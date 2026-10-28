"""Build the chapter map of PWOQF (2nd ed., 2006) from the PDF outline (bookmarks).

Writes library/wilmott-pwoqf/_meta/chapters.json (git-ignored) with, per unit:
  vol, kind (chapter/part/front/appendix/back), number, title, slug, file,
  pdf_start, pdf_end (1-based, inclusive), printed_start, printed_end, sections[].

Printed page = PDF page - 21 for all body pages (checked against the printed
contents pages, PDF pp. 10-15: ch.1 printed p.5 = PDF p.26; ch.83 printed p.1311 = PDF p.1332).
Volume split comes from the printed contents (PDF pp. 10-15):
  Vol 1 = Part One (ch. 1-21); Vol 2 = Parts Two-Four (ch. 22-44);
  Vol 3 = Parts Five-Six (ch. 45-83), Appendix A, Bibliography, Index.
"""
import json
import os
import re
import pymupdf

PDF = "media/paul-wilmott-on-quantitative-finance.pdf"
OUT = "library/wilmott-pwoqf/_meta/chapters.json"
OFFSET = 21

doc = pymupdf.open(PDF)
toc = doc.get_toc()
N = doc.page_count


def slugify(s):
    s = s.replace("’", "").replace("‘", "").replace("'", "")
    s = s.replace("Black–Scholes", "black-scholes").replace("–", "-")
    s = re.sub(r"\*+", "", s)
    s = re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()
    return s[:60].strip("-")


def vol_of(ch):
    return 1 if ch <= 21 else (2 if ch <= 44 else 3)


units = []
# entries in reading order with start page
starts = []
for i, (lvl, title, page) in enumerate(toc):
    if lvl == 2 and title.startswith("PART"):
        starts.append(("part", title, page, i))
    elif lvl == 3 and re.match(r"^\d+ ", title):
        starts.append(("chapter", title, page, i))
    elif lvl == 2 and title.startswith("Appendix A"):
        starts.append(("appendix", title, page, i))
    elif lvl == 2 and title in ("Bibliography", "Index"):
        starts.append(("back", title, page, i))
    elif lvl == 2 and title == "contents of volume one":
        starts.append(("front", "Front matter, contents, Visual Basic code list, Prolog", 1, i))

part_no = 0
for k, (kind, title, page, ti) in enumerate(starts):
    end = (starts[k + 1][2] - 1) if k + 1 < len(starts) else N
    # sections = TOC entries below this unit until next unit
    next_ti = starts[k + 1][3] if k + 1 < len(starts) else len(toc)
    secs = [{"level": l, "title": t, "pdf_page": p, "printed_page": p - OFFSET}
            for (l, t, p) in toc[ti + 1:next_ti]]
    if kind == "chapter":
        num = int(title.split(" ", 1)[0])
        name = title.split(" ", 1)[1]
        vol = vol_of(num)
        fname = f"{vol}-{num:02d}-{slugify(name)}.md"
    elif kind == "part":
        part_no += 1
        num = f"P{part_no}"
        name = title
        first_ch = int(starts[k + 1][1].split(" ", 1)[0])
        vol = vol_of(first_ch)
        fname = f"{vol}-part{part_no}-{slugify(title.split(' ', 2)[2] if title.count(' ') > 1 else title)}.md"
        fname = f"{vol}-part{part_no}-introduction.md"
    elif kind == "appendix":
        num, name, vol = "A", title.replace("Appendix A ", ""), 3
        fname = f"3-A-{slugify(name)}.md"
    elif kind == "back":
        num, name, vol = title[:3].upper(), title, 3
        fname = f"3-{'Z1' if title == 'Bibliography' else 'Z2'}-{slugify(title)}.md"
    else:
        num, name, vol = "0", title, 1
        fname = "1-00-front-matter.md"
    units.append({
        "vol": vol, "kind": kind, "number": num, "title": name, "file": fname,
        "pdf_start": page, "pdf_end": end,
        "printed_start": page - OFFSET, "printed_end": end - OFFSET,
        "sections": secs,
    })

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(units, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
for u in units:
    print(u["vol"], u["kind"], u["number"], u["file"], u["pdf_start"], u["pdf_end"], len(u["sections"]))
print(len([u for u in units if u["kind"] == "chapter"]), "chapters")
