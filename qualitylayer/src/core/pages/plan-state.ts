// What the two QualityLayer sections of a task's Plan are drawn from: the Plan's review
// (*Reviewed by*, from reviews/plan.md and the review's state) and the answers the person gave
// (*Decided with you*, from the Plan's answered questions and the Your calls). Read once per
// refresh by state.ts; sections/plan.ts turns them into text.

import type { Ctx } from "../../ctx.ts"
import { modelName } from "../agents/model-values.ts"
import { readBaseline } from "../gate/baseline.ts"
import { readRun, reasonOf, reviewFile } from "../review/cross.ts"
import { reviewFindings } from "../task/items.ts"
import type { Task } from "../task/store.ts"
import type { Answered, PlanReviewState } from "./render.ts"
import { decisionBlocks, yourCallsOf } from "./your-calls.ts"

const read = async (ctx: Ctx, path: string) =>
  (await ctx.fs.exists(path)) ? await ctx.fs.readFile(path) : ""

type PlanRun = NonNullable<Awaited<ReturnType<typeof readRun>>>

function planReviewLabel(run: PlanRun): string {
  // A panel names the reviewers whose review stands; one that did not answer is not named here
  // (the review file says so).
  const standing = run.panel?.members.filter((m) => m.round1 === "running" || m.round1 === "done")
  if (standing !== undefined) {
    // Nobody answered: the label names no one, and ends without a dangling separator.
    return ["Review panel", standing.map((m) => m.name).join(", ")].filter(Boolean).join(" · ")
  }
  if (run.kind === "sonnet") return `Plan review · ${run.name} (fresh session)`
  const base = `Second opinion · ${run.name}, ${modelName(run.by, run.model)}`
  return run.kind === "same-family" ? `${base} (no other maker's model available)` : base
}

function planReviewFindings(done: boolean, text: string): PlanReviewState["findings"] {
  if (!done) return []
  return reviewFindings(text).map((f) => ({
    what: f.what,
    ...(f.panel !== undefined ? { panel: f.panel } : {}),
    ...(f.stance !== undefined ? { stance: f.stance } : {}),
    ...(f.answer !== undefined ? { answer: f.answer } : {}),
  }))
}

/** The Plan's review as the document names it; undefined while none has started. */
export async function planReviewState(ctx: Ctx, task: Task): Promise<PlanReviewState | undefined> {
  const run = await readRun(ctx, task, "plan")
  if (run === null) return undefined
  const text = await read(ctx, reviewFile(task, "plan"))
  const done = run.state === "done"
  const verdict = done
    ? (text.match(/^(APPROVE|REVISE[^\n]*|BLOCK[^\n]*)/m)?.[1]?.trim() ?? null)
    : null
  return {
    label: planReviewLabel(run),
    state: run.state,
    ...(run.state === "failed" ? { reason: reasonOf(run) } : {}),
    verdict,
    ...(run.state === "running" && run.panel !== undefined ? { round: run.panel.round } : {}),
    findings: planReviewFindings(done, text),
  }
}

/** The words of a call's answer: the option the person picked. */
const pickedOption = (answer: Answered | undefined, recommended: "A" | "B"): string | undefined => {
  if (answer === undefined) return undefined
  const letter = answer.note
    ?.trim()
    .match(/^([AB])\b/i)?.[1]
    ?.toUpperCase()
  if (letter !== undefined) return letter
  return answer.kind === "agree" ? recommended : answer.kind === "change" ? "B" : undefined
}

/**
 * Every answer the person gave that the Plan rests on, with its kind: the questions the Plan asked
 * (`asked`, as *Decided with you* lists them), and each Your call of the Plan they answered.
 */
export async function decidedByYou(
  ctx: Ctx,
  task: Task,
  plan: string,
  decides: Record<string, Answered | undefined>,
  asked: readonly { what: string; answer: string }[],
): Promise<{ step: string; what: string; answer: string }[]> {
  const rows: { step: string; what: string; answer: string }[] = asked.map((row) => ({
    step: "Question",
    what: row.what,
    answer: row.answer,
  }))
  // A Your call: the decision's own title and the option picked (A or B). A call kept in the
  // baseline at approval is read from that record, whatever a later edit made of its block; one
  // approved before the record existed is read from the block as it stands.
  const kept = (await readBaseline(ctx, task))?.yourCalls ?? {}
  const standing = yourCallsOf(plan)
  for (const block of decisionBlocks(plan)) {
    if (block.id === undefined) continue
    const call = kept[block.id] ?? standing[block.id]
    // Old approved records lacked a recommendation and retain their original A mapping.
    const picked = pickedOption(decides[block.id], call?.recommended ?? "A")
    if (call === undefined || (picked !== "A" && picked !== "B")) continue
    const option = call[picked]
    rows.push({
      step: "Your call",
      what: call.what,
      answer: option !== undefined ? `${picked} · ${option}` : picked,
    })
  }
  return rows
}
