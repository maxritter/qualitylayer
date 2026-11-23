// The one live status of a task, in one place: the pill in the task's header, its panel, the
// sidebar row in miniature, and what notifies. Seven states, from the task and the agent's signs
// of life (core/live): working, needs you here, your move outside the App, quiet, stopped, an
// error of QualityLayer's own, and done. Pure: the components draw it, the logic suites test it.

import { HELPER_FRESH_MS } from "../core/estimate.ts"
import { stoppedResume } from "../core/interaction-shell/status.ts"
import {
  agentName,
  agoShort,
  type Liveness,
  livenessOf,
  QUIET_TOOL_MS,
} from "../core/live/liveness.ts"
import { askedInAgent } from "../core/task/sides.ts"
import type { LiveReport } from "../server/api.ts"
import type { TaskDetail, TaskSummary } from "./api.ts"
import { doneOrImplementStatus } from "./live-status-done.ts"
import { needsOrWaitingStatus, quietOrIdleStatus } from "./live-status-needs.ts"
import { stoppedOrBlockedStatus } from "./live-status-stopped.ts"
import { workingStatus } from "./live-status-work.ts"
import { type Groups, groupTasks } from "./model.ts"
import { approvesOutside } from "./outside.ts"

export type StatusState =
  | "working"
  | "needs-you"
  | "your-move"
  | "quiet"
  | "stopped"
  | "error"
  | "done"

/** The pill's look: blue at work, solid amber here, amber outline outside, dashed quiet, red, plain. */
export type PillKind = "work" | "you" | "move" | "quiet" | "err" | "done"
export type PillIcon = "spin" | "go" | "term" | "hour" | "unplug" | "alert" | "done" | "quiet"

/** Where a click on a Needs you pill takes the person. */
export type StatusTarget =
  | { kind: "question" }
  | { kind: "need"; for: string }
  | { kind: "item"; id: string; view: string }
  | { kind: "view"; view: string }

/** The sidebar's row: the mark, five words, their tone, and the list it sorts into. */
export type StatusRow = {
  mark: "you" | "agent" | "quiet" | "stop" | "err" | "done"
  words: string
  tone: "amb" | "red" | null
  group: "you" | "running" | "shipped"
}

export type Status = {
  state: StatusState
  kind: PillKind
  icon: PillIcon
  /** Working: the agent's name, in bold before the words. */
  agent: string | null
  /** The coloured lead: "Your move", "Plan refused", "Claude Code's session ended". */
  lead: string | null
  /** The words after the lead (or the whole line without one). */
  text: string
  /** The words the narrow header keeps. */
  short: string
  /** The quiet words on the right: "2 agents · 14 min", "the build goes on". */
  meta: string | null
  shortMeta: string | null
  target: StatusTarget | null
  row: StatusRow
  /** The command that picks the work up again, when the move is the person's outside the App. */
  command: string | null
  /** The liveness the state came from (for the panel's signals). */
  liveness: Liveness
  /** The person's move is made in the terminal, where the task's agent runs: its words say so. */
  outside?: true
}

export type StatusInput = TaskSummary &
  Partial<Pick<TaskDetail, "checklist" | "quality" | "shipped" | "question" | "implementStart">>

type Defaults = Pick<
  Status,
  "agent" | "lead" | "meta" | "shortMeta" | "target" | "command" | "liveness"
>
export type StatusMaker = (s: Omit<Status, keyof Defaults> & Partial<Defaults>) => Status

const MIN = 60_000
const SHORT_NEED = 48
const NO_SIGNALS: Liveness = { state: "none" }

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })

/** The slice or task is already identified beside the need. */
export function withoutNeedScope(what: string, includeIn = false): string {
  const suffix = /(?<!\s)\s+(for|in)\s+(?:slice|task)\s+\S+$/i.exec(what)
  return suffix !== null && (includeIn || suffix[1]?.toLowerCase() === "for")
    ? what.slice(0, suffix.index)
    : what
}

