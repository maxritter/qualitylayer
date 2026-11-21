import { AppWindowIcon, HistoryIcon, SquareTerminalIcon } from "lucide-react"
import { type ReactNode, useCallback, useEffect, useState } from "react"
import { AGENT_NAMES, isNativeAgent } from "../../core/agents/ids.ts"
import { NAMES } from "../../core/docs/names.ts"
import { FLOW_STEPS, flowStepOf } from "../../core/flow.ts"
import { shellStatus } from "../../core/interaction-shell/status.ts"
import { agoShort, livenessOf } from "../../core/live/liveness.ts"
import type { TaskDetail } from "../api.ts"
import { useNow } from "../hooks.ts"
import { AgentMark } from "../kit/marks/index.ts"
import { useOptionalRuns } from "../run-context.tsx"
import { runColors } from "../runs-api.ts"
import { VerifyActivityTimeline, verifyPause } from "../shell/VerifyActivity.tsx"
import type { AgentTabTerminal } from "./AgentTab.tsx"
import { taskApprovalReady } from "./approval-ready.ts"
import { ExistingPlanContext } from "./ExistingPlanContext.tsx"
import { OutsideConversation, type OutsideQuestionStatus } from "./OutsideConversation.tsx"
import "./outside-lead.css"

/** A stage's step name: a shipped task stands on Verify, a stage outside the three keeps its own word. */
const stepLabel = (stage: string): string =>
  FLOW_STEPS.find((step) => step.id === flowStepOf(stage))?.label ?? stage

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })

/** The agent's name in the person's words. */
export const agentWord = (agent: string | null | undefined): string =>
  agent && isNativeAgent(agent) ? AGENT_NAMES[agent] : "Your agent"

type Lead = NonNullable<TaskDetail["outside"]>

/** A workflow decision in the App does not move the session that prepared it. */
export const outsideApprovalReady = (task: TaskDetail) =>
  task.outside ? taskApprovalReady(task) : null

/** The slice the build is in: the progress report's, else the first slice with a task still open. */
function sliceOf(task: TaskDetail): { at: number; of: number } | null {
  const progress = task.live?.progress
  if (progress?.slice != null && typeof progress.slices === "number")
    return { at: progress.slice.at, of: progress.slices }
  const slices = task.slices ?? []
  const at = slices.findIndex((s) => s.tasks.some((t) => !t.checked))
  return at < 0 ? null : { at: at + 1, of: slices.length }
}

/** Whether the outside session waits at a question or a gate in its window (the card reads "Answer here instead"). */
export function outsideAsks(task: TaskDetail): boolean {
  if (task.outside === undefined) return false
  if (task.stage !== "chat") return shellStatus(task).state === "waits-for-you"
  const ask = task.live?.signals?.ask
  return task.question != null || (ask?.alive === true && ask.waiting)
}

/**
 * The way the person chose to build with the approval, from the task's start record (`where: "here"`
 * and optionally `compact`): the three ways in the words of the approved design. Null before the Plan
 * is approved or once the planner has moved on to Implement.
 */
function approvedWay(task: TaskDetail, lead: Lead) {
  const gate = task.gate
  if (
    lead.phase !== "planning" ||
    task.stage !== "plan" ||
    gate?.target !== NAMES.plan ||
    gate.decision !== "approved"
  )
    return null
  const name = agentWord(lead.agent)
  // The person's route for this planner (Build in that session), recorded before the approval.
  const route = task.start?.route === true ? task.start : undefined
  if (route?.where === "here" && route.compact === true)
    return {
      kind: "waiting" as const,
      word: "Approved · build here, from the Plan",
      line: `Run your compact command in ${name}, then say “build here”.`,
      lead: `The Plan is approved. Compact ${name}, then say “build here”: it builds from the Plan’s files.`,
    }
  if (route?.where === "here")
    return {
      kind: "working" as const,
      word: "Approved · keeping this conversation",
      line: "The same conversation builds it next.",
      lead: `The Plan is approved. ${name} builds it in the same conversation.`,
    }
  return {
    kind: "waiting" as const,
    word: `Approved · ${name} shows the ways to build, outside the App`,
    line: "Build here, from the Plan · Keep this conversation · Another session or agent",
    lead: `The Plan is approved. ${name} asks you where to build, outside the App.`,
  }
}

