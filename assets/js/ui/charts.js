// TradingView Lightweight Charts（v4.2.0，由 HTML 以 <script> 載入全域 LightweightCharts）的薄封裝。
// 所有圖表的主題設定集中在這裡。

import { COLORS } from '../core/palette.js';

const LWC = () => {
  if (!window.LightweightCharts) throw new Error('圖表函式庫載入失敗，請檢查網路連線');
  return window.LightweightCharts;
};

const fmtTime = (t) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');

export function baseOptions(extra = {}) {
  return {
    autoSize: true,
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: COLORS.muted,
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: 11,
    },
    grid: {
      vertLines: { color: 'rgba(255,255,255,0.035)' },
      horzLines: { color: 'rgba(255,255,255,0.035)' },
    },
    crosshair: {
      mode: 0,
      vertLine: { color: 'rgba(165,148,255,0.5)', labelBackgroundColor: '#3a3470' },
      horzLine: { color: 'rgba(165,148,255,0.5)', labelBackgroundColor: '#3a3470' },
    },
    rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)', minimumWidth: 84 },
    // minBarSpacing 調小，才能把 7 萬多根 K 棒的全期資金曲線放進一個畫面
    timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true, secondsVisible: false, minBarSpacing: 0.001 },
    localization: { locale: 'zh-TW', timeFormatter: fmtTime },
    // 滾輪留給頁面捲動；用拖曳平移、拖曳座標軸或雙指縮放
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
    ...extra,
  };
}

/**
 * 數值陣列 → line series 資料。
 * Lightweight Charts 遇到空值不會斷線，會把前後兩點直接連起來；
 * 因此中途的 NaN 改成「沿用上一個值的透明點」，空值後的第一個點也設為透明，讓線真的斷開。
 * 開頭暖機期的 NaN 仍用空白點（不畫）。
 */
const toLine = (time, values) => {
  const out = new Array(values.length);
  let last = NaN, inGap = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) {
      out[i] = inGap ? { time: time[i], value: v, color: 'transparent' } : { time: time[i], value: v };
      last = v; inGap = false;
    } else if (Number.isFinite(last)) {
      out[i] = { time: time[i], value: last, color: 'transparent' };
      inGap = true;
    } else {
      out[i] = { time: time[i] };
    }
  }
  return out;
};

/** 樣本外區間的背景底色：疊在圖上的半透明 div，隨平移縮放更新位置 */
function addShade(chart, el) {
  const div = document.createElement('div');
  div.className = 'oos-shade';
  div.hidden = true;
  el.appendChild(div);
  let fromIdx = null;
  const update = () => {
    if (fromIdx == null) { div.hidden = true; return; }
    const ts = chart.timeScale();
    const width = ts.width();
    const x = ts.logicalToCoordinate(fromIdx - 0.5);
    if (x == null || x >= width) { div.hidden = true; return; }
    const left = Math.max(0, x);
    div.hidden = false;
    div.style.left = `${left}px`;
    div.style.width = `${width - left}px`;
    div.style.bottom = `${chart.options().timeScale.visible === false ? 0 : 28}px`;
  };
  chart.timeScale().subscribeVisibleLogicalRangeChange(update);
  new ResizeObserver(() => requestAnimationFrame(update)).observe(el);
  return { set(idx) { fromIdx = idx; requestAnimationFrame(update); } };
}

function setShade(shade, time, fromIdx) {
  shade.set(fromIdx != null && fromIdx < time.length ? fromIdx : null);
}

