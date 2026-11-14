// 回測台頁面：表單 ↔ Worker ↔ 圖表 / 表格
import { STRATEGIES, getStrategy } from '../strategies/index.js';
import { defaultParams, sanitizeParams, buildGrid, describeParams } from '../core/params.js';
import { loadBaseBars, buildDatasets, TIMEFRAMES } from '../core/data.js';
import { DEFAULT_SETTINGS, EXIT_REASONS } from '../core/engine.js';
import { OBJECTIVES } from '../core/metrics.js';
import { SERIES, COLORS } from '../core/palette.js';
import { createWorkerClient } from '../ui/worker-client.js';
import { createPriceCharts, createEquityChart } from '../ui/charts.js';
import { drawFan, drawHistogram, autoDraw } from '../ui/plots.js';
import * as F from '../ui/format.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const form = $('#settings');
const PAGE_SIZE = 50;
const MAX_COMPARE = 6;

const state = {
  strategy: STRATEGIES[0],
  params: {},
  tf: '4h',
  direction: 'both',
  compare: [],
  datasets: null,
  meta: null,
  last: null,
  page: 0,
  runToken: 0,
  busy: false,
};

const client = createWorkerClient();
let priceCharts, equityChart, wfChart;

/* ── 小工具 ───────────────────────────────────────── */

function setStatus(msg, isError = false) {
  const el = $('#status');
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

function setupSegmented(el, value, onChange) {
  const buttons = $$('button', el);
  const set = (v) => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === v)));
  set(value);
  buttons.forEach((b) => b.addEventListener('click', () => { set(b.dataset.value); onChange?.(b.dataset.value); }));
  return { get: () => buttons.find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset.value, set };
}

