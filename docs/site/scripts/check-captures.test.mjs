import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureSource } from "./capture-source.mjs";
import { CAPTURE_SCENES, captureFiles, DESKTOP_HERO_FILES, DESKTOP_HERO_VIEWPORT, HERO_FILES, sceneFiles } from "./capture-scenes.mjs";
import { checkCaptures, refreshCaptures } from "./check-captures.mjs";
import { publishCaptures } from "./capture-publish.mjs";

const roots = [];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("capture publication", () => {
  it("keeps the last good images when a captured frame throws", async () => {
    const root = mkdtempSync(join(tmpdir(), "ql-media-publish-"));
    roots.push(root);
    const source = join(root, "draft.webp"), target = join(root, "published.webp");
    writeFileSync(source, "new pixels"); writeFileSync(target, "last good pixels");
    await expect(publishCaptures([{ source, target }], ["artifact frame: SecurityError"], () => {})).rejects.toThrow("SecurityError");
    expect(readFileSync(target, "utf8")).toBe("last good pixels");
  });

  it("keeps the last good images if source changed during capture", async () => {
    const root = mkdtempSync(join(tmpdir(), "ql-media-publish-"));
    roots.push(root);
    const source = join(root, "draft.webp"), target = join(root, "published.webp");
    writeFileSync(source, "new pixels"); writeFileSync(target, "last good pixels");
    await expect(publishCaptures([{ source, target }], [], () => { throw new Error("source changed"); })).rejects.toThrow("source changed");
    expect(readFileSync(target, "utf8")).toBe("last good pixels");
    await publishCaptures([{ source, target }], [], () => {});
    expect(readFileSync(target, "utf8")).toBe("new pixels");
  });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ql-release-media-"));
  roots.push(root);
  const put = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.test");
  git("config", "commit.gpgsign", "false");
  put("qualitylayer/src/ui/App.tsx", "export const app = 'current';");
  put("qualitylayer/package.json", JSON.stringify({ version: "12.9.0", dependencies: { react: "19.3.0" } }));
  put("docs/site/scripts/demo/story.mjs", "export const demo = 'approved story';");
  git("add", "."); git("commit", "-qm", "Capture inputs");
  const source = captureSource(root);
  const key = hash(JSON.stringify(source.sourceInputs));
  const images = captureFiles("plan").map(file => {
    const bytes = Buffer.from(`Fixture image ${file}`);
    put(`docs/site/public/product/${file}`, bytes);
    put(`docs/docusaurus/static/img/app/${file}`, bytes);
    return { file, sha256: hash(bytes), width: 100, height: 100, captureSource: key, frame: { padding: file.includes("-phone-") ? 12 : 24, border: 1, radius: file.includes("-phone-") ? 16 : 20, theme: file.endsWith("-dark.webp") ? "dark" : "light" } };
  });
  for (const file of HERO_FILES) {
    const bytes = Buffer.from(`Existing Hero scene ${file}`);
    put(`docs/site/public/hero/${file}`, bytes);
    images.push({ file, assetGroup: "hero", sha256: hash(bytes), width: 1456, height: 1552, captureSource: key,
      frame: { kind: "consumer", padding: 12, theme: file.endsWith("-dark.webp") ? "dark" : "light" } });
  }
  for (const file of DESKTOP_HERO_FILES) {
    const bytes = Buffer.from(`Desktop Hero ${file}`);
    put(`docs/site/public/hero/${file}`, bytes);
    images.push({ file, scene: "hero", assetGroup: "hero", capture: "desktop-hero", sha256: hash(bytes),
      width: 2664, height: 1904, sourceViewport: DESKTOP_HERO_VIEWPORT, captureSource: key,
      frame: { padding: 24, border: 1, radius: 20, theme: file.endsWith("-dark.webp") ? "dark" : "light" } });
  }
  put("docs/site/public/hero/desktop-capture.json", JSON.stringify({ capturedAt: "historical", purpose: "Original restored capture" }));
  const manifest = { ...source, sourceMode: "committed", captureSources: { [key]: source }, images };
  const manifestPath = "docs/site/public/product/capture-manifest.json";
  put(manifestPath, JSON.stringify(manifest));
  put("docs/site/public/product/demo-check.json", JSON.stringify({ ...source, status: "passed", mode: "private-source-build", chapters: ["intro"] }));
  const check = () => checkCaptures(root, { scenes: ["plan"], chapterIds: ["intro"] });
  return { root, put, git, source, manifest, manifestPath, check };
}

function capturedShape(file) {
  const phone = file.includes("-phone-"), theme = file.endsWith("-dark.webp") ? "dark" : "light";
  const shape = { width: 100, height: 100, frame: { padding: phone ? 12 : 24, border: 1, radius: phone ? 16 : 20, theme } };
  if (DESKTOP_HERO_FILES.includes(file)) return { ...shape, assetGroup: "hero", scene: "hero", capture: "desktop-hero",
    width: 2664, height: 1904, sourceViewport: DESKTOP_HERO_VIEWPORT };
  if (HERO_FILES.includes(file)) return { ...shape, assetGroup: "hero", frame: { kind: "consumer", padding: 12, theme } };
  return shape;
}

function capturedBatch(f, scenes) {
  const source = captureSource(f.root);
  const key = hash(JSON.stringify(source.sourceInputs));
  const manifest = JSON.parse(readFileSync(join(f.root, f.manifestPath), "utf8"));
  manifest.captureSources[key] = source;
  const images = new Map(manifest.images.map(image => [image.file, image]));
  for (const scene of scenes) for (const file of sceneFiles(scene)) {
    const bytes = Buffer.from(`Refreshed fixture ${file}`);
    const shape = capturedShape(file);
    f.put(`docs/site/public/${shape.assetGroup ?? "product"}/${file}`, bytes);
    images.set(file, { file, sha256: hash(bytes), captureSource: key, ...shape });
  }
  f.put(f.manifestPath, JSON.stringify({ ...manifest, images: [...images.values()] }));
}

describe("release media freshness", () => {
  it("catalogues the desktop Hero independently from the tour and phone consumer", () => {
    expect(captureFiles("hero")).toEqual(DESKTOP_HERO_FILES);
    expect(sceneFiles("plan").filter(file => DESKTOP_HERO_FILES.includes(file))).toEqual([]);
    const files = CAPTURE_SCENES.flatMap(sceneFiles);
    expect(new Set(files).size).toBe(files.length);
    expect(files).toEqual(expect.arrayContaining([...DESKTOP_HERO_FILES, ...HERO_FILES]));
    expect(DESKTOP_HERO_VIEWPORT).toEqual({ width: 1280, height: 900 });
  });

  it("rejects corrupted desktop Hero bytes separately from a current Plan tour", () => {
    const f = fixture();
    expect(checkCaptures(f.root, { scenes: ["hero"], chapterIds: ["intro"] }).ok).toBe(true);
    f.put("docs/site/public/hero/plan-desktop-dark.webp", "corrupted desktop Hero");
    const checked = checkCaptures(f.root, { scenes: ["hero"], chapterIds: ["intro"] });
    expect(checked.issues).toContainEqual(expect.objectContaining({ kind: "asset-bytes", file: "plan-desktop-dark.webp" }));
    expect(checked.staleScenes).toEqual(["hero"]);
    expect(f.check().ok).toBe(true);
  });

  it.each(["scene", "viewport", "padding", "producer"])("rejects an invalid desktop Hero %s", kind => {
    const f = fixture();
    const image = f.manifest.images.find(image => image.file === DESKTOP_HERO_FILES[0]);
    if (kind === "scene") image.scene = "plan";
    if (kind === "viewport") image.sourceViewport = { width: 1280, height: 780 };
    if (kind === "padding") image.frame.padding = 12;
    if (kind === "producer") image.captureSource = "missing-producer";
    f.put(f.manifestPath, JSON.stringify(f.manifest));
    expect(checkCaptures(f.root, { scenes: ["hero"], chapterIds: ["intro"] }).ok).toBe(false);
  });

  it("refreshes the Plan tour without altering desktop Hero bytes or historical provenance", async () => {
    const f = fixture();
    const path = "docs/site/public/hero/desktop-capture.json";
    const historical = readFileSync(join(f.root, path));
    const desktop = DESKTOP_HERO_FILES.map(file => readFileSync(join(f.root, "docs/site/public/hero", file)));
    const receipts = f.manifest.images.filter(image => DESKTOP_HERO_FILES.includes(image.file));
    f.put("docs/site/public/product/plan-light.webp", "stale tour");
    const calls = [];
    const result = await refreshCaptures(f.root, (_file, args) => {
      calls.push(args[1]); capturedBatch(f, args[1].split(","));
    }, { scenes: ["plan"], chapterIds: ["intro"] });
    expect(result.ok).toBe(true);
    expect(calls).toEqual(["plan"]);
    for (const [index, file] of DESKTOP_HERO_FILES.entries())
      expect(readFileSync(join(f.root, "docs/site/public/hero", file))).toEqual(desktop[index]);
    const published = JSON.parse(readFileSync(join(f.root, f.manifestPath), "utf8"));
    expect(published.images.filter(image => DESKTOP_HERO_FILES.includes(image.file))).toEqual(receipts);
    expect(readFileSync(join(f.root, path))).toEqual(historical);
  });

  it("refreshes all scenes in sequential four-scene child cohorts and retains per-image provenance", async () => {
    const f = fixture();
    rmSync(join(f.root, "docs/site/public/product/plan-light.webp"));
    rmSync(join(f.root, "docs/site/public/hero/plan-desktop-light.webp"));
    const calls = [];
    let active = 0, peak = 0;
    const result = await refreshCaptures(f.root, async (file, args) => {
      expect(file).toBe("website-screenshots.mjs");
      expect(args[0]).toBe("--only");
      const scenes = args[1].split(",");
      calls.push(scenes);
      active++; peak = Math.max(peak, active);
      await Promise.resolve();
      capturedBatch(f, scenes);
      active--;
    }, { chapterIds: ["intro"] });
    expect(calls).toEqual(Array.from({ length: Math.ceil(CAPTURE_SCENES.length / 4) }, (_, at) => CAPTURE_SCENES.slice(at * 4, at * 4 + 4)));
    expect(calls.flat()).toEqual(CAPTURE_SCENES);
    expect(peak).toBe(1);
    expect(result.ok).toBe(true);
    const published = JSON.parse(readFileSync(join(f.root, f.manifestPath), "utf8"));
    expect(published.images.every(image => published.captureSources[image.captureSource])).toBe(true);
    expect(readFileSync(join(f.root, "docs/docusaurus/static/img/app/plan-light.webp"))).toEqual(readFileSync(join(f.root, "docs/site/public/product/plan-light.webp")));
  });

  it("stops before later cohorts when a capture child fails", async () => {
    const f = fixture();
    rmSync(join(f.root, "docs/site/public/product/plan-light.webp"));
    rmSync(join(f.root, "docs/site/public/hero/plan-desktop-light.webp"));
    const calls = [];
    await expect(refreshCaptures(f.root, async (_file, args) => {
      calls.push(args[1].split(","));
      if (calls.length === 2) throw new Error("capture child failed");
      capturedBatch(f, calls[0]);
    }, { chapterIds: ["intro"] })).rejects.toThrow("capture child failed");
    expect(calls).toEqual([CAPTURE_SCENES.slice(0, 4), CAPTURE_SCENES.slice(4, 8)]);
  });

  it("refuses dirty capture inputs before starting any child cohort", async () => {
    const f = fixture();
    f.put("qualitylayer/src/ui/App.tsx", "uncommitted rendering change");
    const calls = [];
    await expect(refreshCaptures(f.root, async (...args) => calls.push(args), { chapterIds: ["intro"] })).rejects.toThrow("Commit capture inputs first");
    expect(calls).toEqual([]);
  });

  it("admits unchanged inputs without requiring the candidate and producer commits to match", () => {
    const f = fixture();
    f.put("backend.txt", "Backend-only fix"); f.git("add", "backend.txt"); f.git("commit", "-qm", "Backend fix");
    expect(captureSource(f.root).sourceCommit).not.toBe(f.source.sourceCommit);
    expect(f.check()).toMatchObject({ ok: true, staleScenes: [], demoNeedsCheck: false, checkedImages: 6 });
  });

  it("reuses original capture provenance after a version-only bump", () => {
    const f = fixture();
    f.put("qualitylayer/package.json", JSON.stringify({ version: "12.10.0", dependencies: { react: "19.3.0" } }));
    f.git("add", "qualitylayer/package.json"); f.git("commit", "-qm", "Version bump");
    expect(f.check().ok).toBe(true);
    expect(JSON.parse(readFileSync(join(f.root, f.manifestPath), "utf8")).sourceCommit).toBe(f.source.sourceCommit);
  });

  it.each(["qualitylayer/src/ui/App.tsx", "docs/site/scripts/demo/story.mjs", "qualitylayer/package.json"])("rejects changed UI, demo or dependency input: %s", path => {
    const f = fixture();
    f.put(path, path.endsWith("package.json") ? JSON.stringify({ version: "12.9.0", dependencies: { react: "20.0.0" } }) : "changed render input");
    f.git("add", path); f.git("commit", "-qm", "Changed input");
    expect(f.check()).toMatchObject({ ok: false, staleScenes: ["plan"], demoNeedsCheck: true });
  });

  it.each(["missing", "corrupt"])("rejects a %s canonical asset", kind => {
    const f = fixture(); const path = "docs/site/public/product/plan-light.webp";
    if (kind === "missing") rmSync(join(f.root, path)); else f.put(path, "not the captured bytes");
    expect(f.check().issues).toContainEqual(expect.objectContaining({ kind: "asset-bytes", file: "plan-light.webp" }));
  });
  it("includes the existing mobile Hero images outside the product folder", () => {
    const f = fixture();
    f.put("docs/site/public/hero/your-turn-light.webp", "old Hero");
    expect(f.check().issues).toContainEqual(expect.objectContaining({ kind: "asset-bytes", file: "your-turn-light.webp" }));
    expect(f.check().staleScenes).toEqual(["plan"]);
  });

  it("detects a missing referenced docs copy and a stale existing docs copy", () => {
    const f = fixture();
    f.put("docs/docusaurus/docs/plan.md", '<img src="/img/app/plan-light.webp" />');
    rmSync(join(f.root, "docs/docusaurus/static/img/app/plan-light.webp"));
    f.put("docs/docusaurus/static/img/app/plan-dark.webp", "old image");
    expect(f.check().aliases).toEqual(expect.arrayContaining([{ source: "plan-light.webp", target: "plan-light.webp" }, { source: "plan-dark.webp", target: "plan-dark.webp" }]));
  });

  it("rejects draft screenshots even if their current bytes and inputs match", () => {
    const f = fixture();
    f.manifest.sourceMode = "working-tree-snapshot";
    Object.values(f.manifest.captureSources)[0].sourceDirtyFiles = [" M qualitylayer/src/ui/App.tsx"];
    f.put(f.manifestPath, JSON.stringify(f.manifest));
    expect(f.check().issues.map(issue => issue.kind)).toEqual(expect.arrayContaining(["draft-manifest", "draft-source"]));
    expect(f.check().staleScenes).toEqual(["plan"]);
  });

  it.each(["failed", "partial", "source-observer"])("rejects %s demo evidence", kind => {
    const f = fixture();
    f.put("docs/site/public/product/demo-check.json", JSON.stringify({ ...f.source, status: kind === "failed" ? "failed" : "passed", mode: kind === "source-observer" ? kind : "private-source-build", chapters: kind === "partial" ? [] : ["intro"] }));
    expect(f.check()).toMatchObject({ ok: false, demoNeedsCheck: true });
  });

  it("rejects unsafe manifest names without reading them as assets", () => {
    const f = fixture();
    f.manifest.images.push({ file: "../outside.webp", sha256: "0".repeat(64) });
    f.put(f.manifestPath, JSON.stringify(f.manifest));
    expect(f.check().issues).toContainEqual(expect.objectContaining({ kind: "invalid-image", file: "../outside.webp" }));
  });

  it("repairs a stale docs copy without starting a capture or demo browser", async () => {
    const f = fixture();
    f.put("docs/docusaurus/static/img/app/plan-light.webp", "old copy");
    const result = await refreshCaptures(f.root, () => { throw new Error("No rendering is needed"); }, { scenes: ["plan"], chapterIds: ["intro"] });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(f.root, "docs/docusaurus/static/img/app/plan-light.webp"))).toEqual(readFileSync(join(f.root, "docs/site/public/product/plan-light.webp")));
  });

  it("replaces an unsafe docs symlink without writing through it", async () => {
    const f = fixture();
    const outside = `${f.root}-outside`;
    roots.push(outside); mkdirSync(outside); writeFileSync(join(outside, "keep.webp"), "keep these bytes");
    const alias = join(f.root, "docs/docusaurus/static/img/app/plan-light.webp");
    rmSync(alias); symlinkSync(join(outside, "keep.webp"), alias);
    const result = await refreshCaptures(f.root, () => { throw new Error("No rendering is needed"); }, { scenes: ["plan"], chapterIds: ["intro"] });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(outside, "keep.webp"), "utf8")).toBe("keep these bytes");
  });
});
