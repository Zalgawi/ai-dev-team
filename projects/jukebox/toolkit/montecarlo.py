"""Monte Carlo by resampling a strategy's own daily returns (stationary block bootstrap).

Instead of assuming a model for prices, this redraws blocks of the strategy's realised daily returns
in random order, keeping short-term clustering (volatility comes in bursts). It shows the range of
outcomes the same strategy could plausibly have produced: drawdowns, losing years, terminal wealth.
It cannot prove an edge exists; it measures risk given the returns observed.

Method: stationary bootstrap of Politis & Romano (1994): blocks start at random days and have
geometric lengths with mean `block` days. Outside library: no book in media/ covers it.
Every run is seeded and reports its seed and number of paths.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .metrics import DAYS


def bootstrap_paths(returns: pd.Series, horizon: int, paths: int = 2000, block: int = 20,
                    seed: int = 7) -> np.ndarray:
    """Array (paths x horizon) of resampled daily returns."""
    r = returns.dropna().to_numpy()
    n = len(r)
    if n < 2:
        raise ValueError("Need at least two returns to resample.")
    if horizon < 1 or paths < 1 or block < 1:
        raise ValueError("horizon, paths and block must be positive")
    rng = np.random.default_rng(seed)
    idx = np.empty((paths, horizon), dtype=np.int64)
    idx[:, 0] = rng.integers(0, n, paths)
    new_block = rng.random((paths, horizon)) < 1.0 / block
    jumps = rng.integers(0, n, (paths, horizon))
    for t in range(1, horizon):
        idx[:, t] = np.where(new_block[:, t], jumps[:, t], (idx[:, t - 1] + 1) % n)
    return r[idx]


def simulate(returns: pd.Series, years: float = 1.0, paths: int = 2000, block: int = 20,
             seed: int = 7, drawdown_limit: float = -0.20) -> dict:
    """Distribution of outcomes over `years`: terminal return, max drawdown, chance of a loss."""
    horizon = max(1, int(round(years * DAYS)))
    sims = bootstrap_paths(returns, horizon, paths, block, seed)
    equity = np.cumprod(1.0 + sims, axis=1)
    terminal = equity[:, -1] - 1.0
    peaks = np.maximum.accumulate(np.maximum(equity, 1.0), axis=1)
    mdd = (equity / peaks - 1.0).min(axis=1)
    q = [5, 25, 50, 75, 95]
    step = max(1, horizon // 60)
    fan_days = list(range(0, horizon, step)) + [horizon - 1]
    fan = np.percentile(equity[:, fan_days], q, axis=0)
    return {
        "years": years, "paths": paths, "block": block, "seed": seed,
        "terminal": {f"p{p}": float(v) for p, v in zip(q, np.percentile(terminal, q))},
        "max_drawdown": {f"p{p}": float(v) for p, v in zip(q, np.percentile(mdd, q))},
        "prob_loss": float((terminal < 0).mean()),
        "prob_drawdown_beyond": float((mdd <= drawdown_limit).mean()),
        "drawdown_limit": drawdown_limit,
        "fan": {"day": [d + 1 for d in fan_days], **{f"p{p}": row.tolist() for p, row in zip(q, fan)}},
    }
