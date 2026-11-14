// 策略：時間序列動量（TSMOM）
import { roc } from '../core/indicators.js';
import { daysToBars } from '../core/data.js';
import { COLORS, SERIES } from '../core/palette.js';

export default {
  id: 'tsmom',
  name: '時間序列動量',
  nameEn: 'Time-Series Momentum (TSMOM)',
  category: '動能',
  tags: ['學術', '極簡', '以天數設定'],
  summary: '過去 N 天漲就做多、跌就做空。出自 2012 年學術論文，規則極簡，是檢驗其他策略的好基準。',
  description: [
    'Moskowitz、Ooi 與 Pedersen 在 2012 年的論文〈Time Series Momentum〉中發現：在股票、債券、商品、外匯等 58 種期貨上，「過去一段時間的報酬方向」對未來報酬有顯著的延續性。策略只看一個數字——過去 N 天的漲跌幅。',
    '回看期間以「天」設定，在 1h、4h、1d 週期下代表相同的時間長度。可設定門檻：漲跌幅絕對值低於門檻時空手，以減少在零附近來回翻轉。若更複雜的策略連 TSMOM 都贏不了，就要懷疑那些複雜度是否只是過擬合。',
  ],
  rules: {
    long: '收盤時過去 N 天報酬 > 門檻 → 下一根開盤做多',
    short: '收盤時過去 N 天報酬 < −門檻 → 下一根開盤做空（只做多時改為空手）',
    exit: '報酬回到 ±門檻之間時空手；方向相反時反手；或觸發共用風控',
  },
  params: [
    { key: 'days', label: '回看天數', short: '天', type: 'int', default: 90, min: 10, max: 360, step: 10 },
    { key: 'threshold', label: '門檻 %', short: '門檻', type: 'float', default: 0, min: 0, max: 20, step: 4 },
  ],

  compute(bars, p) {
    const lookback = daysToBars(bars, p.days);
    const mom = roc(bars.close, lookback);
    const th = p.threshold / 100;
    const signal = new Int8Array(bars.length);
    const pctLine = new Float64Array(bars.length);
    for (let i = 0; i < bars.length; i++) {
      pctLine[i] = mom[i] * 100;
      if (Number.isNaN(mom[i])) continue;
      signal[i] = mom[i] > th ? 1 : mom[i] < -th ? -1 : 0;
    }
    const upper = new Float64Array(bars.length).fill(p.threshold);
    const lower = new Float64Array(bars.length).fill(-p.threshold);
    return {
      signal,
      overlays: [],
      panels: [
        {
          name: `${p.days} 天報酬 %`,
          series: [
            { name: `${p.days} 天報酬 %`, type: 'histogram', values: pctLine, colors: { up: COLORS.up, down: COLORS.down } },
            { name: '門檻', type: 'line', color: SERIES[1], values: upper },
            { name: '−門檻', type: 'line', color: SERIES[1], values: lower },
          ],
        },
      ],
    };
  },
};
