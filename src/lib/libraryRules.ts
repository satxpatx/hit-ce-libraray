export type UserRole = 'SUPER_ADMIN' | 'LIBRARIAN' | 'FACULTY' | 'STUDENT';

export type CopyStatus =
  | 'AVAILABLE'
  | 'ISSUED'
  | 'RESERVED'
  | 'UNDER_MAINTENANCE'
  | 'LOST'
  | 'DAMAGED'
  | 'WITHDRAWN';

export type DuplicateHandlingMode = 'SKIP' | 'UPDATE' | 'ADD_COPY';

export interface AccessionConfig {
  prefix: string;
  yearFormat: 'CALENDAR' | 'ACADEMIC';
  year: number;
  sequence: number;
}

export function formatAccessionNumber(config: AccessionConfig): string {
  const cleanPrefix = (config.prefix || 'HIT-CE').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const yearSegment =
    config.yearFormat === 'ACADEMIC'
      ? `${config.year}-${String((config.year + 1) % 100).padStart(2, '0')}`
      : `${config.year}`;
  const seqSegment = String(Math.max(1, Math.floor(config.sequence))).padStart(4, '0');
  return `${cleanPrefix}-${yearSegment}-${seqSegment}`;
}

export function buildQrPayload(params: {
  accessionNumber: string;
  bookCode: string;
  copyNumber: number;
}): string {
  return JSON.stringify({
    sys: 'HIT-CE-LIB',
    acc: params.accessionNumber,
    book: params.bookCode,
    copy: params.copyNumber,
  });
}

export function parseScannedIdentifier(rawInput: string): {
  accessionNumber: string;
  raw: string;
  source: 'QR_JSON' | 'BARCODE_TEXT';
} {
  const trimmed = (rawInput || '').trim();
  if (!trimmed) {
    return { accessionNumber: '', raw: '', source: 'BARCODE_TEXT' };
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as { acc?: string; accessionNumber?: string };
      const acc = (parsed.acc || parsed.accessionNumber || '').trim().toUpperCase();
      if (acc) {
        return { accessionNumber: acc, raw: trimmed, source: 'QR_JSON' };
      }
    } catch {
      // Fallback to raw text parsing
    }
  }

  // Handle pipe-delimited fallback or plain accession number / ISBN
  if (trimmed.includes('|')) {
    const parts = trimmed.split('|').map((p) => p.trim());
    if (parts.length >= 2 && parts[1]) {
      return { accessionNumber: parts[1].toUpperCase(), raw: trimmed, source: 'QR_JSON' };
    }
  }

  return {
    accessionNumber: trimmed.toUpperCase(),
    raw: trimmed,
    source: 'BARCODE_TEXT',
  };
}

export function computeDueDate(
  issueDateIso: string,
  borrowerRole: UserRole,
  studentLoanDays: number,
  facultyLoanDays: number
): string {
  const base = new Date(issueDateIso);
  const days =
    borrowerRole === 'FACULTY' || borrowerRole === 'SUPER_ADMIN' || borrowerRole === 'LIBRARIAN'
      ? Math.max(1, facultyLoanDays)
      : Math.max(1, studentLoanDays);
  const due = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  return due.toISOString();
}

export function calculateOverdueAndFine(params: {
  dueDateIso: string;
  asOfDateIso: string;
  finePerDayInr: number;
  maxFineInr: number;
}): { overdueDays: number; fineAmountInr: number } {
  const due = new Date(params.dueDateIso);
  const asOf = new Date(params.asOfDateIso);

  const dueUtc = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const asOfUtc = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  const diffDays = Math.floor((asOfUtc - dueUtc) / (24 * 60 * 60 * 1000));

  if (diffDays <= 0) {
    return { overdueDays: 0, fineAmountInr: 0 };
  }

  const rawFine = diffDays * Math.max(0, params.finePerDayInr);
  const capped = params.maxFineInr > 0 ? Math.min(rawFine, params.maxFineInr) : rawFine;
  return {
    overdueDays: diffDays,
    fineAmountInr: Math.round(capped * 100) / 100,
  };
}

