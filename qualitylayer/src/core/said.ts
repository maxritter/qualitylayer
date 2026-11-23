// What the judges have said of each item of the current round: the build log's record, then the
// live `qualitylayer verdict` calls while the round is open. Once the round is written, the log
// alone stands. Also which items are the person's to confirm.

import type { Ctx } from "../ctx.ts"
import { proofOf } from "./acceptance.ts"
import { type BuildLog, readBuildRecord, type Verdict } from "./docs/build-log.ts"
import { type ProofList, stepsOfPoint } from "./docs/proof-list.ts"
import { recheckOf } from "./recheck.ts"
import type { Task } from "./task/store.ts"
import { itemId, readVerdicts, reviewCard } from "./verdicts.ts"
import { type Assignment, evidenceExists, readAssignment } from "./verification.ts"

export type Said = {
  state: "passed" | "failed" | "user"
  text: string
  evidence?: string
  carried?: true
  /** The card a failing `review` line names (`[MISSING] review: T3 …`). */
  card?: string
}

const cardOf = (id: string, state: Said["state"], text: string): { card?: string } => {
  const card = id === "review" && state === "failed" ? reviewCard(text) : null
  return card === null ? {} : { card }
}

const VERDICT_STATE: Record<string, Said["state"]> = {
  fail: "failed",
  missing: "failed",
  user: "user",
}

const verdictState = (verdict: string): Said["state"] =>
  VERDICT_STATE[verdict.toLowerCase()] ?? "passed"

function passedPointSaid(judged: { step: { id: string }; said: Said }[]): Said {
  const evidence = judged.find((s) => s.said.evidence !== undefined)?.said.evidence
  return {
    state: "passed",
    text: judged.map((s) => `${s.step.id}: ${s.said.text}`).join(" · "),
    ...(evidence !== undefined ? { evidence } : {}),
    ...(judged.every((s) => s.said.carried === true) ? { carried: true as const } : {}),
  }
}

function provePoint(
  point: ProofList["points"][number],
  list: ProofList,
  items: Map<string, Said>,
): void {
  const key = `done:${point.n}`
  const steps = stepsOfPoint(list, point.n).map((step) => ({
    step,
    said: items.get(`acceptance:${step.id}`),
  }))
  if (steps.length === 0) return
  const failed = steps.find((s) => s.said?.state === "failed")
  if (failed?.said !== undefined) {
    items.set(key, {
      state: "failed",
      text: `Step ${failed.step.id} fails: ${failed.said.text}`,
      ...(failed.said.evidence !== undefined ? { evidence: failed.said.evidence } : {}),
    })
    return
  }
  const written = items.get(key)
  if (written?.state === "failed") return
  const judged = steps.flatMap((s) => (s.said === undefined ? [] : [{ ...s, said: s.said }]))
  if (judged.length < steps.length) {
    items.delete(key)
    return
  }
  const theirs = judged.find((s) => s.said.state === "user")
  if (theirs !== undefined) items.set(key, { state: "user", text: theirs.said.text })
  else if (written?.state !== "user") items.set(key, passedPointSaid(judged))
}

/**
 * A Done means point is proven by its steps: proven when every step under it
 * passes, failed when one fails (or is missing), the person's when one is theirs and the rest
 * pass, open otherwise. The reader of the verdicts, not a line of anyone's record: a `done` line a
 * reviewer still writes cannot prove a point its steps do not, and a failing one fails it.
 */
function provePoints(list: ProofList, items: Map<string, Said>): void {
  for (const point of list.points) provePoint(point, list, items)
}

/**
 * In a recheck the steps this round did not rule on stand as an earlier round
 * left them: the latest PASS (or the person's USER) with its evidence, marked carried. A step the
 * round has a verdict for is its own. While the round is open a pass whose evidence is gone is not
 * carried; a round already counted was read when its files were there.
 */
