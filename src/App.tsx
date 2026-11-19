import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArchiveRestore,
  BarChart3,
  Bell,
  BookCopy,
  BookMarked,
  BookOpen,
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Database,
  FileDown,
  FileSpreadsheet,
  FileUp,
  FolderKanban,
  GraduationCap,
  History,
  IndianRupee,
  LayoutDashboard,
  Library,
  LogOut,
  Menu,
  Moon,
  Printer,
  QrCode,
  RefreshCw,
  RotateCcw,
  ScanLine,
  ScrollText,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Sun,
  Tag,
  UserCheck,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import {
  apiFetch,
  setSessionToken,
  type AuthUser,
  type InstitutionalBranding,
} from './lib/api';
import { signOutFirebase, testFirestoreConnection } from './lib/firebase';
import { hasRolePermission } from './lib/libraryRules';
import { AuthScreen } from './components/AuthScreen';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DashboardView } from './views/DashboardView';
import { CatalogueView } from './views/CatalogueView';
import { AccessionView } from './views/AccessionView';
import { CirculationView } from './views/CirculationView';
import { ExcelView } from './views/ExcelView';
import { MembersDigitalAcqView } from './views/MembersDigitalAcqView';
import { ReportsAdminView } from './views/ReportsAdminView';

type ViewId =
  | 'dashboard'
  | 'catalogue'
  | 'advanced-search'
  | 'digital-library'
  | 'accession'
  | 'copies'
  | 'qr-generator'
  | 'label-printing'
  | 'excel-import'
  | 'excel-export'
  | 'issue'
  | 'return'
  | 'renew'
  | 'scan'
  | 'reservations'
  | 'overdue'
  | 'fines'
  | 'students'
  | 'faculty'
  | 'member-history'
  | 'acquisition-requests'
  | 'categories'
  | 'publishers'
  | 'authors'
  | 'reports'
  | 'notifications'
  | 'users'
  | 'role-permissions'
  | 'department-settings'
  | 'library-policies'
  | 'audit-logs'
  | 'backup-restore';

interface NavItem {
  id: ViewId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
  anyPermissions?: string[];
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'MAIN',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'catalogue', label: 'Book Catalogue', icon: BookOpen, permission: 'catalogue.view' },
      { id: 'advanced-search', label: 'Advanced Search', icon: Search, permission: 'search.advanced' },
      { id: 'digital-library', label: 'Digital Library', icon: Library, permission: 'digital.view' },
    ],
  },
  {
    title: 'INVENTORY',
    items: [
      { id: 'accession', label: 'Accession Register', icon: ClipboardList, permission: 'accession.manage' },
      { id: 'copies', label: 'Physical Book Copies', icon: BookCopy, permission: 'copies.manage' },
      { id: 'qr-generator', label: 'QR / Barcode Generator', icon: QrCode, permission: 'labels.generate' },
      { id: 'label-printing', label: 'Label Printing', icon: Printer, permission: 'labels.generate' },
      { id: 'excel-import', label: 'Excel Import', icon: FileUp, permission: 'excel.import' },
      { id: 'excel-export', label: 'Excel Export', icon: FileDown, permission: 'excel.export' },
    ],
  },
  {
    title: 'CIRCULATION',
    items: [
      { id: 'scan', label: 'Scan & Issue', icon: ScanLine, permission: 'circulation.scan' },
      { id: 'issue', label: 'Issue Books', icon: BookMarked, permission: 'circulation.issue' },
      { id: 'return', label: 'Return Books', icon: RotateCcw, permission: 'circulation.return' },
      {
        id: 'renew',
        label: 'Renew Books',
        icon: RefreshCw,
        anyPermissions: ['circulation.renew', 'circulation.renew_self'],
      },
      { id: 'reservations', label: 'Reservations', icon: ArchiveRestore, permission: 'reservations.view' },
      { id: 'overdue', label: 'Overdue Books', icon: AlertTriangle, permission: 'overdue.manage' },
      { id: 'fines', label: 'Fine Management', icon: IndianRupee, permission: 'fines.manage' },
    ],
  },
  {
    title: 'MEMBERS',
    items: [
      { id: 'students', label: 'Students', icon: GraduationCap, permission: 'members.students' },
      { id: 'faculty', label: 'Faculty', icon: UserCheck, permission: 'members.faculty' },
      { id: 'member-history', label: 'Member History', icon: History, permission: 'members.history' },
    ],
  },
  {
    title: 'MANAGEMENT',
    items: [
      { id: 'acquisition-requests', label: 'Acquisition Requests', icon: FileSpreadsheet, permission: 'acquisitions.request' },
      { id: 'categories', label: 'Categories', icon: Tag, permission: 'taxonomy.manage' },
      { id: 'publishers', label: 'Publishers', icon: Building2, permission: 'taxonomy.manage' },
      { id: 'authors', label: 'Authors', icon: Users, permission: 'taxonomy.manage' },
      { id: 'reports', label: 'Reports & Analytics', icon: BarChart3, permission: 'reports.view' },
      { id: 'notifications', label: 'Notifications', icon: Bell, permission: 'notifications.view' },
    ],
  },
  {
    title: 'ADMINISTRATION',
    items: [
      { id: 'users', label: 'User Management', icon: UserCog, permission: 'admin.users' },
      { id: 'role-permissions', label: 'Role Permissions', icon: Shield, permission: 'admin.roles' },
      { id: 'department-settings', label: 'Department Settings', icon: Settings, permission: 'admin.department' },
      { id: 'library-policies', label: 'Library Policies', icon: SlidersHorizontal, permission: 'admin.policies' },
      { id: 'audit-logs', label: 'Audit Logs', icon: ScrollText, permission: 'admin.audit' },
      { id: 'backup-restore', label: 'Backup & Restore', icon: Database, permission: 'admin.backup' },
    ],
  },
];

