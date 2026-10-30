"""Standard Normal functions used by the Black-Scholes formulae.

Source: Paul Wilmott On Quantitative Finance, 2nd ed. (Wiley, 2006), "PWOQF".
Citations use printed page numbers (printed page = PDF page - 21).
"""
import math

_SQRT_2PI = math.sqrt(2.0 * math.pi)


def norm_pdf(x: float) -> float:
    """N'(x) = exp(-x^2/2) / sqrt(2 pi), the standard Normal density.

    Citation: [PWOQF, Vol 1, Ch. 7, §7.11, p. 137] (definition under Table 7.1).
    Units: dimensionless. Assumptions: none (x any real number).
    """
    return math.exp(-0.5 * x * x) / _SQRT_2PI


def norm_cdf(x: float) -> float:
    """N(x) = (1/sqrt(2 pi)) * integral_{-inf}^{x} exp(-phi^2/2) dphi.

    Citation: [PWOQF, Vol 1, Ch. 7, §7.2.1, p. 115]; also defined under Table 7.1 [p. 137].
    Evaluated exactly via the error function: N(x) = (1 + erf(x / sqrt 2)) / 2.
    Units: probability in [0, 1].
    """
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


# Coefficients printed in the book [PWOQF, Vol 1, Ch. 7, §7.9, p. 131].
_A = (0.31938153, -0.356563782, 1.781477937, -1.821255978, 1.330274429)
_B = 0.2316419


def norm_cdf_book(x: float) -> float:
    """Polynomial approximation to N(x) given in the book (the VB function ``cdf``).

    For x >= 0: N(x) ~= 1 - (1/sqrt(2 pi)) exp(-x^2/2) (a1 d + a2 d^2 + a3 d^3 + a4 d^4 + a5 d^5),
    d = 1 / (1 + 0.2316419 x); for x < 0 use N(x) + N(-x) = 1.

    Citation: [PWOQF, Vol 1, Ch. 7, §7.9, p. 131].
    Note: the displayed formula on p. 131 prints "1 + 0.0.2316419x" (a typesetting typo); the VB code
    on the same page uses 0.2316419, which is what is implemented. Absolute error is below ~1e-7,
    so this is kept only as a cross-check of ``norm_cdf``.
    """
    d = 1.0 / (1.0 + _B * abs(x))
    poly = d * (_A[0] + d * (_A[1] + d * (_A[2] + d * (_A[3] + d * _A[4]))))
    cdf = 1.0 - math.exp(-0.5 * x * x) / _SQRT_2PI * poly
    return cdf if x >= 0 else 1.0 - cdf
