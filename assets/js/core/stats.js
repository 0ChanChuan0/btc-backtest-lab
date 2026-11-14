// 統計工具與過擬合校正指標：常態分配、緊縮夏普值（DSR）、回測過擬合機率（PBO / CSCV）。
// 參考：Bailey & López de Prado (2014) "The Deflated Sharpe Ratio"；
//       Bailey, Borwein, López de Prado & Zhu (2016) "The Probability of Backtest Overfitting"。

const EULER_GAMMA = 0.5772156649015329;

/** 標準常態 CDF（Abramowitz–Stegun 7.1.26，誤差 < 1.5e-7） */
export function normCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

/** 標準常態反函數（Acklam 演算法，相對誤差 < 1.2e-9） */
export function normInv(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** 機率夏普值 PSR：真實夏普 > benchmark 的機率（全部使用未年化的每根夏普值） */
export function probabilisticSharpe(sr, benchmark, T, skew, kurt) {
  const denom = 1 - skew * sr + ((kurt - 1) / 4) * sr * sr;
  if (T < 2 || denom <= 0) return NaN;
  return normCdf(((sr - benchmark) * Math.sqrt(T - 1)) / Math.sqrt(denom));
}

/** 在 N 次獨立嘗試、夏普值變異數為 variance 時，純運氣下「最佳夏普值」的期望值 */
export function expectedMaxSharpe(variance, N) {
  if (N < 2 || variance <= 0) return 0;
  return Math.sqrt(variance) * ((1 - EULER_GAMMA) * normInv(1 - 1 / N) + EULER_GAMMA * normInv(1 - 1 / (N * Math.E)));
}

/**
 * 緊縮夏普值 DSR。
 * @param {number} sr        選出策略的每根夏普值
 * @param {number[]} trialSR 所有嘗試過的參數組合的每根夏普值
 * @param {number} T         報酬筆數
 * @param {number} skew      報酬偏態
 * @param {number} kurt      報酬峰度（非超額）
 */
export function deflatedSharpe(sr, trialSR, T, skew, kurt) {
  const N = trialSR.length;
  const mean = trialSR.reduce((a, v) => a + v, 0) / N;
  const variance = N > 1 ? trialSR.reduce((a, v) => a + (v - mean) ** 2, 0) / (N - 1) : 0;
  const sr0 = expectedMaxSharpe(variance, N);
  return {
    dsr: probabilisticSharpe(sr, sr0, T, skew, kurt),
    psr: probabilisticSharpe(sr, 0, T, skew, kurt),
    sr0,
    trials: N,
  };
}

/**
 * 回測過擬合機率 PBO（組合對稱交叉驗證 CSCV）。
 * 把樣本切成 S 段，所有「取一半當樣本內、另一半當樣本外」的組合中，
 * 樣本內最佳的參數在樣本外排名落在後半段的比例即為 PBO。
 * @param {{sum: Float64Array, sq: Float64Array, cnt: Float64Array}[]} blocks 每個參數組合的分段報酬統計
 * @param {number} S 段數（偶數）
 */
export function pboCSCV(blocks, S) {
  const N = blocks.length;
  if (N < 2) return null;
  const half = S / 2;
  const total = blocks.map((b) => {
    let s = 0, q = 0, c = 0;
    for (let k = 0; k < S; k++) { s += b.sum[k]; q += b.sq[k]; c += b.cnt[k]; }
    return { s, q, c };
  });
  const sharpe = (s, q, c) => {
    if (c < 2) return 0;
    const m = s / c;
    const v = (q - c * m * m) / (c - 1);
    return v > 0 ? m / Math.sqrt(v) : 0;
  };
  const lambdas = [];
  const isSR = new Float64Array(N), oosSR = new Float64Array(N);
  let degradeSum = 0;
  for (let mask = 0; mask < 1 << S; mask++) {
    if (popcount(mask) !== half) continue;
    let best = 0;
    for (let j = 0; j < N; j++) {
      let s = 0, q = 0, c = 0;
      const b = blocks[j];
      for (let k = 0; k < S; k++) if (mask & (1 << k)) { s += b.sum[k]; q += b.sq[k]; c += b.cnt[k]; }
      isSR[j] = sharpe(s, q, c);
      oosSR[j] = sharpe(total[j].s - s, total[j].q - q, total[j].c - c);
      if (isSR[j] > isSR[best]) best = j;
    }
    let below = 0;
    for (let j = 0; j < N; j++) if (oosSR[j] < oosSR[best]) below++;
    const omega = (below + 1) / (N + 1);
    lambdas.push(Math.log(omega / (1 - omega)));
    degradeSum += isSR[best] - oosSR[best];
  }
  const pbo = lambdas.filter((l) => l <= 0).length / lambdas.length;
  return { pbo, lambdas, splits: lambdas.length, avgDegradation: degradeSum / lambdas.length };
}

function popcount(x) {
  let c = 0;
  while (x) { x &= x - 1; c++; }
  return c;
}

/** 可重現的亂數（mulberry32） */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 已排序陣列的百分位數（線性內插） */
export function quantileSorted(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** 直方圖 */
export function histogram(values, bins = 30) {
  let min = Infinity, max = -Infinity;
  for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
  if (min === max) { min -= 0.5; max += 0.5; }
  const width = (max - min) / bins;
  const counts = new Array(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - min) / width))]++;
  return { min, max, width, counts };
}
