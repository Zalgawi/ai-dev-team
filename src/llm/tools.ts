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
import { imageSize, insideProject, renderToPng, viewableImage } from "../tools/images.js";

// Name of the in-process MCP server that exposes the project tools.
// Claude sees each tool as `mcp__<server>__<tool>`.
export const TOOL_SERVER_NAME = "project";

export type ToolName =
  | "read_file"
  | "list_files"
  | "write_file"
  | "run_command"
  | "view_image"
  | "render_design";

export const llmTools: ToolName[] = [
  "read_file",
  "list_files",
  "write_file",
  "run_command",
  "view_image"
];

export const qaTools: ToolName[] = [
  "read_file",
  "list_files",
  "run_command",
  "view_image"
];

export const designerTools: ToolName[] = [...llmTools, "render_design"];

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
      async (args) =>
        safely("render_design", async () => {
          const source = insideProject(projectPath, args.source);

          if (args.draft) {
            const drafts = path.join(projectPath, ".ai", "renders");
            await mkdir(drafts, { recursive: true });
            const id = toMediaName(`${args.name}.png`);
            await renderToPng(source, path.join(drafts, id), { width: args.width, height: args.height });
            return `Saved draft .ai/renders/${id} (${args.width}×${args.height} px). Check it with view_image.`;
          }

          const id = toMediaName(`design-${args.name.replace(/^design-/, "")}.png`);
          const media = path.join(projectPath, "media");
          await mkdir(media, { recursive: true });
          const out = path.join(media, id);
          await renderToPng(source, out, { width: args.width, height: args.height });
          const real = imageSize(await readFile(out));
          await registerGenerated(projectPath, id, {
            madeBy: "Designer",
            note: `Rendered from ${args.source}`,
            ...(real ?? {})
          });
          return `Saved media/${id} (${real ? `${real.width}×${real.height}` : `${args.width}×${args.height}`} px) and added it to the media library. Check it with view_image.`;
        })
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
