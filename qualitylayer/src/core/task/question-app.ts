// The person answers in the App's card. A choice or their own words close the question (through
// `answerQuestion`, `via: "app"`); Tell me more asks the agent for more and leaves it open; Not
// sure takes the recommendation. A question of a gate's review is recorded on the gate first, as
// the agent's picker hook once recorded it: an answer to a decision, or the gate's decision.

import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { recommendedLabel } from "../../interaction/question-recommendations.ts"
import { answerableGate, applyGatePick, questionIsOf } from "../gate/gate.ts"
import { markSet, needQuestionText, readNeeds } from "../need/need.ts"
import { type AnswerUpload, withAnswerFiles } from "./answer-files.ts"
import { matchesChatQuestion, terminalTaskFor } from "./chat-questions.ts"
import { currentOwnerRequest } from "./owner-request.ts"
import { consumePickedCall } from "./picked-calls.ts"
import { placeQuestion } from "./place.ts"
import {
  type AnsweredQuestion,
  answeredQuestions,
  answerQuestion,
  openQuestion,
  picksProblem,
  type Question,
  questionRevision,
  requestMore,
  showQuestion,
  withQuestionLock,
} from "./question.ts"
import { pickedBatchAnswer, readBatch } from "./question-batch.ts"
import type { SessionProof } from "./session-proof.ts"
import { askedInAgent } from "./sides.ts"
import type { Task } from "./store.ts"

/** Open the place question for a task started in `agent` with nothing chosen yet. */
export const askPlace = (ctx: Ctx, task: Task, agent: string): Promise<Result<Question>> =>
  showQuestion(ctx, task, placeQuestion(agent), { agent })

export type AppAnswer = { revision?: string } & (
  | { id: string; choice: number }
  | { id: string; choices: number[] }
  | { id: string; text: string }
  | { id: string; more: { request: string } }
  | { id: string; unsure: true }
)

/** The body of `POST …/question/answer`, checked. */
export function appAnswerOf(body: Record<string, unknown>): AppAnswer | null {
  const id = typeof body.id === "string" && body.id !== "" ? body.id : null
  if (id === null) return null
  if (
    body.revision !== undefined &&
    (typeof body.revision !== "string" || !/^[a-f0-9]{64}$/.test(body.revision))
  )
    return null
  const identity = { id, ...(typeof body.revision === "string" ? { revision: body.revision } : {}) }
  if (typeof body.choice === "number" && Number.isInteger(body.choice) && body.choice >= 0)
    return { ...identity, choice: body.choice }
  if (
    Array.isArray(body.choices) &&
    body.choices.length > 0 &&
    body.choices.length <= 6 &&
    body.choices.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0)
  )
    return { ...identity, choices: body.choices as number[] }
  if (typeof body.text === "string" && body.text.trim() !== "")
    return { ...identity, text: body.text.trim().slice(0, 4000) }
  if (body.unsure === true) return { ...identity, unsure: true }
  if (typeof body.more === "object" && body.more !== null) {
    const request = (body.more as Record<string, unknown>).request
    return { ...identity, more: { request: typeof request === "string" ? request : "" } }
  }
  if (body.more === true) return { ...identity, more: { request: "" } }
  return null
}

export type AppAnswered = { answered: AnsweredQuestion } | { more: Question }

/** Where a question lives without a task: the project's own folder, asked from the App's home page. */
export type HomeHost = Pick<Task, "runtimeDir">

/** The runtime folder of a project's home-page question (a taskless Home or team ask). */
export const homeQuestionDir = (projectDir: string) => join(projectDir, "home-question")

