// The change of a task, top to bottom: one view QualityLayer draws from the records. Why (the agent's
// sentence), the screens designed beside built, the Plan's acceptance test as it ran, what was asked
// for (each Done means point with its verdict), the change by slice (the task cards' slices with
// their tasks, the decisions made while building each and their files with +/−), what is not this
// task's (the Plan's *Out of scope* and the files another session committed), the lanes that ran and
// ship (branch, target). Nothing here is written by an agent: the App draws it
// (`GET /api/tasks/:id/walkthrough`), and the `ql:` sections of 03-verify.md render parts of it as
// Markdown (pages/sections/review.ts). JSON-plain, so the App
// imports its type and reads it as the route sends it.

import type { Ctx } from "../../ctx.ts"
import { proofOf } from "../acceptance.ts"
import {
  type Iteration,
  implementAgentsPath,
  type Note,
  noteTasks,
  parseNotes,
  readBuildRecord,
  sectionText,
  type Verdict,
} from "../docs/build-log.ts"
import { parseDoc } from "../docs/frontmatter.ts"
import {
  allTasks,
  dependenciesOf,
  emptyOutline,
  type Outline,
  type SliceColumn,
  sliceColumns,
  type TreeFile,
} from "../docs/outline.ts"
import { recordLineTail } from "../docs/record-lines.ts"
import { buildBase, mainLine } from "../git/base.ts"
import { changes, isPlanPath } from "../git/changes.ts"
import { covers } from "../git/slice-commit.ts"
import { type LaneRow, laneNameOf } from "../pages/lanes.ts"
import type { DonePoint, PageState, ProofRow } from "../pages/render.ts"
import { roundVerdicts } from "../recheck.ts"
import { withPointVerdicts } from "../said.ts"
import { storedUrl } from "../ship/pull-request.ts"
import { readmeFrontmatter, type Task, taskDocPath } from "../task/store.ts"
import { readOutline } from "../task-flow.ts"
import { buildCommits } from "../timeline.ts"
import { changesByTask } from "./by-task.ts"
import { lineTotal } from "./line-counts.ts"
import { isNoneLine } from "./none-line.ts"
import type { AcceptanceAsRun } from "./screen-evidence.ts"
import { acceptanceAsRun, reviewScreens, type WalkScreen } from "./screens.ts"
import type { ChangedFileView, ChangesByTask } from "./summary.ts"

/** One file of the change as the walkthrough lists it. */
export type ChangePart = {
  id: string
  stamp: string
  path: string
  from?: string
  status: string
  additions: number | null
  deletions: number | null
  kind: "commit" | "working"
  label: string
}

export type WalkFile = {
  path: string
  /** The path before a rename. */
  from?: string
  /** git's status letter: A added, M modified, D deleted, R renamed. */
  status: string
  additions: number | null
  deletions: number | null
  /** What both its sides are now: a Viewed mark holds it, so an edit in place unmarks the file. */
  stamp?: string
  /** Exact own patch revisions, in the order returned by the file's patch request. */
  parts?: ChangePart[]
  /** A retained working revision is readable history, not a claim about the current checkout. */
  current?: "changed" | "unavailable"
  /** The tasks that wrote it, in the cards' order; empty for a fix or another session's file. */
  tasks: string[]
  /** Written on the agent's own decision (a recorded deviation names it), not named by a card. */
  decided?: true
  /** One-line purpose from the slice's file tree, when recorded. */
  note?: string
}

export type WalkTask = { id: string; title: string; done: boolean }

/** One slice of the task cards: what it built and what was decided while building it. */
export type WalkSlice = {
  n: number
  title: string
  /** What works afterwards that did not before, in the slice's own words. */
  summary: string
  /** Earlier slices this slice depends on, from `Depends on` or shared files/contracts. */
  dependsOn?: number[]
  /** Optional explanation from the slice's `Depends on` line. */
  dependsReason?: string
  /** Done means points whose acceptance steps complete on this slice (from `Proof order`). */
  points?: number[]
  tasks: WalkTask[]
  /** The decisions the build recorded for this slice's tasks, each one sentence. */
  decisions: string[]
  files: WalkFile[]
  additions: number | null
  deletions: number | null
  /** The build's commits that ticked this slice's tasks. */
  commits: number
}

