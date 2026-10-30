"""Performance and risk metrics for daily return series.

Conventions: simple daily returns; 252 trading days a year; the risk-free rate is a daily series
of simple returns (or a constant annual rate divided by 252, as in [Chan QT2e, p. 50]).

Citations (printed page numbers):
  Sharpe ratio, annualised by sqrt(N_T) ........ [Chan QT2e, pp. 49-50]
  Drawdown, max drawdown and its duration ...... [Chan QT2e, pp. 23, 54-55]
  Kelly leverage f = m / s^2 ........................... [Chan QT2e, pp. 113, 132]
  Levered growth g = r + f m - s^2 f^2 / 2 ............. [Chan QT2e, p. 131]
  Historical-simulation VaR ..................... [Hardle et al. AQF, p. 64]
  Expected shortfall ES = E[L | L >= VaR] ....... [Fabozzi MFM, p. 749]
  Sortino ratio, Calmar ratio, CAGR ............ outside library (standard definitions)
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

DAYS = 252


def _rf_daily(returns: pd.Series, rf: float | pd.Series) -> pd.Series:
    if isinstance(rf, pd.Series):
        return rf.reindex(returns.index).ffill().fillna(0.0)
    return pd.Series(rf / DAYS, index=returns.index)


def equity_curve(returns: pd.Series, start: float = 1.0) -> pd.Series:
    return start * (1.0 + returns.fillna(0.0)).cumprod()


def cagr(returns: pd.Series) -> float:
    """Compound annual growth rate. Outside library (standard definition)."""
    r = returns.dropna()
    if r.empty:
        return float("nan")
    growth = float((1.0 + r).prod())
    return growth ** (DAYS / len(r)) - 1.0 if growth > 0 else -1.0


def annual_vol(returns: pd.Series) -> float:
    """Annualised volatility: sample std of daily returns x sqrt(252) [Chan QT2e, p. 49]."""
    return float(returns.dropna().std(ddof=1) * math.sqrt(DAYS))


def sharpe(returns: pd.Series, rf: float | pd.Series = 0.0) -> float:
    """Annualised Sharpe ratio = sqrt(252) x mean(excess daily return) / std(excess daily return).

    [Chan QT2e, pp. 49-50]: annualise a per-period Sharpe ratio by sqrt(N_T), N_T = 252 for daily
    returns; excess return = daily return - risk-free/252; std is the sample std (STDEV)."""
    r = returns.dropna()
    excess = r - _rf_daily(r, rf)
    sd = excess.std(ddof=1)
    return float(math.sqrt(DAYS) * excess.mean() / sd) if sd > 0 else float("nan")


def sortino(returns: pd.Series, rf: float | pd.Series = 0.0) -> float:
    """Like Sharpe, but divides by downside deviation (RMS of negative excess returns). Outside library."""
    r = returns.dropna()
    excess = r - _rf_daily(r, rf)
    downside = math.sqrt(float((np.minimum(excess, 0.0) ** 2).mean()))
    return float(math.sqrt(DAYS) * excess.mean() / downside) if downside > 0 else float("nan")


def drawdowns(returns: pd.Series) -> pd.Series:
    """Drawdown at each date: equity / high watermark - 1 (<= 0) [Chan QT2e, pp. 23, 55]."""
    eq = equity_curve(returns)
    return eq / eq.cummax() - 1.0


def max_drawdown(returns: pd.Series) -> float:
    """Largest peak-to-trough fall, as a negative fraction [Chan QT2e, p. 23]."""
    dd = drawdowns(returns)
    return float(dd.min()) if len(dd) else float("nan")


def max_drawdown_duration(returns: pd.Series) -> int:
    """Longest run of trading days spent below a previous high watermark [Chan QT2e, pp. 23, 55]."""
    under = (drawdowns(returns) < 0).astype(int)
    if not under.any():
        return 0
    return int(under.groupby((under == 0).cumsum()).sum().max())


def calmar(returns: pd.Series) -> float:
    """CAGR / |max drawdown|. Outside library."""
    mdd = max_drawdown(returns)
    return cagr(returns) / abs(mdd) if mdd < 0 else float("nan")


def var_historical(returns: pd.Series, level: float = 0.95) -> float:
    """One-day historical-simulation VaR at `level`, as a positive loss fraction.

    The empirical loss distribution is the history of daily losses [Hardle et al. AQF, p. 64];
    VaR is its `level` quantile [Fabozzi MFM, p. 749]."""
    losses = -returns.dropna()
    return float(np.quantile(losses, level)) if len(losses) else float("nan")


def cvar_historical(returns: pd.Series, level: float = 0.95) -> float:
    """Expected shortfall ES = E[L | L >= VaR] over the historical losses [Fabozzi MFM, p. 749]."""
    losses = -returns.dropna()
    if losses.empty:
        return float("nan")
    var = np.quantile(losses, level)
    return float(losses[losses >= var].mean())


def kelly_leverage(returns: pd.Series, rf: float | pd.Series = 0.0) -> float:
    """Optimal Kelly leverage f = m / s^2, with m the mean excess return and s the std of returns.

    [Chan QT2e, pp. 113, 132]. f is the same at any time scale. Estimates of m are noisy and returns
    aren't Gaussian, so traders use half Kelly, or less if the worst historical loss demands it
    [Chan QT2e, pp. 112, 122-123]."""
    r = returns.dropna()
    excess = r - _rf_daily(r, rf)
    var = r.var(ddof=1)
    return float(excess.mean() / var) if var > 0 else float("nan")


def kelly_growth(mean: float, std: float, rf: float = 0.0, leverage: float = 1.0) -> float:
    """Long-run compounded growth g = r + f*m - f^2 s^2 / 2 of a leveraged position (annual inputs).

    Gaussian returns [Chan QT2e, p. 131]; with f = 1 it is g = r + m - s^2/2 [Chan QT2e, p. 113],
    m being the mean excess return."""
    m = mean - rf
    return rf + leverage * m - (leverage * std) ** 2 / 2.0


def summary(returns: pd.Series, rf: float | pd.Series = 0.0, weights: pd.DataFrame | None = None) -> dict:
    """All headline metrics for one return series (and exposure/turnover when weights are given)."""
    r = returns.dropna()
    out = {
        "start": str(r.index.min().date()) if len(r) else None,
        "end": str(r.index.max().date()) if len(r) else None,
        "years": round(len(r) / DAYS, 2),
        "total_return": float((1.0 + r).prod() - 1.0) if len(r) else float("nan"),
        "cagr": cagr(r),
        "vol": annual_vol(r),
        "sharpe": sharpe(r, rf),
        "sortino": sortino(r, rf),
        "max_drawdown": max_drawdown(r),
        "max_dd_days": max_drawdown_duration(r),
        "calmar": calmar(r),
        "var95": var_historical(r, 0.95),
        "cvar95": cvar_historical(r, 0.95),
        "hit_rate": float((r > 0).sum() / max(1, (r != 0).sum())),
    }
    if weights is not None:
        w = weights.reindex(r.index).fillna(0.0)
        out["exposure"] = float(w.abs().sum(axis=1).mean())
        out["turnover"] = float(w.diff().abs().sum(axis=1).sum() / max(out["years"], 1e-9))
    return out
