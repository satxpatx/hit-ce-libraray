import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Upload,
} from 'lucide-react';
import { apiDownload, apiFetch, formatDateTime } from '../lib/api';

const TARGET_FIELDS = [
  { key: 'bookCode', label: 'Book ID' },
  { key: 'accessionNumber', label: 'Accession Number *' },
  { key: 'isbn', label: 'ISBN' },
  { key: 'title', label: 'Book Title *' },
  { key: 'author', label: 'Author *' },
  { key: 'publisher', label: 'Publisher' },
  { key: 'edition', label: 'Edition' },
  { key: 'publicationYear', label: 'Publication Year' },
  { key: 'category', label: 'Category *' },
  { key: 'subject', label: 'Subject' },
  { key: 'acquisitionDate', label: 'Acquisition Date' },
  { key: 'purchasePrice', label: 'Purchase Price (INR)' },
  { key: 'shelfNumber', label: 'Shelf Number' },
  { key: 'rackNumber', label: 'Rack Number' },
  { key: 'physicalCondition', label: 'Physical Condition' },
  { key: 'status', label: 'Status' },
];

const EXPORT_DATASETS = [
  { key: 'catalogue', label: 'Complete Book Catalogue', desc: 'All titles with ISBN, author, publisher, category, and availability' },
  { key: 'accession', label: 'Book Accession Register', desc: 'Complete physical copy register with acquisition prices (INR) & summary sheet' },
  { key: 'copies', label: 'Physical Copy Inventory', desc: 'Every accessioned physical copy with shelf, rack, condition, and status' },
  { key: 'available', label: 'Available Books Inventory', desc: 'Currently shelf-available physical copies ready for issue' },
  { key: 'issued', label: 'Currently Issued Books', desc: 'Active loans with borrower details and due dates' },
  { key: 'overdue', label: 'Overdue Books Register', desc: 'Loans past due date requiring member follow-up' },
  { key: 'student-history', label: 'Student Borrowing History', desc: 'Complete circulation history for Civil Engineering students' },
  { key: 'faculty-history', label: 'Faculty Borrowing History', desc: 'Complete circulation history for department faculty members' },
  { key: 'fines', label: 'Fine Collection Register (INR)', desc: 'Overdue fines assessed, collected, waived, and pending balances' },
  { key: 'acquisitions', label: 'Acquisition & Purchase Records', desc: 'Suppliers, invoices, funding sources, and purchase dates' },
  { key: 'digital', label: 'Digital Library Index', desc: 'Lecture notes, lab manuals, question papers, and download counts' },
];

