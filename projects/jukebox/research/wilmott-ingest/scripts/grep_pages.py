"""grep a page-delimited text dump: python grep_pages.py <file> <regex> [maxlen]. Prints 'pdfpage: line'."""
import re
import sys

path, pat = sys.argv[1], sys.argv[2]
maxlen = int(sys.argv[3]) if len(sys.argv) > 3 else 160
pg = 0
rx = re.compile(pat)
for line in open(path, encoding="utf-8"):
    m = re.match(r"===== PDF PAGE (\d+)", line)
    if m:
        pg = int(m.group(1))
        continue
    if rx.search(line):
        print(f"{pg}: {line.strip()[:maxlen]}")
