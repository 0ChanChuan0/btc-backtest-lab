# BTC 回測實驗室 — 專案規則

> 這份文件寫給接手這個專案的 AI（Claude Code、Codex 等）與人類協作者。
> **動手修改前請完整讀過一次。** 本檔與 `AGENTS.md` 內容必須完全相同，修改其中一份後要複製到另一份。

---

## 1. 專案目的

一個**純前端的 BTC/USDT 量化回測網站**，部署在 GitHub Pages。

- 使用者選擇策略、調整參數，立即看到 2017–2026 年 BTC 的回測結果
- 內建四種**防過擬合**工具：樣本內／樣本外切分、滾動前進（Walk-forward）、蒙地卡羅、緊縮夏普值（DSR）與回測過擬合機率（PBO）
- 設計目標是**可持續擴充**：新增一個策略只需要「寫一個檔案 + 登記一行」，介面、參數面板、最佳化網格、測試全部自動套用

網站有三個頁面：

| 頁面 | 檔案 | 用途 |
|---|---|---|
| 首頁 | `index.html` | 介紹、策略卡片（由登記表自動產生）、防過擬合說明 |
| 回測台 | `backtest.html` | 設定 → 回測 → 圖表、指標、比較、防過擬合檢驗、交易紀錄 |
| 方法說明 | `guide.html` | 成交假設、指標定義、各種防過擬合方法的原理 |

---

## 2. 技術原則（不可違反）

1. **純靜態網站**：HTML + CSS + 原生 ES Modules，**沒有建置步驟、沒有框架、沒有 npm 執行期套件**。檔案直接放上 GitHub Pages 就能跑。
2. **外部資源只有兩個**：
   - TradingView Lightweight Charts `4.2.0`（jsDelivr CDN，`<script>` 載入成全域 `LightweightCharts`）
   - Google Fonts：`Noto Sans TC`、`JetBrains Mono`
   新增任何外部依賴前必須先問使用者。
3. **所有計算都在 Web Worker**（`assets/js/worker.js`）執行，主執行緒只負責畫面。不可在主執行緒跑回測迴圈。
4. **`assets/js/core/` 與 `assets/js/strategies/` 不可碰 DOM**，必須能同時在瀏覽器 Worker 與 Node（測試）中執行。
5. **效能優先於花俏**：使用者明確要求「即時、不卡」勝過視覺特效。任何新特效不得讓回測或圖表變慢。
6. **不使用 Go / WASM / 多 Worker 平行**：已評估過，效益只有幾秒，使用者決定不做。除非使用者主動提出，不要再改架構。
7. **介面語言為繁體中文**（台灣用語：回測、權益、回撤、夏普值、手續費）。程式碼識別字用英文，註解用繁體中文。

---

## 3. 目錄結構

