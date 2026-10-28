import {
  createSdkMcpServer,
  tool
} from "@anthropic-ai/claude-agent-sdk";
import { mkdir, readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";

import {
  readProjectFile,
  listProjectFiles,
  writeProjectFile
} from "../tools/filesystem.js";

import { runCommand } from "../tools/terminal.js";
import { isBinaryMedia, mediaKind, registerGenerated, toMediaName } from "../office/media.js";
import { contactSheet, imageSize, insideProject, renderToPng, viewableImage } from "../tools/images.js";
import {
  analyze,
  checkFfmpegArgs,
  checkOutput,
  FFMPEG,
  grabFrames,
  parseTimecode,
  probe,
  runBinary,
  spreadTimes,
  timecode
} from "../tools/video.js";

// Name of the in-process MCP server that exposes the project tools.
// Claude sees each tool as `mcp__<server>__<tool>`.
export const TOOL_SERVER_NAME = "project";

export type ToolName =
  | "read_file"
  | "list_files"
  | "write_file"
  | "run_command"
  | "view_image"
  | "render_design"
  | "render_chart"
  | "probe_media"
  | "analyze_media"
  | "video_frames"
  | "run_ffmpeg";

export const llmTools: ToolName[] = [
  "read_file",
  "list_files",
  "write_file",
  "run_command",
  "view_image"
];

// Read-only video checks, for QA as well as the editor.
const videoChecks: ToolName[] = ["probe_media", "analyze_media", "video_frames"];

export const qaTools: ToolName[] = [
  "read_file",
  "list_files",
  "run_command",
  "view_image",
  ...videoChecks
];

export const designerTools: ToolName[] = [...llmTools, "render_design"];

export const videoEditorTools: ToolName[] = [...designerTools, ...videoChecks, "run_ffmpeg"];

export const quantTools: ToolName[] = [...llmTools, "render_chart"];

function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    isError
  };
}

async function safely(
  name: ToolName,
  fn: () => Promise<string>
) {
  try {
    const result = await fn();

    console.log(`   ✓ Tool completed`);

    return textResult(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      `   ⚠️ Tool execution failed: ${message}`
    );

    return textResult(
      JSON.stringify({
        error: true,
        tool: name,
        message,
        instruction:
          "The tool call failed. Correct the arguments and try again."
      }),
      true
    );
  }
}

// Renders an HTML/SVG file to PNG: a draft into .ai/renders/, or a final
// export into media/<prefix>-<name>.png, registered in the media library.
async function renderExport(
  projectPath: string,
  args: { source: string; name: string; width: number; height: number; draft?: boolean | undefined },
  prefix: string,
  madeBy: string
): Promise<string> {
  const source = insideProject(projectPath, args.source);

  if (args.draft) {
    const drafts = path.join(projectPath, ".ai", "renders");
    await mkdir(drafts, { recursive: true });
    const id = toMediaName(`${args.name}.png`);
    await renderToPng(source, path.join(drafts, id), { width: args.width, height: args.height });
    return `Saved draft .ai/renders/${id} (${args.width}×${args.height} px). Check it with view_image.`;
  }

  const id = toMediaName(`${prefix}-${args.name.replace(new RegExp(`^${prefix}-`), "")}.png`);
  const media = path.join(projectPath, "media");
  await mkdir(media, { recursive: true });
  const out = path.join(media, id);
  await renderToPng(source, out, { width: args.width, height: args.height });
  const real = imageSize(await readFile(out));
  await registerGenerated(projectPath, id, {
    madeBy,
    note: `Rendered from ${args.source}`,
    ...(real ?? {})
  });
  return `Saved media/${id} (${real ? `${real.width}×${real.height}` : `${args.width}×${args.height}`} px) and added it to the media library. Check it with view_image.`;
}

