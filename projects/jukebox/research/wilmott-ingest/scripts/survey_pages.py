"""Survey every PDF page: text length, image count, vector drawing count, fonts.
Flags pages with no text layer (candidates for OCR). Output is page statistics only (no book text)."""
import json
import sys
import pymupdf

PDF = "media/paul-wilmott-on-quantitative-finance.pdf"
doc = pymupdf.open(PDF)
rows = []
for i, page in enumerate(doc):
    txt = page.get_text()
    rows.append({
        "pdf_page": i + 1,
        "chars": len(txt.strip()),
        "images": len(page.get_images()),
        "drawings": len(page.get_drawings()),
    })
no_text = [r["pdf_page"] for r in rows if r["chars"] == 0]
img_only = [r["pdf_page"] for r in rows if r["chars"] < 30 and r["images"] > 0]
print("pages", len(rows))
print("no-text pages", no_text)
print("image pages with <30 chars", img_only)
fonts = {}
for i in range(0, len(doc), 50):
    for f in doc[i].get_fonts():
        fonts[f[3]] = f[2]
print("sample fonts", sorted(fonts.items())[:60])
json.dump(rows, open(sys.argv[1] if len(sys.argv) > 1 else "research/wilmott-ingest/work/page_survey.json", "w"))