```
btc-backtest-lab/
├── index.html / backtest.html / guide.html   頁面（每頁一個 HTML）
├── CLAUDE.md / AGENTS.md                     專案規則（兩份內容相同）
├── README.md                                 專案簡介（給人看）
├── package.json                              只有 scripts，無 dependencies
├── data/
│   ├── btc_usdt_1h.bin                       BTC 1 小時 K 線（二進位，約 1.75 MB）
│   └── meta.json                             筆數、起訖時間、欄位配置
├── scripts/build_data.py                     parquet/csv → data/*.bin 轉檔
├── tests/core.test.js                        node --test 單元測試
└── assets/
    ├── css/
    │   ├── theme.css                         全站主題（CSS 變數 + 共用元件）
    │   └── <page>.css                        各頁專屬樣式：home / backtest / guide
    ├── img/favicon.svg
    └── js/
        ├── site.js                           頁首頁尾、導覽列 NAV、星空啟動（每頁都要載入）
        ├── worker.js                         計算 Worker：backtest / optimize / walkforward / montecarlo
        ├── core/                             純計算模組（不可碰 DOM）
        │   ├── data.js                       載入、解碼、週期合成、日期區間 → 索引
        │   ├── indicators.js                 技術指標（sma/ema/macd/rsi/bollinger/atr/highest/lowest/roc/supertrend）
        │   ├── engine.js                     回測引擎與買進持有
        │   ├── metrics.js                    績效指標、最佳化目標函數 OBJECTIVES
        │   ├── params.js                     參數清理、最佳化網格
        │   ├── optimize.js                   樣本內最佳化 + DSR + PBO + 樣本外驗證
        │   ├── walkforward.js                滾動前進
        │   ├── montecarlo.js                 蒙地卡羅（交易重抽、區塊抽樣）
        │   ├── stats.js                      常態分配、DSR、PBO(CSCV)、亂數、直方圖
        │   └── palette.js                    資料視覺化色票（與 theme.css 一致）
        ├── strategies/
        │   ├── index.js                      ★ 策略登記表
        │   ├── ma-cross.js                   均線交叉（趨勢跟隨）
        │   ├── macd.js                       MACD（趨勢跟隨）
        │   ├── donchian.js                   海龜交易法／唐奇安通道突破（突破）
        │   ├── supertrend.js                 SuperTrend（趨勢跟隨）
        │   ├── tsmom.js                      時間序列動量（動能，參數以天數設定）
        │   └── rsi2.js                       Connors RSI(2)（均值回歸）
        ├── ui/                               畫面元件（可碰 DOM）
        │   ├── charts.js                     Lightweight Charts 封裝（主題、樣本外底色）
        │   ├── plots.js                      canvas 扇形圖、直方圖
        │   ├── starfield.js                  動態星空背景
        │   ├── format.js                     數字／日期格式化
        │   └── worker-client.js              Worker 的 Promise 介面
        └── pages/
            ├── home.js                       首頁邏輯
            └── backtest.js                   回測台邏輯
```

**放置規則**：純計算 → `core/`；策略 → `strategies/`；可重用的畫面元件 → `ui/`；某一頁專屬的邏輯 → `pages/<page>.js`；某一頁專屬的樣式 → `css/<page>.css`。

---

## 4. 資料

- 來源：Binance BTC/USDT 1 小時 K 線，2017-08-17 ～ 2026-05-14，共 76,498 根，有 28 處交易所停機缺口。
- 格式（`scripts/build_data.py` 產生）：欄位式 little-endian 二進位，依序為 `Uint32 time（秒）`、`Float32 open/high/low/close/volume`，每段長度都是 `meta.count`。解碼時價格四捨五入到小數 2 位還原原值。
- **4h、1d 由 1h 以 UTC 對齊合成**（`core/data.js` 的 `resample`），不另存檔案。
- 更新資料：`python scripts/build_data.py <新的 parquet 或 csv>`，會覆寫 `data/btc_usdt_1h.bin` 與 `data/meta.json`。**不要**把原始 parquet 或 1 分鐘資料放進 repo（GitHub 單檔上限 100 MB，瀏覽器也載不動）。
- 時間一律用 **UTC 秒**；畫面上的日期也是 UTC。

---

## 5. 回測引擎契約（`core/engine.js`）

這是整個專案最重要的約定。**修改任何一條，都必須同步更新 `engine.js` 開頭註解、`guide.html` 的「成交假設」與本節，並補測試。**

1. **收盤產生訊號、下一根開盤成交**：策略在第 i 根收盤決定方向，引擎在第 i+1 根開盤執行。策略不需要（也不可以）自己往後位移。
2. 訊號值只有 `1`（做多）、`-1`（做空）、`0`（空手），是「目標方向」而非買賣動作。方向改變時先平倉再反手。
3. `settings.direction`：`long` 把 −1 視為 0；`short` 把 1 視為 0；`both` 不過濾。
4. 部位：保證金 = 當下權益 × `positionPct`%，名目部位 = 保證金 × `leverage`，損益複利。
5. 成本：每次成交扣 `feePct`% 手續費與 `slippagePct`% 滑價（預設 0.1% / 0.05%）。
6. 風控（盤中用高低價判斷）：停損、停利、移動停損、強制平倉（多單跌 1/L、空單漲 1/L）。同一根同時觸及停損與停利時視為**先停損**；跳空越過停損價以開盤價成交。
7. 風控出場後，訊號必須先變成其他值，才會再次朝同方向進場。
8. 區間最後一根收盤強制平倉（`reason: 'end'`）。
9. 區間第一根開盤會依「前一根收盤的訊號」行動（讓切段回測的狀態延續）。

