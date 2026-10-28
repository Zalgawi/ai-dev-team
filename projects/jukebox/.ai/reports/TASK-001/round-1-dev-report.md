# Development report: TASK-001 (round 1)

Developer: Quant Advisor
Status: completed

TASK-001 is **not finished**. I hit the tool-use limit during setup, before the book was converted. No chapter files, INDEX.md, CONVERSION_LOG.md, FORMULAS.md, EXAMPLES.md, pricing toolkit, tests or report exist yet. None of the 14 acceptance criteria can be signed off. What I did get done is groundwork that makes the next run quicker, plus a few findings worth keeping.

## 1. Short answer
- **Edition:** the uploaded `paul-wilmott-on-quantitative-finance.pdf` is byte-identical to the copy in the FinMathematics repo. Both have git blob `98855bfa…` and SHA-256 `e0ff5f09…d549`. It is *Paul Wilmott On Quantitative Finance*, 2nd edition, Wiley 2006 (ISBN 978-0-470-01870-5), all three volumes in one 1,401-page PDF.
- **Structure:** 83 chapters plus Appendix A.
  - Vol 1 is chapters 1–21.
  - Vol 2 is chapters 22–44.
  - Vol 3 is chapters 45–83 and Appendix A.
  - Printed page = PDF page − 21 throughout, checked against the printed contents pages.
- **Scanning:** the PDF was generated from TeX, so it has a real text layer. The only image pages are the 2 cover pages; every other page without text is blank. OCR isn't needed for body text.
- **Conversion defect found:** the text layer turns the MathTime-font glyphs (Δ, Π, ∫, large brackets and so on) into control or private-use characters. That's about 4,000 occurrences, and the codes seem to change between font subsets. So plain text extraction is unreliable for maths. That problem needs to go in CONVERSION_LOG.md, and it is a reason to run marker with OCR or equation re-recognition.

## 2. Files written so far
- `.gitignore` covers `library/`, `media/`, `.venv/`, `research/wilmott-ingest/work/` and Python caches. Nothing has been committed or pushed.
- `package.json` sets `npm test` to run `scripts/run-pytest.mjs`. That script finds Python (`.venv` first) and stops with a clear message if Python or pytest is missing. I haven't run it yet.
- `requirements.txt` lists pytest; `requirements-ingest.txt` lists marker-pdf and pymupdf.
- Under `research/wilmott-ingest/scripts/`:
  - `chapter_map.py` writes the full chapter map, with PDF and printed page ranges and section lists, to `library/wilmott-pwoqf/_meta/chapters.json` (private).
  - `convert_marker.py` runs marker chapter by chapter, keeps page breaks and can resume. It hasn't been run.
  - `survey_pages.py`, `glyph_survey.py`, `peek.py` and `grep_pages.py` are QA helpers.
  - `fit_fig15_25*.py` is the binomial figure analysis below.
- The private source clone is in `library/_source/` (blob-less, nothing downloaded).

## 3. Assumptions and checks so far
- **Vol 1 known-answer tests read from the PDF text** (not yet checked against page images):

  | Example | Book's answer |
  |---|---|
  | Stock 100 → 101/99, strike-100 call | 0.5 |
  | Stock 100 → 103/98, strike-100 call | 1.2, with Δ = 0.6 |
  | First example with r = 0.1, discounted one day at 1/(1 + 0.1/252) | 0.51963 |

  These are all on printed pp. 264–269.
- **The 4-step tree in Fig. 15.25 (worth 6.13):** the book doesn't give its σ, r or T.
  - The book's own VB code and the usual binomial set-up (exponential up/down steps with e^(−rδt) discounting) reproduce none of the printed nodes.
  - Exactly one parameter set reproduces all 30 printed nodes to 2 dp: Eq. (15.2) with 1/(1 + rδt) discounting, σ√δt = 0.05861 and rδt = 0.00837.
  - So this example can only be a "reconstructed-parameter" consistency test, not a true known-answer test.
- **Other likely Vol 1 examples, not yet written up:** the bond yield in Table 13.1, the swap comparative-advantage example in Tables 14.1–14.2, Kelly betting in chapter 17, the horse-race odds in Tables 17.1–17.4, the VaR table 19.1, the hedging tables in chapter 12, and the gearing and spread examples in chapter 2.

## 4. Risks and open questions
- **Network judgement call:** marker has to download its model weights from HuggingFace the first time it runs. The ticket only allows cloning the repo and installing Python packages. I counted the weights as part of installing the tool you required, but they haven't been downloaded yet. Please confirm or overrule; if you overrule, docling has the same problem, and the fallback would be my own PyMuPDF extractor with weaker LaTeX.
- **Environment state:**
  - `.venv` has marker-pdf 2.0.0 and pytest, but pip replaced the CUDA build of torch with a CPU-only one.
  - A background reinstall of torch 2.14.1 for CUDA 13.0 was running when I stopped. It may have failed and needs checking.
  - My last API check also failed because `marker.__file__` is `None`, which looks like a namespace or broken install. That needs fixing before conversion.
- **Time:** converting the whole book on the RTX 3060 Ti should take roughly 30–90 minutes. Running it with OCR on would take longer.
- **Writing outside `research/`:** I added `package.json`, `scripts/`, `.gitignore` and the requirements files at project level because the ticket asks for them.

## 5. QA issues addressed
None. There was no QA report.

**Recommended next steps:**
1. Check the CUDA torch install and fix the marker import.
2. Run `convert_marker.py`, using OCR or equation re-recognition because of the glyph problem.
3. Post-process into `library/wilmott-pwoqf/` with page markers and a figure-caption register.
4. Do the 15-equation QA with a recorded seed by viewing page images.
5. Write INDEX.md, then FORMULAS.md and EXAMPLES.md for Vol 1 only.
6. Build `toolkit/pricing/` (Black–Scholes with Greeks, and binomial trees for European and American options) with tests: the known answers above, put–call parity, finite-difference Greeks, binomial convergence to Black–Scholes, and invalid inputs.
7. Run `npm test`, then write `research/wilmott-ingest/report.md` with the not-financial-advice note and the checkpoint statement.
