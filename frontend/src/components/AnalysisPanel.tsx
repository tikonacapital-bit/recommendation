import React, { useEffect, useState } from 'react';
import type { StockAnalysis } from '../lib/types';
import { api, fmt, fmtPrice, scoreColor, scoreGradient } from '../lib/api';

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
              {rec.replace(/_/g, ' ')}
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
            {item.thesis_paragraph}
          </p>
        </div>
      )}

      {/* Score bars */}
      {bars.some(b => b.val != null) && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold mb-3">
            Score Breakdown
            {pf2 && <span className="normal-case tracking-normal ml-1 text-slate-700">(percentile-ranked)</span>}
          </div>
          <div className="space-y-2.5">
            {bars.map(b => <ScoreBar key={b.label} label={b.label} value={b.val} />)}
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
      <div>
        <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold mb-3">Backtesting & Price Accuracy</div>
        <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-3">
          {loadingPreds ? (
            <div className="h-16 shimmer rounded-lg" />
          ) : predictions.length === 0 ? (
            <p className="text-xs text-slate-600 text-center py-3">No price tracking history yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {[
                  { label: 'Target (Base)', val: `₹${Number(predictions[0].predicted_price).toFixed(1)}` },
                  { label: 'Actual Price', val: `₹${Number(predictions[0].actual_price).toFixed(1)}` },
                  {
                    label: 'Error Margin',
                    val: `${(predictions[0].error_margin * 100).toFixed(1)}%`,
                    color: predictions[0].error_margin < 0 ? 'text-red-400' : 'text-green-400',
                  },
                ].map(({ label, val, color: c }) => (
                  <div key={label} className="bg-white/[0.03] border border-white/[0.05] rounded-lg p-2 text-center">
                    <div className="text-[10px] text-slate-600 uppercase mb-1">{label}</div>
                    <div className={`text-sm font-bold font-mono ${c || 'text-slate-200'}`}>{val}</div>
                  </div>
                ))}
              </div>
              <div className="max-h-28 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-600 border-b border-white/[0.05]">
                      <th className="text-left py-1.5">Date</th>
                      <th className="text-left py-1.5">Target</th>
                      <th className="text-left py-1.5">Actual</th>
                      <th className="text-right py-1.5">Deviation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {predictions.slice(0, 5).map(p => {
                      const devColor = p.error_margin < 0 ? 'text-red-400' : 'text-green-400';
                      return (
                        <tr key={p.id} className="border-b border-white/[0.03] text-slate-400">
                          <td className="py-1.5">{new Date(p.evaluated_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}</td>
                          <td className="py-1.5 font-mono">₹{Number(p.predicted_price).toFixed(0)}</td>
                          <td className="py-1.5 font-mono">₹{Number(p.actual_price).toFixed(0)}</td>
                          <td className={`py-1.5 font-mono text-right ${devColor}`}>{(p.error_margin * 100).toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
