import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { captureSource } from "./capture-source.mjs";
import { CAPTURE_SCENES, DESKTOP_HERO_FILES, DESKTOP_HERO_VIEWPORT, DOCS_ALIASES, HERO_FILES, sceneFiles } from "./capture-scenes.mjs";
import { CHAPTERS } from "./demo/story.mjs";

const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/;
const json = path => {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
};

function changedInputs(recorded, current) {
  const before = recorded?.appearanceInputs ?? recorded?.sourceInputs;
  const after = recorded?.appearanceInputs ? current.appearanceInputs : current.sourceInputs;
  if (!before || !after || typeof before !== "object" || Array.isArray(before)) return ["capture inputs missing"];
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path] !== after[path]);
}

function committed(recorded) {
  return COMMIT.test(recorded?.sourceCommit ?? "") && Array.isArray(recorded?.sourceDirtyFiles) && recorded.sourceDirtyFiles.length === 0;
}

export function inside(folder, path) {
  const within = relative(realpathSync(folder), realpathSync(path));
  return !isAbsolute(within) && within !== ".." && !within.startsWith("../");
}

export function assetHash(repo, folder, name) {
  if (!NAME.test(name)) return null;
  const path = resolve(folder, name);
  try {
    if (!lstatSync(path).isFile()) return null;
    if (!inside(repo, path) || !inside(folder, path)) return null;
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch { return null; }
}

function docsReferences(folder) {
  const found = new Set();
  const walk = dir => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      if (!entry.isFile() || !/\.mdx?$/.test(entry.name)) continue;
      for (const match of readFileSync(path, "utf8").matchAll(/\/img\/app\/([a-z0-9-]+\.webp)/g)) found.add(match[1]);
    }
  };
  walk(folder);
  return found;
}

function imageIndex(rows, add) {
  const images = new Map();
  for (const image of rows) {
    if (!NAME.test(image?.file ?? "") || images.has(image.file)) {
      add("invalid-image", String(image?.file ?? ""), "Image names must be unique safe basenames");
      continue;
    }
    images.set(image.file, image);
  }
  return images;
}

function checkProducer(state, image, scene) {
  const source = state.manifest?.captureSources?.[image.captureSource];
  if (!committed(source)) {
    state.add("draft-source", image.file, "Image has no committed producer evidence", scene);
    return;
  }
  if (!state.inputChecks.has(image.captureSource)) state.inputChecks.set(image.captureSource, changedInputs(source, state.snapshot));
  const changed = state.inputChecks.get(image.captureSource);
  if (!changed.length) return;
  const more = changed.length > 4 ? ` (+${changed.length - 4})` : "";
  state.add("stale-source", image.file, `Capture inputs changed: ${changed.slice(0, 4).join(", ")}${more}`, scene);
}

function approvedFrame(image) {
  const phone = image.file.includes("-phone-");
  const dimensions = [image.width, image.height].every(size => Number.isInteger(size) && size > 0);
  if (DESKTOP_HERO_FILES.includes(image.file) && [image.scene === "hero", image.assetGroup === "hero",
    image.capture === "desktop-hero", image.sourceViewport?.width === DESKTOP_HERO_VIEWPORT.width,
    image.sourceViewport?.height === DESKTOP_HERO_VIEWPORT.height, image.width === 2664, image.height === 1904].some(value => !value)) return false;
  if (HERO_FILES.includes(image.file)) return [dimensions, image.frame?.kind === "consumer", image.frame?.padding === 12,
    image.frame?.theme === (image.file.endsWith("-dark.webp") ? "dark" : "light")].every(Boolean);
  return [dimensions, image.frame?.padding === (phone ? 12 : 24), image.frame?.border === 1,
    image.frame?.theme === (image.file.endsWith("-dark.webp") ? "dark" : "light"),
    image.frame?.radius === (phone ? 16 : 20)].every(Boolean);
}

function checkDocs(state, image) {
  if (HERO_FILES.includes(image.file) || DESKTOP_HERO_FILES.includes(image.file)) return;
  for (const name of [image.file, DOCS_ALIASES[image.file]].filter(Boolean)) {
    if (!existsSync(resolve(state.docs, name)) && !state.referenced.has(name)) continue;
    if (assetHash(state.repo, state.docs, name) === image.sha256) continue;
    state.add("docs-alias", name, `Docs image differs from ${image.file}`);
    state.aliases.push({ source: image.file, target: name });
  }
}

function checkImage(state, scene, file) {
  const image = state.images.get(file);
  if (!image) { state.add("missing-image", file, "Capture is missing", scene); return; }
  checkProducer(state, image, scene);
  const folder = HERO_FILES.includes(file) || DESKTOP_HERO_FILES.includes(file) ? resolve(state.repo, "docs/site/public/hero") : state.folder;
  if (!SHA.test(image.sha256 ?? "") || assetHash(state.repo, folder, file) !== image.sha256)
    state.add("asset-bytes", file, "Published image is missing, unsafe or differs from its capture", scene);
  if (!approvedFrame(image)) state.add("frame", file, "Capture is missing the approved frame geometry", scene);
  checkDocs(state, image);
}

function currentDemo(receipt, snapshot, expected) {
  const chapters = receipt?.chapters;
  if (!Array.isArray(chapters) || expected.length !== chapters.length) return false;
  return [receipt?.status === "passed", receipt?.mode === "private-source-build", committed(receipt),
    changedInputs(receipt, snapshot).length === 0, expected.every(id => chapters.includes(id))].every(Boolean);
}

/** A producer may differ from the candidate when its actual appearance inputs still match. */
export function checkCaptures(repo, { scenes = CAPTURE_SCENES, chapterIds = CHAPTERS.map(chapter => chapter.id), snapshot = captureSource(repo, { review: true }) } = {}) {
  const folder = resolve(repo, "docs/site/public/product");
  const manifest = json(resolve(folder, "capture-manifest.json"));
  const issues = [], stale = new Set(), aliases = [];
  const add = (kind, file, message, scene) => {
    issues.push({ kind, file, message });
    if (scene) stale.add(scene);
  };
  if (snapshot.sourceDirtyFiles.length) add("dirty-source", "", "Commit capture inputs before publishing media");
  if (manifest?.sourceMode !== "committed") add("draft-manifest", "capture-manifest.json", "Published images need a committed capture manifest");
  const state = { repo, folder, manifest, snapshot, add, aliases, docs: resolve(repo, "docs/docusaurus/static/img/app"),
    referenced: docsReferences(resolve(repo, "docs/docusaurus/docs")), inputChecks: new Map(), images: imageIndex(manifest?.images ?? [], add) };
  for (const scene of scenes) {
    if (manifest?.sourceMode !== "committed") stale.add(scene);
    for (const file of sceneFiles(scene)) checkImage(state, scene, file);
  }
  const demoNeedsCheck = !currentDemo(json(resolve(folder, "demo-check.json")), snapshot, chapterIds);
  if (demoNeedsCheck) add("stale-demo", "demo-check.json", "Run the complete demo check on the committed source");
  return { ok: issues.length === 0, issues, staleScenes: [...stale], demoNeedsCheck, aliases,
    checkedImages: scenes.reduce((sum, scene) => sum + sceneFiles(scene).length, 0) };
}
