import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import * as http from "node:http";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import * as vm from "node:vm";

import { parseTaskPlan } from "../manager/planner.js";
import { DEFAULT_TEAM, REPO_ROOT, type TeamConfig } from "../team.js";
import { closeImageBrowser, contactSheet, imageSize, insideProject, renderToPng, viewableImage } from "../tools/images.js";
import { analyze, checkFfmpegArgs, checkOutput, FFMPEG, grabFrames, parseTimecode, probe, runBinary, timecode } from "../tools/video.js";
import { writeProjectFile } from "../tools/filesystem.js";
import { registerGenerated, toMediaName } from "./media.js";
import { ProjectError, ProjectStore, toProjectName } from "./projects.js";
import { TeamRunner, type OfficeEvent } from "./runner.js";
import { startOfficeServer } from "./server.js";

let root: string;

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "office-test-"));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

const team = (maxIterations: number): TeamConfig => ({ ...DEFAULT_TEAM, maxIterations });

function collect(runner: TeamRunner): { events: OfficeEvent[]; done: Promise<void> } {
  const events: OfficeEvent[] = [];
  const done = new Promise<void>((resolve) => {
    runner.on("event", (event: OfficeEvent) => {
      events.push(event);
      if (event.type === "job-end") resolve();
    });
  });
  return { events, done };
}

describe("ProjectStore", () => {
  it("creates, lists, reads and deletes projects", async () => {
    const store = new ProjectStore(path.join(root, "store"));

    await store.create("recipe-box", "Save recipes.");
    const list = await store.list();
    assert.deepEqual(list.map((p) => p.name), ["recipe-box"]);
    assert.equal(list[0]?.taskCount, 0);

    const detail = await store.get("recipe-box");
    assert.match(detail.prd, /Save recipes\./);
    assert.equal(detail.state?.project, "recipe-box");
    assert.equal(await store.nextTaskId("recipe-box"), "TASK-001");

    await store.delete("recipe-box");
    assert.deepEqual(await store.list(), []);
  });

  it("refuses duplicate, invalid and path-escaping names", async () => {
    const store = new ProjectStore(path.join(root, "store2"));
    await store.create("alpha", "");

    await assert.rejects(store.create("alpha", ""), (e: ProjectError) => e.status === 409);
    for (const bad of ["..", "../x", "A", "a/b", "", "-x"]) {
      assert.throws(() => store.projectPath(bad), ProjectError, bad);
    }
    await assert.rejects(store.delete("missing"), (e: ProjectError) => e.status === 404);
  });

  it("only opens files inside the project's .ai folder", async () => {
    const store = new ProjectStore(path.join(root, "store3"));
    await store.create("beta", "");

    assert.match(await store.readAiFile("beta", ".ai/state.json"), /"project": "beta"/);
    await assert.rejects(store.readAiFile("beta", "PRD.md"), (e: ProjectError) => e.status === 403);
    await assert.rejects(store.readAiFile("beta", ".ai/../../../package.json"), (e: ProjectError) => e.status === 403);
  });

  it("numbers tasks after the highest existing one", async () => {
    const store = new ProjectStore(path.join(root, "store4"));
    await store.create("gamma", "");
    await store.writeTask("gamma", { id: "TASK-009", title: "x", description: "", status: "completed", assignedTo: "developer", priority: "low", acceptanceCriteria: ["a"] });

    assert.equal(await store.nextTaskId("gamma"), "TASK-010");
  });

  it("turns display names into project names", () => {
    assert.equal(toProjectName("  My Recipe Box! "), "my-recipe-box");
  });
});

describe("parseTaskPlan", () => {
  it("reads JSON wrapped in prose", () => {
    const plan = parseTaskPlan('Here it is:\n```json\n{"title":"Search","priority":"high","size":"large","acceptanceCriteria":["Works"]}\n```');
    assert.equal(plan.title, "Search");
    assert.equal(plan.size, "large");
    assert.equal(plan.priority, "high");
    assert.deepEqual(plan.acceptanceCriteria, ["Works"]);
  });

  it("rejects answers without criteria", () => {
    assert.throws(() => parseTaskPlan('{"title":"x","acceptanceCriteria":[]}'));
    assert.throws(() => parseTaskPlan("no json here"));
  });
});