export interface BorrowingEligibilityInput {
  borrowerRole: UserRole;
  accountStatus: string;
  activeLoanCount: number;
  studentBorrowLimit: number;
  facultyBorrowLimit: number;
  hasSameTitleActiveLoan?: boolean;
}

export function checkBorrowingEligibility(input: BorrowingEligibilityInput): {
  eligible: boolean;
  reason?: string;
  limit: number;
  remaining: number;
} {
  const limit =
    input.borrowerRole === 'FACULTY' || input.borrowerRole === 'SUPER_ADMIN' || input.borrowerRole === 'LIBRARIAN'
      ? input.facultyBorrowLimit
      : input.studentBorrowLimit;

  const remaining = Math.max(0, limit - input.activeLoanCount);

  if (input.accountStatus !== 'ACTIVE') {
    return {
      eligible: false,
      reason: `Borrower account is currently ${input.accountStatus}.`,
      limit,
      remaining,
    };
  }

  if (input.activeLoanCount >= limit) {
    return {
      eligible: false,
      reason: `Borrowing limit reached (${input.activeLoanCount}/${limit} active loans).`,
      limit,
      remaining: 0,
    };
  }

  if (input.hasSameTitleActiveLoan) {
    return {
      eligible: false,
      reason: 'Borrower already holds an active loan for another copy of this book title.',
      limit,
      remaining,
    };
  }

  return { eligible: true, limit, remaining };
}

export interface NormalizedImportRow {
  rowNumber: number;
  bookCode: string;
  accessionNumber: string;
  isbn: string;
  title: string;
  author: string;
  publisher: string;
  edition: string;
  publicationYear: number | null;
  category: string;
  subject: string;
  acquisitionDate: string;
  purchasePrice: number;
  shelfNumber: string;
  rackNumber: string;
  physicalCondition: string;
  status: CopyStatus;
}

export interface ImportRowValidationResult {
  valid: boolean;
  action: 'IMPORT' | 'UPDATE' | 'ADD_COPY' | 'SKIP' | 'ERROR';
  errors: Array<{ field: string; reason: string }>;
  warnings: string[];
}

const VALID_COPY_STATUSES: CopyStatus[] = [
  'AVAILABLE',
  'ISSUED',
  'RESERVED',
  'UNDER_MAINTENANCE',
  'LOST',
  'DAMAGED',
  'WITHDRAWN',
];

export function normalizeCopyStatus(raw?: string | null): CopyStatus | null {
  if (!raw) return 'AVAILABLE';
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, '_');
  if (VALID_COPY_STATUSES.includes(cleaned as CopyStatus)) {
    return cleaned as CopyStatus;
  }
  return null;
}

