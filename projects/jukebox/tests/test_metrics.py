"""Tests for toolkit.metrics.

Test labels:
  KNOWN-ANSWER (book)  reproduces a number stated in a library book (tolerance stated per test)
  CONSISTENCY          checks a definition against an independent calculation
  EDGE CASE            empty, flat or degenerate inputs
Citations use printed page numbers.
"""
import math

import numpy as np
import pandas as pd
import pytest

from toolkit import metrics


def series(values, start="2020-01-01"):
    return pd.Series(values, index=pd.bdate_range(start, periods=len(values)), dtype=float)


# ---------------------------------------------------------------- KNOWN-ANSWER (book)

def test_known_answer_unlevered_growth_chan_example_6_2():
    """KNOWN-ANSWER (book). [Chan QT2e, p. 113], Example 6.2: SPY mean 11.23%, std 16.91% ->
    unlevered growth g = r + m - s^2/2 = 0.1123 - 0.1691^2/2 = 9.8%. Tolerance 0.05 pp (book rounds)."""
    assert metrics.kelly_growth(0.1123, 0.1691, rf=0.0, leverage=1.0) == pytest.approx(0.098, abs=5e-4)


def test_known_answer_kelly_leverage_chan_example_6_2():
    """KNOWN-ANSWER (book). [Chan QT2e, p. 113]: excess mean 7.231%, std 16.91% -> f = 0.07231 / 0.1691^2
    = 2.528. Built as a daily series with exactly that annual mean and std (f is time-scale free). Tol 1e-3."""
    rng = np.random.default_rng(0)
    z = rng.standard_normal(5000)
    z = (z - z.mean()) / z.std(ddof=1)
    daily = series(0.07231 / 252 + z * 0.1691 / math.sqrt(252))
    assert metrics.kelly_leverage(daily, rf=0.0) == pytest.approx(2.528, abs=1e-3)


def test_known_answer_sharpe_annualisation_chan():
    """KNOWN-ANSWER (book). [Chan QT2e, pp. 49-50]: annualised Sharpe = sqrt(252) x mean(excess) / std(excess),
    excess = daily return - rf/252. Checked against that formula computed by hand. Tol 1e-12."""
    r = series([0.01, -0.005, 0.002, 0.007, -0.003, 0.004])
    excess = r - 0.04 / 252
    expected = math.sqrt(252) * excess.mean() / excess.std(ddof=1)
    assert metrics.sharpe(r, rf=0.04) == pytest.approx(expected, rel=1e-12)


# ---------------------------------------------------------------- CONSISTENCY

def test_drawdown_and_duration():
    """[Chan QT2e, pp. 23, 55]: equity 1 -> 1.1 -> 0.99 -> 1.045 -> 1.21: max drawdown -10%, 2 days under water."""
    r = series([0.0, 0.10, -0.10, 0.0555555555555556, 0.1578947368421053])
    assert metrics.max_drawdown(r) == pytest.approx(-0.10, abs=1e-12)
    assert metrics.max_drawdown_duration(r) == 2
    assert (metrics.drawdowns(r) <= 0).all()


def test_cagr_and_vol():
    r = series([0.001] * 252)
    assert metrics.cagr(r) == pytest.approx(1.001 ** 252 - 1, rel=1e-12)
    assert metrics.annual_vol(r) == pytest.approx(0.0, abs=1e-15)


def test_var_and_expected_shortfall():
    """VaR = 95% quantile of losses; ES = mean of losses at or beyond VaR [Fabozzi MFM, p. 749]."""
    r = series(-np.arange(1, 101) / 1000.0)  # losses 0.001 .. 0.100
    var = metrics.var_historical(r, 0.95)
    assert var == pytest.approx(np.quantile(np.arange(1, 101) / 1000.0, 0.95))
    losses = np.arange(1, 101) / 1000.0
    assert metrics.cvar_historical(r, 0.95) == pytest.approx(losses[losses >= var].mean())
    assert metrics.cvar_historical(r) >= var


def test_sortino_uses_downside_only():
    up = series([0.01, 0.02, -0.01, 0.03])
    downside = math.sqrt(np.mean(np.minimum(up.values, 0) ** 2))
    assert metrics.sortino(up) == pytest.approx(math.sqrt(252) * up.mean() / downside)


def test_risk_free_series_is_aligned():
    r = series([0.001, 0.002, 0.003])
    rf = pd.Series([0.0001], index=[r.index[0]])  # forward-filled to every day
    assert metrics.sharpe(r, rf) == pytest.approx(metrics.sharpe(r - 0.0001, 0.0))


def test_summary_has_exposure_and_turnover():
    r = series([0.01, 0.0, -0.01, 0.02])
    w = pd.DataFrame({"X": [0.0, 1.0, 1.0, 0.0]}, index=r.index)
    s = metrics.summary(r, 0.0, w)
    assert s["exposure"] == pytest.approx(0.5)
    assert s["turnover"] > 0


# ---------------------------------------------------------------- EDGE CASE

def test_flat_and_empty_series():
    flat = series([0.0] * 10)
    assert math.isnan(metrics.sharpe(flat))
    assert metrics.max_drawdown(flat) == 0.0
    assert metrics.max_drawdown_duration(flat) == 0
    assert math.isnan(metrics.cagr(series([])))
    assert math.isnan(metrics.var_historical(series([])))