/** Take the person's answer from the App: refused unless `id` is the question that waits. */
export async function answerFromApp(
  ctx: Ctx,
  task: Task | HomeHost,
  answer: AppAnswer,
  options: AnswerUpload & { expected?: Question; note?: string } = {},
): Promise<Result<AppAnswered>> {
  const recordedAnswer = async (): Promise<Result<AppAnswered>> => {
    const saved =
      answer.revision === undefined
        ? undefined
        : (await answeredQuestions(ctx, task)).findLast(
            (entry) =>
              entry.id === answer.id && entry.revision === answer.revision && !entry.reopened,
          )
    return saved
      ? ok({ answered: saved })
      : err({
          code: "bad_args",
          message:
            answer.revision === undefined
              ? "that question is not the one waiting any more"
              : "The question changed. Read the current question before answering.",
        })
  }
  const open = await openQuestion(ctx, task)
  if (
    open === null ||
    open.id !== answer.id ||
    (answer.revision !== undefined && answer.revision !== questionRevision(open))
  )
    return recordedAnswer()
  if ("more" in answer) {
    if (options.files?.length)
      return err({
        code: "bad_args",
        message: "Send files with an answer, rather than Tell me more.",
      })
    const asked = await requestMore(ctx, task, answer.id, answer.more.request, options.expected)
    return asked.ok ? ok({ more: asked.data }) : asked
  }
  // The Plan review has no Not sure: Agree is the recommendation there already.
  if ("unsure" in answer && open.gate !== undefined)
    return err({ code: "bad_args", message: "a review question has no Not sure; pick a choice" })
  if ("choices" in answer) {
    const problem = picksProblem(open, answer.choices)
    if (problem) return err({ code: "bad_args", message: problem })
  }
  const words =
    "choices" in answer
      ? answer.choices.map((i) => open.choices[i]?.label ?? "").join(" + ")
      : "choice" in answer
        ? open.choices[answer.choice]?.label
        : "text" in answer
          ? answer.text
          : recommendedLabel(open)
  if (words === undefined)
    return err({ code: "bad_args", message: "the question has no such choice" })
  // A choice that asks for words (Change…, Request changes…) is not sent on its own.
  if ("choice" in answer && open.choices[answer.choice]?.words === true)
    return err({ code: "bad_args", message: "say what should change in the field, then send it" })
  const apply = async (): Promise<Result<AppAnswered>> => {
    if (
      options.via === "chat" &&
      "answers" in task &&
      askedInAgent(task, [open]) &&
      options.expected?.session &&
      (await terminalTaskFor(ctx, options.expected.session))?.runtimeDir !== task.runtimeDir
    )
      return err({
        code: "bad_args",
        message: "that session is no longer bound to this Terminal task",
      })
    const current = await openQuestion(ctx, task)
    if (
      !current ||
      current.id !== open.id ||
      current.asked !== open.asked ||
      current.question !== open.question ||
      current.gateId !== open.gateId ||
      (answer.revision !== undefined && questionRevision(current) !== answer.revision) ||
      (options.expected &&
        (current.asked !== options.expected.asked ||
          current.question !== options.expected.question ||
          current.gateId !== options.expected.gateId ||
          current.found?.at !== options.expected.found?.at))
    )
      return recordedAnswer()
    if (
      current.ownerRequest &&
      (!("stage" in task) || !(await currentOwnerRequest(ctx, task, current.ownerRequest)))
    )
      return err({
        code: "bad_args",
        message: "That owner request changed. Read the current Verify request.",
      })
    if (current.ownerRequest?.kind === "budget" && !("choice" in answer))
      return err({ code: "bad_args", message: "Confirm one of the budget choices." })
    return withAnswerFiles(ctx, task, options, async (files) => {
      const originReceipt = open.gate ? randomUUID() : undefined
      if (/^need-T\d+-/.test(open.id)) {
        const need = (await readNeeds(ctx, task)).find(
          (need) =>
            need.state === "open" &&
            open.asked >= Math.max(need.opened, need.reopened?.at ?? 0) &&
            open.id.startsWith(`need-${need.for}-`) &&
            open.question === needQuestionText(need),
        )
        if (!need || (words !== "Done, it's set" && words !== "Not yet"))
          return err({
            code: "bad_args",
            message: "that prerequisite or choice is no longer current",
          })
        if (words === "Done, it's set") {
          const set = await markSet(ctx, task, need.for, "Confirmed in the current question")
          if (!set.ok) return set
        }
      }
      if (open.gate !== undefined) {
        const batch = await readBatch(ctx, task)
        if (open.item === undefined && batch?.questions.some((question) => question.id !== open.id))
          return err({
            code: "bad_args",
            message: "answer the remaining questions before approval",
          })
        if (!("stage" in task))
          return err({ code: "bad_args", message: "a review question belongs to its task" })
        // The approval question of a Review sent back for a recheck still takes the person's Approve.
        const gate = await answerableGate(ctx, task, open)
        // So does one asked on an earlier opening of the Review that is open now (questionIsOf).
        if (gate === null || gate.target !== open.gate || !questionIsOf(gate, open))
          return err({ code: "bad_args", message: "this review is no longer open" })
        const applied = await applyGatePick(ctx, task, gate, {
          item: open.item,
          pick: words,
          notes: options.note?.trim() || undefined,
          by: options.via === "chat" ? "chat" : "cockpit",
          choices: open.choices.map((c) => c.label),
          question: { id: open.id, number: open.number, receipt: originReceipt as string },
          ...(open.gateId !== undefined ? { gateId: open.gateId } : {}),
        })
        if (!applied.ok) return applied
        if (applied.data === "refused")
          return err({ code: "bad_args", message: "pick one of the choices for this question" })
      }
      const closed = await answerQuestion(
        ctx,
        task,
        "choice" in answer ? String(answer.choice + 1) : words,
        {
          via: options.via ?? "app",
          open,
          literalWords: "text" in answer,
          ...(options.note?.trim() ? { note: options.note.trim() } : {}),
          ...("choices" in answer ? { picks: answer.choices } : {}),
          held: true,
          ...(files ? { files } : {}),
          ...(originReceipt ? { originReceipt } : {}),
          ...("unsure" in answer ? { unsure: true } : {}),
        },
      )
      if (!closed.ok) return closed
      if (closed.data.entry === undefined)
        return err({ code: "bad_args", message: "that question is not the one waiting any more" })
      return ok({ answered: closed.data.entry })
    })
  }
  // A review answer decides the gate and then records itself: a waiting `ask` must not see the
  // decided gate between the two and call the question withdrawn.
  return withQuestionLock(ctx, task, apply)
}

