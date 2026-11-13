import { DEMO_TASK_ID } from "../identity.ts"
// The demo's task at any of its moments: Plan, Implement and Verify. It is reached with
// `?moment=<id>` on the demo address and `#/task/demo`; without `?moment=` the demo has no such
// task, so the existing demo pages and checks are unchanged.
//
// This module lays the task's shape (stage, Verify's mode, files, gate, session, pages) from
// `moments.ts` and the documents from `documents.ts`; the areas (`research.ts`, `batch.ts`,
// `plan.ts`, `cards.ts`, `implement.ts`, `verify.ts`, `review.ts`) add their own content through
// `Area`, each in its own file.

import { type DocRole, STEPS, type Step, taskFiles } from "../../../core/docs/names.ts"
import { FLOW_STEPS, flowStepOf } from "../../../core/flow.ts"
import type { Item } from "../../../core/items.ts"
import { type DocSections, splitSections } from "../../../server/doc-sections-split.ts"
import type { TaskDetail } from "../../api.ts"
import { flagshipTask } from "../flagship.ts"
import { verifyModeField } from "../verify-mode.ts"
import type { Area } from "./area.ts"
import { batch } from "./batch.ts"
import { budget as budgetArea } from "./budget.ts"
import { cards as cardsArea } from "./cards.ts"
import {
  TASK_AGENT_DOCUMENTS,
  TASK_AGENT_FILES,
  TASK_BASE_DOCUMENTS,
  TASK_FILES,
} from "./documents.ts"
import { handback as handbackArea } from "./handback.ts"
import { implement as implementArea } from "./implement.ts"
import { light as lightArea } from "./light.ts"
import { MOMENT_IDS, MOMENTS, type Moment } from "./moments.ts"
import { outsideArea } from "./outside.ts"
import { stepPage } from "./page.ts"
import { plan as planArea } from "./plan.ts"
import { pullRequest as pullRequestArea } from "./pull-request.ts"
import { questionMore } from "./question-more.ts"
import { research as researchArea } from "./research.ts"
import { review as reviewArea } from "./review.ts"
import { BUG_RULES, RULES } from "./sections.ts"
import { status as statusArea } from "./status.ts"
import { story as storyArea } from "./story.ts"
import { verify as verifyArea } from "./verify.ts"

export { DEMO_TASK_ID } from "../identity.ts"
export { MOMENT_IDS, type Moment, TASK_AGENT_FILES, TASK_FILES }

const SLUG = "usage-based-billing"
const PROJECT = "acme/platform"

/** The areas, in the order they patch a task. */
const AREAS: Area[] = [
  researchArea,
  batch,
  questionMore,
  planArea,
  cardsArea,
  implementArea,
  verifyArea,
  reviewArea,
  pullRequestArea,
  statusArea,
  // Last: the model's usage-billing story over what the flagship base brought.
  storyArea,
  // After the story: a light task changes what makes it light, over the billing task.
  budgetArea,
  lightArea,
  // A change handed back as too small: closed at Plan, no agent at work.
  handbackArea,
  // Last: a build outside the App sets the lead and the live signals the Agent tab follows.
  outsideArea,
]

/** The moment the address asks for: `?moment=plan-approve`. */
export function momentFrom(search: string): Moment | undefined {
  const asked = new URLSearchParams(search).get("moment")
  return MOMENT_IDS.find((moment) => moment === asked)
}

/** Which steps have their file at a moment: every step up to the one the task is at. */
function writtenSteps(moment: Moment): Set<Step> {
  const where = MOMENTS[moment]
  const at = STEPS.indexOf(flowStepOf(where.stage) ?? "plan")
  const written = new Set<Step>(STEPS.filter((_, index) => index <= at))
  for (const step of where.absent ?? []) written.delete(step)
  return written
}

/** A file's text at a moment: an area's own document, else the base one. */
export function taskDocument(name: string): string | undefined {
  for (const area of [...AREAS].reverse()) {
    const own = area.documents?.[name]
    if (own !== undefined) return own
  }
  return TASK_BASE_DOCUMENTS[name] ?? TASK_AGENT_DOCUMENTS[name]
}

