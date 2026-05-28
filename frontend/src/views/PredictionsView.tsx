import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

interface PredictionItem {
  id: number;
  analysis_id: number;
  predicted_price: number;
  actual_price: number;
  error_margin: number;
  evaluated_at: string;
}

interface PredictionsResponse {
  ticker: string;
  predictions: PredictionItem[];
}

export default function PredictionsView() {
  const [ticker, setTicker] = useState('TCS.NS');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PredictionItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchPredictions = useCallback(async (sym: string) => {
    if (!sym) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api<PredictionsResponse>(`/stock/${sym.toUpperCase()}/predictions`);
      setData(res.predictions || []);
    } catch (e) {
      setError((e as Error).message);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPredictions(ticker);
  }, []); // eslint-disable-line

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (ticker.trim()) {
      fetchPredictions(ticker.trim());
    }
  };

  // KPIs
  const totalEvaluated = data.length;
  const avgAccuracy = totalEvaluated > 0
    ? (100 - (data.reduce((sum, item) => sum + Math.abs(item.error_margin), 0) / totalEvaluated) * 100).toFixed(2)
    : '—';
  
  const minDev = totalEvaluated > 0
    ? (Math.min(...data.map(item => Math.abs(item.error_margin))) * 100).toFixed(2)
    : '—';

  // SVG Chart Calculation
  const renderChart = () => {
    if (data.length < 2) {
      return (
        <div className="flex items-center justify-center h-48 border border-white/[0.06] rounded-2xl bg-white/[0.01] text-xs text-slate-500">
          Need at least 2 historical prediction data points to render track chart
        </div>
      );
    }

    // Sort chronologically for charting
    const sortedData = [...data].sort((a, b) => new Date(a.evaluated_at).getTime() - new Date(b.evaluated_at).getTime());

    const width = 500;
    const height = 180;
    const padding = 20;

    const prices = sortedData.flatMap(d => [d.predicted_price, d.actual_price]);
    const minPrice = Math.min(...prices) * 0.95;
    const maxPrice = Math.max(...prices) * 1.05;
    const priceRange = maxPrice - minPrice;

    const points = sortedData.map((d, i) => {
      const x = padding + (i / (sortedData.length - 1)) * (width - 2 * padding);
      const yPred = height - padding - ((d.predicted_price - minPrice) / priceRange) * (height - 2 * padding);
      const yAct = height - padding - ((d.actual_price - minPrice) / priceRange) * (height - 2 * padding);
      return { x, yPred, yAct };
    });

    const predPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.yPred}`).join(' ');
    const actPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.yAct}`).join(' ');

    return (
      <div className="border border-white/[0.06] rounded-2xl p-5 bg-white/[0.01] space-y-3 relative overflow-hidden">
        <div className="absolute top-4 right-4 flex items-center gap-4 text-[10px] uppercase font-mono tracking-wider font-semibold">
          <div className="flex items-center gap-1.5 text-indigo-400">
            <span className="w-2.5 h-0.5 bg-indigo-500 inline-block" /> Target (Base)
          </div>
          <div className="flex items-center gap-1.5 text-emerald-400">
            <span className="w-2.5 h-0.5 bg-emerald-500 inline-block" /> Actual Price
          </div>
        </div>
        <h3 className="text-xs font-semibold text-slate-400 font-mono">Prediction vs Actual Track</h3>
        
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto mt-2">
          {/* Gradients */}
          <defs>
            <linearGradient id="predGlow" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#818cf8" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#c084fc" stopOpacity="0.8" />
            </linearGradient>
            <linearGradient id="actGlow" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.8" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="rgba(255,255,255,0.03)" strokeDasharray="3" />
          <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="rgba(255,255,255,0.03)" strokeDasharray="3" />
          <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="rgba(255,255,255,0.05)" />

          {/* Chart Paths */}
          <path d={predPath} fill="none" stroke="url(#predGlow)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d={actPath} fill="none" stroke="url(#actGlow)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

          {/* Data Nodes */}
          {points.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.yPred} r="3" fill="#818cf8" stroke="rgba(8,12,20,1)" strokeWidth="1" />
              <circle cx={p.x} cy={p.yAct} r="3" fill="#34d399" stroke="rgba(8,12,20,1)" strokeWidth="1" />
            </g>
          ))}
        </svg>
      </div>
    );
  };

  return (
    <div className="space-y-6 fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Prediction Backtesting</h1>
          <p className="text-slate-500 text-sm mt-1">Audit and track accuracy of AI-generated price targets against live market metrics</p>
        </div>

        {/* Search Ticker */}
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all font-mono w-48"
            placeholder="Search Ticker... (e.g. TCS.NS)"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
          />
          <button
            type="submit"
            className="flex items-center justify-center p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </button>
        </form>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          Error retrieving prediction records: {error}
        </div>
      )}

      {/* KPI Blocks */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5 hover:bg-white/[0.04] transition-colors">
          <div className="text-3xl font-black font-mono text-indigo-400">{totalEvaluated}</div>
          <div className="text-xs text-slate-500 uppercase tracking-widest font-semibold mt-1">Predictions Audited</div>
        </div>
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5 hover:bg-white/[0.04] transition-colors">
          <div className="text-3xl font-black font-mono text-emerald-400">{avgAccuracy}%</div>
          <div className="text-xs text-slate-500 uppercase tracking-widest font-semibold mt-1">Avg Forecast Accuracy</div>
        </div>
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5 hover:bg-white/[0.04] transition-colors">
          <div className="text-3xl font-black font-mono text-purple-400">{minDev}%</div>
          <div className="text-xs text-slate-500 uppercase tracking-widest font-semibold mt-1">Lowest Deviation</div>
        </div>
      </div>

      {/* Track Chart */}
      {!loading && renderChart()}

      {/* Evaluation List */}
      <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <h2 className="text-sm font-semibold text-slate-300">Historical Evaluation Log</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-400">
            <thead className="bg-white/[0.02] text-xs font-mono uppercase text-slate-500">
              <tr>
                <th className="px-6 py-3 font-semibold">Evaluation Date</th>
                <th className="px-6 py-3 font-semibold">AI Target (Base)</th>
                <th className="px-6 py-3 font-semibold">Actual Price</th>
                <th className="px-6 py-3 font-semibold">Error Margin</th>
                <th className="px-6 py-3 font-semibold">Forecast Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={5} className="px-6 py-4">
                      <div className="h-5 shimmer rounded w-full" />
                    </td>
                  </tr>
                ))
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-slate-600 font-mono text-xs">
                    No prediction performance audits found. Target price backtests execute during yfinance ingestions.
                  </td>
                </tr>
              ) : (
                data.map((item) => {
                  const errorPct = (item.error_margin * 100).toFixed(1);
                  const isUnder = item.error_margin < 0;
                  const isPerfect = Math.abs(item.error_margin) <= 0.05;

                  return (
                    <tr key={item.id} className="hover:bg-white/[0.01] transition-colors">
                      <td className="px-6 py-4 font-mono text-xs text-slate-300">
                        {new Date(item.evaluated_at).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-6 py-4 font-mono font-bold text-indigo-400">₹{item.predicted_price.toFixed(1)}</td>
                      <td className="px-6 py-4 font-mono font-bold text-emerald-400">₹{item.actual_price.toFixed(1)}</td>
                      <td className={`px-6 py-4 font-mono font-semibold ${isPerfect ? 'text-emerald-400' : isUnder ? 'text-indigo-400' : 'text-purple-400'}`}>
                        {isUnder ? '' : '+'}{errorPct}%
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${
                          isPerfect 
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                            : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                        }`}>
                          {isPerfect ? 'Highly Accurate' : isUnder ? 'Underestimated' : 'Overestimated'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
