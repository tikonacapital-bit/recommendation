import { scoreColor, fmt } from '../lib/api';
import type { StockAnalysis } from '../lib/types';

interface Props {
  item: StockAnalysis;
  rank: number;
  onClick: () => void;
  isSelected: boolean;
}

const recStyles: Record<string, string> = {
  BUY: 'text-green-400 bg-green-500/10 border-green-500/20',
  HOLD: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  AVOID: 'text-red-400 bg-red-500/10 border-red-500/20',
  PASS_TIER_1: 'text-teal-400 bg-teal-500/10 border-teal-500/20',
  PASS_TIER_2: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
  PASS_TIER_3: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  RANK_ONLY: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
};

function rankMedal(r: number | null) {
  if (r === 1) return '🥇';
  if (r === 2) return '🥈';
  if (r === 3) return '🥉';
  return null;
}

export default function StockRow({ item, rank, onClick, isSelected }: Props) {
  const color = scoreColor(item.composite_score);
  const rec = item.recommendation || 'RANK_ONLY';
  const recStyle = recStyles[rec] || recStyles.RANK_ONLY;
  const medal = rankMedal(item.rank_in_universe);

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all duration-150 border-b border-white/[0.04] last:border-0 group hover:bg-white/[0.04] ${
        isSelected ? 'bg-indigo-600/10 border-l-2 border-l-indigo-500' : ''
      }`}
    >
      {/* Rank */}
      <div className="w-8 shrink-0 text-center">
        {medal ? (
          <span className="text-base">{medal}</span>
        ) : (
          <span className="text-xs text-slate-500 font-mono">{rank}</span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-100 font-mono">{item.ticker}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold uppercase tracking-wide ${recStyle}`}>
            {rec === 'PASS_TIER_1' ? 'Tier 1' : rec === 'PASS_TIER_2' ? 'Tier 2' : rec === 'PASS_TIER_3' ? 'Tier 3' : rec === 'RANK_ONLY' ? 'Rank' : rec.replace('_', ' ')}
          </span>
        </div>
        <div className="text-xs text-slate-500 truncate mt-0.5">{item.name || '—'}</div>
      </div>

      {/* Score */}
      <div className="shrink-0 text-right">
        <div className="text-sm font-bold font-mono" style={{ color }}>{fmt(item.composite_score)}</div>
        <div className="text-[10px] text-slate-600">score</div>
      </div>
    </button>
  );
}
