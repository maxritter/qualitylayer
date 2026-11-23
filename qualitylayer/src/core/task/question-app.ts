// The person answers in the App's card. A choice or their own words close the question (through
// `answerQuestion`, `via: "app"`); Tell me more asks the agent for more and leaves it open; Not
// sure takes the recommendation. A question of a gate's review is recorded on the gate first, as
// the agent's picker hook once recorded it: an answer to a decision, or the gate's decision.

import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import type { AnswerUpload } from "./answer-files.ts"
import { matchesChatQuestion, terminalTaskFor } from "./chat-questions.ts"
import { consumePickedCall } from "./picked-calls.ts"
import { placeQuestion } from "./place.ts"
import {
  answeredQuestions,
  openQuestion,
  type Question,
  questionRevision,
  requestMore,
  showQuestion,
  withQuestionLock,
} from "./question.ts"
import { applyLockedAppAnswer } from "./question-app-apply.ts"
import {
  type AppAnswer,
  type AppAnswered,
  type HomeHost,
  resolveAppAnswerWords,
} from "./question-app-parse.ts"
import { pickedBatchAnswer, readBatch } from "./question-batch.ts"
import type { SessionProof } from "./session-proof.ts"
import { askedInAgent } from "./sides.ts"
import type { Task } from "./store.ts"

export {
  type AppAnswer,
  type AppAnswered,
  appAnswerOf,
  type HomeHost,
  homeQuestionDir,
} from "./question-app-parse.ts"

/** Open the place question for a task started in `agent` with nothing chosen yet. */
export const askPlace = (ctx: Ctx, task: Task, agent: string): Promise<Result<Question>> =>
  showQuestion(ctx, task, placeQuestion(agent), { agent })

async function lookupRecordedAnswer(
  ctx: Ctx,
  task: Task | HomeHost,
  answer: AppAnswer,
): Promise<Result<AppAnswered>> {
  const saved =
    answer.revision === undefined
      ? undefined
      : (await answeredQuestions(ctx, task)).findLast(
          (entry) =>
            entry.id === answer.id && entry.revision === answer.revision && !entry.reopened,
        )
  if (saved) return ok({ answered: saved })
  return err({
    code: "bad_args",
    message:
      answer.revision === undefined
        ? "that question is not the one waiting any more"
        : "The question changed. Read the current question before answering.",
  })
}

async function handleMoreAnswer(
  ctx: Ctx,
  task: Task | HomeHost,
  answer: Extract<AppAnswer, { more: { request: string } }>,
  options: AnswerUpload & { expected?: Question },
): Promise<Result<AppAnswered>> {
  if (options.files?.length)
    return err({
      code: "bad_args",
      message: "Send files with an answer, rather than Tell me more.",
    })
  const asked = await requestMore(ctx, task, answer.id, answer.more.request, options.expected)
  return asked.ok ? ok({ more: asked.data }) : asked
}

/** Take the person's answer from the App: refused unless `id` is the question that waits. */
export async function answerFromApp(
  ctx: Ctx,
  task: Task | HomeHost,
  answer: AppAnswer,
  options: AnswerUpload & { expected?: Question; note?: string } = {},
): Promise<Result<AppAnswered>> {
  const recordedAnswer = () => lookupRecordedAnswer(ctx, task, answer)
  const open = await openQuestion(ctx, task)
  const matchesOpen =
    open !== null &&
    open.id === answer.id &&
    (answer.revision === undefined || answer.revision === questionRevision(open))
  if (!matchesOpen) return recordedAnswer()
  if ("more" in answer) return handleMoreAnswer(ctx, task, answer, options)
  const resolved = resolveAppAnswerWords(open, answer)
  if (!resolved.ok) return resolved
  // A review answer decides the gate and then records itself: a waiting `ask` must not see the
  // decided gate between the two and call the question withdrawn.
  return withQuestionLock(ctx, task, () =>
    applyLockedAppAnswer(ctx, task, {
      open,
      answer,
      words: resolved.data,
      options,
      recordedAnswer,
    }),
  )
}

function isUngatedSingleTerminalQuestion(
  task: Task,
  question: Question | null,
  session: string,
  agent: string,
): question is Question {
  if (!question || question.gate || /^need-T\d+-/.test(question.id)) return false
  if (!askedInAgent(task, [question]) || question.session !== session) return false
  return !question.agent || question.agent === agent
}

function samePickedQuestion(current: Question | null, expected: Question): current is Question {
  if (!current || current.id !== expected.id || current.asked !== expected.asked) return false
  return current.question === expected.question && current.found?.at === expected.found?.at
}

/** Record an ungated single Terminal question using the same proof boundary as batches. */
export async function recordPickedQuestionAnswer(
  ctx: Ctx,
  pick: { session: string; question: string; answer: string; notes?: string; proof: SessionProof },
): Promise<boolean> {
  const proofMatches =
    Boolean(pick.session) &&
    pick.proof?.session === pick.session &&
    pick.proof.answers.some(
      (answer) =>
        answer.question === pick.question &&
        answer.answer === pick.answer &&
        answer.notes === pick.notes,
    )
  if (!proofMatches) return false
  const task = await terminalTaskFor(ctx, pick.session)
  if (!task) return false
  const question = await openQuestion(ctx, task)
  if (!isUngatedSingleTerminalQuestion(task, question, pick.session, pick.proof.agent)) return false
  if (
    (await readBatch(ctx, task))?.questions.some((q) => q.id === question.id) ||
    !(await matchesChatQuestion(ctx, question, pick.question, pick.proof.agent))
  )
    return false
  return consumePickedCall(ctx, task, pick.proof, {
    target: async () => {
      const current = await openQuestion(ctx, task)
      if (!samePickedQuestion(current, question)) return null
      return {
        id: current.id,
        question: pick.question,
        session: pick.session,
        openedAt: Math.max(current.asked, current.found?.at ?? 0),
      }
    },
    apply: async (answer) => {
      const { batch: _batch, ...selection } = pickedBatchAnswer(question, "", answer)
      return (await answerFromApp(ctx, task, selection, { via: "chat", expected: question })).ok
    },
  })
}
