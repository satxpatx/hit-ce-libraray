import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

function addInstitutionalHeader(doc: jsPDF, subtitle: string) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(15, 41, 77);
  doc.rect(0, 0, pageWidth, 26, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('HALDIA INSTITUTE OF TECHNOLOGY', pageWidth / 2, 10, { align: 'center' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('DEPARTMENT OF CIVIL ENGINEERING – DIGITAL LIBRARY', pageWidth / 2, 16.5, {
    align: 'center',
  });

  doc.setFontSize(8.5);
  doc.text('Haldia, West Bengal, India  |  Knowledge. Research. Innovation.', pageWidth / 2, 22, {
    align: 'center',
  });

  doc.setTextColor(15, 41, 77);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(subtitle.toUpperCase(), pageWidth / 2, 34, { align: 'center' });
  doc.setDrawColor(203, 213, 225);
  doc.line(14, 37, pageWidth - 14, 37);
}

export function generateIssueReceiptPdf(receipt: {
  receiptNo: string;
  accessionNumber: string;
  bookTitle: string;
  author?: string;
  borrowerName: string;
  borrowerMemberCode: string;
  borrowerRole: string;
  issueDate: string;
  dueDate: string;
  issuedBy: string;
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a5' });
  addInstitutionalHeader(doc, 'Book Issue Receipt');

  autoTable(doc, {
    startY: 42,
    theme: 'grid',
    headStyles: { fillColor: [15, 41, 77] },
    styles: { fontSize: 9, cellPadding: 3 },
    body: [
      ['Receipt Number', receipt.receiptNo],
      ['Accession Number', receipt.accessionNumber],
      ['Book Title', receipt.bookTitle],
      ['Author', receipt.author || '—'],
      ['Borrower Name', receipt.borrowerName],
      ['Member ID / Role', `${receipt.borrowerMemberCode} (${receipt.borrowerRole})`],
      ['Issue Date', receipt.issueDate.slice(0, 10)],
      ['Due Date', receipt.dueDate.slice(0, 10)],
      ['Issued By', receipt.issuedBy],
    ],
  });

  const finalY = (doc as any).lastAutoTable?.finalY || 130;
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text('Please return the copy on or before the due date to avoid overdue charges.', 14, finalY + 10);
  doc.text('Borrower Signature', 14, finalY + 26);
  doc.text('Librarian Signature', 100, finalY + 26);
  doc.save(`HIT-CE-Issue-${receipt.receiptNo}.pdf`);
}

export function generateReturnReceiptPdf(receipt: {
  returnReceipt: string;
  issueReceiptNo: string;
  accessionNumber: string;
  bookTitle: string;
  borrowerName: string;
  borrowerMemberCode: string;
  issueDate: string;
  dueDate: string;
  returnDate: string;
  overdueDays: number;
  fineAmountInr: number;
  processedBy: string;
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a5' });
  addInstitutionalHeader(doc, 'Book Return Receipt');

  autoTable(doc, {
    startY: 42,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 3 },
    body: [
      ['Return Receipt No.', receipt.returnReceipt],
      ['Original Issue Ref.', receipt.issueReceiptNo],
      ['Accession Number', receipt.accessionNumber],
      ['Book Title', receipt.bookTitle],
      ['Borrower', `${receipt.borrowerName} (${receipt.borrowerMemberCode})`],
      ['Issue Date', receipt.issueDate.slice(0, 10)],
      ['Due Date', receipt.dueDate.slice(0, 10)],
      ['Return Date', receipt.returnDate.slice(0, 10)],
      ['Overdue Duration', `${receipt.overdueDays} day(s)`],
      ['Fine Assessed (INR)', `INR ${receipt.fineAmountInr.toFixed(2)}`],
      ['Processed By', receipt.processedBy],
    ],
  });

  const finalY = (doc as any).lastAutoTable?.finalY || 140;
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text('Verified & Received by Departmental Library Counter', 14, finalY + 14);
  doc.text('Librarian Signature', 100, finalY + 24);
  doc.save(`HIT-CE-Return-${receipt.returnReceipt}.pdf`);
}

export function generateFineReceiptPdf(receipt: {
  receiptNumber: string;
  borrowerName: string;
  memberCode: string;
  accessionNumber: string;
  amountPaidInr: number;
  remainingBalanceInr: number;
  status: string;
  collectedBy: string;
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a5' });
  addInstitutionalHeader(doc, 'Library Fine Payment Receipt');

  autoTable(doc, {
    startY: 42,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 3 },
    body: [
      ['Payment Receipt No.', receipt.receiptNumber],
      ['Date', new Date().toLocaleDateString('en-IN')],
      ['Member Name', receipt.borrowerName],
      ['Member ID', receipt.memberCode],
      ['Book Accession No.', receipt.accessionNumber],
      ['Amount Paid (INR)', `INR ${receipt.amountPaidInr.toFixed(2)}`],
      ['Remaining Balance', `INR ${receipt.remainingBalanceInr.toFixed(2)}`],
      ['Payment Status', receipt.status],
      ['Collected By', receipt.collectedBy],
    ],
  });

  const finalY = (doc as any).lastAutoTable?.finalY || 135;
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text('Authorised Departmental Counter Seal & Signature', 14, finalY + 22);
  doc.save(`HIT-CE-Fine-${receipt.receiptNumber}.pdf`);
}

export function generateAccessionRegisterPdf(
  copies: Array<{
    accession_number: string;
    acquisition_date: string;
    title: string;
    author: string;
    publisher: string;
    edition?: string;
    publication_year?: number;
    purchase_price_inr: number;
    supplier?: string;
    invoice_number?: string;
    shelf_number: string;
    rack_number: string;
    status: string;
  }>
) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const printDate = new Date().toLocaleDateString('en-IN');

  autoTable(doc, {
    startY: 36,
    margin: { top: 36, bottom: 24, left: 10, right: 10 },
    head: [
      [
        'Acc. No.',
        'Acq. Date',
        'Book Title & Edition',
        'Author',
        'Publisher / Yr',
        'Price (INR)',
        'Supplier & Invoice',
        'Shelf/Rack',
        'Status',
        'Sign.',
      ],
    ],
    body: copies.map((c) => [
      c.accession_number,
      (c.acquisition_date || '').slice(0, 10),
      `${c.title}${c.edition ? ` (${c.edition})` : ''}`,
      c.author,
      `${c.publisher || '—'} / ${c.publication_year || '—'}`,
      Number(c.purchase_price_inr || 0).toFixed(2),
      `${c.supplier || '—'}\n${c.invoice_number || ''}`,
      `${c.shelf_number}/${c.rack_number}`,
      c.status,
      '',
    ]),
    styles: { fontSize: 7.5, cellPadding: 2, overflow: 'linebreak' },
    headStyles: { fillColor: [15, 41, 77], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    didDrawPage: (data) => {
      doc.setFillColor(15, 41, 77);
      doc.rect(0, 0, pageWidth, 24, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('HALDIA INSTITUTE OF TECHNOLOGY', pageWidth / 2, 9, { align: 'center' });
      doc.setFontSize(10);
      doc.text('DEPARTMENT OF CIVIL ENGINEERING – BOOK ACCESSION REGISTER', pageWidth / 2, 15.5, {
        align: 'center',
      });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(`Haldia, West Bengal, India  |  Printed on: ${printDate}`, pageWidth / 2, 21, {
        align: 'center',
      });

      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setTextColor(71, 85, 105);
      doc.setFontSize(8);
      doc.text('Librarian Signature: __________________________', 12, pageHeight - 10);
      doc.text('HOD (Civil Engineering): __________________________', 115, pageHeight - 10);
      doc.text(`Page ${data.pageNumber}`, pageWidth - 22, pageHeight - 10);
    },
  });

  doc.save(`HIT-CE-Book-Accession-Register-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function generateReportPdf(
  title: string,
  headers: string[],
  rows: Array<Array<string | number>>
) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  addInstitutionalHeader(doc, title);

  autoTable(doc, {
    startY: 42,
    head: [headers],
    body: rows.map((r) => r.map((cell) => String(cell ?? '—'))),
    headStyles: { fillColor: [15, 41, 77] },
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  doc.save(`HIT-CE-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
