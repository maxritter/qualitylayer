// The docs model renderer (qualitylayer/artifacts/site/website-model/docs/render.mjs) against a
// temporary copy of the model and the docs, so no real page, guide or asset is read for its content or
// written. The copy has the real page names, a short body for each, and the real shared assets.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const realModel = fileURLToPath(new URL("../../../qualitylayer/artifacts/site/website-model/docs/", import.meta.url));
const realQualityLayer = fileURLToPath(new URL("../../../qualitylayer/", import.meta.url));
const keys = Object.keys(JSON.parse(readFileSync(join(realModel, "copy.json"), "utf8")).pages);
const retainedPages = ["blog--hooks-guide.html", "changelog.html", "changelog-loading.html", "changelog-error.html", "changelog-history.html", "changelog-history-error.html"];
const body = (key, text = "Body") => `---\ntitle: Title of ${key}\n---\n\n## First section\n\n${text} of ${key}.\n`;

let roots = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

/** A temporary repository with the renderer, a short copy.json, the authored pages and the assets. */
function world() {
  const root = mkdtempSync(join(tmpdir(), "docs-model-"));
  roots.push(root);
  const model = join(root, "qualitylayer/artifacts/site/website-model/docs");
  mkdirSync(model, { recursive: true });
  cpSync(join(realModel, "render.mjs"), join(model, "render.mjs"));
  cpSync(join(realModel, "assets.json"), join(model, "assets.json"));
  cpSync(join(realModel, "assets"), join(model, "assets"), { recursive: true });
  // Retained captures own their article bodies; the renderer still refreshes their shared sidebar.
  for (const name of retainedPages) {
    writeFileSync(join(model, name), `<html><body><nav class="docs-nav">Old navigation</nav><article>Retained fixture: ${name}</article></body></html>\n`);
  }
  writeFileSync(join(root, "LICENSE"), "Renderer fixture licence text.\n");
  // The kit's icons, which the model draws as the site does.
  const kit = join(root, "docs/docusaurus/src/components/kit");
  mkdirSync(kit, { recursive: true });
  cpSync(fileURLToPath(new URL("../src/components/kit/icons.tsx", import.meta.url)), join(kit, "icons.tsx"));
  // marked comes from the real QualityLayer install; the copy is only read through the link.
  symlinkSync(join(realQualityLayer, "node_modules"), join(root, "qualitylayer/node_modules"), "junction");
  // The shared assets sit where the check looks for them, equal to the model's own.
  const assets = JSON.parse(readFileSync(join(model, "assets.json"), "utf8"));
  for (const [name, source] of Object.entries(assets)) {
    const target = join(root, source);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(model, "assets", name), target);
  }
  const world = {
    root,
    model,
    pages: Object.fromEntries(keys.map((key) => [key, body(key)])),
    /** Write copy.json and, with `authored`, the markdown pages from the current pages. */
    save({ authored = false } = {}) {
      writeFileSync(join(model, "copy.json"), `${JSON.stringify({ pages: world.pages }, null, 2)}\n`);
      if (!authored) return;
      for (const [key, text] of Object.entries(world.pages)) {
        const path = key === "readme.md" ? join(root, "README.md") : join(root, "docs/docusaurus/docs", key);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
      }
    },
    /** Change a page in copy.json only: its generated page and its authored markdown now differ. */
    edit(key) {
      world.pages[key] = body(key, "Changed body");
      world.save();
    },
    render(...args) {
      const result = spawnSync(process.execPath, [join(model, "render.mjs"), ...args], { cwd: root, encoding: "utf8" });
      return { status: result.status, stdout: result.stdout, stderr: result.stderr, lines: result.stderr.split("\n").filter(Boolean) };
    },
    /** Every real file of the copy except the linked install, by relative path. */
    snapshot() {
      const files = {};
      const visit = (folder) => {
        for (const entry of readdirSync(folder, { withFileTypes: true })) {
          const path = join(folder, entry.name);
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) visit(path);
          else if (entry.isFile()) files[relative(root, path)] = readFileSync(path).toString("base64");
        }
      };
      visit(root);
      return files;
    },
  };
  world.save({ authored: true });
  // Decoys the renderer must never touch: a hand-written page beside the generated ones, and a guide.
  writeFileSync(join(model, "hand-written.html"), "<p>kept</p>\n");
  const written = world.render("--write");
  assert.equal(written.status, 0, written.stderr);
  return world;
}

