// The App's logic, apart from any DOM: which step tabs a task has, which
// view it opens on, what the step line says, how tasks group, what needs you
// lists. The components render these; the logic suites test them.

import { AGENT_NAMES, isNativeAgent } from "../core/agents/ids.ts"
import { COMMENTABLE_FILES, type DocRole, folderDoc, roleOf } from "../core/docs/names.ts"
import { HELPER_FRESH_MS, leftWords, timeLeft } from "../core/estimate.ts"
import { FLOW_STEPS, type FlowStepId, flowStepOf, isAutonomousBuildStage } from "../core/flow.ts"
import { agentIdOf, asksInChat, liveRow, shellStatus } from "../core/interaction-shell/status.ts"
import { flattenItems, type Item, openCount } from "../core/items.ts"
import { livenessOf } from "../core/live/liveness.ts"
import type { NeedItem } from "../core/needs.ts"
import { launchAgent, stagePrompt } from "../core/run/launch-spec.ts"
import type { Stage, VerifyMode } from "../core/task/stages.ts"
import type { TurnSnapshot } from "../interaction/contracts.ts"
import type { Comment, TaskDetail, TaskSummary } from "./api.ts"
import { ago, agoPhrase, type Route } from "./hooks.ts"
import {
  finalApproved,
  landingOf,
  openWaits,
  prWaits,
  shippedWord,
  staysOpen,
} from "./shell/lines.ts"
import { type ShellGroups, shellGroups } from "./shell/model.ts"

type Filed = Pick<TaskSummary, "files">

/** The file a role has in this task, as the server names it: the App spells no file name itself. */
export const fileOf = (task: Filed, role: DocRole): string =>
  task.files.find((f) => f.role === role)?.name ?? ""

/**
 * The role a file name plays. A view, a comment or a gate keeps the name of the file it was made
 * on.
 */
/** The gate that decides the planning documents: its target is the Plan's file. */
const PLAN_GATES = [folderDoc("plan")]

export type AgentInfo = { id: string; name: string }

export function agentInfo(id: string | undefined): AgentInfo {
  return isNativeAgent(id)
    ? { id, name: AGENT_NAMES[id] }
    : { id: id ?? "unknown", name: "Your agent" }
}

/** An agent in `gate wait` touches its heartbeat every 15 s; older than this, it stopped waiting. */
export const WAIT_FRESH_MS = 90_000
/** An agent with no word for this long may have lost its session: its row turns amber and the task offers the command that resumes it. */
export const QUIET_AFTER_MS = 10 * 60_000

/** The exact command that picks the task up again in a new session of its agent. */
export function resumeCommand(
  task: Pick<TaskSummary, "slug" | "stage" | "session"> & Partial<Pick<TaskSummary, "answers">>,
): string {
  return stagePrompt(launchAgent(task.session?.agent), task.slug, task.stage, task.answers)
}

/** A task an agent works on that has said nothing for ten minutes. */
export function agentQuiet(task: TaskSummary, now = Date.now()): boolean {
  return task.session !== null && !isClosed(task) && now - task.session.heartbeat > QUIET_AFTER_MS
}

export function agentWaiting(task: TaskSummary, now = Date.now()): boolean {
  const s = task.session
  return s !== null && s.state === "waiting" && now - s.heartbeat < WAIT_FRESH_MS
}

export function checkoutName(task: TaskSummary): string {
  return task.session?.checkout.split(/[\\/]/).filter(Boolean).pop() ?? ""
}

/** What sets a task apart in a list: a Chat or a bug fix. */
export function taskTag(task: Pick<TaskSummary, "type">): string | null {
  if (task.type === "chat") return "Chat"
  if (task.type === "bugfix") return "bug fix"
  return null
}

const closedStages: Stage[] = ["shipped", "abandoned"]

/** Made with an earlier workflow: listed, its files open as plain files, it is never continued. */
export const isEarlier = (task: Pick<TaskSummary, "earlier">): boolean => task.earlier === true

/** Nothing more happens to the task: it shipped, it was abandoned, or it belongs to an earlier workflow. */
export const isClosed = (task: TaskSummary) => closedStages.includes(task.stage) || isEarlier(task)

/** The task fields Verify's mode is read from: the server sends `verifyMode`, null outside Verify. */
type Moded = Pick<TaskSummary, "stage" | "verifyMode">

/** What Verify is doing: null for a task in any other stage. */
export const verifyModeOf = (task: Moded): VerifyMode | null =>
  task.stage === "verify" ? (task.verifyMode ?? "checking") : null

/** Verify is the person's: they review the change and their approval saves. */
export const personVerify = (task: Moded): boolean => {
  const mode = verifyModeOf(task)
  return mode === "yours" || mode === "rechecking"
}

/** The person's review is on screen: Verify turned to them, or the task shipped. */
export const inReview = (task: Moded): boolean => task.stage === "shipped" || personVerify(task)

/** The agents work on their own: Implement, and Verify until it turns to the person. */
export const autonomous = (task: Moded): boolean =>
  isAutonomousBuildStage(task.stage, verifyModeOf(task) ?? undefined)

/** A failed judgement is being fixed: the task stays in Verify, mode `fixing`. */
export const fixingVerify = (task: Moded): boolean => verifyModeOf(task) === "fixing"

/** The Plan's or the final review's gate; null while no gate is open. */
export function reviewGate(
  task: Pick<TaskSummary, "gate">,
): NonNullable<TaskSummary["gate"]> | null {
  return task.gate
}

/** Verify ended on its own with findings still open: the review lists them first. */
const leftOpen = (task: Pick<TaskDetail, "items">): boolean =>
  (task.items ?? []).some((item) => item.id.startsWith("verify:open:"))

/** The documents the open gate decides on. */
export function gateDocs(task: TaskSummary): string[] {
  const g = reviewGate(task)
  if (g === null) return []
  return g.targets !== undefined && g.targets.length > 0 ? g.targets : [g.target]
}

export function pendingGate(task: TaskSummary): string | null {
  const g = reviewGate(task)
  return g !== null && g.decision === "pending" && !g.settled ? g.target : null
}

/** Decided in the Cockpit or the chat, but the agent has not picked it up yet. */
export function decidedGate(task: TaskSummary): { target: string; decision: string } | null {
  const g = reviewGate(task)
  return g !== null && g.decision !== "pending" && !g.settled
    ? { target: g.target, decision: g.decision }
    : null
}

// ---------------------------------------------------------------- views and tabs

/** The view a task opens on: the one that needs you, else where the work is. */
export function defaultDoc(task: TaskDetail): string {
  // An earlier task has no step page: its first file opens as it is.
  if (isEarlier(task)) return task.docs.find((d) => d.exists)?.name ?? fileOf(task, "plan")
  // The approved Plan waits to be started: the Plan page carries the start.
  if (task.action === "implement" && pendingGate(task) === null) return fileOf(task, "plan")
  const target = pendingGate(task) ?? decidedGate(task)?.target ?? null
  if (target !== null) return target === "final" ? "verify" : target
  if (task.stage === "implement") return "checkpoint"
  if (task.stage === "verify" || task.stage === "shipped") return "verify"
  // A task opens on the document of the step it is at, not on one written early.
  const here = flowStepOf(task.stage)
  const mine = here !== null ? stepView(task, here) : ""
  if (task.docs.some((d) => d.name === mine && d.exists)) return mine
  const existing = task.docs.filter((d) => d.exists && d.name !== fileOf(task, "implement"))
  return existing[existing.length - 1]?.name ?? fileOf(task, "plan")
}

export type TabTone = "done" | "you" | "live" | "bad" | "todo"
export type StageTab = {
  key: string
  /** The step of the flow this tab is: its open items are counted under it. */
  step: FlowStepId
  label: string
  /** Shown only when it matters now: your turn, running, failed. */
  state: string
  tone: TabTone
  enabled: boolean
  title: string
  /** Findings the open gate's stage wrote into this document: "1 added". */
  added: number
  /** What a step that cannot show its page yet says instead, in one sentence; "" when it can. */
  sentence?: string
  /** A few words beside the label in the track: Verify says its pull request is open or merged. */
  note?: string
}

/** The stage word an `[!ADDED]` block names, for each gate's document. */
const GATE_STAGE_WORD: Record<string, string> = Object.fromEntries(
  PLAN_GATES.map((name) => [name, "plan"]),
)

const DOC_WORDS: Partial<Record<DocRole, string>> = {
  plan: "the Plan",
}

/** What a document is called in a sentence, or undefined for one that has no plain word. */
function docWords(name: string): string | undefined {
  const role = roleOf(name)
  return role !== null ? DOC_WORDS[role] : undefined
}

