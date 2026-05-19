/* ═══════════════════════════════════════════════
   AlphaLens — app.js
   ═══════════════════════════════════════════════ */

'use strict';

// ── Helpers ──────────────────────────────────────
const $ = id => document.getElementById(id);
const val = v => (v === null || v === undefined) ? '—' : v;
const pct = v => (v === null || v === undefined) ? '—' : `${(Number(v) * 100).toFixed(1)}%`;
const fmt = v => (v === null || v === undefined) ? '—' : Number(v).toFixed(1);
const fmtPrice = v => (!v || v === 0) ? '—' : `₹${Number(v).toLocaleString('en-IN', {maximumFractionDigits:0})}`;

function ticker() {
  return ($('tickerInput').value.trim() || 'TCS.NS').toUpperCase();
}

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({ detail: res.statusText }));
  if (!res.ok) {
    const msg = data.detail
      ? (Array.isArray(data.detail) ? data.detail.map(d => d.msg || JSON.stringify(d)).join('; ') : String(data.detail))
      : res.statusText;
    throw new Error(msg);
  }
  return data;
}

// ── Toast ─────────────────────────────────────────
function toast(msg, type = 'info') {
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]}</span><span class="toast-msg">${msg}</span><span class="toast-close">×</span>`;
  el.querySelector('.toast-close').onclick = () => el.remove();
  $('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ── View router ───────────────────────────────────
const views = { dashboard: $('viewDashboard'), universe: $('viewUniverse'), analyze: $('viewAnalyze'), pipeline: $('viewPipeline') };
const navBtns = { dashboard: $('navDashboard'), universe: $('navUniverse'), analyze: $('navAnalyze'), pipeline: $('navPipeline') };

function showView(name) {
  Object.values(views).forEach(v => v.classList.remove('active'));
  Object.values(navBtns).forEach(b => b.classList.remove('active'));
  views[name].classList.add('active');
  navBtns[name].classList.add('active');
}

Object.entries(navBtns).forEach(([name, btn]) => btn.addEventListener('click', () => showView(name)));

// ── Sidebar toggle ────────────────────────────────
$('sidebarToggle').addEventListener('click', () => {
  document.querySelector('.sidebar').classList.toggle('collapsed');
  document.querySelector('.main-wrap').classList.toggle('expanded');
});

// ── Status bar ────────────────────────────────────
async function loadStatus() {
  // DB
  try {
    const h = await api('/health');
    const ok = h.database === 'ok';
    $('dotDB').className = `status-dot ${ok ? 'ok' : 'bad'}`;
    $('valDB').textContent = ok ? 'Connected' : 'Error';
  } catch { $('dotDB').className = 'status-dot bad'; $('valDB').textContent = 'Down'; }

  // Worker
  try {
    const w = await api('/worker/health');
    const ok = w.status === 'ok';
    $('dotWorker').className = `status-dot ${ok ? 'ok' : 'warn'}`;
    $('valWorker').textContent = ok ? 'Online' : 'Offline';
  } catch { $('dotWorker').className = 'status-dot bad'; $('valWorker').textContent = 'Error'; }

  // LLM
  try {
    const l = await api('/llm/health');
    const ok = l.status === 'ok';
    $('dotLLM').className = `status-dot ${ok ? 'ok' : 'warn'}`;
    $('valLLM').textContent = ok ? 'Ready' : 'Unconfigured';
  } catch { $('dotLLM').className = 'status-dot bad'; $('valLLM').textContent = 'Error'; }
}

// ── Recommendation badge ──────────────────────────
function recBadge(rec) {
  const map = { BUY: 'badge-green', HOLD: 'badge-amber', AVOID: 'badge-red', PASS_TIER_1: 'badge-teal', RANK_ONLY: 'badge-muted' };
  return `<span class="badge ${map[rec] || 'badge-muted'}">${rec || '—'}</span>`;
}

// ── Score ring colour ─────────────────────────────
function scoreColor(s) {
  if (!s || s < 40) return '#ef4444';
  if (s < 55) return '#f59e0b';
  if (s < 70) return '#6366f1';
  return '#22c55e';
}

// ── Render full analysis ──────────────────────────
function renderAnalysis(item) {
  const score = Number(item.composite_score || 0);
  const pct360 = `${(score / 100 * 360).toFixed(1)}deg`;
  const color = scoreColor(score);
  const prefilter = (item.agent_outputs || {}).prefilter || {};
  const tp = item.target_prices || {};

  const bars = [
    { label: 'Growth',    val: item.growth_score },
    { label: 'Durability',val: item.durability_score },
    { label: 'Mgmt Qual', val: item.mgmt_quality_score },
    { label: 'Sentiment', val: item.mgmt_sentiment_score },
    { label: 'Valuation', val: item.valuation_score },
    { label: 'Technical', val: item.technical_score },
    { label: 'Sector',    val: item.sector_score },
  ].filter(b => b.val !== null && b.val !== undefined);

  return `
  <div class="analysis-wrap">
    <div class="analysis-hero">
      <div class="score-ring" style="--pct:${pct360};background:conic-gradient(${color} ${pct360}, rgba(255,255,255,.06) 0)">
        <span class="score-ring-val">${score.toFixed(0)}</span>
      </div>
      <div class="analysis-meta">
        <div class="analysis-name">${val(item.name)}</div>
        <div class="analysis-ticker">${val(item.ticker)} ${recBadge(item.recommendation)}</div>
        <div class="analysis-sector">${val(item.sector)} · Tier ${val(item.tier_reached)} · Confidence ${item.confidence_score != null ? (item.confidence_score * 100).toFixed(0) + '%' : '—'}</div>
      </div>
    </div>

    ${item.thesis_paragraph ? `
    <div>
      <div class="analysis-row-label">Investment Thesis</div>
      <div class="thesis-text">${item.thesis_paragraph}</div>
    </div>` : ''}

    ${bars.length ? `
    <div>
      <div class="analysis-row-label">Score Breakdown</div>
      <div class="score-bars">${bars.map(b => `
        <div class="score-bar-row">
          <div class="score-bar-label">${b.label}</div>
          <div class="score-bar-track"><div class="score-bar-fill" style="width:${Math.min(100, b.val||0)}%;background:${scoreColor(b.val)}"></div></div>
          <div class="score-bar-val">${fmt(b.val)}</div>
        </div>`).join('')}
      </div>
    </div>` : ''}

    ${(tp.bear || tp.base || tp.bull) ? `
    <div>
      <div class="analysis-row-label">Target Prices</div>
      <div class="target-prices">
        <div class="target-price-item target-bear"><div class="target-label">Bear</div><div class="target-val">${fmtPrice(tp.bear)}</div></div>
        <div class="target-price-item target-base"><div class="target-label">Base</div><div class="target-val">${fmtPrice(tp.base)}</div></div>
        <div class="target-price-item target-bull"><div class="target-label">Bull</div><div class="target-val">${fmtPrice(tp.bull)}</div></div>
      </div>
    </div>` : ''}

    ${(item.key_risks || []).length ? `
    <div>
      <div class="analysis-row-label">Key Risks</div>
      <div class="tag-list">${(item.key_risks || []).map(r => `<span class="tag tag-risk">${r}</span>`).join('')}</div>
    </div>` : ''}

    ${(item.key_catalysts || []).length ? `
    <div>
      <div class="analysis-row-label">Catalysts</div>
      <div class="tag-list">${(item.key_catalysts || []).map(c => `<span class="tag tag-catalyst">${c}</span>`).join('')}</div>
    </div>` : ''}

    ${Object.keys(prefilter).length ? `
    <div>
      <div class="analysis-row-label">Prefilter Data</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
        ${[['Revenue Growth', pct(prefilter.revenue_growth)],['ROE', pct(prefilter.roe)],['Debt/Equity', val(prefilter.debt_to_equity)],['P/E', val(prefilter.pe)],['P/B', val(prefilter.price_to_book)],['Failures', prefilter.hard_filter_failures?.join(', ') || 'None']].map(([l, v2]) =>
          `<div style="padding:8px;background:rgba(255,255,255,.03);border-radius:6px;border:1px solid var(--border)">
            <div style="font-size:.68rem;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">${l}</div>
            <div style="font-size:.83rem;font-weight:600">${v2}</div>
          </div>`
        ).join('')}
      </div>
    </div>` : ''}
  </div>`;
}

// ── Top list ──────────────────────────────────────
function rankClass(r) {
  if (r === 1) return 'gold'; if (r === 2) return 'silver'; if (r === 3) return 'bronze'; return '';
}

function renderTopList(results) {
  if (!results.length) return '<div class="empty-state"><p>No results yet.</p></div>';
  return `<div class="result-list">${results.map(item => `
    <div class="result-row" data-ticker="${item.ticker}">
      <div class="result-rank ${rankClass(item.rank_in_universe)}">${item.rank_in_universe ?? '—'}</div>
      <div class="result-info">
        <div class="result-ticker">${item.ticker}</div>
        <div class="result-name">${item.name || '—'}</div>
      </div>
      ${recBadge(item.recommendation)}
      <div class="result-score" style="color:${scoreColor(item.composite_score)}">${fmt(item.composite_score)}</div>
    </div>`).join('')}</div>`;
}

// ── Universe table ────────────────────────────────
function renderUniverseTable(results) {
  if (!results.length) return '<div class="empty-state"><p>No stocks found.</p></div>';
  return `<table class="universe-table">
    <thead><tr>
      <th>#</th><th>Ticker</th><th>Name</th><th>Sector</th>
      <th>Score</th><th>Growth</th><th>Durability</th><th>Valuation</th><th>Rec</th>
    </tr></thead>
    <tbody>${results.map(i => `<tr class="result-row" data-ticker="${i.ticker}">
      <td class="mono">${i.rank_in_universe ?? '—'}</td>
      <td><strong>${i.ticker}</strong></td>
      <td style="color:var(--text-2)">${i.name || '—'}</td>
      <td style="color:var(--text-2);font-size:.75rem">${i.sector || '—'}</td>
      <td style="font-weight:700;color:${scoreColor(i.composite_score)}">${fmt(i.composite_score)}</td>
      <td class="mono">${fmt(i.growth_score)}</td>
      <td class="mono">${fmt(i.durability_score)}</td>
      <td class="mono">${fmt(i.valuation_score)}</td>
      <td>${recBadge(i.recommendation)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

// ── KPI row ───────────────────────────────────────
function updateKPIs(results) {
  const kpi = $('kpiRow');
  if (!results.length) return;
  const tier1 = results.filter(r => r.tier_reached === 1).length;
  const topScore = Math.max(...results.map(r => r.composite_score || 0));
  const avg = (results.reduce((s, r) => s + (r.composite_score || 0), 0) / results.length).toFixed(1);

  kpi.innerHTML = [
    { val: results.length, label: 'Stocks Tracked' },
    { val: tier1, label: 'Tier 1 Passes' },
    { val: topScore.toFixed(1), label: 'Top Score' },
    { val: avg, label: 'Avg Composite' },
  ].map(k => `<div class="kpi-card">
    <div class="kpi-val">${k.val}</div>
    <div class="kpi-label">${k.label}</div>
  </div>`).join('');
}

// ── Load top ──────────────────────────────────────
let topCache = [];
async function loadTop(limit = 50) {
  try {
    const data = await api(`/top?limit=${limit}`);
    topCache = data.results;
    $('topCount').textContent = data.count;
    $('topResults').innerHTML = renderTopList(data.results);
    updateKPIs(data.results);

    // click handlers on list rows
    document.querySelectorAll('#topResults .result-row').forEach(row => {
      row.addEventListener('click', () => {
        $('tickerInput').value = row.dataset.ticker;
        viewTicker(row.dataset.ticker);
      });
    });
  } catch (e) {
    $('topResults').innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`;
  }
}

