import React from 'react';

type View = 'dashboard' | 'universe' | 'analyze' | 'pipeline';

interface SidebarProps {
  activeView: View;
  onNavigate: (v: View) => void;
  collapsed: boolean;
  onToggle: () => void;
  status: {
    db: 'ok' | 'bad' | 'loading';
    worker: 'ok' | 'warn' | 'bad' | 'loading';
    llm: 'ok' | 'warn' | 'bad' | 'loading';
  };
}

const navItems: { id: View; label: string; icon: React.ReactNode }[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
        <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
      </svg>
    ),
  },
  {
    id: 'universe',
    label: 'Universe',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
    ),
  },
  {
    id: 'analyze',
    label: 'Analyze',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      </svg>
    ),
  },
  {
    id: 'pipeline',
    label: 'Pipeline',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
];

const dotColor: Record<string, string> = {
  ok: 'bg-green-500 shadow-[0_0_6px_#22c55e]',
  warn: 'bg-amber-500 shadow-[0_0_6px_#f59e0b]',
  bad: 'bg-red-500 shadow-[0_0_6px_#ef4444]',
  loading: 'bg-slate-500 animate-pulse',
};

export default function Sidebar({ activeView, onNavigate, collapsed, status }: SidebarProps) {
  return (
    <aside
      className={`fixed top-0 left-0 h-full z-30 flex flex-col transition-all duration-300 glass border-r border-white/[0.07] ${
        collapsed ? 'w-0 -translate-x-full lg:w-16 lg:translate-x-0' : 'w-60'
      }`}
    >
      {/* Brand */}
      <div className={`flex items-center gap-3 px-4 py-5 border-b border-white/[0.07] ${collapsed ? 'justify-center px-2' : ''}`}>
        <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0 glow-accent">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
            <polyline points="16 7 22 7 22 13"/>
          </svg>
        </div>
        {!collapsed && (
          <div>
            <div className="font-bold text-slate-100 tracking-tight text-sm">AlphaLens</div>
            <div className="text-[10px] text-slate-500 font-medium uppercase tracking-widest">Equity Research</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-hidden">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group
              ${activeView === item.id
                ? 'bg-indigo-600/20 text-indigo-400 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.3)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.05]'
              }
              ${collapsed ? 'justify-center' : ''}`}
          >
            <span className={`shrink-0 transition-colors ${activeView === item.id ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'}`}>
              {item.icon}
            </span>
            {!collapsed && <span>{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* Status */}
      {!collapsed && (
        <div className="px-4 py-4 border-t border-white/[0.07] space-y-2.5">
          <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold mb-3">System Status</div>
          {[
            { label: 'Database', key: 'db' as const, val: status.db === 'ok' ? 'Connected' : status.db === 'loading' ? '…' : 'Error' },
            { label: 'Worker', key: 'worker' as const, val: status.worker === 'ok' ? 'Online' : status.worker === 'warn' ? 'Offline' : status.worker === 'loading' ? '…' : 'Error' },
            { label: 'LLM', key: 'llm' as const, val: status.llm === 'ok' ? 'Ready' : status.llm === 'warn' ? 'Unconfigured' : status.llm === 'loading' ? '…' : 'Error' },
          ].map(({ label, key, val }) => (
            <div key={key} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor[status[key]]}`} />
                <span className="text-xs text-slate-400">{label}</span>
              </div>
              <span className="text-xs text-slate-500">{val}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
