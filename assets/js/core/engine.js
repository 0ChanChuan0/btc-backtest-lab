// 回測引擎：把策略訊號轉成交易與資金曲線。
//
// 成交假設（改動前請先更新 CLAUDE.md 與 guide.html）：
//   1. 訊號在第 i 根 K 棒「收盤」產生，於第 i+1 根「開盤」成交 → 不偷看未來。
//   2. 訊號值：1 = 做多、-1 = 做空、0 = 空手；依 settings.direction 過濾。
//   3. 每次進場投入「當下權益 × positionPct」作為保證金，名目部位 = 保證金 × 槓桿。
//   4. 停損 / 移動停損 / 強制平倉在盤中以高低價判斷；同一根同時碰到停損與停利時，保守地視為先停損。
//      跳空越過停損價時以開盤價成交。
//   5. 風控出場後，必須等訊號先變成別的方向，才會再次朝同方向進場。
//   6. 回測區間最後一根收盤強制平倉（reason = 'end'）。

export const DEFAULT_SETTINGS = Object.freeze({
  initialCapital: 10000, // USDT
  positionPct: 100,      // 每筆投入權益百分比
  leverage: 1,           // 槓桿倍數
  feePct: 0.1,           // 單邊手續費 %
  slippagePct: 0.05,     // 單邊滑價 %
  direction: 'both',     // 'long' | 'short' | 'both'
  stopLossPct: 0,        // 0 = 關閉
  takeProfitPct: 0,
  trailingPct: 0,
});

export const EXIT_REASONS = {
  signal: '訊號',
  stop: '停損',
  take: '停利',
  trail: '移動停損',
  liq: '強制平倉',
  end: '區間結束',
};

/** 依交易方向設定過濾訊號 */
function filterDir(sig, direction) {
  if (sig > 0) return direction === 'short' ? 0 : 1;
  if (sig < 0) return direction === 'long' ? 0 : -1;
  return 0;
}

/**
 * 執行回測。
 * @param {object} bars     K 線（time/open/high/low/close）
 * @param {Int8Array} signal 與 bars 同長度的目標方向
 * @param {object} settings 交易設定（見 DEFAULT_SETTINGS）
 * @param {number} start    區間起點索引（含）
 * @param {number} end      區間終點索引（含）
 * @returns {{equity: Float64Array, inPosition: Uint8Array, trades: object[], finalEquity: number, busted: boolean}}
 */
