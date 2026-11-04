import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const INPUTS = [
  "qualitylayer/src/ui", "qualitylayer/src/workflow", "qualitylayer/src/core/conversation/types.ts",
  "qualitylayer/src/core/config.ts", "qualitylayer/src/core/config-values.ts", "qualitylayer/scripts/ui-dev.ts",
  "qualitylayer/package.json", "qualitylayer/bun.lock", "docs/site/package.json", "docs/site/package-lock.json",
  "docs/site/vite.config.ts", "docs/site/vite-plugin-cockpit.ts", "docs/site/app-demo/index.html", "docs/site/scripts/website-screenshots.mjs",
  "docs/site/scripts/capture-source.mjs", "docs/site/scripts/capture-scenes.mjs", "docs/site/scripts/capture-publish.mjs", "docs/site/scripts/demo",
];

/** Version labels alone do not change any of the approved screenshot scenes. */
export function appearanceInputs(repo, sourceInputs) {
  return Object.fromEntries(Object.entries(sourceInputs).map(([path, hash]) => {
    if (hash === null || !["qualitylayer/package.json", "docs/site/package.json"].includes(path)) return [path, hash];
    const data = JSON.parse(readFileSync(resolve(repo, path), "utf8"));
    delete data.version;
    return [path, createHash("sha256").update(JSON.stringify(data)).digest("hex")];
  }));
}

export function captureSource(repo, { review = false } = {}) {
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trimEnd();
  const sourceDirtyFiles = git("status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames", "--", ...INPUTS).split("\0").filter(Boolean);
  if (!review && sourceDirtyFiles.length) throw new Error("Publishable screenshots require committed App UI, fixtures and capture inputs. Commit those changes first, or use --output-dir for review captures.");
  const paths = git("ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...INPUTS).split("\0").filter(Boolean).sort();
  // A tracked file deleted in the working tree is an input too: a review capture records it as gone.
  const sourceInputs = Object.fromEntries(paths.map(path => [path, existsSync(resolve(repo, path)) ? createHash("sha256").update(readFileSync(resolve(repo, path))).digest("hex") : null]));
  return { sourceCommit: git("rev-parse", "HEAD"), sourceTree: git("rev-parse", "HEAD^{tree}"), sourceInputs, appearanceInputs: appearanceInputs(repo, sourceInputs), sourceDirtyFiles };
}

export function assertSameSource(before, after) {
  if (before.sourceCommit !== after.sourceCommit || JSON.stringify(before.sourceInputs) !== JSON.stringify(after.sourceInputs)) throw new Error("App capture inputs changed during the run. Keep the capture source fixed and rerun.");
}
