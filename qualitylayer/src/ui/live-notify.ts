// What the live status tells the person when the App is in the background (Answer in the App,
// frame 7): a notification once for each thing that waits for them (a question, a need, a refusal
// that came twice), their move outside the App (a permission prompt or the agent's turn ended)
// and a stopped agent; the window title and the dock badge with the open
// questions. The first question after /ql is the CLI's own (`question ask` brings the App to the
// front and notifies it); every later one notifies here and never steals focus. Agent progress
// never notifies. Pure, apart from the two helpers at the end.

import { AGENT_NAMES } from "../core/agents/ids.ts"
import { liveRow } from "../core/interaction-shell/status.ts"
import { type RunSummary, runPermissionWaiting } from "../core/run/contracts.ts"
import { askedInAgent } from "../core/task/sides.ts"
import type { Notification } from "../interaction/contracts.ts"
import type { TaskSummary } from "./api.ts"
import { liveNoticeOf, noticeWakeAt } from "./live-notify-moments.ts"
import {
  machineNoticeOf,
  noticeOptions,
  setNoticeSound,
  showTitle,
  type ToldNotice,
  tellShell,
} from "./live-notify-shell.ts"
import { questionOf } from "./live-status.ts"
import { pendingGate } from "./model.ts"
import { approvesOutside, runsInApp } from "./outside.ts"

export {
  liveNoticeOf,
  machineNoticeOf,
  noticeOptions,
  noticeWakeAt,
  setNoticeSound,
  showTitle,
  type ToldNotice,
  tellShell,
}

export type LiveNotice = {
  /** One notice per moment: the same key is never told twice. */
  key: string
  title: string
  body: string
  /** Where a click takes the person: the task. */
  route: string
}

type RunNoticeInput = Pick<
  RunSummary,
  | "id"
  | "generation"
  | "agent"
  | "waitSince"
  | "status"
  | "title"
  | "task"
  | "purpose"
  | "settings"
  | "taskLifecycle"
  | "terminalPrompt"
  | "attention"
>

function isChatHandledByHooks(run: RunNoticeInput): boolean {
  if (runPermissionWaiting(run)) return false
  return (
    (run.purpose.kind === "new-task" && run.purpose.type === "chat") ||
    run.taskLifecycle?.stage === "chat"
  )
}

function isRunNoticeEligible(run: RunNoticeInput, now: number): boolean {
  if (isChatHandledByHooks(run)) return false
  if (!run.terminalPrompt && run.settings?.answers === "terminal") return false
  if (run.agent === "other" || !run.waitSince || now - Date.parse(run.waitSince) < 3000)
    return false
  return run.status === "running" || run.status === "starting"
}

/** A managed permission wait uses the same native notification channel as task activity. */
export function runLiveNoticeOf(run: RunNoticeInput, now: number): LiveNotice | null {
  if (!isRunNoticeEligible(run, now)) return null
  const name = AGENT_NAMES[run.agent as Exclude<RunNoticeInput["agent"], "other">]
  return {
    key: `run|${run.id}|${run.generation}|permission|${run.waitSince}`,
    title: `${name} asks for permission`,
    body: `Allow it in its agent window to go on.\n${run.title}`,
    route: run.task ? `#/task/${encodeURIComponent(run.task)}` : "#/",
  }
}

/** Whether the live row asks for the person: Needs you, or an agent that stopped early. */
export function liveNeedsYou(task: TaskSummary, now: number): boolean {
  const state = liveRow(task, now)?.state
  return state === "needs" || state === "stopped-early"
}

/** Whether what the task waits for is asked in the App: a question on its side, an approval on its. */
const waitsHere = (task: TaskSummary): boolean => {
  const question = questionOf(task)
  return question !== null
    ? !askedInAgent(task, [question])
    : pendingGate(task) !== null
      ? !approvesOutside(task)
      : runsInApp(task)
}

/**
 * The questions the shell's rows confirm as waiting, as the page keys their moments: a question's own
 * row, or its item (`plan:question:2`), where the shell lists a single question as an item. A batch's rows confirm no single question: the batch notifies as one.
 */
export function confirmedQuestions(rows: readonly Notification[]): Set<string> {
  const keys = new Set<string>()
  for (const { state, target } of rows) {
    const found = /(?:^|:)question:(\d+)$/.exec(target.itemId)
    if (state === "open" && found !== null) keys.add(`${target.taskId}|question|${found[1]}`)
  }
  return keys
}

/**
 * What changed since the last look: a notice for each task whose moment is new. The first look
 * only learns what is there: an App opened on a waiting question does not notify it again.
 */
export function liveNoticesFor(
  ...args: [
    seen: Set<string> | null,
    tasks: TaskSummary[],
    now: number,
    batches?: ReadonlyMap<string, string>,
    questions?: ReadonlySet<string>,
    batchTexts?: ReadonlyMap<string, string>,
  ]
): { notices: LiveNotice[]; seen: Set<string>; current: Set<string> } {
  const [seen, tasks, now, batches, questions, batchTexts] = args
  const current = new Set<string>()
  const notices: LiveNotice[] = []
  for (const task of tasks) {
    if (task.archived) continue
    const notice = liveNoticeOf(
      task,
      now,
      batches === undefined ? undefined : (batches.get(task.id) ?? null),
      batchTexts?.get(task.id),
    )
    if (notice === null) continue
    if (
      questions !== undefined &&
      notice.key.startsWith(`${task.id}|question|`) &&
      !questions.has(notice.key)
    )
      continue
    current.add(notice.key)
    if (seen !== null && !seen.has(notice.key)) notices.push(notice)
  }
  return { notices, seen: new Set([...(seen ?? []), ...current]), current }
}

/**
 * The toasts on screen that no longer hold: their moment passed (the question was answered, the
 * change approved, the task shipped) or their task is the one open now, where the page itself
 * shows what waits. `shown` maps each toast's key to the route it opens.
 */
export function staleToasts(
  shown: ReadonlyMap<string, string>,
  current: ReadonlySet<string>,
  currentId: string | null,
): string[] {
  const open = currentId === null ? null : `#/task/${encodeURIComponent(currentId)}`
  return [...shown].filter(([key, route]) => !current.has(key) || route === open).map(([k]) => k)
}

/** The title names only the task on screen; elsewhere it gives the overall open-question count. */
export function windowTitle(
  tasks: TaskSummary[],
  currentId?: string,
  now = Date.now(),
): { title: string; badge: number } {
  // The Dock counts what Home's Needs you lists: a question, a Chat that needs you, a stop that came early.
  const asking = tasks
    .filter((t) => waitsHere(t) && !t.archived && (questionOf(t) !== null || liveNeedsYou(t, now)))
    .sort((a, b) => (b.live?.question?.number ?? 0) - (a.live?.question?.number ?? 0))
  const current = tasks.find((t) => t.id === currentId)
  const prefix = asking.length > 0 ? `(${asking.length}) ` : ""
  const question = current !== undefined ? questionOf(current) : null
  return {
    title:
      current !== undefined
        ? `${prefix}${question != null ? `Question ${question.number} · ${current.title}` : `${current.title} · QualityLayer`}`
        : asking.length > 0
          ? `${prefix}Needs you · QualityLayer`
          : "QualityLayer",
    badge: asking.length,
  }
}
