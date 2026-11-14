// 輕量 canvas 統計圖：蒙地卡羅扇形圖、直方圖。會跟著容器大小自動重畫。

import { COLORS } from '../core/palette.js';

const FONT = "11px 'JetBrains Mono', ui-monospace, monospace";

function setup(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = FONT;
  return { ctx, w, h };
}

/** 讓 draw 在容器尺寸變動時重畫 */
export function autoDraw(canvas, draw) {
  draw();
  if (canvas._ro) canvas._ro.disconnect();
  let pending = 0;
  canvas._ro = new ResizeObserver(() => { cancelAnimationFrame(pending); pending = requestAnimationFrame(draw); });
  canvas._ro.observe(canvas);
}

const pctLabel = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0)}%`;

function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-12; v += step) out.push(Number(v.toFixed(12)));
  return out;
}

/**
 * 扇形圖：x 為進度（0~1），y 為權益倍數（對數座標）。
 * @param {object} mc monteCarlo() 的結果
 */
export function drawFan(canvas, mc) {
  const { ctx, w, h } = setup(canvas);
  const pad = { l: 56, r: 14, t: 12, b: 26 };
  const all = [...mc.bands.p5, ...mc.bands.p95, ...mc.actual, 1].map((v) => Math.max(v, 1e-3));
  const lo = Math.log(Math.min(...all)), hi = Math.log(Math.max(...all));
  const X = (x) => pad.l + x * (w - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (Math.log(Math.max(v, 1e-3)) - lo) / (hi - lo || 1)) * (h - pad.t - pad.b);

  // 格線（以報酬率標示）
  ctx.fillStyle = COLORS.muted; ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const ticks = niceTicks(lo, hi, 5).map(Math.exp);
  for (const t of ticks) {
    const y = Y(t);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillText(pctLabel(t - 1), pad.l - 6, y);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(pad.l, Y(1)); ctx.lineTo(w - pad.r, Y(1)); ctx.stroke(); ctx.setLineDash([]);

  const band = (a, b, color) => {
    ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(X(0), Y(1));
    mc.x.forEach((x, i) => ctx.lineTo(X(x), Y(b[i])));
    for (let i = mc.x.length - 1; i >= 0; i--) ctx.lineTo(X(mc.x[i]), Y(a[i]));
    ctx.lineTo(X(0), Y(1));
    ctx.fill();
  };
  band(mc.bands.p5, mc.bands.p95, 'rgba(165,148,255,0.16)');
  band(mc.bands.p25, mc.bands.p75, 'rgba(165,148,255,0.28)');

  const line = (vals, color, width, dash = []) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.beginPath();
    ctx.moveTo(X(0), Y(1));
    mc.x.forEach((x, i) => ctx.lineTo(X(x), Y(vals[i])));
    ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
  };
  line(mc.bands.p50, COLORS.accent, 1.6, [5, 4]);
  line(mc.actual, COLORS.cyan, 2);

  ctx.fillStyle = COLORS.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const unit = mc.method === 'trades' ? '筆交易' : '根 K 棒';
  for (const f of [0, 0.25, 0.5, 0.75, 1]) ctx.fillText(`${Math.round(f * mc.length)}`, X(f), h - pad.b + 8);
  ctx.textAlign = 'right'; ctx.fillText(unit, w - pad.r, h - pad.b + 8 - 14);
}

/**
 * 直方圖
 * @param {object} hist   histogram() 結果
 * @param {object} opt    { color, marks: [{value, label, color}], format }
 */
export function drawHistogram(canvas, hist, opt = {}) {
  const { ctx, w, h } = setup(canvas);
  const marks = (opt.marks ?? []).filter((m) => Number.isFinite(m.value));
  const pad = { l: 12, r: 12, t: 10 + 14 * marks.length, b: 26 };
  const fmt = opt.format ?? pctLabel;
  const maxC = Math.max(...hist.counts, 1);
  const X = (v) => pad.l + ((v - hist.min) / (hist.max - hist.min)) * (w - pad.l - pad.r);
  const bw = (w - pad.l - pad.r) / hist.counts.length;
  hist.counts.forEach((c, i) => {
    const x = pad.l + i * bw;
    const bh = (c / maxC) * (h - pad.t - pad.b);
    ctx.fillStyle = typeof opt.color === 'function' ? opt.color(hist.min + (i + 0.5) * hist.width) : opt.color ?? COLORS.accent;
    ctx.globalAlpha = 0.75;
    ctx.fillRect(x + 1, h - pad.b - bh, Math.max(bw - 2, 1), bh);
  });
  ctx.globalAlpha = 1;

  ctx.fillStyle = COLORS.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(fmt(hist.min), pad.l + 24, h - pad.b + 8);
  ctx.fillText(fmt(hist.max), w - pad.r - 24, h - pad.b + 8);

  marks.forEach((m, k) => {
    const x = Math.min(Math.max(X(m.value), pad.l), w - pad.r);
    const ty = 4 + k * 14;
    ctx.strokeStyle = m.color ?? COLORS.cyan; ctx.lineWidth = 1.5; ctx.setLineDash(m.dashed ? [4, 3] : []);
    ctx.beginPath(); ctx.moveTo(x, ty + 12); ctx.lineTo(x, h - pad.b); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = m.color ?? COLORS.cyan; ctx.textBaseline = 'top';
    ctx.textAlign = x > w * 0.6 ? 'right' : 'left';
    ctx.fillText(`${m.label} ${fmt(m.value)}`, x + (ctx.textAlign === 'left' ? 4 : -4), ty);
  });
}
