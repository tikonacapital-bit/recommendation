import { useState, useEffect, useCallback } from 'react';
import './index.css';
import Sidebar from './components/Sidebar';
import { ToastProvider, ToastContainer } from './components/Toast';
import DashboardView from './views/DashboardView';
import UniverseView from './views/UniverseView';
import AnalyzeView from './views/AnalyzeView';
import PipelineView from './views/PipelineView';
import PredictionsView from './views/PredictionsView';
import ChartsView from './views/ChartsView';
import { api } from './lib/api';

type View = 'dashboard' | 'universe' | 'analyze' | 'pipeline' | 'predictions' | 'charts';

type StatusLevel = 'ok' | 'warn' | 'bad' | 'loading';

interface SysStatus {
  db: StatusLevel;
  worker: StatusLevel;
  llm: StatusLevel;
}

function AppInner() {
  const [view, setView] = useState<View>('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [ticker, setTicker] = useState('');
  const [taskBanner, setTaskBanner] = useState<string | null>(null);
  const [status, setStatus] = useState<SysStatus>({ db: 'loading', worker: 'loading', llm: 'loading' });
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('theme') as 'light' | 'dark') || 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }
    localStorage.setItem('theme', theme);
    window.dispatchEvent(new Event('theme-change'));
  }, [theme]);

  const loadStatus = useCallback(async () => {
    // DB
    try {
      const h = await api<{ database: string }>('/health');
      setStatus(prev => ({ ...prev, db: h.database === 'ok' ? 'ok' : 'bad' }));
    } catch {
      setStatus(prev => ({ ...prev, db: 'bad' }));
    }
    // Worker
    try {
      const w = await api<{ status: string }>('/worker/health');
      setStatus(prev => ({ ...prev, worker: w.status === 'ok' ? 'ok' : 'warn' }));
    } catch {
      setStatus(prev => ({ ...prev, worker: 'bad' }));
    }
    // LLM
    try {
      const l = await api<{ status: string }>('/llm/health');
      setStatus(prev => ({ ...prev, llm: l.status === 'ok' ? 'ok' : 'warn' }));
    } catch {
      setStatus(prev => ({ ...prev, llm: 'bad' }));
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 30000);
    return () => clearInterval(interval);
  }, [loadStatus]);

  const handleNavigate = (v: View) => {
    setView(v);
  };

  const sidebarWidth = collapsed ? 'lg:pl-16' : 'pl-0 lg:pl-60';

  return (
    <div className="min-h-screen bg-[#080c14] relative overflow-x-hidden">
      {/* Animated background orbs */}
      <div className="orb w-96 h-96 bg-indigo-600/10 top-[-10%] left-[10%]" />
      <div className="orb w-80 h-80 bg-purple-600/8 top-[40%] right-[5%]" />
      <div className="orb w-64 h-64 bg-blue-600/6 bottom-[10%] left-[30%]" />

      {/* Grid bg */}
      <div className="fixed inset-0 bg-grid-pattern pointer-events-none z-0" />

      {/* Sidebar */}
      <Sidebar
        activeView={view}
        onNavigate={handleNavigate}
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
        status={status}
      />

      {/* Main */}
      <div className={`relative min-h-screen flex flex-col transition-all duration-300 ${sidebarWidth}`}>
        {/* Topbar */}
        <header className="sticky top-0 z-20 glass border-b border-white/[0.07] px-4 lg:px-6 py-1.5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1">
              {/* Hamburger */}
              <button
                onClick={() => setCollapsed(c => !c)}
                className="p-2 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-slate-200 transition-colors"
                aria-label="Toggle sidebar"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <line x1="3" y1="12" x2="21" y2="12"/>
                  <line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
              </button>

              {/* Search */}
              <div className="relative flex-1 max-w-xs">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl pl-9 pr-10 py-1.5 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all font-mono"
                  placeholder="Search ticker… e.g. TCS.NS"
                  value={ticker}
                  onChange={e => setTicker(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && ticker.trim()) {
                      setView('dashboard');
                    }
                  }}
                  autoComplete="off"
                  spellCheck="false"
                />
                <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-600 bg-white/[0.04] border border-white/[0.07] px-1.5 py-0.5 rounded font-mono">⏎</kbd>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Theme Toggle */}
              <button
                onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
                className="p-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.06] text-slate-400 hover:text-slate-200 transition-colors flex items-center justify-center shrink-0 cursor-pointer"
                title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              >
                {theme === 'dark' ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
                  </svg>
                )}
              </button>

              <button
                onClick={() => {
                  if (ticker.trim()) setView('dashboard');
                }}
                className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.07] transition-all"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10"/>
                  <polyline points="1 20 1 14 7 14"/>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
                Refresh
              </button>

              <button
                onClick={() => {
                  if (ticker.trim()) {
                    setView('analyze');
                  }
                }}
                className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.07] transition-all"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                </svg>
                AI Synthesize
              </button>

              <button
                onClick={() => { setView('pipeline'); }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs bg-indigo-600 hover:bg-indigo-500 text-white transition-colors font-medium"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Run Prefilter
              </button>
            </div>
          </div>
        </header>

        {/* Task Banner */}
        {taskBanner && (
          <div className="mx-4 lg:mx-6 mt-3 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-sm text-indigo-300">
            <div className="w-4 h-4 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin shrink-0" />
            <span>Task queued: </span>
            <code className="font-mono text-xs text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded">{taskBanner}</code>
            <button
              onClick={() => setTaskBanner(null)}
              className="ml-auto text-indigo-400/60 hover:text-indigo-300 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        )}

        {/* Content */}
        <main className="flex-1 px-4 lg:px-6 py-2">
          <div className={view === 'dashboard' ? 'block' : 'hidden'}>
            <DashboardView tickerInput={ticker} onTickerChange={setTicker} />
          </div>
          <div className={view === 'universe' ? 'block' : 'hidden'}>
            <UniverseView
              onSelectTicker={(t) => {
                setTicker(t);
                setView('dashboard');
              }}
            />
          </div>
          <div className={view === 'analyze' ? 'block' : 'hidden'}>
            <AnalyzeView />
          </div>
          <div className={view === 'pipeline' ? 'block' : 'hidden'}>
            <PipelineView />
          </div>
          <div className={view === 'predictions' ? 'block' : 'hidden'}>
            <PredictionsView />
          </div>
          <div className={view === 'charts' ? 'block' : 'hidden'}>
            <ChartsView />
          </div>
        </main>
      </div>

      <ToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
