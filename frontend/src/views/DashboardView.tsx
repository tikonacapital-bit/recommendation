import { useState, useEffect, useCallback } from 'react';
import { api, scoreColor } from '../lib/api';
import type { StockAnalysis, TopResponse } from '../lib/types';
import AnalysisPanel from '../components/AnalysisPanel';
import StockRow from '../components/StockRow';
import { useToast } from '../components/Toast';

interface Props {
  tickerInput: string;
  onTickerChange: (t: string) => void;
}

function KpiCard({ val, label, color }: { val: string | number; label: string; color?: string }) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 flex flex-col gap-1 hover:bg-white/[0.05] transition-colors">
      <div className="text-2xl font-black font-mono" style={color ? { color } : {}}>{val}</div>
      <div className="text-xs text-slate-500 uppercase tracking-widest font-medium">{label}</div>
    </div>
  );
}

export default function DashboardView({ tickerInput, onTickerChange }: Props) {
  const { toast } = useToast();
  const [topData, setTopData] = useState<StockAnalysis[]>([]);
  const [topCount, setTopCount] = useState(0);
  const [loadingTop, setLoadingTop] = useState(true);
  const [selectedStock, setSelectedStock] = useState<StockAnalysis | null>(null);
  const [loadingStock, setLoadingStock] = useState(false);

  const loadTop = useCallback(async (limit = 50) => {
    setLoadingTop(true);
    try {
      const data = await api<TopResponse>(`/top?limit=${limit}`);
      setTopData(data.results);
      setTopCount(data.count);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoadingTop(false);
    }
  }, [toast]);

  const viewTicker = useCallback(async (sym: string) => {
    if (!sym) return;
    setLoadingStock(true);
    setSelectedStock(null);
    try {
      const data = await api<StockAnalysis>(`/view/${sym.toUpperCase()}`);
      setSelectedStock(data);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoadingStock(false);
    }
  }, [toast]);

  useEffect(() => {
    loadTop();
  }, [loadTop]);

  useEffect(() => {
    if (tickerInput) viewTicker(tickerInput);
  }, []); // eslint-disable-line

  const tier1 = topData.filter(r => r.tier_reached === 1).length;
  const topScore = topData.length ? Math.max(...topData.map(r => r.composite_score || 0)) : 0;
  const avg = topData.length
    ? (topData.reduce((s, r) => s + (r.composite_score || 0), 0) / topData.length).toFixed(1)
    : '—';

  return (
    <div className="space-y-6 fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Research Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">AI-powered analysis · Indian Equity Universe · NSE/BSE</p>
        </div>
        <button
          onClick={() => loadTop(50)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.07] transition-all"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Reload
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loadingTop ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 shimmer rounded-2xl" />
          ))
        ) : (
          <>
            <KpiCard val={topCount} label="Stocks Tracked" />
            <KpiCard val={tier1} label="Tier 1 Passes" color="#6366f1" />
            <KpiCard val={topScore.toFixed(1)} label="Top Score" color={scoreColor(topScore)} />
            <KpiCard val={avg} label="Avg Composite" />
          </>
        )}
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Selected Stock */}
        <div className="lg:col-span-2 bg-white/[0.02] border border-white/[0.07] rounded-2xl p-5 overflow-y-auto max-h-[70vh]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-300">Selected Stock</h2>
            <button
              onClick={() => viewTicker(tickerInput)}
              className="text-xs px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-400 hover:text-slate-200 border border-white/[0.07] transition-all flex items-center gap-1.5"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              View
            </button>
          </div>

          {loadingStock ? (
            <div className="space-y-4">
              <div className="h-20 shimmer rounded-xl" />
              <div className="h-24 shimmer rounded-xl" />
              <div className="h-32 shimmer rounded-xl" />
            </div>
          ) : selectedStock ? (
            <AnalysisPanel item={selectedStock} />
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-slate-600">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <p className="mt-3 text-sm text-center">Search a ticker above or click a stock in the ranking</p>
            </div>
          )}
        </div>

        {/* Universe Ranking */}
        <div className="lg:col-span-3 bg-white/[0.02] border border-white/[0.07] rounded-2xl overflow-hidden flex flex-col max-h-[70vh]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-300">Universe Ranking</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">{topCount}</span>
            </div>
            <button
              onClick={() => loadTop(200)}
              className="text-xs px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-400 hover:text-slate-200 border border-white/[0.07] transition-all"
            >
              Load All
            </button>
          </div>

          <div className="overflow-y-auto flex-1">
            {loadingTop ? (
              <div className="p-5 space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-14 shimmer rounded-lg" />
                ))}
              </div>
            ) : topData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-slate-600 p-6 text-center">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="2" y1="12" x2="22" y2="12"/>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                <p className="mt-3 text-sm">No stocks yet — go to <strong className="text-slate-400">Pipeline</strong> and run Step 1 first</p>
              </div>
            ) : (
              topData.map((item, i) => (
                <StockRow
                  key={item.ticker}
                  item={item}
                  rank={i + 1}
                  isSelected={selectedStock?.ticker === item.ticker}
                  onClick={() => {
                    onTickerChange(item.ticker);
                    viewTicker(item.ticker);
                  }}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
