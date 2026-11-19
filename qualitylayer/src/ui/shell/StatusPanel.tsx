import { ChevronRightIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { FLOW_STEPS, flowStepOf } from "../../core/flow.ts"
import { limitWords, SHELL_GUIDANCE_MS } from "../../core/interaction-shell/status.ts"
import { agentName, agoShort, livenessOf } from "../../core/live/liveness.ts"
import { runPermissionWaiting } from "../../core/run/contracts.ts"
import type { AgentStatus, BackgroundAgent, ShellSnapshot } from "../../interaction/contracts.ts"
import { chooseWindowView } from "../agent-window/conversation/view-choice.ts"
import { useTerminalLayout } from "../agent-window/layout.tsx"
import type { TaskDetail } from "../api.ts"
import { WhoMark } from "../kit/WhoMark.tsx"
import { ReportThis } from "../ReportThis.tsx"
import { type RunWindow, useOptionalRuns } from "../run-context.tsx"
import { cancelLimitResume, runTaskId } from "../runs-api.ts"
import { VerifyActivityTimeline, verifyPause } from "./VerifyActivity.tsx"

import "./status-panel.css"

/** A helper's row name, as production StatusPanel words it. */
function roleLabel(agent: BackgroundAgent): string {
  if (agent.role === "plan-review") return "Plan · reviewed by a second reader"
  const role =
    agent.role === "other" ? "Agent" : agent.role.charAt(0).toUpperCase() + agent.role.slice(1)
  return `${role} · ${agent.subject}`
}

const sentence = (words: string) => (words ? words.charAt(0).toUpperCase() + words.slice(1) : words)

/**
 * Cancel the resume QualityLayer planned after the plan limit resets. The next poll of the task
 * then shows the session held, with the command that continues it.
 */
function CancelResume({ run }: { run: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle")
  const [failure, setFailure] = useState<string | null>(null)
  // Cancelled: the button goes at once; the next poll shows the command that continues the session.
  if (state === "done") return null
  return (
    <div className="sc-actions" data-testid="limit-resume">
      <button
        type="button"
        className="q-btn sm"
        disabled={state === "busy"}
        onClick={() => {
          setState("busy")
          setFailure(null)
          cancelLimitResume(run).then(
            () => setState("done"),
            (cause: unknown) => {
              setState("idle")
              setFailure(
                cause instanceof Error ? cause.message : "The resume could not be cancelled.",
              )
            },
          )
        }}
      >
        Cancel resume
      </button>
      {failure !== null ? (
        <span className="sc-meta" role="alert">
          {failure}
        </span>
      ) : null}
    </div>
  )
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

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
  const s = shell.status as AgentStatus
  const leadTerminal = observedRun
    ? terminals.find(
        (run) =>
          run.id === observedRun.id &&
          run.generation === observedRun.generation &&
          run.nativeSession === observedRun.nativeSession,
      )
    : s.agent && s.signals?.sessionId
      ? terminals.find((run) => run.agent === s.agent && run.nativeSession === s.signals?.sessionId)
      : undefined
  const otherTerminals = terminals.filter((run) => run !== leadTerminal)
  const name = agentName(s.agent)
  const helpersNow = shell.agents.filter((agent) => agent.state === "running")
  const life = s.signals ? livenessOf(s.signals, now) : null
  const ago = (at: number) => agoShort(Math.max(0, now - at))
  const age = s.lastActivity === null ? null : Math.max(0, now - s.lastActivity)
  const clock = (at: number) =>
    new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  const step =
    task.stage === "chat"
      ? "Chat"
      : (FLOW_STEPS.find((one) => one.id === flowStepOf(task.stage))?.label ?? task.stage)
  const observation =
    s.state === "working" || s.state === "quiet"
      ? s.signals?.tool?.words ||
        (s.signals?.hook?.event !== "SessionEnd" ? s.signals?.hook?.words : null) ||
        null
      : null
  const activity = observation || s.doing
  const stopped = s.state === "stopped"
  const permission =
    !stopped &&
    (life?.state === "permission" || (leadTerminal && runPermissionWaiting(leadTerminal)))
  const turnEnd =
    !stopped && s.state !== "step-done" && s.state !== "waits-for-you" && life?.state === "turn-end"
      ? life
      : null
  const waits = permission || s.state === "waits-for-you"
  const pause = stopped || waits || s.state === "step-done" ? null : verifyPause(task, now)

  // The one line of what happens now, and at most one line under it.
  let headline: string
  let detail: string | null = null
  // Held by its plan limit (core/limits): the reason, when it resets, and the way on.
  const limit = stopped || (task.stage === "verify" && waits) ? null : (s.signals?.limit ?? null)
  if (limit !== null) {
    headline = `${name} hit its usage limit`
    detail = limitWords(limit, now).line
  } else if (stopped)
    headline = s.signals?.stoppedAt == null ? "Stopped" : `Stopped at ${clock(s.signals.stoppedAt)}`
  else if (permission) {
    headline = task.stage === "verify" ? "Permission needed" : "Asks for your permission"
    detail = leadTerminal
      ? leadTerminal.terminalPrompt === "permission"
        ? "Allow or refuse it in its terminal."
        : "Allow or deny it in Conversation."
      : `Allow or refuse it in ${name}'s own window.`
  } else if (pause) {
    headline = pause.title
    detail = pause.detail
  } else if (s.state === "waits-for-you" || s.state === "step-done") headline = sentence(s.doing)
  else if (helpersNow.length > 0) {
    headline = `${plural(helpersNow.length, "helper")} working`
    detail = helpersNow.find((helper) => helper.doing)?.doing ?? sentence(s.doing)
  } else if (turnEnd) headline = `Turn ended ${ago(turnEnd.at)} ago`
  else if (s.state === "quiet") {
    headline = `Quiet for ${agoShort(age ?? 0)}`
    detail =
      age !== null && age >= SHELL_GUIDANCE_MS
        ? `Last: ${activity}. Look in its window for a prompt, a long command or an error.`
        : `Last: ${activity}`
  } else headline = observation || sentence(s.doing)
  // "No App session" is the launch card's to say; only a fact the person can act on stays here.
  const meta = [!stopped && s.signals?.process === "unknown" ? "Process not known" : null].filter(
    (one) => one !== null,
  )

  const terminalButton = (run: RunWindow, primary = false) => (
    <button
      type="button"
      className={`q-btn sm${primary ? " primary" : ""}`}
      onClick={() => {
        chooseWindowView(run.id, "terminal")
        if (terminalLayout) terminalLayout.openRun(run.id)
        else windows?.select(run.id)
        terminalLayout?.setPanel("terminal")
        onClose?.()
      }}
    >
      Open {agentName(run.agent)} terminal
    </button>
  )
  const terminalState = (run: RunWindow) => {
    if (run.status === "failed") return "Failed to start"
    if (run.status === "stopped") return "Stopped"
    if (run.status === "stopping") return "Stopping"
    if (run.status === "running") return "Running"
    return "Starting"
  }
  const purpose = (run: RunWindow) =>
    run.purpose.kind === "new-task"
      ? run.purpose.type === "chat"
        ? "Chat"
        : "Planning"
      : run.purpose.kind === "task"
        ? task.type === "chat"
          ? "Chat"
          : "Build"
        : "Team question"

  // A check that waits for the task's check lock runs no command yet.
  const running = task.checkProgress?.filter((row) => row.running && !row.queued) ?? []
  const refusal = task.live?.refusal ?? null
  // A second refusal in a row is the person's (core/live/record.ts); a first is the agent's to fix.
  const escalated = task.stage !== "verify" && refusal !== null && refusal.count >= 2
  const helpers = [
    ...helpersNow,
    ...shell.agents.filter((a) => ["queued", "quiet", "awaiting-commit"].includes(a.state)),
    ...shell.agents.filter((a) => ["done", "failed", "stopped"].includes(a.state)),
  ]
  const failedOthers = otherTerminals.filter((run) => run.status === "failed").length
  const liveOthers = otherTerminals.length - failedOthers
  const summary = [
    refusal !== null && !escalated ? `${refusal.lead} ${ago(refusal.at)} ago` : null,
    failedOthers > 0 ? `${plural(failedOthers, "other session")} failed to start` : null,
    helpersNow.length > 0 ? `${plural(helpersNow.length, "helper")} active` : null,
    liveOthers > 0 ? plural(liveOthers, "other session") : null,
  ].filter((one) => one !== null)
  const turnAge = turnEnd ? agoShort(Math.max(0, now - turnEnd.at)) : null

  return (
    <div className="ir-status-panel compact-status" data-testid="status-panel-body">
      <div className="ir-status-scroll" data-testid="status-panel-scroll">
        <header className="sc-head">
          <WhoMark
            who={
              stopped
                ? "halt"
                : waits
                  ? "you"
                  : s.state === "step-done"
                    ? "done"
                    : pause
                      ? "todo"
                      : "agent"
            }
            running={
              !stopped &&
              !waits &&
              (helpersNow.length > 0 || (s.state === "working" && life?.state === "working"))
            }
          />
          <b>{name}</b>
          <span className="sc-role">Lead · {step}</span>
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
          <p className="sc-line">{headline}</p>
          {detail !== null ? <p className="sc-detail">{detail}</p> : null}
          {meta.length > 0 ? <p className="sc-meta">{meta.join(" · ")}</p> : null}
          {running.map((check) => (
            <div key={check.check} className="sc-check" data-testid="check-progress">
              {check.files.total !== null ? (
                <div
                  className="q-bar"
                  role="progressbar"
                  aria-label="Test files completed"
                  aria-valuemin={0}
                  aria-valuemax={check.files.total}
                  aria-valuenow={check.files.done}
                >
                  <i
                    style={{
                      width: `${check.files.total ? (100 * check.files.done) / check.files.total : 0}%`,
                    }}
                  />
                </div>
              ) : null}
              <p>
                {check.files.total !== null
                  ? `${check.files.done} of ${check.files.total} test files · `
                  : `Check command ${check.i} of ${check.of} · `}
                {check.files.total !== null ? (
                  <>
                    <span className={check.failed ? "sc-failed" : undefined}>
                      {check.failed} failed
                    </span>
                    {" · "}
                  </>
                ) : null}
                {ago(check.started)}
              </p>
            </div>
          ))}
          {s.openItems > 0 ? (
            <p className="sc-you">
              <WhoMark who="you" />
              <span>
                {s.openItems} open for you{s.blocked ? " · it waits on them" : ""}
              </span>
            </p>
          ) : null}
          {escalated ? (
            <div
              className="sc-you sc-escalated"
              id="recorded-refusal"
              data-testid="recorded-refusal"
            >
              <WhoMark who="you" />
              <div>
                <b>{refusal.lead} twice · needs you</b>
                <p>{refusal.words}</p>
                <ReportThis error={`${refusal.lead}: ${refusal.words}`} />
              </div>
            </div>
          ) : null}
          {limit?.resumeAt != null && limit.run != null ? <CancelResume run={limit.run} /> : null}
          {s.resume !== null || leadTerminal ? (
            <div className="sc-actions" data-testid={leadTerminal ? "lead-terminal" : undefined}>
              {s.resume !== null ? (
                <div className="q-cmdline">
                  <code>{s.resume}</code>
                  <button
                    type="button"
                    className="q-link"
                    onClick={() => onCopy(s.resume ?? "", "Copied. Paste it into your agent.")}
                  >
                    Copy
                  </button>
                </div>
              ) : null}
              {leadTerminal ? terminalButton(leadTerminal, waits || turnEnd !== null) : null}
            </div>
          ) : null}
        </div>
        <VerifyActivityTimeline task={task} now={now} />
        <details className="sc-more" id="agent-details" data-testid="agent-details">
          <summary>
            <ChevronRightIcon size={14} aria-hidden="true" className="sc-chev" />
            <span>{summary.length > 0 ? summary.join(" · ") : "Session details"}</span>
          </summary>
          <dl className="sc-facts">
            <dt>Lead since</dt>
            <dd>{s.since === null ? "Not known" : clock(s.since)}</dd>
            <dt>Process</dt>
            <dd>
              {s.signals?.process === "alive"
                ? "Running"
                : s.signals?.process === "gone"
                  ? "Stopped · your answers are kept"
                  : "Not known"}
            </dd>
            {age !== null && agoShort(age) !== turnAge ? (
              <>
                <dt>Last activity</dt>
                <dd>{agoShort(age)} ago</dd>
              </>
            ) : null}
          </dl>
          {refusal !== null && !escalated ? (
            <div className="sc-group" id="recorded-refusal" data-testid="recorded-refusal">
              <b>
                {refusal.lead} <small>{ago(refusal.at)} ago</small>
              </b>
              <p>{refusal.words}</p>
              {s.openItems === 0 && !s.blocked ? (
                <p className="sc-note">Recorded for the agent to fix; nothing for you to answer.</p>
              ) : null}
              <ReportThis error={`${refusal.lead}: ${refusal.words}`} />
            </div>
          ) : null}
          {otherTerminals.length > 0 ? (
            <div className="sc-group" data-testid="other-app-sessions">
              <span className="sc-label">Other App sessions</span>
              {otherTerminals.map((run) => (
                <div key={run.id} className="sc-session">
                  <span>
                    {purpose(run)} · {terminalState(run)}
                  </span>
                  {terminalButton(run)}
                </div>
              ))}
            </div>
          ) : null}
          {helpers.length > 0 ? (
            <div className="sc-group" data-testid="helper-history">
              <span className="sc-label">Helpers</span>
              {helpers.map((a) => (
                <div className="ir-agent-row" key={a.id}>
                  <WhoMark
                    who={a.state === "done" ? "done" : "agent"}
                    running={a.state === "running"}
                  />
                  <b>{roleLabel(a)}</b>
                  <small>
                    {a.state === "done"
                      ? `done${a.ended === null ? "" : ` ${clock(a.ended)}`}`
                      : a.state === "running" && a.started !== null
                        ? agoShort(now - a.started)
                        : a.state === "queued"
                          ? "allocated"
                          : a.state}
                  </small>
                  {a.doing !== null && a.doing !== a.subject ? <p>{a.doing}</p> : null}
                </div>
              ))}
            </div>
          ) : null}
        </details>
      </div>
    </div>
  )
}
