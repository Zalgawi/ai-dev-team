# Development report: TASK-001 (round 2)

Developer: Quant Advisor
Status: completed

# TASK-001, round 2: still not complete

## 1. Answer
The pricing toolkit and its test suite now exist and pass. `npm test` runs pytest: 78 tests pass, exit code 0. Every formula I implemented was checked against the rendered PDF page, not taken from the text layer alone.

The book's known answers reproduce:

| Example | Book | Model |
|---|---|---|
| One-step tree, 101/99 (p.268) | value 0.5, Δ = 0.5 | matches |
| One-step tree, 103/98 (p.268) | value 1.2, Δ = 0.6 | matches |
| With r = 10%, one day (pp.269/274) | p′ = 0.51984, value 0.51963 | p′ matches; value 0.5196351 |
| Binary-call value maximum, Fig 7.15 (p.129) | about 24% vol | 23.6% |
| Fig 15.32 four-step tree | 6.13 | 6.13 |

- **The 0.51963 case:** the book multiplies rounded intermediates (0.9996 × 0.51984). The exact value is 0.5196351, which rounds to 0.51964. The test therefore uses a 1e-5 tolerance and says why.
- **The 6.13 tree:** this only works with parameters reconstructed from the printed nodes, because the book doesn't print σ, r or δt. That test is labelled as a reconstruction, not a known-answer test.

The library half of the ticket is still not done. There are no chapter files, CONVERSION_LOG.md, INDEX.md, FORMULAS.md or EXAMPLES.md, and the required `research/wilmott-ingest/report.md` was not written. This task will fail QA again on those points.

## 2. Files written this round
- **Code:** `toolkit/__init__.py` and `toolkit/pricing/`:
  - `normal.py`: N(x) via erf, plus the book's polynomial N(x) from p.131.
  - `black_scholes.py`: d1/d2; values for call, put, binary call and binary put; all of Table 7.1 (delta, gamma, theta, speed, vega, rho r, rho D) with dividend yield; Newton implied vol from §7.9.
  - `binomial.py`: one-step Δ and value (Eq. 15.1/15.2), p′, the "wilmott" (§15.11) and "appendix" (Eqs 15.4–15.6) tree parameters, and European and American backward induction (§15.18–15.19).
  - Every public function's docstring has a `[PWOQF, Vol 1, Ch. Y, §Z, p. N]` citation plus its units and assumptions.
- **Tests:** `tests/test_black_scholes.py` and `tests/test_binomial.py` cover:
  - book known answers;
  - put–call parity (p.41) and binary parity (p.121);
  - all greeks against central finite differences, for 4 contract types × 5 parameter sets;
  - a Black–Scholes equation residual check;
  - binomial convergence to Black–Scholes at N = 2000 (within 0.005);
  - American against European;
  - invalid inputs: zero or negative S, E, τ, σ or steps, NaN/inf, and implied vol outside the no-arbitrage bounds.

  Each test states its tolerance.
- **Config:** `pytest.ini` (so pytest finds `tests/` and the toolkit).
- **Scripts:** `dump_pages.py`, `find_examples.py`, `filter_survey.py` and `run_marker_detached.cmd` are new in `research/wilmott-ingest/scripts/`. `convert_marker.py` is fixed with the `__main__` guard Windows needs.

## 3. Assumptions and checks
- Formulas came from the text layer (PyMuPDF) and were then checked by eye on the rendered pages:
  - pp.41, 129, 130, 131, 137 (Table 7.1)
  - pp.275, 277, 278, 285, 286, 290, 293, 294
- **Book typo:** p.131 prints `1 + 0.0.2316419x` in the displayed formula. The VB code on the same page uses 0.2316419, which is what I implemented and logged in the code.
- **Book's American VB code (p.290):** the inner loop runs to `NoSteps − 1` instead of `n − 1`. It's harmless to V(0,0), and my implementation loops correctly.
- **Implied-vol example (p.130):** call at 6.51, S = 101.5, E = 100, 4 months, r = 8%. The book doesn't state the answer, so this is tested as a round-trip consistency check only.
- **Two tests use outside numbers:** Hull's S = 42, K = 40 example (call 4.76, put 0.81), and an American put of about 6.09. Both are labelled EXTERNAL REFERENCE.

## 4. Risks, limitations and open items
- **Conversion not done:**
  - marker 2.0.0 needs Docker or a `llama-server` binary, so I downgraded to marker-pdf 1.10.1 / surya 0.17.1. I pinned torch 2.14.1+cu130 so the GPU build stays (CUDA working).
  - marker downloaded its model weights from HuggingFace (about 1.35 GB). Round 1 flagged this as a judgement call and nobody answered it, so **please confirm this is acceptable.**
  - In this tool environment, long-running commands get cut off and take their child processes with them, so background runs died silently. My last action started a WMI-detached test run on a 4-page unit (PID 23352). I couldn't check whether it succeeded.
- **EXAMPLES.md not written:** a candidate list of Vol 1 examples was surveyed (in `work/examples_survey.txt`, git-ignored). Ones not yet registered include:
  - PV of $1,000,000 → $904,837 (p.7)
  - Perez Companc volatility 38.9% (p.64)
  - Wilmott Inc. gearing example (p.40)
  - YTM 6.8406% (p.232)
  - swap 6.95% / 25 bp (p.253)
  - Table 12.3 portfolio: cost −$0.46, expected profit $6.83 (p.214)
  - Kelly and horse-race tables in Ch 17
  - VaR 2.33σ (pp.332–333)
- **Git:** nothing is committed. The project sits inside the public `Zalgawi/ai-dev-team` repo; other projects there (trail-100) are committed, so committing the code (not `library/` or `media/`, which are git-ignored) looks normal. I left that for the next step or for you. Nothing was pushed.
- **Unverified acceptance criteria:**
  - full-book chapter files
  - the 15-equation sample QA
  - INDEX.md (with its page-range spot checks)
  - FORMULAS.md
  - EXAMPLES.md
  - report.md
  - the checkpoint statement

## 5. QA issues addressed
| QA issue | Status |
|---|---|
| `npm test` collects 0 tests | Fixed: 78 pass |
| `toolkit/pricing/` missing | Fixed |
| No unit tests (known-answer, parity, FD greeks, convergence, invalid inputs) | Fixed |
| `report.md` missing | **Not fixed** |
| Work untracked in git | **Not fixed** (needs a commit decision) |
| Library deliverables not checked | **Not fixed**: they don't exist yet |

**Next run:**
1. Check `work/marker_run.exit` / `marker_runs.jsonl` for the detached test.
2. If it worked, launch the full conversion the same detached way.
3. Post-process into `library/wilmott-pwoqf/`.
4. Write CONVERSION_LOG.md (seeded 15-equation sample), INDEX.md, FORMULAS.md (Ch 7 and Ch 15 entries are already page-verified, as above) and EXAMPLES.md.
5. Write `report.md` with the not-advice note and the checkpoint statement, then commit the code without pushing.

This is research and education only, not personal financial advice.
