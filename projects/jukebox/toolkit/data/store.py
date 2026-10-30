"""Local cache of downloaded data in data/cache/ (git-ignored), with a metadata file per series.

Results are reproducible from a logged snapshot: each cached series records its source, retrieval
time, date range and a content hash, and `snapshot()` reports them for a memo or dashboard.
"""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from . import sources
from .quality import check_prices

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "data" / "cache"


def load_env(path: Path = ROOT / ".env") -> None:
    """Reads KEY=value lines from .env into the environment (existing variables win)."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _safe(name: str) -> str:
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in name.upper())


def _paths(kind: str, name: str) -> tuple[Path, Path]:
    base = CACHE / kind / _safe(name)
    return base.with_suffix(".csv"), base.with_suffix(".json")


def _write(kind: str, name: str, frame: pd.DataFrame, meta: dict) -> None:
    csv, info = _paths(kind, name)
    csv.parent.mkdir(parents=True, exist_ok=True)
    body = frame.to_csv()
    csv.write_text(body, encoding="utf-8")
    meta = {
        **meta,
        "retrieved": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "first": str(frame.index.min().date()),
        "last": str(frame.index.max().date()),
        "rows": int(len(frame)),
        "sha256": hashlib.sha256(body.encode()).hexdigest()[:16],
    }
    info.write_text(json.dumps(meta, indent=2), encoding="utf-8")


def _read(kind: str, name: str) -> pd.DataFrame | None:
    csv, _ = _paths(kind, name)
    if not csv.exists():
        return None
    return pd.read_csv(csv, index_col=0, parse_dates=True)


def update_prices(symbol: str, start: str = "1990-01-01") -> dict:
    """Downloads a symbol's full daily history from the first source that works, checks it and caches it."""
    load_env()
    errors = []
    for name, fetch in sources.price_sources():
        try:
            df = fetch(symbol, start)
        except Exception as e:  # try the next source
            errors.append(f"{name}: {e}")
            continue
        report = check_prices(df)
        currency = df.attrs.get("currency", "USD")
        _write("prices", symbol, df, {"symbol": symbol, "source": name, "currency": currency, "quality": report})
        return {"symbol": symbol, "source": name, "currency": currency, "rows": len(df), "quality": report}
    raise RuntimeError(f"No source could load {symbol}: " + "; ".join(errors))


def update_fred(series_id: str) -> dict:
    s = sources.fred_series(series_id)
    _write("fred", series_id, s.to_frame(), {"series": series_id, "source": "fred"})
    return {"series": series_id, "rows": len(s)}


def prices(symbol: str) -> pd.DataFrame:
    """Cached daily prices for a symbol (run update_prices first)."""
    df = _read("prices", symbol)
    if df is None:
        raise FileNotFoundError(f"No cached prices for {symbol}. Run: npm run data")
    return df


def fred(series_id: str) -> pd.Series:
    df = _read("fred", series_id)
    if df is None:
        raise FileNotFoundError(f"No cached FRED series {series_id}. Run: npm run data")
    return df.iloc[:, 0].rename(series_id)


def meta(kind: str, name: str) -> dict:
    """The metadata recorded when a series was downloaded (source, currency, dates, hash, quality)."""
    _, info = _paths(kind, name)
    return json.loads(info.read_text(encoding="utf-8")) if info.exists() else {}


def snapshot() -> list[dict]:
    """Metadata of every cached series: what the current results were computed from."""
    out = []
    for info in sorted(CACHE.glob("*/*.json")):
        out.append(json.loads(info.read_text(encoding="utf-8")))
    return out
