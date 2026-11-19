// A task's security scans: the files its build changed since the build began (its own records left
// out: they are redacted, not scanned), scanned once beside the project checks. The result is kept in
// the task's runtime folder for the Verify page and written as lines under `## Checks`.

import { createHash } from "node:crypto"
import { join, relative } from "node:path"
import type { Ctx } from "../../../ctx.ts"
import { taskCommitDiff } from "../../git/task-diff.ts"
import { type WorkflowProjection, workflowChanges } from "../../git/workflow-changes.ts"
import { committedSource, type PartSource } from "../../git/workflow-parts.ts"
import { workingDirectory, workingSource } from "../../git/working-records.ts"
import type { Task } from "../../task/store.ts"
import { agentControlPaths, installScriptsChanged } from "./agent-controls.ts"
import { type ScanResult, scanChanges } from "./scan.ts"
import { scanSettings } from "./settings.ts"

export type TaskScans = { at: number; head: string; results: ScanResult[]; candidate?: string }

const recordPath = (task: Pick<Task, "runtimeDir">) => join(task.runtimeDir, "scans.json")

/**
 * The changed paths that steer an agent, a hook or CI, including a `package.json` whose install
 * scripts changed. Empty when nothing like that changed or git could not say.
 */
export async function agentControlChanges(ctx: Ctx, task: Task): Promise<string[]> {
  try {
    // Polls reuse the answer while the index and recorded edits still match.
    const head = await headOf(ctx, task)
    const kept = await readKept(ctx, task)
    if (head !== null && kept?.head === head) return kept.paths
    const changed = await changedByBuild(ctx, task)
    const found = agentControlPaths(changed.paths)
    for (const path of changed.paths.filter((p) => /(^|\/)package\.json$/.test(p))) {
      if (await ownedInstallChange(ctx, task, path, changed)) found.push(path)
    }
    // Kept for the steps after Verify, which read it instead of git.
    await ctx.fs.mkdir(task.runtimeDir)
    await ctx.fs.atomicWrite(controlsPath(task), `${JSON.stringify({ head, paths: found })}\n`)
    return found
  } catch {
    return []
  }
}

const controlsPath = (task: Pick<Task, "runtimeDir">) =>
  join(task.runtimeDir, "agent-controls.json")

async function indexChecksum(ctx: Ctx, path: string): Promise<string | null> {
  if (!ctx.fs.stat || !ctx.fs.readByteRange) return null
  try {
    const before = await ctx.fs.stat(path)
    if (!before || before.size < 32) return null
    // Git's SHA-1/SHA-256 checksum is in this bounded tail; skipHash indexes cannot be reused.
    const tail = await ctx.fs.readByteRange(path, Math.max(0, before.size - 64), 64)
    const after = await ctx.fs.stat(path)
    if (
      tail.length < 32 ||
      tail.subarray(-20).every((byte) => byte === 0) ||
      !after ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    )
      return null
    return tail.toString("hex")
  } catch {
    return null
  }
}

/**
 * HEAD, the index checksum and the task's records. An unreadable index disables reuse.
 */
async function headOf(ctx: Ctx, task: Task): Promise<string | null> {
  const run = await ctx.git.run(
    task.repoRoot,
    ["rev-parse", "--path-format=absolute", "--git-path", "index", "HEAD"],
    { maxOutputBytes: 8192 },
  )
  if (run.code !== 0) return null
  const [index, head] = run.stdout.trimEnd().split("\n")
  if (!index || !head) return null
  const checksum = await indexChecksum(ctx, index)
  if (checksum === null) return null
  const record = async (name: string) =>
    (await ctx.fs.exists(join(task.runtimeDir, name)))
      ? await ctx.fs.readFile(join(task.runtimeDir, name))
      : ""
  // The recorded working-tree edits count too: an AGENTS.md or hook edit made during Verify is read.
  const working = join(workingDirectory(ctx), "index.json")
  const edits = (await ctx.fs.exists(working)) ? await ctx.fs.readFile(working) : ""
  const records = `${await record("build-start.json")}\0${await record("slice-commits.json")}\0${edits}\0${index}\0${checksum}`
  return `${head}:${createHash("sha256").update(records).digest("hex").slice(0, 16)}`
}

