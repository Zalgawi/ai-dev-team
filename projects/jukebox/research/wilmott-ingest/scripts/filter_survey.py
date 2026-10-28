"""Filter work/examples_survey.txt down to lines with real numbers (drops figure/equation refs).
Usage: python filter_survey.py MIN_PRINTED MAX_PRINTED"""
import re
import sys

lo, hi = int(sys.argv[1]), int(sys.argv[2])
pg = 0
for line in open("research/wilmott-ingest/work/examples_survey.txt", encoding="utf-8"):
    line = line.rstrip("\n")
    if line.startswith("##"):
        pg = int(line.split()[2])
        continue
    s = re.sub(r"\(\d+\.\d+\)|(Figure|Section|Table|Chapter|Equation)s?\s?\d+(\.\d+)?", "", line)
    if lo <= pg <= hi and re.search(r"\d+\.\d+|\$\s?\d|\d\s?%", s):
        sys.stdout.buffer.write(f"p{pg} {line.strip()[:160]}\n".encode("utf-8"))
