import React, { useState } from 'react';
import { BookOpen, Building2, Lock, Mail, ShieldCheck } from 'lucide-react';
import { apiFetch, setSessionToken, type AuthUser, type InstitutionalBranding } from '../lib/api';
import { signInWithGoogleFirebase } from '../lib/firebase';

const DEMO_ROLE_PROFILES = [
  {
    label: 'Super Admin',
    email: 'admin.ce@hithaldia.ac.in',
    pass: 'Admin@HIT2026',
    desc: 'Full ERP governance, policies, backups & audit logs',
  },
  {
    label: 'Librarian',
    email: 'librarian.ce@hithaldia.ac.in',
    pass: 'Librarian@HIT2026',
    desc: 'Accession register, QR/barcode circulation & Excel',
  },
  {
    label: 'Faculty',
    email: 'faculty.ce@hithaldia.ac.in',
    pass: 'Faculty@HIT2026',
    desc: 'Catalogue, renewals, reservations & recommendations',
  },
  {
    label: 'Student',
    email: 'student.ce@hithaldia.ac.in',
    pass: 'Student@HIT2026',
    desc: 'Search catalogue, reservations & digital repository',
  },
];

export function AuthScreen({
  branding,
  onAuthenticated,
}: {
  branding: InstitutionalBranding;
  onAuthenticated: (user: AuthUser) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Please enter both your institutional email and password.');
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      setSessionToken(data.token);
      onAuthenticated(data.user);
    } catch (err: any) {
      setError(err.message || 'Sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const { user: fbUser } = await signInWithGoogleFirebase();
      const data = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/firebase-exchange', {
        method: 'POST',
        body: JSON.stringify({
          uid: fbUser.uid,
          email: fbUser.email,
          displayName: fbUser.displayName || undefined,
          photoUrl: fbUser.photoURL || undefined,
        }),
      });
      setSessionToken(data.token);
      onAuthenticated(data.user);
    } catch (err: any) {
      setError(err?.message || 'Google Sign-In could not be completed in this browser window.');
    } finally {
      setGoogleLoading(false);
    }
  };

  const quickFill = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 items-stretch lg:grid-cols-12">
        {/* Left Institutional Identity Column */}
        <div className="flex flex-col justify-between bg-[#0f294d] p-8 text-white lg:col-span-6 lg:p-12">
          <div>
            <div className="flex items-center gap-4">
              {branding.institutionLogoUrl ? (
                <img
                  src={branding.institutionLogoUrl}
                  alt="Haldia Institute of Technology Logo"
                  referrerPolicy="no-referrer"
                  className="h-14 w-14 rounded-lg bg-white object-contain p-1.5"
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-white/20 bg-white/10">
                  <Building2 className="h-7 w-7 text-cyan-300" />
                </div>
              )}

              {branding.departmentLogoUrl && (
                <img
                  src={branding.departmentLogoUrl}
                  alt="Department of Civil Engineering Logo"
                  referrerPolicy="no-referrer"
                  className="h-14 w-14 rounded-lg bg-white object-contain p-1.5"
                />
              )}
            </div>

            <p className="mt-8 text-sm font-medium tracking-wide text-cyan-300">
              {branding.institutionName}
            </p>
            <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
              {branding.applicationName}
            </h1>
            <p className="mt-2 text-base text-slate-200">
              {branding.departmentName} · {branding.location}
            </p>
            <p className="mt-4 text-sm font-medium text-cyan-200">{branding.tagline}</p>

            <div className="mt-10 grid grid-cols-1 gap-4 border-t border-white/15 pt-8 sm:grid-cols-2">
              <div>
                <div className="text-sm font-semibold text-white">Physical Accession Register</div>
                <p className="mt-1 text-xs leading-relaxed text-slate-300">
                  Individual copy tracking with non-reusable sequential accession numbers, Code 128 barcodes, and QR labels.
                </p>
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Scan-Based Circulation</div>
                <p className="mt-1 text-xs leading-relaxed text-slate-300">
                  Transactional issue, return, renewal, overdue fine computation in INR, and PDF receipt generation.
                </p>
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Excel Inventory Migration</div>
                <p className="mt-1 text-xs leading-relaxed text-slate-300">
                  Column-mapped XLSX/XLS/CSV import with duplicate accession checks and multi-sheet formatted exports.
                </p>
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Civil Engineering Repository</div>
                <p className="mt-1 text-xs leading-relaxed text-slate-300">
                  35+ specialized Civil Engineering classifications, IS/IRC/ASTM/NBC references, and departmental notes.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-10 border-t border-white/15 pt-5 text-xs text-slate-300">
            Academic Session {branding.academicSession} · Demonstration dataset records are clearly labelled as Sample Data.
          </div>
        </div>

        {/* Right Sign-In Panel */}
        <div className="flex items-center justify-center p-6 sm:p-10 lg:col-span-6 lg:p-12">
          <div className="w-full max-w-md">
            <div className="flex items-center gap-2.5 text-[#0f294d] dark:text-cyan-400">
              <BookOpen className="h-5 w-5" />
              <span className="text-sm font-semibold">Departmental Library ERP Portal</span>
            </div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Sign in to your account
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Authenticate with your departmental credentials or Google Workspace account.
            </p>

            {error && (
              <div
                role="alert"
                className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label
                  htmlFor="login-email"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Institutional Email
                </label>
                <div className="relative mt-1.5">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="login-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@hithaldia.ac.in"
                    className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#1d4ed8]/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Password
                </label>
                <div className="relative mt-1.5">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="login-password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#1d4ed8]/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-[#0f294d] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#173a6b] disabled:opacity-60 erp-transition"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>

            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
              <span className="text-xs text-slate-500">or continue with</span>
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
            </div>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleLoading}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 erp-transition"
            >
              <ShieldCheck className="h-4 w-4 text-[#1d4ed8]" />
              {googleLoading ? 'Connecting to Google...' : 'Sign in with Google (Firebase Auth)'}
            </button>

            {/* Demonstration Role Accounts Quick-Fill */}
            <div className="mt-7 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Demonstration Accounts (Sample Data)
                </span>
                <span className="text-[11px] text-slate-500">Click to fill credentials</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {DEMO_ROLE_PROFILES.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => quickFill(p.email, p.pass)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left hover:border-[#1d4ed8] hover:bg-blue-50/50 dark:border-slate-700 dark:bg-slate-800/70 dark:hover:border-cyan-500 erp-transition"
                  >
                    <div className="text-xs font-semibold text-[#0f294d] dark:text-cyan-300">
                      {p.label}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500 dark:text-slate-400">
                      {p.email}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
