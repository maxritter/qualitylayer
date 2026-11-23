// What a recheck round after a fix holds, for a Plan listed by Done means point (`points`). The
// round is complete with a verdict for each step that did not pass, each step the reviewer chose
// to run again, and one for the diff of the fix. Every other pass stands: QualityLayer carries the
// latest earlier PASS (or USER) of a step into the round, with its evidence, and only while that
// evidence is still in the task folder and the step's text is the one it was judged under.
//
// Nothing is stored: the standing result of a step is read from the Verify record and the
// assignments the rounds were handed out under. A Plan with numbered steps (`flat`) is not asked.

import { join } from "node:path"
import type { Ctx } from "../ctx.ts"
import { type Iteration, readBuildRecord, type Verdict } from "./docs/build-log.ts"
import { evidenceIn } from "./docs/outline.ts"

/** The fields of an assignment a recheck reads; the full record is `Assignment` in verification.ts. */
export type RoundAssignment = {
  id: string
  iteration: number
  /** Set when a judge ruled on this round's requirements before: the round is a recheck. */
  after?: { iteration: number; head: string }
  /** The ids of the Plan's Acceptance test steps when the assignment was handed out. */
  acceptance?: string[]
  /** Each step's text then (`A1` → `action → expected`): a carried pass is for that text only. */
  stepTexts?: Record<string, string>
}

/** A step QualityLayer carries into the round: an earlier pass, or the person's, with its evidence. */
export type CarriedStep = {
  id: string
  /** The round that ruled. */
  iteration: number
  verdict: "PASS" | "USER"
  /** The earlier verdict's text as written. */
  text: string
  /** The evidence files it cites; a USER step cites none. */
  evidence: string[]
}

export type Recheck = {
  /** The steps the round needs no verdict for. */
  carried: Map<string, CarriedStep>
  /** The steps the round must record, with why. */
  again: Map<string, string>
}

/** The assignment a round was handed out under: its archive, or the current receipt. */
export async function roundAssignment(
  ctx: Ctx,
  runtimeDir: string | null,
  id: string | undefined,
): Promise<RoundAssignment | null> {
  if (runtimeDir === null || id === undefined || !/^[A-Za-z0-9-]+$/.test(id)) return null
  for (const path of [
    join(runtimeDir, "judgements", `${id}.json`),
    join(runtimeDir, "verification.json"),
  ]) {
    try {
      const record = JSON.parse(await ctx.fs.readFile(path)) as RoundAssignment
      if (record.id === id) return record
    } catch {
      // No archived assignment: the round is read as a full one, which asks for more, never less.
    }
  }
  return null
}

/** Whether a round is a recheck: the only kind that carries anything. */
export const isRecheck = (assignment: RoundAssignment | null): assignment is RoundAssignment =>
  assignment !== null && assignment.after !== undefined

type Standing = {
  verdict: Verdict["verdict"]
  text: string
  iteration: number
  /** The step's text under the assignment that ruled; unknown for a round before step texts were kept. */
  stepText: string | undefined
}

const clip = (text: string): string =>
  text.length <= 80 ? text : `${text.slice(0, 79).trimEnd()}…`

function collectRoundAcceptance(verdicts: readonly Verdict[]): Map<string, Verdict> {
  const said = new Map<string, Verdict>()
  for (const verdict of verdicts) {
    if (verdict.kind !== "acceptance") continue
    const id = verdict.subject.toUpperCase()
    const before = said.get(id)
    // One failing line of a step makes the step fail.
    if (before?.verdict === "FAIL" || before?.verdict === "MISSING") continue
    said.set(id, verdict)
  }
  return said
}

/**
 * The latest result of each step across the rounds before `assignment`'s own: a full round starts
 * the record again, a recheck adds its own verdicts to what stood.
 */
async function standingBefore(
  ctx: Ctx,
  runtimeDir: string | null,
  assignment: RoundAssignment,
  iterations: readonly Iteration[],
): Promise<Map<string, Standing>> {
  let standing = new Map<string, Standing>()
  const earlier = iterations
    .filter((round) => round.n < assignment.iteration)
    .toSorted((a, b) => a.n - b.n)
  for (const round of earlier) {
    const ruled = await roundAssignment(ctx, runtimeDir, round.assignment)
    if (!isRecheck(ruled)) standing = new Map()
    for (const [id, verdict] of collectRoundAcceptance(round.verdicts)) {
      standing.set(id, {
        verdict: verdict.verdict,
        text: verdict.text,
        iteration: round.n,
        stepText: ruled?.stepTexts?.[id],
      })
    }
  }
  return standing
}

