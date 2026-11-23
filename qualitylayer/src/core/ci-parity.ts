// A local green run and remote red run are comparable only at the same commit and local tree.
import { join } from "node:path"
import type { Ctx } from "../ctx.ts"
import { readCheckRecords } from "./checks.ts"
import { projectChecks } from "./docs/commands.ts"
import { buildRevision } from "./gate/revision.ts"
import { untrackedFiles } from "./git/repo.ts"
import type { PullRequestView } from "./review/summary.ts"
import { pullRequestOf } from "./ship/pull-request.ts"
import { planDetailsText, type Task } from "./task/store.ts"

export async function ciWorkflows(ctx: Ctx, repoRoot: string): Promise<string[]> {
  try {
    return (await ctx.fs.readdir(join(repoRoot, ".github/workflows")))
      .filter((name) => /\.ya?ml$/.test(name))
      .sort()
      .map((name) => `.github/workflows/${name}`)
  } catch {
    return []
  }
}

export async function ciParityWarning(
  ctx: Ctx,
  task: Task,
  known?: PullRequestView | null,
  fresh = false,
): Promise<string | null> {
  try {
    return await compareChecks(ctx, task, known, fresh)
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message.slice(0, 512) : "local inspection failed"
    return `CI comparison is unavailable: ${reason}. No local/CI equivalence was established. Retry the command after the local inspection is restored; the completed workflow transition remains recorded.`
  }
}

function passedAtRevision(
  record: Awaited<ReturnType<typeof readCheckRecords>>[number] | undefined,
  head: string,
  revision: string,
): boolean {
  if (record?.head !== head || record.revision !== revision) return false
  return record.ran && record.exit === 0 && record.notRun === undefined
}

async function isCodeTreeClean(ctx: Ctx, repoRoot: string): Promise<boolean> {
  const clean = await ctx.git.run(repoRoot, [
    "diff",
    "--quiet",
    "HEAD",
    "--",
    ".",
    ":(exclude)docs/plans/**",
  ])
  const freshFiles = await untrackedFiles(ctx, repoRoot)
  if (clean.code !== 0 || freshFiles === null) return false
  return !freshFiles.some((f) => !f.startsWith("docs/plans/"))
}

async function localChecksGreenAtHead(ctx: Ctx, task: Task): Promise<string | null> {
  const records = (await readCheckRecords(ctx, task)).filter((r) => r.scope === "all")
  if (records.length === 0) return null
  const commit = await ctx.git.run(task.repoRoot, ["rev-parse", "HEAD"])
  if (commit.code !== 0) return null
  const head = commit.stdout.trim()
  const revision = await buildRevision(ctx, task)
  const commands = projectChecks((await planDetailsText(ctx, task)) ?? "")
  const latest = new Map(records.map((r) => [r.command, r]))
  const allPassed =
    commands.length > 0 &&
    commands.every((command) => passedAtRevision(latest.get(command), head, revision))
  return allPassed ? head : null
}

async function compareChecks(
  ctx: Ctx,
  task: Task,
  known: PullRequestView | null | undefined,
  fresh: boolean,
): Promise<string | null> {
  const head = await localChecksGreenAtHead(ctx, task)
  if (head === null || !(await isCodeTreeClean(ctx, task.repoRoot))) return null
  const pr = known === undefined ? await pullRequestOf(ctx, task, fresh) : known
  if (pr?.head !== head || (pr.failingChecks?.length ?? 0) === 0) return null
  return `check all passed at ${head}, but PR #${pr.number} CI failed: ${pr.failingChecks?.join("; ")}. Read the workflow and add the missing CI checks to the Plan. ${pr.url}`
}
