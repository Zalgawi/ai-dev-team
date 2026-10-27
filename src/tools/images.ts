import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium, type Browser } from "playwright-core";

// Image helpers for the agents: read pixel sizes, render HTML/SVG designs to
// PNG with headless Chromium, and prepare images for an agent to look at.
// Chromium is the one Playwright installs (npx playwright install chromium).

export interface ImageSize {
  width: number;
  height: number;
}

// Reads width and height from a PNG, JPEG, GIF or WebP header.
export function imageSize(buf: Buffer): ImageSize | null {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  if (buf.length >= 10 && buf.toString("ascii", 0, 3) === "GIF") {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }

  if (buf.length >= 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }

  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1]!;
      const length = buf.readUInt16BE(i + 2);
      // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + length;
    }
  }

  return null;
}

let browser: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = chromium.launch().catch((error: Error) => {
      browser = null;
      throw new Error(`Couldn't start Chromium for rendering (${error.message.split("\n")[0]}). Run: npx playwright install chromium`);
    });
  }
  return browser;
}

export async function closeImageBrowser(): Promise<void> {
  const current = browser;
  browser = null;
  if (current) await (await current).close().catch(() => undefined);
}

// Resolves a project-relative path and refuses anything outside the project.
export function insideProject(projectPath: string, relative: string): string {
  const root = path.resolve(projectPath);
  const full = path.resolve(root, relative);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`${relative} is outside the project.`);
  }
  return full;
}

// Renders an HTML or SVG file at an exact pixel size and saves a PNG.
export async function renderToPng(source: string, output: string, size: ImageSize): Promise<ImageSize> {
  if (!/\.(html?|svg)$/i.test(source)) throw new Error("Render an .html or .svg file.");
  for (const v of [size.width, size.height]) {
    if (!Number.isInteger(v) || v < 16 || v > 4096) throw new Error("Width and height must be whole numbers from 16 to 4096.");
  }

  await stat(source);
  const page = await (await getBrowser()).newPage({ viewport: size });
  try {
    await page.goto(pathToFileURL(source).href, { waitUntil: "load", timeout: 20_000 });
    await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
    await page.screenshot({ path: output, clip: { x: 0, y: 0, ...size }, type: "png" });
  } finally {
    await page.close();
  }
  return size;
}

const VIEW_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const MAX_VIEW_BYTES = 3.5 * 1024 ** 2;
const MAX_VIEW_SIDE = 1568;

export interface ViewableImage {
  data: string; // base64
  mimeType: string;
  size: ImageSize | null; // original size
  note?: string;
}

// Loads an image for an agent to look at. SVGs are rendered first, and large
// images are scaled down (the original file is untouched).
export async function viewableImage(file: string): Promise<ViewableImage> {
  const ext = path.extname(file).toLowerCase();

  if (ext === ".svg") {
    const page = await (await getBrowser()).newPage({ viewport: { width: 1024, height: 1024 } });
    try {
      await page.goto(pathToFileURL(file).href, { waitUntil: "load", timeout: 20_000 });
      const box = await page.evaluate(() => {
        const svg = document.documentElement as unknown as SVGSVGElement;
        const r = svg.getBoundingClientRect();
        return { width: Math.ceil(r.width) || 1024, height: Math.ceil(r.height) || 1024 };
      });
      const clip = { x: 0, y: 0, width: Math.min(box.width, 1024), height: Math.min(box.height, 1024) };
      const data = (await page.screenshot({ clip, type: "png" })).toString("base64");
      return { data, mimeType: "image/png", size: box, note: "SVG rendered to PNG for viewing." };
    } finally {
      await page.close();
    }
  }

  const mimeType = VIEW_TYPES[ext];
  if (!mimeType) throw new Error("view_image supports .png, .jpg, .jpeg, .gif, .webp and .svg.");

  const buf = await readFile(file);
  const size = imageSize(buf);
  const tooBig = buf.length > MAX_VIEW_BYTES || (size && Math.max(size.width, size.height) > MAX_VIEW_SIDE);

  if (!tooBig) return { data: buf.toString("base64"), mimeType, size };

  // Scale down in the browser so the agent gets a manageable picture.
  const scale = size ? Math.min(1, MAX_VIEW_SIDE / Math.max(size.width, size.height)) : 1;
  const view = size
    ? { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }
    : { width: MAX_VIEW_SIDE, height: MAX_VIEW_SIDE };
  const page = await (await getBrowser()).newPage({ viewport: view });
  try {
    await page.setContent(`<style>html,body{margin:0;background:#fff}img{width:100vw;height:100vh;object-fit:contain;display:block}</style><img src="data:${mimeType};base64,${buf.toString("base64")}">`);
    await page.waitForFunction(() => (document.querySelector("img") as HTMLImageElement)?.complete);
    const data = (await page.screenshot({ type: "jpeg", quality: 85 })).toString("base64");
    return { data, mimeType: "image/jpeg", size, note: `Scaled down to ${view.width}×${view.height} for viewing.` };
  } finally {
    await page.close();
  }
}

// Lays frames out in a labelled grid so an agent can see a whole clip in one
// image. Returns a base64 JPEG.
export async function contactSheet(frames: { label: string; data: string }[]): Promise<string> {
  const cols = frames.length <= 2 ? frames.length : frames.length <= 6 ? 3 : 4;
  const cell = cols >= 4 ? 240 : 320;
  const width = cols * (cell + 8) + 8;
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const html = `<style>
    body{margin:0;background:#111;font:600 15px system-ui,sans-serif;color:#fff}
    .g{display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:8px;padding:8px}
    figure{margin:0;position:relative}
    img{width:${cell}px;display:block}
    figcaption{position:absolute;left:4px;top:4px;background:rgba(0,0,0,.75);padding:2px 6px;border-radius:3px}
  </style><div class="g">${frames
    .map((f) => `<figure><img src="data:image/jpeg;base64,${f.data}"><figcaption>${esc(f.label)}</figcaption></figure>`)
    .join("")}</div>`;

  const page = await (await getBrowser()).newPage({ viewport: { width, height: 200 } });
  try {
    await page.setContent(html);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    return (await page.screenshot({ fullPage: true, type: "jpeg", quality: 80 })).toString("base64");
  } finally {
    await page.close();
  }
}
