import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Search,
  UserCheck,
  X,
} from 'lucide-react';
import { apiFetch, formatDate, formatInr, type AuthUser } from '../lib/api';
import {
  generateFineReceiptPdf,
  generateIssueReceiptPdf,
  generateReturnReceiptPdf,
} from '../lib/pdfGenerator';
import { CameraQrScanner } from '../components/BarcodeQr';

export function CirculationView({
  mode,
  user,
}: {
  mode: 'scan' | 'issue' | 'return' | 'renew' | 'reservations' | 'overdue' | 'fines';
  user: AuthUser;
}) {
  const isStaff = user.role === 'SUPER_ADMIN' || user.role === 'LIBRARIAN';
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Scan / Issue / Return states
  const [memberQuery, setMemberQuery] = useState('');
  const [members, setMembers] = useState<any[]>([]);
  const [selectedMember, setSelectedMember] = useState<any | null>(null);
  const [scanInput, setScanInput] = useState('');
  const [scannedResult, setScannedResult] = useState<any | null>(null);
  const [remarks, setRemarks] = useState('');
  const [markDamaged, setMarkDamaged] = useState(false);
  const [lastIssueReceipt, setLastIssueReceipt] = useState<any | null>(null);
  const [lastReturnReceipt, setLastReturnReceipt] = useState<any | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);

  // Tables
  const [transactions, setTransactions] = useState<any[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);
  const [fines, setFines] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Fine Payment / Waiver modal
  const [payingFine, setPayingFine] = useState<any | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [waivingFine, setWaivingFine] = useState<any | null>(null);
  const [waiveReason, setWaiveReason] = useState('');
  const [lastFineReceipt, setLastFineReceipt] = useState<any | null>(null);

  const loadList = async () => {
    setLoading(true);
    try {
      if (mode === 'reservations') {
        const res = await apiFetch('/api/reservations');
        setReservations(res.items || []);
      } else if (mode === 'fines') {
        const res = await apiFetch('/api/fines');
        setFines(res.items || []);
        setPayments(res.payments || []);
      } else if (mode === 'overdue') {
        const res = await apiFetch('/api/circulation/transactions?status=OVERDUE');
        setTransactions(res.items || []);
      } else if (mode === 'renew') {
        const res = await apiFetch('/api/circulation/transactions?status=ACTIVE');
        setTransactions(res.items || []);
      } else {
        const res = await apiFetch('/api/circulation/transactions?status=ACTIVE');
        setTransactions(res.items || []);
      }
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setFeedback(null);
    setScannedResult(null);
    setLastIssueReceipt(null);
    setLastReturnReceipt(null);
    void loadList();
  }, [mode]);

  useEffect(() => {
    if (!isStaff || (mode !== 'scan' && mode !== 'issue')) return;
    const t = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/members/search?q=${encodeURIComponent(memberQuery.trim())}`);
        setMembers(res.items || []);
      } catch {
        setMembers([]);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [memberQuery, mode, isStaff]);

  const lookupScannedCopy = async (code: string) => {
    const cleaned = code.trim();
    if (!cleaned) return;
    setFeedback(null);
    try {
      const res = await apiFetch(`/api/copies/lookup?code=${encodeURIComponent(cleaned)}`);
      setScannedResult(res);
      setScanInput(res.copy.accession_number);
    } catch (err: any) {
      setScannedResult(null);
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleConfirmIssue = async () => {
    if (!selectedMember) {
      setFeedback({ type: 'err', text: 'Select a Student or Faculty borrower first.' });
      return;
    }
    const targetCode = scannedResult?.copy?.accession_number || scanInput.trim();
    if (!targetCode) {
      setFeedback({ type: 'err', text: 'Scan or enter a physical copy Accession Number.' });
      return;
    }
    setFeedback(null);
    try {
      const receipt = await apiFetch('/api/circulation/issue', {
        method: 'POST',
        body: JSON.stringify({
          borrowerId: selectedMember.id,
          scannedCode: targetCode,
          remarks,
        }),
      });
      setLastIssueReceipt(receipt);
      setFeedback({
        type: 'ok',
        text: `Issued ${receipt.accessionNumber} ("${receipt.bookTitle}") to ${receipt.borrowerName}. Receipt: ${receipt.receiptNo}. Due: ${formatDate(receipt.dueDate)}.`,
      });
      setScannedResult(null);
      setScanInput('');
      setRemarks('');
      // Refresh member's active loan count and active loans list
      const mRes = await apiFetch(`/api/members/search?q=${encodeURIComponent(selectedMember.member_code)}`);
      const updated = (mRes.items || []).find((m: any) => m.id === selectedMember.id);
      if (updated) setSelectedMember(updated);
      await loadList();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleConfirmReturn = async (overrideCode?: string) => {
    const targetCode = overrideCode || scannedResult?.copy?.accession_number || scanInput.trim();
    if (!targetCode) {
      setFeedback({ type: 'err', text: 'Scan or enter a book Accession Number to process return.' });
      return;
    }
    setFeedback(null);
    try {
      const receipt = await apiFetch('/api/circulation/return', {
        method: 'POST',
        body: JSON.stringify({
          scannedCode: targetCode,
          conditionNote: remarks || 'Verified at departmental counter',
          markDamaged,
        }),
      });
      setLastReturnReceipt(receipt);
      setFeedback({
        type: 'ok',
        text: `Returned ${receipt.accessionNumber} (${receipt.returnReceipt}). Copy status -> ${receipt.newCopyStatus}.${
          receipt.fineAmountInr > 0 ? ` Overdue Fine: ${formatInr(receipt.fineAmountInr)}.` : ''
        }`,
      });
      setScannedResult(null);
      setScanInput('');
      setRemarks('');
      setMarkDamaged(false);
      await loadList();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleRenew = async (issueId: number) => {
    setFeedback(null);
    try {
      const res = await apiFetch('/api/circulation/renew', {
        method: 'POST',
        body: JSON.stringify({ issueId }),
      });
      setFeedback({
        type: 'ok',
        text: `Renewed ${res.accessionNumber}. New due date: ${formatDate(res.newDueDate)}.`,
      });
      await loadList();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleReservationStatus = async (id: number, status: string) => {
    try {
      await apiFetch(`/api/reservations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setFeedback({ type: 'ok', text: `Reservation #${id} updated to ${status}.` });
      await loadList();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleFinePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingFine) return;
    try {
      const res = await apiFetch(`/api/fines/${payingFine.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({ amountInr: Number(payAmount) }),
      });
      setLastFineReceipt({
        ...res,
        borrowerName: payingFine.borrower_name,
        memberCode: payingFine.member_code,
        accessionNumber: payingFine.accession_number,
        collectedBy: user.fullName,
      });
      setFeedback({
        type: 'ok',
        text: `Recorded payment ${res.receiptNumber} of ${formatInr(res.amountPaidInr)}. Status: ${res.status}.`,
      });
      setPayingFine(null);
      setPayAmount('');
      await loadList();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleFineWaive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waivingFine) return;
    try {
      await apiFetch(`/api/fines/${waivingFine.id}/waive`, {
        method: 'POST',
        body: JSON.stringify({ reason: waiveReason }),
      });
      setFeedback({ type: 'ok', text: `Fine #${waivingFine.id} waived successfully.` });
      setWaivingFine(null);
      setWaiveReason('');
      await loadList();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  return (
    <div className="space-y-5">
      {feedback && (
        <div
          role="alert"
          className={`flex items-center justify-between rounded-lg border px-4 py-3 text-sm ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Dismiss notification">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* SCAN & ISSUE / ISSUE BOOKS */}
      {(mode === 'scan' || mode === 'issue') && isStaff && (
        <div className="space-y-5">
          <div className="border-b border-slate-200 pb-4 dark:border-slate-800">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {mode === 'scan' ? 'QR / Barcode Scan & Issue Counter' : 'Issue Books to Students & Faculty'}
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Supports USB keyboard barcode scanners (focus accession box and scan), webcam/mobile QR camera, and manual accession lookup.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Step 1: Select Borrower */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-5">
              <div className="flex items-center gap-2 text-sm font-bold text-[#0f294d] dark:text-cyan-400">
                <UserCheck className="h-4 w-4" />
                <span>01. Select Student or Faculty Borrower</span>
              </div>
              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={memberQuery}
                  onChange={(e) => setMemberQuery(e.target.value)}
                  placeholder="Search Registration No., Employee ID, or Name..."
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              {selectedMember && (
                <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/70 p-3.5 text-xs dark:border-blue-900 dark:bg-blue-950/40">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm font-bold text-[#0f294d] dark:text-white">
                        {selectedMember.full_name}
                      </div>
                      <div className="mt-0.5 font-mono text-slate-600 dark:text-slate-300">
                        {selectedMember.member_code} · {selectedMember.role}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedMember(null)}
                      className="text-xs text-slate-500 hover:underline"
                    >
                      Change
                    </button>
                  </div>
                  <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-blue-200/80 pt-2 dark:border-blue-900">
                    <div>
                      <span className="text-[10px] text-slate-500">Status</span>
                      <div className="font-semibold text-emerald-700 dark:text-emerald-400">{selectedMember.status}</div>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500">Active Loans</span>
                      <div className="font-mono font-semibold">
                        {selectedMember.active_loans} / {selectedMember.borrow_limit}
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500">Unpaid Fines</span>
                      <div className="font-mono font-semibold text-amber-700 dark:text-amber-400">
                        {formatInr(selectedMember.unpaid_fines)}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-3 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {members.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setSelectedMember(m);
                      setTimeout(() => scanInputRef.current?.focus(), 60);
                    }}
                    className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800 ${
                      selectedMember?.id === m.id ? 'bg-blue-50/60 dark:bg-blue-950/30' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-slate-900 dark:text-white">{m.full_name}</div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {m.member_code} · {m.role}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-slate-500">
                      {m.active_loans}/{m.borrow_limit}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Step 2: Scan Book Copy & Confirm Issue */}
            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-7">
              <div className="flex items-center gap-2 text-sm font-bold text-[#0f294d] dark:text-cyan-400">
                <ScanLine className="h-4 w-4" />
                <span>02. Scan Barcode / QR Code or Enter Accession Number</span>
              </div>

              <div className="flex gap-2">
                <input
                  ref={scanInputRef}
                  type="text"
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void lookupScannedCopy(scanInput);
                    }
                  }}
                  placeholder="Scan USB Barcode / QR or type HIT-CE-2026-0001 and press Enter"
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                />
                <button
                  type="button"
                  onClick={() => void lookupScannedCopy(scanInput)}
                  className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 whitespace-nowrap shrink-0"
                >
                  Verify Copy
                </button>
              </div>

              <CameraQrScanner onScan={(decoded) => void lookupScannedCopy(decoded)} />

              {scannedResult?.copy && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-xs font-bold text-[#0f294d] dark:text-cyan-400">
                        {scannedResult.copy.accession_number} · Copy #{scannedResult.copy.copy_number}
                      </div>
                      <div className="mt-0.5 text-base font-bold text-slate-900 dark:text-white">
                        {scannedResult.copy.title}
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-400">
                        {scannedResult.copy.author} · Shelf {scannedResult.copy.shelf_number} / Rack {scannedResult.copy.rack_number}
                      </div>
                    </div>
                    <span
                      className={`text-xs font-bold ${
                        scannedResult.copy.status === 'AVAILABLE'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {scannedResult.copy.status}
                    </span>
                  </div>
                  {scannedResult.activeIssue && (
                    <div className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">
                      Currently issued to {scannedResult.activeIssue.borrower_name} (Receipt {scannedResult.activeIssue.receipt_no}, Due {formatDate(scannedResult.activeIssue.due_date)}). Duplicate issuance will be blocked.
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Counter Remarks (Optional)
                </label>
                <input
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Optional condition note or departmental reference"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void handleConfirmIssue()}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#0f294d] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#173a6b]"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Confirm Book Issue
                </button>
              </div>

              {lastIssueReceipt && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
                  <div className="text-xs">
                    <div className="font-bold text-emerald-900 dark:text-emerald-300">
                      Issue Receipt Ready: {lastIssueReceipt.receiptNo}
                    </div>
                    <div className="text-emerald-800 dark:text-emerald-400">
                      {lastIssueReceipt.accessionNumber} → {lastIssueReceipt.borrowerName} · Due {formatDate(lastIssueReceipt.dueDate)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => generateIssueReceiptPdf(lastIssueReceipt)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download PDF Receipt
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* RETURN BOOKS */}
      {mode === 'return' && isStaff && (
        <div className="space-y-5">
          <div className="border-b border-slate-200 pb-4 dark:border-slate-800">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Return Books (Scanner & Overdue Fine Verification)
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Scan book barcode or QR code to retrieve active loan details, compute overdue fine in INR, and release availability.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-6">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void lookupScannedCopy(scanInput);
                    }
                  }}
                  placeholder="Scan book barcode/QR or type Accession Number..."
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                />
                <button
                  type="button"
                  onClick={() => void lookupScannedCopy(scanInput)}
                  className="rounded-lg bg-[#0f294d] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#173a6b] whitespace-nowrap shrink-0"
                >
                  Lookup Loan
                </button>
              </div>

              <CameraQrScanner onScan={(decoded) => void lookupScannedCopy(decoded)} />

              {scannedResult && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="font-mono font-bold text-[#0f294d] dark:text-cyan-400">
                    {scannedResult.copy.accession_number} — {scannedResult.copy.title}
                  </div>
                  {scannedResult.activeIssue ? (
                    <div className="mt-3 space-y-1.5">
                      <div>
                        Borrower: <strong>{scannedResult.activeIssue.borrower_name}</strong> ({scannedResult.activeIssue.member_code})
                      </div>
                      <div className="font-mono">
                        Receipt: {scannedResult.activeIssue.receipt_no} · Issued: {formatDate(scannedResult.activeIssue.issue_date)} · Due: {formatDate(scannedResult.activeIssue.due_date)}
                      </div>
                      <div className="font-mono font-bold text-red-600 dark:text-red-400">
                        Overdue Duration: {scannedResult.activeIssue.overdueDays} day(s) · Applicable Fine: {formatInr(scannedResult.activeIssue.fineAmountInr)}
                      </div>

                      <div className="pt-2">
                        <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={markDamaged}
                            onChange={(e) => setMarkDamaged(e.target.checked)}
                          />
                          Flag physical copy as Damaged on return
                        </label>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleConfirmReturn()}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Confirm Return & Update Availability
                      </button>
                    </div>
                  ) : (
                    <div className="mt-2 font-medium text-amber-700 dark:text-amber-400">
                      This copy is currently {scannedResult.copy.status} and has no active loan to return.
                    </div>
                  )}
                </div>
              )}

              {lastReturnReceipt && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
                  <div className="text-xs">
                    <div className="font-bold text-emerald-900 dark:text-emerald-300">
                      Return Receipt: {lastReturnReceipt.returnReceipt}
                    </div>
                    <div>
                      Copy {lastReturnReceipt.accessionNumber} is now {lastReturnReceipt.newCopyStatus}.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => generateReturnReceiptPdf(lastReturnReceipt)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download Return Receipt PDF
                  </button>
                </div>
              )}
            </div>

            {/* Active Loans Quick Return Table */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:col-span-6">
              <div className="border-b border-slate-200 px-4 py-3 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-300">
                Active Checked-Out Copies ({transactions.length})
              </div>
              <div className="max-h-[480px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {transactions.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between gap-3 px-4 py-3 text-xs">
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-[#0f294d] dark:text-cyan-400">
                        {tx.accession_number}
                      </div>
                      <div className="truncate font-medium text-slate-900 dark:text-white">{tx.title}</div>
                      <div className="text-slate-500">
                        {tx.borrower_name} ({tx.member_code}) · Due {formatDate(tx.due_date)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void lookupScannedCopy(tx.accession_number)}
                      className="rounded-md border border-slate-300 px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0"
                    >
                      Select
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RENEW BOOKS & OVERDUE BOOKS */}
      {(mode === 'renew' || mode === 'overdue') && (
        <div className="space-y-4">
          <div className="border-b border-slate-200 pb-4 dark:border-slate-800">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {mode === 'overdue' ? 'Overdue Books Monitoring' : 'Renew Active Book Loans'}
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {mode === 'overdue'
                ? 'Active loans past their institutional due date with live INR fine accruals.'
                : 'Extend eligible active loans subject to renewal limits and reservation queue checks.'}
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                    <th className="px-4 py-3">Receipt / Accession</th>
                    <th className="px-4 py-3">Book Title</th>
                    <th className="px-4 py-3">Borrower</th>
                    <th className="px-4 py-3">Issued / Due</th>
                    <th className="px-4 py-3 text-right">Overdue / Est. Fine</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        Loading transactions...
                      </td>
                    </tr>
                  ) : transactions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        No records found.
                      </td>
                    </tr>
                  ) : (
                    transactions.map((tx) => (
                      <tr key={tx.id}>
                        <td className="px-4 py-3 font-mono">
                          <div className="font-bold text-[#0f294d] dark:text-cyan-400">{tx.accession_number}</div>
                          <div className="text-[11px] text-slate-500">{tx.receipt_no}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900 dark:text-white">{tx.title}</div>
                          <div className="text-slate-500">Renewals: {tx.renewal_count}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900 dark:text-white">{tx.borrower_name}</div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {tx.member_code} · {tx.borrower_role}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono">
                          <div>{formatDate(tx.issue_date)}</div>
                          <div className={tx.status === 'OVERDUE' ? 'font-bold text-red-600 dark:text-red-400' : ''}>
                            Due {formatDate(tx.due_date)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {tx.live_overdue_days > 0 ? (
                            <div className="font-bold text-red-600 dark:text-red-400">
                              {tx.live_overdue_days}d · {formatInr(tx.live_fine_inr)}
                            </div>
                          ) : (
                            <span className="text-emerald-700 dark:text-emerald-400">On Time</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex gap-1.5">
                            {(isStaff || user.role === 'FACULTY') && (
                              <button
                                type="button"
                                onClick={() => void handleRenew(tx.id)}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0"
                              >
                                <RefreshCw className="h-3 w-3" />
                                Renew
                              </button>
                            )}
                            {isStaff && (
                              <button
                                type="button"
                                onClick={() => void handleConfirmReturn(tx.accession_number)}
                                className="inline-flex items-center gap-1 rounded-md bg-[#0f294d] px-2.5 py-1.5 font-semibold text-white hover:bg-[#173a6b] whitespace-nowrap shrink-0"
                              >
                                <RotateCcw className="h-3 w-3" />
                                Return
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* RESERVATIONS */}
      {mode === 'reservations' && (
        <div className="space-y-4">
          <div className="border-b border-slate-200 pb-4 dark:border-slate-800">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Reservation Queue Management
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Track reservation positions, pickup availability notifications, cancellations, and expiry timelines.
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                    <th className="px-4 py-3">Queue #</th>
                    <th className="px-4 py-3">Book Title</th>
                    <th className="px-4 py-3">Member</th>
                    <th className="px-4 py-3">Reserved / Expires</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {reservations.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-3 font-mono font-bold text-[#0f294d] dark:text-cyan-400">
                        #{r.position || 1}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900 dark:text-white">{r.title}</div>
                        <div className="text-slate-500">
                          {r.author} · {r.available_copies} copy/copies currently available
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 dark:text-white">{r.member_name}</div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {r.member_code} · {r.member_role}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono">
                        <div>{formatDate(r.reserved_at)}</div>
                        <div className="text-[11px] text-slate-500">
                          {r.expires_at ? `Exp: ${formatDate(r.expires_at)}` : 'Waiting in queue'}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-semibold text-[#0891b2] dark:text-cyan-400">{r.status}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-1.5">
                          {isStaff && r.status === 'ACTIVE' && (
                            <button
                              type="button"
                              onClick={() => void handleReservationStatus(r.id, 'READY')}
                              className="rounded border border-slate-300 px-2.5 py-1 font-semibold hover:bg-slate-50 dark:border-slate-700"
                            >
                              Mark Ready
                            </button>
                          )}
                          {isStaff && r.status === 'READY' && (
                            <button
                              type="button"
                              onClick={() => void handleReservationStatus(r.id, 'FULFILLED')}
                              className="rounded bg-[#0f294d] px-2.5 py-1 font-semibold text-white"
                            >
                              Mark Fulfilled
                            </button>
                          )}
                          {(r.status === 'ACTIVE' || r.status === 'READY') && (
                            <button
                              type="button"
                              onClick={() => void handleReservationStatus(r.id, 'CANCELLED')}
                              className="rounded border border-red-200 px-2.5 py-1 font-semibold text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* FINE MANAGEMENT (INR) */}
      {mode === 'fines' && (
        <div className="space-y-5">
          <div className="border-b border-slate-200 pb-4 dark:border-slate-800">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Overdue Fine Management (INR)
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Collect full or partial payments in Indian Rupees (₹), issue PDF counter receipts, or record approved waivers.
            </p>
          </div>

          {lastFineReceipt && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
              <div className="text-xs">
                <div className="font-bold text-emerald-900 dark:text-emerald-300">
                  Fine Payment Receipt: {lastFineReceipt.receiptNumber}
                </div>
                <div>
                  Collected {formatInr(lastFineReceipt.amountPaidInr)} from {lastFineReceipt.borrowerName}
                </div>
              </div>
              <button
                type="button"
                onClick={() => generateFineReceiptPdf(lastFineReceipt)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white"
              >
                <Download className="h-3.5 w-3.5" />
                Download Fine Receipt PDF
              </button>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                    <th className="px-4 py-3">Member & Book</th>
                    <th className="px-4 py-3 text-right">Overdue Days</th>
                    <th className="px-4 py-3 text-right">Total Fine</th>
                    <th className="px-4 py-3 text-right">Paid / Waived</th>
                    <th className="px-4 py-3 text-right">Balance</th>
                    <th className="px-4 py-3">Status</th>
                    {isStaff && <th className="px-4 py-3 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {fines.map((f) => {
                    const balance = Math.max(0, f.amount_inr - f.paid_amount_inr - f.waived_amount_inr);
                    return (
                      <tr key={f.id}>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {f.borrower_name} ({f.member_code})
                          </div>
                          <div className="text-slate-500">
                            <span className="font-mono">{f.accession_number}</span> · {f.title}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">{f.overdue_days}d</td>
                        <td className="px-4 py-3 text-right font-mono font-semibold">{formatInr(f.amount_inr)}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-600 dark:text-slate-400">
                          {formatInr(f.paid_amount_inr)} / {formatInr(f.waived_amount_inr)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-red-600 dark:text-red-400">
                          {formatInr(balance)}
                        </td>
                        <td className="px-4 py-3 font-semibold">{f.status.replace('_', ' ')}</td>
                        {isStaff && (
                          <td className="px-4 py-3 text-right">
                            {balance > 0.01 ? (
                              <div className="inline-flex gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPayingFine(f);
                                    setPayAmount(String(balance));
                                  }}
                                  className="rounded bg-[#0f294d] px-2.5 py-1.5 font-semibold text-white whitespace-nowrap shrink-0"
                                >
                                  Record Payment
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setWaivingFine(f);
                                    setWaiveReason('');
                                  }}
                                  className="rounded border border-slate-300 px-2.5 py-1.5 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0"
                                >
                                  Waive
                                </button>
                              </div>
                            ) : (
                              <span className="text-slate-400">Settled</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {payments.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Recent Fine Payment Receipts</h2>
              <div className="mt-3 divide-y divide-slate-100 text-xs dark:divide-slate-800">
                {payments.slice(0, 10).map((p) => (
                  <div key={p.id} className="flex items-center justify-between py-2">
                    <div>
                      <span className="font-mono font-bold text-[#0f294d] dark:text-cyan-400">
                        {p.receipt_number}
                      </span>{' '}
                      · Fine #{p.fine_id} · {p.payment_method} (Collected by {p.collected_by})
                    </div>
                    <div className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                      {formatInr(p.amount_paid_inr)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal: Record Fine Payment */}
      {payingFine && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleFinePay}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
          >
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Collect Fine Payment (INR)
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {payingFine.borrower_name} · Copy {payingFine.accession_number}
            </p>
            <div className="mt-4">
              <label className="block text-xs font-semibold">Amount Received (INR) *</label>
              <input
                type="number"
                required
                min={1}
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPayingFine(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-[#0f294d] px-4 py-2 text-xs font-semibold text-white"
              >
                Confirm Payment
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Waive Fine */}
      {waivingFine && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleFineWaive}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
          >
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Waive Overdue Fine</h2>
            <p className="mt-1 text-xs text-slate-500">
              {waivingFine.borrower_name} · Copy {waivingFine.accession_number}
            </p>
            <div className="mt-4">
              <label className="block text-xs font-semibold">Authorised Waiver Reason *</label>
              <textarea
                required
                rows={3}
                value={waiveReason}
                onChange={(e) => setWaiveReason(e.target.value)}
                placeholder="e.g., Medical leave certified by Head of Department"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setWaivingFine(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-amber-700 px-4 py-2 text-xs font-semibold text-white"
              >
                Confirm Waiver
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
