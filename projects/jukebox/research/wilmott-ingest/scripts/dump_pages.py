"""Dump the PyMuPDF text layer of a PDF page range, or render pages to PNG for visual checks.

Usage (project root, .venv):
  python research/wilmott-ingest/scripts/dump_pages.py text FIRST LAST        # 1-based PDF pages
  python research/wilmott-ingest/scripts/dump_pages.py png  FIRST LAST [ZOOM]  # -> research/wilmott-ingest/work/pages/p<N>.png

Output stays in research/wilmott-ingest/work/ (git-ignored: it is book content).
Printed page = PDF page - 21 for this edition.
"""
import os
import sys

import fitz  # PyMuPDF

PDF = "media/paul-wilmott-on-quantitative-finance.pdf"
mode, a, b = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
doc = fitz.open(PDF)
if mode == "text":
    for p in range(a, b + 1):
        sys.stdout.buffer.write(f"\n===== PDF {p} / printed {p - 21} =====\n".encode("utf-8"))
        sys.stdout.buffer.write(doc[p - 1].get_text().encode("utf-8", "replace"))
else:
    zoom = float(sys.argv[4]) if len(sys.argv) > 4 else 2.0
    out = "research/wilmott-ingest/work/pages"
    os.makedirs(out, exist_ok=True)
    for p in range(a, b + 1):
        pix = doc[p - 1].get_pixmap(matrix=fitz.Matrix(zoom, zoom))
        pix.save(f"{out}/p{p}.png")
        print(f"{out}/p{p}.png")
