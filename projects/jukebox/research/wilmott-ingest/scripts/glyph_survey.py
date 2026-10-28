"""Find characters in the PDF text layer that are control/private-use codes (garbled glyph mappings).
Reports (font, codepoint) -> count and the PDF pages of a few examples, plus a short context snippet."""
import collections
import json
import sys
import pymupdf

PDF = "media/paul-wilmott-on-quantitative-finance.pdf"
doc = pymupdf.open(PDF)
cnt = collections.Counter()
ex = {}
for pno in range(doc.page_count):
    d = doc[pno].get_text("rawdict")
    for b in d["blocks"]:
        for l in b.get("lines", []):
            for s in l["spans"]:
                font = s["font"].split("+")[-1]
                chars = s["chars"]
                text = "".join(c["c"] for c in chars)
                for i, c in enumerate(chars):
                    o = ord(c["c"])
                    if o < 32 or 0xE000 <= o <= 0xF8FF or o == 0xFFFD:
                        k = (font, hex(o))
                        cnt[k] += 1
                        ex.setdefault(k, [])
                        if len(ex[k]) < 4:
                            ex[k].append((pno + 1, text[max(0, i - 15): i + 15]))
for k, v in cnt.most_common():
    print(k, v, ex[k])
