// 策略：海龜交易法（唐奇安通道突破）
import { highest, lowest } from '../core/indicators.js';
import { SERIES } from '../core/palette.js';

export default {
  id: 'donchian',
  name: '海龜交易法',
  nameEn: 'Turtle Trading · Donchian Breakout',
  category: '突破',
  tags: ['唐奇安通道', '經典', '趨勢'],
  summary: '收盤突破過去 N 根最高價做多、跌破最低價做空，反向突破較短的 M 根通道時出場。',
  description: [
    '1983 年，交易員 Richard Dennis 與 William Eckhardt 打賭「交易能不能教」，招募一群新手並傳授一套完全機械化的規則，這群學員被稱為「海龜」。核心就是唐奇安通道突破：價格創 N 根新高代表趨勢啟動就跟進，並用較短的 M 根通道作為出場線。',
    '突破策略勝率通常不高（常見 30–40%），靠少數抓到大行情的交易賺回多次小虧損，非常考驗紀律。BTC 動輒數倍的大趨勢很適合這類策略，但在長時間盤整時會連續假突破。',
  ],
  rules: {
    long: '收盤價 > 前 N 根最高價 → 下一根開盤做多',
    short: '收盤價 < 前 N 根最低價 → 下一根開盤做空（只做多時改為空手）',
    exit: '多單收盤跌破前 M 根最低價、空單收盤突破前 M 根最高價時平倉；或觸發共用風控',
  },
  params: [
    { key: 'entry', label: '進場通道 N', short: 'N', type: 'int', default: 20, min: 10, max: 120, step: 10 },
    { key: 'exit', label: '出場通道 M', short: 'M', type: 'int', default: 10, min: 5, max: 60, step: 5 },
  ],
  validate: (p) => p.exit < p.entry,

  compute(bars, p) {
    const { high, low, close } = bars;
    const n = bars.length;
    const hiN = highest(high, p.entry), loN = lowest(low, p.entry);
    const hiM = highest(high, p.exit), loM = lowest(low, p.exit);
    const signal = new Int8Array(n);
    // 通道使用「前一根為止」的極值，避免把當根高低價算進突破門檻
    const upper = new Float64Array(n).fill(NaN), lower = new Float64Array(n).fill(NaN);
    let state = 0;
    for (let i = 1; i < n; i++) {
      upper[i] = hiN[i - 1];
      lower[i] = loN[i - 1];
      if (Number.isNaN(upper[i])) continue;
      if (state === 1 && close[i] < loM[i - 1]) state = 0;
      else if (state === -1 && close[i] > hiM[i - 1]) state = 0;
      if (close[i] > upper[i]) state = 1;
      else if (close[i] < lower[i]) state = -1;
      signal[i] = state;
    }
    return {
      signal,
      overlays: [
        { name: `上軌（${p.entry}）`, color: SERIES[0], values: upper },
        { name: `下軌（${p.entry}）`, color: SERIES[1], values: lower },
      ],
      panels: [],
    };
  },
};
