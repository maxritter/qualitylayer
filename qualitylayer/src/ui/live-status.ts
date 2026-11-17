// The one live status of a task, in one place: the pill in the task's header, its panel, the
// sidebar row in miniature, and what notifies. Seven states, from the task and the agent's signs
// of life (core/live): working, needs you here, your move outside the App, quiet, stopped, an
// error of QualityLayer's own, and done. Pure: the components draw it, the logic suites test it.

import { HELPER_FRESH_MS } from "../core/estimate.ts"
import { limitWords, stoppedResume } from "../core/interaction-shell/status.ts"
import { flattenItems } from "../core/items.ts"
import {
  agentName,
  agoShort,
  type Liveness,
  livenessOf,
  QUIET_TOOL_MS,
} from "../core/live/liveness.ts"
import type { Need } from "../core/need/need.ts"
import { askedInAgent } from "../core/task/sides.ts"
import type { LiveReport } from "../server/api.ts"
import type { TaskDetail, TaskSummary } from "./api.ts"
import {
  agentWaiting,
  askingYou,
  decidedGate,
  environmentBlockedChecks,
  fileOf,
  type Groups,
  groupTasks,
  isClosed,
  notesWorking,
  pendingGate,
  personVerify,
  waitsOnItems,
} from "./model.ts"
import { approvesOutside } from "./outside.ts"
import { openLine, openWaits, shippedWord, staysOpen } from "./shell/lines.ts"

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

type Input = TaskSummary &
  Partial<Pick<TaskDetail, "checklist" | "quality" | "shipped" | "question" | "implementStart">>

const MIN = 60_000

/** The slice or task is already identified beside the need. */
export function withoutNeedScope(what: string, includeIn = false): string {
  const suffix = /(?<!\s)\s+(for|in)\s+(?:slice|task)\s+\S+$/i.exec(what)
  return suffix !== null && (includeIn || suffix[1]?.toLowerCase() === "for")
    ? what.slice(0, suffix.index)
    : what
}

