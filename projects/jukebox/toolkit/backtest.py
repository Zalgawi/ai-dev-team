"""Daily backtester with no look-ahead, trading costs, and cash earning the risk-free rate.

Timing (the core rule against look-ahead bias, [Chan QT2e, p. 58]: signals use lagged data):
  - A strategy returns TARGET weights for each date t, computed from closes up to and including t.
  - With delay=1 (default) the trade happens at the close of the next trading day t+1, so the
    target first earns the return from close t+1 to close t+2. This matches a human who sees the
    signal after the close and places the order the next day.
  - delay=0 means trading at the close of t itself (a market-on-close order): optimistic, flag it.
Costs: `cost_bps` per unit of weight traded, charged on the trade day [Chan QT2e, pp. 72, 75]
(Chan deducts 5 basis points per trade). Uninvested weight earns the risk-free rate.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from . import metrics


@dataclass
class BacktestResult:
    returns: pd.Series            # net daily returns of the strategy
    gross: pd.Series              # before costs
    weights: pd.DataFrame         # weights actually held over each day's return
    targets: pd.DataFrame         # the strategy's target weights (as of each close)
    trades: pd.DataFrame          # one row per trade: date, symbol, from, to
    costs: pd.Series
    params: dict = field(default_factory=dict)

    def summary(self, rf: float | pd.Series = 0.0) -> dict:
        return metrics.summary(self.returns, rf, self.weights)


def run(
    prices: pd.DataFrame,
    targets: pd.DataFrame,
    rf_daily: pd.Series | float = 0.0,
    cost_bps: float = 5.0,
    delay: int = 1,
) -> BacktestResult:
    """Backtests target weights against adjusted close prices (columns = symbols)."""
    if delay < 0:
        raise ValueError("delay must be >= 0")
    prices = prices.sort_index()
    targets = targets.reindex(prices.index).reindex(columns=prices.columns).ffill().fillna(0.0)
    asset_ret = prices.pct_change(fill_method=None).fillna(0.0)

    # Weight held over day t's return (close t-1 -> close t): the target set at close t-1-delay.
    held = targets.shift(1 + delay).fillna(0.0)
    # A change in holdings on day t is a trade at the close of t-1; its cost is booked on day t.
    change = held.diff().fillna(held)
    costs = change.abs().sum(axis=1) * cost_bps / 10_000.0

    rf = rf_daily if isinstance(rf_daily, pd.Series) else pd.Series(rf_daily, index=prices.index)
    rf = rf.reindex(prices.index).ffill().fillna(0.0)
    cash = 1.0 - held.sum(axis=1)
    gross = (held * asset_ret).sum(axis=1) + cash * rf
    net = gross - costs

    trade_close = pd.Series(prices.index, index=prices.index).shift(1).fillna(prices.index[0])
    before = held.shift(1).fillna(0.0)
    moved = change.stack()
    moved = moved[moved.abs() > 1e-12]
    trades = pd.DataFrame({
        "date": [trade_close[d] for d, _ in moved.index],
        "symbol": [s for _, s in moved.index],
        "from": [float(before.at[d, s]) for d, s in moved.index],
        "to": [float(held.at[d, s]) for d, s in moved.index],
    }, columns=["date", "symbol", "from", "to"])

    return BacktestResult(net, gross, held, targets, trades, costs,
                          {"cost_bps": cost_bps, "delay": delay})


def no_lookahead(strategy, prices: pd.DataFrame, cuts: int = 12, **params) -> bool:
    """Checks a strategy for look-ahead bias by truncation [Chan QT2e, p. 59].

    Targets computed on data up to date T must equal the targets for the same dates computed on
    the full history. If later data changes earlier targets, the strategy peeks into the future.
    Several cut points are tried, because a one-day peek only shows at some of them."""
    n = len(prices)
    full = strategy(prices, **params).fillna(0.0)
    for cut in sorted({int(n * f) for f in [0.5 + 0.45 * i / max(1, cuts - 1) for i in range(cuts)]}):
        part = strategy(prices.iloc[:cut], **params)
        a = full.iloc[:cut]
        b = part.reindex(a.index).fillna(0.0)
        if not ((a - b).abs() < 1e-12).all().all():
            return False
    return True
