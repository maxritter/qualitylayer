// Batch membership is durable; answers and corrections use the existing question delivery log.

import { createHash, randomUUID } from "node:crypto"
import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import type {
  AskedBatch,
  BatchAnswer,
  BatchContinuation,
  BatchStrip,
  DeliveryReceipt,
  QuestionBatch,
} from "../../interaction/contracts.ts"
import { recommendedLabel } from "../../interaction/question-recommendations.ts"
import { doneMeansOf } from "../done-means.ts"
import { takeImmediate } from "../gate/comments.ts"
import { applyGatePick, readGate } from "../gate/gate.ts"
import { listRuns } from "../run/registry.ts"
import { type AnswerUpload, withAnswerFiles } from "./answer-files.ts"
import { matchesChatQuestion, terminalTaskFor } from "./chat-questions.ts"
import { consumePickedCall, type PickedTarget } from "./picked-calls.ts"
import {
  type AnsweredQuestion,
  agentSession,
  answeredQuestions,
  answerQuestion,
  cancelQuestion,
  findingProblem,
  foundOf,
  matchOptions,
  openQuestion,
  parseQuestion,
  picksProblem,
  type Question,
  reopenAnswer,
  takeMeanwhile,
} from "./question.ts"
import type { SessionAnswer, SessionProof } from "./session-proof.ts"
import { askedInAgent } from "./sides.ts"
import { appendEvent, type Task } from "./store.ts"
import { typedAnswer } from "./typed-choice.ts"

type Host = Pick<Task, "runtimeDir" | "stage">
type StoredBatch = QuestionBatch & {
  continuations?: BatchContinuation[]
  replies?: Record<string, { text: string; at: number; answerAt: number }>
  cancelled?: Record<string, { at: number; reason: string }>
}
const path = (task: Pick<Task, "runtimeDir">) => join(task.runtimeDir, "question-batches.json")
const locked = <T>(ctx: Ctx, task: Pick<Task, "runtimeDir">, run: () => Promise<T>) =>
  ctx.fs.withLock(join(task.runtimeDir, "question-batches.lock"), run)
const bad = (message: string) => err({ code: "bad_args", message })
const validMember = (raw: { choices?: unknown; points?: unknown }) =>
  Array.isArray(raw.choices) &&
  raw.choices.length <= 6 &&
  Array.isArray(raw.points) &&
  raw.points.length <= 32 &&
  raw.points.every((n: unknown) => Number.isInteger(n) && Number(n) >= 1)

/** Mirrors the single-question fact limit, so a batch reports every long fact in one refusal. */
const MAX_FACT_CHARS = 200

function overlongFacts(questions: unknown[]): string[] {
  const found: string[] = []
  for (const q of questions) {
    const raw = q as { id?: unknown; choices?: unknown }
    if (!Array.isArray(raw.choices)) continue
    for (const choice of raw.choices) {
      const c = choice as { label?: unknown; facts?: unknown } | null
      if (typeof c !== "object" || c === null || !Array.isArray(c.facts)) continue
      const long = c.facts.filter((f) => typeof f === "string" && f.trim().length > MAX_FACT_CHARS)
      if (long.length > 0)
        found.push(
          `choice "${String(c.label ?? "")}"${typeof raw.id === "string" ? ` of ${raw.id}` : ""} (${long.length} long)`,
        )
    }
  }
  return found
}

function questionIdProblem(
  questions: { id: unknown }[],
  existing: Set<string | undefined>,
): string | null {
  const seen = new Set(existing)
  const duplicates = new Set<string>()
  for (const { id } of questions) {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(id))
      return "question IDs need 1 to 120 letters, digits, underscores or hyphens"
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
  }
  if (duplicates.size === 0) return null
  let next = 1
  while (seen.has(`q${next}`)) next++
  return `Question IDs already used in this task or batch: ${[...duplicates].join(", ")}. Use unused IDs; next free is q${next}.`
}
async function stored(ctx: Ctx, task: Pick<Task, "runtimeDir">): Promise<StoredBatch[]> {
  try {
    return JSON.parse(await ctx.fs.readFile(path(task))) as StoredBatch[]
  } catch {
    return []
  }
}
async function write(ctx: Ctx, task: Pick<Task, "runtimeDir">, batches: StoredBatch[]) {
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(path(task), `${JSON.stringify(batches, null, 2)}\n`)
}
const latest = (history: AnsweredQuestion[], q: Question) =>
  history.findLast((a) => a.id === q.id && a.at >= q.asked)
const answerRevision = (batch: QuestionBatch, history: AnsweredQuestion[]) =>
  createHash("sha256")
    .update(JSON.stringify(batch.questions.map((q) => [q.id, latest(history, q)?.at])))
    .digest("hex")
async function current(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  batch: StoredBatch,
): Promise<QuestionBatch> {
  const history = await answeredQuestions(ctx, task)
  const gate = await readGate(ctx, task)
  return {
    ...batch,
    continuation: batch.continuations?.findLast(
      (attempt) => attempt.revision === answerRevision(batch, history),
    ),
    questions: batch.questions.filter((q) => {
      if (batch.cancelled?.[q.id]) return false
      const answer = latest(history, q)
      if (answer && !answer.reopened) return false
      return (
        q.gate === undefined ||
        (gate?.decision === "pending" &&
          gate.target === q.gate &&
          q.gateId === (gate.id ?? String(gate.opened)))
      )
    }),
  }
}
/** The batch that holds question `id`: an id is used once in a task, so an answer finds its batch. */
const holding = (batches: StoredBatch[], id: string) =>
  batches.findLast((b) => b.questions.some((q) => q.id === id))

/** Every batch with a question still open, oldest first, as `current` gives them. */
async function openBatches(ctx: Ctx, task: Pick<Task, "runtimeDir">, all: StoredBatch[]) {
  const views = await Promise.all(all.map((b) => current(ctx, task, b)))
  return all.flatMap((stored, i) =>
    (views[i]?.questions.length ?? 0) > 0 ? [{ stored, view: views[i] as QuestionBatch }] : [],
  )
}

/**
 * One batch by its id, or the one the App's card shows: a batch asked while an earlier one waits
 * never hides it, so the card holds every open question, the earliest batch's first, under the
 * newest open batch's id and words.
 */