// ── Load universe ─────────────────────────────────
async function loadUniverse() {
  $('universeTable').innerHTML = '<div class="empty-state"><div class="spinner-sm"></div><p>Loading universe…</p></div>';
  try {
    const data = await api('/top?limit=800');
    $('universeTable').innerHTML = renderUniverseTable(data.results);
    document.querySelectorAll('#universeTable .result-row').forEach(row => {
      row.addEventListener('click', () => {
        $('tickerInput').value = row.dataset.ticker;
        showView('dashboard');
        viewTicker(row.dataset.ticker);
      });
    });
  } catch (e) {
    $('universeTable').innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`;
    toast(e.message, 'error');
  }
}

// ── View ticker ───────────────────────────────────
async function viewTicker(sym) {
  const t = sym || ticker();
  $('selectedBadge').className = 'badge badge-muted';
  $('selectedBadge').textContent = 'Loading…';
  $('stockView').innerHTML = '<div class="empty-state"><div class="spinner-sm"></div><p>Fetching…</p></div>';
  try {
    const data = await api(`/view/${t}`);
    $('stockView').innerHTML = renderAnalysis(data);
    $('selectedBadge').className = `badge badge-green`;
    $('selectedBadge').textContent = data.ticker;
  } catch (e) {
    $('stockView').innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`;
    $('selectedBadge').className = 'badge badge-red';
    $('selectedBadge').textContent = 'Not found';
    toast(e.message, 'error');
  }
}

