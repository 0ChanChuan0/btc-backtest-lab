// 策略：SuperTrend
import { supertrend } from '../core/indicators.js';
import { COLORS } from '../core/palette.js';

export default {
  id: 'supertrend',
  name: 'SuperTrend',
  nameEn: 'SuperTrend (ATR Trailing)',
  category: '趨勢跟隨',
  tags: ['ATR', '追蹤停損', '熱門'],
  summary: '以 ATR 畫出跟著價格移動的停損線，收盤穿越這條線就翻轉多空，訊號乾淨、交易少。',
  description: [
    'SuperTrend 以 K 棒中點加減「倍數 × ATR」形成上下軌。多頭時只顯示下軌，下軌只升不降，像一條自動上移的追蹤停損；收盤跌破就翻空，改顯示只降不升的上軌。它是 TradingView 上加密貨幣交易者最常用的指標之一。',
    'ATR 讓通道寬度隨波動自動調整：行情劇烈時線拉得較遠，不容易被洗出場；平靜時貼得較近，能及早反應。倍數越大訊號越少、抱單越久，但反轉時回吐也越多。',
  ],
  rules: {
    long: '收盤站上 SuperTrend 上軌（翻多）→ 下一根開盤做多',
    short: '收盤跌破 SuperTrend 下軌（翻空）→ 下一根開盤做空（只做多時改為空手）',
    exit: '方向翻轉時平倉並反手；或觸發共用風控',
  },
  params: [
    { key: 'period', label: 'ATR 週期', short: 'ATR', type: 'int', default: 10, min: 5, max: 30, step: 5 },
    { key: 'mult', label: 'ATR 倍數', short: '倍數', type: 'float', default: 3, min: 1, max: 5, step: 0.5 },
  ],

  compute(bars, p) {
    const { line, dir } = supertrend(bars, p.period, p.mult);
    const n = bars.length;
    const signal = new Int8Array(n);
    const upLine = new Float64Array(n).fill(NaN), dnLine = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(line[i])) continue;
      signal[i] = dir[i];
      if (dir[i] > 0) upLine[i] = line[i]; else dnLine[i] = line[i];
    }
    return {
      signal,
      overlays: [
        { name: '多方支撐線', color: COLORS.up, values: upLine },
        { name: '空方壓力線', color: COLORS.down, values: dnLine },
      ],
      panels: [],
    };
  },
};