/** One recorded verification round commit and the files touched since it. */
export type WalkRound = {
  n: number
  revision: string
  files: string[]
}

/** A Done means point as the walkthrough says it: its verdict, what proved it and where it was built. */
export type WalkPoint = {
  n: number
  outcome: string
  /** The verdict of the last round, or the person's confirmation for a point only they can confirm. */
  status: ProofRow["status"]
  /** The judge's words, without the evidence paths. */
  proof: string
  /** The evidence the point's verdict cites; null without one. */
  evidence: string | null
}

export type ChangeHistory = "registered" | "unavailable"

export type Walkthrough = {
  /** Local diagnostics only; native source records are never exported with shared task material. */
  changeScope?: {
    history?: ChangeHistory
    candidate?: true
    pending: { path: string; reason: string }[]
    workingFiles: string[]
    localOnlyFiles?: string[]
  }
  screens?: WalkScreen[]
  /** The Plan's acceptance test as it ran: each step with its picture or output, and how the run happened. */
  acceptance: AcceptanceAsRun
  /** The header line: commits, files and lines of the whole change, the slices and the tasks. */
  totals: {
    commits: number
    files: number
    additions: number | null
    deletions: number | null
    slices: number
    tasks: number
  }
  /** False when the change has no base to count from: the slices then stand without files. */
  counted: boolean
  /** The agent's *Why*: one sentence. */
  why: { sentence: string }
  /** The agent's *What changed*, as Markdown. */
  changed: string
  points: WalkPoint[]
  slices: WalkSlice[]
  /** The slices grouped into left-to-right build waves (deterministic from `sliceColumns`). */
  columns?: SliceColumn[][]
  /** Recorded verification round commits when >=2 distinct revisions exist, for round-delta review. */
  rounds?: WalkRound[]
  /** The decisions the build recorded for the Plan as a whole, not for one slice. */
  planDecisions: string[]
  /** Files the agent decided to change that belong to no slice's task. */
  decided: WalkFile[]
  /** Files changed after the person asked for changes, to make them. */
  fixes: WalkFile[]
  /** The task's own plan folder in the diff, apart from the code and its totals; absent when none. */
  documents?: WalkFile[]
  notDoing: {
    /** The Plan's *Out of scope* lines. */
    plan: string[]
    /** Files another session committed on this branch: not part of this change. */
    otherFiles: string[]
    /** The short ids of those commits. */
    otherCommits: string[]
    /**
     * Files in the checkout that no commit holds and no task made: changed before the build
     * started, or since by someone else. Absent when there are none.
     */
    uncommitted?: { before: string[]; during: string[] }
  }
  checked: {
    /** Verify's lanes in run order, with who ran each and how it ended. */
    lanes: {
      id: LaneRow["id"]
      name: string
      who: string
      state: LaneRow["state"]
      result: string
    }[]
  }
  ship: {
    /** The branch the change lands on; null when the task names none. */
    branch: string | null
    /** The branch the pull request targets: the repository's main line. */
    base: string | null
    pr: { number: number; url: string } | null
    shipped: boolean
  }
  /** What left the approved Plan, for *Changed from the Plan*: QualityLayer's facts, the agent's reading. */
  risk?: RiskAtMerge
}

export type RiskAtMerge = {
  /** This task's files no task card names. */
  outside: string[]
  /** Dependency manifests and lock files the change touched. */
  dependencies: string[]
  /** The amendments the build recorded. */
  amendments: number
}

const DEPENDENCY_FILE =
  /(^|\/)(package\.json|bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.(toml|lock)|go\.(mod|sum)|requirements[\w.-]*\.txt|pyproject\.toml|poetry\.lock|uv\.lock|Gemfile(\.lock)?|pom\.xml|build\.gradle(\.kts)?|composer\.(json|lock))$/i