function outsideIdleStatus(
  task: TaskDetail,
  name: string,
  life: ReturnType<typeof livenessOf> | { state: "none" },
  now: number,
  nativeQuestion: boolean,
) {
  const verifying = task.stage === "verify"
  const chat = task.stage === "chat"
  if ((verifying || chat) && life.state === "permission")
    return {
      kind: "waiting" as const,
      word: "Permission needed",
      line: `Allow or refuse it in ${name}'s own window.`,
    }
  const outsideTurn = !verifying && !chat && life.state === "turn-end"
  // The top bar uses the same signals to distinguish a question from a paused Verify run.
  const waits = chat
    ? nativeQuestion || outsideAsks(task)
    : shellStatus(task, now).state === "waits-for-you"
  if (outsideTurn || life.state === "permission" || waits) {
    const asked = task.live?.question?.text
    const requestedAt = life.state === "turn-end" || life.state === "permission" ? life.at : null
    const continuation = "Answer it there, or continue it here."
    return {
      kind: "waiting" as const,
      word: asked ? `${name} asks: ${asked}` : `${name} waits for you outside the App`,
      line: requestedAt === null ? continuation : `Since ${clock(requestedAt)}. ${continuation}`,
    }
  }
  if (chat && life.state === "turn-end")
    return { kind: "quiet" as const, word: "No active turn", line: "" }
  const pause = verifyPause(task, now)
  if (pause) return { kind: "quiet" as const, word: pause.title, line: pause.detail }
  if (life.state !== "quiet") return null
  return {
    kind: "quiet" as const,
    word: `Quiet for ${agoShort(life.quietFor)}`,
    line: life.last ? `Last: ${life.last.words}` : "",
  }
}

/** Where its live signals put the outside session: its mark, its words, one line under them. */
function statusOf(task: TaskDetail, lead: Lead, now: number, nativeQuestion: boolean) {
  const name = agentWord(lead.agent)
  const approval = outsideApprovalReady(task)
  if (approval)
    return {
      kind: "waiting" as const,
      word: `Ready for your ${approval}`,
      line: "Approve or give feedback here or in your own agent. The agent stays outside the App.",
    }
  const approved = approvedWay(task, lead)
  if (approved) return approved
  const signals = task.live?.signals ?? null
  const life = signals !== null ? livenessOf(signals, now) : { state: "none" as const }
  const words = task.live?.progress?.words
  const progress = words?.place || undefined
  if (life.state === "stopped")
    return {
      kind: "stopped" as const,
      word: `Stopped at ${clock(life.at)}`,
      line: "The work so far is kept.",
    }
  const idle = outsideIdleStatus(task, name, life, now, nativeQuestion)
  if (idle) return idle
  const last = life.state === "working" ? life.last : null
  // What it runs now says more than which file last grew.
  const tool = signals?.tool ?? null
  return {
    kind: "working" as const,
    word: "Working",
    line:
      progress ??
      (tool
        ? `${tool.words} · ${agoShort(now - tool.at)} ago`
        : last
          ? `${last.words.replace(/^tool hook: /, "")} · ${agoShort(now - last.at)} ago`
          : ""),
  }
}

/**
 * The Agent tab while the task's lead runs outside the App (planned or built in the person's own
 * terminal, app or IDE): where it runs, its live status and latest workflow events, Continue it here,
 * a plain terminal and the planning conversation as history. The App cannot interrupt or stop a
 * session it does not run, so none of those controls appear here.
 */
