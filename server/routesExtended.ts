import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { db, getDbPath, withTransaction } from './db.ts';
import {
  createNotification,
  requireAuth,
  requireRole,
  writeAuditLog,
  type AuthedRequest,
} from './auth.ts';
import {
  executeValidatedImport,
  generateExportWorkbook,
  generateImportErrorReportWorkbook,
  generateImportTemplateWorkbook,
  mapAndValidateImportRows,
  parseWorkbookBuffer,
  type ImportFieldKey,
} from './excelService.ts';
import type { DuplicateHandlingMode } from '../src/lib/libraryRules.ts';

export const extendedRouter = Router();

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const digitalStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.resolve(process.cwd(), 'uploads', 'digital');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const safeExt = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '') || '.bin';
    const base = path
      .basename(file.originalname, path.extname(file.originalname))
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 50);
    cb(null, `${Date.now()}_${base}${safeExt}`);
  },
});

const digitalUpload = multer({
  storage: digitalStorage,
  limits: { fileSize: 25 * 1024 * 1024 },
});

const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.resolve(process.cwd(), 'uploads', 'logos');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.png';
    cb(null, `logo_${Date.now()}${ext}`);
  },
});

const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Temporary in-memory staged upload store keyed by uploadToken
const stagedExcelUploads = new Map<
  string,
  { fileName: string; buffer: Buffer; createdAt: number }
>();

// ============================================================
// MEMBERS: STUDENTS, FACULTY & MEMBER SEARCH
// ============================================================

extendedRouter.get('/members/search', requireAuth, requireRole('SUPER_ADMIN', 'LIBRARIAN'), (req, res) => {
  const q = String(req.query.q || '').trim();
  const like = `%${q}%`;
  const settings = db.prepare('SELECT * FROM institution_settings WHERE id = 1').get() as Record<string, any>;

  const rows = db
    .prepare(
      `SELECT u.id, u.full_name, u.email, u.phone, u.status, r.name as role,
              COALESCE(s.registration_number, f.employee_id, u.email) as member_code,
              s.programme, s.semester, s.academic_session, f.designation,
              (SELECT COUNT(*) FROM book_issues bi WHERE bi.borrower_id = u.id AND bi.status IN ('ISSUED', 'OVERDUE')) as active_loans,
              (SELECT COALESCE(SUM(amount_inr - paid_amount_inr - waived_amount_inr), 0) FROM fines fn WHERE fn.user_id = u.id AND fn.status IN ('PENDING', 'PARTIALLY_PAID')) as unpaid_fines
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN students s ON s.user_id = u.id
       LEFT JOIN faculty f ON f.user_id = u.id
       WHERE r.name IN ('STUDENT', 'FACULTY')
         AND (? = '' OR u.full_name LIKE ? OR u.email LIKE ? OR s.registration_number LIKE ? OR f.employee_id LIKE ?)
       ORDER BY u.full_name ASC
       LIMIT 50`
    )
    .all(q, like, like, like, like) as Record<string, any>[];

  const enriched = rows.map((m) => ({
    ...m,
    borrow_limit: m.role === 'FACULTY' ? settings.faculty_borrow_limit : settings.student_borrow_limit,
  }));

  res.json({ items: enriched });
});

extendedRouter.get('/members/students', requireAuth, requireRole('SUPER_ADMIN', 'LIBRARIAN'), (req, res) => {
  const q = String(req.query.q || '').trim();
  const like = `%${q}%`;
  const items = db
    .prepare(
      `SELECT s.id as student_id, s.registration_number, s.programme, s.semester, s.academic_session,
              u.id as user_id, u.full_name, u.email, u.phone, u.photo_url, u.status, u.is_demo_data,
              d.name as department,
              (SELECT COUNT(*) FROM book_issues bi WHERE bi.borrower_id = u.id AND bi.status IN ('ISSUED', 'OVERDUE')) as active_loans
       FROM students s
       JOIN users u ON u.id = s.user_id
       JOIN departments d ON d.id = s.department_id
       WHERE (? = '' OR u.full_name LIKE ? OR s.registration_number LIKE ? OR u.email LIKE ?)
       ORDER BY s.id DESC`
    )
    .all(q, like, like, like);
  res.json({ items });
});