export async function readBatch(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  id?: string,
): Promise<QuestionBatch | null> {
  const all = await stored(ctx, task)
  if (id) {
    const batch = all.find((b) => b.id === id)
    return batch ? current(ctx, task, batch) : null
  }
  const open = await openBatches(ctx, task, all)
  const newest = open.at(-1)?.view
  if (newest === undefined || open.length === 1) {
    const last = all.at(-1)
    return newest ?? (last ? current(ctx, task, last) : null)
  }
  return {
    ...newest,
    questions: open.flatMap((b) => b.view.questions),
    links: open.flatMap((b) => b.view.links),
  }
}
export type ClarificationRequest = {
  batch: string
  id: string
  request: string
  request_at: number
  question: string
  choices: string[]
  points: number[]
}

/** Delivery is not completion: a later next still owes every unanswered clarification. */
export async function pendingClarifications(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<ClarificationRequest[]> {
  const requests: ClarificationRequest[] = []
  for (const batch of await stored(ctx, task)) {
    for (const q of (await current(ctx, task, batch)).questions) {
      if (!q.more || q.more.cancelled !== undefined) continue
      requests.push({
        batch: batch.id,
        id: q.id,
        request: q.more.request,
        request_at: q.more.at,
        question: q.question,
        choices: q.choices.map((choice) => choice.label),
        points: batch.links.find((link) => link.questionId === q.id)?.points ?? [],
      })
    }
  }
  return requests
}

export function clarificationInstructions(requests: { id: string; request_at?: number }[]): string {
  const first = requests[0]
  if (!first) return ""
  return `The person pressed Tell me more on ${requests.map((request) => request.id).join(", ")}; this is not an answer. Explain the missing context in plain words and reword that question and its choices where needed. Write a JSON patch with ${first.request_at === undefined ? "" : `\`request_at: ${first.request_at}\`, `}\`found: {text, evidence}\` and only the wording that changes. Run \`qualitylayer question more ${first.id} --file <json>\` now. Update only that question; do not republish or answer the batch. Process every listed clarification before waiting again. A delivered request stays open until this update succeeds, the person cancels it or answers the question.`
}

/** Who belongs to a batch and who still waits: what a coalescing wait reads (null: no such batch). */
export type BatchProgress = { id: string; members: string[]; open: string[] }
export async function batchProgress(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  id?: string,
): Promise<BatchProgress | null> {
  const all = await stored(ctx, task)
  const batch = id ? all.find((b) => b.id === id) : all.at(-1)
  if (!batch) return null
  return {
    id: batch.id,
    members: batch.questions.filter((q) => !batch.cancelled?.[q.id]).map((q) => q.id),
    open: (await current(ctx, task, batch)).questions.map((q) => q.id),
  }
}
/** Every batch published for the task, oldest first, with how many of its questions still wait. */
export async function batchLog(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<{ id: string; step?: string; open: number }[]> {
  const all = await stored(ctx, task)
  return Promise.all(
    all.map(async (b) => ({
      id: b.id,
      ...(b.step ? { step: b.step } : {}),
      open: (await current(ctx, task, b)).questions.length,
    })),
  )
}
const BATCH_FIELDS = ["id", "questions", "step", "title", "ahead", "small", "why_another"]
const line = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, max) : undefined

/**
 * Check stage provenance and finding references; question cadence belongs to the phase text.
 */
async function sevenRules(
  ctx: Ctx,
  task: Host & Partial<Pick<Task, "dir">>,
  given: Record<string, unknown>,
  members: Record<string, unknown>[],
  earlier: StoredBatch[],
): Promise<Result<{ warnings: string[]; step: string; count: string }>> {
  const step: string = task.stage
  if (typeof given.step === "string" && given.step !== step)
    return bad(
      `this task is in ${step}, not ${given.step}: leave "step" out, a batch belongs to the step that asks it`,
    )
  const warnings: string[] = []
  if (task.stage !== "plan" && members.some((member) => member.late === true))
    return err({
      code: "batch_step_closed",
      message: '"late" identifies a Your call in the Plan; ordinary questions need no late flag',
    })
  // Batches are counted per step: Verify's first is its own first, whatever the Plan asked.
  const asked = earlier.filter((b) => b.step === step).length
  const label = `${step.charAt(0).toUpperCase()}${step.slice(1)}`
  const count = `batch ${asked + 1} of this step (${label})`
  for (const member of members) {
    if (typeof member.finding !== "string") continue
    const problem = await findingProblem(ctx, task as Task, member.finding)
    if (problem) return bad(`question ${String(member.id)}: ${problem}`)
  }
  return ok({ warnings: warnings.map((warning) => `${count}: ${warning}`), step, count })
}

/**
 * The batch that waits, as the card's strip shows it: every member in order with the answers
 * already given, or null when nothing is open (a batch all answered leaves no strip).
 */
