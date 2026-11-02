"""Tests for toolkit.pricing.binomial.

Labels as in test_black_scholes.py: KNOWN-ANSWER (book), RECONSTRUCTED (book numbers, parameters
not printed), CONSISTENCY, INVALID INPUT. Citations use printed page numbers of PWOQF 2nd ed.
"""
import math

import pytest

from toolkit.pricing import (
    binomial_price,
    bs_price,
    one_step_delta,
    one_step_value,
    risk_neutral_probability,
    tree_params,
)

# ---------------------------------------------------------------- KNOWN-ANSWER (book)


def test_known_answer_first_example_r0_p262_268():
    """KNOWN-ANSWER (book). [PWOQF, Vol 1, Ch. 15, §15.2-15.6.1, pp. 262-268]: S = 100 moves to 101 or
    99 tomorrow, call strike 100, r = 0. Delta = 0.5 and option value 0.5 (p. 268; p'=0.5, p. 273).
    Tolerance: 1e-12 (exact arithmetic in the book)."""
    u, v, S = 1.01, 0.99, 100.0
    assert abs(one_step_delta(1.0, 0.0, S, u, v) - 0.5) < 1e-12
    assert abs(one_step_value(1.0, 0.0, u, v, 0.0) - 0.5) < 1e-12
    assert abs(risk_neutral_probability(u, v, 0.0) - 0.5) < 1e-12


def test_known_answer_second_example_103_98_p268():
    """KNOWN-ANSWER (book). [PWOQF, Vol 1, Ch. 15, §15.6, p. 268]: S = 100 moves to 103 or 98, call
    strike 100 (payoffs 3 and 0), r = 0. Delta = 3/5 = 0.6 and "the option value is 1.2".
    Tolerance: 1e-12."""
    u, v, S = 1.03, 0.98, 100.0
    assert abs(one_step_delta(3.0, 0.0, S, u, v) - 0.6) < 1e-12
    assert abs(one_step_value(3.0, 0.0, u, v, 0.0) - 1.2) < 1e-12


def test_known_answer_with_interest_p269_p274():
    """KNOWN-ANSWER (book). [PWOQF, Vol 1, Ch. 15, §15.7, p. 269 and §15.10.1, p. 274]: first example
    with r = 0.1, one day = 1/252 year, discount 1/(1 + 0.1/252) = 0.9996, option value 0.51963,
    risk-neutral probability p' = 0.51984. Tolerance: 5e-6 (book prints 5 decimal places; it rounds the
    discount factor to 0.9996 in the intermediate step, exact value 0.999603)."""
    u, v, r_dt = 1.01, 0.99, 0.1 / 252
    assert abs(1 / (1 + r_dt) - 0.9996) < 5e-5
    assert abs(risk_neutral_probability(u, v, r_dt) - 0.51984) < 5e-6
    assert abs(one_step_value(1.0, 0.0, u, v, r_dt) - 0.51963) < 1e-5
    assert abs(0.9996 * round(risk_neutral_probability(u, v, r_dt), 5) - 0.51963) < 5e-6
    # same answer from the book's closed form p' = 1/2 + r sqrt(dt)/(2 sigma), with sigma sqrt(dt) = 0.01
    dt = 1 / 252
    tp = tree_params(0.01 / math.sqrt(dt), 0.1, dt, scheme="wilmott")
    assert abs(tp.u - u) < 1e-12 and abs(tp.v - v) < 1e-12
    assert abs(tp.p - 0.51984) < 5e-6
    assert abs(tp.disc * tp.p * 1.0 - 0.51963) < 1e-5


# ---------------------------------------------------------------- RECONSTRUCTED (book tree)

FIG_15_32 = {  # printed option-price tree, Figure 15.32 [PWOQF, Vol 1, Ch. 15, §15.17, p. 285]
    (4, 4): 26.42, (4, 3): 12.44, (4, 2): 0.0, (4, 1): 0.0, (4, 0): 0.0,
    (3, 3): 20.05, (3, 2): 6.87, (3, 1): 0.0, (3, 0): 0.0,
    (2, 2): 14.09, (2, 1): 3.79, (2, 0): 0.0,
    (1, 1): 9.45, (1, 0): 2.09,
    (0, 0): 6.13,
}
FIG_15_32_ASSET = {(1, 1): 106.04, (1, 0): 94.31, (2, 2): 112.44, (2, 0): 88.94, (3, 3): 119.22,
                   (3, 0): 83.88, (4, 4): 126.42, (4, 0): 79.10}


