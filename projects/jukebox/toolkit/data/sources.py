"""Free daily market data: Tiingo (needs TIINGO_API_KEY), Yahoo via yfinance (no key), FRED (no key).

Every loader returns a DataFrame indexed by trading date (tz-naive, ascending) with columns
open, high, low, close, adj_close, volume, dividend, split. adj_close is adjusted for splits and
dividends, so its returns are total returns ([Chan QT2e, p. 41]: backtests need split- and
dividend-adjusted prices). Network access happens only here; everything else works on cached files.
"""
from __future__ import annotations

import io
import os
from typing import Callable

import pandas as pd

COLUMNS = ["open", "high", "low", "close", "adj_close", "volume", "dividend", "split"]
TIMEOUT = 30


def _finish(df: pd.DataFrame) -> pd.DataFrame:
    df = df[COLUMNS].copy()
    df.index = pd.to_datetime(df.index).tz_localize(None).normalize()
    df.index.name = "date"
    return df.sort_index()


# Exchange time zones and closing times (plus a margin for the closing auction and late prints).
EXCHANGES = {".L": ("Europe/London", 17, 0)}
DEFAULT_EXCHANGE = ("America/New_York", 16, 30)


def drop_unfinished(df: pd.DataFrame, symbol: str, now: pd.Timestamp | None = None) -> pd.DataFrame:
    """Removes today's bar while its exchange is still open: an intraday price isn't a close, and
    a signal computed from it could change by the close."""
    tz, hour, minute = next((v for k, v in EXCHANGES.items() if symbol.upper().endswith(k.upper())), DEFAULT_EXCHANGE)
    local = (now or pd.Timestamp.now(tz="UTC")).tz_convert(tz)
    closed = (local.hour, local.minute) >= (hour, minute)
    if len(df) and not closed and df.index[-1].date() >= local.date():
        return df.iloc[:-1]
    return df


def tiingo_daily(symbol: str, start: str = "1990-01-01") -> pd.DataFrame:
    """Tiingo end-of-day prices (free tier). Requires TIINGO_API_KEY in the environment (.env)."""
    import httpx

    key = os.environ.get("TIINGO_API_KEY")
    if not key:
        raise RuntimeError("TIINGO_API_KEY is not set (add it to .env).")
    r = httpx.get(
        f"https://api.tiingo.com/tiingo/daily/{symbol.lower()}/prices",
        params={"startDate": start, "format": "json"},
        headers={"Authorization": f"Token {key}"},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    rows = r.json()
    if not rows:
        raise RuntimeError(f"Tiingo returned no data for {symbol}.")
    df = pd.DataFrame(rows).set_index("date")
    df = df.rename(columns={"adjClose": "adj_close", "divCash": "dividend", "splitFactor": "split"})
    df = _finish(df)
    df = drop_unfinished(df, symbol)
    df.attrs["currency"] = "USD"  # Tiingo's end-of-day prices are US listings in USD
    return df


def yahoo_daily(symbol: str, start: str = "1990-01-01") -> pd.DataFrame:
    """Yahoo Finance via yfinance (unofficial; no key). Fallback when Tiingo isn't configured."""
    import yfinance as yf

    raw = yf.Ticker(symbol).history(start=start, auto_adjust=False, actions=True, timeout=TIMEOUT)
    if raw.empty:
        raise RuntimeError(f"Yahoo returned no data for {symbol}.")
    df = raw.rename(columns={
        "Open": "open", "High": "high", "Low": "low", "Close": "close", "Adj Close": "adj_close",
        "Volume": "volume", "Dividends": "dividend", "Stock Splits": "split",
    })
    df["split"] = df["split"].replace(0.0, 1.0)
    df = _finish(df)
    # London listings are sometimes quoted in pence (GBp); convert them to pounds.
    currency = yf.Ticker(symbol).fast_info.get("currency") or "USD"
    if currency == "GBp":
        df[["open", "high", "low", "close", "adj_close", "dividend"]] /= 100.0
        currency = "GBP"
    df = drop_unfinished(df, symbol)
    df.attrs["currency"] = currency
    return df


def fred_series(series_id: str) -> pd.Series:
    """A FRED series as floats indexed by date, from the public CSV endpoint (no key needed).

    E.g. DGS3MO: 3-month Treasury bill yield, percent per annum."""
    import httpx

    r = httpx.get("https://fred.stlouisfed.org/graph/fredgraph.csv", params={"id": series_id}, timeout=TIMEOUT)
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.text))
    df.columns = ["date", "value"]
    s = pd.to_numeric(df["value"], errors="coerce")
    s.index = pd.to_datetime(df["date"])
    s.index.name = "date"
    return s.dropna().rename(series_id)


def price_sources() -> list[tuple[str, Callable[[str, str], pd.DataFrame]]]:
    """Price sources in order of preference: Tiingo when a key is set, then Yahoo."""
    sources: list[tuple[str, Callable[[str, str], pd.DataFrame]]] = []
    if os.environ.get("TIINGO_API_KEY"):
        sources.append(("tiingo", tiingo_daily))
    sources.append(("yahoo", yahoo_daily))
    return sources
