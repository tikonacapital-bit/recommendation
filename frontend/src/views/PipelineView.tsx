import React, { useState } from 'react';
import { api } from '../lib/api';
import type { TaskResponse, RunResponse } from '../lib/types';
import { useToast } from '../components/Toast';

function StepCard({
  number, title, children,
}: {
  number: number; title: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
          {number}
        </div>
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function ResultBox({ text }: { text: string }) {
  if (!text) return null;
  const isOk = text.startsWith('✓') || text.toLowerCase().startsWith('done') || text.toLowerCase().includes('success');
  const isErr = text.toLowerCase().startsWith('error');
  return (
    <div className={`text-xs font-mono whitespace-pre-wrap rounded-lg p-3 border ${
      isOk ? 'bg-green-500/5 border-green-500/20 text-green-400' :
      isErr ? 'bg-red-500/5 border-red-500/20 text-red-400' :
      'bg-white/[0.03] border-white/[0.07] text-slate-400'
    }`}>
      {text}
    </div>
  );
}

export default function PipelineView() {
  const { toast } = useToast();
  const [seedResult, setSeedResult] = useState('');
  const [seedLoading, setSeedLoading] = useState(false);
  const [fullResult, setFullResult] = useState('');
  const [fullLoading, setFullLoading] = useState(false);
  const [prefilterResult, setPrefilterResult] = useState('');
  const [prefilterLoading, setPrefilterLoading] = useState(false);
  const [customTicker, setCustomTicker] = useState('');
  const [customResult, setCustomResult] = useState('');
  const [customLoading, setCustomLoading] = useState(false);
  const [bulkLimit, setBulkLimit] = useState(50);
  const [bulkResult, setBulkResult] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [taskId, setTaskId] = useState('');
  const [taskResult, setTaskResult] = useState('');

  async function seedStocks() {
    setSeedLoading(true);
    setSeedResult('Syncing equity_universe from Supabase… (~30 sec, please wait)');
    toast('Syncing equity universe — reading stocks from Supabase', 'info');
    try {
      const data = await api<Record<string, unknown>>('/stocks/sync', { method: 'POST' });
      setSeedResult(`✓ ${data.message}`);
      toast(`Synced ${data.synced} stocks successfully`, 'success');
    } catch (e) {
      setSeedResult(`Error: ${(e as Error).message}`);
      toast((e as Error).message, 'error');
    } finally { setSeedLoading(false); }
  }

  async function runFullPipeline() {
    setFullLoading(true);
    setFullResult('Running full pipeline (sync equity universe + prefilter)… please wait ~1 min');
    toast('Full pipeline started — syncing then scoring all stocks', 'info');
    try {
      const data = await api<Record<string, unknown>>('/pipeline/full', { method: 'POST' });
      setFullResult(`✓ ${data.message}`);
      toast('Full pipeline complete!', 'success');
    } catch (e) {
      setFullResult(`Error: ${(e as Error).message}`);
      toast((e as Error).message, 'error');
    } finally { setFullLoading(false); }
  }

  async function runPrefilter(async_task: boolean) {
    setPrefilterLoading(true);
    setPrefilterResult('Running…');
    try {
      const data = await api<TaskResponse | RunResponse>(`/prefilter/run${async_task ? '?async_task=true' : ''}`, { method: 'POST' });
      const d = data as unknown as Record<string, unknown>;
      if (d.task_id) {
        setPrefilterResult(`Queued: ${d.task_id}`);
        toast('Prefilter queued in Celery', 'info');
      } else {
        const r = data as RunResponse;
        setPrefilterResult(`✓ Done\nRun ID: ${r.run_id}\nStatus: ${r.status}\nProcessed: ${r.processed_count}/${r.total_stocks}`);
        toast('Prefilter complete', 'success');
      }
    } catch (e) {
      setPrefilterResult(`Error: ${(e as Error).message}`);
      toast((e as Error).message, 'error');
    } finally { setPrefilterLoading(false); }
  }

  async function addCustom() {
    const t = customTicker.trim().toUpperCase();
    if (!t) { toast('Enter a ticker first', 'error'); return; }
    setCustomLoading(true);
    setCustomResult(`Fetching ${t}…`);
    try {
      const data = await api<TaskResponse>(`/refresh/${t}`, { method: 'POST' });
      if (data.task_id) {
        setCustomResult(`Queued: task ${data.task_id}`);
        toast(`${t} refresh queued`, 'info');
      } else {
        setCustomResult(`✓ ${t} refreshed. Go to Analyze tab to run AI agents.`);
        toast(`${t} added and scored`, 'success');
      }
    } catch (e) {
      setCustomResult(`Error: ${(e as Error).message}`);
      toast((e as Error).message, 'error');
    } finally { setCustomLoading(false); }
  }

  async function runBulk() {
    setBulkLoading(true);
    setBulkResult('Queueing paced background universe AI synthesis…');
    toast('Queueing paced AI research for high-potential universe', 'info');
    try {
      const data = await api<TaskResponse>(`/pipeline/run_ai_universe?limit=${bulkLimit}`, { method: 'POST' });
      if (data.task_id) {
        setBulkResult(`Queued!\nTask ID: ${data.task_id}\nCheck progress with Task Monitor or Celery worker logs.`);
        toast('Bulk AI research queued', 'success');
      } else {
        setBulkResult(`✓ Done!\nMessage: ${data.message}`);
        toast('Bulk AI research complete', 'success');
      }
    } catch (e) {
      setBulkResult(`Error: ${(e as Error).message}`);
      toast((e as Error).message, 'error');
    } finally { setBulkLoading(false); }
  }

  async function checkTask() {
    if (!taskId.trim()) { toast('Enter a task ID', 'error'); return; }
    try {
      const data = await api<TaskResponse>(`/tasks/${taskId.trim()}`);
      setTaskResult(JSON.stringify(data, null, 2));
    } catch (e) {
      setTaskResult(`Error: ${(e as Error).message}`);
    }
  }

  const BtnPrimary = ({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
    >
      {disabled && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
      {children}
    </button>
  );

  const BtnGhost = ({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] text-slate-400 hover:text-slate-200 text-sm border border-white/[0.07] transition-all disabled:opacity-50"
    >
      {children}
    </button>
  );

  return (
    <div className="space-y-6 fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Pipeline Control</h1>
        <p className="text-slate-500 text-sm mt-1">Follow these steps to populate your universe and start seeing results</p>
      </div>

      {/* Quickstart */}
      <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <strong className="text-slate-200 text-sm">First time? Start here.</strong>
        </div>
        <p className="text-slate-500 text-sm mb-4">
          Your database is empty until you run Step 1. Step 1 syncs all stocks from your Supabase equity_universe table (~30 sec).
          Step 2 scores them all deterministically (instant). Step 3 runs AI agents on any individual stock from the Analyze tab.
        </p>
        <div className="flex items-center gap-3">
          <BtnPrimary onClick={runFullPipeline} disabled={fullLoading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            Run Full Pipeline (Step 1 + 2 together)
          </BtnPrimary>
        </div>
        <ResultBox text={fullResult} />
      </div>

      {/* Steps Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Step 1 */}
        <StepCard number={1} title="Sync Equity Universe">
          <p className="text-sm text-slate-500">
            Reads all stocks directly from your Supabase <code className="text-indigo-400 bg-indigo-500/10 px-1 py-0.5 rounded text-xs">equity_universe</code> table — no yfinance calls needed.
            Financial ratios (ROE, revenue CAGR, P/E, P/B, D/E) are mapped automatically.
          </p>
          <p className="text-xs text-slate-600">Takes ~30 sec. Run again anytime to pick up new stocks.</p>
          <BtnPrimary onClick={seedStocks} disabled={seedLoading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 .49-3.5"/>
            </svg>
            Sync Equity Universe
          </BtnPrimary>
          <ResultBox text={seedResult} />
        </StepCard>

        {/* Step 2 */}
        <StepCard number={2} title="Run Tier-1 Prefilter">
          <p className="text-sm text-slate-500">
            Scores every tracked stock using deterministic rules: revenue growth ≥ 12%, market cap check, P/E, P/B, ROE, and leverage. No AI cost — pure Python.
          </p>
          <p className="text-xs text-slate-600">Completes in seconds. After this, Universe and Dashboard will show rankings.</p>
          <div className="flex gap-2">
            <BtnPrimary onClick={() => runPrefilter(false)} disabled={prefilterLoading}>Run Now</BtnPrimary>
            <BtnGhost onClick={() => runPrefilter(true)} disabled={prefilterLoading}>Queue in Celery</BtnGhost>
          </div>
          <ResultBox text={prefilterResult} />
        </StepCard>

        {/* Step 3 */}
        <StepCard number={3} title="Add a Custom Stock">
          <p className="text-sm text-slate-500">
            Add any NSE/BSE stock outside the default universe. Use the NSE ticker with <code className="text-indigo-400 bg-indigo-500/10 px-1 py-0.5 rounded text-xs">.NS</code> suffix.
          </p>
          <p className="text-xs text-slate-600">Then go to the <strong className="text-slate-400">Analyze</strong> tab to run the full 4-agent AI pipeline on it.</p>
          <div className="flex gap-2">
            <input
              className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-indigo-500/50 transition-all font-mono"
              placeholder="e.g. ZOMATO.NS"
              value={customTicker}
              onChange={e => setCustomTicker(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addCustom(); }}
            />
            <BtnPrimary onClick={addCustom} disabled={customLoading}>Add & Refresh</BtnPrimary>
          </div>
          <ResultBox text={customResult} />
        </StepCard>

        {/* Step 4 */}
        <StepCard number={4} title="Paced Bulk AI Research">
          <p className="text-sm text-slate-500">
            Sequentially synthesize analyses in paced background batches (1.5s delay) for all prefiltered high-potential stocks (Tier 1 Passes).
          </p>
          <p className="text-xs text-slate-600">Ensures OpenRouter compliance. Limit the maximum batch size below.</p>
          <div className="flex gap-2">
            <input
              type="number"
              className="w-24 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500/50 transition-all font-mono"
              value={bulkLimit}
              min={1}
              max={200}
              onChange={e => setBulkLimit(Number(e.target.value))}
            />
            <BtnPrimary onClick={runBulk} disabled={bulkLoading}>Run Bulk AI</BtnPrimary>
          </div>
          <ResultBox text={bulkResult} />
        </StepCard>

        {/* Task Monitor */}
        <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl p-6 space-y-4 lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-300">Task Monitor</h3>
          <p className="text-sm text-slate-500">If you queued a Celery task, paste its ID here to check status.</p>
          <div className="flex gap-2">
            <input
              className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-indigo-500/50 transition-all font-mono"
              placeholder="Paste task ID…"
              value={taskId}
              onChange={e => setTaskId(e.target.value)}
            />
            <BtnGhost onClick={checkTask}>Check</BtnGhost>
          </div>
          <ResultBox text={taskResult} />
        </div>
      </div>
    </div>
  );
}