/** The facts of *Changed from the Plan*, from the slices, the agent's own files, the notes and the points. */
export function riskAtMerge(
  view: Pick<Walkthrough, "slices" | "decided" | "fixes" | "points">,
  outline: Outline,
  notes: readonly Note[],
): RiskAtMerge {
  const own = [
    ...new Set(
      [...view.slices.flatMap((s) => s.files), ...view.decided, ...view.fixes].map((f) => f.path),
    ),
  ]
  // Compared file by file with the cards' Files, as the cards name them.
  const carded = allTasks(outline).flatMap((t) => t.files)
  return {
    outside: own.filter((path) => !carded.some((entry) => covers(entry, path))),
    dependencies: own.filter((path) => DEPENDENCY_FILE.test(path)),
    amendments: notes.filter((note) => note.kind === "amended").length,
  }
}

/** What the page state already holds that the walkthrough reads (pages/state.ts). */
export type WalkSources = Pick<PageState, "done" | "proof" | "records" | "ship">

/** The decisions of the build, as `pages/state.ts` counts them. */
const DECISION_KINDS: ReadonlySet<Note["kind"]> = new Set(["tactical", "amended"])

const plain = (text: string) =>
  text
    .replace(/\*\*|__/g, "")
    .replace(/\s+/g, " ")
    .trim()

/**
 * The decisions the build recorded for a slice: each note whose tasks include one of the slice's.
 * `null` asks for the Plan's own: the notes that name no task of any slice.
 */
export function decisionsOf(
  outline: Outline | null,
  notes: readonly Note[],
  slice: number | null,
): string[] {
  const sliceOf = new Map<string, number>()
  for (const s of outline?.slices ?? []) for (const t of s.tasks) sliceOf.set(t.id, s.n)
  return notes
    .filter((note) => DECISION_KINDS.has(note.kind))
    .filter((note) => {
      const slices = noteTasks(note).flatMap((id) => {
        const n = sliceOf.get(id)
        return n !== undefined ? [n] : []
      })
      return slice === null ? slices.length === 0 : slices.includes(slice)
    })
    .map((note) => plain(note.text))
    .filter((text) => text !== "")
}

/** The items of a section: its list items (a wrapped line joins its item), or its one paragraph. */
function itemsOf(section: string): string[] {
  const items: string[] = []
  let listed = false
  for (const raw of section.split(/\r?\n/)) {
    const prefix = /^\s*(?:[-*]|\d+[.)])/.exec(raw)
    const item = prefix === null ? null : recordLineTail(raw, prefix[0].length, 1, true)
    if (item !== null) {
      listed = true
      items.push(item)
    } else if (raw.trim() !== "" && listed && /^\s+\S/.test(raw) && items.length > 0)
      items[items.length - 1] = `${items[items.length - 1]} ${raw.trim()}`
  }
  if (!listed && section.trim() !== "") items.push(section.replace(/\s+/g, " ").trim())
  return items.filter((item) => item !== "" && !isNoneLine(item))
}

const isUncommitted = (file: ChangedFileView) =>
  file.tag.kind === "other" && file.tag.uncommitted !== undefined

/** The not-this-task files git shows as changed but no commit holds, by when they were changed. */
function uncommittedOf(other: readonly ChangedFileView[]): {
  uncommitted?: { before: string[]; during: string[] }
} {
  const named = (when: "before" | "during") =>
    other.filter((f) => f.tag.kind === "other" && f.tag.uncommitted === when).map((f) => f.path)
  const before = named("before")
  const during = named("during")
  return before.length + during.length > 0 ? { uncommitted: { before, during } } : {}
}

