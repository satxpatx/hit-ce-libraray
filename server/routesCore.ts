import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, withTransaction } from './db.ts';
import {
  authRateLimiter,
  createNotification,
  createSession,
  deleteSession,
  getUserById,
  requireAuth,
  requireRole,
  resolveOptionalSessionUser,
  writeAuditLog,
  type AuthedRequest,
} from './auth.ts';
import {
  buildQrPayload,
  calculateOverdueAndFine,
  checkBorrowingEligibility,
  computeDueDate,
  formatAccessionNumber,
  parseScannedIdentifier,
  type UserRole,
} from '../src/lib/libraryRules.ts';

export const coreRouter = Router();

function getSettings() {
  return db.prepare('SELECT * FROM institution_settings WHERE id = 1').get() as {
    institution_name: string;
    department_name: string;
    location: string;
    application_name: string;
    tagline: string;
    academic_session: string;
    institution_logo_url: string | null;
    department_logo_url: string | null;
    accession_prefix: string;
    accession_year_format: 'CALENDAR' | 'ACADEMIC';
    accession_start_sequence: number;
    student_borrow_limit: number;
    faculty_borrow_limit: number;
    student_loan_days: number;
    faculty_loan_days: number;
    max_renewals: number;
    fine_per_day_inr: number;
    max_fine_inr: number;
    reservation_expiry_hours: number;
    email_notifications_on: number;
  };
}