**指標都在完整資料上計算，再對區間回測**，所以切段（樣本外、滾動前進）不會有暖機期問題。

---

## 6. 新增策略

### 6.1 步驟

1. 在 `assets/js/strategies/` 建立 `<id>.js`（檔名 = id，kebab-case，例如 `rsi-reversion.js`）。
2. 依下方範本填寫，指標一律從 `../core/indicators.js` 取用；缺少的指標先加到 `indicators.js`（見第 7 節）。
3. 在 `assets/js/strategies/index.js` 的 `import` 與 `STRATEGIES` 陣列各加一行（陣列順序 = 首頁卡片順序）。
4. 執行 `npm test`，**必須全部通過**（會自動檢查欄位格式與未來函數）。
5. 本機預覽（第 12 節），在回測台用 1h / 4h / 1d 各跑一次，並跑一次「參數最佳化」確認網格大小合理（建議 50～400 組）。

完成以上步驟後，首頁卡片、回測台的策略選單、參數面板、最佳化勾選項、說明卡、URL 分享參數都會自動出現，**不需要改任何 HTML 或頁面 JS**。

### 6.2 範本

```js
// 策略：<中文名稱>
import { rsi } from '../core/indicators.js';
import { SERIES, COLORS } from '../core/palette.js';

export default {
  id: 'rsi-reversion',                 // kebab-case，與檔名相同，全站唯一（不可與 6.4 的現有 id 重複）
  name: 'RSI 均值回歸',                 // 繁體中文名稱
  nameEn: 'RSI Mean Reversion',
  category: '均值回歸',                 // 只能用這些分類：趨勢跟隨、均值回歸、動能、突破、波動度
  tags: ['RSI', '震盪'],                // 2～3 個短標籤
  summary: '一句話說明策略在做什麼（首頁卡片用，40 字內）。',
  description: [                       // 2 段：原理、優缺點與適用行情
    '第一段：原理。',
    '第二段：優點、缺點、在什麼行情容易失效。',
  ],
  rules: {                             // 三條都要寫，寫成「條件 → 動作」
    long: '收盤時 RSI < 下界 → 下一根開盤做多',
    short: '收盤時 RSI > 上界 → 下一根開盤做空（只做多時改為空手）',
    exit: 'RSI 回到中線時平倉；或觸發共用風控設定',
  },
  params: [
    // int / float：default 必須在 [min, max] 內；step 是最佳化網格間距（輸入框可填任意值）
    { key: 'period', label: 'RSI 週期', short: '週期', type: 'int', default: 14, min: 5, max: 30, step: 3 },
    { key: 'lower', label: '超賣下界', short: '下', type: 'int', default: 30, min: 10, max: 40, step: 5 },
    { key: 'upper', label: '超買上界', short: '上', type: 'int', default: 70, min: 60, max: 90, step: 5 },
    // select：default 必須是 options 之一
    // { key: 'mode', label: '模式', short: '', type: 'select', default: 'a', options: [{ value: 'a', label: 'A' }] },
  ],
  validate: (p) => p.lower < p.upper,  // 選填：排除不合理的參數組合

  compute(bars, p) {
    const r = rsi(bars.close, p.period);
    const signal = new Int8Array(bars.length);   // 暖機期保持 0
    let state = 0;
    for (let i = 0; i < bars.length; i++) {
      if (Number.isNaN(r[i])) continue;
      if (r[i] < p.lower) state = 1;
      else if (r[i] > p.upper) state = -1;
      else if ((state === 1 && r[i] >= 50) || (state === -1 && r[i] <= 50)) state = 0;
      signal[i] = state;
    }
    return {
      signal,                                     // 必填：Int8Array，長度 = bars.length，值 ∈ {-1, 0, 1}
      overlays: [],                               // 疊在 K 線上的線：{ name, color, values }
      panels: [{                                  // 副圖：{ name, series: [{ name, type: 'line'|'histogram', color | colors:{up,down}, values }] }
        name: `RSI (${p.period})`,
        series: [{ name: 'RSI', type: 'line', color: SERIES[0], values: r }],
      }],
    };
  },
};
```