/** The Plan's *Scope* › *Out of scope* lines: what the task deliberately leaves alone. */
export function notDoingOf(plan: string): string[] {
  const scope = sectionText(plan, "Scope").split(/\r?\n/)
  const start = scope.findIndex((line) => /^###\s+Out of scope\s*$/i.test(line.trim()))
  if (start < 0) return []
  const rest = scope.slice(start + 1)
  const end = rest.findIndex((line) => line.trim().startsWith("### "))
  return itemsOf((end < 0 ? rest : rest.slice(0, end)).join("\n"))
}

/** An agent's section of 03-verify.md as written: empty while the template's guidance stands. */
const agentText = (review: string, heading: string) =>
  sectionText(review, heading)
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim()

const treeNoteFor = (path: string, tree: readonly TreeFile[]): string | undefined => {
  const hit =
    tree.find((f) => f.path === path) ??
    tree.find((f) => f.path.endsWith(`/${path}`) || path.endsWith(`/${f.path}`))
  const note = hit?.note.trim()
  return note ? note : undefined
}

const fileOf = (f: ChangedFileView, tree: readonly TreeFile[] = []): WalkFile => {
  const note = tree.length > 0 ? treeNoteFor(f.path, tree) : undefined
  return {
    path: f.path,
    ...(f.from !== undefined ? { from: f.from } : {}),
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    ...(f.stamp !== undefined ? { stamp: f.stamp } : {}),
    tasks: f.tag.kind === "task" || f.tag.kind === "decided" ? f.tag.tasks : [],
    ...(f.tag.kind === "decided" ? { decided: true as const } : {}),
    ...(note !== undefined ? { note } : {}),
  }
}

/** Map each slice number to the Done means points whose acceptance steps finish on that slice. */
function slicePointsOf(
  outline: Outline | null,
  acceptance: AcceptanceAsRun,
): Map<number, number[]> {
  const out = new Map<number, number[]>()
  if (outline === null || outline.proofOrder.length === 0 || !acceptance.points?.length) return out
  const stepSlice = new Map(outline.proofOrder.map((p) => [p.id.toUpperCase(), p.slice]))
  for (const point of acceptance.points) {
    const slices = point.steps
      .map((s) => stepSlice.get(s.id.toUpperCase()))
      .filter((n): n is number => n !== undefined)
    if (slices.length === 0) continue
    const completesAt = Math.max(...slices)
    out.set(completesAt, [...(out.get(completesAt) ?? []), point.n])
  }
  return out
}

const sum = lineTotal

/** The cited `evidence/…` path of a verdict, if it cites one. */
const evidenceOf = (verdict: Verdict | undefined) =>
  verdict?.text.match(/`(evidence\/[^`\s]+)`/)?.[1] ?? null

/** The last round's verdicts. */
async function lastVerdicts(
  ctx: Ctx,
  task: Task,
  last: Iteration | undefined,
): Promise<readonly Verdict[]> {
  if (last === undefined) return []
  // A points Plan proves each Done means point from its steps.
  return withPointVerdicts(await proofOf(ctx, task), await roundVerdicts(ctx, task, last))
}

/** Everything the walkthrough is drawn from, read once. */
export type WalkInput = {
  screens?: WalkScreen[]
  acceptance: AcceptanceAsRun
  outline: Outline | null
  byTask: ChangesByTask | null
  /** This task's implementation commits, each with the slice of the tasks it ticked. */
  commits: { slice: number | null }[]
  done: readonly DonePoint[]
  proof: readonly ProofRow[]
  /** The last round's verdicts. */
  verdicts: readonly Verdict[]
  notes: readonly Note[]
  /** The bodies of the Plan and of the Review document. */
  plan: string
  review: string
  lanes: readonly LaneRow[]
  rounds?: WalkRound[]
  ship: { branch: string | null; base: string | null; url: string | null; shipped: boolean }
}

/** The view, from what was read: pure. */
export function buildWalkthrough(input: WalkInput): Walkthrough {
  const { outline, byTask } = input
  const groups = new Map((byTask?.groups ?? []).map((g) => [g.n, g]))
  const pointMap = slicePointsOf(outline, input.acceptance)
  const slices: WalkSlice[] = (outline?.slices ?? []).map((slice) => {
    const files = (groups.get(slice.n)?.files ?? []).map((f) => fileOf(f, slice.tree))
    const deps = outline !== null ? dependenciesOf(outline, slice) : []
    const pts = pointMap.get(slice.n)
    return {
      n: slice.n,
      title: slice.title,
      summary: plain(slice.summary),
      ...(deps.length > 0 ? { dependsOn: deps } : {}),
      ...(slice.dependsReason !== null && slice.dependsReason !== ""
        ? { dependsReason: plain(slice.dependsReason) }
        : {}),
      ...(pts !== undefined && pts.length > 0 ? { points: pts } : {}),
      tasks: slice.tasks.map((t) => ({ id: t.id, title: t.title, done: t.checked })),
      decisions: decisionsOf(outline, input.notes, slice.n),
      files,
      additions: sum(files, "additions"),
      deletions: sum(files, "deletions"),
      commits: input.commits.filter((c) => c.slice === slice.n).length,
    }
  })
  const columns = outline !== null && outline.slices.length > 0 ? sliceColumns(outline) : undefined
  // A group no slice of the cards holds (the agent's own decisions, n 0) stands apart.
  const known = new Set(slices.map((s) => s.n))
  const decided = (byTask?.groups ?? [])
    .filter((g) => !known.has(g.n))
    .flatMap((g) => g.files.map((f) => fileOf(f)))

  const points: WalkPoint[] = input.done.map((point) => {
    const row = input.proof.find((p) => p.n === point.n)
    const own = input.verdicts.findLast((v) => v.kind === "done" && v.subject === String(point.n))
    return {
      n: point.n,
      outcome: point.outcome,
      status: row?.status ?? "checking",
      proof: row?.proof ?? "",
      evidence: evidenceOf(own),
    }
  })

  const prNumber = input.ship.url?.match(/\/pull\/(\d+)/)?.[1]
  const fixes = (byTask?.fixes ?? []).map((f) => fileOf(f))
  return {
    ...(byTask !== null && outline !== null
      ? {
          risk: riskAtMerge({ slices, decided, fixes, points }, outline, input.notes),
        }
      : {}),
    ...(input.screens?.length ? { screens: input.screens } : {}),
    acceptance: input.acceptance,
    // The header counts this task's change: another session's files and commits are listed apart.
    totals: {
      commits: input.commits.length,
      files: (byTask?.files ?? 0) - (byTask?.other.length ?? 0),
      additions:
        (byTask?.additions ?? 0) - (byTask?.other ?? []).reduce((n, f) => n + f.additions, 0),
      deletions:
        (byTask?.removed ?? 0) - (byTask?.other ?? []).reduce((n, f) => n + f.deletions, 0),
      slices: slices.length,
      tasks: outline !== null ? allTasks(outline).length : 0,
    },
    counted: byTask !== null,
    why: { sentence: plain(agentText(input.review, "Why")) },
    changed: agentText(input.review, "What changed"),
    points,
    slices,
    ...(columns !== undefined ? { columns } : {}),
    ...(input.rounds !== undefined && input.rounds.length >= 2 ? { rounds: input.rounds } : {}),
    planDecisions: decisionsOf(outline, input.notes, null),
    decided,
    fixes,
    ...(byTask?.documents !== undefined
      ? { documents: byTask.documents.map((f) => fileOf(f)) }
      : {}),
    notDoing: {
      plan: notDoingOf(input.plan),
      otherFiles: (byTask?.other ?? []).filter((f) => !isUncommitted(f)).map((f) => f.path),
      otherCommits: byTask?.otherCommits ?? [],
      ...uncommittedOf(byTask?.other ?? []),
    },
    checked: {
      lanes: input.lanes.map((l) => ({
        id: l.id,
        name: laneNameOf(l.id),
        who: l.who,
        state: l.state,
        result: l.result,
      })),
    },
    ship: {
      branch: input.ship.branch,
      base: input.ship.base,
      pr:
        prNumber !== undefined && input.ship.url !== null
          ? { number: Number(prNumber), url: input.ship.url }
          : null,
      shipped: input.ship.shipped,
    },
  }
}

const read = async (ctx: Ctx, path: string) =>
  (await ctx.fs.exists(path)) ? await ctx.fs.readFile(path) : ""

/** Valid distinct verification round commits and the non-plan files changed since each commit. */
const GIT_SHA = /^[0-9a-f]{7,40}$/i

/** Map `checks.json` tree-revision hashes to the git HEAD commit recorded when each check ran. */
async function checkHeadsByRevision(ctx: Ctx, task: Task): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const raw = await ctx.fs.readFile(`${task.runtimeDir}/checks.json`)
    const entries = JSON.parse(raw) as unknown
    if (!Array.isArray(entries)) return map
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue
      const { revision, head } = entry as { revision?: unknown; head?: unknown }
      if (typeof revision === "string" && typeof head === "string" && GIT_SHA.test(head))
        map.set(revision, head)
    }
  } catch {
    // Missing or unreadable checks.json leaves only direct commit revisions.
  }
  return map
}

/** Distinct recorded git commit SHAs for a task's verification rounds. */
export async function roundCommitsOf(
  ctx: Ctx,
  task: Task,
  iterations: readonly Iteration[],
): Promise<{ n: number; revision: string }[]> {
  const byTree = await checkHeadsByRevision(ctx, task)
  const seen = new Set<string>()
  const unique: { n: number; revision: string }[] = []
  for (const item of iterations) {
    const raw = item.revision?.trim()
    if (!raw) continue
    const rev = GIT_SHA.test(raw) ? raw : byTree.get(raw)
    if (!rev || seen.has(rev)) continue
    const check = await ctx.git.run(task.repoRoot, ["cat-file", "-e", `${rev}^{commit}`])
    if (check.code !== 0) continue
    seen.add(rev)
    unique.push({ n: item.n, revision: rev })
  }
  return unique
}

async function readRounds(
  ctx: Ctx,
  task: Task,
  iterations: readonly Iteration[],
): Promise<WalkRound[]> {
  const unique = await roundCommitsOf(ctx, task, iterations)
  if (unique.length < 2) return []
  const rounds: WalkRound[] = []
  for (const entry of unique) {
    const diff = await ctx.git.run(task.repoRoot, ["diff", "--name-only", entry.revision])
    const files =
      diff.code === 0
        ? diff.stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line !== "" && !isPlanPath(line))
        : []
    rounds.push({ n: entry.n, revision: entry.revision, files })
  }
  return rounds
}

/**
 * The walkthrough of a task's change, read from its records and git. `sources` is the page state
 * (pages/state.ts) the documents are written from; `byTask` the diff already split by task, when
 * the caller has it (else it is read here).
 */
export async function readWalkthrough(
  ctx: Ctx,
  task: Task,
  options: { sources: WalkSources; byTask?: ChangesByTask | null },
): Promise<Walkthrough> {
  const outline = await readOutline(ctx, task)
  const buildLog = await read(ctx, implementAgentsPath(task))
  const byTask =
    options.byTask !== undefined
      ? options.byTask
      : await changesByTask(
          ctx,
          task,
          await changes(ctx, task.repoRoot, await buildBase(ctx, task)),
          outline,
          buildLog,
        )
  const commits = await buildCommits(ctx, task, outline ?? emptyOutline())
  const record = await readBuildRecord(ctx, task)
  const rounds = await readRounds(ctx, task, record.verification)
  const fm = await readmeFrontmatter(ctx, task)
  const base =
    typeof fm.base_ref === "string" && fm.base_ref !== ""
      ? fm.base_ref
      : await mainLine(ctx, task.repoRoot)
  const { sources } = options
  const otherCommits = new Set(byTask?.otherCommits ?? [])
  const view = buildWalkthrough({
    screens: await reviewScreens(ctx, task),
    acceptance: await acceptanceAsRun(ctx, task),
    outline,
    byTask,
    commits: commits
      .filter((c) => !otherCommits.has(c.short) && c.paths.some((path) => !isPlanPath(path)))
      .map((c) => ({ slice: c.slice })),
    done: sources.done,
    proof: sources.proof,
    verdicts: await lastVerdicts(ctx, task, record.verification.at(-1)),
    notes: parseNotes(buildLog),
    plan: parseDoc(await read(ctx, taskDocPath(task, "plan"))).body,
    review: parseDoc(await read(ctx, taskDocPath(task, "verify"))).body,
    lanes: sources.records?.lanes ?? [],
    ...(rounds.length >= 2 ? { rounds } : {}),
    ship: {
      branch: sources.ship.branch,
      base,
      url: await storedUrl(ctx, task),
      shipped: sources.ship.shipped,
    },
  })
  return view
}
