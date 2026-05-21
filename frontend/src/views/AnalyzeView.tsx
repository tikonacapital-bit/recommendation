import React, { useState, useRef } from 'react';
import { api } from '../lib/api';
import type { StockAnalysis, TaskResponse } from '../lib/types';
import AnalysisPanel from '../components/AnalysisPanel';
import { useToast } from '../components/Toast';

const STEPS = [
  { id: 'stepA', label: 'Agent A — Fundamentals' },
  { id: 'stepB', label: 'Agent B — Sector Specialist' },
  { id: 'stepC', label: 'Agent C — Management Sentiment' },
  { id: 'stepD', label: 'Agent D — Valuation & Risk' },
  { id: 'stepSynth', label: 'Synthesis Agent (Claude)' },
];

type StepState = 'idle' | 'running' | 'done' | 'failed';

const stepDotColor: Record<StepState, string> = {
  idle: 'bg-slate-700',
  running: 'bg-indigo-500 animate-pulse shadow-[0_0_8px_#6366f1]',
  done: 'bg-green-500 shadow-[0_0_6px_#22c55e]',
  failed: 'bg-red-500',
};

function pollTask(
  taskId: string,
  onStep: (attempts: number) => void,
  onComplete: () => void,
  onError: (err: Error) => void,
) {
  let attempts = 0;
  const maxAttempts = 50;
  const timer = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(timer);
      onError(new Error('Analysis task timed out.'));
      return;
    }
    onStep(attempts);
    try {
      const data = await api<TaskResponse>(`/tasks/${taskId}`);
      if (data.status === 'SUCCESS') { clearInterval(timer); onComplete(); }
      else if (data.status === 'FAILURE' || data.status === 'REVOKED') {
        clearInterval(timer);
        onError(new Error(data.message || 'Task failed on worker.'));
      }
    } catch (_) {}
  }, 3000);
  return () => clearInterval(timer);
}

export default function AnalyzeView() {
  const { toast } = useToast();
  const [ticker, setTicker] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<StockAnalysis | null>(null);
  const [steps, setSteps] = useState<Record<string, StepState>>({
    stepA: 'idle', stepB: 'idle', stepC: 'idle', stepD: 'idle', stepSynth: 'idle',
  });
  const [showProgress, setShowProgress] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const resetSteps = () =>
    setSteps({ stepA: 'idle', stepB: 'idle', stepC: 'idle', stepD: 'idle', stepSynth: 'idle' });

  const setStep = (id: string, state: StepState) =>
    setSteps(prev => ({ ...prev, [id]: state }));

  const handleAnalyze = async () => {
    const t = ticker.trim().toUpperCase() || 'TCS.NS';
    setLoading(true);
    setShowProgress(true);
    setResult(null);
    resetSteps();
    setStep('stepA', 'running');

    try {
      const data = await api<TaskResponse | StockAnalysis>(`/synthesize/${t}?async_task=true`, { method: 'POST' });
      const resp = data as Record<string, unknown>;

      if (resp.task_id) {
        const taskId = resp.task_id as string;
        toast(`AI Synthesis queued for ${t}`, 'info');

        const cleanup = pollTask(
          taskId,
          (attempts) => {
            if (attempts === 5) { setStep('stepA', 'done'); setStep('stepB', 'running'); }
            if (attempts === 10) { setStep('stepB', 'done'); setStep('stepC', 'running'); }
            if (attempts === 15) { setStep('stepC', 'done'); setStep('stepD', 'running'); }
            if (attempts === 20) { setStep('stepD', 'done'); setStep('stepSynth', 'running'); }
          },
          async () => {
            STEPS.forEach(s => setStep(s.id, 'done'));
            toast(`Analysis complete for ${t}!`, 'success');
            try {
              const finalData = await api<StockAnalysis>(`/view/${t}`);
              setResult(finalData);
            } catch (e) {
              toast((e as Error).message, 'error');
            }
            setLoading(false);
          },
          (err) => {
            STEPS.forEach(s => setStep(s.id, 'failed'));
            toast(err.message, 'error');
            setLoading(false);
          },
        );
        cleanupRef.current = cleanup;
      } else {
        STEPS.forEach(s => setStep(s.id, 'done'));
        setResult(data as StockAnalysis);
        toast(`Analysis complete for ${t}!`, 'success');
        setLoading(false);
      }
    } catch (e) {
      STEPS.forEach(s => setStep(s.id, 'failed'));
      toast((e as Error).message, 'error');
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    const t = ticker.trim().toUpperCase();
    if (!t) { toast('Enter a ticker first', 'error'); return; }
    try {
      toast(`Refreshing ${t}…`, 'info');
      await api(`/refresh/${t}`, { method: 'POST' });
      toast(`Refreshed ${t}`, 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const handleView = async () => {
    const t = ticker.trim().toUpperCase();
    if (!t) { toast('Enter a ticker first', 'error'); return; }
    try {
      const data = await api<StockAnalysis>(`/view/${t}`);
      setResult(data);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="space-y-6 fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Deep Analysis</h1>
        <p className="text-slate-500 text-sm mt-1">Run the full 4-agent LangGraph pipeline on any ticker</p>
      </div>

      {/* Controls */}
      <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl p-6">
        <h3 className="text-sm font-semibold text-slate-300 mb-1">Run Analysis</h3>
        <p className="text-xs text-slate-500 mb-4">
          Enter a ticker and click <strong className="text-slate-400">AI Synthesize</strong> to run all 4 agents via LangGraph.
        </p>

        <div className="flex flex-wrap gap-3">
          <input
            className="flex-1 min-w-[200px] bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all font-mono"
            placeholder="e.g. RELIANCE.NS"
            value={ticker}
            onChange={e => setTicker(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAnalyze(); }}
          />
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
            )}
            AI Synthesize
          </button>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="px-4 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] text-slate-400 hover:text-slate-200 text-sm border border-white/[0.07] transition-all disabled:opacity-50"
          >
            Refresh Data
          </button>
          <button
            onClick={handleView}
            disabled={loading}
            className="px-4 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] text-slate-400 hover:text-slate-200 text-sm border border-white/[0.07] transition-all disabled:opacity-50"
          >
            View Result
          </button>
        </div>

        {/* Agent Steps */}
        {showProgress && (
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-5 gap-3">
            {STEPS.map(step => (
              <div
                key={step.id}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs transition-all ${
                  steps[step.id] === 'running' ? 'border-indigo-500/40 bg-indigo-500/5' :
                  steps[step.id] === 'done' ? 'border-green-500/30 bg-green-500/5' :
                  steps[step.id] === 'failed' ? 'border-red-500/30 bg-red-500/5' :
                  'border-white/[0.06] bg-white/[0.02]'
                }`}
              >
                <div className={`w-2 h-2 rounded-full shrink-0 ${stepDotColor[steps[step.id]]}`} />
                <span className={
                  steps[step.id] === 'done' ? 'text-green-400' :
                  steps[step.id] === 'running' ? 'text-indigo-400' :
                  steps[step.id] === 'failed' ? 'text-red-400' :
                  'text-slate-600'
                }>{step.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Result */}
      <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl p-6">
        {result ? (
          <AnalysisPanel item={result} />
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-slate-600">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            </svg>
            <p className="mt-3 text-sm">Analysis results will appear here</p>
          </div>
        )}
      </div>
    </div>
  );
}