/** "A Stripe test key for slice 4" → "Stripe test key": the need in a few words. */
export function shortNeed(what: string): string {
  // A need is written as a sentence or two ("<what is needed>. <why the agent cannot>"): its short
  // form is the first sentence, cut at a word within about eight words, never mid-word.
  const first = (what.split(/(?<=[.!?])\s+|(?<!\s)\s+[—–]\s+|:\s/, 1)[0] ?? what).replace(
    /[.!?]$/,
    "",
  )
  const short = withoutNeedScope(first.replace(/^(an?|the)\s+/i, ""), true).trim()
  if (short.length <= SHORT_NEED) return short
  const cut = short.slice(0, SHORT_NEED + 1)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).replace(/[,;]$/, "")}…`
}

/** About eight words: what a need's short form keeps before it is cut at a word. */
const SHORT_NEED = 48

/** "Plan refused" → "the Plan was refused twice". */
function twiceWords(lead: string): string {
  const what = lead.replace(/(?<!\s)\s+refused$/i, "")
  if (what === lead) return `${lead} twice`
  return `${what === "Plan" ? "the Plan" : what} was refused twice`
}

const minutes = (ms: number) => `${Math.max(1, Math.round(ms / MIN))} min`

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })

/** The agents at work beside the session: its running subagents, or its helpers, whichever is more. */
export function agentsAtWork(task: Input, now = Date.now()): number {
  const subagents = (task.live?.signals?.agents ?? []).filter((a) => a.stopped === null).length
  const helpers = (task.helpers ?? []).filter(
    (h) =>
      (h.state === undefined || h.state === "running") &&
      h.at !== null &&
      now - h.at < HELPER_FRESH_MS,
  ).length
  return Math.max(subagents, helpers)
}

/** What the session at work does, in the pill's words, and the narrow header's. */
function workWords(task: Input): { text: string; short: string; meta: string | null } {
  const progress = task.live?.progress ?? null
  if (task.stage === "chat") {
    const text = task.live?.signals?.tool?.words ?? "Working in Chat"
    return { text, short: text, meta: null }
  }
  if (task.stage === "plan" && task.live?.signals?.tool != null) {
    const text = task.live.signals.tool.words
    return { text, short: text, meta: null }
  }
  const verifying = task.stage === "verify" && !personVerify(task)
  if (task.stage === "implement") {
    const active = progress?.activeSlices ?? []
    if (active.length === 1) {
      const at = `slice ${active[0]} of ${progress?.slices}`
      return { text: `building ${at}`, short: `Building ${at}`, meta: null }
    }
    if (active.length > 1) {
      const slices = `slices ${active.join(", ")}`
      return { text: `building ${slices}`, short: `Building ${slices}`, meta: null }
    }
    return { text: "building", short: "Building", meta: null }
  }
  if (verifying) {
    const list = task.checklist
    if (environmentBlockedChecks(list))
      return { text: "waiting for the environment", short: "Environment blocked", meta: null }
    const fixing = (task.quality ?? []).find((r) => r.state === "fixing")
    if (list != null && list.failed > 0 && list.rounds > 0)
      return {
        text: `fixing ${list.failed} failed ${list.failed === 1 ? "check" : "checks"}`,
        short: "Fixing checks",
        meta: null,
      }
    if (fixing !== undefined)
      return { text: "fixing what the review found", short: "Fixing", meta: null }
    if (list != null && list.total > 0)
      return {
        text: "running checks",
        short: "Running checks",
        meta: `${list.passed + list.failed} of ${list.total}`,
      }
    return { text: "checking Done means", short: "Checking", meta: null }
  }
  // Your notes on the change are the agent's work until they are made and checked.
  if (personVerify(task) && notesWorking(task))
    return { text: "making your changes", short: "Making your changes", meta: null }
  if (personVerify(task) && task.reviewFix === "fix")
    return { text: "fixing open items", short: "Fixing open items", meta: null }
  if (personVerify(task) && task.reviewFix === "judge")
    return { text: "checking the fix", short: "Checking the fix", meta: null }
  if (personVerify(task))
    return { text: "preparing your review", short: "Preparing your review", meta: null }
  const reading = (task.helpers ?? []).some((h) => h.kind !== "review" && h.state !== "done")
  if (reading) return { text: "reading the code", short: "Reading the code", meta: null }
  if (task.stage === "plan")
    return task.type === "bugfix"
      ? { text: "reproducing the bug", short: "Reproducing the bug", meta: null }
      : { text: "writing the Plan", short: "Writing the Plan", meta: null }
  return { text: "working", short: "Working", meta: null }
}

const NO_SIGNALS: Liveness = { state: "none" }

/** The question the agent waits on: the live report's, or the task detail's own. */
export function questionOf(task: Input): NonNullable<LiveReport["question"]> | null {
  // The detail's question is authoritative even when its summary was read just before an answer.
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
export function statusOf(task: Input, now = Date.now()): Status {
  const status = liveStatusOf(task, now)
  // A question is asked on the questions' side; a gate or an item waits on the approvals' side.
  const question = questionOf(task)
  const there =
    status.target?.kind === "question"
      ? askedInAgent(task, question ? [question] : [])
      : approvesOutside(task)
  if (
    !there ||
    status.state !== "needs-you" ||
    // A need the build has is the person's to meet, and a refusal is QualityLayer's own to fix.
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

function liveStatusOf(task: Input, now: number): Status {
  const name = agentName(task.session?.agent ?? task.live?.signals?.agent ?? null)
  // A task without the live report (an older server, a demo) still has its session's heartbeat.
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
  const liveness = signals !== null ? livenessOf(signals, now) : NO_SIGNALS
  type Defaults = Pick<
    Status,
    "agent" | "lead" | "meta" | "shortMeta" | "target" | "command" | "liveness"
  >
  const base: Defaults = {
    agent: null,
    lead: null,
    meta: null,
    shortMeta: null,
    target: null,
    command: null,
    liveness,
  }
  const make = (s: Omit<Status, keyof Defaults> & Partial<Defaults>): Status => ({
    ...base,
    ...s,
  })
  const resume = stoppedResume(task)

  // 1 · Done: shipped, closed, handed back.
  if (task.stage === "shipped") {
    // A pull request that was opened says what it holds: the state it is in, or what waits on you.
    const pullRequest = openLine(task)
    if (pullRequest !== null) {
      const waits = openWaits(task)
      return make({
        state: "done",
        kind: "done",
        icon: "done",
        text: pullRequest,
        short: pullRequest,
        meta: task.pullRequest?.number != null ? `pull request #${task.pullRequest.number}` : null,
        row: {
          mark: waits ? "you" : staysOpen(task) ? "quiet" : "done",
          words: pullRequest,
          tone: waits ? "amb" : null,
          group: waits ? "you" : staysOpen(task) ? "running" : "shipped",
        },
      })
    }
    // The detail knows the approval's moment; a list row has only the day it shipped.
    const shippedOn = Date.parse(task.closing?.shipped ?? "")
    const at = task.shipped?.approvedAt ?? null
    const word = shippedWord(task)
    if (at === null && !Number.isNaN(shippedOn)) {
      const day = new Date(shippedOn).toLocaleDateString([], { day: "numeric", month: "short" })
      return make({
        state: "done",
        kind: "done",
        icon: "done",
        text: `${word} · ${day}`,
        short: `${word} · ${day}`,
        row: { mark: "done", words: `${word} · ${day}`, tone: null, group: "shipped" },
      })
    }
    const pr = task.shipped?.pr ?? null
    const when = at != null ? clock(at) : null
    return make({
      state: "done",
      kind: "done",
      icon: "done",
      text:
        when === null
          ? word
          : word === "Approved"
            ? `Approved at ${when}`
            : `Shipped · approved at ${when}`,
      short: when !== null ? `${word} · ${when}` : word,
      meta: pr != null && pr.number != null ? `pull request #${pr.number}` : null,
      row: {
        mark: "done",
        words: when !== null ? `${word} · ${when}` : word,
        tone: null,
        group: "shipped",
      },
    })
  }
  if (isClosed(task) || task.handedBack !== undefined) {
    const words =
      task.handedBack !== undefined ? "Handed back · a ready prompt" : "Closed without shipping"
    return make({
      state: "done",
      kind: "done",
      icon: "done",
      text: words,
      short: task.handedBack !== undefined ? "Handed back" : "Closed",
      row: { mark: "done", words, tone: null, group: "shipped" },
    })
  }

  // 2 · The Plan is approved and the build waits to be started: the person's move, whatever the
  // planning session does now.
  if (task.action === "implement") {
    return make({
      state: "your-move",
      kind: "move",
      icon: "term",
      lead: "Your move",
      text: "start the build in a new session",
      short: "start the build",
      // The prompt Implement Start offers for the agent that planned it, else the first one.
      command:
        (
          task.implementStart?.agents.find((a) => a.agent === task.session?.agent) ??
          task.implementStart?.agents[0]
        )?.prompt ?? resume,
      row: { mark: "you", words: "Your move · start the build", tone: "amb", group: "you" },
    })
  }

  // 3 · Stopped: the session ended, was interrupted, or its process is gone.
  if (liveness.state === "stopped") {
    const lead =
      liveness.why === "ended"
        ? `${name}'s session ended`
        : liveness.why === "interrupted"
          ? `You stopped ${name}`
          : `${name} quit unexpectedly`
    const rest =
      liveness.why === "interrupted"
        ? "type anything there to go on"
        : "continue using QualityLayer"
    const short =
      liveness.why === "ended"
        ? "Session ended"
        : liveness.why === "interrupted"
          ? `You stopped ${name}`
          : `${name} quit`
    return make({
      state: "stopped",
      kind: "move",
      icon: "unplug",
      lead,
      text: rest,
      short: liveness.why === "interrupted" ? short : `${short} · continue with QL`,
      command: liveness.why === "interrupted" ? null : resume,
      row: {
        mark: "stop",
        words:
          liveness.why === "interrupted"
            ? "Stopped · type to go on"
            : `${short} · continue with QL`,
        tone: "amb",
        group: "you",
      },
    })
  }

  // 3b · Held by the agent's plan limit (core/limits): nothing runs until it resets, so no
  // spinner. A planned resume goes on by itself; otherwise the person continues the session.
  const limit = task.live?.signals?.limit
  if (limit != null) {
    const words = limitWords(limit, now)
    return make({
      state: "your-move",
      kind: "move",
      icon: "hour",
      lead: `${name} hit its usage limit`,
      text: words.line.replace(/:$/, ""),
      short: words.row,
      command: limit.resumeAt != null ? null : resume,
      row: { mark: "you", words: words.row, tone: "amb", group: "you" },
    })
  }

  // 4 · A permission prompt in the agent's window.
  if (liveness.state === "permission") {
    return make({
      state: "your-move",
      kind: "move",
      icon: "term",
      lead: "Your move",
      text: `${name} asks for permission in its window`,
      short: `allow it in ${name}`,
      row: { mark: "you", words: `Allow it in ${name}`, tone: "amb", group: "you" },
    })
  }

  // 5 · Needs you, here in the App.
  const needsYou = (
    text: string,
    short: string,
    row: string,
    target: StatusTarget | null,
    meta: string | null = null,
  ) =>
    make({
      state: "needs-you",
      kind: "you",
      icon: "go",
      text: `Needs you · ${text}`,
      short: `Needs you · ${short}`,
      meta:
        meta ??
        (liveness.state === "working"
          ? `${name} working`
          : liveness.state === "quiet"
            ? `${name} quiet`
            : null),
      shortMeta: meta,
      target,
      row: { mark: "you", words: row, tone: "amb", group: "you" },
    })
  const question = questionOf(task)
  // The `ask` that waited was interrupted: the question is still open, and an answer is kept.
  if (question !== null && question.stopped !== null) {
    return make({
      state: "stopped",
      kind: "move",
      icon: "unplug",
      lead: `${name} stopped waiting`,
      text: "your answer is kept",
      short: "Stopped waiting",
      target: { kind: "question" },
      command: resume,
      row: {
        mark: "you",
        words: `Q${question.number} · ${name} stopped waiting`,
        tone: "amb",
        group: "you",
      },
    })
  }
  // Tell me more: the agent looks into the question, and the card comes back richer.
  if (question !== null && question.looking === true) {
    return make({
      state: "working",
      kind: "work",
      icon: "spin",
      agent: name,
      text: `looking into question ${question.number}`,
      short: `Looking into question ${question.number}`,
      row: {
        mark: "agent",
        words: `Looking into Q${question.number}`,
        tone: null,
        group: "running",
      },
    })
  }
  if (question !== null && question.gate === null && pendingGate(task) === null) {
    const ahead = question.ahead
    return needsYou(
      `question ${question.number}`,
      `question ${question.number}`,
      `Q${question.number} · ${ahead !== null && ahead > 0 ? `about ${ahead} to come` : `${name} waits`}`,
      { kind: "question" },
      `${name} waits`,
    )
  }
  const pending = pendingGate(task)
  if (pending !== null) {
    const items = task.openItems ?? 0
    if (pending === "final")
      return needsYou(
        "approve the result",
        "approve the result",
        "Approve the result",
        { kind: "view", view: "verify" },
        items > 0 ? `${items} ${items === 1 ? "item" : "items"}` : null,
      )
    return needsYou(
      "review the Plan",
      "review the Plan",
      "Review the Plan",
      question !== null ? { kind: "question" } : { kind: "view", view: pending },
      items > 0 ? `${items} ${items === 1 ? "decision" : "decisions"}` : null,
    )
  }
  const needs = (task.live?.needs ?? []).filter((n: Need) => n.state !== "resolved")
  const waitedFor = needs.find((n) => n.waiting !== null)
  if (waitedFor !== undefined) {
    const since = minutes(now - (waitedFor.waiting ?? now))
    return make({
      state: "needs-you",
      kind: "you",
      icon: "hour",
      text: `The build waits for you · ${withoutNeedScope(waitedFor.what).replace(/^./, (c) => c.toLowerCase())}`,
      short: `The build waits · ${shortNeed(waitedFor.what)}`,
      meta: since,
      shortMeta: since,
      target: { kind: "need", for: waitedFor.for },
      row: {
        mark: "you",
        words: `The build waits · ${shortNeed(waitedFor.what)}`,
        tone: "amb",
        group: "you",
      },
    })
  }
  const need = needs[0]
  if (need !== undefined) {
    return make({
      state: "needs-you",
      kind: "you",
      icon: "go",
      text: `Needs you · ${need.what.replace(/^./, (c) => c.toLowerCase())}`,
      short: `Needs you · ${shortNeed(need.what)}`,
      meta: "the build goes on",
      shortMeta: "goes on",
      target: { kind: "need", for: need.for },
      row: {
        mark: "you",
        words: `${shortNeed(need.what)} · build goes on`,
        tone: "amb",
        group: "you",
      },
    })
  }
  const refusal = task.live?.refusal ?? null
  if (refusal !== null && refusal.count >= 2) {
    return needsYou(twiceWords(refusal.lead), "refused twice", "Refused twice · your call", null)
  }
  // A decision made here that the agent has not picked up: it stopped waiting, so it needs a nudge.
  if (decidedGate(task) !== null && !agentWaiting(task, now)) {
    return make({
      state: "your-move",
      kind: "move",
      icon: "term",
      lead: "Your move",
      text: `tell ${name} to continue`,
      short: `continue in ${name}`,
      command: resume,
      row: { mark: "you", words: "Your move · continue", tone: "amb", group: "you" },
    })
  }
  // The agent asked in its own window and waits there (no question in the App, no gate).
  if (askingYou(task, now)) {
    return make({
      state: "your-move",
      kind: "move",
      icon: "term",
      lead: "Your move",
      text: `${name} waits for your answer in its window`,
      short: `answer in ${name}`,
      row: { mark: "you", words: `Answer in ${name}`, tone: "amb", group: "you" },
    })
  }
  if (waitsOnItems(task)) {
    const items = task.openItems ?? 0
    const point =
      "items" in task && Array.isArray(task.items)
        ? flattenItems(task.items ?? []).find(
            (item) => /^plan:done:1:\d+$/.test(item.id) && item.state === "open",
          )
        : undefined
    return needsYou(
      `${items} ${items === 1 ? "item" : "items"}`,
      `${items} ${items === 1 ? "item" : "items"}`,
      `${items} ${items === 1 ? "item waits" : "items wait"}`,
      point !== undefined ? { kind: "item", id: point.id, view: fileOf(task, "plan") } : null,
    )
  }

  // 6 · Your move in the agent's window: its turn ended, or it has been silent for 20 minutes.
  if (liveness.state === "turn-end") {
    return make({
      state: "your-move",
      kind: "move",
      icon: "term",
      lead: "Your move",
      // A turn end alone does not say the agent asked: only where to look.
      text: `${name} waits for you in its window`,
      short: `open ${name}`,
      row: { mark: "you", words: `Open ${name}`, tone: "amb", group: "you" },
    })
  }
  if (liveness.state === "quiet" && liveness.long) {
    const quiet = minutes(liveness.quietFor)
    return make({
      state: "your-move",
      kind: "move",
      icon: "hour",
      lead: `No news for ${quiet}`,
      text: `check ${name}'s window`,
      short: "",
      // Its window may be gone with no hook to say so: the command that picks the work up again.
      command: resume,
      row: { mark: "stop", words: `No news for ${quiet}`, tone: "amb", group: "you" },
    })
  }

  // 7 · QualityLayer refused something once: the agent fixes it.
  if (refusal !== null) {
    return make({
      state: "error",
      kind: "err",
      icon: "alert",
      lead: refusal.lead,
      text: refusal.words,
      short: "being fixed",
      meta: "being fixed",
      row: { mark: "err", words: `${refusal.lead} · being fixed`, tone: "red", group: "running" },
    })
  }

  // 8 · Quiet: alive, but no sign of life for a while.
  if (liveness.state === "quiet") {
    const quiet = minutes(liveness.quietFor)
    return make({
      state: "quiet",
      kind: "quiet",
      icon: "quiet",
      text: `No news from ${name} for ${quiet}`,
      short: `No news for ${quiet}`,
      meta: liveness.toolRunning ? "a command may still run" : "it may still be thinking",
      row: { mark: "quiet", words: `No news for ${quiet}`, tone: null, group: "running" },
    })
  }

  // 9 · No session ever spoke for this task.
  if (liveness.state === "none" && task.session === null) {
    return make({
      state: "quiet",
      kind: "quiet",
      icon: "quiet",
      text: "No agent session yet",
      short: "No session yet",
      meta: "ask your agent to use QualityLayer",
      command: resume,
      row: {
        mark: "quiet",
        words: "No session yet",
        tone: null,
        group:
          task.progress !== null && (task.stage === "implement" || task.stage === "verify")
            ? "you"
            : "running",
      },
    })
  }

  // 10 · Working.
  const words = workWords(task)
  const agents = agentsAtWork(task, now)
  const since = task.session?.since ?? null
  const elapsed = since !== null && now - since >= MIN ? minutes(now - since) : null
  const meta = [
    words.meta,
    agents > 0 ? `${agents} ${agents === 1 ? "agent" : "agents"}` : null,
    elapsed,
  ]
    .filter((part) => part !== null)
    .join(" · ")
  const rowWords = [
    words.short,
    agents > 0 ? `${agents} ${agents === 1 ? "agent" : "agents"}` : null,
  ]
    .filter(Boolean)
    .join(" · ")
  return make({
    state: "working",
    kind: "work",
    icon: "spin",
    agent: name,
    text: words.text,
    short: words.short,
    meta: meta !== "" ? meta : null,
    shortMeta: elapsed,
    row: { mark: "agent", words: rowWords, tone: null, group: "running" },
  })
}

/** The status sorts the task into Needs you: anything that waits for a person. */
export const statusNeedsYou = (task: Input, now = Date.now()): boolean =>
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
