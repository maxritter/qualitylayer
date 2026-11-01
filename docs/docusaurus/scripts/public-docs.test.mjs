import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const page = (route) => {
  const paths = [`../build/docs/${route}index.html`, route ? `../build/docs/${route.replace(/\/$/, "")}.html` : "../build/docs.html"];
  const url = paths.map((path) => process.env.QUALITYLAYER_DOCS_BUILD_DIR ? pathToFileURL(resolve(process.env.QUALITYLAYER_DOCS_BUILD_DIR,path.replace(/^\.\.\/build\//,""))) : new URL(path, import.meta.url)).find(existsSync);
  assert.ok(url, `No built page for ${route}; run npm run build first`);
  return readFileSync(url, "utf8");
};

const text = (route) => page(route)
  .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ");

test("App illustrations open at full size from each guide, with an accessible name and the right theme", () => {
  for (const route of ["", "app/", "chat/", "steps/discuss/", "steps/plan/", "steps/implement/", "steps/verify/", "steps/review/", "artifacts/", "memory/", "reference/settings/"]) {
    const html = page(route);
    const links = [...html.matchAll(/<a\b[^>]*class="ql-diagram"[^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]);
    assert.ok(links.length >= 2, `${route}: no full-size illustrations; run npm run build first`);
    for (const link of links) {
      const href = link.match(/href="([^"]+)"/)?.[1];
      const src = link.match(/<img[^>]*src="([^"]+)"/)?.[1];
      assert.equal(href, src, `${route}: full size must open the illustration shown`);
      assert.match(link, /aria-label="Open illustration full size:/);
      assert.match(link, /target="_blank"/);
      assert.match(link, /rel="noopener noreferrer"/);
      assert.match(link, /data-illustration-theme="(?:light|dark)"/);
      assert.match(link, /Open full size/);
    }
  }
});

test("Chat is under App and team and leads with its themed workspace image", () => {
  const html = page("chat/");
  const categories = html.split(/(?=<li class="theme-doc-sidebar-item-category )/).slice(1);
  const getStarted = categories.find((item) => item.includes(">Get started</span>"));
  const appAndTeam = categories.find((item) => item.includes(">App and team</span>"));
  assert.ok(getStarted && appAndTeam, "Both existing sidebar categories must remain");
  assert.doesNotMatch(getStarted, /<a\b[^>]*href="\/docs\/chat"/);
  assert.match(appAndTeam, /<a\b[^>]*href="\/docs\/chat"/);
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/)?.[1];
  assert.ok(article, "Chat must render a guide article");
  const firstImage = article.indexOf("/img/app/chat-light.webp");
  const firstSection = article.indexOf('id="start"');
  assert.ok(firstImage >= 0 && firstSection > firstImage, "The full workspace image must precede the how-to sections");
  assert.match(article, /\/img\/app\/chat-dark\.webp/);
});

test("the built guides explain current answers, complete Plan approval and live sharing", () => {
  const discuss = text("steps/discuss/");
  assert.match(discuss, /Your turn/);
  assert.match(discuss, /Answer in any order/);
  assert.match(discuss, /one question at a time/);
  assert.match(discuss, /Use recommended/);
  assert.match(discuss, /your own answer/i);
  assert.match(discuss, /Send/);
  assert.match(discuss, /immediately/);
  assert.doesNotMatch(discuss, /question N|Undo.{0,40}five seconds/);
  const plan = text("steps/plan/");
  assert.match(plan, /Findings from the technical review return to the planning agent/);
  assert.match(plan, /Read the complete Plan/);
  assert.match(plan, /Approve Plan/);
  assert.match(plan, /Give feedback/);
  assert.doesNotMatch(plan, /Agree to each.{0,40}Done means/);
  assert.match(page("steps/verify/"), /Proof for each point/);
  assert.match(page("steps/verify/"), /Done means/);
  assert.match(text("steps/verify/"), /point shows its evidence as it comes in/);
  assert.match(page("team/plans/"), /open page updates as the task changes/);
  assert.doesNotMatch(page("team/plans/"), /Reload the page/);
});

test("the built App guides use Files, Feedback and Agent and explain the current reading and privacy boundaries", () => {
  const app = text("app/");
  assert.match(app, /Files/);
  assert.match(app, /Feedback/);
  assert.match(app, /Agent/);
  assert.match(app, /Working artifacts are compact entries in/);
  assert.match(app, /Open full size/);
  assert.match(app, /Copy document/);
  assert.match(app, /Agent status/);
  assert.match(app, /(?:Dollar amounts|Amounts) stay hidden until you open it/);
  assert.match(app, /Usage history/);
  assert.doesNotMatch(app, /Artifacts.{0,20}tab|Comments.{0,30}Files.{0,30}and.{0,30}Artifacts/);
  assert.match(text("steps/implement/"), /Approve (?:&amp;|&) start/);
  assert.match(text("steps/implement/"), /Approve (?:&amp;|&) copy prompt.{0,30}your terminal/);
  assert.match(page("steps/implement/"), /Start the build/);
  for (const field of ["Agent", "Lead", "Effort", "Subagent default", "Files for the build", "Workspace"]) {
    assert.ok(text("steps/implement/").includes(field), `The build guide must explain ${field}`);
  }
  assert.doesNotMatch(page("steps/implement/"), /Start with (?:Codex|Claude Code)/);
  // The "Build it yourself or hand it to a teammate" row went with the team hand-over (2d1a756d2).
  assert.doesNotMatch(page("steps/implement/"), /Hand over|hand it to a teammate/);
  assert.match(page("artifacts/"), /compact entry in/);
  assert.match(text("reference/files/"), /No usage events/);
  assert.match(text("reference/files/"), /Include artifacts/);
  assert.match(text("reference/files/"), /Shared artifact previews run no scripts/);
  assert.match(text("reference/files/"), /terminal output/);
});

test("Memory distinguishes local retrieval, agent context and opt-in Git exchange", () => {
  const memory = text("memory/");
  assert.match(page("memory/"), /<figure[^>]+class="memory-flow"[^>]+aria-label="How a saved lesson reaches an agent"/);
  for (const label of ["Save a lesson", "Find it locally", "Use it in context"]) assert.ok(memory.includes(label));
  assert.match(memory, /(?:cloud-based|cloud) agent may send that context to its provider/);
  assert.match(memory, /without recorded passing checks/);
  assert.match(memory, /Memory exchange(?: itself)? never commits or pushes/);
  assert.match(memory, /If hooks are (?:off|disabled), unavailable or too slow, delivery can be skipped/);
  assert.match(memory, /Turning sharing off stops exchange/);
  assert.doesNotMatch(memory, /no text leaves your computer|writes lessons backed by recorded checks|QualityLayer never commits or pushes/);
  const html = page("memory/");
  assert.match(html, /<summary[^>]*>See Memory settings<\/summary>/);
  assert.match(html, /<summary[^>]*>Search, save, pin and sync from your terminal<\/summary>/);
  for (const anchor of ["what-your-agents-get", "share-lessons-through-git", "import-pilot-lessons", "command-line"]) assert.ok(html.includes(`id="${anchor}"`));
});

test("navigation names supported agents without changing their route or removing their names", () => {
  const html = page("memory/");
  const links = [...html.matchAll(/<a\b[^>]*href="\/docs\/agents\/native"[^>]*>([\s\S]*?)<\/a>/g)];
  assert.equal(links.length, 1);
  assert.equal(links[0][1].replace(/<[^>]+>/g, ""), "Supported agents");
  assert.doesNotMatch(html, />Claude Code, Codex, Pi and OpenCode<\/a>/);
  for (const name of ["Claude Code", "Codex", "Pi", "OpenCode"]) assert.ok(text("agents/native/").includes(name));
  assert.match(html, />Workflow<\/a>/);
  for (const step of ["discuss", "research", "plan", "outline", "implement", "verify", "review", "pull-request"]) assert.ok(html.includes(`/docs/steps/${step}`));
  assert.match(page(""), /id="the-seven-steps"/);
  assert.match(page("app/"), /id="comments-and-artifacts"/);
  assert.match(page("reference/settings/"), /id="defaults"/);
  assert.match(page("reference/settings/"), /Open Feedback automatically/);
});

test("the docs artifact matches the shipped guides (a docs edit without its artifact is red here)", () => {
  const renderer = fileURLToPath(new URL("../../../qualitylayer/artifacts/site/website-model/docs/render.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [renderer, "--check-source"], { encoding: "utf8" });
  const drift = result.stderr.split("\n").filter((line) => /^Docs (?:model|copy|asset) drift: /.test(line)).join("; ") || result.stderr;
  assert.equal(result.status, 0, `Update qualitylayer/artifacts/site/website-model/docs/copy.json, then regenerate the pages with render.mjs --write (or inspect them with --patch): ${drift}`);
  assert.match(result.stdout, /Docs model matches \d+ authored guide pages/);
});
