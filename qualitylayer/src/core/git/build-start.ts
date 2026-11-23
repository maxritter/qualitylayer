// What the checkout held when the build started, recorded by the first `next` into Implement: the
// paths git reported as changed and what each held, so `commit slice` can tell the build's own
// edits from work that was there before it, and what was staged then. A large staged baseline (a
// base copy *Before the build* made) is committed first, on its own: `commit slice` keeps staged
// edits out of a slice's commit and cannot tell them from the slice's hunks in the same file.

import { join, relative, sep } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { allTasks, type Outline } from "../docs/outline.ts"
import type { Task } from "../task/store.ts"
import { covers, stagedPaths, startBlobs, workState } from "./slice-commit.ts"

export {
  COMMIT_ALIAS_HINT,
  canonicalizeSliceCommits,
  recordSliceCommit,
  removeDuplicateSliceCommits,
  sliceCommits,
} from "./build-start-receipts.ts"

export type BuildStart = {
  at: number
  /** Commits after this ancestor can consume a dirty baseline before a later slice edits it. */
  head?: string
  /** Every path git reported as changed, with what it held (see `workState`). */
  state: Record<string, string>
  /** The content of each tracked file that was already changed then, as stored blobs (`startBlobs`). */
  blobs?: Record<string, string>
  /** The paths staged then, the task's own plan folder left out. */
  staged: string[]
  /** Files the task cards named when this exact dirty baseline was captured (absent before the cards). */
  approvedFiles?: string[]
}

const startPath = (task: Pick<Task, "runtimeDir">) => join(task.runtimeDir, "build-start.json")

/** The task's plan folder, as git names paths below it. */
export const planFolder = (task: Pick<Task, "repoRoot" | "dir">): string =>
  `${relative(task.repoRoot, task.dir).split(sep).join("/")}/`

/** Record what the checkout holds as the build starts; null when git cannot say. */
export async function recordBuildStart(
  ctx: Ctx,
  task: Task,
  approvedFiles?: string[],
): Promise<BuildStart | null> {
  const head = await ctx.git.run(task.repoRoot, ["rev-parse", "HEAD"])
  const state = await workState(task.repoRoot)
  const staged = await stagedPaths(task.repoRoot)
  if (state === null || staged === null) return null
  const own = planFolder(task)
  const start: BuildStart = {
    at: ctx.clock.now(),
    ...(head.code === 0 ? { head: head.stdout.trim() } : {}),
    state: Object.fromEntries(state),
    blobs: await startBlobs(
      task.repoRoot,
      [...state.keys()].filter((path) => !path.startsWith(own)),
    ),
    staged: staged.filter((path) => !path.startsWith(own)),
    ...(approvedFiles ? { approvedFiles: [...new Set(approvedFiles)].sort() } : {}),
  }
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(startPath(task), `${JSON.stringify(start)}\n`)
  return start
}

