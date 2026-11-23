// What Home's two queues say about each row, as plain data: which task, where it is in the three
// steps and whose move it is. App Model: Home (attention.jsx, Row / Queue). Home.tsx draws these
// rows and wires their clicks; nothing here reads the DOM, the clock or the network, so a row's
// words are tested without a browser.

import { type FlowStepId, flowStepOf } from "../core/flow.ts"
import { doingWords, liveRow, shellStatus } from "../core/interaction-shell/status.ts"
import type { Person } from "../core/team/people.ts"
import type { TaskSummary } from "./api.ts"
import { agentOf, elapsedWords, ownWords } from "./home-rows-helpers.ts"
import { ago } from "./hooks.ts"
import { agentInfo, type ForYouItem, stepLabel } from "./model.ts"
import {
  finalApproved,
  landingOf,
  prOpen,
  pullRequestChip,
  pullRequestLine,
} from "./shell/lines.ts"

/** Whose move the row's current step is: you, an agent at work, a quiet agent, a stop, a wait or nobody's. */
export type RowTone = "you" | "work" | "quiet" | "stop" | "wait" | "done"

/** The step a row is at; a teammate's artifact has no steps, only its name. */
export type RowStep = FlowStepId | "artifact" | "chat"

export type HomeRow = {
  /** The row's test id: the one the old rows carried, so a kind of row stays findable. */
  testId: string
  taskId: string
  title: string
  /** The task's project, for its tile and name; absent for a teammate's task. */
  origin?: Pick<TaskSummary, "project" | "projectName">
  /** The teammate who asks or answers, drawn as an avatar beside "Anna Keller asks you". */
  person?: Person
  asker?: string
  /** The agent that runs the task, drawn as its mark and name. */
  agent?: { id: string | null; name: string }
  /** What was asked or answered, a few words of the teammate's own. */
  quote?: string
  step: RowStep
  tone: RowTone
  /** The line under the step bar: what the task is doing, or what the question is about. */
  work: string
  /** The chip: whose move it is, in words ("Answer Anna", "Codex working"). */
  move: string
  /** One line under the chip: how long it has waited or run, or the news in words ("No report for 12 min"). */
  note?: string
  /** What the chip means, for a tooltip: the words a row would otherwise repeat on every line. */
  tip?: string
  /** A small mark after the chip: an ask that holds the approval, or only gives an opinion. */
  hold?: "holds" | "opinion"
  /** An ask older than a day: "late" follows the note in amber. */
  late?: boolean
  /** An agent's ring turns, but only while it runs. */
  running?: boolean
}

/** A status line begins like a sentence, whatever case the status words came in. */
const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/** The step a task is at: the shipped task whose pull request is open is still at Verify. */
export const stepOf = (task: Pick<TaskSummary, "stage">): RowStep =>
  task.stage === "chat" ? "chat" : (flowStepOf(task.stage) ?? "plan")

/**
 * What a finished task says in Home's Shipped lists: its pull request as the chip ("Opening pull
 * request" from the click, then "Pull request #412") with what the pull request does beside it
 * ("Checks running"), or how it closed ("Approved", "closed without shipping"). `how` is the
 * closing record's own word for a task with no open pull request.
 */
export function doneWords(task: TaskSummary, how: string): { chip: string | null; state: string } {
  const chip = prOpen(task) ? pullRequestChip(task) : null
  if (chip !== null) {
    const rest = (pullRequestLine(task) ?? "").replace(/^Pull request(?: · open)?(?: · |$)/, "")
    return { chip, state: chip === "Opening pull request" || rest === "" ? "" : sentence(rest) }
  }
  // Saved and not applied yet, or approved with no pull request and not landed.
  if (task.stage !== "shipped" && finalApproved(task)) return { chip: null, state: "Approved" }
  return { chip: null, state: landingOf(task) !== null ? "Approved · not merged yet" : how }
}

/** A local task waiting for the person's next move. */
export function needsRow(item: ForYouItem, ctx: { now: number; building: boolean }): HomeRow {
  const { task, group } = item.own
  const words = ownWords(item, task, group, ctx.now, ctx.building)
  const stopped = shellStatus(task, ctx.now).state === "stopped"
  return {
    testId: "home-task",
    taskId: task.id,
    title: task.title,
    origin: task,
    agent: agentOf(task),
    step: stepOf(task),
    tone: stopped ? "stop" : "you",
    ...words,
    work: sentence(words.work),
  }
}

/** A task your agent works on: what it does, and how long it has run; words only when that is news. */
export function runningRow(
  task: TaskSummary,
  ctx: {
    now: number
    atWork: boolean
    /** The words of the App window the agent runs in, when one is bound to the task. */
    session?: { text: string; since: number } | undefined
  },
): HomeRow {
  const { now, atWork, session } = ctx
  const status = shellStatus(task, now)
  const agent = agentOf(task)
  const work =
    status.state === "working" || status.state === "quiet" ? status.doing : doingWords(task, now)
  const doing =
    task.live === undefined
      ? (task.helpers.filter((helper) => helper.line).sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0]
          ?.line ?? work)
      : work
  const base = {
    testId: "run-line",
    taskId: task.id,
    title: task.title,
    origin: task,
    ...(agent ? { agent } : {}),
    step: stepOf(task),
  }
  const since = session?.since ?? task.session?.since ?? null
  const age = since ? { note: ago(since, now) } : {}
  // An approved task is never a row here: nothing runs, so it stands with the finished ones (`doneWords`).
  // A Chat is read from its hooks: the agent's own line, and whose move it is (Your turn is not work).
  const chat = task.type === "chat" ? liveRow(task, now) : null
  const line = sentence(chat?.line ?? session?.text ?? doing)
  if (chat?.state === "turn") return { ...base, tone: "done", work: line, move: "Your turn" }
  if (!atWork) return { ...base, tone: "wait", work: line, move: "Nothing running" }
  if (status.state === "quiet")
    return {
      ...base,
      tone: "quiet",
      work: line,
      move: "Quiet",
      tip: "The agent's process is alive but has not reported for a while, often during a long test run.",
      note: `No report for ${elapsedWords(now - (status.lastActivity ?? now))}`,
    }
  return {
    ...base,
    tone: "work",
    work: line,
    move: "Working",
    ...age,
    running: true,
  }
}

/** A session open in the App that no task owns, or whose task Home does not list (a retained one). */
export function sessionRow(input: {
  taskId: string
  title: string
  agent: string
  /** Whether a task exists for it; a planning session has none yet. */
  bound: boolean
  status: string
  tone: RowTone
  step: FlowStepId | null
}): HomeRow {
  return {
    testId: "managed-run-line",
    taskId: input.taskId,
    title: input.title,
    agent: { id: input.agent, name: agentInfo(input.agent).name },
    step: input.step ?? "plan",
    tone: input.tone,
    work: input.bound
      ? `${stepLabel(input.step ?? "plan")} · last recorded task step`
      : "Task not created yet",
    move: input.status,
    ...(input.tone === "stop"
      ? { tip: "The process ended; its work is kept." }
      : { note: "No current task activity reported" }),
  }
}