describe("TeamRunner (demo agents)", () => {
  it("plans, builds and passes a request, then waits for approval", async () => {
    const store = new ProjectStore(path.join(root, "runner1"));
    await store.create("site", "A site.");
    const runner = new TeamRunner(store, team(5), { demo: { stepMs: 1, random: () => 0 } });
    const { events, done } = collect(runner);

    await runner.enqueueRequest("site", "Add an offline mode", "auto");
    await done;

    const types = events.map((e) => `${e.type}${"agent" in e ? `:${e.agent}` : ""}`);
    assert.deepEqual(types.filter((t) => !t.startsWith("agent-activity")), [
      "job-queued", "job-start", "agent-start:manager", "task-created",
      "agent-start:manager", "agent-done:manager",
      "agent-start:senior", "agent-done:senior", "agent-start:qa", "qa-result",
      "run-end", "task-updated", "job-end"
    ]);

    const task = await store.readTask("site", "TASK-001");
    assert.equal(task?.status, "awaiting_approval");
    assert.equal(task?.assignedTo, "senior-developer");
    assert.ok(await readFile(path.join(store.projectPath("site"), ".ai/reports/TASK-001/round-1-dev-report.md"), "utf-8"));

    await runner.approve("site", "TASK-001");
    assert.equal((await store.readTask("site", "TASK-001"))?.status, "approved");
  });

  it("blocks a task that fails QA every round", async () => {
    const store = new ProjectStore(path.join(root, "runner2"));
    await store.create("site", "");
    const runner = new TeamRunner(store, team(2), { demo: { stepMs: 1, random: () => 0.99 } });
    const { events, done } = collect(runner);

    await runner.enqueueRequest("site", "Small tweak", "small");
    await done;

    const results = events.filter((e) => e.type === "qa-result");
    assert.equal(results.length, 2);
    assert.ok(events.some((e) => e.type === "agent-start" && e.agent === "junior" && e.iteration === 2));
    assert.equal((await store.readTask("site", "TASK-001"))?.status, "blocked");

    // Sending it back records the feedback and queues another run.
    const again = collect(runner);
    await runner.requestChanges("site", "TASK-001", "Keep it simple");
    await again.done;
    const task = await store.readTask("site", "TASK-001");
    assert.equal(task?.humanFeedback?.[0]?.notes, "Keep it simple");
  });
});

describe("TeamRunner stop button", () => {
  it("stops the running task, marks it stopped and runs the next queued job", async () => {
    const store = new ProjectStore(path.join(root, "runner3"));
    await store.create("site", "");
    const runner = new TeamRunner(store, team(5), { demo: { stepMs: 40, random: () => 0.99 } });

    assert.throws(() => runner.stop(), (e: ProjectError) => e.status === 409);

    const events: OfficeEvent[] = [];
    const ends: string[] = [];
    const bothDone = new Promise<void>((resolve) => {
      runner.on("event", (event: OfficeEvent) => {
        events.push(event);
        if (event.type === "agent-start" && event.agent === "senior" && event.taskId === "TASK-001") runner.stop();
        if (event.type === "job-end") {
          ends.push(event.status);
          if (ends.length === 2) resolve();
        }
      });
    });

    await runner.enqueueRequest("site", "Big data refactor", "large");
    await runner.enqueueRequest("site", "Small tweak", "small");
    await bothDone;

    assert.equal(ends[0], "stopped");
    assert.ok(events.some((e) => e.type === "stop-requested"));
    assert.ok(events.some((e) => e.type === "run-end" && e.status === "stopped"));
    // The stopped developer never handed anything to QA.
    assert.ok(!events.some((e) => e.type === "agent-start" && e.agent === "qa" && e.taskId === "TASK-001"));
    assert.equal((await store.readTask("site", "TASK-001"))?.status, "stopped");

    // The queued request still ran afterwards.
    assert.ok(events.some((e) => e.type === "agent-start" && e.agent === "junior" && e.taskId === "TASK-002"));
  });

  it("stops a request while the Manager is still planning", async () => {
    const store = new ProjectStore(path.join(root, "runner4"));
    await store.create("site", "");
    const runner = new TeamRunner(store, team(5), { demo: { stepMs: 40 } });
    const { events, done } = collect(runner);

    runner.on("event", (event: OfficeEvent) => {
      if (event.type === "agent-activity" && event.agent === "manager") runner.stop();
    });
    await runner.enqueueRequest("site", "Anything", "auto");
    await done;

    const end = events.at(-1);
    assert.equal(end?.type === "job-end" ? end.status : end?.type, "stopped");
    assert.equal(await store.readTask("site", "TASK-001"), null);
  });
});