/** What the open gate carries beyond its own documents: later findings written into earlier ones. */
export type Additions = {
  /** The gate's stage word, as the blocks name it. */
  stage: string
  /** The gate's own document, in words: "the artifact". */
  from: string
  count: number
  docs: { name: string; words: string; count: number; anchor: string }[]
}

export function additionsOf(task: TaskDetail): Additions | null {
  const pending = pendingGate(task)
  const stage = pending !== null ? GATE_STAGE_WORD[pending] : undefined
  if (pending === null || stage === undefined) return null
  const docs = task.docs.flatMap((d) => {
    const found = (d.added ?? []).map((a, i) => ({ stage: a.stage, n: i + 1 }))
    const mine = found.filter((a) => a.stage === stage)
    const first = mine[0]
    return d.name === pending || first === undefined
      ? []
      : [
          {
            name: d.name,
            words: docWords(d.name) ?? d.label,
            count: mine.length,
            anchor: `added-${first.n}`,
          },
        ]
  })
  const count = docs.reduce((sum, d) => sum + d.count, 0)
  return count > 0 ? { stage, from: docWords(pending) ?? pending, count, docs } : null
}

const stepIndex = (id: FlowStepId) => FLOW_STEPS.findIndex((step) => step.id === id)
export const stepLabel = (id: FlowStepId) => FLOW_STEPS[stepIndex(id)]?.label ?? id

/** Where the task is on the three steps: a shipped one is past Verify. */
function position(task: TaskSummary): number {
  if (task.stage === "shipped") return FLOW_STEPS.length
  const step = flowStepOf(task.stage)
  return step === null ? -1 : stepIndex(step)
}

/** Verify's tab word: how far the checks are, what is being fixed. */
function verifyState(task: TaskDetail): string {
  const mode = verifyModeOf(task)
  if (mode === null || personVerify(task)) return ""
  const list = task.checklist
  if (list === null || list === undefined) return "checking"
  if (environmentBlockedChecks(list)) return `blocked ${list.failed}`
  if (mode === "fixing" && list.failed > 0) return `fixing ${list.failed}`
  return `${list.passed}/${list.total}`
}

/** Every failing live check names an environment blocker; no code fix is under way. */
export function environmentBlockedChecks(list: TaskDetail["checklist"] | undefined): boolean {
  const failed = list?.groups.flatMap((g) => g.rows).filter((r) => r.state === "failed") ?? []
  const actual = failed.filter((r) => r.id !== "review" || !failed.some((v) => v.extra === true))
  return (
    actual.some((r) => r.id.startsWith("scenario:") || r.id.startsWith("acceptance:")) &&
    actual.every((r) => /^environment:\s*\S/i.test(r.text ?? ""))
  )
}

/**
 * The person's notes are still the agent's work: one is not yet checked. A list row (not a detail)
 * carries no notes, and then nothing is working.
 */
export const notesWorking = (task: Pick<TaskDetail, "changesRequested"> | TaskSummary): boolean =>
  ("changesRequested" in task ? task.changesRequested : null)?.notes.some(
    (n) => n.state !== "checked",
  ) === true

/**
 * The three steps as tabs: the Plan opens its document, Implement and Verify the build's views.
 * Verify is one tab for the agents' checks and the person's review.
 */
export function stageTabs(
  task: TaskDetail,
  now = Date.now(),
  turn?: TurnSnapshot | null,
): StageTab[] {
  // An earlier task has no steps to show.
  if (isEarlier(task)) return []
  const at = position(task)
  const past = (id: FlowStepId) => at > stepIndex(id)
  const reached = (id: FlowStepId) => at >= stepIndex(id)
  const pending = pendingGate(task)
  const decided = decidedGate(task)
  const additions = additionsOf(task)
  const questionWaiting = (step: FlowStepId): boolean => {
    if (flowStepOf(task.stage) !== step) return false
    const human = (question: NonNullable<TaskDetail["question"]>) =>
      !(question.gate && !question.item)
    if (turn) {
      if (turn.batch?.step && turn.batch.step !== step) return false
      return turn.questions.some(human)
    }
    if (task.batch) {
      if (task.batch.step && task.batch.step !== step) return false
      return task.batch.members.some((member) => member.answer === undefined)
    }
    return (
      !!task.question &&
      human(task.question) &&
      !task.answeredQuestions?.some((answer) => answer.id === task.question?.id && !answer.reopened)
    )
  }

  const tab = (
    step: FlowStepId,
    key: string,
    label: string,
    state: string,
    tone: TabTone,
    enabled: boolean,
    title: string,
    added = 0,
  ): StageTab => ({
    key,
    step,
    label,
    state,
    tone,
    enabled,
    added,
    sentence: enabled
      ? ""
      : tone === "live"
        ? "Being written. It opens here with the first draft."
        : (FLOW_STEPS[stepIndex(step)]?.caption ?? ""),
    title: enabled
      ? title
      : tone === "live"
        ? "Being written: opens with the first draft"
        : `Not reached yet. ${FLOW_STEPS[stepIndex(step)]?.caption ?? ""}`.trim(),
  })

  const planTab = (): StageTab => {
    const name = fileOf(task, "plan")
    const exists = task.docs.find((d) => d.name === name)?.exists === true
    // Only the Plan is the person's: the track is amber only where the person is needed.
    const humanWaiting = questionWaiting("plan")
    const waiting =
      humanWaiting || (pending !== null && !task.gate?.locked && gateDocs(task).includes(name))
    const reviewing =
      !!task.gate?.locked &&
      task.helpers.some((helper) => helper.id === "review-plan" && helper.state === "running")
    // The Plan is being written even before its file exists: research helpers can read for minutes.
    const writing =
      !waiting && pending === null && task.stage === "plan" && task.handedBack === undefined
    // A hand-back has nothing running; a step not reached stays "to do" even when its details are on disk.
    const tone: TabTone = waiting
      ? humanWaiting || decided === null
        ? "you"
        : "done"
      : (writing || reviewing) && task.handedBack === undefined
        ? "live"
        : exists && (reached("plan") || task.handedBack !== undefined)
          ? "done"
          : "todo"
    return tab(
      "plan",
      name,
      stepLabel("plan"),
      waiting
        ? humanWaiting
          ? "your answer"
          : "your review"
        : reviewing
          ? "reviewing"
          : writing
            ? "writing"
            : "",
      tone,
      exists,
      `Open docs/plans/${task.slug}/${name}`,
      additions?.docs.find((d) => d.name === name)?.count ?? 0,
    )
  }

  // The working ring means the agent works: a session that stopped, waits for you or has not been
  // started draws the outlined future mark, however the stage reads.
  const session = shellStatus(task, now).state
  const building = task.stage === "implement"
  const starting = task.action === "implement"
  const buildRuns =
    building &&
    !starting &&
    session !== "stopped" &&
    session !== "waits-for-you" &&
    session !== "step-done"
  const implementTab = tab(
    "implement",
    "checkpoint",
    "Implement",
    starting
      ? "start the build"
      : building && task.progress !== null
        ? `${task.progress.checked}/${task.progress.total}`
        : "",
    starting ? "you" : buildRuns ? "live" : past("implement") ? "done" : "todo",
    reached("implement") || starting,
    "The slices, the tasks and the checks",
  )

  const mode = verifyModeOf(task)
  // The person's notes are the agent's work until the fixes are made and checked.
  const changesWorking = personVerify(task) && pending === null && notesWorking(task)
  const verifyTone: TabTone =
    pending === "final" || mode === "asked" || mode === "yours"
      ? "you"
      : changesWorking || mode === "checking" || mode === "fixing" || mode === "rechecking"
        ? "live"
        : task.stage === "shipped"
          ? // Approved, and the pull request waits on the person: amber; else it is the pull request's turn.
            prWaits(task)
            ? "you"
            : "done"
          : past("verify")
            ? "done"
            : "todo"
  const verifyTab = {
    ...tab(
      "verify",
      "verify",
      "Verify",
      pending === "final"
        ? "your review"
        : mode === "asked"
          ? "needs you"
          : changesWorking
            ? "changes"
            : verifyState(task),
      verifyTone,
      reached("verify") || task.verification.length > 0,
      "What the agents checked, the evidence, the code and your approval",
    ),
    ...verifyNote(task),
  }
  const tabs: StageTab[] = [planTab(), implementTab, verifyTab]
  // Held by the agent's plan limit: nothing is written or built until it resets, so no spinner.
  return task.live?.signals?.limit != null
    ? tabs.map((t) => (t.tone === "live" ? { ...t, tone: "you", state: "usage limit" } : t))
    : tabs
}

