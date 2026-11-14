# BTC 回測實驗室 ✦ BTC Backtest Lab

在星空下，誠實地檢驗你的交易策略。

一個**純前端**的 BTC/USDT 量化回測網站：選擇策略、調整參數，瀏覽器就會用 2017–2026 年的 Binance 1 小時 K 線完成回測。網站也內建四種**防過擬合**工具，用來確認漂亮的資金曲線不只是運氣。

- 🌐 網站：https://0chanchuan0.github.io/btc-backtest-lab/
- 📐 專案規則：[`CLAUDE.md`](CLAUDE.md)（與 [`AGENTS.md`](AGENTS.md) 內容相同）

## 功能

| 類別 | 內容 |
|---|---|
| 策略 | 均線交叉、MACD、海龜交易法（唐奇安通道突破）、SuperTrend、時間序列動量（TSMOM）、Connors RSI(2)——外掛式設計，可持續新增 |
| 資料 | BTC/USDT 1h，約 7.6 萬根；4h、1d 由 1h 合成；可選日期區間 |
| 交易設定 | 初始資金、每筆投入 %、槓桿、手續費、滑價、只做多／多空／只做空 |
| 風控 | 停損、停利、移動停損、強制平倉 |
| 結果 | K 線與買賣點、指標副圖、資金曲線（對數座標）、16 項指標、交易紀錄與 CSV 下載 |
| 比較 | 最多 6 組策略與參數疊圖比較，並與買進持有對照 |
| 防過擬合 | 樣本內／樣本外切分 · 參數最佳化 + 緊縮夏普值（DSR）+ 回測過擬合機率（PBO / CSCV） · 滾動前進（Walk-forward） · 蒙地卡羅（交易重抽、區塊抽樣） |

## 技術

- 純 HTML / CSS / 原生 ES Modules，**沒有建置步驟**，直接放上 GitHub Pages 就能執行
- 所有計算都在 **Web Worker** 執行，畫面不會卡住
- 圖表：[TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) 4.2.0
- 視覺：星空 × 玻璃透視（動態星空 canvas + `backdrop-filter` 毛玻璃卡片）

實測（真實資料、單一 Worker）：單次回測約 10–20 ms；1h 資料掃 200 多組參數加 DSR/PBO 約 1 秒；滾動前進 31 段約 2–3 秒；蒙地卡羅 1000 次約 0.2 秒。

## 本機執行

```bash
npm run dev     # python -m http.server 8765 → 開啟 http://localhost:8765
npm test        # node --test，測試核心模組與所有策略
```

> ES Modules 與 Web Worker 不能用 `file://` 直接開啟，請透過本機伺服器。

更新資料：

```bash
python scripts/build_data.py <BTC_USDT_1h.parquet 或 .csv>
```

## 新增一個策略

規則寫在 [`CLAUDE.md` 第 6 節](CLAUDE.md#6-新增策略)，流程只有三步：

1. 在 `assets/js/strategies/` 依範本建立 `<id>.js`，實作 `compute(bars, params)` 回傳每根 K 棒的目標方向（1 / 0 / −1）
2. 在 `assets/js/strategies/index.js` 登記一行
3. 執行 `npm test`，測試會自動檢查欄位格式，以及有沒有偷看未來資料

首頁卡片、參數面板、最佳化網格、說明卡都會自動產生，不需要修改任何 HTML。

## 專案結構

```
index.html · backtest.html · guide.html     頁面
assets/css/      theme.css（主題變數與共用元件）+ 各頁樣式
assets/js/core/  資料、指標、引擎、指標計算、最佳化、滾動前進、蒙地卡羅、統計
assets/js/strategies/  策略外掛與登記表
assets/js/ui/    圖表、星空、格式化、Worker 介面
assets/js/pages/ 各頁邏輯
data/            BTC 1h 二進位資料與 meta.json
scripts/         資料轉檔
tests/           單元測試
```

## 開發方式

本專案先撰寫 `CLAUDE.md` 定義規則，再由 AI 依規則開發。

- AI 模型：**Claude Opus 5.5**（`claude-opus-5-5`），使用 Claude Code

## 免責聲明

本網站僅供教育與研究用途，不構成任何投資建議。過去績效不代表未來表現。