export function runBacktest(bars, signal, settings, start, end) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const fee = s.feePct / 100;
  const slip = s.slippagePct / 100;
  const pct = Math.min(Math.max(s.positionPct, 0), 100) / 100;
  const lev = Math.max(s.leverage, 1);
  const sl = s.stopLossPct / 100, tp = s.takeProfitPct / 100, tr = s.trailingPct / 100;
  const { open, high, low, close, time } = bars;

  const n = end - start + 1;
  const equity = new Float64Array(n);
  const inPosition = new Uint8Array(n);
  const trades = [];

  let cash = s.initialCapital;
  let pos = 0, qty = 0, entry = 0, entryIdx = -1, entryFee = 0, equityAtEntry = 0;
  let stopPx = NaN, takePx = NaN, trailPx = NaN, liqPx = NaN, extreme = 0;
  let blocked = 0;
  let busted = false;
  // 區間第一根開盤依前一根收盤的訊號行動（讓策略狀態延續，不因切段而延遲進場）
  let pending = start > 0 ? signal[start - 1] : 0;

  function openPos(i, price, dir) {
    const fill = price * (1 + dir * slip);
    const margin = cash * pct;
    if (margin <= 0) return;
    const notional = margin * lev;
    pos = dir;
    qty = notional / fill;
    entry = fill;
    entryIdx = i;
    entryFee = notional * fee;
    equityAtEntry = cash;
    cash -= entryFee;
    extreme = fill;
    stopPx = sl > 0 ? fill * (1 - dir * sl) : NaN;
    takePx = tp > 0 ? fill * (1 + dir * tp) : NaN;
    trailPx = tr > 0 ? fill * (1 - dir * tr) : NaN;
    liqPx = lev > 1 || dir < 0 ? fill * (1 - dir / lev) : NaN;
  }

  function closePos(i, price, reason) {
    const fill = reason === 'liq' ? price : price * (1 - pos * slip);
    const gross = pos * qty * (fill - entry);
    const exitFee = qty * fill * fee;
    cash += gross - exitFee;
    const net = gross - exitFee - entryFee;
    trades.push({
      dir: pos,
      entryIdx, exitIdx: i,
      entryTime: time[entryIdx], exitTime: time[i],
      entryPrice: entry, exitPrice: fill,
      qty,
      pnl: net,
      ret: net / equityAtEntry,
      fees: entryFee + exitFee,
      bars: i - entryIdx,
      reason,
    });
    pos = 0; qty = 0;
    if (cash <= s.initialCapital * 1e-6) { cash = Math.max(cash, 0); busted = true; }
  }

  for (let i = start; i <= end; i++) {
    // 1) 開盤：執行上一根收盤的訊號
    let desired = busted ? 0 : filterDir(pending, s.direction);
    if (blocked !== 0 && desired === blocked) desired = 0;
    if (desired !== pos) {
      if (pos !== 0) closePos(i, open[i], 'signal');
      if (desired !== 0 && !busted) openPos(i, open[i], desired);
    }

    // 2) 盤中：風控出場（先檢查往不利方向的價位）
    if (pos !== 0) {
      let level = NaN, reason = '';
      if (pos > 0) {
        for (const [px, r] of [[liqPx, 'liq'], [stopPx, 'stop'], [trailPx, 'trail']]) {
          if (px > 0 && low[i] <= px && !(level >= px)) { level = px; reason = r; }
        }
        if (reason) {
          const fillAt = reason === 'liq' ? level : Math.min(open[i], level);
          blocked = pos; closePos(i, fillAt, reason);
        } else if (takePx > 0 && high[i] >= takePx) {
          blocked = pos; closePos(i, Math.max(open[i], takePx), 'take');
        }
      } else {
        for (const [px, r] of [[liqPx, 'liq'], [stopPx, 'stop'], [trailPx, 'trail']]) {
          if (px > 0 && high[i] >= px && !(level <= px)) { level = px; reason = r; }
        }
        if (reason) {
          const fillAt = reason === 'liq' ? level : Math.max(open[i], level);
          blocked = pos; closePos(i, fillAt, reason);
        } else if (takePx > 0 && low[i] <= takePx) {
          blocked = pos; closePos(i, Math.min(open[i], takePx), 'take');
        }
      }
      // 移動停損以本根極值更新（下一根才生效）
      if (pos !== 0 && tr > 0) {
        if (pos > 0 && high[i] > extreme) { extreme = high[i]; trailPx = extreme * (1 - tr); }
        if (pos < 0 && low[i] < extreme) { extreme = low[i]; trailPx = extreme * (1 + tr); }
      }
    }

    // 3) 收盤：最後一根強制平倉，其餘依收盤價計算權益
    if (i === end && pos !== 0) closePos(i, close[i], 'end');
    const k = i - start;
    equity[k] = pos !== 0 ? cash + pos * qty * (close[i] - entry) : cash;
    inPosition[k] = pos !== 0 ? 1 : 0;

    // 4) 收盤：讀取本根訊號，留待下一根開盤執行
    pending = signal[i];
    if (blocked !== 0 && pending !== blocked) blocked = 0;
  }

  return { equity, inPosition, trades, finalEquity: equity[n - 1], busted };
}

/** 買進持有：第一根開盤買入（扣一次手續費與滑價），持有到最後。 */
export function buyAndHold(bars, settings, start, end) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const fill = bars.open[start] * (1 + s.slippagePct / 100);
  const units = (s.initialCapital * (1 - s.feePct / 100)) / fill;
  const equity = new Float64Array(end - start + 1);
  for (let i = start; i <= end; i++) equity[i - start] = units * bars.close[i];
  return equity;
}