/**
 * After the approval Verify is not "running": it is approved, and its pull request is open, merged
 * or closed. The track says so beside the label, and the tab's title says it in full.
 */
function verifyNote(task: TaskDetail): Pick<StageTab, "note" | "title"> | Record<string, never> {
  const life = task.stage === "shipped" ? task.pullRequest : undefined
  if (life === undefined) return {}
  const number = life.number !== null ? ` #${life.number}` : ""
  if (life.state === "merged")
    return { note: "merged", title: `Approved · pull request${number} merged` }
  if (life.state === "closed")
    return { note: "closed", title: `Approved · pull request${number} closed without a merge` }
  return { note: "pull request open", title: `Approved · pull request${number} open` }
}

const snippet = (text: string, at = 42): string =>
  text.length > at ? `${text.slice(0, at - 1).trimEnd()}…` : text

/** Where a comment lives, in words, and the view that opens at it: the Comments panel links there. */
export function commentPlace(c: Pick<Comment, "doc" | "quote" | "anchor" | "build">): {
  label: string
  view: string
} {
  if (c.anchor !== undefined) {
    const file = c.anchor.file.split("/").pop() ?? c.anchor.file
    return { label: `${file} · line ${c.anchor.line}`, view: "verify" }
  }
  if (c.build !== undefined)
    return { label: `Implement · ${c.build.quote ?? c.build.id}`, view: "checkpoint" }
  const quote = c.quote !== "" ? ` · ${snippet(c.quote)}` : ""
  if (c.doc === "build") return { label: `Build${quote}`, view: "checkpoint" }
  if (c.doc === "final") return { label: `Verify${quote}`, view: "verify" }
  const step = viewedStep(c.doc)
  const name = step !== null ? stepLabel(step) : c.doc
  return { label: `${name}${quote}`, view: c.doc }
}

/**
 * Where a view's comments go: a document's gate, the final approval, or the
 * build, which takes comments at any time; the agent picks those up with the
 * user's next answer.
 */
export function commentTarget(view: string, task?: Filed): string | null {
  const step = viewedStep(view)
  const document = step === null ? undefined : task?.files.find((file) => file.role === step)
  if (document) return document.name
  if (view === "verify") return "final"
  if (view === "checkpoint") return "build"
  return COMMENTABLE_FILES.includes(view) ? view : null
}

// ---------------------------------------------------------------- the step line

export type NextAction =
  /** Disabled with its reason in `title`: the agent still writes, or a review is still to come in. */
  | { kind: "approve"; label: string; disabled?: boolean; title?: string }
  | { kind: "changes"; label: string; disabled: boolean }
  /** Opens the review panel to write the first comment. */
  | { kind: "comment"; label: string }
  | { kind: "open"; label: string; view: string }
  | { kind: "copy"; label: string; text: string; note: string }
  /** Ends Verify without another judge run: the build is taken as it stands. */
  /** Shows what the agent changed in the Plan since the last review. */
  | { kind: "diff"; label: string }
  /** Puts a shipped task away. */
  | { kind: "archive"; label: string }

export type NextStep = {
  /** Who has the ball: you, the agent, nobody (done), or it failed. */
  tone: "you" | "agent" | "done" | "bad" | "quiet"
  title: string
  text: string
  /** The one short fact of a gate that waits ("Codex read the Plan"), kept while a question names the line. */
  fact?: string
  /** A detail the line keeps out of its sentence (an agent that stopped waiting), as a tooltip. */
  note?: string
  primary: NextAction | null
  secondary: NextAction | null
  /** A command to run in a shell, shown as a copyable chip. */
  command: string | null
  /** 0..1 while the build runs. */
  progress: number | null
  /** One line per helper working side by side: what each is doing now. */
  lines?: string[]
  /** The helpers and reviews running now, each with its clock and the time left. */
  runs?: RunningRow[]
  /** What teammates said about the gate that waits: advice, never the decision. */
  advice?: Advice[]
  /** The agent went quiet: the exact command that resumes the task, and where it ran. */
  resume?: { command: string; where: string }
  /** A step the task is past (or not at yet): where the task is now, to link to. */
  elsewhere?: { link: string; view: string }
  /** The Plan is approved and waits to be started: the line offers the command, per agent. */
  starting?: true
}

/** Slices with activity confirmed by the server; unfinished position alone is not activity. */
function runningSlices(task: TaskDetail): number[] {
  const reported = task.timeline?.builder?.task ?? null
  return reported === null
    ? []
    : (task.timeline?.slices ?? [])
        .filter((s) => s.tasks.some((t) => t.id === reported && !t.checked))
        .map((s) => s.n)
}

/** "slice 5", "slices 5 and 6", "slices 2, 3 and 4"; capitalised for the start of a sentence. */
function slicesWords(slices: number[], capital = false): string {
  const list =
    slices.length <= 1
      ? String(slices[0] ?? "")
      : `${slices.slice(0, -1).join(", ")} and ${slices.at(-1)}`
  return `${capital ? "Slice" : "slice"}${slices.length === 1 ? "" : "s"} ${list}`
}

/** A teammate's verdict on the owner's open gate: advice, one line per member. */
export type Advice = { who: string; text: string; when: string }

/** Each teammate's latest verdict on the documents this gate decides, kept after the agent took the comments. */
export function adviceOf(task: TaskDetail, now: number): Advice[] {
  if (pendingGate(task) === null) return []
  const docs = gateDocs(task)
  const onGate = task.comments.filter((c) => c.source !== undefined && docs.includes(c.doc))
  const latest = new Map<string, TaskDetail["comments"][number]>()
  for (const c of onGate) {
    if (c.verdict === undefined || c.author === undefined) continue
    const held = latest.get(c.author)
    if (held === undefined || c.created >= held.created) latest.set(c.author, c)
  }
  return [...latest.values()]
    .sort((a, b) => a.created - b.created)
    .map((verdict) => {
      const author = verdict.author ?? ""
      const said = onGate.filter((c) => c.author === author && c.remark.trim() !== "").length
      const text =
        verdict.verdict === "approve"
          ? `${firstName(author)} approved`
          : `${firstName(author)} asked for changes${said > 0 ? ` · ${said} ${said === 1 ? "comment" : "comments"}` : ""}`
      const since = ago(verdict.created, now)
      return { who: author, text, when: since === "just now" ? since : `${since} ago` }
    })
}

type Row = NonNullable<TaskSummary["helpers"]>[number]

/** m:ss since `from`, the clock a running helper or review shows. */
export function clock(from: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - from) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/** The other agent's reviews in the status box: running ones always, finished ones while their stage is open. */
function reviewRows(task: TaskSummary): Row[] {
  return (task.helpers ?? []).filter((r) => {
    if (r.kind !== "review") return false
    if (r.state === "running") return true
    return r.id === "review-plan" ? task.stage === "plan" : task.stage !== "plan"
  })
}

/** Compact approval status; the full guarded reason remains on the action's tooltip. */
export function approvalLockReason(task: TaskSummary): string | null {
  if (!task.gate?.locked) return null
  const review = reviewRows(task).find((row) => row.state === "running")
  if (review) {
    // A panel's row is "Panel review · Codex, Grok, Pi": the panel reviews, whoever sits on it.
    const who = /^Panel review\b/.test(review.label ?? "")
      ? "The panel"
      : (review.label ?? "The other agent").replace(/ review$/i, "")
    return `${who} is reviewing${task.stage === "plan" ? " the Plan" : ""}`
  }
  const finished = reviewRows(task).find((row) => row.id === "review-plan")
  if (finished?.state === "done") return "Review findings need an update"
  if (finished) return "Review needs attention"
  return "Approval pending"
}

/**
 * A helper or review for the status box. It holds times, not words: the bar works out the clock
 * and the estimate itself every second, so they keep moving between the Cockpit's polls.
 */
export type RunningRow = {
  key: string
  label: string
  /** A review's process is watched; a helper is known only by what it says. */
  kind: "helper" | "review"
  /** When it started; null when that is not known. */
  started: number | null
  /** How long earlier runs of its kind (a slice: of its size) took (ms); null on a first run. */
  typical: number | null
  line: string | null
  /** When it last said something. */
  seen: number | null
  /** When it said it is over (`progress <id> done`); null while it works. */
  over: number | null
}

/** The words for how long is left of a run that started at `started`; null without an estimate. */
export function leftOf(
  started: number | null | undefined,
  typical: number | null | undefined,
  now: number,
): string | null {
  if (started === null || started === undefined) return null
  const left = timeLeft(typical, now - started)
  return left.state === "unknown" ? null : leftWords(left)
}

