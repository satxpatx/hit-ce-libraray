import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { db, withTransaction } from './db.ts';
import {
  buildQrPayload,
  normalizeCopyStatus,
  validateImportRow,
  type DuplicateHandlingMode,
  type NormalizedImportRow,
} from '../src/lib/libraryRules.ts';

export const STANDARD_IMPORT_FIELDS = [
  'bookCode',
  'accessionNumber',
  'isbn',
  'title',
  'author',
  'publisher',
  'edition',
  'publicationYear',
  'category',
  'subject',
  'acquisitionDate',
  'purchasePrice',
  'shelfNumber',
  'rackNumber',
  'physicalCondition',
  'status',
] as const;

export type ImportFieldKey = (typeof STANDARD_IMPORT_FIELDS)[number];

const COLUMN_SYNONYMS: Record<ImportFieldKey, string[]> = {
  bookCode: ['book id', 'book_id', 'book code', 'bookcode', 'id'],
  accessionNumber: ['accession number', 'accession_number', 'accession no', 'acc no', 'accession'],
  isbn: ['isbn', 'isbn-13', 'isbn13', 'isbn-10'],
  title: ['book title', 'title', 'name', 'book name'],
  author: ['author', 'authors', 'writer'],
  publisher: ['publisher', 'publication', 'pub'],
  edition: ['edition', 'ed'],
  publicationYear: ['publication year', 'pub year', 'year', 'publication_year'],
  category: ['category', 'classification', 'subject category', 'dept category'],
  subject: ['subject', 'topic', 'sub-category', 'subcategory'],
  acquisitionDate: ['acquisition date', 'acq date', 'date of acquisition', 'purchase date'],
  purchasePrice: ['purchase price', 'price', 'price (inr)', 'cost', 'amount'],
  shelfNumber: ['shelf number', 'shelf no', 'shelf'],
  rackNumber: ['rack number', 'rack no', 'rack'],
  physicalCondition: ['physical condition', 'condition', 'state'],
  status: ['status', 'copy status', 'availability'],
};

export function autoMapHeaders(headers: string[]): Record<ImportFieldKey, string> {
  const mapping = {} as Record<ImportFieldKey, string>;
  const lowerMap = new Map<string, string>();
  for (const h of headers) {
    lowerMap.set(h.trim().toLowerCase(), h);
  }

  for (const field of STANDARD_IMPORT_FIELDS) {
    mapping[field] = '';
    for (const synonym of COLUMN_SYNONYMS[field]) {
      if (lowerMap.has(synonym)) {
        mapping[field] = lowerMap.get(synonym)!;
        break;
      }
    }
    if (!mapping[field]) {
      for (const h of headers) {
        const hl = h.trim().toLowerCase();
        if (COLUMN_SYNONYMS[field].some((syn) => hl.includes(syn))) {
          mapping[field] = h;
          break;
        }
      }
    }
  }
  return mapping;
}

export function parseWorkbookBuffer(buffer: Buffer, requestedSheet?: string) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetNames = wb.SheetNames;
  const activeSheet =
    requestedSheet && sheetNames.includes(requestedSheet) ? requestedSheet : sheetNames[0];
  const sheet = wb.Sheets[activeSheet];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  });

  const headers =
    rawRows.length > 0
      ? Object.keys(rawRows[0]).filter((h) => !h.startsWith('__EMPTY'))
      : [];

  return {
    sheetNames,
    activeSheet,
    headers,
    totalRows: rawRows.length,
    suggestedMapping: autoMapHeaders(headers),
    rawRows,
  };
}

function cellStr(row: Record<string, unknown>, colName: string): string {
  if (!colName) return '';
  const val = row[colName];
  if (val === null || val === undefined) return '';
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).trim();
}

