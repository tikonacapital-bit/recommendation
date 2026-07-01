import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api, scoreColor } from '../lib/api';
import type { StockAnalysis, TopResponse } from '../lib/types';
import { useToast } from '../components/Toast';
import { PromptDialog, ConfirmDialog } from '../components/Dialogs';
import { createChart, ColorType, CandlestickSeries, LineSeries, AreaSeries, HistogramSeries } from 'lightweight-charts';

type ChartLayout = 'single' | 'dual' | 'quad' | 'all';
type Timeframe = '6M' | '1Y' | '2Y' | '3Y' | '5Y' | '10Y' | 'D' | 'W' | 'M';
type ChartStyle = '1' | '2' | '3' | '8'; // 1=Candles, 2=Line, 3=Area, 8=Heikin Ashi

interface ChartsViewProps {
  pendingSymbol?: string | null;
  onPendingSymbolConsumed?: () => void;
}

export default function ChartsView({ pendingSymbol, onPendingSymbolConsumed }: ChartsViewProps = {}) {
  const { toast } = useToast();
  const [data, setData] = useState<StockAnalysis[]>([]);
  const [loadingUniverse, setLoadingUniverse] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSector, setSelectedSector] = useState<string>('All');
  const [selectedBenchmark, setSelectedBenchmark] = useState<string>('All');
  const [minMarketCapCr, setMinMarketCapCr] = useState<number | null>(0);
  const [maxMarketCapCr, setMaxMarketCapCr] = useState<number | null>(null);
  const [_activePreset, setActivePreset] = useState<string>('all');
  const [customMin, setCustomMin] = useState<number | null>(null);
  const [customMax, setCustomMax] = useState<number | null>(null);
  const [isMarketCapExpanded, setIsMarketCapExpanded] = useState<boolean>(true);

  const handlePresetClick = (presetId: string, min: number | null, max: number | null) => {
    setActivePreset(presetId);
    setMinMarketCapCr(min);
    setMaxMarketCapCr(max);
    setCustomMin(null);
    setCustomMax(null);
  };

  const _handleCustomSubmit = () => {
    if (customMin === null && customMax === null) {
      handlePresetClick('all', 0, null);
      return;
    }
    setActivePreset('custom');
    setMinMarketCapCr(customMin);
    setMaxMarketCapCr(customMax);
  };

  // Multi-chart slot management (max 4 slots for quad view)
  const [symbols, setSymbols] = useState<string[]>([
    'NSE:TCS',
    'NSE:RELIANCE',
    'NSE:INFY',
    'NSE:HDFCBANK',
  ]);
  const [activeSlot, setActiveSlot] = useState<number>(0);
  const [layout, setLayout] = useState<ChartLayout>('single');
  const [timeframe, setTimeframe] = useState<Timeframe>('1Y');
  const [chartStyle, setChartStyle] = useState<ChartStyle>('1');
  const [customSymbol, setCustomSymbol] = useState('');
  const [showControls, setShowControls] = useState(true);

  // Multi-select Watchlist and Fullscreen Presenter
  interface WatchlistMap {
    [name: string]: string[];
  }

  const [watchlists, setWatchlists] = useState<WatchlistMap>(() => {
    try {
      const saved = localStorage.getItem('alphalens_watchlists_multi');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Object.keys(parsed).length > 0) return parsed;
      }
    } catch (e) {
      console.error("Failed to parse watchlists:", e);
    }
    // Fallback: migrate from single watchlist if exists
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
      const saved = localStorage.getItem('alphalens_active_watchlist');
      return saved || 'Default Watchlist';
    } catch {
      return 'Default Watchlist';
    }
  });

  const [showWatchlistOnly, setShowWatchlistOnly] = useState(false);
  const [showCreateWatchlistDialog, setShowCreateWatchlistDialog] = useState(false);
  const [showDeleteWatchlistDialog, setShowDeleteWatchlistDialog] = useState(false);
  const [isFullscreenPresenterOpen, setIsFullscreenPresenterOpen] = useState(false);

  const selectedTickers = useMemo(() => {
    return watchlists[activeWatchlistName] || [];
  }, [watchlists, activeWatchlistName]);

  const setSelectedTickers = (
    value: string[] | ((prev: string[]) => string[])
  ) => {
    setWatchlists(prev => {
      const currentList = prev[activeWatchlistName] || [];
      const updatedList = typeof value === 'function' ? value(currentList) : value;
      return {
        ...prev,
        [activeWatchlistName]: updatedList
      };
    });
  };

  useEffect(() => {
    localStorage.setItem('alphalens_watchlists_multi', JSON.stringify(watchlists));
  }, [watchlists]);

  useEffect(() => {
    localStorage.setItem('alphalens_active_watchlist', activeWatchlistName);
  }, [activeWatchlistName]);

  const handleCreateWatchlistConfirm = (cleanName: string) => {
    if (watchlists[cleanName]) {
      toast("A watchlist with that name already exists!", "error");
      return;
    }
    setWatchlists(prev => ({
      ...prev,
      [cleanName]: []
    }));
    setActiveWatchlistName(cleanName);
    toast(`Created watchlist "${cleanName}"`, "success");
    setShowCreateWatchlistDialog(false);
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
    toast(`Deleted watchlist`, "info");
    setShowDeleteWatchlistDialog(false);
  };

  const handleToggleSelectTicker = (ticker: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const tvSym = translateTicker(ticker);
    setSelectedTickers(prev => {
      if (prev.includes(tvSym)) {
        return prev.filter(t => t !== tvSym);
      } else {
        return [...prev, tvSym];
      }
    });
  };

  const handleSelectAllFiltered = () => {
    const allFilteredSyms = filteredStocks.map(s => translateTicker(s.ticker));
    const allSelected = allFilteredSyms.every(sym => selectedTickers.includes(sym));
    if (allSelected) {
      setSelectedTickers(prev => prev.filter(sym => !allFilteredSyms.includes(sym)));
    } else {
      setSelectedTickers(prev => {
        const next = [...prev];
        allFilteredSyms.forEach(sym => {
          if (!next.includes(sym)) next.push(sym);
        });
        return next;
      });
    }
  };

  // Load the tracked stocks universe for the sidebar
  const loadUniverse = useCallback(async (benchmarkFilter?: string) => {
    setLoadingUniverse(true);
    try {
      let url = '/top?limit=2000';
      if (benchmarkFilter && benchmarkFilter !== 'All') {
        url += `&benchmark=${encodeURIComponent(benchmarkFilter)}`;
      }
      const resp = await api<TopResponse>(url);
      setData(resp.results || []);

      // Auto-set the first loaded ticker in Slot 0 if available
      if (resp.results && resp.results.length > 0) {
        const firstTicker = translateTicker(resp.results[0].ticker);
        setSymbols(prev => {
          const next = [...prev];
          next[0] = firstTicker;
          return next;
        });
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoadingUniverse(false);
    }
  }, [toast]); // eslint-disable-line

  // Initial load
  useEffect(() => {
    loadUniverse();
  }, []); // eslint-disable-line

  // Re-fetch when benchmark index changes
  useEffect(() => {
    loadUniverse(selectedBenchmark);
  }, [selectedBenchmark]); // eslint-disable-line

  // Load a symbol requested from another view (e.g. Watchlist "Chart" action) into Slot 1
  useEffect(() => {
    if (!pendingSymbol) return;
    setSymbols(prev => {
      const next = [...prev];
      next[0] = pendingSymbol;
      return next;
    });
    setActiveSlot(0);
    onPendingSymbolConsumed?.();
  }, [pendingSymbol]); // eslint-disable-line

  // Convert local ticker format (e.g. TCS.NS) to TradingView symbol (e.g. NSE:TCS)
  const translateTicker = (ticker: string): string => {
    if (!ticker) return 'NSE:TCS';
    const clean = ticker.toUpperCase().trim();
    if (clean.endsWith('.NS')) {
      return `NSE:${clean.replace('.NS', '')}`;
    }
    if (clean.endsWith('.BO')) {
      return `BSE:${clean.replace('.BO', '')}`;
    }
    // Default to NSE for standard Indian tickers if not specified
    if (!clean.includes(':') && !clean.endsWith('.NS') && !clean.endsWith('.BO')) {
      return `NSE:${clean}`;
    }
    return clean;
  };

  const findStockByTvSymbol = (tvSymbol: string) => {
    if (!tvSymbol) return null;
    let cleanTicker = tvSymbol.toUpperCase();
    if (cleanTicker.includes(':')) {
      const [_, sym] = cleanTicker.split(':');
      const exchange = cleanTicker.split(':')[0];
      const suffix = exchange === 'NSE' ? '.NS' : exchange === 'BSE' ? '.BO' : '';
      cleanTicker = sym + suffix;
    } else {
      return data.find(s => 
        s.ticker.toUpperCase() === cleanTicker ||
        s.ticker.toUpperCase().replace('.NS', '').replace('.BO', '') === cleanTicker
      );
    }
    return data.find(s => s.ticker.toUpperCase() === cleanTicker);
  };

  const _handleTagClick = (tag: string) => {
    setSelectedBenchmark(tag);
    loadUniverse(tag);
    toast(`Showing stocks in index: ${tag}`, 'info');
  };

  const renderBenchmarkTags = (_benchmarks?: string[] | null | undefined) => {
    return null;
  };

  // Logarithmic slider helpers for Market Cap (10 Cr to 100,000 Cr)
  const sliderToCr = (val: number): number => {
    if (val === 0) return 0;
    if (val === 100) return 100000;
    const minLog = 1; // 10 Cr
    const maxLog = 5; // 100,000 Cr
    const logVal = minLog + (val / 100) * (maxLog - minLog);
    return Math.round(Math.pow(10, logVal));
  };

  const crToSlider = (cr: number | null): number => {
    if (!cr) return 0;
    if (cr >= 100000) return 100;
    if (cr <= 10) return 0;
    const minLog = 1;
    const maxLog = 5;
    const logVal = Math.log10(cr);
    return Math.round(((logVal - minLog) / (maxLog - minLog)) * 100);
  };

  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Math.min(Number(e.target.value), (maxMarketCapCr === null ? 100 : crToSlider(maxMarketCapCr)) - 1);
    setMinMarketCapCr(sliderToCr(val));
  };

  const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Math.max(Number(e.target.value), crToSlider(minMarketCapCr) + 1);
    if (val === 100) {
      setMaxMarketCapCr(null);
    } else {
      setMaxMarketCapCr(sliderToCr(val));
    }
  };

  // Extract all distinct sectors dynamically from the tracked universe
  const sectors = useMemo(() => {
    const set = new Set<string>();
    data.forEach(stock => {
      if (stock.sector) set.add(stock.sector);
    });
    return ['All', ...Array.from(set).sort()];
  }, [data]);

  const [benchmarksOptions, setBenchmarksOptions] = useState<string[]>(['All']);

  useEffect(() => {
    const fetchFilters = async () => {
      try {
        const filters = await api<{ benchmarks: string[] }>('/stocks/screener-filters');
        if (filters && filters.benchmarks) {
          setBenchmarksOptions(['All', ...filters.benchmarks]);
        }
      } catch (e) {
        console.error("Failed to load screener filters:", e);
      }
    };
    fetchFilters();
  }, []);

  // Filtered sidebar tickers based on search, sector, and market cap
  // (benchmark filtering is done server-side via the /top?benchmark= param)
  const filteredStocks = useMemo(() => {
    return data.filter(stock => {
      const tvSym = translateTicker(stock.ticker);

      // 0. Watchlist filter
      if (showWatchlistOnly && !selectedTickers.includes(tvSym)) {
        return false;
      }

      // 1. Search filter
      const q = searchQuery.toLowerCase();
      const matchesSearch = !q || (
        stock.ticker.toLowerCase().includes(q) ||
        (stock.name && stock.name.toLowerCase().includes(q)) ||
        (stock.sector && stock.sector.toLowerCase().includes(q))
      );

      // 2. Sector filter
      const matchesSector = selectedSector === 'All' || stock.sector === selectedSector;

      // 3. Market Cap filter (Rupees to Crores)
      const marketCapCr = stock.market_cap ? stock.market_cap / 10000000 : 0;
      const matchesMinCap = minMarketCapCr === 0 || minMarketCapCr === null || marketCapCr >= minMarketCapCr;
      const matchesMaxCap = maxMarketCapCr === null || marketCapCr <= maxMarketCapCr;
      const matchesMarketCap = matchesMinCap && matchesMaxCap;

      return matchesSearch && matchesSector && matchesMarketCap;
    });
  }, [data, searchQuery, selectedSector, minMarketCapCr, maxMarketCapCr]);

  // Handle ticker selection from the sidebar
  const handleSelectStock = (stock: StockAnalysis) => {
    const tvSymbol = translateTicker(stock.ticker);
    setSymbols(prev => {
      const next = [...prev];
      next[activeSlot] = tvSymbol;
      return next;
    });
    toast(`Loaded ${stock.ticker} into Chart Slot ${activeSlot + 1}`, 'success');
  };

  // Handle custom symbol submission
  const handleCustomSymbolSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customSymbol.trim()) return;
    const formatted = customSymbol.toUpperCase().trim();
    setSymbols(prev => {
      const next = [...prev];
      next[activeSlot] = formatted;
      return next;
    });
    toast(`Loaded custom symbol "${formatted}" into Slot ${activeSlot + 1}`, 'success');
    setCustomSymbol('');
  };


  const getLayoutGridClass = () => {
    if (layout === 'all') return 'block overflow-y-auto pr-2 pb-4';
    if (layout === 'dual') return 'grid-cols-1 xl:grid-cols-2';
    if (layout === 'quad') return 'grid-cols-1 md:grid-cols-2 grid-rows-4 md:grid-rows-2';
    return 'grid-cols-1';
  };

  return (
    <div className="flex flex-col xl:flex-row gap-5 h-[calc(100vh-70px)] min-h-[550px] fade-in relative select-none">
      {isFullscreenPresenterOpen && selectedTickers.length > 0 && (
        <FullscreenPresenter
          selectedTickers={selectedTickers}
          onClose={() => setIsFullscreenPresenterOpen(false)}
          timeframe={timeframe}
          chartStyle={chartStyle}
        />
      )}

      {showCreateWatchlistDialog && (
        <PromptDialog
          title="Create New Watchlist"
          placeholder="e.g. High Conviction"
          confirmLabel="Create"
          onConfirm={handleCreateWatchlistConfirm}
          onCancel={() => setShowCreateWatchlistDialog(false)}
        />
      )}

      {showDeleteWatchlistDialog && (
        <ConfirmDialog
          title="Delete Watchlist"
          message={`Are you sure you want to delete "${activeWatchlistName}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDeleteWatchlistConfirm}
          onCancel={() => setShowDeleteWatchlistDialog(false)}
        />
      )}

      {/* ── LEFT SIDEBAR: Stocks Universe List ── */}
      {(layout !== 'all' && layout !== 'quad') && (
        <div className="w-full xl:w-72 bg-white/[0.02] border border-white/[0.07] rounded-2xl flex flex-col shrink-0 overflow-hidden h-full">
          {/* Search & Filter Header */}
          <div className="p-4 border-b border-white/[0.06] shrink-0 space-y-3">
            <div className="flex items-center justify-between border-b border-white/[0.05] pb-2.5">
              <div className="flex gap-3">
                <button
                  onClick={() => setShowWatchlistOnly(false)}
                  className={`text-xs font-bold pb-1 cursor-pointer transition-all border-b-2 ${
                    !showWatchlistOnly
                      ? 'text-indigo-400 border-indigo-500'
                      : 'text-slate-500 border-transparent hover:text-slate-300'
                  }`}
                >
                  Universe
                </button>
                <button
                  onClick={() => setShowWatchlistOnly(true)}
                  className={`text-xs font-bold pb-1 cursor-pointer transition-all border-b-2 ${
                    showWatchlistOnly
                      ? 'text-indigo-400 border-indigo-500'
                      : 'text-slate-500 border-transparent hover:text-slate-300'
                  }`}
                >
                  Watchlist ({selectedTickers.length})
                </button>
              </div>
              
              <div className="flex items-center gap-2">
                {filteredStocks.length > 0 && (
                  <button
                    onClick={handleSelectAllFiltered}
                    className="text-[9px] text-slate-500 hover:text-indigo-400 transition-colors font-bold uppercase tracking-wide cursor-pointer"
                    title="Toggle selection of all filtered stocks"
                  >
                    {filteredStocks.every(s => selectedTickers.includes(translateTicker(s.ticker))) ? 'Deselect' : 'Select All'}
                  </button>
                )}
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">
                  {filteredStocks.length}
                </span>
              </div>
            </div>

            {showWatchlistOnly && (
              <div className="flex items-center justify-between gap-2 bg-white/[0.03] border border-white/[0.08] rounded-xl p-2 mt-1">
                <select
                  className="flex-1 bg-[#0b0f19] border border-white/[0.08] rounded-lg px-2 py-1.5 text-[11px] text-slate-200 outline-none focus:border-indigo-500/50 cursor-pointer font-medium"
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
                  type="button"
                  onClick={() => setShowCreateWatchlistDialog(true)}
                  className="p-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors cursor-pointer shrink-0 flex items-center justify-center"
                  title="Create New Watchlist"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                </button>

                {Object.keys(watchlists).length > 1 && (
                  <button
                    type="button"
                    onClick={() => setShowDeleteWatchlistDialog(true)}
                    className="p-1.5 bg-rose-600/20 hover:bg-rose-600 text-rose-400 hover:text-white rounded-lg transition-colors cursor-pointer shrink-0 flex items-center justify-center"
                    title="Delete Current Watchlist"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                )}
              </div>
            )}

            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all"
                placeholder="Filter universe stocks…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Quick Dropdown & Cap Card Filters */}
            <div className="space-y-3 pt-1">
              <div className="space-y-1">
                <label className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Sector</label>
                <select
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-2 py-1.5 text-[11px] text-slate-200 outline-none focus:border-indigo-500/50 cursor-pointer font-medium"
                  value={selectedSector}
                  onChange={e => setSelectedSector(e.target.value)}
                >
                  {sectors.map(sec => (
                    <option key={sec} value={sec} className="bg-[#0b0f19] text-slate-300">
                      {sec}
                    </option>
                  ))}
                </select>
              </div>

              {/* Benchmark Index filter directly below Sector */}
              <div className="space-y-1">
                <label className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Benchmark Index</label>
                <select
                  className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-2 py-1.5 text-[11px] text-slate-200 outline-none focus:border-indigo-500/50 cursor-pointer font-medium"
                  value={selectedBenchmark}
                  onChange={e => setSelectedBenchmark(e.target.value)}
                >
                  {benchmarksOptions.map(ben => (
                    <option key={ben} value={ben} className="bg-[#0b0f19] text-slate-300">
                      {ben}
                    </option>
                  ))}
                </select>
              </div>

              {/* By Market Cap Custom Selection Widget */}
              <div className="space-y-1.5 border-t border-white/[0.05] pt-3.5">
                <div 
                  onClick={() => setIsMarketCapExpanded(prev => !prev)}
                  className="flex items-center justify-between text-[9px] text-slate-500 font-bold uppercase tracking-wider cursor-pointer hover:text-slate-300 transition-colors select-none"
                >
                  <span>By Market Cap</span>
                  <svg 
                    width="10" 
                    height="10" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2.5" 
                    className={`text-slate-500 transition-transform duration-200 ${isMarketCapExpanded ? 'rotate-0' : '-rotate-90'}`}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>

                {isMarketCapExpanded && (
                  <div className="bg-white/[0.02] border border-white/[0.07] rounded-xl p-3.5 space-y-4">
                    <style>{`
                      .thumb,
                      .thumb::-webkit-slider-thumb {
                        -webkit-appearance: none;
                        -webkit-tap-highlight-color: transparent;
                      }
                      .thumb {
                        pointer-events: none;
                        position: absolute;
                        height: 0;
                        width: 100%;
                        outline: none;
                      }
                      /* For Chrome browsers */
                      .thumb::-webkit-slider-thumb {
                        background-color: #ffffff;
                        border: 2.5px solid #6366f1;
                        border-radius: 50%;
                        cursor: pointer;
                        height: 12px;
                        width: 12px;
                        pointer-events: all;
                        position: relative;
                      }
                      /* For Firefox browsers */
                      .thumb::-moz-range-thumb {
                        background-color: #ffffff;
                        border: 2.5px solid #6366f1;
                        border-radius: 50%;
                        cursor: pointer;
                        height: 12px;
                        width: 12px;
                        pointer-events: all;
                        position: relative;
                      }
                    `}</style>

                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between text-[10px] font-medium text-slate-400">
                        <span>Market Cap Range:</span>
                      </div>
                      <div className="flex justify-between text-[10px] font-mono font-bold text-indigo-400">
                        <span>{minMarketCapCr ? `₹${minMarketCapCr.toLocaleString()} Cr` : '0 Cr'}</span>
                        <span>to</span>
                        <span>{maxMarketCapCr ? `₹${maxMarketCapCr.toLocaleString()} Cr` : 'Unlimited'}</span>
                      </div>
                    </div>

                    <div className="relative w-full h-5 mt-1 flex items-center">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={crToSlider(minMarketCapCr)}
                        onChange={handleMinChange}
                        className="thumb z-30"
                        style={{ width: '100%' }}
                      />
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={maxMarketCapCr === null ? 100 : crToSlider(maxMarketCapCr)}
                        onChange={handleMaxChange}
                        className="thumb z-40"
                        style={{ width: '100%' }}
                      />

                      <div className="relative w-full h-1 bg-white/10 rounded-full">
                        <div
                          className="absolute h-full bg-indigo-500 rounded-full"
                          style={{
                            left: `${crToSlider(minMarketCapCr)}%`,
                            right: `${100 - (maxMarketCapCr === null ? 100 : crToSlider(maxMarketCapCr))}%`
                          }}
                        />
                      </div>
                    </div>

                    {/* Reset Button */}
                    {(minMarketCapCr !== 0 || maxMarketCapCr !== null) && (
                      <button
                        type="button"
                        onClick={() => {
                          setMinMarketCapCr(0);
                          setMaxMarketCapCr(null);
                        }}
                        className="w-full py-1 text-center bg-white/[0.03] hover:bg-white/[0.07] text-slate-400 hover:text-slate-200 border border-white/[0.05] rounded-lg text-[10px] font-semibold transition-all cursor-pointer"
                      >
                        Reset Range
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Scrollable Stocks List */}
          <div className="flex-1 overflow-y-auto divide-y divide-white/[0.03] pr-1">
            {loadingUniverse ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-12 shimmer rounded-xl" />
                ))}
              </div>
            ) : filteredStocks.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-600">
                No matching assets found in scored universe.
              </div>
            ) : (
              filteredStocks.map(stock => {
                const tvSym = translateTicker(stock.ticker);
                const isLoadedInAnySlot = symbols.includes(tvSym);
                const isLoadedInActiveSlot = symbols[activeSlot] === tvSym;

                return (
                  <div
                    key={stock.ticker}
                    onClick={() => handleSelectStock(stock)}
                    className={`p-3 cursor-pointer text-left transition-all duration-150 relative group ${isLoadedInActiveSlot
                      ? 'bg-indigo-500/10 border-l-2 border-indigo-500'
                      : isLoadedInAnySlot
                        ? 'bg-white/[0.02] border-l-2 border-white/20 hover:bg-white/[0.04]'
                        : 'hover:bg-white/[0.04]'
                      }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 shrink-0">
                        <input
                          type="checkbox"
                          checked={selectedTickers.includes(tvSym)}
                          onClick={(e) => handleToggleSelectTicker(stock.ticker, e)}
                          onChange={() => {}}
                          className="w-3.5 h-3.5 rounded border border-white/[0.15] bg-[#0a101d] text-indigo-600 focus:ring-indigo-500 focus:ring-offset-[#080c14] cursor-pointer accent-indigo-600 transition-all shrink-0"
                        />
                        <span className="text-xs font-bold font-mono text-indigo-400 group-hover:text-indigo-300 transition-colors">
                          {stock.ticker}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {stock.composite_score != null && (
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: scoreColor(stock.composite_score) }}
                          />
                        )}
                        <span className="text-[11px] font-bold font-mono text-slate-300">
                          {stock.composite_score?.toFixed(0) || '—'}
                        </span>
                      </div>
                    </div>
                    <div className="text-[10px] text-slate-500 truncate mt-0.5">
                      {stock.name || '—'}
                    </div>
                    <div className="flex items-center justify-between text-[9px] text-slate-600 uppercase tracking-wide mt-1">
                      <span className="truncate max-w-[100px]">{stock.sector || '—'}</span>
                      <span className="font-mono text-slate-500">
                        {stock.market_cap ? `₹${(stock.market_cap / 10000000).toFixed(0)} Cr` : '—'}
                      </span>
                      {stock.recommendation && (
                        <span className="font-bold text-indigo-400/80">
                          {stock.recommendation === 'PASS_TIER_1' ? 'T1' : stock.recommendation === 'PASS_TIER_2' ? 'T2' : stock.recommendation === 'PASS_TIER_3' ? 'T3' : stock.recommendation}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ── MAIN WORKSPACE PANEL ── */}
      <div className="flex-1 flex flex-col gap-4 h-full min-w-0 relative">

        {/* Toggle Controls Button (when hidden) */}
        {!showControls && (
          <button
            onClick={() => setShowControls(true)}
            className="absolute top-0 right-4 z-20 px-3 py-1.5 bg-indigo-600/80 hover:bg-indigo-500 text-white rounded-b-lg text-[10px] font-semibold backdrop-blur-md shadow-lg transition-all"
          >
            Show Controls
          </button>
        )}

        {/* Custom Controls Bar */}
        {showControls && (
          <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl px-4 py-3 shrink-0 flex flex-wrap gap-4 items-center justify-between">
            <div className="flex items-center gap-4 flex-wrap">
              {/* Select Company Dropdown */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Company:</span>
                <CompanySelect
                  stocks={data}
                  onSelect={handleSelectStock}
                  activeTvSymbol={symbols[activeSlot]}
                  translateTicker={translateTicker}
                  selectedTickers={selectedTickers}
                  onToggleWatchlist={(ticker) => {
                    const tvSym = translateTicker(ticker);
                    setSelectedTickers(prev => 
                      prev.includes(tvSym) ? prev.filter(t => t !== tvSym) : [...prev, tvSym]
                    );
                  }}
                />
              </div>

              <div className="h-4 w-px bg-white/10" />

              {/* Watchlist Toggle */}
              <button
                type="button"
                onClick={() => {
                  if (selectedTickers.length === 0 && !showWatchlistOnly) {
                    toast('Your watchlist is empty. Check the checkboxes in the sidebar to add companies!', 'info');
                    return;
                  }
                  setShowWatchlistOnly(prev => !prev);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer
                  ${showWatchlistOnly
                    ? 'bg-indigo-600 border-indigo-500 text-white shadow-[0_0_12px_rgba(99,102,241,0.25)]'
                    : 'bg-white/[0.03] border-white/[0.08] text-slate-400 hover:text-slate-200'
                  }`}
                title="Toggle showing only your watchlist tickers"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill={showWatchlistOnly ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                {showWatchlistOnly ? `Watchlist: ${activeWatchlistName}` : 'Watchlist Only'}
              </button>

              <div className="h-4 w-px bg-white/10" />

              {/* Custom search symbol form */}
              <form onSubmit={handleCustomSymbolSubmit} className="relative flex items-center gap-2">
                <input
                  className="w-36 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-indigo-500/50 transition-all font-mono uppercase"
                  placeholder="Search TV symbol… e.g. BTCUSD"
                  value={customSymbol}
                  onChange={e => setCustomSymbol(e.target.value)}
                />
                <button
                  type="submit"
                  className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[11px] font-semibold transition-colors shrink-0"
                >
                  Load
                </button>
              </form>

              <div className="h-4 w-px bg-white/10" />

              {/* Timeframe selector */}
              <div className="flex bg-white/[0.03] border border-white/[0.07] rounded-lg p-0.5 text-[11px] font-mono">
                {(['D', 'W', 'M', '6M', '1Y', '2Y', '3Y', '5Y', '10Y'] as Timeframe[]).map(tf => (
                  <button
                    key={tf}
                    onClick={() => setTimeframe(tf)}
                    className={`px-2.5 py-1 rounded transition-all font-bold ${timeframe === tf
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-500 hover:text-slate-300'
                      }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>

              <div className="h-4 w-px bg-white/10" />

              {/* Chart Style Selector */}
              <div className="flex bg-white/[0.03] border border-white/[0.07] rounded-lg p-0.5 text-[11px]">
                {[
                  { id: '1' as ChartStyle, label: 'Candles' },
                  { id: '2' as ChartStyle, label: 'Line' },
                  { id: '3' as ChartStyle, label: 'Area' },
                  { id: '8' as ChartStyle, label: 'Heikin' },
                ].map(styleOpt => (
                  <button
                    key={styleOpt.id}
                    onClick={() => setChartStyle(styleOpt.id)}
                    className={`px-2 py-1 rounded transition-all font-medium ${chartStyle === styleOpt.id
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-500 hover:text-slate-300'
                      }`}
                  >
                    {styleOpt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              {/* Layout selector */}
              <div className="flex bg-white/[0.04] border border-white/[0.08] rounded-xl p-1 gap-1">
                {[
                  {
                    id: 'single' as ChartLayout, label: 'Single', icon: (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                      </svg>
                    )
                  },
                  {
                    id: 'dual' as ChartLayout, label: 'Split', icon: (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="12" y1="3" x2="12" y2="21" />
                      </svg>
                    )
                  },
                  {
                    id: 'quad' as ChartLayout, label: 'Quad', icon: (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="12" y1="3" x2="12" y2="21" /><line x1="3" y1="12" x2="21" y2="12" />
                      </svg>
                    )
                  },
                  {
                    id: 'all' as ChartLayout, label: 'All', icon: (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line>
                      </svg>
                    )
                  }
                ].map(mode => (
                  <button
                    key={mode.id}
                    onClick={() => {
                      setLayout(mode.id);
                      // Adjust active slot if bounds change
                      if (mode.id === 'single') setActiveSlot(0);
                      if (mode.id === 'dual' && activeSlot > 1) setActiveSlot(0);
                    }}
                    title={`${mode.label} View`}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${layout === mode.id
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'text-slate-500 hover:text-slate-300'
                      }`}
                  >
                    {mode.icon}
                    <span className="hidden sm:inline">{mode.label}</span>
                  </button>
                ))}
              </div>

              {selectedTickers.length > 0 && (
                <>
                  <div className="h-4 w-px bg-white/10" />
                  <div className="flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/30 rounded-xl px-3 py-1 animate-pulse shrink-0">
                    <span className="text-[10px] font-bold text-indigo-300 font-mono">
                      {selectedTickers.length} Selected
                    </span>
                    <button
                      onClick={() => setIsFullscreenPresenterOpen(true)}
                      className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 shadow-md hover:shadow-indigo-500/20 cursor-pointer"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                      </svg>
                      View Fullscreen
                    </button>
                    <button
                      onClick={() => setSelectedTickers([])}
                      className="text-slate-500 hover:text-slate-300 text-[10px] font-bold font-mono cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </>
              )}

              <div className="h-4 w-px bg-white/10" />

              <button
                onClick={() => setShowControls(false)}
                className="px-2.5 py-1.5 text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5"
                title="Hide Controls Bar"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 15l-6-6-6 6" /></svg>
                <span className="hidden sm:inline">Hide</span>
              </button>
            </div>
          </div>
        )}

        {/* Charts Container Panel */}
        <div className="flex-1 flex gap-5 min-h-0">

          {/* Main Chart Matrix */}
          <style dangerouslySetInnerHTML={{ __html: `
            .main-charts-scrollbar::-webkit-scrollbar {
              width: 8px !important;
            }
            .main-charts-scrollbar::-webkit-scrollbar-track {
              background: rgba(255, 255, 255, 0.01) !important;
              border-radius: 4px;
            }
            .main-charts-scrollbar::-webkit-scrollbar-thumb {
              background: rgba(99, 102, 241, 0.35) !important;
              border-radius: 4px;
            }
            .main-charts-scrollbar::-webkit-scrollbar-thumb:hover {
              background: rgba(99, 102, 241, 0.6) !important;
            }
          `}} />
          <div className={`flex-1 ${layout !== 'all' ? 'grid' : 'overflow-y-auto main-charts-scrollbar pr-2'} gap-4 min-h-0 h-full ${getLayoutGridClass()}`}>

            {layout === 'all' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-6 w-full h-max">
                {filteredStocks.map((stock, idx) => {
                  const tvSym = translateTicker(stock.ticker);
                  return (
                    <div key={tvSym} className="relative bg-[#0d1420] rounded-2xl overflow-hidden border border-white/[0.06] flex flex-col shrink-0" style={{ minHeight: '450px' }}>
                      <div className="px-4 py-2 bg-white/[0.02] border-b border-white/[0.05] shrink-0 flex items-center justify-between text-xs font-mono font-semibold">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-indigo-400">
                            #{idx + 1}: <span className="text-slate-300">{tvSym}</span>
                          </span>
                          <span className="text-[10px] text-slate-500 font-normal truncate max-w-[120px] hidden sm:inline mr-1">
                            ({stock.name})
                          </span>
                          <button
                            onClick={() => {
                              const tvSym = translateTicker(stock.ticker);
                              setSelectedTickers(prev => 
                                prev.includes(tvSym) ? prev.filter(t => t !== tvSym) : [...prev, tvSym]
                              );
                            }}
                            className={`p-1 hover:bg-white/5 rounded-lg transition-colors cursor-pointer mr-1 flex items-center justify-center shrink-0
                              ${selectedTickers.includes(translateTicker(stock.ticker)) ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'}`}
                            title={selectedTickers.includes(translateTicker(stock.ticker)) ? "Remove from watchlist" : "Add to watchlist"}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill={selectedTickers.includes(translateTicker(stock.ticker)) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5">
                              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                            </svg>
                          </button>
                          {renderBenchmarkTags(stock.benchmarks)}
                        </div>
                      </div>
                      <div className="flex-1 w-full relative p-0 flex flex-col">
                        <LazyTradingViewChart
                          containerId={`tradingview_lazy_${idx}`}
                          symbol={tvSym}
                          timeframe={timeframe}
                          chartStyle={chartStyle}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                {/* Render chart for Slot 0 */}
                <div
                  onClick={() => setActiveSlot(0)}
                  className={`relative bg-[#0d1420] rounded-2xl overflow-hidden border transition-all flex flex-col h-full ${activeSlot === 0
                    ? 'border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.15)]'
                    : 'border-white/[0.06] hover:border-white/[0.12]'
                    }`}
                >
                  {/* Slot Header */}
                  <div className="px-4 py-2 bg-white/[0.02] border-b border-white/[0.05] shrink-0 flex items-center justify-between text-xs font-mono font-semibold">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className={activeSlot === 0 ? 'text-indigo-400' : 'text-slate-500'}>
                        Panel 1: <span className="text-slate-300">{symbols[0]}</span>
                      </span>
                      {(() => {
                        const stock = findStockByTvSymbol(symbols[0]);
                        if (!stock) return null;
                        return (
                          <>
                            <span className="text-[10px] text-slate-500 font-normal truncate max-w-[120px] hidden sm:inline mr-1">
                              ({stock.name})
                            </span>
                            <button
                              onClick={() => {
                                const tvSym = translateTicker(stock.ticker);
                                setSelectedTickers(prev => 
                                  prev.includes(tvSym) ? prev.filter(t => t !== tvSym) : [...prev, tvSym]
                                );
                              }}
                              className={`p-1 hover:bg-white/5 rounded-lg transition-colors cursor-pointer mr-1 flex items-center justify-center shrink-0
                                ${selectedTickers.includes(translateTicker(stock.ticker)) ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'}`}
                              title={selectedTickers.includes(translateTicker(stock.ticker)) ? "Remove from watchlist" : "Add to watchlist"}
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill={selectedTickers.includes(translateTicker(stock.ticker)) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5">
                                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                              </svg>
                            </button>
                            {renderBenchmarkTags(stock.benchmarks)}
                          </>
                        );
                      })()}
                    </div>
                    <span className="text-[10px] text-indigo-500 font-bold uppercase">Active</span>
                  </div>
                  <div className="flex-1 w-full h-full min-h-0 relative">
                    <TradingViewChart
                      key={`tv-slot-0-${symbols[0]}-${timeframe}-${chartStyle}`}
                      containerId="tradingview_slot_0"
                      symbol={symbols[0]}
                      timeframe={timeframe}
                      chartStyle={chartStyle}
                    />
                  </div>
                </div>

                {/* Render Chart for Slot 1 (Split & Quad) */}
                {layout !== 'single' && (
                  <div
                    onClick={() => setActiveSlot(1)}
                    className={`relative bg-[#0d1420] rounded-2xl overflow-hidden border transition-all flex flex-col h-full ${activeSlot === 1
                      ? 'border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.15)]'
                      : 'border-white/[0.06] hover:border-white/[0.12]'
                      }`}
                  >
                    <div className="px-4 py-2 bg-white/[0.02] border-b border-white/[0.05] shrink-0 flex items-center justify-between text-xs font-mono font-semibold">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className={activeSlot === 1 ? 'text-indigo-400' : 'text-slate-500'}>
                          Panel 2: <span className="text-slate-300">{symbols[1]}</span>
                        </span>
                        {(() => {
                          const stock = findStockByTvSymbol(symbols[1]);
                          if (!stock) return null;
                          return (
                            <>
                              <span className="text-[10px] text-slate-500 font-normal truncate max-w-[120px] hidden sm:inline mr-1">
                                ({stock.name})
                              </span>
                              <button
                                onClick={() => {
                                  const tvSym = translateTicker(stock.ticker);
                                  setSelectedTickers(prev => 
                                    prev.includes(tvSym) ? prev.filter(t => t !== tvSym) : [...prev, tvSym]
                                  );
                                }}
                                className={`p-1 hover:bg-white/5 rounded-lg transition-colors cursor-pointer mr-1 flex items-center justify-center shrink-0
                                  ${selectedTickers.includes(translateTicker(stock.ticker)) ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'}`}
                                title={selectedTickers.includes(translateTicker(stock.ticker)) ? "Remove from watchlist" : "Add to watchlist"}
                              >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill={selectedTickers.includes(translateTicker(stock.ticker)) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5">
                                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                                </svg>
                              </button>
                              {renderBenchmarkTags(stock.benchmarks)}
                            </>
                          );
                        })()}
                      </div>
                      {activeSlot === 1 && (
                        <span className="text-[10px] text-indigo-500 font-bold uppercase">Active</span>
                      )}
                    </div>
                    <div className="flex-1 w-full h-full min-h-0 relative">
                      <TradingViewChart
                        key={`tv-slot-1-${symbols[1]}-${timeframe}-${chartStyle}`}
                        containerId="tradingview_slot_1"
                        symbol={symbols[1]}
                        timeframe={timeframe}
                        chartStyle={chartStyle}
                      />
                    </div>
                  </div>
                )}

                {/* Render Slot 2 (Quad only) */}
                {layout === 'quad' && (
                  <div
                    onClick={() => setActiveSlot(2)}
                    className={`relative bg-[#0d1420] rounded-2xl overflow-hidden border transition-all flex flex-col h-full ${activeSlot === 2
                      ? 'border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.15)]'
                      : 'border-white/[0.06] hover:border-white/[0.12]'
                      }`}
                  >
                    <div className="px-4 py-2 bg-white/[0.02] border-b border-white/[0.05] shrink-0 flex items-center justify-between text-xs font-mono font-semibold">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className={activeSlot === 2 ? 'text-indigo-400' : 'text-slate-500'}>
                          Panel 3: <span className="text-slate-300">{symbols[2]}</span>
                        </span>
                        {(() => {
                          const stock = findStockByTvSymbol(symbols[2]);
                          if (!stock) return null;
                          return (
                            <>
                              <span className="text-[10px] text-slate-500 font-normal truncate max-w-[120px] hidden sm:inline mr-1">
                                ({stock.name})
                              </span>
                              <button
                                onClick={() => {
                                  const tvSym = translateTicker(stock.ticker);
                                  setSelectedTickers(prev => 
                                    prev.includes(tvSym) ? prev.filter(t => t !== tvSym) : [...prev, tvSym]
                                  );
                                }}
                                className={`p-1 hover:bg-white/5 rounded-lg transition-colors cursor-pointer mr-1 flex items-center justify-center shrink-0
                                  ${selectedTickers.includes(translateTicker(stock.ticker)) ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'}`}
                                title={selectedTickers.includes(translateTicker(stock.ticker)) ? "Remove from watchlist" : "Add to watchlist"}
                              >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill={selectedTickers.includes(translateTicker(stock.ticker)) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5">
                                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                                </svg>
                              </button>
                              {renderBenchmarkTags(stock.benchmarks)}
                            </>
                          );
                        })()}
                      </div>
                      {activeSlot === 2 && (
                        <span className="text-[10px] text-indigo-500 font-bold uppercase">Active</span>
                      )}
                    </div>
                    <div className="flex-1 w-full h-full min-h-0 relative">
                      <TradingViewChart
                        key={`tv-slot-2-${symbols[2]}-${timeframe}-${chartStyle}`}
                        containerId="tradingview_slot_2"
                        symbol={symbols[2]}
                        timeframe={timeframe}
                        chartStyle={chartStyle}
                      />
                    </div>
                  </div>
                )}

                {/* Render Slot 3 (Quad only) */}
                {layout === 'quad' && (
                  <div
                    onClick={() => setActiveSlot(3)}
                    className={`relative bg-[#0d1420] rounded-2xl overflow-hidden border transition-all flex flex-col h-full ${activeSlot === 3
                      ? 'border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.15)]'
                      : 'border-white/[0.06] hover:border-white/[0.12]'
                      }`}
                  >
                    <div className="px-4 py-2 bg-white/[0.02] border-b border-white/[0.05] shrink-0 flex items-center justify-between text-xs font-mono font-semibold">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className={activeSlot === 3 ? 'text-indigo-400' : 'text-slate-500'}>
                          Panel 4: <span className="text-slate-300">{symbols[3]}</span>
                        </span>
                        {(() => {
                          const stock = findStockByTvSymbol(symbols[3]);
                          if (!stock) return null;
                          return (
                            <>
                              <span className="text-[10px] text-slate-500 font-normal truncate max-w-[120px] hidden sm:inline mr-1">
                                ({stock.name})
                              </span>
                              <button
                                onClick={() => {
                                  const tvSym = translateTicker(stock.ticker);
                                  setSelectedTickers(prev => 
                                    prev.includes(tvSym) ? prev.filter(t => t !== tvSym) : [...prev, tvSym]
                                  );
                                }}
                                className={`p-1 hover:bg-white/5 rounded-lg transition-colors cursor-pointer mr-1 flex items-center justify-center shrink-0
                                  ${selectedTickers.includes(translateTicker(stock.ticker)) ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'}`}
                                title={selectedTickers.includes(translateTicker(stock.ticker)) ? "Remove from watchlist" : "Add to watchlist"}
                              >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill={selectedTickers.includes(translateTicker(stock.ticker)) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5">
                                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                                </svg>
                              </button>
                              {renderBenchmarkTags(stock.benchmarks)}
                            </>
                          );
                        })()}
                      </div>
                      {activeSlot === 3 && (
                        <span className="text-[10px] text-indigo-500 font-bold uppercase">Active</span>
                      )}
                    </div>
                    <div className="flex-1 w-full h-full min-h-0 relative">
                      <TradingViewChart
                        key={`tv-slot-3-${symbols[3]}-${timeframe}-${chartStyle}`}
                        containerId="tradingview_slot_3"
                        symbol={symbols[3]}
                        timeframe={timeframe}
                        chartStyle={chartStyle}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

          </div>
        </div>
      </div>

    </div>
  );
}

interface TradingViewChartProps {
  containerId: string;
  symbol: string;
  timeframe: string;
  chartStyle: string;
}

function LazyTradingViewChart(props: TradingViewChartProps) {
  const [inView, setInView] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="flex-1 w-full h-full flex flex-col">
      {inView ? (
        <TradingViewChart {...props} />
      ) : (
        <div className="flex-1 w-full flex items-center justify-center bg-[#070b12] text-slate-500 text-xs font-mono rounded-b-2xl">
          <div className="w-6 h-6 border-2 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin mr-3" />
          Loading {props.symbol} chart data...
        </div>
      )}
    </div>
  );
}

function TradingViewChart({ containerId, symbol, timeframe, chartStyle }: TradingViewChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [candles, setCandles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredCandle, setHoveredCandle] = useState<any | null>(null);

  // Theme listener to redraw the chart on theme toggle
  const [themeState, setThemeState] = useState(document.documentElement.classList.contains('light') ? 'light' : 'dark');

  useEffect(() => {
    const handleThemeChange = () => {
      setThemeState(document.documentElement.classList.contains('light') ? 'light' : 'dark');
    };
    window.addEventListener('theme-change', handleThemeChange);
    return () => window.removeEventListener('theme-change', handleThemeChange);
  }, []);

  const getTickerForApi = (sym: string) => {
    if (sym.startsWith('NSE:')) return `${sym.replace('NSE:', '')}.NS`;
    if (sym.startsWith('BSE:')) return `${sym.replace('BSE:', '')}.BO`;
    return sym;
  };

  const periodMap: Record<string, string> = {
    '6M': '6mo',
    '1Y': '1y',
    '2Y': '2y',
    '3Y': '5y',  // Fetch 5y from Yahoo and filter to last 3y
    '5Y': '5y',
    '10Y': '10y',
    'D': '2y',
    'W': '5y',
    'M': 'max'
  };

  const intervalMap: Record<string, string> = {
    '6M': '1d',
    '1Y': '1d',
    '2Y': '1d',
    '3Y': '1d',
    '5Y': '1wk',
    '10Y': '1mo',
    'D': '1d',
    'W': '1wk',
    'M': '1mo'
  };

  const fetchCandles = useCallback(async () => {
    setLoading(true);
    const ticker = getTickerForApi(symbol);
    const period = periodMap[timeframe] || '1y';
    const interval = intervalMap[timeframe] || '1d';
    try {
      const data = await api<{ ticker: string; candles: any[] }>(
        `/stock/${ticker}/candles?period=${period}&interval=${interval}`
      );

      // Filter out any candles where yfinance returned null/NaN for prices
      let validCandles = (data.candles || []).filter(c =>
        c.open != null && !isNaN(c.open) &&
        c.high != null && !isNaN(c.high) &&
        c.low != null && !isNaN(c.low) &&
        c.close != null && !isNaN(c.close)
      );

      // If timeframe is 3Y, we fetched 5Y. Let's filter to last 3 years.
      if (timeframe === '3Y') {
        const threeYearsAgo = new Date();
        threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
        validCandles = validCandles.filter(c => new Date(c.time) >= threeYearsAgo);
      }

      setCandles(validCandles);
    } catch (e) {
      console.error("Failed to load candles:", e);
      setCandles([]);
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe]);

  useEffect(() => {
    fetchCandles();
  }, [fetchCandles]);

  useEffect(() => {
    if (loading || candles.length === 0 || !chartContainerRef.current) return;

    const container = chartContainerRef.current;

    const isLight = themeState === 'light';
    const chartBg = isLight ? '#ffffff' : '#080c14';
    const chartText = isLight ? '#475569' : '#94a3b8';
    const gridColor = isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.02)';
    const borderColor = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.07)';

    // Create chart instance
    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: chartBg },
        textColor: chartText,
      },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      rightPriceScale: {
        borderColor: borderColor,
      },
      timeScale: {
        borderColor: borderColor,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: any, tickMarkType: number) => {
          const dateStr = typeof time === 'string'
            ? time
            : (time.year ? `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}` : null);

          if (!dateStr) return String(time);

          const d = new Date(dateStr);
          const month = d.toLocaleString('en-US', { month: 'short' });

          // tickMarkType: 0=Year, 1=Month, 2=DayOfMonth
          if (tickMarkType === 0) return d.getFullYear().toString();
          if (tickMarkType === 1) return `${month} '${d.getFullYear().toString().slice(2)}`;
          if (tickMarkType === 2) return `${d.getDate()} ${month}`;

          return d.toLocaleDateString();
        },
      },
      crosshair: {
        vertLine: {
          color: '#6366f1',
          width: 1,
          style: 3, // dashed
          labelBackgroundColor: '#6366f1',
        },
        horzLine: {
          color: '#6366f1',
          width: 1,
          style: 3, // dashed
          labelBackgroundColor: '#6366f1',
        },
      },
    });

    // Add main series based on style
    let mainSeries: any;

    if (chartStyle === '2' || chartStyle === '3') {
      // Line or Area Series
      if (chartStyle === '3') {
        mainSeries = chart.addSeries(AreaSeries, {
          lineColor: '#6366f1',
          topColor: 'rgba(99, 102, 241, 0.25)',
          bottomColor: 'rgba(99, 102, 241, 0.0)',
          lineWidth: 2,
          priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
        });
      } else {
        mainSeries = chart.addSeries(LineSeries, {
          color: '#6366f1',
          lineWidth: 2,
          priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
        });
      }

      const lineData = candles.map(c => ({
        time: c.time,
        value: c.close,
      }));
      mainSeries.setData(lineData);
    } else {
      // Candlestick Series (Default & Heikin Ashi)
      mainSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      });

      mainSeries.setData(candles);
    }

    // Add volume series at the bottom
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#3b82f6',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '', // Overlay over main pane
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8, // volume takes only bottom 20% of area
        bottom: 0,
      },
    });

    const volumeData = candles.map(c => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)',
    }));
    volumeSeries.setData(volumeData);

    // Responsive sizing
    const handleResize = () => {
      if (container) {
        chart.applyOptions({
          width: container.clientWidth,
          height: container.clientHeight,
        });
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // Initial sizing
    handleResize();

    // Fit the timeline perfectly to the selected timeframe data
    chart.timeScale().fitContent();

    // Hover tooltip / status overlay callback
    chart.subscribeCrosshairMove(param => {
      if (
        param.time &&
        param.point &&
        param.seriesData.size > 0
      ) {
        const data = param.seriesData.get(mainSeries) as any;
        const vol = param.seriesData.get(volumeSeries) as any;
        if (data) {
          setHoveredCandle({
            time: param.time,
            open: data.open ?? data.value,
            high: data.high ?? data.value,
            low: data.low ?? data.value,
            close: data.close ?? data.value,
            volume: vol ? vol.value : 0,
          });
        }
      } else {
        setHoveredCandle(null);
      }
    });

    // Cleanup on unmount
    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [loading, candles, chartStyle, themeState]);

  // Show loading skeleton
  if (loading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[#070b12] gap-3 text-slate-500">
        <div className="w-8 h-8 border-2 border-indigo-600/30 border-t-indigo-600 rounded-full animate-spin" />
        <span className="text-xs font-mono">Fetching candle data…</span>
      </div>
    );
  }

  // Show empty state
  if (candles.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[#070b12] text-slate-600 p-6 text-center">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="10" /><line x1="8" y1="12" x2="16" y2="12" />
        </svg>
        <p className="text-xs mt-2 font-mono">Candlestick data unavailable for {symbol}.</p>
      </div>
    );
  }

  // Determine latest candle for status display when not hovering
  const latestCandle = candles[candles.length - 1];
  const displayData = hoveredCandle || {
    time: latestCandle.time,
    open: latestCandle.open,
    high: latestCandle.high,
    low: latestCandle.low,
    close: latestCandle.close,
    volume: latestCandle.volume,
  };

  const safeVal = (v: any) => (v === null || v === undefined || isNaN(v)) ? null : Number(v);

  const o = safeVal(displayData.open);
  const h = safeVal(displayData.high);
  const l = safeVal(displayData.low);
  const c = safeVal(displayData.close);
  const v = safeVal(displayData.volume);

  const priceChange = (c !== null && o !== null) ? c - o : null;
  const pctChange = (priceChange !== null && o !== null && o !== 0) ? (priceChange / o) * 100 : null;
  const changeColor = priceChange !== null && priceChange >= 0 ? 'text-green-400' : 'text-red-400';

  return (
    <div className="w-full h-full flex flex-col relative bg-[#080c14] select-none">
      {/* Real-time OHLCV Info Bar Overlay */}
      <div className="ohlcv-bar absolute top-2 left-3 z-10 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono bg-[#0d1420]/80 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/[0.05] shadow-lg pointer-events-none">
        <div>
          <span className="text-slate-500">O:</span>{' '}
          <span className="text-slate-300 font-bold">{o !== null ? `₹${o.toFixed(2)}` : '—'}</span>
        </div>
        <div>
          <span className="text-slate-500">H:</span>{' '}
          <span className="text-slate-300 font-bold">{h !== null ? `₹${h.toFixed(2)}` : '—'}</span>
        </div>
        <div>
          <span className="text-slate-500">L:</span>{' '}
          <span className="text-slate-300 font-bold">{l !== null ? `₹${l.toFixed(2)}` : '—'}</span>
        </div>
        <div>
          <span className="text-slate-500">C:</span>{' '}
          <span className="text-slate-300 font-bold">{c !== null ? `₹${c.toFixed(2)}` : '—'}</span>
        </div>
        <div>
          <span className="text-slate-500">V:</span>{' '}
          <span className="text-slate-300 font-bold">{v !== null ? `${(v / 1000000).toFixed(2)}M` : '—'}</span>
        </div>
        <div className={`font-bold ${changeColor}`}>
          {priceChange !== null ? (priceChange >= 0 ? '+' : '') + priceChange.toFixed(2) : '—'}
          {pctChange !== null ? ` (${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(2)}%)` : ''}
        </div>
      </div>

      {/* Lightweight Chart Container */}
      <div id={containerId} ref={chartContainerRef} className="flex-1 w-full h-full min-h-0" />
    </div>
  );
}

interface CompanySelectProps {
  stocks: StockAnalysis[];
  onSelect: (stock: StockAnalysis) => void;
  activeTvSymbol: string;
  translateTicker: (t: string) => string;
  selectedTickers: string[];
  onToggleWatchlist: (ticker: string) => void;
}

function CompanySelect({ stocks, onSelect, activeTvSymbol, translateTicker, selectedTickers, onToggleWatchlist }: CompanySelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentStock = stocks.find(s => translateTicker(s.ticker) === activeTvSymbol);
  const displayText = currentStock 
    ? `${currentStock.ticker.replace('.NS', '').replace('.BO', '')} - ${currentStock.name || ''}`
    : activeTvSymbol || 'Select Company…';

  const filtered = useMemo(() => {
    if (!search.trim()) return stocks;
    const q = search.toLowerCase();
    return stocks.filter(s => 
      s.ticker.toLowerCase().includes(q) || 
      (s.name && s.name.toLowerCase().includes(q))
    );
  }, [stocks, search]);

  return (
    <div ref={containerRef} className="relative w-64 z-30">
      <button
        type="button"
        onClick={() => {
          setOpen(prev => !prev);
          if (!open) setSearch('');
        }}
        className={`w-full flex items-center justify-between gap-2.5 bg-white/[0.04] border rounded-xl px-3 py-2 text-xs text-left transition-all outline-none cursor-pointer
          ${open
            ? 'border-indigo-500/50 ring-1 ring-indigo-500/20 text-slate-200'
            : 'border-white/[0.08] text-slate-300 hover:border-white/20 hover:bg-white/[0.06]'
          }`}
      >
        <span className="truncate font-semibold text-slate-200">{displayText}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={`shrink-0 text-slate-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1.5 w-full bg-[#0d1420] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-80"
          style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.65)' }}
        >
          <div className="p-2 border-b border-white/[0.06] bg-white/[0.01]">
            <input
              type="text"
              autoFocus
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-indigo-500/30 transition-all"
              placeholder="Search by company or ticker…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="overflow-y-auto py-1 divide-y divide-white/[0.02]">
            {filtered.length === 0 ? (
              <div className="px-3.5 py-4 text-center text-xs text-slate-500">
                No companies found
              </div>
            ) : (
              filtered.map(stock => {
                const isSelected = translateTicker(stock.ticker) === activeTvSymbol;
                const cleanTicker = stock.ticker.replace('.NS', '').replace('.BO', '');
                return (
                  <div
                    key={stock.ticker}
                    className={`w-full text-left px-3.5 py-1.5 text-[11px] transition-colors flex items-center justify-between group/item cursor-pointer
                      ${isSelected
                        ? 'bg-indigo-600/15 text-indigo-400 font-bold border-l-2 border-indigo-500'
                        : 'text-slate-300 hover:bg-white/[0.04] hover:text-slate-100'
                      }`}
                  >
                    <div 
                      className="flex-1 flex flex-col gap-0.5 min-w-0"
                      onClick={() => {
                        onSelect(stock);
                        setOpen(false);
                      }}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="font-mono text-indigo-400 font-bold">{cleanTicker}</span>
                        {stock.composite_score != null && (
                          <span className="text-[10px] text-slate-500 font-mono">Score: {stock.composite_score.toFixed(0)}</span>
                        )}
                      </div>
                      <span className="text-slate-500 text-[10px] truncate max-w-full">{stock.name || '—'}</span>
                    </div>
                    
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleWatchlist(stock.ticker);
                      }}
                      className={`p-1.5 ml-2 hover:bg-white/5 rounded-lg transition-colors cursor-pointer
                        ${selectedTickers.includes(translateTicker(stock.ticker)) ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'}`}
                      title={selectedTickers.includes(translateTicker(stock.ticker)) ? "Remove from watchlist" : "Add to watchlist"}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill={selectedTickers.includes(translateTicker(stock.ticker)) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FullscreenPresenter({
  selectedTickers,
  onClose,
  timeframe,
  chartStyle,
}: {
  selectedTickers: string[];
  onClose: () => void;
  timeframe: string;
  chartStyle: string;
}) {
  // ESC key to exit
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-[#070b13] flex flex-col animate-fade-in font-sans">
      {/* Header bar */}
      <div className="bg-[#0b121f] border-b border-white/[0.08] px-6 py-4 flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-white/[0.06] text-slate-400 hover:text-slate-200 transition-colors cursor-pointer flex items-center justify-center"
            title="Exit Fullscreen"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          
          <div className="h-5 w-px bg-white/10" />

          <div>
            <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <span className="text-indigo-400">Fullscreen Watchlist Grid</span>
              <span className="text-slate-500 text-xs font-mono font-medium">
                ({selectedTickers.length} assets selected)
              </span>
            </h2>
          </div>
        </div>

        {/* Selected Ticker Summary Badges */}
        <div className="hidden lg:flex items-center gap-1.5 max-w-xl overflow-x-auto px-4 py-1 scrollbar-none">
          {selectedTickers.map((ticker) => (
            <span
              key={ticker}
              className="px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px] font-mono font-bold shrink-0"
            >
              {ticker.replace('NSE:', '').replace('BSE:', '')}
            </span>
          ))}
        </div>

        {/* Done / Exit */}
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-all hover:shadow-[0_0_12px_rgba(99,102,241,0.4)] cursor-pointer"
          >
            Exit Fullscreen
          </button>
        </div>
      </div>

      {/* Main Grid Scroll Area */}
      <div className="flex-1 w-full overflow-y-auto p-6 bg-[#080c14]">
        {/* Navigation hotkey guide */}
        <div className="fixed bottom-4 right-4 z-20 text-[10px] text-slate-600 bg-[#0d1420]/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/[0.05] pointer-events-none select-none font-mono flex items-center gap-2 shadow-lg">
          <span>Keyboard:</span>
          <kbd className="bg-white/5 border border-white/10 px-1 py-0.2 rounded">ESC</kbd>
          <span>to exit</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-6 w-full max-w-[1800px] mx-auto pb-8">
          {selectedTickers.map((tvSym, idx) => (
            <div
              key={tvSym}
              className="relative bg-[#0d1420] rounded-2xl overflow-hidden border border-white/[0.06] flex flex-col shrink-0 shadow-lg hover:border-white/[0.12] transition-colors"
              style={{ minHeight: '480px', height: '480px' }}
            >
              {/* Header */}
              <div className="px-4 py-2 bg-white/[0.02] border-b border-white/[0.05] shrink-0 flex items-center justify-between text-xs font-mono font-semibold">
                <span className="text-indigo-400">
                  #{idx + 1}: <span className="text-slate-300">{tvSym}</span>
                </span>
              </div>
              
              {/* Chart */}
              <div className="flex-1 w-full relative p-0 flex flex-col">
                <LazyTradingViewChart
                  containerId={`tradingview_fullscreen_lazy_${idx}`}
                  symbol={tvSym}
                  timeframe={timeframe}
                  chartStyle={chartStyle}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
