import type { AgentStatus, BackgroundAgent } from "../../interaction/contracts.ts"
import type { TaskDetail, TaskSummary } from "../../server/api.ts"
import agentsJson from "../agents/agents.json" with { type: "json" }
import { isNativeAgent } from "../agents/ids.ts"
import { wakesOf } from "../agents/wakes.ts"
import { HELPER_FRESH_MS, HELPER_STALE_MS } from "../estimate.ts"
import { isAutonomousBuildStage } from "../flow.ts"
import {
  agentName,
  agoShort,
  type LiveSignals,
  lastSign,
  livenessOf,
  underWayWords,
} from "../live/liveness.ts"
import { launchAgent, stagePrompt } from "../run/launch-spec.ts"
import { STARTUP_PROMPT_LINES, type StartupPrompt } from "../run/startup-prompt.ts"
import { buildsNextLine } from "../task/builds-next.ts"

type Input = TaskSummary & Partial<Pick<TaskDetail, "question" | "outside">>
export const agentIdOf = (task: Input) =>
  task.outside != null
    ? task.outside.agent
    : (task.live?.signals?.agent ?? task.session?.agent ?? null)

/** The command that starts the QualityLayer skill in the agent: its `invoke` in agents.json. */
export const invokeOf = (agent: string | null): string =>
  (isNativeAgent(agent)
    ? (agentsJson as unknown as Record<string, { invoke?: string }>)[agent]?.invoke
    : undefined) ?? "/ql"
export const SHELL_QUIET_MS = 2 * 60_000
export const SHELL_GUIDANCE_MS = 15 * 60_000

/**
 * An approved task that has not landed, with an agent attached (a session or its live signals): its
 * conversation goes on, so it shows working, waiting on a permission or stopped like any other step.
 * Without an agent it reads as done; nothing is inferred from a process being alive.
 */
export function landingAgent(task: Input): boolean {
  return (
    task.stage === "shipped" &&
    task.landing?.state === "landing" &&
    ((task.session ?? null) !== null || (task.live?.signals ?? null) !== null)
  )
}

/** The task's work is over: shipped with nobody attached, abandoned, or handed back. */
const workEnded = (task: Input): boolean =>
  (task.stage === "shipped" && !landingAgent(task)) ||
  task.stage === "abandoned" ||
  task.handedBack !== undefined

/** Resume the native client when known and continue the task's current stage. */
export function stoppedResume(task: Input): string {
  const agent = launchAgent(agentIdOf(task))
  const prompt = stagePrompt(agent, task.slug, task.stage)
  return prompt
}

/** Whether the agents work on their own: Implement, and Verify until it turns to the person. */
export const autonomousTask = (task: Pick<Input, "stage" | "verifyMode">): boolean =>
  // A recheck runs while the review is the person's (plan §3.2): the page stays theirs.
  task.verifyMode !== "rechecking" &&
  isAutonomousBuildStage(task.stage, task.verifyMode ?? undefined)

/**
 * Copilot's `errorOccurred` fires once per retry of one failed turn. When it is the latest hook and
 * came after the turn's end, it is not a sign of new work: the end stands, so the row does not
 * flicker back to Working on every retry.
 */
function calm(signals: LiveSignals | null): LiveSignals | null {
  if (signals === null || signals.end === null || signals.hook?.event !== "errorOccurred")
    return signals
  return signals.hook.at > signals.end.at ? { ...signals, hook: null } : signals
}

/** "17:23" today, "Dec 2, 17:23" another day, in the person's own clock. */
function resetClock(at: number, now: number): { time: string; day: string | null } {
  const date = new Date(at)
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
  const today = new Date(now).toDateString() === date.toDateString()
  return {
    time,
    day: today ? null : date.toLocaleDateString([], { month: "short", day: "numeric" }),
  }
}

/**
 * The words of a plan-limit stop: the row's "Limit · resets 17:23" (or the day, when it is not
 * today), and the line under "<Agent> hit its usage limit" for a planned resume or for the person.
 */
export function limitWords(
  limit: NonNullable<LiveSignals["limit"]>,
  now: number,
): { row: string; line: string } {
  const planned = limit.resumeAt != null
  if (limit.resetsAt === null)
    return {
      row: "Usage limit",
      line: "Continue the session once it resets:",
    }
  const { time, day } = resetClock(limit.resetsAt, now)
  const when = day === null ? time : `${day}, ${time}`
  return {
    row: `Limit · resets ${day ?? time}`,
    line: planned
      ? `It resets ${when}; QualityLayer continues the session then.`
      : `It resets ${when}. Continue the session after that:`,
  }
}

