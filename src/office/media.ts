import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import type { Readable } from "node:stream";

import { probe } from "../tools/video.js";
import { ProjectError, type ProjectStore } from "./projects.js";

// Files the human uploads for the team to work with: clips, images, audio,
// PDFs, fonts and notes. They live in projects/<name>/media/, which is
// git-ignored (the repo is public and videos are large), and are described in
// media/library.json so agents can find them without opening binary files.

export const MEDIA_DIR = "media";
export const LIBRARY_FILE = "library.json";

export type MediaKind = "video" | "image" | "audio" | "pdf" | "font" | "text";

const KINDS: Record<string, { kind: MediaKind; type: string }> = {
  ".mp4": { kind: "video", type: "video/mp4" },
  ".m4v": { kind: "video", type: "video/mp4" },
  ".mov": { kind: "video", type: "video/quicktime" },
  ".webm": { kind: "video", type: "video/webm" },
  ".mkv": { kind: "video", type: "video/x-matroska" },
  ".avi": { kind: "video", type: "video/x-msvideo" },
  ".png": { kind: "image", type: "image/png" },
  ".jpg": { kind: "image", type: "image/jpeg" },
  ".jpeg": { kind: "image", type: "image/jpeg" },
  ".gif": { kind: "image", type: "image/gif" },
  ".webp": { kind: "image", type: "image/webp" },
  ".svg": { kind: "image", type: "image/svg+xml" },
  ".mp3": { kind: "audio", type: "audio/mpeg" },
  ".wav": { kind: "audio", type: "audio/wav" },
  ".m4a": { kind: "audio", type: "audio/mp4" },
  ".aac": { kind: "audio", type: "audio/aac" },
  ".ogg": { kind: "audio", type: "audio/ogg" },
  ".pdf": { kind: "pdf", type: "application/pdf" },
  ".ttf": { kind: "font", type: "font/ttf" },
  ".otf": { kind: "font", type: "font/otf" },
  ".woff": { kind: "font", type: "font/woff" },
  ".woff2": { kind: "font", type: "font/woff2" },
  ".txt": { kind: "text", type: "text/plain; charset=utf-8" },
  ".md": { kind: "text", type: "text/plain; charset=utf-8" },
  ".csv": { kind: "text", type: "text/plain; charset=utf-8" },
  ".json": { kind: "text", type: "text/plain; charset=utf-8" },
  ".srt": { kind: "text", type: "text/plain; charset=utf-8" },
  ".vtt": { kind: "text", type: "text/plain; charset=utf-8" }
};

export const ACCEPTED_EXTENSIONS = Object.keys(KINDS);

export function mediaKind(file: string): MediaKind | null {
  return KINDS[path.extname(file).toLowerCase()]?.kind ?? null;
}

export function isBinaryMedia(file: string): boolean {
  const kind = mediaKind(file);
  return kind !== null && kind !== "text";
}

export interface MediaItem {
  id: string; // file name inside media/
  originalName: string;
  kind: MediaKind;
  size: number;
  uploadedAt: string;
  // Set when the team made the file (e.g. "Designer").
  madeBy?: string;
  // What's in it, in the human's words. Agents rely on this for things
  // they can't perceive themselves, such as what's said in a clip.
  note?: string;
  width?: number;
  height?: number;
  duration?: number; // seconds
}

export type MediaPatch = Partial<Pick<MediaItem, "note" | "width" | "height" | "duration">>;

