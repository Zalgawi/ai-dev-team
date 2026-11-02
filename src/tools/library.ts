import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { closePdf, openPdf, outline, pageText, type OutlineEntry } from "./pdf.js";

// A private, searchable index of the project's PDFs (media/*.pdf), so agents
// can use the human's books as a cited source: search finds the pages, then
// read_pdf reads them. The index is built from the PDFs' text layer and kept in
// .ai/library/ (git-ignored, because it contains the books' text). Scanned
// books have no text layer; they're listed so agents can read their pages as
// images instead.

const INDEX_DIR = path.join(".ai", "library");
const VERSION = 2;

export interface BookIndex {
  version: number;
  id: string; // media file name
  title: string;
  size: number;
  mtimeMs: number;
  pages: number;
  labels: string[] | null;
  outline: OutlineEntry[];
  scanned: boolean; // no usable text layer
  text: string[]; // per page
}

export interface SearchHit {
  book: string;
  title: string;
  page: number;
  label: string;
  section: string | null;
  score: number;
  snippet: string;
}

function cleanText(text: string): string {
  return text
    .replace(/ﬀ/g, "ff").replace(/ﬁ/g, "fi").replace(/ﬂ/g, "fl")
    .replace(/ﬃ/g, "ffi").replace(/ﬄ/g, "ffl")
    .replace(/(\w)-\n(\w)/g, "$1$2");
}

async function titles(mediaDir: string): Promise<Map<string, string>> {
  try {
    const lib = JSON.parse(await readFile(path.join(mediaDir, "library.json"), "utf-8"));
    const items: { id: string; originalName?: string }[] = Array.isArray(lib) ? lib : lib.items ?? [];
    return new Map(items.map((m) => [m.id, (m.originalName ?? m.id).replace(/\.pdf$/i, "")]));
  } catch {
    return new Map();
  }
}

