// How a task row looks and what it says: its mark, the words that title it and the line under its name,
// from the task's own status, the build window the App started for it and the agent's signs of life.
// Pure: the row draws these, the logic suites test them.

import {
  agentAtWork,
  doingWords,
  type LiveRow,
  type LiveRowState,
  liveRow,
  shellStatus,
} from "../../core/interaction-shell/status.ts"
import { agentName, agoShort } from "../../core/live/liveness.ts"
import { runPermissionWaiting } from "../../core/run/contracts.ts"
import type { AgentState, AgentStatus } from "../../interaction/contracts.ts"
import type { TaskSummary } from "../api.ts"
import { type StatusRow, statusOf } from "../live-status.ts"
import { runsOutside } from "../outside.ts"
import { blockedBuildRun, blockedRunReason, startingPlanningRun } from "../run-attention.ts"
import type { RunWindow } from "../run-context.tsx"
import { preferredBuildRun, runStatusText, runTaskId, taskAgentRuns } from "../runs-api.ts"
import { openLine, statusWords, unlanded } from "../shell/lines.ts"
import type { RowGroup } from "./project-model.ts"

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
  /** The agent works on it now, as the Running group says. */
  atWork: boolean
  /** What its pull request says; null when it has none or the task is archived. */
  prWords: string | null
  /** What the build window says of itself; undefined without one. */
  managed: string | undefined
  /** What the agent's hooks say it does now; null when it reports none. */
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

/** The mark, the row's `data-state` and the sub line's tone of each live state. */
const SESSION_LOOK: Record<
  LiveRowState,
  { mark: RowMark; state: string; tone: StatusRow["tone"] }
> = {
  starting: { mark: "agent", state: "starting", tone: null },
  working: { mark: "agent", state: "working", tone: null },
  needs: { mark: "you", state: "waits-for-you", tone: "amb" },
  asks: { mark: "you", state: "waits-for-you", tone: "amb" },
  turn: { mark: "done", state: "your-turn", tone: null },
  quiet: { mark: "quiet", state: "quiet", tone: null },
  "stopped-early": { mark: "stop", state: "stopped", tone: "red" },
  stopped: { mark: "open", state: "stopped", tone: null },
}

/** A task that still takes a build session: open, not handed back. */
const takesBuild = (task: TaskSummary): boolean =>
  !task.archived &&
  task.stage !== "shipped" &&
  task.stage !== "abandoned" &&
  task.handedBack === undefined

/** The build window of a task, and whether it is blocked. */
function buildOf(
  task: TaskSummary,
  runs: readonly RunWindow[],
  now: number,
): { build: RunWindow | undefined; blocked: boolean } {
  if (!takesBuild(task)) return { build: undefined, blocked: false }
  const blocked = blockedBuildRun(runs, task.id)
  const build = blocked ?? preferredBuildRun(runs, task.id) ?? startingPlanningRun(runs, task, now)
  return { build, blocked: blocked !== undefined }
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
  const there =
    interaction &&
    group === "you" &&
    runsOutside(task) &&
    // A plan limit is waited out, not answered.
    shell.signals?.limit == null &&
    (status.outside === true || shell.state === "waits-for-you")
  return there ? `${words} · in your own agent` : words
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

/** The states that replace a workflow row under Your turn: it asks something, or the agent stopped. */
const OVER_WORKFLOW: readonly LiveRowState[] = ["needs", "asks", "stopped-early", "stopped"]

/**
 * The live row the agent's hooks give the task, when it is the row's say: not an open pull request
 * (GitHub holds it), an archived task, a blocked build window, nor a workflow row under Your turn
 * that keeps its own words unless the agent asks or stopped.
 */
function liveSession(input: {
  task: TaskSummary
  group: RowGroup
  interaction: boolean
  blocked: boolean
  prWords: string | null
  now: number
}): LiveRow | null {
  const { task, group, interaction, blocked, prWords, now } = input
  if (!interaction || prWords !== null || task.archived || blocked) return null
  const row = liveRow(task, now)
  if (row === null) return null
  return group === "you" && task.type !== "chat" && !OVER_WORKFLOW.includes(row.state) ? null : row
}

/** A managed planner's recorded exit outweighs its last heartbeat. */
function stoppedPlanner(task: TaskSummary, runs: readonly RunWindow[]): RunWindow | undefined {
  if (task.stage !== "plan" || task.type === "chat" || runsOutside(task)) return undefined
  const signals = task.live?.signals
  const run = taskAgentRuns(runs, task.id).find((candidate) => !candidate.pendingFresh)
  if (run?.status !== "stopped" || run.handedOff !== undefined || !run.nativeSession)
    return undefined
  if (run.purpose.kind === "task" && run.purpose.phase !== "planning") return undefined
  if (run.fresh?.generation === run.generation && run.fresh.state !== "started") return undefined
  const session = signals?.sessionId ?? run.nativeSession
  const agent = signals?.agent ?? task.session?.agent ?? run.agent
  return session === run.nativeSession && agent === run.agent ? run : undefined
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
  const permissionRun = runs.find((run) => runTaskId(run) === task.id && runPermissionWaiting(run))
  if (permissionRun && !task.archived && prWords === null) {
    const line = runStatusText(permissionRun)
    return {
      build: permissionRun,
      mark: "you",
      title: line,
      sub: line,
      state: "waits-for-you",
      tone: "amb",
      live: null,
      session: null,
    }
  }
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
  if (planner) {
    const line = `${agentName(planner.agent)} stopped · Continue`
    return {
      build: undefined,
      mark: "stop",
      title: line,
      sub: line,
      state: "stopped",
      tone: "red",
      live: null,
      session: null,
    }
  }
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
  if (session !== null) {
    const look = SESSION_LOOK[session.state]
    return {
      build,
      mark: look.mark,
      title: session.line,
      sub: session.line,
      // A Chat you stopped is neutral ("ended"); a stopped task keeps the red "stopped".
      state: session.state === "stopped" && task.type === "chat" ? "ended" : look.state,
      tone: look.tone,
      live: null,
      session,
    }
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
