"""Print raw text of given 1-based PDF pages (scratch helper; output contains book text, do not commit output)."""
import sys
import pymupdf

PDF = "media/paul-wilmott-on-quantitative-finance.pdf"
doc = pymupdf.open(PDF)
for arg in sys.argv[1:]:
    if "-" in arg:
        a, b = map(int, arg.split("-"))
    else:
        a = b = int(arg)
    for p in range(a, b + 1):
        print(f"===== PDF PAGE {p} =====")
        print(doc[p - 1].get_text())
