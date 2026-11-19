import React, { useEffect, useState } from 'react';
import {
  Check,
  Download,
  FileText,
  Plus,
  Search,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import { apiDownload, apiFetch, formatDate, type AuthUser } from '../lib/api';

const DIGITAL_CATEGORIES = [
  'Lecture notes',
  'Previous year question papers',
  'Laboratory manuals',
  'Project reports',
  'Research papers',
  'Conference publications',
  'Open-access books',
  'Departmental study materials',
  'Publicly available codes and guidelines',
];

export function MembersDigitalAcqView({
  mode,
  user,
}: {
  mode:
    | 'students'
    | 'faculty'
    | 'member-history'
    | 'digital-library'
    | 'acquisition-requests'
    | 'categories'
    | 'publishers'
    | 'authors';
  user: AuthUser;
}) {
  const isStaff = user.role === 'SUPER_ADMIN' || user.role === 'LIBRARIAN';
  const [items, setItems] = useState<any[]>([]);
  const [taxonomy, setTaxonomy] = useState<{ categories: any[]; authors: any[]; publishers: any[] }>({
    categories: [],
    authors: [],
    publishers: [],
  });
  const [q, setQ] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [showModal, setShowModal] = useState(false);

  // Forms
  const [studentForm, setStudentForm] = useState({
    registrationNumber: '',
    fullName: '',
    programme: 'B.Tech Civil Engineering',
    semester: '4',
    academicSession: '2025-2029',
    email: '',
    phone: '',
  });
  const [facultyForm, setFacultyForm] = useState({
    employeeId: '',
    fullName: '',
    designation: 'Assistant Professor',
    email: '',
    phone: '',
  });
  const [digitalForm, setDigitalForm] = useState({
    title: '',
    author: user.fullName,
    category: DIGITAL_CATEGORIES[0],
    subject: 'Structural Engineering',
    semester: '6th Semester',
    academicYear: '2026-2027',
    description: '',
    accessLevel: 'ALL_AUTHENTICATED',
  });
  const [digitalFile, setDigitalFile] = useState<File | null>(null);

  const [acqForm, setAcqForm] = useState({
    title: '',
    author: '',
    isbn: '',
    publisher: '',
    subject: 'Structural Engineering',
    reason: '',
    priority: 'MEDIUM',
  });

  const [taxForm, setTaxForm] = useState({ name: '', code: '', extra: '' });

  const load = async () => {
    setLoading(true);
    try {
      if (mode === 'students') {
        const res = await apiFetch(`/api/members/students?q=${encodeURIComponent(q.trim())}`);
        setItems(res.items || []);
      } else if (mode === 'faculty') {
        const res = await apiFetch(`/api/members/faculty?q=${encodeURIComponent(q.trim())}`);
        setItems(res.items || []);
      } else if (mode === 'member-history') {
        const res = await apiFetch(`/api/circulation/transactions?q=${encodeURIComponent(q.trim())}`);
        setItems(res.items || []);
      } else if (mode === 'digital-library') {
        const params = new URLSearchParams();
        if (q.trim()) params.set('q', q.trim());
        if (filterCat) params.set('category', filterCat);
        const res = await apiFetch(`/api/digital-library?${params.toString()}`);
        setItems(res.items || []);
      } else if (mode === 'acquisition-requests') {
        const res = await apiFetch('/api/acquisition-requests');
        setItems(res.items || []);
      } else {
        const res = await apiFetch('/api/taxonomy');
        setTaxonomy(res);
      }
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setFeedback(null);
    setShowModal(false);
    const t = setTimeout(() => void load(), 150);
    return () => clearTimeout(t);
  }, [mode, q, filterCat]);

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/members/students', {
        method: 'POST',
        body: JSON.stringify({ ...studentForm, semester: Number(studentForm.semester) }),
      });
      setFeedback({ type: 'ok', text: `Registered student ${studentForm.fullName} (${res.registrationNumber}).` });
      setShowModal(false);
      setStudentForm({
        registrationNumber: '',
        fullName: '',
        programme: 'B.Tech Civil Engineering',
        semester: '4',
        academicSession: '2025-2029',
        email: '',
        phone: '',
      });
      await load();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleCreateFaculty = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/members/faculty', {
        method: 'POST',
        body: JSON.stringify(facultyForm),
      });
      setFeedback({ type: 'ok', text: `Registered faculty ${facultyForm.fullName} (${res.employeeId}).` });
      setShowModal(false);
      setFacultyForm({ employeeId: '', fullName: '', designation: 'Assistant Professor', email: '', phone: '' });
      await load();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleToggleMemberStatus = async (userId: number, currentStatus: string) => {
    const next = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await apiFetch(`/api/members/${userId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      setFeedback({ type: 'ok', text: `Member account status set to ${next}.` });
      await load();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleMemberExcelImport = async (e: React.ChangeEvent<HTMLInputElement>, type: 'students' | 'faculty') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await apiFetch(`/api/members/import/${type}`, { method: 'POST', body: form });
      setFeedback({
        type: 'ok',
        text: `Imported ${res.imported} ${type} (${res.skipped} skipped from ${res.total} rows).`,
      });
      await load();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleDigitalUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!digitalFile) {
      setFeedback({ type: 'err', text: 'Select a document file to upload.' });
      return;
    }
    const form = new FormData();
    Object.entries(digitalForm).forEach(([k, v]) => form.append(k, v));
    form.append('file', digitalFile);
    try {
      await apiFetch('/api/digital-library', { method: 'POST', body: form });
      setFeedback({ type: 'ok', text: `Uploaded "${digitalForm.title}" to Digital Library.` });
      setShowModal(false);
      setDigitalFile(null);
      await load();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleAcqSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/acquisition-requests', {
        method: 'POST',
        body: JSON.stringify(acqForm),
      });
      setFeedback({ type: 'ok', text: `Submitted book recommendation "${acqForm.title}".` });
      setShowModal(false);
      setAcqForm({
        title: '',
        author: '',
        isbn: '',
        publisher: '',
        subject: 'Structural Engineering',
        reason: '',
        priority: 'MEDIUM',
      });
      await load();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleAcqReview = async (id: number, status: string) => {
    try {
      await apiFetch(`/api/acquisition-requests/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setFeedback({ type: 'ok', text: `Acquisition request #${id} marked as ${status}.` });
      await load();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleTaxonomyAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (mode === 'categories') {
        await apiFetch('/api/taxonomy/categories', {
          method: 'POST',
          body: JSON.stringify({ name: taxForm.name, code: taxForm.code, description: taxForm.extra }),
        });
      } else if (mode === 'authors') {
        await apiFetch('/api/taxonomy/authors', {
          method: 'POST',
          body: JSON.stringify({ name: taxForm.name, biography: taxForm.extra }),
        });
      } else {
        await apiFetch('/api/taxonomy/publishers', {
          method: 'POST',
          body: JSON.stringify({ name: taxForm.name, city: taxForm.code, country: taxForm.extra || 'India' }),
        });
      }
      setFeedback({ type: 'ok', text: `Added "${taxForm.name}" successfully.` });
      setTaxForm({ name: '', code: '', extra: '' });
      setShowModal(false);
      await load();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  return (
    <div className="space-y-5">
      {feedback && (
        <div
          role="status"
          className={`flex items-center justify-between rounded-lg border px-4 py-3 text-sm ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Dismiss message">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* STUDENTS & FACULTY */}
      {(mode === 'students' || mode === 'faculty') && (
        <>
          <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800 sm:flex-row sm:items-end">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                {mode === 'students' ? 'Civil Engineering Students Directory' : 'Department Faculty Directory'}
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {items.length} registered {mode} · Supports manual registration, Excel bulk import/export, and account control.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap shrink-0">
                <Upload className="h-3.5 w-3.5" />
                Bulk Excel Import
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => void handleMemberExcelImport(e, mode)}
                  className="hidden"
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  void apiDownload(
                    `/api/excel/export/${mode === 'students' ? 'student-history' : 'faculty-history'}`,
                    `HIT-CE-${mode}.xlsx`
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                Export History
              </button>
              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f294d] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#173a6b] whitespace-nowrap shrink-0"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Register {mode === 'students' ? 'Student' : 'Faculty'}
              </button>
            </div>
          </div>

          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${mode} by ID, name, or email...`}
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                    <th className="px-4 py-3">{mode === 'students' ? 'Reg. Number' : 'Employee ID'}</th>
                    <th className="px-4 py-3">Name & Email</th>
                    <th className="px-4 py-3">{mode === 'students' ? 'Programme & Semester' : 'Designation'}</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3 text-right">Active Loans</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((m) => (
                    <tr key={m.user_id}>
                      <td className="px-4 py-3 font-mono font-bold text-[#0f294d] dark:text-cyan-400">
                        {mode === 'students' ? m.registration_number : m.employee_id}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900 dark:text-white">{m.full_name}</div>
                        <div className="text-slate-500">
                          {m.email}
                          {m.is_demo_data ? ' · Sample Data' : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {mode === 'students' ? (
                          <>
                            <div>{m.programme}</div>
                            <div className="text-slate-500">
                              Sem {m.semester} · {m.academic_session}
                            </div>
                          </>
                        ) : (
                          m.designation
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-400">{m.phone || '—'}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold">{m.active_loans}</td>
                      <td className="px-4 py-3 font-semibold">
                        <span className={m.status === 'ACTIVE' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600'}>
                          {m.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => void handleToggleMemberStatus(m.user_id, m.status)}
                          className="rounded border border-slate-300 px-2.5 py-1 font-semibold hover:bg-slate-50 dark:border-slate-700"
                        >
                          {m.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Add Student / Faculty Modal */}
          {showModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
              {mode === 'students' ? (
                <form
                  onSubmit={handleCreateStudent}
                  className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
                >
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">Register Civil Engineering Student</h2>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold">Registration Number *</label>
                      <input
                        required
                        value={studentForm.registrationNumber}
                        onChange={(e) => setStudentForm({ ...studentForm, registrationNumber: e.target.value })}
                        placeholder="HIT/CE/2026/101"
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold">Full Name *</label>
                      <input
                        required
                        value={studentForm.fullName}
                        onChange={(e) => setStudentForm({ ...studentForm, fullName: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold">Programme</label>
                      <input
                        value={studentForm.programme}
                        onChange={(e) => setStudentForm({ ...studentForm, programme: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold">Semester</label>
                      <input
                        type="number"
                        min={1}
                        max={8}
                        value={studentForm.semester}
                        onChange={(e) => setStudentForm({ ...studentForm, semester: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold">Academic Session</label>
                      <input
                        value={studentForm.academicSession}
                        onChange={(e) => setStudentForm({ ...studentForm, academicSession: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold">Phone</label>
                      <input
                        value={studentForm.phone}
                        onChange={(e) => setStudentForm({ ...studentForm, phone: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-semibold">Email *</label>
                      <input
                        type="email"
                        required
                        value={studentForm.email}
                        onChange={(e) => setStudentForm({ ...studentForm, email: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                  </div>
                  <div className="mt-5 flex justify-end gap-2">
                    <button type="button" onClick={() => setShowModal(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold">
                      Cancel
                    </button>
                    <button type="submit" className="rounded-lg bg-[#0f294d] px-4 py-2 text-xs font-semibold text-white">
                      Register Student
                    </button>
                  </div>
                </form>
              ) : (
                <form
                  onSubmit={handleCreateFaculty}
                  className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
                >
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">Register Faculty Member</h2>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold">Employee ID *</label>
                      <input
                        required
                        value={facultyForm.employeeId}
                        onChange={(e) => setFacultyForm({ ...facultyForm, employeeId: e.target.value })}
                        placeholder="HIT-FAC-CE-011"
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold">Full Name *</label>
                      <input
                        required
                        value={facultyForm.fullName}
                        onChange={(e) => setFacultyForm({ ...facultyForm, fullName: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-semibold">Designation *</label>
                      <input
                        required
                        value={facultyForm.designation}
                        onChange={(e) => setFacultyForm({ ...facultyForm, designation: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold">Email *</label>
                      <input
                        type="email"
                        required
                        value={facultyForm.email}
                        onChange={(e) => setFacultyForm({ ...facultyForm, email: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold">Phone</label>
                      <input
                        value={facultyForm.phone}
                        onChange={(e) => setFacultyForm({ ...facultyForm, phone: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                  </div>
                  <div className="mt-5 flex justify-end gap-2">
                    <button type="button" onClick={() => setShowModal(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold">
                      Cancel
                    </button>
                    <button type="submit" className="rounded-lg bg-[#0f294d] px-4 py-2 text-xs font-semibold text-white">
                      Register Faculty
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </>
      )}

      {/* MEMBER HISTORY */}
      {mode === 'member-history' && (
        <div className="space-y-4">
          <div className="border-b border-slate-200 pb-4 dark:border-slate-800">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Member Borrowing History Ledger
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Complete circulation audit trail across students, faculty, and physical book copies.
            </p>
          </div>

          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search member name, registration ID, accession no., or title..."
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                    <th className="px-4 py-3">Receipt / Copy</th>
                    <th className="px-4 py-3">Borrower</th>
                    <th className="px-4 py-3">Book Title</th>
                    <th className="px-4 py-3">Issued</th>
                    <th className="px-4 py-3">Due / Returned</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((tx) => (
                    <tr key={tx.id}>
                      <td className="px-4 py-3 font-mono">
                        <div className="font-bold text-[#0f294d] dark:text-cyan-400">{tx.accession_number}</div>
                        <div className="text-[11px] text-slate-500">{tx.receipt_no}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900 dark:text-white">{tx.borrower_name}</div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {tx.member_code} · {tx.borrower_role}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium">{tx.title}</td>
                      <td className="px-4 py-3 font-mono">{formatDate(tx.issue_date)}</td>
                      <td className="px-4 py-3 font-mono">
                        <div>Due {formatDate(tx.due_date)}</div>
                        {tx.return_date && <div className="text-emerald-700">Ret {formatDate(tx.return_date)}</div>}
                      </td>
                      <td className="px-4 py-3 font-semibold">{tx.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* DIGITAL LIBRARY */}
      {mode === 'digital-library' && (
        <div className="space-y-4">
          <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800 sm:flex-row sm:items-end">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                Civil Engineering Digital Library Repository
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Departmental lecture notes, lab manuals, previous year question papers, project reports, and open-access publications.
              </p>
            </div>
            {(isStaff || user.role === 'FACULTY') && (
              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f294d] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#173a6b] whitespace-nowrap shrink-0"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload Resource
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="relative sm:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search notes, manuals, question papers, or subjects..."
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <select
              value={filterCat}
              onChange={(e) => setFilterCat(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="">All Resource Categories</option>
              {DIGITAL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map((res) => (
              <div
                key={res.id}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <div>
                  <div className="flex items-center gap-2 text-[11px] font-medium text-[#0891b2]">
                    <FileText className="h-3.5 w-3.5" />
                    <span>{res.category}</span>
                    <span>·</span>
                    <span>{res.semester || 'All'}</span>
                  </div>
                  <h3 className="mt-1.5 text-sm font-bold text-slate-900 dark:text-white">{res.title}</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {res.author} · {res.subject} · {res.academic_year}
                  </p>
                  {res.description && (
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      {res.description}
                    </p>
                  )}
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
                  <span className="font-mono text-slate-500">{res.download_count} downloads</span>
                  <button
                    type="button"
                    onClick={() =>
                      void apiDownload(`/api/digital-library/${res.id}/download`, res.file_name)
                    }
                    className="inline-flex items-center gap-1 font-semibold text-[#1d4ed8] hover:underline dark:text-cyan-400"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </button>
                </div>
              </div>
            ))}
          </div>

          {showModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
              <form
                onSubmit={handleDigitalUpload}
                className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
              >
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Upload Digital Library Resource</h2>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold">Resource Title *</label>
                    <input
                      required
                      value={digitalForm.title}
                      onChange={(e) => setDigitalForm({ ...digitalForm, title: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold">Author / Faculty *</label>
                    <input
                      required
                      value={digitalForm.author}
                      onChange={(e) => setDigitalForm({ ...digitalForm, author: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold">Category</label>
                    <select
                      value={digitalForm.category}
                      onChange={(e) => setDigitalForm({ ...digitalForm, category: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                    >
                      {DIGITAL_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold">Subject</label>
                    <input
                      value={digitalForm.subject}
                      onChange={(e) => setDigitalForm({ ...digitalForm, subject: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold">Semester</label>
                    <input
                      value={digitalForm.semester}
                      onChange={(e) => setDigitalForm({ ...digitalForm, semester: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold">Document File (PDF, DOCX, PPTX, TXT) *</label>
                    <input
                      type="file"
                      required
                      onChange={(e) => setDigitalFile(e.target.files?.[0] || null)}
                      className="mt-1 w-full text-xs"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold">Description</label>
                    <textarea
                      rows={2}
                      value={digitalForm.description}
                      onChange={(e) => setDigitalForm({ ...digitalForm, description: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={() => setShowModal(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold">
                    Cancel
                  </button>
                  <button type="submit" className="rounded-lg bg-[#0f294d] px-4 py-2 text-xs font-semibold text-white">
                    Upload Resource
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* ACQUISITION REQUESTS */}
      {mode === 'acquisition-requests' && (
        <div className="space-y-4">
          <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800 sm:flex-row sm:items-end">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                Book Acquisition Requests
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Faculty and students can recommend new textbooks, standards, or research monographs for procurement.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f294d] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#173a6b] whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              Recommend New Book
            </button>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                    <th className="px-4 py-3">Recommended Title & Author</th>
                    <th className="px-4 py-3">Subject & Reason</th>
                    <th className="px-4 py-3">Requester</th>
                    <th className="px-4 py-3">Priority / Status</th>
                    {isStaff && <th className="px-4 py-3 text-right">Review Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((req) => (
                    <tr key={req.id}>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900 dark:text-white">{req.title}</div>
                        <div className="text-slate-500">
                          {req.author} · {req.publisher || '—'} {req.isbn ? `· ${req.isbn}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{req.subject}</div>
                        <div className="text-slate-500">{req.reason}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{req.requester_name}</div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {req.requester_role} · {formatDate(req.created_at)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[#0f294d] dark:text-cyan-400">{req.status}</div>
                        <div className="text-[11px] text-slate-500">Priority: {req.priority}</div>
                      </td>
                      {isStaff && (
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex gap-1">
                            {req.status === 'PENDING' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void handleAcqReview(req.id, 'APPROVED')}
                                  className="rounded bg-emerald-700 px-2 py-1 font-semibold text-white"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleAcqReview(req.id, 'REJECTED')}
                                  className="rounded border border-red-300 px-2 py-1 font-semibold text-red-600"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            {req.status === 'APPROVED' && (
                              <button
                                type="button"
                                onClick={() => void handleAcqReview(req.id, 'PURCHASED')}
                                className="inline-flex items-center gap-1 rounded bg-[#0f294d] px-2.5 py-1 font-semibold text-white"
                              >
                                <Check className="h-3 w-3" />
                                Mark Purchased
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {showModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
              <form
                onSubmit={handleAcqSubmit}
                className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
              >
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Recommend a Book for Procurement</h2>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold">Book Title *</label>
                    <input
                      required
                      value={acqForm.title}
                      onChange={(e) => setAcqForm({ ...acqForm, title: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold">Author *</label>
                    <input
                      required
                      value={acqForm.author}
                      onChange={(e) => setAcqForm({ ...acqForm, author: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold">ISBN</label>
                    <input
                      value={acqForm.isbn}
                      onChange={(e) => setAcqForm({ ...acqForm, isbn: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold">Subject *</label>
                    <input
                      required
                      value={acqForm.subject}
                      onChange={(e) => setAcqForm({ ...acqForm, subject: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold">Priority</label>
                    <select
                      value={acqForm.priority}
                      onChange={(e) => setAcqForm({ ...acqForm, priority: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                    >
                      <option value="LOW">LOW</option>
                      <option value="MEDIUM">MEDIUM</option>
                      <option value="HIGH">HIGH</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold">Academic Justification / Reason *</label>
                    <textarea
                      required
                      rows={3}
                      value={acqForm.reason}
                      onChange={(e) => setAcqForm({ ...acqForm, reason: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={() => setShowModal(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold">
                    Cancel
                  </button>
                  <button type="submit" className="rounded-lg bg-[#0f294d] px-4 py-2 text-xs font-semibold text-white">
                    Submit Recommendation
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* TAXONOMY: CATEGORIES / PUBLISHERS / AUTHORS */}
      {(mode === 'categories' || mode === 'publishers' || mode === 'authors') && (
        <div className="space-y-4">
          <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800 sm:flex-row sm:items-end">
            <div>
              <h1 className="text-2xl font-bold capitalize tracking-tight text-slate-900 dark:text-white">
                Civil Engineering {mode}
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Pre-populated with 35+ Civil Engineering subject classifications, IS/BIS/IRC/ASTM/ACI/NBC standards, and GATE resources.
              </p>
            </div>
            {isStaff && (
              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f294d] px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                Add {mode.slice(0, -1)}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {(mode === 'categories'
              ? taxonomy.categories
              : mode === 'authors'
              ? taxonomy.authors
              : taxonomy.publishers
            ).map((item: any) => (
              <div
                key={item.id}
                className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-slate-900 dark:text-white">{item.name}</div>
                  <span className="shrink-0 font-mono text-xs text-[#0891b2]">
                    {item.code ? `${item.code} · ` : ''}
                    {item.book_count} titles
                  </span>
                </div>
                {(item.description || item.biography || item.city) && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    {item.description || item.biography || `${item.city || ''}${item.country ? `, ${item.country}` : ''}`}
                  </p>
                )}
              </div>
            ))}
          </div>

          {showModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
              <form
                onSubmit={handleTaxonomyAdd}
                className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
              >
                <h2 className="text-base font-bold capitalize text-slate-900 dark:text-white">
                  Add New {mode.slice(0, -1)}
                </h2>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="block text-xs font-semibold">Name *</label>
                    <input
                      required
                      value={taxForm.name}
                      onChange={(e) => setTaxForm({ ...taxForm, name: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                  {mode !== 'authors' && (
                    <div>
                      <label className="block text-xs font-semibold">
                        {mode === 'categories' ? 'Short Code (e.g. GEO) *' : 'City'}
                      </label>
                      <input
                        required={mode === 'categories'}
                        value={taxForm.code}
                        onChange={(e) => setTaxForm({ ...taxForm, code: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-semibold">
                      {mode === 'publishers' ? 'Country' : 'Description / Bio'}
                    </label>
                    <input
                      value={taxForm.extra}
                      onChange={(e) => setTaxForm({ ...taxForm, extra: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={() => setShowModal(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold">
                    Cancel
                  </button>
                  <button type="submit" className="rounded-lg bg-[#0f294d] px-4 py-2 text-xs font-semibold text-white">
                    Save
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {loading && items.length === 0 && taxonomy.categories.length === 0 && (
        <div className="py-10 text-center text-sm text-slate-500">Loading records...</div>
      )}
    </div>
  );
}
