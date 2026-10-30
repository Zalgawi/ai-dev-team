"""End-to-end assessment of a strategy, as shown on the dashboard.

  research instrument (long history) -> walk-forward out-of-sample backtest with costs
  -> benchmark and fixed-parameter comparisons -> parameter sensitivity (in-sample, labelled)
  -> Monte Carlo risk of the out-of-sample returns -> today's signal -> manual order ticket
  sized in the trading instrument.

Run `python -m toolkit.pipeline update` to refresh data, `python -m toolkit.pipeline` to print a summary.
"""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass

import numpy as np
import pandas as pd

from . import backtest, data, metrics, montecarlo, signals, walkforward
from .strategies import REGISTRY


@dataclass(frozen=True)
class Market:
    research: str = "SPY"        # long, clean history (US-listed; not buyable by UK retail)
    trade: str = "VUAG.L"        # UK-listed UCITS S&P 500 ETF the human can buy, in GBP
    rf_series: str = "DGS3MO"    # 3-month T-bill yield (% p.a.) from FRED; cash earns this


MARKET = Market()
COST_BPS = 5.0   # per unit traded [Chan QT2e, p. 75]; includes half-spread on a liquid ETF


def update_data(market: Market = MARKET) -> list[dict]:
    """Downloads/refreshes every series the dashboard needs."""
    out = [data.update_prices(market.research), data.update_prices(market.trade)]
    out.append(data.update_fred(market.rf_series))
    return out


def rf_daily(series: pd.Series, index: pd.DatetimeIndex) -> pd.Series:
    """Daily risk-free return from an annual % yield: yield / 100 / 252 [Chan QT2e, p. 50].

    Uses the previous day's published yield, so cash never earns a rate it couldn't have known."""
    s = (series / 100.0 / metrics.DAYS).reindex(index.union(series.index)).ffill().reindex(index)
    return s.shift(1).fillna(0.0)


def _clean(x):
    """JSON-safe: NaN/inf become None, numpy types become Python types."""
    if isinstance(x, dict):
        return {k: _clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_clean(v) for v in x]
    if isinstance(x, (np.floating, float)):
        return None if not np.isfinite(x) else float(x)
    if isinstance(x, np.integer):
        return int(x)
    return x