export function ExcelView({ mode }: { mode: 'excel-import' | 'excel-export' }) {
  const [categories, setCategories] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Import Wizard State
  const [uploadMeta, setUploadMeta] = useState<any | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [duplicateMode, setDuplicateMode] = useState<'SKIP' | 'UPDATE' | 'ADD_COPY'>('SKIP');
  const [validationData, setValidationData] = useState<any | null>(null);
  const [importSummary, setImportSummary] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  // Export Filters
  const [expYear, setExpYear] = useState('');
  const [expCategory, setExpCategory] = useState('');
  const [expStatus, setExpStatus] = useState('');
  const [expFrom, setExpFrom] = useState('');
  const [expTo, setExpTo] = useState('');

  const loadMeta = async () => {
    try {
      const [tax, jobRes] = await Promise.all([apiFetch('/api/taxonomy'), apiFetch('/api/excel/jobs')]);
      setCategories(tax.categories || []);
      setJobs(jobRes.items || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadMeta();
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedback(null);
    setValidationData(null);
    setImportSummary(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiFetch('/api/excel/upload', { method: 'POST', body: form });
      setUploadMeta(res);
      setSheetName(res.activeSheet);
      setMapping(res.suggestedMapping || {});
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleValidate = async () => {
    if (!uploadMeta) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/excel/validate', {
        method: 'POST',
        body: JSON.stringify({
          uploadToken: uploadMeta.uploadToken,
          sheetName,
          mapping,
          duplicateMode,
        }),
      });
      setValidationData(res);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!uploadMeta) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/excel/confirm', {
        method: 'POST',
        body: JSON.stringify({
          uploadToken: uploadMeta.uploadToken,
          sheetName,
          mapping,
          duplicateMode,
        }),
      });
      setImportSummary(res);
      setUploadMeta(null);
      setValidationData(null);
      setFeedback({
        type: 'ok',
        text: `Import Job #${res.jobId} completed: ${res.importedRows} records imported, ${res.skippedRows} skipped, ${res.errorRows} errors.`,
      });
      await loadMeta();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadErrors = async () => {
    if (!uploadMeta) return;
    try {
      await apiDownload('/api/excel/error-report', 'HIT-CE-Import-Error-Report.xlsx', {
        method: 'POST',
        body: JSON.stringify({
          uploadToken: uploadMeta.uploadToken,
          sheetName,
          mapping,
          duplicateMode,
        }),
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleExport = async (dataset: string) => {
    const params = new URLSearchParams();
    if (expYear) params.set('year', expYear);
    if (expCategory) params.set('category', expCategory);
    if (expStatus) params.set('status', expStatus);
    if (expFrom) params.set('fromDate', expFrom);
    if (expTo) params.set('toDate', expTo);
    try {
      await apiDownload(`/api/excel/export/${dataset}?${params.toString()}`, `HIT-CE-${dataset}.xlsx`);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  if (mode === 'excel-export') {
    return (
      <div className="space-y-5">
        <div className="border-b border-slate-200 pb-4 dark:border-slate-800">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Formatted Institutional Excel Exports
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Generate styled XLSX workbooks with HIT Civil Engineering headers, frozen rows, auto-filters, and INR currency formatting.
          </p>
        </div>

        {feedback && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {feedback.text}
          </div>
        )}

        {/* Export Filter Bar */}
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500">Year Filter</label>
            <input
              value={expYear}
              onChange={(e) => setExpYear(e.target.value)}
              placeholder="e.g., 2026"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500">Category Filter</label>
            <select
              value={expCategory}
              onChange={(e) => setExpCategory(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500">Copy Status</label>
            <select
              value={expStatus}
              onChange={(e) => setExpStatus(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="">All Statuses</option>
              <option value="AVAILABLE">AVAILABLE</option>
              <option value="ISSUED">ISSUED</option>
              <option value="RESERVED">RESERVED</option>
              <option value="UNDER_MAINTENANCE">UNDER MAINTENANCE</option>
              <option value="LOST">LOST</option>
              <option value="DAMAGED">DAMAGED</option>
              <option value="WITHDRAWN">WITHDRAWN</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500">From Date</label>
            <input
              type="date"
              value={expFrom}
              onChange={(e) => setExpFrom(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500">To Date</label>
            <input
              type="date"
              value={expTo}
              onChange={(e) => setExpTo(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        </div>

        {/* 11 Export Cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {EXPORT_DATASETS.map((ds) => (
            <div
              key={ds.key}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                  <FileSpreadsheet className="h-4 w-4 text-[#0891b2]" />
                  <span>{ds.label}</span>
                </div>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{ds.desc}</p>
              </div>
              <button
                type="button"
                onClick={() => void handleExport(ds.key)}
                className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0f294d] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#173a6b]"
              >
                <Download className="h-3.5 w-3.5" />
                Download XLSX
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800 xl:flex-row xl:items-end">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Excel Inventory Migration & Bulk Import
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Supports XLSX, XLS, and CSV with worksheet selection, manual column mapping, duplicate accession detection, and error report downloads.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void apiDownload('/api/excel/template/inventory', 'HIT-CE-inventory-template.xlsx')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            Inventory Template
          </button>
          <button
            type="button"
            onClick={() => void apiDownload('/api/excel/template/students', 'HIT-CE-students-template.xlsx')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            Students Template
          </button>
          <button
            type="button"
            onClick={() => void apiDownload('/api/excel/template/faculty', 'HIT-CE-faculty-template.xlsx')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            Faculty Template
          </button>
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Step 1: Upload File */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              01. Upload Book Inventory Workbook (.xlsx, .xls, .csv)
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Existing accession numbers are never overwritten silently. Choose duplicate handling in Step 2.
            </p>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[#0f294d] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#173a6b]">
            <Upload className="h-4 w-4" />
            <span>{busy ? 'Reading File...' : 'Select Excel / CSV File'}</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>

        {importSummary && (
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <div>
              <strong>Import Completed (Job #{importSummary.jobId}):</strong> {importSummary.importedRows} valid rows imported, {importSummary.skippedRows} duplicates skipped, {importSummary.errorRows} invalid rows rejected.
            </div>
          </div>
        )}
      </div>

      {/* Step 2: Worksheet, Column Mapping & Duplicate Handling */}
      {uploadMeta && (
        <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                02. Map Columns & Configure Duplicate Handling — {uploadMeta.fileName}
              </h2>
              <p className="text-xs text-slate-500">
                Detected <strong className="font-mono">{uploadMeta.totalRows}</strong> rows across{' '}
                <strong className="font-mono">{uploadMeta.sheetNames.length}</strong> worksheet(s).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500">Worksheet</label>
                <select
                  value={sheetName}
                  onChange={(e) => setSheetName(e.target.value)}
                  className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                >
                  {uploadMeta.sheetNames.map((s: string) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500">Duplicate Handling</label>
                <select
                  value={duplicateMode}
                  onChange={(e) => setDuplicateMode(e.target.value as any)}
                  className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="SKIP">Skip duplicate Accession / ISBN rows</option>
                  <option value="UPDATE">Update existing book/copy metadata</option>
                  <option value="ADD_COPY">Import matching ISBN as additional physical copy</option>
                </select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TARGET_FIELDS.map((tf) => (
              <div key={tf.key}>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  {tf.label}
                </label>
                <select
                  value={mapping[tf.key] || ''}
                  onChange={(e) => setMapping({ ...mapping, [tf.key]: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="">— Not Mapped —</option>
                  {uploadMeta.headers.map((h: string) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleValidate()}
              className="rounded-lg bg-[#1d4ed8] px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
            >
              {busy ? 'Validating Rows...' : 'Validate & Preview Import'}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Validation Preview & Confirm */}
      {validationData && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                03. Validation Preview & Duplicate Detection
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-3 font-mono text-xs">
                <span>Total: {validationData.summary.total}</span>
                <span className="text-emerald-700 dark:text-emerald-400">
                  Import: {validationData.summary.toImport + validationData.summary.toUpdate + validationData.summary.toAddCopy}
                </span>
                <span className="text-amber-700 dark:text-amber-400">Skip: {validationData.summary.toSkip}</span>
                <span className="text-red-600 dark:text-red-400">Errors: {validationData.summary.invalid}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {validationData.summary.invalid > 0 && (
                <button
                  type="button"
                  onClick={() => void handleDownloadErrors()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
                >
                  <AlertCircle className="h-3.5 w-3.5" />
                  Download Error Report (.xlsx)
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleConfirmImport()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f294d] px-4 py-2 text-xs font-semibold text-white hover:bg-[#173a6b] disabled:opacity-60"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Confirm & Import Valid Rows
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 font-semibold text-slate-600 dark:bg-slate-950 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2">Row #</th>
                  <th className="px-3 py-2">Accession No.</th>
                  <th className="px-3 py-2">Book Title</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Validation Notes / Error Reasons</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {validationData.previewRows.map((r: any, idx: number) => (
                  <tr
                    key={idx}
                    className={
                      r.validation.action === 'ERROR'
                        ? 'bg-red-50/60 dark:bg-red-950/20'
                        : r.validation.action === 'SKIP'
                        ? 'bg-amber-50/40 dark:bg-amber-950/20'
                        : ''
                    }
                  >
                    <td className="px-3 py-2 font-mono">{r.normalized.rowNumber}</td>
                    <td className="px-3 py-2 font-mono font-semibold">{r.normalized.accessionNumber || '—'}</td>
                    <td className="px-3 py-2 font-medium">{r.normalized.title || '—'}</td>
                    <td className="px-3 py-2">{r.normalized.category || '—'}</td>
                    <td className="px-3 py-2 font-bold">
                      <span
                        className={
                          r.validation.action === 'ERROR'
                            ? 'text-red-600 dark:text-red-400'
                            : r.validation.action === 'SKIP'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }
                      >
                        {r.validation.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px]">
                      {r.validation.errors.length > 0
                        ? r.validation.errors.map((e: any) => `${e.field}: ${e.reason}`).join(' | ')
                        : r.validation.warnings.join(' | ') || 'Valid'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Import History */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Excel Import Job History</h2>
        {jobs.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">No Excel import batches executed yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                  <th className="py-2 pr-4">File</th>
                  <th className="py-2 pr-4">Mode</th>
                  <th className="py-2 pr-4 text-right">Total</th>
                  <th className="py-2 pr-4 text-right">Imported</th>
                  <th className="py-2 pr-4 text-right">Skipped</th>
                  <th className="py-2 pr-4 text-right">Errors</th>
                  <th className="py-2">Uploaded By & Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="py-2 pr-4 font-medium">{j.file_name}</td>
                    <td className="py-2 pr-4 font-mono">{j.duplicate_mode}</td>
                    <td className="py-2 pr-4 text-right font-mono">{j.total_rows}</td>
                    <td className="py-2 pr-4 text-right font-mono text-emerald-700">{j.imported_rows}</td>
                    <td className="py-2 pr-4 text-right font-mono text-amber-700">{j.skipped_rows}</td>
                    <td className="py-2 pr-4 text-right font-mono text-red-600">{j.error_rows}</td>
                    <td className="py-2 text-slate-500">
                      {j.uploaded_by} · {formatDateTime(j.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
