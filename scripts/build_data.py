"""把 Binance BTC/USDT 1 小時 K 線轉成網頁用的二進位資料檔。

用法：
    python scripts/build_data.py <來源檔.parquet 或 .csv>

來源檔需要欄位：timestamp, open, high, low, close, volume
（timestamp 可為 datetime 或毫秒/秒整數，一律視為 UTC）

輸出：
    data/btc_usdt_1h.bin   欄位式（column-major）little-endian 二進位
                           [Uint32 time 秒] [Float32 open] [Float32 high] [Float32 low] [Float32 close] [Float32 volume]
                           每段長度皆為 count
    data/meta.json         筆數、起訖時間、欄位配置等描述
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
OUT_BIN = ROOT / "data" / "btc_usdt_1h.bin"
OUT_META = ROOT / "data" / "meta.json"
FIELDS = ["open", "high", "low", "close", "volume"]


def load(path: Path) -> pd.DataFrame:
    if path.suffix == ".parquet":
        df = pd.read_parquet(path)
    elif path.suffix == ".csv":
        df = pd.read_csv(path)
    else:
        raise SystemExit(f"不支援的檔案格式：{path.suffix}")

    missing = {"timestamp", *FIELDS} - set(df.columns)
    if missing:
        raise SystemExit(f"缺少欄位：{sorted(missing)}")

    ts = df["timestamp"]
    if pd.api.types.is_numeric_dtype(ts):
        unit = "ms" if ts.max() > 1e11 else "s"
        ts = pd.to_datetime(ts, unit=unit, utc=True)
    else:
        ts = pd.to_datetime(ts, utc=True)
    df = df.assign(timestamp=ts)
    return df[["timestamp", *FIELDS]]


def clean(df: pd.DataFrame) -> pd.DataFrame:
    before = len(df)
    df = df.dropna().drop_duplicates("timestamp").sort_values("timestamp")
    # 只保留整點 K 棒，避免來源混入其他週期
    df = df[df["timestamp"].dt.minute.eq(0) & df["timestamp"].dt.second.eq(0)]
    bad = (df["high"] < df[["open", "close"]].max(axis=1)) | (df["low"] > df[["open", "close"]].min(axis=1))
    if bad.any():
        print(f"警告：{int(bad.sum())} 根 K 棒高低價異常，已修正為開收盤的極值")
        df.loc[bad, "high"] = df.loc[bad, ["open", "high", "close"]].max(axis=1)
        df.loc[bad, "low"] = df.loc[bad, ["open", "low", "close"]].min(axis=1)
    print(f"清理：{before} → {len(df)} 根")
    return df.reset_index(drop=True)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    src = Path(sys.argv[1])
    df = clean(load(src))

    secs = (df["timestamp"].astype("int64") // 10**9).to_numpy().astype("<u4")
    parts = [secs.tobytes()] + [df[f].to_numpy().astype("<f4").tobytes() for f in FIELDS]
    OUT_BIN.parent.mkdir(parents=True, exist_ok=True)
    OUT_BIN.write_bytes(b"".join(parts))

    gaps = int((np.diff(secs.astype(np.int64)) > 3600).sum())
    meta = {
        "symbol": "BTCUSDT",
        "exchange": "Binance",
        "timeframe": "1h",
        "file": f"data/{OUT_BIN.name}",
        "count": int(len(df)),
        "start": int(secs[0]),
        "end": int(secs[-1]),
        "layout": ["time:u32", *[f"{f}:f32" for f in FIELDS]],
        "gaps": gaps,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    OUT_META.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    size_mb = OUT_BIN.stat().st_size / 1024 / 1024
    print(f"輸出 {OUT_BIN.relative_to(ROOT)}（{size_mb:.2f} MB），{meta['count']} 根，缺口 {gaps} 處")


if __name__ == "__main__":
    main()
