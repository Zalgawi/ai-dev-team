"""Survey candidate numerical examples in a PDF page range (for building EXAMPLES.md).

Prints, per printed page, the text lines that contain numbers in running text (a decimal number, a
currency amount or a percentage) and are long enough not to be figure-axis tick labels.
Usage: python research/wilmott-ingest/scripts/find_examples.py FIRST_PDF LAST_PDF > work/examples_survey.txt
"""
import re
import sys

import pymupdf

PDF = "media/paul-wilmott-on-quantitative-finance.pdf"
NUM = re.compile(r"(\$\s?\d[\d,]*(\.\d+)?|\d+\.\d+|\d+(\.\d+)?\s?%)")
a, b = int(sys.argv[1]), int(sys.argv[2])
doc = pymupdf.open(PDF)
out = sys.stdout.buffer
for p in range(a, b + 1):
    lines = [ln.strip() for ln in doc[p - 1].get_text().split("\n")]
    hits = [ln for ln in lines if len(ln) > 18 and NUM.search(ln) and not ln.startswith(("Figure", "Table"))
            and not re.match(r"^[\d.\s−-]+$", ln)]
    if hits:
        out.write(f"## printed {p - 21} (PDF {p})\n".encode())
        for h in hits:
            out.write(f"   {h}\n".encode("utf-8", "replace"))
