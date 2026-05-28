import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

interface TrendData {
  [key: string]: number;
}

interface FinancialsResponse {
  ticker: string;
  revenue: TrendData;
  pat: TrendData;
  ebitda: TrendData;
}

export default function FinancialCharts({ ticker }: { ticker: string }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<FinancialsResponse | null>(null);

  const fetchFinancials = useCallback(async (sym: string) => {
    if (!sym) return;
    setLoading(true);
    try {
      const res = await api<FinancialsResponse>(`/stock/${sym.toUpperCase()}/financials`);
      setData(res);
    } catch (e) {
      console.error("Failed to load financials trend:", e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFinancials(ticker);
  }, [ticker, fetchFinancials]);

  if (loading) {
    return <div className="h-32 shimmer rounded-2xl" />;
  }

  if (!data || !data.revenue || Object.keys(data.revenue).length === 0) {
    return (
      <p className="text-xs text-slate-600 text-center py-4 border border-white/[0.05] rounded-xl bg-white/[0.01]">
        Multi-year historical financial trends are unavailable for this stock.
      </p>
    );
  }

  const revKeys = Object.keys(data.revenue).sort();
  const revValues = revKeys.map(k => data.revenue[k]);
  const maxRev = Math.max(...revValues) * 1.1 || 1;

  // PAT
  const patKeys = data.pat ? Object.keys(data.pat).sort() : [];
  const patValues = patKeys.map(k => data.pat[k]);
  const maxPat = Math.max(...patValues, 1) * 1.1;
  const minPat = Math.min(...patValues, 0) * 1.1;
  const patRange = maxPat - minPat || 1;

  // Render SVG Revenue Bars
  const renderRevenueChart = () => {
    const width = 240;
    const height = 120;
    const padding = 15;
    const barWidth = 28;
    const gap = 18;

    return (
      <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-4 flex flex-col gap-2 flex-1">
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold font-mono">Revenue Trend</span>
          <span className="text-[9px] text-slate-600 font-mono">₹ in Cr.</span>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto mt-1 select-none">
          <defs>
            <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#818cf8" stopOpacity="0.2" />
            </linearGradient>
          </defs>

          {/* Grid line */}
          <line x1="0" y1={height - padding} x2={width} y2={height - padding} stroke="rgba(255,255,255,0.08)" />

          {revKeys.map((k, i) => {
            const val = data.revenue[k];
            const pct = val / maxRev;
            const barHeight = (height - 2 * padding) * pct;
            const x = padding + i * (barWidth + gap) + 10;
            const y = height - padding - barHeight;

            return (
              <g key={k}>
                {/* Bar */}
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  fill="url(#revGrad)"
                  rx="4"
                  className="transition-all duration-300 hover:fill-indigo-500"
                />
                {/* Value Label */}
                <text
                  x={x + barWidth / 2}
                  y={y - 4}
                  fill="#c7d2fe"
                  fontSize="8"
                  fontWeight="bold"
                  textAnchor="middle"
                  className="font-mono"
                >
                  {val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val.toFixed(0)}
                </text>
                {/* Period Label */}
                <text
                  x={x + barWidth / 2}
                  y={height - 4}
                  fill="rgba(255,255,255,0.3)"
                  fontSize="8"
                  textAnchor="middle"
                  className="font-mono"
                >
                  {k}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  };

  // Render SVG Net Profit Line
  const renderPatChart = () => {
    if (patKeys.length < 2) return null;

    const width = 240;
    const height = 120;
    const padding = 15;

    const points = patKeys.map((k, i) => {
      const val = data.pat[k];
      const x = padding + (i / (patKeys.length - 1)) * (width - 2 * padding);
      const y = height - padding - ((val - minPat) / patRange) * (height - 2 * padding);
      return { x, y, k, val };
    });

    const pathStr = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const areaPathStr = points.length > 0
      ? `${pathStr} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`
      : '';

    return (
      <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-4 flex flex-col gap-2 flex-1">
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold font-mono">Net Profit (PAT)</span>
          <span className="text-[9px] text-slate-600 font-mono">₹ in Cr.</span>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto mt-1 select-none">
          <defs>
            <linearGradient id="patAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#34d399" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid line */}
          <line x1="0" y1={height - padding} x2={width} y2={height - padding} stroke="rgba(255,255,255,0.08)" />

          {/* Area under line */}
          {areaPathStr && <path d={areaPathStr} fill="url(#patAreaGrad)" className="pointer-events-none" />}

          {/* Line Path */}
          {pathStr && (
            <path
              d={pathStr}
              fill="none"
              stroke="#34d399"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="pointer-events-none"
              style={{ filter: 'drop-shadow(0 0 2px rgba(52,211,153,0.3))' }}
            />
          )}

          {/* Nodes */}
          {points.map((p) => (
            <g key={p.k}>
              <circle cx={p.x} cy={p.y} r="3" fill="#34d399" stroke="rgba(8,12,20,1)" strokeWidth="1" />
              <text
                x={p.x}
                y={p.y - 6}
                fill="#a7f3d0"
                fontSize="8"
                fontWeight="bold"
                textAnchor="middle"
                className="font-mono"
              >
                {p.val >= 1000 ? (p.val / 1000).toFixed(1) + 'k' : p.val.toFixed(0)}
              </text>
              <text
                x={p.x}
                y={height - 4}
                fill="rgba(255,255,255,0.3)"
                fontSize="8"
                textAnchor="middle"
                className="font-mono"
              >
                {p.k}
              </text>
            </g>
          ))}
        </svg>
      </div>
    );
  };

  return (
    <div className="flex flex-col sm:flex-row gap-4 items-stretch">
      {renderRevenueChart()}
      {patKeys.length >= 2 && renderPatChart()}
    </div>
  );
}