function getNextAccessionNumberLocked(): { accessionNumber: string; year: number; seq: number } {
  const settings = getSettings();
  const year = new Date().getFullYear();
  const prefix = settings.accession_prefix || 'HIT-CE';
  const yearFormat = settings.accession_year_format === 'ACADEMIC' ? 'ACADEMIC' : 'CALENDAR';

  let row = db
    .prepare('SELECT id, last_number FROM accession_sequences WHERE prefix = ? AND current_year = ?')
    .get(prefix, year) as { id: number; last_number: number } | undefined;

  let nextSeq = Math.max(settings.accession_start_sequence || 1, 1);
  if (!row) {
    db.prepare(
      'INSERT INTO accession_sequences (prefix, year_format, current_year, last_number) VALUES (?, ?, ?, ?)'
    ).run(prefix, yearFormat, year, nextSeq);
  } else {
    nextSeq = Math.max(row.last_number + 1, settings.accession_start_sequence || 1);
    db.prepare(
      `UPDATE accession_sequences SET last_number = ?, year_format = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(nextSeq, yearFormat, row.id);
  }

  // Ensure uniqueness even if manual accession numbers were imported ahead of sequence
  let candidate = formatAccessionNumber({ prefix, yearFormat, year, sequence: nextSeq });
  while (db.prepare('SELECT 1 FROM book_copies WHERE accession_number = ?').get(candidate)) {
    nextSeq += 1;
    candidate = formatAccessionNumber({ prefix, yearFormat, year, sequence: nextSeq });
    db.prepare(
      `UPDATE accession_sequences SET last_number = ?, updated_at = datetime('now') WHERE prefix = ? AND current_year = ?`
    ).run(nextSeq, prefix, year);
  }

  return { accessionNumber: candidate, year, seq: nextSeq };
}

// ============================================================
// PUBLIC INSTITUTION BRANDING & AUTHENTICATION
// ============================================================

coreRouter.get('/public/branding', (_req, res) => {
  const s = getSettings();
  res.json({
    institutionName: s.institution_name,
    departmentName: s.department_name,
    location: s.location,
    applicationName: s.application_name,
    tagline: s.tagline,
    academicSession: s.academic_session,
    institutionLogoUrl: s.institution_logo_url,
    departmentLogoUrl: s.department_logo_url,
  });
});

coreRouter.post('/auth/login', authRateLimiter, (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(4),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Please provide a valid email address and password.' });
    return;
  }

  const userRow = db
    .prepare('SELECT id, password_hash, status FROM users WHERE LOWER(email) = LOWER(?)')
    .get(parsed.data.email.trim()) as { id: number; password_hash: string; status: string } | undefined;

  if (!userRow || !bcrypt.compareSync(parsed.data.password, userRow.password_hash)) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }
  if (userRow.status !== 'ACTIVE') {
    res.status(403).json({ error: 'Your account is currently deactivated. Contact the departmental librarian.' });
    return;
  }

  const session = createSession(userRow.id);
  const user = getUserById(userRow.id)!;

  res.cookie('hit_lib_session', session.token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 3600 * 1000,
  });

  writeAuditLog(
    { user, ip: req.ip } as AuthedRequest,
    'AUTH_LOGIN',
    'USER',
    user.id,
    `${user.fullName} (${user.role}) signed in via institutional credentials.`
  );

  res.json({ token: session.token, expiresAt: session.expiresAt, user });
});

coreRouter.post('/auth/firebase-exchange', authRateLimiter, (req, res) => {
  const schema = z.object({
    uid: z.string().min(3),
    email: z.string().email(),
    displayName: z.string().optional(),
    photoUrl: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid Google sign-in payload.' });
    return;
  }

  const { uid, email, displayName, photoUrl } = parsed.data;
  let userRow = db
    .prepare('SELECT id, status FROM users WHERE firebase_uid = ? OR LOWER(email) = LOWER(?)')
    .get(uid, email) as { id: number; status: string } | undefined;

  if (!userRow) {
    const targetRole =
      email.toLowerCase() === 'patrasatyabrata8@gmail.com' ? 'SUPER_ADMIN' : 'STUDENT';
    const roleRow = db.prepare('SELECT id FROM roles WHERE name = ?').get(targetRole) as { id: number };
    const deptRow = db.prepare("SELECT id FROM departments WHERE code = 'CE'").get() as { id: number } | undefined;
    const randomHash = bcrypt.hashSync(`firebase-oauth-${uid}-${Date.now()}`, 8);

    const inserted = db
      .prepare(
        `INSERT INTO users (firebase_uid, email, password_hash, full_name, photo_url, role_id, department_id, status, is_demo_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 0)`
      )
      .run(uid, email, randomHash, displayName || email.split('@')[0], photoUrl || null, roleRow.id, deptRow?.id ?? null);

    const newId = Number(inserted.lastInsertRowid);
    if (targetRole === 'STUDENT' && deptRow) {
      db.prepare(
        `INSERT OR IGNORE INTO students (user_id, registration_number, programme, semester, academic_session, department_id)
         VALUES (?, ?, 'B.Tech Civil Engineering', 1, '2026-2030', ?)`
      ).run(newId, `HIT/CE/G/${newId}`, deptRow.id);
    }
    userRow = { id: newId, status: 'ACTIVE' };
  } else {
    db.prepare('UPDATE users SET firebase_uid = COALESCE(firebase_uid, ?) WHERE id = ?').run(uid, userRow.id);
  }

  if (userRow.status !== 'ACTIVE') {
    res.status(403).json({ error: 'Account is deactivated.' });
    return;
  }

  const session = createSession(userRow.id);
  const user = getUserById(userRow.id)!;
  res.cookie('hit_lib_session', session.token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 3600 * 1000,
  });

  writeAuditLog(
    { user, ip: req.ip } as AuthedRequest,
    'AUTH_GOOGLE_LOGIN',
    'USER',
    user.id,
    `${user.fullName} signed in via Google / Firebase Auth.`
  );

  res.json({ token: session.token, expiresAt: session.expiresAt, user });
});

coreRouter.get('/auth/session', (req, res) => {
  res.json({ user: resolveOptionalSessionUser(req) });
});

coreRouter.get('/auth/me', requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

coreRouter.post('/auth/logout', requireAuth, (req: AuthedRequest, res) => {
  if (req.sessionToken) {
    deleteSession(req.sessionToken);
  }
  res.clearCookie('hit_lib_session');
  res.json({ ok: true });
});

// ============================================================
// ROLE-AWARE REAL DATABASE DASHBOARD
// ============================================================

coreRouter.get('/dashboard', requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!;
  const isStaff = user.role === 'SUPER_ADMIN' || user.role === 'LIBRARIAN';

  // Auto-mark active loans past due_date as OVERDUE for live accuracy
  db.prepare(
    `UPDATE book_issues SET status = 'OVERDUE' WHERE status = 'ISSUED' AND datetime(due_date) < datetime('now')`
  ).run();

  if (isStaff) {
    const totalTitles = (db.prepare('SELECT COUNT(*) as c FROM books WHERE archived = 0').get() as { c: number }).c;
    const totalCopies = (db.prepare('SELECT COUNT(*) as c FROM book_copies').get() as { c: number }).c;
    const availableCopies = (
      db.prepare("SELECT COUNT(*) as c FROM book_copies WHERE status = 'AVAILABLE'").get() as { c: number }
    ).c;
    const issuedCopies = (
      db.prepare("SELECT COUNT(*) as c FROM book_copies WHERE status = 'ISSUED'").get() as { c: number }
    ).c;
    const reservedCopies = (
      db.prepare("SELECT COUNT(*) as c FROM book_copies WHERE status = 'RESERVED'").get() as { c: number }
    ).c;
    const overdueBooks = (
      db.prepare("SELECT COUNT(*) as c FROM book_issues WHERE status = 'OVERDUE'").get() as { c: number }
    ).c;
    const lostBooks = (
      db.prepare("SELECT COUNT(*) as c FROM book_copies WHERE status = 'LOST'").get() as { c: number }
    ).c;
    const damagedBooks = (
      db.prepare("SELECT COUNT(*) as c FROM book_copies WHERE status = 'DAMAGED'").get() as { c: number }
    ).c;
    const totalStudents = (db.prepare('SELECT COUNT(*) as c FROM students').get() as { c: number }).c;
    const totalFaculty = (db.prepare('SELECT COUNT(*) as c FROM faculty').get() as { c: number }).c;
    const currentYear = String(new Date().getFullYear());
    const booksAddedThisYear = (
      db
        .prepare("SELECT COUNT(*) as c FROM book_copies WHERE substr(acquisition_date, 1, 4) = ?")
        .get(currentYear) as { c: number }
    ).c;
    const outstandingFines = (
      db
        .prepare(
          `SELECT COALESCE(SUM(amount_inr - paid_amount_inr - waived_amount_inr), 0) as total
           FROM fines WHERE status IN ('PENDING', 'PARTIALLY_PAID')`
        )
        .get() as { total: number }
    ).total;

    const monthlyCirculation = db
      .prepare(
        `SELECT substr(issue_date, 1, 7) as month,
                COUNT(*) as issues,
                SUM(CASE WHEN status = 'RETURNED' THEN 1 ELSE 0 END) as returns,
                SUM(CASE WHEN status = 'OVERDUE' THEN 1 ELSE 0 END) as overdue
         FROM book_issues
         GROUP BY substr(issue_date, 1, 7)
         ORDER BY month ASC
         LIMIT 12`
      )
      .all();

    const categoryInventory = db
      .prepare(
        `SELECT c.name as category, COUNT(bc.id) as copies, COUNT(DISTINCT b.id) as titles
         FROM categories c
         JOIN books b ON b.category_id = c.id
         LEFT JOIN book_copies bc ON bc.book_id = b.id
         GROUP BY c.id
         ORDER BY copies DESC
         LIMIT 10`
      )
      .all();

    const mostBorrowed = db
      .prepare(
        `SELECT b.title, c.name as category, COUNT(bi.id) as borrowCount
         FROM book_issues bi
         JOIN book_copies bc ON bc.id = bi.book_copy_id
         JOIN books b ON b.id = bc.book_id
         JOIN categories c ON c.id = b.category_id
         GROUP BY b.id
         ORDER BY borrowCount DESC
         LIMIT 8`
      )
      .all();

    const monthlyAcquisitions = db
      .prepare(
        `SELECT substr(acquisition_date, 1, 7) as month,
                COUNT(*) as copiesAdded,
                ROUND(SUM(purchase_price_inr), 2) as spendInr
         FROM book_copies
         GROUP BY substr(acquisition_date, 1, 7)
         ORDER BY month ASC
         LIMIT 12`
      )
      .all();

    const recentActivities = db
      .prepare(
        `SELECT id, actor_name, actor_role, action, entity_type, entity_id, details, created_at
         FROM audit_logs
         ORDER BY id DESC
         LIMIT 12`
      )
      .all();

    res.json({
      mode: 'STAFF',
      stats: {
        totalTitles,
        totalCopies,
        availableCopies,
        issuedCopies,
        reservedCopies,
        overdueBooks,
        lostBooks,
        damagedBooks,
        totalStudents,
        totalFaculty,
        booksAddedThisYear,
        outstandingFines: Math.round(outstandingFines * 100) / 100,
      },
      charts: {
        monthlyCirculation,
        categoryInventory,
        mostBorrowed,
        monthlyAcquisitions,
      },
      recentActivities,
    });
    return;
  }

  // Student / Faculty Dashboard
  const issuedBooks = db
    .prepare(
      `SELECT bi.id, bi.receipt_no, bi.issue_date, bi.due_date, bi.status, bi.renewal_count,
              bc.accession_number, bc.shelf_number, bc.rack_number,
              b.id as book_id, b.title, a.name as author, c.name as category
       FROM book_issues bi
       JOIN book_copies bc ON bc.id = bi.book_copy_id
       JOIN books b ON b.id = bc.book_id
       JOIN authors a ON a.id = b.author_id
       JOIN categories c ON c.id = b.category_id
       WHERE bi.borrower_id = ? AND bi.status IN ('ISSUED', 'OVERDUE')
       ORDER BY bi.due_date ASC`
    )
    .all(user.id);

  const borrowingHistory = db
    .prepare(
      `SELECT bi.id, bi.receipt_no, bi.issue_date, bi.due_date, bi.status,
              br.return_date, br.overdue_days, br.fine_amount_inr,
              bc.accession_number, b.title, a.name as author
       FROM book_issues bi
       JOIN book_copies bc ON bc.id = bi.book_copy_id
       JOIN books b ON b.id = bc.book_id
       JOIN authors a ON a.id = b.author_id
       LEFT JOIN book_returns br ON br.book_issue_id = bi.id
       WHERE bi.borrower_id = ?
       ORDER BY bi.issue_date DESC
       LIMIT 20`
    )
    .all(user.id);

  const activeReservations = db
    .prepare(
      `SELECT res.id, res.status, res.reserved_at, res.expires_at, rq.position,
              b.id as book_id, b.title, a.name as author
       FROM reservations res
       JOIN books b ON b.id = res.book_id
       JOIN authors a ON a.id = b.author_id
       LEFT JOIN reservation_queue rq ON rq.reservation_id = res.id
       WHERE res.user_id = ? AND res.status IN ('ACTIVE', 'READY')
       ORDER BY res.reserved_at DESC`
    )
    .all(user.id);

  const newArrivals = db
    .prepare(
      `SELECT b.id, b.book_code, b.title, a.name as author, c.name as category, b.publication_year,
              (SELECT COUNT(*) FROM book_copies bc WHERE bc.book_id = b.id AND bc.status = 'AVAILABLE') as available_copies
       FROM books b
       JOIN authors a ON a.id = b.author_id
       JOIN categories c ON c.id = b.category_id
       WHERE b.archived = 0
       ORDER BY b.id DESC
       LIMIT 8`
    )
    .all();

  const recommendedBooks = db
    .prepare(
      `SELECT b.id, b.book_code, b.title, a.name as author, c.name as category, b.subject,
              (SELECT COUNT(*) FROM book_copies bc WHERE bc.book_id = b.id AND bc.status = 'AVAILABLE') as available_copies
       FROM books b
       JOIN authors a ON a.id = b.author_id
       JOIN categories c ON c.id = b.category_id
       WHERE b.archived = 0 AND c.name IN ('Structural Engineering', 'Concrete Technology', 'Geotechnical Engineering', 'Machine Learning in Civil Engineering', 'GATE & Competitive Exams')
       ORDER BY available_copies DESC, b.id ASC
       LIMIT 8`
    )
    .all();

  const unpaidFines = (
    db
      .prepare(
        `SELECT COALESCE(SUM(amount_inr - paid_amount_inr - waived_amount_inr), 0) as total
         FROM fines WHERE user_id = ? AND status IN ('PENDING', 'PARTIALLY_PAID')`
      )
      .get(user.id) as { total: number }
  ).total;

  const settings = getSettings();

  res.json({
    mode: 'MEMBER',
    stats: {
      activeIssued: issuedBooks.length,
      overdueCount: issuedBooks.filter((b: any) => b.status === 'OVERDUE').length,
      activeReservations: activeReservations.length,
      totalHistory: borrowingHistory.length,
      unpaidFinesInr: Math.round(unpaidFines * 100) / 100,
      borrowLimit: user.role === 'FACULTY' ? settings.faculty_borrow_limit : settings.student_borrow_limit,
      maxRenewals: settings.max_renewals,
    },
    issuedBooks,
    borrowingHistory,
    activeReservations,
    newArrivals,
    recommendedBooks,
  });
});

// ============================================================
// BOOK CATALOGUE & ADVANCED SEARCH
// ============================================================

coreRouter.get('/books', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  const category = String(req.query.category || '').trim();
  const author = String(req.query.author || '').trim();
  const publisher = String(req.query.publisher || '').trim();
  const year = String(req.query.year || '').trim();
  const edition = String(req.query.edition || '').trim();
  const availability = String(req.query.availability || '').trim();
  const includeArchived = req.query.includeArchived === 'true';
  const sort = String(req.query.sort || 'newest');
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 25));

  let where = 'WHERE 1=1';
  const params: (string | number)[] = [];

  if (!includeArchived) {
    where += ' AND b.archived = 0';
  }
  if (q) {
    const like = `%${q}%`;
    where += ` AND (
      b.title LIKE ? OR b.subtitle LIKE ? OR b.isbn LIKE ? OR b.book_code LIKE ?
      OR b.subject LIKE ? OR b.keywords LIKE ? OR a.name LIKE ? OR p.name LIKE ? OR c.name LIKE ?
      OR EXISTS (SELECT 1 FROM book_copies bc2 WHERE bc2.book_id = b.id AND bc2.accession_number LIKE ?)
    )`;
    params.push(like, like, like, like, like, like, like, like, like, like);
  }
  if (category) {
    where += ' AND c.name = ?';
    params.push(category);
  }
  if (author) {
    where += ' AND a.name LIKE ?';
    params.push(`%${author}%`);
  }
  if (publisher) {
    where += ' AND p.name LIKE ?';
    params.push(`%${publisher}%`);
  }
  if (year) {
    where += ' AND b.publication_year = ?';
    params.push(Number(year));
  }
  if (edition) {
    where += ' AND b.edition LIKE ?';
    params.push(`%${edition}%`);
  }
  if (availability === 'AVAILABLE') {
    where += ` AND EXISTS (SELECT 1 FROM book_copies bc3 WHERE bc3.book_id = b.id AND bc3.status = 'AVAILABLE')`;
  } else if (availability === 'UNAVAILABLE') {
    where += ` AND NOT EXISTS (SELECT 1 FROM book_copies bc3 WHERE bc3.book_id = b.id AND bc3.status = 'AVAILABLE')`;
  }

  let orderBy = 'ORDER BY b.id DESC';
  if (sort === 'title_asc') orderBy = 'ORDER BY b.title ASC';
  if (sort === 'title_desc') orderBy = 'ORDER BY b.title DESC';
  if (sort === 'year_desc') orderBy = 'ORDER BY b.publication_year DESC';
  if (sort === 'author_asc') orderBy = 'ORDER BY a.name ASC';

  const countRow = db
    .prepare(
      `SELECT COUNT(*) as total
       FROM books b
       JOIN authors a ON a.id = b.author_id
       JOIN publishers p ON p.id = b.publisher_id
       JOIN categories c ON c.id = b.category_id
       ${where}`
    )
    .get(...params) as { total: number };

  const offset = (page - 1) * pageSize;
  const items = db
    .prepare(
      `SELECT b.id, b.book_code, b.isbn, b.title, b.subtitle, a.name as author, b.editor,
              p.name as publisher, b.edition, b.publication_year, b.language, b.subject,
              c.name as category, b.subcategory, b.description, b.keywords,
              b.cover_image_url, b.digital_attachment, b.archived, b.is_demo_data, b.created_at,
              (SELECT COUNT(*) FROM book_copies bc WHERE bc.book_id = b.id) as total_copies,
              (SELECT COUNT(*) FROM book_copies bc WHERE bc.book_id = b.id AND bc.status = 'AVAILABLE') as available_copies
       FROM books b
       JOIN authors a ON a.id = b.author_id
       JOIN publishers p ON p.id = b.publisher_id
       JOIN categories c ON c.id = b.category_id
       ${where}
       ${orderBy}
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset);

  res.json({
    items,
    total: countRow.total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(countRow.total / pageSize)),
  });
});