### 6.3 策略的硬性規定

- **不可使用未來資料**：第 i 個訊號只能用 `bars.*[0..i]` 計算。測試會把資料截短重算，前段訊號只要不同就失敗。
- `compute` 必須是**純函式**：同樣輸入永遠同樣輸出，不可使用 `Math.random()`、`Date.now()`、全域狀態。
- 不要在策略裡處理手續費、停損、部位大小、做多做空過濾——那是引擎的工作（第 5 節）。
- 顏色只能用 `core/palette.js` 的 `SERIES` / `COLORS`，不要寫死新色碼。
- 參數範圍要讓網格大小落在合理區間；`buildGrid` 超過上限時會自動把組合最多的軸間距加倍。
- 指標值暖機期是 `NaN`，對應訊號保持 `0`。
- 突破類策略的通道要用「**前一根為止**」的極值（`highest(high, N)[i - 1]`），否則當根收盤永遠不可能大於含當根在內的最高價。參考 `donchian.js`。
- 參數單位預設是「根數」。若希望參數在 1h / 4h / 1d 代表相同時間長度，參數以「天」設定，再用 `core/data.js` 的 `daysToBars(bars, days)` 換算，並在 `tags` 標示「以天數設定」。參考 `tsmom.js`。
- 有狀態的進出場（例如「進場條件」與「出場條件」不同）用 `let state` 逐根推進：**先判斷出場、再判斷進場**。參考 `donchian.js`、`rsi2.js`。
- 副圖的水平參考線（例如 RSI 超買超賣、門檻）用填滿常數的 `Float64Array` 當作 line series。

### 6.4 現有策略一覽

| id | 名稱 | 分類 | 參數 | 備註 |
|---|---|---|---|---|
| `ma-cross` | 均線交叉 | 趨勢跟隨 | 短、長均線週期、SMA/EMA | 入門範例 |
| `macd` | MACD | 趨勢跟隨 | 快、慢、訊號線、零軸過濾 | 有副圖範例 |
| `donchian` | 海龜交易法 | 突破 | 進場通道 N、出場通道 M | 有狀態進出場範例 |
| `supertrend` | SuperTrend | 趨勢跟隨 | ATR 週期、倍數（float） | float 參數範例 |
| `tsmom` | 時間序列動量 | 動能 | 回看天數、門檻 % | 以天數設定的範例 |
| `rsi2` | Connors RSI(2) | 均值回歸 | RSI 週期、超賣值、趨勢均線、出場均線 | 4 個參數，網格會自動放大間距 |

新增策略後請把它加進這張表。

---

## 7. 新增指標（`core/indicators.js`）

- 純函式；輸入 `Float64Array`（或 `bars`），輸出**同長度** `Float64Array`，暖機期為 `NaN`。
- 第 i 個值只能用到第 i 根以前（含）的資料。
- 要能處理前段為 `NaN` 的輸入（例如對 MACD 線再做 EMA）。
- 在 `tests/core.test.js` 補至少一個已知數值的測試。

---

## 8. 新增頁面

1. 在根目錄建立 `<name>.html`，複製下方骨架；頁面專屬樣式放 `assets/css/<name>.css`，專屬邏輯放 `assets/js/pages/<name>.js`。
2. 在 `assets/js/site.js` 的 `NAV` 陣列加一筆 `{ href: '<name>.html', label: '中文名稱' }`，所有頁面的導覽列會自動更新。
3. 內容區塊一律用 `.glass.pad` 卡片，標題用 `.section-title`。

