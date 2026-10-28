"""Convert PWOQF to Markdown with marker, one run per chapter/unit (page ranges from chapters.json).

Usage (from project root, in .venv; marker-pdf 1.10.1, see report for why not 2.x):
  python research/wilmott-ingest/scripts/convert_marker.py [--only FILE ...] [--force-ocr] [--redo]

Raw marker output goes to research/wilmott-ingest/work/marker_raw/<file>.md (git-ignored: book text),
with paginate_output=True so that page boundaries ({pdf_index}----) survive for citations.
Resumable: units with an existing raw file are skipped unless --redo.
A log line per unit (seconds, chars) is appended to work/marker_runs.jsonl.
The __main__ guard is required on Windows, where marker/surya start worker processes with "spawn".
"""
import argparse
import json
import os
import time

PDF = "media/paul-wilmott-on-quantitative-finance.pdf"
META = "library/wilmott-pwoqf/_meta/chapters.json"
RAW = "research/wilmott-ingest/work/marker_raw"
LOG = "research/wilmott-ingest/work/marker_runs.jsonl"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--force-ocr", action="store_true")
    ap.add_argument("--redo", action="store_true")
    ap.add_argument("--out", default=RAW)
    args = ap.parse_args()

    from marker.config.parser import ConfigParser
    from marker.converters.pdf import PdfConverter
    from marker.models import create_model_dict
    from marker.output import text_from_rendered

    units = json.load(open(META, encoding="utf-8"))
    if args.only:
        units = [u for u in units if u["file"] in args.only]
    os.makedirs(args.out, exist_ok=True)

    t0 = time.time()
    models = create_model_dict()
    print(f"models loaded in {time.time() - t0:.1f}s", flush=True)

    for u in units:
        out = os.path.join(args.out, u["file"])
        if os.path.exists(out) and not args.redo:
            continue
        cfg = {
            "output_format": "markdown",
            "page_range": f"{u['pdf_start'] - 1}-{u['pdf_end'] - 1}",
            "paginate_output": True,
            "disable_image_extraction": True,
            "force_ocr": bool(args.force_ocr),
            "disable_multiprocessing": True,
        }
        cp = ConfigParser(cfg)
        conv = PdfConverter(
            config=cp.generate_config_dict(),
            artifact_dict=models,
            processor_list=cp.get_processors(),
            renderer=cp.get_renderer(),
        )
        t = time.time()
        try:
            rendered = conv(PDF)
            text, _, _ = text_from_rendered(rendered)
            ok, err = True, None
        except Exception as e:  # keep going; failure is logged and retried later
            text, ok, err = "", False, repr(e)
        dt = time.time() - t
        if ok:
            with open(out, "w", encoding="utf-8") as f:
                f.write(text)
        rec = {"file": u["file"], "pages": u["pdf_end"] - u["pdf_start"] + 1, "seconds": round(dt, 1),
               "chars": len(text), "ok": ok, "error": err, "force_ocr": bool(args.force_ocr)}
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")
        print(rec, flush=True)
    print(f"done in {time.time() - t0:.1f}s", flush=True)


if __name__ == "__main__":
    main()