coreRouter.get('/books/suggestions', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) {
    res.json({ suggestions: [] });
    return;
  }
  const like = `%${q}%`;
  const rows = db
    .prepare(
      `SELECT b.id, b.title, a.name as author, b.isbn, c.name as category
       FROM books b
       JOIN authors a ON a.id = b.author_id
       JOIN categories c ON c.id = b.category_id
       WHERE b.archived = 0 AND (b.title LIKE ? OR a.name LIKE ? OR b.isbn LIKE ? OR b.subject LIKE ?)
       LIMIT 8`
    )
    .all(like, like, like, like);
  res.json({ suggestions: rows });
});

coreRouter.get('/books/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const book = db
    .prepare(
      `SELECT b.*, a.name as author, p.name as publisher, c.name as category
       FROM books b
       JOIN authors a ON a.id = b.author_id
       JOIN publishers p ON p.id = b.publisher_id
       JOIN categories c ON c.id = b.category_id
       WHERE b.id = ?`
    )
    .get(id);
  if (!book) {
    res.status(404).json({ error: 'Book not found.' });
    return;
  }
  const copies = db
    .prepare(
      `SELECT bc.*, qr.payload as qr_payload, bar.value as barcode_value
       FROM book_copies bc
       LEFT JOIN qr_codes qr ON qr.book_copy_id = bc.id
       LEFT JOIN barcodes bar ON bar.book_copy_id = bc.id
       WHERE bc.book_id = ?
       ORDER BY bc.copy_number ASC`
    )
    .all(id);
  res.json({ book, copies });
});

const bookCreateSchema = z.object({
  bookCode: z.string().min(2).max(64).optional(),
  isbn: z.string().max(32).optional().nullable(),
  title: z.string().min(2).max(250),
  subtitle: z.string().max(250).optional().nullable(),
  author: z.string().min(2).max(200),
  editor: z.string().max(200).optional().nullable(),
  publisher: z.string().min(2).max(200),
  edition: z.string().max(60).optional().nullable(),
  publicationYear: z.coerce.number().int().min(1850).max(2100).optional().nullable(),
  language: z.string().max(60).optional(),
  subject: z.string().min(2).max(160),
  category: z.string().min(2).max(140),
  subcategory: z.string().max(140).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  keywords: z.string().max(500).optional().nullable(),
  initialCopies: z.coerce.number().int().min(0).max(100).optional(),
  purchasePriceInr: z.coerce.number().min(0).optional(),
  supplier: z.string().max(200).optional(),
  invoiceNumber: z.string().max(100).optional(),
  fundingSource: z.string().max(160).optional(),
  shelfNumber: z.string().max(40).optional(),
  rackNumber: z.string().max(40).optional(),
});

function resolveOrInsertTaxonomy(authorName: string, publisherName: string, categoryName: string) {
  let author = db.prepare('SELECT id FROM authors WHERE LOWER(name) = LOWER(?)').get(authorName.trim()) as
    | { id: number }
    | undefined;
  if (!author) {
    author = { id: Number(db.prepare('INSERT INTO authors (name) VALUES (?)').run(authorName.trim()).lastInsertRowid) };
  }

  let publisher = db.prepare('SELECT id FROM publishers WHERE LOWER(name) = LOWER(?)').get(publisherName.trim()) as
    | { id: number }
    | undefined;
  if (!publisher) {
    publisher = {
      id: Number(db.prepare('INSERT INTO publishers (name) VALUES (?)').run(publisherName.trim()).lastInsertRowid),
    };
  }

  let category = db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)').get(categoryName.trim()) as
    | { id: number }
    | undefined;
  if (!category) {
    const code =
      categoryName
        .replace(/[^A-Za-z]/g, '')
        .slice(0, 3)
        .toUpperCase() + Math.floor(10 + Math.random() * 89);
    category = {
      id: Number(
        db
          .prepare('INSERT INTO categories (name, code, description) VALUES (?, ?, ?)')
          .run(categoryName.trim(), code, 'Custom departmental category').lastInsertRowid
      ),
    };
  }

  return { authorId: author.id, publisherId: publisher.id, categoryId: category.id };
}

coreRouter.post('/books', requireAuth, requireRole('SUPER_ADMIN', 'LIBRARIAN'), (req: AuthedRequest, res) => {
  const parsed = bookCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid book details.' });
    return;
  }

  const d = parsed.data;
  try {
    const created = withTransaction(() => {
      const { authorId, publisherId, categoryId } = resolveOrInsertTaxonomy(d.author, d.publisher, d.category);
      const countBooks = (db.prepare('SELECT COUNT(*) as c FROM books').get() as { c: number }).c;
      const bookCode = (d.bookCode?.trim() || `CE-BK-${String(countBooks + 1).padStart(3, '0')}`).toUpperCase();

      if (d.isbn && db.prepare('SELECT id FROM books WHERE isbn = ?').get(d.isbn.trim())) {
        throw new Error(`A book title with ISBN "${d.isbn}" already exists in the catalogue.`);
      }

      const bookId = Number(
        db
          .prepare(
            `INSERT INTO books (
              book_code, isbn, title, subtitle, author_id, editor, publisher_id, edition,
              publication_year, language, subject, category_id, subcategory, description, keywords, archived, is_demo_data
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`
          )
          .run(
            bookCode,
            d.isbn?.trim() || null,
            d.title.trim(),
            d.subtitle?.trim() || null,
            authorId,
            d.editor?.trim() || null,
            publisherId,
            d.edition?.trim() || '1st Edition',
            d.publicationYear ?? new Date().getFullYear(),
            d.language?.trim() || 'English',
            d.subject.trim(),
            categoryId,
            d.subcategory?.trim() || null,
            d.description?.trim() || null,
            d.keywords?.trim() || null
          ).lastInsertRowid
      );

      const copiesCreated: Array<{ id: number; accessionNumber: string; copyNumber: number }> = [];
      const copyCount = d.initialCopies ?? 0;
      for (let i = 1; i <= copyCount; i++) {
        const { accessionNumber } = getNextAccessionNumberLocked();
        const copyId = Number(
          db
            .prepare(
              `INSERT INTO book_copies (
                accession_number, book_id, copy_number, acquisition_date, purchase_price_inr,
                supplier, invoice_number, funding_source, shelf_number, rack_number,
                physical_condition, status, remarks, is_demo_data
              ) VALUES (?, ?, ?, date('now'), ?, ?, ?, ?, ?, ?, 'New', 'AVAILABLE', 'Registered with title', 0)`
            )
            .run(
              accessionNumber,
              bookId,
              i,
              d.purchasePriceInr ?? 0,
              d.supplier?.trim() || 'Departmental Procurement',
              d.invoiceNumber?.trim() || null,
              d.fundingSource?.trim() || 'Departmental Budget',
              d.shelfNumber?.trim() || 'S-01',
              d.rackNumber?.trim() || 'R-01'
            ).lastInsertRowid
        );
        db.prepare('INSERT INTO barcodes (book_copy_id, format, value) VALUES (?, ?, ?)').run(
          copyId,
          'CODE128',
          accessionNumber
        );
        db.prepare('INSERT INTO qr_codes (book_copy_id, payload) VALUES (?, ?)').run(
          copyId,
          buildQrPayload({ accessionNumber, bookCode, copyNumber: i })
        );
        copiesCreated.push({ id: copyId, accessionNumber, copyNumber: i });
      }

      return { bookId, bookCode, copiesCreated };
    });

    writeAuditLog(
      req,
      'BOOK_CREATE',
      'BOOK',
      created.bookId,
      `Created book "${d.title}" (${created.bookCode}) with ${created.copiesCreated.length} initial copies.`
    );
    res.status(201).json(created);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to create book.' });
  }
});

