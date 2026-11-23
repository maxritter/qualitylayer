// Captured environment failures stay unverified for human Review rather than code-fix loops.
import type { Ctx } from "../ctx.ts"
import { readCheckRecords } from "./checks.ts"
import type { Iteration, Verdict } from "./docs/build-log.ts"
import { sliceCommands } from "./docs/commands.ts"
import { evidenceIn } from "./docs/outline.ts"
import { buildRevision } from "./gate/revision.ts"
import { openNeeds, readNeeds } from "./need/need.ts"
import type { Task } from "./task/store.ts"
import { taskFlow } from "./task-flow.ts"

export const environmentBlocked = (v: Pick<Verdict, "verdict" | "text">): boolean =>
  (v.verdict === "FAIL" || v.verdict === "MISSING") &&
  /^environment:\s*\S/i.test(v.text) &&
  evidenceIn(v.text).length > 0

/** Every failing verdict is explicitly blocked, with captured proof; no code failure is hidden. */
export function environmentOnly(iteration: Iteration): boolean {
  const failed = iteration.verdicts.filter((v) => v.verdict === "FAIL" || v.verdict === "MISSING")
  return iteration.result === "fail" && failed.length > 0 && failed.every(environmentBlocked)
}

export type ReleaseWait = {
  instructions: string
  then: string
  /**
   * The redeploy cannot finish here: a need is open on the release slice's task. Waiting again would
   * loop, so the live checks go to Review as unverified instead.
   */
  exhausted: boolean
}

type CheckRecordEntry = Awaited<ReturnType<typeof readCheckRecords>>[number]
type PlanSlice = NonNullable<Awaited<ReturnType<typeof taskFlow>>["plan"]>["slices"][number]
type OpenNeed = ReturnType<typeof openNeeds>[number]

function checkPassedAtRevision(record: CheckRecordEntry | undefined, revision: string): boolean {
  if (record?.revision !== revision) return false
  return record.ran && record.exit === 0 && record.notRun === undefined
}

function checkFailedAtRevision(record: CheckRecordEntry | undefined, revision: string): boolean {
  if (record?.revision !== revision) return false
  return !record.ran || record.exit !== 0 || record.notRun !== undefined
}

function releaseWaitForSlice(
  slice: PlanSlice,
  head: string,
  revision: string,
  records: readonly CheckRecordEntry[],
  needs: readonly OpenNeed[],
): ReleaseWait | null {
  const commands = sliceCommands(slice)
  const latest = new Map(
    records.filter((r) => r.scope === `slice ${slice.n}`).map((r) => [r.command, r]),
  )
  // Current while the build's code is: a commit of the task's own records leaves the deployed
  // proof standing, and the release's check compares the deployed version itself.
  if (
    commands.length > 0 &&
    commands.every((command) => checkPassedAtRevision(latest.get(command), revision))
  )
    return null
  if (commands.length === 0)
    return {
      instructions: `Release slice ${slice.n} has not passed validation at ${head}. Add an automated deployed-version check to its Validation and amend the Plan.`,
      then: "qualitylayer plan amend",
      exhausted: false,
    }
  const ids = slice.tasks.map((t) => t.id)
  const deployTask = ids[0] ?? `slice ${slice.n}'s task`
  const failedHere = commands.some((command) =>
    checkFailedAtRevision(latest.get(command), revision),
  )
  const why = failedHere
    ? "its validation already failed at this commit, so the deploy did not reach it"
    : "the code changed after the last deploy, so the deployed version is stale"
  return {
    instructions: `Release slice ${slice.n} has not passed validation at ${head}: ${why}. If the approved Plan explicitly grants this verification deploy, redeploy this commit only to the target named by ${deployTask}. A release label or a validation result is not a grant. When that exact granted target is a preview built by pushing the task branch, push only that branch and open no pull request; never main, a merge, a pull request merge or production. Wait until it is live (a queued deploy is not ready for judges), then run qualitylayer check slice ${slice.n}. Without that grant, or if access is missing, deployment fails or the person declines, do not deploy: record qualitylayer need --kind permission "<what the person must allow or do, and where>. <why the live checks need it>" --for ${deployTask}, then run qualitylayer next. Review shows the blocked live checks as unverified.`,
    then: `qualitylayer check slice ${slice.n}`,
    exhausted: needs.some((need) => ids.includes(need.for)),
  }
}

/**
 * Only recorded validation of the release at this commit unlocks live judging. Every commit after the
 * last deploy (a fix round, Review's fixes) makes the deployed version stale, so the lead
 * repeats only a verification deploy explicitly granted by the approved Plan, then validates it.
 * Judges never deploy.
 */
export async function releaseWaiting(ctx: Ctx, task: Task): Promise<ReleaseWait | null> {
  const plan = (await taskFlow(ctx, task)).plan
  const releases = plan?.slices.filter((s) => s.release) ?? []
  if (releases.length === 0) return null
  const rev = await ctx.git.run(task.repoRoot, ["rev-parse", "HEAD"])
  const head = rev.code === 0 ? rev.stdout.trim() : "unknown HEAD"
  const revision = await buildRevision(ctx, task)
  const records = await readCheckRecords(ctx, task)
  const needs = openNeeds(await readNeeds(ctx, task))
  // A release a person must unblock waits only when no other release can still be validated here.
  let blocked: ReleaseWait | null = null
  for (const slice of releases) {
    const wait = releaseWaitForSlice(slice, head, revision, records, needs)
    if (wait === null) continue
    if (!wait.exhausted) return wait
    blocked ??= wait
  }
  return blocked
}