const html = (key) => /^memory\.mdx?$/.test(key) ? "index.html" : `${key.replace(/\.mdx?$/, "").replaceAll("/", "--")}.html`;

test("an .mdx guide's kit renders as cards, steps, callouts, tabs, a flow and next steps", () => {
  const w = world();
  const key = keys.find((name) => /^chat\.mdx?$/.test(name));
  w.pages[key] = [
    "---", `title: Kit page`, "mdx:", "  format: mdx", "---", "",
    'import { Card, CardGroup, Steps, Step, Tip, Tabs, Tab, Flow, NextSteps } from "@site/src/components/kit";', "",
    "Lead with **bold**.", "",
    "## Cards {#cards}", "",
    '<CardGroup cols={2}>', '  <Card title="Plan" icon="network" tone="plan" href="/docs/install#cli">Reads **the code**.</Card>', '  <Card title="Plain">One line.</Card>', "</CardGroup>", "",
    "<Steps>", '  <Step title="First">Do `this`.</Step>', '  <Step title="Second">', "", "```text", "<Step> stays code", "```", "", "  </Step>", "</Steps>", "",
    "<Tip>A [link](install.md).</Tip>", "",
    '<Tabs groupId="where">', '  <Tab value="app" label="In the App">Choose **+**.</Tab>', '  <Tab value="agent" label="In my own agent">', "", "Ask in plain words.", "", "  </Tab>", "</Tabs>", "",
    '<Flow label="Laptop to machine" nodes={[{ icon: "laptop", label: "Laptop" }, { icon: "server", label: "Machine", detail: "Runs it" }]} via={["ssh"]} />', "",
    '<NextSteps items={[{ title: "Install", href: "/docs/install", text: "Get the App." }, { title: "Overview", href: "/docs", text: "Start." }]} />', "",
  ].join("\n");
  const renamed = key.replace(/\.md$/, ".mdx");
  if (renamed !== key) { w.pages[renamed] = w.pages[key]; delete w.pages[key]; }
  w.save();
  const written = w.render("--write", "--pages", renamed);
  assert.equal(written.status, 0, written.stderr);
  const page = readFileSync(join(w.model, html(renamed)), "utf8");
  assert.doesNotMatch(page, /import \{|&lt;Card|<Card\b/);
  assert.match(page, /<h2 id="cards">Cards<\/h2>/);
  assert.match(page, /<div class="kit-cards kit-cols-2"><a class="kit-card kit-card-link" href="install\.html#cli">.*kit-plan.*<svg.*Reads <strong>the code<\/strong>/);
  assert.match(page, /<ol class="kit-steps"><li class="kit-step"><p class="kit-step-title">First<\/p><div class="kit-step-body">Do <code>this<\/code>\.<\/div><\/li>/);
  assert.match(page, /&lt;Step&gt; stays code/);
  assert.match(page, /kit-callout kit-tip.*<a href="install\.html">link<\/a>/);
  assert.match(page, /data-group="where".*aria-selected="true" data-value="app">In the App<\/button>.*In my own agent.*<div class="kit-panel"[^>]*>Choose <strong>\+<\/strong>\.<\/div><div class="kit-panel"[^>]* hidden><p>Ask in plain words\.<\/p>/s);
  assert.match(page, /<figure class="kit-flow" aria-label="Laptop to machine">.*kit-flow-via">ssh<.*Runs it/);
  assert.match(page, /kit-next.*href="install\.html".*href="intro\.html"/);
});

test("a fresh model is written page by page, then the plain and source checks pass", () => {
  const w = world();
  for (const key of keys) assert.ok(existsSync(join(w.model, html(key))), html(key));
  for (const flags of [[], ["--check-source"]]) {
    const checked = w.render(...flags);
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, new RegExp(`Docs model matches ${keys.length + retainedPages.length + 1} authored guide pages`));
  }
});

test("every drifted generated page is named, one per line, not only the first", () => {
  const w = world();
  w.edit("app.mdx");
  w.edit("artifacts.mdx");
  const checked = w.render();
  assert.equal(checked.status, 1);
  assert.deepEqual(checked.lines, ["Docs model drift: app.html", "Docs model drift: artifacts.html"]);
});

test("README source checking reads the repository root and preserves its source", () => {
  const w = world();
  const readme = join(w.root, "README.md");
  writeFileSync(readme, "# Changed README\n");
  const checked = w.render("--check-source", "--pages", "readme.md");
  assert.equal(checked.status, 1);
  assert.deepEqual(checked.lines, ["Docs copy drift: readme.md"]);
  assert.equal(readFileSync(readme, "utf8"), "# Changed README\n");
});

test("--check-source names every drifted authored page too", () => {
  const w = world();
  w.edit("app.mdx");
  w.edit("artifacts.mdx");
  const checked = w.render("--check-source");
  assert.equal(checked.status, 1);
  assert.deepEqual(checked.lines.sort(), ["Docs copy drift: app.mdx", "Docs copy drift: artifacts.mdx", "Docs model drift: app.html", "Docs model drift: artifacts.html"]);

  // Only the authored markdown differs from copy.json: the generated pages are current.
  const v = world();
  for (const key of ["app.mdx", "intro.mdx"]) writeFileSync(join(v.root, "docs/docusaurus/docs", key), body(key, "Edited elsewhere"));
  const authored = v.render("--check-source");
  assert.equal(authored.status, 1);
  assert.deepEqual(authored.lines.sort(), ["Docs copy drift: app.mdx", "Docs copy drift: intro.mdx"]);
});

test("--pages limits the check to those pages", () => {
  const w = world();
  w.edit("app.mdx");
  for (const flags of [[], ["--check-source"]]) {
    const other = w.render(...flags, "--pages", "artifacts.mdx");
    assert.equal(other.status, 0, other.stderr);
    assert.match(other.stdout, /Docs model matches 1 authored guide pages/);
  }
  const named = w.render("--check-source", "--pages", "app.mdx,artifacts.mdx");
  assert.equal(named.status, 1);
  assert.deepEqual(named.lines.sort(), ["Docs copy drift: app.mdx", "Docs model drift: app.html"]);
  const unknown = w.render("--pages", "nowhere.md");
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown page: nowhere\.md/);
});

