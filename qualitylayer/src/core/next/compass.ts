// `qualitylayer next`: the read-only compass. It says where the task is (step, Verify's mode), what
// is open, who is waited for and the moves open now, from the one table in moves.ts. It never
// writes: any number of calls leaves every byte of the task folder and its runtime folder as they
// were. Every change is a verb (plan §3.7).

import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { flowStepOf } from "../flow.ts"
import { planReviewQuestionMove, readGate } from "../gate/gate.ts"
import { matchingStartRoute, readStart } from "../handoff/start.ts"
import { type RepoRef, resolveRepo } from "../paths.ts"
import { isArchived } from "../task/archive.ts"
import { sessionKey } from "../task/binding.ts"
import type { VerifyMode } from "../task/stages.ts"
import {
  EARLIER_LAYOUT_REASON,
  isCurrentLayout,
  lostIdentity,
  resolveTask,
  type Task,
} from "../task/store.ts"
import { type CompassOpen, messageOf, moveStateOf } from "./compass-state.ts"
import { briefStepOf, type Move, type MoveState, meantVerb, movesOf, waitingFor } from "./moves.ts"

export { moveStateOf } from "./compass-state.ts"

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
  open?: CompassOpen
  waiting_for?: string
  moves: Move[]
  brief?: string
  message: string
  /** The verb an old `next <word>` meant: nothing changed, this is the command that does it. */
  meant?: string
}

async function noTaskCompass(ctx: Ctx, repo: RepoRef, words: string): Promise<Result<Compass>> {
  // A Plan file written over leaves its task unseen: the reply names it, never a second start.
  const lost = await lostIdentity(ctx, repo)
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

async function taskCompass(ctx: Ctx, task: Task, words: string): Promise<Result<Compass>> {
  const { state, open } = await moveStateOf(ctx, task)
  const findingQuestion =
    state.stage === "plan" && state.gate === "reviewed"
      ? await planReviewQuestionMove(ctx, task)
      : null
  const chosen =
    state.stage === "implement" && !state.started
      ? matchingStartRoute(
          await readStart(ctx, task),
          await readGate(ctx, task),
          sessionKey(ctx.env),
        )
      : null
  const briefed = briefStepOf(state)
  const waiting = waitingFor(state)
  const named = words.toLowerCase().includes(task.slug)
  const meant = words === "" || named ? null : (meantVerb(words, state) ?? startOf(words))
  const moves =
    findingQuestion === null
      ? movesOf(state)
      : [
          {
            command: findingQuestion.then,
            does: "hear the answer to the review question",
            by: "person" as const,
          },
          ...movesOf(state),
        ]
  const message =
    chosen === null
      ? (findingQuestion?.message ?? messageOf(task, state))
      : chosen.compact === true
        ? 'Implement: Build here, from the Plan was chosen. Compact in your agent, then say "build here".'
        : "Implement: Keep this conversation was chosen; this session builds it next."
  return ok({
    task: task.slug,
    title: task.title,
    step: flowStepOf(task.stage),
    stage: task.stage,
    ...(state.stage === "verify" ? { mode: state.mode } : {}),
    ...(Object.keys(open).length > 0 ? { open } : {}),
    ...(waiting !== null ? { waiting_for: waiting } : {}),
    moves,
    ...(briefed !== null ? { brief: `qualitylayer brief ${briefed}` } : {}),
    message,
    ...(meant !== null ? { meant } : {}),
  })
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
  if (task === null) return noTaskCompass(ctx, repo.data, words)
  if (!isCurrentLayout(task))
    return ok({
      task: task.slug,
      step: null,
      stage: task.stage,
      moves: movesOf({ stage: "none" }),
      message: `${task.slug}: ${EARLIER_LAYOUT_REASON}`,
    })
  if (await isArchived(ctx, task))
    return err({
      code: "bad_args",
      message: `${task.slug} is archived. Restore it with qualitylayer task restore ${task.slug} before continuing.`,
    })
  return taskCompass(ctx, task, words)
}

/** New words that name no verb ask for a new task: the command that starts it. */
function startOf(words: string): string | null {
  return words === "" || words.toLowerCase() === "status"
    ? null
    : `qualitylayer task start ${JSON.stringify(words)}`
}
