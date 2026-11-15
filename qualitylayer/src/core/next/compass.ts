// `qualitylayer next`: the read-only compass. It says where the task is (step, Verify's mode), what
// is open, who is waited for and the moves open now, from the one table in moves.ts. It never
// writes: any number of calls leaves every byte of the task folder and its runtime folder as they
// were. Every change is a verb (plan §3.7).

import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { allTasks } from "../docs/outline.ts"
import { flowStepOf } from "../flow.ts"
import { FINAL, readGate } from "../gate/gate.ts"
import { humanNeedBlockedTasks } from "../open-items.ts"
import { resolveRepo } from "../paths.ts"
import { reviewFile } from "../review/cross.ts"
import { isArchived } from "../task/archive.ts"
import { sessionKey } from "../task/binding.ts"
import { reviewFindings } from "../task/items.ts"
import { PLACE_QUESTION_ID } from "../task/place.ts"
import { openQuestion } from "../task/question.ts"
import type { VerifyMode } from "../task/stages.ts"
import {
  EARLIER_LAYOUT_REASON,
  isCurrentLayout,
  lostIdentity,
  resolveTask,
  type Task,
} from "../task/store.ts"
import { readVerifyMode } from "../task/verify-mode.ts"
import { taskFlow } from "../task-flow.ts"
import { readBuildLead } from "./build-lead.ts"
import {
  briefStepOf,
  type Move,
  type MoveState,
  meantVerb,
  movesOf,
  type PlanGate,
  waitingFor,
} from "./moves.ts"
import { unprovenSteps } from "./steps.ts"

/**
 * The user's words without the skill's own invocation. Claude Code drops its `/ql`, Codex passes
 * `$ql` on as part of the message, so an agent may hand either along.
 */
export function stripInvocation(rawWords: string): string {
  return rawWords
    .trim()
    .replace(/^[/$](?:qualitylayer|ql)\b[:,]?\s*/i, "")
    .trim()
}

export type Compass = {
  task: string | null
  title?: string
  step: "plan" | "implement" | "verify" | null
  stage?: string
  mode?: VerifyMode
  open?: {
    questions?: number
    /** The start's one question: where the person answers from now on (`chat_questions`). */
    place?: true
    cards?: number
    steps?: string[]
    findings?: number
  }
  waiting_for?: string
  moves: Move[]
  brief?: string
  message: string
  /** The verb an old `next <word>` meant: nothing changed, this is the command that does it. */
  meant?: string
}

/** How many unproven step ids the reply names; the count stays whole. */
const STEPS_SHOWN = 8

/** Where the Plan's gate stands, read from the gate and the Plan review's stored record. */
async function planGateOf(ctx: Ctx, task: Task): Promise<PlanGate> {
  const gate = await readGate(ctx, task)
  if (gate === null || gate.target === FINAL) return "none"
  if (gate.decision === "approved" && gate.settled !== true) return "approved"
  if (gate.decision === "changes" && gate.settled !== true) return "changes"
  if (gate.settled === true || gate.decision !== "pending") return "none"
  if (gate.waitsFor === "plan") {
    const run = await storedState(ctx, task)
    return run === "running" ? "reviewing" : "reviewed"
  }
  return "open"
}

/** The Plan review's state as stored; the compass never marks a stopped worker itself. */
async function storedState(ctx: Ctx, task: Task): Promise<string | null> {
  try {
    const run = JSON.parse(await ctx.fs.readFile(join(task.runtimeDir, "review-plan.json"))) as {
      state?: unknown
    }
    return typeof run.state === "string" ? run.state : null
  } catch {
    return null
  }
}

/** The cards not ticked and not waiting on the person, from the agents' file of Implement. */
async function openCards(ctx: Ctx, task: Task): Promise<number> {
  const outline = (await taskFlow(ctx, task)).plan
  if (outline === null) return 0
  const waiting = new Set((await humanNeedBlockedTasks(ctx, task)).map((id) => id.toUpperCase()))
  return allTasks(outline).filter((card) => !card.checked && !waiting.has(card.id.toUpperCase()))
    .length
}

/** The findings of a review file that carry no `Answer:` line yet. */
async function openFindings(ctx: Ctx, task: Task, point: "plan" | "verify"): Promise<number> {
  const file = reviewFile(task, point)
  if (!(await ctx.fs.exists(file))) return 0
  return reviewFindings(await ctx.fs.readFile(file)).filter((f) => f.stance === undefined).length
}

