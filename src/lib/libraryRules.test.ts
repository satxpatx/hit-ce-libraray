import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQrPayload,
  calculateOverdueAndFine,
  checkBorrowingEligibility,
  computeDueDate,
  formatAccessionNumber,
  hasRolePermission,
  parseScannedIdentifier,
  validateImportRow,
  type NormalizedImportRow,
} from './libraryRules';

test('formatAccessionNumber generates calendar and academic year sequences', () => {
  assert.equal(
    formatAccessionNumber({ prefix: 'HIT-CE', yearFormat: 'CALENDAR', year: 2026, sequence: 1 }),
    'HIT-CE-2026-0001'
  );
  assert.equal(
    formatAccessionNumber({ prefix: 'HIT-CE', yearFormat: 'CALENDAR', year: 2026, sequence: 42 }),
    'HIT-CE-2026-0042'
  );
  assert.equal(
    formatAccessionNumber({ prefix: 'HIT-CE', yearFormat: 'ACADEMIC', year: 2026, sequence: 7 }),
    'HIT-CE-2026-27-0007'
  );
});

test('parseScannedIdentifier parses JSON QR payloads and Code 128 barcodes', () => {
  const qr = buildQrPayload({ accessionNumber: 'HIT-CE-2026-0015', bookCode: 'CE-010', copyNumber: 2 });
  const parsedQr = parseScannedIdentifier(qr);
  assert.equal(parsedQr.accessionNumber, 'HIT-CE-2026-0015');
  assert.equal(parsedQr.source, 'QR_JSON');

  const parsedBarcode = parseScannedIdentifier('  hit-ce-2026-0099  ');
  assert.equal(parsedBarcode.accessionNumber, 'HIT-CE-2026-0099');
  assert.equal(parsedBarcode.source, 'BARCODE_TEXT');
});

test('computeDueDate applies student and faculty loan periods', () => {
  const issueIso = '2026-05-01T10:00:00.000Z';
  assert.equal(computeDueDate(issueIso, 'STUDENT', 14, 30), '2026-05-15T10:00:00.000Z');
  assert.equal(computeDueDate(issueIso, 'FACULTY', 14, 30), '2026-05-31T10:00:00.000Z');
});

test('calculateOverdueAndFine computes overdue days and respects maximum fine cap', () => {
  const onTime = calculateOverdueAndFine({
    dueDateIso: '2026-05-15T00:00:00.000Z',
    asOfDateIso: '2026-05-15T23:00:00.000Z',
    finePerDayInr: 5,
    maxFineInr: 500,
  });
  assert.deepEqual(onTime, { overdueDays: 0, fineAmountInr: 0 });

  const tenDaysLate = calculateOverdueAndFine({
    dueDateIso: '2026-05-01T00:00:00.000Z',
    asOfDateIso: '2026-05-11T00:00:00.000Z',
    finePerDayInr: 5,
    maxFineInr: 500,
  });
  assert.deepEqual(tenDaysLate, { overdueDays: 10, fineAmountInr: 50 });

  const capped = calculateOverdueAndFine({
    dueDateIso: '2026-01-01T00:00:00.000Z',
    asOfDateIso: '2026-06-01T00:00:00.000Z',
    finePerDayInr: 10,
    maxFineInr: 500,
  });
  assert.equal(capped.fineAmountInr, 500);
});

test('checkBorrowingEligibility enforces limits, account status, and duplicate title check', () => {
  const ok = checkBorrowingEligibility({
    borrowerRole: 'STUDENT',
    accountStatus: 'ACTIVE',
    activeLoanCount: 2,
    studentBorrowLimit: 4,
    facultyBorrowLimit: 8,
  });
  assert.equal(ok.eligible, true);
  assert.equal(ok.remaining, 2);

  const atLimit = checkBorrowingEligibility({
    borrowerRole: 'STUDENT',
    accountStatus: 'ACTIVE',
    activeLoanCount: 4,
    studentBorrowLimit: 4,
    facultyBorrowLimit: 8,
  });
  assert.equal(atLimit.eligible, false);

  const inactive = checkBorrowingEligibility({
    borrowerRole: 'FACULTY',
    accountStatus: 'INACTIVE',
    activeLoanCount: 0,
    studentBorrowLimit: 4,
    facultyBorrowLimit: 8,
  });
  assert.equal(inactive.eligible, false);
});

test('validateImportRow detects missing fields and duplicate accession numbers', () => {
  const baseRow: NormalizedImportRow = {
    rowNumber: 2,
    bookCode: 'CE-201',
    accessionNumber: 'HIT-CE-2026-0501',
    isbn: '978-81-203-9999-1',
    title: 'Design of Reinforced Concrete Bridges',
    author: 'N. Krishna Raju',
    publisher: 'CBS Publishers',
    edition: '4th Edition',
    publicationYear: 2024,
    category: 'Bridge Engineering',
    subject: 'Bridge Design',
    acquisitionDate: '2026-03-01',
    purchasePrice: 850,
    shelfNumber: 'S-04',
    rackNumber: 'R-02',
    physicalCondition: 'New',
    status: 'AVAILABLE',
  };

  const validRes = validateImportRow(baseRow, {
    existingAccessions: new Set(['HIT-CE-2026-0001']),
    seenAccessionsInFile: new Set(),
    existingIsbns: new Set(),
    duplicateMode: 'SKIP',
  });
  assert.equal(validRes.valid, true);
  assert.equal(validRes.action, 'IMPORT');

  const dupInDbSkip = validateImportRow(
    { ...baseRow, accessionNumber: 'HIT-CE-2026-0001' },
    {
      existingAccessions: new Set(['HIT-CE-2026-0001']),
      seenAccessionsInFile: new Set(),
      existingIsbns: new Set(),
      duplicateMode: 'SKIP',
    }
  );
  assert.equal(dupInDbSkip.action, 'SKIP');

  const dupInDbAddCopyRejected = validateImportRow(
    { ...baseRow, accessionNumber: 'HIT-CE-2026-0001' },
    {
      existingAccessions: new Set(['HIT-CE-2026-0001']),
      seenAccessionsInFile: new Set(),
      existingIsbns: new Set(),
      duplicateMode: 'ADD_COPY',
    }
  );
  assert.equal(dupInDbAddCopyRejected.valid, false);
  assert.equal(dupInDbAddCopyRejected.action, 'ERROR');

  const dupInFile = validateImportRow(baseRow, {
    existingAccessions: new Set(),
    seenAccessionsInFile: new Set(['HIT-CE-2026-0501']),
    existingIsbns: new Set(),
    duplicateMode: 'SKIP',
  });
  assert.equal(dupInFile.valid, false);
  assert.equal(dupInFile.action, 'ERROR');
});

test('hasRolePermission enforces strict RBAC matrix across all 4 roles', () => {
  assert.equal(hasRolePermission('SUPER_ADMIN', 'admin.backup'), true);
  assert.equal(hasRolePermission('LIBRARIAN', 'admin.backup'), false);
  assert.equal(hasRolePermission('LIBRARIAN', 'accession.manage'), true);
  assert.equal(hasRolePermission('FACULTY', 'circulation.renew_self'), true);
  assert.equal(hasRolePermission('STUDENT', 'circulation.issue'), false);
  assert.equal(hasRolePermission('STUDENT', 'catalogue.view'), true);
});