/** One signal projection shared by Home, navigation and the task header. */
export function shellStatus(
  task: Input & { startupPrompt?: StartupPrompt },
  now = Date.now(),
): AgentStatus {
  const signals = calm(task.live?.signals ?? null)
  const last = signals === null ? null : lastSign(signals)
  const lastActivity = last?.at ?? task.session?.heartbeat ?? null
  const autonomous = autonomousTask(task)
  const question = task.question === undefined ? task.live?.question : task.question
  const plannerReview = task.stage === "plan" && task.gate?.locked && !question && !task.openItems
  const openItems = autonomous
    ? question != null
      ? 1
      : task.action === "implement"
        ? 1
        : 0
    : (task.live?.needs.filter((n) => n.state === "open").length ?? 0) +
      Math.max(
        task.openItems ?? task.needs?.filter((n) => n.state !== "chosen").length ?? 0,
        (task.action !== null && !plannerReview) || question != null ? 1 : 0,
      )
  const ask = signals?.ask?.alive === true && signals.ask.waiting
  const life = signals === null ? null : livenessOf(signals, now).state
  const permission = life === "permission"
  const verifying = task.stage === "verify"
  const outsideChat = task.stage === "chat" && task.outside !== undefined
  const helpers = runningHelpers(task, now)
  // Outside workflow steps can wait after a turn. An ordinary Chat needs an actual question.
  const outsideTurn =
    !verifying &&
    !outsideChat &&
    task.outside !== undefined &&
    helpers.length === 0 &&
    life === "turn-end"
  const independent =
    signals?.tool !== null &&
    signals?.tool !== undefined &&
    signals.tool.at > (task.session?.heartbeat ?? 0)
  const verifyQuestion = verifying && (question != null || task.action === "final")
  const needsPerson =
    permission || verifyQuestion || outsideTurn || (outsideChat && (question != null || ask))
  const blocked = needsPerson || ask === true || (task.session?.state === "waiting" && !independent)
  const base = {
    agent: agentIdOf(task),
    since: task.session?.since ?? null,
    lastActivity,
    openItems,
    blocked,
    signals,
    resume: null,
  }
  const resume = stoppedResume(task)
  if (task.archived)
    return { ...base, state: "step-done", doing: "Archived", openItems: 0, blocked: false }
  const done = task.archived || workEnded(task)
  if (done)
    return {
      ...base,
      openItems: 0,
      blocked: false,
      state: "step-done",
      doing: task.stage === "shipped" ? "Shipped" : "Closed",
    }
  // The agent waits on its own start-up question (trust this folder, …), which only its terminal shows.
  if (task.startupPrompt !== undefined)
    return {
      ...base,
      blocked: true,
      state: "waits-for-you",
      doing: STARTUP_PROMPT_LINES[task.startupPrompt],
    }
  if (task.action === "implement" && !ask)
    return {
      ...base,
      state: "step-done",
      // Approved for its own outside session: who builds next, as the Implement header says it.
      doing:
        buildsNextLine(
          task.start,
          (agent) => (agent === "other" || agent === "" ? "your agent" : agentName(agent)),
          task.gate?.decided,
        ) ?? "Plan approved · choose how to implement",
      resume: `${invokeOf(base.agent)} implement ${task.slug}`,
    }
  if (life === "stopped")
    return { ...base, state: "stopped", doing: `${agentName(base.agent)} stopped`, resume }
  // Held by the agent's plan limit: nothing runs until it resets, so no spinner. With a resume
  // planned QualityLayer goes on by itself; without one the person continues the session.
  const verifyIntervention = verifying && (verifyQuestion || permission)
  if (signals?.limit != null && !verifyIntervention)
    return {
      ...base,
      state: verifying ? "quiet" : "waits-for-you",
      blocked: !verifying,
      doing: limitWords(signals.limit, now).row,
      resume: signals.limit.resumeAt != null ? null : resume,
    }
  if (needsPerson || (blocked && openItems > 0))
    return {
      ...base,
      state: "waits-for-you",
      doing: "waits for you",
    }
  const doing = doingWords(task, now)
  if (helpers.length > 0) return { ...base, state: "working", doing }
  if ((verifying || outsideChat) && life === "turn-end")
    return { ...base, state: "quiet", blocked: false, doing: "No active turn" }
  if (lastActivity !== null && now - lastActivity >= SHELL_QUIET_MS)
    return { ...base, state: "quiet", doing }
  return { ...base, state: "working", doing }
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * What the agent does in the task's step, in a few words that move with the step's own facts: the
 * build's place counted over the whole build (the same totals the step page counts, no internal
 * task ids), the helpers reading the code for the Plan and the lanes running in Verify.
 */
