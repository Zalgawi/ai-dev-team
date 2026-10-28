"""Reconstruct the (undisclosed) parameters of the 4-step tree in PWOQF Figs 15.25-15.32 (printed p. 282-285).

The figure prints the asset tree (100 -> 106.04 ... 126.42) and option tree (root 6.13) but not sigma, r, T.
We grid-search (sigma, r) for T = 1 (and a few other T) using the book's own VB parameterization
(PWOQF Vol 1 Ch. 15 §15.18 p. 286) and report fits whose 15 printed nodes all round to the book values.
"""
import itertools
import math

ASSET = {4: [126.42, 112.44, 100.00, 88.94, 79.10], 3: [119.22, 106.04, 94.31, 83.88],
         2: [112.44, 100.00, 88.94], 1: [106.04, 94.31], 0: [100.0]}
OPTION = {4: [26.42, 12.44, 0.00, 0.00, 0.00], 3: [20.05, 6.87, 0.00, 0.00],
          2: [14.09, 3.79, 0.00], 1: [9.45, 2.09], 0: [6.13]}


def tree(S, K, sigma, r, T, M):
    dt = T / M
    D = math.exp(-r * dt)
    t1 = math.exp((r + sigma * sigma) * dt)
    t2 = 0.5 * (D + t1)
    u = t2 + math.sqrt(t2 * t2 - 1)
    d = 1 / u
    p = (math.exp(r * dt) - d) / (u - d)
    A = {n: [S * u ** (n - k) * d ** k for k in range(n + 1)] for n in range(M + 1)}
    V = {M: [max(s - K, 0) for s in A[M]]}
    for n in range(M - 1, -1, -1):
        V[n] = [D * (p * V[n + 1][k] + (1 - p) * V[n + 1][k + 1]) for k in range(n + 1)]
    return A, V


hits = []
for T in (0.25, 0.5, 1.0):
    for s100 in range(500, 4001):          # sigma 0.0500 .. 0.4000 step 0.0001
        sigma = s100 / 10000
        for r1000 in range(0, 201):        # r 0 .. 0.200 step 0.001
            r = r1000 / 1000
            A, V = tree(100, 100, sigma, r, T, 4)
            ok = all(abs(round(A[n][k], 2) - ASSET[n][k]) < 1e-9 for n in A for k in range(n + 1)) and \
                all(abs(round(V[n][k], 2) - OPTION[n][k]) < 1e-9 for n in V for k in range(n + 1))
            if ok:
                hits.append((T, sigma, r, V[0][0]))
print(len(hits), "parameter sets reproduce all 30 printed node values (2 dp)")
for h in hits[:10]:
    print(h)
round_hits = [h for h in hits if abs(h[1] * 100 - round(h[1] * 100)) < 1e-9 and abs(h[2] * 100 - round(h[2] * 100)) < 1e-9]
print("round-number fits (sigma, r to whole %):", round_hits)
