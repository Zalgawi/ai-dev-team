import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";

import { chromium } from "playwright-core";

import { buildToolDefinitions } from "../llm/tools.js";
import { imageSize } from "./images.js";
import { buildLibrary, searchLibrary, searchTerms } from "./library.js";
import { closePdf, openPdf, outline, pageLabel, pageText, parsePages, renderPage } from "./pdf.js";
import { refuseCommand, runCommand } from "./terminal.js";

let root: string;
let project: string;

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "library-test-"));
  project = path.join(root, "fund");
  await mkdir(path.join(project, "media"), { recursive: true });

  // A three-page "book" with headings, so the PDF has an outline.
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <style>section { break-after: page; font: 14px serif; }</style>
      <section><h1>Chapter 1 Returns</h1><p>Simple returns and log returns. Annualise volatility with the square root of 252.</p></section>
      <section><h1>Chapter 2 Money management</h1><p>The Kelly criterion maximises long-run growth. Betting full Kelly is risky, so traders use half Kelly.</p></section>
      <section><h1>Chapter 3 Testing</h1><p>A walk-forward test re-fits parameters on a rolling window. Avoid look-ahead bias.</p></section>`);
    await page.pdf({ path: path.join(project, "media", "money-book.pdf"), format: "A5", outline: true, tagged: true });
  } finally {
    await browser.close();
  }
});

after(async () => {
  await closePdf();
  await rm(root, { recursive: true, force: true });
});

describe("pdf reading", () => {
  it("reads text, outline and page ranges, and renders pages", async () => {
    const book = await openPdf(path.join(project, "media", "money-book.pdf"));
    assert.equal(book.pages, 3);
    assert.match(await pageText(book, 2), /Kelly criterion maximises long-run growth/);
    assert.equal(pageLabel(book, 2), "2");

    const toc = await outline(book);
    assert.deepEqual(toc.map((e) => e.page), [1, 2, 3]);
    assert.match(toc[1]!.title, /Money management/);

    const png = await renderPage(book, 1, 800);
    const size = imageSize(png);
    assert.ok(size && Math.max(size.width, size.height) <= 800 && size.height > size.width);

    assert.deepEqual(parsePages("3, 1-2", 3), [1, 2, 3]);
    assert.deepEqual(parsePages("2-9", 3), [2, 3]);
    assert.throws(() => parsePages("5", 3), /past the end/);
    assert.throws(() => parsePages("two", 3), /page range/);
  });
});

describe("library search", () => {
  it("indexes the PDFs privately and finds the right page", async () => {
    const books = await buildLibrary(project);
    assert.equal(books.length, 1);
    assert.equal(books[0]!.scanned, false);
    const indexFile = path.join(project, ".ai", "library", "money-book.pdf.json");
    const { mtimeMs } = await stat(indexFile);

    const { hits } = await searchLibrary(project, "Kelly criterion");
    assert.equal(hits[0]!.page, 2);
    assert.match(hits[0]!.section ?? "", /Money management/);
    assert.match(hits[0]!.snippet, /Kelly criterion/);

    // Hyphens and spaces match each other.
    assert.equal((await searchLibrary(project, "walk forward")).hits[0]!.page, 3);
    assert.equal((await searchLibrary(project, "look-ahead")).hits[0]!.page, 3);
    assert.deepEqual(searchTerms("The Black-Scholes delta"), ["black", "scholes", "delta"]);
    await assert.rejects(searchLibrary(project, "the of"), /search words/);

    // An unchanged book isn't indexed again.
    await buildLibrary(project);
    assert.equal((await stat(indexFile)).mtimeMs, mtimeMs);
    assert.ok(JSON.parse(await readFile(indexFile, "utf-8")).text.length === 3);
  });
});

describe("library tools", () => {
  it("search_library and read_pdf answer the agents", async () => {
    const tools = buildToolDefinitions(project);
    const call = async (name: "search_library" | "read_pdf", args: Record<string, unknown>) =>
      (await (tools[name].handler as (a: unknown, extra: unknown) => Promise<{ content: { type: string; text?: string }[]; isError?: boolean }>)(args, {}));

    const found = await call("search_library", { query: "half Kelly" });
    assert.match(found.content[0]!.text!, /money-book — PDF page 2 \(printed p\. 2\), Chapter 2 Money management/);

    const contents = await call("read_pdf", { filePath: "media/money-book.pdf" });
    assert.match(contents.content[0]!.text!, /3 pages[\s\S]*Chapter 3 Testing — PDF page 3/);

    const text = await call("read_pdf", { filePath: "media/money-book.pdf", pages: "2-3" });
    assert.match(text.content[0]!.text!, /--- PDF page 2 \(printed p\. 2\) ---\nChapter 2/);

    const images = await call("read_pdf", { filePath: "media/money-book.pdf", pages: "1", as: "image" });
    assert.deepEqual(images.content.map((c) => c.type), ["text", "image"]);

    assert.equal((await call("read_pdf", { filePath: "media/money-book.pdf", pages: "9", as: "image" })).isError, true);
    assert.equal((await call("read_pdf", { filePath: "../../secret.pdf" })).isError, true);
  });
});

describe("command guard rails", () => {
  it("refuses detached processes and heavy ML installs", () => {
    for (const command of [
      "Start-Process python -ArgumentList convert.py",
      "start /b python convert.py",
      "cmd /c start python convert.py",
      "Invoke-CimMethod -ClassName Win32_Process -MethodName Create",
      "wmic process call create python",
      "nohup python convert.py",
      "python convert.py &",
      "pip install marker-pdf",
      ".venv\\Scripts\\python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cu124",
      "huggingface-cli download some/model"
    ]) {
      assert.ok(refuseCommand(command), command);
    }
    for (const command of ["npm start", "npm test && npm run build", "pip install pandas numpy", "python -m pytest -q", "git status"]) {
      assert.equal(refuseCommand(command), null, command);
    }
  });

  it("reports a refused command without running it", async () => {
    const result = await runCommand("pip install torch", root);
    assert.equal(result.exitCode, 126);
    assert.match(result.stderr, /approval/);
  });

  it("kills the whole process tree on timeout", async () => {
    // The command starts a child that would outlive a plain shell kill.
    const script = "const c=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'ignore'});console.log(c.pid);setTimeout(()=>{},60000)";
    const result = await runCommand(`node -e "${script}"`, root, undefined, 1500);
    assert.equal(result.exitCode, 124);
    const pid = Number(result.stdout.trim());
    assert.ok(pid > 0);
    await new Promise((r) => setTimeout(r, 300));
    assert.throws(() => process.kill(pid, 0), "the child process should be gone");
  });

  it("stops when the human presses Stop", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const result = await runCommand(`node -e "setTimeout(()=>{},60000)"`, root, controller.signal);
    assert.equal(result.exitCode, 130);
  });
});
