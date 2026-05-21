import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api, fmt, scoreColor } from '../lib/api';
import type { StockAnalysis, TopResponse } from '../lib/types';
import { useToast } from '../components/Toast';
import DarkSelect from '../components/DarkSelect';

interface Props {
  onSelectTicker: (t: string) => void;
}

const recStyles: Record<string, string> = {
  BUY: 'text-green-400 bg-green-500/10 border-green-500/20',
  HOLD: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  AVOID: 'text-red-400 bg-red-500/10 border-red-500/20',
  PASS_TIER_1: 'text-teal-400 bg-teal-500/10 border-teal-500/20',
  RANK_ONLY: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
};

export default function UniverseView({ onSelectTicker }: Props) {
  const { toast } = useToast();
  const [data, setData] = useState<StockAnalysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [sectors, setSectors] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [sector, setSector] = useState('');
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

  useEffect(() => {
    loadUniverse('', '');
  }, []); // eslint-disable-line

  const isV2 = data.some(i => (i.agent_outputs || {}).prefilter_v2);
  const q2Label = isV2 ? 'Quality' : 'Durability';
  const q3Label = isV2 ? 'Momentum' : 'Technical';
  const q4Label = isV2 ? 'Health' : 'Sector';

  return (
    <div className="space-y-5 fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Stock Universe</h1>
          <p className="text-slate-500 text-sm mt-1">All stocks ranked by composite score</p>
        </div>
        <button
          onClick={() => loadUniverse()}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.07] transition-all"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <input
            className="flex-1 min-w-[180px] bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all"
            placeholder="Search ticker or name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') loadUniverse(sector, search); }}
          />
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
          {!loading && (
            <span className="text-xs text-slate-600">{data.length} stocks</span>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-8 space-y-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-10 shimmer rounded-lg" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-600">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            <p className="mt-3 text-sm text-center">No data — go to <strong className="text-slate-400">Pipeline</strong> and run Step 1 + 2 first</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-slate-600 text-xs uppercase tracking-widest">
                  <th className="px-4 py-3 text-left w-12">#</th>
                  <th className="px-4 py-3 text-left">Ticker</th>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Sector</th>
                  <th className="px-4 py-3 text-right">Score</th>
                  <th className="px-4 py-3 text-right">Growth</th>
                  <th className="px-4 py-3 text-right">{q2Label}</th>
                  <th className="px-4 py-3 text-right">Valuation</th>
                  <th className="px-4 py-3 text-right">{q3Label}</th>
                  <th className="px-4 py-3 text-right">{q4Label}</th>
                  <th className="px-4 py-3 text-center">Rec</th>
                </tr>
              </thead>
              <tbody>
                {data.map((item, i) => {
                  const rec = item.recommendation || 'RANK_ONLY';
                  const recStyle = recStyles[rec] || recStyles.RANK_ONLY;
                  return (
                    <tr
                      key={item.ticker}
                      className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03] cursor-pointer transition-colors group"
                      onClick={() => onSelectTicker(item.ticker)}
                    >
                      <td className="px-4 py-3 text-slate-600 font-mono text-xs">{item.rank_in_universe ?? i + 1}</td>
                      <td className="px-4 py-3 font-semibold font-mono text-indigo-400 group-hover:text-indigo-300">{item.ticker}</td>
                      <td className="px-4 py-3 text-slate-400 max-w-[160px] truncate">{item.name || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{item.sector || '—'}</td>
                      <td className="px-4 py-3 text-right font-bold font-mono" style={{ color: scoreColor(item.composite_score) }}>
                        {fmt(item.composite_score)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-400">{fmt(item.growth_score)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-400">{fmt(item.durability_score)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-400">{fmt(item.valuation_score)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-400">{fmt(item.technical_score)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-400">{fmt(item.sector_score)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold uppercase ${recStyle}`}>
                          {rec.replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
