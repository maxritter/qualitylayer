// What the App's Implement and Verify views show, read from the
// documents, the runtime and git: whole task cards per slice with each task's
// state, the notes by task, the live line, the
// commits, the plan's diff since approval and the steps the user tries. Read-only.

import type { Ctx } from "../ctx.ts"
import { readCheckRecords, verifiedTasks } from "./checks.ts"
import { type Note, parseNotes } from "./docs/build-log.ts"
import { contractKey, readContracts } from "./docs/contracts.ts"
import {
  allTasks,
  dependenciesOf,
  evidenceIn,
  type Outline,
  parsePrerequisites,
  prerequisiteSettled,
  type SliceColumn,
  sliceColumns,
  type TestFirst,
  type TreeFile,
} from "./docs/outline.ts"
import { checkField, checkHeading, checkListItem } from "./docs/record-lines.ts"
import { sectionRanges } from "./docs/rules/types.ts"
import { buildBase } from "./git/base.ts"
import { type BuildLine, buildLine, helperLines } from "./helpers.ts"
import { cardReports } from "./live/progress.ts"
import { type LandingArea, landingOf } from "./pages/landing.ts"
import { finalChecksText } from "./review/final-checks.ts"
import { type Task, taskDocPath } from "./task/store.ts"
import { buildCommits, type CommitView, planDiff } from "./timeline-git.ts"

export { buildCommits, type CommitView }

/**
 * Where a task of the build stands: its builder reported on it (building), QualityLayer ran its
 * verify command and it passed (verified), its box is ticked (done), or nothing yet (open).
 */
export type TaskState = "open" | "building" | "verified" | "done"

export type TimelineTask = {
  id: string
  title: string
  checked: boolean
  state: TaskState
  objective: string
  /** The card's files, each with its slice's note and mark when the tree names it. */
  files: TreeFile[]
  testFirst: TestFirst | null
  /** Definition-of-done lines, without the verify line. */
  dod: string[]
  /** The verify command, from the `verify:` line. */
  proof: string | null
  design: string[]
  owner: "User" | null
  userAction: string | null
  /** A bug's card role from the agents' file (`**Role:** reproduce` or `fix`); absent on other cards. */
  role?: string
}

export type TimelineSlice = {
  n: number
  title: string
  summary: string
  validation: string
  /** Earlier slices this slice depends on. */
  dependsOn?: number[]
  /** Optional reason from `Depends on`. */
  dependsReason?: string
  /** Unique non-plan files touched by commits for this slice. */
  filesChanged?: number
  /** The commit that ticked the slice's last box, once there is one. */
  commit: string | null
  tasks: TimelineTask[]
}

export type { Note }

export type TryStep = {
  title: string
  what: string
  command: string | null
  expected: string
  saw: string
  evidence: string[]
}

export type Timeline = {
  slices: TimelineSlice[]
  /** The slices in the columns they can be built in, side by side within a column. */
  columns: SliceColumn[][]
  notes: Note[]
  /** What the build session says it is doing, with its age. */
  builder: BuildLine | null
  /** The judge's latest line while a round runs. */
  judge: { line: string; at: number } | null
  commits: CommitView[]
  /** The commit that holds the approved plan, and the plan's diff since. */
  plan: { commit: string | null; diff: string }
  tries: TryStep[]
  notVerified: string[]
  docsImpact: string[]
  /** What was settled before the build, from the Plan's *Prerequisites*; empty when no human step. */
  prerequisites: { n: string; what: string; metBy: string; status: string; settled: boolean }[]
  /** How many checks QualityLayer recorded for the build (tasks, slices, the whole project). */
  checks?: number
  /** Every contract of the details (a bug's diagnosis) with the tasks that name it. */
  contracts: { name: string; section: string; tasks: string[] }[]
  /** Where the change lands: the areas of the code the cards change, largest first (landing.ts). */
  landing?: LandingArea[]
  /** The test files the cards name, counted apart from the areas. */
  landingTests?: { files: number }
}

/** The card's files with the slice tree's notes: the same path, or one that ends where the other does. */
function filesOf(paths: string[], tree: TreeFile[]): TreeFile[] {
  return paths.map((path) => {
    const hit =
      tree.find((f) => f.path === path) ??
      tree.find((f) => f.path.endsWith(`/${path}`) || path.endsWith(`/${f.path}`))
    return { path, mark: hit?.mark ?? "", note: hit?.note ?? "" }
  })
}

function cardOf(
  task: Outline["slices"][number]["tasks"][number],
  tree: TreeFile[],
  state: TaskState,
): TimelineTask {
  const verify = task.dod.find((line) => /^verify:/i.test(line))
  const command = verify?.match(/`([^`]+)`/)?.[1] ?? null
  return {
    id: task.id,
    title: task.title,
    checked: task.checked,
    state,
    objective: task.objective,
    files: filesOf(task.files, tree),
    testFirst: task.testFirst,
    dod: task.dod.filter((line) => !/^verify:/i.test(line)),
    proof: command,
    design: task.design,
    owner: task.owner ?? null,
    userAction: task.userAction ?? null,
    ...(task.role !== undefined && task.role !== "" ? { role: task.role } : {}),
  }
}

function applyCheckField(step: TryStep, field: { name: string; value: string }): void {
  const { name, value } = field
  if (name === "do") step.what = value
  else if (name === "run") step.command = value.match(/`([^`]+)`/)?.[1] ?? value
  else if (name.startsWith("expect")) step.expected = value
  else {
    step.saw = value
    step.evidence = evidenceIn(value)
  }
}

