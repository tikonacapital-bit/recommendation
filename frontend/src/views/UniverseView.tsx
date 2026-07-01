import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  PASS_TIER_2: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
  PASS_TIER_3: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  RANK_ONLY: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
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
function StockCard({
  item,
  rank,
  onClick,
  isSelectedForCompare,
  onCompareToggle,
}: {
  item: StockAnalysis;
  rank: number;
  onClick: () => void;
  isSelectedForCompare: boolean;
  onCompareToggle: () => void;
}) {


  const bars = [
    { label: 'G', title: 'Growth', val: item.growth_score },
    { label: 'Q', title: 'Quality/Durability', val: item.durability_score },
    { label: 'V', title: 'Valuation', val: item.valuation_score },
    { label: 'M', title: 'Momentum/Technical', val: item.technical_score },
  ].filter(b => b.val != null);

  return (
    <div className="relative group/card">
      {/* Checkbox overlay */}
      <div className="absolute top-3.5 right-3.5 z-20">
        <input
          type="checkbox"
          checked={isSelectedForCompare}
          onChange={(e) => {
            e.stopPropagation();
            onCompareToggle();
          }}
          className="w-4 h-4 rounded border border-white/[0.15] bg-[#0a101d] text-indigo-600 focus:ring-indigo-500 focus:ring-offset-[#080c14] cursor-pointer accent-indigo-600 transition-all"
        />
      </div>

      <button
        onClick={onClick}
        className={`group w-full text-left bg-white/[0.02] hover:bg-white/[0.05] border rounded-xl p-3.5 transition-all duration-200 hover:shadow-[0_0_20px_rgba(99,102,241,0.08)] space-y-3
          ${isSelectedForCompare ? 'border-indigo-500/50 bg-indigo-500/[0.03]' : 'border-white/[0.06] hover:border-indigo-500/30'}`}
      >
        {/* Header row */}
        <div className="flex items-start gap-2.5 pr-6">
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
        </div>

        {/* Sector + rank */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-slate-600 truncate flex-1">{item.sector || '—'}</span>
          <span className="text-[10px] text-slate-700 font-mono shrink-0">#{item.rank_in_universe ?? rank}</span>
        </div>

        {/* Benchmarks */}
        {item.benchmarks && item.benchmarks.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.benchmarks.slice(0, 2).map(b => (
              <span key={b} className="text-[8px] px-1 py-0.2 rounded bg-indigo-500/5 text-indigo-400 border border-indigo-500/10 font-mono">
                {b}
              </span>
            ))}
            {item.benchmarks.length > 2 && (
              <span className="text-[8px] px-1 py-0.2 text-slate-500 font-mono">+{item.benchmarks.length - 2}</span>
            )}
          </div>
        )}

        {/* Promotion Badge */}
        {item.previous_tier === 2 && item.tier_reached === 1 && (
          <div className="px-2 py-0.5 rounded bg-gradient-to-r from-indigo-500/10 to-emerald-500/10 border border-emerald-500/30 text-[9px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5 w-max">
            <span>Tier 2 → 1</span>
            <span className="text-[11px] leading-none">↗</span>
            {item.previous_composite_score != null && (
              <span className="text-slate-500 font-mono font-normal">
                ({item.previous_composite_score.toFixed(0)} → {item.composite_score?.toFixed(0)})
              </span>
            )}
          </div>
        )}

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
    </div>
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
type TierFilter = 'all' | '1' | '2' | '3' | 'promoted' | 'none';

const TIER_TABS: { id: TierFilter; label: string; short: string; color: string; glow: string }[] = [
  { id: 'all',  label: 'All Stocks', short: 'All',    color: 'text-slate-300 border-slate-500/40 bg-slate-500/10',   glow: '' },
  { id: '1',    label: 'Tier 1',     short: 'Tier 1', color: 'text-green-400  border-green-500/40  bg-green-500/10',  glow: 'shadow-[0_0_12px_rgba(34,197,94,0.2)]' },
  { id: '2',    label: 'Tier 2',     short: 'Tier 2', color: 'text-indigo-400 border-indigo-500/40 bg-indigo-500/10', glow: 'shadow-[0_0_12px_rgba(99,102,241,0.2)]' },
  { id: '3',    label: 'Tier 3',     short: 'Tier 3', color: 'text-amber-400  border-amber-500/40  bg-amber-500/10',  glow: 'shadow-[0_0_12px_rgba(245,158,11,0.2)]' },
  { id: 'promoted', label: 'Tier 2 → 1', short: 'Tier 2→1', color: 'text-pink-400 border-pink-500/40 bg-pink-500/10', glow: 'shadow-[0_0_12px_rgba(244,63,94,0.2)]' },
  { id: 'none', label: 'Unranked',   short: 'Unranked',color: 'text-slate-500 border-slate-700/40  bg-slate-700/10',  glow: '' },
];

export default function UniverseView({ onSelectTicker }: Props) {
  const { toast } = useToast();
  const [data, setData] = useState<StockAnalysis[]>([]);
  const [promotedData, setPromotedData] = useState<StockAnalysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [sectors, setSectors] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [sector, setSector] = useState('');
  const [benchmark, setBenchmark] = useState('');
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortAsc, setSortAsc] = useState(true);
  const sectorsLoadedRef = useRef(false);

  const [compareList, setCompareList] = useState<string[]>([]);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);

  const toggleCompare = useCallback((ticker: string) => {
    setCompareList(prev => {
      if (prev.includes(ticker)) {
        return prev.filter(t => t !== ticker);
      }
      if (prev.length >= 3) {
        toast('Maximum of 3 stocks can be compared side-by-side.', 'info');
        return prev;
      }
      return [...prev, ticker];
    });
  }, [toast]);

  const comparedItems = useMemo(() => {
    return compareList.map(t => data.find(item => item.ticker === t)).filter((item): item is StockAnalysis => !!item);
  }, [compareList, data]);

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
      const [d, p] = await Promise.all([
        api<TopResponse>(`/top?${params}`),
        api<TopResponse>('/universe/promoted')
      ]);
      setData(d.results || []);
      setPromotedData(p.results || []);
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
    promoted: promotedData.length,
    none: data.filter(d => d.tier_reached == null).length,
  }), [data, promotedData]);

  const [benchmarksOptions, setBenchmarksOptions] = useState<string[]>([]);

  useEffect(() => {
    const fetchFilters = async () => {
      try {
        const filters = await api<{ benchmarks: string[] }>('/stocks/screener-filters');
        if (filters && filters.benchmarks) {
          setBenchmarksOptions(filters.benchmarks);
        }
      } catch (e) {
        console.error("Failed to load screener filters:", e);
      }
    };
    fetchFilters();
  }, []);

  // Tier filter + sort
  const sorted = useMemo(() => {
    let tierFiltered = data;
    if (tierFilter === 'none') {
      tierFiltered = data.filter(i => i.tier_reached == null);
    } else if (tierFilter === 'promoted') {
      tierFiltered = promotedData;
    } else if (tierFilter !== 'all') {
      tierFiltered = data.filter(i => i.tier_reached === Number(tierFilter));
    }

    // Apply client-side filters for promoted tab
    if (tierFilter === 'promoted') {
      if (sector) {
        tierFiltered = tierFiltered.filter(i => i.sector?.toLowerCase().includes(sector.toLowerCase()));
      }
      if (search) {
        const q = search.toLowerCase();
        tierFiltered = tierFiltered.filter(i => 
          (i.ticker && i.ticker.toLowerCase().includes(q)) || 
          (i.name && i.name.toLowerCase().includes(q))
        );
      }
    }

    // Apply client-side advanced screener index filter
    if (benchmark && benchmark !== 'All') {
      tierFiltered = tierFiltered.filter(i => i.benchmarks && Array.isArray(i.benchmarks) && i.benchmarks.includes(benchmark));
    }

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
  }, [data, promotedData, tierFilter, sortKey, sortAsc, sector, search, benchmark]);

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
      <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl p-4 space-y-4">
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
          <DarkSelect
            className="flex-1 min-w-[160px]"
            value={benchmark}
            onChange={val => setBenchmark(val)}
            placeholder="All Benchmark Indexes"
            options={benchmarksOptions.map(s => ({ value: s, label: s }))}
          />
          <button
            onClick={() => loadUniverse(sector, search)}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
          >
            Filter
          </button>
          <button
            onClick={() => {
              setSearch('');
              setSector('');
              setBenchmark('');
              loadUniverse('', '');
            }}
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
                  isSelectedForCompare={compareList.includes(item.ticker)}
                  onCompareToggle={() => toggleCompare(item.ticker)}
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
                    <th className="px-3 py-3 text-center w-12">Compare</th>
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
                        {/* Compare checkbox */}
                        <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={compareList.includes(item.ticker)}
                            onChange={() => toggleCompare(item.ticker)}
                            className="w-4 h-4 rounded border border-white/[0.15] bg-[#0a101d] text-indigo-600 focus:ring-indigo-500 focus:ring-offset-[#080c14] cursor-pointer accent-indigo-600 transition-all"
                          />
                        </td>
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
                          <div className="flex flex-col items-end">
                            <span className="font-black font-mono text-sm" style={{ color: scoreCol }}>
                              {fmt(item.composite_score)}
                            </span>
                            {item.previous_composite_score != null && (
                              <span className="text-[9px] font-mono text-slate-500 leading-tight">
                                (was {fmt(item.previous_composite_score)})
                              </span>
                            )}
                          </div>
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
                          {item.previous_tier === 2 && item.tier_reached === 1 ? (
                            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-bold uppercase tracking-wide bg-gradient-to-r from-indigo-500/10 to-emerald-500/10 text-emerald-400 border-emerald-500/30">
                              Tier 2 → 1 ↗
                            </span>
                          ) : (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold uppercase tracking-wide ${recStyle}`}>
                              {rec === 'PASS_TIER_1' ? 'Tier 1' : rec === 'PASS_TIER_2' ? 'Tier 2' : rec === 'PASS_TIER_3' ? 'Tier 3' : rec === 'RANK_ONLY' ? 'Rank' : rec}
                            </span>
                          )}
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

      {/* Floating Compare Action Bar */}
      {compareList.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-[90%] max-w-xl bg-[#0d1420]/80 backdrop-blur-md border border-indigo-500/30 rounded-2xl px-5 py-3.5 flex items-center justify-between gap-4 shadow-[0_10px_40px_rgba(99,102,241,0.15)] transition-all">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-1.5">
              {compareList.map(t => (
                <div key={t} className="px-2 py-0.5 bg-indigo-600/30 border border-indigo-500/50 rounded-lg text-[10px] font-bold font-mono text-indigo-300 shadow-md">
                  {t}
                </div>
              ))}
            </div>
            <div className="text-xs text-slate-400 font-medium">
              <span className="text-indigo-400 font-bold">{compareList.length}</span> / 3 selected
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCompareList([])}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
            >
              Clear
            </button>
            <button
              onClick={() => setIsCompareModalOpen(true)}
              className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all hover:shadow-[0_0_12px_rgba(99,102,241,0.4)]"
            >
              Compare
            </button>
          </div>
        </div>
      )}

      {/* Compare Modal */}
      {isCompareModalOpen && (
        <CompareModal
          items={comparedItems}
          onClose={() => setIsCompareModalOpen(false)}
          onRemoveTicker={(t) => setCompareList(prev => prev.filter(x => x !== t))}
        />
      )}
    </div>
  );
}

interface CompareModalProps {
  items: StockAnalysis[];
  onClose: () => void;
  onRemoveTicker: (ticker: string) => void;
}

const renderFormattedText = (text: string | null | undefined) => {
  if (!text) return null;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-bold text-white font-mono bg-white/5 px-1 py-0.5 rounded border border-white/5 select-all">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
};

function CompareModal({ items, onClose, onRemoveTicker }: CompareModalProps) {
  if (items.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 backdrop-blur-md bg-slate-950/80 flex items-center justify-center p-4 md:p-6 animate-fade-in">
      <div className="bg-[#0b121f] border border-white/[0.08] rounded-3xl w-full max-w-5xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between shrink-0 bg-white/[0.01]">
          <div>
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-400">
                <path d="M16 3h5v5M8 21H3v-5M12 12m-9 0a9 9 0 1 0 18 0 9 9 0 1 0-18 0M21 3L14 10M3 21l7-7" />
              </svg>
              Stock Comparison Matrix
            </h2>
            <p className="text-slate-500 text-xs mt-0.5">Institutional-grade side-by-side row comparison</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-white/[0.06] text-slate-400 hover:text-slate-200 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Scrollable Matrix Table */}
        <div className="flex-1 overflow-auto p-6">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/[0.08]">
                <th className="py-4 pr-4 text-xs font-semibold text-slate-500 uppercase tracking-widest min-w-[180px] sticky left-0 bg-[#0b121f] z-10">Metric</th>
                {items.map(item => {
                  const rec = item.recommendation || 'RANK_ONLY';
                  const recStyle = recStyles[rec] || recStyles.RANK_ONLY;
                  return (
                    <th key={item.ticker} className="py-4 px-6 min-w-[220px]">
                      <div className="flex items-center justify-between gap-3 relative">
                        <div className="flex items-center gap-3">
                          <ScoreArc score={item.composite_score || 0} />
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-bold font-mono text-slate-100">{item.ticker}</span>
                              <span className={`text-[8px] px-1 py-0.2 rounded border font-bold uppercase tracking-wide leading-none ${recStyle}`}>
                                {rec === 'PASS_TIER_1' ? 'Tier 1' : rec === 'PASS_TIER_2' ? 'Tier 2' : rec === 'PASS_TIER_3' ? 'Tier 3' : rec === 'RANK_ONLY' ? 'Rank' : rec.replace(/_/g, ' ')}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-500 truncate max-w-[150px] mt-0.5" title={item.name || ''}>{item.name || '—'}</div>
                          </div>
                        </div>
                        <button
                          onClick={() => onRemoveTicker(item.ticker)}
                          title="Remove"
                          className="p-1 rounded bg-white/[0.03] hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04] text-xs">
              {/* Category: Ratings */}
              <tr className="bg-white/[0.01]">
                <td colSpan={items.length + 1} className="py-2.5 px-3 font-semibold text-indigo-400 text-[10px] uppercase tracking-widest sticky left-0 z-10">Factor Scores</td>
              </tr>
              <tr>
                <td className="py-3.5 pr-4 text-slate-400 font-medium sticky left-0 bg-[#0b121f] z-10">Composite Score</td>
                {items.map(item => (
                  <td key={item.ticker} className="py-3.5 px-6 font-mono font-black text-sm" style={{ color: scoreColor(item.composite_score) }}>
                    {fmt(item.composite_score)}/100
                  </td>
                ))}
              </tr>
              {[
                { label: 'Growth Score', key: 'growth_score' },
                { label: 'Quality & Durability', key: 'durability_score' },
                { label: 'Valuation Rating', key: 'valuation_score' },
                { label: 'Technical Momentum', key: 'technical_score' },
                { label: 'Sector Health Indicator', key: 'sector_score' }
              ].map(row => (
                <tr key={row.key}>
                  <td className="py-3.5 pr-4 text-slate-400 sticky left-0 bg-[#0b121f] z-10">{row.label}</td>
                  {items.map(item => {
                    const val = (item as any)[row.key];
                    return (
                      <td key={item.ticker} className="py-3.5 px-6 font-mono font-bold" style={{ color: scoreColor(val) }}>
                        <div className="flex items-center gap-2">
                          <span className="w-8 text-right">{val != null ? Math.round(val) : '—'}</span>
                          <div className="w-20 h-1.5 bg-white/[0.04] rounded-full overflow-hidden shrink-0">
                            <div className="h-full rounded-full" style={{ width: `${val ?? 0}%`, background: scoreColor(val) }} />
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Category: Quantitative Key Ratios */}
              <tr className="bg-white/[0.01]">
                <td colSpan={items.length + 1} className="py-2.5 px-3 font-semibold text-indigo-400 text-[10px] uppercase tracking-widest sticky left-0 z-10">Quantitative Metrics</td>
              </tr>
              {[
                { label: 'Revenue CAGR (2yr)', getVal: (pf2: any) => pf2.rev_cagr != null ? `${Number(pf2.rev_cagr).toFixed(1)}%` : '—' },
                { label: 'PAT CAGR (2yr)', getVal: (pf2: any) => pf2.pat_cagr != null ? `${Number(pf2.pat_cagr).toFixed(1)}%` : '—' },
                { label: 'Return on Equity (ROE)', getVal: (pf2: any) => pf2.roe != null ? `${Number(pf2.roe).toFixed(1)}%` : '—' },
                { label: 'Return on Invested Capital (ROIC)', getVal: (pf2: any) => pf2.roic != null ? `${Number(pf2.roic).toFixed(1)}%` : '—' },
                { label: 'Forward P/E Multiple', getVal: (pf2: any) => pf2.pe_fwd != null ? `${Number(pf2.pe_fwd).toFixed(1)}x` : '—' },
                { label: 'EV / EBITDA Multiple', getVal: (pf2: any) => pf2.ev_ebitda_fwd != null ? `${Number(pf2.ev_ebitda_fwd).toFixed(1)}x` : '—' },
                { label: 'Consensus Market Upside', getVal: (pf2: any) => pf2.consensus_upside != null ? `${Number(pf2.consensus_upside).toFixed(0)}%` : '—', color: 'text-indigo-400 font-bold' },
                { label: 'EBITDA Margin', getVal: (pf2: any) => pf2.ebitda_margin_fy25 != null ? `${Number(pf2.ebitda_margin_fy25).toFixed(1)}%` : '—' },
                { label: 'Promoter Shareholding', getVal: (pf2: any) => pf2.promoter_pct != null ? `${Number(pf2.promoter_pct).toFixed(1)}%` : '—' },
                { label: 'Net Leverage (Debt/EBITDA)', getVal: (pf2: any) => pf2.net_leverage != null ? `${Number(pf2.net_leverage).toFixed(2)}x` : '—' },
                { label: '3-Month Stock Return', getVal: (pf2: any) => pf2.ret_3m != null ? `${Number(pf2.ret_3m).toFixed(1)}%` : '—', getColor: (pf2: any) => (pf2.ret_3m ?? 0) >= 0 ? 'text-green-400 font-bold' : 'text-red-400 font-bold' },
                { label: '6-Month Stock Return', getVal: (pf2: any) => pf2.ret_6m != null ? `${Number(pf2.ret_6m).toFixed(1)}%` : '—', getColor: (pf2: any) => (pf2.ret_6m ?? 0) >= 0 ? 'text-green-400 font-bold' : 'text-red-400 font-bold' },
              ].map((row, idx) => (
                <tr key={idx}>
                  <td className="py-3 pr-4 text-slate-400 sticky left-0 bg-[#0b121f] z-10">{row.label}</td>
                  {items.map(item => {
                    const ao = item.agent_outputs || {};
                    const pf2 = ao.prefilter_v2 || null;
                    const val = pf2 ? row.getVal(pf2) : '—';
                    const customCol = pf2 && (row as any).getColor ? (row as any).getColor(pf2) : row.color ? row.color : 'text-slate-200';
                    return (
                      <td key={item.ticker} className={`py-3 px-6 font-mono font-medium ${customCol}`}>
                        {val}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Category: Target Prices */}
              <tr className="bg-white/[0.01]">
                <td colSpan={items.length + 1} className="py-2.5 px-3 font-semibold text-indigo-400 text-[10px] uppercase tracking-widest sticky left-0 z-10">Target Prices (INR)</td>
              </tr>
              {[
                { label: 'Bear Case Target', key: 'bear', color: 'text-red-400 font-bold' },
                { label: 'Base Case Target', key: 'base', color: 'text-indigo-400 font-bold' },
                { label: 'Bull Case Target', key: 'bull', color: 'text-green-400 font-bold' },
              ].map(row => (
                <tr key={row.key}>
                  <td className="py-3.5 pr-4 text-slate-400 sticky left-0 bg-[#0b121f] z-10">{row.label}</td>
                  {items.map(item => {
                    const tp = item.target_prices || {};
                    const val = tp[row.key];
                    return (
                      <td key={item.ticker} className={`py-3.5 px-6 font-mono ${row.color}`}>
                        {val ? `₹${Math.round(val).toLocaleString('en-IN')}` : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Category: AI Synthesis Thesis */}
              <tr className="bg-white/[0.01]">
                <td colSpan={items.length + 1} className="py-2.5 px-3 font-semibold text-indigo-400 text-[10px] uppercase tracking-widest sticky left-0 z-10">AI Thesis & Summaries</td>
              </tr>
              <tr>
                <td className="py-4 pr-4 text-slate-400 align-top sticky left-0 bg-[#0b121f] z-10">AI Investment Thesis</td>
                {items.map(item => (
                  <td key={item.ticker} className="py-4 px-6 text-[11px] text-slate-300 leading-relaxed max-w-[320px] align-top">
                    {item.thesis_paragraph ? (
                      <div className="bg-white/[0.01] border border-white/[0.04] rounded-xl p-3 select-all">
                        {renderFormattedText(item.thesis_paragraph)}
                      </div>
                    ) : (
                      <span className="text-slate-600 italic">No synthesis report run yet.</span>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
