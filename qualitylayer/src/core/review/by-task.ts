// Changes by task: which task changed each file of the diff. A file is a task's when its card's
// Files block names it (under its old path too, for a rename), a build commit that ticked the task
// touched it, or a build commit that ticked nothing (the plan folder is ignored: local mode)
// touched it together with a file the slice names; the agent's recorded deviations explain the rest
// it wrote on its own; a change the re-check recorded as the fix's is a fix; a file none of these
// explains came from another session's commit ("not this task") and stays out of the pull
// request's description. The push still carries the branch as it is.

import type { Ctx } from "../../ctx.ts"
import { noteTasks, parseNotes } from "../docs/build-log.ts"
import { emptyOutline, type Outline } from "../docs/outline.ts"
import { readBuildStart, sliceCommits } from "../git/build-start.ts"
import type { Changes } from "../git/changes.ts"
import { otherTasksOnly } from "../git/session-edits.ts"
import { resolveRepo } from "../paths.ts"
import { readEvents, type Task } from "../task/store.ts"
import { buildCommits } from "../timeline.ts"
import { tagChanges } from "./by-task-tag.ts"
import type { ChangesByTask } from "./summary.ts"

export { tagChanges } from "./by-task-tag.ts"

/** The paths the pull request's description leaves out: "not this task". */
export const keepOutOf = (byTask: Pick<ChangesByTask, "other">): string[] =>
  byTask.other.map((f) => f.path)

/** The files only other tasks' sessions edited in this repository (empty outside one). */
async function othersOnlyOf(ctx: Ctx, task: Task): Promise<Set<string>> {
  const repo = await resolveRepo(ctx)
  return new Set(repo.ok ? await otherTasksOnly(ctx, repo.data, task.slug) : [])
}

/** When the person first sent changes on the final review, if they did. */
async function changesSentAt(ctx: Ctx, task: Task): Promise<number | null> {
  const sent = (await readEvents(ctx, task)).find(
    (e) => e.event === "gate_decided" && e.target === "final" && e.decision === "changes",
  )
  return typeof sent?.ts === "number" ? sent.ts : null
}

/**
 * Files of the commits made after `since`, by git's own commit dates: a filter, not the evidence.
 * Only the task's own recorded commits are eligible; their dates never establish ownership.
 */
async function filesSince(
  ctx: Ctx,
  task: Task,
  commits: string[],
  since: number,
): Promise<Set<string>> {
  if (commits.length === 0) return new Set()
  const log = await ctx.git.run(task.repoRoot, [
    "log",
    "--no-walk=unsorted",
    "--format=%x1e%ct",
    "--name-only",
    ...commits,
  ])
  const files = new Set<string>()
  if (log.code !== 0) return files
  for (const block of log.stdout.split("\x1e").filter((b) => b.trim() !== "")) {
    const [time = "0", ...names] = block.split("\n")
    if (Number(time) * 1000 <= since) continue
    for (const name of names) if (name.trim() !== "") files.add(name.trim())
  }
  return files
}

/**
 * The diff of a task split by who changed what. A workflow's own change (it carries a changeScope)
 * has no range base by design; any other change without a base has nothing to count from: null.
 */
export async function changesByTask(
  ctx: Ctx,
  task: Task,
  diff: Changes,
  outline: Outline | null,
  buildLog: string,
): Promise<ChangesByTask | null> {
  if (diff.base === null && diff.changeScope === undefined) return null
  const plan = outline ?? emptyOutline()
  const commits = (await buildCommits(ctx, task, plan)).map((c) => ({
    short: c.short,
    paths: c.paths,
    tasks: c.tasks,
  }))
  const sent = await changesSentAt(ctx, task)
  const own = await sliceCommits(ctx, task)
  // Feedback time filters recorded ownership; a branch range cannot supply it.
  const fixed = sent === null ? new Set<string>() : await filesSince(ctx, task, own, sent)
  return tagChanges({
    files: diff.files,
    outline: plan,
    commits,
    // A note about several tasks (one amendment) explains a file for each of them.
    deviations: parseNotes(buildLog)
      .filter((n) => n.kind !== "baseline")
      .flatMap((n): { task: string | null; text: string }[] => {
        const tasks = noteTasks(n)
        return tasks.length > 0
          ? tasks.map((task) => ({ task, text: n.text }))
          : [{ task: null, text: n.text }]
      }),
    fixed,
    othersOnly: await othersOnlyOf(ctx, task),
    baseline: new Set(Object.keys((await readBuildStart(ctx, task))?.state ?? {})),
    ownCommits: own,
  })
}