function runningRow(row: Row, label: string, line = row.line ?? null): RunningRow {
  return {
    key: row.id,
    label,
    kind: row.kind === "review" ? "review" : "helper",
    started: row.started ?? null,
    typical: row.typical ?? null,
    line,
    seen: row.at ?? null,
    over: row.state === "done" ? (row.at ?? null) : null,
  }
}

/** What a card in the status box says at `now`: running, over, or quiet for too long to be sure. */
export type RunView =
  | { state: "running"; clock: string | null; left: string | null }
  | { state: "done"; clock: string | null }
  | { state: "quiet"; since: string }

export function runView(run: RunningRow, now: number): RunView {
  if (run.over !== null) {
    return { state: "done", clock: run.started === null ? null : clock(run.started, run.over) }
  }
  const last = run.seen ?? run.started
  if (run.kind === "helper" && last !== null && now - last >= HELPER_FRESH_MS) {
    const since = new Date(last).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    })
    return { state: "quiet", since }
  }
  return {
    state: "running",
    clock: run.started === null ? null : clock(run.started, now),
    left: leftOf(run.started, run.typical, now),
  }
}

function reviewLine(row: Row, now: number): string {
  const who = row.label ?? "Review"
  const state =
    row.state === "running"
      ? `running ${clock(row.started ?? now, now)}`
      : row.state === "timed_out"
        ? "timed out"
        : row.state === "failed"
          ? "failed"
          : `done${row.findings !== null && row.findings !== undefined ? ` · ${row.findings} ${row.findings === 1 ? "finding" : "findings"}` : ""}`
  // The last line a review printed tells what it is doing; once it is done, it is noise.
  const line = row.state === "running" && row.line ? ` · ${row.line}` : ""
  return `${who} · ${state}${line}`
}

/**
 * The step of the flow a view shows; null for a page that belongs to none (the pages Show me draws).
 * Verify has one view for the agents' checks and the person's review.
 */
export function viewedStep(view: string): FlowStepId | null {
  const role = roleOf(view)
  if (role !== null) return role
  if (view === "implement" || view === "checkpoint") return "implement"
  if (view === "verify") return "verify"
  return null
}

/**
 * The one line the items a decision settled fold into. After the decision: "Approved by you at
 * 13:27 · 4 items settled · the agent's 7 decisions kept". In a new revision: "Kept from your
 * first review: the mockup, the engineering decision, no extra review".
 */
export function settledLineFor(
  items: readonly Item[],
  revision: boolean,
  decision: "approved" | "changes" = "approved",
): string | undefined {
  const settled = items.filter(
    (item) =>
      item.state === "settled" &&
      (item.settledAt !== undefined || (revision && item.kind === "decision")),
  )
  if (settled.length === 0) return undefined
  const decided = settled.find((item) => item.kind === "decided")
  if (revision) {
    const kept: string[] = []
    if (settled.some((item) => item.kind === "mockup")) kept.push("the mockup")
    const engineering = settled.filter(
      (item) => item.kind === "decision" && item.kindLabel.startsWith("Engineering"),
    ).length
    if (engineering > 0)
      kept.push(
        engineering === 1 ? "the engineering decision" : `${engineering} engineering decisions`,
      )
    if (decided !== undefined) kept.push(`the agent's ${decided.count ?? 0} decisions`)
    const extra = settled.find((item) => item.kind === "extra-review")
    if (extra !== undefined)
      kept.push(extra.what.startsWith("None") ? "no extra review" : "the extra review")
    if (settled.some((item) => item.kind === "done")) kept.push("Done means")
    // What was decided with you in the Plan's questions is a record that was settled from the start: kept too.
    if (
      items.some(
        (item) => item.state === "settled" && item.kindLabel.startsWith("Decided with you"),
      )
    )
      kept.push("what you decided with the agent")
    return kept.length > 0 ? `Kept from your first review: ${kept.join(", ")}.` : undefined
  }
  const at = Math.max(...settled.map((item) => item.settledAt ?? 0))
  const time = new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  // The same set the card counted as open: the agent's decisions are one item of it (kept as a
  // group), what you decided in the questions was settled before.
  const counted = settled.filter((item) => !item.kindLabel.startsWith("Decided with you"))
  return [
    decision === "changes" ? `You sent changes at ${time}` : `Approved by you at ${time}`,
    `${counted.length} ${counted.length === 1 ? "item" : "items"} settled`,
    ...(decided !== undefined ? [`the agent's ${decided.count ?? 0} decisions kept`] : []),
  ].join(" · ")
}

/** Where a step stands for the task: behind it, the one it is at, or not reached yet. */
export type StepPhase = "past" | "now" | "future"

export function stepPhase(task: TaskSummary, view: string): StepPhase {
  const viewed = viewedStep(view)
  const at = position(task)
  // A page of no step, or a task that is on no step (abandoned), reads as where the task is.
  if (viewed === null || at < 0) return "now"
  const index = stepIndex(viewed)
  // A shipped task's Verify says it shipped.
  if (task.stage === "shipped" && viewed === "verify") return "now"
  return index < at ? "past" : index > at ? "future" : "now"
}

/**
 * The step line of the step being viewed. Where the task is, it is `nextStep`; a step behind it is
 * done and says where the task is now; a step not reached yet says what will happen there. So
 * Verify's line shows on Verify only, never on every tab.
 */
export function stepLineFor(
  task: TaskDetail,
  view: string,
  drafts: number,
  now = Date.now(),
  /** How many of the answers picked and not sent ask for a change: the line says so. */
  changesAsked = 0,
): NextStep {
  const phase = stepPhase(task, view)
  const viewed = viewedStep(view)
  const quiet: NextStep = {
    tone: "quiet",
    title: "",
    text: "",
    primary: null,
    secondary: null,
    command: null,
    progress: null,
  }
  if (phase === "now" || viewed === null) return nextStep(task, view, drafts, now, changesAsked)
  if (phase === "future") {
    return {
      ...quiet,
      title: "Not started",
      text: FLOW_STEPS[stepIndex(viewed)]?.caption ?? "",
    }
  }
  const at = position(task)
  const where = task.stage === "shipped" ? "Verify" : stepLabel(FLOW_STEPS[at]?.id ?? viewed)
  return {
    ...quiet,
    tone: "done",
    title: `${stepLabel(viewed)} is done`,
    text:
      task.stage === "shipped"
        ? "The task shipped."
        : needsYou(task, now)
          ? `${where} waits for you.`
          : `The task is on ${where} now.`,
    elsewhere: { link: `Go to ${where}`, view: defaultDoc(task as TaskDetail) },
  }
}

export function nextStep(
  task: TaskDetail,
  view: string,
  drafts: number,
  now = Date.now(),
  changesAsked = 0,
): NextStep {
  const advice = adviceOf(task, now)
  let step = baseStep(task, view, drafts, now, changesAsked)
  const reviews = reviewRows(task)
  const locked = task.gate?.locked ?? null
  if (step.primary?.kind === "approve" && locked !== null && locked !== "") {
    step = {
      ...step,
      primary: {
        ...step.primary,
        disabled: true,
        title: approvalLockReason(task) ?? locked,
      },
    }
  }
  if (reviews.length > 0) {
    step = {
      ...step,
      lines: [
        ...(step.lines ?? []),
        // A finished review of the Plan is its findings, drawn as items: no line of its own.
        ...reviews
          .filter((r) => r.state !== "running" && !(r.id === "review-plan" && r.state === "done"))
          .map((r) => reviewLine(r, now)),
      ],
      runs: [
        ...(step.runs ?? []),
        ...reviews
          .filter((r) => r.state === "running")
          .map((r) => runningRow(r, r.label ?? "Review")),
      ],
    }
  }
  return advice.length > 0 ? { ...step, advice } : step
}

/** What an approved task says of its change: merged (and by whom), or not merged yet; "" before it ships. */
function landingWords(task: TaskDetail): string {
  const landing = task.landing
  if (landing?.state === "landed" && landing.how !== "legacy")
    return landing.how === "person"
      ? "Marked as merged."
      : `Merged into ${landing.base ?? "the base branch"}.`
  return landingOf(task) !== null ? "Not merged yet; the chat stays open." : ""
}

