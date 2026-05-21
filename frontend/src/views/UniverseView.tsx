import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { api, fmt, scoreColor } from '../lib/api';
import type { StockAnalysis, TopResponse } from '../lib/types';
import { useToast } from '../components/Toast';
import DarkSelect from '../components/DarkSelect';

interface Props {
  onSelectTicker: (t: string) => void;
}

const PAGE_SIZE = 100;

const recStyles: Record<string, string> = {
  BUY: 'text-green-400 bg-green-500/10 border-green-500/20',
  HOLD: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  AVOID: 'text-red-400 bg-red-500/10 border-red-500/20',
  PASS_TIER_1: 'text-teal-400 bg-teal-500/10 border-teal-500/20',
  RANK_ONLY: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
};

const recDot: Record<string, string> = {
  BUY: 'bg-green-500',
  HOLD: 'bg-amber-500',
  AVOID: 'bg-red-500',
  PASS_TIER_1: 'bg-teal-500',
  RANK_ONLY: 'bg-slate-600',
};

// Mini score arc for card view
function ScoreArc({ score }: { score: number | null | undefined }) {
  const s = score ?? 0;
  const color = scoreColor(s);
  const deg = `${(s / 100 * 360).toFixed(1)}deg`;
  return (
    <div
      className="relative flex items-center justify-center w-11 h-11 rounded-full shrink-0"
      style={{ background: `conic-gradient(${color} ${deg}, rgba(255,255,255,.05) 0)` }}
    >
      <div className="absolute inset-1.5 rounded-full bg-[#0d1420] flex items-center justify-center">
        <span className="text-[11px] font-black font-mono leading-none" style={{ color }}>{s.toFixed(0)}</span>
      </div>
    </div>
  );
}

// Mini bar for table rows
function MiniBar({ value }: { value: number | null | undefined }) {
  const v = value ?? 0;
  const color = scoreColor(v);
  return (
    <div className="flex items-center gap-1.5 justify-end">
      <div className="w-14 h-1 bg-white/[0.06] rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, v)}%`, background: color }} />
      </div>
      <span className="text-xs font-mono w-7 text-right" style={{ color }}>{fmt(value)}</span>
    </div>
  );
}