/** Record an ungated single Terminal question using the same proof boundary as batches. */
export async function recordPickedQuestionAnswer(
  ctx: Ctx,
  pick: { session: string; question: string; answer: string; notes?: string; proof: SessionProof },
): Promise<boolean> {
  if (
    !pick.session ||
    pick.proof?.session !== pick.session ||
    !pick.proof.answers.some(
      (answer) =>
        answer.question === pick.question &&
        answer.answer === pick.answer &&
        answer.notes === pick.notes,
    )
  )
    return false
  const task = await terminalTaskFor(ctx, pick.session)
  if (!task) return false
  const question = await openQuestion(ctx, task)
  if (
    !question ||
    question.gate ||
    /^need-T\d+-/.test(question.id) ||
    !askedInAgent(task, [question]) ||
    question.session !== pick.session ||
    (question.agent && question.agent !== pick.proof.agent)
  )
    return false
  if (
    (await readBatch(ctx, task))?.questions.some((q) => q.id === question.id) ||
    !(await matchesChatQuestion(ctx, question, pick.question, pick.proof.agent))
  )
    return false
  const only = { task, question }
  return consumePickedCall(ctx, only.task, pick.proof, {
    target: async () => {
      const current = await openQuestion(ctx, only.task)
      if (
        !current ||
        current.id !== only.question.id ||
        current.asked !== only.question.asked ||
        current.question !== only.question.question ||
        current.found?.at !== only.question.found?.at
      )
        return null
      return {
        id: current.id,
        question: pick.question,
        session: pick.session,
        openedAt: Math.max(current.asked, current.found?.at ?? 0),
      }
    },
    apply: async (answer) => {
      const { batch: _batch, ...selection } = pickedBatchAnswer(only.question, "", answer)
      return (
        await answerFromApp(ctx, only.task, selection, { via: "chat", expected: only.question })
      ).ok
    },
  })
}
