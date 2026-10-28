"""Search one-step parameters (u, d=1/u, discount D, prob p) of several textbook parameterizations
for a 4-step tree that reproduces every printed node of PWOQF Fig. 15.25 (p. 282) to 2 dp.
Variables are per-step: a = sigma*sqrt(dt), b = r*dt."""
import math

ASSET = {4: [126.42, 112.44, 100.00, 88.94, 79.10], 3: [119.22, 106.04, 94.31, 83.88],
         2: [112.44, 100.00, 88.94], 1: [106.04, 94.31], 0: [100.0]}
OPTION = {4: [26.42, 12.44, 0.00, 0.00, 0.00], 3: [20.05, 6.87, 0.00, 0.00],
          2: [14.09, 3.79, 0.00], 1: [9.45, 2.09], 0: [6.13]}


def check(u, d, D, p):
    A = {n: [100 * u ** (n - k) * d ** k for k in range(n + 1)] for n in range(5)}
    V = {4: [max(s - 100, 0) for s in A[4]]}
    for n in range(3, -1, -1):
        V[n] = [D * (p * V[n + 1][k] + (1 - p) * V[n + 1][k + 1]) for k in range(n + 1)]
    okA = all(abs(round(A[n][k], 2) - ASSET[n][k]) < 1e-9 for n in A for k in range(n + 1))
    okV = all(abs(round(V[n][k], 2) - OPTION[n][k]) < 1e-9 for n in V for k in range(n + 1))
    return okA, okV, V[0][0]


schemes = {
    "CRR exp, D=e^-b, p=(e^b-d)/(u-d)": lambda a, b: (math.exp(a), math.exp(-a), math.exp(-b), (math.exp(b) - math.exp(-a)) / (math.exp(a) - math.exp(-a))),
    "u=e^a, D=1/(1+b), p=(1+b-d)/(u-d)": lambda a, b: (math.exp(a), math.exp(-a), 1 / (1 + b), (1 + b - math.exp(-a)) / (math.exp(a) - math.exp(-a))),
    "u=e^a, D=1/(1+b), p=1/2+b/(2a)": lambda a, b: (math.exp(a), math.exp(-a), 1 / (1 + b), 0.5 + b / (2 * a)),
    "u=e^a, D=e^-b, p=1/2+b/(2a)": lambda a, b: (math.exp(a), math.exp(-a), math.exp(-b), 0.5 + b / (2 * a)),
}
for name, f in schemes.items():
    hits = []
    for ia in range(5800, 5930):
        a = ia / 100000
        for ib in range(0, 2000):
            b = ib / 100000
            u, d, D, p = f(a, b)
            okA, okV, v0 = check(u, d, D, p)
            if okA and okV:
                hits.append((a, b, round(p, 5), round(D, 6), round(v0, 5)))
    print(name, len(hits), hits[:3], hits[-1:] if hits else "")
