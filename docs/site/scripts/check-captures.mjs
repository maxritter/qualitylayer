import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { assetHash, checkCaptures, inside } from "./capture-evidence.mjs";

export { checkCaptures } from "./capture-evidence.mjs";

const CAPTURE_BATCH_SIZE = 4;

async function copyAlias(repo, alias) {
  const source = resolve(repo, "docs/site/public/product", alias.source);
  const target = resolve(repo, "docs/docusaurus/static/img/app", alias.target);
  let existing = dirname(target);
  while (!existsSync(existing)) existing = dirname(existing);
  if (!inside(repo, existing) || assetHash(repo, dirname(source), alias.source) === null) throw new Error("Media copy must stay inside the repository");
  await mkdir(dirname(target), { recursive: true });
  if (!inside(repo, dirname(target))) throw new Error("Docs media folder must stay inside the repository");
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, readFileSync(source), { flag: "wx" });
  await rename(temporary, target);
}

export async function refreshCaptures(repo, run = (file, args) => {
  const child = spawnSync(process.execPath, [resolve(repo, "docs/site/scripts", file), ...args], { cwd: resolve(repo, "docs/site"), stdio: "inherit" });
  if (child.status !== 0) throw new Error(`${file} failed (${child.status ?? child.signal})`);
}, options = {}) {
  let state = checkCaptures(repo, options);
  if (state.issues.some(issue => issue.kind === "dirty-source")) throw new Error("Commit capture inputs first; use screenshots --output-dir for drafts");
  for (let at = 0; at < state.staleScenes.length; at += CAPTURE_BATCH_SIZE) {
    const scenes = state.staleScenes.slice(at, at + CAPTURE_BATCH_SIZE);
    await run("website-screenshots.mjs", ["--only", scenes.join(",")]);
  }
  state = checkCaptures(repo, options);
  for (const alias of state.aliases) await copyAlias(repo, alias);
  if (state.demoNeedsCheck) await run("demo/present.mjs", ["--check"]);
  return checkCaptures(repo, options);
}

function printStatus(result) {
  const groups = new Map();
  for (const issue of result.issues) groups.set(issue.kind, [...(groups.get(issue.kind) ?? []), issue]);
  for (const [kind, issues] of groups) {
    const files = issues.slice(0, 3).map(issue => issue.file || "capture inputs").join(", ");
    console.error(`${kind}: ${issues.length} issue(s); ${files}${issues.length > 3 ? ", …" : ""}. ${issues[0].message}`);
  }
  console.log(result.ok ? `Release media is current (${result.checkedImages} images and the complete demo)` : "Release media needs refresh: cd docs/site && npm run media:refresh");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  try {
    const result = process.argv.includes("--refresh") ? await refreshCaptures(repo) : checkCaptures(repo);
    if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
    else printStatus(result);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