describe("office browser scripts", () => {
  // themes.js and game.js are plain browser scripts; run them with a stub window.
  async function load(file: string): Promise<Record<string, any>> {
    const window: Record<string, any> = {};
    const code = await readFile(path.join(REPO_ROOT, "office", file), "utf-8");
    vm.runInNewContext(code, { window });
    return window;
  }

  it("defines complete themes and falls back to the default", async () => {
    const { OfficeThemes: themes } = await load("themes.js");
    const ids = [...themes.list.map((t: { id: string }) => t.id)];
    assert.deepEqual(ids, ["classic", "daylight", "osrs"]);
    for (const t of themes.list) {
      assert.equal(t.zones.length, 8, t.id);
      assert.equal(t.game.upgrades.length, 6, t.id);
    }
    assert.equal(themes.get("nonsense").id, "classic");
    assert.equal(themes.isValid("osrs"), true);
    assert.equal(themes.isValid("__proto__"), false);
  });

  it("runs the clicker's economy", async () => {
    const { OfficeGame: { rules } } = await load("game.js");
    const s = rules.fresh();

    assert.equal(rules.buyTier(s, 0), false);
    rules.earn(s, 20);
    assert.equal(rules.buyTier(s, 0), true);
    assert.equal(s.coins, 5);
    assert.equal(rules.tierCost(s, 0), Math.ceil(15 * 1.15));
    assert.equal(rules.rate(s, false), 0.1);
    assert.equal(rules.rate(s, true), 0.2);

    rules.earn(s, 100);
    assert.equal(rules.buyClick(s), true);
    assert.equal(rules.clickValue(s), 2);

    // An hour's cap on earnings while away.
    s.savedAt = 1000;
    assert.equal(Math.round(rules.awayEarnings(s, 1000 + 10 * 3600 * 1000)), 360);

    assert.equal(rules.level(0), 1);
    assert.equal(rules.level(83), 2);
    assert.equal(rules.level(13_034_431), 99);
    assert.equal(rules.fmt(123_456), "123K");
    assert.equal(rules.fmt(2_450_000), "2.5M");
    assert.equal(rules.stackClass(10_000_000), "stack-g");
  });

  it("repairs corrupt saved progress", async () => {
    const { OfficeGame: { rules } } = await load("game.js");
    for (const bad of [null, "x", 5, { coins: -3, owned: "no" }, { coins: Number.NaN, click: 1e9 }]) {
      const s = rules.normalise(bad);
      assert.ok(s.coins >= 0 && Number.isFinite(s.coins));
      assert.equal(s.owned.length, 6);
      assert.ok(s.click <= 30);
    }
    assert.deepEqual([...rules.normalise({ coins: 5, total: 2, owned: [1, 2] }).owned], [1, 2, 0, 0, 0, 0]);
  });
});