function baseStep(
  task: TaskDetail,
  view: string,
  drafts: number,
  now: number,
  changesAsked = 0,
): NextStep {
  const agent = agentInfo(task.session?.agent)
  const live = agentWaiting(task, now)
  const heartbeat = task.session?.heartbeat ?? 0
  const where = checkoutName(task)
  const base: NextStep = {
    tone: "agent",
    title: "",
    text: "",
    primary: null,
    secondary: null,
    command: null,
    progress: null,
  }

  // A task handed back as a plain prompt, at the person's request: nothing runs, and nothing happens unless the person asks.
  if (task.handedBack !== undefined) {
    return {
      ...base,
      tone: "done",
      title: "Handed back",
      text: "A ready prompt instead of a task; nothing else happens unless you ask.",
    }
  }
  // The agent asks one question at a time and waits; the App shows the question.
  const asking = (task.items ?? []).find((item) => item.kind === "question")
  if (
    !autonomous(task) &&
    asking !== undefined &&
    decidedGate(task) === null &&
    pendingGate(task) === null
  ) {
    return {
      ...base,
      tone: "you",
      title: "Waits for your answer",
      text: `${agent.name} asks one question at a time and waits for your answer.`,
    }
  }

  // The person's notes are the agent's work until the fixes are made and checked.
  const asked = task.changesRequested
  if (
    asked?.notes.some((n) => n.state !== "checked") === true &&
    personVerify(task) &&
    task.session !== null &&
    now - heartbeat <= QUIET_AFTER_MS
  ) {
    const going = asked.notes.filter((n) => n.state !== "done" && n.state !== "checked").length
    const progress =
      asked.notes.length === 1
        ? "Your note is in progress."
        : `${going} of your notes ${going === 1 ? "is" : "are"} in progress.`
    const then = `Then only what ${going === 1 ? "it touches" : "they touch"} is checked again, and your review comes back to you.`
    return {
      ...base,
      tone: "agent",
      title: "The agent is making your changes",
      text:
        going > 0
          ? `${progress} ${then}`
          : "Your notes are done. Only what they touch is checked again, and your review comes back to you.",
    }
  }

  const decided = decidedGate(task)
  if (decided !== null) {
    const approved = decided.decision === "approved"
    // The final approval closes the task itself: it waits for no agent to pick it up.
    if (finalApproved(task))
      return { ...base, tone: "done", title: "Approved", text: "Nothing to do in the chat." }
    if (live) {
      return {
        ...base,
        tone: "done",
        title: approved ? "Approved" : "Changes sent",
        text: `${agent.name} picks it up now. Nothing to do in the chat.`,
      }
    }
    return {
      ...base,
      tone: "you",
      title: `${approved ? "Approved" : "Changes sent"}. Now tell ${agent.name} to continue`,
      text: `${agent.name} stopped waiting ${agoPhrase(heartbeat, now)}. Paste this into your agent where it ran${where !== "" ? `, in ${where}` : ""}.`,
      command: resumeCommand(task),
    }
  }

  const pending = pendingGate(task)
  if (pending !== null) {
    // The agent waits and goes on the moment you decide; one that stopped says where to continue,
    // in the line's tooltip rather than its sentence.
    const stopped = live
      ? {}
      : {
          note: `${agent.name} stopped waiting ${agoPhrase(heartbeat, now)}; your decision is kept. Continue in your agent with: ${resumeCommand(task)}.`,
        }
    const waiting =
      task.items !== undefined ? openCount(task.items, viewedStep(view) ?? undefined) : null
    const askedLine =
      changesAsked > 0
        ? `${changesAsked} ${changesAsked === 1 ? "answer so far asks" : "answers so far ask"} for a change.`
        : ""
    if (pending === "final") {
      const reviewItems = (task.items ?? []).filter((item) => item.step === "verify")
      // Every item is settled: nothing is left but the approval, and Request changes is the
      // items' own business by now.
      if (reviewItems.length > 0 && reviewItems.every((item) => item.state === "settled")) {
        const fixes = reviewItems.filter((item) => item.answer?.kind === "fix").length
        return {
          ...base,
          tone: "you",
          title: "Ready to ship",
          text: [
            `All ${reviewItems.length} items are settled.`,
            fixes > 0 ? `The ${fixes === 1 ? "fix is" : `${fixes} fixes are`} in and checked.` : "",
          ]
            .filter(Boolean)
            .join(" "),
          ...stopped,
          primary: { kind: "approve", label: "Approve" },
          secondary: null,
        }
      }
      return {
        ...base,
        tone: "you",
        title: "Waits for your review",
        text: [
          task.iterations > 0 && !leftOpen(task) ? "Every check passed." : "",
          // One short sentence: "4 items need you; 1 answer so far asks for a change."
          waiting !== null && waiting > 0 && askedLine !== ""
            ? `${waiting} ${waiting === 1 ? "item needs" : "items need"} you; ${askedLine.replace(/^./, (c) => c.toLowerCase())}`
            : waiting !== null && waiting > 0
              ? `${waiting} ${waiting === 1 ? "item needs" : "items need"} you before it ships.`
              : askedLine,
        ]
          .filter(Boolean)
          .join(" "),
        ...stopped,
        primary: { kind: "approve", label: "Approve" },
        // Without notes it opens the Comments panel to write one, as at every other approval.
        secondary:
          drafts === 0
            ? { kind: "comment", label: "Request changes…" }
            : { kind: "changes", label: "Request changes…", disabled: false },
      }
    }
    // From the second round on the line says what came back: the parts the agent changed after your notes.
    const round = task.gate?.round ?? 1
    const planItems = flattenItems(task.items ?? []).filter((item) => item.step === "plan")
    const changed = planItems.filter((item) => item.changedSinceReview === true).length
    const noted = planItems.filter((item) => item.kind === "note").length
    const back =
      round >= 2 && changed > 0
        ? `The agent changed ${changed} ${changed === 1 ? "part" : "parts"}${noted > 0 ? ` after your ${noted} ${noted === 1 ? "note" : "notes"}` : " since your review"}. Changes are marked.`
        : ""
    // What another agent made of the Plan: the reason Approve may be locked.
    const reviewed = reviewRows(task).find((r) => r.id === "review-plan" && r.state !== "running")
    // A comment of yours on the Plan that the agent answered is what the person reads next.
    const answeredCount = task.comments.filter(
      (c) => c.doc === fileOf(task, "plan") && c.answer !== undefined && c.item === undefined,
    ).length
    const answeredNote =
      answeredCount === 0
        ? ""
        : answeredCount === 1
          ? "Your feedback was answered."
          : `${answeredCount} threads of your feedback were answered.`
    // The state and at most one short fact: what came back, who Approve waits for, an answered
    // comment, or that the other agent read the Plan. The counts are on the tabs and the cards.
    const fact =
      reviewed !== undefined
        ? `${(reviewed.label ?? "The other agent").replace(/ review$/i, "")} read the Plan`
        : ""
    const text = back || answeredNote || fact
    return {
      ...base,
      tone: "you",
      title: round >= 2 ? `Waits for your approval · revision ${round}` : "Waits for your approval",
      text,
      ...(fact !== "" ? { fact } : {}),
      ...stopped,
      primary: { kind: "approve", label: "Approve" },
      // From the second round the diff comes first; without comments, Request changes opens the Comments panel.
      secondary:
        round >= 2 && task.planDiff !== undefined
          ? { kind: "diff", label: "Show the Plan's diff" }
          : drafts === 0
            ? { kind: "comment", label: "Request changes…" }
            : { kind: "changes", label: "Request changes…", disabled: false },
    }
  }

  if (task.action === "implement") {
    return {
      ...base,
      tone: "you",
      title: "Start the build",
      // The line itself carries the command and its Copy button, for the agent the person picks.
      text: "",
      starting: true,
    }
  }

  if (task.stage === "shipped") {
    const facts = task.shipped
    const pr = facts?.pr ?? task.review?.pr ?? null
    const failed = facts?.prError ?? undefined
    const at =
      facts?.approvedAt != null
        ? new Date(facts.approvedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })
        : null
    return {
      ...base,
      tone: "done",
      title: shippedWord(task),
      text: [
        at !== null ? `Approved at ${at}.` : "Approved.",
        pr !== null
          ? `Pull request ${pr.number !== null ? `#${pr.number} ` : ""}is open on GitHub.`
          : failed !== undefined
            ? `The pull request could not be opened: ${failed}`
            : facts?.choice === "pull-request"
              ? "The pull request is being opened."
              : landingWords(task),
      ]
        .filter((part) => part !== "")
        .join(" "),
      secondary: task.archived ? null : { kind: "archive", label: "Archive" },
    }
  }
  if (task.stage === "abandoned") {
    return {
      ...base,
      tone: "quiet",
      title: "Abandoned",
      text: "The documents stay in the repository and in search.",
    }
  }

  if (task.session === null) {
    return {
      ...base,
      tone: "quiet",
      title: "No agent session yet",
      text: `Start or continue it in your agent with: ${resumeCommand(task)}.`,
    }
  }

  // No word for over ten minutes: the session may have closed. The exact command that resumes it
  // is a card of its own under the line; a person can act on it, so the line is amber.
  if (now - heartbeat > QUIET_AFTER_MS) {
    const minutes = Math.max(1, Math.round((now - heartbeat) / 60_000))
    return {
      ...base,
      tone: "you",
      title: `No word from ${agent.name} for ${minutes} min`,
      text: "Its session may have closed.",
      resume: { command: resumeCommand(task), where },
    }
  }

  const waiting = task.session.state === "waiting"
  // Verify has turned to the person: they review the change (the final gate is not open yet).
  if (personVerify(task)) {
    const waitingItems = openCount(task.items ?? [], "verify")
    return {
      ...base,
      tone: "you",
      title: "Waits for your review",
      text:
        waitingItems > 0
          ? `${waitingItems} ${waitingItems === 1 ? "item needs" : "items need"} you before it ships.`
          : "Read the change and decide.",
    }
  }
  const verifying = task.stage === "verify"
  if (task.stage === "implement") {
    // Which slices run, said plainly; a comment the build picked up says after which task.
    const built = runningSlices(task)
    const runs =
      built.length === 0
        ? "The build is under way"
        : built.length === 1
          ? `Slice ${built[0]} runs`
          : `${slicesWords(built, true)} run side by side`
    const picked = (task.comments ?? [])
      .filter(
        (c) =>
          c.build !== undefined &&
          c.pickedAfter !== undefined &&
          now - (c.pickedAt ?? c.created) < 30 * 60_000,
      )
      .at(-1)
    return {
      ...base,
      title: "Agents are building",
      text:
        picked !== undefined
          ? `${runs}; your feedback was picked up after ${picked.pickedAfter}.`
          : `${runs}. Nothing needs you.`,
      progress: null,
    }
  }
  const helpers = (task.helpers ?? []).filter((h) => h.kind !== "review")
  // A helper that reported done is over: its card stays, but it is no longer counted at work.
  const atWork = helpers.filter((h) => h.state !== "done").length
  if (task.stage === "plan" && !waiting && atWork > 0) {
    return {
      ...base,
      title:
        atWork === 1
          ? "An agent that did not write it is reading the code"
          : `${atWork} agents that did not write it are reading the code`,
      text: "Each answers questions about the code as it is, with the files it read.",
      runs: helpers.map((h, i) =>
        runningRow(h, helpers.length > 1 ? `Agent ${i + 1}` : "Agent", h.line ?? "Starting…"),
      ),
    }
  }
  // A check failed and the agent fixes it: nothing is asked of you unless the second fix fails too.
  const failed = verifying ? (task.checklist?.failed ?? 0) : 0
  if (verifying && environmentBlockedChecks(task.checklist))
    return {
      ...base,
      title: "Waiting for the environment",
      text: "After the environment works, a fresh judge can re-check the blocked scenarios without another full run.",
      secondary: null,
    }
  if (failed > 0 && (task.checklist?.rounds ?? 0) > 0) {
    return {
      ...base,
      title: `Fixing ${failed} failed ${failed === 1 ? "check" : "checks"}`,
      text: `The agent writes a failing test and fixes the code, then checks ${failed === 1 ? "this point" : "these points"} and what the fix touched.`,
      secondary: null,
    }
  }
  // The security review goes before the checks: the line names it while it works.
  const fixing = verifying ? task.quality.find((r) => r.state === "fixing") : undefined
  if (fixing !== undefined) {
    return {
      ...base,
      title: `${agent.name} fixes what the Security review found`,
      text: "Each finding is fixed test first before the checks start. It goes on by itself.",
      secondary: null,
    }
  }
  const step = verifying
    ? task.quality.find((r) => r.state === "running" || r.state === "waiting")
    : undefined
  if (step !== undefined) {
    return {
      ...base,
      title: "Before checking · Security review",
      text: "An agent reads the finished change for what an attacker could use before the checks start. Nothing needs you yet.",
      secondary: null,
    }
  }
  if (verifying) {
    // The review of a change that crosses a trust boundary ran before the checks: the line says why.
    const reviewed = task.quality.some((r) => r.step === "security" && r.state === "done")
    return {
      ...base,
      title: "Agents are checking",
      text: reviewed
        ? "The change crosses a trust boundary, so a security review ran first."
        : "Checks and review cover every point. Nothing needs you yet.",
      secondary: null,
    }
  }
  const words: Partial<Record<Stage, [string, string]>> = {
    plan: [
      waiting ? `${agent.name} is waiting for your answer` : `${agent.name} is writing the Plan`,
      task.type === "bugfix"
        ? "Reproduction first, then the cause and the fix. Another agent reads it before your review."
        : "What you want, what done means, the decisions and the checks that prove them. Another agent reads it before your review.",
    ],
  }
  const [title, text] = words[task.stage] ?? [
    `${agent.name} is working`,
    "Its progress shows here as it goes.",
  ]
  // The agent asked and waits: the ball is with the user, nothing is running.
  return { ...base, tone: waiting ? "you" : "agent", title, text }
}

