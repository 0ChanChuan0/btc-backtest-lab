// 技術指標函式庫。全部是純函式：輸入 Float64Array，輸出同長度 Float64Array，暖機期為 NaN。
// 規則：第 i 個值只能使用 src[0..i]，不得讀取未來資料。新增指標請寫在這裡並補上測試。

const nanArray = (n) => new Float64Array(n).fill(NaN);

function firstValid(src) {
  for (let i = 0; i < src.length; i++) if (!Number.isNaN(src[i])) return i;
  return src.length;
}

/** 簡單移動平均 */
export function sma(src, period) {
  const n = src.length, out = nanArray(n);
  const s = firstValid(src);
  let sum = 0;
  for (let i = s; i < n; i++) {
    sum += src[i];
    if (i - s >= period) sum -= src[i - period];
    if (i - s >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** 指數移動平均（以前 period 根的 SMA 作為起點） */
export function ema(src, period) {
  const n = src.length, out = nanArray(n);
  const s = firstValid(src);
  if (s + period > n) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = s; i < s + period; i++) prev += src[i];
  prev /= period;
  out[s + period - 1] = prev;
  for (let i = s + period; i < n; i++) {
    prev = src[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** 依類型選均線：'sma' | 'ema' */
export function ma(src, period, type = 'sma') {
  return type === 'ema' ? ema(src, period) : sma(src, period);
}

/** 滾動標準差（母體） */
export function stdev(src, period) {
  const n = src.length, out = nanArray(n);
  const s = firstValid(src);
  let sum = 0, sq = 0;
  for (let i = s; i < n; i++) {
    sum += src[i]; sq += src[i] * src[i];
    if (i - s >= period) { sum -= src[i - period]; sq -= src[i - period] ** 2; }
    if (i - s >= period - 1) {
      const m = sum / period;
      out[i] = Math.sqrt(Math.max(sq / period - m * m, 0));
    }
  }
  return out;
}

/** MACD：回傳 { macd, signal, hist } */
export function macd(src, fast = 12, slow = 26, signalPeriod = 9) {
  const f = ema(src, fast), s = ema(src, slow);
  const line = new Float64Array(src.length);
  for (let i = 0; i < src.length; i++) line[i] = f[i] - s[i];
  const sig = ema(line, signalPeriod);
  const hist = new Float64Array(src.length);
  for (let i = 0; i < src.length; i++) hist[i] = line[i] - sig[i];
  return { macd: line, signal: sig, hist };
}

/** RSI（Wilder 平滑） */
export function rsi(src, period = 14) {
  const n = src.length, out = nanArray(n);
  if (n <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = src[i] - src[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < n; i++) {
    const d = src[i] - src[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/** 布林通道：回傳 { mid, upper, lower } */
export function bollinger(src, period = 20, mult = 2) {
  const mid = sma(src, period), sd = stdev(src, period);
  const upper = new Float64Array(src.length), lower = new Float64Array(src.length);
  for (let i = 0; i < src.length; i++) {
    upper[i] = mid[i] + mult * sd[i];
    lower[i] = mid[i] - mult * sd[i];
  }
  return { mid, upper, lower };
}

/** ATR（Wilder 平滑） */
export function atr(bars, period = 14) {
  const n = bars.length, tr = new Float64Array(n);
  tr[0] = bars.high[0] - bars.low[0];
  for (let i = 1; i < n; i++) {
    const pc = bars.close[i - 1];
    tr[i] = Math.max(bars.high[i] - bars.low[i], Math.abs(bars.high[i] - pc), Math.abs(bars.low[i] - pc));
  }
  const out = nanArray(n);
  if (n < period) return out;
  let prev = 0;
  for (let i = 0; i < period; i++) prev += tr[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < n; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** 滾動極值（單調佇列，O(n)）。better(a, b) 為 true 代表 a 比 b 更極端 */
function rollingExtreme(src, period, better) {
  const n = src.length, out = nanArray(n);
  const q = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) {
    while (tail > head && !better(src[q[tail - 1]], src[i])) tail--;
    q[tail++] = i;
    if (q[head] <= i - period) head++;
    if (i >= period - 1) out[i] = src[q[head]];
  }
  return out;
}

/** 過去 period 根（含當根）的最高值 */
export function highest(src, period) {
  return rollingExtreme(src, period, (a, b) => a > b);
}

/** 過去 period 根（含當根）的最低值 */
export function lowest(src, period) {
  return rollingExtreme(src, period, (a, b) => a < b);
}

/** 變動率：src[i] / src[i - period] − 1 */
export function roc(src, period) {
  const n = src.length, out = nanArray(n);
  for (let i = period; i < n; i++) out[i] = src[i - period] > 0 ? src[i] / src[i - period] - 1 : NaN;
  return out;
}

/**
 * SuperTrend：以 (高+低)/2 ± 倍數 × ATR 形成上下軌，收盤突破另一側時翻轉方向。
 * 回傳 { line, dir }：dir 為 1（多）/ -1（空），line 為目前方向的追蹤停損線。
 */
export function supertrend(bars, period = 10, mult = 3) {
  const n = bars.length;
  const a = atr(bars, period);
  const line = nanArray(n), dir = new Int8Array(n);
  let up = NaN, dn = NaN, d = 1;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(a[i])) continue;
    const mid = (bars.high[i] + bars.low[i]) / 2;
    const basicUp = mid + mult * a[i], basicDn = mid - mult * a[i];
    if (Number.isNaN(up)) {
      up = basicUp; dn = basicDn; d = bars.close[i] >= mid ? 1 : -1;
    } else {
      const pc = bars.close[i - 1];
      up = basicUp < up || pc > up ? basicUp : up;
      dn = basicDn > dn || pc < dn ? basicDn : dn;
      if (d === 1 && bars.close[i] < dn) d = -1;
      else if (d === -1 && bars.close[i] > up) d = 1;
    }
    dir[i] = d;
    line[i] = d === 1 ? dn : up;
  }
  return { line, dir };
}
