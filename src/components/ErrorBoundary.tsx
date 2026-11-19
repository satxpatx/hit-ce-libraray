import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || 'Unexpected application error.' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Application ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
          <div className="max-w-lg rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-6 w-6 shrink-0" />
              <h1 className="text-lg font-semibold">Application Error</h1>
            </div>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              An unexpected error interrupted this view. Your saved library records remain intact.
            </p>
            <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-slate-100 p-3 font-mono text-xs text-slate-700 dark:bg-slate-950 dark:text-slate-300">
              {this.state.message}
            </pre>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#0f294d] px-4 py-2 text-sm font-medium text-white hover:bg-[#173a6b]"
            >
              <RefreshCw className="h-4 w-4" />
              Reload Library Portal
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
