// How a task row looks and what it says: its mark, the words that title it and the line under its name,
// from the task's own status, the build window the App started for it and the agent's signs of life.
// Pure: the row draws these, the logic suites test them.

import {
  agentAtWork,
  doingWords,
  type LiveRow,
  shellStatus,
} from "../../core/interaction-shell/status.ts"
import { agentName, agoShort } from "../../core/live/liveness.ts"
import type { AgentState, AgentStatus } from "../../interaction/contracts.ts"
import type { TaskSummary } from "../api.ts"
import { type StatusRow, statusOf } from "../live-status.ts"
import { runsOutside } from "../outside.ts"
import { blockedRunReason } from "../run-attention.ts"
import type { RunWindow } from "../run-context.tsx"
import { runStatusText } from "../runs-api.ts"
import { openLine, statusWords, unlanded } from "../shell/lines.ts"
import type { RowGroup } from "./project-model.ts"
import {
  buildOf,
  liveSession,
  permissionWaitingLook,
  plannerStoppedLook,
  sessionRowLook,
  stoppedPlanner,
  takesBuild,
} from "./row-look-runs.ts"

/** `open`: an empty ring, a Chat you stopped. */
export type RowMark = StatusRow["mark"] | "open"

const ARCHIVED_WORDS = "Archived · restore when ready"
const EARLIER_WORDS = "Files only"

/** The mark of each state the agent's own signs give a task. */
const SHELL_MARK: Partial<Record<AgentState, RowMark>> = {
  working: "agent",
  quiet: "quiet",
  stopped: "stop",
  "step-done": "done",
}

const LIVE_MARK: Partial<Record<AgentState, "agent" | "quiet">> = {
  working: "agent",
  quiet: "quiet",
}

type Context = {
  task: TaskSummary
  group: RowGroup
  interaction: boolean
  now: number
  status: ReturnType<typeof statusOf>
  shell: AgentStatus
  atWork: boolean
  prWords: string | null
  managed: string | undefined
  session: LiveRow | null
}

export type RowLook = {
  build: RunWindow | undefined
  mark: RowMark
  /** The words in the row's tooltip. */
  title: string
  /** The line under the task's name. */
  sub: string
  /** What the row's `data-state` says. */
  state: string
  tone: StatusRow["tone"]
  /** The second mark of a task under Your turn whose agent works or has gone quiet on it. */
  live: "agent" | "quiet" | null
  /** The live row the agent's hooks give the task: its state, task list and helpers. */
  session: LiveRow | null
}

/** The mark from the agent's own signs: yours under Your turn, else what it does, else how it stopped. */
function signMark({ group, shell, atWork }: Context): RowMark {
  if (group === "you" && shell.state !== "stopped") return "you"
  if (atWork) return shell.state === "quiet" ? "quiet" : "agent"
  return SHELL_MARK[shell.state] ?? "you"
}

/** The mark from the task's own status, before a build window says otherwise. */
function pillMark(context: Context): RowMark {
  const { task, group, interaction, status } = context
  if (task.archived) return "done"
  // GitHub holds the pull request, not an agent: no working ring, whatever its checks do.
  if (unlanded(task)) return group === "you" ? "you" : "done"
  return interaction ? signMark(context) : status.row.mark
}

/** What waits on the person is answered in the terminal where this task's agent runs. */
function inTerminal(words: string, { task, group, interaction, status, shell }: Context): string {
  if (!interaction || group !== "you" || !runsOutside(task)) return words
  // A plan limit is waited out, not answered.
  if (shell.signals?.limit != null) return words
  const awaiting = status.outside === true || shell.state === "waits-for-you"
  return awaiting ? `${words} · in your own agent` : words
}

/** The words that stand for the task before its own status speaks: archived, a pull request, a build window. */
function fixedWords(context: Context): string | undefined {
  // A task of the earlier workflow is never continued or restored: its files are all there is to open.
  if (context.task.earlier === true) return EARLIER_WORDS
  if (context.task.archived) return ARCHIVED_WORDS
  return context.prWords ?? context.managed
}

function titleWords(context: Context): string {
  const fixed = fixedWords(context)
  if (fixed !== undefined) return fixed
  const { task, now, atWork, shell, interaction, status } = context
  if (atWork && shell.state !== "quiet") return doingWords(task, now)
  return interaction ? inTerminal(statusWords(task, shell), context) : status.row.words
}

function subWords(context: Context): string {
  const fixed = fixedWords(context)
  if (fixed !== undefined) return fixed
  const { task, now, atWork, shell, interaction, status } = context
  if (!interaction) return status.row.words
  if (shell.state === "quiet") return `Quiet ${agoShort(now - (shell.lastActivity ?? now))}`
  if (shell.state === "stopped") return `${agentName(shell.agent)} stopped · Continue`
  return atWork ? doingWords(task, now) : inTerminal(statusWords(task, shell), context)
}

function runMark(group: RowGroup, build: RunWindow): RowMark {
  if (group === "you") return "you"
  return build.status === "stopping" ? "quiet" : "agent"
}

function stateOf(context: Context, build: RunWindow | undefined): string {
  if (context.task.archived) return "archived"
  if (build) return build.status
  return context.interaction ? context.shell.state : context.status.state
}

export function rowLook(input: {
  task: TaskSummary
  group: RowGroup
  interaction: boolean
  now: number
  runs: readonly RunWindow[]
}): RowLook {
  const { task, group, interaction, now, runs } = input
  const { build, blocked } = buildOf(task, runs, now)
  const prWords = task.archived ? null : openLine(task)
  const waiting = permissionWaitingLook(task, runs, prWords)
  if (waiting !== null) return waiting
  // A run held by its agent's plan limit says so, not what its window last showed.
  const runWords =
    build && prWords === null && task.live?.signals?.limit == null
      ? blocked
        ? blockedRunReason(build)
        : runStatusText(build)
      : undefined
  const status = statusOf(task, now)
  const shell = shellStatus(task, now)
  const session = liveSession({ task, group, interaction, blocked, prWords, now })
  const planner =
    interaction &&
    prWords === null &&
    takesBuild(task) &&
    (shell.state === "working" || shell.state === "quiet")
      ? stoppedPlanner(task, runs)
      : undefined
  if (planner) return plannerStoppedLook(planner)
  if (session !== null) return sessionRowLook(task, build, session)
  const context: Context = {
    task,
    group,
    interaction,
    now,
    status,
    shell,
    // Under Running the row says what the agent does, even while the task also waits on the person.
    atWork: interaction && group === "running" && (!!build || agentAtWork(task, now)),
    prWords,
    managed: runWords,
    session,
  }
  return {
    build,
    mark: build && prWords === null ? runMark(group, build) : pillMark(context),
    title: titleWords(context),
    sub: subWords(context),
    state: stateOf(context, build),
    tone: status.row.tone,
    live: interaction && group === "you" ? (LIVE_MARK[shell.state] ?? null) : null,
    session: null,
  }
}
