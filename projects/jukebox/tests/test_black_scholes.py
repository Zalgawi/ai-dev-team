"""Tests for toolkit.pricing.black_scholes and toolkit.pricing.normal.

Test labels:
  KNOWN-ANSWER (book)  reproduces a number stated in PWOQF Vol 1 (tolerance stated per test)
  CONSISTENCY          checks an identity or an independent method (no book number exists)
  EXTERNAL REFERENCE   a widely published value from another textbook
  INVALID INPUT        bad inputs must raise ValueError
Citations: [PWOQF, Vol X, Ch. Y, §Z, p. N], printed page numbers.
"""
import math

import pytest

from toolkit.pricing import bs_greeks, bs_price, d1_d2, implied_vol_call, norm_cdf, norm_cdf_book, norm_pdf

KINDS = ("call", "put", "binary_call", "binary_put")
# A grid of parameter sets (S, E, tau, sigma, r, D) covering ITM/ATM/OTM, short/long expiry, D > 0.
CASES = [
    (100.0, 100.0, 1.0, 0.20, 0.05, 0.00),
    (100.0, 110.0, 0.5, 0.40, 0.05, 0.00),
    (88.0, 100.0, 1.0, 0.24, 0.10, 0.00),
    (120.0, 100.0, 0.25, 0.15, 0.03, 0.02),
    (50.0, 55.0, 2.0, 0.30, 0.01, 0.04),
]


# ---------------------------------------------------------------- KNOWN-ANSWER (book)

def test_known_answer_binary_call_vega_maximum_fig_7_15():
    """KNOWN-ANSWER (book). [PWOQF, Vol 1, Ch. 7, §7.7, p. 129], Figure 7.15: OTM binary call,
    S = 88, E = 100, T - t = 1, r = 10%, D = 0. "Observe that there is maximum at a volatility of
    about 24%." Tolerance: +/- 0.01 in sigma (the book reads the maximum off a chart, "about 24%")."""
    grid = [0.05 + i * 0.0005 for i in range(1000)]  # 5% .. 55%
    values = [bs_price("binary_call", 88, 100, 1.0, s, 0.10) for s in grid]
    s_star = grid[values.index(max(values))]
    assert abs(s_star - 0.24) <= 0.01
    # and the vega formula of Table 7.1 changes sign there (vega = 0 at the maximum)
    assert bs_greeks("binary_call", 88, 100, 1.0, s_star - 0.01, 0.10).vega > 0
    assert bs_greeks("binary_call", 88, 100, 1.0, s_star + 0.01, 0.10).vega < 0


def test_known_answer_atm_forward_approximation_p116():
    """KNOWN-ANSWER (book, approximation). [PWOQF, Vol 1, Ch. 7, §7.2.1, p. 116]: at the money forward,
    S = E e^{-(r-D)(T-t)}, Call ~= 0.4 S e^{-D(T-t)} sigma sqrt(T-t) (Brenner & Subrahmanyam).
    Tolerance: 1% relative for sigma sqrt(T - t) <= 0.2 (0.4 approximates 1/sqrt(2 pi) = 0.3989 and
    the approximation error grows like (sigma^2 tau))."""
    for S, tau, sigma, r, D in [(100, 1.0, 0.2, 0.05, 0.0), (50, 0.25, 0.3, 0.02, 0.01), (100, 0.5, 0.1, 0.08, 0.03)]:
        E = S / math.exp(-(r - D) * tau)
        exact = bs_price("call", S, E, tau, sigma, r, D)
        approx = 0.4 * S * math.exp(-D * tau) * sigma * math.sqrt(tau)
        assert abs(exact / approx - 1) < 0.01
        # p. 118 states the same approximation for the put
        assert abs(bs_price("put", S, E, tau, sigma, r, D) / approx - 1) < 0.01


def test_known_answer_book_cdf_coefficients_p131():
    """KNOWN-ANSWER (book algorithm). [PWOQF, Vol 1, Ch. 7, §7.9, p. 131]: the book's polynomial N(x)
    must agree with the exact N(x) (erf). Tolerance: 1e-7 absolute (stated accuracy class of the
    Abramowitz-Stegun 26.2.17 approximation the book uses)."""
    for i in range(-800, 801):
        x = i / 100
        assert abs(norm_cdf_book(x) - norm_cdf(x)) < 1e-7


# ---------------------------------------------------------------- CONSISTENCY

