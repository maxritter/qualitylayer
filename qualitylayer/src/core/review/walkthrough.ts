// The change of a task, top to bottom: one view QualityLayer draws from the records. Why (the agent's
// sentence), the screens designed beside built, the Plan's acceptance test as it ran, what was asked
// for (each Done means point with its verdict), the change by slice (the task cards' slices with
// their tasks, the decisions made while building each and their files with +/−), what is not this
// task's (the Plan's *Out of scope* and the files another session committed), the lanes that ran and
// ship (branch, target). Nothing here is written by an agent: the App draws it
// (`GET /api/tasks/:id/walkthrough`), and the `ql:` sections of 03-verify.md render parts of it as
// Markdown (pages/sections/review.ts). JSON-plain, so the App
// imports its type and reads it as the route sends it.

import type { Note, Verdict } from "../docs/build-log.ts"
import {
  allTasks,
  dependenciesOf,
  type Outline,
  type SliceColumn,
  sliceColumns,
} from "../docs/outline.ts"
import { type LaneRow, laneNameOf } from "../pages/lanes.ts"
import type { DonePoint, PageState, ProofRow } from "../pages/render.ts"
import { lineTotal } from "./line-counts.ts"
import type { AcceptanceAsRun } from "./screen-evidence.ts"
import type { WalkScreen } from "./screens.ts"
import type { ChangesByTask } from "./summary.ts"
import {
  agentText,
  decisionsOf,
  evidenceOf,
  fileOf,
  isUncommitted,
  notDoingOf,
  plain,
  type RiskAtMerge,
  riskAtMerge,
  slicePointsOf,
  uncommittedOf,
} from "./walkthrough-parts.ts"
import { readWalkthrough, roundCommitsOf } from "./walkthrough-read.ts"

export { decisionsOf, notDoingOf, type RiskAtMerge, readWalkthrough, riskAtMerge, roundCommitsOf }

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

/** What the page state already holds that the walkthrough reads (pages/state.ts). */
export type WalkSources = Pick<PageState, "done" | "proof" | "records" | "ship">

const sum = lineTotal

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
