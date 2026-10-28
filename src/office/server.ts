import "dotenv/config";

import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { loadTeam, REPO_ROOT, type TeamConfig } from "../team.js";
import { ACCEPTED_EXTENSIONS, MediaStore, type MediaPatch } from "./media.js";
import { ProjectError, ProjectStore, toProjectName } from "./projects.js";
import { TeamRunner, type OfficeEvent } from "./runner.js";
import type { TaskSize } from "../manager/planner.js";

const STATIC_FILES: Record<string, string> = {
  "/": "index.html",
  "/office.css": "office.css",
  "/office.js": "office.js",
  "/themes.js": "themes.js",
  "/game.js": "game.js"
};

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

export interface OfficeServerOptions {
  port: number;
  projectsDir: string;
  team: TeamConfig;
  demo: boolean;
  demoStepMs?: number;
  git: boolean;
  // Largest upload accepted, in bytes (default 2 GB).
  maxUploadBytes?: number;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) throw new ProjectError("Request is too large.", 413);
    chunks.push(chunk as Buffer);
  }

  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8")) as Record<string, unknown>;
  } catch {
    throw new ProjectError("Request body must be JSON.");
  }
}

export async function startOfficeServer(options: OfficeServerOptions): Promise<{ server: Server; runner: TeamRunner; url: string }> {
  // Read the UI once so it keeps working while the team switches git branches.
  const uiDir = path.join(REPO_ROOT, "office");
  const ui = new Map<string, string>();
  for (const file of new Set(Object.values(STATIC_FILES))) {
    ui.set(file, await readFile(path.join(uiDir, file), "utf-8"));
  }

  const store = new ProjectStore(options.projectsDir);
  const media = new MediaStore(store, options.maxUploadBytes);
  const runner = new TeamRunner(store, options.team, {
    demo: options.demo ? { ...(options.demoStepMs ? { stepMs: options.demoStepMs } : {}) } : false,
    git: options.git
  });

  const clients = new Set<ServerResponse>();
  const recent: OfficeEvent[] = [];

  runner.on("event", (event: OfficeEvent) => {
    recent.push(event);
    if (recent.length > 200) recent.shift();

    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) client.write(data);
  });

  const allowedHosts = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`]);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const method = req.method ?? "GET";

      // The server can run agents and delete folders, so it only answers
      // pages it served itself on this machine.
      if (!allowedHosts.has(String(req.headers.host))) {
        return sendJson(res, 403, { error: "Open the office at http://localhost." });
      }
      if (method !== "GET" && req.headers["x-office"] !== "1") {
        return sendJson(res, 403, { error: "Missing office header." });
      }

      const file = STATIC_FILES[url.pathname];
      if (method === "GET" && file) {
        res.writeHead(200, { "content-type": CONTENT_TYPES[path.extname(file)] ?? "text/plain", "cache-control": "no-store" });
        return res.end(ui.get(file));
      }

      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (parts[0] !== "api") return sendJson(res, 404, { error: "Not found." });

      const [, resource, project, sub, taskId, action] = parts;

      if (resource === "events" && method === "GET") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          connection: "keep-alive"
        });
        res.write(`event: snapshot\ndata: ${JSON.stringify({ ...runner.snapshot(), recent })}\n\n`);
        clients.add(res);
        const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
        req.on("close", () => {
          clearInterval(ping);
          clients.delete(res);
        });
        return;
      }

      if (resource === "office" && method === "GET") {
        return sendJson(res, 200, {
          team: options.team,
          demo: options.demo,
          git: options.git && !options.demo,
          snapshot: runner.snapshot(),
          media: { accept: ACCEPTED_EXTENSIONS, maxBytes: media.maxBytes }
        });
      }

      // The big red button: end the task the team is working on right now.
      if (resource === "stop" && method === "POST") {
        return sendJson(res, 202, runner.stop());
      }

      if (resource !== "projects") return sendJson(res, 404, { error: "Not found." });

      // /api/projects
      if (!project) {
        if (method === "GET") return sendJson(res, 200, await store.list());

        if (method === "POST") {
          const body = await readBody(req);
          const name = toProjectName(String(body.name ?? ""));
          const created = await store.create(name, String(body.description ?? ""));
          runner.publish({ type: "projects-changed" });
          return sendJson(res, 201, created);
        }
      }

      // /api/projects/:name
      if (project && !sub) {
        if (method === "GET") return sendJson(res, 200, await store.get(project));

        if (method === "DELETE") {
          if (url.searchParams.get("confirm") !== project) {
            throw new ProjectError("Type the project name to confirm.", 400);
          }
          if (runner.isBusy(project)) {
            throw new ProjectError("The team is working on this project. Delete it when they're done.", 409);
          }
          await store.delete(project);
          runner.publish({ type: "projects-changed" });
          return sendJson(res, 200, { deleted: project });
        }
      }

      // /api/projects/:name/requests
      if (project && sub === "requests" && method === "POST") {
        const body = await readBody(req);
        const size = ["small", "large", "design", "video", "quant"].includes(String(body.size)) ? (body.size as TaskSize) : "auto";
        const wanted = Array.isArray(body.media) ? body.media.map(String) : [];
        const library = wanted.length ? await media.list(project) : [];
        const attached = wanted.map((id) => {
          const item = library.find((m) => m.id === id);
          if (!item) throw new ProjectError(`There is no media file called "${id}".`, 404);
          return item;
        });
        return sendJson(res, 202, await runner.enqueueRequest(project, String(body.request ?? ""), size, attached));
      }

      // /api/projects/:name/media[/:file]
      if (project && sub === "media") {
        const id = taskId;
        if (!id && method === "GET") return sendJson(res, 200, await media.list(project));
        if (!id && method === "POST") {
          const name = decodeURIComponent(String(req.headers["x-file-name"] ?? ""));
          if (!name) throw new ProjectError("Missing file name.");
          return sendJson(res, 201, await media.save(project, name, req));
        }
        if (id && method === "GET") {
          await media.send(project, id, req, res);
          return;
        }
        if (id && method === "PATCH") return sendJson(res, 200, await media.update(project, id, (await readBody(req)) as MediaPatch));
        if (id && method === "DELETE") {
          await media.remove(project, id);
          return sendJson(res, 200, { deleted: id });
        }
      }

      // /api/projects/:name/file?path=.ai/...
      if (project && sub === "file" && method === "GET") {
        const content = await store.readAiFile(project, url.searchParams.get("path") ?? "");
        return sendJson(res, 200, { content });
      }

      // /api/projects/:name/tasks/:id/(run|approve|changes)
      if (project && sub === "tasks" && taskId && method === "POST") {
        if (action === "run") return sendJson(res, 202, await runner.enqueueRun(project, taskId));
        if (action === "approve") return sendJson(res, 200, await runner.approve(project, taskId));
        if (action === "changes") {
          const body = await readBody(req);
          return sendJson(res, 202, await runner.requestChanges(project, taskId, String(body.notes ?? "")));
        }
      }

      return sendJson(res, 404, { error: "Not found." });
    } catch (error) {
      if (error instanceof ProjectError) return sendJson(res, error.status, { error: error.message });

      console.error(error);
      return sendJson(res, 500, { error: error instanceof Error ? error.message : "Something went wrong." });
    }
  });

  await new Promise<void>((resolve) => server.listen(options.port, "127.0.0.1", resolve));

  return { server, runner, url: `http://localhost:${options.port}` };
}

// npm run office            → real team, projects/ folder
// npm run office -- --demo  → stand-in agents, .office-demo/projects folder
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const demo = process.argv.includes("--demo");
  const port = Number(process.env.OFFICE_PORT ?? 4321);
  const projectsDir = demo
    ? path.join(REPO_ROOT, ".office-demo", "projects")
    : path.join(REPO_ROOT, "projects");

  const team = await loadTeam();
  const { url } = await startOfficeServer({
    port,
    projectsDir,
    team,
    demo,
    git: process.env.OFFICE_GIT !== "off",
    ...(process.env.OFFICE_MAX_UPLOAD_MB ? { maxUploadBytes: Number(process.env.OFFICE_MAX_UPLOAD_MB) * 1024 ** 2 } : {})
  });

  if (demo) {
    const store = new ProjectStore(projectsDir);
    if (!(await store.list()).length) {
      await store.create("sample-site", "A small sample website for trying the office in demo mode.");
    }
  }

  console.log(`\n🏢 Agent Office running at ${url}${demo ? " (demo mode: no Claude calls)" : ""}`);
  console.log(`   Projects: ${projectsDir}`);
}
