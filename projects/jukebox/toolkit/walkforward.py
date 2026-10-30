"""Walk-forward testing: choose parameters on a training window, apply them to the next, unseen window.

Parameters are only ever chosen on past data and judged on later data: tuning on the test set turns
it into a training set and brings back data-snooping bias [Chan QT2e, pp. 60, 72]. The stitched
out-of-sample windows are the only results presented as evidence.
"""
from __future__ import annotations

from dataclasses import dataclass
from itertools import product

import pandas as pd

from . import backtest, metrics
from .strategies import Strategy


@dataclass
class WalkForward:
    result: backtest.BacktestResult   # out-of-sample backtest over all test windows, stitched
    windows: list[dict]               # train/test dates, the chosen parameters, train and test Sharpe
    trials: int                       # parameter sets tried per window


def grid_points(grid: dict[str, list]) -> list[dict]:
    if not grid:
        return [{}]
    keys = list(grid)
    return [dict(zip(keys, values)) for values in product(*(grid[k] for k in keys))]


def run(
    strategy: Strategy,
    prices: pd.DataFrame,
    rf_daily: pd.Series | float = 0.0,
    train_years: int = 10,
    test_years: int = 1,
    cost_bps: float = 5.0,
    delay: int = 1,
) -> WalkForward:
    days = metrics.DAYS
    train, test = train_years * days, test_years * days
    if len(prices) < train + test:
        raise ValueError(f"Need at least {train_years + test_years} years of data for walk-forward.")
    points = grid_points(strategy.grid)
    # Strategies only use data up to each close, so targets for every parameter set can be
    # computed once on the full history (no_lookahead checks this).
    targets = {i: strategy.fn(prices, **p) for i, p in enumerate(points)}

    oos = pd.DataFrame(0.0, index=prices.index, columns=prices.columns)
    windows = []
    start = train
    while start < len(prices):
        end = min(start + test, len(prices))
        tr = prices.index[start - train:start]
        te = prices.index[start:end]
        scores = {}
        for i in targets:
            res = backtest.run(prices.loc[tr], targets[i].loc[tr], rf_daily, cost_bps, delay)
            scores[i] = metrics.sharpe(res.returns, rf_daily)
        best = max(scores, key=lambda i: (pd.notna(scores[i]), scores[i]))
        oos.loc[te] = targets[best].loc[te].values
        windows.append({"train_start": str(tr[0].date()), "train_end": str(tr[-1].date()),
                        "test_start": str(te[0].date()), "test_end": str(te[-1].date()),
                        "params": points[best], "train_sharpe": scores[best]})
        start = end

    first_test = prices.index[train]
    # Run on the full history so the first test window's trades see the right previous holdings,
    # then keep only the out-of-sample part.
    full = backtest.run(prices, oos, rf_daily, cost_bps, delay)
    keep = full.returns.index >= first_test
    result = backtest.BacktestResult(
        full.returns[keep], full.gross[keep], full.weights[keep], full.targets[keep],
        full.trades[full.trades["date"] >= first_test], full.costs[keep],
        {**full.params, "walk_forward": True, "train_years": train_years, "test_years": test_years},
    )
    for w in windows:
        r = result.returns.loc[w["test_start"]:w["test_end"]]
        w["test_sharpe"] = metrics.sharpe(r, rf_daily)
    return WalkForward(result, windows, len(points))


def sensitivity(strategy: Strategy, prices: pd.DataFrame, rf_daily: pd.Series | float = 0.0,
                cost_bps: float = 5.0, delay: int = 1) -> list[dict]:
    """Full-period results for every parameter set. IN-SAMPLE: shows robustness, not evidence.

    A strategy that only works at one setting is noise [Chan QT2e, p. 72]."""
    out = []
    for p in grid_points(strategy.grid):
        res = backtest.run(prices, strategy.fn(prices, **p), rf_daily, cost_bps, delay)
        s = metrics.summary(res.returns, rf_daily, res.weights)
        out.append({"params": p, **{k: s[k] for k in ("cagr", "vol", "sharpe", "max_drawdown", "turnover")}})
    return out
