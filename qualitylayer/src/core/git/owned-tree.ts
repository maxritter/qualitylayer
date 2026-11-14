import { createHash } from "node:crypto"
import { isAbsolute, join, win32 } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { allTasks, parseOutline } from "../docs/outline.ts"
import { cardsPath, readCardsText } from "../docs/outline-files.ts"
import { readmeFrontmatter, type Task } from "../task/store.ts"
import { mapBounded } from "./bounded.ts"
import { COMMIT_ALIAS_HINT, sliceCommits } from "./build-start.ts"
import { revisionPaths } from "./revision-paths.ts"
import { ownEdits } from "./session-edits.ts"

type Entry = { mode: string; object: string }
export type OwnedTree = {
  pin: string
  head: string
  current: string
  recorded: string
  delta: { path: string; before?: Entry; after?: Entry }[]
  externalPlanned: string[]
}
const full = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
/** How many characters of pathspecs one git call takes: Windows refuses a command line past 32,767 in all. */
const COMMAND_LINE_PATHS = 20_000
const cache = new WeakMap<Ctx["git"], Map<string, string>>()
const digest = (text: string) => createHash("sha256").update(text).digest("hex")
function requireTree(value: unknown): asserts value {
  if (!value) throw Error("Committed task-owned source authority is unavailable")
}
async function git(
  ctx: Ctx,
  task: Task,
  args: string[],
  immutable = false,
  fresh = false,
): Promise<string> {
  const key = JSON.stringify([task.repoRoot, args])
  const kept = cache.get(ctx.git) ?? new Map<string, string>()
  cache.set(ctx.git, kept)
  const known = immutable && !fresh ? kept.get(key) : undefined
  if (known !== undefined) return known
  const result = fresh
    ? await ctx.git.run(task.repoRoot, args, { fresh: true })
    : await ctx.git.run(task.repoRoot, args)
  // Name the git call that left the authority unavailable: the message alone says nothing of which.
  if (result.code !== 0)
    throw Error(
      `Committed task-owned source authority is unavailable (git ${args.slice(0, 2).join(" ")} exited ${result.code}: ${(result.stderr ?? "").split("\n")[0]?.slice(0, 160)})`,
    )
  if (Buffer.byteLength(result.stdout) > 1024 * 1024)
    throw Error(
      `Committed task-owned source authority is unavailable (git ${args.slice(0, 2).join(" ")} printed more than 1 MB)`,
    )
  if (immutable && !fresh) {
    if (kept.size >= 16) kept.delete(kept.keys().next().value as string)
    kept.set(key, result.stdout)
  }
  return result.stdout
}
async function commit(ctx: Ctx, task: Task, value: string): Promise<string> {
  requireTree(/^[a-f0-9]{7,64}$/.test(value))
  if (full.test(value)) return value
  const resolved = (await git(ctx, task, ["rev-parse", "--verify", `${value}^{commit}`])).trim()
  requireTree(full.test(resolved))
  return resolved
}
/** Bounded literal-path entries at one Git revision; callers may request a fresh authority read. */
export async function treeEntriesAt(
  ctx: Ctx,
  task: Task,
  sha: string,
  paths: readonly string[],
  options: { fresh?: true } = {},
): Promise<Map<string, Entry>> {
  requireTree(paths.length <= 4096 && Buffer.byteLength(JSON.stringify(paths)) <= 256 * 1024)
  if (paths.length === 0) return new Map<string, Entry>()
  // A command line holds only so much (Windows: 32,767 characters). The paths go to git in as
  // many calls as it takes; their rows are disjoint, and are put back in git's single-call order.
  const groups: string[][] = [[]]
  let used = 0
  for (const path of paths) {
    const spec = `:(literal)${path}`
    if (used + spec.length + 3 > COMMAND_LINE_PATHS && (groups.at(-1)?.length ?? 0) > 0) {
      groups.push([])
      used = 0
    }
    groups.at(-1)?.push(spec)
    used += spec.length + 3
  }
  const rows: string[] = []
  for (const group of groups)
    rows.push(
      ...(
        await git(
          ctx,
          task,
          ["ls-tree", "-r", "-z", "--full-tree", sha, "--", ...group],
          true,
          options.fresh === true,
        )
      )
        .split("\0")
        .filter(Boolean),
    )
  if (groups.length > 1)
    rows.sort((a, b) =>
      Buffer.compare(
        Buffer.from(a.slice(a.indexOf("\t") + 1)),
        Buffer.from(b.slice(b.indexOf("\t") + 1)),
      ),
    )
  const entries = new Map<string, Entry>()
  for (const row of rows) {
    const at = row.indexOf("\t")
    requireTree(at > 0)
    const [mode, kind, object] = row.slice(0, at).split(" ")
    const path = row.slice(at + 1)
    requireTree(mode && object && full.test(object) && ["blob", "commit"].includes(kind ?? ""))
    if (!path.startsWith("docs/plans/")) {
      requireTree(entries.size < 16_384)
      entries.set(path, { mode, object })
    }
  }
  return entries
}
export async function ownedTree(
  ctx: Ctx,
  task: Task,
  supplied?: string[],
): Promise<OwnedTree | null> {
  const raw = supplied ?? (await sliceCommits(ctx, task))
  if (!raw.length) return null
  await ctx.fs.assertSafeDirectory?.(task.runtimeDir)
  const receipt = join(task.runtimeDir, "slice-commits.json")
  requireTree((await ctx.fs.lstat?.(receipt))?.kind === "file")
  requireTree(((await ctx.fs.stat?.(receipt))?.size ?? 0) <= 64 * 1024)
  requireTree(raw.length <= 512)
  const commits = await mapBounded(raw, (value) => commit(ctx, task, value))
  if (new Set(commits).size !== commits.length) throw new Error(COMMIT_ALIAS_HINT)
  const objects = [...commits]
  if (typeof task.dir === "string") {
    const fm = await readmeFrontmatter(ctx, task)
    requireTree(typeof fm.base === "string")
    const base = await commit(ctx, task, fm.base)
    if (!objects.includes(base)) objects.push(base)
  }
  const available = (await git(ctx, task, ["rev-list", "--no-walk=unsorted", ...objects]))
    .trim()
    .split("\n")
  requireTree(
    available.length === objects.length && objects.every((sha) => available.includes(sha)),
  )
  const pin = commits.at(-1) as string
  const head = (await git(ctx, task, ["rev-parse", "--verify", "HEAD^{commit}"])).trim()
  requireTree(full.test(head))
  const changed = await git(ctx, task, ["show", "--name-only", "--format=", "-z", ...commits], true)
  const outline = typeof task.dir === "string" ? cardsPath(task.dir) : null
  let planned: string[] = []
  if (outline && task.dir && (await ctx.fs.exists(outline))) {
    requireTree(((await ctx.fs.stat?.(outline))?.size ?? 0) <= 2 * 1024 * 1024)
    const cards = await readCardsText(ctx, task.dir)
    requireTree(Buffer.byteLength(cards) <= 2 * 1024 * 1024)
    planned = allTasks(parseOutline(cards)).flatMap((card) => card.files)
  }
  const edits =
    typeof task.repoId === "string" && typeof task.slug === "string"
      ? await ownEdits(ctx, { id: task.repoId, root: task.repoRoot }, task.slug)
      : []
  const recordedPaths = [...changed.split("\0").filter(Boolean), ...edits]
  requireTree(
    recordedPaths.every(
      (path) =>
        !path.includes("\0") &&
        !isAbsolute(path) &&
        !win32.isAbsolute(path) &&
        !path.split(/[\\/]/).includes(".."),
    ),
  )
  const scope = revisionPaths(task.repoRoot, planned)
  const paths = [...new Set([...scope.local, ...recordedPaths])]
    .filter((path) => path && !path.startsWith("docs/plans/"))
    .sort()
  requireTree(
    paths.length + scope.external.length > 0 &&
      paths.length + scope.external.length <= 4096 &&
      Buffer.byteLength(JSON.stringify([paths, scope.external])) <= 256 * 1024,
  )
  const before = await treeEntriesAt(ctx, task, pin, paths)
  const after = head === pin ? before : await treeEntriesAt(ctx, task, head, paths)
  const delta = [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .filter((path) => JSON.stringify(before.get(path)) !== JSON.stringify(after.get(path)))
    .map((path) => ({ path, before: before.get(path), after: after.get(path) }))
  return {
    pin,
    head,
    current: digest(JSON.stringify([...after])),
    recorded: digest(JSON.stringify([...before])),
    delta,
    externalPlanned: scope.external,
  }
}
/** Committed task files moved by a commit no slice recorded, such as another session's. */
export class OwnedTreeMoved extends Error {}

export async function requireOwnedTreeCurrent(
  ctx: Ctx,
  task: Task,
  commits?: string[],
): Promise<OwnedTree> {
  const state = await ownedTree(ctx, task, commits)
  requireTree(state)
  if (state.externalPlanned.length)
    throw new Error(
      `Committed task-owned source authority is unavailable for external planned inputs (${state.externalPlanned.slice(0, 8).join(", ")}). They are bound only as external file bytes, not committed checkout source. Use supported working-tree verification where available, or move the build's owned files into one repository before requesting recorded-tree proof. No external commit authority was adopted.`,
    )
  const ancestry = await ctx.git.run(task.repoRoot, [
    "merge-base",
    "--is-ancestor",
    state.pin,
    state.head,
  ])
  requireTree(ancestry.code === 0)
  if (state.delta.length)
    throw new OwnedTreeMoved(
      `Committed task-owned source differs from its recorded commit (${state.delta
        .slice(0, 8)
        .map((row) => row.path)
        .join(
          ", ",
        )}). Inspect each actual commit, then register its full SHA: a slice's with qualitylayer commit slice <n> --commit <fullsha>, a fix's with qualitylayer commit fix --commit <fullsha>. Add any new files to the relevant card first. No commit was adopted.`,
    )
  return state
}