// ── Refresh ticker ────────────────────────────────
async function refreshTicker() {
  const btn = $('refreshBtn'); btn.disabled = true;
  toast(`Refreshing ${ticker()}…`, 'info');
  try {
    const data = await api(`/refresh/${ticker()}`, { method: 'POST' });
    if (data.task_id) showTaskBanner(data.task_id);
    else { toast(`Refresh complete for ${ticker()}`, 'success'); await viewTicker(); await loadTop(); }
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

// ── Synthesize ticker ─────────────────────────────
async function synthesizeTicker(sym) {
  const t = sym || ticker();
  const btn = $('synthesizeBtn'); btn.disabled = true;
  toast(`Running AI agents on ${t}… (may take ~1 min)`, 'info');
  try {
    const data = await api(`/synthesize/${t}`, { method: 'POST' });
    $('stockView').innerHTML = renderAnalysis(data);
    $('selectedBadge').className = 'badge badge-blue';
    $('selectedBadge').textContent = 'AI Synthesized';
    toast(`Synthesis complete for ${t}`, 'success');
    await loadTop();
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

// ── Task banner ───────────────────────────────────
let currentTaskId = '';
function showTaskBanner(id) {
  currentTaskId = id;
  $('taskId').textContent = id;
  $('taskBanner').classList.remove('hidden');
}
$('taskClose').addEventListener('click', () => $('taskBanner').classList.add('hidden'));
$('checkTaskBtn').addEventListener('click', async () => {
  if (!currentTaskId) return;
  try {
    const data = await api(`/tasks/${currentTaskId}`);
    toast(`Task ${data.status}: ${data.message || ''}`, data.status === 'SUCCESS' ? 'success' : 'info');
    if (data.status === 'SUCCESS') { await viewTicker(); await loadTop(); }
  } catch (e) { toast(e.message, 'error'); }
});

// ── Prefilter (pipeline view) ─────────────────────
async function runPrefilter(async_task = false) {
  const result = $('prefilterResult');
  result.classList.remove('hidden');
  result.textContent = 'Running…';
  try {
    const data = await api(`/prefilter/run${async_task ? '?async_task=true' : ''}`, { method: 'POST' });
    if (data.task_id) { showTaskBanner(data.task_id); result.textContent = `Queued: ${data.task_id}`; }
    else result.textContent = `Done ✓\nRun ID: ${data.run_id}\nStatus: ${data.status}\nProcessed: ${data.processed_count}/${data.total_stocks}`;
    toast('Prefilter complete', 'success');
    await loadTop();
  } catch (e) { result.textContent = `Error: ${e.message}`; toast(e.message, 'error'); }
}

// ── Analyze view agent steps ──────────────────────
const stepIds = ['stepA','stepB','stepC','stepD','stepSynth'];
function resetSteps() { stepIds.forEach(id => $( id).className = 'agent-step'); }
function setStep(id, state) { $(id).className = `agent-step ${state}`; }

async function runAnalyze() {
  const t = ($('analyzeTickerInput').value.trim() || ticker()).toUpperCase();
  $('analyzeProgress').classList.remove('hidden');
  $('analyzeResult').innerHTML = '<div class="empty-state"><div class="spinner-sm"></div><p>Running agents…</p></div>';
  resetSteps();

  // Animate steps while waiting (fake progress — real progress would need SSE)
  const delays = [0, 8000, 16000, 24000, 32000];
  stepIds.forEach((id, i) => setTimeout(() => setStep(id, 'running'), delays[i]));

  const btn = $('analyzeRunBtn'); btn.disabled = true;
  try {
    const data = await api(`/synthesize/${t}`, { method: 'POST' });
    stepIds.forEach(id => setStep(id, 'done'));
    $('analyzeResult').innerHTML = renderAnalysis(data);
    toast(`Analysis complete for ${t}`, 'success');
    // Also update dashboard
    $('tickerInput').value = t;
    $('stockView').innerHTML = renderAnalysis(data);
    $('selectedBadge').className = 'badge badge-blue';
    $('selectedBadge').textContent = 'AI Synthesized';
    await loadTop();
  } catch (e) {
    stepIds.forEach(id => setStep(id, 'failed'));
    $('analyzeResult').innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`;
    toast(e.message, 'error');
  }
  finally { btn.disabled = false; }
}

// ── Wire events ───────────────────────────────────
$('refreshBtn').addEventListener('click', refreshTicker);
$('synthesizeBtn').addEventListener('click', () => synthesizeTicker());
$('viewBtn').addEventListener('click', () => viewTicker());
$('topBtn').addEventListener('click', () => loadTop(200));
$('reloadTopBtn').addEventListener('click', () => loadTop());
$('runPrefilterBtn').addEventListener('click', () => runPrefilter(false));

$('tickerInput').addEventListener('keydown', e => { if (e.key === 'Enter') viewTicker(); });

$('loadUniverseBtn').addEventListener('click', loadUniverse);

$('analyzeRunBtn').addEventListener('click', runAnalyze);
$('analyzeRefreshBtn').addEventListener('click', async () => {
  const t = ($('analyzeTickerInput').value.trim() || ticker()).toUpperCase();
  const btn = $('analyzeRefreshBtn'); btn.disabled = true;
  toast(`Refreshing ${t}…`, 'info');
  try {
    const data = await api(`/refresh/${t}`, { method: 'POST' });
    if (data.task_id) { showTaskBanner(data.task_id); toast(`Refresh queued for ${t}`, 'info'); }
    else toast(`Refreshed ${t}`, 'success');
  }
  catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; }
});
$('analyzeViewBtn').addEventListener('click', async () => {
  const t = ($('analyzeTickerInput').value.trim() || ticker()).toUpperCase();
  try {
    const data = await api(`/view/${t}`);
    $('analyzeResult').innerHTML = renderAnalysis(data);
  } catch (e) { toast(e.message, 'error'); }
});

$('prefilterInlineBtn').addEventListener('click', () => runPrefilter(false));
$('prefilterAsyncBtn').addEventListener('click', () => runPrefilter(true));

$('taskMonitorBtn').addEventListener('click', async () => {
  const id = $('taskMonitorInput').value.trim();
  if (!id) { toast('Enter a task ID', 'error'); return; }
  const result = $('taskMonitorResult'); result.classList.remove('hidden');
  try {
    const data = await api(`/tasks/${id}`);
    result.textContent = JSON.stringify(data, null, 2);
  } catch (e) { result.textContent = `Error: ${e.message}`; }
});

// ── Row clicks on universe ────────────────────────
document.addEventListener('click', e => {
  const row = e.target.closest('#universeTable .result-row');
  if (row) { showView('dashboard'); $('tickerInput').value = row.dataset.ticker; viewTicker(row.dataset.ticker); }
});

// ── Boot ──────────────────────────────────────────
loadStatus();
loadTop();
setInterval(loadStatus, 30000);
