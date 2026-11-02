import * as path from "node:path";

import { REPO_ROOT } from "../team.js";
import { buildLibrary, searchLibrary } from "./library.js";

// Builds a project's PDF library index ahead of time (otherwise the first
// search_library call does it), and optionally runs a search:
//   npm run library -- <project> ["search words"]
const [name, ...query] = process.argv.slice(2);
if (!name) {
  console.error('Usage: npm run library -- <project> ["search words"]');
  process.exit(1);
}

const project = path.join(REPO_ROOT, "projects", name);
const started = Date.now();
const books = await buildLibrary(project, (message) => console.log(message));
const pages = books.reduce((n, b) => n + b.pages, 0);
console.log(`\n${books.length} PDFs, ${pages} pages, indexed in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
const scanned = books.filter((b) => b.scanned);
if (scanned.length) {
  console.log(`Scanned (no text layer, read as page images): ${scanned.map((b) => b.id).join(", ")}`);
}

if (query.length) {
  const { hits } = await searchLibrary(project, query.join(" "));
  for (const h of hits) console.log(`\n${h.title}, p. ${h.label} (PDF page ${h.page})${h.section ? ` — ${h.section}` : ""}\n  ${h.snippet}`);
}
