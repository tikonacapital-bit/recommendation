import { useEffect, useState } from 'react';
import type { StockAnalysis } from '../lib/types';
import { api, fmt, fmtPrice, scoreColor, scoreGradient } from '../lib/api';
import FinancialCharts from './FinancialCharts';

interface Evidence {
  id: number;
  quote: string;
  pillar: string | null;
  source_doc_id: number | null;
}

interface Prediction {
  id: number;
  predicted_price: number;
  actual_price: number;
  error_margin: number;
  evaluated_at: string;
}

const recStyles: Record<string, string> = {
  BUY: 'text-green-400 bg-green-500/10 border-green-500/30',
  HOLD: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  AVOID: 'text-red-400 bg-red-500/10 border-red-500/30',
  PASS_TIER_1: 'text-teal-400 bg-teal-500/10 border-teal-500/30',
  PASS_TIER_2: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30',
  PASS_TIER_3: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  RANK_ONLY: 'text-slate-400 bg-slate-500/10 border-slate-500/30',
};

function ScoreBar({ label, value }: { label: string; value: number | null | undefined }) {
  if (value === null || value === undefined) return null;
  const color = scoreColor(value);
  return (
    <div className="flex items-center gap-3">
      <div className="w-20 text-xs text-slate-400 shrink-0">{label}</div>
      <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.min(100, value)}%`, background: color }}
        />
      </div>
      <div className="w-8 text-xs font-mono text-right" style={{ color }}>{fmt(value)}</div>
    </div>
  );
}

function AgentCard({ title, icon, data }: { title: string, icon: React.ReactNode, data: any }) {
  if (!data || Object.keys(data).length === 0) return null;
  const summary = data.summary || "No summary available.";
  const isError = summary.toLowerCase().includes("unavailable") || summary.toLowerCase().includes("failed");

  return (
    <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <span className="text-indigo-400">{icon}</span>
          {title}
        </div>
        <div className={`w-2 h-2 rounded-full ${!isError ? 'bg-green-500 shadow-[0_0_6px_#22c55e]' : 'bg-red-500 shadow-[0_0_6px_#ef4444]'}`} />
      </div>
      <p className="text-xs text-slate-400 leading-relaxed line-clamp-3" title={summary}>{summary}</p>

      {/* Dynamic Key Metrics based on agent type */}
      {data.growth_score != null && (
        <div className="mt-auto pt-2 flex gap-3 text-[10px] uppercase tracking-wider text-slate-500 font-mono">
          <div>Growth: {data.growth_score.toFixed(0)}</div>
          <div>Quality: {data.durability_score?.toFixed(0)}</div>
        </div>
      )}
      {data.sector_score != null && (
        <div className="mt-auto pt-2 text-[10px] uppercase tracking-wider text-slate-500 font-mono">
          <div>Sector KPI Score: {data.sector_score.toFixed(0)}</div>
        </div>
      )}
      {data.tone_shift != null && (
        <div className="mt-auto pt-2 flex flex-wrap gap-1">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300">Tone: {data.tone_shift}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300">Guidance: {data.guidance_change}</span>
        </div>
      )}
      {data.valuation_score != null && (
        <div className="mt-auto pt-2 flex flex-wrap gap-1">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300">Value Score: {data.valuation_score.toFixed(0)}</span>
          {data.risk_flags && data.risk_flags.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/20 text-red-400">{data.risk_flags.length} Risks</span>
          )}
        </div>
      )}
    </div>
  );
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

export default function AnalysisPanel({ item }: { item: StockAnalysis }) {
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loadingEvidence, setLoadingEvidence] = useState(true);
  const [loadingPreds, setLoadingPreds] = useState(true);

  const score = Number(item.composite_score || 0);
  const color = scoreColor(score);
  const gradient = scoreGradient(score);
  const rec = item.recommendation || 'RANK_ONLY';
  const recStyle = recStyles[rec] || recStyles.RANK_ONLY;

  const ao = item.agent_outputs || {};
  const pf2 = (ao.prefilter_v2 as Record<string, number | null>) || null;
  const pfLeg = (ao.prefilter as Record<string, unknown>) || {};
  const tp = item.target_prices || {};

  const bars = pf2
    ? [
      { label: 'Growth', val: item.growth_score },
      { label: 'Quality', val: item.durability_score },
      { label: 'Valuation', val: item.valuation_score },
      { label: 'Momentum', val: item.technical_score },
      { label: 'Health', val: item.sector_score },
    ]
    : [
      { label: 'Growth', val: item.growth_score },
      { label: 'Durability', val: item.durability_score },
      { label: 'Mgmt Qual', val: item.mgmt_quality_score },
      { label: 'Sentiment', val: item.mgmt_sentiment_score },
      { label: 'Valuation', val: item.valuation_score },
      { label: 'Technical', val: item.technical_score },
    ];

  const quantMetrics = pf2
    ? [
      ['Rev CAGR 2yr', pf2.rev_cagr != null ? `${Number(pf2.rev_cagr).toFixed(1)}%` : '—'],
      ['PAT CAGR 2yr', pf2.pat_cagr != null ? `${Number(pf2.pat_cagr).toFixed(1)}%` : '—'],
      ['ROIC', pf2.roic != null ? `${Number(pf2.roic).toFixed(1)}%` : '—'],
      ['ROE', pf2.roe != null ? `${Number(pf2.roe).toFixed(1)}%` : '—'],
      ['Fwd PE', pf2.pe_fwd != null ? `${Number(pf2.pe_fwd).toFixed(1)}x` : '—'],
      ['EV/EBITDA', pf2.ev_ebitda_fwd != null ? `${Number(pf2.ev_ebitda_fwd).toFixed(1)}x` : '—'],
      ['Consensus ↑', pf2.consensus_upside != null ? `${Number(pf2.consensus_upside).toFixed(0)}%` : '—'],
      ['EBITDA Margin', pf2.ebitda_margin_fy25 != null ? `${Number(pf2.ebitda_margin_fy25).toFixed(1)}%` : '—'],
      ['3m Return', pf2.ret_3m != null ? `${Number(pf2.ret_3m).toFixed(1)}%` : '—'],
      ['6m Return', pf2.ret_6m != null ? `${Number(pf2.ret_6m).toFixed(1)}%` : '—'],
      ['Net Leverage', pf2.net_leverage != null ? `${Number(pf2.net_leverage).toFixed(2)}x` : '—'],
      ['Promoter %', pf2.promoter_pct != null ? `${Number(pf2.promoter_pct).toFixed(1)}%` : '—'],
    ]
    : Object.keys(pfLeg).length
      ? [
        ['Rev Growth', pf2 ? '—' : ((pfLeg as Record<string, unknown>).revenue_growth != null ? `${(Number((pfLeg as Record<string, unknown>).revenue_growth) * 100).toFixed(1)}%` : '—')],
      ]
      : [];

  useEffect(() => {
    setLoadingEvidence(true);
    setLoadingPreds(true);
    if (item.id) {
      api<{ evidence: Evidence[] }>(`/analysis/${item.id}/evidence`)
        .then(d => setEvidence(d.evidence || []))
        .catch(() => setEvidence([]))
        .finally(() => setLoadingEvidence(false));
    } else {
      setLoadingEvidence(false);
    }
    api<{ predictions: Prediction[] }>(`/stock/${item.ticker}/predictions`)
      .then(d => setPredictions(d.predictions || []))
      .catch(() => setPredictions([]))
      .finally(() => setLoadingPreds(false));
  }, [item.ticker, item.id]);

  return (
    <div className="space-y-5 fade-in">
      {/* Hero */}
      <div className="flex items-center gap-5">
        <div
          className="relative flex items-center justify-center w-20 h-20 rounded-full shrink-0"
          style={{ background: gradient }}
        >
          <div className="absolute inset-2 rounded-full bg-[#0d1420] flex items-center justify-center">
            <span className="text-xl font-black font-mono" style={{ color }}>{score.toFixed(0)}</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold text-slate-100 font-mono">{item.name || item.ticker}</h2>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${recStyle}`}>
              {rec === 'PASS_TIER_1' ? 'Tier 1' : rec === 'PASS_TIER_2' ? 'Tier 2' : rec === 'PASS_TIER_3' ? 'Tier 3' : rec === 'RANK_ONLY' ? 'Rank' : rec.replace(/_/g, ' ')}
            </span>
          </div>
          <div className="text-sm text-slate-400 mt-1 font-mono">{item.ticker}</div>
          <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
            <span>{item.sector || '—'}</span>
            {item.rank_in_universe && <span>· Rank #{item.rank_in_universe}</span>}
            {item.confidence_score != null && (
              <span>· Confidence {(item.confidence_score * 100).toFixed(0)}%</span>
            )}
          </div>
        </div>
      </div>

      {/* Thesis */}
      {item.thesis_paragraph && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold mb-2">AI Thesis</div>
          <p className="text-sm text-slate-300 leading-relaxed bg-white/[0.02] rounded-xl p-4 border border-white/[0.05]">
            {renderFormattedText(item.thesis_paragraph)}
          </p>
        </div>
      )}

      {/* Agent Diagnostics */}
      {ao && !!(ao.agent_a || ao.agent_b || ao.agent_c || ao.agent_d) && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold mb-2 flex items-center gap-2">
            Agent Network Diagnostics
            <span className="bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded text-[8px]">LIVE</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <AgentCard
              title="A: Fundamentals"
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 20V10M18 20V4M6 20v-4" />
                </svg>
              }
              data={ao.agent_a}
            />
            <AgentCard
              title="B: Sector Analyst"
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                </svg>
              }
              data={ao.agent_b}
            />
            <AgentCard
              title="C: Sentiment (RAG)"
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              }
              data={ao.agent_c}
            />
            <AgentCard
              title="D: Valuation & Risk"
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              }
              data={ao.agent_d}
            />
          </div>
        </div>
      )}

      {/* Score bars */}
      {bars.some(b => b.val != null) && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold mb-3">
            Score Breakdown
            {pf2 && <span className="normal-case tracking-normal ml-1 text-slate-700">(percentile-ranked)</span>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-center bg-white/[0.015] border border-white/[0.05] rounded-2xl p-4 md:p-6">
            <div className="space-y-3 w-full">
              {bars.map(b => <ScoreBar key={b.label} label={b.label} value={b.val} />)}
            </div>
            <div className="flex justify-center w-full">
              <RadarChart
                items={bars.map(b => ({ label: b.label, val: b.val ?? 0 }))}
                strokeColor={color}
              />
            </div>
          </div>
        </div>
      )}

      {/* Target Prices */}
      {(tp.bear || tp.base || tp.bull) && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold mb-3">Target Prices</div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Bear', key: 'bear', color: 'border-red-500/20 bg-red-500/5 text-red-400' },
              { label: 'Base', key: 'base', color: 'border-indigo-500/20 bg-indigo-500/5 text-indigo-400' },
              { label: 'Bull', key: 'bull', color: 'border-green-500/20 bg-green-500/5 text-green-400' },
            ].map(({ label, key, color: c }) => (
              <div key={key} className={`rounded-xl border p-3 text-center ${c}`}>
                <div className="text-[10px] uppercase tracking-widest opacity-60 mb-1">{label}</div>
                <div className="text-sm font-bold font-mono">{fmtPrice(tp[key])}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Risks & Catalysts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {item.key_risks?.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold mb-2">Key Risks</div>
            <div className="flex flex-wrap gap-1.5">
              {item.key_risks.map(r => (
                <span key={r} className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                  {r.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        )}
        {item.key_catalysts?.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold mb-2">Catalysts</div>
            <div className="flex flex-wrap gap-1.5">
              {item.key_catalysts.map(c => (
                <span key={c} className="text-xs px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20">
                  {c.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Multi-Year Financial Trends */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold mb-3">Multi-Year Financial Trends</div>
        <FinancialCharts ticker={item.ticker} />
      </div>

      {/* Quant Metrics */}
      {quantMetrics.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold mb-3">Quantitative Data</div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {quantMetrics.map(([l, v]) => (
              <div key={l} className="bg-white/[0.02] border border-white/[0.05] rounded-lg p-2.5">
                <div className="text-[10px] text-slate-600 uppercase tracking-wide mb-1">{l}</div>
                <div className="text-sm font-semibold font-mono text-slate-200">{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Evidence */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold mb-3">Compliance Audit Trail</div>
        <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-3 max-h-48 overflow-y-auto">
          {loadingEvidence ? (
            <div className="h-16 shimmer rounded-lg" />
          ) : evidence.length === 0 ? (
            <p className="text-xs text-slate-600 text-center py-3">No audit quotes registered for this analysis.</p>
          ) : (
            <div className="space-y-2">
              {evidence.map(e => (
                <div key={e.id} className="border-l-2 border-indigo-500/40 pl-3 py-1">
                  <p className="text-xs text-slate-400 italic leading-snug">"{e.quote}"</p>
                  <div className="flex justify-between mt-1 text-[10px] text-slate-600 uppercase tracking-wide">
                    <span>Pillar: {e.pillar || 'General'}</span>
                    <span>Source: {e.source_doc_id ? `Doc #${e.source_doc_id}` : 'Concall'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Prediction Tracking */}
      {predictions && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold mb-3">Backtesting & Price Accuracy</div>
          <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-4">
            {loadingPreds ? (
              <div className="h-16 shimmer rounded-lg" />
            ) : predictions.length === 0 ? (
              <p className="text-xs text-slate-600 text-center py-3">No price tracking history yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                <div className="space-y-3 w-full">
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Target (Base)', val: `₹${Number(predictions[0].predicted_price).toFixed(1)}` },
                      { label: 'Actual Price', val: `₹${Number(predictions[0].actual_price).toFixed(1)}` },
                      {
                        label: 'Error Margin',
                        val: `${(predictions[0].error_margin * 100).toFixed(1)}%`,
                        color: predictions[0].error_margin < 0 ? 'text-red-400' : 'text-green-400',
                      },
                    ].map(({ label, val, color: c }) => (
                      <div key={label} className="bg-white/[0.03] border border-white/[0.05] rounded-xl p-2 text-center">
                        <div className="text-[10px] text-slate-600 uppercase mb-1">{label}</div>
                        <div className={`text-sm font-bold font-mono ${c || 'text-slate-200'}`}>{val}</div>
                      </div>
                    ))}
                  </div>
                  <div className="max-h-28 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-600 border-b border-white/[0.05]">
                          <th className="text-left py-1.5 font-bold uppercase tracking-wider text-[8px]">Date</th>
                          <th className="text-left py-1.5 font-bold uppercase tracking-wider text-[8px]">Target</th>
                          <th className="text-left py-1.5 font-bold uppercase tracking-wider text-[8px]">Actual</th>
                          <th className="text-right py-1.5 font-bold uppercase tracking-wider text-[8px]">Deviation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {predictions.slice(0, 5).map(p => {
                          const devColor = p.error_margin < 0 ? 'text-red-400' : 'text-green-400';
                          return (
                            <tr key={p.id} className="border-b border-white/[0.03] text-slate-400">
                              <td className="py-1.5 font-semibold">{new Date(p.evaluated_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}</td>
                              <td className="py-1.5 font-mono">₹{Number(p.predicted_price).toFixed(0)}</td>
                              <td className="py-1.5 font-mono">₹{Number(p.actual_price).toFixed(0)}</td>
                              <td className={`py-1.5 font-mono text-right ${devColor}`}>{(p.error_margin * 100).toFixed(1)}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="w-full flex justify-center">
                  <BacktestChart data={predictions} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface RadarChartProps {
  items: { label: string; val: number }[];
  strokeColor: string;
}

export function RadarChart({ items, strokeColor }: RadarChartProps) {
  const width = 220;
  const height = 220;
  const cx = width / 2;
  const cy = height / 2;
  const r = 70; // max radius
  const N = items.length;
  if (N < 3) return null;

  // Compute angles and vertices for 100% level
  const points = items.map((_, i) => {
    const angle = (i * 2 * Math.PI) / N - Math.PI / 2;
    return {
      angle,
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  });

  // Concentric rings (tiers) - 20%, 40%, 60%, 80%, 100%
  const tiers = [0.2, 0.4, 0.6, 0.8, 1.0];

  // Draw tier polygons
  const tierPaths = tiers.map(t => {
    const pStr = items.map((_, i) => {
      const angle = (i * 2 * Math.PI) / N - Math.PI / 2;
      const tx = cx + r * t * Math.cos(angle);
      const ty = cy + r * t * Math.sin(angle);
      return `${tx},${ty}`;
    }).join(' ');
    return pStr;
  });

  // Data polygon path
  const dataPoints = items.map((item, i) => {
    const val = Math.min(100, Math.max(0, item.val));
    const angle = (i * 2 * Math.PI) / N - Math.PI / 2;
    const dx = cx + r * (val / 100) * Math.cos(angle);
    const dy = cy + r * (val / 100) * Math.sin(angle);
    return { x: dx, y: dy };
  });
  const dataPathStr = dataPoints.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <svg width={width} height={height} viewBox={"0 0 " + width + " " + height} className="overflow-visible select-none my-2">
      {/* Background radial grid lines (axes) */}
      {points.map((p, i) => (
        <line
          key={"axis-" + i}
          x1={cx}
          y1={cy}
          x2={p.x}
          y2={p.y}
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="1"
        />
      ))}

      {/* Nested polygons for tiers */}
      {tierPaths.map((pStr, i) => (
        <polygon
          key={"tier-" + i}
          points={pStr}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="1"
        />
      ))}

      {/* Grid concentric rings percentage indicators */}
      {tiers.map((t, i) => {
        return (
          <text
            key={"pct-" + i}
            x={cx + 4}
            y={cy - r * t + 3}
            fill="rgba(255,255,255,0.2)"
            fontSize="8"
            className="font-mono pointer-events-none"
          >
            {Math.round(t * 100)}
          </text>
        );
      })}

      {/* Data Area Polyfill */}
      {dataPathStr && (
        <polygon
          points={dataPathStr}
          fill={strokeColor}
          fillOpacity="0.18"
          stroke={strokeColor}
          strokeWidth="2.5"
          className="transition-all duration-500 hover:fill-opacity-30"
          style={{ filter: 'drop-shadow(0 0 4px ' + strokeColor + '40)' }}
        />
      )}

      {/* Vertices/Data markers */}
      {dataPoints.map((p, i) => (
        <circle
          key={"dot-" + i}
          cx={p.x}
          cy={p.y}
          r="3"
          fill="#fff"
          stroke={strokeColor}
          strokeWidth="1.5"
          className="transition-all duration-300 hover:scale-150"
        />
      ))}

      {/* Axis Labels */}
      {points.map((p, i) => {
        const item = items[i];
        const labelOffset = 12;
        const lx = cx + (r + labelOffset) * Math.cos(p.angle);
        const ly = cy + (r + labelOffset) * Math.sin(p.angle);

        let textAnchor: 'middle' | 'start' | 'end' = 'middle';
        if (Math.cos(p.angle) > 0.1) textAnchor = 'start';
        else if (Math.cos(p.angle) < -0.1) textAnchor = 'end';

        let dy = '0.35em';
        if (Math.sin(p.angle) > 0.8) dy = '0.8em';
        else if (Math.sin(p.angle) < -0.8) dy = '-0.2em';

        return (
          <text
            key={"lbl-" + i}
            x={lx}
            y={ly}
            fill="#94a3b8"
            fontSize="9"
            fontWeight="600"
            textAnchor={textAnchor}
            dy={dy}
            className="font-sans pointer-events-none tracking-wide"
          >
            {item.label}
          </text>
        );
      })}
    </svg>
  );
}

interface BacktestChartProps {
  data: Prediction[];
}

export function BacktestChart({ data }: BacktestChartProps) {
  if (!data || data.length === 0) return null;

  const sortedData = [...data].sort((a, b) => new Date(a.evaluated_at).getTime() - new Date(b.evaluated_at).getTime());

  const width = 280;
  const height = 140;
  const paddingLeft = 32;
  const paddingRight = 10;
  const paddingTop = 15;
  const paddingBottom = 20;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const actuals = sortedData.map(d => d.actual_price);
  const targets = sortedData.map(d => d.predicted_price);
  const allPrices = [...actuals, ...targets];

  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const priceRange = maxPrice - minPrice || 1;

  const yMin = Math.max(0, minPrice - priceRange * 0.1);
  const yMax = maxPrice + priceRange * 0.1;
  const yRange = yMax - yMin;

  const M = sortedData.length;

  const getCoords = (idx: number, price: number) => {
    const x = paddingLeft + (idx / Math.max(1, M - 1)) * chartWidth;
    const y = paddingTop + chartHeight - ((price - yMin) / yRange) * chartHeight;
    return { x, y };
  };

  const actualPoints = sortedData.map((d, i) => getCoords(i, d.actual_price));
  const targetPoints = sortedData.map((d, i) => getCoords(i, d.predicted_price));

  const actualPathStr = actualPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const targetPathStr = targetPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  const targetPointsReverse = [...targetPoints].reverse();
  const errorBandPoints = [...actualPoints, ...targetPointsReverse];
  const errorBandPathStr = errorBandPoints.length > 0
    ? errorBandPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'
    : '';

  const yTicks = [yMin, yMin + yRange / 2, yMax];

  return (
    <svg width={width} height={height} viewBox={"0 0 " + width + " " + height} className="overflow-visible select-none my-1">
      {yTicks.map((val, i) => {
        const y = paddingTop + chartHeight - ((val - yMin) / yRange) * chartHeight;
        return (
          <g key={"grid-" + i} className="opacity-40">
            <line
              x1={paddingLeft}
              y1={y}
              x2={width - paddingRight}
              y2={y}
              stroke="rgba(255,255,255,0.04)"
              strokeDasharray="2,2"
            />
            <text
              x={paddingLeft - 6}
              y={y + 3}
              fill="rgba(255,255,255,0.25)"
              fontSize="8"
              textAnchor="end"
              className="font-mono"
            >
              ₹{Math.round(val)}
            </text>
          </g>
        );
      })}

      {errorBandPathStr && (
        <path
          d={errorBandPathStr}
          fill="rgba(99,102,241,0.06)"
          className="pointer-events-none"
        />
      )}

      {targetPathStr && (
        <path
          d={targetPathStr}
          fill="none"
          stroke="#818cf8"
          strokeWidth="1.5"
          strokeDasharray="4,3"
          className="pointer-events-none"
        />
      )}

      {actualPathStr && (
        <path
          d={actualPathStr}
          fill="none"
          stroke="#34d399"
          strokeWidth="2"
          className="pointer-events-none"
          style={{ filter: 'drop-shadow(0 0 2px rgba(52,211,153,0.2))' }}
        />
      )}

      {actualPoints.length > 0 && (
        <g>
          <circle
            cx={actualPoints[actualPoints.length - 1].x}
            cy={actualPoints[actualPoints.length - 1].y}
            r="5"
            fill="#34d399"
            fillOpacity="0.4"
            className="animate-ping"
          />
          <circle
            cx={actualPoints[actualPoints.length - 1].x}
            cy={actualPoints[actualPoints.length - 1].y}
            r="3"
            fill="#34d399"
            stroke="#fff"
            strokeWidth="1"
          />
        </g>
      )}

      {targetPoints.length > 0 && (
        <circle
          cx={targetPoints[targetPoints.length - 1].x}
          cy={targetPoints[targetPoints.length - 1].y}
          r="3"
          fill="#818cf8"
          stroke="#fff"
          strokeWidth="1"
        />
      )}

      {sortedData.length > 1 && (
        <g className="opacity-40">
          {[0, sortedData.length - 1].map(idx => {
            const d = sortedData[idx];
            const p = actualPoints[idx];
            const dateStr = new Date(d.evaluated_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
            return (
              <text
                key={"x-lbl-" + idx}
                x={p.x}
                y={height - 4}
                fill="rgba(255,255,255,0.3)"
                fontSize="8"
                textAnchor={idx === 0 ? 'start' : 'end'}
                className="font-mono"
              >
                {dateStr}
              </text>
            );
          })}
        </g>
      )}
    </svg>
  );
}
