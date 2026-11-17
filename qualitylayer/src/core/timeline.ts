// What the App's Implement and Verify views show, read from the
// documents, the runtime and git: whole task cards per slice with each task's
// state, the notes by task, the live line, the
// commits, the plan's diff since approval and the steps the user tries. Read-only.

import { join, relative } from "node:path"
import type { Ctx } from "../ctx.ts"
import { readCheckRecords, verifiedTasks } from "./checks.ts"
import { type Note, parseNotes } from "./docs/build-log.ts"
import { contractKey, readContracts } from "./docs/contracts.ts"
import { agentFileOf } from "./docs/names.ts"
import {
  allTasks,
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
import { PLAN_GATE_DOCS } from "./docs/schema.ts"
import { BUILD_COMMITS, buildBase } from "./git/base.ts"
import { type BuildLine, buildLine, helperLines } from "./helpers.ts"
import { cardReports } from "./live/progress.ts"
import { type LandingArea, landingOf } from "./pages/landing.ts"
import { finalChecksText } from "./review/final-checks.ts"
import { type Task, taskDocPath } from "./task/store.ts"

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
  /** The commit that ticked the slice's last box, once there is one. */
  commit: string | null
  tasks: TimelineTask[]
}

export type { Note }

export type CommitView = {
  sha: string
  short: string
  subject: string
  slice: number | null
  /** The boxes it ticked. */
  tasks: string[]
  /** Changed files outside the plan folder. */
  files: number
  /** Their paths, for the files each slice changed. */
  paths: string[]
}

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

async function git(ctx: Ctx, task: Task, args: string[]): Promise<string | null> {
  try {
    const result = await ctx.git.run(task.repoRoot, args)
    return result.code === 0 ? result.stdout : null
  } catch {
    return null
  }
}

/** What a commit ticked and touched: fixed by its sha, so the Cockpit reads each commit once, not on every file event. */
type CommitRead = { ticked: string; names: string }
const READ_COMMITS_KEPT = 1000
const readCommits = new WeakMap<Ctx["git"], Map<string, CommitRead>>()

/** Each commit's part of a `git log` whose format starts every commit with RS and its sha. */
function perCommit(text: string): Map<string, string> {
  const parts = new Map<string, string>()
  for (const chunk of text.split("\x1e")) {
    const end = chunk.indexOf("\n")
    const sha = (end < 0 ? chunk : chunk.slice(0, end)).trim()
    if (sha !== "") parts.set(sha, end < 0 ? "" : chunk.slice(end + 1))
  }
  return parts
}

/**
 * What each commit ticked in the outline and which files it touched. Commits not read before are
 * read for the whole range in two `git log`s: a process per commit (two for each of hundreds of
 * commits of a long build) took seconds and a few hundred megabytes on every first open.
 */
async function readCommitsOf(
  ctx: Ctx,
  task: Task,
  base: string,
  shas: string[],
  outlinePath: string,
): Promise<CommitRead[]> {
  const kept = readCommits.get(ctx.git) ?? new Map<string, CommitRead>()
  readCommits.set(ctx.git, kept)
  const key = (sha: string) => `${task.repoRoot}\0${sha}\0${outlinePath}`
  const fresh = new Map<string, CommitRead>()
  if (shas.some((sha) => !kept.has(key(sha)))) {
    const range = `${base}..HEAD`
    const [ticks, names] = await Promise.all([
      git(ctx, task, [
        "log",
        ...BUILD_COMMITS,
        "--format=%x1e%H",
        "--unified=0",
        "--patch",
        range,
        "--",
        outlinePath,
      ]),
      git(ctx, task, ["log", ...BUILD_COMMITS, "--format=%x1e%H", "--name-only", range]),
    ])
    // A failed read is asked again next time.
    if (ticks !== null && names !== null) {
      const ticked = perCommit(ticks)
      const named = perCommit(names)
      for (const sha of shas) {
        const read = { ticked: ticked.get(sha) ?? "", names: named.get(sha) ?? "" }
        fresh.set(sha, read)
        if (kept.size >= READ_COMMITS_KEPT) kept.delete(kept.keys().next().value as string)
        kept.set(key(sha), read)
      }
    }
  }
  return shas.map((sha) => kept.get(key(sha)) ?? fresh.get(sha) ?? { ticked: "", names: "" })
}

/**
 * The build's commits since its base, oldest first, each with the boxes it ticked: read from git
 * each time, along the first parent and without merges, so a rebase or a merged main line never
 * lists other people's commits as the build's.
 */
