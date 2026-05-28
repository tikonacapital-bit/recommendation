import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api, scoreColor } from '../lib/api';
import type { StockAnalysis, TopResponse } from '../lib/types';
import { useToast } from '../components/Toast';
import { createChart, ColorType, CandlestickSeries, LineSeries, AreaSeries, HistogramSeries } from 'lightweight-charts';

type ChartLayout = 'single' | 'dual' | 'quad';
type Timeframe = '5' | '15' | '60' | 'D' | 'W' | 'M';
type ChartStyle = '1' | '2' | '3' | '8'; // 1=Candles, 2=Line, 3=Area, 8=Heikin Ashi

export default function ChartsView() {
  const { toast } = useToast();
  const [data, setData] = useState<StockAnalysis[]>([]);
  const [loadingUniverse, setLoadingUniverse] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Multi-chart slot management (max 4 slots for quad view)
  const [symbols, setSymbols] = useState<string[]>([
    'NSE:TCS',
    'NSE:RELIANCE',
    'NSE:INFY',
    'NSE:HDFCBANK',
  ]);
  const [activeSlot, setActiveSlot] = useState<number>(0);
  const [layout, setLayout] = useState<ChartLayout>('single');
  const [timeframe, setTimeframe] = useState<Timeframe>('D');
  const [chartStyle, setChartStyle] = useState<ChartStyle>('1');
  const [customSymbol, setCustomSymbol] = useState('');

  // Load the tracked stocks universe for the sidebar
  const loadUniverse = useCallback(async () => {
    setLoadingUniverse(true);
    try {
      const resp = await api<TopResponse>('/top?limit=150');
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
  }, [toast]);

  useEffect(() => {
    loadUniverse();
  }, [loadUniverse]);

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

  // Filtered sidebar tickers based on search
  const filteredStocks = useMemo(() => {
    return data.filter(stock => {
      const q = searchQuery.toLowerCase();
      return (
        stock.ticker.toLowerCase().includes(q) ||
        (stock.name && stock.name.toLowerCase().includes(q)) ||
        (stock.sector && stock.sector.toLowerCase().includes(q))
      );
    });
  }, [data, searchQuery]);

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
    if (layout === 'dual') return 'grid-cols-1 xl:grid-cols-2';
    if (layout === 'quad') return 'grid-cols-1 md:grid-cols-2';
    return 'grid-cols-1';
  };

  return (
    <div className="flex flex-col xl:flex-row gap-5 h-[calc(100vh-100px)] min-h-[550px] fade-in relative select-none">
      
      {/* ── LEFT SIDEBAR: Stocks Universe List ── */}
      <div className="w-full xl:w-72 bg-white/[0.02] border border-white/[0.07] rounded-2xl flex flex-col shrink-0 overflow-hidden h-full">
        {/* Search Header */}
        <div className="p-4 border-b border-white/[0.06] shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-200">Tracked Universe</h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">
              {filteredStocks.length}
            </span>
          </div>

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
                  className={`p-3 cursor-pointer text-left transition-all duration-150 relative group ${
                    isLoadedInActiveSlot
                      ? 'bg-indigo-500/10 border-l-2 border-indigo-500'
                      : isLoadedInAnySlot
                      ? 'bg-white/[0.02] border-l-2 border-white/20 hover:bg-white/[0.04]'
                      : 'hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold font-mono text-indigo-400 group-hover:text-indigo-300 transition-colors">
                      {stock.ticker}
                    </span>
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
                    <span className="truncate max-w-[120px]">{stock.sector || '—'}</span>
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

      {/* ── MAIN WORKSPACE PANEL ── */}
      <div className="flex-1 flex flex-col gap-4 h-full min-w-0">
        
        {/* Custom Controls Bar */}
        <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl px-4 py-3 shrink-0 flex flex-wrap gap-4 items-center justify-between">
          <div className="flex items-center gap-4 flex-wrap">
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
              {(['5', '15', '60', 'D', 'W', 'M'] as Timeframe[]).map(tf => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`px-2.5 py-1 rounded transition-all font-bold ${
                    timeframe === tf
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {tf === '60' ? '1H' : tf === '5' ? '5M' : tf === '15' ? '15M' : tf}
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
                  className={`px-2 py-1 rounded transition-all font-medium ${
                    chartStyle === styleOpt.id
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
                { id: 'single' as ChartLayout, label: 'Single', icon: (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                  </svg>
                )},
                { id: 'dual' as ChartLayout, label: 'Split', icon: (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="12" y1="3" x2="12" y2="21" />
                  </svg>
                )},
                { id: 'quad' as ChartLayout, label: 'Quad', icon: (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="12" y1="3" x2="12" y2="21" /><line x1="3" y1="12" x2="21" y2="12" />
                  </svg>
                )}
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
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    layout === mode.id
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {mode.icon}
                  <span className="hidden sm:inline">{mode.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Charts Container Panel */}
        <div className="flex-1 flex gap-5 min-h-0">
          
          {/* Main Chart Matrix */}
          <div className={`flex-1 grid gap-4 min-h-0 h-full ${getLayoutGridClass()}`}>
            
            {/* Render chart for Slot 0 */}
            <div
              onClick={() => setActiveSlot(0)}
              className={`relative bg-[#0d1420] rounded-2xl overflow-hidden border transition-all flex flex-col h-full ${
                activeSlot === 0
                  ? 'border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.15)]'
                  : 'border-white/[0.06] hover:border-white/[0.12]'
              }`}
            >
              {/* Slot Header */}
              <div className="px-4 py-2 bg-white/[0.02] border-b border-white/[0.05] shrink-0 flex items-center justify-between text-xs font-mono font-semibold">
                <span className={activeSlot === 0 ? 'text-indigo-400' : 'text-slate-500'}>
                  Panel 1: <span className="text-slate-300">{symbols[0]}</span>
                </span>
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
                className={`relative bg-[#0d1420] rounded-2xl overflow-hidden border transition-all flex flex-col h-full ${
                  activeSlot === 1
                    ? 'border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.15)]'
                    : 'border-white/[0.06] hover:border-white/[0.12]'
                }`}
              >
                <div className="px-4 py-2 bg-white/[0.02] border-b border-white/[0.05] shrink-0 flex items-center justify-between text-xs font-mono font-semibold">
                  <span className={activeSlot === 1 ? 'text-indigo-400' : 'text-slate-500'}>
                    Panel 2: <span className="text-slate-300">{symbols[1]}</span>
                  </span>
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
                className={`relative bg-[#0d1420] rounded-2xl overflow-hidden border transition-all flex flex-col h-full ${
                  activeSlot === 2
                    ? 'border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.15)]'
                    : 'border-white/[0.06] hover:border-white/[0.12]'
                }`}
              >
                <div className="px-4 py-2 bg-white/[0.02] border-b border-white/[0.05] shrink-0 flex items-center justify-between text-xs font-mono font-semibold">
                  <span className={activeSlot === 2 ? 'text-indigo-400' : 'text-slate-500'}>
                    Panel 3: <span className="text-slate-300">{symbols[2]}</span>
                  </span>
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
                className={`relative bg-[#0d1420] rounded-2xl overflow-hidden border transition-all flex flex-col h-full ${
                  activeSlot === 3
                    ? 'border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.15)]'
                    : 'border-white/[0.06] hover:border-white/[0.12]'
                }`}
              >
                <div className="px-4 py-2 bg-white/[0.02] border-b border-white/[0.05] shrink-0 flex items-center justify-between text-xs font-mono font-semibold">
                  <span className={activeSlot === 3 ? 'text-indigo-400' : 'text-slate-500'}>
                    Panel 4: <span className="text-slate-300">{symbols[3]}</span>
                  </span>
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

function TradingViewChart({ containerId, symbol, timeframe, chartStyle }: TradingViewChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [candles, setCandles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredCandle, setHoveredCandle] = useState<any | null>(null);

  const getTickerForApi = (sym: string) => {
    if (sym.startsWith('NSE:')) return `${sym.replace('NSE:', '')}.NS`;
    if (sym.startsWith('BSE:')) return `${sym.replace('BSE:', '')}.BO`;
    return sym;
  };

  const periodMap: Record<string, string> = {
    '5': '1mo',
    '15': '3mo',
    '60': '6mo',
    'D': '1y',
    'W': '2y',
    'M': '5y'
  };

  const fetchCandles = useCallback(async () => {
    setLoading(true);
    const ticker = getTickerForApi(symbol);
    const period = periodMap[timeframe] || '1y';
    try {
      const data = await api<{ ticker: string; candles: any[] }>(
        `/stock/${ticker}/candles?period=${period}`
      );
      setCandles(data.candles || []);
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
    
    // Create chart instance
    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#080c14' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.02)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.02)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.07)',
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.07)',
        timeVisible: true,
        secondsVisible: false,
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
  }, [loading, candles, chartStyle]);

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
          <circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>
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

  const priceChange = displayData.close - displayData.open;
  const pctChange = (priceChange / displayData.open) * 100;
  const changeColor = priceChange >= 0 ? 'text-green-400' : 'text-red-400';

  return (
    <div className="w-full h-full flex flex-col relative bg-[#080c14] select-none">
      {/* Real-time OHLCV Info Bar Overlay */}
      <div className="absolute top-2 left-3 z-10 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono bg-[#0d1420]/80 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/[0.05] shadow-lg pointer-events-none">
        <div>
          <span className="text-slate-500">O:</span>{' '}
          <span className="text-slate-300 font-bold">₹{displayData.open.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-slate-500">H:</span>{' '}
          <span className="text-slate-300 font-bold">₹{displayData.high.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-slate-500">L:</span>{' '}
          <span className="text-slate-300 font-bold">₹{displayData.low.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-slate-500">C:</span>{' '}
          <span className="text-slate-300 font-bold">₹{displayData.close.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-slate-500">V:</span>{' '}
          <span className="text-slate-300 font-bold">{(displayData.volume / 1000000).toFixed(2)}M</span>
        </div>
        <div className={`font-bold ${changeColor}`}>
          {priceChange >= 0 ? '+' : ''}
          {priceChange.toFixed(2)} ({priceChange >= 0 ? '+' : ''}
          {pctChange.toFixed(2)}%)
        </div>
      </div>

      {/* Lightweight Chart Container */}
      <div ref={chartContainerRef} className="flex-1 w-full h-full min-h-0" />
    </div>
  );
}
