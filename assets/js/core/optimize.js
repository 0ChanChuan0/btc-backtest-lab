// 參數最佳化（只用樣本內資料）＋ 統計校正（DSR、PBO）＋ 最佳參數的樣本外驗證。

import { runBacktest } from './engine.js';
import { computeMetrics, barReturns, moments, OBJECTIVES } from './metrics.js';
import { deflatedSharpe, pboCSCV } from './stats.js';

/** 跑單一參數組合，回傳指標與每根報酬 */
export function evaluate(bars, strategy, params, settings, start, end, barsPerYear) {
  const { signal } = strategy.compute(bars, params);
  const res = runBacktest(bars, signal, settings, start, end);
  const metrics = computeMetrics({
    equity: res.equity, trades: res.trades, offset: start, inPosition: res.inPosition,
    base: settings.initialCapital, barsPerYear,
  });
  const returns = barReturns(res.equity, 0, res.equity.length - 1, settings.initialCapital);
  return { res, metrics, returns };
}

/**
 * @param {object} o
 * @param {object} o.bars, o.strategy, o.settings
 * @param {number} o.start, o.isEnd, o.end   樣本內 [start, isEnd]，樣本外 (isEnd, end]
 * @param {object[]} o.combos                參數組合
 * @param {string} o.objective               OBJECTIVES 的 key
 * @param {number} o.barsPerYear
 * @param {number} [o.blocks=16]             CSCV 段數
 * @param {(p:number)=>void} [o.onProgress]
 */
export function optimize(o) {
  const { bars, strategy, settings, start, isEnd, end, combos, barsPerYear } = o;
  const S = o.blocks ?? 16;
  const objFn = OBJECTIVES[o.objective]?.fn ?? OBJECTIVES.sharpe.fn;
  const n = isEnd - start + 1;
  const blockLen = Math.floor(n / S);
  if (blockLen < 5) throw new Error('樣本內資料太短，無法切成 16 段做 PBO，請放寬區間或改用較短週期');

  const rows = [];
  const blocks = [];
  combos.forEach((params, idx) => {
    const { metrics, returns } = evaluate(bars, strategy, params, settings, start, isEnd, barsPerYear);
    const mom = moments(returns);
    const b = { sum: new Float64Array(S), sq: new Float64Array(S), cnt: new Float64Array(S) };
    for (let k = 0; k < returns.length; k++) {
      const j = Math.min(Math.floor(k / blockLen), S - 1);
      b.sum[j] += returns[k]; b.sq[j] += returns[k] * returns[k]; b.cnt[j]++;
    }
    blocks.push(b);
    rows.push({
      params,
      score: objFn(metrics),
      sr: mom.std > 0 ? mom.mean / mom.std : 0,
      skew: mom.skew,
      kurt: mom.kurt,
      metrics: pick(metrics),
    });
    if (o.onProgress && idx % 5 === 0) o.onProgress((idx + 1) / combos.length * 0.85);
  });

  let bestIdx = 0;
  rows.forEach((r, i) => { if (r.score > rows[bestIdx].score) bestIdx = i; });
  const best = rows[bestIdx];

  const dsr = deflatedSharpe(best.sr, rows.map((r) => r.sr), n, best.skew, best.kurt);
  o.onProgress?.(0.9);
  const pbo = pboCSCV(blocks, S);
  o.onProgress?.(0.98);

  let oos = null;
  if (end > isEnd + 10) {
    const { metrics } = evaluate(bars, strategy, best.params, settings, isEnd + 1, end, barsPerYear);
    oos = pick(metrics);
  }

  const ranked = rows.map((r, i) => ({ ...r, i })).sort((a, b) => b.score - a.score);
  return {
    best: { params: best.params, score: best.score, metrics: best.metrics },
    oos,
    top: ranked.slice(0, 20).map(({ params, score, metrics }) => ({ params, score, metrics })),
    combos: rows.length,
    dsr: { ...dsr, srAnnual: best.sr * Math.sqrt(barsPerYear), sr0Annual: dsr.sr0 * Math.sqrt(barsPerYear) },
    pbo: pbo && { pbo: pbo.pbo, splits: pbo.splits, lambdas: pbo.lambdas, avgDegradation: pbo.avgDegradation * Math.sqrt(barsPerYear) },
    blocks: S,
  };
}

/** 只保留需要傳回主執行緒的指標欄位 */
export function pick(m) {
  return {
    totalReturn: m.totalReturn, cagr: m.cagr, maxDD: m.maxDD, sharpe: m.sharpe,
    sortino: m.sortino, calmar: m.calmar, trades: m.trades, winRate: m.winRate,
    profitFactor: m.profitFactor, exposure: m.exposure,
  };
}