function debounce(fn, ms) {
  let t = 0;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function readNumber(name, fallback) {
  const v = Number(form.elements[name]?.value);
  return Number.isFinite(v) ? v : fallback;
}

function readSettings() {
  const s = {};
  for (const k of ['initialCapital', 'positionPct', 'leverage', 'feePct', 'slippagePct', 'stopLossPct', 'takeProfitPct', 'trailingPct']) {
    s[k] = Math.max(0, readNumber(k, DEFAULT_SETTINGS[k]));
  }
  s.initialCapital = Math.max(s.initialCapital, 100);
  s.leverage = Math.max(s.leverage, 1);
  s.direction = state.direction;
  return s;
}

function readParams() {
  const raw = {};
  for (const p of state.strategy.params) raw[p.key] = form.elements[`p:${p.key}`]?.value;
  return sanitizeParams(state.strategy, raw);
}

function basePayload() {
  return {
    tf: state.tf,
    strategyId: state.strategy.id,
    params: state.params,
    settings: readSettings(),
    from: F.parseDate(form.elements.from.value),
    to: F.parseDate(form.elements.to.value, true),
    oosPct: Math.min(Math.max(readNumber('oosPct', 20), 0), 50) / 100,
  };
}

/* ── 表單產生 ─────────────────────────────────────── */

function renderStrategySelect() {
  const sel = $('#strategy');
  sel.innerHTML = STRATEGIES.map((s) => `<option value="${s.id}">${F.escapeHtml(s.name)}（${F.escapeHtml(s.category)}）</option>`).join('');
  sel.value = state.strategy.id;
}

function renderParamForm() {
  const wrap = $('#params');
  wrap.innerHTML = state.strategy.params.map((p) => {
    const v = state.params[p.key];
    if (p.type === 'select') {
      return `<label class="field"><span>${F.escapeHtml(p.label)}</span><select name="p:${p.key}">${p.options
        .map((o) => `<option value="${o.value}"${o.value === v ? ' selected' : ''}>${F.escapeHtml(o.label)}</option>`).join('')}</select></label>`;
    }
    const step = p.type === 'int' ? 1 : p.step;
    return `<label class="field"><span>${F.escapeHtml(p.label)} <em>${p.min}–${p.max}</em></span>
      <input type="number" name="p:${p.key}" min="${p.min}" max="${p.max}" step="${step}" value="${v}"></label>`;
  }).join('');
  renderOptKeys();
}

function renderOptKeys() {
  $('#opt-keys').innerHTML = state.strategy.params.map((p) => {
    const range = p.type === 'select' ? p.options.map((o) => o.label).join('/') : `${p.min}–${p.max} 間距 ${p.step}`;
    return `<label class="check"><input type="checkbox" value="${p.key}" checked> ${F.escapeHtml(p.label)} <small>${F.escapeHtml(range)}</small></label>`;
  }).join('');
  updateGridSize();
}

function optConfig() {
  const keys = $$('#opt-keys input:checked').map((i) => i.value);
  const maxCombos = Math.min(Math.max(Number($('#max-combos').value) || 300, 10), 1000);
  return { keys, maxCombos, objective: $('#objective').value };
}

function updateGridSize() {
  const { keys, maxCombos } = optConfig();
  const g = buildGrid(state.strategy, state.params, keys, maxCombos);
  const coarse = g.raw > g.combos.length ? `（原始 ${F.int(g.raw)} 組，已自動放大間距）` : '';
  $('#grid-size').textContent = `${F.int(g.combos.length)} 組${coarse}`;
}

function renderStrategyInfo() {
  const s = state.strategy;
  $('#strategy-info').innerHTML = `
    <div class="info-head">
      <h1>${F.escapeHtml(s.name)}</h1>
      <span class="en">${F.escapeHtml(s.nameEn ?? '')}</span>
      <span class="chip accent">${F.escapeHtml(s.category)}</span>
      ${(s.tags ?? []).map((t) => `<span class="chip">${F.escapeHtml(t)}</span>`).join('')}
    </div>
    <div class="info-body">
      <div>${s.description.map((p) => `<p>${F.escapeHtml(p)}</p>`).join('')}
        <p class="muted small">目前參數：<span class="mono">${F.escapeHtml(describeParams(s, state.params))}</span></p></div>
      <dl class="rules">
        <div><dt>做多</dt><dd>${F.escapeHtml(s.rules.long)}</dd></div>
        <div><dt>做空</dt><dd>${F.escapeHtml(s.rules.short)}</dd></div>
        <div><dt>出場</dt><dd>${F.escapeHtml(s.rules.exit)}</dd></div>
      </dl>
    </div>`;
}

/* ── 回測 ─────────────────────────────────────────── */

async function runMain() {
  if (!state.datasets) return;
  state.params = readParams();
  const token = ++state.runToken;
  const payload = basePayload();
  setStatus('回測中…');
  const t0 = performance.now();
  try {
    const [res, ...compares] = await Promise.all([
      client.request('backtest', payload),
      ...state.compare.map((c) => client.request('backtest', { ...payload, strategyId: c.strategyId, params: c.params, lite: true })),
    ]);
    if (token !== state.runToken) return;
    state.last = { res, compares, payload };
    state.page = 0;
    renderStrategyInfo();
    renderResults();
    updateURL();
    setStatus(`完成 · ${F.int(res.metrics.all.trades)} 筆交易 · ${Math.round(performance.now() - t0)} ms`);
  } catch (err) {
    if (token === state.runToken) setStatus(err.message, true);
  }
}
const runSoon = debounce(runMain, 300);

function currentBars() {
  const { start, end } = state.last.res.range;
  const b = state.datasets[state.tf];
  return {
    time: b.time.subarray(start, end + 1), open: b.open.subarray(start, end + 1), high: b.high.subarray(start, end + 1),
    low: b.low.subarray(start, end + 1), close: b.close.subarray(start, end + 1),
  };
}

function buildMarkers(trades, time, start) {
  const showText = trades.length <= 300;
  const m = [];
  for (const t of trades) {
    m.push({
      time: time[t.entryIdx - start], position: t.dir > 0 ? 'belowBar' : 'aboveBar',
      color: t.dir > 0 ? COLORS.up : COLORS.down, shape: t.dir > 0 ? 'arrowUp' : 'arrowDown',
      text: showText ? (t.dir > 0 ? '多' : '空') : '',
    });
    m.push({
      time: time[t.exitIdx - start], position: t.dir > 0 ? 'aboveBar' : 'belowBar',
      color: t.pnl > 0 ? COLORS.gold : COLORS.muted, shape: 'circle', text: '',
    });
  }
  return m.sort((a, b) => a.time - b.time);
}

function renderResults() {
  const { res, compares, payload } = state.last;
  const { range, metrics } = res;
  const bars = currentBars();
  const oosFrom = range.isEnd - range.start + 1;

  $('#range-label').textContent = `${F.date(bars.time[0])} → ${F.date(bars.time[bars.time.length - 1])} · ${TIMEFRAMES[state.tf].label} · ${F.int(bars.time.length)} 根`;
  renderKpis(metrics);
  renderWarnings(res);

  priceCharts.render({
    ...bars, overlays: res.overlays, panels: res.panels, oosFrom,
    markers: $('#show-markers').checked ? buildMarkers(res.trades, bars.time, range.start) : [],
  });
  $('#price-legend').innerHTML = [
    ...res.overlays.map((o) => `<span><i style="background:${o.color}"></i>${F.escapeHtml(o.name)}</span>`),
    ...res.panels.flatMap((p) => p.series.filter((s) => s.color).map((s) => `<span><i style="background:${s.color}"></i>${F.escapeHtml(s.name)}</span>`)),
  ].join('');

  const lines = [
    { name: state.strategy.name, color: COLORS.accent, values: res.equity, width: 2.4 },
    { name: '買進持有', color: COLORS.muted, values: res.bh, dashed: true, width: 1.5 },
    ...compares.map((c, i) => ({ name: state.compare[i].short, color: state.compare[i].color, values: c.equity, width: 1.6 })),
  ];
  equityChart.render(bars.time, lines, oosFrom);
  renderCompareTable(res, compares);
  renderMetricsTable(metrics, payload.oosPct > 0);
  renderTrades();
  updateGridSize();
}

function kpi(label, value, cls = '', hint = '') {
  return `<div class="kpi"><div class="label">${label}</div><div class="value ${cls}">${value}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
}

function renderKpis(m) {
  const a = m.all;
  $('#kpis').innerHTML = [
    kpi('總報酬', F.pct(a.totalReturn), F.tone(a.totalReturn), `買進持有 ${F.pct(m.bh.totalReturn)}`),
    kpi('年化報酬', F.pct(a.cagr), F.tone(a.cagr), `期末 ${F.money(a.finalEquity)}`),
    kpi('最大回撤', F.pct(-a.maxDD), 'neg', `買進持有 ${F.pct(-m.bh.maxDD)}`),
    kpi('夏普值', F.num(a.sharpe), F.tone(a.sharpe), `索提諾 ${F.num(a.sortino)}`),
    kpi('勝率', F.pct(a.winRate, 1, false), '', `獲利因子 ${F.num(a.profitFactor)}`),
    kpi('交易次數', F.int(a.trades), '', `平均持有 ${F.num(a.avgBars, 1)} 根`),
    kpi('樣本外報酬', m.oos ? F.pct(m.oos.totalReturn) : '—', m.oos ? F.tone(m.oos.totalReturn) : '', m.oos ? `樣本外夏普 ${F.num(m.oos.sharpe)}` : '未切樣本外'),
    kpi('曝險時間', F.pct(a.exposure, 0, false), '', `手續費 ${F.money(a.fees)}`),
  ].join('');
}

function renderWarnings(res) {
  const m = res.metrics, notes = [];
  if (res.busted) notes.push(['bad', '資金在回測途中歸零（爆倉），之後不再交易。請降低槓桿或投入比例。']);
  if (m.all.trades < 30) notes.push(['warn', `交易次數只有 ${m.all.trades} 筆，統計上樣本太少，結果可能只是運氣。`]);
  if (m.oos && m.is.sharpe > 0.3 && m.oos.sharpe < m.is.sharpe * 0.5) {
    notes.push(['warn', `樣本外夏普值（${F.num(m.oos.sharpe)}）不到樣本內（${F.num(m.is.sharpe)}）的一半，可能有過擬合；建議到下方「防過擬合檢驗」確認。`]);
  }
  if (m.all.fees > Math.abs(m.all.finalEquity - readSettings().initialCapital) && m.all.trades > 100) {
    notes.push(['warn', '手續費總額大於淨損益，交易過於頻繁；可改用較長的 K 線週期或放慢訊號。']);
  }
  $('#warnings').innerHTML = notes.map(([c, t]) => `<div class="note ${c}">${t}</div>`).join('');
}

const METRIC_ROWS = [
  ['總報酬', (m) => F.pct(m.totalReturn), 'totalReturn'],
  ['年化報酬', (m) => F.pct(m.cagr), 'cagr'],
  ['最大回撤', (m) => F.pct(-m.maxDD)],
  ['最長回撤（天）', (m) => F.int(m.maxDDDays)],
  ['夏普值', (m) => F.num(m.sharpe), 'sharpe'],
  ['索提諾', (m) => F.num(m.sortino), 'sortino'],
  ['卡瑪比率', (m) => F.num(m.calmar), 'calmar'],
  ['年化波動', (m) => F.pct(m.volatility, 1, false)],
  ['交易次數', (m) => (m.trades == null ? '—' : F.int(m.trades))],
  ['勝率', (m) => (m.winRate == null ? '—' : F.pct(m.winRate, 1, false))],
  ['獲利因子', (m) => (m.profitFactor == null ? '—' : F.num(m.profitFactor))],
  ['平均每筆報酬', (m) => (m.avgTradeRet == null ? '—' : F.pct(m.avgTradeRet, 2)), 'avgTradeRet'],
  ['平均持有（根）', (m) => (m.avgBars == null ? '—' : F.num(m.avgBars, 1))],
  ['曝險時間', (m) => (m.exposure == null ? '100%' : F.pct(m.exposure, 0, false))],
  ['手續費', (m) => (m.fees == null ? '—' : F.money(m.fees))],
  ['期末權益', (m) => F.money(m.finalEquity)],
];

function renderMetricsTable(m, hasOos) {
  const cols = [['全期', m.all], ['樣本內', m.is]];
  if (hasOos && m.oos) cols.push(['樣本外', m.oos]);
  cols.push(['買進持有', m.bh]);
  if (hasOos && m.bhOos) cols.push(['買進持有（樣本外）', m.bhOos]);
  $('#metrics-table').innerHTML = `
    <thead><tr><th>指標</th>${cols.map(([n]) => `<th>${n}</th>`).join('')}</tr></thead>
    <tbody>${METRIC_ROWS.map(([label, fmt, key]) => `<tr><td class="text">${label}</td>${cols
      .map(([, c]) => `<td class="${key ? F.tone(c[key]) : ''}">${fmt(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
}

function renderCompareTable(res, compares) {
  const wrap = $('#compare-wrap');
  if (!state.compare.length) {
    wrap.innerHTML = '<p class="muted small" style="margin:14px 0 0">按左側「＋ 加入比較」把目前的策略與參數加入清單，所有曲線會疊在上圖一起比較（最多 6 組）。</p>';
    return;
  }
  const rows = [
    { color: COLORS.accent, label: `${state.strategy.name}（目前）`, m: res.metrics.all, idx: -1 },
    ...compares.map((c, i) => ({ color: state.compare[i].color, label: state.compare[i].label, m: c.metrics.all, idx: i })),
    { color: COLORS.muted, label: '買進持有', m: res.metrics.bh, idx: -1 },
  ];
  wrap.innerHTML = `<div class="table-wrap"><table class="table">
    <thead><tr><th>策略</th><th>總報酬</th><th>年化</th><th>最大回撤</th><th>夏普</th><th>交易</th><th>勝率</th><th></th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td class="text"><span class="swatch" style="background:${r.color}"></span>${F.escapeHtml(r.label)}</td>
      <td class="${F.tone(r.m.totalReturn)}">${F.pct(r.m.totalReturn)}</td>
      <td class="${F.tone(r.m.cagr)}">${F.pct(r.m.cagr)}</td>
      <td>${F.pct(-r.m.maxDD)}</td>
      <td class="${F.tone(r.m.sharpe)}">${F.num(r.m.sharpe)}</td>
      <td>${r.m.trades == null ? '—' : F.int(r.m.trades)}</td>
      <td>${r.m.winRate == null ? '—' : F.pct(r.m.winRate, 0, false)}</td>
      <td>${r.idx >= 0 ? `<button class="x-btn" data-remove="${r.idx}" title="移除">×</button>` : ''}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

function renderTrades() {
  const { res } = state.last;
  const trades = res.trades.slice().reverse();
  const pages = Math.max(1, Math.ceil(trades.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages - 1);
  const view = trades.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
  $('#trade-count').textContent = `共 ${F.int(trades.length)} 筆，最新在前`;
  $('#trades-table').innerHTML = `
    <thead><tr><th>#</th><th>方向</th><th>進場時間</th><th>進場價</th><th>出場時間</th><th>出場價</th><th>報酬</th><th>損益</th><th>持有</th><th>出場原因</th></tr></thead>
    <tbody>${view.length ? view.map((t, i) => `<tr>
      <td>${trades.length - state.page * PAGE_SIZE - i}</td>
      <td class="text ${t.dir > 0 ? 'pos' : 'neg'}">${t.dir > 0 ? '做多' : '做空'}</td>
      <td>${F.dateTime(t.entryTime)}</td><td>${F.num(t.entryPrice)}</td>
      <td>${F.dateTime(t.exitTime)}</td><td>${F.num(t.exitPrice)}</td>
      <td class="${F.tone(t.ret)}">${F.pct(t.ret, 2)}</td>
      <td class="${F.tone(t.pnl)}">${F.money(t.pnl)}</td>
      <td>${t.bars}</td><td class="text">${EXIT_REASONS[t.reason]}</td>
    </tr>`).join('') : '<tr><td colspan="10" class="text empty">沒有交易</td></tr>'}</tbody>`;
  $('#pager').innerHTML = pages > 1 ? `
    <button class="btn small" data-page="${state.page - 1}" ${state.page === 0 ? 'disabled' : ''}>上一頁</button>
    <span>${state.page + 1} / ${pages}</span>
    <button class="btn small" data-page="${state.page + 1}" ${state.page >= pages - 1 ? 'disabled' : ''}>下一頁</button>` : '';
}

function downloadCsv() {
  if (!state.last) return;
  const head = ['方向', '進場時間(UTC)', '進場價', '出場時間(UTC)', '出場價', '數量', '報酬%', '損益USDT', '手續費', '持有根數', '出場原因'];
  const rows = state.last.res.trades.map((t) => [
    t.dir > 0 ? '做多' : '做空', F.dateTime(t.entryTime), t.entryPrice.toFixed(2), F.dateTime(t.exitTime), t.exitPrice.toFixed(2),
    t.qty.toFixed(6), (t.ret * 100).toFixed(3), t.pnl.toFixed(2), t.fees.toFixed(2), t.bars, EXIT_REASONS[t.reason],
  ]);
  const csv = '﻿' + [head, ...rows].map((r) => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `trades_${state.strategy.id}_${state.tf}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function addCompare() {
  state.params = readParams();
  const key = `${state.strategy.id}:${JSON.stringify(state.params)}`;
  if (state.compare.some((c) => c.key === key)) { setStatus('這組策略與參數已在比較清單中'); return; }
  if (state.compare.length >= MAX_COMPARE) { setStatus(`比較清單最多 ${MAX_COMPARE} 組`); return; }
  const used = new Set(state.compare.map((c) => c.color));
  const color = SERIES.find((c) => !used.has(c)) ?? SERIES[state.compare.length % SERIES.length];
  const desc = describeParams(state.strategy, state.params);
  state.compare.push({ key, strategyId: state.strategy.id, params: { ...state.params }, color, label: `${state.strategy.name}（${desc}）`, short: `${state.strategy.name} ${state.compare.length + 1}` });
  runMain();
}

function updateURL() {
  const q = new URLSearchParams({ s: state.strategy.id, tf: state.tf });
  for (const [k, v] of Object.entries(state.params)) q.set(`p_${k}`, v);
  history.replaceState(null, '', `${location.pathname}?${q}`);
}

/* ── 防過擬合 ─────────────────────────────────────── */

function progressBar(id) {
  const el = $(id), bar = $('i', el);
  return {
    start() { el.hidden = false; bar.style.width = '0%'; },
    set(v) { bar.style.width = `${Math.round(v * 100)}%`; },
    done() { bar.style.width = '100%'; setTimeout(() => { el.hidden = true; }, 400); },
  };
}

async function runRobust(kind, btn, progId, outEl, payloadFn, render) {
  if (state.busy) return;
  state.params = readParams();
  state.busy = true;
  $$('.run-row .btn').forEach((b) => { b.disabled = true; });
  const prog = progressBar(progId);
  prog.start();
  const t0 = performance.now();
  try {
    const payload = payloadFn();
    const out = await client.request(kind, payload, (v) => prog.set(v));
    render(out, payload, Math.round(performance.now() - t0));
  } catch (err) {
    $(outEl).innerHTML = `<div class="note bad">${F.escapeHtml(err.message)}</div>`;
  } finally {
    prog.done();
    state.busy = false;
    $$('.run-row .btn').forEach((b) => { b.disabled = false; });
  }
}

function verdictNote(cls, html) { return `<div class="note ${cls}">${html}</div>`; }

function paramChips(params) {
  return state.strategy.params.map((p) => {
    const v = params[p.key];
    const shown = p.type === 'select' ? p.options.find((o) => o.value === v)?.label : v;
    return `<span class="chip accent">${F.escapeHtml(p.label)}：${F.escapeHtml(shown)}</span>`;
  }).join('');
}

function renderOptimize(r, payload, ms) {
  const objLabel = OBJECTIVES[payload.objective].label;
  const b = r.best.metrics, o = r.oos;
  const notes = [];
  const pbo = r.pbo?.pbo;
  if (pbo != null) {
    notes.push(pbo < 0.2
      ? verdictNote('good', `PBO = <b>${F.pct(pbo, 0, false)}</b>：樣本內最佳的參數在樣本外通常仍排在前段，<b>過擬合風險低</b>。`)
      : pbo < 0.5
        ? verdictNote('warn', `PBO = <b>${F.pct(pbo, 0, false)}</b>：有相當機率樣本內最佳只是運氣，<b>需謹慎</b>。`)
        : verdictNote('bad', `PBO = <b>${F.pct(pbo, 0, false)}</b>：樣本內最佳的參數到樣本外多半落到後半段，<b>很可能是過擬合</b>。`));
  }
  const dsr = r.dsr.dsr;
  notes.push(dsr >= 0.95
    ? verdictNote('good', `DSR = <b>${F.pct(dsr, 0, false)}</b>：扣除「試了 ${r.combos} 組」的運氣後，夏普值仍顯著大於 0。`)
    : dsr >= 0.5
      ? verdictNote('warn', `DSR = <b>${F.pct(dsr, 0, false)}</b>：試了 ${r.combos} 組後，純運氣就可能達到年化夏普 ${F.num(r.dsr.sr0Annual)}，目前結果未達 95% 顯著水準。`)
      : verdictNote('bad', `DSR = <b>${F.pct(dsr, 0, false)}</b>：最佳夏普值（${F.num(r.dsr.srAnnual)}）沒有超過純運氣的期望最大值（${F.num(r.dsr.sr0Annual)}），<b>不具統計顯著性</b>。`));
  if (o) {
    notes.push(o.sharpe <= 0
      ? verdictNote('bad', `樣本外夏普值為 ${F.num(o.sharpe)}，最佳參數在沒看過的資料上<b>失效</b>。`)
      : o.sharpe < b.sharpe * 0.5
        ? verdictNote('warn', `樣本外夏普值 ${F.num(o.sharpe)} 不到樣本內（${F.num(b.sharpe)}）的一半，績效明顯衰退。`)
        : verdictNote('good', `樣本外夏普值 ${F.num(o.sharpe)}，與樣本內（${F.num(b.sharpe)}）相比衰退不大。`));
  }

  $('#out-opt').innerHTML = `
    <div class="best-params"><strong>樣本內最佳參數</strong>${paramChips(r.best.params)}
      <button class="btn small" id="apply-best">套用到回測台</button>
      <span class="muted small">${r.combos} 組 · ${objLabel} · ${ms} ms</span></div>
    <div class="kpis">
      ${kpi('樣本內報酬', F.pct(b.totalReturn), F.tone(b.totalReturn), `夏普 ${F.num(b.sharpe)}`)}
      ${kpi('樣本外報酬', o ? F.pct(o.totalReturn) : '—', o ? F.tone(o.totalReturn) : '', o ? `夏普 ${F.num(o.sharpe)}` : '樣本外比例為 0')}
      ${kpi('緊縮夏普 DSR', F.pct(dsr, 0, false), dsr >= 0.95 ? 'pos' : dsr >= 0.5 ? 'warn' : 'neg', `PSR（不校正）${F.pct(r.dsr.psr, 0, false)}`)}
      ${kpi('運氣門檻', F.num(r.dsr.sr0Annual), '', '純運氣的期望最大年化夏普')}
      ${kpi('過擬合機率 PBO', pbo == null ? '—' : F.pct(pbo, 0, false), pbo == null ? '' : pbo < 0.2 ? 'pos' : pbo < 0.5 ? 'warn' : 'neg', `CSCV ${r.blocks} 段 · ${F.int(r.pbo?.splits)} 種切法`)}
      ${kpi('平均夏普衰退', r.pbo ? F.num(r.pbo.avgDegradation) : '—', '', '樣本內最佳 → 樣本外')}
    </div>
    <div class="verdict">${notes.join('')}</div>
    <div class="result-grid">
      <div><h4>樣本外相對排名的 logit 分布（λ ≤ 0 的比例 = PBO）</h4><canvas class="plot" id="plot-lambda"></canvas></div>
      <div><h4>樣本內前 20 名參數</h4>
        <div class="table-wrap scroll"><table class="table">
          <thead><tr><th>#</th><th>參數</th><th>${objLabel}</th><th>報酬</th><th>夏普</th><th>回撤</th><th>交易</th></tr></thead>
          <tbody>${r.top.map((t, i) => `<tr><td>${i + 1}</td><td class="text">${F.escapeHtml(describeParams(state.strategy, t.params))}</td>
            <td>${F.num(t.score)}</td><td class="${F.tone(t.metrics.totalReturn)}">${F.pct(t.metrics.totalReturn)}</td>
            <td>${F.num(t.metrics.sharpe)}</td><td>${F.pct(-t.metrics.maxDD)}</td><td>${F.int(t.metrics.trades)}</td></tr>`).join('')}</tbody>
        </table></div></div>
    </div>`;
  $('#apply-best').addEventListener('click', () => {
    state.params = sanitizeParams(state.strategy, r.best.params);
    renderParamForm();
    runMain();
    form.scrollIntoView({ behavior: 'smooth' });
  });
  if (r.pbo) {
    const lambdas = r.pbo.lambdas;
    let min = Math.min(...lambdas), max = Math.max(...lambdas);
    if (min === max) { min -= 1; max += 1; }
    const bins = 30, width = (max - min) / bins, counts = new Array(bins).fill(0);
    for (const l of lambdas) counts[Math.min(bins - 1, Math.floor((l - min) / width))]++;
    const canvas = $('#plot-lambda');
    autoDraw(canvas, () => drawHistogram(canvas, { min, max, width, counts }, {
      color: (v) => (v <= 0 ? COLORS.down : COLORS.up),
      format: (v) => v.toFixed(1),
      marks: [{ value: 0, label: 'λ', color: COLORS.gold, dashed: true }],
    }));
  }
}

function renderWalkForward(r, payload, ms) {
  const s = r.stitched;
  const wfeCls = r.wfe >= 0.5 ? 'pos' : r.wfe >= 0 ? 'warn' : 'neg';
  const notes = [
    r.wfe >= 0.5
      ? verdictNote('good', `Walk-forward 效率 <b>${F.num(r.wfe)}</b>：樣本外保有樣本內一半以上的年化報酬，參數選擇方法具延續性。`)
      : r.wfe >= 0
        ? verdictNote('warn', `Walk-forward 效率 <b>${F.num(r.wfe)}</b>：樣本外績效明顯低於樣本內，最佳化的效果打折扣。`)
        : verdictNote('bad', `Walk-forward 效率 <b>${F.num(r.wfe)}</b>：樣本內選出的參數到了樣本外反而虧損，<b>最佳化流程不可靠</b>。`),
    s.totalReturn > r.bhMetrics.totalReturn
      ? verdictNote('good', `拼接後的樣本外報酬 ${F.pct(s.totalReturn)} 勝過同期買進持有（${F.pct(r.bhMetrics.totalReturn)}）。`)
      : verdictNote('warn', `拼接後的樣本外報酬 ${F.pct(s.totalReturn)} 不如同期買進持有（${F.pct(r.bhMetrics.totalReturn)}）。`),
  ];
  wfChart?.chart.remove();
  $('#out-wf').innerHTML = `
    <p class="muted small">${r.segments.length} 段 · 每段 ${r.combos} 組參數 · ${OBJECTIVES[payload.objective].label} · ${payload.mode === 'rolling' ? '固定滾動' : '起點固定'} · ${ms} ms</p>
    <div class="kpis">
      ${kpi('樣本外拼接報酬', F.pct(s.totalReturn), F.tone(s.totalReturn), `買進持有 ${F.pct(r.bhMetrics.totalReturn)}`)}
      ${kpi('年化報酬', F.pct(s.cagr), F.tone(s.cagr))}
      ${kpi('最大回撤', F.pct(-s.maxDD), 'neg', `買進持有 ${F.pct(-r.bhMetrics.maxDD)}`)}
      ${kpi('夏普值', F.num(s.sharpe), F.tone(s.sharpe), `買進持有 ${F.num(r.bhMetrics.sharpe)}`)}
      ${kpi('WF 效率', F.num(r.wfe), wfeCls, '樣本外 ÷ 樣本內年化報酬')}
      ${kpi('正報酬段數', `${F.pct(r.positiveRatio, 0, false)}`, '', `${Math.round(r.positiveRatio * r.segments.length)} / ${r.segments.length} 段`)}
    </div>
    <div class="verdict">${notes.join('')}</div>
    <div class="chart chart-wf" id="chart-wf"></div>
    <h4 style="margin-top:18px">各段結果</h4>
    <div class="table-wrap scroll"><table class="table">
      <thead><tr><th>#</th><th>樣本內</th><th>樣本外</th><th>選出參數</th><th>樣本內年化</th><th>樣本外報酬</th><th>樣本外夏普</th><th>回撤</th><th>交易</th></tr></thead>
      <tbody>${r.segments.map((g, i) => `<tr><td>${i + 1}</td>
        <td>${F.date(g.isFrom)} ~ ${F.date(g.isTo)}</td><td>${F.date(g.oosFrom)} ~ ${F.date(g.oosTo)}</td>
        <td class="text">${F.escapeHtml(describeParams(state.strategy, g.params))}</td>
        <td class="${F.tone(g.isCagr)}">${F.pct(g.isCagr)}</td>
        <td class="${F.tone(g.oos.totalReturn)}">${F.pct(g.oos.totalReturn)}</td>
        <td>${F.num(g.oos.sharpe)}</td><td>${F.pct(-g.oos.maxDD)}</td><td>${F.int(g.oos.trades)}</td></tr>`).join('')}</tbody>
    </table></div>`;
  wfChart = createEquityChart($('#chart-wf'), { log: $('#log-scale').checked });
  wfChart.render(r.equity.time, [
    { name: '滾動前進（樣本外拼接）', color: COLORS.accent, values: r.equity.value, width: 2.4 },
    { name: '買進持有', color: COLORS.muted, values: r.bh.value, dashed: true, width: 1.5 },
  ]);
}

function renderMonteCarlo(r, payload, ms) {
  const unit = r.method === 'trades' ? `${F.int(r.length)} 筆交易` : `${F.int(r.length)} 根 K 棒，區塊 ${payload.blockSize} 根`;
  const notes = [
    verdictNote(r.probLoss < 0.1 ? 'good' : r.probLoss < 0.35 ? 'warn' : 'bad', `${F.int(r.iterations)} 次模擬中有 <b>${F.pct(r.probLoss, 0, false)}</b> 最終虧損。`),
    verdictNote(r.maxDD.p95 > r.maxDD.actual * 1.5 ? 'warn' : 'good',
      `實際最大回撤 ${F.pct(-r.maxDD.actual)}，但有 5% 的情境會超過 <b>${F.pct(-r.maxDD.p95)}</b>；資金與心理準備應以後者為準。`),
  ];
  $('#out-mc').innerHTML = `
    <p class="muted small">${F.escapeHtml(state.strategy.name)}（${F.escapeHtml(describeParams(state.strategy, payload.params))}）· ${r.method === 'trades' ? '交易重抽' : '區塊抽樣'} · ${unit} · ${ms} ms</p>
    <div class="kpis">
      ${kpi('虧損機率', F.pct(r.probLoss, 0, false), r.probLoss < 0.1 ? 'pos' : r.probLoss < 0.35 ? 'warn' : 'neg')}
      ${kpi('報酬 5% 分位', F.pct(r.final.p5), F.tone(r.final.p5), '95% 信心的最差情境')}
      ${kpi('報酬中位數', F.pct(r.final.p50), F.tone(r.final.p50), `實際 ${F.pct(r.final.actual)}`)}
      ${kpi('報酬 95% 分位', F.pct(r.final.p95), F.tone(r.final.p95))}
      ${kpi('回撤中位數', F.pct(-r.maxDD.p50), 'neg', `實際 ${F.pct(-r.maxDD.actual)}`)}
      ${kpi('回撤 95% 分位', F.pct(-r.maxDD.p95), 'neg', '最壞 5% 情境')}
    </div>
    <div class="verdict">${notes.join('')}</div>
    <div class="result-grid">
      <div style="grid-column:1/-1"><h4>權益路徑分布</h4><canvas class="plot tall" id="plot-fan"></canvas>
        <div class="legend-inline"><span><i style="background:rgba(165,148,255,.3)"></i>5%–95%</span><span><i style="background:rgba(165,148,255,.55)"></i>25%–75%</span><span><i style="background:${COLORS.accent}"></i>中位數</span><span><i style="background:${COLORS.cyan}"></i>實際回測</span></div></div>
      <div><h4>最終報酬分布 <span class="muted">（對數刻度）</span></h4><canvas class="plot" id="plot-final"></canvas></div>
      <div><h4>最大回撤分布</h4><canvas class="plot" id="plot-dd"></canvas></div>
    </div>`;
  const fan = $('#plot-fan'), fin = $('#plot-final'), dd = $('#plot-dd');
  autoDraw(fan, () => drawFan(fan, r));
  const toLog = (v) => Math.log(Math.max(1 + v, 1e-3));
  autoDraw(fin, () => drawHistogram(fin, r.histFinalLog, {
    color: (v) => (v < 0 ? COLORS.down : COLORS.up),
    format: (v) => F.pct(Math.expm1(v), 0),
    marks: [{ value: toLog(r.final.actual), label: '實際', color: COLORS.cyan }, { value: toLog(r.final.p5), label: '5%', color: COLORS.gold, dashed: true }],
  }));
  autoDraw(dd, () => drawHistogram(dd, r.histDD, {
    color: COLORS.down,
    format: (v) => `-${(v * 100).toFixed(0)}%`,
    marks: [{ value: r.maxDD.actual, label: '實際', color: COLORS.cyan }, { value: r.maxDD.p95, label: '95%', color: COLORS.gold, dashed: true }],
  }));
}

function setupRobust() {
  const tabs = $$('[role="tab"]');
  tabs.forEach((t) => t.addEventListener('click', () => {
    tabs.forEach((x) => {
      const on = x === t;
      x.setAttribute('aria-selected', String(on));
      $(`#${x.getAttribute('aria-controls')}`).hidden = !on;
    });
  }));
  const wfMode = setupSegmented($('#wf-mode'), 'rolling');
  const mcMethod = setupSegmented($('#mc-method'), 'blocks');
  $('#opt-keys').addEventListener('change', updateGridSize);
  $('#max-combos').addEventListener('input', debounce(updateGridSize, 200));

  $('#run-opt').addEventListener('click', () => runRobust('optimize', '#run-opt', '#prog-opt', '#out-opt',
    () => {
      const p = { ...basePayload(), ...optConfig() };
      if (p.oosPct === 0) p.oosPct = 0.2;
      return p;
    }, renderOptimize));

  $('#run-wf').addEventListener('click', () => runRobust('walkforward', '#run-wf', '#prog-wf', '#out-wf',
    () => ({
      ...basePayload(), ...optConfig(), maxCombos: Math.min(optConfig().maxCombos, 300),
      isMonths: Math.max(1, Number($('#wf-is').value) || 12),
      oosMonths: Math.max(1, Number($('#wf-oos').value) || 3),
      mode: wfMode.get(),
    }), renderWalkForward));

  $('#run-mc').addEventListener('click', () => runRobust('montecarlo', '#run-mc', '#prog-mc', '#out-mc',
    () => {
      const days = Math.max(1, Number($('#mc-block').value) || 7);
      return {
        ...basePayload(), oosPct: 0,
        method: mcMethod.get(),
        iterations: Math.min(Math.max(Number($('#mc-iter').value) || 1000, 100), 5000),
        blockSize: Math.max(1, Math.round((days * 86400) / TIMEFRAMES[state.tf].seconds)),
        seed: Number($('#mc-seed').value) || 42,
      };
    }, renderMonteCarlo));
}

/* ── 初始化 ───────────────────────────────────────── */

function readURL() {
  const q = new URLSearchParams(location.search);
  if (q.get('s')) state.strategy = getStrategy(q.get('s'));
  if (TIMEFRAMES[q.get('tf')]) state.tf = q.get('tf');
  const raw = {};
  for (const p of state.strategy.params) if (q.has(`p_${p.key}`)) raw[p.key] = q.get(`p_${p.key}`);
  state.params = sanitizeParams(state.strategy, { ...defaultParams(state.strategy), ...raw });
}

async function init() {
  readURL();
  renderStrategySelect();
  renderParamForm();
  renderStrategyInfo();
  setupSegmented($('#tf'), state.tf, (v) => { state.tf = v; runMain(); });
  setupSegmented($('#direction'), state.direction, (v) => { state.direction = v; runMain(); });
  setupRobust();

  try {
    priceCharts = createPriceCharts($('#chart-price'), $('#chart-panel'));
    equityChart = createEquityChart($('#chart-equity'));
  } catch (err) {
    setStatus(err.message, true);
    return;
  }

  $('#strategy').addEventListener('change', (e) => {
    state.strategy = getStrategy(e.target.value);
    state.params = defaultParams(state.strategy);
    renderParamForm();
    runMain();
  });
  $('#reset-params').addEventListener('click', () => { state.params = defaultParams(state.strategy); renderParamForm(); runMain(); });
  form.addEventListener('submit', (e) => { e.preventDefault(); runMain(); });
  form.addEventListener('input', (e) => { if (e.target.type === 'number') runSoon(); });
  form.addEventListener('change', (e) => { if (e.target.type === 'date' || e.target.name?.startsWith('p:')) runSoon(); });
  $('#add-compare').addEventListener('click', addCompare);
  $('#compare-wrap').addEventListener('click', (e) => {
    const idx = e.target.closest('[data-remove]')?.dataset.remove;
    if (idx == null) return;
    state.compare.splice(Number(idx), 1);
    runMain();
  });
  $('#pager').addEventListener('click', (e) => {
    const p = e.target.closest('[data-page]')?.dataset.page;
    if (p == null) return;
    state.page = Number(p);
    renderTrades();
  });
  $('#show-markers').addEventListener('change', (e) => {
    if (!state.last) return;
    const bars = currentBars();
    priceCharts.setMarkers(e.target.checked ? buildMarkers(state.last.res.trades, bars.time, state.last.res.range.start) : []);
  });
  $('#log-scale').addEventListener('change', (e) => { equityChart.setLog(e.target.checked); wfChart?.setLog(e.target.checked); });
  $('#download-csv').addEventListener('click', downloadCsv);

  try {
    const base = new URL('../../../', import.meta.url);
    const { meta, bars } = await loadBaseBars(base);
    state.meta = meta;
    state.datasets = buildDatasets(bars);
    await client.request('init', { base: bars });
    const from = F.date(meta.start), to = F.date(meta.end);
    for (const name of ['from', 'to']) { form.elements[name].min = from; form.elements[name].max = to; }
    form.elements.from.value = from;
    form.elements.to.value = to;
    await runMain();
  } catch (err) {
    setStatus(`資料載入失敗：${err.message}`, true);
  }
}

init();
