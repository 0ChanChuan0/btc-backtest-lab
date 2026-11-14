// 策略參數工具：預設值、清理輸入、產生最佳化網格。

/** 取得策略的預設參數 */
export function defaultParams(strategy) {
  return Object.fromEntries(strategy.params.map((p) => [p.key, p.default]));
}

/** 把使用者輸入（可能是字串）轉成合法參數；超出範圍時夾回 [min, max] */
export function sanitizeParams(strategy, raw = {}) {
  const out = {};
  for (const p of strategy.params) {
    let v = raw[p.key] ?? p.default;
    if (p.type === 'select') {
      if (!p.options.some((o) => o.value === v)) v = p.default;
    } else {
      v = Number(v);
      if (!Number.isFinite(v)) v = p.default;
      if (p.type === 'int') v = Math.round(v);
      v = Math.min(Math.max(v, p.min), p.max);
    }
    out[p.key] = v;
  }
  return out;
}

/** 參數組合是否合法（呼叫策略自訂的 validate） */
export function isValid(strategy, params) {
  return typeof strategy.validate === 'function' ? !!strategy.validate(params) : true;
}

/** 單一參數在網格中的取值 */
function axisValues(p, step) {
  if (p.type === 'select') return p.options.map((o) => o.value);
  const vals = [];
  const digits = (String(step).split('.')[1] || '').length;
  for (let v = p.min; v <= p.max + 1e-9; v += step) vals.push(Number(v.toFixed(digits)));
  return vals;
}

/**
 * 產生最佳化網格。
 * @param {object} strategy
 * @param {object} base       未納入最佳化的參數使用此值
 * @param {string[]} keys     要最佳化的參數 key
 * @param {number} maxCombos  上限；超過時自動把組合最多的軸的間距加倍
 * @returns {{combos: object[], steps: object, raw: number}}
 */
export function buildGrid(strategy, base, keys, maxCombos = 400) {
  const defs = strategy.params.filter((p) => keys.includes(p.key));
  const steps = Object.fromEntries(defs.map((p) => [p.key, p.step ?? 1]));
  const enumerate = () => {
    let combos = [{ ...base }];
    for (const p of defs) {
      const vals = axisValues(p, steps[p.key]);
      const next = [];
      for (const c of combos) for (const v of vals) next.push({ ...c, [p.key]: v });
      combos = next;
    }
    return combos.filter((c) => isValid(strategy, c));
  };
  let combos = enumerate();
  const raw = combos.length;
  let guard = 0;
  while (combos.length > maxCombos && guard++ < 20) {
    const numeric = defs.filter((p) => p.type !== 'select');
    if (!numeric.length) break;
    const widest = numeric.reduce((a, p) => (axisValues(p, steps[p.key]).length > axisValues(a, steps[a.key]).length ? p : a));
    steps[widest.key] *= 2;
    combos = enumerate();
  }
  return { combos, steps, raw };
}

/** 參數組合的簡短文字，例如「短 20 / 長 50 / EMA」 */
export function describeParams(strategy, params) {
  return strategy.params
    .map((p) => {
      const v = params[p.key];
      const shown = p.type === 'select' ? p.options.find((o) => o.value === v)?.label ?? v : v;
      return `${p.short ?? p.label} ${shown}`;
    })
    .join(' / ');
}
