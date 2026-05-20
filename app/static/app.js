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

Object.entries(navBtns).forEach(([name, btn]) => btn.addEventListener('click', () => {
  showView(name);
  if (name === 'universe') loadUniverse();
}));

// Universe filter controls (wired after DOM ready)
document.addEventListener('DOMContentLoaded', () => {
  const filterBtn = $('universeFilterBtn');
  const clearBtn  = $('universeClearBtn');
  const searchEl  = $('universeSearch');
  const sectorEl  = $('universeSector');

  if (filterBtn) filterBtn.addEventListener('click', () =>
    loadUniverse(sectorEl.value, searchEl.value.trim())
  );
  if (clearBtn) clearBtn.addEventListener('click', () => {
    searchEl.value = ''; sectorEl.value = '';
    loadUniverse();
  });
  if (searchEl) searchEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') loadUniverse(sectorEl.value, searchEl.value.trim());
  });
});

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
  const ao = item.agent_outputs || {};
  const pf2 = ao.prefilter_v2 || null;
  const pfLeg = ao.prefilter || {};
  const tp = item.target_prices || {};

  // Score bar labels depend on scoring engine
  const bars = pf2 ? [
    { label: 'Growth',    val: item.growth_score },
    { label: 'Quality',   val: item.durability_score },
    { label: 'Valuation', val: item.valuation_score },
    { label: 'Momentum',  val: item.technical_score },
    { label: 'Health',    val: item.sector_score },
  ] : [
    { label: 'Growth',    val: item.growth_score },
    { label: 'Durability',val: item.durability_score },
    { label: 'Mgmt Qual', val: item.mgmt_quality_score },
    { label: 'Sentiment', val: item.mgmt_sentiment_score },
    { label: 'Valuation', val: item.valuation_score },
    { label: 'Technical', val: item.technical_score },
  ];
  const visibleBars = bars.filter(b => b.val !== null && b.val !== undefined);

  // Quant metrics grid (prefilter_v2 only)
  const quantMetrics = pf2 ? [
    ['Rev CAGR 2yr', pf2.rev_cagr != null ? `${Number(pf2.rev_cagr).toFixed(1)}%` : '—'],
    ['PAT CAGR 2yr', pf2.pat_cagr != null ? `${Number(pf2.pat_cagr).toFixed(1)}%` : '—'],
    ['ROIC',         pf2.roic != null ? `${Number(pf2.roic).toFixed(1)}%` : '—'],
    ['ROE',          pf2.roe  != null ? `${Number(pf2.roe).toFixed(1)}%` : '—'],
    ['Fwd PE',       pf2.pe_fwd != null ? `${Number(pf2.pe_fwd).toFixed(1)}x` : (pf2.pe_ttm != null ? `${Number(pf2.pe_ttm).toFixed(1)}x (TTM)` : '—')],
    ['EV/EBITDA Fwd',pf2.ev_ebitda_fwd != null ? `${Number(pf2.ev_ebitda_fwd).toFixed(1)}x` : '—'],
    ['Consensus ↑',  pf2.consensus_upside != null ? `${Number(pf2.consensus_upside).toFixed(0)}%` : '—'],
    ['EBITDA Margin',pf2.ebitda_margin_fy25 != null ? `${Number(pf2.ebitda_margin_fy25).toFixed(1)}%` : '—'],
    ['3m Return',    pf2.ret_3m != null ? `${Number(pf2.ret_3m).toFixed(1)}%` : '—'],
    ['6m Return',    pf2.ret_6m != null ? `${Number(pf2.ret_6m).toFixed(1)}%` : '—'],
    ['Net Leverage', pf2.net_leverage != null ? `${Number(pf2.net_leverage).toFixed(2)}x` : '—'],
    ['Promoter %',   pf2.promoter_pct != null ? `${Number(pf2.promoter_pct).toFixed(1)}%` : '—'],
  ] : Object.keys(pfLeg).length ? [
    ['Rev Growth', pct(pfLeg.revenue_growth)],
    ['ROE', pct(pfLeg.roe)],
    ['Debt/Equity', val(pfLeg.debt_to_equity)],
    ['P/E', val(pfLeg.pe)],
    ['P/B', val(pfLeg.price_to_book)],
    ['Issues', pfLeg.hard_filter_failures?.join(', ') || 'None'],
  ] : [];

  return `
  <div class="analysis-wrap">
    <div class="analysis-hero">
      <div class="score-ring" style="--pct:${pct360};background:conic-gradient(${color} ${pct360}, rgba(255,255,255,.06) 0)">
        <span class="score-ring-val">${score.toFixed(0)}</span>
      </div>
      <div class="analysis-meta">
        <div class="analysis-name">${val(item.name)}</div>
        <div class="analysis-ticker">${val(item.ticker)} ${recBadge(item.recommendation)}</div>
        <div class="analysis-sector">${val(item.sector)} · Rank #${item.rank_in_universe ?? '—'} · Confidence ${item.confidence_score != null ? (item.confidence_score * 100).toFixed(0) + '%' : '—'}</div>
      </div>
    </div>

    ${item.thesis_paragraph ? `
    <div>
      <div class="analysis-row-label">Snapshot</div>
      <div class="thesis-text">${item.thesis_paragraph}</div>
    </div>` : ''}

    ${visibleBars.length ? `
    <div>
      <div class="analysis-row-label">Score Breakdown${pf2 ? ' <span style="font-size:.7rem;color:var(--text-3);font-weight:400">(percentile-ranked within universe/sector)</span>' : ''}</div>
      <div class="score-bars">${visibleBars.map(b => `
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
      <div class="analysis-row-label">Risks</div>
      <div class="tag-list">${(item.key_risks || []).map(r => `<span class="tag tag-risk">${r.replace(/_/g,' ')}</span>`).join('')}</div>
    </div>` : ''}

    ${(item.key_catalysts || []).length ? `
    <div>
      <div class="analysis-row-label">Catalysts</div>
      <div class="tag-list">${(item.key_catalysts || []).map(c => `<span class="tag tag-catalyst">${c.replace(/_/g,' ')}</span>`).join('')}</div>
    </div>` : ''}

    ${quantMetrics.length ? `
    <div>
      <div class="analysis-row-label">Quantitative Data</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
        ${quantMetrics.map(([l, v2]) =>
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
  if (!results.length) return '<div class="empty-state" style="padding:40px"><p>No stocks found.</p></div>';
  // Detect v2 scoring by checking first result
  const isV2 = results.some(i => (i.agent_outputs || {}).prefilter_v2);
  const q2Label = isV2 ? 'Quality' : 'Durability';
  const q3Label = isV2 ? 'Momentum' : 'Technical';
  const q4Label = isV2 ? 'Health' : 'Sector';

  return `<div style="overflow-x:auto"><table class="universe-table">
    <thead><tr>
      <th>#</th><th>Ticker</th><th>Name</th><th>Sector</th>
      <th>Score</th><th>Growth</th><th>${q2Label}</th><th>Valuation</th><th>${q3Label}</th><th>${q4Label}</th><th>Rec</th>
    </tr></thead>
    <tbody>${results.map(i => {
      const extraCols = isV2
        ? `<td class="mono" title="Momentum">${fmt(i.technical_score)}</td><td class="mono" title="Health">${fmt(i.sector_score)}</td>`
        : `<td class="mono">${fmt(i.technical_score)}</td><td class="mono">${fmt(i.sector_score)}</td>`;
      return `<tr class="result-row" data-ticker="${i.ticker}">
        <td class="mono">${i.rank_in_universe ?? '—'}</td>
        <td><strong>${i.ticker}</strong></td>
        <td style="color:var(--text-2)">${i.name || '—'}</td>
        <td style="color:var(--text-3);font-size:.73rem">${i.sector || '—'}</td>
        <td style="font-weight:700;color:${scoreColor(i.composite_score)}">${fmt(i.composite_score)}</td>
        <td class="mono">${fmt(i.growth_score)}</td>
        <td class="mono">${fmt(i.durability_score)}</td>
        <td class="mono">${fmt(i.valuation_score)}</td>
        ${extraCols}
        <td>${recBadge(i.recommendation)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
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
let sectorsLoaded = false;
async function loadSectors() {
  if (sectorsLoaded) return;
  try {
    const data = await api('/universe/sectors');
    const sel = $('universeSector');
    data.sectors.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      sel.appendChild(opt);
    });
    sectorsLoaded = true;
  } catch (_) {}
}

async function loadUniverse(sector = '', q = '') {
  $('universeTable').innerHTML = '<div class="empty-state" style="padding:40px"><div class="spinner-sm"></div><p>Loading universe…</p></div>';
  await loadSectors();
  try {
    const params = new URLSearchParams({ limit: 1000 });
    if (sector) params.set('sector', sector);
    if (q) params.set('q', q);
    const data = await api(`/top?${params}`);
    $('universeTable').innerHTML = renderUniverseTable(data.results);
    const countEl = $('universeCount');
    if (countEl) countEl.textContent = `${data.count} stock${data.count !== 1 ? 's' : ''}`;
    document.querySelectorAll('#universeTable .result-row').forEach(row => {
      row.addEventListener('click', () => {
        $('tickerInput').value = row.dataset.ticker;
        showView('dashboard');
        viewTicker(row.dataset.ticker);
      });
    });
  } catch (e) {
    $('universeTable').innerHTML = `<div class="empty-state" style="padding:40px"><p>${e.message}</p></div>`;
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

$('loadUniverseBtn').addEventListener('click', () => {
  const s = $('universeSector'); const q = $('universeSearch');
  loadUniverse(s ? s.value : '', q ? q.value.trim() : '');
});

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

// ── Sync Equity Universe ──────────────────────────
async function seedStocks() {
  const btn = $('seedBtn'); btn.disabled = true;
  const result = $('seedResult');
  result.classList.remove('hidden');
  result.textContent = 'Syncing equity_universe from Supabase… (~30 sec, please wait)';
  toast('Syncing equity universe — reading 895 stocks from Supabase', 'info');
  try {
    const data = await api('/stocks/sync', { method: 'POST' });
    result.textContent = `✓ ${data.message}`;
    toast(`Synced ${data.synced} stocks successfully`, 'success');
    await loadTop();
  } catch (e) {
    result.textContent = `Error: ${e.message}`;
    toast(e.message, 'error');
  } finally { btn.disabled = false; }
}

// ── Full pipeline (sync + prefilter) ─────────────
async function runFullPipeline() {
  const btn = $('fullPipelineBtn'); btn.disabled = true;
  const result = $('fullPipelineResult');
  result.classList.remove('hidden');
  result.textContent = 'Running full pipeline (sync equity universe + prefilter)… please wait ~1 min';
  toast('Full pipeline started — syncing 895 stocks then scoring all', 'info');
  try {
    const data = await api('/pipeline/full', { method: 'POST' });
    result.textContent = `✓ ${data.message}`;
    toast('Full pipeline complete!', 'success');
    await loadTop();
  } catch (e) {
    result.textContent = `Error: ${e.message}`;
    toast(e.message, 'error');
  } finally { btn.disabled = false; }
}

// ── Custom ticker add ─────────────────────────────
async function customRefresh() {
  const t = ($('customTickerInput').value.trim()).toUpperCase();
  if (!t) { toast('Enter a ticker first', 'error'); return; }
  const btn = $('customRefreshBtn'); btn.disabled = true;
  const result = $('customRefreshResult');
  result.classList.remove('hidden');
  result.textContent = `Fetching ${t}…`;
  try {
    const data = await api(`/refresh/${t}`, { method: 'POST' });
    if (data.task_id) {
      showTaskBanner(data.task_id);
      result.textContent = `Queued: task ${data.task_id}`;
      toast(`${t} refresh queued`, 'info');
    } else {
      result.textContent = `✓ ${t} refreshed. Go to Analyze tab to run AI agents.`;
      toast(`${t} added and scored`, 'success');
      await loadTop();
    }
  } catch (e) {
    result.textContent = `Error: ${e.message}`;
    toast(e.message, 'error');
  } finally { btn.disabled = false; }
}

$('seedBtn').addEventListener('click', seedStocks);
$('fullPipelineBtn').addEventListener('click', runFullPipeline);
$('customRefreshBtn').addEventListener('click', customRefresh);
$('customTickerInput').addEventListener('keydown', e => { if (e.key === 'Enter') customRefresh(); });

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