export async function batchStrip(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<BatchStrip | null> {
  // Every batch still open, the earliest first: one asked while another waits never hides it.
  const open = (await openBatches(ctx, task, await stored(ctx, task))).map((b) => b.stored)
  const batch = open.at(-1)
  if (!batch) return null
  const history = await answeredQuestions(ctx, task)
  const members = open
    .flatMap((b) => b.questions.filter((q) => !b.cancelled?.[q.id]))
    .map((q, index) => {
      const answer = latest(history, q)
      return {
        id: q.id,
        number: index + 1,
        text: q.question,
        recommended: q.recommended,
        ...(q.recommendedChoices
          ? { recommendedChoices: [...q.recommendedChoices], multi: q.multi }
          : {}),
        ...(answer && !answer.reopened ? { answer: answer.choice } : {}),
      }
    })
  return {
    id: batch.id,
    ...(batch.step ? { step: batch.step } : {}),
    ...(batch.title ? { title: batch.title } : {}),
    ...(batch.ahead ? { ahead: batch.ahead } : {}),
    members,
  }
}

export async function askBatch(
  ctx: Ctx,
  task: Host & Partial<Pick<Task, "dir">>,
  input: unknown,
  extra: { agent?: string } = {},
): Promise<Result<AskedBatch>> {
  return locked(ctx, task, async () => {
    if (!input || typeof input !== "object" || Array.isArray(input))
      return bad("a batch needs an id and questions")
    const given = input as Record<string, unknown>
    const unknown = Object.keys(given).filter((key) => !BATCH_FIELDS.includes(key))
    if (unknown.length)
      return bad(
        `unknown batch fields: ${unknown.join(", ")}. Put facts, diagram and evidence on each question's choices.`,
      )
    if (
      typeof given.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,120}$/.test(given.id) ||
      !Array.isArray(given.questions) ||
      given.questions.length < 1 ||
      given.questions.length > 24
    )
      return bad("a batch needs a stable id and 1 to 24 questions")
    if (JSON.stringify(input).length > 100_000)
      return bad("the batch is too large (100 KB maximum)")
    if (
      given.questions.some(
        (question) =>
          !question ||
          typeof question !== "object" ||
          Array.isArray(question) ||
          typeof question.id !== "string" ||
          typeof question.question !== "string",
      )
    )
      return bad("each batch member needs its id and question text")
    const requestedQuestions = given.questions
    const batches = await stored(ctx, task)
    const existing = batches.find((b) => b.id === given.id)
    if (existing) {
      const again = await republish(ctx, task, existing, batches, requestedQuestions)
      if (!again.ok || existing.step === undefined) return again
      const same = batches.filter((b) => b.step === existing.step)
      const label = `${existing.step.charAt(0).toUpperCase()}${existing.step.slice(1)}`
      return ok({
        ...again.data,
        count: `batch ${same.indexOf(existing) + 1} of this step (${label})`,
      })
    }
    const rules = await sevenRules(ctx, task, given, requestedQuestions, batches)
    if (!rules.ok) return rules
    const history = await answeredQuestions(ctx, task)
    const singleton = await openQuestion(ctx, task)
    const ids = new Set([
      ...history.map((a) => a.id),
      ...batches.flatMap((b) => b.questions.map((q) => q.id)),
      singleton?.id,
    ])
    const idProblem = questionIdProblem(given.questions, ids)
    if (idProblem !== null) return bad(idProblem)
    const longFacts = overlongFacts(given.questions)
    if (longFacts.length > 0)
      return bad(
        `each fact must be at most ${MAX_FACT_CHARS} characters; shorten these before asking: ${longFacts.join("; ")}`,
      )
    const questions: Question[] = []
    const links: QuestionBatch["links"] = []
    // A single question asked on its own joins the batch; one an earlier batch holds stays there.
    if (singleton && holding(batches, singleton.id) === undefined) {
      questions.push(singleton)
      links.push({ questionId: singleton.id, points: [] })
    }
    for (const raw of given.questions) {
      if (!validMember(raw))
        return bad("give each question 2 to 6 choices and its Done means point numbers")
      const parsed = parseQuestion(ctx, raw, [
        ...history,
        ...questions.map((q) => ({
          question: q.question,
          number: q.number,
          choice: "",
          at: q.asked,
        })),
      ])
      if (!parsed.ok) return parsed
      const gate = parsed.data.gate ? await readGate(ctx, task) : null
      if (
        parsed.data.gate &&
        (gate?.decision !== "pending" ||
          gate.target !== parsed.data.gate ||
          raw.gateId !== (gate.id ?? String(gate.opened)))
      )
        return bad("that review is no longer open; use its current gate id")
      const q: Question = {
        ...parsed.data,
        ...(gate ? { gateId: gate.id ?? String(gate.opened) } : {}),
        asked: ctx.clock.now(),
        ...(extra.agent ? { agent: extra.agent } : {}),
      }
      questions.push(q)
      links.push({ questionId: q.id, points: [...new Set<number>(raw.points)] })
    }
    const batch: QuestionBatch = {
      id: given.id,
      asked: ctx.clock.now(),
      agent: extra.agent ?? null,
      session: agentSession(ctx.env),
      questions,
      links,
      ...(rules?.ok ? { step: rules.data.step } : {}),
      ...(line(given.title, 120) ? { title: line(given.title, 120) } : {}),
      ...(line(given.ahead, 200) ? { ahead: line(given.ahead, 200) } : {}),
      ...(line(given.small, 300) ? { small: line(given.small, 300) } : {}),
      ...(line(given.why_another, 300) ? { whyAnother: line(given.why_another, 300) } : {}),
    }
    if (task.stage === "plan" && batch.session) {
      const planners = listRuns(ctx.home).filter(
        (run) =>
          run.status === "running" &&
          run.nativeSession === batch.session &&
          run.taskRuntimeDir === task.runtimeDir &&
          (run.purpose.kind === "new-task" ||
            (run.purpose.kind === "task" && run.purpose.phase === "planning")),
      )
      const planner = planners.length === 1 ? planners[0] : undefined
      if (planner?.nativeSession && planner.task)
        batch.planner = {
          run: planner.id,
          generation: planner.generation,
          nativeSession: planner.nativeSession,
          task: planner.task,
        }
    }
    await write(ctx, task, [...batches, batch])
    // One record for the batch, naming the questions it brings (an open single question was told of
    // earlier; a gate's approval question, with no item, belongs to the approval and is no
    // question event).
    const told = batch.questions
      .slice(singleton ? 1 : 0)
      .filter((q) => q.gate === undefined || q.item !== undefined)
    if (told.length > 0)
      await appendEvent(ctx, task, {
        event: "question_asked",
        batch: batch.id,
        ids: told.map((q) => q.id),
      })
    return ok({
      ...batch,
      ...(rules?.ok ? { count: rules.data.count } : {}),
      ...(rules?.ok && rules.data.warnings.length ? { warnings: rules.data.warnings } : {}),
    })
  })
}
/** The member as the agent sees it again: its wording and number of choices, for the refusal. */
function differences(stored: Question, raw: Record<string, unknown>): string[] {
  const parts: string[] = []
  if (raw.question !== stored.question) parts.push("question text changed")
  const n = Array.isArray(raw.choices) ? raw.choices.length : 0
  if (n !== stored.choices.length) parts.push(`choices ${stored.choices.length} → ${n}`)
  return parts
}

/** A request for more context that is still open: asked, and not cancelled. */
const moreOpen = (q: Question) => q.more !== undefined && q.more.cancelled === undefined

/**
 * Replace one stored member with the member as sent again (`raw`), keeping its number, its asked
 * time and the earlier wording when it was reworded. `found` closes an open Tell me more request.
 */
