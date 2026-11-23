import { XIcon } from "lucide-react"
import { agentName, agoShort, livenessOf } from "../../core/live/liveness.ts"
import { runPermissionWaiting } from "../../core/run/contracts.ts"
import type { AgentStatus, ShellSnapshot } from "../../interaction/contracts.ts"
import { chooseWindowView } from "../agent-window/conversation/view-choice.ts"
import { useTerminalLayout } from "../agent-window/layout.tsx"
import type { TaskDetail } from "../api.ts"
import { WhoMark } from "../kit/WhoMark.tsx"
import { ReportThis } from "../ReportThis.tsx"
import { type RunWindow, useOptionalRuns } from "../run-context.tsx"
import { runTaskId } from "../runs-api.ts"
import {
  CancelResume,
  RunningChecks,
  StatusDetailsFold,
  TerminalButton,
} from "./StatusPanelSections.tsx"
import {
  findLeadTerminal,
  formatAgo,
  leadMarkWho,
  observationOf,
  orderedHelpers,
  plural,
  resolveStatusHeadline,
  stepLabelOf,
} from "./status-panel-model.ts"
import { VerifyActivityTimeline, verifyPause } from "./VerifyActivity.tsx"

import "./status-panel.css"

function buildSummaryItems({
  refusal,
  escalated,
  otherTerminals,
  helpersNowCount,
  now,
}: {
  refusal: NonNullable<TaskDetail["live"]>["refusal"] | null
  escalated: boolean
  otherTerminals: RunWindow[]
  helpersNowCount: number
  now: number
}) {
  const failedOthers = otherTerminals.filter((run) => run.status === "failed").length
  const liveOthers = otherTerminals.length - failedOthers
  return [
    refusal !== null && !escalated ? `${refusal.lead} ${formatAgo(now, refusal.at)} ago` : null,
    failedOthers > 0 ? `${plural(failedOthers, "other session")} failed to start` : null,
    helpersNowCount > 0 ? `${plural(helpersNowCount, "helper")} active` : null,
    liveOthers > 0 ? plural(liveOthers, "other session") : null,
  ].filter((one): one is string => one !== null)
}

function ResumeActions({
  resume,
  leadTerminal,
  primaryTerminal,
  onCopy,
  onOpenTerminal,
}: {
  resume: string | null
  leadTerminal: RunWindow | undefined
  primaryTerminal: boolean
  onCopy: (text: string, note: string) => void
  onOpenTerminal: (run: RunWindow) => void
}) {
  if (resume === null && !leadTerminal) return null
  return (
    <div className="sc-actions" data-testid={leadTerminal ? "lead-terminal" : undefined}>
      {resume !== null ? (
        <div className="q-cmdline">
          <code>{resume}</code>
          <button
            type="button"
            className="q-link"
            onClick={() => onCopy(resume, "Copied. Paste it into your agent.")}
          >
            Copy
          </button>
        </div>
      ) : null}
      {leadTerminal ? (
        <TerminalButton run={leadTerminal} primary={primaryTerminal} onOpen={onOpenTerminal} />
      ) : null}
    </div>
  )
}

function deriveStatusState({
  task,
  shell,
  now,
  terminals,
  observedRun,
}: {
  task: TaskDetail
  shell: ShellSnapshot
  now: number
  terminals: RunWindow[]
  observedRun?: Pick<RunWindow, "id" | "generation" | "nativeSession">
}) {
  const s = shell.status as AgentStatus
  const leadTerminal = findLeadTerminal(terminals, s, observedRun)
  const otherTerminals = terminals.filter((run) => run !== leadTerminal)
  const name = agentName(s.agent)
  const helpersNow = shell.agents.filter((agent) => agent.state === "running")
  const life = s.signals ? livenessOf(s.signals, now) : null
  const age = s.lastActivity === null ? null : Math.max(0, now - s.lastActivity)
  const stopped = s.state === "stopped"
  const permission =
    !stopped &&
    Boolean(life?.state === "permission" || (leadTerminal && runPermissionWaiting(leadTerminal)))
  const activeTurn = !stopped && s.state !== "step-done" && s.state !== "waits-for-you"
  const turnEnd = activeTurn && life?.state === "turn-end" ? life : null
  const waits = permission || s.state === "waits-for-you"
  const pause = stopped || waits || s.state === "step-done" ? null : verifyPause(task, now)
  const limit = stopped || (task.stage === "verify" && waits) ? null : (s.signals?.limit ?? null)
  const { headline, detail } = resolveStatusHeadline({
    status: s,
    task,
    name,
    now,
    limit,
    permission,
    leadTerminal,
    pause,
    helpersNow,
    turnEnd,
    age,
    observation: observationOf(s),
  })
  const refusal = task.live?.refusal ?? null
  const escalated = task.stage !== "verify" && refusal !== null && refusal.count >= 2
  return {
    s,
    leadTerminal,
    otherTerminals,
    name,
    age,
    stopped,
    waits,
    pause,
    turnEnd,
    limit,
    headline,
    detail,
    meta: !stopped && s.signals?.process === "unknown" ? ["Process not known"] : [],
    runningChecks: task.checkProgress?.filter((row) => row.running && !row.queued) ?? [],
    refusal,
    escalated,
    helpers: orderedHelpers(shell.agents, helpersNow),
    summary: buildSummaryItems({
      refusal,
      escalated,
      otherTerminals,
      helpersNowCount: helpersNow.length,
      now,
    }),
    turnAge: turnEnd ? agoShort(Math.max(0, now - turnEnd.at)) : null,
    isRunning:
      !stopped &&
      !waits &&
      (helpersNow.length > 0 || (s.state === "working" && life?.state === "working")),
  }
}