async function carryPasses(
  ctx: Ctx,
  task: Task,
  assignment: Assignment,
  log: BuildLog | null,
  items: Map<string, Said>,
): Promise<void> {
  const recheck = await recheckOf(
    ctx,
    task.runtimeDir,
    assignment,
    log?.verification ?? [],
    assignment.iteration > task.iterations ? evidenceExists(ctx, task) : undefined,
  )
  for (const [id, step] of recheck?.carried ?? []) {
    if (items.has(`acceptance:${id}`)) continue
    items.set(`acceptance:${id}`, {
      state: step.verdict === "USER" ? "user" : "passed",
      text: step.text,
      carried: true,
      ...(step.evidence[0] !== undefined ? { evidence: step.evidence[0] } : {}),
    })
  }
}

/** What a recorded round's lines say, by item: a failing line of an item (a review has several) makes it fail. */
function groupVerdicts(verdicts: readonly Verdict[]): Map<string, Said> {
  const grouped = new Map<string, Said>()
  for (const v of verdicts) {
    const id = itemId(`${v.kind} ${v.subject}`.trim())
    if (id === null || id === "check") continue
    const state = verdictState(v.verdict)
    if (grouped.get(id)?.state === "failed" && state !== "failed") continue
    grouped.set(id, { state, text: v.text, ...cardOf(id, state, v.text) })
  }
  return grouped
}

const VERDICT_OF: Record<Said["state"], Verdict["verdict"]> = {
  passed: "PASS",
  failed: "FAIL",
  user: "USER",
}

/**
 * A recorded round's lines for the readers that hold the round's verdicts and not the live record
 * (the person's review, the pull request body, the Verify page's proof rows): each Done means point
 * carries the result `provePoints` derives from its steps, in place of any `done` line written for
 * it. The one derivation, read from the lines of a round.
 */
export function withPointVerdicts(list: ProofList, verdicts: readonly Verdict[]): Verdict[] {
  const items = groupVerdicts(verdicts)
  provePoints(list, items)
  const points = new Set(list.points.map((point) => String(point.n)))
  const derived = list.points.flatMap((point): Verdict[] => {
    const proven = items.get(`done:${point.n}`)
    return proven === undefined
      ? []
      : [
          {
            verdict: VERDICT_OF[proven.state],
            kind: "done",
            subject: String(point.n),
            text: proven.text,
            line: 0,
          },
        ]
  })
  return [...verdicts.filter((v) => !(v.kind === "done" && points.has(v.subject))), ...derived]
}

/** The verdicts a round holds, by item: what the build log recorded, then the judges' live calls. */
export async function said(
  ctx: Ctx,
  task: Task,
  log: BuildLog | null,
): Promise<{ items: Map<string, Said>; open: boolean }> {
  const items = new Map<string, Said>()
  const assignment = await readAssignment(ctx, task)
  if (assignment === null) return { items, open: false }
  const own = log?.verification.find((i) => i.assignment === assignment.id)
  for (const [id, v] of groupVerdicts(own?.verdicts ?? [])) items.set(id, v)
  // A round the build log recorded stands as written: a late or stray call cannot contradict it.
  const recorded = own?.result !== undefined && own.result !== null
  for (const [id, v] of recorded ? [] : await readVerdicts(ctx, task, assignment.id)) {
    const state = verdictState(v.verdict)
    items.set(id, {
      state,
      text: v.text,
      ...(v.evidence !== undefined ? { evidence: v.evidence } : {}),
      ...cardOf(id, state, v.text),
    })
  }
  await carryPasses(ctx, task, assignment, log, items)
  provePoints(await proofOf(ctx, task), items)
  return { items, open: assignment.result === undefined }
}

/**
 * The Done means points that are the person's to confirm: the ones a judge recorded as `user`, or
 * whose steps it did. Nothing else can be attested, and a step is attested through its point.
 */
export async function personPointIds(ctx: Ctx, task: Task): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const [id, v] of (await said(ctx, task, await readBuildRecord(ctx, task))).items)
    if (v.state === "user" && id.startsWith("done:")) ids.add(id)
  return ids
}