def test_reconstructed_fig_15_32_tree_6_13():
    """RECONSTRUCTED (book numbers, parameters not printed). Figures 15.25-15.32
    [PWOQF, Vol 1, Ch. 15, §15.17, pp. 282-285]: 4-step call, S = 100, strike 100, value 6.13. The book
    does not print sigma, r or dt. Fitting the printed asset tree gives u = e^{0.05861}, v = 1/u and the
    option tree is reproduced by the hedging step of Eq. (15.2) (discount 1/(1 + r dt)) with
    r dt = 0.00837. This is a consistency test of one_step_value on a full tree, not a pure known-answer
    test. Tolerance: 0.006 on every printed node (book rounds to 2 dp)."""
    u = math.exp(0.05861)
    v = 1 / u
    r_dt = 0.00837
    for (n, j), s in FIG_15_32_ASSET.items():
        assert abs(100 * u**j * v ** (n - j) - s) < 0.006
    vals = {(4, j): max(100 * u**j * v ** (4 - j) - 100, 0.0) for j in range(5)}
    for n in range(3, -1, -1):
        for j in range(n + 1):
            vals[(n, j)] = one_step_value(vals[(n + 1, j + 1)], vals[(n + 1, j)], u, v, r_dt)
    for node, printed in FIG_15_32.items():
        assert abs(vals[node] - printed) < 0.006, (node, vals[node], printed)


# ---------------------------------------------------------------- CONSISTENCY


@pytest.mark.parametrize("scheme", ["appendix", "wilmott"])
@pytest.mark.parametrize("kind", ["call", "put"])
@pytest.mark.parametrize("S,E", [(100, 100), (90, 100), (110, 100)])
def test_binomial_converges_to_black_scholes(scheme, kind, S, E):
    """CONSISTENCY. European binomial price -> Black-Scholes as dt -> 0
    ([PWOQF, Vol 1, Ch. 15, §15.21, p. 291]: (15.2) becomes the Black-Scholes equation).
    T = 1, sigma = 0.2, r = 0.05. Tolerance: |tree(N=2000) - BS| < 0.005 currency (about 0.05% of S)."""
    bs = bs_price(kind, S, E, 1.0, 0.2, 0.05)
    tree = binomial_price(S, E, 1.0, 0.2, 0.05, 2000, kind=kind, scheme=scheme)
    assert abs(tree - bs) < 0.005, (tree, bs)


def test_binomial_error_shrinks_with_steps():
    """CONSISTENCY. Error vs Black-Scholes at N = 1000 is smaller than at N = 50 (both schemes)."""
    bs = bs_price("put", 100, 105, 0.5, 0.3, 0.04)
    for scheme in ("appendix", "wilmott"):
        e50 = abs(binomial_price(100, 105, 0.5, 0.3, 0.04, 50, kind="put", scheme=scheme) - bs)
        e1000 = abs(binomial_price(100, 105, 0.5, 0.3, 0.04, 1000, kind="put", scheme=scheme) - bs)
        assert e1000 < e50


def test_american_vs_european():
    """CONSISTENCY. [PWOQF, Vol 1, Ch. 2, §2.11, p. 41]: American options are never worth less than the
    European. With no dividends the American call is worth exactly the European call on the same tree
    (early exercise never optimal); the American put carries a strictly positive premium.
    Tolerance: 1e-9 for the call equality."""
    args = (100, 100, 1.0, 0.2, 0.05, 500)
    ec = binomial_price(*args, kind="call")
    ac = binomial_price(*args, kind="call", american=True)
    ep = binomial_price(*args, kind="put")
    ap = binomial_price(*args, kind="put", american=True)
    assert abs(ac - ec) < 1e-9
    assert ap > ep + 0.1
    # American put is at least intrinsic value everywhere it is tested
    for S in (60, 80, 100):
        assert binomial_price(S, 100, 1.0, 0.2, 0.05, 200, kind="put", american=True) >= 100 - S - 1e-12


