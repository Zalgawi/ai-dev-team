"""Tests for toolkit.backtest, toolkit.strategies and toolkit.walkforward.

The most important property is timing: a target set at close t must not earn any return before
it could have been traded ([Chan QT2e, p. 58]: use lagged data), and strategies must pass the
truncation test for look-ahead bias [Chan QT2e, p. 59].
"""
import numpy as np
import pandas as pd
import pytest

from toolkit import backtest, metrics, walkforward
from toolkit.strategies import REGISTRY, buy_and_hold, trend_filter


def prices_from(returns, start="2000-01-03", name="X"):
    idx = pd.bdate_range(start, periods=len(returns) + 1)
    px = 100 * np.cumprod(np.concatenate([[1.0], 1 + np.asarray(returns, dtype=float)]))
    return pd.DataFrame({name: px}, index=idx)


def random_prices(years=13, seed=1, drift=0.0004, vol=0.011):
    rng = np.random.default_rng(seed)
    return prices_from(drift + vol * rng.standard_normal(252 * years))


# ---------------------------------------------------------------- timing

def test_target_earns_only_after_the_next_close():
    """Target goes to 1 at the close of day 2. With delay=1 the trade is at the close of day 3, so the
    first return earned is day 4's. With delay=0 (market-on-close at day 2) it is day 3's."""
    px = prices_from([0.01] * 8)
    targets = pd.DataFrame({"X": [0, 0, 1, 1, 1, 1, 1, 1, 1]}, index=px.index, dtype=float)
    res = backtest.run(px, targets, cost_bps=0.0, delay=1)
    assert list(res.weights["X"].values) == [0, 0, 0, 0, 1, 1, 1, 1, 1]
    assert res.returns.iloc[3] == 0.0 and res.returns.iloc[4] == pytest.approx(0.01)
    res0 = backtest.run(px, targets, cost_bps=0.0, delay=0)
    assert list(res0.weights["X"].values) == [0, 0, 0, 1, 1, 1, 1, 1, 1]
    assert res.trades.iloc[0]["date"] == px.index[3]  # traded at the close of day 3


def test_costs_are_charged_on_each_trade():
    px = prices_from([0.0] * 6)
    targets = pd.DataFrame({"X": [1, 1, 0, 0, 1, 1, 1]}, index=px.index, dtype=float)
    res = backtest.run(px, targets, cost_bps=10.0, delay=0)
    assert res.costs.sum() == pytest.approx(3 * 10 / 10_000)  # in, out, in
    assert res.returns.sum() == pytest.approx(-3 * 0.001)
    assert len(res.trades) == 3


def test_cash_earns_the_risk_free_rate():
    px = prices_from([0.0] * 5)
    targets = pd.DataFrame({"X": 0.0}, index=px.index)
    res = backtest.run(px, targets, rf_daily=0.0001, cost_bps=0.0)
    assert np.allclose(res.returns.values, 0.0001)


def test_negative_delay_is_rejected():
    px = prices_from([0.0] * 3)
    with pytest.raises(ValueError):
        backtest.run(px, buy_and_hold(px), delay=-1)


# ---------------------------------------------------------------- look-ahead

def test_strategies_pass_the_truncation_test():
    px = random_prices(years=3)
    assert backtest.no_lookahead(trend_filter, px, window=50)
    assert backtest.no_lookahead(buy_and_hold, px)


def test_truncation_test_catches_a_cheating_strategy():
    """A strategy that holds the asset when TOMORROW's return is positive peeks into the future."""
    def cheat(prices):
        nxt = prices.pct_change().shift(-1)
        return (nxt > 0).astype(float)
    px = random_prices(years=3)
    assert not backtest.no_lookahead(cheat, px)


def test_trend_filter_rules():
    px = prices_from([0.01] * 5 + [-0.05] * 5)
    w = trend_filter(px, window=3)
    assert (w["X"].iloc[:2] == 0).all()        # no average yet
    assert w["X"].iloc[4] == 1.0               # rising: above its average
    assert w["X"].iloc[-1] == 0.0              # falling: below its average
    with pytest.raises(ValueError):
        trend_filter(px, window=1)


# ---------------------------------------------------------------- walk-forward

def test_walk_forward_chooses_on_training_data_only():
    px = random_prices(years=13)
    wf = walkforward.run(REGISTRY["trend-sma"], px, 0.0, train_years=10, test_years=1)
    assert wf.trials == 5
    # 13 years of data, 10 to train: three full test years plus the partial current one.
    assert len(wf.windows) == -(-(len(px) - 2520) // 252)
    for w in wf.windows:
        assert w["train_end"] < w["test_start"]
    # Re-derive the first choice independently: best training Sharpe over the grid.
    w0 = wf.windows[0]
    train = px.loc[w0["train_start"]:w0["train_end"]]
    scores = {}
    for p in walkforward.grid_points(REGISTRY["trend-sma"].grid):
        full_targets = trend_filter(px, **p)
        res = backtest.run(train, full_targets.loc[train.index], 0.0, 5.0, 1)
        scores[p["window"]] = metrics.sharpe(res.returns)
    assert w0["params"]["window"] == max(scores, key=scores.get)
    # Results start at the first test day: no in-sample days are reported.
    assert wf.result.returns.index[0] == pd.Timestamp(w0["test_start"])


def test_walk_forward_needs_enough_history():
    with pytest.raises(ValueError):
        walkforward.run(REGISTRY["trend-sma"], random_prices(years=5), 0.0)


def test_sensitivity_covers_the_grid():
    rows = walkforward.sensitivity(REGISTRY["trend-sma"], random_prices(years=3))
    assert [r["params"]["window"] for r in rows] == [50, 100, 150, 200, 250]
