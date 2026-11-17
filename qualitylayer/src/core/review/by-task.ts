// Changes by task: which task changed each file of the diff. A file is a task's when its card's
// Files block names it (under its old path too, for a rename), a build commit that ticked the task
// touched it, or a build commit that ticked nothing (the plan folder is ignored: local mode)
// touched it together with a file the slice names; the agent's recorded deviations explain the rest
// it wrote on its own; a change the re-check recorded as the fix's is a fix; a file none of these
// explains came from another session's commit ("not this task") and stays out of the pull
// request's description. The push still carries the branch as it is.

import type { Ctx } from "../../ctx.ts"
import { noteTasks, parseNotes } from "../docs/build-log.ts"
import { allTasks, emptyOutline, type Outline } from "../docs/outline.ts"
import { readBuildStart, sliceCommits } from "../git/build-start.ts"
import { type Changes, isPlanPath } from "../git/changes.ts"
import { otherTasksOnly } from "../git/session-edits.ts"
import { resolveRepo } from "../paths.ts"
import { readEvents, type Task } from "../task/store.ts"
import { buildCommits } from "../timeline.ts"
import type { ChangedFileView, ChangeGroup, ChangesByTask, ChangeTag } from "./summary.ts"

type CommitFacts = { short: string; paths: string[]; tasks: string[] }
type Deviation = { task: string | null; text: string }

const under = (file: string, path: string) =>
  file === path || file.startsWith(path.endsWith("/") ? path : `${path}/`)

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1)