coreRouter.put('/books/:id', requireAuth, requireRole('SUPER_ADMIN', 'LIBRARIAN'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = bookCreateSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid book update payload.' });
    return;
  }
  const existing = db.prepare('SELECT * FROM books WHERE id = ?').get(id) as Record<string, any> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Book not found.' });
    return;
  }

  const d = parsed.data;
  try {
    withTransaction(() => {
      const authorName =
        d.author ||
        (db.prepare('SELECT name FROM authors WHERE id = ?').get(existing.author_id) as { name: string }).name;
      const publisherName =
        d.publisher ||
        (db.prepare('SELECT name FROM publishers WHERE id = ?').get(existing.publisher_id) as { name: string }).name;
      const categoryName =
        d.category ||
        (db.prepare('SELECT name FROM categories WHERE id = ?').get(existing.category_id) as { name: string }).name;

      const { authorId, publisherId, categoryId } = resolveOrInsertTaxonomy(authorName, publisherName, categoryName);

      db.prepare(
        `UPDATE books SET
          isbn = ?, title = ?, subtitle = ?, author_id = ?, editor = ?, publisher_id = ?,
          edition = ?, publication_year = ?, language = ?, subject = ?, category_id = ?,
          subcategory = ?, description = ?, keywords = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        d.isbn !== undefined ? d.isbn || null : existing.isbn,
        d.title ?? existing.title,
        d.subtitle !== undefined ? d.subtitle || null : existing.subtitle,
        authorId,
        d.editor !== undefined ? d.editor || null : existing.editor,
        publisherId,
        d.edition ?? existing.edition,
        d.publicationYear ?? existing.publication_year,
        d.language ?? existing.language,
        d.subject ?? existing.subject,
        categoryId,
        d.subcategory !== undefined ? d.subcategory || null : existing.subcategory,
        d.description !== undefined ? d.description || null : existing.description,
        d.keywords !== undefined ? d.keywords || null : existing.keywords,
        id
      );
    });
    writeAuditLog(req, 'BOOK_UPDATE', 'BOOK', id, `Updated catalogue record for book ID ${id}.`);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update book.' });
  }
});

coreRouter.patch('/books/:id/archive', requireAuth, requireRole('SUPER_ADMIN', 'LIBRARIAN'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const archived = req.body?.archived ? 1 : 0;
  db.prepare(`UPDATE books SET archived = ?, updated_at = datetime('now') WHERE id = ?`).run(archived, id);
  writeAuditLog(req, archived ? 'BOOK_ARCHIVE' : 'BOOK_RESTORE', 'BOOK', id, `Set archived=${archived} for book ${id}.`);
  res.json({ ok: true });
});

// ============================================================
// ACCESSION REGISTER & PHYSICAL BOOK COPIES
// ============================================================

coreRouter.get('/copies', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim();
  const year = String(req.query.year || '').trim();
  const subject = String(req.query.subject || '').trim();
  const bookId = req.query.bookId ? Number(req.query.bookId) : null;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(300, Math.max(1, Number(req.query.pageSize) || 50));

  let where = 'WHERE 1=1';
  const params: (string | number)[] = [];

  if (q) {
    const like = `%${q}%`;
    where += ` AND (bc.accession_number LIKE ? OR b.title LIKE ? OR b.isbn LIKE ? OR b.book_code LIKE ? OR a.name LIKE ? OR bc.invoice_number LIKE ?)`;
    params.push(like, like, like, like, like, like);
  }
  if (status) {
    where += ' AND bc.status = ?';
    params.push(status);
  }
  if (year) {
    where += ' AND substr(bc.acquisition_date, 1, 4) = ?';
    params.push(year);
  }
  if (subject) {
    where += ' AND (c.name = ? OR b.subject LIKE ?)';
    params.push(subject, `%${subject}%`);
  }
  if (bookId) {
    where += ' AND bc.book_id = ?';
    params.push(bookId);
  }

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) as c
         FROM book_copies bc
         JOIN books b ON b.id = bc.book_id
         JOIN authors a ON a.id = b.author_id
         JOIN categories c ON c.id = b.category_id
         ${where}`
      )
      .get(...params) as { c: number }
  ).c;

  const offset = (page - 1) * pageSize;
  const items = db
    .prepare(
      `SELECT bc.*, b.book_code, b.isbn, b.title, b.edition, b.publication_year, b.subject,
              a.name as author, p.name as publisher, c.name as category,
              bar.value as barcode_value, qr.payload as qr_payload
       FROM book_copies bc
       JOIN books b ON b.id = bc.book_id
       JOIN authors a ON a.id = b.author_id
       JOIN publishers p ON p.id = b.publisher_id
       JOIN categories c ON c.id = b.category_id
       LEFT JOIN barcodes bar ON bar.book_copy_id = bc.id
       LEFT JOIN qr_codes qr ON qr.book_copy_id = bc.id
       ${where}
       ORDER BY bc.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset);

  const settings = getSettings();
  const seqRow = db
    .prepare('SELECT last_number FROM accession_sequences WHERE prefix = ? AND current_year = ?')
    .get(settings.accession_prefix, new Date().getFullYear()) as { last_number: number } | undefined;

  const nextPreview = formatAccessionNumber({
    prefix: settings.accession_prefix,
    yearFormat: settings.accession_year_format,
    year: new Date().getFullYear(),
    sequence: Math.max((seqRow?.last_number ?? 0) + 1, settings.accession_start_sequence || 1),
  });

  res.json({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    nextAccessionPreview: nextPreview,
  });
});

coreRouter.get('/copies/lookup', requireAuth, (req, res) => {
  const raw = String(req.query.code || '').trim();
  const parsed = parseScannedIdentifier(raw);
  if (!parsed.accessionNumber) {
    res.status(400).json({ error: 'Scan or enter a valid Accession Number, Barcode, or QR payload.' });
    return;
  }

  const copy = db
    .prepare(
      `SELECT bc.*, b.book_code, b.isbn, b.title, b.edition, b.subject,
              a.name as author, p.name as publisher, c.name as category,
              bar.value as barcode_value, qr.payload as qr_payload
       FROM book_copies bc
       JOIN books b ON b.id = bc.book_id
       JOIN authors a ON a.id = b.author_id
       JOIN publishers p ON p.id = b.publisher_id
       JOIN categories c ON c.id = b.category_id
       LEFT JOIN barcodes bar ON bar.book_copy_id = bc.id
       LEFT JOIN qr_codes qr ON qr.book_copy_id = bc.id
       WHERE UPPER(bc.accession_number) = ? OR UPPER(bar.value) = ?`
    )
    .get(parsed.accessionNumber, parsed.accessionNumber) as Record<string, any> | undefined;

  if (!copy) {
    res.status(404).json({
      error: `No physical book copy found for scanned code "${parsed.accessionNumber}".`,
    });
    return;
  }

  const activeIssue = db
    .prepare(
      `SELECT bi.*, u.full_name as borrower_name, u.email as borrower_email, r.name as borrower_role,
              COALESCE(s.registration_number, f.employee_id, u.email) as member_code
       FROM book_issues bi
       JOIN users u ON u.id = bi.borrower_id
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN students s ON s.user_id = u.id
       LEFT JOIN faculty f ON f.user_id = u.id
       WHERE bi.book_copy_id = ? AND bi.status IN ('ISSUED', 'OVERDUE')
       ORDER BY bi.id DESC
       LIMIT 1`
    )
    .get(copy.id) as Record<string, any> | undefined;

  let overduePreview = { overdueDays: 0, fineAmountInr: 0 };
  if (activeIssue) {
    const settings = getSettings();
    overduePreview = calculateOverdueAndFine({
      dueDateIso: activeIssue.due_date,
      asOfDateIso: new Date().toISOString(),
      finePerDayInr: settings.fine_per_day_inr,
      maxFineInr: settings.max_fine_inr,
    });
  }

  res.json({
    parsed,
    copy,
    activeIssue: activeIssue ? { ...activeIssue, ...overduePreview } : null,
  });
});

coreRouter.get('/copies/:id/history', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const copy = db
    .prepare(
      `SELECT bc.*, b.title, b.book_code, a.name as author
       FROM book_copies bc
       JOIN books b ON b.id = bc.book_id
       JOIN authors a ON a.id = b.author_id
       WHERE bc.id = ?`
    )
    .get(id);
  if (!copy) {
    res.status(404).json({ error: 'Physical book copy not found.' });
    return;
  }

  const history = db
    .prepare(
      `SELECT bi.id, bi.receipt_no, bi.issue_date, bi.due_date, bi.status, bi.renewal_count,
              br.return_date, br.return_receipt, br.overdue_days, br.fine_amount_inr, br.condition_note,
              u.full_name as borrower_name, r.name as borrower_role,
              COALESCE(s.registration_number, f.employee_id, u.email) as member_code
       FROM book_issues bi
       JOIN users u ON u.id = bi.borrower_id
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN students s ON s.user_id = u.id
       LEFT JOIN faculty f ON f.user_id = u.id
       LEFT JOIN book_returns br ON br.book_issue_id = bi.id
       WHERE bi.book_copy_id = ?
       ORDER BY bi.issue_date DESC`
    )
    .all(id);

  res.json({ copy, history });
});

coreRouter.post('/copies', requireAuth, requireRole('SUPER_ADMIN', 'LIBRARIAN'), (req: AuthedRequest, res) => {
  const schema = z.object({
    bookId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().min(1).max(50).default(1),
    acquisitionDate: z.string().optional(),
    purchasePriceInr: z.coerce.number().min(0).default(0),
    supplier: z.string().max(200).optional(),
    invoiceNumber: z.string().max(100).optional(),
    fundingSource: z.string().max(160).optional(),
    shelfNumber: z.string().min(1).max(40).default('S-01'),
    rackNumber: z.string().min(1).max(40).default('R-01'),
    physicalCondition: z.string().max(60).default('New'),
    remarks: z.string().max(400).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid copy details.' });
    return;
  }

  const d = parsed.data;
  const book = db.prepare('SELECT id, book_code, title FROM books WHERE id = ?').get(d.bookId) as
    | { id: number; book_code: string; title: string }
    | undefined;
  if (!book) {
    res.status(404).json({ error: 'Selected book title does not exist.' });
    return;
  }

  try {
    const createdCopies = withTransaction(() => {
      const existingCount = (
        db.prepare('SELECT COALESCE(MAX(copy_number), 0) as m FROM book_copies WHERE book_id = ?').get(d.bookId) as {
          m: number;
        }
      ).m;

      const results: Array<{ id: number; accessionNumber: string; copyNumber: number }> = [];
      for (let i = 1; i <= d.quantity; i++) {
        const copyNumber = existingCount + i;
        const { accessionNumber } = getNextAccessionNumberLocked();
        const copyId = Number(
          db
            .prepare(
              `INSERT INTO book_copies (
                accession_number, book_id, copy_number, acquisition_date, purchase_price_inr,
                supplier, invoice_number, funding_source, shelf_number, rack_number,
                physical_condition, status, remarks, is_demo_data
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AVAILABLE', ?, 0)`
            )
            .run(
              accessionNumber,
              d.bookId,
              copyNumber,
              d.acquisitionDate || new Date().toISOString().slice(0, 10),
              d.purchasePriceInr,
              d.supplier?.trim() || 'Departmental Procurement',
              d.invoiceNumber?.trim() || null,
              d.fundingSource?.trim() || 'Institute Library Budget',
              d.shelfNumber.trim(),
              d.rackNumber.trim(),
              d.physicalCondition.trim(),
              d.remarks?.trim() || null
            ).lastInsertRowid
        );

        db.prepare('INSERT INTO barcodes (book_copy_id, format, value) VALUES (?, ?, ?)').run(
          copyId,
          'CODE128',
          accessionNumber
        );
        db.prepare('INSERT INTO qr_codes (book_copy_id, payload) VALUES (?, ?)').run(
          copyId,
          buildQrPayload({ accessionNumber, bookCode: book.book_code, copyNumber })
        );
        results.push({ id: copyId, accessionNumber, copyNumber });
      }
      return results;
    });

    writeAuditLog(
      req,
      'ACCESSION_REGISTER_ADD',
      'BOOK_COPY',
      createdCopies.map((c) => c.accessionNumber).join(','),
      `Registered ${createdCopies.length} physical copies of "${book.title}": ${createdCopies.map((c) => c.accessionNumber).join(', ')}.`
    );

    res.status(201).json({ copies: createdCopies });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to register physical copies.' });
  }
});