// ---------------------------------------------------------------- lists

export type Groups = {
  you: TaskSummary[]
  progress: TaskSummary[]
  shipped: TaskSummary[]
  archived: TaskSummary[]
}

export function filterTasks(tasks: TaskSummary[], project: string, agent: string): TaskSummary[] {
  return tasks.filter(
    (t) =>
      (project === "" || t.project === project) && (agent === "" || t.session?.agent === agent),
  )
}

/** A current question or native permission prompt needs the person, with no gate open. */
export function askingYou(task: TaskSummary, now = Date.now()): boolean {
  const gateOpen = task.gate !== null && !task.gate.settled
  const question = (task as Partial<TaskDetail>).question
  const pending =
    question !== undefined
      ? question !== null
      : task.batch != null
        ? task.batch.members.some((member) => member.answer === undefined)
        : task.live?.question != null
  const permission =
    task.live?.signals != null && livenessOf(task.live.signals, now).state === "permission"
  return !isClosed(task) && !gateOpen && (pending || permission)
}

/**
 * The ball is with the user: a gate or the Implement start waits, a decision waits to be
 * picked up, or the agent asked a question in the chat.
 */
export function needsYou(task: TaskSummary, now = Date.now()): boolean {
  if (isEarlier(task)) return false
  // The final approval is saved: applying it is nobody's wait, whichever step a recheck left the
  // task in and whether or not an agent is there. Only what came after the approval can wait.
  if (finalApproved(task) && !isClosed(task)) return askingYou(task, now)
  if (autonomous(task)) return task.action === "implement" || agentMissing(task)
  return (
    task.action !== null ||
    // Verify turned to the person (a question, their review, a recheck) or waits on their answer.
    task.stage === "verify" ||
    decidedGate(task) !== null ||
    askingYou(task, now) ||
    waitsOnItems(task) ||
    agentMissing(task) ||
    // A shipped task whose pull request holds a thread, a failing check or a fix to push, or whose
    // commits after the approval wait for Approve change.
    openWaits(task)
  )
}

/** The Plan (or a hand-back) holds items that wait for the person, though no gate is open yet. */
export function waitsOnItems(task: TaskSummary): boolean {
  return (task.openItems ?? 0) > 0 && !isClosed(task) && task.stage === "plan"
}

/** Which of the sidebar's three lists to show alone; empty shows all of them. */
export type Need = "" | "you" | "running" | "shipped"

/** What ⌘K narrows the task list to: a list, an agent, a project. All empty shows every task. */
export type TaskFilter = { need: Need; agent: string; project: string }

export const NEED_WORD: Record<Exclude<Need, "">, string> = {
  you: "Needs you",
  running: "Running",
  shipped: "Shipped",
}

export function groupTasks(
  tasks: TaskSummary[],
  project: string,
  agent = "",
  now = Date.now(),
): Groups {
  const all = filterTasks(tasks, project, agent)
  // An archived task leaves the working lists for a group of its own.
  const scoped = all.filter((t) => !t.archived)
  return {
    you: scoped.filter((t) => needsYou(t, now)),
    // An approved task is finished from the click on, its pull request open or not: nothing runs.
    progress: scoped.filter((t) => !needsYou(t, now) && !isClosed(t) && !finalApproved(t)),
    shipped: scoped.filter((t) =>
      isClosed(t) ? !staysOpen(t) : finalApproved(t) && !needsYou(t, now),
    ),
    archived: all.filter((t) => t.archived),
  }
}

