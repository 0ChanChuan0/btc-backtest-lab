// 首頁：策略卡片由策略登記表自動產生
import { STRATEGIES } from '../strategies/index.js';
import { SITE } from '../site.js';
import * as F from '../ui/format.js';

const $ = (s) => document.querySelector(s);

function renderCards() {
  const cards = STRATEGIES.map((s) => `
    <a class="card glass" href="backtest.html?s=${encodeURIComponent(s.id)}">
      <div class="card-head"><span class="card-orb" aria-hidden="true"></span>
        <div><h3>${F.escapeHtml(s.name)}</h3><div class="en">${F.escapeHtml(s.nameEn ?? '')}</div></div></div>
      <p>${F.escapeHtml(s.summary)}</p>
      <div class="tags"><span class="chip accent">${F.escapeHtml(s.category)}</span>${(s.tags ?? []).map((t) => `<span class="chip">${F.escapeHtml(t)}</span>`).join('')}</div>
      <span class="go">開始回測 →</span>
    </a>`);
  cards.push(`
    <a class="card glass add" href="${SITE.repo}/blob/main/CLAUDE.md#6-新增策略" target="_blank" rel="noopener">
      <span class="plus">＋</span><strong>下一顆星</strong><p>依照專案規則新增你的策略</p>
    </a>`);
  $('#strategy-cards').innerHTML = cards.join('');
}

async function renderStats() {
  $('#stat-strategies').textContent = STRATEGIES.length;
  try {
    const meta = await fetch('data/meta.json').then((r) => r.json());
    $('#stat-bars').textContent = F.int(meta.count);
    $('#stat-range').textContent = `${new Date(meta.start * 1000).getUTCFullYear()}–${new Date(meta.end * 1000).getUTCFullYear()}`;
  } catch { /* 統計數字非必要 */ }
}

$('#rules-link').href = `${SITE.repo}/blob/main/CLAUDE.md`;
renderCards();
renderStats();
