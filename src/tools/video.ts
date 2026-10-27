import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { insideProject } from "./images.js";

// Video helpers for the Video Editor and QA, built on the ffmpeg/ffprobe
// binaries from the ffmpeg-static and ffprobe-static packages (nothing is
// installed system-wide). The editor can see frames but can't hear, so
// analyze() reports pauses and loudness to help it cut between sentences.

const require = createRequire(import.meta.url);
export const FFMPEG: string = require("ffmpeg-static");
export const FFPROBE: string = (require("ffprobe-static") as { path: string }).path;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runBinary(
  bin: string,
  args: string[],
  { cwd, signal, timeoutMs = 30 * 60_000 }: { cwd?: string; signal?: AbortSignal | undefined; timeoutMs?: number } = {}
): Promise<RunResult> {
  if (!existsSync(bin)) {
    return Promise.reject(new Error(`${path.basename(bin)} is missing. Run: node node_modules/ffmpeg-static/install.js`));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, windowsHide: true, ...(signal ? { signal } : {}) });
    let stdout = "";
    let stderr = "";
    // Keep the tail only: a long render writes a lot of progress output.
    child.stdout.on("data", (d: Buffer) => { stdout = (stdout + d.toString()).slice(-2_000_000); });
    child.stderr.on("data", (d: Buffer) => { stderr = (stderr + d.toString()).slice(-200_000); });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

// "83.4" → "1:23.4"
export function timecode(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = (s % 60).toFixed(1).padStart(4, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

// "1:23.4", "01:02:03", "83" → seconds
export function parseTimecode(value: string | number): number {
  if (typeof value === "number") return value;
  const parts = value.trim().split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) throw new Error(`Not a timecode: ${value}`);
  return parts.reduce((total, n) => total * 60 + n, 0);
}

export interface ProbeResult {
  duration: number;
  sizeBytes: number;
  container: string;
  video: { width: number; height: number; fps: number; codec: string; rotation: number } | null;
  audio: { codec: string; channels: number; sampleRate: number } | null;
}

export function summariseProbe(json: unknown): ProbeResult {
  const data = json as {
    format?: { duration?: string; size?: string; format_name?: string };
    streams?: Array<Record<string, any>>;
  };
  const streams = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  const a = streams.find((s) => s.codec_type === "audio");

  let video: ProbeResult["video"] = null;
  if (v) {
    const rotation = Number(v.tags?.rotate ?? v.side_data_list?.find((d: any) => d.rotation !== undefined)?.rotation ?? 0);
    const [num, den] = String(v.avg_frame_rate ?? v.r_frame_rate ?? "0/1").split("/").map(Number);
    const sideways = Math.abs(rotation) % 180 === 90;
    video = {
      // Phones store portrait video as landscape plus a rotation flag.
      width: sideways ? Number(v.height) : Number(v.width),
      height: sideways ? Number(v.width) : Number(v.height),
      fps: den ? Math.round(((num ?? 0) / den) * 100) / 100 : 0,
      codec: String(v.codec_name ?? ""),
      rotation
    };
  }

  return {
    duration: Math.round(Number(data.format?.duration ?? v?.duration ?? a?.duration ?? 0) * 100) / 100,
    sizeBytes: Number(data.format?.size ?? 0),
    container: String(data.format?.format_name ?? ""),
    video,
    audio: a ? { codec: String(a.codec_name ?? ""), channels: Number(a.channels ?? 0), sampleRate: Number(a.sample_rate ?? 0) } : null
  };
}

export async function probe(file: string): Promise<ProbeResult> {
  const result = await runBinary(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { timeoutMs: 60_000 });
  if (result.code !== 0) throw new Error(`ffprobe couldn't read ${path.basename(file)}: ${result.stderr.trim().slice(-300)}`);
  return summariseProbe(JSON.parse(result.stdout));
}

export interface Analysis {
  scenes: number[];
  silences: { start: number; end: number }[];
  loudness: { integratedLufs: number; truePeakDb: number } | null;
}

export function parseSilences(stderr: string, duration: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let start: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const s = /silence_start: (-?[\d.]+)/.exec(line);
    if (s) start = Math.max(0, Number(s[1]));
    const e = /silence_end: ([\d.]+)/.exec(line);
    if (e && start !== null) { out.push({ start, end: Number(e[1]) }); start = null; }
  }
  if (start !== null) out.push({ start, end: duration });
  return out;
}

export function parseLoudness(stderr: string): Analysis["loudness"] {
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const i = /I:\s+(-?[\d.]+|-inf) LUFS/.exec(summary);
  const p = /Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary);
  if (!i) return null;
  const num = (s: string | undefined) => (s === undefined || s === "-inf" ? -Infinity : Number(s));
  return { integratedLufs: num(i[1]), truePeakDb: num(p?.[1]) };
}

