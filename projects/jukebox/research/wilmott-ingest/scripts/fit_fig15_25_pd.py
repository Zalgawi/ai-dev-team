"""Back out the one-step risk-neutral probability p and discount factor D implied by the printed
option tree in PWOQF Fig. 15.25 (printed p. 282), by least squares over all 10 interior nodes."""
O = {4: [26.42, 12.44, 0, 0, 0], 3: [20.05, 6.87, 0, 0], 2: [14.09, 3.79, 0], 1: [9.45, 2.09], 0: [6.13]}
best = []
for a in range(5000, 6500):
    p = a / 10000
    for x in range(97000, 100001, 2):
        D = x / 100000
        e = 0.0
        for n in range(4):
            for k in range(n + 1):
                e += (D * (p * O[n + 1][k] + (1 - p) * O[n + 1][k + 1]) - O[n][k]) ** 2
        best.append((e, p, D))
best.sort()
for b in best[:5]:
    print(b)