export function mapAndValidateImportRows(
  rawRows: Record<string, unknown>[],
  mapping: Record<ImportFieldKey, string>,
  duplicateMode: DuplicateHandlingMode
) {
  const existingAccessions = new Set<string>(
    (db.prepare('SELECT accession_number FROM book_copies').all() as Array<{ accession_number: string }>).map(
      (r) => r.accession_number.toUpperCase()
    )
  );
  const existingIsbns = new Set<string>(
    (db.prepare('SELECT isbn FROM books WHERE isbn IS NOT NULL').all() as Array<{ isbn: string }>).map((r) =>
      r.isbn.trim()
    )
  );
  const seenAccessionsInFile = new Set<string>();

  const rows: Array<{
    normalized: NormalizedImportRow;
    validation: ReturnType<typeof validateImportRow>;
  }> = [];

  rawRows.forEach((raw, idx) => {
    const yearRaw = cellStr(raw, mapping.publicationYear);
    const priceRaw = cellStr(raw, mapping.purchasePrice).replace(/[₹,\s]/g, '');
    const statusRaw = cellStr(raw, mapping.status);
    const parsedStatus = normalizeCopyStatus(statusRaw);

    const normalized: NormalizedImportRow = {
      rowNumber: idx + 2,
      bookCode: cellStr(raw, mapping.bookCode),
      accessionNumber: cellStr(raw, mapping.accessionNumber).toUpperCase(),
      isbn: cellStr(raw, mapping.isbn),
      title: cellStr(raw, mapping.title),
      author: cellStr(raw, mapping.author),
      publisher: cellStr(raw, mapping.publisher) || 'Academic Press',
      edition: cellStr(raw, mapping.edition) || '1st Edition',
      publicationYear: yearRaw ? Number(yearRaw) : null,
      category: cellStr(raw, mapping.category),
      subject: cellStr(raw, mapping.subject) || cellStr(raw, mapping.category),
      acquisitionDate: cellStr(raw, mapping.acquisitionDate) || new Date().toISOString().slice(0, 10),
      purchasePrice: priceRaw ? Number(priceRaw) : 0,
      shelfNumber: cellStr(raw, mapping.shelfNumber) || 'S-01',
      rackNumber: cellStr(raw, mapping.rackNumber) || 'R-01',
      physicalCondition: cellStr(raw, mapping.physicalCondition) || 'Good',
      status: parsedStatus ?? 'AVAILABLE',
    };

    const validation = validateImportRow(normalized, {
      existingAccessions,
      seenAccessionsInFile,
      existingIsbns,
      duplicateMode,
    });

    if (statusRaw && !parsedStatus) {
      validation.valid = false;
      validation.action = 'ERROR';
      validation.errors.push({
        field: 'Status',
        reason: `Invalid copy status "${statusRaw}". Allowed: AVAILABLE, ISSUED, RESERVED, UNDER_MAINTENANCE, LOST, DAMAGED, WITHDRAWN.`,
      });
    }

    if (normalized.accessionNumber) {
      seenAccessionsInFile.add(normalized.accessionNumber);
    }

    rows.push({ normalized, validation });
  });

  const summary = {
    total: rows.length,
    toImport: rows.filter((r) => r.validation.action === 'IMPORT').length,
    toUpdate: rows.filter((r) => r.validation.action === 'UPDATE').length,
    toAddCopy: rows.filter((r) => r.validation.action === 'ADD_COPY').length,
    toSkip: rows.filter((r) => r.validation.action === 'SKIP').length,
    invalid: rows.filter((r) => r.validation.action === 'ERROR').length,
  };

  return { rows, summary };
}