/** The words of a deviation, split once: whole path-like tokens. */
const wordsOf = (text: string) => text.split(/[\s`'"(),;:]+/)

/**
 * Whether a deviation's words name a path. A bare file name counts when it is the only file of the
 * diff with that name.
 */
const mentions = (words: string[], file: string, bareNameOk: boolean) =>
  words.some(
    (word) =>
      word === file ||
      (word.endsWith("/") && under(file, word)) ||
      (bareNameOk && !word.includes("/") && word === basename(file)),
  )

export function tagChanges(input: {
  files: {
    path: string
    status: string
    additions: number
    deletions: number
    from?: string
    stamp?: string
  }[]
  outline: Outline
  commits: CommitFacts[]
  deviations: Deviation[]
  /** Files the fix changed after the person asked for changes (`fixedFiles`). */
  fixed: ReadonlySet<string>
  /** Files only other tasks' sessions edited (`otherTasksOnly`): another build on the same branch. */
  othersOnly?: ReadonlySet<string>
  /** The paths already changed in the checkout when the build started (`readBuildStart`). */
  baseline?: ReadonlySet<string>
  /**
   * The full hashes of the commits `commit slice` made for this task. When there are any, a commit
   * that ticked nothing and is not among them is another build's: its files are not handed to a
   * slice that happens to share one.
   */
  ownCommits?: readonly string[]
}): ChangesByTask {
  const tasks = allTasks(input.outline)
  const sliceOf = new Map<string, number>()
  for (const slice of input.outline.slices) for (const t of slice.tasks) sliceOf.set(t.id, slice.n)
  // A task's place in the Plan; an id the Plan does not hold sorts first, as findIndex's -1 did.
  const place = new Map<string, number>()
  tasks.forEach((t, i) => {
    if (!place.has(t.id)) place.set(t.id, i)
  })
  const order = (ids: string[]) =>
    [...new Set(ids)].sort((a, b) => (place.get(a) ?? -1) - (place.get(b) ?? -1))

  // A large build meets every file of the diff against every commit and every task's Files:
  // each of those facts is worked out once, not once per file of the diff.
  const namedPaths = new Map<string, boolean>()
  const named = (path: string) => {
    let known = namedPaths.get(path)
    if (known === undefined) {
      known = tasks.some((t) => t.files.some((f) => under(path, f)))
      namedPaths.set(path, known)
    }
    return known
  }
  const names = new Map<string, number>()
  for (const f of input.files) names.set(basename(f.path), (names.get(basename(f.path)) ?? 0) + 1)
  /** The commits that touched each path, in the order of the commits. */
  const touchedBy = new Map<string, CommitFacts[]>()
  for (const commit of input.commits) {
    for (const path of new Set(commit.paths)) {
      const list = touchedBy.get(path)
      if (list === undefined) touchedBy.set(path, [commit])
      else list.push(commit)
    }
  }
  /** The tasks whose files a commit with no ticks touched: one commit per slice, so its other files are theirs too. */
  const sliceTasks = new Map<CommitFacts, string[]>()
  const sliceTasksOf = (commit: CommitFacts): string[] => {
    let ids = sliceTasks.get(commit)
    if (ids === undefined) {
      ids = tasks
        .filter((t) => commit.paths.some((p) => t.files.some((f) => under(p, f))))
        .map((t) => t.id)
      sliceTasks.set(commit, ids)
    }
    return ids
  }
  const deviations = input.deviations.map((d) => ({ ...d, words: wordsOf(d.text) }))
  const own = input.ownCommits ?? []
  /** Whether a commit is this task's own: any, until `commit slice` has recorded some. */
  const ours = (c: CommitFacts) => own.length === 0 || own.some((sha) => sha.startsWith(c.short))

  const tagOf = (file: { path: string; from?: string }): ChangeTag => {
    const { path } = file
    const owners = tasks
      .filter((t) =>
        t.files.some((f) => under(path, f) || (file.from !== undefined && under(file.from, f))),
      )
      .map((t) => t.id)
    if (owners.length > 0) return { kind: "task", tasks: order(owners) }
    const touching = touchedBy.get(path) ?? []
    const ticked = touching.flatMap((c) => c.tasks)
    if (ticked.length > 0) return { kind: "task", tasks: order(ticked) }
    const bare = (names.get(basename(path)) ?? 0) === 1
    const decided = deviations.filter((d) => mentions(d.words, path, bare))
    if (decided.length > 0) {
      return {
        kind: "decided",
        tasks: order(decided.flatMap((d) => (d.task !== null ? [d.task] : []))),
      }
    }
    if (input.fixed.has(path)) return { kind: "fix" }
    // Another build on the same branch edited it and this task never did: its commits tick nothing
    // here, so the slice rule below would otherwise hand its files to a slice that shares a file.
    // No commit holds a file it never touched: git still shows it as changed, not committed.
    const foreign = (): ChangeTag =>
      touching.length > 0
        ? { kind: "other" }
        : { kind: "other", uncommitted: input.baseline?.has(path) === true ? "before" : "during" }
    if (input.othersOnly?.has(path) === true) return foreign()
    const slice = touching.filter((c) => c.tasks.length === 0 && ours(c)).flatMap(sliceTasksOf)
    return slice.length > 0 ? { kind: "task", tasks: order(slice) } : foreign()
  }

  const groups = new Map<number, ChangeGroup>()
  const fixes: ChangedFileView[] = []
  const other: ChangedFileView[] = []
  const documents: ChangedFileView[] = []
  let additions = 0
  let removed = 0
  let count = 0
  for (const f of input.files) {
    if (isPlanPath(f.path)) {
      // The task's documents stand apart from the code: no tag, no count.
      documents.push({ ...f, tag: { kind: "other" } })
      continue
    }
    count++
    additions += f.additions
    removed += f.deletions
    const tag = tagOf(f)
    const view: ChangedFileView = { ...f, tag }
    if (tag.kind === "fix") fixes.push(view)
    else if (tag.kind === "other") other.push(view)
    else {
      const ids = tag.tasks
      const n = ids.map((id) => sliceOf.get(id)).find((s) => s !== undefined) ?? 0
      const group = groups.get(n) ?? {
        n,
        title: input.outline.slices.find((s) => s.n === n)?.title ?? "Decided by the agent",
        tasks: [],
        files: [],
      }
      group.tasks = order([...group.tasks, ...ids])
      group.files.push(view)
      groups.set(n, group)
    }
  }
  // Another session's commits: the ones that touched a "not this task" file and no file a task names.
  const otherPaths = new Set(other.map((f) => f.path))
  const otherCommits = [
    ...new Set(
      input.commits
        .filter(
          (c) =>
            c.tasks.length === 0 &&
            (own.length > 0 ? !ours(c) : !c.paths.some(named)) &&
            c.paths.some((p) => otherPaths.has(p)),
        )
        .map((c) => c.short),
    ),
  ]
  return {
    files: count,
    additions,
    removed,
    groups: [...groups.values()].sort((a, b) => a.n - b.n),
    fixes,
    other,
    otherCommits,
    ...(documents.length > 0 ? { documents } : {}),
  }
}

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