@pytest.mark.parametrize("S,E,tau,sigma,r,D", CASES)
def test_put_call_parity(S, E, tau, sigma, r, D):
    """CONSISTENCY. Put-call parity C - P = S - E e^{-r(T-t)} [PWOQF, Vol 1, Ch. 2, §2.12, p. 41]
    (D = 0); with dividend yield the Table 7.1 formulae imply C - P = S e^{-D tau} - E e^{-r tau}.
    Binary parity: binary call + binary put = e^{-r(T-t)} [PWOQF, Vol 1, Ch. 7, §7.2.4, p. 121].
    Tolerance: 1e-10 absolute (pure floating-point)."""
    c, p = bs_price("call", S, E, tau, sigma, r, D), bs_price("put", S, E, tau, sigma, r, D)
    assert abs((c - p) - (S * math.exp(-D * tau) - E * math.exp(-r * tau))) < 1e-10
    bc, bp = bs_price("binary_call", S, E, tau, sigma, r, D), bs_price("binary_put", S, E, tau, sigma, r, D)
    assert abs(bc + bp - math.exp(-r * tau)) < 1e-12


def _fd_greeks(kind, S, E, tau, sigma, r, D):
    """Central finite differences of bs_price (independent of the Table 7.1 greek formulae)."""
    f = lambda **kw: bs_price(kind, kw.get("S", S), E, kw.get("tau", tau), kw.get("sigma", sigma),
                              kw.get("r", r), kw.get("D", D))
    h = 1e-3 * S
    delta = (f(S=S + h) - f(S=S - h)) / (2 * h)
    gamma = (f(S=S + h) - 2 * f() + f(S=S - h)) / h**2
    speed = (f(S=S + 2 * h) - 2 * f(S=S + h) + 2 * f(S=S - h) - f(S=S - 2 * h)) / (2 * h**3)
    k = 1e-5
    theta = -(f(tau=tau + k) - f(tau=tau - k)) / (2 * k)  # dV/dt = -dV/dtau
    vega = (f(sigma=sigma + k) - f(sigma=sigma - k)) / (2 * k)
    rho = (f(r=r + k) - f(r=r - k)) / (2 * k)
    rho_d = (f(D=D + k) - f(D=D - k)) / (2 * k)
    return dict(delta=delta, gamma=gamma, speed=speed, theta=theta, vega=vega, rho=rho, rho_dividend=rho_d)


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("S,E,tau,sigma,r,D", CASES)
def test_greeks_match_finite_differences(kind, S, E, tau, sigma, r, D):
    """CONSISTENCY. Every greek in Table 7.1 [PWOQF, Vol 1, Ch. 7, §7.11, p. 137] must equal a central
    finite difference of the value formula. Tolerance: |analytic - FD| <= 1e-4 * max(1, |analytic|)
    for delta, gamma, theta, vega, rho, rho_D and 1e-3 * max(1, |analytic|) for speed (third
    derivative, larger truncation/round-off error)."""
    g = bs_greeks(kind, S, E, tau, sigma, r, D)
    fd = _fd_greeks(kind, S, E, tau, sigma, r, D)
    for name, num in fd.items():
        ana = getattr(g, name)
        tol = (1e-3 if name == "speed" else 1e-4) * max(1.0, abs(ana))
        assert abs(ana - num) <= tol, (kind, name, ana, num)


@pytest.mark.parametrize("S,E,tau,sigma,r,D", CASES)
def test_black_scholes_pde_satisfied(S, E, tau, sigma, r, D):
    """CONSISTENCY. The values satisfy the Black-Scholes equation with dividend yield,
    Theta + 1/2 sigma^2 S^2 Gamma + (r - D) S Delta - r V = 0 [PWOQF, Vol 1, Ch. 7, §7.2, p. 110, Eq. (7.1)
    with D as in Ch. 8]. Tolerance: 1e-9 * max(1, V)."""
    for kind in KINDS:
        g = bs_greeks(kind, S, E, tau, sigma, r, D)
        resid = g.theta + 0.5 * sigma**2 * S**2 * g.gamma + (r - D) * S * g.delta - r * g.value
        assert abs(resid) < 1e-9 * max(1.0, g.value), (kind, resid)


