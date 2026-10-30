"""Black-Scholes closed-form values and greeks for calls, puts and simple (cash-or-nothing) digitals.

Source: Paul Wilmott On Quantitative Finance, 2nd ed. (Wiley, 2006), "PWOQF", Vol 1, Ch. 7.
Every formula below was transcribed from Table 7.1 [PWOQF, Vol 1, Ch. 7, §7.11, p. 137] and checked
against the rendered page image (see library/wilmott-pwoqf/FORMULAS.md, entries F7.x).

Conventions (all functions):
  S      underlying price (> 0), currency units
  E      strike (> 0), same currency units
  tau    time to expiry T - t in YEARS (> 0)
  sigma  volatility, annualised, as a decimal (0.2 = 20%) (> 0)
  r      continuously compounded risk-free rate per year, decimal
  D      continuous dividend yield (or foreign rate for FX) per year, decimal
Digitals pay 1 unit of currency if they finish in the money (Heaviside payoff), p. 119-120.
Greeks are partial derivatives in these units: theta is dV/dt per YEAR (divide by 365 or 252 for
per-day), vega is dV/dsigma per unit of sigma (divide by 100 for "per vol point"), rho is dV/dr per
unit of r. Model assumptions (Ch. 5-7): lognormal asset, constant sigma, r, D; frictionless,
continuous delta hedging, European exercise.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from .normal import norm_cdf as N
from .normal import norm_pdf as Np

KINDS = ("call", "put", "binary_call", "binary_put")


def _check(S: float, E: float, tau: float, sigma: float) -> None:
    for name, v in (("S", S), ("E", E), ("tau", tau), ("sigma", sigma)):
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v):
            raise ValueError(f"{name} must be a finite number, got {v!r}")
    if S <= 0:
        raise ValueError(f"underlying price S must be > 0, got {S}")
    if E <= 0:
        raise ValueError(f"strike E must be > 0, got {E}")
    if tau <= 0:
        raise ValueError(f"time to expiry tau must be > 0 years, got {tau}")
    if sigma <= 0:
        raise ValueError(f"volatility sigma must be > 0, got {sigma}")


def d1_d2(S: float, E: float, tau: float, sigma: float, r: float, D: float = 0.0) -> tuple[float, float]:
    """d1 = [log(S/E) + (r - D + sigma^2/2) tau] / (sigma sqrt(tau)),  d2 = d1 - sigma sqrt(tau).

    Citation: [PWOQF, Vol 1, Ch. 7, §7.2.1, p. 116] (with dividend yield D) and Table 7.1 [p. 137].
    Units: dimensionless. Raises ValueError for S, E, tau or sigma <= 0.
    """
    _check(S, E, tau, sigma)
    sq = sigma * math.sqrt(tau)
    d1 = (math.log(S / E) + (r - D + 0.5 * sigma * sigma) * tau) / sq
    return d1, d1 - sq


def bs_price(kind: str, S: float, E: float, tau: float, sigma: float, r: float, D: float = 0.0) -> float:
    """Black-Scholes value of a European call, put, binary call or binary put.

    call        = S e^{-D tau} N(d1) - E e^{-r tau} N(d2)          [PWOQF, Vol 1, Ch. 7, §7.2.1, p. 116]
    put         = -S e^{-D tau} N(-d1) + E e^{-r tau} N(-d2)       [PWOQF, Vol 1, Ch. 7, §7.2.2, p. 118]
    binary_call = e^{-r tau} N(d2)                                  [PWOQF, Vol 1, Ch. 7, §7.2.3, p. 120]
    binary_put  = e^{-r tau} (1 - N(d2))                            [PWOQF, Vol 1, Ch. 7, §7.2.4, p. 120]
    (all reproduced in Table 7.1, [PWOQF, Vol 1, Ch. 7, §7.11, p. 137]).
    Units: currency per option (binaries pay 1 currency unit). Assumptions: see module docstring.
    """
    d1, d2 = d1_d2(S, E, tau, sigma, r, D)
    dfr, dfd = math.exp(-r * tau), math.exp(-D * tau)
    if kind == "call":
        return S * dfd * N(d1) - E * dfr * N(d2)
    if kind == "put":
        return -S * dfd * N(-d1) + E * dfr * N(-d2)
    if kind == "binary_call":
        return dfr * N(d2)
    if kind == "binary_put":
        return dfr * (1.0 - N(d2))
    raise ValueError(f"kind must be one of {KINDS}, got {kind!r}")


@dataclass(frozen=True)
class Greeks:
    """Value and sensitivities from Table 7.1 [PWOQF, Vol 1, Ch. 7, §7.11, p. 137]."""

    value: float
    delta: float  # dV/dS
    gamma: float  # d2V/dS2
    theta: float  # dV/dt, per year (t is calendar time, so theta = -dV/dtau)
    speed: float  # d3V/dS3
    vega: float  # dV/dsigma
    rho: float  # dV/dr
    rho_dividend: float  # dV/dD


def bs_greeks(kind: str, S: float, E: float, tau: float, sigma: float, r: float, D: float = 0.0) -> Greeks:
    """Value, delta, gamma, theta, speed, vega, rho (r) and rho (D) for calls, puts and binaries.

    Every expression is one cell of Table 7.1 [PWOQF, Vol 1, Ch. 7, §7.11, p. 137]; the same
    formulae appear in the text in §7.3 (delta, p. 122), §7.4 (gamma, p. 124), §7.5 (theta, p. 125),
    §7.6 (speed, p. 126), §7.7 (vega, p. 128) and §7.8 (rho, p. 129).
    Units: delta per unit of S; gamma per S^2; speed per S^3; theta per year; vega per unit sigma;
    rho per unit r. Raises ValueError for invalid inputs (S, E, tau, sigma <= 0) or unknown kind.
    """
    d1, d2 = d1_d2(S, E, tau, sigma, r, D)
    st = math.sqrt(tau)
    dfr, dfd = math.exp(-r * tau), math.exp(-D * tau)
    v = bs_price(kind, S, E, tau, sigma, r, D)
    if kind == "call":
        return Greeks(
            value=v,
            delta=dfd * N(d1),
            gamma=dfd * Np(d1) / (sigma * S * st),
            theta=-sigma * S * dfd * Np(d1) / (2 * st) + D * S * N(d1) * dfd - r * E * dfr * N(d2),
            speed=-dfd * Np(d1) / (sigma**2 * S**2 * tau) * (d1 + sigma * st),
            vega=S * st * dfd * Np(d1),
            rho=E * tau * dfr * N(d2),
            rho_dividend=-tau * S * dfd * N(d1),
        )
    if kind == "put":
        return Greeks(
            value=v,
            delta=dfd * (N(d1) - 1.0),
            gamma=dfd * Np(d1) / (sigma * S * st),
            theta=-sigma * S * dfd * Np(-d1) / (2 * st) - D * S * N(-d1) * dfd + r * E * dfr * N(-d2),
            speed=-dfd * Np(d1) / (sigma**2 * S**2 * tau) * (d1 + sigma * st),
            vega=S * st * dfd * Np(d1),
            rho=-E * tau * dfr * N(-d2),
            rho_dividend=tau * S * dfd * N(-d1),
        )
    if kind in ("binary_call", "binary_put"):
        sgn = 1.0 if kind == "binary_call" else -1.0
        th_bracket = d1 / (2 * tau) - (r - D) / (sigma * st)
        theta = (r * dfr * N(d2) + dfr * Np(d2) * th_bracket) if sgn > 0 else (
            r * dfr * (1.0 - N(d2)) - dfr * Np(d2) * th_bracket)
        rho = (-tau * dfr * N(d2) + st / sigma * dfr * Np(d2)) if sgn > 0 else (
            -tau * dfr * (1.0 - N(d2)) - st / sigma * dfr * Np(d2))
        return Greeks(
            value=v,
            delta=sgn * dfr * Np(d2) / (sigma * S * st),
            gamma=-sgn * dfr * d1 * Np(d2) / (sigma**2 * S**2 * tau),
            theta=theta,
            speed=-sgn * dfr * Np(d2) / (sigma**2 * S**3 * tau) * (-2 * d1 + (1 - d1 * d2) / (sigma * st)),
            vega=-sgn * dfr * Np(d2) * (st + d2 / sigma),
            rho=rho,
            rho_dividend=-sgn * st / sigma * dfr * Np(d2),
        )
    raise ValueError(f"kind must be one of {KINDS}, got {kind!r}")


def implied_vol_call(price: float, S: float, E: float, tau: float, r: float, D: float = 0.0,
                     tol: float = 1e-10, max_iter: int = 100, sigma0: float = 0.2) -> float:
    """Implied volatility of a European call by Newton-Raphson on sigma using vega.

    Algorithm: [PWOQF, Vol 1, Ch. 7, §7.9, p. 130] (VB function ImpVolCall: start at 0.2, step
    dv = PriceError / Vega until |dv| < error). Extended here with the dividend yield D of p. 116 and
    an iteration cap. The book notes a unique solution exists only if
    max(S e^{-D tau} - E e^{-r tau}, 0) < price < S e^{-D tau}; outside that a ValueError is raised.
    Units: returns sigma as an annualised decimal.
    """
    _check(S, E, tau, sigma0)
    lower = max(S * math.exp(-D * tau) - E * math.exp(-r * tau), 0.0)
    upper = S * math.exp(-D * tau)
    if not (lower < price < upper):
        raise ValueError(f"call price {price} outside no-arbitrage bounds ({lower:.6g}, {upper:.6g})")
    sigma = sigma0
    for _ in range(max_iter):
        g = bs_greeks("call", S, E, tau, sigma, r, D)
        dv = (g.value - price) / g.vega
        sigma -= dv
        if sigma <= 0:  # safeguard the book's plain Newton step
            sigma = 1e-4
        if abs(dv) < tol:
            return sigma
    raise ValueError("implied volatility did not converge")
