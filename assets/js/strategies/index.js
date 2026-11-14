// 策略登記表：新增策略時，在 strategies/ 建立檔案後於此 import 並加入陣列（順序 = 首頁卡片順序）。
import maCross from './ma-cross.js';
import macd from './macd.js';
import donchian from './donchian.js';
import supertrend from './supertrend.js';
import tsmom from './tsmom.js';
import rsi2 from './rsi2.js';

export const STRATEGIES = [maCross, macd, donchian, supertrend, tsmom, rsi2];

export function getStrategy(id) {
  return STRATEGIES.find((s) => s.id === id) ?? STRATEGIES[0];
}
