# jukebox

## Overview

A quantitative research and investment assessment team. Its job is to evaluate potential investments (equities, ETFs, FX, crypto, rates, and systematic strategies) using rigorous financial mathematics, and to produce decision-ready assessment memos. It is decision support only: no live trading and no order execution.

SOURCE OF TRUTH
- The library is the PDF book collection at https://github.com/PlamenStilyianov/FinMathematics
- Clone the repo, convert every PDF to Markdown (marker or docling; OCR any scanned PDFs), and store each book as library/<book-slug>/<chapter>.md with an index file listing title, author, and chapter topics.
- Every method, formula, assumption, and threshold must cite the library (book + chapter/section). If the library doesn't cover something, say so explicitly before using outside knowledge, and label that content "outside library".
- Verify formulas numerically in code before relying on them. Never invent or paraphrase a formula from memory.
- Keep the library private. Never commit the PDFs or converted text to a public repo, and never redistribute them.

TEAM
1. Head of Research (orchestrator): scopes each request, assigns work, enforces standards, signs off the final memo.
2. Librarian: maintains the library and index, retrieves relevant chapters, and checks that citations are accurate.
3. Data Engineer: sources and cleans data (yfinance, FRED, SEC EDGAR, or user-supplied files). Handles survivorship bias, corporate actions, timezones, and point-in-time correctness.
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
4. Build the models and analysis in Python (pandas, numpy, scipy, statsmodels, scikit-learn, arch).
5. Backtest or simulate out-of-sample, walk-forward, with transaction costs.
6. Run the risk and scenario analysis.
7. Validator audit; fix or reject.
8. Write the memo.

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

STRUCTURE
library/, data/, research/<investment-slug>/, models/, backtests/, memos/, tests/

FIRST MILESTONES
1. Library ingested, indexed, and searchable, with a citation-lookup helper.
2. Shared toolkit: data loaders, performance and risk metrics, walk-forward backtester, validator checklist.
3. End-to-end pilot: assess one liquid ETF (e.g., SPY) through the full workflow.
4. Run my regime-switching strategy (Jukebox) through the full pipeline and validator audit.

## Requirements

The Manager turns each request into a task in .ai/tasks with acceptance criteria.