test("--write rewrites the drifted generated pages, names them, and the plain check then passes", () => {
  const w = world();
  w.edit("app.mdx");
  w.edit("artifacts.mdx");
  const before = w.snapshot();
  const written = w.render("--write");
  assert.equal(written.status, 0, written.stderr);
  assert.match(written.stdout, /Wrote 2 generated pages: (?:app\.html, artifacts\.html|artifacts\.html, app\.html)/);
  assert.equal(w.render().status, 0);
  assert.match(readFileSync(join(w.model, "app.html"), "utf8"), /Changed body of app\.mdx/);

  // Nothing but those two generated pages changed: not the authored markdown, copy.json, the assets or a hand-written page.
  const after = w.snapshot();
  const changed = Object.keys(after).filter((path) => before[path] !== after[path]).map((path) => basename(path)).sort();
  assert.deepEqual(changed, ["app.html", "artifacts.html"]);
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  // The authored markdown still differs from the model: --write does not hide that.
  assert.deepEqual(w.render("--check-source").lines.sort(), ["Docs copy drift: app.mdx", "Docs copy drift: artifacts.mdx"]);
  // Run again: nothing is left to write.
  assert.match(w.render("--write").stdout, /No generated page needed writing/);
});

test("--write with --pages writes only those pages", () => {
  const w = world();
  w.edit("app.mdx");
  w.edit("artifacts.mdx");
  const written = w.render("--write", "--pages", "artifacts.mdx");
  assert.equal(written.status, 0, written.stderr);
  assert.match(written.stdout, /Wrote 1 generated page: artifacts\.html/);
  assert.deepEqual(w.render().lines, ["Docs model drift: app.html"]);
});

test("--patch prints only the pages that differ and writes nothing", () => {
  const w = world();
  w.edit("app.mdx");
  const before = w.snapshot();
  const patch = w.render("--patch");
  assert.equal(patch.status, 0, patch.stderr);
  assert.match(patch.stdout, /\*\*\* Update File: .*app\.html/);
  assert.deepEqual(patch.stdout.split("\n").filter((line) => /^\*\*\* (?:Update|Add) File: /.test(line)).map((line) => basename(line)), ["app.html"]);
  assert.deepEqual(w.snapshot(), before);
});
