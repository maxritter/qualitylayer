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
  cpSync(join(realModel, "assets"), join(model, "assets"), { recursive: true });
  // marked comes from the real QualityLayer install; the copy is only read through the link.
  symlinkSync(join(realQualityLayer, "node_modules"), join(root, "qualitylayer/node_modules"), "junction");
  // The shared assets sit where the check looks for them, equal to the model's own.
  for (const name of readdirSync(join(model, "assets"))) {
    const target = name === "palette.css" ? "qualitylayer/src/ui/brand" : /^(?:geist|OFL)/.test(name) ? "docs/docusaurus/static/fonts" : name.startsWith("product-") ? "docs/site/public/product" : "docs/docusaurus/static/img/app";
    mkdirSync(join(root, target), { recursive: true });
    cpSync(join(model, "assets", name), join(root, target, name.replace(/^product-/, "")), { recursive: true });
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

const html = (key) => key === "memory.md" ? "index.html" : `${key.replace(/\.md$/, "").replaceAll("/", "--")}.html`;

test("a fresh model is written page by page, then the plain and source checks pass", () => {
  const w = world();
  for (const key of keys) assert.ok(existsSync(join(w.model, html(key))), html(key));
  for (const flags of [[], ["--check-source"]]) {
    const checked = w.render(...flags);
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, new RegExp(`Docs model matches ${keys.length} authored guide pages`));
  }
});

test("every drifted generated page is named, one per line, not only the first", () => {
  const w = world();
  w.edit("app.md");
  w.edit("artifacts.md");
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
  w.edit("app.md");
  w.edit("artifacts.md");
  const checked = w.render("--check-source");
  assert.equal(checked.status, 1);
  assert.deepEqual(checked.lines.sort(), ["Docs copy drift: app.md", "Docs copy drift: artifacts.md", "Docs model drift: app.html", "Docs model drift: artifacts.html"]);

  // Only the authored markdown differs from copy.json: the generated pages are current.
  const v = world();
  for (const key of ["app.md", "intro.md"]) writeFileSync(join(v.root, "docs/docusaurus/docs", key), body(key, "Edited elsewhere"));
  const authored = v.render("--check-source");
  assert.equal(authored.status, 1);
  assert.deepEqual(authored.lines.sort(), ["Docs copy drift: app.md", "Docs copy drift: intro.md"]);
});

test("--pages limits the check to those pages", () => {
  const w = world();
  w.edit("app.md");
  for (const flags of [[], ["--check-source"]]) {
    const other = w.render(...flags, "--pages", "artifacts.md");
    assert.equal(other.status, 0, other.stderr);
    assert.match(other.stdout, /Docs model matches 1 authored guide pages/);
  }
  const named = w.render("--check-source", "--pages", "app.md,artifacts.md");
  assert.equal(named.status, 1);
  assert.deepEqual(named.lines.sort(), ["Docs copy drift: app.md", "Docs model drift: app.html"]);
  const unknown = w.render("--pages", "nowhere.md");
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown page: nowhere\.md/);
});

test("--write rewrites the drifted generated pages, names them, and the plain check then passes", () => {
  const w = world();
  w.edit("app.md");
  w.edit("artifacts.md");
  const before = w.snapshot();
  const written = w.render("--write");
  assert.equal(written.status, 0, written.stderr);
  assert.match(written.stdout, /Wrote 2 generated pages: (?:app\.html, artifacts\.html|artifacts\.html, app\.html)/);
  assert.equal(w.render().status, 0);
  assert.match(readFileSync(join(w.model, "app.html"), "utf8"), /Changed body of app\.md/);

  // Nothing but those two generated pages changed: not the authored markdown, copy.json, the assets or a hand-written page.
  const after = w.snapshot();
  const changed = Object.keys(after).filter((path) => before[path] !== after[path]).map((path) => basename(path)).sort();
  assert.deepEqual(changed, ["app.html", "artifacts.html"]);
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  // The authored markdown still differs from the model: --write does not hide that.
  assert.deepEqual(w.render("--check-source").lines.sort(), ["Docs copy drift: app.md", "Docs copy drift: artifacts.md"]);
  // Run again: nothing is left to write.
  assert.match(w.render("--write").stdout, /No generated page needed writing/);
});

test("--write with --pages writes only those pages", () => {
  const w = world();
  w.edit("app.md");
  w.edit("artifacts.md");
  const written = w.render("--write", "--pages", "artifacts.md");
  assert.equal(written.status, 0, written.stderr);
  assert.match(written.stdout, /Wrote 1 generated page: artifacts\.html/);
  assert.deepEqual(w.render().lines, ["Docs model drift: app.html"]);
});

test("--patch prints only the pages that differ and writes nothing", () => {
  const w = world();
  w.edit("app.md");
  const before = w.snapshot();
  const patch = w.render("--patch");
  assert.equal(patch.status, 0, patch.stderr);
  assert.match(patch.stdout, /\*\*\* Update File: .*app\.html/);
  assert.deepEqual(patch.stdout.split("\n").filter((line) => /^\*\*\* (?:Update|Add) File: /.test(line)).map((line) => basename(line)), ["app.html"]);
  assert.deepEqual(w.snapshot(), before);
});