def test_american_put_converges():
    """CONSISTENCY. American put (S = E = 100, T = 1, sigma = 0.2, r = 0.05): N = 1000 and N = 2000 agree
    within 0.005, and both schemes agree within 0.01. EXTERNAL REFERENCE: the commonly quoted converged
    value for these inputs is about 6.09 (tolerance 0.01)."""
    a1 = binomial_price(100, 100, 1.0, 0.2, 0.05, 1000, kind="put", american=True)
    a2 = binomial_price(100, 100, 1.0, 0.2, 0.05, 2000, kind="put", american=True)
    w2 = binomial_price(100, 100, 1.0, 0.2, 0.05, 2000, kind="put", american=True, scheme="wilmott")
    assert abs(a1 - a2) < 0.005
    assert abs(a2 - w2) < 0.01
    assert abs(a2 - 6.09) < 0.01


def test_tree_parameters_match_moments():
    """CONSISTENCY. Appendix scheme satisfies (15.4) uv = 1, (15.5) p u + (1-p) v = e^{r dt} and (15.6)
    p u^2 + (1-p) v^2 = e^{(2r + sigma^2) dt} [PWOQF, Vol 1, Ch. 15, App., pp. 293-294] with mu -> r;
    Wilmott scheme has mean (1 + r dt) S [§15.11.1, p. 275 with mu -> r]. Tolerance 1e-12."""
    sigma, r, dt = 0.25, 0.04, 0.01
    a = tree_params(sigma, r, dt, "appendix")
    assert abs(a.u * a.v - 1) < 1e-12
    assert abs(a.p * a.u + (1 - a.p) * a.v - math.exp(r * dt)) < 1e-12
    assert abs(a.p * a.u**2 + (1 - a.p) * a.v**2 - math.exp((2 * r + sigma**2) * dt)) < 1e-12
    w = tree_params(sigma, r, dt, "wilmott")
    assert abs(w.p * w.u + (1 - w.p) * w.v - (1 + r * dt)) < 1e-12


def test_zero_rate_and_custom_payoff():
    """CONSISTENCY. With r = 0 the tree value of a forward-like payoff S - E is S - E exactly
    (risk-neutral mean is S); payoff= hook works. Tolerance 1e-9."""
    v = binomial_price(100, 90, 1.0, 0.3, 0.0, 300, payoff=lambda s: s - 90)
    assert abs(v - 10) < 1e-9


# ---------------------------------------------------------------- INVALID INPUT


@pytest.mark.parametrize("bad", [dict(S=0), dict(S=-5), dict(E=0), dict(T=0), dict(T=-1),
                                 dict(sigma=0), dict(sigma=-0.2), dict(steps=0), dict(steps=2.5)])
def test_invalid_inputs_raise(bad):
    """INVALID INPUT. Zero/negative price, strike, time, volatility or step count raise ValueError."""
    args = dict(S=100.0, E=100.0, T=1.0, sigma=0.2, r=0.05, steps=10)
    args.update(bad)
    with pytest.raises(ValueError):
        binomial_price(args["S"], args["E"], args["T"], args["sigma"], args["r"], args["steps"])


def test_invalid_tree_and_one_step_inputs():
    """INVALID INPUT. Wilmott scheme with sigma sqrt(dt) >= 1 (v <= 0); p' outside (0,1) (r sqrt(dt) > sigma);
    one-step functions with u <= v or S <= 0; unknown kind or scheme."""
    with pytest.raises(ValueError):
        tree_params(2.0, 0.05, 1.0, "wilmott")
    with pytest.raises(ValueError):
        tree_params(0.1, 5.0, 0.01, "wilmott")
    with pytest.raises(ValueError):
        one_step_delta(1, 0, 100, 0.99, 1.01)
    with pytest.raises(ValueError):
        one_step_delta(1, 0, 0, 1.01, 0.99)
    with pytest.raises(ValueError):
        one_step_value(1, 0, 0.99, 0.99, 0.0)
    with pytest.raises(ValueError):
        binomial_price(100, 100, 1, 0.2, 0.05, 10, kind="straddle")
    with pytest.raises(ValueError):
        tree_params(0.2, 0.05, 0.01, "trinomial")
