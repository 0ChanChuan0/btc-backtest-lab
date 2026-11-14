// 資料載入、解碼與週期合成。主執行緒與 Worker 共用，不可碰 DOM。

export const TIMEFRAMES = {
  '1h': { label: '1 小時', seconds: 3600, barsPerYear: 24 * 365 },
  '4h': { label: '4 小時', seconds: 4 * 3600, barsPerYear: 6 * 365 },
  '1d': { label: '1 日', seconds: 86400, barsPerYear: 365 },
};

/** 讀取 data/meta.json 與二進位檔，回傳 1h bars。baseUrl 為網站根目錄的 URL。 */
export async function loadBaseBars(baseUrl) {
  const metaRes = await fetch(new URL('data/meta.json', baseUrl));
  if (!metaRes.ok) throw new Error(`讀取 meta.json 失敗（${metaRes.status}）`);
  const meta = await metaRes.json();
  const binRes = await fetch(new URL(meta.file, baseUrl));
  if (!binRes.ok) throw new Error(`讀取 ${meta.file} 失敗（${binRes.status}）`);
  const buf = await binRes.arrayBuffer();
  return { meta, bars: decodeBars(buf, meta.count) };
}

/** 解碼 build_data.py 產生的欄位式二進位：u32 time + f32 × 5。 */
export function decodeBars(buf, count) {
  if (buf.byteLength !== count * 4 * 6) throw new Error('資料檔大小與 meta.count 不符');
  const time = new Float64Array(new Uint32Array(buf, 0, count));
  const col = (k, digits) => {
    const src = new Float32Array(buf, count * 4 * (k + 1), count);
    const out = new Float64Array(count);
    const m = 10 ** digits;
    for (let i = 0; i < count; i++) out[i] = Math.round(src[i] * m) / m;
    return out;
  };
  // Binance BTCUSDT 價格為小數 2 位；Float32 誤差 < 0.004，四捨五入可還原原值
  return {
    time,
    open: col(0, 2),
    high: col(1, 2),
    low: col(2, 2),
    close: col(3, 2),
    volume: col(4, 4),
    length: count,
  };
}

/** 依 UTC 對齊把 bars 合成成較長週期（例如 1h → 4h、1d）。 */
export function resample(bars, seconds) {
  const n = bars.length;
  const time = [], open = [], high = [], low = [], close = [], volume = [];
  let bucket = -1;
  for (let i = 0; i < n; i++) {
    const b = Math.floor(bars.time[i] / seconds) * seconds;
    if (b !== bucket) {
      bucket = b;
      time.push(b);
      open.push(bars.open[i]);
      high.push(bars.high[i]);
      low.push(bars.low[i]);
      close.push(bars.close[i]);
      volume.push(bars.volume[i]);
    } else {
      const k = time.length - 1;
      if (bars.high[i] > high[k]) high[k] = bars.high[i];
      if (bars.low[i] < low[k]) low[k] = bars.low[i];
      close[k] = bars.close[i];
      volume[k] += bars.volume[i];
    }
  }
  return {
    time: Float64Array.from(time),
    open: Float64Array.from(open),
    high: Float64Array.from(high),
    low: Float64Array.from(low),
    close: Float64Array.from(close),
    volume: Float64Array.from(volume),
    length: time.length,
  };
}

/** 由 1h 基礎資料建立所有週期。 */
export function buildDatasets(base) {
  const out = {};
  for (const [tf, def] of Object.entries(TIMEFRAMES)) {
    out[tf] = def.seconds === 3600 ? base : resample(base, def.seconds);
  }
  return out;
}

/**
 * 推算一根 K 棒的秒數（取前 20 個間隔的最小值，避開交易所停機缺口）。
 * 策略若以「天數」定義參數，用它換算成根數，讓參數在 1h / 4h / 1d 意義一致。
 */
export function barSeconds(bars) {
  let s = Infinity;
  for (let i = 1; i < Math.min(bars.length, 21); i++) s = Math.min(s, bars.time[i] - bars.time[i - 1]);
  return Number.isFinite(s) && s > 0 ? s : 3600;
}

/** 天數 → 根數（至少 1 根） */
export function daysToBars(bars, days) {
  return Math.max(1, Math.round((days * 86400) / barSeconds(bars)));
}

/** 第一個 time >= t 的索引（找不到回傳 length）。 */
export function lowerBound(time, t) {
  let lo = 0, hi = time.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (time[mid] < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * 把日期區間（UTC 秒）與樣本外比例轉成索引。
 * 回傳 { start, end, isEnd }：樣本內為 [start, isEnd]，樣本外為 [isEnd+1, end]。
 */
export function resolveRange(bars, fromSec, toSec, oosPct = 0) {
  const start = Math.max(0, lowerBound(bars.time, fromSec ?? -Infinity));
  const end = Math.min(bars.length - 1, lowerBound(bars.time, (toSec ?? Infinity) + 1) - 1);
  if (end - start < 50) throw new Error('回測區間太短（少於 50 根 K 棒），請放寬日期');
  const n = end - start + 1;
  const oosBars = Math.floor(n * Math.min(Math.max(oosPct, 0), 0.9));
  return { start, end, isEnd: end - oosBars };
}
