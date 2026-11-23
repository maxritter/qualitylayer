// What needs a person, per step, computed from the task's documents and state: the one shape
// (core/items.ts) every surface draws, so the App never parses Markdown for it. Each step has its
// sources here (the Plan, the final review); state comes from the answers stored as comments, the
// gate, and decided.json, which says what each earlier decision covered.
//
//   open     no answer yet
//   chosen   an answer saved as a draft: it goes with the next decision
//   sent     the agent has it (a decision delivered it); its reply shows when there is one
//   settled  its gate was decided and it was answered or approved with it, and it has not changed
//
// An item the agent changed since a decision covered it opens again with `changedSinceReview`;
// one that changes under an unsent answer is `updated` and the answer stays.

import type { Ctx } from "../../ctx.ts"
import { folderDoc } from "../docs/names.ts"
import { doneMeans } from "../done-means.ts"
import { readComments } from "../gate/comments.ts"
import { readDecided } from "../gate/decided.ts"
import type { GateFile } from "../gate/gate.ts"
import { type Item, orderItems, resolveItem, type StepChecks, type StepParts } from "../items.ts"
import { readHandback } from "./handback.ts"
import { checkFacts, findingItems, noteItems } from "./items-findings.ts"
import { clipText, FINAL, makeItem, plainText, stampItems } from "./items-helpers.ts"
import { askedItems, planItems, planParts, teammateItems } from "./items-plan.ts"
import { reviewItems } from "./items-review.ts"
import { applyPointAgreements, pointAgreements } from "./point-confirmations.ts"
import type { Task } from "./store.ts"
import { readVerifyMode } from "./verify-mode.ts"

export { decideIds, decisionItems, engineeringDecisions } from "./items-decisions.ts"
export { noteItems, reviewFindings } from "./items-findings.ts"
export { planLists } from "./items-plan.ts"
export { openedChecks } from "./items-review.ts"
export { doneMeans }

export type TaskPage = {
  items: Item[]
  parts: StepParts
  checked: StepChecks
}

function handbackPage(handback: NonNullable<Awaited<ReturnType<typeof readHandback>>>): TaskPage {
  return {
    items: [
      makeItem({
        id: "plan:handback:1",
        step: "plan",
        kind: "handback",
        what: clipText(plainText(handback.words !== "" ? handback.words : handback.title), 220),
        ...(handback.reason !== "" ? { why: handback.reason } : {}),
        ...(handback.prompt !== ""
          ? { media: { kind: "prompt" as const, text: handback.prompt } }
          : {}),
      }),
    ],
    parts: {},
    checked: { plan: [] },
  }
}

async function shouldShowVerifyReview(
  ctx: Ctx,
  task: Task,
  gate: GateFile | null,
): Promise<boolean> {
  if (task.stage === "shipped" || gate?.target === FINAL) return true
  const mode = await readVerifyMode(ctx, task)
  return mode === "yours" || mode === "rechecking"
}

/**
 * Everything the step pages draw from the documents and state: the items of every step the task has
 * reached, with their state, in the order a person reads them (blocking first, settled last, per
 * step), the lists around them, and the facts for the violet lines. `gate` is the task's gate
 * file, which the caller may have read already.
 */
export async function taskPage(ctx: Ctx, task: Task, gate: GateFile | null): Promise<TaskPage> {
  if (task.type === "chat") return { items: [], parts: {}, checked: { plan: [] } }
  // A hand-back keeps its Plan file when present; its one action item is the prompt to copy.
  const handback = await readHandback(ctx, task)
  if (handback !== null) return handbackPage(handback)
  const [comments, decided, asked, finding, teammates, parts] = await Promise.all([
    readComments(ctx, task),
    readDecided(ctx, task),
    askedItems(ctx, task),
    findingItems(ctx, task),
    teammateItems(ctx, task),
    planParts(ctx, task),
  ])
  const env = {
    comments,
    decided,
    ...(gate?.revision !== undefined ? { revision: gate.revision } : {}),
  }
  const out: Item[] = []
  // A finding the agent answered stays settled: nothing the person did or a gate decided reopens it.
  const resolve = (item: Item) =>
    (item.kind === "finding" && item.state === "settled") ||
    (item.kind === "confirm" && item.step === "verify")
      ? item
      : resolveItem(item, env)
  const plan = stampItems([...asked, ...(await planItems(ctx, task))])
  const notes = stampItems(noteItems(comments, gate?.target === folderDoc("plan") ? gate : null))
  const planAll = applyPointAgreements(
    [...plan, ...stampItems(finding.items), ...stampItems(teammates), ...notes].map(resolve),
    await pointAgreements(ctx, task, comments),
  )
  // A note that is still open arrived with the agent's answer: it is new since the last review.
  const marked = planAll.map((item) =>
    item.kind === "note" && item.state === "open" ? { ...item, changedSinceReview: true } : item,
  )
  out.push(...orderItems(marked))
  if (await shouldShowVerifyReview(ctx, task, gate)) {
    const changeFindings = await findingItems(ctx, task, "verify")
    const review = stampItems([...(await reviewItems(ctx, task)), ...changeFindings.items]).map(
      resolve,
    )
    out.push(...orderItems(review))
  }
  return {
    items: out,
    parts: { plan: parts },
    checked: await checkFacts(ctx, task, finding.line),
  }
}

/** The task's items alone; see `taskPage`. */
export async function taskItems(ctx: Ctx, task: Task, gate: GateFile | null): Promise<Item[]> {
  return (await taskPage(ctx, task, gate)).items
}