describe("designer", () => {
  it("routes design requests to the Designer", async () => {
    assert.equal(parseTaskPlan('{"title":"Logo","role":"designer","acceptanceCriteria":["1024×1024 PNG"]}').role, "designer");
    assert.equal(parseTaskPlan('{"title":"API","acceptanceCriteria":["x"]}').role, "developer");

    const store = new ProjectStore(path.join(root, "designer1"));
    await store.create("brand", "");
    const runner = new TeamRunner(store, team(1), { demo: { stepMs: 1, random: () => 0 } });
    const { events, done } = collect(runner);
    await runner.enqueueRequest("brand", "Make a YouTube thumbnail for the launch video");
    await done;

    assert.equal((await store.readTask("brand", "TASK-001"))?.assignedTo, "designer");
    assert.ok(events.some((e) => e.type === "agent-start" && e.agent === "designer"));

    // Picking the Designer by hand overrides the Manager.
    const again = collect(runner);
    await runner.enqueueRequest("brand", "Add a footer", "design");
    await again.done;
    assert.equal((await store.readTask("brand", "TASK-002"))?.assignedTo, "designer");
  });

  it("reads image sizes from headers", () => {
    const png = Buffer.alloc(24);
    png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(1080, 16); png.writeUInt32BE(1920, 20);
    assert.deepEqual(imageSize(png), { width: 1080, height: 1920 });

    const gif = Buffer.from("GIF89a\x40\x01\xf0\x00", "latin1");
    assert.deepEqual(imageSize(gif), { width: 320, height: 240 });

    // Minimal JPEG: SOI, an APP0 segment, then SOF0 with 720×1280.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x05, 0x00, 0x02, 0xd0, 0x03, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(imageSize(jpeg), { width: 720, height: 1280 });

    assert.equal(imageSize(Buffer.from("not an image")), null);
  });

  it("write_file creates folders and stays inside the project", async () => {
    const project = path.join(root, "writes");
    await mkdir(project, { recursive: true });
    await writeProjectFile(project, "design/new/logo.svg", "<svg/>");
    assert.equal(await readFile(path.join(project, "design", "new", "logo.svg"), "utf-8"), "<svg/>");
    await assert.rejects(writeProjectFile(project, "../escape.txt", "x"));
  });

  it("keeps tool paths inside the project", () => {
    const project = path.join(root, "p");
    assert.equal(insideProject(project, "design/a.svg"), path.join(project, "design", "a.svg"));
    assert.throws(() => insideProject(project, "../secret.png"));
    assert.throws(() => insideProject(project, path.join(root, "elsewhere.png")));
  });

  it("renders a design to an exact-size PNG and registers it in the media library", async () => {
    const project = path.join(root, "render");
    await mkdir(path.join(project, "design"), { recursive: true });
    await mkdir(path.join(project, "media"), { recursive: true });
    await writeFile(path.join(project, "design", "thumb.html"),
      '<body style="margin:0;background:#123;color:#fff;font:bold 120px sans-serif;display:grid;place-items:center;height:100vh">LAUNCH</body>');

    try {
      const out = path.join(project, "media", "design-thumb.png");
      await renderToPng(path.join(project, "design", "thumb.html"), out, { width: 1280, height: 720 });
      assert.deepEqual(imageSize(await readFile(out)), { width: 1280, height: 720 });

      const item = await registerGenerated(project, "design-thumb.png", { madeBy: "Designer", note: "Rendered from design/thumb.html", width: 1280, height: 720 });
      assert.equal(item.kind, "image");
      const library = JSON.parse(await readFile(path.join(project, "media", "library.json"), "utf-8"));
      assert.deepEqual(library.items.map((m: { id: string; madeBy: string }) => [m.id, m.madeBy]), [["design-thumb.png", "Designer"]]);

      // What an agent sees: the real size, scaled down when large.
      const view = await viewableImage(out);
      assert.equal(view.mimeType, "image/png");
      assert.deepEqual(view.size, { width: 1280, height: 720 });

      await assert.rejects(renderToPng(path.join(project, "design", "thumb.html"), out, { width: 5000, height: 10 }));
    } finally {
      await closeImageBrowser();
    }
  });
});

