// A slice's checks judge the tree its commit would hold: HEAD plus the slice's own files. A checkout
// that several sessions share also holds their unfinished edits, and a check that fails on those says
// nothing about the slice. So a check that fails in the checkout for others' files (it did none of
// its work, or its output names one of them) is run once more on a copy of HEAD with the slice's
// files laid over it (the work tree's bytes for the slice's files, HEAD's for every file others
// changed), and that second run is the verdict. A check that passes in the checkout is never run
// again, and a checkout nobody else changed has nothing to leave out.

import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import type { CommandRunner, Ran } from "../checks.ts"
import { allTasks } from "../docs/outline.ts"
import { readCards } from "../docs/outline-files.ts"
import type { Task } from "../task/store.ts"
import { changedWorkFiles, isolationHeader, populateSliceCopy } from "./slice-tree-copy.ts"

export { notIsolatedWords } from "./slice-tree-copy.ts"

/**
 * The files the cards of a slice name: the slice's own, whatever the work tree holds besides. A card
 * takes its whole slice's, since its siblings' uncommitted files are part of the tree it builds on.
 */
export async function ownFiles(
  ctx: Ctx,
  task: Task,
  scope: { kind: "slice"; n: number } | { kind: "task"; id: string },
): Promise<string[]> {
  const outline = await readCards(ctx, task.dir).catch(() => null)
  if (outline === null) return []
  const same = (id: string) =>
    id.toUpperCase() === (scope.kind === "task" ? scope.id : "").toUpperCase()
  const slice = outline.slices.find((s) =>
    scope.kind === "slice" ? s.n === scope.n : s.tasks.some((t) => same(t.id)),
  )
  if (slice !== undefined) return slice.tasks.flatMap((t) => t.files)
  return scope.kind === "task" ? (allTasks(outline).find((t) => same(t.id))?.files ?? []) : []
}

/**
 * True when the output names one of `paths`, whole or below the folder the command ran in
 * (`src/a.ts` for `app/src/a.ts`); a bare file name is too common to count.
 */
export function namesPath(output: string, paths: readonly string[]): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strips the colour codes of a runner's output
  const text = output.replace(/\u001b\[[0-9;]*m/g, "").replaceAll("\\", "/")
  const named = (part: string) => {
    for (let at = text.indexOf(part); at !== -1; at = text.indexOf(part, at + 1)) {
      const before = text[at - 1] ?? " "
      const after = text[at + part.length] ?? " "
      // A dash that begins no word ends the path (`a.ts-- stale`); `a.ts-backup` is another file.
      const dashed = after === "-" && !/\w/.test(text[at + part.length + 1] ?? " ")
      if (!/[\w.-]/.test(before) && (dashed || !/[\w/-]/.test(after))) return true
    }
    return false
  }
  return paths.some((path) => {
    const parts = path.split("/")
    if (parts.length === 1) return named(path)
    for (let from = 0; from < parts.length - 1; from++)
      if (named(parts.slice(from).join("/"))) return true
    return false
  })
}

type SliceTreeOptions = {
  /**
   * Why a run did none of its work, read in the folder it ran in (`cwd`), or null when it did.
   * Asked for the first run in the checkout and for the rerun in its copy, while the copy exists.
   */
  notRun: (ran: Ran, command: string, cwd: string) => Promise<string | null>
  /** Of these changed paths, those another session's record provably claims. */
  theirs: (paths: string[]) => Promise<string[]>
  whose: "slice" | "task"
}

type IsolationPlan =
  | { kind: "stop"; result: Ran }
  | { kind: "rerun"; changed: { own: string[]; foreign: string[] }; strays: string[] }

