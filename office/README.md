# Agent Office

A local web app where you give the AI team requests and watch them work. The Manager, Senior Dev, Jr Dev and QA are pixel characters who carry the real task files, dev reports and QA reports between desks while the orchestrator runs.

## Run it

```sh
npm run office        # real team, using your Claude Code login
npm run office:demo   # stand-in agents, no Claude usage
```

Then open http://localhost:4321 (set `OFFICE_PORT` to change the port).

Demo mode keeps its projects in `.office-demo/projects` (git-ignored), so it never touches your real projects.

## What you can do

- **Projects:** create one (this makes `projects/<name>` with `PRD.md`, `AGENTS.md` and `.ai/`) or delete one (you have to type its name to confirm).
- **Requests:** describe what you want. The Manager reads the project and writes `.ai/tasks/TASK-xxx.json` with acceptance criteria, then assigns the task: large tasks go to the Senior Dev, small ones to the Jr Dev. You can also pick the developer yourself.
- **Approval:** when QA passes a task, it shows up under "Needs you". Approve it, or send it back with notes, which are added to the task file as `humanFeedback`. A task that fails QA 5 times is blocked and also comes back to you.
- **Files:** every handoff in the log links to the file that was passed: `TASK-xxx.json`, `dev-report.md` or `qa-report.json`. The reports for each round are kept in `.ai/reports/<task>/`.

- **Stop button:** the big red button under the office ends the task the team is working on right now. The running agent and any command it started are stopped straight away, the task is marked `stopped`, and the work so far is committed to its task branch. Anything queued after it still runs. A stopped task appears under "Needs you" so you can send it back with direction, or run it again from Tasks.
- **Themes:** pick one from the Theme menu in the header. It changes the page and the pixel world. Your choice is saved in this browser.
  - *Pixel office (night)*: the default.
  - *Pixel office (day)*: a light page.
  - *Old School RuneScape*: a fan theme with stone panels, torches, a bank booth, party hat and armour, overhead chat, hitsplats when QA fails a round and a level-up when it passes. It's all original pixel art drawn in code, with no Jagex assets.
- **While you wait:** a small idle clicker on the side (Commit Clicker, or Gold Ore Miner in the OSRS theme). It earns double while the team is working, and its progress is kept in this browser.

### Adding a theme

Add an entry to `office/themes.js` (page label, world recolour map, optional floor/wall/decor drawing, outfits, room names, game names) and a `:root[data-theme="<id>"]` block of CSS variables in `office/office.css`.

## Media

The Media panel takes uploads for the selected project: videos, images, audio, PDFs, fonts and text files, up to 2 GB each (set `OFFICE_MAX_UPLOAD_MB` to change this). Drag files onto the panel or choose them.

- Files go into `projects/<name>/media/`, which is git-ignored. Uploads and renders stay on this PC and are never pushed. Deleting a file, or the project, can't be undone.
- `media/library.json` lists each file with its type, size, dimensions or length, and your note. Write a note saying what's in each file, especially what's said in a clip, because the agents can't hear audio.
- Tick "Use in next request" to attach files. The Manager sees their descriptions, and the task file lists them under `media`.

## The team

The **Designer** makes logos, social graphics, YouTube thumbnails, posters, banners and UI mockups. It designs in HTML/SVG (sources in `design/`, committed), renders exact-size PNGs into `media/design-*.png` (local, shown in the Media panel) and looks at every render with a `view_image` tool before handing it to QA. QA looks at the exports too. It can't generate photos, so attach your own images when a design needs them. The Manager sends visual work to the Designer, or you can pick "Designer" under "Who builds it". Rendering uses Playwright's Chromium (`npx playwright install chromium` on a new machine).