describe("quant advisor", () => {
  it("routes finance and maths requests to the Quant Advisor", async () => {
    assert.equal(parseTaskPlan('{"title":"Backtest","role":"quant-advisor","acceptanceCriteria":["Sharpe reported"]}').role, "quant-advisor");

    const store = new ProjectStore(path.join(root, "quant1"));
    await store.create("fund", "");
    const runner = new TeamRunner(store, team(1), { demo: { stepMs: 1, random: () => 0 } });
    const { events, done } = collect(runner);
    await runner.enqueueRequest("fund", "Backtest a 50-day moving average crossover on the S&P 500");
    await done;
    assert.equal((await store.readTask("fund", "TASK-001"))?.assignedTo, "quant-advisor");
    assert.ok(events.some((e) => e.type === "agent-start" && e.agent === "quant"));

    // Picking the Quant Advisor by hand overrides the Manager.
    const again = collect(runner);
    await runner.enqueueRequest("fund", "Add a footer", "quant");
    await again.done;
    assert.equal((await store.readTask("fund", "TASK-002"))?.assignedTo, "quant-advisor");
  });
});

describe("video editor", () => {
  it("routes video requests to the Video Editor", async () => {
    assert.equal(parseTaskPlan('{"title":"Reel","role":"video-editor","acceptanceCriteria":["1080×1920"]}').role, "video-editor");

    const store = new ProjectStore(path.join(root, "editor1"));
    await store.create("reels", "");
    const runner = new TeamRunner(store, team(1), { demo: { stepMs: 1, random: () => 0 } });
    const { events, done } = collect(runner);
    await runner.enqueueRequest("reels", "Edit my footage into a 30 second reel");
    await done;
    assert.equal((await store.readTask("reels", "TASK-001"))?.assignedTo, "video-editor");
    assert.ok(events.some((e) => e.type === "agent-start" && e.agent === "editor"));
  });

  it("reads timecodes and guards ffmpeg arguments", () => {
    assert.equal(parseTimecode("1:23.5"), 83.5);
    assert.equal(parseTimecode("01:02:03"), 3723);
    assert.equal(timecode(83.46), "1:23.5");
    assert.throws(() => parseTimecode("soon"));

    const project = path.join(root, "guard");
    checkFfmpegArgs(project, ["-ss", "5", "-i", "media/a.mp4", "-vf", "scale=1080:-2,crop=1080:1920"]);
    checkFfmpegArgs(project, ["-vf", "drawtext=fontfile=C\\:/Windows/Fonts/arial.ttf:text=Hi"]);
    for (const bad of [["-i", "../x.mp4"], ["-i", "C:/Users/someone/secret.mp4"], ["-i", "https://example.com/a.mp4"], ["-f", "concat", "-safe", "0"], ["-i", "/etc/passwd"]]) {
      assert.throws(() => checkFfmpegArgs(project, bad), Error, bad.join(" "));
    }
    assert.equal(checkOutput(project, "media/video-reel.mp4").final, true);
    assert.equal(checkOutput(project, ".ai/renders/seg01.mp4").final, false);
    assert.throws(() => checkOutput(project, "video/reel.mp4"));
    assert.throws(() => checkOutput(project, "media/sub/reel.mp4"));
  });

  it("probes, analyses and samples a real clip", async () => {
    const dir = path.join(root, "clip");
    await mkdir(dir, { recursive: true });
    const clip = path.join(dir, "test.mp4");
    // 4 s landscape: a tone, 1.5 s of silence, a tone; a hard cut at 2 s.
    const made = await runBinary(FFMPEG, [
      "-hide_banner", "-y",
      "-f", "lavfi", "-i", "color=c=red:s=640x360:d=2:r=30",
      "-f", "lavfi", "-i", "color=c=blue:s=640x360:d=2:r=30",
      "-f", "lavfi", "-i", "sine=f=440:d=4",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v];[2:a]volume='if(between(t,1.2,2.7),0,1)':eval=frame[a]",
      "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", clip
    ]);
    assert.equal(made.code, 0, made.stderr.slice(-500));

    try {
      const info = await probe(clip);
      assert.ok(Math.abs(info.duration - 4) < 0.2, String(info.duration));
      assert.deepEqual([info.video?.width, info.video?.height, info.video?.fps], [640, 360, 30]);
      assert.ok(info.audio);

      const a = await analyze(clip);
      assert.ok(a.scenes.some((t) => Math.abs(t - 2) < 0.2), `scenes ${a.scenes}`);
      assert.ok(a.silences.some((s) => s.start > 1 && s.start < 1.5 && s.end > 2.4 && s.end < 3), JSON.stringify(a.silences));
      assert.ok(a.loudness && Number.isFinite(a.loudness.integratedLufs));

      const frames = await grabFrames(clip, [0.5, 3]);
      assert.equal(frames.length, 2);
      const sheet = await contactSheet(frames.map((f) => ({ label: timecode(f.time), data: f.data })));
      assert.ok((imageSize(Buffer.from(sheet, "base64"))?.width ?? 0) > 600);
    } finally {
      await closeImageBrowser();
    }
  });
});

