// The scaling rules applied to one task as its documents stand: the cards' slices, the Plan's
// Size and Trust boundary lines, its questions for helpers, findings and risks, and the user's
// overrides. scaling.ts holds the rules; this reads what they need from disk.

import { join } from "node:path"
import type { Ctx } from "../ctx.ts"
import { agentControlChanges, keptAgentControls } from "./code-quality/scanners/task-scans.ts"
import { readConfig } from "./config.ts"
import { sectionText } from "./docs/build-log.ts"
import { agentFileOf, folderDoc, RESEARCH_QUESTIONS } from "./docs/names.ts"
import { codeSlices, type Outline } from "./docs/outline.ts"
import { cardsPath, readCards, readWrittenCards } from "./docs/outline-files.ts"
import { proseLines } from "./docs/rules/types.ts"
import { approvalCurrent } from "./gate/revision.ts"
import { researchQuestionItems } from "./research-questions.ts"
import { readPlanners } from "./review/planners.ts"
import { otherVendorInstalled } from "./review/vendors.ts"
import {
  type Flow,
  type FlowSignals,
  flowFor,
  flowLine,
  lightPlan,
  planReviewWhen,
} from "./scaling.ts"
import { artifactMarkers, firstLookFiles, smallBounds } from "./small-change.ts"
import { answeredQuestions } from "./task/question.ts"
import { STAGE_ORDER } from "./task/stages.ts"
import { type Task, taskDocPath } from "./task/store.ts"

/**
 * The first prose line of the Plan the pattern matches (a fenced example is no line, as in the
 * validator's rules); the pattern's first group, or null.
 */
function proseMatch(plan: string, pattern: RegExp): string | null {
  for (const { text } of proseLines(plan)) {
    const match = text.match(pattern)
    if (match !== null) return match[1] ?? ""
  }
  return null
}

/** The Plan's `**Trust boundary:** …` value; null without the line. */
export function trustBoundaryOf(plan: string): string | null {
  return proseMatch(plan, /^\*\*Trust boundary:\*\*(.*)$/i)?.trim() ?? null
}

/** The slices the Plan's `**Size:** about N slices …` line names; null without the line. */
export function plannedSlicesOf(plan: string): number | null {
  const count = proseMatch(plan, /^\*\*Size:\*\*[ \t]*(?:about\s+)?(\d+)\s+slices?\b/i)
  const n = count === null ? NaN : Number(count)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/**
 * The Plan's `**Size:** about N slices and M tasks` line as numbers: what the build will be before
 * the build session writes the cards. Null without a Size line that names slices.
 */
export function plannedSizeOf(plan: string): { slices: number; tasks: number | null } | null {
  const slices = plannedSlicesOf(plan)
  if (slices === null) return null
  const tasks = Number(proseMatch(plan, /^\*\*Size:\*\*.*?\b(\d+)\s+tasks?\b/i) ?? NaN)
  return { slices, tasks: Number.isSafeInteger(tasks) && tasks > 0 ? tasks : null }
}

async function read(ctx: Ctx, path: string): Promise<string> {
  return (await ctx.fs.exists(path)) ? await ctx.fs.readFile(path) : ""
}

export async function flowSignals(ctx: Ctx, task: Task): Promise<FlowSignals> {
  const plan = await read(ctx, taskDocPath(task, "plan"))
  // The questions for helpers, the findings and the accepted risks are the agents' Plan file's.
  const agents = await read(ctx, join(task.dir, agentFileOf("plan")))
  const questions = researchQuestionItems(sectionText(agents, RESEARCH_QUESTIONS)).length
  return {
    researchQuestions: questions,
    // A question for helpers is an area the planner's own reading did not trace.
    untraced: questions > 0,
    trustBoundary: trustBoundaryOf(plan),
    risks: sectionText(agents, "Risks"),
    plannedSlices: plannedSlicesOf(plan),
    // The small change's bounds are measured from the Plan's findings and its screens.
    firstLookFiles: firstLookFiles(sectionText(agents, "Findings")),
    screens: plan === "" ? null : artifactMarkers(plan),
  }
}

/** The slices and cards as the build reads them; null before the cards file exists. */
export async function readOutline(ctx: Ctx, task: Task): Promise<Outline | null> {
  return (await ctx.fs.exists(cardsPath(task.dir))) ? await readCards(ctx, task.dir) : null
}

export type TaskFlow = { flow: Flow; line: string; plan: Outline | null; signals: FlowSignals }

const COUNT_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
]

