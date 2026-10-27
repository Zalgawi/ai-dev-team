// Agent Office UI. The server streams the team's real progress as events
// (/api/events); each event queues walking/working steps for the characters.
(() => {
  "use strict";

  // ---------- constants ----------
  const T = 16, S = 3, W = 30, H = 19;
  const cv = document.getElementById("office");
  cv.width = W * T * S; cv.height = H * T * S;
  const ctx = cv.getContext("2d");
  const PX = '"Pixelify Sans", "Courier New", monospace';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const LOOKS = {
    you:     { name: "You", model: "Final approval", color: "#ef8a6e", shirt: "#d4654b", pants: "#3b3a4f", hair: "#2a1c14", skin: "#c9926b", style: "short",
               about: "You send requests and give final approval. Nothing merges into main, deploys, or touches secrets without you." },
    manager: { color: "#a58ff0", shirt: "#7a64c9", pants: "#2b2840", hair: "#5a4632", skin: "#e8bb94", style: "side", tie: true,
               about: "Reads the project and turns your request into a TASK json with acceptance criteria, picks a developer, and checks QA's report before bringing it to you. Never declares a task done from the developer's report alone." },
    senior:  { color: "#62aef0", shirt: "#3f7fc4", pants: "#2c3446", hair: "#1d1d26", skin: "#d9a57c", style: "spiky", phones: true,
               about: "Takes the large tasks. Reads the PRD and task, inspects the code, implements, runs tests and writes a development report." },
    junior:  { color: "#5cd0ae", shirt: "#2f9c80", pants: "#2d3a3a", hair: "#b0602e", skin: "#f0c7a2", style: "bob",
               about: "Takes the small tasks, with the same workflow as the Senior Dev." },
    designer: { color: "#f07ab4", shirt: "#c95590", pants: "#3a2d40", hair: "#6b2fa0", skin: "#e3a982", style: "side", hat: "beret", hatColor: "#2b2533",
               about: "Makes logos, social graphics, thumbnails, posters and UI mockups. Designs in HTML/SVG, renders exact-size PNGs into Media, and looks at every render to fix what's off before handing it to QA." },
    qa:      { color: "#f0c254", shirt: "#c99a2e", pants: "#3a3328", hair: "#d8d0c0", skin: "#b9805c", style: "bun", glasses: true,
               about: "Verifies every change independently: runs npm test and the browser tests, checks each acceptance criterion and writes qa-report.json. Read-only: never fixes or approves its own work." }
  };

  // ---------- themes ----------
  // See themes.js. The page sets data-theme on <html> before first paint.
  const Themes = window.OfficeThemes;
  const savedTheme = (() => { try { return localStorage.getItem("office.theme"); } catch { return null; } })();
  let THEME = Themes.get(Themes.isValid(savedTheme) ? savedTheme : Themes.DEFAULT);
  const col = c => THEME.map[c] || c;
  const LOOK_KEYS = ["color", "shirt", "pants", "hair", "skin", "style", "tie", "phones", "glasses", "hat", "hatColor"];

  // ---------- map ----------
  const wall = [...Array(H)].map((_, y) => [...Array(W)].map((_, x) => x === 0 || y === 0 || x === W - 1 || y === H - 1));
  for (let x = 0; x < W; x++) if (![5, 15, 25].includes(x)) wall[7][x] = true;
  for (let y = 1; y < 7; y++) { wall[y][10] = true; wall[y][20] = true; }
  const blocked = wall.map(r => r.slice());
  const zone = (x, y) => y < 7 ? (x < 10 ? "wood" : x < 20 ? "wood2" : "tile") : y > 7 ? (x < 12 ? "blue" : x < 18 ? "hall" : "sage") : "hall";

  const furniture = [];
  function place(kind, x, y, w = 1, h = 1, extra = {}) {
    furniture.push({ kind, x, y, w, h, ...extra });
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) blocked[y + j][x + i] = true;
  }
  const SEATS = { you: { x: 5, y: 3 }, manager: { x: 15, y: 3 }, senior: { x: 4, y: 10 }, junior: { x: 4, y: 14 }, designer: { x: 9, y: 10 }, qa: { x: 24, y: 10 } };
  const VISIT = { you: { x: 7, y: 3 }, manager: { x: 17, y: 3 }, senior: { x: 6, y: 10 }, junior: { x: 6, y: 14 }, designer: { x: 11, y: 10 }, qa: { x: 26, y: 10 } };
  // Team members who build things and hand them to QA.
  const MAKERS = ["senior", "junior", "designer"];
  const SPOT = { rackDev: { x: 14, y: 12 }, rackQa: { x: 15, y: 12 }, bench: { x: 27, y: 12 }, coffee: { x: 27, y: 2 }, board: { x: 23, y: 2 }, cooler: { x: 13, y: 9 } };
  for (const id in SEATS) place("desk", SEATS[id].x - 1, SEATS[id].y + 1, 3, 1, { owner: id });
  place("rack", 14, 10, 2, 1); place("board", 22, 1, 4, 1); place("coffee", 28, 1); place("sofa", 22, 5, 3, 1); place("bench", 27, 13, 2, 1);
  place("shelf", 7, 1, 2, 1); place("shelf", 11, 1, 2, 1);
  place("plant", 1, 1); place("plant", 19, 1); place("plant", 1, 8); place("plant", 28, 17); place("plant", 11, 17); place("plant", 18, 8); place("plant", 8, 6);
  place("cooler", 12, 8);

  function findPath(from, to) {
    const key = (x, y) => y * W + x;
    const prev = new Map([[key(from.x, from.y), null]]);
    const q = [from];
    while (q.length) {
      const c = q.shift();
      if (c.x === to.x && c.y === to.y) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = c.x + dx, ny = c.y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (blocked[ny][nx] && !(nx === to.x && ny === to.y)) continue;
        const k = key(nx, ny);
        if (prev.has(k)) continue;
        prev.set(k, c); q.push({ x: nx, y: ny });
      }
    }
    const path = [];
    if (!prev.has(key(to.x, to.y))) return path;
    let c = to;
    while (c && !(c.x === from.x && c.y === from.y)) { path.unshift(c); c = prev.get(key(c.x, c.y)); }
    return path;
  }

  // ---------- app state ----------
  const app = {
    team: null, demo: false, git: false, projects: [], project: null, detail: null,
    snapshot: null, connected: false, selected: "manager", maxIterations: 5
  };
  const tokens = new Set();      // handoffs that have happened, e.g. "task-3"
  const logItems = [];
  const particles = [];
  let rackFlash = 0;

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  // ---------- characters ----------
  class Agent {
    constructor(id) {
      Object.assign(this, LOOKS[id]);
      this.id = id;
      this.name = this.name || id;
      this.model = this.model || "";
      this.seat = SEATS[id];
      this.x = this.seat.x; this.y = this.seat.y;
      this.path = []; this.script = []; this.step = null;
      this.activity = "At desk"; this.status = "idle"; this.carry = null; this.bubble = null;
      this.dir = "down"; this.idleT = rand(15, 40); this.wandering = false; this.progress = 0;
    }
    get tile() { return { x: Math.round(this.x), y: Math.round(this.y) }; }
    get seated() { return !this.path.length && this.x === this.seat.x && this.y === this.seat.y; }
    say(text, t = 3) { this.bubble = { text, t }; }
    queue(...steps) {
      if (this.wandering) { this.script = []; this.step = null; this.wandering = false; this.path = []; }
      this.script.push(...steps);
    }
    update(dt) {
      if (this.bubble && (this.bubble.t -= dt) <= 0) this.bubble = null;
      if (this.step && this.step.k === "busy" && this.script.length) this.step = null;
      if (!this.step) {
        if (this.script.length) return this.begin(this.script.shift());
        this.wandering = false;
        if (this.status !== "idle") { this.status = "idle"; this.activity = "At desk"; this.progress = 0; renderRosterSoon(); }
        if (this.id !== "you" && (this.idleT -= dt) <= 0) {
          this.idleT = rand(30, 60);
          const spot = pick([SPOT.coffee, SPOT.board, SPOT.cooler]);
          this.script = [go(spot, "Stretching legs"), work(rand(3, 5), spot === SPOT.board ? "Looking at the task board" : spot === SPOT.coffee ? "Getting coffee" : "At the water cooler", null, true), go(this.seat, "Back to desk")];
          this.wandering = true;
        }
        return;
      }
      const s = this.step;
      if (s.k === "go") {
        if (!this.path.length) { this.x = Math.round(this.x); this.y = Math.round(this.y); if (this.seated) this.dir = "down"; this.step = null; return; }
        const n = this.path[0], dx = n.x - this.x, dy = n.y - this.y, d = Math.hypot(dx, dy), v = 4.2 * dt;
        this.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
        if (d <= v) { this.x = n.x; this.y = n.y; this.path.shift(); } else { this.x += dx / d * v; this.y += dy / d * v; }
      } else if (s.k === "work") {
        s.left -= dt; this.progress = s.idle ? 0 : 1 - s.left / s.t;
        if (s.left <= 0) { this.step = null; this.progress = 0; }
      } else if (s.k === "wait") {
        s.left -= dt;
        if (tokens.has(s.key) || s.left <= 0) this.step = null;
      } else if (s.k === "busy") {
        this.progress = (performance.now() / 2400) % 1;
      }
    }
    begin(s) {
      this.step = s;
      if (s.k === "go") {
        this.path = findPath(this.tile, typeof s.to === "function" ? s.to() : s.to);
        this.status = "walking"; this.activity = s.act || "Walking";
      } else if (s.k === "work") {
        s.left = s.t; this.status = s.idle ? "idle" : "working"; this.activity = s.act; this.dir = "down";
        if (s.say) this.say(s.say, Math.min(4, s.t + 0.5));
      } else if (s.k === "busy") {
        this.status = "working"; this.activity = s.act; this.dir = "down";
        if (s.say) this.say(s.say, 3);
      } else if (s.k === "wait") {
        s.left = s.max; this.status = "idle"; this.activity = s.act || "Waiting";
      } else if (s.k === "do") { this.step = null; s.fn(this); }
      renderRosterSoon();
    }
  }
  const go = (to, act) => ({ k: "go", to, act });
  const work = (t, act, say, idle) => ({ k: "work", t, act, say, idle });
  const busy = (act, say) => ({ k: "busy", act, say });
  const waitFor = (key, act, max = 25) => ({ k: "wait", key, act, max });
  const doIt = fn => ({ k: "do", fn });
  const say = (text, t = 3) => doIt(a => a.say(text, t));
  const carry = doc => doIt(a => { a.carry = doc; });

  const agents = {};
  for (const id of Object.keys(LOOKS)) agents[id] = new Agent(id);

  function trayPos(id) {
    if (id === "rack") return { x: 15 * T, y: 9 * T + 6 };
    const s = SEATS[id]; return { x: (s.x + 1) * T + 6, y: (s.y + 1) * T + 2 };
  }
  // Hand the carried file over: a paper flies to the target's in-tray.
  function handoff(toId, key) {
    return doIt(a => {
      const p = trayPos(toId);
      particles.push({ x0: a.x * T + 10, y0: a.y * T + 4, x1: p.x, y1: p.y, t: 0, dur: 0.55 });
      if (toId === "rack") rackFlash = 2.5;
      a.carry = null;
      tokens.add(key);
    });
  }

  // ---------- server events → characters ----------
  const friendly = activity => {
    const [tool, ...rest] = activity.split(" ");
    const arg = rest.join(" ");
    if (tool === "read_file") return `Reading ${arg}`;
    if (tool === "write_file") return `Writing ${arg}`;
    if (tool === "list_files") return "Looking through the project";
    if (tool === "run_command") return `Running ${arg}`;
    return activity;
  };
  const docFor = (e, name, path, content) => ({ name, path, content, project: e.project, taskId: e.taskId });
  const assigneeOf = e => {
    const task = (app.detail?.tasks || []).find(x => x.id === e.taskId);
    const map = { "senior-developer": "senior", "junior-developer": "junior", designer: "designer", developer: "senior" };
    return (task && map[task.assignedTo]) || e.member || "senior";
  };
  const jobDev = new Map();

  function handle(e, animate) {
    if (e.type === "projects-changed") { loadProjects(); return; }
    if (e.project && e.project === app.project && ["task-created", "task-updated", "job-end", "qa-result", "agent-start"].includes(e.type)) refreshProjectSoon();
    if (["job-queued", "job-start", "job-end"].includes(e.type)) refreshOfficeSoon();

    logEvent(e);
    if (!animate) return;

    const A = agents, j = e.jobId;
    const name = id => A[id].name;
    switch (e.type) {
      case "job-queued": {
        const doc = e.request ? docFor(e, "request.md", null, `# Request\n\n${e.request}\n\nProject: ${e.project}`) : docFor(e, `${e.taskId}.json`, `.ai/tasks/${e.taskId}.json`);
        A.you.queue(
          work(1, e.request ? "Writing request.md" : `Picking up ${e.taskId}`),
          carry(doc), go(VISIT.manager, "Taking it to the Manager"),
          say(e.request ? "Can the team build this?" : `Run ${e.taskId} again, please.`),
          handoff("manager", `req-${j}`), go(A.you.seat, "Back to desk"));
        break;
      }
      case "agent-start": {
        if (e.agent === "manager" && e.iteration === 0 && !tokens.has(`planned-${j}`)) {
          tokens.add(`planned-${j}`);
          A.manager.queue(waitFor(`req-${j}`, "Waiting for the request"), go(A.manager.seat, "Back to desk"),
            busy(tokens.has(`created-${j}`) ? "Loading the task file" : "Reading the project", "Let me read the project first."));
        } else if (MAKERS.includes(e.agent)) {
          const dev = A[e.agent];
          jobDev.set(j, e.agent);
          if (e.iteration === 1) {
            if (!tokens.has(`created-${j}`)) {
              tokens.add(`created-${j}`);
              const doc = docFor(e, `${e.taskId}.json`, `.ai/tasks/${e.taskId}.json`);
              A.manager.queue(carry(doc), go(VISIT[e.agent], `Taking ${e.taskId}.json to ${dev.name}`),
                say(`${e.taskId} is yours.`), handoff(e.agent, `task-${j}`), go(A.manager.seat, "Back to desk"));
            }
            dev.queue(waitFor(`task-${j}`, "Waiting for the task file"), go(dev.seat, "Back to desk"), busy(`Starting ${e.taskId}`, "On it."));
          } else {
            dev.queue(waitFor(`qa-${j}-${e.iteration - 1}`, "Waiting for the QA report"), go(dev.seat, "Back to desk"),
              busy(`Fixing QA issues (round ${e.iteration})`, "Right, fixing those."));
          }
        } else if (e.agent === "qa") {
          A.qa.queue(waitFor(`push-${j}-${e.iteration}`, "Waiting for a pushed branch"), go(SPOT.rackQa, "Pulling the branch"),
            work(1.2, "git pull"), go(A.qa.seat, "Back to the QA desk"), busy(`Verifying ${e.taskId}, round ${e.iteration}`, "Trust, but verify."));
        }
        break;
      }
      case "agent-activity": {
        const a = A[e.agent];
        if (!a) break;
        const text = friendly(e.activity);
        if (a.step && a.step.k === "busy") { a.activity = text; a.say(text, 2.6); renderRosterSoon(); }
        else a.queue(busy(text));
        if (e.agent === "qa" && /e2e|playwright/i.test(e.activity) && !tokens.has(`bench-${j}-${A.qa.round}`)) {
          tokens.add(`bench-${j}-${A.qa.round}`);
          A.qa.queue(go(SPOT.bench, "Over to the device bench"), busy("Running the browser tests at 360px and 1280px"));
        }
        break;
      }
      case "task-created": {
        tokens.add(`created-${j}`);
        const doc = docFor(e, `${e.task.id}.json`, `.ai/tasks/${e.task.id}.json`);
        A.manager.queue(work(1.2, `Assigning ${e.task.id} to ${name(e.member)}`, `${name(e.member)} gets this one.`), carry(doc),
          go(VISIT[e.member], `Taking ${e.task.id}.json to ${name(e.member)}`), say(`${e.task.id} is yours. Criteria are in the file.`),
          handoff(e.member, `task-${j}`), go(A.manager.seat, "Back to desk"));
        break;
      }
      case "agent-done": {
        if (MAKERS.includes(e.agent)) {
          const dev = A[e.agent];
          const doc = docFor(e, "dev-report.md", e.reportPath);
          A.qa.round = e.iteration;
          dev.queue(work(1, "git commit", "Done. Pushing."), carry(doc), go(SPOT.rackDev, "Walking to the GitHub rack"),
            work(1.4, "git push"), handoff("rack", `push-${j}-${e.iteration}`), go(dev.seat, "Back to desk"));
        }
        break;
      }
      case "qa-result": {
        const dev = jobDev.get(j) || assigneeOf(e);
        const doc = docFor(e, "qa-report.json", e.reportPath || ".ai/qa-report.json");
        if (e.outcome === "passed") {
          A.qa.queue(say("PASS. Everything checks out."), doIt(() => effect(A[dev], "level", "Level up!")), carry(doc), go(VISIT.manager, "Taking qa-report.json to the Manager"),
            handoff("manager", `pass-${j}`), go(A.qa.seat, "Back to the QA desk"));
        } else if (e.iteration >= app.maxIterations) {
          A.qa.queue(say(`Failed round ${e.iteration}. That's the limit.`), carry(doc), go(VISIT.manager, "Reporting to the Manager"),
            handoff("manager", `pass-${j}`), go(A.qa.seat, "Back to the QA desk"));
        } else {
          A.qa.queue(say(`FAIL: ${e.issues.length || "some"} issue${e.issues.length === 1 ? "" : "s"}.`), carry(doc),
            go(VISIT[dev], `Returning qa-report.json to ${name(dev)}`), say(e.issues[0] ? e.issues[0].slice(0, 90) : "Details are in the report.", 4),
            handoff(dev, `qa-${j}-${e.iteration}`), doIt(() => effect(A[dev], "hit", String(e.issues.length || 1))), go(A.qa.seat, "Back to the QA desk"));
        }
        break;
      }
      case "run-end": {
        const passed = e.status === "completed";
        if (e.status === "failed" || e.status === "stopped") break;
        const doc = docFor(e, passed ? `${e.taskId}.json` : "qa-report.json", passed ? `.ai/tasks/${e.taskId}.json` : ".ai/qa-report.json");
        A.manager.queue(waitFor(`pass-${j}`, "Waiting for QA"), go(A.manager.seat, "Back to desk"),
          work(2, passed ? "Checking QA's report against the criteria" : "Writing up the blocker", passed ? "Verifying QA, not just the dev report." : "Time to escalate."),
          carry(doc), go(VISIT.you, passed ? "Bringing the result to you" : "Escalating to you"),
          say(passed ? `${e.taskId} passed QA. Needs your OK.` : `${e.taskId} is blocked after ${e.iteration} rounds.`, 3.5),
          handoff("you", `done-${j}`), go(A.manager.seat, "Back to desk"));
        A.you.queue(waitFor(`done-${j}`, "At desk", 60), say(passed ? "Let me look." : "Hmm, stuck?"));
        break;
      }
      case "stop-requested":
        A.you.say("STOP! End this task.", 3);
        for (const a of Object.values(A)) {
          if (a.id === "you") continue;
          a.script = []; a.step = null; a.carry = null; a.path = []; a.wandering = false;
          a.queue(say("Stopping.", 2), go(a.seat, "Back to desk"));
        }
        break;
      case "job-error":
        if (/^Stopped by you/.test(e.error)) break;
        A.manager.say(`That run stopped: ${e.error.slice(0, 80)}`, 5);
        break;
      case "git":
        rackFlash = 1.5;
        break;
      case "job-end":
        for (const a of Object.values(A)) if (a.id !== "you") a.queue(go(a.seat, "Back to desk"));
        break;
    }
  }

  // ---------- log ----------
  const hhmm = iso => { const d = new Date(iso); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  function logEvent(e) {
    const who = id => `<b>${esc(agents[id] ? agents[id].name : id)}</b>`;
    const t = e.taskId ? esc(e.taskId) : "";
    let text = null, doc = null, bad = false;
    switch (e.type) {
      case "job-queued": text = e.request ? `${who("you")} asked for: ${esc(e.request)}` : `${who("you")} queued ${t} to run`; break;
      case "task-created": text = `${who("manager")} wrote ${t}: ${esc(e.task.title)} → ${who(e.member)}`; doc = { name: `${e.task.id}.json`, path: `.ai/tasks/${e.task.id}.json` }; break;
      case "agent-start": if (e.agent !== "manager") text = `${who(e.agent)} started ${t}${e.iteration ? `, round ${e.iteration}` : ""}`; break;
      case "agent-done": if (e.reportPath) { text = `${who(e.agent)} finished round ${e.iteration}`; doc = { name: "dev-report.md", path: e.reportPath }; } break;
      case "qa-result": text = `${who("qa")} ${e.outcome === "passed" ? "passed" : "failed"} ${t} in round ${e.iteration}${e.issues.length && e.outcome !== "passed" ? `: ${esc(e.issues.slice(0, 2).join("; "))}` : ""}`; doc = { name: "qa-report.json", path: e.reportPath || ".ai/qa-report.json" }; bad = e.outcome !== "passed"; break;
      case "run-end": text = e.status === "completed" ? `${t} passed QA and is waiting for your approval` : e.status === "stopped" ? `${t} stopped in round ${e.iteration}` : `${t} ${e.status} after ${e.iteration} rounds`; bad = e.status !== "completed"; break;
      case "stop-requested": text = `${who("you")} pressed the stop button${t ? ` on ${t}` : ""}`; bad = true; break;
      case "task-updated": if (e.task.status === "approved") text = `${who("you")} approved ${t}`; else if (e.task.status === "changes_requested") text = `${who("you")} requested changes on ${t}`; break;
      case "git": text = `git: ${esc(e.message)}`; break;
      case "job-error": text = `Run stopped: ${esc(e.error)}`; bad = true; break;
    }
    if (!text) return;
    if (doc) doc = { ...doc, project: e.project, taskId: e.taskId };
    logItems.unshift({ time: hhmm(e.time), text, doc, project: e.project, bad });
    if (logItems.length > 150) logItems.pop();
    renderLog();
  }

  // ---------- drawing ----------
  function r(x, y, w, h, c) { ctx.fillStyle = col(c); ctx.fillRect(x, y, w, h); }
  function drawFloor() {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (wall[y][x]) continue;
      if (THEME.floor) { THEME.floor(x, y, zone(x, y), r, T); continue; }
      const px = x * T, py = y * T, z = zone(x, y);
      if (z === "wood" || z === "wood2") {
        const base = z === "wood" ? "#b78657" : "#c49a6c", line = z === "wood" ? "#a3764a" : "#b0875b";
        r(px, py, T, T, base);
        for (let j = 0; j < 4; j++) { r(px, py + j * 4 + 3, T, 1, line); r(px + ((x * 7 + j * 5 + y * 3) % 16), py + j * 4, 1, 3, line); }
      } else if (z === "tile") r(px, py, T, T, (x + y) % 2 ? "#d8d0bf" : "#cbc2af");
      else if (z === "blue" || z === "sage") {
        r(px, py, T, T, z === "blue" ? "#56688a" : "#6b8466");
        for (let j = 0; j < 16; j += 4) for (let i = (j / 4) % 2 * 2; i < 16; i += 4) r(px + i, py + j, 1, 1, z === "blue" ? "#4d5e7e" : "#62795d");
      } else { r(px, py, T, T, "#c7c0b2"); r(px, py, T, 1, "#bcb4a5"); r(px, py, 1, T, "#bcb4a5"); }
    }
    r(13 * T + 4, 9 * T + 6, 4 * T - 8, 4 * T - 4, "#3d3a52");
    r(13 * T + 6, 9 * T + 8, 4 * T - 12, 4 * T - 8, "#48445f");
  }
  function drawWall(x, y) {
    if (THEME.wall) return THEME.wall(x, y, r, T, H, wall);
    const px = x * T, py = y * T;
    r(px, py, T, T, "#2c283d"); r(px, py, T, 1, "#3a354f");
    if (y + 1 < H && !wall[y + 1][x]) { r(px, py + 7, T, 9, "#7d72a6"); r(px, py + 7, T, 1, "#968bc0"); r(px, py + 14, T, 2, "#5c527f"); }
  }
  function monitor(cx, py, on, t) {
    r(cx - 7, py - 7, 14, 10, "#23212f"); r(cx - 6, py - 6, 12, 8, on ? "#163b52" : "#2f3a4c");
    if (on) for (let i = 0; i < 3; i++) r(cx - 5, py - 5 + i * 2, 3 + ((Math.floor(t * 6) + i * 3) % 7), 1, i === 1 ? "#f0c254" : "#7fd1ff");
    r(cx - 1, py + 3, 2, 2, "#23212f");
  }
  function boardCounts() {
    const tasks = app.detail ? app.detail.tasks : [];
    const col = s => s === "in_progress" ? 1 : s === "awaiting_approval" ? 2 : (s === "approved" || s === "completed") ? 3 : 0;
    const counts = [0, 0, 0, 0];
    for (const t of tasks) counts[col(t.status)]++;
    return counts;
  }
  function drawFurniture(f, t) {
    const px = f.x * T, py = f.y * T;
    switch (f.kind) {
      case "desk": {
        const w = f.w * T, owner = f.owner && agents[f.owner];
        r(px + 1, py + 2, w - 2, 10, "#8a5a36"); r(px + 1, py + 2, w - 2, 2, "#a8714a"); r(px + 1, py + 12, w - 2, 3, "#5f3c22");
        r(px + 2, py + 15, 2, 1, "#3c2716"); r(px + w - 4, py + 15, 2, 1, "#3c2716");
        monitor(px + 8, py + 4, !!(owner && owner.status === "working" && owner.seated), t);
        r(px + 18, py + 6, 10, 3, "#d9d2c5"); r(px + 18, py + 6, 10, 1, "#efe9dd");
        const tx = px + w - 13;
        r(tx, py + 7, 10, 4, "#4a3a2a");
        const n = owner ? Math.min(owner.script.filter(s => s.k === "wait").length + (owner.carry ? 1 : 0), 3) : 0;
        for (let i = 0; i < n; i++) { r(tx + 1, py + 5 - i * 2, 8, 2, "#f4ecd8"); r(tx + 1, py + 6 - i * 2, 8, 1, "#c9bfa8"); }
        if (!owner) r(px + 34, py + 3, 3, 4, "#c4553f");
        break;
      }
      case "rack": {
        const w = 2 * T;
        r(px, py - 16, w, 32, "#1c1b26"); r(px + 1, py - 15, w - 2, 30, "#2a2938");
        for (let i = 0; i < 6; i++) {
          r(px + 3, py - 13 + i * 5, w - 6, 3, "#15141d");
          for (let j = 0; j < 4; j++) {
            const on = rackFlash > 0 ? Math.floor(t * 12 + i + j) % 2 === 0 : Math.floor(t * 2 + i * 1.7 + j * 2.3) % 3 === 0;
            r(px + 5 + j * 3, py - 12 + i * 5, 1, 1, on ? (rackFlash > 0 ? "#f0c254" : "#7ccf8a") : "#355e3e");
          }
        }
        break;
      }
      case "board": {
        const w = f.w * T;
        r(px, py - 10, w, 22, "#e9e4d8"); r(px, py - 10, w, 2, "#9a95a8"); r(px, py + 12, w, 2, "#9a95a8");
        const colors = ["#9fb4ff", "#62aef0", "#f0c254", "#7ccf8a"], counts = boardCounts();
        counts.forEach((c, i) => {
          const cx = px + 2 + i * 16;
          r(cx, py - 7, 14, 1, "#b9b3c4");
          for (let k = 0; k < Math.min(6, c); k++) r(cx + 1 + (k % 2) * 6, py - 5 + Math.floor(k / 2) * 5, 5, 4, colors[i]);
        });
        break;
      }
      case "coffee":
        r(px + 2, py - 6, 12, 18, "#3a3546"); r(px + 3, py - 5, 10, 5, "#57516a"); r(px + 5, py + 3, 6, 4, "#1d1b26"); r(px + 6, py + 5, 4, 3, "#f4ecd8");
        r(px + 11, py - 3, 1, 1, Math.floor(t * 2) % 2 ? "#ef7c6a" : "#7ccf8a");
        break;
      case "sofa":
        r(px, py + 1, f.w * T, 13, "#7a4f6e"); r(px, py + 1, f.w * T, 4, "#946385"); r(px, py + 1, 3, 13, "#69425e"); r(px + f.w * T - 3, py + 1, 3, 13, "#69425e");
        break;
      case "bench":
        r(px, py + 3, 32, 10, "#4b4a5c"); r(px, py + 3, 32, 2, "#5f5e73");
        r(px + 3, py - 2, 5, 9, "#1d1b26"); r(px + 4, py - 1, 3, 6, "#7fd1ff");
        r(px + 12, py - 4, 10, 11, "#1d1b26"); r(px + 13, py - 3, 8, 8, "#9fb4ff"); r(px + 25, py, 5, 3, "#ef7c6a");
        break;
      case "shelf":
        r(px, py - 6, f.w * T, 20, "#6b4a30");
        for (let s = 0; s < 3; s++) { r(px + 1, py - 5 + s * 6, f.w * T - 2, 5, "#3e2a1b"); for (let b = 0; b < 8; b++) r(px + 2 + b * 3.6, py - 4 + s * 6, 2, 4, ["#c4553f", "#5aa2e6", "#f0c254", "#7ccf8a", "#a58ff0"][(b + s * 2) % 5]); }
        break;
      case "plant":
        r(px + 4, py + 8, 8, 7, "#a8603c"); r(px + 4, py + 8, 8, 2, "#c27449"); r(px + 3, py, 10, 8, "#3f7a49"); r(px + 5, py - 4, 6, 6, "#4f9659");
        r(px + 1, py + 3, 4, 3, "#4f9659"); r(px + 11, py + 2, 4, 3, "#4f9659");
        break;
      case "cooler":
        r(px + 4, py - 2, 8, 7, "#9fd3f0"); r(px + 4, py - 2, 8, 2, "#c4e6f8"); r(px + 3, py + 5, 10, 10, "#e9e4d8"); r(px + 6, py + 8, 4, 2, "#5c527f");
        break;
    }
  }
  function drawChar(a, t) {
    const cx = Math.round(a.x * T + 8), by = Math.round(a.y * T + 15) + (a.seated ? 7 : 0);
    const walking = a.status === "walking" && a.path.length, step = walking ? Math.floor(t * 8) % 2 : 0;
    ctx.fillStyle = "rgba(10,8,20,0.28)"; ctx.fillRect(cx - 5, by - 1, 10, 2);
    if (app.selected === a.id) { r(cx - 7, by - 1, 14, 1, a.color); r(cx - 6, by, 12, 1, a.color); }
    r(cx - 3, by - 5, 2, step ? 4 : 5, a.pants); r(cx + 1, by - 5, 2, step ? 5 : 4, a.pants);
    r(cx - 3, by - 1, 2, 1, "#1d1b26"); r(cx + 1, by - 1, 2, 1, "#1d1b26");
    r(cx - 4, by - 12, 8, 7, a.shirt);
    if (a.tie) { r(cx - 1, by - 12, 2, 1, "#f4ecd8"); r(cx, by - 11, 1, 5, "#c4553f"); }
    const swing = walking ? (step ? 1 : -1) : 0;
    r(cx - 5, by - 11 + swing, 1, 5, a.shirt); r(cx + 4, by - 11 - swing, 1, 5, a.shirt);
    r(cx - 5, by - 6 + swing, 1, 1, a.skin); r(cx + 4, by - 6 - swing, 1, 1, a.skin);
    r(cx - 4, by - 19, 8, 7, a.skin);
    const hc = a.hair;
    if (a.dir === "up") r(cx - 4, by - 20, 8, 6, hc);
    else {
      r(cx - 4, by - 20, 8, 2, hc);
      if (a.style === "side") { r(cx - 4, by - 18, 3, 1, hc); r(cx - 4, by - 18, 1, 3, hc); }
      if (a.style === "spiky") { r(cx - 3, by - 21, 1, 1, hc); r(cx, by - 21, 1, 1, hc); r(cx + 2, by - 21, 1, 1, hc); r(cx - 4, by - 18, 1, 2, hc); r(cx + 3, by - 18, 1, 2, hc); }
      if (a.style === "bob") { r(cx - 5, by - 19, 1, 6, hc); r(cx + 4, by - 19, 1, 6, hc); r(cx - 4, by - 18, 8, 1, hc); }
      if (a.style === "bun") { r(cx - 2, by - 22, 4, 2, hc); r(cx - 4, by - 18, 1, 2, hc); r(cx + 3, by - 18, 1, 2, hc); }
      if (a.style === "short") { r(cx - 4, by - 18, 1, 2, hc); r(cx + 3, by - 18, 1, 1, hc); }
      const ex = a.dir === "left" ? -1 : a.dir === "right" ? 1 : 0;
      if (a.glasses) { r(cx - 3 + ex, by - 16, 3, 2, "#2a2838"); r(cx + ex, by - 16, 3, 2, "#2a2838"); r(cx - 2 + ex, by - 16, 1, 1, "#9fd3f0"); r(cx + 1 + ex, by - 16, 1, 1, "#9fd3f0"); }
      else { r(cx - 2 + ex, by - 16, 1, 1, "#1d1b26"); r(cx + 1 + ex, by - 16, 1, 1, "#1d1b26"); }
      if (a.status === "working" && Math.floor(t * 3) % 4 === 0) r(cx - 1 + ex, by - 14, 2, 1, "#9b5a4a");
    }
    if (a.hat) drawHat(a, cx, by);
    if (a.phones) { r(cx - 5, by - 18, 1, 3, "#1d1b26"); r(cx + 4, by - 18, 1, 3, "#1d1b26"); r(cx - 4, by - 21, 8, 1, "#1d1b26"); }
    if (a.carry) { r(cx + 3, by - 11, 5, 6, "#f4ecd8"); r(cx + 4, by - 9, 3, 1, "#9a95a8"); r(cx + 4, by - 7, 3, 1, "#9a95a8"); }
    if (a.progress > 0) { r(cx - 8, by - 25, 16, 3, "#1d1b26"); r(cx - 7, by - 24, Math.max(1, Math.round(14 * a.progress)), 1, a.color); }
  }
  function drawHat(a, cx, by) {
    const c = a.hatColor, dark = "#1d1b26";
    if (a.hat === "party") {
      r(cx - 4, by - 22, 8, 2, c); r(cx - 4, by - 24, 2, 2, c); r(cx - 1, by - 25, 2, 3, c); r(cx + 2, by - 24, 2, 2, c);
    } else if (a.hat === "wizard") {
      r(cx - 5, by - 21, 10, 2, c); r(cx - 3, by - 23, 6, 2, c); r(cx - 2, by - 25, 4, 2, c); r(cx - 1, by - 27, 2, 2, c); r(cx, by - 24, 1, 1, "#ffe14d");
    } else if (a.hat === "full") {
      r(cx - 5, by - 21, 10, 9, c); r(cx - 5, by - 21, 10, 1, "#5b8fa0");
      if (a.dir !== "up") r(cx - 3, by - 16, 6, 1, dark);
    } else if (a.hat === "med") {
      r(cx - 5, by - 21, 10, 4, c); r(cx - 5, by - 17, 1, 3, c); r(cx + 4, by - 17, 1, 3, c);
    } else if (a.hat === "beret") {
      r(cx - 5, by - 21, 10, 3, c); r(cx + 2, by - 22, 4, 1, c); r(cx - 1, by - 23, 2, 1, c);
    } else if (a.hat === "coif") {
      r(cx - 5, by - 21, 10, 3, c); r(cx - 5, by - 18, 2, 5, c); r(cx + 3, by - 18, 2, 5, c);
    }
  }
  function wrapText(text, maxW) {
    const lines = []; let line = "";
    for (const w of text.split(" ")) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    return lines.slice(0, 4);
  }
  function roundRect(x, y, w, h, rad, fill) { ctx.beginPath(); ctx.roundRect(x, y, w, h, rad); ctx.fillStyle = col(fill); ctx.fill(); }
  function drawLabels(a) {
    const cx = (a.x * T + 8) * S, top = (Math.round(a.y * T + 15) + (a.seated ? 7 : 0) - 26) * S;
    ctx.font = `700 19px ${PX}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const overhead = THEME.speech === "overhead";
    if (overhead) shadowText(a.name, cx, top - 9, a.color);
    else {
      const nw = ctx.measureText(a.name).width + 14;
      roundRect(cx - nw / 2, top - 22, nw, 24, 5, a.color);
      ctx.fillStyle = "#17151f"; ctx.fillText(a.name, cx, top - 9);
    }
    const y = top - 28;
    if (overhead) {
      // RuneScape-style: yellow overhead chat, items in orange, no bubbles.
      if (a.bubble) {
        ctx.font = `700 19px ${PX}`;
        const lines = wrapText(a.bubble.text, 300);
        const x = Math.max(160, Math.min(cv.width - 160, cx));
        lines.forEach((l, i) => shadowText(l, x, y - 10 - (lines.length - 1 - i) * 22, "#ffff00"));
      } else if (a.carry) {
        ctx.font = `700 17px ${PX}`;
        shadowText(a.carry.name, cx, y - 10, "#ff981f");
      }
      return;
    }
    if (a.carry && !a.bubble) {
      ctx.font = `500 17px ${PX}`;
      const tw = ctx.measureText(a.carry.name).width + 16;
      roundRect(cx - tw / 2, y - 24, tw, 24, 3, "#f4ecd8");
      ctx.fillStyle = "#2b2533"; ctx.fillText(a.carry.name, cx, y - 11);
    }
    if (a.bubble) {
      ctx.font = `500 19px ${PX}`;
      const lines = wrapText(a.bubble.text, 280);
      const bw = Math.max(...lines.map(l => ctx.measureText(l).width)) + 22, bh = lines.length * 22 + 14;
      const bx = Math.max(6, Math.min(cv.width - bw - 6, cx - bw / 2));
      roundRect(bx, y - bh - 8, bw, bh, 8, "#fffaf0");
      ctx.beginPath(); ctx.moveTo(cx - 7, y - 9); ctx.lineTo(cx + 7, y - 9); ctx.lineTo(cx, y); ctx.fill();
      ctx.fillStyle = "#2b2533";
      lines.forEach((l, i) => ctx.fillText(l, bx + bw / 2, y - bh - 8 + 18 + i * 22));
    }
  }
  function shadowText(text, x, y, color) {
    ctx.fillStyle = "#000"; ctx.fillText(text, x + 2, y + 2);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  function drawZoneLabels() {
    ctx.font = `700 20px ${PX}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const spots = [[1.3, 6.7], [11.3, 6.7], [21.3, 6.7], [1.3, 17.7], [13.2, 8.6], [18.3, 17.7], [7.4, 13.1]];
    THEME.zones.forEach((t, i) => {
      ctx.fillStyle = THEME.zoneColor; ctx.fillText(t, spots[i][0] * T * S, spots[i][1] * T * S);
    });
    ctx.font = `700 14px ${PX}`; ctx.fillStyle = THEME.boardText; ctx.textAlign = "center";
    ctx.fillText("TODO   DEV    YOU   DONE", 24 * T * S, 0.86 * T * S);
  }
  function frame(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = col("#0f0e15"); ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(S, 0, 0, S, 0, 0);
    drawFloor();
    const list = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (wall[y][x]) list.push({ y: (y + 1) * T - 0.5, d: () => drawWall(x, y) });
    for (const f of furniture) list.push({ y: (f.y + f.h) * T, d: () => drawFurniture(f, t) });
    for (const d of THEME.decor || []) list.push({ y: (d.y + 1) * T - 0.4, d: () => d.draw(r, T, t, d.x, d.y) });
    for (const a of Object.values(agents)) list.push({ y: Math.round(a.y * T + 15) + (a.seated ? 7 : 0), d: () => drawChar(a, t) });
    list.sort((p, q) => p.y - q.y).forEach(o => o.d());
    for (const p of particles) {
      const k = Math.min(1, p.t / p.dur), x = p.x0 + (p.x1 - p.x0) * k, y = p.y0 + (p.y1 - p.y0) * k - Math.sin(k * Math.PI) * 14;
      r(Math.round(x) - 3, Math.round(y) - 3, 6, 7, "#f4ecd8"); r(Math.round(x) - 2, Math.round(y) - 1, 4, 1, "#9a95a8");
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawZoneLabels();
    Object.values(agents).sort((p, q) => p.y - q.y).forEach(drawLabels);
    drawEffects();
  }

  // ---------- RuneScape-style hitsplats and level-ups (themes with effects) ----------
  const effects = [];
  function effect(a, kind, text) {
    if (!THEME.effects || !a) return;
    effects.push({ a, kind, text, t: 0, dur: kind === "hit" ? 1.6 : 2.4 });
  }
  function drawEffects() {
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const e of effects) {
      const cx = (e.a.x * T + 8) * S, cy = (e.a.y * T + 4) * S;
      if (e.kind === "hit") {
        // A red splat showing how many issues QA found.
        const w = 18 * Math.min(1, e.t / 0.15);
        ctx.fillStyle = "#8b0000"; ctx.fillRect(cx - w - 2, cy - w + 2, (w + 2) * 2, Math.max(0, (w - 2) * 2));
        ctx.fillStyle = "#c81e1e"; ctx.fillRect(cx - w, cy - w, w * 2, w * 2);
        ctx.font = `700 22px ${PX}`; shadowText(e.text, cx, cy, "#ffffff");
      } else {
        ctx.font = `700 24px ${PX}`; shadowText(e.text, cx, cy - 70 - e.t * 40, "#ff981f");
        if (Math.floor(e.t * 10) % 2 === 0) for (let i = 0; i < 6; i++) {
          const ang = i / 6 * Math.PI * 2 + e.t, rad = 30 + e.t * 30;
          ctx.fillStyle = i % 2 ? "#ffff00" : "#ff981f";
          ctx.fillRect(cx + Math.cos(ang) * rad - 3, cy - 30 + Math.sin(ang) * rad - 3, 6, 6);
        }
      }
    }
  }
  let last = performance.now(), simT = 0;
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; simT += dt;
    rackFlash = Math.max(0, rackFlash - dt);
    for (const a of Object.values(agents)) a.update(dt);
    for (let i = particles.length - 1; i >= 0; i--) if ((particles[i].t += dt) > particles[i].dur) particles.splice(i, 1);
    for (let i = effects.length - 1; i >= 0; i--) if ((effects[i].t += dt) > effects[i].dur) effects.splice(i, 1);
    frame(simT);
    requestAnimationFrame(tick);
  }

  // ---------- API ----------
  async function api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { "content-type": "application/json", "x-office": "1", ...(opts.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }
  function setStatus(text, error) { const el = $("status"); el.textContent = text || ""; el.classList.toggle("error", !!error); }

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* not available */ } }
  };

  async function loadOffice() {
    const o = await api("/api/office");
    app.team = o.team; app.demo = o.demo; app.git = o.git; app.snapshot = o.snapshot;
    app.maxIterations = o.team.maxIterations;
    app.mediaRules = o.media;
    $("mediaInput").accept = o.media.accept.join(",");
    for (const id of ["manager", "senior", "junior", "designer", "qa"]) {
      const m = o.team.members[id];
      if (!m) continue;
      agents[id].name = m.name; agents[id].model = m.model ? `Claude ${m.model}` : "Claude";
    }
    const mode = $("mode");
    mode.textContent = o.demo ? "Demo mode · stand-in agents, no Claude usage" : `Live · real agents on your Claude login${o.git ? " · task branches on" : ""}`;
    mode.className = "mode " + (o.demo ? "demo" : "live");
    renderQueue();
  }
  async function loadProjects() {
    app.projects = await api("/api/projects");
    const sel = $("projectSelect");
    const saved = app.project || store.get("office.project");
    app.project = app.projects.some(p => p.name === saved) ? saved : (app.projects[0] ? app.projects[0].name : null);
    sel.innerHTML = app.projects.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("") || `<option value="">No projects yet</option>`;
    sel.value = app.project || "";
    $("deleteProjectBtn").disabled = !app.project;
    await loadProject();
  }
  async function loadProject() {
    $("reqFor").textContent = app.project ? `→ ${app.project}` : "";
    $("tasksFor").textContent = app.project || "";
    $("mediaFor").textContent = app.project || "";
    loadMedia();
    if (!app.project) { app.detail = null; renderProject(); return; }
    store.set("office.project", app.project);
    try { app.detail = await api(`/api/projects/${encodeURIComponent(app.project)}`); app.detail.project = app.project; }
    catch (err) { app.detail = null; setStatus(err.message, true); }
    renderProject();
  }
  let projTimer = 0, officeTimer = 0;
  function refreshProjectSoon() { clearTimeout(projTimer); projTimer = setTimeout(loadProject, 250); }
  function refreshOfficeSoon() { clearTimeout(officeTimer); officeTimer = setTimeout(() => api("/api/office").then(o => { app.snapshot = o.snapshot; renderQueue(); renderProject(); }).catch(() => {}), 200); }

  function connect() {
    const es = new EventSource("/api/events");
    es.addEventListener("snapshot", m => {
      const snap = JSON.parse(m.data);
      app.connected = true;
      logItems.length = 0;
      snap.recent.forEach(e => handle(e, false));
      if (snap.activeAgent && agents[snap.activeAgent]) {
        const a = agents[snap.activeAgent];
        a.script = []; a.step = null;
        a.queue(go(a.seat, "Back to desk"), busy(snap.activity ? friendly(snap.activity) : `Working on ${snap.current?.taskId || "a task"}`));
      }
      app.snapshot = { current: snap.current, queue: snap.queue };
      renderQueue();
      setStatus("");
    });
    es.onmessage = m => handle(JSON.parse(m.data), true);
    es.onerror = () => { if (app.connected) setStatus("Lost connection to the office server. Retrying…", true); app.connected = false; };
  }

  // ---------- rendering ----------
  let rosterTimer = 0;
  function renderRosterSoon() { if (!rosterTimer) rosterTimer = setTimeout(() => { rosterTimer = 0; renderRoster(); }, 150); }
  function renderRoster() {
    $("roster").innerHTML = Object.values(agents).map(a => `
      <button type="button" class="agent" data-id="${a.id}" aria-pressed="${app.selected === a.id}" style="--role:${a.color}">
        <span class="nm"><span class="dot"></span>${esc(a.name)}</span>
        <span class="model">${esc(a.model)}</span>
        <span class="act">${esc(a.activity)}</span>
        <span class="meta"><span class="pill s-${a.status}">${a.status}</span></span>
      </button>`).join("");
    const a = agents[app.selected];
    $("detail").innerHTML = `<h3 style="color:${a.color}">${esc(a.name)} · ${esc(a.model)}</h3><p>${esc(a.about)}</p>`;
  }
  function renderStop() {
    const c = app.snapshot && app.snapshot.current;
    const btn = $("stopBtn");
    if (!c) app.stopping = false;
    btn.disabled = !c || app.stopping;
    btn.querySelector("small").textContent = app.stopping ? "Stopping…" : c ? `End ${c.taskId || "the new request"}` : "Nothing running";
  }
  function renderQueue() {
    renderStop();
    const s = app.snapshot;
    if (!s || !s.current) { $("queueLine").textContent = "The team is idle. Send a request to get them working."; return; }
    const c = s.current;
    $("queueLine").textContent = `Working on ${c.project} · ${c.taskId || "new request"}${s.queue.length ? ` · ${s.queue.length} more queued` : ""}. Click a character to see their role.`;
  }
  const STATUS_LABEL = { in_progress: "in progress", awaiting_approval: "awaiting you", approved: "approved", completed: "completed", blocked: "blocked", failed: "failed", changes_requested: "changes requested", stopped: "stopped by you", cancelled: "cancelled" };
  const isRunning = id => app.snapshot && ((app.snapshot.current && app.snapshot.current.project === app.project && app.snapshot.current.taskId === id) || (app.snapshot.queue || []).some(j => j.project === app.project && j.taskId === id));
  function renderProject() {
    const d = app.detail;
    const tasks = d ? d.tasks.slice().reverse() : [];
    $("tasks").innerHTML = !d ? `<li><span class="empty">Create a project to get started.</span></li>`
      : !tasks.length ? `<li><span class="empty">No tasks yet. Send the team a request.</span></li>`
      : tasks.map(t => {
        const runnable = !["approved", "completed", "awaiting_approval", "cancelled"].includes(t.status) && !isRunning(t.id);
        return `<li>
          <span class="tid">${esc(t.id)}</span>
          <button type="button" class="ttl" data-task="${esc(t.id)}">${esc(t.title)}</button>
          <span class="pill st-${esc(t.status)}">${esc(STATUS_LABEL[t.status] || t.status)}</span>
          <span class="tmeta">${esc(t.assignedTo || "")}${runnable ? ` <button class="btn ghost small" type="button" data-run="${esc(t.id)}">${t.status === "in_progress" ? "Resume" : "Run"}</button>` : ""}</span>
        </li>`;
      }).join("");
    const waiting = (d ? d.tasks : []).filter(t => ["awaiting_approval", "blocked", "failed", "stopped"].includes(t.status) && !isRunning(t.id));
    $("approvals").innerHTML = !waiting.length ? `<p class="empty">Nothing waiting. When QA passes a task, the Manager brings it here for your approval.</p>`
      : waiting.map(t => {
        const ok = t.status === "awaiting_approval";
        return `<div class="approval ${ok ? "" : "blocked"}">
          <p><b>${esc(t.id)}</b> · ${esc(t.title)}</p>
          <p class="fine">${ok ? `Passed QA.${app.git ? ` Branch task/${esc(app.project)}-${esc(t.id)}.` : ""}` : t.status === "blocked" ? `Blocked after ${app.maxIterations} QA rounds.` : t.status === "stopped" ? "You stopped this task. Send it back with direction, or run it again from Tasks." : "The last run stopped with an error."}</p>
          <label class="lbl" for="notes-${esc(t.id)}">${ok ? "Notes if you request changes" : "Direction for the team"}</label>
          <input type="text" id="notes-${esc(t.id)}" placeholder="${ok ? "e.g. Make the empty state friendlier" : "e.g. Keep it simpler, skip the animation"}">
          <div class="acts">
            ${ok ? `<button class="btn" type="button" data-approve="${esc(t.id)}">Approve</button>` : ""}
            <button class="btn ${ok ? "ghost" : ""}" type="button" data-changes="${esc(t.id)}">${ok ? "Request changes" : "Send back with notes"}</button>
            <button class="btn ghost" type="button" data-qa="${esc(t.id)}">QA report</button>
          </div>
        </div>`;
      }).join("");
    $("stateFor").textContent = app.project || "";
    $("stateJson").textContent = d && d.state ? JSON.stringify(d.state, null, 2) : "{}";
  }
  function renderLog() {
    const many = app.projects.length > 1;
    $("log").innerHTML = logItems.map((l, i) => `<li><time>${l.time}</time><span class="msg${l.bad ? " bad" : ""}">${many && l.project ? `<span class="proj">${esc(l.project)} · </span>` : ""}${l.text}${l.doc ? `<button type="button" class="doclink" data-log="${i}">${esc(l.doc.name)}</button>` : ""}</span></li>`).join("")
      || `<li><time>--:--</time><span class="msg">No handoffs yet.</span></li>`;
  }

  // ---------- documents ----------
  async function openDoc(doc) {
    $("docName").textContent = doc.name;
    $("docMeta").textContent = [doc.project, doc.path].filter(Boolean).join(" · ");
    $("docBody").textContent = doc.content || "Loading…";
    $("docDlg").showModal();
    if (doc.content || !doc.path) return;
    try {
      const { content } = await api(`/api/projects/${encodeURIComponent(doc.project)}/file?path=${encodeURIComponent(doc.path)}`);
      let text = content;
      try { const j = JSON.parse(content); if (typeof j.summary === "string" && j.summary.length > 200) text = j.summary; else text = JSON.stringify(j, null, 2); } catch { /* not JSON */ }
      $("docBody").textContent = text;
    } catch (err) { $("docBody").textContent = err.message; }
  }

  // ---------- events ----------
  document.querySelectorAll("dialog [data-close]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
  $("log").addEventListener("click", e => { const b = e.target.closest("[data-log]"); if (b) openDoc(logItems[Number(b.dataset.log)].doc); });
  $("roster").addEventListener("click", e => { const b = e.target.closest(".agent"); if (b) { app.selected = b.dataset.id; renderRoster(); } });
  cv.addEventListener("click", e => {
    const rect = cv.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * W * T, y = (e.clientY - rect.top) / rect.height * H * T;
    let best = null, bd = 18;
    for (const a of Object.values(agents)) { const d = Math.hypot(a.x * T + 8 - x, a.y * T + 4 - y); if (d < bd) { bd = d; best = a; } }
    if (best) { app.selected = best.id; renderRoster(); }
  });
  $("projectSelect").addEventListener("change", e => { app.project = e.target.value || null; loadProject(); });

  $("reqForm").addEventListener("submit", async e => {
    e.preventDefault();
    const request = $("reqText").value.trim();
    if (!app.project) { $("reqErr").textContent = "Create a project first."; return; }
    if (!request) { $("reqErr").textContent = "Describe what the team should build, then send it."; $("reqText").focus(); return; }
    $("reqErr").textContent = "";
    try {
      await api(`/api/projects/${encodeURIComponent(app.project)}/requests`, { method: "POST", body: JSON.stringify({ request, size: $("reqSize").value, media: [...attached] }) });
      $("reqText").value = "";
      attached.clear(); renderMedia();
      setStatus(`Sent to the Manager for ${app.project}.`);
    } catch (err) { $("reqErr").textContent = err.message; }
  });

  $("tasks").addEventListener("click", async e => {
    const view = e.target.closest("[data-task]");
    if (view) return openDoc({ name: `${view.dataset.task}.json`, path: `.ai/tasks/${view.dataset.task}.json`, project: app.project });
    const run = e.target.closest("[data-run]");
    if (!run) return;
    run.disabled = true;
    try { await api(`/api/projects/${encodeURIComponent(app.project)}/tasks/${run.dataset.run}/run`, { method: "POST" }); setStatus(`Queued ${run.dataset.run}.`); }
    catch (err) { setStatus(err.message, true); run.disabled = false; }
  });

  $("approvals").addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    const id = b.dataset.approve || b.dataset.changes || b.dataset.qa;
    if (b.dataset.qa) return openDoc({ name: "qa-report.json", path: ".ai/qa-report.json", project: app.project });
    b.disabled = true;
    try {
      const base = `/api/projects/${encodeURIComponent(app.project)}/tasks/${id}`;
      if (b.dataset.approve) {
        await api(`${base}/approve`, { method: "POST" });
        setStatus(app.git ? `${id} approved. Merge task/${app.project}-${id} into main when you're ready.` : `${id} approved.`);
        agents.you.say("Approved. Nice work, team.", 3);
      } else {
        const notes = ($(`notes-${id}`)?.value || "").trim();
        await api(`${base}/changes`, { method: "POST", body: JSON.stringify({ notes }) });
        setStatus(`Sent ${id} back to the team.`);
      }
      loadProject();
    } catch (err) { setStatus(err.message, true); b.disabled = false; }
  });

  $("newProjectBtn").addEventListener("click", () => { $("newErr").textContent = ""; $("newForm").reset(); $("newDlg").showModal(); $("newName").focus(); });
  $("newForm").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("newName").value.trim();
    if (!name) { $("newErr").textContent = "Give the project a name."; return; }
    try {
      const p = await api("/api/projects", { method: "POST", body: JSON.stringify({ name, description: $("newDesc").value }) });
      app.project = p.name;
      $("newDlg").close();
      await loadProjects();
      setStatus(`Created ${p.name}. Send the team its first request.`);
      $("reqText").focus();
    } catch (err) { $("newErr").textContent = err.message; }
  });

  $("deleteProjectBtn").addEventListener("click", () => {
    if (!app.project) return;
    $("delName").textContent = app.project; $("delErr").textContent = ""; $("delConfirm").value = "";
    $("delDlg").showModal(); $("delConfirm").focus();
  });
  $("delForm").addEventListener("submit", async e => {
    e.preventDefault();
    const typed = $("delConfirm").value.trim();
    if (typed !== app.project) { $("delErr").textContent = `Type ${app.project} exactly to delete it.`; return; }
    try {
      await api(`/api/projects/${encodeURIComponent(app.project)}?confirm=${encodeURIComponent(typed)}`, { method: "DELETE" });
      const gone = app.project;
      app.project = null; $("delDlg").close();
      await loadProjects();
      setStatus(`Deleted ${gone}.`);
    } catch (err) { $("delErr").textContent = err.message; }
  });

  // ---------- media library ----------
  let media = [];
  const attached = new Set();
  const KIND_ICON = { video: "▶", image: "▣", audio: "♪", pdf: "PDF", font: "Aa", text: "TXT" };
  const fmtSize = b => b < 1024 ** 2 ? `${Math.max(1, Math.round(b / 1024))} KB` : b < 1024 ** 3 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${(b / 1024 ** 3).toFixed(2)} GB`;
  const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  const mediaUrl = id => `/api/projects/${encodeURIComponent(app.project)}/media/${encodeURIComponent(id)}`;
  const facts = m => [m.kind, m.width && m.height ? `${m.width}×${m.height}` : "", m.duration ? fmtTime(m.duration) : "", fmtSize(m.size)].filter(Boolean).join(" · ");

  async function loadMedia() {
    if (!app.project) { media = []; renderMedia(); return; }
    try { media = await api(`/api/projects/${encodeURIComponent(app.project)}/media`); }
    catch (err) { media = []; setStatus(err.message, true); }
    for (const id of [...attached]) if (!media.some(m => m.id === id)) attached.delete(id);
    renderMedia();
  }
  function thumb(m) {
    if (m.kind === "image") return `<img src="${mediaUrl(m.id)}" alt="" loading="lazy">`;
    if (m.kind === "video") return `<video src="${mediaUrl(m.id)}#t=0.5" preload="metadata" muted aria-hidden="true"></video>`;
    return `<span class="icon" aria-hidden="true">${KIND_ICON[m.kind] || "?"}</span>`;
  }
  function renderMedia() {
    $("drop").classList.toggle("off", !app.project);
    $("mediaInput").disabled = !app.project;
    $("mediaList").innerHTML = !app.project ? `<li class="empty">Create a project to upload files.</li>`
      : !media.length ? `<li class="empty">No files yet.</li>`
      : media.map(m => `<li class="mitem">
          <button type="button" class="thumb" data-view="${esc(m.id)}" aria-label="Preview ${esc(m.id)}">${thumb(m)}</button>
          <div class="mbody">
            <button type="button" class="mname" data-view="${esc(m.id)}">${esc(m.id)}</button>
            <span class="mfacts">${esc(facts(m))}</span>
            <label class="sr-only" for="note-${esc(m.id)}">What's in ${esc(m.id)}</label>
            <input type="text" id="note-${esc(m.id)}" data-note="${esc(m.id)}" value="${esc(m.note || "")}" placeholder="What's in it? e.g. me talking about the route" maxlength="2000">
            <div class="macts">
              <label class="check"><input type="checkbox" data-attach="${esc(m.id)}" ${attached.has(m.id) ? "checked" : ""}> Use in next request</label>
              <button type="button" class="btn ghost small danger" data-del="${esc(m.id)}">Delete</button>
            </div>
          </div>
        </li>`).join("");
    const names = [...attached];
    $("reqMedia").hidden = !names.length;
    $("reqMedia").textContent = names.length ? `Attached: ${names.join(", ")}` : "";
  }

  // Reads size and length in the browser so the team knows what each file is.
  function probe(file) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(file);
      const done = info => { URL.revokeObjectURL(url); resolve(info); };
      if (file.type.startsWith("image/")) {
        const img = new Image();
        img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => done({});
        img.src = url;
      } else if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
        const el = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
        el.preload = "metadata";
        el.onloadedmetadata = () => done({ duration: el.duration, ...(el.videoWidth ? { width: el.videoWidth, height: el.videoHeight } : {}) });
        el.onerror = () => done({});
        el.src = url;
      } else done({});
    });
  }

  function uploadOne(file) {
    const row = document.createElement("li");
    row.innerHTML = `<span class="uname">${esc(file.name)}</span><progress max="100" value="0" aria-label="Uploading ${esc(file.name)}"></progress><span class="ustate">0%</span>`;
    $("uploads").appendChild(row);
    const bar = row.querySelector("progress"), state = row.querySelector(".ustate");
    const fail = msg => { row.classList.add("bad"); state.textContent = msg; setTimeout(() => row.remove(), 8000); };

    if (app.mediaRules && file.size > app.mediaRules.maxBytes) return Promise.resolve(fail(`Too large (max ${fmtSize(app.mediaRules.maxBytes)})`));

    return new Promise(resolve => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/projects/${encodeURIComponent(app.project)}/media`);
      xhr.setRequestHeader("x-office", "1");
      xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
      xhr.upload.onprogress = e => { if (e.lengthComputable) { const p = Math.round(e.loaded / e.total * 100); bar.value = p; state.textContent = `${p}%`; } };
      xhr.onerror = () => { fail("Upload failed"); resolve(); };
      xhr.onload = async () => {
        let body = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
        if (xhr.status !== 201) { fail(body.error || `Failed (${xhr.status})`); return resolve(); }
        state.textContent = "Done";
        const info = await probe(file);
        if (Object.keys(info).length) {
          try { await api(mediaUrl(body.id), { method: "PATCH", body: JSON.stringify(info) }); } catch { /* sizes are optional */ }
        }
        setTimeout(() => row.remove(), 1500);
        resolve();
      };
      xhr.send(file);
    });
  }
  async function uploadAll(files) {
    if (!app.project || !files.length) return;
    await Promise.all([...files].map(uploadOne));
    await loadMedia();
  }

  async function viewMedia(id) {
    const m = media.find(x => x.id === id);
    if (!m) return;
    $("mediaName").textContent = m.id;
    $("mediaMeta").textContent = [facts(m), m.originalName !== m.id ? `uploaded as ${m.originalName}` : ""].filter(Boolean).join(" · ");
    const url = mediaUrl(m.id), body = $("mediaBody");
    body.innerHTML = m.kind === "video" ? `<video src="${url}" controls playsinline></video>`
      : m.kind === "image" ? `<img src="${url}" alt="${esc(m.note || m.id)}">`
      : m.kind === "audio" ? `<audio src="${url}" controls></audio>`
      : m.kind === "pdf" ? `<p><a class="btn" href="${url}" target="_blank" rel="noopener">Open the PDF in a new tab</a></p>`
      : m.kind === "text" ? `<pre class="paper">Loading…</pre>`
      : `<p class="fine">No preview for ${esc(m.kind)} files.</p>`;
    $("mediaDlg").showModal();
    if (m.kind === "text") {
      try { body.querySelector("pre").textContent = await (await fetch(url)).text(); } catch (err) { body.querySelector("pre").textContent = err.message; }
    }
  }
  $("mediaDlg").addEventListener("close", () => { $("mediaBody").innerHTML = ""; });

  $("mediaInput").addEventListener("change", e => { uploadAll(e.target.files); e.target.value = ""; });
  const drop = $("mediaCard");
  drop.addEventListener("dragover", e => { if (!app.project) return; e.preventDefault(); $("drop").classList.add("over"); });
  drop.addEventListener("dragleave", e => { if (!drop.contains(e.relatedTarget)) $("drop").classList.remove("over"); });
  drop.addEventListener("drop", e => { e.preventDefault(); $("drop").classList.remove("over"); uploadAll(e.dataTransfer.files); });

  $("mediaList").addEventListener("click", async e => {
    const view = e.target.closest("[data-view]");
    if (view) return viewMedia(view.dataset.view);
    const del = e.target.closest("[data-del]");
    if (!del) return;
    if (!window.confirm(`Delete ${del.dataset.del}? It isn't in git, so it can't be recovered.`)) return;
    try { await api(mediaUrl(del.dataset.del), { method: "DELETE" }); attached.delete(del.dataset.del); await loadMedia(); }
    catch (err) { setStatus(err.message, true); }
  });
  $("mediaList").addEventListener("change", async e => {
    const box = e.target.closest("[data-attach]");
    if (box) { box.checked ? attached.add(box.dataset.attach) : attached.delete(box.dataset.attach); renderMedia(); return; }
    const note = e.target.closest("[data-note]");
    if (!note) return;
    try {
      const updated = await api(mediaUrl(note.dataset.note), { method: "PATCH", body: JSON.stringify({ note: note.value }) });
      media = media.map(m => (m.id === updated.id ? updated : m));
      setStatus(`Saved the note for ${updated.id}.`);
    } catch (err) { setStatus(err.message, true); }
  });

  // ---------- theme ----------
  const themeSelect = $("themeSelect");
  themeSelect.innerHTML = Themes.list.map(t => `<option value="${t.id}">${esc(t.label)}</option>`).join("");
  let game = null;
  function applyTheme(id) {
    THEME = Themes.get(id);
    document.documentElement.dataset.theme = THEME.id;
    themeSelect.value = THEME.id;
    for (const a of Object.values(agents)) {
      const look = { hat: null, hatColor: null, ...LOOKS[a.id], ...(THEME.looks && THEME.looks[a.id]) };
      for (const k of LOOK_KEYS) a[k] = look[k];
    }
    if (game) game.setSkin(THEME.game);
    renderRoster();
  }
  themeSelect.addEventListener("change", e => {
    applyTheme(e.target.value);
    try { localStorage.setItem("office.theme", THEME.id); } catch { /* not available */ }
  });

  // ---------- stop button ----------
  $("stopBtn").addEventListener("click", () => {
    const c = app.snapshot && app.snapshot.current;
    if (!c) return;
    $("stopWhat").textContent = `${c.project} · ${c.taskId || "the new request"}`;
    $("stopErr").textContent = "";
    $("stopDlg").showModal();
  });
  $("stopForm").addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await api("/api/stop", { method: "POST" });
      app.stopping = true; renderStop();
      $("stopDlg").close();
      setStatus("Stopping the current task. The work so far is kept.");
    } catch (err) { $("stopErr").textContent = err.message; }
  });

  // ---------- side game ----------
  game = window.OfficeGame.mount($("game"), { skin: THEME.game, isTeamWorking: () => !!(app.snapshot && app.snapshot.current) });

  // ---------- start ----------
  applyTheme(THEME.id);
  renderRoster(); renderLog();
  requestAnimationFrame(t => { last = t; requestAnimationFrame(tick); });
  (async () => {
    try { await loadOffice(); await loadProjects(); renderRoster(); connect(); }
    catch (err) { setStatus(`Can't reach the office server: ${err.message}. Start it with npm run office.`, true); }
  })();
})();
