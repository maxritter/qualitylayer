// The state a step page draws its live parts from, as plain data: what each marked section shows,
// what needs the person and where it sits, worked out from the task the server sends. The App builds
// it live; the share link builds the same from its copy of the task, in snapshot mode, which leaves
// out everything the agent keeps for itself (task cards, records) and every artifact but its picture.
// Pure: no DOM, no fetch.

import { pointProof } from "../../core/interaction-steps/proof.ts"
import type { ItemAnswer } from "../../core/items.ts"
import type { TaskDetail } from "../api.ts"
import { agentInfo, inReview } from "../model.ts"
import { stepActivity, stepIsWorking } from "../steps/readiness.ts"
import type { StepDocument } from "./document.ts"
import { implementView } from "./state-implement.ts"
import { headingsOf, needsOf } from "./state-index.ts"
import { decidedView, planPreparation, planView } from "./state-plan.ts"
import {
  type ArtifactView,
  type BoardSlice,
  type CardsPlace,
  type Choice,
  cardOf,
  type ImplementView,
  type ItemCard,
  jumpId,
  type Mode,
  OWN_TITLE,
  type ProofRow,
  planAmendsOf,
  type RecordView,
  type StepState,
  type TaskCard,
} from "./state-types.ts"
import { reviewView, verifyView } from "./state-verify.ts"

export {
  type ArtifactView,
  type BoardSlice,
  type CardsPlace,
  type Choice,
  cardOf,
  type ImplementView,
  type ItemCard,
  jumpId,
  type Mode,
  OWN_TITLE,
  type ProofRow,
  planAmendsOf,
  planPreparation,
  type RecordView,
  type StepState,
  type TaskCard,
}

export function stepState(
  task: TaskDetail,
  doc: StepDocument | null,
  options: {
    answers?: Readonly<Record<string, ItemAnswer>>
    mode?: Mode
    now?: number
  } = {},
): StepState {
  const step = doc?.step ?? "plan"
  const answers = options.answers ?? {}
  const mode = options.mode ?? "live"
  const now = options.now ?? Date.now()
  const activity = mode === "live" ? stepActivity(task, now) : undefined
  const base = {
    working: stepIsWorking(task, now),
    ...(activity !== undefined ? { activity } : {}),
    step,
    mode,
    title: task.title,
    agent: agentInfo(task.session?.agent).name,
    at: now,
    closed: task.archived || task.stage === "shipped" || task.stage === "abandoned",
    ...(mode === "live" && task.answers === "terminal" ? { outside: true as const } : {}),
    ...(mode === "live" ? { preparing: planPreparation(task, doc) } : {}),
  }
  const implement = step === "implement" ? implementView(task, mode, now) : undefined
  const parts = {
    ...base,
    ...(mode === "live" && step === "verify" ? { pointProof: pointProof(task) } : {}),
    ...(step === "plan"
      ? { decided: decidedView(task, answers), plan: planView(task, doc, answers, mode) }
      : {}),
    ...(implement !== undefined ? { implement } : {}),
    ...(step === "verify" ? { verify: verifyView(task, answers, mode) } : {}),
    ...(step === "verify" && inReview(task) ? { review: reviewView(task, answers) } : {}),
  }
  return { ...parts, needs: needsOf(parts), headings: headingsOf(parts) }
}
