import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CheckCheck,
  Database,
  Download,
  FileText,
  Plus,
  Save,
  Search,
  Upload,
} from 'lucide-react';
import { apiDownload, apiFetch, formatDateTime, formatInr } from '../lib/api';
import { generateReportPdf } from '../lib/pdfGenerator';

export function ReportsAdminView({
  mode,
  onBrandingUpdated,
}: {
  mode:
    | 'reports'
    | 'notifications'
    | 'users'
    | 'role-permissions'
    | 'department-settings'
    | 'library-policies'
    | 'audit-logs'
    | 'backup-restore';
  onBrandingUpdated?: () => void;
}) {
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Reports
  const [reportData, setReportData] = useState<any>(null);
  const [repYear, setRepYear] = useState('');

  // Notifications
  const [notifications, setNotifications] = useState<any[]>([]);

  // Admin Users / Roles
  const [users, setUsers] = useState<any[]>([]);
  const [roleMatrix, setRoleMatrix] = useState<any>(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'LIBRARIAN',
    phone: '',
  });

  // Settings & Policies
  const [settings, setSettings] = useState<any>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [newDept, setNewDept] = useState({ code: '', name: '', hodName: '', location: '' });

  // Audit Logs
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditQuery, setAuditQuery] = useState('');

  const load = async () => {
    try {
      if (mode === 'reports') {
        const res = await apiFetch(`/api/reports/summary?year=${encodeURIComponent(repYear)}`);
        setReportData(res);
      } else if (mode === 'notifications') {
        const res = await apiFetch('/api/notifications');
        setNotifications(res.items || []);
      } else if (mode === 'users') {
        const res = await apiFetch('/api/admin/users');
        setUsers(res.items || []);
      } else if (mode === 'role-permissions') {
        const res = await apiFetch('/api/admin/roles');
        setRoleMatrix(res);
      } else if (mode === 'department-settings' || mode === 'library-policies') {
        const res = await apiFetch('/api/admin/settings');
        setSettings(res.settings);
        setDepartments(res.departments || []);
      } else if (mode === 'audit-logs') {
        const res = await apiFetch(`/api/admin/audit-logs?q=${encodeURIComponent(auditQuery.trim())}`);
        setAuditLogs(res.items || []);
      }
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  useEffect(() => {
    setFeedback(null);
    const t = setTimeout(() => void load(), 120);
    return () => clearTimeout(t);
  }, [mode, repYear, auditQuery]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      setSettings(res.settings);
      onBrandingUpdated?.();
      setFeedback({ type: 'ok', text: 'Institutional settings and library policies saved.' });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>, slot: 'institution' | 'department') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('logo', file);
    try {
      const res = await apiFetch(`/api/admin/settings/logo/${slot}`, { method: 'POST', body: form });
      setSettings((prev: any) => ({
        ...prev,
        [slot === 'department' ? 'department_logo_url' : 'institution_logo_url']: res.url,
      }));
      onBrandingUpdated?.();
      setFeedback({ type: 'ok', text: `Uploaded ${slot === 'department' ? 'Civil Engineering Department' : 'Haldia Institute of Technology'} logo.` });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/users', { method: 'POST', body: JSON.stringify(newUser) });
      setFeedback({ type: 'ok', text: `Created user account for ${newUser.fullName} (${newUser.role}).` });
      setShowAddUser(false);
      setNewUser({ fullName: '', email: '', password: '', role: 'LIBRARIAN', phone: '' });
      await load();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err.message });
    }
  };

  const exportCsv = (title: string, headers: string[], rows: Array<Array<string | number>>) => {
    const csv = [headers.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `HIT-CE-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-5">
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

      {/* REPORTS & ANALYTICS */}
      {mode === 'reports' && reportData && (
        <div className="space-y-6">
          <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800 sm:flex-row sm:items-end">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                Departmental Reports & Analytics
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Real-time inventory valuation, fine collection summary, lost/damaged books, and PDF/XLSX/CSV export.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={repYear}
                onChange={(e) => setRepYear(e.target.value)}
                placeholder="Acq. Year (e.g. 2026)"
                className="w-36 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
              />
              <button
                type="button"
                onClick={() =>
                  generateReportPdf(
                    'Category-Wise Civil Engineering Inventory Valuation',
                    ['Category', 'Titles', 'Total Copies', 'Available', 'Issued', 'Valuation (INR)'],
                    reportData.inventoryByCategory.map((r: any) => [
                      r.category,
                      r.titles,
                      r.totalCopies,
                      r.availableCopies,
                      r.issuedCopies,
                      Number(r.valuationInr).toFixed(2),
                    ])
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f294d] px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap shrink-0"
              >
                <FileText className="h-3.5 w-3.5" />
                Export PDF
              </button>
              <button
                type="button"
                onClick={() => void apiDownload('/api/excel/export/accession', 'HIT-CE-Inventory-Report.xlsx')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                XLSX
              </button>
              <button
                type="button"
                onClick={() =>
                  exportCsv(
                    'category-inventory',
                    ['Category', 'Titles', 'Total Copies', 'Available', 'Issued', 'Valuation INR'],
                    reportData.inventoryByCategory.map((r: any) => [
                      r.category,
                      r.titles,
                      r.totalCopies,
                      r.availableCopies,
                      r.issuedCopies,
                      r.valuationInr,
                    ])
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900 whitespace-nowrap shrink-0"
              >
                CSV
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Top Categories by Asset Valuation (INR)
              </h2>
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={reportData.inventoryByCategory.slice(0, 8)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="category" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(0, 10)} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="valuationInr" name="Valuation (INR)" fill="#0f294d" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Fine Collection Summary (INR)</h2>
              <div className="mt-4 divide-y divide-slate-100 text-xs dark:divide-slate-800">
                {reportData.fineSummary.map((f: any) => (
                  <div key={f.status} className="flex items-center justify-between py-2.5">
                    <div>
                      <span className="font-semibold text-slate-900 dark:text-white">{f.status.replace('_', ' ')}</span>
                      <span className="ml-2 text-slate-500">({f.count} records)</span>
                    </div>
                    <div className="font-mono">
                      Total {formatInr(f.totalInr)} · Paid {formatInr(f.paidInr)}
                    </div>
                  </div>
                ))}
              </div>

              <h3 className="mt-6 text-sm font-semibold text-slate-900 dark:text-white">
                Lost, Damaged & Under Maintenance Copies ({reportData.lostAndDamaged.length})
              </h3>
              <div className="mt-2 divide-y divide-slate-100 text-xs dark:divide-slate-800">
                {reportData.lostAndDamaged.map((c: any) => (
                  <div key={c.accession_number} className="flex items-center justify-between py-2">
                    <div className="min-w-0">
                      <span className="font-mono font-semibold text-[#0f294d] dark:text-cyan-400">
                        {c.accession_number}
                      </span>{' '}
                      · {c.title}
                    </div>
                    <span className="shrink-0 font-semibold text-red-600 dark:text-red-400">{c.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-4 py-3 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-300">
              Category-Wise Inventory Breakdown
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                    <th className="px-4 py-2.5">Category</th>
                    <th className="px-4 py-2.5 text-right">Titles</th>
                    <th className="px-4 py-2.5 text-right">Total Copies</th>
                    <th className="px-4 py-2.5 text-right">Available</th>
                    <th className="px-4 py-2.5 text-right">Issued</th>
                    <th className="px-4 py-2.5 text-right">Valuation (INR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {reportData.inventoryByCategory.map((r: any) => (
                    <tr key={r.category}>
                      <td className="px-4 py-2.5 font-medium">{r.category}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{r.titles}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold">{r.totalCopies}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-emerald-700">{r.availableCopies}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-[#1d4ed8]">{r.issuedCopies}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatInr(r.valuationInr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* NOTIFICATIONS */}
      {mode === 'notifications' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                Notification Centre
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Alerts for book issues, returns, due dates, reservations, fines, and acquisition requests.
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                await apiFetch('/api/notifications/read-all', { method: 'POST' });
                await load();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-900 whitespace-nowrap shrink-0"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark All Read
            </button>
          </div>

          <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {notifications.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-500">No notifications yet.</p>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`flex items-start justify-between gap-4 p-4 ${
                    n.is_read ? '' : 'bg-blue-50/40 dark:bg-blue-950/20'
                  }`}
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">
                      {n.title}{' '}
                      {!n.is_read && <span className="ml-2 text-xs font-medium text-[#1d4ed8]">Unread</span>}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{n.message}</p>
                    <div className="mt-1 font-mono text-[11px] text-slate-400">
                      {n.type} · {formatDateTime(n.created_at)}
                    </div>
                  </div>
                  {!n.is_read && (
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/notifications/${n.id}/read`, { method: 'PATCH' });
                        await load();
                      }}
                      className="text-xs font-medium text-[#1d4ed8] hover:underline whitespace-nowrap shrink-0"
                    >
                      Mark Read
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ADMIN: USER MANAGEMENT */}
      {mode === 'users' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                User & Librarian Account Management
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Create librarian and staff accounts, manage roles, and activate or deactivate users.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddUser(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f294d] px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              Create User Account
            </button>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                    <th className="px-4 py-3">Name & Email</th>
                    <th className="px-4 py-3">Member Code</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900 dark:text-white">{u.full_name}</div>
                        <div className="text-slate-500">{u.email}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-400">
                        {u.member_code || 'Staff'}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          aria-label={`Role for ${u.full_name}`}
                          value={u.role}
                          onChange={async (e) => {
                            await apiFetch(`/api/admin/users/${u.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ role: e.target.value }),
                            });
                            await load();
                          }}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950"
                        >
                          <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                          <option value="LIBRARIAN">LIBRARIAN</option>
                          <option value="FACULTY">FACULTY</option>
                          <option value="STUDENT">STUDENT</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          aria-label={`Status for ${u.full_name}`}
                          value={u.status}
                          onChange={async (e) => {
                            await apiFetch(`/api/admin/users/${u.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ status: e.target.value }),
                            });
                            await load();
                          }}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950"
                        >
                          <option value="ACTIVE">ACTIVE</option>
                          <option value="INACTIVE">INACTIVE</option>
                          <option value="SUSPENDED">SUSPENDED</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {showAddUser && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
              <form
                onSubmit={handleAddUser}
                className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
              >
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Create Institutional Account</h2>
                <div className="mt-4 space-y-3">
                  <input
                    required
                    placeholder="Full Name"
                    value={newUser.fullName}
                    onChange={(e) => setNewUser({ ...newUser, fullName: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                  <input
                    type="email"
                    required
                    placeholder="Institutional Email"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                  <input
                    type="password"
                    required
                    minLength={6}
                    placeholder="Initial Password (min 6 chars)"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="LIBRARIAN">LIBRARIAN</option>
                    <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                    <option value="FACULTY">FACULTY</option>
                    <option value="STUDENT">STUDENT</option>
                  </select>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" onClick={() => setShowAddUser(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold">
                    Cancel
                  </button>
                  <button type="submit" className="rounded-lg bg-[#0f294d] px-4 py-2 text-xs font-semibold text-white">
                    Create Account
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* ADMIN: ROLE PERMISSIONS MATRIX */}
      {mode === 'role-permissions' && roleMatrix && (
        <div className="space-y-4">
          <div className="border-b border-slate-200 pb-4 dark:border-slate-800">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Role-Based Access Control (RBAC) Matrix
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Permissions enforced on both Express REST API endpoints and frontend navigation modules.
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                    <th className="px-4 py-3">Permission Code</th>
                    {roleMatrix.roles.map((r: any) => (
                      <th key={r.id} className="px-4 py-3 text-center">
                        {r.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {roleMatrix.permissions.map((p: any) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2.5 font-mono">{p.code}</td>
                      {roleMatrix.roles.map((r: any) => {
                        const granted = roleMatrix.mappings.some(
                          (m: any) => m.role_id === r.id && m.permission_id === p.id
                        );
                        return (
                          <td
                            key={r.id}
                            className={`px-4 py-2.5 text-center font-semibold ${
                              granted ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-300 dark:text-slate-700'
                            }`}
                          >
                            {granted ? 'Allowed' : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ADMIN: DEPARTMENT SETTINGS & CONFIGURABLE LOGOS */}
      {mode === 'department-settings' && settings && (
        <div className="space-y-6">
          <div className="border-b border-slate-200 pb-4 dark:border-slate-800">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Institution & Department Branding Settings
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Upload official Haldia Institute of Technology and Department of Civil Engineering logos and configure departments.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Logo Uploaders */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Official Institutional Logos (Configurable Uploads)
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                No fabricated logos are bundled. Upload verified official institute and department emblems below.
              </p>

              <div className="mt-4 space-y-4">
                <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-3.5 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    {settings.institution_logo_url ? (
                      <img
                        src={settings.institution_logo_url}
                        alt="Haldia Institute of Technology Logo"
                        referrerPolicy="no-referrer"
                        className="h-12 w-12 rounded border border-slate-200 bg-white object-contain p-1"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded border border-dashed border-slate-300 text-[10px] text-slate-400">
                        HIT
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-white">
                        1. Haldia Institute of Technology Logo
                      </div>
                      <div className="text-[11px] text-slate-500">PNG, SVG, JPG or WebP (max 5MB)</div>
                    </div>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#0f294d] px-3 py-1.5 text-xs font-semibold text-white">
                    <Upload className="h-3.5 w-3.5" />
                    Upload
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => void handleLogoUpload(e, 'institution')}
                      className="hidden"
                    />
                  </label>
                </div>

                <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-3.5 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    {settings.department_logo_url ? (
                      <img
                        src={settings.department_logo_url}
                        alt="Department of Civil Engineering Logo"
                        referrerPolicy="no-referrer"
                        className="h-12 w-12 rounded border border-slate-200 bg-white object-contain p-1"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded border border-dashed border-slate-300 text-[10px] text-slate-400">
                        CE
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-white">
                        2. Department of Civil Engineering Logo
                      </div>
                      <div className="text-[11px] text-slate-500">PNG, SVG, JPG or WebP (max 5MB)</div>
                    </div>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#0f294d] px-3 py-1.5 text-xs font-semibold text-white">
                    <Upload className="h-3.5 w-3.5" />
                    Upload
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => void handleLogoUpload(e, 'department')}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* Institutional Details Form */}
            <form
              onSubmit={handleSaveSettings}
              className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
            >
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Institutional Details</h2>
              <div>
                <label className="block text-xs font-semibold">Institution Name</label>
                <input
                  value={settings.institution_name}
                  onChange={(e) => setSettings({ ...settings, institution_name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold">Department Name</label>
                <input
                  value={settings.department_name}
                  onChange={(e) => setSettings({ ...settings, department_name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold">Location</label>
                  <input
                    value={settings.location}
                    onChange={(e) => setSettings({ ...settings, location: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold">Academic Session</label>
                  <input
                    value={settings.academic_session}
                    onChange={(e) => setSettings({ ...settings, academic_session: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f294d] px-4 py-2 text-xs font-semibold text-white"
              >
                <Save className="h-3.5 w-3.5" />
                Save Institutional Settings
              </button>
            </form>
          </div>

          {/* Departments List & Add */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Configured Departments</h2>
            <div className="mt-3 divide-y divide-slate-100 text-xs dark:divide-slate-800">
              {departments.map((d) => (
                <div key={d.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <span className="font-mono font-bold text-[#0f294d] dark:text-cyan-400">{d.code}</span> ·{' '}
                    <span className="font-semibold">{d.name}</span>
                  </div>
                  <span className="text-slate-500">{d.hod_name || d.location || '—'}</span>
                </div>
              ))}
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await apiFetch('/api/admin/departments', { method: 'POST', body: JSON.stringify(newDept) });
                setNewDept({ code: '', name: '', hodName: '', location: '' });
                await load();
              }}
              className="mt-4 grid grid-cols-1 gap-2 border-t border-slate-100 pt-4 dark:border-slate-800 sm:grid-cols-4"
            >
              <input
                required
                placeholder="Code (e.g. ME)"
                value={newDept.code}
                onChange={(e) => setNewDept({ ...newDept, code: e.target.value })}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
              />
              <input
                required
                placeholder="Department Name"
                value={newDept.name}
                onChange={(e) => setNewDept({ ...newDept, name: e.target.value })}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
              />
              <input
                placeholder="Head of Department"
                value={newDept.hodName}
                onChange={(e) => setNewDept({ ...newDept, hodName: e.target.value })}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
              />
              <button
                type="submit"
                className="rounded-lg bg-[#0f294d] px-3 py-1.5 text-xs font-semibold text-white"
              >
                Add Department
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ADMIN: LIBRARY POLICIES & ACCESSION CONFIG */}
      {mode === 'library-policies' && settings && (
        <form onSubmit={handleSaveSettings} className="space-y-6">
          <div className="border-b border-slate-200 pb-4 dark:border-slate-800">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Borrowing Policies, Fine Rules & Accession Sequence
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              All operational limits and accession numbering rules are configurable from the database — zero hardcoded policies.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Borrowing & Fine Policies</h2>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold">Student Borrow Limit</label>
                  <input
                    type="number"
                    min={1}
                    value={settings.student_borrow_limit}
                    onChange={(e) => setSettings({ ...settings, student_borrow_limit: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold">Faculty Borrow Limit</label>
                  <input
                    type="number"
                    min={1}
                    value={settings.faculty_borrow_limit}
                    onChange={(e) => setSettings({ ...settings, faculty_borrow_limit: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold">Student Loan Duration (Days)</label>
                  <input
                    type="number"
                    min={1}
                    value={settings.student_loan_days}
                    onChange={(e) => setSettings({ ...settings, student_loan_days: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold">Faculty Loan Duration (Days)</label>
                  <input
                    type="number"
                    min={1}
                    value={settings.faculty_loan_days}
                    onChange={(e) => setSettings({ ...settings, faculty_loan_days: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold">Maximum Renewals</label>
                  <input
                    type="number"
                    min={0}
                    value={settings.max_renewals}
                    onChange={(e) => setSettings({ ...settings, max_renewals: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold">Reservation Expiry (Hours)</label>
                  <input
                    type="number"
                    min={1}
                    value={settings.reservation_expiry_hours}
                    onChange={(e) => setSettings({ ...settings, reservation_expiry_hours: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold">Fine Per Overdue Day (INR)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={settings.fine_per_day_inr}
                    onChange={(e) => setSettings({ ...settings, fine_per_day_inr: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold">Maximum Fine Cap (INR)</label>
                  <input
                    type="number"
                    min={0}
                    value={settings.max_fine_inr}
                    onChange={(e) => setSettings({ ...settings, max_fine_inr: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Accession Register Sequence Format</h2>
              <div>
                <label className="block text-xs font-semibold">Accession Prefix</label>
                <input
                  value={settings.accession_prefix}
                  onChange={(e) => setSettings({ ...settings, accession_prefix: e.target.value.toUpperCase() })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold">Year Format</label>
                <select
                  value={settings.accession_year_format}
                  onChange={(e) => setSettings({ ...settings, accession_year_format: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="CALENDAR">Calendar Year (e.g. HIT-CE-2026-0001)</option>
                  <option value="ACADEMIC">Academic Year (e.g. HIT-CE-2026-27-0001)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold">Minimum Starting Sequence</label>
                <input
                  type="number"
                  min={1}
                  value={settings.accession_start_sequence}
                  onChange={(e) => setSettings({ ...settings, accession_start_sequence: Number(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={Boolean(settings.email_notifications_on)}
                  onChange={(e) => setSettings({ ...settings, email_notifications_on: e.target.checked ? 1 : 0 })}
                />
                Enable optional SMTP Email Notifications (requires server SMTP env configuration)
              </label>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f294d] px-5 py-2.5 text-xs font-semibold text-white"
            >
              <Save className="h-4 w-4" />
              Save All Policies
            </button>
          </div>
        </form>
      )}

      {/* ADMIN: AUDIT LOGS */}
      {mode === 'audit-logs' && (
        <div className="space-y-4">
          <div className="border-b border-slate-200 pb-4 dark:border-slate-800">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              System Audit Logs
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Immutable trail of authentication, accession registrations, circulation operations, Excel imports, and policy updates.
            </p>
          </div>

          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={auditQuery}
              onChange={(e) => setAuditQuery(e.target.value)}
              placeholder="Search action, actor, accession no., or details..."
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Actor & Role</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Entity</th>
                    <th className="px-4 py-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="px-4 py-2.5 font-mono whitespace-nowrap">{formatDateTime(log.created_at)}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-900 dark:text-white">{log.actor_name}</div>
                        <div className="font-mono text-[10px] text-slate-500">{log.actor_role}</div>
                      </td>
                      <td className="px-4 py-2.5 font-mono font-semibold text-[#0f294d] dark:text-cyan-400">
                        {log.action}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-400">
                        {log.entity_type} {log.entity_id ? `(${log.entity_id})` : ''}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ADMIN: BACKUP & RESTORE */}
      {mode === 'backup-restore' && (
        <div className="space-y-5">
          <div className="border-b border-slate-200 pb-4 dark:border-slate-800">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Database Backup & Institutional Archival
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Export full relational database snapshots in JSON or SQLite binary format for departmental server archival.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
              <Database className="h-6 w-6 text-[#0f294d] dark:text-cyan-400" />
              <h2 className="mt-3 text-base font-bold text-slate-900 dark:text-white">Full JSON Data Archive</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Downloads every table (books, accession register, copies, circulation, fines, digital resources, audit logs, and settings) as a structured JSON backup suitable for PostgreSQL migration.
              </p>
              <button
                type="button"
                onClick={() => void apiDownload('/api/admin/backup/json', 'HIT-CE-Library-Backup.json')}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#0f294d] px-4 py-2 text-xs font-semibold text-white"
              >
                <Download className="h-3.5 w-3.5" />
                Download JSON Backup
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
              <Database className="h-6 w-6 text-[#0891b2]" />
              <h2 className="mt-3 text-base font-bold text-slate-900 dark:text-white">Persistent SQLite Binary Snapshot</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Downloads the live ACID relational database file directly for cold storage or offline recovery.
              </p>
              <button
                type="button"
                onClick={() => void apiDownload('/api/admin/backup/sqlite', 'HIT-CE-Library.db')}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <Download className="h-3.5 w-3.5" />
                Download .DB Snapshot
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
