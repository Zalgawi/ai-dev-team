"""Binomial model: one-step delta hedging and recombining trees for European and American options.

Source: Paul Wilmott On Quantitative Finance, 2nd ed. (Wiley, 2006), "PWOQF", Vol 1, Ch. 15.
Formulae transcribed from the converted text and checked against page images (FORMULAS.md, F15.x).

Two tree parameterizations from the book are offered:
  "wilmott"  u = 1 + sigma sqrt(dt), v = 1 - sigma sqrt(dt),  p' = 1/2 + r sqrt(dt) / (2 sigma),
             discount 1/(1 + r dt)                     [§15.11, p. 275; (15.2)-(15.3), p. 278]
  "appendix" uv = 1, p = (e^{r dt} - v)/(u - v), p u^2 + (1-p) v^2 = e^{(2r + sigma^2) dt},
             discount e^{-r dt}                         [Appendix, (15.4)-(15.6), pp. 293-294;
                                                         VB code §15.18 p. 286, §15.19 p. 290]
Units: S, E in currency; T in years; sigma, r annualised decimals; returns currency per option.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable

SCHEMES = ("wilmott", "appendix")


def one_step_delta(v_up: float, v_down: float, S: float, u: float, v: float) -> float:
    """Hedge ratio Delta = (V+ - V-) / ((u - v) S): range of option payoffs over range of asset.

    Citation: [PWOQF, Vol 1, Ch. 15, §15.12.1, p. 277, Eq. (15.1)]; worked form in §15.6.1, p. 268.
    Units: shares of underlying per option. Requires S > 0 and u > v.
    """
    if S <= 0 or not u > v:
        raise ValueError("need S > 0 and u > v")
    return (v_up - v_down) / ((u - v) * S)


def one_step_value(v_up: float, v_down: float, u: float, v: float, r_dt: float) -> float:
    """Option value from one hedged binomial step (no-arbitrage, rate per step r*dt, simple interest).

    (1 + r dt) V = (1 + r dt)(V+ - V-)/(u - v) + (u V- - v V+)/(u - v)
    Citation: [PWOQF, Vol 1, Ch. 15, §15.12.2, p. 277] (last display), equivalent to Eq. (15.2) p. 278.
    Units: currency. Requires u > v and 1 + r dt > 0.
    """
    if not u > v or 1.0 + r_dt <= 0:
        raise ValueError("need u > v and 1 + r dt > 0")
    return ((1.0 + r_dt) * (v_up - v_down) / (u - v) + (u * v_down - v * v_up) / (u - v)) / (1.0 + r_dt)


def risk_neutral_probability(u: float, v: float, r_dt: float) -> float:
    """p' such that (1 + r dt) V = p' V+ + (1 - p') V-, i.e. p' = (1 + r dt - v) / (u - v).

    Obtained by collecting the V+ and V- coefficients of the p. 277 equation; with u, v = 1 +/- sigma
    sqrt(dt) it reduces to the book's p' = 1/2 + r sqrt(dt)/(2 sigma).
    Citation: [PWOQF, Vol 1, Ch. 15, §15.12.2, p. 278, Eqs. (15.2)-(15.3)]; numeric use §15.10.1, p. 274.
    """
    if not u > v:
        raise ValueError("need u > v")
    return (1.0 + r_dt - v) / (u - v)


@dataclass(frozen=True)
class TreeParams:
    u: float  # up factor per step
    v: float  # down factor per step
    p: float  # risk-neutral probability of an up move
    disc: float  # one-step discount factor
    dt: float  # step length in years


def tree_params(sigma: float, r: float, dt: float, scheme: str = "appendix") -> TreeParams:
    """Up/down factors, risk-neutral probability and one-step discount factor for a binomial step.

    scheme="wilmott":  u = 1 + sigma sqrt(dt), v = 1 - sigma sqrt(dt)        [§15.11, p. 275]
                       p' = 1/2 + r sqrt(dt)/(2 sigma), disc = 1/(1 + r dt)   [Eqs. (15.2)-(15.3), p. 278]
    scheme="appendix": u = A + sqrt(A^2 - 1), A = (e^{-r dt} + e^{(r+sigma^2) dt})/2, v = 1/u,
                       p = (e^{r dt} - v)/(u - v), disc = e^{-r dt}
                       [Appendix Eqs. (15.4)-(15.6), pp. 293-294 with mu -> r; VB code §15.18, p. 286]
    Citation: [PWOQF, Vol 1, Ch. 15, §15.11, p. 275] and [PWOQF, Vol 1, Ch. 15, App., p. 294].
    Raises ValueError for sigma <= 0, dt <= 0, or parameters that make p outside (0, 1) or v <= 0
    (the "wilmott" scheme needs sigma sqrt(dt) < 1).
    """
    if not (sigma > 0 and dt > 0 and math.isfinite(sigma) and math.isfinite(dt) and math.isfinite(r)):
        raise ValueError("need sigma > 0 and dt > 0")
    if scheme == "wilmott":
        s = sigma * math.sqrt(dt)
        u, v = 1.0 + s, 1.0 - s
        p = 0.5 + r * math.sqrt(dt) / (2.0 * sigma)
        disc = 1.0 / (1.0 + r * dt)
    elif scheme == "appendix":
        a = 0.5 * (math.exp(-r * dt) + math.exp((r + sigma * sigma) * dt))
        u = a + math.sqrt(a * a - 1.0)
        v = 1.0 / u
        p = (math.exp(r * dt) - v) / (u - v)
        disc = math.exp(-r * dt)
    else:
        raise ValueError(f"scheme must be one of {SCHEMES}")
    if v <= 0 or not (0.0 < p < 1.0):
        raise ValueError(f"invalid tree: v={v:.4g}, p={p:.4g} (reduce the step or check inputs)")
    return TreeParams(u, v, p, disc, dt)


def call_payoff(E: float) -> Callable[[float], float]:
    """max(S - E, 0) [PWOQF, Vol 1, Ch. 7, §7.2.1, p. 114]."""
    return lambda s: max(s - E, 0.0)


def put_payoff(E: float) -> Callable[[float], float]:
    """max(E - S, 0) [PWOQF, Vol 1, Ch. 7, §7.2.2, p. 118]."""
    return lambda s: max(E - s, 0.0)


def binomial_price(S: float, E: float, T: float, sigma: float, r: float, steps: int,
                   kind: str = "call", american: bool = False, scheme: str = "appendix",
                   payoff: Callable[[float], float] | None = None) -> float:
    """Price a European or American option on a recombining binomial tree by backward induction.

    European: V_j^n = disc * (p V_{j+1}^{n+1} + (1-p) V_j^{n+1})
        [PWOQF, Vol 1, Ch. 15, §15.18, p. 286 (VB Price); Eq. (15.2), p. 278]
    American: V_j^n = max(disc * (p V_{j+1}^{n+1} + (1-p) V_j^{n+1}), Payoff(S_j^n))
        [PWOQF, Vol 1, Ch. 15, §15.19, p. 290 (VB USPrice)]
    Nodes S_j^n = S u^j v^(n-j) [§15.19, p. 289]. kind is "call" or "put" unless ``payoff`` is given.
    Units: currency per option; T in years. Raises ValueError for S, E, T, sigma <= 0 or steps < 1.
    """
    if not (isinstance(steps, int) and steps >= 1):
        raise ValueError("steps must be an integer >= 1")
    for name, x in (("S", S), ("E", E), ("T", T), ("sigma", sigma)):
        if not (math.isfinite(x) and x > 0):
            raise ValueError(f"{name} must be > 0, got {x}")
    if payoff is None:
        if kind == "call":
            payoff = call_payoff(E)
        elif kind == "put":
            payoff = put_payoff(E)
        else:
            raise ValueError("kind must be 'call' or 'put' (or pass payoff=)")
    tp = tree_params(sigma, r, T / steps, scheme)
    u, v, p, disc = tp.u, tp.v, tp.p, tp.disc
    values = [payoff(S * u**j * v ** (steps - j)) for j in range(steps + 1)]
    for n in range(steps - 1, -1, -1):
        for j in range(n + 1):
            cont = disc * (p * values[j + 1] + (1.0 - p) * values[j])
            values[j] = max(cont, payoff(S * u**j * v ** (n - j))) if american else cont
    return values[0]