/** The task's state as the moves table reads it, with what is open beside it. */
export async function moveStateOf(
  ctx: Ctx,
  task: Task,
): Promise<{ state: MoveState; open: NonNullable<Compass["open"]> }> {
  // The start's place question is named as such: it is no question of the Plan.
  const open = await openQuestion(ctx, task)
  const asked =
    open === null ? {} : open.id === PLACE_QUESTION_ID ? { place: true as const } : { questions: 1 }
  switch (task.stage) {
    case "chat":
      return { state: { stage: "chat" }, open: {} }
    case "plan": {
      const findings = await openFindings(ctx, task, "plan")
      return {
        state: { stage: "plan", gate: await planGateOf(ctx, task) },
        open: { ...asked, ...(findings > 0 ? { findings } : {}) },
      }
    }
    case "implement": {
      const lead = await readBuildLead(ctx, task)
      const started = lead !== null
      const ledElsewhere = started && lead.session !== sessionKey(ctx.env)
      const cards = started ? await openCards(ctx, task) : 0
      const steps = started ? (await unprovenSteps(ctx, task)).map((step) => step.id) : []
      return {
        state: {
          stage: "implement",
          started,
          unticked: cards,
          unproven: steps.length,
          ...(ledElsewhere ? { ledElsewhere } : {}),
        },
        open: {
          ...asked,
          ...(cards > 0 ? { cards } : {}),
          ...(steps.length > 0 ? { steps: steps.slice(0, STEPS_SHOWN) } : {}),
        },
      }
    }
    case "verify": {
      const mode = (await readVerifyMode(ctx, task)) ?? "checking"
      const findings = await openFindings(ctx, task, "verify")
      return {
        state: { stage: "verify", mode },
        open: { ...asked, ...(findings > 0 ? { findings } : {}) },
      }
    }
    case "shipped":
      return { state: { stage: "shipped" }, open: {} }
    default:
      return { state: { stage: "abandoned" }, open: {} }
  }
}

/** One plain line on where the task stands. */
function messageOf(task: Task, state: MoveState): string {
  switch (state.stage) {
    case "plan":
      return {
        none: "Plan: write the Plan, validate it with plan draft, then open its gate.",
        open: "Plan: the gate is open. Your move is `qualitylayer wait --for approval`, again while it says pending: it returns when the person approves or comments, in the App or here. Ask for the approval once.",
        reviewing:
          "Plan: the Plan's reviewers are at work; Approve stays locked until they finish.",
        reviewed: "Plan: the review is in; answer each finding, then open the gate again.",
        changes:
          "Plan: the person asked for changes; hear them with wait, apply them, then ask again.",
        approved: "Plan: approved; the build starts with build start.",
      }[state.gate]
    case "implement":
      return !state.started
        ? "Implement: the Plan is approved and no session builds it yet."
        : state.unticked === 0 && state.unproven === 0
          ? "Implement: every card is ticked and every Done means step ran green; build done starts Verify."
          : `Implement: ${state.unticked} card(s) open, ${state.unproven} Done means step(s) not yet green.`
    case "verify":
      return {
        checking: "Verify: the checks, then the fresh reviewer.",
        fixing: "Verify: the last judgement failed; fix it, then recheck.",
        asked: "Verify: the exit question waits for the person's answer.",
        yours: "Verify: every point passed on the code as it is; the person reviews and approves.",
        rechecking:
          "Verify: the code or the Plan changed since the pass (the task's own change or the person's comment); recheck it. The person's approval still saves.",
      }[state.mode]
    case "shipped":
      return `${task.slug} is approved; ship follows the chosen delivery.`
    case "abandoned":
      return `${task.slug} is closed; its files stay.`
    case "chat":
      return "A Chat: start a task at Plan when the person wants the workflow."
    case "none":
      return "No open task in this repository."
  }
}

/**
 * `next [words]`: where the task is and what can be done now. Reads only. A word after it changes
 * nothing: the reply names the verb it meant.
 */
export async function compass(ctx: Ctx, rawWords = ""): Promise<Result<Compass>> {
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return repo
  const words = stripInvocation(rawWords)
  const task = await resolveTask(ctx, repo.data, words)
  if (task === null) {
    // A Plan file written over leaves its task unseen: the reply names it, never a second start.
    const lost = await lostIdentity(ctx, repo.data)
    if (lost !== null)
      return ok({
        task: null,
        step: null,
        moves: [{ command: lost.move, does: `restore task ${lost.slug}`, by: "agent" }],
        message: lost.message,
      })
    const state: MoveState = { stage: "none" }
    const meant = words === "" ? null : (meantVerb(words, state) ?? startOf(words))
    return ok({
      task: null,
      step: null,
      moves: movesOf(state),
      message: "No open task in this repository.",
      ...(meant !== null ? { meant } : {}),
    })
  }
  if (!isCurrentLayout(task)) {
    const state: MoveState = { stage: "none" }
    return ok({
      task: task.slug,
      step: null,
      stage: task.stage,
      moves: movesOf(state),
      message: `${task.slug}: ${EARLIER_LAYOUT_REASON}`,
    })
  }
  if (await isArchived(ctx, task))
    return err({
      code: "bad_args",
      message: `${task.slug} is archived. Restore it with qualitylayer task restore ${task.slug} before continuing.`,
    })
  const { state, open } = await moveStateOf(ctx, task)
  const step = flowStepOf(task.stage)
  const briefed = briefStepOf(state)
  const waiting = waitingFor(state)
  const named = words.toLowerCase().includes(task.slug)
  const meant = words === "" || named ? null : (meantVerb(words, state) ?? startOf(words))
  return ok({
    task: task.slug,
    title: task.title,
    step,
    stage: task.stage,
    ...(state.stage === "verify" ? { mode: state.mode } : {}),
    ...(Object.keys(open).length > 0 ? { open } : {}),
    ...(waiting !== null ? { waiting_for: waiting } : {}),
    moves: movesOf(state),
    ...(briefed !== null ? { brief: `qualitylayer brief ${briefed}` } : {}),
    message: messageOf(task, state),
    ...(meant !== null ? { meant } : {}),
  })
}

/** New words that name no verb ask for a new task: the command that starts it. */
function startOf(words: string): string | null {
  return words === "" || words.toLowerCase() === "status"
    ? null
    : `qualitylayer task start ${JSON.stringify(words)}`
}
