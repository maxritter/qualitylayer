// A build too large for one judge is judged by several, side by side. Each gets a
// share: consecutive slices with their tasks and the scenarios that run after them. For a Plan
// listed by Done means point (its task cards write *Proof order* and no scenario) a share is a set of
// step ids instead: the steps split, not scenarios. One more share is the diff-wide review. The
// shares follow from the outline the assignment holds and, for a re-check, its points and
// iteration 1's share count, so the brief handed out and the check of the record agree without
// storing the shares.

import type { Outline, OutlineTask } from "../outline.ts"

/**
 * What one judge can cover in its budget. It cites the CLI's recorded checks instead of running
 * them again, and polish and security own what it no longer reviews. Shares are the overflow path
 * for a build past this; the split proposal (above 25 tasks) should make them rare.
 */
export const JUDGE_CAPACITY = { tasks: 30, scenarios: 10 } as const

/** At most this many judges take slices; the diff-wide review is one more. */
const MAX_SLICE_SHARES = 6

/** A scenario weighs as much as this many tasks when slices are divided. */
const SCENARIO_WEIGHT = 3

export type JudgeShare = {
  /** 1-based; the diff-wide share is the last. */
  n: number
  of: number
  kind: "slices" | "diff"
  /** The slices this share judges; the diff-wide share reviews them all. */
  slices: number[]
  /** Tasks whose definition of done this share audits; none for the diff-wide share. */
  tasks: string[]
  /** Scenarios this share runs, those that run after its slices; none for the diff-wide share. */
  scenarios: number[]
  /** The Acceptance test's steps (`A3`) this share runs, in a points Plan's build; none otherwise and for the diff-wide share. */
  steps: string[]
  /** The minutes its judge is told it has. */
  minutes: number
  /** The share needs live evidence, as for a scenario, security point or whole-diff review. */
  live: boolean
}
const TEST_COMMAND =
  /\b(?:bun(?:\s+run)?\s+test|npm\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|yarn\s+test|vitest|jest|pytest|cargo\s+test|go\s+test)\b/i
const SECURITY_POINT =
  /\b(?:security|trust boundary|authori[sz]\w*|credentials?|secrets?|permissions?|injection)\b/i

/** A task whose proof is a test: a `verify:` bullet runs one, and the card names no security point. */
const provedByTest = (task: OutlineTask): boolean =>
  task.dod.some((bullet) => /^verify:/i.test(bullet) && TEST_COMMAND.test(bullet)) &&
  !SECURITY_POINT.test(task.text)

const SLICE_MINUTES = (tasks: number, scenarios: number) =>
  Math.min(30, Math.max(10, Math.ceil(tasks / 2 + scenarios * 2)))
const DIFF_MINUTES = 15

/** The index of the slice after which a scenario runs; a scenario with no valid slice runs after the last. */
function ownerIndex(outline: Outline, runsAfter: number | null): number {
  const last = outline.slices.length - 1
  if (runsAfter === null) return last
  let index = 0
  outline.slices.forEach((slice, i) => {
    if (slice.n <= runsAfter) index = i
  })
  return index
}

/** One slice's tasks and the scenarios that run after it: what a judge of its group covers. */
type Piece = { n: number; tasks: OutlineTask[]; scenarios: number[] }

/**
 * Divide the pieces into `count` consecutive groups as even as the pieces allow, one share each,
 * and add the diff-wide share that reviews every slice in `all`.
 */
function divide(pieces: Piece[], count: number, all: number[]): JudgeShare[] {
  const weights = pieces.map((p) => p.tasks.length + SCENARIO_WEIGHT * p.scenarios.length)
  const total = weights.reduce((sum, w) => sum + w, 0)

  // Close a group once it holds its even part of the weight, leaving a piece for each group to come.
  const groups: Piece[][] = [[]]
  let seen = 0
  pieces.forEach((piece, i) => {
    groups[groups.length - 1]?.push(piece)
    seen += weights[i] ?? 0
    const left = pieces.length - 1 - i
    const toCome = count - groups.length
    if (toCome > 0 && (seen >= (total * groups.length) / count || left <= toCome)) groups.push([])
  })

  const shares: JudgeShare[] = groups.map((group, index) => {
    const tasks = group.flatMap((p) => p.tasks)
    const scenarios = group.flatMap((p) => p.scenarios)
    return {
      n: index + 1,
      of: count + 1,
      kind: "slices",
      slices: group.map((p) => p.n),
      tasks: tasks.map((t) => t.id),
      scenarios,
      steps: [],
      minutes: SLICE_MINUTES(tasks.length, scenarios.length),
      live: scenarios.length > 0 || tasks.some((t) => !provedByTest(t)),
    }
  })
  shares.push({
    n: count + 1,
    of: count + 1,
    kind: "diff",
    slices: all,
    tasks: [],
    scenarios: [],
    steps: [],
    minutes: DIFF_MINUTES,
    // The diff-wide review stays on the judge's model: in the handover task it caught real defects
    // in both rounds (Max, 4 November 2026: balance quality, cost and speed, not the cheapest option).
    live: true,
  })
  return shares
}

