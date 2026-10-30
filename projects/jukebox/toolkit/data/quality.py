"""Data quality checks for daily price series, run on every download.

Checks: duplicate or unsorted dates, missing or non-positive prices, gaps of more than a week,
stale prices (unchanged for many days), and one-day moves in adj_close that are too large to be
real unless explained by a split ([Chan QT2e, p. 41]: unadjusted splits fake huge returns).
"""
from __future__ import annotations

import pandas as pd


def check_prices(df: pd.DataFrame, max_move: float = 0.25, stale_days: int = 5) -> dict:
    """Returns {"ok": bool, "issues": [...]}; issues are warnings to show the human, not fixes."""
    issues: list[str] = []
    if df.empty:
        return {"ok": False, "issues": ["no rows"]}
    if df.index.has_duplicates:
        issues.append(f"{int(df.index.duplicated().sum())} duplicate dates")
    if not df.index.is_monotonic_increasing:
        issues.append("dates are not in order")

    px = df["adj_close"]
    if px.isna().any():
        issues.append(f"{int(px.isna().sum())} missing adj_close values")
    if (px.dropna() <= 0).any():
        issues.append("non-positive prices")

    gaps = df.index.to_series().diff().dt.days
    big = gaps[gaps > 7]
    for date, days in big.head(5).items():
        issues.append(f"{int(days)}-day gap before {date.date()}")

    ret = px.pct_change(fill_method=None).dropna()
    jumps = ret[ret.abs() > max_move]
    for date, r in jumps.head(5).items():
        split = df.loc[date, "split"] if "split" in df.columns else 1.0
        note = f" (split {split})" if split not in (0, 1, 1.0) else ""
        issues.append(f"{r:+.1%} move on {date.date()}{note}")

    unchanged = (px.diff() == 0).astype(int)
    runs = unchanged.groupby((unchanged == 0).cumsum()).cumsum()
    if len(runs) and runs.max() >= stale_days:
        issues.append(f"price unchanged for {int(runs.max())} days in a row, up to {runs.idxmax().date()}")

    return {"ok": not issues, "issues": issues}