/** "A Stripe test key for slice 4" → "Stripe test key": the need in a few words. */
export function shortNeed(what: string): string {
  const first = (what.split(/(?<=[.!?])\s+|(?<!\s)\s+[—–]\s+|:\s/, 1)[0] ?? what).replace(
    /[.!?]$/,
    "",
  )
  const short = withoutNeedScope(first.replace(/^(an?|the)\s+/i, ""), true).trim()
  if (short.length <= SHORT_NEED) return short
  const cut = short.slice(0, SHORT_NEED + 1)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).replace(/[,;]$/, "")}…`
}

/** The agents at work beside the session: its running subagents, or its helpers, whichever is more. */
export function agentsAtWork(task: StatusInput, now = Date.now()): number {
  const subagents = (task.live?.signals?.agents ?? []).filter((a) => a.stopped === null).length
  const helpers = (task.helpers ?? []).filter(
    (h) =>
      (h.state === undefined || h.state === "running") &&
      h.at !== null &&
      now - h.at < HELPER_FRESH_MS,
  ).length
  return Math.max(subagents, helpers)
}

/** The question the agent waits on: the live report's, or the task detail's own. */
export function questionOf(task: StatusInput): NonNullable<LiveReport["question"]> | null {
  if (task.question === undefined) return task.live?.question ?? null
  const q = task.question ?? null
  if (q === null) return null
  return {
    number: q.number,
    text: q.question,
    ahead: q.ahead ?? null,
    gate: q.gate ?? null,
    ...(q.settles ? { settles: q.settles } : {}),
    front: q.front === true,
    stopped: q.stopped?.at ?? null,
    looking: q.more?.taken !== undefined && q.more.cancelled === undefined,
  }
}

/**
 * The task's status at `now`. A task whose agent runs in the terminal asks and takes approval
 * there: where its status says the person's move is a question, a gate or an item, the words add
 * " · in your own agent" so the row never offers an answer the App does not take.
 */
export function statusOf(task: StatusInput, now = Date.now()): Status {
  const status = liveStatusOf(task, now)
  const question = questionOf(task)
  const there =
    status.target?.kind === "question"
      ? askedInAgent(task, question ? [question] : [])
      : approvesOutside(task)
  if (
    !there ||
    status.state !== "needs-you" ||
    status.target?.kind === "need" ||
    (status.target === null && (task.live?.refusal?.count ?? 0) >= 2)
  )
    return status
  const outside = (words: string) => `${words} · in your own agent`
  return {
    ...status,
    outside: true,
    text: outside(status.text),
    short: outside(status.short),
    row: { ...status.row, words: outside(status.row.words) },
  }
}

function livenessForTask(task: StatusInput, now: number): Liveness {
  const signals =
    task.live?.signals ??
    (task.session !== null
      ? {
          agent: task.session.agent,
          hook: null,
          tool: null,
          transcript: null,
          cli: { at: task.session.heartbeat, command: "" },
          question: null,
          process: "unknown" as const,
          end: null,
          agents: [],
        }
      : null)
  return signals !== null ? livenessOf(signals, now) : NO_SIGNALS
}

function liveStatusOf(task: StatusInput, now: number): Status {
  const name = agentName(task.session?.agent ?? task.live?.signals?.agent ?? null)
  const liveness = livenessForTask(task, now)
  const base: Defaults = {
    agent: null,
    lead: null,
    meta: null,
    shortMeta: null,
    target: null,
    command: null,
    liveness,
  }
  const make: StatusMaker = (s) => ({ ...base, ...s })
  const resume = stoppedResume(task)
  return (
    doneOrImplementStatus(task, resume, make) ??
    stoppedOrBlockedStatus({ task, name, liveness, resume, now, make }) ??
    needsOrWaitingStatus({ task, name, liveness, now, resume, make }) ??
    quietOrIdleStatus({ task, name, liveness, resume, make }) ??
    workingStatus(task, name, now, make)
  )
}

/** The status sorts the task into Needs you: anything that waits for a person. */
export const statusNeedsYou = (task: StatusInput, now = Date.now()): boolean =>
  statusOf(task, now).row.group === "you"

/**
 * The sidebar's lists: what the task list always sorted into Needs you, and besides it every task
 * whose status waits for a person (your move, stopped, a need, twenty quiet minutes).
 */
export function groupByStatus(
  tasks: TaskSummary[],
  project: string,
  agent = "",
  now = Date.now(),
): Groups {
  const groups = groupTasks(tasks, project, agent, now)
  const moved = groups.progress.filter((t) => statusNeedsYou(t, now))
  return {
    ...groups,
    you: [...groups.you, ...moved],
    progress: groups.progress.filter((t) => !moved.includes(t)),
  }
}

/** How long a signal was ago, for the panel's rows: "40 s", "6 min", or the clock when long ago. */
export function signalAge(at: number | null, now: number): string {
  if (at === null) return "none"
  const ago = now - at
  return ago > 60 * MIN ? clock(at) : agoShort(ago)
}

/** Why the quiet waits longer: a command started by a hook is running. */
export const TOOL_QUIET_WORDS = `a command is running, so no “quiet” before ${Math.round(QUIET_TOOL_MS / MIN)} min`
