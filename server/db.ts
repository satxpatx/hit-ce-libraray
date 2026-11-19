import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DB_PATH = process.env.SQLITE_DB_PATH
  ? path.resolve(process.cwd(), process.env.SQLITE_DB_PATH)
  : path.resolve(process.cwd(), 'data', 'hit_civil_library.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(path.resolve(process.cwd(), 'uploads', 'digital'), { recursive: true });
fs.mkdirSync(path.resolve(process.cwd(), 'uploads', 'logos'), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

export function getDbPath(): string {
  return DB_PATH;
}

export function withTransaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback error if already rolled back
    }
    throw err;
  }
}

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      module TEXT NOT NULL,
      description TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_id)
    );

    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      hod_name TEXT,
      location TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firebase_uid TEXT UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT,
      photo_url TEXT,
      role_id INTEGER NOT NULL REFERENCES roles(id),
      department_id INTEGER REFERENCES departments(id),
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      is_demo_data INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      registration_number TEXT NOT NULL UNIQUE,
      programme TEXT NOT NULL,
      semester INTEGER NOT NULL,
      academic_session TEXT NOT NULL,
      department_id INTEGER NOT NULL REFERENCES departments(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS faculty (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      employee_id TEXT NOT NULL UNIQUE,
      designation TEXT NOT NULL,
      department_id INTEGER NOT NULL REFERENCES departments(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE,
      description TEXT,
      is_standard INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS authors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      biography TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS publishers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      city TEXT,
      country TEXT,
      website TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_code TEXT NOT NULL UNIQUE,
      isbn TEXT UNIQUE,
      title TEXT NOT NULL,
      subtitle TEXT,
      author_id INTEGER NOT NULL REFERENCES authors(id),
      editor TEXT,
      publisher_id INTEGER NOT NULL REFERENCES publishers(id),
      edition TEXT,
      publication_year INTEGER,
      language TEXT NOT NULL DEFAULT 'English',
      subject TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      subcategory TEXT,
      description TEXT,
      keywords TEXT,
      cover_image_url TEXT,
      digital_attachment TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      is_demo_data INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS accession_sequences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prefix TEXT NOT NULL DEFAULT 'HIT-CE',
      year_format TEXT NOT NULL DEFAULT 'CALENDAR',
      current_year INTEGER NOT NULL,
      last_number INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(prefix, current_year)
    );

    CREATE TABLE IF NOT EXISTS book_copies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      accession_number TEXT NOT NULL UNIQUE,
      book_id INTEGER NOT NULL REFERENCES books(id),
      copy_number INTEGER NOT NULL,
      acquisition_date TEXT NOT NULL DEFAULT (date('now')),
      purchase_price_inr REAL NOT NULL DEFAULT 0,
      supplier TEXT,
      invoice_number TEXT,
      funding_source TEXT,
      shelf_number TEXT NOT NULL DEFAULT 'S-01',
      rack_number TEXT NOT NULL DEFAULT 'R-01',
      physical_condition TEXT NOT NULL DEFAULT 'Good',
      status TEXT NOT NULL DEFAULT 'AVAILABLE',
      remarks TEXT,
      is_demo_data INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS barcodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_copy_id INTEGER NOT NULL UNIQUE REFERENCES book_copies(id) ON DELETE CASCADE,
      format TEXT NOT NULL DEFAULT 'CODE128',
      value TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS qr_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_copy_id INTEGER NOT NULL UNIQUE REFERENCES book_copies(id) ON DELETE CASCADE,
      payload TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS book_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_no TEXT NOT NULL UNIQUE,
      book_copy_id INTEGER NOT NULL REFERENCES book_copies(id),
      borrower_id INTEGER NOT NULL REFERENCES users(id),
      issued_by_id INTEGER NOT NULL REFERENCES users(id),
      issue_date TEXT NOT NULL DEFAULT (datetime('now')),
      due_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ISSUED',
      renewal_count INTEGER NOT NULL DEFAULT 0,
      remarks TEXT,
      is_demo_data INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS book_returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_issue_id INTEGER NOT NULL UNIQUE REFERENCES book_issues(id),
      return_receipt TEXT NOT NULL UNIQUE,
      return_date TEXT NOT NULL DEFAULT (datetime('now')),
      overdue_days INTEGER NOT NULL DEFAULT 0,
      fine_amount_inr REAL NOT NULL DEFAULT 0,
      condition_note TEXT,
      processed_by_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS book_renewals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_issue_id INTEGER NOT NULL REFERENCES book_issues(id),
      previous_due TEXT NOT NULL,
      new_due_date TEXT NOT NULL,
      renewed_by_id INTEGER NOT NULL REFERENCES users(id),
      renewal_date TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES books(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      reserved_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      is_demo_data INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS reservation_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_id INTEGER NOT NULL UNIQUE REFERENCES reservations(id) ON DELETE CASCADE,
      book_id INTEGER NOT NULL REFERENCES books(id),
      position INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_issue_id INTEGER NOT NULL REFERENCES book_issues(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      overdue_days INTEGER NOT NULL DEFAULT 0,
      amount_inr REAL NOT NULL DEFAULT 0,
      paid_amount_inr REAL NOT NULL DEFAULT 0,
      waived_amount_inr REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING',
      waiver_reason TEXT,
      is_demo_data INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fine_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fine_id INTEGER NOT NULL REFERENCES fines(id) ON DELETE CASCADE,
      receipt_number TEXT NOT NULL UNIQUE,
      amount_paid_inr REAL NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'Cash / Departmental Counter',
      collected_by_id INTEGER NOT NULL REFERENCES users(id),
      paid_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS acquisition_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      isbn TEXT,
      publisher TEXT,
      subject TEXT NOT NULL,
      reason TEXT NOT NULL,
      requester_id INTEGER NOT NULL REFERENCES users(id),
      priority TEXT NOT NULL DEFAULT 'MEDIUM',
      status TEXT NOT NULL DEFAULT 'PENDING',
      review_note TEXT,
      is_demo_data INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS digital_resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      category TEXT NOT NULL,
      subject TEXT NOT NULL,
      semester TEXT,
      academic_year TEXT NOT NULL,
      description TEXT,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT NOT NULL DEFAULT 'application/pdf',
      access_level TEXT NOT NULL DEFAULT 'ALL_AUTHENTICATED',
      uploaded_by_id INTEGER NOT NULL REFERENCES users(id),
      download_count INTEGER NOT NULL DEFAULT 0,
      is_demo_data INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS import_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL,
      sheet_name TEXT NOT NULL,
      duplicate_mode TEXT NOT NULL,
      total_rows INTEGER NOT NULL,
      imported_rows INTEGER NOT NULL,
      skipped_rows INTEGER NOT NULL,
      error_rows INTEGER NOT NULL,
      uploaded_by_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS import_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_job_id INTEGER NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
      row_number INTEGER NOT NULL,
      field_name TEXT NOT NULL,
      reason TEXT NOT NULL,
      raw_payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER REFERENCES users(id),
      actor_name TEXT,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details TEXT NOT NULL,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS institution_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      institution_name TEXT NOT NULL DEFAULT 'Haldia Institute of Technology',
      department_name TEXT NOT NULL DEFAULT 'Department of Civil Engineering',
      location TEXT NOT NULL DEFAULT 'Haldia, West Bengal, India',
      application_name TEXT NOT NULL DEFAULT 'HIT Civil Engineering – Digital Library',
      tagline TEXT NOT NULL DEFAULT 'Knowledge. Research. Innovation.',
      academic_session TEXT NOT NULL DEFAULT '2026-2027',
      institution_logo_url TEXT,
      department_logo_url TEXT,
      accession_prefix TEXT NOT NULL DEFAULT 'HIT-CE',
      accession_year_format TEXT NOT NULL DEFAULT 'CALENDAR',
      accession_start_sequence INTEGER NOT NULL DEFAULT 1,
      student_borrow_limit INTEGER NOT NULL DEFAULT 4,
      faculty_borrow_limit INTEGER NOT NULL DEFAULT 8,
      student_loan_days INTEGER NOT NULL DEFAULT 14,
      faculty_loan_days INTEGER NOT NULL DEFAULT 30,
      max_renewals INTEGER NOT NULL DEFAULT 2,
      fine_per_day_inr REAL NOT NULL DEFAULT 5.0,
      max_fine_inr REAL NOT NULL DEFAULT 500.0,
      reservation_expiry_hours INTEGER NOT NULL DEFAULT 48,
      email_notifications_on INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
    CREATE INDEX IF NOT EXISTS idx_books_category ON books(category_id);
    CREATE INDEX IF NOT EXISTS idx_book_copies_acc ON book_copies(accession_number);
    CREATE INDEX IF NOT EXISTS idx_book_copies_book ON book_copies(book_id);
    CREATE INDEX IF NOT EXISTS idx_book_copies_status ON book_copies(status);
    CREATE INDEX IF NOT EXISTS idx_issues_copy_status ON book_issues(book_copy_id, status);
    CREATE INDEX IF NOT EXISTS idx_issues_borrower_status ON book_issues(borrower_id, status);
    CREATE INDEX IF NOT EXISTS idx_issues_due ON book_issues(due_date);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
  `);
}
