// 核心模組測試：node --test（或 npm test）
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sma, ema, macd, rsi, highest, lowest, roc, supertrend } from '../assets/js/core/indicators.js';
import { runBacktest, buyAndHold } from '../assets/js/core/engine.js';
import { computeMetrics, maxDrawdown } from '../assets/js/core/metrics.js';
import { resample, resolveRange, daysToBars } from '../assets/js/core/data.js';
import { buildGrid, sanitizeParams } from '../assets/js/core/params.js';
import { normCdf, normInv, deflatedSharpe, pboCSCV, rng } from '../assets/js/core/stats.js';
import { optimize } from '../assets/js/core/optimize.js';
import { walkForward } from '../assets/js/core/walkforward.js';
import { monteCarlo } from '../assets/js/core/montecarlo.js';
import { STRATEGIES } from '../assets/js/strategies/index.js';

/** 由收盤價序列產生 K 線：開盤 = 前一根收盤，高低為開收極值 */
function makeBars(closes, startTime = 1_600_000_000, step = 3600) {
  const n = closes.length;
  const b = {
    time: new Float64Array(n), open: new Float64Array(n), high: new Float64Array(n),
    low: new Float64Array(n), close: Float64Array.from(closes), volume: new Float64Array(n).fill(1), length: n,
  };
  for (let i = 0; i < n; i++) {
    b.time[i] = startTime + i * step;
    b.open[i] = i ? closes[i - 1] : closes[0];
    b.high[i] = Math.max(b.open[i], closes[i]);
    b.low[i] = Math.min(b.open[i], closes[i]);
  }
  return b;
}

function randomWalk(n, seed = 1, start = 100) {
  const r = rng(seed);
  const out = [start];
  for (let i = 1; i < n; i++) out.push(out[i - 1] * (1 + (r() - 0.5) * 0.04));
  return out;
}

const noCost = { feePct: 0, slippagePct: 0, initialCapital: 1000 };

test('指標：SMA / EMA / MACD / RSI 數值與暖機期', () => {
  const s = sma(Float64Array.from([1, 2, 3, 4, 5]), 3);
  assert.ok(Number.isNaN(s[1]));
  assert.deepEqual([...s.slice(2)], [2, 3, 4]);
  const e = ema(Float64Array.from([1, 2, 3, 4]), 2);
  assert.equal(e[1], 1.5);
  assert.ok(Math.abs(e[2] - (3 * 2 / 3 + 1.5 / 3)) < 1e-12);
  const m = macd(Float64Array.from(randomWalk(200)), 12, 26, 9);
  assert.ok(Number.isNaN(m.signal[32]) && !Number.isNaN(m.signal[33]));
  const up = rsi(Float64Array.from(Array.from({ length: 30 }, (_, i) => i + 1)), 14);
  assert.equal(up[29], 100);
});

test('指標：滾動最高 / 最低（單調佇列）與逐一比對結果相同', () => {
  const src = Float64Array.from(randomWalk(500, 21));
  for (const p of [1, 3, 20, 77]) {
    const hi = highest(src, p), lo = lowest(src, p);
    for (let i = 0; i < src.length; i++) {
      if (i < p - 1) { assert.ok(Number.isNaN(hi[i]) && Number.isNaN(lo[i])); continue; }
      const win = [...src.slice(i - p + 1, i + 1)];
      assert.equal(hi[i], Math.max(...win));
      assert.equal(lo[i], Math.min(...win));
    }
  }
});

test('指標：ROC、SuperTrend 方向、天數換算', () => {
  const r = roc(Float64Array.from([100, 110, 121]), 1);
  assert.ok(Math.abs(r[2] - 0.1) < 1e-12);
  const up = makeBars(Array.from({ length: 60 }, (_, i) => 100 + i * 2));
  const st = supertrend(up, 10, 3);
  assert.equal(st.dir[59], 1);
  assert.ok(st.line[59] < up.close[59]);
  const down = makeBars(Array.from({ length: 60 }, (_, i) => 300 - i * 2));
  assert.equal(supertrend(down, 10, 3).dir[59], -1);
  assert.equal(daysToBars(makeBars([1, 2, 3], 0, 3600), 2), 48);
  assert.equal(daysToBars(makeBars([1, 2, 3], 0, 86400), 2), 2);
});

