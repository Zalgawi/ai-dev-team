"""Tests for toolkit.montecarlo, toolkit.signals, data quality and the risk-free conversion."""
import numpy as np
import pandas as pd
import pytest

from toolkit import montecarlo, pipeline, signals
from toolkit.data.quality import check_prices
from toolkit.data.sources import drop_unfinished


def daily(values, start="2020-01-01"):
    return pd.Series(values, index=pd.bdate_range(start, periods=len(values)), dtype=float)


# ---------------------------------------------------------------- Monte Carlo

def test_bootstrap_is_seeded_and_resamples_only_observed_returns():
    r = daily(np.linspace(-0.02, 0.02, 200))
    a = montecarlo.bootstrap_paths(r, 100, paths=50, seed=3)
    b = montecarlo.bootstrap_paths(r, 100, paths=50, seed=3)
    assert a.shape == (50, 100)
    assert np.array_equal(a, b)
    assert set(np.round(a.ravel(), 12)) <= set(np.round(r.values, 12))


def test_constant_returns_give_a_certain_outcome():
    out = montecarlo.simulate(daily([0.001] * 300), years=1.0, paths=200)
    expected = 1.001 ** 252 - 1
    for p in ("p5", "p50", "p95"):
        assert out["terminal"][p] == pytest.approx(expected, rel=1e-9)
    assert out["prob_loss"] == 0.0
    assert out["max_drawdown"]["p50"] == 0.0


def test_percentiles_are_ordered_and_fan_ends_at_horizon():
    rng = np.random.default_rng(0)
    out = montecarlo.simulate(daily(0.0003 + 0.01 * rng.standard_normal(2000)), years=1.0, paths=500)
    t = out["terminal"]
    assert t["p5"] <= t["p25"] <= t["p50"] <= t["p75"] <= t["p95"]
    assert out["fan"]["day"][-1] == 252
    assert 0.0 <= out["prob_loss"] <= 1.0


def test_bootstrap_rejects_bad_input():
    with pytest.raises(ValueError):
        montecarlo.bootstrap_paths(daily([0.01]), 10)
    with pytest.raises(ValueError):
        montecarlo.bootstrap_paths(daily([0.01, 0.02]), 0)


# ---------------------------------------------------------------- signals and tickets

def test_latest_signal_reports_changes_and_since():
    s = signals.latest(daily([0, 0, 1, 1, 1]))
    assert (s.target, s.previous, s.changed) == (1.0, 1.0, False)
    assert s.since == str(pd.bdate_range("2020-01-01", periods=5)[2].date())
    assert signals.latest(daily([1, 1, 0])).changed


def sig(target, previous=None):
    return signals.Signal("2026-10-29", target, target if previous is None else previous,
                          previous is not None and previous != target, "2026-04-08", {})


def test_ticket_buys_whole_units_to_reach_the_target():
    t = signals.ticket(sig(1.0), "VUAG.L", 111.74, "GBP", 10_000)
    assert (t.action, t.units, t.target_units) == ("BUY", 89, 89)
    assert t.limit == pytest.approx(111.74 * 1.005, abs=0.01)
    assert t.value == pytest.approx(89 * 111.74, abs=0.01)


def test_ticket_sells_when_the_signal_goes_to_cash():
    t = signals.ticket(sig(0.0, 1.0), "VUAG.L", 100.0, "GBP", 10_000, current_units=95)
    assert (t.action, t.units, t.target_units) == ("SELL", 95, 0)
    assert t.limit == pytest.approx(99.5)


def test_ticket_holds_and_respects_the_allocation_cap():
    hold = signals.ticket(sig(1.0), "VUAG.L", 100.0, "GBP", 10_000, current_units=100)
    assert hold.action == "HOLD" and hold.units == 0 and hold.est_cost == 0
    capped = signals.ticket(sig(1.0), "VUAG.L", 100.0, "GBP", 10_000, max_allocation=0.5)
    assert capped.target_units == 50
    assert any("Capped at 50%" in n for n in capped.notes)


def test_ticket_flags_tiny_orders_and_rejects_bad_input():
    t = signals.ticket(sig(1.0), "VUAG.L", 100.0, "GBP", 10_150, current_units=100, commission=10.0)
    assert t.units == 1 and any("small relative to the commission" in n for n in t.notes)
    with pytest.raises(ValueError):
        signals.ticket(sig(1.0), "VUAG.L", 100.0, "GBP", 0)
    with pytest.raises(ValueError):
        signals.ticket(sig(1.0), "VUAG.L", 100.0, "GBP", 1000, current_units=-1)


# ---------------------------------------------------------------- data

def frame(px, start="2020-01-01"):
    idx = pd.bdate_range(start, periods=len(px))
    return pd.DataFrame({"adj_close": px, "close": px, "split": 1.0}, index=idx)


def test_quality_flags_jumps_gaps_and_stale_prices():
    assert check_prices(frame([100, 101, 102, 101]))["ok"]
    jump = check_prices(frame([100, 101, 150, 151]))
    assert not jump["ok"] and "+48.5%" in jump["issues"][0]
    stale = check_prices(frame([100] * 8 + [101]))
    assert any("unchanged" in i for i in stale["issues"])
    gappy = frame([100, 101, 102])
    gappy.index = pd.to_datetime(["2020-01-01", "2020-01-02", "2020-02-03"])
    assert any("gap" in i for i in check_prices(gappy)["issues"])


def test_unfinished_bar_is_dropped_until_the_exchange_closes():
    df = frame([100, 101, 102], start="2026-10-28")  # last bar dated 2026-10-30
    during = pd.Timestamp("2026-10-30 18:00", tz="UTC")   # 14:00 New York
    after = pd.Timestamp("2026-10-30 21:00", tz="UTC")    # 17:00 New York
    assert drop_unfinished(df, "SPY", during).index[-1].date().isoformat() == "2026-10-29"
    assert len(drop_unfinished(df, "SPY", after)) == 3
    london_open = pd.Timestamp("2026-10-30 12:00", tz="UTC")
    assert len(drop_unfinished(df, "VUAG.L", london_open)) == 2


def test_risk_free_rate_is_lagged_and_daily():
    idx = pd.bdate_range("2024-01-01", periods=4)
    yields = pd.Series([5.04, 2.52], index=[idx[0], idx[2]])
    rf = pipeline.rf_daily(yields, idx)
    assert rf.iloc[0] == 0.0                                  # yesterday's rate unknown
    assert rf.iloc[1] == pytest.approx(5.04 / 100 / 252)      # [Chan QT2e, p. 50]: rate / 252
    assert rf.iloc[3] == pytest.approx(2.52 / 100 / 252)
