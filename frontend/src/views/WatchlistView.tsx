import { useState, useEffect, useCallback, useMemo } from 'react';
import { api, scoreColor } from '../lib/api';
import type { StockAnalysis, TopResponse } from '../lib/types';
import { useToast } from '../components/Toast';
import { PromptDialog, ConfirmDialog } from '../components/Dialogs';

interface WatchlistMap {
  [name: string]: string[];
}

// Convert local ticker format (e.g. TCS.NS) to TradingView symbol (e.g. NSE:TCS)
function translateTicker(ticker: string): string {
  if (!ticker) return 'NSE:TCS';
  const clean = ticker.toUpperCase().trim();
  if (clean.endsWith('.NS')) return `NSE:${clean.replace('.NS', '')}`;
  if (clean.endsWith('.BO')) return `BSE:${clean.replace('.BO', '')}`;
  if (!clean.includes(':')) return `NSE:${clean}`;
  return clean;
}

interface WatchlistViewProps {
  onOpenChart: (tvSymbol: string) => void;
}

export default function WatchlistView({ onOpenChart }: WatchlistViewProps) {
  const { toast } = useToast();
  const [data, setData] = useState<StockAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const [watchlists, setWatchlists] = useState<WatchlistMap>(() => {
    try {
      const saved = localStorage.getItem('alphalens_watchlists_multi');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Object.keys(parsed).length > 0) return parsed;
      }
    } catch (e) {
      console.error('Failed to parse watchlists:', e);
    }
    try {
      const legacy = localStorage.getItem('alphalens_watchlist');
      const legacyTickers = legacy ? JSON.parse(legacy) : [];
      return { 'Default Watchlist': legacyTickers };
    } catch {
      return { 'Default Watchlist': [] };
    }
  });

  const [activeWatchlistName, setActiveWatchlistName] = useState<string>(() => {
    try {
      return localStorage.getItem('alphalens_active_watchlist') || 'Default Watchlist';
    } catch {
      return 'Default Watchlist';
    }
  });

  useEffect(() => {
    localStorage.setItem('alphalens_watchlists_multi', JSON.stringify(watchlists));
  }, [watchlists]);

  useEffect(() => {
    localStorage.setItem('alphalens_active_watchlist', activeWatchlistName);
  }, [activeWatchlistName]);

  // Keep in sync if another tab/view (e.g. Charts) changes watchlists in localStorage
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'alphalens_watchlists_multi' && e.newValue) {
        try {
          setWatchlists(JSON.parse(e.newValue));
        } catch {
          /* ignore malformed storage payload */
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const tickers = useMemo(() => watchlists[activeWatchlistName] || [], [watchlists, activeWatchlistName]);

  const loadUniverse = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await api<TopResponse>('/top?limit=2000');
      setData(resp.results || []);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadUniverse();
  }, [loadUniverse]);

  const findStockByTvSymbol = (tvSymbol: string) => {
    const clean = tvSymbol.toUpperCase();
    if (clean.includes(':')) {
      const [exchange, sym] = clean.split(':');
      const suffix = exchange === 'NSE' ? '.NS' : exchange === 'BSE' ? '.BO' : '';
      return data.find(s => s.ticker.toUpperCase() === `${sym}${suffix}`);
    }
    return data.find(s => s.ticker.toUpperCase() === clean);
  };

  const watchlistStocks = useMemo(() => {
    return tickers.map(tv => ({ tv, stock: findStockByTvSymbol(tv) || null }));
  }, [tickers, data]);

  const filteredUniverseForAdd = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return [];
    return data
      .filter(s =>
        s.ticker.toLowerCase().includes(q) ||
        (s.name && s.name.toLowerCase().includes(q))
      )
      .filter(s => !tickers.includes(translateTicker(s.ticker)))
      .slice(0, 25);
  }, [data, searchQuery, tickers]);

  const setActiveTickers = (value: string[] | ((prev: string[]) => string[])) => {
    setWatchlists(prev => {
      const current = prev[activeWatchlistName] || [];
      const updated = typeof value === 'function' ? value(current) : value;
      return { ...prev, [activeWatchlistName]: updated };
    });
  };

  const handleAddTicker = (stock: StockAnalysis) => {
    const tv = translateTicker(stock.ticker);
    setActiveTickers(prev => (prev.includes(tv) ? prev : [...prev, tv]));
    toast(`Added ${stock.ticker} to "${activeWatchlistName}"`, 'success');
  };

  const handleRemoveTicker = (tv: string) => {
    setActiveTickers(prev => prev.filter(t => t !== tv));
  };

  const handleCreateWatchlistConfirm = (name: string) => {
    if (watchlists[name]) {
      toast('A watchlist with that name already exists!', 'error');
      return;
    }
    setWatchlists(prev => ({ ...prev, [name]: [] }));
    setActiveWatchlistName(name);
    toast(`Created watchlist "${name}"`, 'success');
    setShowCreateDialog(false);
  };

  const handleDeleteWatchlistConfirm = () => {
    const remainingNames = Object.keys(watchlists).filter(n => n !== activeWatchlistName);
    const nextActive = remainingNames[0];
    setWatchlists(prev => {
      const next = { ...prev };
      delete next[activeWatchlistName];
      return next;
    });
    setActiveWatchlistName(nextActive);
    toast('Deleted watchlist', 'info');
    setShowDeleteDialog(false);
  };

  return (
    <div className="flex flex-col gap-5 fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white/[0.02] border border-white/[0.07] rounded-2xl px-4 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-sm font-bold text-slate-100 uppercase tracking-wider">Watchlist</h1>
          <select
            className="bg-[#0b0f19] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500/50 cursor-pointer font-medium"
            value={activeWatchlistName}
            onChange={e => setActiveWatchlistName(e.target.value)}
          >
            {Object.keys(watchlists).map(name => (
              <option key={name} value={name} className="bg-[#0b0f19] text-slate-300">
                {name} ({watchlists[name]?.length || 0})
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowCreateDialog(true)}
            className="p-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors cursor-pointer flex items-center justify-center"
            title="Create New Watchlist"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          {Object.keys(watchlists).length > 1 && (
            <button
              onClick={() => setShowDeleteDialog(true)}
              className="p-1.5 bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white rounded-lg transition-colors cursor-pointer flex items-center justify-center"
              title="Delete Current Watchlist"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          )}
        </div>

        <button
          onClick={() => setShowAddPanel(prev => !prev)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            showAddPanel ? 'bg-indigo-600 text-white' : 'bg-white/[0.03] border border-white/[0.08] text-slate-400 hover:text-slate-200'
          }`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Stocks
        </button>
      </div>

      {/* Add panel */}
      {showAddPanel && (
        <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl p-4 space-y-3">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              autoFocus
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all"
              placeholder="Search ticker or company name to add…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          {searchQuery.trim() && (
            <div className="max-h-64 overflow-y-auto divide-y divide-white/[0.03] rounded-xl border border-white/[0.05]">
              {filteredUniverseForAdd.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-600">No matching stocks (or already in this watchlist).</div>
              ) : (
                filteredUniverseForAdd.map(stock => (
                  <button
                    key={stock.ticker}
                    onClick={() => handleAddTicker(stock)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-white/[0.04] transition-colors text-left cursor-pointer"
                  >
                    <div className="min-w-0">
                      <span className="text-xs font-bold font-mono text-indigo-400">{stock.ticker}</span>
                      <span className="text-[10px] text-slate-500 ml-2 truncate">{stock.name || '—'}</span>
                    </div>
                    <span className="text-[10px] font-bold text-indigo-400 uppercase shrink-0">+ Add</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* List */}
      <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 shimmer rounded-xl" />
            ))}
          </div>
        ) : watchlistStocks.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500 space-y-2">
            <p>Your watchlist "{activeWatchlistName}" is empty.</p>
            <p className="text-xs text-slate-600">Click "Add Stocks" above to start tracking companies here.</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-slate-500">
                <th className="text-left font-bold px-4 py-3">Ticker</th>
                <th className="text-left font-bold px-4 py-3">Name</th>
                <th className="text-left font-bold px-4 py-3">Sector</th>
                <th className="text-right font-bold px-4 py-3">Score</th>
                <th className="text-right font-bold px-4 py-3">Market Cap</th>
                <th className="text-left font-bold px-4 py-3">Recommendation</th>
                <th className="text-right font-bold px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {watchlistStocks.map(({ tv, stock }) => (
                <tr key={tv} className="hover:bg-white/[0.03] transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-indigo-400">{tv}</td>
                  <td className="px-4 py-3 text-slate-300 truncate max-w-[220px]">{stock?.name || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{stock?.sector || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {stock?.composite_score != null ? (
                      <span className="inline-flex items-center gap-1.5 font-mono font-bold" style={{ color: scoreColor(stock.composite_score) }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: scoreColor(stock.composite_score) }} />
                        {stock.composite_score.toFixed(0)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-400">
                    {stock?.market_cap ? `₹${(stock.market_cap / 10000000).toFixed(0)} Cr` : '—'}
                  </td>
                  <td className="px-4 py-3 font-semibold text-indigo-400/80">
                    {stock?.recommendation
                      ? stock.recommendation === 'PASS_TIER_1' ? 'Tier 1'
                        : stock.recommendation === 'PASS_TIER_2' ? 'Tier 2'
                        : stock.recommendation === 'PASS_TIER_3' ? 'Tier 3'
                        : stock.recommendation
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => onOpenChart(tv)}
                        className="px-2.5 py-1 bg-indigo-600/20 hover:bg-indigo-600 text-indigo-400 hover:text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer"
                        title="Open in Charts"
                      >
                        Chart
                      </button>
                      <button
                        onClick={() => handleRemoveTicker(tv)}
                        className="px-2.5 py-1 bg-rose-600/10 hover:bg-rose-600 text-rose-400 hover:text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer"
                        title="Remove from watchlist"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreateDialog && (
        <PromptDialog
          title="Create New Watchlist"
          placeholder="e.g. High Conviction"
          confirmLabel="Create"
          onConfirm={handleCreateWatchlistConfirm}
          onCancel={() => setShowCreateDialog(false)}
        />
      )}

      {showDeleteDialog && (
        <ConfirmDialog
          title="Delete Watchlist"
          message={`Are you sure you want to delete "${activeWatchlistName}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDeleteWatchlistConfirm}
          onCancel={() => setShowDeleteDialog(false)}
        />
      )}
    </div>
  );
}