function parseTrySteps(body: readonly string[]): TryStep[] {
  const tries: TryStep[] = []
  let step: TryStep | null = null
  for (const line of body) {
    const heading = checkHeading(line)
    if (heading !== null) {
      step = { title: heading, what: "", command: null, expected: "", saw: "", evidence: [] }
      tries.push(step)
      continue
    }
    const field = checkField(line)
    if (field !== null && step !== null) {
      applyCheckField(step, field)
      continue
    }
    const text = checkListItem(line)
    if (text !== null && step === null) {
      tries.push({
        title: text,
        what: "",
        command: text.match(/`([^`]+)`/)?.[1] ?? null,
        expected: "",
        saw: "",
        evidence: evidenceIn(text),
      })
    }
  }
  return tries
}

/**
 * evidence/final-checks.md: `## Try it` with one `### <title>` per step and
 * `- Do:`, `- Run:`, `- Expect:`, `- Saw:` lines (a plain list item is a step
 * of its own); `## Not verified` and `## Docs` as lists.
 */
export function parseFinalChecks(markdown: string): {
  tries: TryStep[]
  notVerified: string[]
  docsImpact: string[]
} {
  const lines = markdown.split(/\r?\n/)
  const section = (name: string) => {
    const range = sectionRanges(markdown).find(
      (r) => r.heading.toLowerCase() === name.toLowerCase(),
    )
    return range === undefined ? [] : lines.slice(range.start, range.end - 1)
  }
  const items = (body: string[]) =>
    body.map((line) => checkListItem(line) ?? "").filter((l) => l !== "")
  return {
    tries: parseTrySteps(section("Try it")),
    notVerified: items(section("Not verified")),
    docsImpact: items(section("Docs")),
  }
}

function buildTimelineSlice(
  s: Outline["slices"][number],
  outline: Outline,
  commits: readonly CommitView[],
  stateOf: (t: Outline["slices"][number]["tasks"][number]) => TaskState,
): TimelineSlice {
  const ids = s.tasks.map((t) => t.id)
  const sliceCommits = commits.filter(
    (c) => c.slice === s.n || c.tasks.some((id) => ids.includes(id)),
  )
  const last = sliceCommits.at(-1)
  const done = s.tasks.length > 0 && s.tasks.every((t) => t.checked)
  const deps = dependenciesOf(outline, s)
  const touched = new Set(sliceCommits.flatMap((c) => c.paths))
  return {
    n: s.n,
    title: s.title,
    summary: s.summary,
    validation: s.validation,
    ...(deps.length > 0 ? { dependsOn: deps } : {}),
    ...(s.dependsReason ? { dependsReason: s.dependsReason } : {}),
    ...(touched.size > 0 ? { filesChanged: touched.size } : {}),
    commit: done && last !== undefined ? last.short : null,
    tasks: s.tasks.map((t) => cardOf(t, s.tree, stateOf(t))),
  }
}

export async function timeline(
  ctx: Ctx,
  task: Task,
  outline: Outline,
  logText: string,
): Promise<Timeline> {
  const helpers = await helperLines(ctx, task)
  // One read of the build's base serves its commits and where it lands.
  const base = await buildBase(ctx, task)
  const commits = await buildCommits(ctx, task, outline, base)
  // The lead's own lines and, where it said nothing, the cards whose files are being edited.
  const reports = await cardReports(
    ctx,
    task,
    outline.slices.flatMap((s) => s.tasks),
  )
  const verified = await verifiedTasks(ctx, task)
  const stateOf = (t: Outline["slices"][number]["tasks"][number]): TaskState => {
    if (t.checked) return "done"
    if (verified.has(t.id)) return "verified"
    return reports[t.id] !== undefined ? "building" : "open"
  }
  const slices = outline.slices.map((s) => buildTimelineSlice(s, outline, commits, stateOf))
  const judge = helpers.find((h) => /^j\d+-/.test(h.id))
  const checks = parseFinalChecks(await finalChecksText(ctx, task))

  return {
    slices,
    columns: sliceColumns(outline),
    notes: parseNotes(logText),
    builder: await buildLine(ctx, task),
    judge:
      judge?.line !== null && judge?.at !== null && judge !== undefined
        ? { line: judge.line, at: judge.at }
        : null,
    commits,
    plan: await planDiff(ctx, task),
    ...checks,
    prerequisites: (await prerequisitesOf(ctx, task)).map(({ n, what, metBy, status }) => ({
      n,
      what,
      metBy,
      status,
      settled: prerequisiteSettled(status),
    })),
    checks: (await readCheckRecords(ctx, task)).length,
    contracts: await contractMap(ctx, task, outline),
    ...(await landingOf(ctx, task, outline, base)),
  }
}

/** The Plan's *Prerequisites*, in 01-plan.md. */
async function prerequisitesOf(ctx: Ctx, task: Task) {
  const path = taskDocPath(task, "plan")
  return (await ctx.fs.exists(path)) ? parsePrerequisites(await ctx.fs.readFile(path)).rows : []
}

async function contractMap(ctx: Ctx, task: Task, outline: Outline): Promise<Timeline["contracts"]> {
  const found = await readContracts(ctx, task.dir, task.type)
  if (found === null) return []
  const tasks = allTasks(outline)
  return [...found.wholes, ...found.contracts].map((c) => ({
    name: c.name,
    section: c.section,
    tasks: tasks
      .filter((t) => t.design.some((name) => contractKey(name) === contractKey(c.name)))
      .map((t) => t.id),
  }))
}