export function OutsideLead({
  task,
  terminal,
  planning,
  continueHere,
}: {
  task: TaskDetail
  terminal?: AgentTabTerminal
  /** The App's planning conversation, read-only, with who planned it and how it ended. */
  planning?: { label: string; open: () => void }
  /** The launch card that continues the build here, drawn once the outside session has stopped. */
  continueHere?: ReactNode
}) {
  const lead = task.outside as Lead
  const now = useNow(true, 5000)
  // A Continue it here asked while the Agent tab was not open waits here for it.
  const [continuing, setContinuing] = useState(() => continueAsked.delete(task.id))
  useEffect(() => {
    const listener = (id: string) => {
      if (id === task.id) setContinuing(true)
    }
    continueListeners.add(listener)
    return () => {
      continueListeners.delete(listener)
    }
  }, [task.id])
  const name = agentWord(lead.agent)
  const [questionStatus, setQuestionStatus] = useState<OutsideQuestionStatus>()
  const noteQuestion = useCallback((current: OutsideQuestionStatus) => {
    setQuestionStatus((prior) =>
      prior?.session === current.session && prior.pending === current.pending ? prior : current,
    )
  }, [])
  const nativeQuestion =
    questionStatus?.pending === true && questionStatus.session === lead.sessionId
  const status = statusOf(task, lead, now, nativeQuestion)
  // A question waits in the terminal: the page's own card holds Answer here instead, so this card
  // is the session's status and events only (DESIGN.md › One fact, one place).
  const pageAsks = status.kind === "waiting" && task.question != null
  const statusLine = pageAsks
    ? status.line.replace("or continue it here", "or on the page")
    : status.line
  const approval = outsideApprovalReady(task)
  const chosen = approval ? null : approvedWay(task, lead)
  const stopped = status.kind === "stopped"
  const waitingToContinue = continuing && !stopped && !approval && !pageAsks
  const building = lead.phase === "building"
  const slice = building && task.stage === "implement" ? sliceOf(task) : null
  // The outside session's own conversation resumes here when its agent can resume it.
  const runs = useOptionalRuns()
  const [resuming, setResuming] = useState<"idle" | "busy" | "failed">("idle")
  const [problem, setProblem] = useState<string>()
  const resumable =
    (building || task.type === "chat") &&
    lead.agent !== null &&
    isNativeAgent(lead.agent) &&
    lead.sessionId !== null &&
    runs?.support?.canStart === true
  const resume = async () => {
    if (!runs || !lead.agent || !isNativeAgent(lead.agent) || !lead.sessionId) return
    setResuming("busy")
    setProblem(undefined)
    try {
      await runs.start({
        agent: lead.agent,
        purpose: { kind: "task", task: task.id },
        cwd: lead.folder,
        works: "checkout",
        mode: "plain",
        settings: { answers: "app" },
        resumeNative: lead.sessionId,
        idempotencyKey: `resume:${task.id}:${lead.sessionId}`,
        colors: runColors(),
      })
    } catch (cause) {
      setResuming("failed")
      setProblem(
        cause instanceof Error ? cause.message : `${name}’s conversation could not resume here.`,
      )
    }
  }
  // Waiting for the outside session to stop: once it has, it continues here by itself.
  useEffect(() => {
    if (!approval && continuing && stopped && resumable && resuming === "idle") void resume()
  })
  if (
    continuing &&
    !approval &&
    stopped &&
    continueHere &&
    (!resumable || (resuming === "failed" && task.type !== "chat"))
  )
    return (
      <div className="q-outside-lead" data-testid="outside-continue">
        {problem ? (
          <p role="alert" className="q-run-error">
            {problem} Start a fresh session here instead.
          </p>
        ) : null}
        {continueHere}
        <button type="button" className="q-link" onClick={() => setContinuing(false)}>
          Back to {name}’s status
        </button>
      </div>
    )
  const continueNode =
    continueHere && !approval && !pageAsks ? (
      <ContinueButton
        name={name}
        stopped={stopped}
        asked={
          status.kind === "waiting" &&
          !chosen &&
          (task.stage !== "chat" || nativeQuestion || outsideAsks(task))
        }
        continuing={continuing}
        busy={resuming === "busy"}
        onContinue={() => {
          setResuming("idle")
          setContinuing(true)
        }}
        onCancel={() => setContinuing(false)}
      />
    ) : null
  let action = building ? "Building" : "Planning"
  if (task.stage === "verify") action = "Verifying"
  if (task.type === "chat") action = "Chatting"
  return (
    <div className="q-outside-lead" data-testid="outside-lead" data-state={status.kind}>
      <header className="q-outside-head">
        <AgentMark agent={lead.agent ?? "other"} size={18} />
        <h2>
          {approval || chosen
            ? `${name} outside the App`
            : stopped
              ? `${name} stopped outside the App`
              : `${action} in ${name} outside the App`}
        </h2>
      </header>
      <p className="q-outside-lead-line">
        {approval
          ? `The ${approval} is ready for your decision. This session stays outside the App.`
          : chosen
            ? chosen.lead
            : stopped
              ? `Continue here, or start ${name} again in your own agent.`
              : task.type === "chat" && lead.agent === "claude-code"
                ? "Claude Code’s questions can be answered here. Its history and progress show below."
                : `${name} asks and waits outside the App. Its progress shows here.`}
      </p>
      <ExistingPlanContext task={task} />
      <section className={`q-outside-card ${status.kind}`} aria-label="Status outside the App">
        <div className="q-outside-now" role="status">
          <i className={`q-outside-mark ${status.kind}`} aria-hidden="true" />
          <span>
            <b>{status.word}</b>
            {statusLine ? <small>{statusLine}</small> : null}
          </span>
        </div>
        <dl className="q-outside-facts">
          <dt>Step</dt>
          <dd>
            {stepLabel(chosen ? "implement" : task.stage)}
            {slice !== null ? ` · slice ${slice.at} of ${slice.of}` : ""}
          </dd>
          <dt>Runs in</dt>
          <dd>Your own agent · {name}</dd>
          {building && task.planned ? (
            <>
              <dt>Planned</dt>
              <dd>
                In {agentWord(task.planned.agent)} ·{" "}
                {task.planned.where === "app" ? "App" : "your own agent"}
              </dd>
            </>
          ) : null}
          <dt>Folder</dt>
          <dd>
            <code title={lead.folder}>{lead.folder}</code>
          </dd>
        </dl>
        {task.stage === "verify" ? (
          <VerifyActivityTimeline task={task} now={now} />
        ) : lead.events.length > 0 ? (
          <ol className="q-outside-events" aria-label="Latest events">
            {lead.events.map((event) => (
              <li key={`${event.at}:${event.what}`}>
                <time dateTime={new Date(event.at).toISOString()}>{clock(event.at)}</time>
                <b>{event.what}</b>
              </li>
            ))}
          </ol>
        ) : null}
      </section>
      {waitingToContinue ? continueNode : null}
      {(continueNode && !waitingToContinue) || terminal ? (
        // One row: Continue it here beside the plain terminal. The class also keeps the Dock's focus hand-off to a new terminal.
        <fieldset
          className="q-agent-tab-links q-outside-lead-actions"
          aria-label="Ways to continue"
        >
          {waitingToContinue ? null : continueNode}
          {terminal ? (
            <button type="button" className="q-agent-tab-link" onClick={terminal.open}>
              <SquareTerminalIcon size={14} aria-hidden="true" />
              {terminal.live ? "Return to the plain terminal" : "Open a plain terminal"}
            </button>
          ) : null}
        </fieldset>
      ) : null}
      {problem && task.type === "chat" ? (
        <p role="alert" className="q-run-error">
          {problem}
        </p>
      ) : null}
      {task.type === "chat" && lead.agent && isNativeAgent(lead.agent) ? (
        <OutsideConversation
          key={lead.sessionId}
          task={task}
          lead={{ ...lead, agent: lead.agent }}
          name={name}
          onQuestion={noteQuestion}
        />
      ) : null}
      {planning ? (
        <fieldset className="q-agent-tab-links" aria-label="Other ways to work">
          <button type="button" className="q-agent-tab-link" onClick={planning.open}>
            <HistoryIcon size={14} aria-hidden="true" />
            Planning conversation
            <small>{planning.label}</small>
          </button>
        </fieldset>
      ) : null}
    </div>
  )
}