/** K 線圖 + 指標副圖（時間軸同步） */
export function createPriceCharts(mainEl, panelEl) {
  const L = LWC();
  const chart = L.createChart(mainEl, baseOptions());
  const shade = addShade(chart, mainEl);
  const candles = chart.addCandlestickSeries({
    upColor: COLORS.up, downColor: COLORS.down, borderVisible: false,
    wickUpColor: COLORS.up, wickDownColor: COLORS.down,
  });
  // 副圖只跟隨主圖（單向同步，避免兩張圖互相觸發）；副圖本身不接受平移縮放
  const panel = L.createChart(panelEl, baseOptions({
    timeScale: { visible: false, borderColor: 'rgba(255,255,255,0.08)', minBarSpacing: 0.001 },
    handleScroll: false, handleScale: false,
  }));
  let overlaySeries = [], panelSeries = [];
  const follow = () => {
    const range = chart.timeScale().getVisibleLogicalRange();
    if (range && !panelEl.hidden) panel.timeScale().setVisibleLogicalRange(range);
  };
  chart.timeScale().subscribeVisibleLogicalRangeChange(follow);

  return {
    chart, panel,
    /**
     * @param {object} d { time, open, high, low, close, overlays, panels, oosFrom, markers }
     */
    render(d, { keepView = false } = {}) {
      const n = d.time.length;
      const view = keepView ? chart.timeScale().getVisibleLogicalRange() : null;
      const data = new Array(n);
      for (let i = 0; i < n; i++) data[i] = { time: d.time[i], open: d.open[i], high: d.high[i], low: d.low[i], close: d.close[i] };
      candles.setData(data);
      setShade(shade, d.time, d.oosFrom ?? n);

      overlaySeries.forEach((s) => chart.removeSeries(s));
      overlaySeries = d.overlays.map((o) => {
        const s = chart.addLineSeries({ color: o.color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        s.setData(toLine(d.time, o.values));
        return s;
      });

      panelSeries.forEach((s) => panel.removeSeries(s));
      panelSeries = [];
      const hasPanel = d.panels.length > 0;
      panelEl.hidden = !hasPanel;
      if (hasPanel) {
        // 先只支援一個副圖；多個副圖的 series 會疊在同一張圖
        for (const p of d.panels) for (const s of p.series) {
          if (s.type === 'histogram') {
            const h = panel.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
            h.setData(Array.from(s.values, (v, i) => (Number.isFinite(v) ? { time: d.time[i], value: v, color: v >= 0 ? s.colors.up + '99' : s.colors.down + '99' } : { time: d.time[i] })));
            panelSeries.push(h);
          } else {
            const l = panel.addLineSeries({ color: s.color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            l.setData(toLine(d.time, s.values));
            panelSeries.push(l);
          }
        }
      }
      candles.setMarkers(d.markers ?? []);

      const range = view ?? { from: Math.max(0, n - 300), to: n + 5 };
      chart.timeScale().setVisibleLogicalRange(range);
      requestAnimationFrame(() => { chart.timeScale().setVisibleLogicalRange(range); follow(); });
    },
    setMarkers(markers) { candles.setMarkers(markers); },
  };
}

/** 資金曲線圖：可疊多條線，支援對數座標 */
export function createEquityChart(el, { log = true } = {}) {
  const L = LWC();
  const chart = L.createChart(el, baseOptions({ rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)', mode: log ? 1 : 0 } }));
  const shade = addShade(chart, el);
  let lines = [];
  return {
    chart,
    setLog(on) { chart.priceScale('right').applyOptions({ mode: on ? 1 : 0 }); },
    /** @param {{name, color, values, dashed?, width?}[]} series  @param {Float64Array} time */
    render(time, series, oosFrom = null) {
      lines.forEach((s) => chart.removeSeries(s));
      setShade(shade, time, oosFrom ?? time.length);
      lines = series.map((s) => {
        const line = chart.addLineSeries({
          color: s.color, lineWidth: s.width ?? 2, lineStyle: s.dashed ? 2 : 0,
          priceLineVisible: false, lastValueVisible: true, title: s.name,
          priceFormat: { type: 'price', precision: 0, minMove: 1 },
        });
        line.setData(toLine(time, s.values));
        return line;
      });
      chart.timeScale().fitContent();
      requestAnimationFrame(() => chart.timeScale().fitContent());
    },
  };
}