export function parseScenes(stderr: string): number[] {
  const times: number[] = [];
  for (const m of stderr.matchAll(/pts_time:([\d.]+)/g)) times.push(Math.round(Number(m[1]) * 10) / 10);
  return times;
}

// Scene changes (picture cuts), pauses in the audio (likely gaps between
// sentences) and overall loudness.
export async function analyze(file: string, signal?: AbortSignal): Promise<Analysis & { probe: ProbeResult }> {
  const info = await probe(file);
  let scenes: number[] = [];
  let silences: Analysis["silences"] = [];
  let loudness: Analysis["loudness"] = null;

  if (info.video) {
    const r = await runBinary(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-an", "-vf", "scale=320:-2,select='gt(scene,0.35)',showinfo", "-f", "null", "-"], { signal });
    scenes = parseScenes(r.stderr);
  }
  if (info.audio) {
    const r = await runBinary(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "silencedetect=noise=-35dB:d=0.5,ebur128=peak=true", "-f", "null", "-"], { signal });
    silences = parseSilences(r.stderr, info.duration);
    loudness = parseLoudness(r.stderr);
  }

  return { probe: info, scenes, silences, loudness };
}

// Grabs frames at the given times (or evenly spread) as small JPEGs.
export async function grabFrames(
  file: string,
  times: number[],
  signal?: AbortSignal
): Promise<{ time: number; data: string }[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "frames-"));
  try {
    const frames: { time: number; data: string }[] = [];
    for (const [i, time] of times.entries()) {
      const out = path.join(dir, `f${i}.jpg`);
      const r = await runBinary(FFMPEG, ["-hide_banner", "-loglevel", "error", "-ss", String(time), "-i", file, "-frames:v", "1", "-vf", "scale='min(480,iw)':-2", "-q:v", "4", "-y", out], { signal, timeoutMs: 60_000 });
      if (r.code === 0 && existsSync(out)) frames.push({ time, data: (await readFile(out)).toString("base64") });
    }
    return frames;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function spreadTimes(duration: number, count: number): number[] {
  const n = Math.max(1, Math.min(count, 16));
  return Array.from({ length: n }, (_, i) => Math.round(((i + 0.5) * duration / n) * 10) / 10);
}

const FONTS_DIR = path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts").toLowerCase();

// Checks ffmpeg arguments before the agent's command runs: paths must stay in
// the project (system fonts are allowed for drawtext), no other protocols.
export function checkFfmpegArgs(projectPath: string, args: string[]): void {
  // The concat demuxer's safe mode keeps list files to plain relative names.
  const safe = args.indexOf("-safe");
  if (safe !== -1 && args[safe + 1] === "0") throw new Error("-safe 0 isn't allowed; list files by relative name in the concat file.");

  for (const arg of args) {
    if (typeof arg !== "string") throw new Error("ffmpeg arguments must be strings.");
    if (/(^|[\\/'":=])\.\.([\\/]|$)/.test(arg)) throw new Error(`"${arg}" points outside the project.`);
    if (/\b(https?|ftp|rtmp|rtsp|tcp|udp|pipe|concat):/i.test(arg) && !/^concat$/i.test(arg)) {
      throw new Error(`"${arg}": network and pipe inputs aren't allowed.`);
    }
    const absolute = arg.match(/(?:^|[='":])([a-zA-Z](?:\\)?:[\\/][^'":,;]*)/g) ?? [];
    for (const raw of absolute) {
      const p = raw.replace(/^[='":]/, "").replace(/\\:/, ":");
      const lower = path.resolve(p).toLowerCase();
      if (!lower.startsWith(path.resolve(projectPath).toLowerCase()) && !lower.startsWith(FONTS_DIR)) {
        throw new Error(`"${arg}" points outside the project.`);
      }
    }
    if (/^[\\/]/.test(arg)) throw new Error(`"${arg}": use paths relative to the project.`);
  }
}

// Where the editor may write: final exports in media/, work files in
// .ai/renders/ (both git-ignored).
export function checkOutput(projectPath: string, output: string): { full: string; final: boolean } {
  const full = insideProject(projectPath, output);
  const rel = path.relative(projectPath, full).split(path.sep).join("/");
  if (/^media\/[^/]+$/.test(rel)) return { full, final: true };
  if (rel.startsWith(".ai/renders/")) return { full, final: false };
  throw new Error("Write final videos to media/<name>.mp4 and work files to .ai/renders/.");
}
