// 計算用 Web Worker：所有回測、最佳化、滾動前進、蒙地卡羅都在這裡跑，避免卡住畫面。
// 訊息格式：主執行緒 → { id, type, payload }；回傳 { id, kind: 'progress'|'result'|'error', ... }

import { buildDatasets, resolveRange, TIMEFRAMES } from './core/data.js';
import { runBacktest, buyAndHold } from './core/engine.js';
import { computeMetrics } from './core/metrics.js';
import { buildGrid, sanitizeParams } from './core/params.js';
import { optimize } from './core/optimize.js';
import { walkForward } from './core/walkforward.js';
import { monteCarlo } from './core/montecarlo.js';
import { getStrategy } from './strategies/index.js';

let datasets = null;

function ctx(p) {
  if (!datasets) throw new Error('資料尚未載入');
  const bars = datasets[p.tf];
  if (!bars) throw new Error(`不支援的週期：${p.tf}`);
  const strategy = getStrategy(p.strategyId);
  const params = sanitizeParams(strategy, p.params);
  const range = resolveRange(bars, p.from, p.to, p.oosPct ?? 0);
  return { bars, strategy, params, range, barsPerYear: TIMEFRAMES[p.tf].barsPerYear };
}

function slice(arr, s, e) {
  return arr ? Float64Array.from(arr.subarray(s, e + 1)) : null;
}

/** 單次回測：全期、樣本內、樣本外、買進持有的指標，以及畫圖需要的資料 */
function backtest(p) {
  const { bars, strategy, params, range, barsPerYear } = ctx(p);
  const { start, end, isEnd } = range;
  const out = strategy.compute(bars, params);
  const res = runBacktest(bars, out.signal, p.settings, start, end);
  const bh = buyAndHold(bars, p.settings, start, end);
  const base = p.settings.initialCapital;
  const common = { equity: res.equity, trades: res.trades, offset: start, inPosition: res.inPosition, barsPerYear };
  const last = end - start;
  const split = isEnd - start;
  const metrics = {
    all: computeMetrics({ ...common, base }),
    is: computeMetrics({ ...common, to: split, base }),
    oos: split < last ? computeMetrics({ ...common, from: split + 1 }) : null,
    bh: computeMetrics({ equity: bh, base, barsPerYear }),
    bhOos: split < last ? computeMetrics({ equity: bh, from: split + 1, barsPerYear }) : null,
  };
  const result = { params, range, metrics, equity: res.equity, bh, busted: res.busted };
  if (p.lite) return result;
  result.trades = res.trades;
  result.overlays = (out.overlays ?? []).map((o) => ({ ...o, values: slice(o.values, start, end) }));
  result.panels = (out.panels ?? []).map((panel) => ({
    ...panel,
    series: panel.series.map((s) => ({ ...s, values: slice(s.values, start, end) })),
  }));
  return result;
}

function grid(strategy, params, keys, maxCombos) {
  const g = buildGrid(strategy, params, keys, maxCombos);
  if (g.combos.length < 2) throw new Error('參數組合少於 2 組，請至少勾選一個要最佳化的參數');
  return g;
}

const handlers = {
  init(p) {
    datasets = buildDatasets(p.base);
    return Object.fromEntries(Object.entries(datasets).map(([k, v]) => [k, v.length]));
  },

  backtest,

  optimize(p, progress) {
    const { bars, strategy, params, range, barsPerYear } = ctx(p);
    const g = grid(strategy, params, p.keys, p.maxCombos ?? 400);
    const r = optimize({
      bars, strategy, settings: p.settings, ...range, combos: g.combos,
      objective: p.objective, barsPerYear, onProgress: progress,
    });
    return { ...r, steps: g.steps, rawCombos: g.raw, range };
  },

  walkforward(p, progress) {
    const { bars, strategy, params, range, barsPerYear } = ctx({ ...p, oosPct: 0 });
    const g = grid(strategy, params, p.keys, p.maxCombos ?? 200);
    const r = walkForward({
      bars, strategy, settings: p.settings, start: range.start, end: range.end, combos: g.combos,
      objective: p.objective, barsPerYear, isMonths: p.isMonths, oosMonths: p.oosMonths, mode: p.mode,
      onProgress: progress,
    });
    return { ...r, steps: g.steps };
  },

  montecarlo(p, progress) {
    const { bars, strategy, params, range } = ctx(p);
    const res = runBacktest(bars, strategy.compute(bars, params).signal, p.settings, range.start, range.end);
    return monteCarlo({
      method: p.method, trades: res.trades, equity: res.equity, initialCapital: p.settings.initialCapital,
      iterations: p.iterations, blockSize: p.blockSize, seed: p.seed, onProgress: progress,
    });
  },
};

self.onmessage = (e) => {
  const { id, type, payload } = e.data;
  const progress = (value) => self.postMessage({ id, kind: 'progress', value });
  try {
    const handler = handlers[type];
    if (!handler) throw new Error(`未知的指令：${type}`);
    const data = handler(payload, progress);
    self.postMessage({ id, kind: 'result', data });
  } catch (err) {
    self.postMessage({ id, kind: 'error', message: err?.message ?? String(err) });
  }
};