coreRouter.put('/copies/:id', requireAuth, requireRole('SUPER_ADMIN', 'LIBRARIAN'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM book_copies WHERE id = ?').get(id) as Record<string, any> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Copy not found.' });
    return;
  }

  const schema = z.object({
    acquisitionDate: z.string().optional(),
    purchasePriceInr: z.coerce.number().min(0).optional(),
    supplier: z.string().max(200).optional().nullable(),
    invoiceNumber: z.string().max(100).optional().nullable(),
    fundingSource: z.string().max(160).optional().nullable(),
    shelfNumber: z.string().max(40).optional(),
    rackNumber: z.string().max(40).optional(),
    physicalCondition: z.string().max(60).optional(),
    status: z
      .enum(['AVAILABLE', 'ISSUED', 'RESERVED', 'UNDER_MAINTENANCE', 'LOST', 'DAMAGED', 'WITHDRAWN'])
      .optional(),
    remarks: z.string().max(400).optional().nullable(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid copy update payload.' });
    return;
  }

  const d = parsed.data;
  if (existing.status === 'ISSUED' && d.status && d.status !== 'ISSUED' && d.status !== 'LOST' && d.status !== 'DAMAGED') {
    res.status(400).json({ error: 'Cannot change an actively issued copy directly to this status. Process a book return first.' });
    return;
  }

  db.prepare(
    `UPDATE book_copies SET
      acquisition_date = ?, purchase_price_inr = ?, supplier = ?, invoice_number = ?,
      funding_source = ?, shelf_number = ?, rack_number = ?, physical_condition = ?,
      status = ?, remarks = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    d.acquisitionDate ?? existing.acquisition_date,
    d.purchasePriceInr ?? existing.purchase_price_inr,
    d.supplier !== undefined ? d.supplier : existing.supplier,
    d.invoiceNumber !== undefined ? d.invoiceNumber : existing.invoice_number,
    d.fundingSource !== undefined ? d.fundingSource : existing.funding_source,
    d.shelfNumber ?? existing.shelf_number,
    d.rackNumber ?? existing.rack_number,
    d.physicalCondition ?? existing.physical_condition,
    d.status ?? existing.status,
    d.remarks !== undefined ? d.remarks : existing.remarks,
    id
  );

  writeAuditLog(
    req,
    'BOOK_COPY_UPDATE',
    'BOOK_COPY',
    existing.accession_number,
    `Updated copy ${existing.accession_number} (status=${d.status ?? existing.status}, shelf=${d.shelfNumber ?? existing.shelf_number}).`
  );
  res.json({ ok: true });
});

// ============================================================
// CIRCULATION: TRANSACTIONAL ISSUE, RETURN, RENEW & OVERDUE
// ============================================================

coreRouter.get('/circulation/transactions', requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!;
  const isStaff = user.role === 'SUPER_ADMIN' || user.role === 'LIBRARIAN';
  const status = String(req.query.status || '').trim();
  const q = String(req.query.q || '').trim();
  const borrowerId = req.query.borrowerId ? Number(req.query.borrowerId) : null;

  db.prepare(
    `UPDATE book_issues SET status = 'OVERDUE' WHERE status = 'ISSUED' AND datetime(due_date) < datetime('now')`
  ).run();

  let where = 'WHERE 1=1';
  const params: (string | number)[] = [];

  if (!isStaff) {
    where += ' AND bi.borrower_id = ?';
    params.push(user.id);
  } else if (borrowerId) {
    where += ' AND bi.borrower_id = ?';
    params.push(borrowerId);
  }

  if (status === 'ACTIVE') {
    where += ` AND bi.status IN ('ISSUED', 'OVERDUE')`;
  } else if (status) {
    where += ' AND bi.status = ?';
    params.push(status);
  }

  if (q) {
    const like = `%${q}%`;
    where += ` AND (bc.accession_number LIKE ? OR b.title LIKE ? OR u.full_name LIKE ? OR bi.receipt_no LIKE ? OR s.registration_number LIKE ? OR f.employee_id LIKE ?)`;
    params.push(like, like, like, like, like, like);
  }

  const settings = getSettings();
  const rows = db
    .prepare(
      `SELECT bi.*, bc.accession_number, bc.shelf_number, bc.rack_number, bc.book_id,
              b.title, b.isbn, a.name as author,
              u.full_name as borrower_name, u.email as borrower_email, r.name as borrower_role,
              COALESCE(s.registration_number, f.employee_id, u.email) as member_code,
              br.return_date, br.return_receipt, br.overdue_days as returned_overdue_days, br.fine_amount_inr as returned_fine_inr
       FROM book_issues bi
       JOIN book_copies bc ON bc.id = bi.book_copy_id
       JOIN books b ON b.id = bc.book_id
       JOIN authors a ON a.id = b.author_id
       JOIN users u ON u.id = bi.borrower_id
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN students s ON s.user_id = u.id
       LEFT JOIN faculty f ON f.user_id = u.id
       LEFT JOIN book_returns br ON br.book_issue_id = bi.id
       ${where}
       ORDER BY bi.id DESC
       LIMIT 200`
    )
    .all(...params) as Record<string, any>[];

  const nowIso = new Date().toISOString();
  const enriched = rows.map((row) => {
    if (row.status === 'ISSUED' || row.status === 'OVERDUE') {
      const calc = calculateOverdueAndFine({
        dueDateIso: row.due_date,
        asOfDateIso: nowIso,
        finePerDayInr: settings.fine_per_day_inr,
        maxFineInr: settings.max_fine_inr,
      });
      return { ...row, live_overdue_days: calc.overdueDays, live_fine_inr: calc.fineAmountInr };
    }
    return {
      ...row,
      live_overdue_days: row.returned_overdue_days || 0,
      live_fine_inr: row.returned_fine_inr || 0,
    };
  });

  res.json({ items: enriched });
});

coreRouter.post('/circulation/issue', requireAuth, requireRole('SUPER_ADMIN', 'LIBRARIAN'), (req: AuthedRequest, res) => {
  const schema = z.object({
    borrowerId: z.coerce.number().int().positive(),
    scannedCode: z.string().min(2),
    remarks: z.string().max(300).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Borrower and Book Accession Number / QR Code are required.' });
    return;
  }

  const { borrowerId, scannedCode, remarks } = parsed.data;
  const scanned = parseScannedIdentifier(scannedCode);

  try {
    const result = withTransaction(() => {
      const settings = getSettings();
      const borrower = getUserById(borrowerId);
      if (!borrower) {
        throw new Error('Borrower account not found.');
      }

      const copy = db
        .prepare(
          `SELECT bc.*, b.title, b.book_code, a.name as author
           FROM book_copies bc
           JOIN books b ON b.id = bc.book_id
           JOIN authors a ON a.id = b.author_id
           LEFT JOIN barcodes bar ON bar.book_copy_id = bc.id
           WHERE UPPER(bc.accession_number) = ? OR UPPER(bar.value) = ?`
        )
        .get(scanned.accessionNumber, scanned.accessionNumber) as Record<string, any> | undefined;

      if (!copy) {
        throw new Error(`Book copy "${scanned.accessionNumber}" does not exist in the Accession Register.`);
      }

      // Prevent duplicate active issuance on the same physical copy
      const existingActiveLoan = db
        .prepare(`SELECT id, receipt_no FROM book_issues WHERE book_copy_id = ? AND status IN ('ISSUED', 'OVERDUE')`)
        .get(copy.id) as { id: number; receipt_no: string } | undefined;

      if (existingActiveLoan || copy.status === 'ISSUED') {
        throw new Error(
          `Duplicate issuance rejected: Copy ${copy.accession_number} is already issued (Active Receipt: ${existingActiveLoan?.receipt_no || 'Active Loan'}).`
        );
      }

      if (copy.status !== 'AVAILABLE' && copy.status !== 'RESERVED') {
        throw new Error(
          `Copy ${copy.accession_number} cannot be issued because its status is ${copy.status}.`
        );
      }

      // If RESERVED, verify either borrower holds the READY reservation or no other user holds READY
      const readyRes = db
        .prepare(`SELECT id, user_id FROM reservations WHERE book_id = ? AND status = 'READY' ORDER BY id ASC LIMIT 1`)
        .get(copy.book_id) as { id: number; user_id: number } | undefined;
      if (copy.status === 'RESERVED' && readyRes && readyRes.user_id !== borrowerId) {
        throw new Error('This physical copy is reserved and held for another member.');
      }

      const activeLoansRow = db
        .prepare(`SELECT COUNT(*) as c FROM book_issues WHERE borrower_id = ? AND status IN ('ISSUED', 'OVERDUE')`)
        .get(borrowerId) as { c: number };

      const sameTitleRow = db
        .prepare(
          `SELECT COUNT(*) as c FROM book_issues bi
           JOIN book_copies bc ON bc.id = bi.book_copy_id
           WHERE bi.borrower_id = ? AND bc.book_id = ? AND bi.status IN ('ISSUED', 'OVERDUE')`
        )
        .get(borrowerId, copy.book_id) as { c: number };

      const eligibility = checkBorrowingEligibility({
        borrowerRole: borrower.role as UserRole,
        accountStatus: borrower.status,
        activeLoanCount: activeLoansRow.c,
        studentBorrowLimit: settings.student_borrow_limit,
        facultyBorrowLimit: settings.faculty_borrow_limit,
        hasSameTitleActiveLoan: sameTitleRow.c > 0,
      });

      if (!eligibility.eligible) {
        throw new Error(eligibility.reason || 'Borrower is not eligible to issue this book.');
      }

      const issueDateIso = new Date().toISOString();
      const dueDateIso = computeDueDate(
        issueDateIso,
        borrower.role as UserRole,
        settings.student_loan_days,
        settings.faculty_loan_days
      );
      const countTx = (db.prepare('SELECT COUNT(*) as c FROM book_issues').get() as { c: number }).c;
      const receiptNo = `ISS-${new Date().getFullYear()}-${String(countTx + 1).padStart(4, '0')}`;

      const issueId = Number(
        db
          .prepare(
            `INSERT INTO book_issues (receipt_no, book_copy_id, borrower_id, issued_by_id, issue_date, due_date, status, renewal_count, remarks, is_demo_data)
             VALUES (?, ?, ?, ?, ?, ?, 'ISSUED', 0, ?, 0)`
          )
          .run(receiptNo, copy.id, borrowerId, req.user!.id, issueDateIso, dueDateIso, remarks?.trim() || null)
          .lastInsertRowid
      );

      db.prepare(`UPDATE book_copies SET status = 'ISSUED', updated_at = datetime('now') WHERE id = ?`).run(copy.id);

      // Fulfill matching reservation if borrower had one
      db.prepare(
        `UPDATE reservations SET status = 'FULFILLED' WHERE book_id = ? AND user_id = ? AND status IN ('ACTIVE', 'READY')`
      ).run(copy.book_id, borrowerId);

      createNotification(
        borrowerId,
        'ISSUE',
        `Book Issued: ${copy.title}`,
        `Copy ${copy.accession_number} issued under receipt ${receiptNo}. Due date: ${dueDateIso.slice(0, 10)}.`
      );

      return {
        issueId,
        receiptNo,
        accessionNumber: copy.accession_number,
        bookTitle: copy.title,
        author: copy.author,
        borrowerName: borrower.fullName,
        borrowerMemberCode: borrower.memberCode || borrower.email,
        borrowerRole: borrower.role,
        issueDate: issueDateIso,
        dueDate: dueDateIso,
        issuedBy: req.user!.fullName,
      };
    });

    writeAuditLog(
      req,
      'BOOK_ISSUE',
      'CIRCULATION',
      result.receiptNo,
      `Issued copy ${result.accessionNumber} ("${result.bookTitle}") to ${result.borrowerName} (${result.borrowerMemberCode}).`
    );

    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Unable to issue book.' });
  }
});

coreRouter.post('/circulation/return', requireAuth, requireRole('SUPER_ADMIN', 'LIBRARIAN'), (req: AuthedRequest, res) => {
  const schema = z.object({
    scannedCode: z.string().min(2),
    conditionNote: z.string().max(300).optional(),
    markDamaged: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Scan or enter the book Accession Number / QR code to return.' });
    return;
  }

  const scanned = parseScannedIdentifier(parsed.data.scannedCode);

  try {
    const result = withTransaction(() => {
      const settings = getSettings();
      const copy = db
        .prepare(
          `SELECT bc.*, b.title, a.name as author
           FROM book_copies bc
           JOIN books b ON b.id = bc.book_id
           JOIN authors a ON a.id = b.author_id
           LEFT JOIN barcodes bar ON bar.book_copy_id = bc.id
           WHERE UPPER(bc.accession_number) = ? OR UPPER(bar.value) = ?`
        )
        .get(scanned.accessionNumber, scanned.accessionNumber) as Record<string, any> | undefined;

      if (!copy) {
        throw new Error(`Copy "${scanned.accessionNumber}" was not found in the Accession Register.`);
      }

      const activeIssue = db
        .prepare(
          `SELECT bi.*, u.full_name as borrower_name, u.email as borrower_email,
                  COALESCE(s.registration_number, f.employee_id, u.email) as member_code
           FROM book_issues bi
           JOIN users u ON u.id = bi.borrower_id
           LEFT JOIN students s ON s.user_id = u.id
           LEFT JOIN faculty f ON f.user_id = u.id
           WHERE bi.book_copy_id = ? AND bi.status IN ('ISSUED', 'OVERDUE')
           ORDER BY bi.id DESC
           LIMIT 1`
        )
        .get(copy.id) as Record<string, any> | undefined;

      if (!activeIssue) {
        throw new Error(
          `Invalid return rejected: Copy ${copy.accession_number} does not have an active issued loan.`
        );
      }

      const returnDateIso = new Date().toISOString();
      const { overdueDays, fineAmountInr } = calculateOverdueAndFine({
        dueDateIso: activeIssue.due_date,
        asOfDateIso: returnDateIso,
        finePerDayInr: settings.fine_per_day_inr,
        maxFineInr: settings.max_fine_inr,
      });

      const retCount = (db.prepare('SELECT COUNT(*) as c FROM book_returns').get() as { c: number }).c;
      const returnReceipt = `RET-${new Date().getFullYear()}-${String(retCount + 1).padStart(4, '0')}`;

      db.prepare(
        `INSERT INTO book_returns (book_issue_id, return_receipt, return_date, overdue_days, fine_amount_inr, condition_note, processed_by_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        activeIssue.id,
        returnReceipt,
        returnDateIso,
        overdueDays,
        fineAmountInr,
        parsed.data.conditionNote?.trim() || 'Returned and verified via scanner',
        req.user!.id
      );

      db.prepare(`UPDATE book_issues SET status = 'RETURNED' WHERE id = ?`).run(activeIssue.id);

      let fineId: number | null = null;
      if (fineAmountInr > 0) {
        const existingFine = db
          .prepare('SELECT id FROM fines WHERE book_issue_id = ?')
          .get(activeIssue.id) as { id: number } | undefined;
        if (existingFine) {
          db.prepare(
            `UPDATE fines SET overdue_days = ?, amount_inr = ?, updated_at = datetime('now') WHERE id = ?`
          ).run(overdueDays, fineAmountInr, existingFine.id);
          fineId = existingFine.id;
        } else {
          fineId = Number(
            db
              .prepare(
                `INSERT INTO fines (book_issue_id, user_id, overdue_days, amount_inr, paid_amount_inr, waived_amount_inr, status, is_demo_data)
                 VALUES (?, ?, ?, ?, 0, 0, 'PENDING', 0)`
              )
              .run(activeIssue.id, activeIssue.borrower_id, overdueDays, fineAmountInr).lastInsertRowid
          );
        }
      }

      // Check reservation queue to promote next member if not damaged
      let nextCopyStatus = parsed.data.markDamaged ? 'DAMAGED' : 'AVAILABLE';
      let promotedReservationUser: string | null = null;

      if (!parsed.data.markDamaged) {
        const nextRes = db
          .prepare(
            `SELECT r.id, r.user_id, u.full_name
             FROM reservations r
             JOIN reservation_queue rq ON rq.reservation_id = r.id
             JOIN users u ON u.id = r.user_id
             WHERE r.book_id = ? AND r.status = 'ACTIVE'
             ORDER BY rq.position ASC, r.reserved_at ASC
             LIMIT 1`
          )
          .get(copy.book_id) as { id: number; user_id: number; full_name: string } | undefined;

        if (nextRes) {
          nextCopyStatus = 'RESERVED';
          promotedReservationUser = nextRes.full_name;
          const expiresAt = new Date(
            Date.now() + (settings.reservation_expiry_hours || 48) * 3600 * 1000
          ).toISOString();
          db.prepare(`UPDATE reservations SET status = 'READY', expires_at = ? WHERE id = ?`).run(
            expiresAt,
            nextRes.id
          );
          createNotification(
            nextRes.user_id,
            'RESERVATION_READY',
            `Reserved Book Available: ${copy.title}`,
            `Copy ${copy.accession_number} is now available for pickup until ${expiresAt.slice(0, 10)}.`
          );
        }
      }

      db.prepare(
        `UPDATE book_copies SET status = ?, physical_condition = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(nextCopyStatus, parsed.data.markDamaged ? 'Damaged' : copy.physical_condition, copy.id);

      createNotification(
        activeIssue.borrower_id,
        'RETURN',
        `Book Returned: ${copy.title}`,
        `Copy ${copy.accession_number} returned under receipt ${returnReceipt}.${fineAmountInr > 0 ? ` Overdue fine assessed: ₹${fineAmountInr.toFixed(2)}.` : ''}`
      );

      return {
        returnReceipt,
        issueReceiptNo: activeIssue.receipt_no,
        accessionNumber: copy.accession_number,
        bookTitle: copy.title,
        borrowerName: activeIssue.borrower_name,
        borrowerMemberCode: activeIssue.member_code,
        issueDate: activeIssue.issue_date,
        dueDate: activeIssue.due_date,
        returnDate: returnDateIso,
        overdueDays,
        fineAmountInr,
        fineId,
        newCopyStatus: nextCopyStatus,
        promotedReservationUser,
        processedBy: req.user!.fullName,
      };
    });

    writeAuditLog(
      req,
      'BOOK_RETURN',
      'CIRCULATION',
      result.returnReceipt,
      `Returned copy ${result.accessionNumber} from ${result.borrowerName}. Overdue: ${result.overdueDays}d, Fine: ₹${result.fineAmountInr}. Copy status -> ${result.newCopyStatus}.`
    );

    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Unable to process book return.' });
  }
});

coreRouter.post('/circulation/renew', requireAuth, (req: AuthedRequest, res) => {
  const issueId = Number(req.body?.issueId);
  if (!issueId) {
    res.status(400).json({ error: 'Transaction issueId is required.' });
    return;
  }

  try {
    const result = withTransaction(() => {
      const settings = getSettings();
      const issue = db
        .prepare(
          `SELECT bi.*, bc.accession_number, bc.book_id, b.title, u.role_id, r.name as borrower_role
           FROM book_issues bi
           JOIN book_copies bc ON bc.id = bi.book_copy_id
           JOIN books b ON b.id = bc.book_id
           JOIN users u ON u.id = bi.borrower_id
           JOIN roles r ON r.id = u.role_id
           WHERE bi.id = ?`
        )
        .get(issueId) as Record<string, any> | undefined;

      if (!issue) {
        throw new Error('Active loan transaction not found.');
      }

      const isStaff = req.user!.role === 'SUPER_ADMIN' || req.user!.role === 'LIBRARIAN';
      if (!isStaff) {
        if (req.user!.role === 'STUDENT') {
          throw new Error('Students must request renewals through the Librarian counter.');
        }
        if (issue.borrower_id !== req.user!.id) {
          throw new Error('You may only renew your own issued books.');
        }
      }

      if (issue.status !== 'ISSUED' && issue.status !== 'OVERDUE') {
        throw new Error('Only active loans can be renewed.');
      }
      if (issue.renewal_count >= settings.max_renewals) {
        throw new Error(`Maximum renewal limit (${settings.max_renewals}) reached for this loan.`);
      }

      const pendingRes = (
        db
          .prepare(`SELECT COUNT(*) as c FROM reservations WHERE book_id = ? AND status = 'ACTIVE'`)
          .get(issue.book_id) as { c: number }
      ).c;
      if (pendingRes > 0) {
        throw new Error('Cannot renew: another member is waiting in the reservation queue for this title.');
      }

      const baseDate = new Date(Math.max(Date.now(), new Date(issue.due_date).getTime())).toISOString();
      const newDueDate = computeDueDate(
        baseDate,
        issue.borrower_role as UserRole,
        settings.student_loan_days,
        settings.faculty_loan_days
      );

      db.prepare(
        `INSERT INTO book_renewals (book_issue_id, previous_due, new_due_date, renewed_by_id) VALUES (?, ?, ?, ?)`
      ).run(issue.id, issue.due_date, newDueDate, req.user!.id);

      db.prepare(
        `UPDATE book_issues SET due_date = ?, renewal_count = renewal_count + 1, status = 'ISSUED' WHERE id = ?`
      ).run(newDueDate, issue.id);

      createNotification(
        issue.borrower_id,
        'RENEWAL',
        `Loan Renewed: ${issue.title}`,
        `Copy ${issue.accession_number} renewed. New due date: ${newDueDate.slice(0, 10)}.`
      );

      return {
        issueId: issue.id,
        accessionNumber: issue.accession_number,
        previousDue: issue.due_date,
        newDueDate,
        renewalCount: issue.renewal_count + 1,
      };
    });

    writeAuditLog(
      req,
      'BOOK_RENEW',
      'CIRCULATION',
      result.issueId,
      `Renewed copy ${result.accessionNumber} to due date ${result.newDueDate.slice(0, 10)}.`
    );
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Unable to renew loan.' });
  }
});

// ============================================================
// RESERVATIONS & QUEUE MANAGEMENT
// ============================================================

coreRouter.get('/reservations', requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!;
  const isStaff = user.role === 'SUPER_ADMIN' || user.role === 'LIBRARIAN';

  // Auto-expire past-expiry READY reservations
  db.prepare(
    `UPDATE reservations SET status = 'EXPIRED' WHERE status = 'READY' AND expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')`
  ).run();

  const where = isStaff ? '' : 'WHERE r.user_id = ?';
  const params = isStaff ? [] : [user.id];

  const items = db
    .prepare(
      `SELECT r.*, rq.position, b.title, b.book_code, a.name as author, c.name as category,
              u.full_name as member_name, rl.name as member_role,
              COALESCE(s.registration_number, f.employee_id, u.email) as member_code,
              (SELECT COUNT(*) FROM book_copies bc WHERE bc.book_id = b.id AND bc.status = 'AVAILABLE') as available_copies
       FROM reservations r
       JOIN books b ON b.id = r.book_id
       JOIN authors a ON a.id = b.author_id
       JOIN categories c ON c.id = b.category_id
       JOIN users u ON u.id = r.user_id
       JOIN roles rl ON rl.id = u.role_id
       LEFT JOIN students s ON s.user_id = u.id
       LEFT JOIN faculty f ON f.user_id = u.id
       LEFT JOIN reservation_queue rq ON rq.reservation_id = r.id
       ${where}
       ORDER BY CASE r.status WHEN 'READY' THEN 1 WHEN 'ACTIVE' THEN 2 ELSE 3 END, r.reserved_at DESC`
    )
    .all(...params);

  res.json({ items });
});

coreRouter.post('/reservations', requireAuth, (req: AuthedRequest, res) => {
  const bookId = Number(req.body?.bookId);
  const targetUserId =
    (req.user!.role === 'SUPER_ADMIN' || req.user!.role === 'LIBRARIAN') && req.body?.userId
      ? Number(req.body.userId)
      : req.user!.id;

  if (!bookId) {
    res.status(400).json({ error: 'Book ID is required to reserve.' });
    return;
  }

  try {
    const created = withTransaction(() => {
      const book = db.prepare('SELECT id, title FROM books WHERE id = ? AND archived = 0').get(bookId) as
        | { id: number; title: string }
        | undefined;
      if (!book) throw new Error('Book not found.');

      const existing = db
        .prepare(
          `SELECT id FROM reservations WHERE book_id = ? AND user_id = ? AND status IN ('ACTIVE', 'READY')`
        )
        .get(bookId, targetUserId);
      if (existing) {
        throw new Error('You already have an active reservation for this title.');
      }

      const maxPos = (
        db
          .prepare(
            `SELECT COALESCE(MAX(rq.position), 0) as p
             FROM reservation_queue rq
             JOIN reservations r ON r.id = rq.reservation_id
             WHERE rq.book_id = ? AND r.status IN ('ACTIVE', 'READY')`
          )
          .get(bookId) as { p: number }
      ).p;

      const settings = getSettings();
      const avail = (
        db.prepare(`SELECT COUNT(*) as c FROM book_copies WHERE book_id = ? AND status = 'AVAILABLE'`).get(bookId) as {
          c: number;
        }
      ).c;

      const initialStatus = avail > 0 && maxPos === 0 ? 'READY' : 'ACTIVE';
      const expiresAt =
        initialStatus === 'READY'
          ? new Date(Date.now() + (settings.reservation_expiry_hours || 48) * 3600 * 1000).toISOString()
          : null;

      const resId = Number(
        db
          .prepare(
            `INSERT INTO reservations (book_id, user_id, status, reserved_at, expires_at, is_demo_data)
             VALUES (?, ?, ?, datetime('now'), ?, 0)`
          )
          .run(bookId, targetUserId, initialStatus, expiresAt).lastInsertRowid
      );

      db.prepare('INSERT INTO reservation_queue (reservation_id, book_id, position) VALUES (?, ?, ?)').run(
        resId,
        bookId,
        maxPos + 1
      );

      createNotification(
        targetUserId,
        'RESERVATION',
        `Reservation Confirmed: ${book.title}`,
        initialStatus === 'READY'
          ? `A copy is ready for pickup at the Civil Engineering Library desk until ${expiresAt!.slice(0, 10)}.`
          : `You are #${maxPos + 1} in the queue for "${book.title}".`
      );

      return { id: resId, position: maxPos + 1, status: initialStatus, title: book.title };
    });

    writeAuditLog(
      req,
      'RESERVATION_CREATE',
      'RESERVATION',
      created.id,
      `Reserved "${created.title}" (Queue #${created.position}, status=${created.status}).`
    );
    res.status(201).json(created);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Unable to create reservation.' });
  }
});

coreRouter.patch('/reservations/:id', requireAuth, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || '').toUpperCase();
  const validStatuses = ['ACTIVE', 'READY', 'FULFILLED', 'CANCELLED', 'EXPIRED'];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: 'Invalid reservation status.' });
    return;
  }

  const existing = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id) as Record<string, any> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Reservation not found.' });
    return;
  }

  const isStaff = req.user!.role === 'SUPER_ADMIN' || req.user!.role === 'LIBRARIAN';
  if (!isStaff && (existing.user_id !== req.user!.id || status !== 'CANCELLED')) {
    res.status(403).json({ error: 'You can only cancel your own reservations.' });
    return;
  }

  db.prepare('UPDATE reservations SET status = ? WHERE id = ?').run(status, id);
  writeAuditLog(req, 'RESERVATION_UPDATE', 'RESERVATION', id, `Updated reservation #${id} status -> ${status}.`);
  res.json({ ok: true });
});

