// 蒙地卡羅模擬：用重抽樣產生大量「可能的另一種歷史」，看績效的分布而不是單一數字。
//   trades：交易報酬「有放回重抽」→ 交易順序與組成都會變，反映運氣成分
//   blocks：每根報酬切成固定長度的區塊重抽（block bootstrap），保留行情的連續性

import { barReturns } from './metrics.js';
import { rng, quantileSorted, histogram } from './stats.js';

export const MC_METHODS = {
  trades: '交易重抽',
  blocks: '區塊抽樣',
};

/**
 * @param {object} o
 * @param {'trades'|'blocks'} o.method
 * @param {object[]} o.trades        回測交易（需有 ret 欄位）
 * @param {Float64Array} o.equity    回測資金曲線
 * @param {number} o.initialCapital
 * @param {number} [o.iterations=1000]
 * @param {number} [o.blockSize=168] 區塊長度（根）
 * @param {number} [o.seed=42]
 * @param {number} [o.points=120]    輸出曲線的取樣點數
 */
export function monteCarlo(o) {
  const iterations = o.iterations ?? 1000;
  const points = o.points ?? 120;
  const rand = rng(o.seed ?? 42);

  let src;
  if (o.method === 'trades') {
    src = Float64Array.from(o.trades.map((t) => t.ret));
    if (src.length < 10) throw new Error('交易次數少於 10 筆，交易重抽沒有意義；請改用區塊抽樣或放寬區間');
  } else {
    src = barReturns(o.equity, 0, o.equity.length - 1, o.initialCapital);
  }
  const L = src.length;
  const block = o.method === 'blocks' ? Math.max(1, Math.min(o.blockSize ?? 168, L)) : 1;
  const idx = Array.from({ length: Math.min(points, L) }, (_, k) => Math.round(((k + 1) / Math.min(points, L)) * L) - 1);

  const samples = idx.map(() => new Float64Array(iterations));
  const finals = new Float64Array(iterations);
  const dds = new Float64Array(iterations);

  for (let it = 0; it < iterations; it++) {
    let v = 1, peak = 1, mdd = 0, p = 0, k = 0;
    while (k < L) {
      const s = block === 1 ? Math.floor(rand() * L) : Math.floor(rand() * (L - block + 1));
      for (let j = 0; j < block && k < L; j++, k++) {
        v *= 1 + src[s + j];
        if (v > peak) peak = v; else if (1 - v / peak > mdd) mdd = 1 - v / peak;
        if (k === idx[p]) samples[p++][it] = v;
      }
    }
    finals[it] = v - 1;
    dds[it] = mdd;
    if (o.onProgress && it % 50 === 0) o.onProgress(it / iterations);
  }

  // 實際路徑
  const actual = [];
  let v = 1, peak = 1, actualDD = 0, p = 0;
  for (let k = 0; k < L; k++) {
    v *= 1 + src[k];
    if (v > peak) peak = v; else actualDD = Math.max(actualDD, 1 - v / peak);
    if (k === idx[p]) { actual.push(v); p++; }
  }

  const band = (q) => samples.map((col) => quantileSorted(col.slice().sort(), q));
  const sf = finals.slice().sort();
  const sd = dds.slice().sort();

  return {
    method: o.method,
    iterations,
    length: L,
    x: idx.map((i) => (i + 1) / L),
    bands: { p5: band(0.05), p25: band(0.25), p50: band(0.5), p75: band(0.75), p95: band(0.95) },
    actual,
    final: { p5: quantileSorted(sf, 0.05), p50: quantileSorted(sf, 0.5), p95: quantileSorted(sf, 0.95), actual: v - 1 },
    probLoss: sf.filter((x) => x < 0).length / iterations,
    maxDD: { p50: quantileSorted(sd, 0.5), p95: quantileSorted(sd, 0.95), actual: actualDD },
    // 報酬右尾很長，直方圖改用對數報酬 ln(1 + r)；畫圖時再換回百分比
    histFinalLog: histogram(Array.from(finals, (v) => Math.log(Math.max(1 + v, 1e-3))), 40),
    histDD: histogram(dds, 40),
  };
}