// Turns an uploaded file name into a safe, readable one: "My Clip (1).MOV" → "my-clip-1.mov".
export function toMediaName(original: string): string {
  const ext = path.extname(original).toLowerCase();
  if (!KINDS[ext]) {
    throw new ProjectError(`Can't upload ${ext ? `${ext} files` : "files without an extension"}. Use video, image, audio, PDF, font or text files.`, 415);
  }

  const base = path
    .basename(original, path.extname(original))
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return `${base || "file"}${ext}`;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*\.[a-z0-9]+$/;

async function readLibraryFile(dir: string): Promise<MediaItem[]> {
  try {
    const parsed = JSON.parse(await readFile(path.join(dir, LIBRARY_FILE), "utf-8")) as { items?: MediaItem[] };
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

async function writeLibraryFile(dir: string, items: MediaItem[]): Promise<void> {
  const body = {
    about: "Files for this project: uploads from the human, and files the team made (madeBy). Binary files can't be opened with read_file; use these descriptions, or view_image for images.",
    items
  };
  await writeFile(path.join(dir, LIBRARY_FILE), `${JSON.stringify(body, null, 2)}\n`, "utf-8");
}

// Adds (or refreshes) a file the team made in media/, e.g. a rendered design,
// so it shows up in the Office's media panel next to the uploads.
export async function registerGenerated(
  projectPath: string,
  id: string,
  details: { madeBy: string; note: string; width?: number; height?: number; duration?: number }
): Promise<MediaItem> {
  if (!ID_PATTERN.test(id)) throw new Error(`Invalid media file name: ${id}`);

  const dir = path.join(projectPath, MEDIA_DIR);
  const { size } = await stat(path.join(dir, id));
  const items = await readLibraryFile(dir);
  const item: MediaItem = {
    id,
    originalName: id,
    kind: mediaKind(id)!,
    size,
    uploadedAt: new Date().toISOString(),
    ...details
  };
  await writeLibraryFile(dir, [...items.filter((m) => m.id !== id), item]);
  return item;
}

export class MediaStore {
  // Serialises library.json writes per project.
  private locks = new Map<string, Promise<unknown>>();

  constructor(
    private projects: ProjectStore,
    public maxBytes = 2 * 1024 ** 3
  ) {}

  private async dir(project: string): Promise<string> {
    const full = path.join(await this.projects.requireProject(project), MEDIA_DIR);
    await mkdir(full, { recursive: true });
    return full;
  }

  private async withLock<T>(project: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(project) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    this.locks.set(project, next.catch(() => undefined));
    return next;
  }

  private readLibrary(dir: string): Promise<MediaItem[]> {
    return readLibraryFile(dir);
  }

  private writeLibrary(dir: string, items: MediaItem[]): Promise<void> {
    return writeLibraryFile(dir, items);
  }

  async list(project: string): Promise<MediaItem[]> {
    return this.readLibrary(await this.dir(project));
  }

  async filePath(project: string, id: string): Promise<{ file: string; item: MediaItem }> {
    if (!ID_PATTERN.test(id)) throw new ProjectError("Invalid media file name.", 400);

    const dir = await this.dir(project);
    const item = (await this.readLibrary(dir)).find((m) => m.id === id);
    if (!item) throw new ProjectError(`There is no media file called "${id}".`, 404);

    return { file: path.join(dir, id), item };
  }

  // Streams an upload to disk, then adds it to the library. A name that's
  // already taken gets a number: clip.mp4, clip-2.mp4, ...
  async save(project: string, originalName: string, body: Readable): Promise<MediaItem> {
    const name = toMediaName(originalName);
    const dir = await this.dir(project);
    const part = path.join(dir, `.upload-${randomBytes(6).toString("hex")}.part`);

    let size = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        const out = createWriteStream(part);
        body.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > this.maxBytes) {
            body.unpipe(out);
            out.destroy();
            body.resume();
            reject(new ProjectError(`That file is larger than ${Math.round(this.maxBytes / 1024 ** 2)} MB.`, 413));
          }
        });
        body.on("error", reject);
        body.on("aborted", () => reject(new ProjectError("The upload was interrupted.", 400)));
        out.on("error", reject);
        out.on("finish", resolve);
        body.pipe(out);
      });

      if (size === 0) throw new ProjectError("That file is empty.", 400);

      return await this.withLock(project, async () => {
        const items = await this.readLibrary(dir);
        const ext = path.extname(name);
        const stem = path.basename(name, ext);
        let id = name;
        for (let n = 2; items.some((m) => m.id === id); n++) id = `${stem}-${n}${ext}`;

        await rename(part, path.join(dir, id));

        const item: MediaItem = {
          id,
          originalName: path.basename(originalName).slice(0, 200),
          kind: mediaKind(id)!,
          size,
          uploadedAt: new Date().toISOString(),
          ...(await probeDetails(path.join(dir, id)))
        };
        await this.writeLibrary(dir, [...items, item]);
        return item;
      });
    } catch (error) {
      await rm(part, { force: true });
      throw error;
    }
  }

  async update(project: string, id: string, patch: MediaPatch): Promise<MediaItem> {
    const { item } = await this.filePath(project, id);
    const dir = await this.dir(project);

    const clean: MediaPatch = {};
    if (typeof patch.note === "string") clean.note = patch.note.trim().slice(0, 8000);
    // Sizes measured by the browser only fill gaps; ffprobe's are better.
    for (const key of ["width", "height", "duration"] as const) {
      if (item[key]) continue;
      const value = patch[key];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) clean[key] = Math.round(value * 100) / 100;
    }

    return this.withLock(project, async () => {
      const items = await this.readLibrary(dir);
      const updated = { ...item, ...items.find((m) => m.id === id), ...clean };
      if (clean.note === "") delete updated.note;
      await this.writeLibrary(dir, items.map((m) => (m.id === id ? updated : m)));
      return updated;
    });
  }

  async remove(project: string, id: string): Promise<void> {
    const { file } = await this.filePath(project, id);
    const dir = await this.dir(project);

    await this.withLock(project, async () => {
      await rm(file, { force: true });
      await this.writeLibrary(dir, (await this.readLibrary(dir)).filter((m) => m.id !== id));
    });
  }

  // Sends a file, honouring Range requests so videos can be scrubbed.
  async send(project: string, id: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { file } = await this.filePath(project, id);
    const { size } = await stat(file);
    const info = KINDS[path.extname(id).toLowerCase()]!;

    const headers: Record<string, string> = {
      "content-type": info.type,
      "accept-ranges": "bytes",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    };
    // Uploaded SVGs (and anything else that could run script) are served
    // sandboxed, since this origin can start agents.
    if (info.kind !== "pdf") headers["content-security-policy"] = "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'";

    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(size - 1, end);

      if (start > end || start >= size) {
        res.writeHead(416, { "content-range": `bytes */${size}` });
        res.end();
        return;
      }

      res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, { ...headers, "content-length": String(size) });
    createReadStream(file).pipe(res);
  }
}

// Duration and display size for videos and audio, from ffprobe. Best effort:
// a file ffprobe can't read is still kept.
async function probeDetails(file: string): Promise<Partial<MediaItem>> {
  const kind = mediaKind(file);
  if (kind !== "video" && kind !== "audio") return {};
  try {
    const info = await probe(file);
    return {
      ...(info.duration ? { duration: info.duration } : {}),
      ...(info.video ? { width: info.video.width, height: info.video.height } : {})
    };
  } catch {
    return {};
  }
}

// How a task's attached media is described to the agents.
export function describeMedia(items: MediaItem[]): string {
  if (!items.length) return "";

  const line = (m: MediaItem) => {
    const facts = [
      m.kind,
      m.width && m.height ? `${m.width}×${m.height}` : "",
      m.duration ? `${m.duration}s` : "",
      m.size < 1024 ** 2 ? `${Math.max(1, Math.round(m.size / 1024))} KB` : `${(m.size / 1024 ** 2).toFixed(1)} MB`
    ].filter(Boolean).join(", ");
    return `- media/${m.id} (${facts})${m.note ? `: ${m.note}` : ""}`;
  };

  return items.map(line).join("\n");
}
