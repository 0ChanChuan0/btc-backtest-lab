// 策略：MACD
import { macd } from '../core/indicators.js';
import { COLORS, SERIES } from '../core/palette.js';

export default {
  id: 'macd',
  name: 'MACD',
  nameEn: 'Moving Average Convergence Divergence',
  category: '趨勢跟隨',
  tags: ['動能', 'EMA', '零軸過濾'],
  summary: 'MACD 快線在訊號線之上做多、之下做空，可加零軸過濾只順著大趨勢交易。',
  description: [
    'MACD 線是快、慢兩條 EMA 的差，反映價格動能；訊號線是 MACD 線再做一次 EMA。MACD 線穿越訊號線代表動能轉強或轉弱，柱狀體（兩者的差）則顯示動能的大小。',
    '開啟「零軸過濾」時，只在 MACD 線位於零軸上方時做多、下方時做空，等於加上一層長期趨勢確認，能減少逆勢的假訊號，但也會錯過部分轉折初期的行情。',
  ],
  rules: {
    long: '收盤時 MACD 線 > 訊號線（零軸過濾：且 MACD 線 > 0）→ 下一根開盤做多',
    short: '收盤時 MACD 線 < 訊號線（零軸過濾：且 MACD 線 < 0）→ 下一根開盤做空',
    exit: '條件不再成立時平倉（零軸過濾下可能先轉空手）；或觸發共用風控設定',
  },
  params: [
    { key: 'fast', label: '快線 EMA', short: '快', type: 'int', default: 12, min: 6, max: 30, step: 2 },
    { key: 'slow', label: '慢線 EMA', short: '慢', type: 'int', default: 26, min: 16, max: 60, step: 4 },
    { key: 'signal', label: '訊號線 EMA', short: '訊', type: 'int', default: 9, min: 3, max: 18, step: 3 },
    {
      key: 'zeroFilter', label: '零軸過濾', short: '零軸', type: 'select', default: 'off',
      options: [{ value: 'off', label: '關閉' }, { value: 'on', label: '開啟' }],
    },
  ],
  validate: (p) => p.fast < p.slow,

  compute(bars, p) {
    const { macd: line, signal: sig, hist } = macd(bars.close, p.fast, p.slow, p.signal);
    const filter = p.zeroFilter === 'on';
    const signal = new Int8Array(bars.length);
    for (let i = 0; i < bars.length; i++) {
      if (Number.isNaN(sig[i])) continue;
      if (line[i] > sig[i] && (!filter || line[i] > 0)) signal[i] = 1;
      else if (line[i] < sig[i] && (!filter || line[i] < 0)) signal[i] = -1;
    }
    return {
      signal,
      overlays: [],
      panels: [
        {
          name: `MACD (${p.fast}, ${p.slow}, ${p.signal})`,
          series: [
            { name: '柱狀體', type: 'histogram', values: hist, colors: { up: COLORS.up, down: COLORS.down } },
            { name: 'MACD', type: 'line', color: SERIES[0], values: line },
            { name: '訊號線', type: 'line', color: SERIES[1], values: sig },
          ],
        },
      ],
    };
  },
};
