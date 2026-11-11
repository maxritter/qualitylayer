import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const page = (route) => {
  const paths = [`../build/docs/${route}index.html`, route ? `../build/docs/${route.replace(/\/$/, "")}.html` : "../build/docs.html"];
  const url = paths.map((path) => process.env.QUALITYLAYER_DOCS_BUILD_DIR ? pathToFileURL(resolve(process.env.QUALITYLAYER_DOCS_BUILD_DIR,path.replace(/^\.\.\/build\//,""))) : new URL(path, import.meta.url)).find(existsSync);
  assert.ok(url, `No built page for ${route}; run npm run build first`);
  return readFileSync(url, "utf8");
};

const article = (route) => page(route).match(/<article\b[^>]*>([\s\S]*?)<\/article>/)?.[1] ?? assert.fail(`${route}: no guide article`);
const text = (route) => article(route)
  .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/\s+/g, " ");

// Every guide in the sidebar, by route. The changelog reads GitHub Releases and is checked on its own.
const guides = [
  "", "install/", "machines/", "first-task/", "work-in-your-agent/", "agents/native/", "agents/other/", "moving-from-pilot-shell/",
  "steps/plan/", "steps/implement/", "steps/verify/", "steps/pull-request/",
  "app/", "chat/", "artifacts/", "reference/code-health/", "memory/", "automations/",
  "reference/commands/", "reference/settings/", "reference/files/",
];

test("every guide renders its kit: no raw imports or tags, no placeholder, and a Next row", () => {
  for (const route of guides) {
    const body = article(route);
    const words = text(route);
    assert.doesNotMatch(words, /from "@site\/src\/components\/kit"|<(?:Card|Steps|Tabs|Screenshot|NextSteps)\b/, `${route}: kit source leaked into the page`);
    assert.doesNotMatch(words, /Picture to capture/, `${route}: a screenshot placeholder reached production`);
    assert.match(body, /<nav\b[^>]*aria-label="Next steps"/, `${route}: no Next steps`);
  }
});

test("diagrams open at full size from each guide, with an accessible name and the right theme", () => {
  for (const route of ["", "install/", "first-task/", "steps/implement/", "steps/pull-request/", "agents/other/", "reference/code-health/", "reference/files/"]) {
    const links = [...article(route).matchAll(/<a\b[^>]*class="ql-diagram"[^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]);
    assert.ok(links.length >= 2, `${route}: no full-size illustrations; run npm run build first`);
    for (const link of links) {
      const href = link.match(/href="([^"]+)"/)?.[1];
      const src = link.match(/<img[^>]*src="([^"]+)"/)?.[1];
      assert.equal(href, src, `${route}: full size must open the illustration shown`);
      assert.match(link, /aria-label="Open illustration full size:/);
      assert.match(link, /target="_blank"/);
      assert.match(link, /rel="noopener noreferrer"/);
      assert.match(link, /data-illustration-theme="(?:light|dark)"/);
    }
  }
});

test("App screenshots come in both themes, each opening its own picture, and every picture exists", () => {
  const app = fileURLToPath(new URL("../static/img/app/", import.meta.url));
  const shipped = new Set(readdirSync(app));
  for (const route of ["", "first-task/", "steps/plan/", "steps/implement/", "steps/verify/", "steps/pull-request/", "app/", "chat/", "artifacts/", "memory/", "machines/", "reference/settings/"]) {
    const links = [...article(route).matchAll(/<a\b[^>]*aria-label="Open full size:[^"]*"[^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]);
    assert.ok(links.length >= 2, `${route}: no App screenshot`);
    const names = links.map((link) => link.match(/<img[^>]*src="\/img\/app\/([a-z-]+)-(?:light|dark)\.webp"/)?.[1]);
    for (const [index, link] of links.entries()) {
      const src = link.match(/<img[^>]*src="([^"]+)"/)?.[1];
      assert.equal(link.match(/href="([^"]+)"/)?.[1], src, `${route}: full size must open the screenshot shown`);
      assert.match(link, /target="_blank"/);
      assert.ok(names[index], `${route}: a screenshot outside static/img/app`);
      assert.ok(shipped.has(src.split("/").at(-1)), `${route}: ${src} is not in static/img/app`);
    }
    for (const name of new Set(names)) {
      for (const theme of ["light", "dark"]) assert.ok(links.some((link) => link.includes(`/img/app/${name}-${theme}.webp`)), `${route}: ${name} has no ${theme} picture`);
    }
  }
});

test("Chat sits under App and projects and leads with its workspace picture", () => {
  const html = page("chat/");
  const categories = html.split(/(?=<li class="theme-doc-sidebar-item-category )/).slice(1);
  const getStarted = categories.find((item) => item.includes(">Get started<"));
  const app = categories.find((item) => item.includes(">App and projects<"));
  assert.ok(getStarted && app, "Both sidebar categories must remain");
  assert.doesNotMatch(getStarted, /<a\b[^>]*href="\/docs\/chat"/);
  assert.match(app, /<a\b[^>]*href="\/docs\/chat"/);
  const body = article("chat/");
  const firstImage = body.indexOf("/img/app/chat-light.webp");
  assert.ok(firstImage >= 0 && body.indexOf('id="start"') > firstImage, "The workspace picture must precede the how-to sections");
  assert.match(body, /\/img\/app\/chat-dark\.webp/);
});

test("the workflow has three steps and the pull request, named as the App names them", () => {
  const html = page("steps/plan/");
  const workflow = html.split(/(?=<li class="theme-doc-sidebar-item-category )/).find((item) => item.includes(">Workflow<"));
  assert.deepEqual([...new Set([...workflow.matchAll(/href="\/docs\/steps\/([a-z-]+)"/g)].map((m) => m[1]))], ["plan", "implement", "verify", "pull-request"]);
  assert.match(page(""), /id="the-three-steps"/);
  for (const route of guides) {
    const words = text(route);
    assert.doesNotMatch(words, /In my terminal|Terminal mode|the seven steps/i, `${route}: retired naming`);
    assert.doesNotMatch(words, /\b(?:Discuss|Outline) step\b|\/docs\/team\//, `${route}: a retired step or team page`);
  }
});

test("Plan, Implement and Verify explain the current questions, approvals and review", () => {
  const plan = text("steps/plan/");
  for (const phrase of ["Your turn", "one question at a time", "Use all recommended", "your own answer", "Send", "Tell me more", "Your call", "Approve and build here", "Choose where to build", "Answering a question does not approve the Plan", "Done means"]) assert.ok(plan.includes(phrase), `Plan: ${phrase}`);
  const implement = text("steps/implement/");
  for (const phrase of ["Approve and build here", "Start the build", "Approve & start", "Approve and copy", "Copy prompt", "Build model", "Effort", "Subagent model", "Workspace", "In my own agent"]) assert.ok(implement.includes(phrase), `Implement: ${phrase}`);
  assert.doesNotMatch(implement, /Start with (?:Codex|Claude Code)|Hand over|hand it to a teammate/);
  const verify = text("steps/verify/");
  for (const phrase of ["Done means", "point shows its evidence as it comes in", "Review the code", "Approve and create PR", "Ask another reviewer", "rechecking"]) assert.ok(verify.includes(phrase), `Verify: ${phrase}`);
});

test("the App guide names its parts and keeps amounts and reading boundaries", () => {
  const app = text("app/");
  for (const phrase of ["Files", "Agent status", "Conversation", "Working artifacts are compact entries in", "Open full size", "Copy document", "Amounts stay hidden until you open it", "Usage history", "In my own agent"]) assert.ok(app.includes(phrase), `App: ${phrase}`);
  assert.match(page("artifacts/"), /compact entry in/);
  const files = text("reference/files/");
  for (const phrase of ["Licence and trial service", "Nothing passes through qualitylayer.dev", "Report bug / idea", "Private support"]) assert.ok(files.includes(phrase), `Files and privacy: ${phrase}`);
});

test("Memory distinguishes local retrieval, agent context and opt-in Git exchange", () => {
  const memory = text("memory/");
  assert.match(article("memory/"), /<figure[^>]+aria-label="How a saved lesson reaches an agent"/);
  for (const label of ["Save a lesson", "Find it locally", "Use it in context"]) assert.ok(memory.includes(label));
  assert.match(memory, /cloud agent may send that context to its provider/);
  assert.match(memory, /without recorded passing checks/);
  assert.match(memory, /Memory exchange never commits, pushes or pulls/);
  assert.match(memory, /If hooks are off, unavailable or too slow, delivery can be skipped/);
  assert.match(memory, /Turning sharing off stops exchange/);
  assert.doesNotMatch(memory, /no text leaves your computer|QualityLayer never commits or pushes/);
  const html = article("memory/");
  assert.match(html, /<summary[^>]*>Search, save, pin and sync from the command line<\/summary>/);
  for (const anchor of ["what-your-agents-get", "share-lessons-through-git", "import-pilot-lessons", "command-line"]) assert.ok(html.includes(`id="${anchor}"`), anchor);
});

test("anchors that the App, README and other pages link to still exist", () => {
  const anchors = {
    "": ["the-three-steps", "choose-how-to-work", "how-it-fits-together"],
    "install/": ["port", "without-a-screen", "agent-setup", "updates", "uninstall"],
    "machines/": ["second-machine", "dev-containers", "work"],
    "work-in-your-agent/": ["where", "pickers"],
    "agents/native/": ["the-six-skills", "permission-modes", "plan-limits"],
    "steps/plan/": ["the-question", "items", "answering", "a-bug", "existing-plan"],
    "steps/implement/": ["start-implement", "where-it-lands", "while-the-agent-builds"],
    "steps/verify/": ["lanes", "items", "when-it-stops", "approve"],
    "steps/pull-request/": ["watch", "waits"],
    "app/": ["home", "questions", "agent-runs", "cost", "comments-and-artifacts"],
    "artifacts/": ["lasting", "keep", "fold-in"],
    "reference/files/": ["privacy", "documents"],
    "reference/settings/": ["second-opinion", "step-checks", "machines", "defaults", "workflow", "git-and-editor"],
    "reference/commands/": ["session-messaging", "artifacts", "code-health", "memory", "commands-by-group"],
    "reference/code-health/": ["security-scans"],
  };
  for (const [route, ids] of Object.entries(anchors)) {
    const html = article(route);
    for (const id of ids) assert.ok(html.includes(`id="${id}"`), `${route}#${id}`);
  }
});

test("navigation names supported agents without changing their route", () => {
  const html = page("memory/");
  const links = [...html.matchAll(/<a\b[^>]*href="\/docs\/agents\/native"[^>]*>([\s\S]*?)<\/a>/g)].filter((m) => m[0].includes("menu__link"));
  assert.equal(links.length, 1);
  assert.equal(links[0][1].replace(/<[^>]+>/g, ""), "Supported agents");
  for (const name of ["Claude Code", "Codex", "Cursor", "Grok", "Antigravity", "Pi", "OpenCode", "GitHub Copilot"]) assert.ok(text("agents/native/").includes(name), name);
  assert.match(page("reference/settings/"), /id="defaults"/);
});

test("the docs artifact matches the shipped guides (a docs edit without its artifact is red here)", () => {
  const renderer = fileURLToPath(new URL("../../../qualitylayer/artifacts/site/website-model/docs/render.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [renderer, "--check-source"], { encoding: "utf8" });
  const drift = result.stderr.split("\n").filter((line) => /^Docs (?:model|copy|asset) drift: /.test(line)).join("; ") || result.stderr;
  assert.equal(result.status, 0, `Update qualitylayer/artifacts/site/website-model/docs/copy.json, then regenerate the pages with render.mjs --write (or inspect them with --patch): ${drift}`);
  assert.match(result.stdout, /Docs model matches \d+ authored guide pages/);
});