export async function buildCommits(
  ctx: Ctx,
  task: Task,
  outline: Outline,
  read?: string | null,
): Promise<CommitView[]> {
  const base = read === undefined ? await buildBase(ctx, task) : read
  if (base === null) return []
  const log = await git(ctx, task, [
    "log",
    "--reverse",
    ...BUILD_COMMITS,
    "--format=%H%x1f%h%x1f%s",
    `${base}..HEAD`,
  ])
  if (log === null) return []
  const folder = relative(task.repoRoot, task.dir).replaceAll("\\", "/")
  const outlinePath = `${folder}/${agentFileOf("implement")}`
  const sliceOf = new Map(allTasks(outline).map((t) => [t.id, 0]))
  for (const slice of outline.slices) for (const t of slice.tasks) sliceOf.set(t.id, slice.n)
  const rows = log
    .split("\n")
    .filter(Boolean)
    .map((row) => row.split("\x1f"))
  const reads = await readCommitsOf(
    ctx,
    task,
    base,
    rows.map(([sha = ""]) => sha),
    outlinePath,
  )
  const commits: CommitView[] = []
  for (const [index, [sha = "", short = "", subject = ""]] of rows.entries()) {
    const { ticked, names } = reads[index] ?? { ticked: "", names: "" }
    const tasks = [...ticked.matchAll(/^\+- \[[xX]\] (T\d+)\b/gm)].map((m) => m[1] ?? "")
    const paths = names.split("\n").filter((p) => p !== "" && !p.startsWith(`${folder}/`))
    const slices = tasks.map((id) => sliceOf.get(id) ?? 0).filter((n) => n > 0)
    commits.push({
      sha,
      short,
      subject,
      slice: slices.length > 0 ? Math.max(...slices) : null,
      tasks,
      files: paths.length,
      paths,
    })
  }
  return commits
}

/** The approved plan's commit (`plan: <slug>`) and the plan documents' diff since, working tree included. */
async function planDiff(ctx: Ctx, task: Task): Promise<Timeline["plan"]> {
  const found = await git(ctx, task, [
    "log",
    "-n",
    "1",
    "--format=%H",
    "--fixed-strings",
    `--grep=plan: ${task.slug}`,
  ])
  const commit = found?.trim() || null
  if (commit === null) return { commit: null, diff: "" }
  const folder = relative(task.repoRoot, task.dir)
  const diff = await git(ctx, task, [
    "diff",
    "--no-ext-diff",
    commit,
    "--",
    ...PLAN_GATE_DOCS.map((d) => join(folder, d)),
  ])
  return { commit, diff: diff ?? "" }
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
  const tries: TryStep[] = []
  let step: TryStep | null = null
  for (const line of section("Try it")) {
    const heading = checkHeading(line)
    if (heading !== null) {
      step = {
        title: heading,
        what: "",
        command: null,
        expected: "",
        saw: "",
        evidence: [],
      }
      tries.push(step)
      continue
    }
    const field = checkField(line)
    if (field !== null && step !== null) {
      const { name, value } = field
      if (name === "do") step.what = value
      else if (name === "run") step.command = value.match(/`([^`]+)`/)?.[1] ?? value
      else if (name.startsWith("expect")) step.expected = value
      else {
        step.saw = value
        step.evidence = evidenceIn(value)
      }
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
  return { tries, notVerified: items(section("Not verified")), docsImpact: items(section("Docs")) }
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
  const stateOf = (t: Outline["slices"][number]["tasks"][number]): TaskState =>
    t.checked
      ? "done"
      : verified.has(t.id)
        ? "verified"
        : reports[t.id] !== undefined
          ? "building"
          : "open"

  const slices: TimelineSlice[] = outline.slices.map((s) => {
    const ids = s.tasks.map((t) => t.id)
    const last = [...commits].reverse().find((c) => c.tasks.some((id) => ids.includes(id)))
    const done = s.tasks.length > 0 && s.tasks.every((t) => t.checked)
    return {
      n: s.n,
      title: s.title,
      summary: s.summary,
      validation: s.validation,
      commit: done && last !== undefined ? last.short : null,
      tasks: s.tasks.map((t) => cardOf(t, s.tree, stateOf(t))),
    }
  })

  const judge = helpers.find((h) => /^j\d+-/.test(h.id))
  const checks = parseFinalChecks(await finalChecksText(ctx, task))

  return {
    slices,
    columns: sliceColumns(outline),
    notes: parseNotes(logText),
    builder: await buildLine(ctx, task),
    judge:
      judge !== undefined && judge.line !== null && judge.at !== null
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