The **Video Editor** turns uploaded footage, either one long raw video or several clips, into finished social videos. By default these are vertical 1080×1920 H.264 MP4s, about -14 LUFS, under 60 s unless you say otherwise.
- **Your instructions** are the request (the brief for that edit) and the **edit notes** on each clip in the Media panel, one per line with that clip's own timestamps, e.g. `0:05–0:20 keep: summit view`, `1:10 cut: cough`, `2:10–2:40 use as the ending`.
- **Before rendering**, it writes an edit plan to `video/<name>-edit.md` (committed).
- **Files:** work files go to `.ai/renders/` and the final video to `media/video-<name>.mp4`. Both stay local and the final shows in the Media panel.
- **What it can and can't do:** it sees footage as frame contact sheets and finds pauses and loudness with ffmpeg, but it can't hear. Put what's said in your notes, and any captions in the brief.
- **QA** checks the export's format, length and loudness, and looks at frames at every cut against the plan and your notes.
- **Requirements:** ffmpeg and ffprobe come from the `ffmpeg-static` and `ffprobe-static` packages. If `npm ci` skipped the download, run `node node_modules/ffmpeg-static/install.js`. Uploaded videos are measured with ffprobe, so `.mov` and `.mkv` get their real length and size too.

The **Quant Advisor** handles financial and mathematical/logical strategy questions: strategy research and backtests, portfolio construction and risk (drawdowns, VaR/CVaR, position sizing), option and bond pricing, loan, savings and retirement maths, and probability, game-theory and logic problems.
- **How it works:** it states the question and its assumptions, builds the model as tested TypeScript in `research/<name>/` (run with Node, no extra packages) and cross-checks the numbers a second way, e.g. a formula against a simulation.
- **Output:** charts are rendered into `media/chart-*.png`, and a report goes to `research/<name>-report.md` with the answer and its uncertainty, the method, the validation, robustness checks, and the risks and limitations.
- **Backtests** must avoid look-ahead, include trading costs and report an out-of-sample or walk-forward period. It counts how many variants it tried, so you can judge overfitting.
- **Data:** attach data through the Media panel (CSV exports, statements). Personal financial data stays in `media/` and is never committed, because the repo is public.
- **Limits:** its work is research and education, not personal financial advice. It never places trades, connects to brokers or banks, or handles API keys. Where the answer depends on your circumstances, it shows labelled scenarios and says what would change the answer.
- **QA** re-runs the tests and the main script, spot-checks a headline number independently, looks for look-ahead, reads the report for missing assumptions or guaranteed-return language, and checks the charts.

### Books and PDFs as a source

The Quant Advisor and QA can search and read the PDFs in a project's `media/` folder, such as your own copies of textbooks and papers.

- **`search_library`** finds the best-matching pages, giving the book, PDF page, printed page number, section and a snippet.
- **`read_pdf`** reads up to 20 pages as text, or up to 4 as images (for exact equations, tables and scanned books). Without a page range, it returns the table of contents.
- **Citations:** agents cite formulas as `[Short title, p. <printed page>]`, and QA checks some of the citations against the pages.
- **The index** is built from each PDF's text layer and stored in `.ai/library/`, which is git-ignored because it contains the books' text. It takes about 40 seconds for 10,000 pages and updates when a PDF changes. The first search builds it, or you can build it ahead of time with `npm run library -- <project>`, and add search words to try a search.
- **Scanned books** have no text layer, so they can't be searched. Agents read their pages as images instead.
- **Privacy:** agents may quote a formula or a sentence with its citation, but never copy pages or convert whole books. Nothing from the books is committed.

### Guard rails on agents' commands

Agents' commands run at below-normal priority, so the PC stays responsive. Each command is stopped after 60 seconds, or when you press Stop, together with every process it started.

Commands that detach a process (`Start-Process`, `start`, WMI, `nohup`, a trailing `&`) are refused. So is installing heavy machine-learning packages (`torch`, `tensorflow`, `marker-pdf`, `docling`, `transformers`...) or downloading models. An agent that needs them has to ask in its report.

`team.json` sets each member's name and Claude model (`opus`, `sonnet`, or a full model ID), plus the maximum number of dev/QA rounds.

## Git

In live mode, each task runs on its own branch, `task/<project>-<TASK>`, created from the current branch when there are no uncommitted changes to tracked files. When the run ends, the project folder is committed to that branch. Nothing is ever committed to `main` or `master`, and nothing is merged or pushed: approving a task tells you which branch to merge. Set `OFFICE_GIT=off` to turn this off.

Tasks run one at a time, across all projects, because they share one git working tree.

## Safety

The server only listens on `127.0.0.1`. It only accepts requests addressed to `localhost`, and only accepts changes from its own page. That matters because it can run agents that execute commands and can delete project folders.
