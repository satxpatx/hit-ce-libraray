import React, { useEffect, useState } from 'react';
import {
  CheckSquare,
  Download,
  Edit3,
  FileText,
  History,
  Plus,
  Printer,
  QrCode,
  Search,
  Square,
  X,
} from 'lucide-react';
import { apiDownload, apiFetch, formatDate, formatInr, type InstitutionalBranding } from '../lib/api';
import { generateAccessionRegisterPdf } from '../lib/pdfGenerator';
import { BookCopyLabelCard } from '../components/BarcodeQr';

const COPY_STATUSES = [
  'AVAILABLE',
  'ISSUED',
  'RESERVED',
  'UNDER_MAINTENANCE',
  'LOST',
  'DAMAGED',
  'WITHDRAWN',
];

export function AccessionView({
  mode = 'accession',
  branding,
}: {
  mode: 'accession' | 'copies' | 'qr-generator' | 'label-printing';
  branding: InstitutionalBranding;
}) {
  const [copies, setCopies] = useState<any[]>([]);
  const [books, setBooks] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [nextPreview, setNextPreview] = useState('HIT-CE-2026-0151');
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Filters
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [year, setYear] = useState('');
  const [subject, setSubject] = useState('');

  // Selection for Bulk Label Printing
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [labelColumns, setLabelColumns] = useState<2 | 3>(3);
  const [compactLabels, setCompactLabels] = useState(false);

  // Modals
  const [showAddCopies, setShowAddCopies] = useState(false);
  const [editingCopy, setEditingCopy] = useState<any | null>(null);
  const [historyData, setHistoryData] = useState<{ copy: any; history: any[] } | null>(null);
  const [singleLabelCopy, setSingleLabelCopy] = useState<any | null>(null);

  const [addForm, setAddForm] = useState({
    bookId: '',
    quantity: '5',
    acquisitionDate: new Date().toISOString().slice(0, 10),
    purchasePriceInr: '850',
    supplier: 'Kolkata Academic Book House',
    invoiceNumber: 'INV-HIT-CE-2026-901',
    fundingSource: 'Departmental Annual Grant',
    shelfNumber: 'S-03',
    rackNumber: 'R-02',
    physicalCondition: 'New',
    remarks: '',
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '180' });
      if (q.trim()) params.set('q', q.trim());
      if (status) params.set('status', status);
      if (year) params.set('year', year);
      if (subject) params.set('subject', subject);

      const res = await apiFetch(`/api/copies?${params.toString()}`);
      setCopies(res.items || []);
      setTotal(res.total || 0);
      if (res.nextAccessionPreview) setNextPreview(res.nextAccessionPreview);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    Promise.all([apiFetch('/api/books?pageSize=200'), apiFetch('/api/taxonomy')])
      .then(([bRes, tRes]) => {
        setBooks(bRes.items || []);
        setCategories(tRes.categories || []);
        if (bRes.items?.[0]) {
          setAddForm((prev) => ({ ...prev, bookId: String(bRes.items[0].id) }));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void loadData(), 160);
    return () => clearTimeout(t);
  }, [q, status, year, subject]);

  const handleRegisterCopies = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await apiFetch('/api/copies', {
        method: 'POST',
        body: JSON.stringify({
          ...addForm,
          bookId: Number(addForm.bookId),
          quantity: Number(addForm.quantity),
          purchasePriceInr: Number(addForm.purchasePriceInr),
        }),
      });
      const accs = res.copies.map((c: any) => c.accessionNumber).join(', ');
      setFeedback({
        type: 'ok',
        text: `Registered ${res.copies.length} physical copy/copies with unique accession numbers: ${accs}`,
      });
      setShowAddCopies(false);
      await loadData();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleSaveCopyEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCopy) return;
    setFeedback(null);
    try {
      await apiFetch(`/api/copies/${editingCopy.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          acquisitionDate: editingCopy.acquisition_date,
          purchasePriceInr: Number(editingCopy.purchase_price_inr),
          supplier: editingCopy.supplier,
          invoiceNumber: editingCopy.invoice_number,
          fundingSource: editingCopy.funding_source,
          shelfNumber: editingCopy.shelf_number,
          rackNumber: editingCopy.rack_number,
          physicalCondition: editingCopy.physical_condition,
          status: editingCopy.status,
          remarks: editingCopy.remarks,
        }),
      });
      setFeedback({ type: 'ok', text: `Updated accession record ${editingCopy.accession_number}.` });
      setEditingCopy(null);
      await loadData();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const openCopyHistory = async (copyId: number) => {
    try {
      const res = await apiFetch(`/api/copies/${copyId}/history`);
      setHistoryData(res);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectTopN = (n: number) => {
    setSelectedIds(new Set(copies.slice(0, n).map((c) => c.id)));
  };

  const selectedCopies = copies.filter((c) => selectedIds.has(c.id));
  const labelCopiesToRender =
    selectedCopies.length > 0 ? selectedCopies : copies.slice(0, mode === 'label-printing' ? 12 : 9);

  const headingMap = {
    accession: 'Book Accession Register',
    copies: 'Physical Book Copies Inventory',
    'qr-generator': 'QR Code & Code 128 Barcode Generator',
    'label-printing': 'A4 Printable Barcode & QR Label Sheets',
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="no-print flex flex-col justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800 lg:flex-row lg:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {headingMap[mode]}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            <span className="font-mono font-semibold text-[#0f294d] dark:text-cyan-400">{total}</span> individual physical copies tracked · Next automatic accession number:{' '}
            <span className="font-mono font-semibold text-[#1d4ed8] dark:text-cyan-300">{nextPreview}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(mode === 'accession' || mode === 'copies') && (
            <>
              <button
                type="button"
                onClick={() => generateAccessionRegisterPdf(copies)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap shrink-0"
              >
                <FileText className="h-3.5 w-3.5" />
                Official Register PDF
              </button>
              <button
                type="button"
                onClick={() => void apiDownload('/api/excel/export/accession', 'HIT-CE-Accession-Register.xlsx')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                Export Excel
              </button>
              <button
                type="button"
                onClick={() => setShowAddCopies(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f294d] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#173a6b] whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                Register Physical Copies
              </button>
            </>
          )}

          {(mode === 'qr-generator' || mode === 'label-printing') && (
            <>
              <button
                type="button"
                onClick={() => selectTopN(12)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap shrink-0"
              >
                Select First 12
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap shrink-0"
              >
                Clear Selection ({selectedIds.size})
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f294d] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#173a6b] whitespace-nowrap shrink-0"
              >
                <Printer className="h-3.5 w-3.5" />
                Print A4 Label Sheet
              </button>
            </>
          )}
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className={`no-print flex items-center justify-between rounded-lg border px-4 py-3 text-sm ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Dismiss message">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="no-print grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-12">
        <div className="relative md:col-span-5">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search Accession Number (e.g. HIT-CE-2026-0001), ISBN, Title, Invoice..."
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
        <div className="md:col-span-2">
          <select
            aria-label="Filter by copy status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="">All Statuses</option>
            {COPY_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-3">
          <select
            aria-label="Filter by subject category"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="">All Subjects</option>
            {categories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <input
            type="text"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="Acq. Year (2026)"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>
      </div>

      {/* Mode: QR / Barcode Generator & Label Printing Sheet */}
      {mode === 'qr-generator' || mode === 'label-printing' ? (
        <div className="space-y-4">
          <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-4">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Label Sheet Layout:</span>
              <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setLabelColumns(2)}
                  className={`rounded-md px-2.5 py-1 font-medium ${
                    labelColumns === 2
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  2 Columns (Large)
                </button>
                <button
                  type="button"
                  onClick={() => setLabelColumns(3)}
                  className={`rounded-md px-2.5 py-1 font-medium ${
                    labelColumns === 3
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  3 Columns (Standard A4)
                </button>
              </div>
              <label className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={compactLabels}
                  onChange={(e) => setCompactLabels(e.target.checked)}
                />
                Compact Spine Dimensions
              </label>
            </div>
            <span className="text-slate-500">
              Showing {labelCopiesToRender.length} printable labels ({selectedCopies.length > 0 ? 'Selected' : 'Latest'})
            </span>
          </div>

          {/* Printable A4 Sheet */}
          <div
            className={`grid gap-3 ${
              labelColumns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
            }`}
          >
            {labelCopiesToRender.map((c) => (
              <BookCopyLabelCard
                key={c.id}
                accessionNumber={c.accession_number}
                bookTitle={c.title}
                qrPayload={c.qr_payload || c.accession_number}
                shelfNumber={c.shelf_number}
                rackNumber={c.rack_number}
                institutionName={branding.institutionName.toUpperCase()}
                departmentName={branding.departmentName.toUpperCase()}
                compact={compactLabels}
              />
            ))}
          </div>

          {/* Selector Table below labels */}
          <div className="no-print overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-4 py-3 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-300">
              Pick Specific Physical Copies to Include on Label Sheet
            </div>
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {copies.slice(0, 80).map((c) => {
                    const checked = selectedIds.has(c.id);
                    return (
                      <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-4 py-2">
                          <button
                            type="button"
                            onClick={() => toggleSelect(c.id)}
                            aria-label={`Select copy ${c.accession_number}`}
                            className="text-[#0f294d] dark:text-cyan-400"
                          >
                            {checked ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4 text-slate-400" />}
                          </button>
                        </td>
                        <td className="px-3 py-2 font-mono font-semibold">{c.accession_number}</td>
                        <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">{c.title}</td>
                        <td className="px-3 py-2 font-mono text-slate-500">
                          {c.shelf_number}/{c.rack_number}
                        </td>
                        <td className="px-3 py-2 font-semibold">{c.status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* Mode: Official Accession Register & Physical Copies Table */
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          {/* Print-Only Formal Institutional Header */}
          <div className="hidden print-only border-b-2 border-slate-900 p-4 text-center">
            <div className="text-base font-bold">HALDIA INSTITUTE OF TECHNOLOGY</div>
            <div className="text-sm font-semibold">DEPARTMENT OF CIVIL ENGINEERING</div>
            <div className="text-xs font-bold tracking-wide">BOOK ACCESSION REGISTER</div>
            <div className="mt-1 text-[10px]">Printed on {new Date().toLocaleDateString('en-IN')}</div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                  <th className="px-3.5 py-3">Accession No.</th>
                  <th className="px-3.5 py-3">Book Title & Author</th>
                  <th className="px-3.5 py-3">Acquisition & Invoice</th>
                  <th className="px-3.5 py-3 text-right">Price (INR)</th>
                  <th className="px-3.5 py-3">Shelf / Rack</th>
                  <th className="px-3.5 py-3">Condition & Status</th>
                  <th className="no-print px-3.5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                      Loading Accession Register...
                    </td>
                  </tr>
                ) : copies.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                      No physical book copies match your filter criteria.
                    </td>
                  </tr>
                ) : (
                  copies.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                      <td className="px-3.5 py-3 align-top">
                        <div className="font-mono font-bold text-[#0f294d] dark:text-cyan-400">
                          {c.accession_number}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                          {c.book_code} · Copy #{c.copy_number}
                        </div>
                      </td>
                      <td className="px-3.5 py-3 align-top">
                        <div className="font-semibold text-slate-900 dark:text-white">{c.title}</div>
                        <div className="mt-0.5 text-slate-500">
                          {c.author} · {c.category}
                        </div>
                      </td>
                      <td className="px-3.5 py-3 align-top">
                        <div className="font-mono text-slate-800 dark:text-slate-200">
                          {formatDate(c.acquisition_date)}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {c.supplier || '—'} · {c.invoice_number || 'No Inv.'}
                        </div>
                      </td>
                      <td className="px-3.5 py-3 align-top text-right font-mono font-medium text-slate-800 dark:text-slate-200">
                        {formatInr(c.purchase_price_inr)}
                      </td>
                      <td className="px-3.5 py-3 align-top font-mono text-slate-700 dark:text-slate-300">
                        {c.shelf_number} / {c.rack_number}
                      </td>
                      <td className="px-3.5 py-3 align-top">
                        <div
                          className={`font-semibold ${
                            c.status === 'AVAILABLE'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : c.status === 'ISSUED'
                              ? 'text-[#1d4ed8] dark:text-blue-400'
                              : c.status === 'LOST' || c.status === 'DAMAGED'
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {c.status.replace('_', ' ')}
                        </div>
                        <div className="text-[11px] text-slate-500">{c.physical_condition}</div>
                      </td>
                      <td className="no-print px-3.5 py-3 align-top text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setSingleLabelCopy(c)}
                            aria-label={`View QR and Barcode label for ${c.accession_number}`}
                            className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            <QrCode className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void openCopyHistory(c.id)}
                            aria-label={`View circulation history for ${c.accession_number}`}
                            className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            <History className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingCopy({ ...c })}
                            aria-label={`Edit copy ${c.accession_number}`}
                            className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Register Single / Multiple Physical Copies */}
      {showAddCopies && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  Register Physical Book Copies (Accession Register)
                </h2>
                <p className="text-xs text-slate-500">
                  Next auto-generated sequence starts at <span className="font-mono font-semibold">{nextPreview}</span>
                </p>
              </div>
              <button type="button" onClick={() => setShowAddCopies(false)} aria-label="Close register copies modal">
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>

            <form onSubmit={handleRegisterCopies} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Select Book Title *
                </label>
                <select
                  required
                  value={addForm.bookId}
                  onChange={(e) => setAddForm({ ...addForm, bookId: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                >
                  {books.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.book_code} — {b.title} ({b.author})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Number of Physical Copies *
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  max={50}
                  value={addForm.quantity}
                  onChange={(e) => setAddForm({ ...addForm, quantity: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Acquisition Date *
                </label>
                <input
                  type="date"
                  required
                  value={addForm.acquisitionDate}
                  onChange={(e) => setAddForm({ ...addForm, acquisitionDate: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Purchase Price (INR) *
                </label>
                <input
                  type="number"
                  required
                  min={0}
                  step="0.01"
                  value={addForm.purchasePriceInr}
                  onChange={(e) => setAddForm({ ...addForm, purchasePriceInr: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Supplier</label>
                <input
                  value={addForm.supplier}
                  onChange={(e) => setAddForm({ ...addForm, supplier: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Invoice Number</label>
                <input
                  value={addForm.invoiceNumber}
                  onChange={(e) => setAddForm({ ...addForm, invoiceNumber: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Funding Source</label>
                <input
                  value={addForm.fundingSource}
                  onChange={(e) => setAddForm({ ...addForm, fundingSource: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Shelf Number *</label>
                <input
                  required
                  value={addForm.shelfNumber}
                  onChange={(e) => setAddForm({ ...addForm, shelfNumber: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Rack Number *</label>
                <input
                  required
                  value={addForm.rackNumber}
                  onChange={(e) => setAddForm({ ...addForm, rackNumber: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Remarks</label>
                <input
                  value={addForm.remarks}
                  onChange={(e) => setAddForm({ ...addForm, remarks: e.target.value })}
                  placeholder="Optional procurement notes"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div className="flex justify-end gap-2 sm:col-span-2">
                <button
                  type="button"
                  onClick={() => setShowAddCopies(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold dark:border-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[#0f294d] px-4 py-2 text-xs font-semibold text-white hover:bg-[#173a6b]"
                >
                  Generate Accession Numbers & Register
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Copy (Non-destructive; accession number immutable) */}
      {editingCopy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Edit Copy {editingCopy.accession_number}
                </h2>
                <p className="text-xs text-slate-500">
                  Accession numbers are permanent and never deleted. Use Withdrawn for retired copies.
                </p>
              </div>
              <button type="button" onClick={() => setEditingCopy(null)} aria-label="Close edit copy modal">
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            <form onSubmit={handleSaveCopyEdit} className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold">Status</label>
                <select
                  value={editingCopy.status}
                  onChange={(e) => setEditingCopy({ ...editingCopy, status: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                >
                  {COPY_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold">Physical Condition</label>
                <input
                  value={editingCopy.physical_condition || ''}
                  onChange={(e) => setEditingCopy({ ...editingCopy, physical_condition: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold">Shelf Number</label>
                <input
                  value={editingCopy.shelf_number || ''}
                  onChange={(e) => setEditingCopy({ ...editingCopy, shelf_number: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold">Rack Number</label>
                <input
                  value={editingCopy.rack_number || ''}
                  onChange={(e) => setEditingCopy({ ...editingCopy, rack_number: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold">Remarks</label>
                <input
                  value={editingCopy.remarks || ''}
                  onChange={(e) => setEditingCopy({ ...editingCopy, remarks: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div className="col-span-2 flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingCopy(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold dark:border-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[#0f294d] px-4 py-2 text-xs font-semibold text-white"
                >
                  Save Copy Details
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Individual Label Preview */}
      {singleLabelCopy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Individual Copy Label: {singleLabelCopy.accession_number}
              </h2>
              <button type="button" onClick={() => setSingleLabelCopy(null)} aria-label="Close label modal">
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>
            <BookCopyLabelCard
              accessionNumber={singleLabelCopy.accession_number}
              bookTitle={singleLabelCopy.title}
              qrPayload={singleLabelCopy.qr_payload || singleLabelCopy.accession_number}
              shelfNumber={singleLabelCopy.shelf_number}
              rackNumber={singleLabelCopy.rack_number}
              institutionName={branding.institutionName.toUpperCase()}
              departmentName={branding.departmentName.toUpperCase()}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f294d] px-4 py-2 text-xs font-semibold text-white"
              >
                <Printer className="h-3.5 w-3.5" />
                Print Label
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Copy History */}
      {historyData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Physical Copy History · {historyData.copy.accession_number}
                </h2>
                <p className="text-xs text-slate-500">{historyData.copy.title}</p>
              </div>
              <button type="button" onClick={() => setHistoryData(null)} aria-label="Close history modal">
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            {historyData.history.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                This copy has not been circulated yet.
              </p>
            ) : (
              <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
                {historyData.history.map((h: any) => (
                  <div key={h.id} className="flex items-center justify-between gap-3 py-3 text-xs">
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {h.borrower_name} ({h.member_code})
                      </div>
                      <div className="mt-0.5 font-mono text-slate-500">
                        Receipt {h.receipt_no} · Issued {formatDate(h.issue_date)} · Due {formatDate(h.due_date)}
                        {h.return_date ? ` · Returned ${formatDate(h.return_date)}` : ''}
                      </div>
                    </div>
                    <div className="font-semibold text-[#0f294d] dark:text-cyan-400">{h.status}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