describe("media uploads", () => {
  it("names files safely", () => {
    assert.equal(toMediaName("My Clip (1).MOV"), "my-clip-1.mov");
    assert.equal(toMediaName("../../etc/passwd.png"), "passwd.png");
    assert.equal(toMediaName("???.mp4"), "file.mp4");
    assert.throws(() => toMediaName("run.exe"), (e: ProjectError) => e.status === 415);
    assert.throws(() => toMediaName("noext"), (e: ProjectError) => e.status === 415);
  });

  it("uploads, lists, streams, describes, attaches and deletes media", async () => {
    const port = 40000 + Math.floor(Math.random() * 20000);
    const projectsDir = path.join(root, "media-server");
    const { server, runner } = await startOfficeServer({
      port, projectsDir, team: team(1), demo: true, demoStepMs: 1, git: false, maxUploadBytes: 64
    });

    try {
      const base = `http://localhost:${port}`;
      const json = { "content-type": "application/json", "x-office": "1" };
      await fetch(`${base}/api/projects`, { method: "POST", headers: json, body: JSON.stringify({ name: "reel", description: "" }) });

      const upload = (name: string, body: string) =>
        fetch(`${base}/api/projects/reel/media`, { method: "POST", headers: { "x-office": "1", "x-file-name": encodeURIComponent(name) }, body });

      const first = await upload("Beach Clip.MP4", "0123456789");
      assert.equal(first.status, 201);
      assert.deepEqual(
        { ...((await first.json()) as Record<string, unknown>), uploadedAt: "" },
        { id: "beach-clip.mp4", originalName: "Beach Clip.MP4", kind: "video", size: 10, uploadedAt: "" }
      );
      assert.equal(((await (await upload("beach clip.mp4", "abc")).json()) as { id: string }).id, "beach-clip-2.mp4");

      // Rejected: no office header, wrong type, too large, empty.
      assert.equal((await fetch(`${base}/api/projects/reel/media`, { method: "POST", headers: { "x-file-name": "a.png" }, body: "x" })).status, 403);
      assert.equal((await upload("virus.exe", "x")).status, 415);
      assert.equal((await upload("big.mp4", "x".repeat(65))).status, 413);
      assert.equal((await upload("empty.png", "")).status, 400);

      const list = (await (await fetch(`${base}/api/projects/reel/media`)).json()) as { id: string }[];
      assert.deepEqual(list.map((m) => m.id), ["beach-clip.mp4", "beach-clip-2.mp4"]);
      const leftovers = (await readdir(path.join(projectsDir, "reel", "media"))).filter((f) => f.endsWith(".part"));
      assert.deepEqual(leftovers, []);

      // Whole file, a byte range, and a bad range.
      const whole = await fetch(`${base}/api/projects/reel/media/beach-clip.mp4`);
      assert.equal(whole.headers.get("content-type"), "video/mp4");
      assert.match(String(whole.headers.get("content-security-policy")), /sandbox/);
      assert.equal(await whole.text(), "0123456789");
      const part = await fetch(`${base}/api/projects/reel/media/beach-clip.mp4`, { headers: { range: "bytes=2-4" } });
      assert.equal(part.status, 206);
      assert.equal(await part.text(), "234");
      assert.equal((await fetch(`${base}/api/projects/reel/media/beach-clip.mp4`, { headers: { range: "bytes=50-" } })).status, 416);
      assert.equal((await fetch(`${base}/api/projects/reel/media/..%2F.ai%2Fstate.json`)).status, 400);

      const patched = await fetch(`${base}/api/projects/reel/media/beach-clip.mp4`, {
        method: "PATCH", headers: json, body: JSON.stringify({ note: " Waves at sunset, no talking ", duration: 12.345, width: -1 })
      });
      assert.deepEqual(
        ((({ note, duration, width }) => ({ note, duration, width }))((await patched.json()) as Record<string, unknown>)),
        { note: "Waves at sunset, no talking", duration: 12.35, width: undefined }
      );

      // Attaching media to a request puts it in the task file and the Manager's brief.
      const { done } = collect(runner);
      const bad = await fetch(`${base}/api/projects/reel/requests`, { method: "POST", headers: json, body: JSON.stringify({ request: "Cut a reel", media: ["nope.mp4"] }) });
      assert.equal(bad.status, 404);
      await fetch(`${base}/api/projects/reel/requests`, { method: "POST", headers: json, body: JSON.stringify({ request: "Cut a reel", media: ["beach-clip.mp4"] }) });
      await done;
      const task = JSON.parse(await readFile(path.join(projectsDir, "reel", ".ai", "tasks", "TASK-001.json"), "utf-8"));
      assert.deepEqual(task.media, [{ file: "media/beach-clip.mp4", kind: "video", note: "Waves at sunset, no talking" }]);
      assert.equal(task.request, "Cut a reel");
      assert.match(task.description, /media\/beach-clip\.mp4 \(video, 12\.35s/);

      assert.equal((await fetch(`${base}/api/projects/reel/media/beach-clip-2.mp4`, { method: "DELETE", headers: json })).status, 200);
      assert.equal((await fetch(`${base}/api/projects/reel/media/beach-clip-2.mp4`)).status, 404);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});

describe("office server", () => {
  it("guards requests and manages projects", async () => {
    const port = 40000 + Math.floor(Math.random() * 20000);
    const { server, runner } = await startOfficeServer({
      port,
      projectsDir: path.join(root, "server"),
      team: team(1),
      demo: true,
      demoStepMs: 1,
      git: false
    });

    try {
      const base = `http://localhost:${port}`;
      const headers = { "content-type": "application/json", "x-office": "1" };

      assert.equal((await fetch(`${base}/`)).status, 200);
      const foreignHost = await new Promise<number>((resolve, reject) => {
        http.get({ host: "127.0.0.1", port, path: "/api/projects", headers: { host: "evil.example" } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }).on("error", reject);
      });
      assert.equal(foreignHost, 403);
      assert.equal((await fetch(`${base}/api/projects`, { method: "POST", body: "{}" })).status, 403);

      const created = await fetch(`${base}/api/projects`, { method: "POST", headers, body: JSON.stringify({ name: "Demo App", description: "x" }) });
      assert.equal(created.status, 201);
      assert.equal(((await created.json()) as { name: string }).name, "demo-app");

      const { done } = collect(runner);
      const queued = await fetch(`${base}/api/projects/demo-app/requests`, { method: "POST", headers, body: JSON.stringify({ request: "Add a footer" }) });
      assert.equal(queued.status, 202);
      await done;

      const file = await fetch(`${base}/api/projects/demo-app/file?path=${encodeURIComponent(".ai/tasks/TASK-001.json")}`);
      assert.equal(file.status, 200);

      assert.equal((await fetch(`${base}/api/projects/demo-app`, { method: "DELETE", headers })).status, 400);
      assert.equal((await fetch(`${base}/api/projects/demo-app?confirm=demo-app`, { method: "DELETE", headers })).status, 200);
      assert.equal((await fetch(`${base}/api/projects/demo-app`)).status, 404);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