/**
 * Steps one judge runs in its budget: the task capacity, because a step is a line (one action, one
 * expected result), not a scenario of several. Measured on 10 November 2026: twelve steps on one
 * slice were split three ways, doubling the run's helper calls and cost.
 */
const STEPS_PER_JUDGE = 30

/** The cards order the proof of the Plan's Done means: *Proof order*. */
export const stepsAreProved = (outline: Outline): boolean => (outline.proofOrder ?? []).length > 0

/** A step's number: `A12` is 12. */
const stepNumber = (id: string): number => Number(id.replace(/\D/g, ""))

/**
 * A points build's shares: the steps in the order they can first run, divided into as many even
 * consecutive sets as the build needs, and the diff-wide share that records the checks and the
 * review. The set a step falls in does not depend on which tasks a slice holds.
 */
function stepShares(outline: Outline): JudgeShare[] {
  const slices = outline.slices
  const sliceOf = new Map<string, number>()
  for (const line of outline.proofOrder) if (!sliceOf.has(line.id)) sliceOf.set(line.id, line.slice)
  const last = slices[slices.length - 1]?.n ?? 1
  const order = [...sliceOf].map(([id, slice]) => ({
    id,
    slice: slices.some((s) => s.n === slice) ? slice : last,
  }))
  order.sort(
    (a, b) =>
      ownerIndex(outline, a.slice) - ownerIndex(outline, b.slice) ||
      stepNumber(a.id) - stepNumber(b.id),
  )
  // Never more shares than slices, as in judgeShares: a one-slice build is one reviewer.
  const count = Math.min(Math.ceil(order.length / STEPS_PER_JUDGE), MAX_SLICE_SHARES, slices.length)
  if (count < 2) return []
  const shares: JudgeShare[] = []
  const size = order.length / count
  for (let index = 0; index < count; index++) {
    const group = order.slice(Math.round(index * size), Math.round((index + 1) * size))
    shares.push({
      n: index + 1,
      of: count + 1,
      kind: "slices",
      slices: [...new Set(group.map((s) => s.slice))],
      tasks: [],
      scenarios: [],
      steps: group.map((s) => s.id),
      minutes: SLICE_MINUTES(0, group.length),
      live: true,
    })
  }
  shares.push({
    n: count + 1,
    of: count + 1,
    kind: "diff",
    slices: slices.map((slice) => slice.n),
    tasks: [],
    scenarios: [],
    steps: [],
    minutes: DIFF_MINUTES,
    live: true,
  })
  return shares
}

/**
 * The judges' shares for an outline; empty when one judge covers it, which is today's
 * behaviour. Slices are divided into as many consecutive groups as the build needs, as even
 * as the slices allow, and a last share reviews the whole diff.
 */
export function judgeShares(outline: Outline, iteration = 1): JudgeShare[] {
  // A re-check is one judge: judge-rerun.md scopes it to what failed and what the fix touched, and
  // the judge chooses that scope (Max, 4 November 2026). Splitting it again re-read the whole build
  // three times over for a dozen points.
  if (iteration > 1) return []
  if (stepsAreProved(outline)) return stepShares(outline)
  const slices = outline.slices
  const tasks = slices.reduce((sum, slice) => sum + slice.tasks.length, 0)
  const wanted = Math.ceil(tasks / JUDGE_CAPACITY.tasks)
  const count = Math.min(wanted, MAX_SLICE_SHARES, slices.length)
  if (count < 2) return []

  const pieces: Piece[] = slices.map((slice) => ({ n: slice.n, tasks: slice.tasks, scenarios: [] }))
  return divide(
    pieces,
    count,
    slices.map((slice) => slice.n),
  )
}

/** What a share covers in a few words, for a brief and for an error that names a missing share. */
export function describeShare(share: JudgeShare): string {
  if (share.kind === "diff") return `the diff-wide review (share ${share.n} of ${share.of})`
  if (share.steps.length > 0)
    return `share ${share.n} of ${share.of} (step${share.steps.length === 1 ? "" : "s"} ${share.steps.join(", ")})`
  const range =
    share.slices.length === 1
      ? `slice ${share.slices[0]}`
      : `slices ${share.slices[0]} to ${share.slices[share.slices.length - 1]}`
  const scenarios =
    share.scenarios.length > 0
      ? `, scenario${share.scenarios.length > 1 ? "s" : ""} ${share.scenarios.join(", ")}`
      : ""
  return `share ${share.n} of ${share.of} (${range}: ${share.tasks.length} task${share.tasks.length === 1 ? "" : "s"}${scenarios})`
}