export function doingWords(task: Input, now = Date.now()): string {
  const helpers = runningHelpers(task, now).length
  switch (task.stage) {
    case "implement": {
      const p = task.live?.progress
      if (p === null || p === undefined) return "building"
      if (typeof p.total !== "number") return p.words?.place || "building"
      const done = [
        `${p.done} of ${count(p.total, "task", "tasks")} done`,
        underWayWords(p.underWay),
      ]
        .filter(Boolean)
        .join(" · ")
      return p.slice !== null ? `slice ${p.slice.at} of ${p.slices} · ${done}` : done
    }
    case "verify":
      if (task.verifyMode === "yours" || task.verifyMode === "rechecking")
        return "preparing your review"
      if (task.verifyMode === "fixing")
        return helpers > 0
          ? `fixing the gaps · ${count(helpers, "helper", "helpers")} at work`
          : "fixing the gaps"
      return helpers > 0
        ? `checking the change · ${count(helpers, "lane", "lanes")} running`
        : "checking the change"
    case "plan":
      return helpers > 0
        ? `reading the code · ${count(helpers, "helper", "helpers")} at work`
        : "writing the Plan"
    case "shipped":
      return "after your approval"
    default:
      return "reading the code"
  }
}

/** Navigation names the step's work; raw tool commands remain in the session's details. */
export function doingNow(task: Input, now = Date.now()): string {
  return task.type === "chat" ? "Working" : doingWords(task, now)
}

/** A turn end shows as Your turn only after this long, so a quick next step never flickers. */
export const TURN_HOLD_MS = 2000
/** No hook and no sign for this long: the agent reports nothing, so the row stops saying Starting. */
const STARTING_MS = 60_000

export type LiveRowState =
  | "starting"
  | "working"
  | "needs"
  /** A workflow task's lead ended its turn waiting on the person: answer in its own chat. */
  | "asks"
  | "turn"
  | "quiet"
  | "stopped-early"
  | "stopped"

/**
 * In Implement or Verify's checks the lead agent ended its turn (its own recorded Stop, after the
 * hold) with nothing left that wakes it, so the next move is the person's, in its chat. Its next
 * sign of life ends it. A question card, a gate, a permission prompt, the build start, a build need,
 * a gate wait, a second refusal and a stop keep their own states; a lead whose helpers or own
 * background work still run waits on them, not on the person, and an agent whose record cannot say
 * so (agents/wakes.ts) is never this state.
 */
export function asksInChat(
  task: Input & { startupPrompt?: StartupPrompt },
  now = Date.now(),
): boolean {
  if (task.stage === "verify" || task.type === "chat" || task.archived || !autonomousTask(task))
    return false
  if (workEnded(task) || task.action !== null || task.startupPrompt !== undefined) return false
  if (task.gate != null && !task.gate.settled) return false
  if (task.session?.state === "waiting") return false
  const question = task.question === undefined ? task.live?.question : task.question
  if (question != null || task.batch?.members.some((m) => m.answer === undefined)) return false
  if ((task.live?.needs ?? []).some((n) => n.state !== "resolved")) return false
  if ((task.live?.refusal?.count ?? 0) >= 2) return false
  const signals = calm(task.live?.signals ?? null)
  if (signals === null || signals.ask?.waiting === true) return false
  // Only where QualityLayer can know nothing will wake the agent (agents/wakes.ts): an agent whose
  // record cannot say never lights it, one whose record can lights only while nothing is open.
  if (wakesOf(agentIdOf(task)).wakes === "unknown") return false
  if (task.live?.backgroundRunning === true) return false
  const lv = livenessOf(signals, now)
  return (
    lv.state === "turn-end" && now - lv.at >= TURN_HOLD_MS && runningHelpers(task, now).length === 0
  )
}

/** The sidebar's live row: its state, the line under the name, and what the agent's hooks report. */
export type LiveRow = {
  state: LiveRowState
  line: string
  /** The agent's own task list; null when it reports none (never guessed). */
  todo: NonNullable<LiveSignals["todo"]>["items"] | null
  /** The helpers at work, grouped by kind. */
  helpers: { kind: string; n: number }[]
  /** When the row changes with no new signal (a turn end's hold ends); the row draws again then. */
  recheckAt: number | null
}

