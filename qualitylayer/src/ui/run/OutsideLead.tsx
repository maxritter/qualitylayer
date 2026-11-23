import { HistoryIcon } from "lucide-react"
import { type ReactNode, useCallback, useEffect, useState } from "react"
import { isNativeAgent } from "../../core/agents/ids.ts"
import type { TaskDetail } from "../api.ts"
import { useNow } from "../hooks.ts"
import { AgentMark } from "../kit/marks/index.ts"
import { useOptionalRuns } from "../run-context.tsx"
import { runColors } from "../runs-api.ts"
import type { AgentTabTerminal } from "./AgentTab.tsx"
import { ExistingPlanContext } from "./ExistingPlanContext.tsx"
import { OutsideConversation, type OutsideQuestionStatus } from "./OutsideConversation.tsx"
import {
  ContinueButton,
  OutsideLeadActions,
  OutsideStatusCard,
  outsideHeading,
  outsideLeadLine,
} from "./OutsideLeadParts.tsx"
import {
  agentWord,
  approvedWay,
  isOutsideResumable,
  type OutsideLeadRecord,
  outsideApprovalReady,
  outsideAsks,
  outsideStatusOf,
} from "./outside-lead-status.ts"
import "./outside-lead.css"

export { agentWord, outsideApprovalReady, outsideAsks }

function useOutsideResume({
  task,
  lead,
  name,
  canResumeNow,
}: {
  task: TaskDetail
  lead: OutsideLeadRecord
  name: string
  canResumeNow: boolean
}) {
  const runs = useOptionalRuns()
  const [resuming, setResuming] = useState<"idle" | "busy" | "failed">("idle")
  const [problem, setProblem] = useState<string>()
  const resumable = isOutsideResumable(task, lead, runs?.support?.canStart === true)

  useEffect(() => {
    if (!canResumeNow || !resumable || resuming !== "idle") return
    if (!runs || !lead.agent || !isNativeAgent(lead.agent) || !lead.sessionId) return
    setResuming("busy")
    setProblem(undefined)
    void runs
      .start({
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
      .catch((cause) => {
        setResuming("failed")
        setProblem(
          cause instanceof Error ? cause.message : `${name}’s conversation could not resume here.`,
        )
      })
  }, [
    canResumeNow,
    resumable,
    resuming,
    runs,
    lead.agent,
    lead.folder,
    lead.sessionId,
    task.id,
    name,
  ])

  return { resumable, resuming, setResuming, problem }
}

function useContinueRequest(taskId: string) {
  const [continuing, setContinuing] = useState(() => continueAsked.delete(taskId))
  useEffect(() => {
    const listener = (id: string) => {
      if (id === taskId) setContinuing(true)
    }
    continueListeners.add(listener)
    return () => {
      continueListeners.delete(listener)
    }
  }, [taskId])
  return [continuing, setContinuing] as const
}

function OutsideLeadExtras({
  task,
  lead,
  name,
  problem,
  planning,
  onQuestion,
}: {
  task: TaskDetail
  lead: OutsideLeadRecord
  name: string
  problem: string | undefined
  planning?: { label: string; open: () => void }
  onQuestion(status: OutsideQuestionStatus): void
}) {
  return (
    <>
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
          onQuestion={onQuestion}
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
    </>
  )
}

function OutsideContinueFallback({
  problem,
  continueHere,
  name,
  onBack,
}: {
  problem: string | undefined
  continueHere: ReactNode
  name: string
  onBack: () => void
}) {
  return (
    <div className="q-outside-lead" data-testid="outside-continue">
      {problem ? (
        <p role="alert" className="q-run-error">
          {problem} Start a fresh session here instead.
        </p>
      ) : null}
      {continueHere}
      <button type="button" className="q-link" onClick={onBack}>
        Back to {name}’s status
      </button>
    </div>
  )
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
  planning?: { label: string; open: () => void }
  continueHere?: ReactNode
}) {
  const lead = task.outside as OutsideLeadRecord
  const now = useNow(true, 5000)
  const [continuing, setContinuing] = useContinueRequest(task.id)
  const name = agentWord(lead.agent)
  const [questionStatus, setQuestionStatus] = useState<OutsideQuestionStatus>()
  const noteQuestion = useCallback((current: OutsideQuestionStatus) => {
    setQuestionStatus((prior) =>
      prior?.session === current.session && prior.pending === current.pending ? prior : current,
    )
  }, [])
  const nativeQuestion =
    questionStatus?.pending === true && questionStatus.session === lead.sessionId
  const status = outsideStatusOf(task, lead, now, nativeQuestion)
  const pageAsks = status.kind === "waiting" && task.question != null
  const statusLine = pageAsks
    ? status.line.replace("or continue it here", "or on the page")
    : status.line
  const approval = outsideApprovalReady(task)
  const chosen = approval ? null : approvedWay(task, lead)
  const stopped = status.kind === "stopped"
  const canContinueStopped = continuing && !approval && stopped
  const { resumable, resuming, setResuming, problem } = useOutsideResume({
    task,
    lead,
    name,
    canResumeNow: canContinueStopped,
  })
  const fallbackToLaunch = !resumable || (resuming === "failed" && task.type !== "chat")
  if (canContinueStopped && continueHere && fallbackToLaunch) {
    return (
      <OutsideContinueFallback
        problem={problem}
        continueHere={continueHere}
        name={name}
        onBack={() => setContinuing(false)}
      />
    )
  }
  const waitingToContinue = continuing && !stopped && !approval && !pageAsks
  const asked =
    status.kind === "waiting" &&
    !chosen &&
    (task.stage !== "chat" || nativeQuestion || outsideAsks(task))
  const continueNode =
    continueHere && !approval && !pageAsks ? (
      <ContinueButton
        name={name}
        stopped={stopped}
        asked={asked}
        continuing={continuing}
        busy={resuming === "busy"}
        onContinue={() => {
          setResuming("idle")
          setContinuing(true)
        }}
        onCancel={() => setContinuing(false)}
      />
    ) : null
  return (
    <div className="q-outside-lead" data-testid="outside-lead" data-state={status.kind}>
      <header className="q-outside-head">
        <AgentMark agent={lead.agent ?? "other"} size={18} />
        <h2>{outsideHeading(task, lead, name, Boolean(approval || chosen), stopped)}</h2>
      </header>
      <p className="q-outside-lead-line">
        {outsideLeadLine({ task, lead, name, approval, chosenLead: chosen?.lead, stopped })}
      </p>
      <ExistingPlanContext task={task} />
      <OutsideStatusCard
        task={task}
        lead={lead}
        name={name}
        now={now}
        status={status}
        statusLine={statusLine}
        chosen={chosen}
      />
      <OutsideLeadActions
        continueNode={continueNode}
        waitingToContinue={waitingToContinue}
        terminal={terminal}
      />
      <OutsideLeadExtras
        task={task}
        lead={lead}
        name={name}
        problem={problem}
        planning={planning}
        onQuestion={noteQuestion}
      />
    </div>
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
  return ({ runs, open }) => {
    const link = planningLink(runs, open)
    return (
      <OutsideLead
        key={task.id}
        task={task}
        {...(terminal ? { terminal } : {})}
        {...(link ? { planning: link } : {})}
        continueHere={launch}
      />
    )
  }
}
