// 績效與風險指標。輸入資金曲線（每根 K 棒收盤權益），輸出統一格式的指標物件。

/** 由資金曲線計算每根報酬（第一根相對於 base） */
export function barReturns(equity, from = 0, to = equity.length - 1, base = null) {
  const n = to - from + 1;
  const r = new Float64Array(n);
  let prev = base ?? (from > 0 ? equity[from - 1] : equity[from]);
  for (let k = 0; k < n; k++) {
    const v = equity[from + k];
    r[k] = prev > 0 ? v / prev - 1 : 0;
    prev = v;
  }
  return r;
}

/** 平均、標準差（樣本）、偏態、峰度（非超額） */
export function moments(r) {
  const n = r.length;
  if (n < 2) return { mean: 0, std: 0, skew: 0, kurt: 3 };
  let mean = 0;
  for (let i = 0; i < n; i++) mean += r[i];
  mean /= n;
  let m2 = 0, m3 = 0, m4 = 0;
  for (let i = 0; i < n; i++) {
    const d = r[i] - mean, d2 = d * d;
    m2 += d2; m3 += d2 * d; m4 += d2 * d2;
  }
  const varPop = m2 / n;
  const std = Math.sqrt(m2 / (n - 1));
  const skew = varPop > 0 ? (m3 / n) / varPop ** 1.5 : 0;
  const kurt = varPop > 0 ? (m4 / n) / (varPop * varPop) : 3;
  return { mean, std, skew, kurt };
}

/** 未年化的每根夏普值 */
export function perBarSharpe(r) {
  const { mean, std } = moments(r);
  return std > 0 ? mean / std : 0;
}

/** 最大回撤（比例，正數）與最長回撤期（根數） */
export function maxDrawdown(equity, from = 0, to = equity.length - 1, base = null) {
  let peak = base ?? equity[from];
  let mdd = 0, dur = 0, maxDur = 0;
  for (let i = from; i <= to; i++) {
    const v = equity[i];
    if (v >= peak) { peak = v; dur = 0; } else {
      dur++;
      if (dur > maxDur) maxDur = dur;
      const dd = peak > 0 ? 1 - v / peak : 0;
      if (dd > mdd) mdd = dd;
    }
  }
  return { maxDD: mdd, maxDDBars: maxDur };
}

/**
 * 計算指標。
 * @param {object} o
 * @param {Float64Array} o.equity      資金曲線
 * @param {number} [o.from] [o.to]     計算區段（equity 的索引）
 * @param {number} [o.base]            區段起點前的權益（預設為前一根或初始資金）
 * @param {object[]} [o.trades]        交易紀錄（只計 exit 落在區段內的交易，需搭配 o.offset）
 * @param {number} [o.offset]          equity[0] 對應的 bars 索引
 * @param {Uint8Array} [o.inPosition]  每根是否持倉
 * @param {number} o.barsPerYear
 */
export function computeMetrics(o) {
  const { equity, barsPerYear } = o;
  const from = o.from ?? 0;
  const to = o.to ?? equity.length - 1;
  const base = o.base ?? (from > 0 ? equity[from - 1] : equity[0]);
  const n = to - from + 1;

  const r = barReturns(equity, from, to, base);
  const { mean, std } = moments(r);
  let down = 0;
  for (let i = 0; i < r.length; i++) if (r[i] < 0) down += r[i] * r[i];
  const downDev = Math.sqrt(down / Math.max(r.length - 1, 1));

  const totalReturn = base > 0 ? equity[to] / base - 1 : 0;
  const years = n / barsPerYear;
  const cagr = equity[to] > 0 && years > 0 ? (equity[to] / base) ** (1 / years) - 1 : -1;
  const { maxDD, maxDDBars } = maxDrawdown(equity, from, to, base);
  const ann = Math.sqrt(barsPerYear);

  const out = {
    totalReturn,
    cagr,
    maxDD,
    maxDDDays: (maxDDBars / barsPerYear) * 365,
    sharpe: std > 0 ? (mean / std) * ann : 0,
    sortino: downDev > 0 ? (mean / downDev) * ann : 0,
    calmar: maxDD > 0 ? cagr / maxDD : 0,
    volatility: std * ann,
    bars: n,
    finalEquity: equity[to],
  };

  if (o.inPosition) {
    let c = 0;
    for (let i = from; i <= to; i++) c += o.inPosition[i];
    out.exposure = c / n;
  }

  if (o.trades) {
    const off = o.offset ?? 0;
    const ts = o.trades.filter((t) => t.exitIdx - off >= from && t.exitIdx - off <= to);
    const wins = ts.filter((t) => t.pnl > 0);
    const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
    const grossLoss = ts.filter((t) => t.pnl <= 0).reduce((a, t) => a - t.pnl, 0);
    out.trades = ts.length;
    out.winRate = ts.length ? wins.length / ts.length : 0;
    out.profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
    out.avgTradeRet = ts.length ? ts.reduce((a, t) => a + t.ret, 0) / ts.length : 0;
    out.avgBars = ts.length ? ts.reduce((a, t) => a + t.bars, 0) / ts.length : 0;
    out.fees = ts.reduce((a, t) => a + t.fees, 0);
  }
  return out;
}

/** 最佳化目標函數 */
export const OBJECTIVES = {
  sharpe: { label: '夏普值', fn: (m) => m.sharpe },
  return: { label: '總報酬', fn: (m) => m.totalReturn },
  calmar: { label: '報酬 / 最大回撤', fn: (m) => (m.maxDD > 0 ? m.totalReturn / m.maxDD : m.totalReturn > 0 ? m.totalReturn * 100 : m.totalReturn) },
};
