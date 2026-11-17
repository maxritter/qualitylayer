// What Home's two queues say about each row, as plain data: which task, where it is in the three
// steps and whose move it is. App Model: Home (attention.jsx, Row / Queue). Home.tsx draws these
// rows and wires their clicks; nothing here reads the DOM, the clock or the network, so a row's
// words are tested without a browser.

import { type FlowStepId, flowStepOf } from "../core/flow.ts"
import {
  agentIdOf,
  asksInChat,
  doingWords,
  liveRow,
  shellStatus,
} from "../core/interaction-shell/status.ts"
import type { Person } from "../core/team/people.ts"
import type { TaskSummary } from "./api.ts"
import { ago } from "./hooks.ts"
import { agentInfo, type ForYouItem, type NeedsGroup, stepLabel } from "./model.ts"
import { outsideAction, outsideSub } from "./outside-home.ts"
import {
  finalApproved,
  landingOf,
  openLine,
  openMove,
  prOpen,
  pullRequestChip,
  pullRequestLine,
  statusWords,
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

/** A time already gone, rounded down: 61 minutes is "1 h", never "2 h". */
function elapsedWords(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000))
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h`
}

const agentOf = (task: TaskSummary): HomeRow["agent"] => {
  const id = agentIdOf(task)
  return { id, name: agentInfo(id ?? undefined).name }
}

/** The step a task is at: the shipped task whose pull request is open is still at Verify. */
export const stepOf = (task: Pick<TaskSummary, "stage">): RowStep =>
  task.stage === "chat" ? "chat" : (flowStepOf(task.stage) ?? "plan")

/** The pull request line with its number and without "open", which the chip and the list already say. */
function prWords(task: TaskSummary, line: string): string {
  const number = task.pullRequest?.number
  const named =
    number === undefined ? line : line.replace("Pull request", `Pull request #${number}`)
  return named.replace(" · open", "")
}

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

type OwnWords = { move: string; work: string; note?: string }

/** The move and the status line of one of the member's own tasks that waits on them. */
function ownWords(
  item: ForYouItem,
  task: TaskSummary,
  group: NeedsGroup | undefined,
  now: number,
  building: boolean,
): OwnWords {
  const status = shellStatus(task, now)
  // The age alone: the chip says whose move it is and the column says what the task is doing.
  // A task with no known start (a Plan without `created`) shows no time.
  const waits = item.since > 0 ? elapsedWords(now - item.since) : undefined
  if (item.agentIssue) return { move: "Open the agent", work: item.agentIssue.reason, note: waits }
  // Held by its plan limit (core/limits): nothing is asked or done until it resets.
  if (status.signals?.limit != null)
    return {
      move: status.doing,
      work: `${agentOf(task)?.name ?? "The agent"} hit its usage limit`,
      note: waits,
    }
  // A Chat has no steps to read: its agent's own line says what it needs, or that its process ended.
  const live = task.type === "chat" ? liveRow(task, now) : null
  if (live?.state === "needs")
    return { move: `Answer ${agentOf(task)?.name ?? "your agent"}`, work: live.line, note: waits }
  if (live?.state === "stopped-early")
    return {
      move: "Continue",
      work: "Its process ended while working",
      note: "Stopped early · work kept",
    }
  // The build's lead ended its turn in its own chat: whether it asked is not known, only where to look.
  if (asksInChat(task, now))
    return { move: `Open ${agentOf(task)?.name}`, work: doingWords(task, now), note: waits }
  const outside = outsideAction(task, now)
  if (outside !== null)
    return { move: `${outside} in your own agent`, work: status.doing, note: outsideSub(task) }
  const pullRequest = openLine(task)
  if (pullRequest !== null)
    // Changes after the approval wait for Approve change; the pull request's own words wait on GitHub.
    return { move: openMove(task), work: prWords(task, pullRequest), note: waits }
  if (!building && task.action === "implement") {
    const outside = task.start?.route === true && task.start.where === "here"
    return {
      move: outside ? "Open the task" : "Start the build",
      work: outside ? status.doing : "Plan approved · nothing builds until you start it",
      note: waits,
    }
  }
  if (task.action === "review" && !task.gate?.locked)
    return { move: "Review the Plan", work: "Complete · ready to approve", note: waits }
  if (task.action === "final")
    return { move: "Review the change", work: "Built and verified", note: waits }
  if (agentIdOf(task) === null)
    return { move: "Open the task", work: "No agent is attached", note: waits }
  const notice = group?.notices.find(
    (n) => n.tone === "bad" || n.key.includes("no-agent") || n.key.endsWith("|asking"),
  )
  if (notice) return { move: "Open the task", work: notice.text, note: waits }
  const current = building && task.action === "implement" ? { ...task, action: null } : task
  const currentStatus = shellStatus(current, now)
  const words = statusWords(current, currentStatus)
  const asked = /^\d+ (question|questions|choice|choices)$/.test(words)
  if (currentStatus.state === "stopped" && liveRow(task, now)?.state === "stopped-early")
    return { move: "Continue", work: doingWords(task, now), note: "Stopped early · work kept" }
  if (currentStatus.state === "stopped")
    return {
      move: `Resume ${agentInfo(agentIdOf(task) ?? undefined).name}`,
      work: `Stopped · ${doingWords(task, now)}`,
      note: waits,
    }
  return asked
    ? { move: `Answer ${words}`, work: doingWords(task, now), note: waits }
    : { move: "Open the task", work: words, note: waits }
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