export function executeValidatedImport(params: {
  fileName: string;
  sheetName: string;
  duplicateMode: DuplicateHandlingMode;
  uploadedById: number;
  validatedRows: ReturnType<typeof mapAndValidateImportRows>['rows'];
}) {
  return withTransaction(() => {
    let importedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    const findCategory = db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)');
    const insertCategory = db.prepare('INSERT INTO categories (name, code, description) VALUES (?, ?, ?)');
    const findAuthor = db.prepare('SELECT id FROM authors WHERE LOWER(name) = LOWER(?)');
    const insertAuthor = db.prepare('INSERT INTO authors (name) VALUES (?)');
    const findPublisher = db.prepare('SELECT id FROM publishers WHERE LOWER(name) = LOWER(?)');
    const insertPublisher = db.prepare('INSERT INTO publishers (name) VALUES (?)');
    const findBookByIsbn = db.prepare('SELECT id, book_code FROM books WHERE isbn = ?');
    const findBookByCode = db.prepare('SELECT id, book_code FROM books WHERE book_code = ?');
    const findBookByTitleAuthor = db.prepare(
      'SELECT id, book_code FROM books WHERE LOWER(title) = LOWER(?) AND author_id = ?'
    );
    const insertBook = db.prepare(`
      INSERT INTO books (book_code, isbn, title, author_id, publisher_id, edition, publication_year, subject, category_id, archived, is_demo_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
    `);
    const updateBook = db.prepare(`
      UPDATE books SET title = ?, author_id = ?, publisher_id = ?, edition = ?, publication_year = ?, subject = ?, category_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    const findCopyByAcc = db.prepare('SELECT id, book_id FROM book_copies WHERE accession_number = ?');
    const countCopiesForBook = db.prepare('SELECT COUNT(*) as c FROM book_copies WHERE book_id = ?');
    const insertCopy = db.prepare(`
      INSERT INTO book_copies (
        accession_number, book_id, copy_number, acquisition_date, purchase_price_inr,
        shelf_number, rack_number, physical_condition, status, remarks, is_demo_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Imported via Excel Migration', 0)
    `);
    const updateCopy = db.prepare(`
      UPDATE book_copies SET acquisition_date = ?, purchase_price_inr = ?, shelf_number = ?, rack_number = ?, physical_condition = ?, status = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    const insertBarcode = db.prepare('INSERT OR IGNORE INTO barcodes (book_copy_id, format, value) VALUES (?, ?, ?)');
    const insertQr = db.prepare('INSERT OR IGNORE INTO qr_codes (book_copy_id, payload) VALUES (?, ?)');

    const errorRecords: Array<{ rowNumber: number; field: string; reason: string; raw: string }> = [];

    for (const item of params.validatedRows) {
      const { normalized: r, validation } = item;
      if (validation.action === 'ERROR') {
        errorCount += 1;
        for (const err of validation.errors) {
          errorRecords.push({
            rowNumber: r.rowNumber,
            field: err.field,
            reason: err.reason,
            raw: JSON.stringify(r),
          });
        }
        continue;
      }

      if (validation.action === 'SKIP') {
        skippedCount += 1;
        continue;
      }

      // Resolve taxonomy
      let cat = findCategory.get(r.category) as { id: number } | undefined;
      if (!cat) {
        const code =
          r.category
            .replace(/[^A-Za-z]/g, '')
            .slice(0, 3)
            .toUpperCase() + Math.floor(10 + Math.random() * 89);
        const inserted = insertCategory.run(r.category, code, 'Created during Excel import');
        cat = { id: Number(inserted.lastInsertRowid) };
      }

      let author = findAuthor.get(r.author) as { id: number } | undefined;
      if (!author) {
        author = { id: Number(insertAuthor.run(r.author).lastInsertRowid) };
      }

      let pub = findPublisher.get(r.publisher) as { id: number } | undefined;
      if (!pub) {
        pub = { id: Number(insertPublisher.run(r.publisher).lastInsertRowid) };
      }

      // Resolve existing copy if UPDATE
      const existingCopy = findCopyByAcc.get(r.accessionNumber) as { id: number; book_id: number } | undefined;
      if (existingCopy && validation.action === 'UPDATE') {
        updateCopy.run(
          r.acquisitionDate,
          r.purchasePrice,
          r.shelfNumber,
          r.rackNumber,
          r.physicalCondition,
          r.status,
          existingCopy.id
        );
        updateBook.run(
          r.title,
          author.id,
          pub.id,
          r.edition,
          r.publicationYear,
          r.subject,
          cat.id,
          existingCopy.book_id
        );
        importedCount += 1;
        continue;
      }

      // Resolve or insert book title
      let book: { id: number; book_code: string } | undefined;
      if (r.isbn) {
        book = findBookByIsbn.get(r.isbn) as { id: number; book_code: string } | undefined;
      }
      if (!book && r.bookCode) {
        book = findBookByCode.get(r.bookCode) as { id: number; book_code: string } | undefined;
      }
      if (!book) {
        book = findBookByTitleAuthor.get(r.title, author.id) as { id: number; book_code: string } | undefined;
      }

      if (!book) {
        const bookCode =
          r.bookCode && !findBookByCode.get(r.bookCode)
            ? r.bookCode
            : `CE-IMP-${Date.now().toString(36).toUpperCase()}-${r.rowNumber}`;
        const insertedBookId = Number(
          insertBook.run(
            bookCode,
            r.isbn || null,
            r.title,
            author.id,
            pub.id,
            r.edition,
            r.publicationYear,
            r.subject,
            cat.id
          ).lastInsertRowid
        );
        book = { id: insertedBookId, book_code: bookCode };
      } else if (validation.action === 'UPDATE') {
        updateBook.run(
          r.title,
          author.id,
          pub.id,
          r.edition,
          r.publicationYear,
          r.subject,
          cat.id,
          book.id
        );
      }

      const nextCopyNo = ((countCopiesForBook.get(book.id) as { c: number }).c || 0) + 1;
      const newCopyId = Number(
        insertCopy.run(
          r.accessionNumber,
          book.id,
          nextCopyNo,
          r.acquisitionDate,
          r.purchasePrice,
          r.shelfNumber,
          r.rackNumber,
          r.physicalCondition,
          r.status
        ).lastInsertRowid
      );

      insertBarcode.run(newCopyId, 'CODE128', r.accessionNumber);
      insertQr.run(
        newCopyId,
        buildQrPayload({
          accessionNumber: r.accessionNumber,
          bookCode: book.book_code,
          copyNumber: nextCopyNo,
        })
      );
      importedCount += 1;
    }

    const jobId = Number(
      db
        .prepare(
          `INSERT INTO import_jobs (file_name, sheet_name, duplicate_mode, total_rows, imported_rows, skipped_rows, error_rows, uploaded_by_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          params.fileName,
          params.sheetName,
          params.duplicateMode,
          params.validatedRows.length,
          importedCount,
          skippedCount,
          errorCount,
          params.uploadedById
        ).lastInsertRowid
    );

    const insertImportErr = db.prepare(
      'INSERT INTO import_errors (import_job_id, row_number, field_name, reason, raw_payload) VALUES (?, ?, ?, ?, ?)'
    );
    for (const e of errorRecords) {
      insertImportErr.run(jobId, e.rowNumber, e.field, e.reason, e.raw);
    }

    return {
      jobId,
      totalRows: params.validatedRows.length,
      importedRows: importedCount,
      skippedRows: skippedCount,
      errorRows: errorCount,
    };
  });
}

function styleInstitutionalSheet(
  ws: ExcelJS.Worksheet,
  reportTitle: string,
  headers: Array<{ header: string; key: string; width: number; numFmt?: string }>
) {
  ws.mergeCells(1, 1, 1, headers.length);
  ws.getCell(1, 1).value = 'HALDIA INSTITUTE OF TECHNOLOGY';
  ws.getCell(1, 1).font = { name: 'Calibri', size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F294D' } };
  ws.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 28;

  ws.mergeCells(2, 1, 2, headers.length);
  ws.getCell(2, 1).value = `DEPARTMENT OF CIVIL ENGINEERING – ${reportTitle.toUpperCase()}`;
  ws.getCell(2, 1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0F294D' } };
  ws.getCell(2, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  ws.getCell(2, 1).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 22;

  ws.mergeCells(3, 1, 3, headers.length);
  ws.getCell(3, 1).value = `Generated on ${new Date().toLocaleString('en-IN')} | Haldia, West Bengal, India`;
  ws.getCell(3, 1).font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF475569' } };
  ws.getCell(3, 1).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(3).height = 18;

  const headerRow = ws.getRow(4);
  headers.forEach((h, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = h.header;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    cell.alignment = { horizontal: 'left', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'medium', color: { argb: 'FF0F294D' } },
    };
    ws.getColumn(idx + 1).width = h.width;
    if (h.numFmt) {
      ws.getColumn(idx + 1).numFmt = h.numFmt;
    }
  });
  headerRow.height = 24;

  ws.views = [{ state: 'frozen', ySplit: 4 }];
  ws.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4, column: headers.length },
  };
}

export async function generateImportTemplateWorkbook(type: 'inventory' | 'students' | 'faculty'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HIT Civil Engineering Digital Library';
  wb.created = new Date();

  if (type === 'inventory') {
    const ws = wb.addWorksheet('Inventory Import Template');
    const cols = [
      { header: 'Book ID', key: 'bookCode', width: 14 },
      { header: 'Accession Number', key: 'accessionNumber', width: 22 },
      { header: 'ISBN', key: 'isbn', width: 20 },
      { header: 'Book Title', key: 'title', width: 38 },
      { header: 'Author', key: 'author', width: 24 },
      { header: 'Publisher', key: 'publisher', width: 24 },
      { header: 'Edition', key: 'edition', width: 14 },
      { header: 'Publication Year', key: 'publicationYear', width: 16 },
      { header: 'Category', key: 'category', width: 26 },
      { header: 'Subject', key: 'subject', width: 24 },
      { header: 'Acquisition Date', key: 'acquisitionDate', width: 16 },
      { header: 'Purchase Price', key: 'purchasePrice', width: 16 },
      { header: 'Shelf Number', key: 'shelfNumber', width: 14 },
      { header: 'Rack Number', key: 'rackNumber', width: 14 },
      { header: 'Physical Condition', key: 'physicalCondition', width: 18 },
      { header: 'Status', key: 'status', width: 16 },
    ];
    ws.columns = cols;
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F294D' } };
    ws.addRow({
      bookCode: 'CE-NEW-001',
      accessionNumber: 'HIT-CE-2026-0901',
      isbn: '978-81-203-9101-1',
      title: 'Advanced Design of Concrete Bridges',
      author: 'Dr. N. Krishna Raju',
      publisher: 'Oxford & IBH',
      edition: '5th Edition',
      publicationYear: 2025,
      category: 'Bridge Engineering',
      subject: 'Bridge Superstructures',
      acquisitionDate: '2026-04-10',
      purchasePrice: 950,
      shelfNumber: 'S-04',
      rackNumber: 'R-02',
      physicalCondition: 'New',
      status: 'AVAILABLE',
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  } else if (type === 'students') {
    const ws = wb.addWorksheet('Students Import Template');
    ws.columns = [
      { header: 'Registration Number', key: 'registrationNumber', width: 22 },
      { header: 'Student Name', key: 'fullName', width: 28 },
      { header: 'Programme', key: 'programme', width: 28 },
      { header: 'Semester', key: 'semester', width: 12 },
      { header: 'Academic Session', key: 'academicSession', width: 18 },
      { header: 'Email', key: 'email', width: 32 },
      { header: 'Phone', key: 'phone', width: 18 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F294D' } };
    ws.addRow({
      registrationNumber: 'HIT/CE/2026/101',
      fullName: 'Abhishek Sen',
      programme: 'B.Tech Civil Engineering',
      semester: 4,
      academicSession: '2025-2029',
      email: 'abhishek.sen.sample@hithaldia.edu.in',
      phone: '+91-98300-00101',
    });
  } else {
    const ws = wb.addWorksheet('Faculty Import Template');
    ws.columns = [
      { header: 'Employee ID', key: 'employeeId', width: 20 },
      { header: 'Name', key: 'fullName', width: 28 },
      { header: 'Designation', key: 'designation', width: 30 },
      { header: 'Email', key: 'email', width: 32 },
      { header: 'Phone', key: 'phone', width: 18 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F294D' } };
    ws.addRow({
      employeeId: 'HIT-FAC-CE-021',
      fullName: 'Dr. Partha Sarathi Roy',
      designation: 'Associate Professor (Hydraulics)',
      email: 'partha.roy.sample@hithaldia.edu.in',
      phone: '+91-94340-20021',
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function generateImportErrorReportWorkbook(
  errors: Array<{ rowNumber: number; accessionNumber: string; title: string; errors: string }>
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Import Validation Errors');
  const headers = [
    { header: 'Excel Row #', key: 'rowNumber', width: 14 },
    { header: 'Accession Number', key: 'accessionNumber', width: 22 },
    { header: 'Book Title', key: 'title', width: 36 },
    { header: 'Validation Error Reasons', key: 'errors', width: 65 },
  ];
  styleInstitutionalSheet(ws, 'Excel Import Validation Error Report', headers);
  errors.forEach((e) => {
    ws.addRow([e.rowNumber, e.accessionNumber, e.title, e.errors]);
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function generateExportWorkbook(
  dataset: string,
  filters: { year?: string; category?: string; status?: string; fromDate?: string; toDate?: string }
): Promise<{ buffer: Buffer; filename: string }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HIT Civil Engineering – Digital Library';
  wb.created = new Date();

  const dateStamp = new Date().toISOString().slice(0, 10);

  if (dataset === 'catalogue') {
    const ws = wb.addWorksheet('Book Catalogue');
    const headers = [
      { header: 'Book ID', key: 'book_code', width: 14 },
      { header: 'ISBN', key: 'isbn', width: 20 },
      { header: 'Title', key: 'title', width: 42 },
      { header: 'Author', key: 'author', width: 24 },
      { header: 'Publisher', key: 'publisher', width: 24 },
      { header: 'Edition', key: 'edition', width: 14 },
      { header: 'Year', key: 'publication_year', width: 10 },
      { header: 'Category', key: 'category', width: 26 },
      { header: 'Subject', key: 'subject', width: 24 },
      { header: 'Total Copies', key: 'total_copies', width: 14 },
      { header: 'Available', key: 'available_copies', width: 12 },
    ];
    styleInstitutionalSheet(ws, 'Complete Book Catalogue', headers);
    const params: unknown[] = [];
    let where = 'WHERE 1=1';
    if (filters.category) {
      where += ' AND c.name = ?';
      params.push(filters.category);
    }
    if (filters.year) {
      where += ' AND b.publication_year = ?';
      params.push(Number(filters.year));
    }
    const rows = db
      .prepare(
        `SELECT b.book_code, b.isbn, b.title, a.name as author, p.name as publisher,
                b.edition, b.publication_year, c.name as category, b.subject,
                (SELECT COUNT(*) FROM book_copies bc WHERE bc.book_id = b.id) as total_copies,
                (SELECT COUNT(*) FROM book_copies bc WHERE bc.book_id = b.id AND bc.status = 'AVAILABLE') as available_copies
         FROM books b
         JOIN authors a ON a.id = b.author_id
         JOIN publishers p ON p.id = b.publisher_id
         JOIN categories c ON c.id = b.category_id
         ${where}
         ORDER BY b.book_code ASC`
      )
      .all(...(params as string[])) as Record<string, unknown>[];
    rows.forEach((r) => ws.addRow(headers.map((h) => r[h.key])));
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename: `HIT-CE-Book-Catalogue-${dateStamp}.xlsx` };
  }

  if (dataset === 'accession' || dataset === 'copies' || dataset === 'available' || dataset === 'acquisitions') {
    const titleMap: Record<string, string> = {
      accession: 'Book Accession Register',
      copies: 'Physical Copy Inventory',
      available: 'Available Physical Books',
      acquisitions: 'Acquisition & Purchase Register',
    };
    const ws = wb.addWorksheet(titleMap[dataset]);
    const headers = [
      { header: 'Accession Number', key: 'accession_number', width: 22 },
      { header: 'Book ID', key: 'book_code', width: 14 },
      { header: 'Copy #', key: 'copy_number', width: 10 },
      { header: 'ISBN', key: 'isbn', width: 20 },
      { header: 'Book Title', key: 'title', width: 40 },
      { header: 'Author', key: 'author', width: 24 },
      { header: 'Category', key: 'category', width: 26 },
      { header: 'Acquisition Date', key: 'acquisition_date', width: 16 },
      { header: 'Price (INR)', key: 'purchase_price_inr', width: 15, numFmt: '₹#,##0.00' },
      { header: 'Supplier', key: 'supplier', width: 24 },
      { header: 'Invoice No.', key: 'invoice_number', width: 20 },
      { header: 'Funding Source', key: 'funding_source', width: 24 },
      { header: 'Shelf', key: 'shelf_number', width: 10 },
      { header: 'Rack', key: 'rack_number', width: 10 },
      { header: 'Condition', key: 'physical_condition', width: 16 },
      { header: 'Status', key: 'status', width: 18 },
    ];
    styleInstitutionalSheet(ws, titleMap[dataset], headers);

    const params: unknown[] = [];
    let where = 'WHERE 1=1';
    if (dataset === 'available') {
      where += ` AND bc.status = 'AVAILABLE'`;
    } else if (filters.status) {
      where += ' AND bc.status = ?';
      params.push(filters.status);
    }
    if (filters.category) {
      where += ' AND c.name = ?';
      params.push(filters.category);
    }
    if (filters.year) {
      where += ' AND substr(bc.acquisition_date, 1, 4) = ?';
      params.push(filters.year);
    }
    if (filters.fromDate) {
      where += ' AND bc.acquisition_date >= ?';
      params.push(filters.fromDate);
    }
    if (filters.toDate) {
      where += ' AND bc.acquisition_date <= ?';
      params.push(filters.toDate);
    }

    const rows = db
      .prepare(
        `SELECT bc.accession_number, b.book_code, bc.copy_number, b.isbn, b.title, a.name as author,
                c.name as category, bc.acquisition_date, bc.purchase_price_inr, bc.supplier,
                bc.invoice_number, bc.funding_source, bc.shelf_number, bc.rack_number,
                bc.physical_condition, bc.status
         FROM book_copies bc
         JOIN books b ON b.id = bc.book_id
         JOIN authors a ON a.id = b.author_id
         JOIN categories c ON c.id = b.category_id
         ${where}
         ORDER BY bc.accession_number ASC`
      )
      .all(...(params as string[])) as Record<string, unknown>[];
    rows.forEach((r) => ws.addRow(headers.map((h) => r[h.key])));

    // Add summary worksheet for Accession Register
    const summaryWs = wb.addWorksheet('Summary');
    styleInstitutionalSheet(summaryWs, 'Inventory Summary', [
      { header: 'Metric', key: 'metric', width: 32 },
      { header: 'Value', key: 'val', width: 20 },
    ]);
    const totalValue = rows.reduce((acc, r) => acc + Number(r.purchase_price_inr || 0), 0);
    summaryWs.addRow(['Total Copies Exported', rows.length]);
    summaryWs.addRow(['Total Asset Valuation (INR)', `₹${totalValue.toFixed(2)}`]);
    summaryWs.addRow(['Available Copies', rows.filter((r) => r.status === 'AVAILABLE').length]);
    summaryWs.addRow(['Issued Copies', rows.filter((r) => r.status === 'ISSUED').length]);

    return {
      buffer: Buffer.from(await wb.xlsx.writeBuffer()),
      filename: `HIT-CE-${dataset}-${dateStamp}.xlsx`,
    };
  }

  if (dataset === 'issued' || dataset === 'overdue' || dataset === 'student-history' || dataset === 'faculty-history') {
    const titleMap: Record<string, string> = {
      issued: 'Currently Issued Books Register',
      overdue: 'Overdue Books Register',
      'student-history': 'Student Borrowing History',
      'faculty-history': 'Faculty Borrowing History',
    };
    const ws = wb.addWorksheet(titleMap[dataset]);
    const headers = [
      { header: 'Receipt No.', key: 'receipt_no', width: 18 },
      { header: 'Accession Number', key: 'accession_number', width: 22 },
      { header: 'Book Title', key: 'title', width: 38 },
      { header: 'Borrower Name', key: 'borrower_name', width: 26 },
      { header: 'Member ID', key: 'member_code', width: 20 },
      { header: 'Role', key: 'borrower_role', width: 12 },
      { header: 'Issue Date', key: 'issue_date', width: 16 },
      { header: 'Due Date', key: 'due_date', width: 16 },
      { header: 'Return Date', key: 'return_date', width: 16 },
      { header: 'Status', key: 'status', width: 14 },
    ];
    styleInstitutionalSheet(ws, titleMap[dataset], headers);

    const params: unknown[] = [];
    let where = 'WHERE 1=1';
    if (dataset === 'issued') {
      where += ` AND bi.status IN ('ISSUED', 'OVERDUE')`;
    } else if (dataset === 'overdue') {
      where += ` AND (bi.status = 'OVERDUE' OR (bi.status = 'ISSUED' AND datetime(bi.due_date) < datetime('now')))`;
    } else if (dataset === 'student-history') {
      where += ` AND r.name = 'STUDENT'`;
    } else if (dataset === 'faculty-history') {
      where += ` AND r.name = 'FACULTY'`;
    }
    if (filters.fromDate) {
      where += ' AND substr(bi.issue_date, 1, 10) >= ?';
      params.push(filters.fromDate);
    }
    if (filters.toDate) {
      where += ' AND substr(bi.issue_date, 1, 10) <= ?';
      params.push(filters.toDate);
    }

    const rows = db
      .prepare(
        `SELECT bi.receipt_no, bc.accession_number, b.title, u.full_name as borrower_name,
                COALESCE(s.registration_number, f.employee_id, u.email) as member_code,
                r.name as borrower_role, substr(bi.issue_date, 1, 10) as issue_date,
                substr(bi.due_date, 1, 10) as due_date, substr(br.return_date, 1, 10) as return_date, bi.status
         FROM book_issues bi
         JOIN book_copies bc ON bc.id = bi.book_copy_id
         JOIN books b ON b.id = bc.book_id
         JOIN users u ON u.id = bi.borrower_id
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN students s ON s.user_id = u.id
         LEFT JOIN faculty f ON f.user_id = u.id
         LEFT JOIN book_returns br ON br.book_issue_id = bi.id
         ${where}
         ORDER BY bi.issue_date DESC`
      )
      .all(...(params as string[])) as Record<string, unknown>[];
    rows.forEach((r) => ws.addRow(headers.map((h) => r[h.key] ?? '—')));
    return {
      buffer: Buffer.from(await wb.xlsx.writeBuffer()),
      filename: `HIT-CE-${dataset}-${dateStamp}.xlsx`,
    };
  }

  if (dataset === 'fines') {
    const ws = wb.addWorksheet('Fine Collection Register');
    const headers = [
      { header: 'Fine ID', key: 'id', width: 10 },
      { header: 'Borrower', key: 'full_name', width: 26 },
      { header: 'Member ID', key: 'member_code', width: 20 },
      { header: 'Accession No.', key: 'accession_number', width: 22 },
      { header: 'Overdue Days', key: 'overdue_days', width: 14 },
      { header: 'Total Fine (INR)', key: 'amount_inr', width: 16, numFmt: '₹#,##0.00' },
      { header: 'Paid (INR)', key: 'paid_amount_inr', width: 16, numFmt: '₹#,##0.00' },
      { header: 'Waived (INR)', key: 'waived_amount_inr', width: 16, numFmt: '₹#,##0.00' },
      { header: 'Status', key: 'status', width: 16 },
    ];
    styleInstitutionalSheet(ws, 'Fine Collection Register (INR)', headers);
    const rows = db
      .prepare(
        `SELECT fn.id, u.full_name, COALESCE(s.registration_number, f.employee_id, u.email) as member_code,
                bc.accession_number, fn.overdue_days, fn.amount_inr, fn.paid_amount_inr, fn.waived_amount_inr, fn.status
         FROM fines fn
         JOIN users u ON u.id = fn.user_id
         LEFT JOIN students s ON s.user_id = u.id
         LEFT JOIN faculty f ON f.user_id = u.id
         JOIN book_issues bi ON bi.id = fn.book_issue_id
         JOIN book_copies bc ON bc.id = bi.book_copy_id
         ORDER BY fn.created_at DESC`
      )
      .all() as Record<string, unknown>[];
    rows.forEach((r) => ws.addRow(headers.map((h) => r[h.key])));
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename: `HIT-CE-Fine-Collection-${dateStamp}.xlsx` };
  }

  // Digital resources export
  const ws = wb.addWorksheet('Digital Resources');
  const headers = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Title', key: 'title', width: 42 },
    { header: 'Author', key: 'author', width: 26 },
    { header: 'Category', key: 'category', width: 24 },
    { header: 'Subject', key: 'subject', width: 24 },
    { header: 'Semester', key: 'semester', width: 16 },
    { header: 'Academic Year', key: 'academic_year', width: 16 },
    { header: 'Downloads', key: 'download_count', width: 12 },
  ];
  styleInstitutionalSheet(ws, 'Digital Library Repository Index', headers);
  const rows = db
    .prepare(
      'SELECT id, title, author, category, subject, semester, academic_year, download_count FROM digital_resources ORDER BY created_at DESC'
    )
    .all() as Record<string, unknown>[];
  rows.forEach((r) => ws.addRow(headers.map((h) => r[h.key])));
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename: `HIT-CE-Digital-Resources-${dateStamp}.xlsx` };
}