extendedRouter.post('/members/students', requireAuth, requireRole('SUPER_ADMIN', 'LIBRARIAN'), (req: AuthedRequest, res) => {
  const schema = z.object({
    registrationNumber: z.string().min(3).max(64),
    fullName: z.string().min(2).max(150),
    programme: z.string().min(2).max(120).default('B.Tech Civil Engineering'),
    semester: z.coerce.number().int().min(1).max(10).default(1),
    academicSession: z.string().min(4).max(32).default('2026-2030'),
    email: z.string().email(),
    phone: z.string().max(30).optional(),
    password: z.string().min(6).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid student registration data.' });
    return;
  }

  const d = parsed.data;
  try {
    const created = withTransaction(() => {
      if (db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(d.email)) {
        throw new Error(`Email "${d.email}" is already registered.`);
      }
      if (
        db
          .prepare('SELECT id FROM students WHERE UPPER(registration_number) = UPPER(?)')
          .get(d.registrationNumber)
      ) {
        throw new Error(`Registration Number "${d.registrationNumber}" already exists.`);
      }

      const roleRow = db.prepare("SELECT id FROM roles WHERE name = 'STUDENT'").get() as { id: number };
      const deptRow = db.prepare("SELECT id FROM departments WHERE code = 'CE'").get() as { id: number };
      const hash = bcrypt.hashSync(d.password || 'Student@HIT2026', 10);

      const userId = Number(
        db
          .prepare(
            `INSERT INTO users (email, password_hash, full_name, phone, role_id, department_id, status, is_demo_data)
             VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 0)`
          )
          .run(d.email.trim(), hash, d.fullName.trim(), d.phone?.trim() || null, roleRow.id, deptRow.id)
          .lastInsertRowid
      );

      const studentId = Number(
        db
          .prepare(
            `INSERT INTO students (user_id, registration_number, programme, semester, academic_session, department_id)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            userId,
            d.registrationNumber.trim().toUpperCase(),
            d.programme.trim(),
            d.semester,
            d.academicSession.trim(),
            deptRow.id
          ).lastInsertRowid
      );

      return { userId, studentId, registrationNumber: d.registrationNumber.trim().toUpperCase() };
    });

    writeAuditLog(
      req,
      'STUDENT_REGISTER',
      'STUDENT',
      created.registrationNumber,
      `Registered student ${d.fullName} (${created.registrationNumber}).`
    );
    res.status(201).json(created);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to register student.' });
  }
});

extendedRouter.get('/members/faculty', requireAuth, requireRole('SUPER_ADMIN', 'LIBRARIAN'), (req, res) => {
  const q = String(req.query.q || '').trim();
  const like = `%${q}%`;
  const items = db
    .prepare(
      `SELECT f.id as faculty_id, f.employee_id, f.designation,
              u.id as user_id, u.full_name, u.email, u.phone, u.photo_url, u.status, u.is_demo_data,
              d.name as department,
              (SELECT COUNT(*) FROM book_issues bi WHERE bi.borrower_id = u.id AND bi.status IN ('ISSUED', 'OVERDUE')) as active_loans
       FROM faculty f
       JOIN users u ON u.id = f.user_id
       JOIN departments d ON d.id = f.department_id
       WHERE (? = '' OR u.full_name LIKE ? OR f.employee_id LIKE ? OR u.email LIKE ?)
       ORDER BY f.id DESC`
    )
    .all(q, like, like, like);
  res.json({ items });
});

extendedRouter.post('/members/faculty', requireAuth, requireRole('SUPER_ADMIN', 'LIBRARIAN'), (req: AuthedRequest, res) => {
  const schema = z.object({
    employeeId: z.string().min(3).max(64),
    fullName: z.string().min(2).max(150),
    designation: z.string().min(2).max(120),
    email: z.string().email(),
    phone: z.string().max(30).optional(),
    password: z.string().min(6).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid faculty registration data.' });
    return;
  }

  const d = parsed.data;
  try {
    const created = withTransaction(() => {
      if (db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(d.email)) {
        throw new Error(`Email "${d.email}" is already registered.`);
      }
      if (db.prepare('SELECT id FROM faculty WHERE UPPER(employee_id) = UPPER(?)').get(d.employeeId)) {
        throw new Error(`Employee ID "${d.employeeId}" already exists.`);
      }

      const roleRow = db.prepare("SELECT id FROM roles WHERE name = 'FACULTY'").get() as { id: number };
      const deptRow = db.prepare("SELECT id FROM departments WHERE code = 'CE'").get() as { id: number };
      const hash = bcrypt.hashSync(d.password || 'Faculty@HIT2026', 10);

      const userId = Number(
        db
          .prepare(
            `INSERT INTO users (email, password_hash, full_name, phone, role_id, department_id, status, is_demo_data)
             VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 0)`
          )
          .run(d.email.trim(), hash, d.fullName.trim(), d.phone?.trim() || null, roleRow.id, deptRow.id)
          .lastInsertRowid
      );

      const facultyId = Number(
        db
          .prepare(
            `INSERT INTO faculty (user_id, employee_id, designation, department_id) VALUES (?, ?, ?, ?)`
          )
          .run(userId, d.employeeId.trim().toUpperCase(), d.designation.trim(), deptRow.id).lastInsertRowid
      );

      return { userId, facultyId, employeeId: d.employeeId.trim().toUpperCase() };
    });

    writeAuditLog(
      req,
      'FACULTY_REGISTER',
      'FACULTY',
      created.employeeId,
      `Registered faculty member ${d.fullName} (${created.employeeId}).`
    );
    res.status(201).json(created);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to register faculty.' });
  }
});

extendedRouter.patch(
  '/members/:userId/status',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LIBRARIAN'),
  (req: AuthedRequest, res) => {
    const userId = Number(req.params.userId);
    const status = String(req.body?.status || '').toUpperCase();
    if (!['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(status)) {
      res.status(400).json({ error: 'Invalid status.' });
      return;
    }
    db.prepare(`UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, userId);
    writeAuditLog(req, 'MEMBER_STATUS_CHANGE', 'USER', userId, `Changed member #${userId} status -> ${status}.`);
    res.json({ ok: true });
  }
);

extendedRouter.post(
  '/members/import/:memberType',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LIBRARIAN'),
  memoryUpload.single('file'),
  (req: AuthedRequest, res) => {
    const memberType = req.params.memberType === 'faculty' ? 'faculty' : 'students';
    if (!req.file) {
      res.status(400).json({ error: 'Please upload an Excel (.xlsx, .xls) or CSV file.' });
      return;
    }

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    const deptRow = db.prepare("SELECT id FROM departments WHERE code = 'CE'").get() as { id: number };
    const roleRow = db
      .prepare('SELECT id FROM roles WHERE name = ?')
      .get(memberType === 'faculty' ? 'FACULTY' : 'STUDENT') as { id: number };
    const defaultHash = bcrypt.hashSync(memberType === 'faculty' ? 'Faculty@HIT2026' : 'Student@HIT2026', 8);

    let imported = 0;
    let skipped = 0;

    withTransaction(() => {
      for (const r of rows) {
        const email = String(r['Email'] || r['email'] || '').trim();
        const fullName = String(r['Student Name'] || r['Name'] || r['fullName'] || '').trim();
        const phone = String(r['Phone'] || r['phone'] || '').trim();
        if (!email || !fullName) {
          skipped += 1;
          continue;
        }
        if (db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email)) {
          skipped += 1;
          continue;
        }

        if (memberType === 'students') {
          const reg = String(r['Registration Number'] || r['registrationNumber'] || '').trim().toUpperCase();
          if (!reg || db.prepare('SELECT id FROM students WHERE registration_number = ?').get(reg)) {
            skipped += 1;
            continue;
          }
          const uId = Number(
            db
              .prepare(
                `INSERT INTO users (email, password_hash, full_name, phone, role_id, department_id, status, is_demo_data)
                 VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 0)`
              )
              .run(email, defaultHash, fullName, phone || null, roleRow.id, deptRow.id).lastInsertRowid
          );
          db.prepare(
            `INSERT INTO students (user_id, registration_number, programme, semester, academic_session, department_id)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(
            uId,
            reg,
            String(r['Programme'] || 'B.Tech Civil Engineering'),
            Number(r['Semester'] || 1),
            String(r['Academic Session'] || '2026-2030'),
            deptRow.id
          );
          imported += 1;
        } else {
          const emp = String(r['Employee ID'] || r['employeeId'] || '').trim().toUpperCase();
          if (!emp || db.prepare('SELECT id FROM faculty WHERE employee_id = ?').get(emp)) {
            skipped += 1;
            continue;
          }
          const uId = Number(
            db
              .prepare(
                `INSERT INTO users (email, password_hash, full_name, phone, role_id, department_id, status, is_demo_data)
                 VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 0)`
              )
              .run(email, defaultHash, fullName, phone || null, roleRow.id, deptRow.id).lastInsertRowid
          );
          db.prepare(
            `INSERT INTO faculty (user_id, employee_id, designation, department_id) VALUES (?, ?, ?, ?)`
          ).run(uId, emp, String(r['Designation'] || 'Assistant Professor'), deptRow.id);
          imported += 1;
        }
      }
    });

    writeAuditLog(
      req,
      'MEMBER_BULK_IMPORT',
      memberType.toUpperCase(),
      req.file.originalname,
      `Bulk imported ${imported} ${memberType} (${skipped} skipped).`
    );
    res.json({ imported, skipped, total: rows.length });
  }
);

// ============================================================
// DIGITAL LIBRARY (UPLOAD & AUTHORIZED DOWNLOAD)
// ============================================================

extendedRouter.get('/digital-library', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  const category = String(req.query.category || '').trim();
  const subject = String(req.query.subject || '').trim();

  let where = 'WHERE 1=1';
  const params: string[] = [];
  if (q) {
    const like = `%${q}%`;
    where += ' AND (dr.title LIKE ? OR dr.author LIKE ? OR dr.subject LIKE ? OR dr.description LIKE ?)';
    params.push(like, like, like, like);
  }
  if (category) {
    where += ' AND dr.category = ?';
    params.push(category);
  }
  if (subject) {
    where += ' AND dr.subject LIKE ?';
    params.push(`%${subject}%`);
  }

  const items = db
    .prepare(
      `SELECT dr.*, u.full_name as uploaded_by_name
       FROM digital_resources dr
       JOIN users u ON u.id = dr.uploaded_by_id
       ${where}
       ORDER BY dr.id DESC`
    )
    .all(...params);

  res.json({ items });
});

extendedRouter.post(
  '/digital-library',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LIBRARIAN', 'FACULTY'),
  digitalUpload.single('file'),
  (req: AuthedRequest, res) => {
    const title = String(req.body?.title || '').trim();
    const author = String(req.body?.author || '').trim();
    const category = String(req.body?.category || 'Lecture notes').trim();
    const subject = String(req.body?.subject || 'General Engineering').trim();
    const semester = String(req.body?.semester || 'All Semesters').trim();
    const academicYear = String(req.body?.academicYear || '2026-2027').trim();
    const description = String(req.body?.description || '').trim();
    const accessLevel = String(req.body?.accessLevel || 'ALL_AUTHENTICATED').trim();

    if (!title || !author || !req.file) {
      res.status(400).json({ error: 'Title, Author, and resource file are required.' });
      return;
    }

    const relPath = `uploads/digital/${req.file.filename}`;
    const insertedId = Number(
      db
        .prepare(
          `INSERT INTO digital_resources (
            title, author, category, subject, semester, academic_year, description,
            file_name, file_path, file_size_bytes, mime_type, access_level, uploaded_by_id, download_count, is_demo_data
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`
        )
        .run(
          title,
          author,
          category,
          subject,
          semester,
          academicYear,
          description,
          req.file.originalname,
          relPath,
          req.file.size,
          req.file.mimetype || 'application/octet-stream',
          accessLevel,
          req.user!.id
        ).lastInsertRowid
    );

    writeAuditLog(req, 'DIGITAL_RESOURCE_UPLOAD', 'DIGITAL_RESOURCE', insertedId, `Uploaded "${title}" (${category}).`);
    res.status(201).json({ id: insertedId, fileName: req.file.originalname });
  }
);

extendedRouter.get('/digital-library/:id/download', requireAuth, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const resource = db.prepare('SELECT * FROM digital_resources WHERE id = ?').get(id) as Record<string, any> | undefined;
  if (!resource) {
    res.status(404).json({ error: 'Digital resource not found.' });
    return;
  }
  if (resource.access_level === 'FACULTY_ONLY' && req.user!.role === 'STUDENT') {
    res.status(403).json({ error: 'This digital resource is restricted to Faculty and Library Staff.' });
    return;
  }

  const absPath = path.resolve(process.cwd(), resource.file_path);
  if (!fs.existsSync(absPath)) {
    res.status(404).json({ error: 'Stored file not found on server.' });
    return;
  }

  db.prepare('UPDATE digital_resources SET download_count = download_count + 1 WHERE id = ?').run(id);
  res.download(absPath, resource.file_name);
});

// ============================================================
// BOOK ACQUISITION REQUESTS
// ============================================================

extendedRouter.get('/acquisition-requests', requireAuth, (req: AuthedRequest, res) => {
  const isStaff = req.user!.role === 'SUPER_ADMIN' || req.user!.role === 'LIBRARIAN';
  const where = isStaff ? '' : 'WHERE ar.requester_id = ?';
  const params = isStaff ? [] : [req.user!.id];
  const items = db
    .prepare(
      `SELECT ar.*, u.full_name as requester_name, r.name as requester_role
       FROM acquisition_requests ar
       JOIN users u ON u.id = ar.requester_id
       JOIN roles r ON r.id = u.role_id
       ${where}
       ORDER BY ar.id DESC`
    )
    .all(...params);
  res.json({ items });
});

extendedRouter.post('/acquisition-requests', requireAuth, (req: AuthedRequest, res) => {
  const schema = z.object({
    title: z.string().min(2).max(250),
    author: z.string().min(2).max(200),
    isbn: z.string().max(32).optional(),
    publisher: z.string().max(200).optional(),
    subject: z.string().min(2).max(160),
    reason: z.string().min(5).max(800),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid acquisition request.' });
    return;
  }

  const d = parsed.data;
  const id = Number(
    db
      .prepare(
        `INSERT INTO acquisition_requests (title, author, isbn, publisher, subject, reason, requester_id, priority, status, is_demo_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0)`
      )
      .run(
        d.title.trim(),
        d.author.trim(),
        d.isbn?.trim() || null,
        d.publisher?.trim() || null,
        d.subject.trim(),
        d.reason.trim(),
        req.user!.id,
        d.priority
      ).lastInsertRowid
  );

  writeAuditLog(req, 'ACQUISITION_REQUEST_SUBMIT', 'ACQUISITION_REQUEST', id, `Requested new book "${d.title}".`);
  res.status(201).json({ id });
});

extendedRouter.patch(
  '/acquisition-requests/:id',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LIBRARIAN'),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const status = String(req.body?.status || '').toUpperCase();
    const reviewNote = String(req.body?.reviewNote || '').trim();
    if (!['PENDING', 'APPROVED', 'REJECTED', 'PURCHASED'].includes(status)) {
      res.status(400).json({ error: 'Invalid status.' });
      return;
    }

    const existing = db.prepare('SELECT * FROM acquisition_requests WHERE id = ?').get(id) as Record<string, any> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Request not found.' });
      return;
    }

    db.prepare(
      `UPDATE acquisition_requests SET status = ?, review_note = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(status, reviewNote || null, id);

    createNotification(
      existing.requester_id,
      'ACQUISITION',
      `Book Recommendation ${status}`,
      `Your request for "${existing.title}" has been marked as ${status}.${reviewNote ? ` Note: ${reviewNote}` : ''}`
    );

    writeAuditLog(req, 'ACQUISITION_REQUEST_REVIEW', 'ACQUISITION_REQUEST', id, `Set status=${status} for "${existing.title}".`);
    res.json({ ok: true });
  }
);

// ============================================================
// TAXONOMY: CATEGORIES, AUTHORS & PUBLISHERS
// ============================================================

extendedRouter.get('/taxonomy', requireAuth, (_req, res) => {
  const categories = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM books b WHERE b.category_id = c.id) as book_count
       FROM categories c ORDER BY c.name ASC`
    )
    .all();
  const authors = db
    .prepare(
      `SELECT a.*, (SELECT COUNT(*) FROM books b WHERE b.author_id = a.id) as book_count
       FROM authors a ORDER BY a.name ASC`
    )
    .all();
  const publishers = db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM books b WHERE b.publisher_id = p.id) as book_count
       FROM publishers p ORDER BY p.name ASC`
    )
    .all();
  res.json({ categories, authors, publishers });
});

extendedRouter.post('/taxonomy/categories', requireAuth, requireRole('SUPER_ADMIN', 'LIBRARIAN'), (req: AuthedRequest, res) => {
  const name = String(req.body?.name || '').trim();
  const code = String(req.body?.code || '').trim().toUpperCase();
  const description = String(req.body?.description || '').trim();
  const isStandard = req.body?.isStandard ? 1 : 0;
  if (name.length < 2 || code.length < 2) {
    res.status(400).json({ error: 'Category name and short code are required.' });
    return;
  }
  try {
    const id = Number(
      db
        .prepare('INSERT INTO categories (name, code, description, is_standard) VALUES (?, ?, ?, ?)')
        .run(name, code, description || null, isStandard).lastInsertRowid
    );
    writeAuditLog(req, 'CATEGORY_CREATE', 'CATEGORY', id, `Created category "${name}" (${code}).`);
    res.status(201).json({ id, name, code });
  } catch (err: any) {
    res.status(400).json({ error: 'Category name or code already exists.' });
  }
});

extendedRouter.post('/taxonomy/authors', requireAuth, requireRole('SUPER_ADMIN', 'LIBRARIAN'), (req: AuthedRequest, res) => {
  const name = String(req.body?.name || '').trim();
  const biography = String(req.body?.biography || '').trim();
  if (name.length < 2) {
    res.status(400).json({ error: 'Author name is required.' });
    return;
  }
  try {
    const id = Number(
      db.prepare('INSERT INTO authors (name, biography) VALUES (?, ?)').run(name, biography || null).lastInsertRowid
    );
    res.status(201).json({ id, name });
  } catch {
    res.status(400).json({ error: 'Author already exists.' });
  }
});

extendedRouter.post('/taxonomy/publishers', requireAuth, requireRole('SUPER_ADMIN', 'LIBRARIAN'), (req: AuthedRequest, res) => {
  const name = String(req.body?.name || '').trim();
  const city = String(req.body?.city || '').trim();
  const country = String(req.body?.country || 'India').trim();
  if (name.length < 2) {
    res.status(400).json({ error: 'Publisher name is required.' });
    return;
  }
  try {
    const id = Number(
      db
        .prepare('INSERT INTO publishers (name, city, country) VALUES (?, ?, ?)')
        .run(name, city || null, country || null).lastInsertRowid
    );
    res.status(201).json({ id, name });
  } catch {
    res.status(400).json({ error: 'Publisher already exists.' });
  }
});

// ============================================================
// EXCEL IMPORT & EXPORT MODULE
// ============================================================

extendedRouter.get('/excel/template/:type', requireAuth, requireRole('SUPER_ADMIN', 'LIBRARIAN'), async (req, res) => {
  const t = req.params.type;
  const validType = t === 'students' || t === 'faculty' ? t : 'inventory';
  const buf = await generateImportTemplateWorkbook(validType);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="HIT-CE-${validType}-import-template.xlsx"`);
  res.send(buf);
});

extendedRouter.post(
  '/excel/upload',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LIBRARIAN'),
  memoryUpload.single('file'),
  (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Please upload a valid .xlsx, .xls, or .csv file.' });
      return;
    }

    try {
      const parsed = parseWorkbookBuffer(req.file.buffer);
      const uploadToken = `upl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      stagedExcelUploads.set(uploadToken, {
        fileName: req.file.originalname,
        buffer: req.file.buffer,
        createdAt: Date.now(),
      });

      // Prune staged uploads older than 30 minutes
      const cutoff = Date.now() - 30 * 60 * 1000;
      for (const [k, v] of stagedExcelUploads.entries()) {
        if (v.createdAt < cutoff) stagedExcelUploads.delete(k);
      }

      res.json({
        uploadToken,
        fileName: req.file.originalname,
        sheetNames: parsed.sheetNames,
        activeSheet: parsed.activeSheet,
        headers: parsed.headers,
        totalRows: parsed.totalRows,
        suggestedMapping: parsed.suggestedMapping,
        sampleRows: parsed.rawRows.slice(0, 5),
      });
    } catch (err: any) {
      res.status(400).json({ error: `Could not parse workbook: ${err.message}` });
    }
  }
);

extendedRouter.post(
  '/excel/validate',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LIBRARIAN'),
  (req, res) => {
    const { uploadToken, sheetName, mapping, duplicateMode } = req.body as {
      uploadToken: string;
      sheetName?: string;
      mapping?: Record<ImportFieldKey, string>;
      duplicateMode?: DuplicateHandlingMode;
    };

    const staged = stagedExcelUploads.get(uploadToken);
    if (!staged) {
      res.status(404).json({ error: 'Uploaded workbook session expired. Please upload the file again.' });
      return;
    }

    try {
      const parsed = parseWorkbookBuffer(staged.buffer, sheetName);
      const effectiveMapping = mapping || parsed.suggestedMapping;
      const mode: DuplicateHandlingMode =
        duplicateMode === 'UPDATE' || duplicateMode === 'ADD_COPY' ? duplicateMode : 'SKIP';

      const validated = mapAndValidateImportRows(parsed.rawRows, effectiveMapping, mode);
      res.json({
        activeSheet: parsed.activeSheet,
        headers: parsed.headers,
        mapping: effectiveMapping,
        duplicateMode: mode,
        summary: validated.summary,
        previewRows: validated.rows.slice(0, 150),
      });
    } catch (err: any) {
      res.status(400).json({ error: `Validation failed: ${err.message}` });
    }
  }
);

extendedRouter.post(
  '/excel/error-report',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LIBRARIAN'),
  async (req, res) => {
    const { uploadToken, sheetName, mapping, duplicateMode } = req.body as {
      uploadToken: string;
      sheetName?: string;
      mapping: Record<ImportFieldKey, string>;
      duplicateMode: DuplicateHandlingMode;
    };
    const staged = stagedExcelUploads.get(uploadToken);
    if (!staged) {
      res.status(404).json({ error: 'Uploaded workbook session expired.' });
      return;
    }

    const parsed = parseWorkbookBuffer(staged.buffer, sheetName);
    const validated = mapAndValidateImportRows(parsed.rawRows, mapping, duplicateMode || 'SKIP');
    const errorRows = validated.rows
      .filter((r) => r.validation.action === 'ERROR')
      .map((r) => ({
        rowNumber: r.normalized.rowNumber,
        accessionNumber: r.normalized.accessionNumber,
        title: r.normalized.title,
        errors: r.validation.errors.map((e) => `${e.field}: ${e.reason}`).join(' | '),
      }));

    const buf = await generateImportErrorReportWorkbook(errorRows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="HIT-CE-Import-Error-Report.xlsx"');
    res.send(buf);
  }
);

extendedRouter.post(
  '/excel/confirm',
  requireAuth,
  requireRole('SUPER_ADMIN', 'LIBRARIAN'),
  (req: AuthedRequest, res) => {
    const { uploadToken, sheetName, mapping, duplicateMode } = req.body as {
      uploadToken: string;
      sheetName?: string;
      mapping: Record<ImportFieldKey, string>;
      duplicateMode: DuplicateHandlingMode;
    };

    const staged = stagedExcelUploads.get(uploadToken);
    if (!staged) {
      res.status(404).json({ error: 'Uploaded workbook session expired. Please upload the file again.' });
      return;
    }

    try {
      const parsed = parseWorkbookBuffer(staged.buffer, sheetName);
      const mode: DuplicateHandlingMode =
        duplicateMode === 'UPDATE' || duplicateMode === 'ADD_COPY' ? duplicateMode : 'SKIP';
      const validated = mapAndValidateImportRows(parsed.rawRows, mapping || parsed.suggestedMapping, mode);

      const summary = executeValidatedImport({
        fileName: staged.fileName,
        sheetName: parsed.activeSheet,
        duplicateMode: mode,
        uploadedById: req.user!.id,
        validatedRows: validated.rows,
      });

      stagedExcelUploads.delete(uploadToken);
      writeAuditLog(
        req,
        'EXCEL_IMPORT',
        'IMPORT_JOB',
        summary.jobId,
        `Imported "${staged.fileName}" (${mode}): ${summary.importedRows} imported, ${summary.skippedRows} skipped, ${summary.errorRows} errors.`
      );
      res.json(summary);
    } catch (err: any) {
      res.status(400).json({ error: `Import failed: ${err.message}` });
    }
  }
);

extendedRouter.get('/excel/jobs', requireAuth, requireRole('SUPER_ADMIN', 'LIBRARIAN'), (_req, res) => {
  const jobs = db
    .prepare(
      `SELECT ij.*, u.full_name as uploaded_by
       FROM import_jobs ij
       JOIN users u ON u.id = ij.uploaded_by_id
       ORDER BY ij.id DESC
       LIMIT 30`
    )
    .all();
  res.json({ items: jobs });
});

extendedRouter.get('/excel/export/:dataset', requireAuth, requireRole('SUPER_ADMIN', 'LIBRARIAN'), async (req: AuthedRequest, res) => {
  const dataset = String(req.params.dataset);
  const filters = {
    year: typeof req.query.year === 'string' ? req.query.year : undefined,
    category: typeof req.query.category === 'string' ? req.query.category : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    fromDate: typeof req.query.fromDate === 'string' ? req.query.fromDate : undefined,
    toDate: typeof req.query.toDate === 'string' ? req.query.toDate : undefined,
  };

  try {
    const { buffer, filename } = await generateExportWorkbook(dataset, filters);
    writeAuditLog(req, 'EXCEL_EXPORT', 'EXPORT', dataset, `Exported ${filename} with filters ${JSON.stringify(filters)}.`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: `Excel export failed: ${err.message}` });
  }
});

// ============================================================
// REPORTS & ANALYTICS + NOTIFICATIONS
// ============================================================

extendedRouter.get('/reports/summary', requireAuth, requireRole('SUPER_ADMIN', 'LIBRARIAN'), (req, res) => {
  const year = String(req.query.year || '').trim();
  const category = String(req.query.category || '').trim();

  const inventoryByCategory = db
    .prepare(
      `SELECT c.name as category, COUNT(DISTINCT b.id) as titles, COUNT(bc.id) as totalCopies,
              SUM(CASE WHEN bc.status = 'AVAILABLE' THEN 1 ELSE 0 END) as availableCopies,
              SUM(CASE WHEN bc.status = 'ISSUED' THEN 1 ELSE 0 END) as issuedCopies,
              ROUND(COALESCE(SUM(bc.purchase_price_inr), 0), 2) as valuationInr
       FROM categories c
       LEFT JOIN books b ON b.category_id = c.id
       LEFT JOIN book_copies bc ON bc.book_id = b.id
       WHERE (? = '' OR c.name = ?) AND (? = '' OR substr(bc.acquisition_date, 1, 4) = ?)
       GROUP BY c.id
       HAVING totalCopies > 0
       ORDER BY totalCopies DESC`
    )
    .all(category, category, year, year);

  const fineSummary = db
    .prepare(
      `SELECT status, COUNT(*) as count,
              ROUND(SUM(amount_inr), 2) as totalInr,
              ROUND(SUM(paid_amount_inr), 2) as paidInr,
              ROUND(SUM(waived_amount_inr), 2) as waivedInr
       FROM fines
       GROUP BY status`
    )
    .all();

  const lostAndDamaged = db
    .prepare(
      `SELECT bc.accession_number, b.title, a.name as author, bc.status, bc.physical_condition,
              bc.purchase_price_inr, bc.remarks, bc.updated_at
       FROM book_copies bc
       JOIN books b ON b.id = bc.book_id
       JOIN authors a ON a.id = b.author_id
       WHERE bc.status IN ('LOST', 'DAMAGED', 'UNDER_MAINTENANCE', 'WITHDRAWN')
       ORDER BY bc.updated_at DESC`
    )
    .all();

  const topBorrowers = db
    .prepare(
      `SELECT u.full_name, r.name as role,
              COALESCE(s.registration_number, f.employee_id, u.email) as member_code,
              COUNT(bi.id) as totalLoans
       FROM book_issues bi
       JOIN users u ON u.id = bi.borrower_id
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN students s ON s.user_id = u.id
       LEFT JOIN faculty f ON f.user_id = u.id
       GROUP BY u.id
       ORDER BY totalLoans DESC
       LIMIT 12`
    )
    .all();

  res.json({
    inventoryByCategory,
    fineSummary,
    lostAndDamaged,
    topBorrowers,
  });
});

extendedRouter.get('/notifications', requireAuth, (req: AuthedRequest, res) => {
  const items = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50')
    .all(req.user!.id);
  const unreadCount = (
    db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user!.id) as {
      c: number;
    }
  ).c;
  res.json({ items, unreadCount });
});

extendedRouter.patch('/notifications/:id/read', requireAuth, (req: AuthedRequest, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(
    Number(req.params.id),
    req.user!.id
  );
  res.json({ ok: true });
});

extendedRouter.post('/notifications/read-all', requireAuth, (req: AuthedRequest, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user!.id);
  res.json({ ok: true });
});

// ============================================================
// ADMINISTRATION: USERS, ROLES, SETTINGS, LOGOS, POLICIES, AUDIT, BACKUP
// ============================================================

extendedRouter.get('/admin/users', requireAuth, requireRole('SUPER_ADMIN'), (_req, res) => {
  const items = db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.phone, u.status, u.is_demo_data, u.created_at,
              r.name as role, d.name as department,
              COALESCE(s.registration_number, f.employee_id) as member_code
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN students s ON s.user_id = u.id
       LEFT JOIN faculty f ON f.user_id = u.id
       ORDER BY u.id ASC`
    )
    .all();
  res.json({ items });
});

extendedRouter.post('/admin/users', requireAuth, requireRole('SUPER_ADMIN'), (req: AuthedRequest, res) => {
  const schema = z.object({
    fullName: z.string().min(2).max(150),
    email: z.string().email(),
    password: z.string().min(6),
    role: z.enum(['SUPER_ADMIN', 'LIBRARIAN', 'FACULTY', 'STUDENT']),
    phone: z.string().max(30).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid user payload.' });
    return;
  }

  const d = parsed.data;
  if (db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(d.email)) {
    res.status(400).json({ error: 'Email already exists.' });
    return;
  }

  const roleRow = db.prepare('SELECT id FROM roles WHERE name = ?').get(d.role) as { id: number };
  const deptRow = db.prepare("SELECT id FROM departments WHERE code = 'CE'").get() as { id: number };
  const hash = bcrypt.hashSync(d.password, 10);

  const id = Number(
    db
      .prepare(
        `INSERT INTO users (email, password_hash, full_name, phone, role_id, department_id, status, is_demo_data)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 0)`
      )
      .run(d.email.trim(), hash, d.fullName.trim(), d.phone?.trim() || null, roleRow.id, deptRow.id).lastInsertRowid
  );

  writeAuditLog(req, 'ADMIN_USER_CREATE', 'USER', id, `Created user ${d.fullName} (${d.email}) with role ${d.role}.`);
  res.status(201).json({ id });
});

extendedRouter.patch('/admin/users/:id', requireAuth, requireRole('SUPER_ADMIN'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const role = req.body?.role as string | undefined;
  const status = req.body?.status as string | undefined;

  if (role) {
    const roleRow = db.prepare('SELECT id FROM roles WHERE name = ?').get(role) as { id: number } | undefined;
    if (!roleRow) {
      res.status(400).json({ error: 'Invalid role.' });
      return;
    }
    db.prepare(`UPDATE users SET role_id = ?, updated_at = datetime('now') WHERE id = ?`).run(roleRow.id, id);
  }
  if (status && ['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(status)) {
    db.prepare(`UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
  }

  writeAuditLog(req, 'ADMIN_USER_UPDATE', 'USER', id, `Updated user #${id} (role=${role || 'unchanged'}, status=${status || 'unchanged'}).`);
  res.json({ ok: true });
});

extendedRouter.get('/admin/roles', requireAuth, requireRole('SUPER_ADMIN'), (_req, res) => {
  const roles = db.prepare('SELECT * FROM roles ORDER BY id ASC').all() as Array<{ id: number; name: string; description: string }>;
  const permissions = db.prepare('SELECT * FROM permissions ORDER BY module ASC, code ASC').all();
  const mappings = db.prepare('SELECT role_id, permission_id FROM role_permissions').all();
  res.json({ roles, permissions, mappings });
});

extendedRouter.get('/admin/settings', requireAuth, (_req, res) => {
  const settings = db.prepare('SELECT * FROM institution_settings WHERE id = 1').get();
  const departments = db.prepare('SELECT * FROM departments ORDER BY id ASC').all();
  res.json({ settings, departments });
});

extendedRouter.put('/admin/settings', requireAuth, requireRole('SUPER_ADMIN'), (req: AuthedRequest, res) => {
  const s = db.prepare('SELECT * FROM institution_settings WHERE id = 1').get() as Record<string, any>;
  const b = req.body || {};

  db.prepare(
    `UPDATE institution_settings SET
      institution_name = ?, department_name = ?, location = ?, application_name = ?, tagline = ?,
      academic_session = ?, accession_prefix = ?, accession_year_format = ?, accession_start_sequence = ?,
      student_borrow_limit = ?, faculty_borrow_limit = ?, student_loan_days = ?, faculty_loan_days = ?,
      max_renewals = ?, fine_per_day_inr = ?, max_fine_inr = ?, reservation_expiry_hours = ?,
      email_notifications_on = ?, updated_at = datetime('now')
     WHERE id = 1`
  ).run(
    b.institution_name ?? s.institution_name,
    b.department_name ?? s.department_name,
    b.location ?? s.location,
    b.application_name ?? s.application_name,
    b.tagline ?? s.tagline,
    b.academic_session ?? s.academic_session,
    b.accession_prefix ?? s.accession_prefix,
    b.accession_year_format ?? s.accession_year_format,
    Number(b.accession_start_sequence ?? s.accession_start_sequence),
    Number(b.student_borrow_limit ?? s.student_borrow_limit),
    Number(b.faculty_borrow_limit ?? s.faculty_borrow_limit),
    Number(b.student_loan_days ?? s.student_loan_days),
    Number(b.faculty_loan_days ?? s.faculty_loan_days),
    Number(b.max_renewals ?? s.max_renewals),
    Number(b.fine_per_day_inr ?? s.fine_per_day_inr),
    Number(b.max_fine_inr ?? s.max_fine_inr),
    Number(b.reservation_expiry_hours ?? s.reservation_expiry_hours),
    b.email_notifications_on ? 1 : 0
  );

  writeAuditLog(req, 'SETTINGS_UPDATE', 'INSTITUTION_SETTINGS', 1, 'Updated institutional configuration and library borrowing policies.');
  res.json({ settings: db.prepare('SELECT * FROM institution_settings WHERE id = 1').get() });
});

extendedRouter.post(
  '/admin/settings/logo/:slot',
  requireAuth,
  requireRole('SUPER_ADMIN'),
  logoUpload.single('logo'),
  (req: AuthedRequest, res) => {
    const slot = req.params.slot === 'department' ? 'department_logo_url' : 'institution_logo_url';
    if (!req.file) {
      res.status(400).json({ error: 'Please select a PNG, JPG, SVG, or WebP logo image.' });
      return;
    }
    const url = `/uploads/logos/${req.file.filename}`;
    db.prepare(`UPDATE institution_settings SET ${slot} = ?, updated_at = datetime('now') WHERE id = 1`).run(url);
    writeAuditLog(req, 'LOGO_UPLOAD', 'INSTITUTION_SETTINGS', slot, `Uploaded custom logo for ${slot}.`);
    res.json({ url, slot });
  }
);

extendedRouter.post('/admin/departments', requireAuth, requireRole('SUPER_ADMIN'), (req: AuthedRequest, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  const name = String(req.body?.name || '').trim();
  const hodName = String(req.body?.hodName || '').trim();
  const location = String(req.body?.location || '').trim();
  if (code.length < 2 || name.length < 3) {
    res.status(400).json({ error: 'Department code and name are required.' });
    return;
  }
  try {
    const id = Number(
      db
        .prepare('INSERT INTO departments (code, name, hod_name, location) VALUES (?, ?, ?, ?)')
        .run(code, name, hodName || null, location || null).lastInsertRowid
    );
    writeAuditLog(req, 'DEPARTMENT_CREATE', 'DEPARTMENT', id, `Added department "${name}" (${code}).`);
    res.status(201).json({ id, code, name });
  } catch {
    res.status(400).json({ error: 'Department code already exists.' });
  }
});

extendedRouter.get('/admin/audit-logs', requireAuth, requireRole('SUPER_ADMIN'), (req, res) => {
  const q = String(req.query.q || '').trim();
  const entityType = String(req.query.entityType || '').trim();
  let where = 'WHERE 1=1';
  const params: string[] = [];
  if (q) {
    const like = `%${q}%`;
    where += ' AND (action LIKE ? OR details LIKE ? OR actor_name LIKE ? OR entity_id LIKE ?)';
    params.push(like, like, like, like);
  }
  if (entityType) {
    where += ' AND entity_type = ?';
    params.push(entityType);
  }
  const items = db
    .prepare(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT 200`)
    .all(...params);
  res.json({ items });
});

extendedRouter.get('/admin/backup/json', requireAuth, requireRole('SUPER_ADMIN'), (req: AuthedRequest, res) => {
  const tables = [
    'institution_settings',
    'departments',
    'categories',
    'authors',
    'publishers',
    'books',
    'accession_sequences',
    'book_copies',
    'book_issues',
    'book_returns',
    'reservations',
    'fines',
    'fine_payments',
    'acquisition_requests',
    'digital_resources',
    'audit_logs',
  ];
  const snapshot: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    application: 'HIT Civil Engineering – Digital Library',
    data: {},
  };
  for (const t of tables) {
    (snapshot.data as Record<string, unknown>)[t] = db.prepare(`SELECT * FROM ${t}`).all();
  }
  writeAuditLog(req, 'DATABASE_BACKUP', 'DATABASE', 'json-snapshot', 'Exported full JSON database backup.');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="HIT-CE-Library-Backup-${new Date().toISOString().slice(0, 10)}.json"`
  );
  res.send(JSON.stringify(snapshot, null, 2));
});

extendedRouter.get('/admin/backup/sqlite', requireAuth, requireRole('SUPER_ADMIN'), (req: AuthedRequest, res) => {
  writeAuditLog(req, 'DATABASE_BACKUP', 'DATABASE', 'sqlite-db', 'Downloaded persistent SQLite database archive.');
  res.download(getDbPath(), `HIT-CE-Library-${new Date().toISOString().slice(0, 10)}.db`);
});
