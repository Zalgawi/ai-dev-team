"""Strategies: functions from adjusted close prices to target weights, using data up to each close only.

Each strategy is registered with its parameter grid (kept small: [Chan QT2e, p. 60] advises at most
five parameters, and every grid point counts as a trial against data snooping) and its citations.
Published rules like these are widely known, so any edge has to survive costs and out-of-sample tests.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import pandas as pd


def buy_and_hold(prices: pd.DataFrame) -> pd.DataFrame:
    """Fully invested in every column, equally weighted. The benchmark for everything else."""
    n = prices.shape[1]
    return pd.DataFrame(1.0 / n, index=prices.index, columns=prices.columns)


def trend_filter(prices: pd.DataFrame, window: int = 200) -> pd.DataFrame:
    """Hold an asset while its close is above its `window`-day simple moving average, else cash.

    Moving averages smooth out noise to show the underlying trend, and their crossing is read as a
    change in trend [Wilmott PWOQF, §20.2.4, p. 345]. Uses closes up to and including t only."""
    if window < 2:
        raise ValueError("window must be at least 2")
    sma = prices.rolling(window, min_periods=window).mean()
    weights = (prices > sma).astype(float)
    weights[sma.isna()] = 0.0
    return weights.div(prices.shape[1])


@dataclass
class Strategy:
    id: str
    name: str
    description: str
    fn: Callable[..., pd.DataFrame]
    grid: dict[str, list] = field(default_factory=dict)
    default: dict = field(default_factory=dict)
    citations: list[str] = field(default_factory=list)


REGISTRY: dict[str, Strategy] = {
    "trend-sma": Strategy(
        id="trend-sma",
        name="Trend filter (moving average)",
        description="Hold the index while its price is above its N-day moving average; otherwise sit in "
                    "T-bills. Aims to sidestep long bear markets at the cost of whipsaws and lagging re-entry.",
        fn=trend_filter,
        grid={"window": [50, 100, 150, 200, 250]},
        default={"window": 200},
        citations=["[Wilmott PWOQF, §20.2.4, p. 345] moving averages as trend signals",
                   "[Chan QT2e, p. 58] lag data to avoid look-ahead bias",
                   "[Chan QT2e, p. 60] at most five parameters; data-snooping bias"],
    ),
    "buy-hold": Strategy(
        id="buy-hold",
        name="Buy and hold",
        description="Always fully invested. The benchmark every strategy must beat after costs and risk.",
        fn=lambda prices: buy_and_hold(prices),
        citations=["[Chan QT2e, pp. 49-50] Sharpe ratio of a buy-and-hold position"],
    ),
}
