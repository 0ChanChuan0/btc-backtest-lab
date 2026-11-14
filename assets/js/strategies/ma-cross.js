// 策略：均線交叉
import { ma } from '../core/indicators.js';
import { SERIES } from '../core/palette.js';

export default {
  id: 'ma-cross',
  name: '均線交叉',
  nameEn: 'Moving Average Crossover',
  category: '趨勢跟隨',
  tags: ['SMA', 'EMA', '入門'],
  summary: '短均線在長均線之上做多、之下做空，最經典的趨勢跟隨策略。',
  description: [
    '均線把雜亂的價格平滑成趨勢線。短均線反應快、長均線反應慢，當短均線由下往上穿越長均線（黃金交叉），代表近期價格強於長期平均，趨勢可能轉多；反之由上往下穿越（死亡交叉）則可能轉空。',
    '優點是規則簡單、在大趨勢中能抱住大段行情；缺點是在盤整區會反覆被雙巴（假訊號），而且均線本身有落後性，進出場總是慢一步。',
  ],
  rules: {
    long: '收盤時短均線 > 長均線 → 下一根開盤做多',
    short: '收盤時短均線 < 長均線 → 下一根開盤做空（只做多時改為空手）',
    exit: '方向相反時平倉並反手；或觸發共用風控設定',
  },
  params: [
    { key: 'fast', label: '短均線週期', short: '短', type: 'int', default: 20, min: 5, max: 60, step: 5 },
    { key: 'slow', label: '長均線週期', short: '長', type: 'int', default: 60, min: 20, max: 200, step: 10 },
    {
      key: 'maType', label: '均線類型', short: '', type: 'select', default: 'ema',
      options: [{ value: 'sma', label: 'SMA' }, { value: 'ema', label: 'EMA' }],
    },
  ],
  validate: (p) => p.fast < p.slow,

  compute(bars, p) {
    const fast = ma(bars.close, p.fast, p.maType);
    const slow = ma(bars.close, p.slow, p.maType);
    const signal = new Int8Array(bars.length);
    for (let i = 0; i < bars.length; i++) {
      if (Number.isNaN(fast[i]) || Number.isNaN(slow[i])) continue;
      signal[i] = fast[i] > slow[i] ? 1 : fast[i] < slow[i] ? -1 : 0;
    }
    const tag = p.maType.toUpperCase();
    return {
      signal,
      overlays: [
        { name: `${tag} ${p.fast}`, color: SERIES[0], values: fast },
        { name: `${tag} ${p.slow}`, color: SERIES[1], values: slow },
      ],
      panels: [],
    };
  },
};
