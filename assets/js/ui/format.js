// 數字與日期格式化（統一使用 UTC 日期，與資料一致）

export function pct(v, digits = 1, sign = true) {
  if (v == null || !Number.isFinite(v)) return v === Infinity ? '∞' : '—';
  const s = (v * 100).toFixed(digits);
  return `${sign && v > 0 ? '+' : ''}${s}%`;
}

export function num(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function int(v) {
  return v == null || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString('en-US');
}

export function money(v) {
  return v == null || !Number.isFinite(v) ? '—' : `${v < 0 ? '−' : ''}$${num(Math.abs(v), 0)}`;
}

export function date(sec) {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

export function dateTime(sec) {
  return new Date(sec * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

/** 正負號對應的 CSS class */
export function tone(v) {
  return v > 0 ? 'pos' : v < 0 ? 'neg' : '';
}

/** 'YYYY-MM-DD' → UTC 秒 */
export function parseDate(str, endOfDay = false) {
  if (!str) return null;
  const t = Date.parse(`${str}T00:00:00Z`) / 1000;
  return Number.isFinite(t) ? t + (endOfDay ? 86399 : 0) : null;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