// ============================================================
// FINE MANAGEMENT (INR)
// ============================================================

coreRouter.get('/fines', requireAuth, (req: AuthedRequest, res) => {
  const isStaff = req.user!.role === 'SUPER_ADMIN' || req.user!.role === 'LIBRARIAN';
  const status = String(req.query.status || '').trim();

  let where = 'WHERE 1=1';
  const params: (string | number)[] = [];
  if (!isStaff) {
    where += ' AND fn.user_id = ?';
    params.push(req.user!.id);
  }
  if (status) {
    where += ' AND fn.status = ?';
    params.push(status);
  }

  const items = db
    .prepare(
      `SELECT fn.*, u.full_name as borrower_name, u.email as borrower_email, r.name as borrower_role,
              COALESCE(s.registration_number, f.employee_id, u.email) as member_code,
              bi.receipt_no, bi.issue_date, bi.due_date,
              bc.accession_number, b.title
       FROM fines fn
       JOIN users u ON u.id = fn.user_id
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN students s ON s.user_id = u.id
       LEFT JOIN faculty f ON f.user_id = u.id
       JOIN book_issues bi ON bi.id = fn.book_issue_id
       JOIN book_copies bc ON bc.id = bi.book_copy_id
       JOIN books b ON b.id = bc.book_id
       ${where}
       ORDER BY fn.id DESC`
    )
    .all(...params);

  const payments = db
    .prepare(
      `SELECT fp.*, u.full_name as collected_by
       FROM fine_payments fp
       JOIN users u ON u.id = fp.collected_by_id
       ORDER BY fp.paid_at DESC
       LIMIT 100`
    )
    .all();

  res.json({ items, payments });
});