test('引擎：訊號於下一根開盤成交（無未來函數）', () => {
  const bars = makeBars([100, 100, 110, 120, 130, 130]);
  const signal = Int8Array.from([0, 1, 1, 1, 0, 0]);
  const res = runBacktest(bars, signal, noCost, 0, 5);
  assert.equal(res.trades.length, 1);
  const t = res.trades[0];
  assert.equal(t.entryIdx, 2);            // 第 1 根收盤訊號 → 第 2 根開盤
  assert.equal(t.entryPrice, bars.open[2]);
  assert.equal(t.exitIdx, 5);             // 第 4 根收盤轉 0 → 第 5 根開盤平倉
  assert.equal(t.exitPrice, bars.open[5]);
  assert.ok(Math.abs(res.finalEquity - 1000 * 130 / 100) < 1e-9);
});

test('引擎：手續費與滑價', () => {
  const bars = makeBars([100, 100, 100, 100]);
  const signal = Int8Array.from([1, 1, 0, 0]);
  const res = runBacktest(bars, signal, { initialCapital: 1000, feePct: 0.1, slippagePct: 0 }, 0, 3);
  // 進場收 1 USDT，出場名目約 999 × 0.1%
  assert.ok(Math.abs(res.finalEquity - (1000 - 1 - 1)) < 0.01);
  assert.equal(res.trades[0].fees.toFixed(3), '2.000');
});

test('引擎：只做多時忽略做空訊號，做空時獲利方向正確', () => {
  const bars = makeBars([100, 100, 90, 80, 80]);
  const signal = Int8Array.from([-1, -1, -1, -1, -1]);
  assert.equal(runBacktest(bars, signal, { ...noCost, direction: 'long' }, 0, 4).trades.length, 0);
  const short = runBacktest(bars, signal, noCost, 0, 4);
  assert.ok(short.finalEquity > 1000);
});

test('引擎：停損在停損價出場，之後同方向不立即再進場', () => {
  const closes = [100, 100, 100, 94, 96, 98, 99];
  const bars = makeBars(closes);
  const signal = Int8Array.from([1, 1, 1, 1, 1, 1, 1]);
  const res = runBacktest(bars, signal, { ...noCost, stopLossPct: 5 }, 0, 6);
  assert.equal(res.trades[0].reason, 'stop');
  assert.ok(Math.abs(res.trades[0].exitPrice - 95) < 1e-9);
  assert.equal(res.trades.length, 1);     // 訊號一直是 1，被風控擋住
});

test('引擎：槓桿多單跌破強平價時虧掉整筆保證金', () => {
  const bars = makeBars([100, 100, 100, 60, 60]);   // 3 倍槓桿強平價 = 100 × (1 − 1/3) ≈ 66.67
  const signal = Int8Array.from([1, 1, 1, 1, 1]);
  const res = runBacktest(bars, signal, { ...noCost, leverage: 3, positionPct: 50 }, 0, 4);
  assert.equal(res.trades[0].reason, 'liq');
  assert.ok(Math.abs(res.trades[0].pnl + 500) < 1e-6);
});

test('績效：最大回撤與報酬', () => {
  const eq = Float64Array.from([100, 120, 90, 110, 130]);
  assert.ok(Math.abs(maxDrawdown(eq).maxDD - 0.25) < 1e-12);
  const m = computeMetrics({ equity: eq, base: 100, barsPerYear: 365 });
  assert.ok(Math.abs(m.totalReturn - 0.3) < 1e-12);
  const bh = buyAndHold(makeBars([100, 100, 200]), noCost, 0, 2);
  assert.equal(bh[2], 2000);
});

test('資料：1h 合成 4h 的 OHLCV 正確', () => {
  const bars = makeBars([1, 2, 3, 4, 5, 6, 7, 8], 14400 * 100);
  const r = resample(bars, 14400);
  assert.equal(r.length, 2);
  assert.equal(r.open[0], 1); assert.equal(r.close[0], 4);
  assert.equal(r.high[1], 8); assert.equal(r.low[1], 4);
  assert.equal(r.volume[0], 4);
  const range = resolveRange(makeBars(randomWalk(200)), null, null, 0.2);
  assert.equal(range.end - range.isEnd, 40);
});

test('參數：網格會套用 validate，超過上限時自動放大間距', () => {
  const s = STRATEGIES.find((x) => x.id === 'ma-cross');
  const g = buildGrid(s, sanitizeParams(s), ['fast', 'slow'], 50);
  assert.ok(g.combos.length <= 50 && g.combos.length > 0);
  assert.ok(g.combos.every((c) => c.fast < c.slow));
  assert.equal(sanitizeParams(s, { fast: '999' }).fast, 60);
});

test('統計：常態分配函數互為反函數', () => {
  for (const p of [0.01, 0.2, 0.5, 0.9, 0.999]) assert.ok(Math.abs(normCdf(normInv(p)) - p) < 1e-6);
});

