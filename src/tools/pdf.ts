import { readFile, stat } from "node:fs/promises";

import { getDocument, type PDFDocumentLoadingTask, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

// PDF reading for the agents with pdf.js: the text layer page by page (fast
// and light: a 1,400-page book takes seconds) and single pages rendered to PNG
// for checking equations, figures and scanned books by eye. No OCR or ML.

export interface OutlineEntry {
  title: string;
  page: number; // 1-based PDF page
  depth: number;
}

export interface PdfBook {
  doc: PDFDocumentProxy;
  task: PDFDocumentLoadingTask;
  pages: number;
  labels: string[] | null; // printed page numbers, e.g. "39" for PDF page 60
}

// pdf.js's Node canvas factory (backed by @napi-rs/canvas).
interface CanvasFactory {
  create(width: number, height: number): {
    canvas: HTMLCanvasElement & { toBuffer(type: "image/png"): Buffer };
    context: CanvasRenderingContext2D;
  };
}

// One open document at a time: books can be large.
let open: { file: string; mtimeMs: number; book: PdfBook } | null = null;

export async function openPdf(file: string): Promise<PdfBook> {
  const { mtimeMs } = await stat(file);
  if (open && open.file === file && open.mtimeMs === mtimeMs) return open.book;
  await closePdf();

  const task = getDocument({ data: new Uint8Array(await readFile(file)), verbosity: 0 });
  const doc = await task.promise;
  const book = { doc, task, pages: doc.numPages, labels: await doc.getPageLabels().catch(() => null) };
  open = { file, mtimeMs, book };
  return book;
}

export async function closePdf(): Promise<void> {
  const current = open;
  open = null;
  await current?.book.task.destroy();
}

// The printed page number, when the PDF defines page labels.
export function pageLabel(book: PdfBook, page: number): string {
  return book.labels?.[page - 1] || String(page);
}

export async function pageText(book: PdfBook, page: number): Promise<string> {
  const p = await book.doc.getPage(page);
  try {
    const content = await p.getTextContent();
    let text = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      text += item.str + (item.hasEOL ? "\n" : item.str.endsWith(" ") ? "" : " ");
    }
    return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  } finally {
    p.cleanup();
  }
}

export async function outline(book: PdfBook): Promise<OutlineEntry[]> {
  const entries: OutlineEntry[] = [];
  const walk = async (items: Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>, depth: number) => {
    for (const item of items ?? []) {
      if (entries.length >= 5000) return;
      let page = 0;
      try {
        const dest = typeof item.dest === "string" ? await book.doc.getDestination(item.dest) : item.dest;
        if (dest?.[0]) page = (await book.doc.getPageIndex(dest[0])) + 1;
      } catch { /* external or broken link */ }
      if (page) entries.push({ title: item.title.trim(), page, depth });
      await walk(item.items, depth + 1);
    }
  };
  await walk(await book.doc.getOutline(), 0);
  return entries;
}

// Renders one page to PNG with its longer side at most maxSide pixels.
export async function renderPage(book: PdfBook, page: number, maxSide = 1600): Promise<Buffer> {
  const p = await book.doc.getPage(page);
  try {
    const base = p.getViewport({ scale: 1 });
    const viewport = p.getViewport({ scale: Math.min(3, maxSide / Math.max(base.width, base.height)) });
    const factory = book.doc.canvasFactory as CanvasFactory;
    const { canvas, context } = factory.create(Math.floor(viewport.width), Math.floor(viewport.height));
    await p.render({ canvasContext: context, viewport, canvas }).promise;
    return canvas.toBuffer("image/png");
  } finally {
    p.cleanup();
  }
}

// Parses "12", "12-15" or "3, 7-9" into sorted, unique page numbers.
export function parsePages(spec: string, max: number): number[] {
  const pages = new Set<number>();
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part);
    if (!m) throw new Error(`Can't read the page range "${part}". Use e.g. "12", "12-15" or "3, 7-9".`);
    const from = Number(m[1]), to = Number(m[2] ?? m[1]);
    if (from < 1 || to < from) throw new Error(`Bad page range "${part}".`);
    if (from > max) throw new Error(`Page ${from} is past the end (the PDF has ${max} pages).`);
    for (let n = from; n <= Math.min(to, max); n++) pages.add(n);
  }
  return [...pages].sort((a, b) => a - b);
}
