// 滾動前進分析（Walk-forward）：每段用前 isMonths 個月找最佳參數，再用接下來 oosMonths 個月驗證。

import { runBacktest, buyAndHold } from './engine.js';
import { computeMetrics, OBJECTIVES } from './metrics.js';
import { lowerBound } from './data.js';
import { pick } from './optimize.js';

function addMonths(sec, months) {
  const d = new Date(sec * 1000);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.getTime() / 1000;
}

/** 依時間切出各段索引 */
export function buildSegments(time, start, end, isMonths, oosMonths, mode = 'rolling') {
  const segs = [];
  const t0 = time[start];
  let isStartT = t0;
  let isEndT = addMonths(t0, isMonths);
  while (true) {
    const oosEndT = addMonths(isEndT, oosMonths);
    const isS = Math.max(start, lowerBound(time, isStartT));
    const oosS = lowerBound(time, isEndT);
    if (oosS > end) break;
    const oosE = Math.min(end, lowerBound(time, oosEndT) - 1);
    if (oosE - oosS < 5) break;
    segs.push({ isS, isE: oosS - 1, oosS, oosE });
    if (oosE >= end) break;
    if (mode === 'rolling') isStartT = addMonths(isStartT, oosMonths);
    isEndT = addMonths(isEndT, oosMonths);
  }
  return segs;
}

/**
 * @param {object} o  { bars, strategy, settings, start, end, combos, objective, barsPerYear, isMonths, oosMonths, mode, onProgress }
 */
export function walkForward(o) {
  const { bars, strategy, settings, start, end, combos, barsPerYear } = o;
  const objFn = OBJECTIVES[o.objective]?.fn ?? OBJECTIVES.sharpe.fn;
  const segs = buildSegments(bars.time, start, end, o.isMonths, o.oosMonths, o.mode);
  if (segs.length < 2) throw new Error('區間太短，切不出至少 2 段滾動窗口；請縮短窗口或放寬日期');

  // 外層跑參數組合、內層跑各段：每組參數的訊號只需算一次
  const scores = segs.map(() => new Float64Array(combos.length).fill(-Infinity));
  const isMetrics = segs.map(() => new Array(combos.length));
  combos.forEach((params, ci) => {
    const { signal } = strategy.compute(bars, params);
    segs.forEach((sg, si) => {
      const res = runBacktest(bars, signal, settings, sg.isS, sg.isE);
      const m = computeMetrics({ equity: res.equity, base: settings.initialCapital, trades: res.trades, offset: sg.isS, barsPerYear });
      scores[si][ci] = objFn(m);
      isMetrics[si][ci] = m;
    });
    if (o.onProgress && ci % 3 === 0) o.onProgress((ci + 1) / combos.length * 0.9);
  });

  // 樣本外：每段用該段最佳參數，資金接續上一段
  let capital = settings.initialCapital;
  const time = [], value = [], trades = [];
  const signalCache = new Map();
  const segments = segs.map((sg, si) => {
    let best = 0;
    for (let ci = 1; ci < combos.length; ci++) if (scores[si][ci] > scores[si][best]) best = ci;
    if (!signalCache.has(best)) signalCache.set(best, strategy.compute(bars, combos[best]).signal);
    const res = runBacktest(bars, signalCache.get(best), { ...settings, initialCapital: capital }, sg.oosS, sg.oosE);
    const m = computeMetrics({ equity: res.equity, base: capital, trades: res.trades, offset: sg.oosS, barsPerYear });
    for (let k = 0; k < res.equity.length; k++) { time.push(bars.time[sg.oosS + k]); value.push(res.equity[k]); }
    trades.push(...res.trades);
    capital = res.finalEquity;
    const im = isMetrics[si][best];
    return {
      isFrom: bars.time[sg.isS], isTo: bars.time[sg.isE],
      oosFrom: bars.time[sg.oosS], oosTo: bars.time[sg.oosE],
      params: combos[best],
      isScore: scores[si][best],
      isReturn: im.totalReturn, isCagr: im.cagr, isSharpe: im.sharpe,
      oos: pick(m),
    };
  });
  o.onProgress?.(0.97);

  const s0 = segs[0].oosS, s1 = segs[segs.length - 1].oosE;
  const equity = Float64Array.from(value);
  const stitched = computeMetrics({ equity, base: settings.initialCapital, barsPerYear });
  const wins = trades.filter((t) => t.pnl > 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = trades.filter((t) => t.pnl <= 0).reduce((a, t) => a - t.pnl, 0);
  stitched.trades = trades.length;
  stitched.winRate = trades.length ? wins.length / trades.length : 0;
  stitched.profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;

  const bh = buyAndHold(bars, settings, s0, s1);
  const bhMetrics = computeMetrics({ equity: bh, base: settings.initialCapital, barsPerYear });

  const meanIs = segments.reduce((a, s) => a + s.isCagr, 0) / segments.length;
  const meanOos = segments.reduce((a, s) => a + s.oos.cagr, 0) / segments.length;
  const positive = segments.filter((s) => s.oos.totalReturn > 0).length;

  return {
    segments,
    equity: { time: Float64Array.from(time), value: equity },
    bh: { time: Float64Array.from(time), value: bh },
    stitched: pick(stitched),
    bhMetrics: pick(bhMetrics),
    wfe: meanIs !== 0 ? meanOos / meanIs : 0,
    positiveRatio: positive / segments.length,
    combos: combos.length,
  };
}