export async function readBuildStart(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<BuildStart | null> {
  try {
    return JSON.parse(await ctx.fs.readFile(startPath(task))) as BuildStart
  } catch {
    return null
  }
}

const committedPath = (task: Pick<Task, "runtimeDir">) =>
  join(task.runtimeDir, "committed-slices.json")

/**
 * The slices whose `commit slice` succeeded, by number: a slice not among them still owns the files
 * its cards name, a committed one no longer does (another slice may change them again).
 */
export async function committedSlices(ctx: Ctx, task: Pick<Task, "runtimeDir">): Promise<number[]> {
  try {
    const parsed = JSON.parse(await ctx.fs.readFile(committedPath(task))) as unknown
    if (
      !Array.isArray(parsed) ||
      !parsed.every((n): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0)
    )
      return []
    return [...new Set(parsed)]
  } catch {
    return []
  }
}

const blockedPath = (task: Pick<Task, "runtimeDir">) =>
  join(task.runtimeDir, "commit-blocked-slices.json")

export type CommitBlock = {
  at: number
  reason: string
  attempt?: number
  failure?: "hook"
  detail?: string
  truncated?: true
}

/** Why a slice could not be committed cleanly, by slice number: its commit is carried, never a stop. */
export async function commitBlockedSlices(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<Record<number, CommitBlock>> {
  try {
    const parsed = JSON.parse(await ctx.fs.readFile(blockedPath(task))) as unknown
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<number, CommitBlock>)
      : {}
  } catch {
    return {}
  }
}

async function writeBlocked(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  blocked: Record<number, CommitBlock>,
): Promise<void> {
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(blockedPath(task), `${JSON.stringify(blocked)}\n`)
}

/** `commit slice` refused or failed for these slices: the build goes on, the commit is carried. */
export async function recordCommitBlocked(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  slices: number[],
  reason: string,
  failure?: "hook",
): Promise<void> {
  const blocked = await commitBlockedSlices(ctx, task)
  const bytes = new TextEncoder().encode(reason)
  const detail = new TextDecoder().decode(bytes.subarray(0, 32 * 1024), { stream: true })
  for (const n of slices) {
    const before = blocked[n]?.attempt
    const attempt =
      typeof before === "number" &&
      Number.isSafeInteger(before) &&
      before >= 0 &&
      before < Number.MAX_SAFE_INTEGER
        ? before + 1
        : 1
    blocked[n] = {
      at: ctx.clock.now(),
      reason: reason.slice(0, 400),
      attempt,
      ...(failure === undefined
        ? {}
        : { failure, detail, ...(bytes.length > 32 * 1024 ? { truncated: true as const } : {}) }),
    }
  }
  await writeBlocked(ctx, task, blocked)
}

export async function recordCommittedSlice(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  n: number,
): Promise<void> {
  const blocked = await commitBlockedSlices(ctx, task)
  if (blocked[n] !== undefined) {
    delete blocked[n]
    await writeBlocked(ctx, task, blocked)
  }
  const all = await committedSlices(ctx, task)
  if (all.includes(n)) return
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(
    committedPath(task),
    `${JSON.stringify([...all, n].sort((a, b) => a - b))}\n`,
  )
}

/** A staged baseline this large is committed before the first slice, whatever its files are. */
export const LARGE_STAGED = 20

export type StagedBaseline = { files: number; named_by_cards: string[] }

/** The work staged when the build started, when it is large or a card's file is in it; else null. */
export function stagedBaseline(start: BuildStart, outline: Outline): StagedBaseline | null {
  const files = allTasks(outline).flatMap((t) => t.files)
  const named = start.staged.filter((path) => files.some((file) => covers(file, path))).sort()
  if (start.staged.length < LARGE_STAGED && named.length === 0) return null
  return { files: start.staged.length, named_by_cards: named }
}

/** The build's first reply with the staged baseline named first and listed as `staged_before_build`. */
export function withStagedBaseline<P extends Record<string, unknown>>(
  payload: P,
  found: StagedBaseline | null,
): P {
  if (found === null) return payload
  const rest = typeof payload.instructions === "string" ? payload.instructions : ""
  return {
    ...payload,
    staged_before_build: found,
    instructions: [stagedBaselineText(found), rest].filter((part) => part !== "").join("\n\n"),
  }
}

/** What the session is told about a staged baseline, first thing in the build's first reply. */
export function stagedBaselineText(found: StagedBaseline): string {
  const shown = found.named_by_cards.slice(0, 5).map((path) => `\`${path}\``)
  const more = found.named_by_cards.length - shown.length
  const named =
    found.named_by_cards.length > 0
      ? `, ${found.named_by_cards.length} of them files the Plan's cards change (${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""})`
      : ""
  return (
    `**${found.files} file${found.files === 1 ? " is" : "s are"} staged and not committed**, from before the build${named}. ` +
    "`qualitylayer commit slice N` keeps staged edits out of each slice's commit, and where a slice changes a staged file it cannot tell the two apart. " +
    "When they are the build's own groundwork (what *Before the build* set up, a base copy), commit them first, on their own, before any slice: " +
    '`git commit -m "<what they are>"`. Staged work that is someone else\'s stays theirs: leave it, and note it as a `- Baseline:` line.'
  )
}