function reviseMember(
  ctx: Ctx,
  batch: StoredBatch,
  index: number,
  raw: Record<string, unknown>,
  history: AnsweredQuestion[],
): Result<null> {
  const question = batch.questions[index]
  if (!question) return bad("that question is not in this batch")
  if (!validMember(raw))
    return bad("give each question 2 to 6 choices and its Done means point numbers")
  const requestAt = (raw.found as { requestAt?: unknown } | undefined)?.requestAt
  if (
    moreOpen(question) &&
    raw.found !== undefined &&
    ((requestAt !== undefined && requestAt !== question.more?.at) ||
      (requestAt === undefined && question.more?.replaces !== undefined))
  )
    return bad(`the Tell me more request for ${question.id} changed; answer its current request_at`)
  const parsed = parseQuestion(ctx, raw, history)
  if (!parsed.ok) return parsed
  const finding = moreOpen(question) && raw.found !== undefined
  const found =
    finding && question.more
      ? foundOf(raw.found, question.more.request, ctx.clock.now(), question.more.at)
      : undefined
  if (finding && !found) return bad("give the requested context in found.text")
  const { more, ...kept } = question
  const reworded =
    parsed.data.question !== question.question ||
    parsed.data.choices.some((c, i) => c.label !== question.choices[i]?.label)
  const earlier = reworded
    ? [
        ...(question.earlier ?? []),
        {
          question: question.question,
          choices: question.choices.map((c) => ({
            label: c.label,
            ...(c.detail !== undefined ? { detail: c.detail } : {}),
          })),
          at: ctx.clock.now(),
        },
      ]
    : question.earlier
  batch.questions[index] = {
    ...kept,
    ...parsed.data,
    number: question.number,
    asked: question.asked,
    ...(earlier !== undefined ? { earlier } : {}),
    // A cancelled request is over: it does not come back with the republished card.
    ...(found ? { found } : more && moreOpen(question) ? { more } : {}),
  }
  const link = batch.links.find((l) => l.questionId === question.id)
  if (link && Array.isArray(raw.points)) link.points = [...new Set<number>(raw.points as number[])]
  return ok(null)
}

/**
 * The same batch sent again: its questions may not change, except that a question with an open
 * Tell me more request may be reworded (its text and its choices' labels, the same number of
 * choices in the same order). Answered members are kept as they are, and the reply says so.
 */
async function republish(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  existing: StoredBatch,
  batches: StoredBatch[],
  requested: Record<string, unknown>[],
): Promise<Result<AskedBatch>> {
  if (requested.some((q) => existing.cancelled?.[String(q.id)]))
    return bad("this batch contains cancelled questions; use a new stable batch and question id")
  const problems: string[] = []
  for (const raw of requested) {
    const stored = existing.questions.find((q) => q.id === raw.id)
    if (!stored) {
      problems.push(`${String(raw.id)}: not a question of this batch`)
      continue
    }
    const parts = differences(stored, raw)
    // Only a question the person asked more about may be reworded.
    const allowed = parts.filter((part) => part !== "question text changed" || moreOpen(stored))
    if (allowed.length !== parts.length || parts.some((p) => p.startsWith("choices ")))
      problems.push(`${stored.id}: ${parts.join("; ")}`)
  }
  if (problems.length)
    return bad(`this batch id already names different questions: ${problems.join(" · ")}`)
  const history = await answeredQuestions(ctx, task)
  const kept: { id: string; answer: string }[] = []
  for (const raw of requested) {
    const index = existing.questions.findIndex((q) => q.id === raw.id)
    const question = existing.questions[index]
    if (!question) continue
    const answer = latest(history, question)
    if (answer && !answer.reopened) {
      kept.push({ id: question.id, answer: answer.choice })
      continue
    }
    const revised = reviseMember(ctx, existing, index, raw, history)
    if (!revised.ok) return revised
  }
  await write(ctx, task, batches)
  return ok({ ...(await current(ctx, task, existing)), ...(kept.length ? { kept } : {}) })
}

/** What `question more` may carry: the answer to the request and the wording it improves. */
const MORE_FIELDS = ["found", "question", "choices", "grade", "why", "request_at"]
/**
 * Fields of the whole question an agent may send along when it republishes it for Tell me more.
 * They name what the stored batch already holds, so they are passed over and listed back.
 */
const KEPT_FIELDS = [
  "id",
  "batch",
  "recommended",
  "recommendedChoices",
  "points",
  "kind",
  "multi",
  "ahead",
]

/**
 * `question more <id>`: answer one open Tell me more request with a small patch (`found`, and
 * optionally a reworded `question`, choice labels, `grade`, `why`, per-choice `facts`, `evidence`,
 * `diagram`). Everything else is read from the stored batch; no other member is touched.
 */
