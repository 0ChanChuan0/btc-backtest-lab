// 策略：Connors RSI(2) 均值回歸
import { rsi, sma } from '../core/indicators.js';
import { COLORS, SERIES } from '../core/palette.js';

export default {
  id: 'rsi2',
  name: 'Connors RSI(2)',
  nameEn: 'Connors RSI(2) Mean Reversion',
  category: '均值回歸',
  tags: ['RSI', '短線', '順勢回檔'],
  summary: '長期趨勢向上時，等 2 期 RSI 極度超賣才進場，反彈站回短均線就出場——順大勢、逆小勢。',
  description: [
    'Larry Connors 在《Short Term Trading Strategies That Work》中推廣的經典短線策略：只在價格位於 200 期均線之上（長期多頭）時做多，並等待 2 期 RSI 跌到極低值——代表短期跌過頭——再進場，價格一站回 5 期均線就獲利了結。做空則完全相反。',
    '與趨勢策略相反，它的勝率通常很高、持有時間很短，但單筆虧損可能比獲利大，遇到趨勢真正反轉時會「接刀子」。原版用於日線，用在 1h / 4h 時均線週期代表的時間會變短。建議與其他趨勢策略一起放進比較清單觀察差異。',
  ],
  rules: {
    long: '收盤 > 趨勢均線 且 RSI < 超賣值 → 下一根開盤做多',
    short: '收盤 < 趨勢均線 且 RSI > 100 − 超賣值 → 下一根開盤做空（只做多時改為空手）',
    exit: '多單收盤站上出場均線、空單收盤跌破出場均線時平倉；或觸發共用風控',
  },
  params: [
    { key: 'rsiPeriod', label: 'RSI 週期', short: 'RSI', type: 'int', default: 2, min: 2, max: 4, step: 1 },
    { key: 'oversold', label: '超賣值', short: '超賣', type: 'int', default: 10, min: 2, max: 30, step: 4 },
    { key: 'trendMa', label: '趨勢均線', short: '趨勢', type: 'int', default: 200, min: 100, max: 300, step: 50 },
    { key: 'exitMa', label: '出場均線', short: '出場', type: 'int', default: 5, min: 3, max: 11, step: 2 },
  ],

  compute(bars, p) {
    const { close } = bars;
    const r = rsi(close, p.rsiPeriod);
    const trend = sma(close, p.trendMa);
    const exit = sma(close, p.exitMa);
    const ob = 100 - p.oversold;
    const signal = new Int8Array(bars.length);
    let state = 0;
    for (let i = 0; i < bars.length; i++) {
      if (Number.isNaN(r[i]) || Number.isNaN(trend[i]) || Number.isNaN(exit[i])) continue;
      if (state === 1 && close[i] > exit[i]) state = 0;
      else if (state === -1 && close[i] < exit[i]) state = 0;
      if (state === 0) {
        if (close[i] > trend[i] && r[i] < p.oversold) state = 1;
        else if (close[i] < trend[i] && r[i] > ob) state = -1;
      }
      signal[i] = state;
    }
    const lo = new Float64Array(bars.length).fill(p.oversold);
    const hi = new Float64Array(bars.length).fill(ob);
    return {
      signal,
      overlays: [
        { name: `趨勢 SMA ${p.trendMa}`, color: SERIES[1], values: trend },
        { name: `出場 SMA ${p.exitMa}`, color: SERIES[0], values: exit },
      ],
      panels: [
        {
          name: `RSI (${p.rsiPeriod})`,
          series: [
            { name: `RSI ${p.rsiPeriod}`, type: 'line', color: SERIES[2], values: r },
            { name: '超賣', type: 'line', color: COLORS.up, values: lo },
            { name: '超買', type: 'line', color: COLORS.down, values: hi },
          ],
        },
      ],
    };
  },
};