def test_implied_vol_round_trip_and_book_example_p130():
    """CONSISTENCY (book example without stated answer). [PWOQF, Vol 1, Ch. 7, §7.9, p. 130]: a call
    with four months to expiry, strike 100, trading at 6.51 with S = 101.5 and r = 8%. The book does
    not state the implied volatility, so we check that Newton-Raphson converges to a sigma that
    re-prices 6.51 (tolerance 1e-8) and that round-trips on a grid recover sigma to 1e-8."""
    iv = implied_vol_call(6.51, 101.5, 100.0, 4 / 12, 0.08)
    assert abs(bs_price("call", 101.5, 100.0, 4 / 12, iv, 0.08) - 6.51) < 1e-8
    assert 0.05 < iv < 1.0
    for S, E, tau, sigma, r, D in CASES:
        price = bs_price("call", S, E, tau, sigma, r, D)
        assert abs(implied_vol_call(price, S, E, tau, r, D) - sigma) < 1e-8


def test_limits_and_monotonicity():
    """CONSISTENCY. Deep ITM call -> S e^{-D tau} - E e^{-r tau}; deep OTM -> 0; call increases in S
    and sigma; 0 <= delta_call <= e^{-D tau}. Tolerance 1e-8."""
    assert abs(bs_price("call", 1000, 100, 1, 0.2, 0.05) - (1000 - 100 * math.exp(-0.05))) < 1e-8
    assert bs_price("call", 10, 100, 1, 0.2, 0.05) < 1e-8
    prev = 0.0
    for S in range(50, 151, 5):
        c = bs_price("call", S, 100, 1, 0.2, 0.05, 0.01)
        assert c > prev
        prev = c
        d = bs_greeks("call", S, 100, 1, 0.2, 0.05, 0.01).delta
        assert 0 <= d <= math.exp(-0.01)
    assert bs_price("call", 100, 100, 1, 0.3, 0.05) > bs_price("call", 100, 100, 1, 0.2, 0.05)


def test_norm_functions():
    """CONSISTENCY. N(0) = 1/2, N(x) + N(-x) = 1 [p. 131], N'(0) = 1/sqrt(2 pi). Tolerance 1e-15."""
    assert norm_cdf(0.0) == 0.5
    assert abs(norm_cdf(1.3) + norm_cdf(-1.3) - 1) < 1e-15
    assert abs(norm_pdf(0.0) - 1 / math.sqrt(2 * math.pi)) < 1e-15


# ---------------------------------------------------------------- EXTERNAL REFERENCE

def test_external_reference_hull_example():
    """EXTERNAL REFERENCE. Hull, Options, Futures and Other Derivatives (Example 15.6 in 8th ed.):
    S = 42, K = 40, r = 10%, sigma = 20%, T = 0.5 gives d1 = 0.7693, d2 = 0.6278, call = 4.76,
    put = 0.81. Tolerance: 0.005 on prices (book rounds to cents), 1e-4 on d1, d2."""
    d1, d2 = d1_d2(42, 40, 0.5, 0.2, 0.1)
    assert abs(d1 - 0.7693) < 1e-4 and abs(d2 - 0.6278) < 1e-4
    assert abs(bs_price("call", 42, 40, 0.5, 0.2, 0.1) - 4.76) < 0.005
    assert abs(bs_price("put", 42, 40, 0.5, 0.2, 0.1) - 0.81) < 0.005


# ---------------------------------------------------------------- INVALID INPUT

@pytest.mark.parametrize("bad", [
    dict(S=0.0), dict(S=-1.0), dict(E=0.0), dict(tau=0.0), dict(tau=-0.5), dict(sigma=0.0),
    dict(sigma=-0.2), dict(S=float("nan")), dict(sigma=float("inf")),
])
def test_invalid_inputs_raise(bad):
    """INVALID INPUT. Zero/negative price, strike, time or volatility (and NaN/inf) raise ValueError."""
    args = dict(S=100.0, E=100.0, tau=1.0, sigma=0.2)
    args.update(bad)
    with pytest.raises(ValueError):
        bs_price("call", args["S"], args["E"], args["tau"], args["sigma"], 0.05)
    with pytest.raises(ValueError):
        bs_greeks("put", args["S"], args["E"], args["tau"], args["sigma"], 0.05)


def test_invalid_kind_and_iv_bounds():
    """INVALID INPUT. Unknown contract kind; implied vol of a price outside no-arbitrage bounds."""
    with pytest.raises(ValueError):
        bs_price("straddle", 100, 100, 1, 0.2, 0.05)
    with pytest.raises(ValueError):
        implied_vol_call(150.0, 100, 100, 1, 0.05)  # above S
    with pytest.raises(ValueError):
        implied_vol_call(1.0, 120, 100, 1, 0.05)  # below intrinsic S - E e^{-r tau}