async function missingEvidenceReason(
  was: Standing,
  evidence: readonly string[],
  exists: ((path: string) => Promise<boolean>) | undefined,
): Promise<string | null> {
  if (was.verdict !== "PASS" || exists === undefined) return null
  if (evidence.length === 0) return `its pass in iteration ${was.iteration} cites no evidence file`
  const checks = await Promise.all(
    evidence.map(async (path) => ((await exists(path)) ? null : path)),
  )
  const gone = checks.filter((path): path is string => path !== null)
  return gone.length > 0
    ? `its pass in iteration ${was.iteration} cites ${gone.map((p) => `\`${p}\``).join(", ")}, no longer in the task folder`
    : null
}

function stepRerunReason(
  was: Standing | undefined,
  currentText: string | undefined,
): string | null {
  if (was === undefined) return "it was not judged before"
  if (was.verdict !== "PASS" && was.verdict !== "USER") {
    return was.verdict === "NOTE"
      ? `iteration ${was.iteration} recorded only a note for it`
      : `it did not pass in iteration ${was.iteration}: ${clip(was.text)}`
  }
  if (was.stepText === undefined || currentText === undefined)
    return `the text it was judged under in iteration ${was.iteration} was not kept`
  return was.stepText !== currentText ? `its text changed since iteration ${was.iteration}` : null
}

/**
 * What the recheck round handed out under `assignment` holds, or null when it is no recheck of a
 * points Plan. With `exists`, a carried pass whose evidence file is gone is required again; without
 * it (a round already counted, read as it was) the evidence is not looked at.
 */
export async function recheckOf(
  ctx: Ctx,
  runtimeDir: string | null,
  assignment: RoundAssignment | null,
  iterations: readonly Iteration[],
  exists?: (path: string) => Promise<boolean>,
): Promise<Recheck | null> {
  if (!isRecheck(assignment)) return null
  const standing = await standingBefore(ctx, runtimeDir, assignment, iterations)
  const carried = new Map<string, CarriedStep>()
  const again = new Map<string, string>()
  for (const id of assignment.acceptance ?? []) {
    const was = standing.get(id)
    const reason = stepRerunReason(was, assignment.stepTexts?.[id])
    if (reason !== null || was === undefined) {
      again.set(id, reason ?? "it was not judged before")
      continue
    }
    const evidence = was.verdict === "PASS" ? evidenceIn(was.text) : []
    const evidenceIssue = await missingEvidenceReason(was, evidence, exists)
    if (evidenceIssue !== null) {
      again.set(id, evidenceIssue)
      continue
    }
    carried.set(id, {
      id,
      iteration: was.iteration,
      verdict: was.verdict as "PASS" | "USER",
      text: was.text,
      evidence,
    })
  }
  return { carried, again }
}

/**
 * The lines a recheck round carries, as verdict lines (line 0), for a reader that holds a round's
 * verdicts and not the live record: its own lines plus these read the same as `said()` does. A
 * step the round has its own line for is not repeated. Empty for any other round.
 */
export async function carriedVerdicts(
  ctx: Ctx,
  runtimeDir: string | null,
  iterations: readonly Iteration[],
  iteration: Iteration,
): Promise<Verdict[]> {
  const recheck = await recheckOf(
    ctx,
    runtimeDir,
    await roundAssignment(ctx, runtimeDir, iteration.assignment),
    iterations,
  )
  const own = new Set(
    iteration.verdicts.filter((v) => v.kind === "acceptance").map((v) => v.subject.toUpperCase()),
  )
  return [...(recheck?.carried.values() ?? [])]
    .filter((step) => !own.has(step.id))
    .map((step) => ({
      verdict: step.verdict,
      kind: "acceptance",
      subject: step.id,
      text: step.text,
      line: 0,
    }))
}

/**
 * A round's verdicts as its readers must see them: its own lines and, on a recheck round, the
 * passes QualityLayer carried. Without the carried ones a page would show a Done means point
 * unproven because one of its steps was not run again.
 */
export async function roundVerdicts(
  ctx: Ctx,
  task: { dir: string; runtimeDir: string | null },
  iteration: Iteration,
): Promise<Verdict[]> {
  const iterations = (await readBuildRecord(ctx, task)).verification
  return [
    ...iteration.verdicts,
    ...(await carriedVerdicts(ctx, task.runtimeDir, iterations, iteration)),
  ]
}