coreRouter.post('/fines/:id/pay', requireAuth, requireRole('SUPER_ADMIN', 'LIBRARIAN'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const amount = Number(req.body?.amountInr);
  const method = String(req.body?.paymentMethod || 'Cash / Departmental Counter');

  if (!amount || amount <= 0) {
    res.status(400).json({ error: 'Payment amount in INR must be greater than zero.' });
    return;
  }

  try {
    const payment = withTransaction(() => {
      const fine = db.prepare('SELECT * FROM fines WHERE id = ?').get(id) as Record<string, any> | undefined;
      if (!fine) throw new Error('Fine record not found.');

      const outstanding = Math.round((fine.amount_inr - fine.paid_amount_inr - fine.waived_amount_inr) * 100) / 100;
      if (outstanding <= 0) throw new Error('This fine has no remaining balance.');
      if (amount > outstanding + 0.01) {
        throw new Error(`Payment ₹${amount.toFixed(2)} exceeds remaining balance ₹${outstanding.toFixed(2)}.`);
      }

      const newPaid = Math.round((fine.paid_amount_inr + amount) * 100) / 100;
      const remaining = Math.round((fine.amount_inr - newPaid - fine.waived_amount_inr) * 100) / 100;
      const newStatus = remaining <= 0.01 ? 'PAID' : 'PARTIALLY_PAID';

      const countPay = (db.prepare('SELECT COUNT(*) as c FROM fine_payments').get() as { c: number }).c;
      const receiptNumber = `FINE-${new Date().getFullYear()}-${String(countPay + 1).padStart(4, '0')}`;

      db.prepare(
        `INSERT INTO fine_payments (fine_id, receipt_number, amount_paid_inr, payment_method, collected_by_id)
         VALUES (?, ?, ?, ?, ?)`
      ).run(id, receiptNumber, amount, method, req.user!.id);

      db.prepare(
        `UPDATE fines SET paid_amount_inr = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(newPaid, newStatus, id);

      createNotification(
        fine.user_id,
        'FINE_PAYMENT',
        `Fine Payment Received (${receiptNumber})`,
        `₹${amount.toFixed(2)} received towards overdue fine #${id}. Status: ${newStatus}.`
      );

      return { fineId: id, receiptNumber, amountPaidInr: amount, remainingBalanceInr: Math.max(0, remaining), status: newStatus };
    });

    writeAuditLog(
      req,
      'FINE_PAYMENT',
      'FINE',
      payment.receiptNumber,
      `Collected ₹${amount.toFixed(2)} for fine #${id} (status -> ${payment.status}).`
    );
    res.json(payment);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to record fine payment.' });
  }
});

coreRouter.post('/fines/:id/waive', requireAuth, requireRole('SUPER_ADMIN', 'LIBRARIAN'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) {
    res.status(400).json({ error: 'Please specify a valid waiver reason.' });
    return;
  }

  const fine = db.prepare('SELECT * FROM fines WHERE id = ?').get(id) as Record<string, any> | undefined;
  if (!fine) {
    res.status(404).json({ error: 'Fine not found.' });
    return;
  }

  const remaining = Math.max(0, fine.amount_inr - fine.paid_amount_inr);
  db.prepare(
    `UPDATE fines SET waived_amount_inr = ?, status = 'WAIVED', waiver_reason = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(remaining, reason, id);

  writeAuditLog(req, 'FINE_WAIVE', 'FINE', id, `Waived remaining ₹${remaining.toFixed(2)} on fine #${id}. Reason: ${reason}`);
  res.json({ ok: true });
});