export async function answerMore(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  id: string,
  patch: unknown,
): Promise<Result<{ batch: string; id: string; question: Question; ignored?: string[] }>> {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    return bad(
      'usage: qualitylayer question more <id> --file <json: {"found": {"text", "evidence"}, …}>',
    )
  const given = patch as Record<string, unknown>
  if (given.id !== undefined && given.id !== id)
    return bad(`the file's id is ${String(given.id)}, the command's is ${id}: send the same id`)
  const ignored = Object.keys(given).filter((key) => KEPT_FIELDS.includes(key))
  const unknown = Object.keys(given).filter(
    (key) => !MORE_FIELDS.includes(key) && !KEPT_FIELDS.includes(key),
  )
  if (unknown.length)
    return bad(
      `unknown fields: ${unknown.join(", ")}. question more takes ${MORE_FIELDS.join(", ")}`,
    )
  return locked(ctx, task, async () => {
    const batches = await stored(ctx, task)
    const batch = batches.findLast((b) => b.questions.some((q) => q.id === id))
    const index = batch?.questions.findIndex((q) => q.id === id) ?? -1
    const question = batch?.questions[index]
    if (!batch || !question) return bad(`no batch question has the id ${id} in this task`)
    const answer = latest(await answeredQuestions(ctx, task), question)
    if (batch.cancelled?.[id] || (answer && !answer.reopened) || !moreOpen(question))
      return bad(
        question.more?.cancelled !== undefined
          ? `the person cancelled the Tell me more request for ${id}: nothing to answer, keep waiting`
          : `no open Tell me more request for ${id}: nothing to answer`,
      )
    if (
      (given.request_at !== undefined && given.request_at !== question.more?.at) ||
      (given.request_at === undefined && question.more?.replaces !== undefined)
    )
      return bad(
        `the Tell me more request for ${id} changed; read its current request_at and answer that request`,
      )
    const text = (given.found as { text?: unknown } | undefined)?.text
    if (typeof text !== "string" || text.trim() === "")
      return bad("give the requested context in found.text")
    const edits = given.choices
    if (edits !== undefined && (!Array.isArray(edits) || edits.length !== question.choices.length))
      return bad(
        `${id}: choices ${question.choices.length} → ${Array.isArray(edits) ? edits.length : 0}: give one entry per choice, in order`,
      )
    const choices = question.choices.map((choice, i) => {
      const edit = (edits as unknown[] | undefined)?.[i]
      const patchOf = typeof edit === "string" ? { label: edit } : (edit ?? {})
      if (typeof patchOf !== "object" || Array.isArray(patchOf)) return choice
      return { ...choice, ...patchOf }
    })
    const keep: Record<string, unknown> = {
      about: question.about,
      artifact: question.artifact,
      settles: question.settles,
      gate: question.gate,
      gateId: question.gateId,
      item: question.item,
      late: question.late,
      finding: question.finding,
      multi: question.multi,
      ahead: question.ahead,
    }
    for (const key of Object.keys(keep)) if (keep[key] === undefined) delete keep[key]
    const raw: Record<string, unknown> = {
      ...keep,
      id,
      number: question.number,
      question: given.question ?? question.question,
      choices,
      recommended: question.recommendedChoices ?? question.recommended,
      grade: given.grade ?? question.grade,
      why: given.why ?? question.why,
      found: { ...(given.found as object), requestAt: question.more?.at },
      points: batch.links.find((l) => l.questionId === id)?.points ?? [],
    }
    if (raw.grade === undefined) delete raw.grade
    if (raw.why === undefined) delete raw.why
    // The request counts as picked up: the agent is answering it.
    if (question.more && question.more.taken === undefined) question.more.taken = ctx.clock.now()
    const revised = reviseMember(ctx, batch, index, raw, await answeredQuestions(ctx, task))
    if (!revised.ok) return revised
    await write(ctx, task, batches)
    return ok({
      batch: batch.id,
      id,
      question: batch.questions[index] as Question,
      ...(ignored.length ? { ignored } : {}),
    })
  })
}

/** The stored batch in the form `question ask --batch` takes, so an edit and resend needs no file. */
export function questionEcho<
  T extends Pick<Question, "recommended" | "recommendedChoices" | "multi">,
>(question: T) {
  return {
    ...question,
    recommended: question.multi
      ? [...(question.recommendedChoices ?? [question.recommended])]
      : question.recommended,
  }
}

export function batchEcho<T extends { questions: Question[] }>(batch: T) {
  return { ...batch, questions: batch.questions.map(questionEcho) }
}

export async function showBatch(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  id: string,
): Promise<Result<{ batch: Record<string, unknown>; answers: Record<string, string> }>> {
  const batch = (await stored(ctx, task)).find((b) => b.id === id)
  if (!batch) return bad(`no batch has the id ${id} in this task`)
  const history = await answeredQuestions(ctx, task)
  const answers: Record<string, string> = {}
  const questions = batch.questions
    .filter((q) => !batch.cancelled?.[q.id])
    .map((q) => {
      const answer = latest(history, q)
      if (answer && !answer.reopened) answers[q.id] = answer.choice
      const {
        asked: _asked,
        session: _session,
        agent: _agent,
        more: _more,
        found: _found,
        stopped: _stopped,
        front: _front,
        earlier: _earlier,
        ...member
      } = q
      return {
        ...questionEcho(member),
        points: batch.links.find((l) => l.questionId === q.id)?.points ?? [],
      }
    })
  return ok({
    batch: {
      id: batch.id,
      ...(batch.title ? { title: batch.title } : {}),
      ...(batch.ahead ? { ahead: batch.ahead } : {}),
      ...(batch.small ? { small: batch.small } : {}),
      ...(batch.whyAnother ? { why_another: batch.whyAnother } : {}),
      questions,
    },
    answers,
  })
}

export async function cancelBatch(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  input: { batch?: string; id?: string; reason?: string },
): Promise<Result<{ cancelled: string[]; batch: string }>> {
  return locked(ctx, task, async () => {
    const batches = await stored(ctx, task)
    const batch = input.batch
      ? batches.find((b) => b.id === input.batch)
      : input.id
        ? holding(batches, input.id)
        : batches.at(-1)
    if (!batch) return bad("that batch is not current")
    if (batch.session && batch.session !== agentSession(ctx.env))
      return bad("only the session that asked this batch can cancel it")
    const active = (await current(ctx, task, batch)).questions.filter(
      (q) => !input.id || q.id === input.id,
    )
    if (!active.length) return bad("no matching question is open")
    const singleton = await openQuestion(ctx, task)
    if (
      singleton &&
      active.some((q) => q.id === singleton.id) &&
      (await ctx.fs.exists(join(task.runtimeDir, "question.json")))
    ) {
      const cancelled = await cancelQuestion(ctx, task, singleton.id)
      if (!cancelled.ok) return cancelled
    }
    for (const question of active) {
      batch.cancelled = {
        ...batch.cancelled,
        [question.id]: {
          at: ctx.clock.now(),
          reason: input.reason ?? "cancelled by its asking session",
        },
      }
    }
    await write(ctx, task, batches)
    return ok({ cancelled: active.map((q) => q.id), batch: batch.id })
  })
}

export async function answerBatchInChat(ctx: Ctx, task: Host, id: string, words: string) {
  return locked(ctx, task, async () => {
    const batch = holding(await stored(ctx, task), id)
    if (!batch) return bad("no batch is open")
    const question = (await current(ctx, task, batch)).questions.find((q) => q.id === id)
    if (!question) return bad("that batch question is not open")
    return answerQuestion(ctx, task, words, { open: question, preserveOpen: true, via: "chat" })
  })
}