/** A document cut into sections with each one's show and writer, as the server's endpoint serves it. */
export function taskSections(
  name: string,
  markdown = taskDocument(name),
  type?: string,
): DocSections | undefined {
  if (markdown === undefined) return undefined
  const role = Object.entries(TASK_FILES).find(([, file]) => file === name)?.[0] ?? null
  const rules = (type === "bugfix" ? BUG_RULES[name] : undefined) ?? RULES[name] ?? []
  return { name, role, ...splitSections(markdown, rules) }
}

/** A question of a batch, open: just enough for the track and the Files tab; the batch area replaces it. */
const openQuestion = (n: number): Item => ({
  id: `plan:ask:${n}`,
  step: "plan",
  family: "answer",
  kind: "question",
  kindLabel: "Question",
  what: `Question ${n}`,
  answers: { options: ["reply"] },
  blocking: true,
  state: "open",
})

/** The flagship's task as the closest finished-in-shape base: its timeline, slices and cost-free fields. */
function baseFor(stage: string): TaskDetail {
  const at = stage === "implement" ? "implement" : stage === "verify" ? "verify" : "plan"
  return structuredClone(flagshipTask(at))
}

export function demoTask(moment: Moment, now = Date.now()): TaskDetail {
  const where = MOMENTS[moment]
  const written = writtenSteps(moment)
  const base = baseFor(where.stage === "shipped" ? "verify" : where.stage)
  const built = ["implement", "verify", "shipped"].includes(where.stage)
  const files = taskFiles(PROJECT, SLUG, "feature", (role: DocRole) => written.has(role))
  const entries = STEPS.map((step) => {
    const here = flowStepOf(where.stage) === step
    return {
      name: TASK_FILES[step],
      label: FLOW_STEPS.find((s) => s.id === step)?.label ?? step,
      exists: written.has(step),
      status: here && where.waits === "plan" ? "review" : "",
      approved: false,
    }
  })
  const gate =
    where.waits === "plan"
      ? {
          id: "demo-plan",
          target: TASK_FILES.plan,
          targets: [TASK_FILES.plan],
          opened: now - 6 * 60_000,
          decision: "pending",
          settled: false,
        }
      : where.waits === "final"
        ? {
            id: "demo-final",
            target: "final",
            targets: ["final"],
            opened: now - 4 * 60 * 60_000,
            decision: "pending",
            settled: false,
          }
        : null
  const items = Array.from({ length: where.stage === "plan" ? (where.open ?? 0) : 0 }, (_, i) =>
    openQuestion(i + 1),
  )
  const task: TaskDetail = {
    ...base,
    id: DEMO_TASK_ID,
    title: "Usage-based billing",
    slug: SLUG,
    answers: "app",
    projectName: PROJECT,
    files,
    docs: entries,
    stage: where.stage,
    ...verifyModeField(where.mode ?? null),
    iterations: where.mode === "yours" || where.mode === "rechecking" ? 2 : 0,
    gate: gate as TaskDetail["gate"],
    action:
      where.waits === "plan"
        ? "review"
        : where.waits === "final"
          ? "final"
          : where.starting === true
            ? "implement"
            : null,
    session: {
      agent: "claude-code",
      phase: where.stage,
      state: where.session === "waiting" ? "waiting" : "busy",
      heartbeat: where.session === "quiet" ? now - 7 * 60_000 : now,
      since: now - 40 * 60_000,
      checkout: "/demo/acme/platform",
    },
    progress: built ? base.progress : null,
    comments: [],
    items,
    openItems: items.length,
    timeline: built ? base.timeline : null,
    slices: built ? base.slices : [],
    implementStart:
      where.starting === true || built ? flagshipTask("implement").implementStart : null,
    buildLog: built ? base.buildLog : null,
    quality: built ? base.quality : [],
    verification: built ? base.verification : [],
    prDescription:
      where.mode === "yours" || where.mode === "rechecking" ? base.prDescription : null,
    pages: STEPS.map((step) =>
      stepPage(step, written.has(step) ? (taskDocument(TASK_FILES[step]) ?? null) : null),
    ),
  }
  return AREAS.reduce((t, area) => area.patch?.(t, moment) ?? t, task)
}

/** The words of the agent's state at a moment, for the status chip. */
export const agentWords = (moment: Moment): string => MOMENTS[moment].words