const STARTUP_ASK: Record<StartupPrompt, string> = {
  trust: "trust this folder",
  theme: "choose a text style",
  setup: "finish setup",
  notes: "press Enter",
  bypass: "accept Bypass Permissions",
  login: "sign in",
}
const ASK_VERBS: readonly (readonly [string, string])[] = [
  ["Running ", "run "],
  ["Editing ", "edit "],
  ["Reading ", "read "],
]

const helpersOf = (signals: LiveSignals): LiveRow["helpers"] => {
  const kinds = new Map<string, number>()
  for (const agent of signals.agents) {
    if (agent.stopped !== null) continue
    const kind = /^(an agent|agent|default|helper)?\s*$/i.test(agent.words) ? "helper" : agent.words
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
  }
  return [...kinds].map(([kind, n]) => ({ kind, n }))
}

const sinceWords = (ms: number) => (ms < 60_000 ? "now" : agoShort(ms))

/**
 * What a task's row shows when its agent reports through hooks: Starting, Working, Needs you, Answer
 * in its agent (a workflow task, asksInChat), Your turn (a Chat), Quiet, Stopped early or Stopped. Null when it reports nothing (the row keeps its
 * workflow words) or the task is closed. A process that dies while working is Stopped early.
 */
export function liveRow(
  task: Input & { startupPrompt?: StartupPrompt },
  now = Date.now(),
): LiveRow | null {
  const signals = calm(task.live?.signals ?? null)
  if (signals === null || task.outside != null) return null
  const shell = shellStatus(task, now)
  if (shell.state === "step-done") return null
  const chat = task.type === "chat"
  const lv = livenessOf(signals, now)
  const row = (state: LiveRowState, line: string): LiveRow => ({
    state,
    line,
    todo: signals.todo?.items ?? null,
    helpers: helpersOf(signals),
    recheckAt: null,
  })
  if (task.startupPrompt !== undefined)
    return row("needs", `Needs you · ${STARTUP_ASK[task.startupPrompt]}`)
  if (lv.state === "stopped") return stoppedRow(task, signals, lv, now, row)
  if (lv.state === "permission") {
    const verb = ASK_VERBS.find(([from]) => signals.tool?.words.startsWith(from))
    const what = verb ? `${verb[1]}${signals.tool?.words.slice(verb[0].length)}?` : "permission"
    return row("needs", `Needs you · ${what}`)
  }
  if (signals.ask?.alive === true && signals.ask.waiting) {
    const n = task.openItems ?? 0
    return row("needs", `Needs you · ${n > 1 ? `${n} questions` : "a question"}`)
  }
  // A workflow wait (the Plan, a gate, a blocked build) keeps the workflow's own words.
  if (shell.state === "waits-for-you") return null
  if (asksInChat(task, now)) return row("asks", `Open ${agentName(agentIdOf(task))}`)
  // Held like a Chat's turn end: the row asks to be drawn again when the hold ends.
  if (lv.state === "turn-end" && !chat && asksInChat(task, lv.at + TURN_HOLD_MS))
    return { ...row("working", doingNow(task, now)), recheckAt: lv.at + TURN_HOLD_MS }
  if (lv.state === "turn-end" && chat) {
    if (now - lv.at >= TURN_HOLD_MS) return row("turn", `Your turn · ${sinceWords(now - lv.at)}`)
    // Held: it shows as working until then, and the row asks to be drawn again at that moment.
    return { ...row("working", doingNow(task, now)), recheckAt: lv.at + TURN_HOLD_MS }
  }
  if (
    signals.process === "alive" &&
    signals.hook === null &&
    signals.end === null &&
    (lv.state === "none" || (lv.state === "working" && now - lv.last.at < STARTING_MS))
  )
    return row("starting", "Starting")
  if (lv.state === "quiet") return row("quiet", `Quiet ${agoShort(lv.quietFor)}`)
  return row("working", doingNow(task, now))
}

/** A process that is gone, or a session that ended: Stopped when it ended on purpose, else Stopped early. */
function stoppedRow(
  task: Input,
  signals: LiveSignals,
  lv: Extract<ReturnType<typeof livenessOf>, { state: "stopped" }>,
  now: number,
  row: (state: LiveRowState, line: string) => LiveRow,
): LiveRow {
  const chat = task.type === "chat"
  // Esc: the agent runs and waits for the Chat's next message.
  if (chat && lv.why === "interrupted" && signals.process !== "gone")
    return row("turn", `Your turn · ${sinceWords(now - lv.at)}`)
  const end = signals.end
  // Ended, interrupted or idle at a turn end: the person's own stop, not a crash.
  const ended =
    lv.why === "ended" ||
    lv.why === "interrupted" ||
    (end?.kind === "turn-end" && (lv.last === null || lv.last.at <= end.at + 5000))
  if (ended) return row("stopped", `Stopped · ${chat ? "Resume" : "Continue"}`)
  // Nothing is live under a process that ended mid-turn: no list, no helpers.
  return { ...row("stopped-early", "Stopped early · Continue"), todo: null, helpers: [] }
}