export async function batchReceipts(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<DeliveryReceipt[]> {
  const history = await answeredQuestions(ctx, task)
  const batches = await stored(ctx, task)
  return batches.flatMap((b) =>
    b.questions.flatMap((q) => {
      const a = latest(history, q)
      if (!a || a.reopened) return []
      const reply = b.replies?.[`${q.id}:${a.at}`] ?? b.replies?.[q.id]
      const acted = reply?.answerAt === a.at ? reply : undefined
      const handed = acted || a.delivered || (a.delivered === undefined && a.via === "chat")
      return [
        {
          id: `${b.id}:${q.id}:${a.at}`,
          kind: "question" as const,
          state: acted ? ("acted" as const) : handed ? ("picked-up" as const) : ("saved" as const),
          saved: a.at,
          pickedUp: a.pickedAt ?? (a.via === "chat" && a.delivered !== false ? a.at : null),
          acted: acted?.at ?? null,
          reply: acted?.text ?? null,
          // The answer is handed over once; a handed-over receipt keeps what the person chose.
          ...(handed
            ? {
                choice: a.choice,
                ...(a.note !== undefined ? { note: a.note } : {}),
                ...(a.pickedLabels?.length ? { labels: [...a.pickedLabels] } : {}),
              }
            : {}),
        },
      ]
    }),
  )
}
/**
 * Cancel on one member's Tell me more: that request is over and the card is back to plain waiting.
 * Every answer and every other member stays as it is; no `found` is kept. An agent that already
 * took the request is told so when it answers (`question more`), and a request cancelled before
 * it was taken never reaches the waiting agent.
 */
export async function cancelBatchMore(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  input: { batch: string; id: string },
): Promise<Result<Question>> {
  return locked(ctx, task, async () => {
    const batches = await stored(ctx, task)
    // The card holds every open batch under the newest's id: the question names its own batch.
    const batch = holding(batches, input.id)
    if (!batch || !batches.some((b) => b.id === input.batch))
      return bad("that batch is no longer current")
    const open = (await current(ctx, task, batch)).questions.find((q) => q.id === input.id)
    if (!open) return bad("that question is not waiting any more")
    if (open.more === undefined || open.more.cancelled !== undefined)
      return bad("nothing is being looked into for this question")
    const updated: Question = { ...open, more: { ...open.more, cancelled: ctx.clock.now() } }
    batch.questions = batch.questions.map((q) => (q.id === open.id ? updated : q))
    await write(ctx, task, batches)
    return ok(updated)
  })
}
export async function answerBatch(
  ctx: Ctx,
  task: Host & Partial<Task>,
  answer: BatchAnswer,
  options: AnswerUpload & {
    expected?: Pick<Question, "asked" | "question" | "gateId" | "found" | "session">
    /** The words the person wrote beside the choice they picked. */
    note?: string
  } = {},
): Promise<Result<{ answer: AnsweredQuestion; receipt: DeliveryReceipt } | { more: Question }>> {
  return locked(ctx, task, async () => {
    if (
      options.via === "chat" &&
      options.expected?.session &&
      (await terminalTaskFor(ctx, options.expected.session))?.runtimeDir !== task.runtimeDir
    )
      return bad("that session is no longer bound to this Terminal task")
    const batches = await stored(ctx, task)
    // The card holds every open batch under the newest's id: the question names its own batch.
    const batch = holding(batches, answer.id)
    if (!batch || !batches.some((b) => b.id === answer.batch))
      return bad("that batch is no longer current")
    const q = (await current(ctx, task, batch)).questions.find((q) => q.id === answer.id)
    if (!q) return bad("that question is not waiting any more")
    if (
      options.expected &&
      (q.asked !== options.expected.asked ||
        q.question !== options.expected.question ||
        q.gateId !== options.expected.gateId ||
        q.found?.at !== options.expected.found?.at)
    )
      return bad("that question changed before the answer was recorded")
    if ("more" in answer) {
      if (options.files?.length) return bad("Send files with an answer, rather than Tell me more.")
      const updated = {
        ...q,
        more: {
          request: answer.more.request.trim().slice(0, 600),
          at: Math.max(ctx.clock.now(), (q.more?.at ?? q.found?.requestAt ?? 0) + 1),
          ...(q.more || q.found
            ? { replaces: q.more?.at ?? q.found?.requestAt ?? q.found?.at }
            : {}),
        },
      }
      batch.questions = batch.questions.map((it) => (it.id === q.id ? updated : it))
      await write(ctx, task, batches)
      return ok({ more: updated })
    }
    if (q.gate && "unsure" in answer) return bad("a review question has no Not sure; pick a choice")
    if (
      "choice" in answer &&
      (!Number.isInteger(answer.choice) ||
        !q.choices[answer.choice] ||
        q.choices[answer.choice]?.words)
    )
      return bad("pick a valid choice, or send your own words")
    if ("choices" in answer) {
      const problem = picksProblem(q, answer.choices)
      if (problem) return bad(problem)
    }
    if ("text" in answer && (!answer.text.trim() || answer.text.length > 4000))
      return bad("give an answer of 1 to 4000 characters")
    const words =
      "choices" in answer
        ? answer.choices.map((i) => q.choices[i]?.label ?? "").join(" + ")
        : "choice" in answer
          ? String(answer.choice + 1)
          : "text" in answer
            ? answer.text
            : recommendedLabel(q)
    return withAnswerFiles(ctx, task, options, async (files) => {
      let originReceipt: string | undefined
      if (q.gate) {
        originReceipt = randomUUID()
        const gate = await readGate(ctx, task)
        if (!gate || !task.slug) return bad("a review belongs to its current task")
        if (
          !q.item &&
          (await current(ctx, task, batch)).questions.some((other) => other.id !== q.id)
        )
          return bad("answer the remaining questions before approval")
        const pick = "choice" in answer ? (q.choices[answer.choice]?.label ?? "") : words
        const applied = await applyGatePick(ctx, task as Task, gate, {
          item: q.item,
          pick,
          notes: options.note?.trim() || undefined,
          by: options.via === "chat" ? "chat" : "cockpit",
          choices: q.choices.map((c) => c.label),
          question: { id: q.id, number: q.number, receipt: originReceipt },
        })
        if (!applied.ok) return applied
        if (applied.data === "refused") return bad("use this review's current choices")
      }
      const said = await answerQuestion(ctx, task, words, {
        open: q,
        preserveOpen: true,
        literalWords: "text" in answer,
        ...(options.note?.trim() ? { note: options.note.trim() } : {}),
        ...("choices" in answer ? { picks: answer.choices } : {}),
        via: options.via ?? "app",
        ...(files ? { files } : {}),
        ...(originReceipt ? { originReceipt } : {}),
        ...("unsure" in answer ? { unsure: true } : {}),
      })
      if (!said.ok) return said
      if (!said.data.entry) return bad("no answer was recorded")
      const receipt = (await batchReceipts(ctx, task)).find(
        (r) => r.id === `${batch.id}:${q.id}:${said.data.entry?.at}`,
      )
      if (!receipt) return bad("no receipt was recorded")
      return ok({ answer: said.data.entry, receipt })
    })
  })
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Preserve the complete native selection; Other remains the person's own words. */
export function pickedBatchAnswer(
  q: Question,
  batch: string,
  answer: SessionAnswer,
  source: "native" | "typed" = "native",
): BatchAnswer {
  const base = { batch, id: q.id }
  const labels = answer.labels ?? [answer.answer]
  if (labels.length === 1) {
    const text = labels[0]?.trim() ?? ""
    if (/^(?:tell me )?more$/i.test(text)) return { ...base, more: { request: answer.notes ?? "" } }
    if (/^(?:not sure|unsure)$/i.test(text)) return { ...base, unsure: true }
  }
  const picks = labels.map((label) => {
    const plain = label.replace(/\s*\(Recommended\)$/i, "").trim()
    if (source !== "typed") return q.choices.findIndex((choice) => sameText(choice.label, plain))
    // Words beside the choice stay words: answering records them as the note of the choice.
    const own = typedAnswer(plain, q.choices, { recommended: q.recommended, own: true })
    if (own.kind === "choice" && own.note !== undefined) return -1
    const found =
      own.kind === "choice" ? own : typedAnswer(plain, q.choices, { recommended: q.recommended })
    return found.kind === "choice" ? found.index : -1
  })
  if (picks.length && picks.every((index) => index >= 0 && index < q.choices.length)) {
    if (q.multi) return { ...base, choices: picks }
    if (picks.length === 1) return { ...base, choice: picks[0] as number }
  }
  const numbered = source === "typed" && q.multi ? matchOptions(answer.answer, q.choices) : null
  return numbered ? { ...base, choices: numbered } : { ...base, text: answer.answer }
}

/** Native answers count only for one current Terminal member in the session's bound task. */
export async function recordPickedBatchAnswer(
  ctx: Ctx,
  pick: { session: string; question: string; answer: string; notes?: string; proof: SessionProof },
): Promise<boolean> {
  if (
    !pick.session ||
    pick.proof?.session !== pick.session ||
    !pick.proof.answers.some(
      (answer) =>
        sameText(answer.question, pick.question) &&
        answer.answer === pick.answer &&
        answer.notes === pick.notes,
    )
  )
    return false
  const task = await terminalTaskFor(ctx, pick.session)
  if (!task) return false
  const candidates: {
    task: Task
    batch: string
    q: Question
    openedAt: number
    gateOpenedAt?: number
  }[] = []
  const batch = await readBatch(ctx, task)
  if (batch?.session !== pick.session || (batch.agent && batch.agent !== pick.proof.agent))
    return false
  // The session answers only the batches asked on its side; an App batch stays the App's.
  if (!askedInAgent(task, batch.questions)) return false
  for (const q of batch.questions) {
    if (!(await matchesChatQuestion(ctx, q, pick.question, pick.proof.agent))) continue
    const gate = q.gate ? await readGate(ctx, task) : null
    candidates.push({
      task,
      batch: batch.id,
      q,
      openedAt: Math.max(q.asked, q.found?.at ?? 0),
      ...(gate ? { gateOpenedAt: gate.opened } : {}),
    })
  }
  const only = candidates[0]
  if (!only || candidates.length !== 1) return false
  const target: PickedTarget = {
    id: only.q.id,
    question: pick.question,
    session: pick.session,
    openedAt: only.openedAt,
    ...(only.gateOpenedAt !== undefined ? { gateOpenedAt: only.gateOpenedAt } : {}),
  }
  return consumePickedCall(ctx, only.task, pick.proof, {
    target: async () => {
      const current = await readBatch(ctx, only.task, only.batch)
      const q = current?.questions.find((q) => q.id === only.q.id)
      if (
        !q ||
        q.question !== only.q.question ||
        q.asked !== only.q.asked ||
        q.gateId !== only.q.gateId ||
        q.found?.at !== only.q.found?.at
      )
        return null
      return target
    },
    apply: async (answer) =>
      (
        await answerBatch(ctx, only.task, pickedBatchAnswer(only.q, only.batch, answer), {
          via: "chat",
          expected: only.q,
        })
      ).ok,
  })
}
export async function undoBatch(
  ctx: Ctx,
  task: Host,
  input: { batch: string; id: string; answerAt: number },
  change = false,
): Promise<Result<QuestionBatch>> {
  return locked(ctx, task, async () => {
    const all = await stored(ctx, task)
    const batch = holding(all, input.id)
    if (!batch || !all.some((b) => b.id === input.batch))
      return bad("that batch is no longer current")
    if (!change && ctx.clock.now() - input.answerAt > 5000)
      return bad("Undo is available for five seconds; use Change on the answer")
    const reopened = await reopenAnswer(ctx, task, input.id, input.answerAt)
    return reopened.ok ? ok(await current(ctx, task, batch)) : reopened
  })
}
export async function pollBatch(ctx: Ctx, task: Pick<Task, "runtimeDir">, batchId?: string) {
  return locked(ctx, task, async () => {
    const all = await stored(ctx, task)
    const batches = batchId === undefined ? all : all.filter((batch) => batch.id === batchId)
    const members =
      batchId === undefined
        ? undefined
        : new Set(batches.flatMap((batch) => batch.questions.map((question) => question.id)))
    const more_requests = batches.flatMap((b) =>
      b.questions.flatMap((q) => {
        if (!q.more || q.more.taken !== undefined || q.more.cancelled !== undefined) return []
        q.more.taken = ctx.clock.now()
        return [
          {
            batch: b.id,
            id: q.id,
            request: q.more.request,
            request_at: q.more.at,
            points: b.links.find((l) => l.questionId === q.id)?.points ?? [],
          },
        ]
      }),
    )
    if (more_requests.length) await write(ctx, task, all)
    return {
      ...(await takeMeanwhile(ctx, task, members)),
      item_answers: batchId === undefined ? await takeImmediate(ctx, task) : [],
      more_requests,
      links: batches.flatMap((b) => b.links),
      receipts: (await batchReceipts(ctx, task)).filter(
        (receipt) => batchId === undefined || receipt.id.startsWith(`${batchId}:`),
      ),
    }
  })
}

/** The completed App batch and its one handoff share the same lock as wait/poll pickup. */
export async function withCompletedBatch(
  ctx: Ctx,
  task: Task,
  questionId: string,
  act: (
    batch: QuestionBatch,
    revision: string,
    save: (attempt: BatchContinuation) => Promise<void>,
  ) => Promise<void>,
): Promise<void> {
  await locked(ctx, task, async () => {
    if (task.stage !== "plan" || task.answers !== "app") return
    const all = await stored(ctx, task)
    const batch = holding(all, questionId)
    if (!batch?.planner || batch.questions.some((q) => q.gate)) return
    if ((await openBatches(ctx, task, all)).length || (await openQuestion(ctx, task))) return
    const history = await answeredQuestions(ctx, task)
    const answers = batch.questions.map((q) => latest(history, q))
    if (!answers.length || answers.some((a) => !a || a.reopened || a.via !== "app")) return
    if (answers.every((a) => a?.delivered !== false)) return
    const revision = answerRevision(batch, history)
    if (batch.continuations?.some((attempt) => attempt.revision === revision)) return
    await act(batch, revision, async (attempt) => {
      batch.continuations = [
        ...(batch.continuations ?? []).filter((prior) => prior.revision !== revision),
        attempt,
      ]
      await write(ctx, task, all)
    })
  })
}
/** `1,3` (or `none`) as Done means numbers, or why it is not one. */
export function parsePoints(raw: string): Result<number[]> {
  const text = raw.trim()
  if (text.toLowerCase() === "none") return ok([])
  const parts = text.split(",").map((part) => part.trim())
  if (!parts.every((part) => /^[1-9]\d{0,2}$/.test(part)))
    return bad('--points takes Done means numbers like "1,3" (or "none" to clear)')
  return ok([...new Set(parts.map(Number))].sort((a, b) => a - b))
}

/** Why these are not points of the task's Done means, or null when they are. */
export async function pointsProblem(
  ctx: Ctx,
  task: Pick<Task, "dir">,
  points: number[],
): Promise<string | null> {
  if (points.length > 32) return "a question links to at most 32 points"
  if (points.length === 0) return null
  const known = (await doneMeansOf(ctx, task)).map((p) => p.n)
  if (known.length === 0) return "this task has no Done means yet: write them in the Plan first"
  const unknown = points.filter((n) => !known.includes(n))
  return unknown.length
    ? `Done means has no point ${unknown.join(", ")}: its points are ${known.join(", ")}`
    : null
}

/** Plain words when the id is the task's question asked alone, which has no batch to act on. */
async function askedAloneNote(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  id: string,
  what: "link" | "reply",
): Promise<string | null> {
  const open = await openQuestion(ctx, task)
  const answered = (await answeredQuestions(ctx, task)).some((a) => a.id === id)
  if (open?.id !== id && !answered) return null
  const done = what === "link" ? "link it to Done means points" : "reply to it"
  return `${id} was asked alone, not in a batch, so there is nothing to ${done}${
    answered ? "; its answer is already in Decided with you" : ""
  }`
}

/**
 * Set which Done means points a batch member's answer settles. Members are published before Done
 * means exist (`points: []`); the agent links them once the points are written.
 */
export async function linkPoints(
  ctx: Ctx,
  task: Host & Pick<Task, "dir">,
  id: string,
  points: number[],
): Promise<Result<{ batch: string; id: string; points: number[] }>> {
  const problem = await pointsProblem(ctx, task, points)
  if (problem) return bad(problem)
  return locked(ctx, task, async () => {
    const all = await stored(ctx, task)
    const batch = all.findLast((b) => b.questions.some((q) => q.id === id))
    if (!batch)
      return bad(
        (await askedAloneNote(ctx, task, id, "link")) ?? `no batch question has the id ${id}`,
      )
    const link = batch.links.find((l) => l.questionId === id)
    if (link) link.points = points
    else batch.links.push({ questionId: id, points })
    await write(ctx, task, all)
    return ok({ batch: batch.id, id, points })
  })
}

export async function replyBatch(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  id: string,
  text: string,
  answerAt?: number,
): Promise<Result<DeliveryReceipt[]>> {
  return locked(ctx, task, async () => {
    if (!text.trim() || text.length > 4000) return bad("a reply needs 1 to 4000 characters")
    const all = await stored(ctx, task)
    const batch = all.findLast((b) => b.questions.some((q) => q.id === id))
    const answer = (await answeredQuestions(ctx, task)).findLast((a) => a.id === id)
    if (!batch)
      return bad(
        (await askedAloneNote(ctx, task, id, "reply")) ?? `no batch question has the id ${id}`,
      )
    // The reply names the one move that hands the answer over, so it is never only repeated.
    const read = "run `qualitylayer wait --for answer`, which hands it to you, then reply"
    if (!answer) return bad(`${id} has no answer yet: ${read}`)
    if (
      answer.reopened ||
      (!answer.delivered && !(answer.delivered === undefined && answer.via === "chat"))
    )
      return bad(`${id}'s current answer has not reached you yet: ${read}`)
    if (answerAt !== undefined && answerAt !== answer.at)
      return bad(`${id}'s answer was changed since you read it: ${read}`)
    batch.replies = {
      ...batch.replies,
      [`${id}:${answer.at}`]: { text: text.trim(), at: ctx.clock.now(), answerAt: answer.at },
    }
    await write(ctx, task, all)
    return ok(await batchReceipts(ctx, task))
  })
}