function slicesNamed(text: string): number | null {
  const count = /\b(\d+|[a-z]+)\s+(?:code\s+)?slices\b/i.exec(text)?.[1]?.toLowerCase()
  if (count === undefined) return null
  const n = /^\d+$/.test(count) ? Number(count) : COUNT_WORDS.indexOf(count)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function keptAsOneTask(
  answer: Awaited<ReturnType<typeof answeredQuestions>>[number] | undefined,
): answer is Awaited<ReturnType<typeof answeredQuestions>>[number] {
  if (!answer || answer.reopened || answer.kind === "unsure") return false
  const directVia = answer.via === "app" || answer.via === "chat"
  return (
    directVia &&
    /^(?:keep (?:it as )?|continue (?:as )?|no,? )?(?:one|single|1) task\b/i.test(answer.choice)
  )
}

async function oneTaskApproved(ctx: Ctx, task: Task, plan: Outline | null): Promise<boolean> {
  if (plan === null) return false
  const answer = (await answeredQuestions(ctx, task)).findLast(
    (a) => /\bsplit\b/i.test(a.question) && /\b(?:one|single|1) task\b/i.test(a.question),
  )
  if (!keptAsOneTask(answer)) return false
  const slices = slicesNamed(answer.choice) ?? slicesNamed(answer.question)
  if (slices === null || codeSlices(plan).length > slices) return false
  return approvalCurrent(ctx, task, folderDoc("plan"))
}

export async function taskFlow(ctx: Ctx, task: Task): Promise<TaskFlow> {
  const plan = await readWrittenCards(ctx, task.dir)
  const signals = await flowSignals(ctx, task)
  signals.oneTaskApproved = await oneTaskApproved(ctx, task, plan)
  const config = await readConfig(ctx)
  // Settings › Second opinion is Off or Automatic: on, it reads a risky Plan and a risky built change.
  const secondWhen = config.secondOpinion.enabled ? ("risky" as const) : ("off" as const)
  const scaled = flowFor(task, plan, signals, {
    secondOpinion: config.secondOpinion.enabled,
    plan: planReviewWhen(config.secondOpinion),
    change: secondWhen,
  })
  // Extra planners the person chose for this task (`task start --planners`) always read its Plan,
  // whatever Settings say; the task's own `-second-opinion` still switches them off.
  if (
    scaled.planReview === "none" &&
    !task.overrides.some((word) => word === "-second-opinion" || word === "-second-opinion:plan") &&
    (await readPlanners(ctx, task)).length > 0
  )
    scaled.planReview = "second-opinion"
  // A build that changed agent instructions, hooks, install scripts or CI crosses a trust boundary,
  // whatever the Plan's line says: the Security review reads it.
  // Read from git in Verify only; a shipped task reuses what Verify kept, so it reads no history.
  if (!scaled.security && !task.overrides.includes("-security")) {
    const controls =
      task.stage === "verify"
        ? await agentControlChanges(ctx, task)
        : STAGE_ORDER.indexOf(task.stage) > STAGE_ORDER.indexOf("verify")
          ? await keptAgentControls(ctx, task)
          : []
    if (controls.length > 0) Object.assign(scaled, { security: true, agentControls: controls })
  }
  // Once the Plan is approved the build is under way and nobody can act on a split.
  const approved = STAGE_ORDER.indexOf(task.stage) >= STAGE_ORDER.indexOf("implement")
  // With Independent review off in Settings no fresh agent reviews the change, so none adds the tests.
  const combinedReview = scaled.combinedReview === true && config.independentReview.enabled
  const flow = {
    ...scaled,
    combinedReview,
    ...(approved ? { splitProposal: false } : {}),
  }
  // A task's line also says whether the second opinion reviews the change.
  const words = task.overrides
  const asked = words.includes("+second-opinion") || words.includes("+second-opinion:change")
  const off =
    words.includes("-second-opinion") ||
    words.includes("-second-opinion:change") ||
    (!config.secondOpinion.enabled && !asked)
  const otherAgentMissing = flow.changeSecondOpinion
    ? (await otherVendorInstalled(ctx, task)) === false
    : false
  return {
    flow,
    line: flowLine(flow, plan, signals, { off, otherAgentMissing }),
    plan,
    signals,
  }
}

/** The way a task runs, as the Plan's quiet row shows it: the pick, whether the other way is open, and why. */
export type Intake = {
  pick: "small" | "full"
  /** The person chose it (`+small` or `-small`), not the system. */
  chosen: boolean
  /** The other way is open to the person: while the first look keeps the small change's bounds. */
  offered: boolean
  reason: string
}

/**
 * What the row under the gist says, before the Plan is approved and only while the choice is real:
 * a small change the system picked, or a full workflow the first look would have allowed to be
 * small. Null once the Plan is approved, and when the first look does not keep the bounds.
 */
export async function intakeOf(ctx: Ctx, task: Task): Promise<Intake | null> {
  if (task.stage !== "plan") return null
  const signals = await flowSignals(ctx, task)
  const bounds = smallBounds({ files: signals.firstLookFiles ?? null, untraced: signals.untraced })
  // Before the Plan names its Size the first look alone decides; once it does, the Plan's lines too.
  const possible =
    bounds.ok &&
    (signals.plannedSlices === null ||
      lightPlan({ ...task, profile: "small", overrides: [] }, null, signals))
  const asked = task.overrides.includes("+small")
  const refused = task.overrides.includes("-small")
  const filesLine = `${bounds.files} ${bounds.files === 1 ? "file" : "files"} inspected · no risk surface found`
  if (refused)
    return {
      pick: "full",
      chosen: true,
      offered: possible,
      reason: possible
        ? "You chose the full workflow. The change fits a small one."
        : "You chose the full workflow.",
    }
  if ((task.profile === "small" || asked) && possible)
    return {
      pick: "small",
      chosen: asked && task.profile !== "small",
      offered: true,
      reason: filesLine,
    }
  if (possible)
    return {
      pick: "full",
      chosen: false,
      offered: true,
      reason:
        "The first look saw more than a small change. It fits the small bounds if you want it.",
    }
  return null
}