// ── Stock Card (grid view) ────────────────────────────────────────────────────
function StockCard({ item, rank, onClick }: { item: StockAnalysis; rank: number; onClick: () => void }) {
  const rec = item.recommendation || 'RANK_ONLY';
  const recStyle = recStyles[rec] || recStyles.RANK_ONLY;
  const dot = recDot[rec] || recDot.RANK_ONLY;

  const bars = [
    { label: 'G', title: 'Growth', val: item.growth_score },
    { label: 'Q', title: 'Quality/Durability', val: item.durability_score },
    { label: 'V', title: 'Valuation', val: item.valuation_score },
    { label: 'M', title: 'Momentum/Technical', val: item.technical_score },
  ].filter(b => b.val != null);

  return (
    <button
      onClick={onClick}
      className="group w-full text-left bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.06] hover:border-indigo-500/30 rounded-xl p-3.5 transition-all duration-200 hover:shadow-[0_0_20px_rgba(99,102,241,0.08)] space-y-3"
    >
      {/* Header row */}
      <div className="flex items-start gap-2.5">
        <ScoreArc score={item.composite_score} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold font-mono text-indigo-400 group-hover:text-indigo-300 transition-colors truncate">
              {item.ticker}
            </span>
            {rank <= 3 && (
              <span className="text-sm">{rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}</span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 truncate leading-tight mt-0.5">{item.name || '—'}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
          <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase tracking-wide ${recStyle}`}>
            {rec === 'PASS_TIER_1' ? 'T1' : rec === 'RANK_ONLY' ? 'RO' : rec}
          </span>
        </div>
      </div>

      {/* Sector + rank */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-600 truncate flex-1">{item.sector || '—'}</span>
        <span className="text-[10px] text-slate-700 font-mono shrink-0">#{item.rank_in_universe ?? rank}</span>
      </div>

      {/* Score sparkline bars */}
      {bars.length > 0 && (
        <div className="grid grid-cols-4 gap-1">
          {bars.map(b => (
            <div key={b.label} title={b.title} className="space-y-0.5">
              <div className="h-1 bg-white/[0.05] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, b.val ?? 0)}%`, background: scoreColor(b.val) }}
                />
              </div>
              <div className="text-[9px] text-slate-700 text-center font-mono">{b.label}</div>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────
function Pagination({ page, total, pageSize, onChange }: {
  page: number; total: number; pageSize: number; onChange: (p: number) => void;
}) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  const pages: (number | '…')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('…');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push('…');
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-between px-1 py-3">
      <span className="text-xs text-slate-600">
        Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total} stocks
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(page - 1)}
          disabled={page === 1}
          className="px-2 py-1 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition-all text-sm"
        >
          ‹
        </button>
        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`e${i}`} className="px-2 text-slate-700 text-sm">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onChange(p as number)}
              className={`w-8 h-8 rounded-lg text-xs font-medium transition-all ${
                p === page
                  ? 'bg-indigo-600 text-white shadow-[0_0_10px_rgba(99,102,241,0.3)]'
                  : 'text-slate-500 hover:text-slate-200 hover:bg-white/[0.06]'
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          onClick={() => onChange(page + 1)}
          disabled={page === totalPages}
          className="px-2 py-1 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition-all text-sm"
        >
          ›
        </button>
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────
type SortKey = 'rank' | 'composite' | 'growth' | 'durability' | 'valuation' | 'technical';
type ViewMode = 'table' | 'cards';
type TierFilter = 'all' | '1' | '2' | '3' | 'none';

const TIER_TABS: { id: TierFilter; label: string; short: string; color: string; glow: string }[] = [
  { id: 'all',  label: 'All Stocks', short: 'All',    color: 'text-slate-300 border-slate-500/40 bg-slate-500/10',   glow: '' },
  { id: '1',    label: 'Tier 1',     short: 'Tier 1', color: 'text-green-400  border-green-500/40  bg-green-500/10',  glow: 'shadow-[0_0_12px_rgba(34,197,94,0.2)]' },
  { id: '2',    label: 'Tier 2',     short: 'Tier 2', color: 'text-indigo-400 border-indigo-500/40 bg-indigo-500/10', glow: 'shadow-[0_0_12px_rgba(99,102,241,0.2)]' },
  { id: '3',    label: 'Tier 3',     short: 'Tier 3', color: 'text-amber-400  border-amber-500/40  bg-amber-500/10',  glow: 'shadow-[0_0_12px_rgba(245,158,11,0.2)]' },
  { id: 'none', label: 'Unranked',   short: 'Unranked',color: 'text-slate-500 border-slate-700/40  bg-slate-700/10',  glow: '' },
];

export default function UniverseView({ onSelectTicker }: Props) {
  const { toast } = useToast();
  const [data, setData] = useState<StockAnalysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [sectors, setSectors] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [sector, setSector] = useState('');
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortAsc, setSortAsc] = useState(true);
  const sectorsLoadedRef = useRef(false);

  const loadSectors = useCallback(async () => {
    if (sectorsLoadedRef.current) return;
    try {
      const d = await api<{ sectors: string[] }>('/universe/sectors');
      setSectors(d.sectors || []);
      sectorsLoadedRef.current = true;
    } catch (_) {}
  }, []);

  const loadUniverse = useCallback(async (s = sector, q = search) => {
    setLoading(true);
    setPage(1);
    await loadSectors();
    try {
      const params = new URLSearchParams({ limit: '1000' });
      if (s) params.set('sector', s);
      if (q) params.set('q', q);
      const d = await api<TopResponse>(`/top?${params}`);
      setData(d.results);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [sector, search, loadSectors, toast]);

  useEffect(() => { loadUniverse('', ''); }, []); // eslint-disable-line

  // Per-tier counts (computed from full unfiltered data)
  const tierCounts = useMemo(() => ({
    all:  data.length,
    '1':  data.filter(d => d.tier_reached === 1).length,
    '2':  data.filter(d => d.tier_reached === 2).length,
    '3':  data.filter(d => d.tier_reached === 3).length,
    none: data.filter(d => d.tier_reached == null).length,
  }), [data]);

  // Tier filter + sort
  const sorted = useMemo(() => {
    const tierFiltered = tierFilter === 'all'
      ? data
      : tierFilter === 'none'
        ? data.filter(i => i.tier_reached == null)
        : data.filter(i => i.tier_reached === Number(tierFilter));

    const keyMap: Record<SortKey, (i: StockAnalysis) => number> = {
      rank:       i => i.rank_in_universe ?? 9999,
      composite:  i => i.composite_score ?? 0,
      growth:     i => i.growth_score ?? 0,
      durability: i => i.durability_score ?? 0,
      valuation:  i => i.valuation_score ?? 0,
      technical:  i => i.technical_score ?? 0,
    };
    return [...tierFiltered].sort((a, b) => {
      const diff = keyMap[sortKey](a) - keyMap[sortKey](b);
      return sortAsc ? diff : -diff;
    });
  }, [data, tierFilter, sortKey, sortAsc]);

  const paginated = useMemo(
    () => sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [sorted, page]
  );

  const isV2 = data.some(i => (i.agent_outputs || {}).prefilter_v2);
  const q2Label = isV2 ? 'Quality' : 'Durability';
  const q3Label = isV2 ? 'Momentum' : 'Technical';
  const q4Label = isV2 ? 'Health' : 'Sector';

  function switchTier(t: TierFilter) {
    setTierFilter(t);
    setPage(1);
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(key === 'rank'); }
    setPage(1);
  }

  const SortTh = ({ label, k }: { label: string; k: SortKey }) => (
    <th
      onClick={() => toggleSort(k)}
      className="px-3 py-3 text-right cursor-pointer select-none hover:text-slate-300 transition-colors whitespace-nowrap group"
    >
      <span className="inline-flex items-center gap-1 justify-end">
        {label}
        <span className={`text-[10px] transition-opacity ${sortKey === k ? 'opacity-100 text-indigo-400' : 'opacity-0 group-hover:opacity-40'}`}>
          {sortAsc && sortKey === k ? '↑' : '↓'}
        </span>
      </span>
    </th>
  );

  // Summary stats
  const buyCount = data.filter(d => d.recommendation === 'BUY').length;
  const tier1Count = data.filter(d => d.tier_reached === 1).length;
  const avgScore = data.length ? (data.reduce((s, d) => s + (d.composite_score ?? 0), 0) / data.length).toFixed(1) : '—';

  return (
    <div className="space-y-5 fade-in">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Stock Universe</h1>
          <p className="text-slate-500 text-sm mt-0.5">All stocks ranked by composite score · {PAGE_SIZE} per page</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center bg-white/[0.04] border border-white/[0.08] rounded-xl p-1 gap-1">
            <button
              onClick={() => setViewMode('table')}
              title="Table view"
              className={`p-1.5 rounded-lg transition-all ${viewMode === 'table' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/>
                <line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/>
              </svg>
            </button>
            <button
              onClick={() => setViewMode('cards')}
              title="Card view"
              className={`p-1.5 rounded-lg transition-all ${viewMode === 'cards' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
              </svg>
            </button>
          </div>
          <button
            onClick={() => loadUniverse()}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-slate-400 hover:text-slate-200 bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.07] transition-all"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* ── Stats strip ── */}
      {!loading && data.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Stocks', val: data.length, color: 'text-slate-200' },
            { label: 'Tier 1 Passes', val: tier1Count, color: 'text-indigo-400' },
            { label: 'BUY Calls', val: buyCount, color: 'text-green-400' },
            { label: 'Avg Score', val: avgScore, color: 'text-slate-200' },
          ].map(({ label, val, color }) => (
            <div key={label} className="bg-white/[0.02] border border-white/[0.06] rounded-xl px-4 py-3 flex items-center justify-between gap-2">
              <span className="text-xs text-slate-600">{label}</span>
              <span className={`text-sm font-bold font-mono ${color}`}>{val}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Tier Tabs ── */}
      {!loading && data.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {TIER_TABS.map(tab => {
            const isActive = tierFilter === tab.id;
            const count = tierCounts[tab.id];
            
            return (
              <button
                key={tab.id}
                onClick={() => switchTier(tab.id)}
                className={`px-4 py-2.5 rounded-xl border text-xs font-semibold uppercase tracking-wider transition-all duration-200 flex items-center gap-2 ${
                  isActive 
                    ? `${tab.color} ${tab.glow} border-current` 
                    : 'text-slate-400 bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.05] hover:text-slate-200'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold leading-none ${
                  isActive 
                    ? 'bg-current/10 text-current' 
                    : 'bg-white/[0.06] text-slate-500'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Filters ── */}
      <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[180px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl pl-9 pr-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all"
              placeholder="Search ticker or company name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') loadUniverse(sector, search); }}
            />
          </div>
          <DarkSelect
            className="flex-1 min-w-[160px]"
            value={sector}
            onChange={val => setSector(val)}
            placeholder="All Sectors"
            options={sectors.map(s => ({ value: s, label: s }))}
          />
          <button
            onClick={() => loadUniverse(sector, search)}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
          >
            Filter
          </button>
          <button
            onClick={() => { setSearch(''); setSector(''); loadUniverse('', ''); }}
            className="px-4 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] text-slate-400 hover:text-slate-200 text-sm border border-white/[0.07] transition-all"
          >
            Clear
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl overflow-hidden">
        {loading ? (
          <div className={`p-5 ${viewMode === 'cards' ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3' : 'space-y-2'}`}>
            {Array.from({ length: viewMode === 'cards' ? 20 : 12 }).map((_, i) => (
              <div key={i} className={`shimmer rounded-xl ${viewMode === 'cards' ? 'h-28' : 'h-10'}`} />
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-600">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            <p className="mt-4 text-sm text-center max-w-xs">
              No data yet — go to <strong className="text-slate-400">Pipeline</strong> and run Step 1 + 2 first
            </p>
          </div>
        ) : viewMode === 'cards' ? (
          /* ── CARD GRID ── */
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5">
              {paginated.map((item, i) => (
                <StockCard
                  key={item.ticker}
                  item={item}
                  rank={(page - 1) * PAGE_SIZE + i + 1}
                  onClick={() => onSelectTicker(item.ticker)}
                />
              ))}
            </div>
            <Pagination page={page} total={sorted.length} pageSize={PAGE_SIZE} onChange={setPage} />
          </div>
        ) : (
          /* ── TABLE ── */
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.07] text-slate-600 text-[11px] uppercase tracking-wider">
                    <th
                      onClick={() => toggleSort('rank')}
                      className="px-3 py-3 text-left w-10 cursor-pointer hover:text-slate-300 transition-colors"
                    >
                      <span className="inline-flex items-center gap-1">
                        # {sortKey === 'rank' && <span className="text-indigo-400">{sortAsc ? '↑' : '↓'}</span>}
                      </span>
                    </th>
                    <th className="px-3 py-3 text-left">Ticker</th>
                    <th className="px-3 py-3 text-left">Company</th>
                    <th className="px-3 py-3 text-left">Sector</th>
                    <SortTh label="Score" k="composite" />
                    <SortTh label="Growth" k="growth" />
                    <SortTh label={q2Label} k="durability" />
                    <SortTh label="Valuation" k="valuation" />
                    <SortTh label={q3Label} k="technical" />
                    <th className="px-3 py-3 text-center">{q4Label}</th>
                    <th className="px-3 py-3 text-center">Rec</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.03]">
                  {paginated.map((item, i) => {
                    const globalRank = (page - 1) * PAGE_SIZE + i + 1;
                    const rec = item.recommendation || 'RANK_ONLY';
                    const recStyle = recStyles[rec] || recStyles.RANK_ONLY;
                    const scoreCol = scoreColor(item.composite_score);
                    return (
                      <tr
                        key={item.ticker}
                        className="hover:bg-white/[0.025] cursor-pointer transition-colors group"
                        onClick={() => onSelectTicker(item.ticker)}
                      >
                        {/* Rank */}
                        <td className="px-3 py-2.5 text-slate-600 font-mono text-xs">
                          {globalRank <= 3
                            ? <span>{globalRank === 1 ? '🥇' : globalRank === 2 ? '🥈' : '🥉'}</span>
                            : <span>{item.rank_in_universe ?? globalRank}</span>
                          }
                        </td>
                        {/* Ticker */}
                        <td className="px-3 py-2.5">
                          <span className="font-bold font-mono text-indigo-400 group-hover:text-indigo-300 text-xs transition-colors">
                            {item.ticker}
                          </span>
                        </td>
                        {/* Name */}
                        <td className="px-3 py-2.5 text-slate-400 max-w-[150px]">
                          <span className="truncate block text-xs">{item.name || '—'}</span>
                        </td>
                        {/* Sector */}
                        <td className="px-3 py-2.5 max-w-[120px]">
                          <span className="text-[10px] text-slate-600 truncate block">{item.sector || '—'}</span>
                        </td>
                        {/* Composite score — featured with mini ring */}
                        <td className="px-3 py-2.5 text-right">
                          <span className="font-black font-mono text-sm" style={{ color: scoreCol }}>
                            {fmt(item.composite_score)}
                          </span>
                        </td>
                        {/* Sub-scores as mini bars */}
                        <td className="px-3 py-2.5"><MiniBar value={item.growth_score} /></td>
                        <td className="px-3 py-2.5"><MiniBar value={item.durability_score} /></td>
                        <td className="px-3 py-2.5"><MiniBar value={item.valuation_score} /></td>
                        <td className="px-3 py-2.5"><MiniBar value={item.technical_score} /></td>
                        <td className="px-3 py-2.5 text-right">
                          <span className="text-xs font-mono text-slate-500">{fmt(item.sector_score)}</span>
                        </td>
                        {/* Rec badge */}
                        <td className="px-3 py-2.5 text-center">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold uppercase tracking-wide ${recStyle}`}>
                            {rec === 'PASS_TIER_1' ? 'Tier 1' : rec === 'RANK_ONLY' ? 'Rank' : rec}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Table pagination */}
            <div className="border-t border-white/[0.06] px-4">
              <Pagination page={page} total={sorted.length} pageSize={PAGE_SIZE} onChange={setPage} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