/** Continue it here: one agent builds at a time, so it waits for the outside session to stop first. */
function ContinueButton({
  name,
  stopped,
  asked = false,
  continuing,
  busy = false,
  onContinue,
  onCancel,
}: {
  name: string
  stopped: boolean
  /** A question waits in the terminal: the same action reads as the question card's own. */
  asked?: boolean
  continuing: boolean
  busy?: boolean
  onContinue: () => void
  onCancel: () => void
}) {
  if (continuing && !stopped)
    return (
      <div className="q-outside-wait" role="status" data-testid="outside-wait">
        <p>
          <i className="q-outside-mark working" aria-hidden="true" />
          Waiting for {name} to stop. Stop it where it runs (Ctrl+C in a terminal); then it
          continues here.
        </p>
        <button type="button" className="q-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    )
  return (
    <button
      type="button"
      className={`q-btn${stopped ? " primary" : ""} q-outside-continue`}
      disabled={busy}
      onClick={onContinue}
    >
      <AppWindowIcon size={14} aria-hidden="true" />
      {busy ? `Resuming ${name} here…` : asked ? "Answer here instead" : "Continue it here"}
    </button>
  )
}

const continueListeners = new Set<(task: string) => void>()
/** Tasks whose Continue it here was asked while no outside view was drawn. */
const continueAsked = new Set<string>()
/**
 * Continue it here from the session menu or the Implement page's stopped card: the Agent tab's
 * outside view takes it as its own button's click, and the Agent tab opens to show it.
 */
export function continueOutsideLead(task: string): void {
  if (continueListeners.size === 0) continueAsked.add(task)
  document.getElementById("rs-tab-terminal")?.click()
  for (const listener of [...continueListeners]) listener(task)
}

type PlanningRun = {
  id: string
  agent: string
  status: string
  purpose: { kind: string; phase?: string }
}

/** The App's planning conversation among a task's earlier ones, and how its tab link names it. */
export function planningLink(
  runs: readonly PlanningRun[],
  open: (id: string) => void,
): { label: string; open: () => void } | undefined {
  const planner = runs.find(
    (run) =>
      run.purpose.kind === "new-task" ||
      (run.purpose.kind === "task" && run.purpose.phase === "planning"),
  )
  if (planner === undefined) return undefined
  const live = ["validated", "starting", "running", "stopping"].includes(planner.status)
  return {
    label: `${agentWord(planner.agent)} · ${live ? "closing" : "finished"}`,
    open: () => open(planner.id),
  }
}

/**
 * The Agent tab's view without a lead session: the launch card, or, while the task's lead runs
 * outside the App, that lead with the launch card behind Continue it here.
 */
export function taskAgentEmpty(
  task: TaskDetail,
  launch: ReactNode,
  terminal?: AgentTabTerminal,
): ReactNode | ((history: { runs: PlanningRun[]; open: (id: string) => void }) => ReactNode) {
  if (task.outside === undefined) return launch
  return ({ runs, open }) => (
    <OutsideLead
      key={task.id}
      task={task}
      {...(terminal ? { terminal } : {})}
      {...(planningLink(runs, open) ? { planning: planningLink(runs, open) } : {})}
      continueHere={launch}
    />
  )
}
