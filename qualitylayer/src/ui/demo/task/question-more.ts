// The demo's Tell me more and multi-select, for the question card. The demo runs no agent, so this
// plays one: a request is picked up after 1.5 s (with a progress line) and answered after 5 s, the
// way the App Model's `moreSend` plays it: "I don't get the question" republishes the question in
// plainer words (the earlier wording kept), "Explain the choices" and own words add what was found.
//
// Two knobs on the demo address, for the states a person cannot wait for:
//   `?more=late`    nobody picks the request up (the 20 s line)
//   `?multi=<id>`   that question takes several choices
// Both only matter on the demo.

import type { Question } from "../../../core/task/question.ts"
import type { TaskDetail } from "../../api.ts"
import { moreKind } from "../../turn/more-words.ts"
import type { Area } from "./area.ts"

export const DEMO_TAKEN_MS = 1_500
export const DEMO_ANSWERED_MS = 5_200

const knob = (name: string): string | null => {
  try {
    return new URLSearchParams(globalThis.location?.search ?? "").get(name)
  } catch {
    return null
  }
}

/** The questions of the demo's batches, in plainer words: the text, the reason and the choice labels. */
const PLAIN: Record<string, { question: string; why: string; choices: string[] }> = {
  r1: {
    question: "Where should a request be counted: as it arrives, or later from the logs?",
    why: "Counting as it arrives shows usage within minutes, and a retried request keeps its id, so it is counted once. The logs have every request too, but only an hour later.",
    choices: [
      "As it arrives, once per request id",
      "From the logs, once an hour",
      "Both, and compare them every night",
    ],
  },
  r2: {
    question: "When is a five-minute block of usage final?",
    why: "Some events arrive late, even days late. The answer decides when the count stops changing.",
    choices: [
      "After five minutes; anything late fixes the next invoice",
      "Only once events stop coming",
      "After an hour",
    ],
  },
  r3: {
    question: "The work is about eleven slices: ship it as one task, or as two?",
    why: "Rebuilding past usage is three slices. Split off, the rest ships a day sooner, but invoices start without history.",
    choices: [
      "One task",
      "Two tasks: billing first, past usage after",
      "Skip rebuilding past usage",
    ],
  },
}

const EXPLAINED =
  "Each choice, in plain words: the first shows usage soonest and counts a retry once; the second adds nothing to the gateway but shows usage an hour late; the third does the most and takes the longest."

/** Where the request is, for the pending timers: the same question, the same request, not cancelled. */
const stillAsked = (task: TaskDetail, id: string, at: number) =>
  task.question?.id === id &&
  task.question.more?.at === at &&
  task.question.more.cancelled === undefined

type MoreKind = ReturnType<typeof moreKind>

function applyTakenMore(task: TaskDetail, id: string, at: number, kind: MoreKind): boolean {
  const q = task.question
  if (q === null || q === undefined || !stillAsked(task, id, at) || q.more === undefined)
    return false
  task.question = {
    ...q,
    more: {
      ...q.more,
      taken: Date.now(),
      lines: [
        kind === "explain"
          ? "rereading research finding 1 for what each choice means"
          : "rereading research finding 1 for plainer words",
      ],
    },
  }
  return true
}

function buildPlainUpdate(q: Question) {
  const plain = PLAIN[q.id] ?? {
    question: `In other words: ${q.question}`,
    why: q.why ?? "",
    choices: [],
  }
  return {
    plain,
    patch: {
      question: plain.question,
      ...(plain.why !== "" ? { why: plain.why } : {}),
      choices: q.choices.map((c, i) => ({ ...c, label: plain.choices[i] ?? c.label })),
      earlier: [
        ...(q.earlier ?? []),
        {
          question: q.question,
          choices: q.choices.map((c) => ({ label: c.label })),
          at: Date.now(),
        },
      ],
    },
  }
}

function moreAnswerText(kind: MoreKind, request: string): string {
  if (kind === "explain") return EXPLAINED
  if (kind === "ask") return `About “${request}”: ${EXPLAINED}`
  return "The same question in plainer words. The choices mean what they meant before."
}

function applyAnsweredMore(
  task: TaskDetail,
  id: string,
  at: number,
  kind: MoreKind,
  request: string,
): boolean {
  const q = task.question
  if (q === null || q === undefined || !stillAsked(task, id, at)) return false
  const { more: _closed, ...rest } = q
  const plainUpdate = kind === "plain" ? buildPlainUpdate(q) : undefined
  task.question = {
    ...rest,
    ...(plainUpdate?.patch ?? {}),
    found: { asked: request, text: moreAnswerText(kind, request), evidence: [], at: Date.now() },
  }
  // The strip names the question by its wording.
  if (plainUpdate !== undefined && task.batch != null) {
    task.batch = {
      ...task.batch,
      members: task.batch.members.map((m) =>
        m.id === q.id ? { ...m, text: plainUpdate.plain.question } : m,
      ),
    }
  }
  return true
}

/**
 * The visitor pressed Tell me more: the question carries the request now, and an agent that is not
 * there is played by two timers.
 */
export function demoMore(task: TaskDetail, open: Question, request: string, onChange: () => void) {
  const at = Date.now()
  const asked: Question = { ...open, more: { request, at } }
  task.question = asked
  if (knob("more") === "late") return asked
  const kind = moreKind(request)
  setTimeout(() => {
    if (applyTakenMore(task, open.id, at, kind)) onChange()
  }, DEMO_TAKEN_MS)
  setTimeout(() => {
    if (applyAnsweredMore(task, open.id, at, kind, request)) onChange()
  }, DEMO_ANSWERED_MS)
  return asked
}

/** Cancel on a request: the card goes back to plain waiting. */
export function demoCancelMore(task: TaskDetail): void {
  const q = task.question
  if (q?.more !== undefined && q.more.cancelled === undefined)
    task.question = { ...q, more: { ...q.more, cancelled: Date.now() } }
}

/** `?multi=<id>`: that question, when it is the one open, takes several choices. */
export function demoMulti(task: TaskDetail): void {
  const id = knob("multi")
  if (id !== null && task.question?.id === id && task.question.multi !== true)
    task.question = { ...task.question, multi: true }
}

export const questionMore: Area = {
  patch: (task) => {
    demoMulti(task)
    return task
  },
}