/** The kept answer: `{ head, paths }`, or a bare list from before the head was kept. */
async function readKept(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<{ head: string | null; paths: string[] } | null> {
  try {
    const value: unknown = JSON.parse(await ctx.fs.readFile(controlsPath(task)))
    const strings = (list: unknown) =>
      Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : []
    if (Array.isArray(value)) return { head: null, paths: strings(value) }
    if (value === null || typeof value !== "object") return null
    const record = value as { head?: unknown; paths?: unknown }
    return {
      head: typeof record.head === "string" ? record.head : null,
      paths: strings(record.paths),
    }
  } catch {
    return null
  }
}

/** What Verify last found, without reading git; none before Verify ran. */
export async function keptAgentControls(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<string[]> {
  return (await readKept(ctx, task))?.paths ?? []
}

type BuildChanges = { paths: string[]; owned: WorkflowProjection }

/** The same owned commits and recorded edits as Files; untracked files remain outside Verify scans. */
async function changedByBuild(ctx: Ctx, task: Task): Promise<BuildChanges> {
  const committed = await taskCommitDiff(ctx, task)
  const owned = await workflowChanges(ctx, task, { metadata: true, current: false })
  const working = await ctx.git.run(task.repoRoot, ["diff", "--name-only", "-z", "HEAD", "--"])
  const tracked = new Set(working.code === 0 ? working.stdout.split("\0") : [])
  const recorded = owned.workingFiles.filter((path) => tracked.has(path))
  const own = relative(task.repoRoot, task.dir).replaceAll("\\", "/")
  return {
    paths: [...new Set([...(committed?.files ?? []), ...recorded])].filter(
      (path) => path !== "" && (own === "" || !path.startsWith(`${own}/`)),
    ),
    owned,
  }
}

/** Inspect only the owned package patch, not a foreign hook in the same checkout. */
async function ownedInstallChange(
  ctx: Ctx,
  task: Task,
  path: string,
  changed: BuildChanges,
): Promise<boolean> {
  try {
    const parts = changed.owned.files.find((file) => file.path === path)?.parts
    if (!parts?.length || parts.length > 256) return true
    let left = 4 * 1024 * 1024
    const read = async (source: PartSource | null) => {
      if (source === null) return null
      if (left <= 0) throw new Error("Package source budget exceeded")
      const text =
        source.kind === "working"
          ? await workingSource(ctx, source.hash, left)
          : await committedSource(ctx, task, source, left)
      left -= Buffer.byteLength(text)
      return text
    }
    for (const descriptor of parts) {
      const part = changed.owned.parts.get(descriptor.stamp)
      if (!part || part.unavailable) return true
      if (installScriptsChanged(await read(part.before), await read(part.after))) return true
    }
    return false
  } catch {
    // An owned package change with an unreadable patch cannot establish that its hooks are unchanged.
    return true
  }
}

/** Scans what the task changed and keeps the record; never throws, never fails the checks. */
export async function runTaskScans(ctx: Ctx, task: Task): Promise<TaskScans | null> {
  try {
    const settings = await scanSettings(ctx)
    const head = (await ctx.git.run(task.repoRoot, ["rev-parse", "HEAD"])).stdout.trim()
    const changed = await changedByBuild(ctx, task)
    const results = await scanChanges(ctx, task.repoRoot, changed.paths, {
      advisories: settings.advisories,
      off: !settings.enabled,
    })
    const record: TaskScans = { at: ctx.clock.now(), head, results }
    await ctx.fs.mkdir(task.runtimeDir)
    await ctx.fs.atomicWrite(recordPath(task), `${JSON.stringify(record, null, 2)}\n`)
    return record
  } catch {
    return null
  }
}

/** The last scans of the task, or null before any ran. */
export async function readTaskScans(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<TaskScans | null> {
  try {
    const value = JSON.parse(await ctx.fs.readFile(recordPath(task))) as TaskScans
    return Array.isArray(value.results) ? value : null
  } catch {
    return null
  }
}

/** A selected commit is reviewed in full and never replaces the previous task-slice scans. */
export async function candidateScans(
  ctx: Ctx,
  task: Task,
  candidate: { id: string; head: string },
): Promise<TaskScans> {
  const path = join(task.runtimeDir, `review-candidate-${candidate.id}-scans.json`)
  if (await ctx.fs.exists(path)) {
    const previous = JSON.parse(await ctx.fs.readFile(path)) as TaskScans
    if (previous.candidate === candidate.id && previous.head === candidate.head) return previous
    throw new Error("The saved candidate security receipt is invalid.")
  }
  const listed = await ctx.git.run(task.repoRoot, [
    "ls-files",
    "-z",
    "--",
    ".",
    ":(exclude)docs/plans/**",
  ])
  if (listed.code !== 0)
    throw new Error("Could not inventory the selected commit for security review.")
  const settings = await scanSettings(ctx)
  const results = await scanChanges(ctx, task.repoRoot, listed.stdout.split("\0").filter(Boolean), {
    advisories: settings.advisories,
    off: !settings.enabled,
  })
  const head = await ctx.git.run(task.repoRoot, ["rev-parse", "HEAD"], { fresh: true })
  if (head.code !== 0 || head.stdout.trim() !== candidate.head)
    throw new Error(
      "The selected commit moved during security checks. Choose the current candidate again.",
    )
  const record = { at: ctx.clock.now(), head: candidate.head, candidate: candidate.id, results }
  await ctx.fs.atomicWrite(path, `${JSON.stringify(record)}\n`, { mode: 0o600 })
  return record
}