/** The task's helpers and subagents at work now: what makes a waiting task still a running one. */
export function runningHelpers(task: Input, now = Date.now()): BackgroundAgent[] {
  return backgroundAgents(task, now).filter((a) => a.state === "running")
}

/**
 * The one answer to "does an agent work on this task now", for the sidebar's Running group, Home's
 * Running list, its calm line and the spending card's count. The lead agent working or quiet, or a
 * helper of it at work while the lead waits on the person. A closed task, a stopped agent and an open pull request (GitHub's, not an agent's)
 * are not at work.
 */
export function agentAtWork(task: Input, now = Date.now()): boolean {
  // No session and no signal ever: no agent is attached, whatever the default state says.
  if ((task.session ?? null) === null && (task.live?.signals ?? null) === null)
    return task.helpers.some((h) => h.state === "running")
  const status = shellStatus(task, now)
  if (status.state === "working" || status.state === "quiet") return true
  if (status.state === "stopped" || task.archived) return false
  if (workEnded(task)) return false
  return runningHelpers(task, now).length > 0 || writesMeanwhile(task, now)
}

/** A waiting lead that still writes: its tools fire and its transcript grows within this window. */
export const SHELL_WRITING_MS = 60_000

/**
 * The lead waits on the person in the background (a `wait` while it goes on with other work) and its
 * own hooks or transcript moved a moment ago: it works meanwhile. A question it waits on in
 * the foreground, an ended turn and a permission prompt are not work.
 */
function writesMeanwhile(task: Input, now: number): boolean {
  const signals = task.live?.signals ?? null
  if (signals === null) return false
  if (signals.ask?.alive === true && signals.ask.waiting) return false
  const live = livenessOf(signals, now)
  if (live.state !== "working" && live.state !== "quiet") return false
  const moved = Math.max(signals.hook?.at ?? 0, signals.transcript ?? 0)
  return moved > 0 && now - moved < SHELL_WRITING_MS
}

/** The needs of the build the person has not set yet. */
export const openNeeds = (task: Input): number =>
  autonomousTask(task) ? 0 : (task.live?.needs.filter((n) => n.state === "open").length ?? 0)

function roleOf(value: string): BackgroundAgent["role"] {
  // A task's Plan review reads the Plan: it is not a research helper.
  if (/plan-review/i.test(value)) return "plan-review"
  if (/research/i.test(value)) return "research"
  if (/artifact|mockup/i.test(value)) return "artifact"
  if (/slice|build|fix/i.test(value)) return "building"
  if (/check|judge|security/i.test(value)) return "checking"
  if (/review/i.test(value)) return "review"
  return "other"
}

export function backgroundAgents(task: Input, now = Date.now()): BackgroundAgent[] {
  const rows = new Map<string, BackgroundAgent>()
  for (const agent of task.live?.signals?.agents ?? [])
    rows.set(agent.id, {
      id: agent.id,
      parent: task.live?.signals?.session ?? null,
      role: roleOf(agent.words),
      subject: /^(default|agent|helper)\s*$/i.test(agent.words)
        ? "Work not reported"
        : agent.words.replace(/^[^·]+·\s*/, ""),
      state: agent.stopped === null ? "running" : "done",
      started: agent.started,
      ended: agent.stopped,
      doing: null,
    })
  for (const helper of task.helpers)
    rows.set(helper.id, {
      id: helper.id,
      parent: task.live?.signals?.session ?? null,
      // The review the Plan's draft starts (`review-plan`) is the Plan's, the change's is the other.
      role: roleOf(
        helper.role ?? (helper.id === "review-plan" ? "plan-review" : (helper.kind ?? helper.id)),
      ),
      subject: helper.label ?? helper.line ?? helper.budget?.name ?? helper.id,
      state:
        helper.state === "timed_out"
          ? "stopped"
          : helper.state === "running" &&
              helper.at !== null &&
              (helper.at > now ||
                now - helper.at >= (helper.started == null ? HELPER_FRESH_MS : HELPER_STALE_MS))
            ? "quiet"
            : (helper.state ?? (helper.at === null ? "queued" : "running")),
      started: helper.started ?? null,
      ended: helper.state === "done" || helper.state === "failed" ? helper.at : null,
      doing: helper.line,
    })
  return [...rows.values()]
}