```html
<!doctype html>
<html lang="zh-Hant-TW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>頁面名稱 · BTC 回測實驗室</title>
  <meta name="description" content="一句話描述">
  <link rel="icon" href="assets/img/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="assets/css/theme.css">
  <link rel="stylesheet" href="assets/css/<name>.css">
  <script type="module" src="assets/js/site.js"></script>
  <!-- 需要互動時：<script type="module" src="assets/js/pages/<name>.js"></script> -->
</head>
<body>
  <header data-site-header></header>
  <main class="page container">
    <section class="glass pad">…</section>
  </main>
  <footer data-site-footer></footer>
</body>
</html>
```

---

## 9. 視覺風格：星空 × 玻璃透視

### 9.1 原則

- 深色宇宙背景（`body` 的星雲漸層）+ 動態星空 canvas（`#starfield`，由 `site.js` 自動建立）。
- 內容放在半透明毛玻璃卡片上：`.glass`（背景 `--glass`、邊框 `--glass-border`、`backdrop-filter: blur(14px)`）。
- 強調色是紫（`--accent #a594ff`）到青（`--accent-2 #5ad8ff`）的漸層；漲用 `--up` 綠、跌用 `--down` 紅、警告用 `--warn` 金。
- 數字一律用等寬字 `--mono`（JetBrains Mono）；正數加 `+`，用 `.pos` / `.neg` 上色。

### 9.2 規定

- **頁面 CSS 不可寫死色碼**，只能用 `theme.css` 的 CSS 變數；需要新顏色時先加到 `theme.css` 的 `:root`，資料視覺化用色同步加到 `core/palette.js`。
- 優先使用共用元件：`.glass` `.btn` `.btn.primary` `.field` `.segmented` `.chip` `.kpis/.kpi` `.table-wrap/.table` `.tabs` `.progress` `.note(.good/.warn/.bad)`。
- 版面必須支援手機寬度（375px）：不可出現水平捲軸；grid 欄位用 `minmax(0, 1fr)` 避免被內容撐寬；表格包在 `.table-wrap` 裡橫向捲動。
- 星空效能限制（`ui/starfield.js`）：最多 420 顆星、30 FPS、分頁隱藏時暫停、`prefers-reduced-motion` 時只畫靜態；使用者可用頁首 ✦ 按鈕關閉動畫（存在 localStorage）。**不可**提高這些上限。
- 玻璃卡片不要巢狀太多層（`backdrop-filter` 疊加很耗 GPU）；卡片內的子區塊改用 `rgba(255,255,255,0.03)` 底色。

### 9.3 圖表

- K 線、資金曲線用 Lightweight Charts，一律透過 `ui/charts.js` 建立，不要在頁面裡直接呼叫 `LightweightCharts.createChart`。
- 滑鼠滾輪留給頁面捲動（圖表用拖曳平移、拖曳座標軸縮放）。
- 樣本外區間用 `.oos-shade` 半透明藍色覆蓋層標示。
- 統計圖（扇形圖、直方圖）用 `ui/plots.js` 的 canvas 函式，並用 `autoDraw` 自動跟隨尺寸重畫。

---

## 10. 防過擬合模組

| 功能 | 模組 | 使用的資料 | 重點輸出 |
|---|---|---|---|
| 樣本內／外切分 | `data.js` `resolveRange` | 回測區間最後 `oosPct`% 為樣本外 | 指標表分欄、圖上藍色底 |
| 參數最佳化 + DSR + PBO | `optimize.js` `stats.js` | **只用樣本內**掃網格，最佳參數再跑樣本外 | 最佳參數、DSR、PSR、PBO、λ 分布、前 20 名 |
| 滾動前進 | `walkforward.js` | 整個區間，依月份切段 | 拼接樣本外曲線、WFE、各段參數 |
| 蒙地卡羅 | `montecarlo.js` | 目前參數在整個區間的回測 | 虧損機率、報酬／回撤分位數、扇形圖 |

