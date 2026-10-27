import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import * as http from "node:http";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import * as vm from "node:vm";

import { parseTaskPlan } from "../manager/planner.js";
import { DEFAULT_TEAM, REPO_ROOT, type TeamConfig } from "../team.js";
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
      assert.equal(t.zones.length, 7, t.id);
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