function buildToolDefinitions(projectPath: string, signal?: AbortSignal) {
  return {
    view_image: tool(
      "view_image",
      "Look at an image in the project (PNG, JPEG, GIF, WebP or SVG), e.g. an uploaded photo, a rendered design or a screenshot. Returns the picture and its pixel size.",
      {
        filePath: z.string().describe("Path to the image relative to the project root, e.g. media/logo.png.")
      },
      async (args) => {
        try {
          const file = insideProject(projectPath, args.filePath);
          const view = await viewableImage(file);
          const facts = [
            view.size ? `${args.filePath}: ${view.size.width}×${view.size.height} px` : args.filePath,
            view.note ?? ""
          ].filter(Boolean).join(". ");
          console.log(`   ✓ Tool completed`);
          return {
            content: [
              { type: "image" as const, data: view.data, mimeType: view.mimeType },
              { type: "text" as const, text: facts }
            ]
          };
        } catch (error) {
          return textResult(`Tool view_image failed: ${error instanceof Error ? error.message : String(error)}`, true);
        }
      }
    ),

    probe_media: tool(
      "probe_media",
      "Read a video or audio file's details: duration, resolution (as displayed, after phone rotation), frame rate, codecs and whether it has sound.",
      { filePath: z.string().describe("Path relative to the project root, e.g. media/raw-hike.mov.") },
      async (args) =>
        safely("probe_media", async () => {
          const p = await probe(insideProject(projectPath, args.filePath));
          return JSON.stringify({ ...p, durationTimecode: timecode(p.duration) }, null, 2);
        })
    ),

    analyze_media: tool(
      "analyze_media",
      "Analyse a video or audio file: scene changes (picture cuts), pauses in the audio (silences, usually gaps between sentences: cut inside these so nobody is cut off mid-word) and loudness (LUFS). You can't hear audio, so use this plus the human's notes. Long files take a while.",
      { filePath: z.string().describe("Path relative to the project root.") },
      async (args) =>
        safely("analyze_media", async () => {
          const a = await analyze(insideProject(projectPath, args.filePath), signal);
          const scenes = a.scenes.slice(0, 80).map(timecode);
          const silences = a.silences.slice(0, 120).map((s) => `${timecode(s.start)}–${timecode(s.end)}`);
          return [
            `Duration ${timecode(a.probe.duration)} (${a.probe.duration}s). Video: ${a.probe.video ? `${a.probe.video.width}×${a.probe.video.height} @ ${a.probe.video.fps}fps` : "none"}. Audio: ${a.probe.audio ? "yes" : "none"}.`,
            `Scene changes (${a.scenes.length}): ${scenes.join(", ") || "none"}${a.scenes.length > 80 ? ", …" : ""}`,
            `Pauses/silences ≥0.5s below -35 dB (${a.silences.length}): ${silences.join(", ") || "none"}${a.silences.length > 120 ? ", …" : ""}`,
            `Loudness: ${a.loudness ? `${a.loudness.integratedLufs} LUFS integrated, true peak ${a.loudness.truePeakDb} dBTP (social target about -14 LUFS, peak below -1 dBTP)` : "no audio"}`
          ].join("\n");
        })
    ),

    video_frames: tool(
      "video_frames",
      "Look at a video: returns one contact-sheet image of frames labelled with their timecodes. Give exact times (e.g. to check the moments in the human's notes or your cut points) or a count for evenly spread frames. Up to 16 frames.",
      {
        filePath: z.string().describe("Video path relative to the project root."),
        times: z.array(z.string()).optional().describe("Timecodes such as \"0:05\", \"1:23.5\" or \"83\"."),
        count: z.number().int().optional().describe("Evenly spread frames when no times are given (default 9).")
      },
      async (args) => {
        try {
          const file = insideProject(projectPath, args.filePath);
          const info = await probe(file);
          if (!info.video) return textResult(`${args.filePath} has no video stream.`, true);
          const times = (args.times?.length ? args.times.map(parseTimecode) : spreadTimes(info.duration, args.count ?? 9))
            .slice(0, 16)
            .map((t) => Math.min(Math.max(0, t), Math.max(0, info.duration - 0.05)));
          const frames = await grabFrames(file, times, signal);
          if (!frames.length) return textResult("Couldn't extract any frames.", true);
          const sheet = await contactSheet(frames.map((f) => ({ label: timecode(f.time), data: f.data })));
          console.log(`   ✓ Tool completed`);
          return {
            content: [
              { type: "image" as const, data: sheet, mimeType: "image/jpeg" },
              { type: "text" as const, text: `${args.filePath}: ${info.video.width}×${info.video.height}, ${timecode(info.duration)}. Frames at ${frames.map((f) => timecode(f.time)).join(", ")}.` }
            ]
          };
        } catch (error) {
          return textResult(`Tool video_frames failed: ${error instanceof Error ? error.message : String(error)}`, true);
        }
      }
    ),

    run_ffmpeg: tool(
      "run_ffmpeg",
      "Run ffmpeg from the project root (no shell, up to 30 minutes). Give every argument except the output in args (paths relative to the project), and the output path separately. Final videos go to media/<name>.mp4 and are added to the media library; work files go to .ai/renders/.",
      {
        args: z.array(z.string()).describe("ffmpeg arguments without the output file, e.g. [\"-ss\",\"12.5\",\"-to\",\"20\",\"-i\",\"media/raw.mp4\",\"-c:v\",\"libx264\",...]"),
        output: z.string().describe("Output path: media/<name>.mp4 for a final video, or .ai/renders/<file> for work files.")
      },
      async (args) =>
        safely("run_ffmpeg", async () => {
          checkFfmpegArgs(projectPath, args.args);
          const { full, final } = checkOutput(projectPath, args.output);
          const id = path.basename(full);
          if (final && toMediaName(id) !== id) throw new Error(`Name the final file like media/${toMediaName(id)}.`);
          await mkdir(path.dirname(full), { recursive: true });

          const started = Date.now();
          const result = await runBinary(FFMPEG, ["-hide_banner", "-nostdin", "-y", ...args.args, full], { cwd: projectPath, signal });
          const secs = Math.round((Date.now() - started) / 1000);
          if (result.code !== 0) {
            throw new Error(`ffmpeg exited with ${result.code} after ${secs}s:\n${result.stderr.trim().slice(-2500)}`);
          }

          const info = await probe(full).catch(() => null);
          const facts = info
            ? `${info.video ? `${info.video.width}×${info.video.height} @ ${info.video.fps}fps, ` : ""}${timecode(info.duration)}, ${(info.sizeBytes / 1024 ** 2).toFixed(1)} MB, audio ${info.audio ? "yes" : "none"}`
            : "unreadable output";
          if (final && info) {
            await registerGenerated(projectPath, id, {
              madeBy: "Video Editor",
              note: "Exported by the Video Editor",
              ...(info.video ? { width: info.video.width, height: info.video.height } : {}),
              duration: info.duration
            });
          }
          return `Done in ${secs}s: ${args.output} (${facts}).${final ? " Added to the media library." : ""}`;
        })
    ),

    render_design: tool(
      "render_design",
      "Render an HTML or SVG design file to a PNG at an exact pixel size. Final renders are saved as media/design-<name>.png and added to the media library so the human sees them in the Office. Set draft to true for check renders (e.g. a small-size readability test): they go to .ai/renders/<name>.png and stay out of the media library. Look at every result with view_image.",
      {
        source: z.string().describe("The .html or .svg design file, relative to the project root, e.g. design/youtube-thumbnail.html."),
        name: z.string().describe("Short name for the export, e.g. youtube-thumbnail. Saved as media/design-<name>.png."),
        width: z.number().int().describe("Width in pixels, e.g. 1280."),
        height: z.number().int().describe("Height in pixels, e.g. 720."),
        draft: z.boolean().optional().describe("true for a check render that isn't a deliverable.")
      },
      async (args) => safely("render_design", () => renderExport(projectPath, args, "design", "Designer"))
    ),

    render_chart: tool(
      "render_chart",
      "Render an HTML or SVG chart (e.g. inline SVG drawn from your results) to a PNG at an exact pixel size. Final renders are saved as media/chart-<name>.png and added to the media library so the human sees them in the Office. Set draft to true for check renders: they go to .ai/renders/<name>.png. Look at every result with view_image.",
      {
        source: z.string().describe("The .html or .svg chart file, relative to the project root, e.g. research/momentum/equity-curve.html."),
        name: z.string().describe("Short name for the export, e.g. momentum-equity-curve. Saved as media/chart-<name>.png."),
        width: z.number().int().describe("Width in pixels, e.g. 1600."),
        height: z.number().int().describe("Height in pixels, e.g. 900."),
        draft: z.boolean().optional().describe("true for a check render that isn't a deliverable.")
      },
      async (args) => safely("render_chart", () => renderExport(projectPath, args, "chart", "Quant Advisor"))
    ),

    read_file: tool(
      "read_file",
      "Read a text file from the current project.",
      {
        filePath: z
          .string()
          .describe(
            "Path to the file relative to the project root."
          )
      },
      async (args) =>
        safely("read_file", async () => {
          // Uploaded videos, images and PDFs aren't text; point to their descriptions.
          if (isBinaryMedia(args.filePath)) {
            const { size } = await stat(path.join(projectPath, args.filePath));
            return `${args.filePath} is a binary ${mediaKind(args.filePath)} file (${(size / 1024 ** 2).toFixed(1)} MB) and can't be read as text. Uploaded files are described in media/library.json.`;
          }
          return readProjectFile(projectPath, args.filePath);
        })
    ),

    list_files: tool(
      "list_files",
      "List files and folders in the current project directory.",
      {},
      async () =>
        safely("list_files", async () =>
          JSON.stringify(
            await listProjectFiles(projectPath),
            null,
            2
          )
        )
    ),

    write_file: tool(
      "write_file",
      "Write the complete contents of a text file. Do not use edit_file or patch operations. When modifying an existing file, first read it, then use this tool with the complete replacement content.",
      {
        filePath: z
          .string()
          .describe(
            "Path to the file relative to the project root."
          ),
        content: z
          .string()
          .describe(
            "The COMPLETE replacement contents of the file. Never provide a partial edit, patch, or diff."
          )
      },
      async (args) =>
        safely("write_file", async () => {
          await writeProjectFile(
            projectPath,
            args.filePath,
            args.content
          );

          return `Successfully wrote ${args.filePath}`;
        })
    ),

    run_command: tool(
      "run_command",
      "Run a terminal command from the current project directory.",
      {
        command: z
          .string()
          .describe("The terminal command to execute.")
      },
      async (args) =>
        safely("run_command", async () => {
          const result = await runCommand(
            args.command,
            projectPath,
            signal
          );

          return JSON.stringify({
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr
          });
        })
    )
  };
}

// Builds an MCP server exposing only the requested tools, bound to one project.
export function createToolServer(
  projectPath: string,
  tools: ToolName[],
  signal?: AbortSignal
) {
  const definitions = buildToolDefinitions(projectPath, signal);

  return createSdkMcpServer({
    name: TOOL_SERVER_NAME,
    version: "1.0.0",
    tools: tools.map((name) => definitions[name])
  });
}

export function qualifiedToolName(name: ToolName): string {
  return `mcp__${TOOL_SERVER_NAME}__${name}`;
}