def _series(s: pd.Series, points: int = 400) -> dict:
    """Downsampled series for charts (always keeps the last point)."""
    s = s.dropna()
    step = max(1, len(s) // points)
    picked = s.iloc[::step]
    if len(s) and picked.index[-1] != s.index[-1]:
        picked = pd.concat([picked, s.iloc[-1:]])
    return {"dates": [str(d.date()) for d in picked.index], "values": [float(v) for v in picked.values]}


def assess(strategy_id: str = "trend-sma", market: Market = MARKET, mc_paths: int = 2000) -> dict:
    strategy = REGISTRY[strategy_id]
    research = data.prices(market.research)
    prices = research[["adj_close"]].rename(columns={"adj_close": market.research})
    rf = rf_daily(data.fred(market.rf_series), prices.index)

    wf = walkforward.run(strategy, prices, rf, cost_bps=COST_BPS)
    oos = wf.result
    start = oos.returns.index[0]
    hold = backtest.run(prices, REGISTRY["buy-hold"].fn(prices), rf, COST_BPS)
    fixed = backtest.run(prices, strategy.fn(prices, **strategy.default), rf, COST_BPS)
    no_cost = backtest.run(prices, oos.targets.reindex(prices.index).fillna(0.0), rf, 0.0)

    def period(res):  # restrict to the out-of-sample period for a fair comparison
        r = res.returns[res.returns.index >= start]
        return metrics.summary(r, rf, res.weights[res.weights.index >= start])

    comparison = {
        "walk_forward": oos.summary(rf),
        "fixed_default": {**period(fixed), "params": strategy.default},
        "buy_and_hold": period(hold),
        "walk_forward_before_costs": period(no_cost),
    }

    # Latest signal: the default/most recent walk-forward parameters, applied to all data so far.
    current_params = wf.windows[-1]["params"]
    targets = strategy.fn(prices, **current_params)[market.research]
    px = prices[market.research]
    detail = {"params": current_params}
    if "window" in current_params:
        sma = px.rolling(current_params["window"]).mean()
        detail.update({"price": float(px.iloc[-1]), "sma": float(sma.iloc[-1]),
                       "distance": float(px.iloc[-1] / sma.iloc[-1] - 1.0)})
    signal = signals.latest(targets, detail)

    trade = data.prices(market.trade)
    trade_meta = data.meta("prices", market.trade)
    tr = trade["adj_close"].pct_change(fill_method=None)
    rs = px.pct_change(fill_method=None)
    both = pd.concat([rs, tr], axis=1, join="inner").dropna()
    tracking = {
        "since": str(both.index[0].date()) if len(both) else None,
        "correlation": float(both.corr().iloc[0, 1]) if len(both) > 2 else None,
        # Daily returns of a London and a New York listing are measured at different closes,
        # so compare monthly returns.
        "monthly_correlation": None,
    }
    monthly = (1 + both).resample("ME").prod() - 1
    if len(monthly) > 3:
        tracking["monthly_correlation"] = float(monthly.corr().iloc[0, 1])

    mc = {
        "one_year": montecarlo.simulate(oos.returns, 1.0, mc_paths),
        "five_years": montecarlo.simulate(oos.returns, 5.0, mc_paths),
        "buy_and_hold_one_year": montecarlo.simulate(hold.returns[hold.returns.index >= start], 1.0, mc_paths),
    }
    ann_mean = float(oos.returns.mean() * metrics.DAYS)
    ann_std = float(oos.returns.std(ddof=1) * np.sqrt(metrics.DAYS))
    rf_ann = float(rf[rf.index >= start].mean() * metrics.DAYS)
    kelly = metrics.kelly_leverage(oos.returns, rf)
    sizing = {
        "kelly": kelly, "half_kelly": kelly / 2,
        "growth_unlevered": metrics.kelly_growth(ann_mean, ann_std, rf_ann, 1.0),
        "note": "Kelly leverage from noisy estimates is an upper bound, not a target. Use at most a "
                "fraction of it (traders use half Kelly) and no leverage on an ISA or cash account. [Chan QT2e, pp. 112-113, 122]",
    }

    trades = oos.trades
    last_trades = [{"date": str(r.date.date()), "symbol": r.symbol, "from": r["from"], "to": r.to}
                   for _, r in trades.tail(12).iterrows()]

    report = {
        "strategy": {"id": strategy.id, "name": strategy.name, "description": strategy.description,
                     "grid": strategy.grid, "default": strategy.default, "citations": strategy.citations},
        "market": {"research": market.research, "trade": market.trade, "trade_currency": trade_meta.get("currency", "GBP"),
                   "rf_series": market.rf_series, "cost_bps": COST_BPS, "execution": "next close after the signal"},
        "signal": signal.to_dict(),
        "trade_price": {"symbol": market.trade, "price": float(trade["close"].iloc[-1]),
                        "as_of": str(trade.index[-1].date()), "currency": trade_meta.get("currency", "GBP")},
        "comparison": comparison,
        "walk_forward": {"trials_per_window": wf.trials, "windows": wf.windows,
                         "train_years": 10, "test_years": 1},
        "sensitivity_in_sample": walkforward.sensitivity(strategy, prices, rf, COST_BPS),
        "charts": {
            "equity": _series(metrics.equity_curve(oos.returns)),
            "equity_buy_hold": _series(metrics.equity_curve(hold.returns[hold.returns.index >= start])),
            "drawdown": _series(metrics.drawdowns(oos.returns)),
            "drawdown_buy_hold": _series(metrics.drawdowns(hold.returns[hold.returns.index >= start])),
            "exposure": _series(oos.weights.sum(axis=1)),
        },
        "monte_carlo": mc,
        "sizing": sizing,
        "tracking": tracking,
        "recent_trades": last_trades,
        "trades_per_year": float(len(trades) / max(comparison["walk_forward"]["years"], 1e-9)),
        "lookahead_check": backtest.no_lookahead(strategy.fn, prices, **current_params),
        "data": data.snapshot(),
    }
    return _clean(report)


def main(argv: list[str]) -> None:
    if argv and argv[0] == "update":
        for row in update_data():
            print(json.dumps(row))
        return
    rep = assess(argv[0] if argv else "trend-sma")
    c = rep["comparison"]
    print(json.dumps({"signal": rep["signal"], "walk_forward": c["walk_forward"], "buy_and_hold": c["buy_and_hold"]}, indent=2))


if __name__ == "__main__":
    main(sys.argv[1:])
