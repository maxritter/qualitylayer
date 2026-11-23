// QualityLayer creates a branch only on the person's click (the start
// card, or `qualitylayer branch new`), never on its own. It never switches a branch otherwise,
// merges one, creates, moves or removes a worktree, or pushes. The branch and the worktree are the
// user's choice, made before planning or the build.

import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { patchReadme, readmeFrontmatter, type Task } from "../task/store.ts"
import { mainLine } from "./base.ts"
import { currentBranch, headSha } from "./repo.ts"

function gitFailed(what: string, stderr: string): Result<never> {
  return err({ code: "bad_args", message: `${what}: ${stderr.trim() || "git failed"}` })
}

/**
 * Where the work happens: the branch checked out now (null when HEAD is detached), the commit the
 * change is measured from, and the main line it came from (`base_ref`), so a build rebased onto a
 * newer main line, or with it merged in, is still measured from where it meets it. Nothing is
 * switched.
 */
export async function recordCheckout(
  ctx: Ctx,
  task: Pick<Task, "repoRoot">,
): Promise<{ branch: string | null; base: string | null; base_ref?: string }> {
  const ref = await mainLine(ctx, task.repoRoot)
  return {
    branch: await currentBranch(ctx, task.repoRoot),
    base: await headSha(ctx, task.repoRoot),
    ...(ref !== null ? { base_ref: ref } : {}),
  }
}

/** The branch a build is suggested to start on: the task's slug without its date, under `ql/`. */
export const suggestedBranch = (task: Pick<Task, "slug">): string =>
  `ql/${task.slug.replace(/^\d{4}-\d{2}-\d{2}-/, "")}`

/** The branch a pull request goes into: the one the task came from, else the repository's main line. */
async function baseOf(ctx: Ctx, task: Pick<Task, "repoRoot" | "dir">) {
  const recorded = (await readmeFrontmatter(ctx, task)).base_ref
  return typeof recorded === "string" && recorded !== ""
    ? recorded
    : await mainLine(ctx, task.repoRoot)
}

/**
 * Whether the task's work is on the branch a pull request goes into: the task's recorded branch,
 * else the one checked out. A pull request cannot be opened from there, and Approve would push it.
 */
export async function onBaseBranch(
  ctx: Ctx,
  task: Pick<Task, "repoRoot" | "dir" | "branch">,
): Promise<boolean> {
  return (await baseWhenOn(ctx, task)) !== null
}

/** The base branch's name when the task's work is on it, else null: what a refusal names. */
export async function baseWhenOn(
  ctx: Ctx,
  task: Pick<Task, "repoRoot" | "dir" | "branch">,
): Promise<string | null> {
  const base = await baseOf(ctx, task)
  if (base === null) return null
  return (task.branch ?? (await currentBranch(ctx, task.repoRoot))) === base ? base : null
}

/** What the start card's *Lands on* row reads from git. */
export type BranchState = {
  /** The branch checked out now; null when HEAD is detached or there is no checkout. */
  branch: string | null
  /** The branch the pull request will go into; null when the repository has no main line. */
  base: string | null
  onBase: boolean
  /** The name the card offers for a new branch. */
  suggested: string
}

export async function branchState(
  ctx: Ctx,
  task: Pick<Task, "repoRoot" | "dir" | "slug">,
): Promise<BranchState> {
  const branch = (await ctx.fs.exists(task.repoRoot))
    ? await currentBranch(ctx, task.repoRoot)
    : null
  const base = await baseOf(ctx, task)
  return {
    branch,
    base,
    onBase: branch !== null && branch === base,
    suggested: suggestedBranch(task),
  }
}

/** Why the approval cannot open a pull request from the base branch, and what the person runs instead. */
export function baseBranchRefusal(
  task: Pick<Task, "slug">,
  base: string,
): { reason: string; commands: string[]; message: string } {
  const name = suggestedBranch(task)
  const commands = [`git switch -c ${name}`, `git push -u origin ${name}`]
  const reason = `This task is on ${base}, the branch a pull request goes into, so there is no branch to open one from`
  return {
    reason,
    commands,
    message: `${reason}. Approve would push ${base} itself. Run \`${commands[0]}\` to put the work on a branch, push it with \`${commands[1]}\`, and open the pull request yourself, or choose Approve only.`,
  }
}

const BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/
/** The steps before the build runs: after them the branch is no longer the person's to pick here. */
const BEFORE_BUILD = new Set(["plan", "implement"])

async function validateNewBranch(
  ctx: Ctx,
  task: Pick<Task, "repoRoot" | "stage" | "branch">,
  name: string,
): Promise<string | null> {
  if (!BEFORE_BUILD.has(task.stage))
    return `The build has already started${task.branch !== undefined ? ` on ${task.branch}` : ""}; its branch is chosen before it.`
  const notAName = `"${name}" is not a name git takes for a branch. Use letters, digits, dots, dashes and slashes.`
  if (!BRANCH_NAME.test(name)) return notAName
  if (!(await ctx.fs.exists(task.repoRoot)))
    return `There is no checkout at ${task.repoRoot} to start a branch in.`
  const valid = await ctx.git.run(task.repoRoot, ["check-ref-format", "--branch", name])
  if (valid.code !== 0) return notAName
  const exists = await ctx.git.run(task.repoRoot, [
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${name}`,
  ])
  return exists.code === 0
    ? `A branch named ${name} already exists. Pick another name: qualitylayer branch new <name>.`
    : null
}

/**
 * Create the branch the build lands on and switch the checkout to it, on the person's click or
 * `qualitylayer branch new`. Work in progress comes along (git carries it); the task's `branch` is
 * recorded so the approval's guards read the new one. A name that exists, one git cannot use, a
 * missing checkout and git's own refusal each come back with the reason and change nothing.
 */
export async function createBranch(
  ctx: Ctx,
  task: Pick<Task, "repoRoot" | "dir" | "slug" | "stage" | "branch">,
  name: string = suggestedBranch(task),
): Promise<Result<{ branch: string; from: string | null }>> {
  const refusal = await validateNewBranch(ctx, task, name)
  if (refusal !== null) return err({ code: "bad_args", message: refusal })
  const from = await currentBranch(ctx, task.repoRoot)
  const switched = await ctx.git.run(task.repoRoot, ["switch", "--quiet", "-c", name])
  if (switched.code !== 0) return gitFailed("cannot start the branch", switched.stderr)
  await patchReadme(ctx, task as Task, { branch: name })
  return ok({ branch: name, from })
}