// ---------------------------------------------------------------- what needs you

export type Notice = {
  key: string
  taskId: string
  view: string | null
  text: string
  task: string
  at: number
  tone: "you" | "bad"
  /** The command that resumes the task, for a task with no agent attached. */
  command?: string
  /** Feedback from people outside the team: Open goes to the Feedback panel. */
  comments?: boolean
}

/** What a task needs from you beyond its items: the step that has no items yet, a stop, no agent attached. */
export const NOTHING_TO_LOOK_AT = (words: string) =>
  `Nothing needs a closer look; read ${words} and approve.`

/** A build that started and has no agent on it: nothing will go on until one is attached. */
export function agentMissing(task: TaskSummary): boolean {
  return (
    task.session === null &&
    !isClosed(task) &&
    task.action === null &&
    (task.stage === "implement" || task.stage === "verify") &&
    task.progress !== null
  )
}

/**
 * What needs you that is not an item (yet): a gate with nothing to look at, a decision the agent
 * has not picked up, the Implement start, a stop, a task with no agent attached, and what outside
 * reviewers said. Home's Needs you lists these beside the items; oldest first within a task.
 */
export function notices(tasks: TaskSummary[]): Notice[] {
  const out: Notice[] = []
  for (const t of tasks) {
    if (isClosed(t)) continue
    const at = t.waitingSince ?? t.session?.since ?? t.created
    const pending = pendingGate(t)
    const items = t.openItems ?? 0
    const add = (
      n: Omit<Notice, "key" | "taskId" | "task" | "at" | "tone"> & {
        tone?: Notice["tone"]
        id: string
        at?: number
      },
    ) =>
      out.push({
        key: `${t.id}|${n.id}`,
        taskId: t.id,
        view: n.view,
        text: n.text,
        task: t.title,
        at: n.at ?? at,
        tone: n.tone ?? "you",
        ...(n.command !== undefined ? { command: n.command } : {}),
        ...(n.comments === true ? { comments: true } : {}),
      })
    if (pending !== null) {
      if (items === 0)
        add({
          id: `${pending}|${t.gate?.opened ?? 0}`,
          view: pending === "final" ? "verify" : pending,
          text: NOTHING_TO_LOOK_AT(
            pending === "final" ? "the change" : (docWords(pending) ?? "the document"),
          ),
          at: t.gate?.opened ?? at,
        })
    } else if (decidedGate(t) !== null && !agentWaiting(t) && !finalApproved(t)) {
      add({
        id: `continue|${t.gate?.opened ?? 0}`,
        view: null,
        text: "Decided; tell your agent to continue",
        command: resumeCommand(t),
      })
    } else if (t.action === "implement") {
      add({ id: "implement", view: "implement", text: "The Plan is approved. Start Implement." })
    } else if (askingYou(t) && items === 0 && t.handedBack === undefined) {
      add({
        id: "asking",
        view: null,
        text: `${agentInfo(t.session?.agent).name} asks you in the chat`,
      })
    }
    // An approved task misses no agent: nothing is left to go on with.
    if (agentMissing(t) && !finalApproved(t))
      add({
        id: "no-agent",
        view: null,
        text: "No agent is attached. Open a session and type the command to go on.",
        command: resumeCommand(t),
      })
  }
  return out.sort((a, b) => a.at - b.at)
}

/** One task's part of Needs you: its items, and what else needs you on it. */
export type NeedsGroup = {
  task: TaskSummary
  items: NeedItem[]
  notices: Notice[]
  /** When the oldest of it began to wait. */
  since: number
}

/**
 * The three steps as short bars: "d" for the ones passed, "n" for the one now (blue), "y" when the
 * task waits there for someone (amber), "" for the ones ahead. A shipped one has passed every step.
 */
export function trackBars(
  task: Pick<TaskSummary, "stage">,
  waiting: boolean,
): ("d" | "n" | "y" | "")[] {
  const here =
    task.stage === "shipped"
      ? FLOW_STEPS.length
      : Math.max(
          0,
          FLOW_STEPS.findIndex((step) => step.id === flowStepOf(task.stage)),
        )
  return FLOW_STEPS.map((_, i) => (i < here ? "d" : i === here ? (waiting ? "y" : "n") : ""))
}

/** The view a step's page lives at: where "Open" on one of its items goes. */
export function stepView(task: Filed, step: FlowStepId): string {
  switch (step) {
    case "plan":
      return fileOf(task, "plan")
    case "implement":
      return "checkpoint"
    case "verify":
      return "verify"
  }
}

/**
 * Home's Needs you: the items across tasks grouped by task, with what else needs each task, the
 * oldest wait first. Counts and the oldest wait feed the line under the heading.
 */
export function homeNeeds(
  tasks: TaskSummary[],
  now = Date.now(),
): { groups: NeedsGroup[]; items: number; oldest: number | null } {
  const waiting = tasks.filter((t) => needsYou(t, now))
  const all = notices(waiting)
  const groups = waiting
    .map((task): NeedsGroup => {
      const mine = all.filter((n) => n.taskId === task.id)
      const items = (task.needs ?? []).filter((i) => i.state === "open" || i.state === "chosen")
      const began = [task.waitingSince, task.gate?.opened, ...mine.map((n) => n.at)].filter(
        (v): v is number => typeof v === "number" && v > 0,
      )
      return {
        task,
        items,
        notices: mine,
        since: began.length > 0 ? Math.min(...began) : task.created,
      }
    })
    .filter((g) => g.items.length > 0 || g.notices.length > 0)
    .sort((a, b) => a.since - b.since)
  const items = groups.reduce((n, g) => n + g.items.length, 0) + all.length
  return { groups, items, oldest: groups.length > 0 ? (groups[0]?.since ?? null) : null }
}

/** One local task waiting for the person, counted by Home, the sidebar and the task-list toggle. */
export type ForYouItem = {
  key: string
  kind: "turn" | "task"
  /** The task's unchanged local identity. */
  task: string
  title: string
  step: FlowStepId
  since: number
  action: { label: string; route: Route }
  /** The own task behind a `turn` or `task`, with what else needs the member on it. */
  own: { task: TaskSummary; group: NeedsGroup | undefined }
  /** A recorded blocker in the existing, exactly bound App build session. */
  agentIssue?: { run: string; generation: number; reason: string }
  /** The item of the task to scroll to once it is open. */
  focus?: string
}

/** The step an own task's attention opens: the reached human step, else the task's own stage. */
function attentionStep(task: TaskSummary, group: NeedsGroup | undefined): FlowStepId {
  return (
    group?.items[0]?.step ??
    (task.action === "final"
      ? "verify"
      : task.action === "implement"
        ? "implement"
        : (flowStepOf(task.stage) ?? "plan"))
  )
}

/** Open the reached human step, falling back to the real workspace when its document is not written. */
function attentionTarget(task: TaskSummary, step: FlowStepId): Route {
  const file = task.files.find((file) => file.role === step && file.exists)
  return {
    view: "task",
    id: task.id,
    doc: step === "plan" ? (file?.name ?? null) : stepView(task, step),
  }
}

/** The words on an own task's action: Home's wording of what the member does there. */
function attentionLabel(task: TaskSummary): string {
  if ((task.action === "review" || task.action === "final") && !task.gate?.locked) return "Review"
  if (task.action === "implement") return "Start"
  return "Open"
}

/** Local questions, decisions, stopped agents and tasks without an agent, oldest first. */
export function forYouItems(input: { tasks: TaskSummary[]; shell: ShellGroups; now: number }): {
  items: ForYouItem[]
} {
  const { tasks, shell, now } = input
  const candidates = [
    ...new Map(
      [
        ...shell.you,
        ...groupTasks(tasks, "", "", now).you,
        ...shell.all.filter(
          (task) =>
            agentIdOf(task) === null &&
            !task.archived &&
            !task.handedBack &&
            !finalApproved(task) &&
            task.stage !== "shipped" &&
            task.stage !== "abandoned",
        ),
      ].map((task) => [task.id, task]),
    ).values(),
  ].sort((a, b) => (a.waitingSince ?? a.created) - (b.waitingSince ?? b.created))
  const needs = homeNeeds(candidates, now)

  const own = candidates.map((task): ForYouItem => {
    const group = needs.groups.find((g) => g.task.id === task.id)
    const step = attentionStep(task, group)
    const state = shellStatus(task, now).state
    const stuck = agentIdOf(task) === null || state === "stopped" || state === "waits-for-you"
    const first = group?.items[0]
    return {
      key: `task:${task.id}`,
      kind: stuck ? "task" : "turn",
      task: task.id,
      title: task.title,
      step,
      since: task.waitingSince ?? task.created,
      action: { label: attentionLabel(task), route: attentionTarget(task, step) },
      own: { task, group },
      ...(first ? { focus: first.id } : {}),
    }
  })

  return { items: own }
}

