// Where the build's change is measured from. The task's README records the commit the build
// started on (`base`) and the branch it came from (`base_ref`, the repository's main line). The
// person may rebase the build onto a newer main line, or merge it in, at any time before Review:
// then the build starts where HEAD and that branch now meet, not at the recorded commit, so other
// people's commits never count as the build's. The build's commits are read along the first
// parent, without merges, for the same reason. QualityLayer stores no commit hash of the build
// itself: everything is read from git each time.

import type { Ctx } from "../../ctx.ts"
import { readmeFrontmatter, type Task } from "../task/store.ts"

/** `git log` options that list only the build's own commits: a merged main line is not one. */
export const BUILD_COMMITS = ["--first-parent", "--no-merges"]

/** The branches a repository's main line goes by, in the order they are tried. */
const MAIN_LINES = ["main", "master", "trunk", "dev", "develop"]

async function out(ctx: Ctx, cwd: string, args: string[]): Promise<string | null> {
  const result = await ctx.git.run(cwd, args)
  return result.code === 0 && result.stdout.trim() !== "" ? result.stdout.trim() : null
}

const isAncestor = async (ctx: Ctx, cwd: string, older: string, newer: string) =>
  (await ctx.git.run(cwd, ["merge-base", "--is-ancestor", older, newer])).code === 0

/** Workflow-record commits carry no new source, including on a main-line or recorded-base ref. */
async function sourceAnchor(ctx: Ctx, cwd: string, ref: string): Promise<string | null> {
  const found = await ctx.git.run(cwd, [
    "rev-list",
    "--first-parent",
    "--max-count=1",
    ref,
    "--",
    ".",
    ":(exclude)docs/plans/**",
  ])
  if (found.code !== 0) return null
  const source = found.stdout.trim()
  if (source !== "") return source
  // An all-record history has a stable first-parent root, never the moving metadata HEAD.
  return out(ctx, cwd, ["rev-list", "--first-parent", "--max-parents=0", "--max-count=1", ref])
}

/** The repository's main line, as a local branch name: what a build branches from. */
export async function mainLine(ctx: Ctx, cwd: string): Promise<string | null> {
  const remote = await out(ctx, cwd, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ])
  if (remote !== null) return remote.replace(/^origin\//, "")
  for (const name of MAIN_LINES)
    for (const ref of [`refs/heads/${name}`, `refs/remotes/origin/${name}`])
      if ((await out(ctx, cwd, ["rev-parse", "--verify", "--quiet", ref])) !== null) return name
  return null
}

/**
 * Where HEAD meets the main line now: of `ref` and its `origin/` copy (a local main line may lag
 * behind what was fetched), the newest meeting point. A branch that already holds HEAD (the build
 * runs on it, or it was merged there) says nothing about where the build began, and is skipped.
 */
async function meetingPoint(
  ctx: Ctx,
  cwd: string,
  ref: string,
  target: string,
): Promise<string | null> {
  const head = await sourceAnchor(ctx, cwd, target)
  if (head === null) return null
  const candidates = ref.includes("/") ? [ref] : [ref, `origin/${ref}`]
  const points: string[] = []
  for (const candidate of candidates) {
    const commit = await out(ctx, cwd, [
      "rev-parse",
      "--verify",
      "--quiet",
      `${candidate}^{commit}`,
    ])
    if (commit === null) continue
    const source = await sourceAnchor(ctx, cwd, commit)
    if (source === null || (await isAncestor(ctx, cwd, head, source))) continue
    const point = await out(ctx, cwd, ["merge-base", head, source])
    if (point !== null) points.push(point)
  }
  let newest: string | null = null
  for (const point of points)
    if (newest === null || (await isAncestor(ctx, cwd, newest, point))) newest = point
  return newest
}

/**
 * The commit the build's change is measured from: the recorded commit while the main line has not
 * been brought into the build, else where HEAD and the main line now meet. Null when there is
 * neither.
 */
export async function effectiveBase(
  ctx: Ctx,
  cwd: string,
  recorded: { base?: unknown; base_ref?: unknown },
  target = "HEAD",
): Promise<string | null> {
  const sha =
    typeof recorded.base === "string" &&
    recorded.base !== "" &&
    (await ctx.git.run(cwd, ["cat-file", "-e", `${recorded.base}^{commit}`])).code === 0
      ? await sourceAnchor(ctx, cwd, recorded.base)
      : null
  const ref =
    typeof recorded.base_ref === "string" && recorded.base_ref !== ""
      ? recorded.base_ref
      : await mainLine(ctx, cwd)
  const point = ref !== null ? await meetingPoint(ctx, cwd, ref, target) : null
  if (sha === null) return point
  if (point === null) return sha
  // The main line moved and was brought in (a rebase or a merge) only when its meeting point is
  // past the recorded commit.
  return (await isAncestor(ctx, cwd, point, sha)) ? sha : point
}

/** The effective base of a task's build, read from its README. */
export async function buildBase(ctx: Ctx, task: Task): Promise<string | null> {
  return effectiveBase(ctx, task.repoRoot, await readmeFrontmatter(ctx, task))
}