async function planIsolation(
  first: Ran,
  listed: { own: string[]; foreign: string[]; untracked: Set<string> },
  context: { command: string; cwd: string; options: SliceTreeOptions },
): Promise<IsolationPlan> {
  // Why the first run stands is kept with it, so the reply says the reason that applied.
  if (listed.foreign.length === 0)
    return { kind: "stop", result: { ...first, notIsolated: { why: "nothing-else-changed" } } }
  // A file is this task's source for the check only on positive evidence that it is the task's:
  // a card names it or a session of the task wrote it (`own`), or git tracks it (a tracked file
  // changed by nobody's record may be the task's own unrecorded edit, so it stays in: that doubt
  // goes to red, never to green). Left out are the files another session's record claims, and
  // the untracked files with no such evidence (`strays`): written by no session of this task
  // and named by no card, they are not what the task would commit, and the task's agent may
  // neither delete nor commit them. Nothing is hidden: the run says what it left out and why.
  const claimed = new Set(await context.options.theirs(listed.foreign))
  const strays = listed.foreign.filter((path) => !claimed.has(path) && listed.untracked.has(path))
  const left = new Set([...claimed, ...strays])
  const changed = {
    own: [...listed.own, ...listed.foreign.filter((path) => !left.has(path))],
    foreign: listed.foreign.filter((path) => left.has(path)),
  }
  // What the output names among the tracked files changed by nobody's record.
  const unclaimed = changed.own
    .filter((path) => !listed.own.includes(path) && namesPath(first.output, [path]))
    .slice(0, 5)
  if (changed.foreign.length === 0)
    return {
      kind: "stop",
      result: { ...first, notIsolated: { why: "unclaimed", named: unclaimed } },
    }
  const hasEvidence =
    namesPath(first.output, changed.foreign) ||
    (await context.options.notRun(first, context.command, context.cwd)) !== null
  if (!hasEvidence) {
    const notIsolated =
      unclaimed.length > 0
        ? { why: "unclaimed" as const, named: unclaimed }
        : { why: "unnamed" as const }
    return { kind: "stop", result: { ...first, notIsolated } }
  }
  return { kind: "rerun", changed, strays }
}

/**
 * Run a failed check again on HEAD plus the slice's (or the task's) own files, when there is
 * evidence that others' files caused the failure: the first run did none of its work, or its output
 * names a file others changed. `own` are the files the cards name; the second run's result stands,
 * with the first run's output kept in front of it, the files it left out named in `isolated` and
 * whether it did its work, as its copy showed it, in `notRun`. A
 * check that passed, was interrupted, failed for its own reason, or fails in a checkout nobody else
 * changed, keeps its first result: an expensive command is never started twice for nothing.
 */
export function onSliceTree(
  task: Pick<Task, "repoRoot" | "dir" | "runtimeDir">,
  own: readonly string[],
  runner: CommandRunner,
  options: SliceTreeOptions,
): CommandRunner {
  return async (command, cwd, timeoutMs, stream) => {
    const first = await runner(command, cwd, timeoutMs, stream)
    if (first.exit === 0 || first.exit === null || first.exit === 127 || first.timedOut)
      return first
    const listed = await changedWorkFiles(task, own)
    if (listed === null) return first
    const plan = await planIsolation(first, listed, { command, cwd, options })
    if (plan.kind === "stop") return plan.result
    const folder = join(task.runtimeDir, "slice-trees")
    // A run that was killed leaves its copy behind; this one holds the check lock, so it is nobody's.
    await rm(folder, { recursive: true, force: true })
    const dir = join(folder, "tree")
    try {
      await mkdir(dir, { recursive: true })
      if (!(await populateSliceCopy(task.repoRoot, dir, plan.changed, folder))) return first
      const header = isolationHeader(options.whose, plan.changed.foreign, plan.strays)
      await stream?.output(header)
      const again = await runner(command, dir, timeoutMs, stream)
      // Whether it did its work is decided here, in the tree it ran in: the copy holds HEAD's
      // package.json and scripts, which another session's uncommitted ones in the checkout may
      // not match, and the copy is gone once this returns.
      const notRun = await options.notRun(again, command, dir)
      return {
        ...again,
        output: `${first.output}${header}${again.output}`,
        isolated: plan.changed.foreign,
        ...(plan.strays.length > 0 ? { strays: plan.strays } : {}),
        first: { exit: first.exit, output: first.output },
        notRun,
      }
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  }
}