/** A Chat whose session the person ended (Stopped, Esc included): quiet, never Needs you, never Running. */
export const endedChat = (task: TaskSummary, now: number): boolean =>
  task.type === "chat" && liveRow(task, now)?.state === "stopped"

/**
 * What the agent's hooks report decides who has the move (Sessions design, States): Needs you and
 * Stopped early wait on the person, whatever the workflow status says; a Chat the person ended is
 * not theirs to answer. The one list Home, the sidebar's Home badge, the task-list toggle and the
 * Dock count.
 */
function withLiveAttention(shell: ShellGroups, now: number): ShellGroups {
  const waits = (task: TaskSummary) => {
    const state = liveRow(task, now)?.state
    // An approved task waits for no agent: one whose process ended after the approval is not a wait.
    return state === "needs" || (state === "stopped-early" && !finalApproved(task))
  }
  // An Esc'd Chat has the turn; only the workflow status calls its stopped agent a wait.
  const turn = (task: TaskSummary) =>
    task.type === "chat" &&
    liveRow(task, now)?.state === "turn" &&
    task.action === null &&
    task.live?.question == null &&
    (task.openItems ?? 0) === 0
  const ended = shell.open.filter((task) => endedChat(task, now))
  const turns = shell.you.filter(turn)
  const added = shell.open.filter((task) => waits(task) && !shell.you.includes(task))
  // A Chat's wait began at its live moment, whatever the task's own clock says.
  const moved = new Map<string, TaskSummary>()
  for (const task of shell.open) {
    // A build whose lead asks in its chat waits since its turn ended.
    const at =
      task.type === "chat" && waits(task)
        ? liveMoment(task, now)
        : asksInChat(task, now)
          ? (task.live?.signals?.end?.at ?? null)
          : null
    if (at !== null) moved.set(task.id, { ...task, waitingSince: at })
  }
  if (ended.length === 0 && added.length === 0 && turns.length === 0 && moved.size === 0)
    return shell
  const same = (list: TaskSummary[]) => list.map((task) => moved.get(task.id) ?? task)
  const leaving = [...ended, ...turns]
  const you = same([...shell.you.filter((task) => !leaving.includes(task)), ...added]).sort(
    (a, b) => (a.waitingSince ?? a.created) - (b.waitingSince ?? b.created),
  )
  const running = same([...shell.running.filter((task) => !added.includes(task)), ...leaving])
  return {
    ...shell,
    all: same(shell.all),
    open: same(shell.open),
    you,
    running,
    progress: running,
  }
}

/** When a Chat's live wait began: the permission's own moment, the stop, else the last hook before a question. */
function liveMoment(task: TaskSummary, now: number): number | null {
  const signals = task.live?.signals ?? null
  if (signals === null) return null
  const lv = livenessOf(signals, now)
  return lv.state === "permission" || lv.state === "stopped" ? lv.at : (signals.hook?.at ?? null)
}

/** One scoped attention list for Home, the sidebar badge and the task-list toggle. */
export function forYouIn(input: {
  tasks: TaskSummary[]
  project: string
  agent: string
  now: number
}) {
  const { tasks, project, agent, now } = input
  const shell = withLiveAttention(shellGroups(tasks, project, agent, now), now)
  return {
    shell,
    ...forYouItems({
      tasks: shell.all,
      shell,
      now,
    }),
  }
}

/**
 * Whether one task stands in Home's Needs you: the one answer Home, `qualitylayer status` and the
 * Claude Code band give, so the three never disagree.
 */
export function homeNeedsYou(task: TaskSummary, now = Date.now()): boolean {
  return forYouIn({ tasks: [task], project: "", agent: "", now }).items.length > 0
}

// ---------------------------------------------------------------- words

export function stageShort(task: TaskSummary): string {
  if (task.stage === "chat") return "Chat"
  if (isEarlier(task)) return "earlier workflow"
  if (task.handedBack !== undefined) return "handed back"
  if (task.action === "implement") return "Implement"
  // The notes you sent from your review are the agent's work: the task runs, and says what it does.
  if (personVerify(task) && notesWorking(task)) return "changes"
  if (fixingVerify(task)) return "fixing"
  if (task.stage === "implement" && task.progress !== null) {
    return `Implement ${task.progress.checked}/${task.progress.total}`
  }
  if (task.stage === "verify") return "Verify"
  if (task.stage === "shipped") return task.closing?.shipped ?? "shipped"
  const words: Partial<Record<Stage, string>> = {
    plan: "Plan",
    implement: "Implement",
    abandoned: "abandoned",
  }
  return words[task.stage] ?? task.stage
}

/** How a member is called in the team's lists: a first name, or an email's part before the @. */
export function firstName(name: string): string {
  const flat = name.trim()
  return (flat.includes("@") ? flat.split("@")[0] : flat.split(/\s+/)[0]) ?? flat
}

/** The two letters of an avatar: Max Ritter → MR; an email gives the first two of its name. */
export function initialsOf(name: string): string {
  const flat = name.trim()
  if (flat === "") return "?"
  const words = flat.includes("@")
    ? [(flat.split("@")[0] ?? "").replace(/[^A-Za-z0-9]/g, "")]
    : flat.split(/\s+/)
  const letters =
    words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : (words[0] ?? "").slice(0, 2)
  return letters.toUpperCase() || "?"
}

const TEAM_STAGE: Record<string, string> = {
  shipped: "Shipped",
  abandoned: "Abandoned",
}

/**
 * The stage of a shared task in a word, for lists and filters: one of the steps.
 */
export function teamStageWord(stage: string): string {
  const fixed = TEAM_STAGE[stage]
  if (fixed !== undefined) return fixed
  const step = flowStepOf(stage)
  return step !== null ? stepLabel(step) : stage
}

/**
 * Everything that makes a task need you again, as one string: its stage and
 * action, the gate that is open (when it first opened: a gate the user
 * answered opens at a new time, one that only waited keeps its own), and the question the agent is
 * asking in the chat (since when). Two looks at the task list that give
 * the same moment have nothing new to say.
 */
export function momentOf(task: TaskSummary, now = Date.now()): string {
  const gate =
    task.gate !== null && task.gate.decision === "pending" && !task.gate.settled
      ? `${task.gate.target}@${task.gate.opened}`
      : ""
  const asking = askingYou(task, now) ? String(task.session?.since ?? 0) : ""
  return [task.stage, task.action ?? "", gate, asking].join(":")
}

/** "1 item needs you" / "4 items need you", with what they wait before. */
const needLine = (n: number, before: string) =>
  `${n} ${n === 1 ? "item needs" : "items need"} you before ${before}.`

/**
 * The system notifications a change in the task list deserves, in the step line's words (rule 6):
 * a Plan or a review that waits ("Settings cleanup: Plan ready", "… needs your review"), a task
 * that stopped, a task that shipped. Never agent progress, the Implement start or a question in
 * the chat. The "needs you" switch covers the first two, the "finished" switch a shipped task.
 * `before` and `now` hold `momentOf` for each task, so a task notifies once per change.
 */
export function notificationsFor(
  before: Map<string, string>,
  now: Map<string, string>,
  tasks: TaskSummary[],
  on: { gateOpened: boolean; taskFinished: boolean },
): { title: string; body: string }[] {
  const out: { title: string; body: string }[] = []
  for (const task of tasks) {
    if (before.get(task.id) === now.get(task.id)) continue
    const items = task.openItems ?? 0
    if (on.gateOpened && task.action === "review") {
      out.push({
        title: `${task.title}: ${(docWords(task.gate?.target ?? "") ?? "the document").replace(/^the /, "").replace(/^./, (c) => c.toUpperCase())} ready`,
        body:
          items > 0
            ? needLine(items, "the build starts")
            : "Read it and approve to start the build.",
      })
    } else if (on.gateOpened && task.action === "final") {
      out.push({
        title: `${task.title} needs your review`,
        body: [
          task.iterations > 0 ? "Every check passed." : "",
          items > 0 ? needLine(items, "it ships") : "Read the change and approve.",
        ]
          .filter(Boolean)
          .join(" "),
      })
    } else if (on.taskFinished && task.stage === "shipped") {
      out.push({
        title: `${task.title} ${shippedWord(task).toLowerCase()}`,
        body: task.closing?.how !== undefined ? `${task.closing.how}.` : `${shippedWord(task)}.`,
      })
    }
  }
  return out
}