/**
 * Current lead activity stays visible. Session facts, a first refusal, other sessions and helpers
 * remain behind one fold.
 */
export function StatusPanel({
  task,
  shell,
  now,
  onCopy,
  onClose,
  observedRun,
}: {
  task: TaskDetail
  shell: ShellSnapshot
  now: number
  onCopy: (text: string, note: string) => void
  /** Cost is the header's own button; the panel carries no link to it (callers may still pass one). */
  onClose?: () => void
  observedRun?: Pick<RunWindow, "id" | "generation" | "nativeSession">
}) {
  const windows = useOptionalRuns()
  const terminalLayout = useTerminalLayout()
  const terminals = windows?.runs.filter((run) => runTaskId(run) === task.id) ?? []
  const view = deriveStatusState({ task, shell, now, terminals, observedRun })
  const openTerminal = (run: RunWindow) => {
    chooseWindowView(run.id, "terminal")
    if (terminalLayout) terminalLayout.openRun(run.id)
    else windows?.select(run.id)
    terminalLayout?.setPanel("terminal")
    onClose?.()
  }

  return (
    <div className="ir-status-panel compact-status" data-testid="status-panel-body">
      <div className="ir-status-scroll" data-testid="status-panel-scroll">
        <header className="sc-head">
          <WhoMark
            who={leadMarkWho({
              stopped: view.stopped,
              waits: view.waits,
              stepDone: view.s.state === "step-done",
              paused: view.pause !== null,
            })}
            running={view.isRunning}
          />
          <b>{view.name}</b>
          <span className="sc-role">Lead · {stepLabelOf(task.stage)}</span>
          {onClose ? (
            <button
              type="button"
              className="q-link ir-status-close"
              aria-label="Close agent activity"
              onClick={onClose}
            >
              <XIcon size={16} aria-hidden="true" />
            </button>
          ) : null}
        </header>
        <div className="sc-now" id="agent-now" data-testid="agent-now">
          <p className="sc-line">{view.headline}</p>
          {view.detail !== null ? <p className="sc-detail">{view.detail}</p> : null}
          {view.meta.length > 0 ? <p className="sc-meta">{view.meta.join(" · ")}</p> : null}
          <RunningChecks checks={view.runningChecks} now={now} />
          {view.s.openItems > 0 ? (
            <p className="sc-you">
              <WhoMark who="you" />
              <span>
                {view.s.openItems} open for you{view.s.blocked ? " · it waits on them" : ""}
              </span>
            </p>
          ) : null}
          {view.escalated && view.refusal !== null ? (
            <div
              className="sc-you sc-escalated"
              id="recorded-refusal"
              data-testid="recorded-refusal"
            >
              <WhoMark who="you" />
              <div>
                <b>{view.refusal.lead} twice · needs you</b>
                <p>{view.refusal.words}</p>
                <ReportThis error={`${view.refusal.lead}: ${view.refusal.words}`} />
              </div>
            </div>
          ) : null}
          {view.limit?.resumeAt != null && view.limit.run != null ? (
            <CancelResume run={view.limit.run} />
          ) : null}
          <ResumeActions
            resume={view.s.resume}
            leadTerminal={view.leadTerminal}
            primaryTerminal={view.waits || view.turnEnd !== null}
            onCopy={onCopy}
            onOpenTerminal={openTerminal}
          />
        </div>
        <VerifyActivityTimeline task={task} now={now} />
        <StatusDetailsFold
          status={view.s}
          task={task}
          now={now}
          age={view.age}
          turnAge={view.turnAge}
          refusal={view.refusal}
          escalated={view.escalated}
          otherTerminals={view.otherTerminals}
          helpers={view.helpers}
          summary={view.summary}
          onOpenTerminal={openTerminal}
        />
      </div>
    </div>
  )
}
