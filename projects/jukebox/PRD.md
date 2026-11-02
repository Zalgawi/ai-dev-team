# jukebox

## Overview

A quantitative research and investment assessment team. Its job is to evaluate potential investments (equities, ETFs, FX, crypto, rates, and systematic strategies) using rigorous financial mathematics, and to produce decision-ready assessment memos.

The product is a local web dashboard that turns validated strategies into daily signals and **manual** order tickets. The human decides and places every trade in their own broker account. Jukebox never sends orders anywhere. It is decision support built on the human's own rules and data, not personal financial advice.

PRODUCT
- **Dashboard** (`npm run dashboard`, http://127.0.0.1:8050). It runs on this PC only. For each strategy it shows:
  - today's signal, what changed, and why;
  - out-of-sample evidence after costs, against buy-and-hold;
  - equity and drawdown charts;
  - a Monte Carlo range of outcomes;
  - sizing figures;
  - parameter sensitivity and the walk-forward windows;
  - citations and the data snapshot.
- **Order tickets.** The human enters account value, current holding, an allocation cap and a commission estimate. Jukebox sizes the order in whole units with a suggested limit price. The human places it by hand in Interactive Brokers.
- **Research and trading instruments.**
  - Strategies are researched on the instrument with the longest clean history (e.g. SPY).
  - Tickets are sized in a UK-listed UCITS equivalent the human can buy (e.g. VUAG on the LSE, in GBP). UK retail investors generally can't buy US-domiciled ETFs, which have no PRIIPs KID.
  - The dashboard shows how closely the two track, including USD/GBP moves.
- **Data (free).**
  - Tiingo end-of-day prices when `TIINGO_API_KEY` is set in `.env`; otherwise Yahoo Finance via yfinance.
  - FRED for T-bill rates and macro series; SEC EDGAR later for fundamentals.
  - Only completed daily closes are used: today's bar is dropped until its exchange has closed.
- **Secrets.** API keys live only in `.env` on this PC, which is git-ignored (the repo is public). Use read-only keys where the broker offers them. Agents never handle credentials.

SOURCE OF TRUTH
- The library is the PDF book collection in `media/` (the human's own copies).
- Agents find pages with `search_library` and read them with `read_pdf`. Cite as `[Short title, p. <printed page>]`.
- Text layers garble maths, so check every implemented equation against the page image.
- Scanned books (no text layer) are read as page images.
- Never convert whole books. Read the pages you need.
- Every method, formula, assumption, and threshold must cite the library (book + chapter/section). If the library doesn't cover something, say so explicitly before using outside knowledge, and label that content "outside library".
- Verify formulas numerically in code before relying on them. Never invent or paraphrase a formula from memory.
- Keep the library private.
  - Never commit the PDFs or text extracted from them to a public repo, and never redistribute them.
  - Committed code and docs may quote a formula or a sentence with its citation, nothing longer.

TEAM
1. Head of Research (orchestrator): scopes each request, assigns work, enforces standards, signs off the final memo.
2. Librarian: maintains the library and index, retrieves relevant chapters, and checks that citations are accurate.
3. Data Engineer: sources and cleans data (Tiingo, yfinance, FRED, SEC EDGAR, or user-supplied files). Handles survivorship bias, corporate actions, timezones, and point-in-time correctness.
4. Statistical/Econometrics Quant: time-series analysis, stationarity, cointegration, volatility models (GARCH), and regime detection (HMM / Markov switching).
5. ML Quant: feature engineering, labelling (e.g., triple-barrier), purged/walk-forward cross-validation, and feature importance. No random train/test splits on time series.
6. Derivatives & Pricing Quant: stochastic calculus, option pricing, Greeks, and implied vol, for any assessment involving options or structured exposure.
7. Risk Quant: VaR, CVaR, drawdown analysis, stress tests and scenarios, position sizing (Kelly / fractional Kelly), and correlation and tail-dependence.
8. Portfolio Quant: how the investment fits an existing portfolio, including diversification, mean-variance and risk-parity views, and marginal risk contribution.
9. Model Validator (skeptic): independently audits every result for look-ahead bias, survivorship bias, data snooping, unrealistic costs and slippage, and overfitting (deflated Sharpe, multiple-testing correction). It can veto a conclusion.
10. Report Writer: compiles the final memo in plain, concise language.

WORKFLOW (per investment)
1. Define the question, horizon, and constraints.
2. Pull the relevant library chapters and agree on a methodology, with citations.
3. Source the data and run quality checks.
4. Build the models and analysis in Python. Use only lightweight packages: pandas, numpy, scipy, statsmodels, scikit-learn, arch. No deep-learning frameworks or model downloads without the human's approval.
5. Backtest or simulate out-of-sample, walk-forward, with transaction costs.
6. Run the risk and scenario analysis.
7. Validator audit; fix or reject.
8. Write the memo.
9. If the verdict is Proceed, add the strategy to the dashboard registry (`toolkit/strategies.py`).

ASSESSMENT MEMO FORMAT
- One-paragraph verdict: Proceed / Watchlist / Reject, with a confidence level
- Thesis and what would have to be true
- Data used and its limitations
- Methodology, with library citations
- Results: expected return range, volatility, Sharpe/Sortino, max drawdown, VaR/CVaR, stress scenarios
- Regime sensitivity (how it behaves in different market states)
- Key risks, model risk, and what would invalidate the thesis
- Validator sign-off notes

STANDARDS
- Reproducible: every result has a script, fixed seeds, and a logged data snapshot.
- Show uncertainty: give ranges and confidence intervals, not single-point forecasts.
- In-sample results are never presented as evidence.
- Assume published book strategies are widely known; any edge must be justified.
- Signals use only completed closes and lagged data. Every strategy passes the truncation test for look-ahead bias (`toolkit.backtest.no_lookahead`).
- Costs are always on (default 5 bp per trade). Results before costs are shown only next to results after costs.

STRUCTURE
- `toolkit/`: data, metrics, backtest, walk-forward, Monte Carlo, strategies, signals, pricing
- `app/`: the dashboard
- `data/`: downloaded data (git-ignored)
- `research/<investment-slug>/`, `memos/`, `tests/`
- `media/`: the book library and uploads (git-ignored)

MILESTONES
1. Done: library searchable and citable via the Office's `search_library` / `read_pdf` tools.
2. Done: shared toolkit (data loaders with quality checks, performance and risk metrics, walk-forward backtester with costs and look-ahead checks, Monte Carlo bootstrap) plus the dashboard with signals and manual order tickets. Baseline strategy: SPY trend filter.
3. End-to-end pilot: an SPY assessment memo through the full workflow, with validator sign-off.
4. Run my regime-switching strategy (Jukebox) through the full pipeline and validator audit, and add it to the dashboard if it passes.
5. IBKR read-only sync through the Client Portal Web API gateway, which the human logs into locally. Holdings and cash fill the order ticket automatically. No order placement.
6. Trade journal: record what was actually traded (manually, or from IBKR's read-only trade history), and compare real results with the signals.
7. Alerts when a signal changes (email or Telegram).
8. Paper trading: strategies run automatically in an IBKR paper account for months before any real money is considered. Real-money orders stay manual.

## Requirements

The Manager turns each request into a task in .ai/tasks with acceptance criteria.