規定：

- 最佳化**絕對不可以**用到樣本外資料；新增任何最佳化流程都要遵守。
- 蒙地卡羅使用固定種子的亂數（`stats.js` 的 `rng`），相同設定必須得到相同結果。
- DSR 與 PBO 一律用**未年化的每根夏普值**計算，顯示時再年化。
- 判讀文字的門檻集中在 `pages/backtest.js`：PBO < 20% 綠、< 50% 黃、其餘紅；DSR ≥ 95% 綠、≥ 50% 黃；WFE ≥ 0.5 綠、≥ 0 黃。修改門檻要同步更新 `guide.html`。
- 新增一種檢驗方法時：計算放 `core/<name>.js`，在 `worker.js` 的 `handlers` 加一個指令，在 `backtest.html` 的「防過擬合檢驗」卡片加一個分頁籤，在 `guide.html` 加一節說明，並補測試。

---

## 11. 命名與程式風格

- 檔名：kebab-case（`ma-cross.js`、`worker-client.js`）；策略檔名 = 策略 id。
- JS：ES2022 模組、2 空白縮排、單引號、分號、`const` 優先；函式加一行繁體中文 JSDoc 說明用途。
- 百分比參數在 settings 中用「百分比數字」（`feePct: 0.1` 代表 0.1%），在引擎內才除以 100。
- 時間用 UTC 秒；價格與權益用 USDT。
- 使用者看得到的字串一律繁體中文；插入 HTML 的動態字串要經過 `format.js` 的 `escapeHtml`。

---

## 12. 測試與驗證

```bash
npm test          # = node --test，跑 tests/ 下所有測試（需 Node 18+）
npm run dev       # = python -m http.server 8765，開 http://localhost:8765
```

- **ES Modules 與 Worker 不能用 `file://` 開啟**，一定要透過本機伺服器預覽。
- 修改 `core/` 或 `strategies/` 後必跑 `npm test`。
- 修改畫面後至少檢查：首頁、回測台、方法說明三頁的瀏覽器主控台沒有錯誤；回測台在桌機與 375px 手機寬度都沒有水平捲軸；三個防過擬合分頁都能跑出結果。
- 測試中「所有策略都必須通過」的規格檢查與未來函數檢查，會自動套用到新登記的策略，**不可為了讓新策略通過而放寬這些測試**。

---

## 13. AI 修改守則

**要做：**
- 先讀本檔，再讀要修改的模組開頭註解。
- 依第 3 節的放置規則決定檔案位置；能用設定或登記表解決的，就不要改頁面程式。
- 改動成交假設、指標定義、判讀門檻時，同步更新 `guide.html` 與本檔。
- 修改本檔後，把內容複製到 `AGENTS.md`。
- 完成後跑測試並在本機預覽確認。

**不要做：**
- 不要引入框架、打包工具或新的 CDN 套件（要先問使用者）。
- 不要在主執行緒跑回測、不要讓 `core/` 碰 DOM。
- 不要放寬未來函數測試，不要讓最佳化看到樣本外資料。
- 不要寫死色碼或另起一套樣式；不要提高星空效能上限。
- 不要提交原始 parquet、1 分鐘資料或任何金鑰。
- 不要把結果包裝成投資建議；頁尾的免責聲明必須保留。

---

## 14. 部署

- GitHub Pages：Settings → Pages → Deploy from a branch → `main` / `(root)`。
- 根目錄的 `.nojekyll` 必須保留（讓 Pages 直接提供所有檔案）。
- `site.js` 的 `SITE.repo` 是 GitHub repo 網址，首頁「閱讀專案規則」連結會指向 `<repo>/blob/main/CLAUDE.md`。

---

## 15. 開發紀錄

- AI 模型：Claude Opus 5.5（`claude-opus-5-5`），透過 Claude Code 開發。
- 本網站僅供教育與研究，不構成任何投資建議。
