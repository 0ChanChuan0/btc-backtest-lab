// 全站共用：注入頁首 / 頁尾、啟動星空背景。每個頁面都要 import 這個檔案。
// 新增頁面時：在 NAV 加一筆，並在 HTML 放 <header data-site-header> 與 <footer data-site-footer>。

import { createStarfield } from './ui/starfield.js';

export const SITE = {
  name: 'BTC 回測實驗室',
  nameEn: 'BTC BACKTEST LAB',
  repo: 'https://github.com/0ChanChuan0/btc-backtest-lab',
  model: 'Claude Opus 5.5（claude-opus-5-5）× Claude Code',
};

export const NAV = [
  { href: 'index.html', label: '首頁' },
  { href: 'backtest.html', label: '回測台' },
  { href: 'guide.html', label: '方法說明' },
];

const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true">
  <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a594ff"/><stop offset="1" stop-color="#5ad8ff"/></linearGradient></defs>
  <circle cx="16" cy="16" r="14" fill="none" stroke="url(#lg)" stroke-width="1.5" opacity=".6"/>
  <path d="M16 4.5l2.4 7.1 7.1 2.4-7.1 2.4L16 23.5l-2.4-7.1L6.5 14l7.1-2.4z" fill="url(#lg)"/>
  <circle cx="24.5" cy="23.5" r="1.6" fill="#5ad8ff"/>
</svg>`;

const STAR_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>`;

const STORAGE_KEY = 'btc-lab:starfield';

function readPref() {
  try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { return true; }
}
function writePref(on) {
  try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch { /* 無痕模式可能無法寫入 */ }
}

function renderHeader(el) {
  const here = location.pathname.split('/').pop() || 'index.html';
  el.className = 'site-header';
  el.innerHTML = `
    <div class="container">
      <a class="brand" href="index.html">${LOGO}<span>${SITE.name}<br><small>${SITE.nameEn}</small></span></a>
      <nav class="nav" aria-label="主選單">
        ${NAV.map((n) => `<a href="${n.href}"${n.href === here ? ' aria-current="page"' : ''}>${n.label}</a>`).join('')}
      </nav>
      <button class="icon-btn" type="button" data-star-toggle aria-pressed="true" title="星空動畫開關">${STAR_ICON}<span class="sr-only">星空動畫</span></button>
    </div>`;
}

function renderFooter(el) {
  el.className = 'site-footer';
  el.innerHTML = `
    <div class="container">
      <div><strong>${SITE.name}</strong> · 資料：Binance BTC/USDT 1 小時 K 線 · 僅供教育與研究，不構成任何投資建議</div>
      <div>AI 開發：${SITE.model} · <a href="${SITE.repo}" target="_blank" rel="noopener">GitHub</a></div>
    </div>`;
}

export function initSite() {
  document.querySelectorAll('[data-site-header]').forEach(renderHeader);
  document.querySelectorAll('[data-site-footer]').forEach(renderFooter);

  let canvas = document.getElementById('starfield');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'starfield';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);
  }
  let sky;
  try {
    sky = createStarfield(canvas);
  } catch (err) {
    console.warn('星空背景停用：', err);
    return; // 背景失敗不影響頁面其他功能
  }
  const on = readPref();
  sky.setEnabled(on);
  document.querySelectorAll('[data-star-toggle]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(on && !sky.reduced));
    btn.addEventListener('click', () => {
      const next = !sky.enabled;
      sky.setEnabled(next);
      writePref(next);
      btn.setAttribute('aria-pressed', String(next));
    });
  });
}

initSite();
