import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowRight,
  BookCopy,
  FileSpreadsheet,
  Plus,
  QrCode,
  RotateCcw,
  ScanLine,
} from 'lucide-react';
import { apiFetch, formatDate, formatDateTime, formatInr, type AuthUser } from '../lib/api';

const CHART_COLORS = ['#0f294d', '#1d4ed8', '#0891b2', '#0284c7', '#2563eb', '#0e7490', '#334155', '#475569'];

export function DashboardView({
  user,
  onNavigate,
}: {
  user: AuthUser;
  onNavigate: (view: string) => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/dashboard');
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [user.id]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="h-72 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
          <div className="h-72 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
        {error || 'Dashboard data unavailable.'}
      </div>
    );
  }

  if (data.mode === 'STAFF') {
    const s = data.stats;
    const kpis = [
      { label: 'Total Book Titles', value: s.totalTitles, tone: 'text-[#0f294d] dark:text-white' },
      { label: 'Total Physical Copies', value: s.totalCopies, tone: 'text-[#0f294d] dark:text-white' },
      { label: 'Available Copies', value: s.availableCopies, tone: 'text-emerald-700 dark:text-emerald-400' },
      { label: 'Issued Copies', value: s.issuedCopies, tone: 'text-[#1d4ed8] dark:text-blue-400' },
      { label: 'Reserved Copies', value: s.reservedCopies, tone: 'text-[#0891b2] dark:text-cyan-400' },
      { label: 'Overdue Books', value: s.overdueBooks, tone: 'text-red-600 dark:text-red-400' },
      { label: 'Lost Books', value: s.lostBooks, tone: 'text-red-700 dark:text-red-400' },
      { label: 'Damaged Books', value: s.damagedBooks, tone: 'text-amber-700 dark:text-amber-400' },
      { label: 'Total Students', value: s.totalStudents, tone: 'text-slate-900 dark:text-white' },
      { label: 'Total Faculty', value: s.totalFaculty, tone: 'text-slate-900 dark:text-white' },
      { label: 'Added This Year', value: s.booksAddedThisYear, tone: 'text-[#0891b2] dark:text-cyan-400' },
      { label: 'Outstanding Fines', value: formatInr(s.outstandingFines), tone: 'text-amber-700 dark:text-amber-400' },
    ];

    return (
      <div className="space-y-6">
        {/* Header & Quick Actions */}
        <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800 xl:flex-row xl:items-end">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Haldia Institute of Technology · Department of Civil Engineering
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Library Operations Overview
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Live database inventory, circulation telemetry, and acquisition metrics. Demonstration records are clearly flagged as Sample Data.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate('scan')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f294d] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#173a6b] whitespace-nowrap shrink-0"
            >
              <ScanLine className="h-3.5 w-3.5" />
              Scan & Issue
            </button>
            <button
              type="button"
              onClick={() => onNavigate('return')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Return Book
            </button>
            <button
              type="button"
              onClick={() => onNavigate('accession')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <BookCopy className="h-3.5 w-3.5" />
              Accession Register
            </button>
            <button
              type="button"
              onClick={() => onNavigate('excel-import')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Excel Import
            </button>
          </div>
        </div>

        {/* 12 Live KPI Stat Grid */}
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {kpis.map((kpi) => (
            <div
              key={kpi.label}
              className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{kpi.label}</div>
              <div className={`mt-2 font-mono text-xl font-bold tabular-nums ${kpi.tone}`}>
                {kpi.value}
              </div>
            </div>
          ))}
        </div>

        {/* Interactive Charts Grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Monthly Circulation & Overdue Trends */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Monthly Issues, Returns & Overdue Trends
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Real circulation records aggregated by month
                </p>
              </div>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.charts.monthlyCirculation}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="issues" name="Issues" stroke="#0f294d" strokeWidth={2.5} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="returns" name="Returns" stroke="#0891b2" strokeWidth={2.5} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="overdue" name="Overdue" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Category-wise Inventory */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Category-Wise Physical Copy Inventory
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Top 10 Civil Engineering subjects by accessioned copies
              </p>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.charts.categoryInventory} layout="vertical" margin={{ left: 4, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="category"
                    width={175}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: string) => (v.length > 26 ? `${v.slice(0, 25)}…` : v)}
                  />
                  <Tooltip />
                  <Bar dataKey="copies" name="Physical Copies" radius={[0, 4, 4, 0]}>
                    {data.charts.categoryInventory.map((_: unknown, idx: number) => (
                      <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Monthly Acquisitions */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Monthly Acquisition Statistics
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Copies added to the Accession Register by acquisition month
              </p>
            </div>
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.charts.monthlyAcquisitions}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="copiesAdded" name="Copies Accessioned" fill="#1d4ed8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Most Borrowed Books */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Most Borrowed Civil Engineering Titles
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Ranked by completed and active circulation transactions
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="text-xs font-medium text-[#1d4ed8] hover:underline dark:text-cyan-400"
              >
                Full Reports
              </button>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.charts.mostBorrowed.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500">No circulation records yet.</p>
              ) : (
                data.charts.mostBorrowed.map((b: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {b.title}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{b.category}</div>
                    </div>
                    <div className="shrink-0 font-mono text-xs font-semibold text-[#0f294d] dark:text-cyan-400">
                      {b.borrowCount} loans
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Recent Activities & Quick Shortcuts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Recent Departmental Activities
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('audit-logs')}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#1d4ed8] hover:underline dark:text-cyan-400"
              >
                View Audit Log <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.recentActivities.map((act: any) => (
                <div key={act.id} className="flex flex-col justify-between gap-1 py-2.5 sm:flex-row sm:items-center">
                  <div className="min-w-0">
                    <div className="text-sm text-slate-800 dark:text-slate-200">{act.details}</div>
                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {act.actor_name} · {act.actor_role} · {act.action}
                    </div>
                  </div>
                  <div className="shrink-0 font-mono text-xs text-slate-500 dark:text-slate-400">
                    {formatDateTime(act.created_at)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Quick Counter Actions</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Direct shortcuts for daily library operations
            </p>
            <div className="mt-4 space-y-2">
              {[
                { label: 'Add New Book Title', view: 'catalogue', icon: Plus },
                { label: 'Register Physical Copies', view: 'accession', icon: BookCopy },
                { label: 'Print QR / Barcode Labels', view: 'label-printing', icon: QrCode },
                { label: 'Export Accession Register', view: 'excel-export', icon: FileSpreadsheet },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.view}
                    type="button"
                    onClick={() => onNavigate(item.view)}
                    className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3.5 py-2.5 text-left text-sm font-medium text-slate-800 hover:border-[#1d4ed8] hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800 erp-transition"
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="h-4 w-4 text-[#1d4ed8] dark:text-cyan-400" />
                      {item.label}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Student / Faculty Dashboard
  const ms = data.stats;
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {user.role === 'FACULTY' ? 'Faculty Member Portal' : 'Student Member Portal'} · {user.memberCode || user.email}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Welcome, {user.fullName}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Track your issued books, upcoming due dates, reservations, and Civil Engineering digital resources.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onNavigate('catalogue')}
            className="rounded-lg bg-[#0f294d] px-4 py-2 text-xs font-semibold text-white hover:bg-[#173a6b] whitespace-nowrap shrink-0"
          >
            Browse Book Catalogue
          </button>
          <button
            type="button"
            onClick={() => onNavigate('digital-library')}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap shrink-0"
          >
            Digital Library
          </button>
        </div>
      </div>

      {/* Member KPI Row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500">Currently Issued</div>
          <div className="mt-1 font-mono text-2xl font-bold text-[#0f294d] dark:text-white">
            {ms.activeIssued} <span className="text-xs font-normal text-slate-400">/ {ms.borrowLimit}</span>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500">Overdue Books</div>
          <div className="mt-1 font-mono text-2xl font-bold text-red-600 dark:text-red-400">{ms.overdueCount}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500">Active Reservations</div>
          <div className="mt-1 font-mono text-2xl font-bold text-[#0891b2] dark:text-cyan-400">
            {ms.activeReservations}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500">Total Loans History</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-white">{ms.totalHistory}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500">Outstanding Fines</div>
          <div className="mt-1 font-mono text-xl font-bold text-amber-700 dark:text-amber-400">
            {formatInr(ms.unpaidFinesInr)}
          </div>
        </div>
      </div>

      {/* Currently Issued Books & Active Reservations */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Currently Issued Books & Due Dates
          </h2>
          {data.issuedBooks.length === 0 ? (
            <p className="mt-6 text-sm text-slate-500">You have no books currently issued.</p>
          ) : (
            <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              {data.issuedBooks.map((item: any) => (
                <div key={item.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">{item.title}</div>
                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {item.author} · <span className="font-mono">{item.accession_number}</span>
                    </div>
                    <div className="mt-1 font-mono text-xs text-slate-600 dark:text-slate-300">
                      Issued {formatDate(item.issue_date)} · Due {formatDate(item.due_date)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div
                      className={`text-xs font-semibold ${
                        item.status === 'OVERDUE'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {item.status === 'OVERDUE' ? 'Overdue' : 'Active Loan'}
                    </div>
                    {user.role === 'FACULTY' && item.renewal_count < ms.maxRenewals && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await apiFetch('/api/circulation/renew', {
                              method: 'POST',
                              body: JSON.stringify({ issueId: item.id }),
                            });
                            await load();
                          } catch (err: any) {
                            setError(err.message);
                          }
                        }}
                        className="mt-1.5 text-xs font-medium text-[#1d4ed8] hover:underline dark:text-cyan-400"
                      >
                        Renew Loan
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Active Reservations</h2>
            <button
              type="button"
              onClick={() => onNavigate('reservations')}
              className="text-xs font-medium text-[#1d4ed8] hover:underline dark:text-cyan-400"
            >
              Manage All
            </button>
          </div>
          {data.activeReservations.length === 0 ? (
            <p className="mt-6 text-sm text-slate-500">No active reservations. Reserve any book from the catalogue.</p>
          ) : (
            <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              {data.activeReservations.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">{r.title}</div>
                    <div className="text-xs text-slate-500">
                      {r.author} · Queue Position #{r.position || 1}
                    </div>
                  </div>
                  <div className="text-xs font-semibold text-[#0891b2] dark:text-cyan-400">{r.status}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* New Arrivals & Recommended Civil Engineering Books */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">New Arrivals</h2>
          <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {data.newArrivals.map((b: any) => (
              <div key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{b.title}</div>
                  <div className="text-xs text-slate-500">
                    {b.author} · {b.category} · {b.publication_year}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-xs text-emerald-700 dark:text-emerald-400">
                  {b.available_copies} avail
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Recommended Civil Engineering Books
          </h2>
          <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {data.recommendedBooks.map((b: any) => (
              <div key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{b.title}</div>
                  <div className="text-xs text-slate-500">
                    {b.author} · {b.subject}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-xs text-emerald-700 dark:text-emerald-400">
                  {b.available_copies} avail
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Borrowing History */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Borrowing History</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                <th className="py-2 pr-4 font-semibold">Receipt</th>
                <th className="py-2 pr-4 font-semibold">Accession No.</th>
                <th className="py-2 pr-4 font-semibold">Book Title</th>
                <th className="py-2 pr-4 font-semibold">Issued</th>
                <th className="py-2 pr-4 font-semibold">Due</th>
                <th className="py-2 pr-4 font-semibold">Returned</th>
                <th className="py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.borrowingHistory.map((h: any) => (
                <tr key={h.id}>
                  <td className="py-2.5 pr-4 font-mono">{h.receipt_no}</td>
                  <td className="py-2.5 pr-4 font-mono">{h.accession_number}</td>
                  <td className="py-2.5 pr-4 font-medium text-slate-900 dark:text-slate-100">{h.title}</td>
                  <td className="py-2.5 pr-4 font-mono">{formatDate(h.issue_date)}</td>
                  <td className="py-2.5 pr-4 font-mono">{formatDate(h.due_date)}</td>
                  <td className="py-2.5 pr-4 font-mono">{formatDate(h.return_date)}</td>
                  <td className="py-2.5 font-semibold">{h.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