test('統計：嘗試次數越多，DSR 越低', () => {
  const r = rng(7);
  const trials = (n) => Array.from({ length: n }, () => (r() - 0.5) * 0.02);
  const few = deflatedSharpe(0.02, trials(5), 5000, 0, 3);
  const many = deflatedSharpe(0.02, trials(500), 5000, 0, 3);
  assert.ok(many.dsr < few.dsr);
  assert.ok(few.psr > 0.9);
});

test('統計：PBO 介於 0~1，真正有優勢的參數 PBO 低', () => {
  const S = 8, r = rng(3);
  const mk = (edge) => {
    const b = { sum: new Float64Array(S), sq: new Float64Array(S), cnt: new Float64Array(S) };
    for (let k = 0; k < S; k++) for (let j = 0; j < 200; j++) {
      const x = (r() - 0.5) * 0.02 + edge;
      b.sum[k] += x; b.sq[k] += x * x; b.cnt[k]++;
    }
    return b;
  };
  const noise = pboCSCV(Array.from({ length: 20 }, () => mk(0)), S);
  assert.ok(noise.pbo >= 0 && noise.pbo <= 1);
  const edged = pboCSCV([mk(0.003), ...Array.from({ length: 19 }, () => mk(0))], S);
  assert.ok(edged.pbo < 0.1);
});

test('最佳化 / 滾動前進 / 蒙地卡羅可在合成資料上執行', () => {
  const bars = makeBars(randomWalk(24 * 365 * 2, 11), 1_600_000_000);
  const s = STRATEGIES.find((x) => x.id === 'ma-cross');
  const { combos } = buildGrid(s, sanitizeParams(s), ['fast', 'slow'], 30);
  const range = resolveRange(bars, null, null, 0.2);
  const opt = optimize({ bars, strategy: s, settings: noCost, ...range, combos, objective: 'sharpe', barsPerYear: 8760 });
  assert.ok(opt.pbo.pbo >= 0 && opt.pbo.pbo <= 1);
  assert.ok(opt.dsr.dsr >= 0 && opt.dsr.dsr <= 1);
  assert.ok(opt.oos);

  const wf = walkForward({ bars, strategy: s, settings: noCost, start: range.start, end: range.end, combos, objective: 'sharpe', barsPerYear: 8760, isMonths: 6, oosMonths: 3, mode: 'rolling' });
  assert.ok(wf.segments.length >= 4);
  assert.equal(wf.equity.value.length, wf.bh.value.length);

  const sig = s.compute(bars, sanitizeParams(s)).signal;
  const res = runBacktest(bars, sig, noCost, range.start, range.end);
  const mc = monteCarlo({ method: 'blocks', trades: res.trades, equity: res.equity, initialCapital: 1000, iterations: 200, blockSize: 48 });
  assert.ok(mc.bands.p5.every((v, i) => v <= mc.bands.p95[i]));
  assert.ok(Math.abs(mc.final.actual - (res.finalEquity / 1000 - 1)) < 1e-9);
});

// ── 所有策略都必須通過的規格檢查（新增策略後自動套用） ──
for (const s of STRATEGIES) {
  test(`策略規格：${s.id}`, () => {
    for (const k of ['id', 'name', 'category', 'summary', 'description', 'rules', 'params', 'compute']) assert.ok(s[k], `缺少欄位 ${k}`);
    assert.match(s.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, 'id 必須是 kebab-case');
    for (const p of s.params) {
      assert.ok(['int', 'float', 'select'].includes(p.type), `${p.key} type 不合法`);
      if (p.type === 'select') assert.ok(p.options.some((o) => o.value === p.default));
      else assert.ok(p.default >= p.min && p.default <= p.max && p.step > 0, `${p.key} 預設值或範圍錯誤`);
    }
    const bars = makeBars(randomWalk(600, 5));
    const params = sanitizeParams(s);
    const out = s.compute(bars, params);
    assert.equal(out.signal.length, bars.length);
    assert.ok(out.signal.every((v) => v === -1 || v === 0 || v === 1), '訊號只能是 -1 / 0 / 1');
  });

  test(`策略無未來函數：${s.id}`, () => {
    // 只給前 k 根資料算出的訊號，必須與完整資料算出的前 k 根訊號相同
    const full = makeBars(randomWalk(600, 9));
    const params = sanitizeParams(s);
    const all = s.compute(full, params).signal;
    for (const k of [150, 300, 450]) {
      const cut = {
        time: full.time.slice(0, k), open: full.open.slice(0, k), high: full.high.slice(0, k),
        low: full.low.slice(0, k), close: full.close.slice(0, k), volume: full.volume.slice(0, k), length: k,
      };
      const part = s.compute(cut, params).signal;
      assert.deepEqual([...part], [...all.slice(0, k)], `前 ${k} 根訊號受到未來資料影響`);
    }
  });
}