export function validateImportRow(
  row: NormalizedImportRow,
  context: {
    existingAccessions: Set<string>;
    seenAccessionsInFile: Set<string>;
    existingIsbns: Set<string>;
    duplicateMode: DuplicateHandlingMode;
  }
): ImportRowValidationResult {
  const errors: Array<{ field: string; reason: string }> = [];
  const warnings: string[] = [];

  if (!row.title || row.title.trim().length < 2) {
    errors.push({ field: 'Book Title', reason: 'Book Title is required (min 2 characters).' });
  }
  if (!row.author || row.author.trim().length < 2) {
    errors.push({ field: 'Author', reason: 'Author name is required.' });
  }
  if (!row.category || row.category.trim().length < 2) {
    errors.push({ field: 'Category', reason: 'Category is required.' });
  }
  if (!row.accessionNumber || row.accessionNumber.trim().length < 3) {
    errors.push({ field: 'Accession Number', reason: 'Unique Accession Number is required.' });
  } else if (!/^[A-Za-z0-9/_-]+$/.test(row.accessionNumber.trim())) {
    errors.push({
      field: 'Accession Number',
      reason: 'Accession Number contains invalid characters.',
    });
  }

  if (row.publicationYear !== null && (row.publicationYear < 1850 || row.publicationYear > 2100)) {
    errors.push({
      field: 'Publication Year',
      reason: `Publication Year (${row.publicationYear}) is out of valid range (1850-2100).`,
    });
  }

  if (Number.isNaN(row.purchasePrice) || row.purchasePrice < 0) {
    errors.push({ field: 'Purchase Price', reason: 'Purchase Price must be a non-negative number.' });
  }

  const accUpper = row.accessionNumber.trim().toUpperCase();
  const isbnClean = row.isbn.trim();

  if (accUpper && context.seenAccessionsInFile.has(accUpper)) {
    errors.push({
      field: 'Accession Number',
      reason: `Duplicate Accession Number "${accUpper}" appears multiple times inside uploaded file.`,
    });
  }

  if (errors.length > 0) {
    return { valid: false, action: 'ERROR', errors, warnings };
  }

  const accessionExists = context.existingAccessions.has(accUpper);
  const isbnExists = Boolean(isbnClean) && context.existingIsbns.has(isbnClean);

  if (accessionExists) {
    if (context.duplicateMode === 'SKIP') {
      warnings.push(`Accession "${accUpper}" already exists — will be skipped.`);
      return { valid: true, action: 'SKIP', errors: [], warnings };
    }
    if (context.duplicateMode === 'UPDATE') {
      warnings.push(`Accession "${accUpper}" exists — metadata will be updated (accession preserved).`);
      return { valid: true, action: 'UPDATE', errors: [], warnings };
    }
    // ADD_COPY mode still cannot reuse an existing accession number!
    errors.push({
      field: 'Accession Number',
      reason: `Accession Number "${accUpper}" already exists in the Accession Register and cannot be reused.`,
    });
    return { valid: false, action: 'ERROR', errors, warnings };
  }

  if (isbnExists) {
    if (context.duplicateMode === 'SKIP') {
      warnings.push(`ISBN "${isbnClean}" already exists — will be skipped.`);
      return { valid: true, action: 'SKIP', errors: [], warnings };
    }
    if (context.duplicateMode === 'ADD_COPY') {
      warnings.push(`ISBN "${isbnClean}" exists — will register "${accUpper}" as an additional physical copy.`);
      return { valid: true, action: 'ADD_COPY', errors: [], warnings };
    }
    warnings.push(`ISBN "${isbnClean}" exists — book details will be updated and new copy "${accUpper}" added.`);
    return { valid: true, action: 'UPDATE', errors: [], warnings };
  }

  return { valid: true, action: 'IMPORT', errors: [], warnings };
}

export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  SUPER_ADMIN: [
    'dashboard.admin',
    'catalogue.view',
    'catalogue.manage',
    'search.advanced',
    'digital.view',
    'digital.manage',
    'accession.manage',
    'copies.manage',
    'labels.generate',
    'excel.import',
    'excel.export',
    'circulation.issue',
    'circulation.return',
    'circulation.renew',
    'circulation.scan',
    'reservations.view',
    'reservations.manage',
    'overdue.manage',
    'fines.manage',
    'members.students',
    'members.faculty',
    'members.history',
    'acquisitions.request',
    'acquisitions.manage',
    'taxonomy.manage',
    'reports.view',
    'notifications.view',
    'admin.users',
    'admin.roles',
    'admin.department',
    'admin.policies',
    'admin.audit',
    'admin.backup',
  ],
  LIBRARIAN: [
    'dashboard.admin',
    'catalogue.view',
    'catalogue.manage',
    'search.advanced',
    'digital.view',
    'digital.manage',
    'accession.manage',
    'copies.manage',
    'labels.generate',
    'excel.import',
    'excel.export',
    'circulation.issue',
    'circulation.return',
    'circulation.renew',
    'circulation.scan',
    'reservations.view',
    'reservations.manage',
    'overdue.manage',
    'fines.manage',
    'members.students',
    'members.faculty',
    'members.history',
    'acquisitions.request',
    'acquisitions.manage',
    'taxonomy.manage',
    'reports.view',
    'notifications.view',
  ],
  FACULTY: [
    'dashboard.member',
    'catalogue.view',
    'search.advanced',
    'digital.view',
    'circulation.renew_self',
    'reservations.view',
    'acquisitions.request',
    'notifications.view',
  ],
  STUDENT: [
    'dashboard.member',
    'catalogue.view',
    'search.advanced',
    'digital.view',
    'reservations.view',
    'acquisitions.request',
    'notifications.view',
  ],
};

export function hasRolePermission(role: UserRole, permission: string): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