const DEFAULT_BRANDING: InstitutionalBranding = {
  institutionName: 'Haldia Institute of Technology',
  departmentName: 'Department of Civil Engineering',
  location: 'Haldia, West Bengal, India',
  applicationName: 'HIT Civil Engineering – Digital Library',
  tagline: 'Knowledge. Research. Innovation.',
  academicSession: '2025-2026',
  institutionLogoUrl: null,
  departmentLogoUrl: null,
};

function canSeeItem(role: AuthUser['role'], item: NavItem): boolean {
  if (item.permission) return hasRolePermission(role, item.permission);
  if (item.anyPermissions) {
    return item.anyPermissions.some((p) => hasRolePermission(role, p));
  }
  return true;
}

function LibraryErpApp() {
  const [branding, setBranding] = useState<InstitutionalBranding>(DEFAULT_BRANDING);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [activeView, setActiveView] = useState<ViewId>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [darkMode, setDarkMode] = useState(false);

  const loadBranding = useCallback(async () => {
    try {
      const data = await apiFetch<InstitutionalBranding>('/api/public/branding');
      setBranding(data);
    } catch {
      // keep default branding
    }
  }, []);

  const loadUnreadCount = useCallback(async () => {
    try {
      const res = await apiFetch<{ unreadCount: number }>('/api/notifications');
      setUnreadNotifications(Number(res.unreadCount || 0));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void testFirestoreConnection();
    const savedTheme = (() => {
      try {
        return localStorage.getItem('hit_ce_lib_theme');
      } catch {
        return null;
      }
    })();
    if (savedTheme === 'dark') {
      setDarkMode(true);
      document.documentElement.classList.add('dark');
    }

    (async () => {
      await loadBranding();
      try {
        const res = await apiFetch<{ user: AuthUser | null }>('/api/auth/session');
        if (res?.user) {
          setUser(res.user);
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      } finally {
        setInitializing(false);
      }
    })();
  }, [loadBranding]);

  useEffect(() => {
    if (user) {
      void loadUnreadCount();
    }
  }, [user, activeView, loadUnreadCount]);

  const toggleTheme = () => {
    setDarkMode((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle('dark', next);
      try {
        localStorage.setItem('hit_ce_lib_theme', next ? 'dark' : 'light');
      } catch {
        // ignore
      }
      return next;
    });
  };

  const visibleSections = useMemo(() => {
    if (!user) return [];
    return NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => canSeeItem(user.role, item)),
    })).filter((section) => section.items.length > 0);
  }, [user]);

  const allowedViewIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of visibleSections) {
      for (const i of s.items) set.add(i.id);
    }
    return set;
  }, [visibleSections]);

  const navigate = useCallback(
    (target: string) => {
      if (allowedViewIds.has(target)) {
        setActiveView(target as ViewId);
      } else {
        setActiveView('dashboard');
      }
      setMobileMenuOpen(false);
    },
    [allowedViewIds]
  );

  const handleGlobalSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittedSearch(globalSearch.trim());
    navigate('advanced-search');
  };

  const handleSignOut = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // continue sign out
    }
    setSessionToken(null);
    await signOutFirebase();
    setUser(null);
    setActiveView('dashboard');
  };

  const handleAuthenticated = (authenticatedUser: AuthUser) => {
    setUser(authenticatedUser);
    setActiveView('dashboard');
    void loadBranding();
  };

  if (initializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[#0f294d] text-white">
            <BookOpen className="h-6 w-6" />
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">
            {branding.applicationName}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Loading departmental library workspace...
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen branding={branding} onAuthenticated={handleAuthenticated} />;
  }

  const currentNavMeta = visibleSections
    .flatMap((s) => s.items)
    .find((item) => item.id === activeView);

  const renderActiveView = () => {
    switch (activeView) {
      case 'dashboard':
        return <DashboardView user={user} onNavigate={navigate} />;
      case 'catalogue':
        return <CatalogueView user={user} mode="catalogue" />;
      case 'advanced-search':
        return (
          <CatalogueView
            user={user}
            mode="advanced-search"
            initialQuery={submittedSearch}
          />
        );
      case 'accession':
      case 'copies':
      case 'qr-generator':
      case 'label-printing':
        return <AccessionView mode={activeView} branding={branding} />;
      case 'excel-import':
      case 'excel-export':
        return <ExcelView mode={activeView} />;
      case 'scan':
      case 'issue':
      case 'return':
      case 'renew':
      case 'reservations':
      case 'overdue':
      case 'fines':
        return <CirculationView mode={activeView} user={user} />;
      case 'students':
      case 'faculty':
      case 'member-history':
      case 'digital-library':
      case 'acquisition-requests':
      case 'categories':
      case 'publishers':
      case 'authors':
        return <MembersDigitalAcqView mode={activeView} user={user} />;
      case 'reports':
      case 'notifications':
      case 'users':
      case 'role-permissions':
      case 'department-settings':
      case 'library-policies':
      case 'audit-logs':
      case 'backup-restore':
        return (
          <ReportsAdminView
            mode={activeView}
            onBrandingUpdated={loadBranding}
          />
        );
      default:
        return <DashboardView user={user} onNavigate={navigate} />;
    }
  };

  const renderSidebarContent = (collapsed: boolean) => (
    <div className="flex h-full flex-col bg-[#0b1f3b] text-slate-200">
      {/* Sidebar Institutional Brand Header */}
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {branding.institutionLogoUrl ? (
            <img
              src={branding.institutionLogoUrl}
              alt="HIT Logo"
              className="h-9 w-9 shrink-0 rounded-lg bg-white object-contain p-0.5"
            />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-cyan-300">
              <Building2 className="h-5 w-5" />
            </div>
          )}
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-xs font-bold tracking-wide text-white">
                HIT CIVIL LIBRARY
              </p>
              <p className="text-[10px] leading-tight tracking-tight text-cyan-300 whitespace-nowrap">
                {branding.tagline}
              </p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setSidebarCollapsed((c) => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="hidden h-7 w-7 items-center justify-center rounded-md text-slate-300 hover:bg-white/10 hover:text-white lg:flex"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Close navigation menu"
          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-300 hover:bg-white/10 hover:text-white lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Role-filtered Navigation Sections */}
      <nav aria-label="Primary library navigation" className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4">
        {visibleSections.map((section) => (
          <div key={section.title}>
            {!collapsed && (
              <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                {section.title}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = activeView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate(item.id)}
                    title={collapsed ? item.label : undefined}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium erp-transition ${
                      active
                        ? 'bg-[#1d4ed8] text-white shadow-xs'
                        : 'text-slate-300 hover:bg-white/10 hover:text-white'
                    } ${collapsed ? 'justify-center px-2' : ''}`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-white' : 'text-slate-400'}`} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {!collapsed && item.id === 'notifications' && unreadNotifications > 0 && (
                      <span className="ml-auto rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-200 tabular-nums">
                        {unreadNotifications}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Sidebar Footer Account Summary */}
      <div className="shrink-0 border-t border-white/10 p-3">
        {!collapsed ? (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-white">{user.fullName}</p>
              <p className="truncate text-[11px] text-slate-400">
                {user.role.replace('_', ' ')} {user.memberCode ? `· ${user.memberCode}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              title="Sign out"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleSignOut}
            title="Sign out"
            className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[#f8fafc] text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Desktop Collapsible Sidebar */}
      <aside
        className={`no-print hidden shrink-0 lg:block ${
          sidebarCollapsed ? 'w-[68px]' : 'w-[256px]'
        } erp-transition`}
      >
        <div className="sticky top-0 h-screen">{renderSidebarContent(sidebarCollapsed)}</div>
      </aside>

      {/* Mobile Drawer Sidebar */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative z-10 h-full w-72 max-w-[85vw]">
            {renderSidebarContent(false)}
          </div>
        </div>
      )}

      {/* Main Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Institutional Navigation Bar */}
        <header className="no-print sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur-xs dark:border-slate-800 dark:bg-slate-900/95 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="flex min-w-0 items-center gap-2.5">
              {branding.departmentLogoUrl && (
                <img
                  src={branding.departmentLogoUrl}
                  alt="Civil Engineering Department Logo"
                  className="hidden h-9 w-9 shrink-0 rounded-md border border-slate-200 bg-white object-contain p-0.5 sm:block"
                />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[#0f294d] dark:text-white">
                  {branding.institutionName}
                </p>
                <p className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {branding.departmentName} · {currentNavMeta?.label || 'Dashboard'}
                </p>
              </div>
            </div>
          </div>

          {/* Global Search Bar */}
          <form
            onSubmit={handleGlobalSearchSubmit}
            className="hidden max-w-md flex-1 md:block"
          >
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="Search books, ISBN, accession number, IS codes..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#1d4ed8] focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </form>

          {/* Right Action Controls */}
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('notifications')}
              title="Notifications"
              className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Bell className="h-4 w-4" />
              {unreadNotifications > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded bg-[#1d4ed8] px-1 text-[10px] font-bold text-white tabular-nums">
                  {unreadNotifications > 99 ? '99+' : unreadNotifications}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              title={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
              aria-label="Toggle light or dark theme"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <div className="hidden items-center gap-2.5 border-l border-slate-200 pl-3 dark:border-slate-800 sm:flex">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0f294d] text-xs font-bold text-white">
                {user.fullName
                  .split(' ')
                  .slice(0, 2)
                  .map((p) => p[0])
                  .join('')
                  .toUpperCase()}
              </div>
              <div className="text-right">
                <p className="max-w-[150px] truncate text-xs font-semibold text-slate-900 dark:text-white">
                  {user.fullName}
                </p>
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {user.role.replace('_', ' ')}
                </p>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                title="Sign out"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </header>

        {/* Main Workspace Canvas */}
        <main className="mx-auto w-full max-w-[1560px] flex-1 p-4 lg:p-6">
          {renderActiveView()}
        </main>

        {/* Institutional Academic Footer */}
        <footer className="no-print border-t border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 lg:px-6">
          <div className="mx-auto flex max-w-[1560px] flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
            <p className="font-medium text-slate-700 dark:text-slate-300">
              {branding.applicationName} · {branding.institutionName}, {branding.location}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Functional reference: vinitshahdeo/Library-Management-System (MIT License) · Session {branding.academicSession}
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <LibraryErpApp />
    </ErrorBoundary>
  );
}