// Brings the index up to date with media/*.pdf and returns every book's index.
export async function buildLibrary(
  projectPath: string,
  onProgress?: (message: string) => void
): Promise<BookIndex[]> {
  const mediaDir = path.join(projectPath, "media");
  const indexDir = path.join(projectPath, INDEX_DIR);
  const files = (await readdir(mediaDir).catch(() => [] as string[])).filter((f) => /\.pdf$/i.test(f)).sort();
  if (!files.length) return [];
  await mkdir(indexDir, { recursive: true });
  const names = await titles(mediaDir);
  const books: BookIndex[] = [];

  for (const id of files) {
    const file = path.join(mediaDir, id);
    const { size, mtimeMs } = await stat(file);
    const indexFile = path.join(indexDir, `${id}.json`);
    const existing = await readFile(indexFile, "utf-8").then((s) => JSON.parse(s) as BookIndex).catch(() => null);
    if (existing && existing.version === VERSION && existing.size === size && existing.mtimeMs === mtimeMs) {
      books.push(existing);
      continue;
    }

    onProgress?.(`indexing ${id}`);
    try {
      const book = await openPdf(file);
      const text: string[] = [];
      for (let n = 1; n <= book.pages; n++) text.push(cleanText(await pageText(book, n)));
      const withText = text.filter((t) => t.length >= 40).length;
      const index: BookIndex = {
        version: VERSION,
        id,
        title: names.get(id) ?? id.replace(/\.pdf$/i, ""),
        size,
        mtimeMs,
        pages: book.pages,
        labels: book.labels,
        outline: await outline(book),
        scanned: withText < book.pages * 0.2,
        text
      };
      await writeFile(indexFile, JSON.stringify(index));
      books.push(index);
    } catch (error) {
      onProgress?.(`couldn't read ${id}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await closePdf();
    }
  }
  return books;
}

// Lower-cased page text, cached per project until a book changes.
const cache = new Map<string, { key: string; books: BookIndex[]; lower: string[][] }>();

async function loadLibrary(projectPath: string, onProgress?: (message: string) => void) {
  const books = await buildLibrary(projectPath, onProgress);
  const key = books.map((b) => `${b.id}:${b.size}:${b.mtimeMs}`).join("|");
  const hit = cache.get(projectPath);
  if (hit && hit.key === key) return hit;
  // Hyphens become spaces (same length, so offsets still match the raw text):
  // "walk-forward" and "walk forward" match each other.
  const entry = { key, books, lower: books.map((b) => b.text.map((t) => t.toLowerCase().replace(/[-‐-—]/g, " "))) };
  cache.set(projectPath, entry);
  return entry;
}

const isWordChar = (c: string | undefined) => !!c && /[a-z0-9]/.test(c);

// Counts matches of term that start at a word boundary.
function countTerm(text: string, term: string): { count: number; first: number } {
  let count = 0, first = -1;
  for (let i = text.indexOf(term); i !== -1; i = text.indexOf(term, i + term.length)) {
    if (isWordChar(text[i - 1])) continue;
    if (first === -1) first = i;
    count++;
  }
  return { count, first };
}

const queryWords = (query: string) =>
  query.toLowerCase().split(/[^a-z0-9']+/).map((t) => t.replace(/^'+|'+$/g, "")).filter(Boolean);

export function searchTerms(query: string): string[] {
  return [...new Set(queryWords(query).filter((t) => t.length >= 2 && !STOP.has(t)))];
}

// Contents pages (dot leaders) and back-of-book index pages (lists of page
// numbers) rank below real text.
const isContentsPage = (text: string) =>
  (text.match(/(\. ?){5,}/g)?.length ?? 0) >= 8 || (text.match(/, ?\d/g)?.length ?? 0) >= 30;

const STOP = new Set(["the", "and", "of", "to", "in", "a", "an", "for", "on", "with", "is", "are", "by", "as", "at", "or", "be", "from", "that", "this", "it", "how", "what", "why"]);

function section(book: BookIndex, page: number): string | null {
  let best: OutlineEntry | null = null;
  for (const e of book.outline) if (e.page <= page && (!best || e.page >= best.page)) best = e;
  return best?.title ?? null;
}

// BM25 over pages, with a bonus when the whole query appears as a phrase.
export async function searchLibrary(
  projectPath: string,
  query: string,
  { book, limit = 8 }: { book?: string | undefined; limit?: number } = {},
  onProgress?: (message: string) => void
): Promise<{ hits: SearchHit[]; books: BookIndex[]; searched: number }> {
  const { books, lower } = await loadLibrary(projectPath, onProgress);
  const terms = searchTerms(query);
  if (!terms.length) throw new Error("Give some search words, e.g. \"Black-Scholes delta\" or \"Kelly criterion\".");
  const words = queryWords(query);
  // Words are only letters, digits and apostrophes, so they need no escaping.
  const phrase = words.length > 1 ? new RegExp(`(?<![a-z0-9])${words.join("\\s+")}`, "g") : null;
  const wanted = book?.toLowerCase();

  type Page = { b: number; p: number; counts: number[]; first: number; len: number; phrase: number; contents: boolean };
  const pages: Page[] = [];
  const df = terms.map(() => 0);
  let totalLen = 0, pageCount = 0;

  books.forEach((bk, b) => {
    if (bk.scanned) return;
    if (wanted && !bk.id.toLowerCase().includes(wanted) && !bk.title.toLowerCase().includes(wanted)) return;
    lower[b]!.forEach((text, p) => {
      pageCount++;
      totalLen += text.length;
      let first = -1;
      const counts = terms.map((t, i) => {
        const r = countTerm(text, t);
        if (r.count) df[i]!++;
        if (r.first !== -1 && (first === -1 || r.first < first)) first = r.first;
        return r.count;
      });
      if (counts.some(Boolean)) {
        const matches = phrase ? [...text.matchAll(phrase)] : [];
        pages.push({ b, p, counts, first: matches[0]?.index ?? first, len: text.length, phrase: matches.length, contents: isContentsPage(text) });
      }
    });
  });

  const avg = totalLen / Math.max(1, pageCount);
  const idf = df.map((d) => Math.log(1 + (pageCount - d + 0.5) / (d + 0.5)));
  const k1 = 1.2, bParam = 0.75;
  const scored = pages.map((pg) => {
    let score = 0;
    pg.counts.forEach((c, i) => {
      if (c) score += idf[i]! * (c * (k1 + 1)) / (c + k1 * (1 - bParam + bParam * pg.len / avg));
    });
    // Pages with every word, and with the exact phrase, rank first.
    const matched = pg.counts.filter(Boolean).length;
    score *= 0.5 + 0.5 * (matched / terms.length);
    if (pg.phrase) score += 2 + Math.log(1 + pg.phrase);
    if (pg.contents) score *= 0.4;
    return { pg, score };
  }).sort((x, y) => y.score - x.score).slice(0, Math.max(1, Math.min(20, limit)));

  const hits = scored.map(({ pg, score }) => {
    const bk = books[pg.b]!;
    const raw = bk.text[pg.p]!;
    const at = Math.max(0, pg.first);
    const start = Math.max(0, at - 200);
    const snippet = (start > 0 ? "…" : "") + raw.slice(start, at + 300).replace(/\s+/g, " ").trim() + (at + 300 < raw.length ? "…" : "");
    return {
      book: bk.id,
      title: bk.title,
      page: pg.p + 1,
      label: bk.labels?.[pg.p] || String(pg.p + 1),
      section: section(bk, pg.p + 1),
      score: Math.round(score * 100) / 100,
      snippet
    };
  });
  return { hits, books, searched: pageCount };
}
