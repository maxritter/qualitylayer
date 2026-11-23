// Model: app-model/agent-switch.html#agent-switch
import { ArrowRightLeftIcon, LoaderCircleIcon } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { type Config, DEFAULT_CONFIG } from "../../core/config-values.ts"
import { agentName } from "../../core/live/liveness.ts"
import { permissionChoices } from "../agent-window/conversation/footer-values.ts"
import type { SubagentModels, TaskDetail } from "../api.ts"
import { AgentMark } from "../kit/marks/index.ts"
import { type RunWindow, useRuns } from "../run-context.tsx"
import { type AgentLaunchValue, availableLaunchAgents } from "./AgentLaunchFields.tsx"
import { AgentSwitchFormBody, isAgentSwitchReady, SwitchFolder } from "./AgentSwitchBody.tsx"
import { taskAgentDefaults, taskPlanningLaunch } from "./task-launch.ts"
import { useAgentSwitchRunner } from "./useAgentSwitchRunner.ts"
import "./agent-switch.css"

const ended = (run: RunWindow) => run.status === "stopped" || run.status === "failed"

export function AgentSwitchButton({ onClick }: { onClick(): void }) {
  return (
    <button
      type="button"
      className="q-run-ib"
      aria-label="Continue in another agent"
      title="Continue in another agent"
      onClick={onClick}
    >
      <ArrowRightLeftIcon size={15} aria-hidden="true" />
    </button>
  )
}

export function StoppedAgentSwitch({
  run,
  onSwitch,
  onHistory,
}: {
  run: RunWindow
  onSwitch(): void
  onHistory(): void
}) {
  const runs = useRuns()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const resume = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await runs.control(run.id, { action: "resume", mode: "continue", generation: run.generation })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The previous session could not resume. Try again.",
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="q-switch-ended" data-testid="agent-switch-ended">
      <h2>
        <AgentMark agent={run.agent} size={18} />
        {agentName(run.agent)} stopped
      </h2>
      <p>Your task, draft and current work are kept.</p>
      {run.error ? <p role="alert">{run.error}</p> : null}
      <SwitchFolder path={run.cwd} />
      <button type="button" className="q-btn primary" disabled={busy} onClick={onSwitch}>
        Continue in another agent…
      </button>
      <div className="q-switch-ended-links">
        {run.nativeSession && run.canResume ? (
          <button type="button" className="q-lnk" disabled={busy} onClick={() => void resume()}>
            Resume previous session
          </button>
        ) : null}
        <button type="button" className="q-lnk" disabled={busy} onClick={onHistory}>
          Read previous conversation
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  )
}

function switchLeadText(previousAgent: RunWindow["agent"], active: boolean, planning: boolean) {
  const name = agentName(previousAgent)
  if (active) return `${name} is still working. Stop its session before a replacement starts.`
  if (planning) return `${name} has stopped. Continue planning with another installed agent.`
  return `${name} has stopped. Continue the approved work with another installed agent.`
}

function SwitchDialogFooter({
  phase,
  active,
  agent,
  ready,
  startButton,
  onClose,
  onStart,
}: {
  phase: "choose" | "stopping" | "starting"
  active: boolean
  agent: AgentLaunchValue["agent"]
  ready: boolean
  startButton: React.RefObject<HTMLButtonElement | null>
  onClose(): void
  onStart(): void
}) {
  const busy = phase !== "choose"
  const actionLabel =
    phase === "starting"
      ? `Starting ${agentName(agent)}…`
      : `${active ? "Stop & continue with" : "Continue with"} ${agentName(agent)}`
  return (
    <footer className="q-switch-actions">
      <button type="button" className="q-btn" disabled={phase === "starting"} onClick={onClose}>
        Cancel
      </button>
      {phase !== "stopping" ? (
        <button
          type="button"
          className="q-btn primary"
          ref={startButton}
          disabled={!ready || busy}
          onClick={onStart}
        >
          {actionLabel}
        </button>
      ) : null}
    </footer>
  )
}

export function AgentSwitchDialog({
  task,
  previous,
  config,
  installed,
  onClose,
  onStarted,
}: {
  task: TaskDetail
  previous: RunWindow
  config: Config | null
  installed: SubagentModels[] | null | undefined
  onClose(): void
  onStarted(): void
}) {
  const runs = useRuns()
  const saved = config ?? DEFAULT_CONFIG
  const [value, setValue] = useState<AgentLaunchValue>(() => {
    const agent =
      availableLaunchAgents(installed).find((one) => one !== previous.agent) ?? previous.agent
    return { agent, ...taskAgentDefaults(task, saved, agent), runWhere: "app" }
  })
  const [permission, setPermission] = useState("own")
  const [confirmed, setConfirmed] = useState(false)
  const permissionField = useRef<HTMLDivElement>(null)
  const permissionConfirm = useRef<HTMLFieldSetElement>(null)
  const startButton = useRef<HTMLButtonElement>(null)
  const leadId = useId()
  const runner = useAgentSwitchRunner({ runs, task, previous, onStarted, onClose })
  const current = runs.runs.find((run) => run.id === previous.id)
  const available =
    current?.generation === previous.generation && current.nativeSession === previous.nativeSession
  const active = !ended(current ?? previous)
  const planning = taskPlanningLaunch(task)
  const modes = permissionChoices(value.agent)
  const bypass = modes.find((mode) => mode.id === permission)?.bypass === true
  useEffect(() => {
    if (bypass && !confirmed) {
      permissionConfirm.current?.focus()
      permissionConfirm.current?.scrollIntoView({ block: "nearest" })
    } else if (confirmed) {
      startButton.current?.focus()
    }
  }, [bypass, confirmed])
  const ready = isAgentSwitchReady({
    config,
    installed,
    available,
    canStart: runs.support?.supported === true && runs.support?.canStart === true,
    agent: value.agent,
    previousAgent: previous.agent,
    bypass,
    confirmed,
  })
  const change = (patch: Partial<AgentLaunchValue>) => {
    setValue((now) => ({
      ...now,
      ...patch,
      ...(patch.agent ? taskAgentDefaults(task, saved, patch.agent) : {}),
    }))
    if (patch.agent) {
      setPermission("own")
      setConfirmed(false)
    }
    runner.setError(undefined)
  }
  const triggerStart = () => void runner.start({ ready, value, permission, bypass, confirmed })
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) runner.close()
      }}
    >
      <DialogContent
        className="q-agent-switch-dialog"
        aria-describedby={leadId}
        showCloseButton={runner.phase !== "starting"}
      >
        <DialogHeader>
          <DialogTitle>
            {active ? "Stop and continue in another agent" : "Continue in another agent"}
          </DialogTitle>
        </DialogHeader>
        <section className="q-switch-choice" data-testid="agent-switch-dialog">
          <p className="q-switch-task">{task.title}</p>
          <p id={leadId} className="q-switch-lead">
            {switchLeadText(previous.agent, active, planning)}
          </p>
          {runner.phase === "stopping" ? (
            <div className="q-switch-stopping" role="status">
              <LoaderCircleIcon size={16} className="animate-spin" aria-hidden="true" />
              <b>Waiting for {agentName(previous.agent)} to stop</b>
              <p>No replacement starts until the current session has ended.</p>
            </div>
          ) : (
            <AgentSwitchFormBody
              task={task}
              previous={previous}
              saved={saved}
              value={value}
              installed={installed}
              supported={runs.support?.supported === true}
              canConfigure={runs.support?.canConfigure === true}
              busy={runner.phase !== "choose"}
              planning={planning}
              modes={modes}
              permission={permission}
              bypass={bypass}
              confirmed={confirmed}
              available={available}
              ready={ready}
              error={runner.error}
              permissionField={permissionField}
              permissionConfirm={permissionConfirm}
              onChange={change}
              onPermission={(next) => {
                setPermission(next)
                setConfirmed(false)
              }}
              onConfirmBypass={() => setConfirmed(true)}
              onCancelBypass={() => {
                setPermission("own")
                permissionField.current
                  ?.querySelector<HTMLButtonElement>('[role="combobox"]')
                  ?.focus()
              }}
              onRetry={triggerStart}
            />
          )}
        </section>
        <SwitchDialogFooter
          phase={runner.phase}
          active={active}
          agent={value.agent}
          ready={ready}
          startButton={startButton}
          onClose={runner.close}
          onStart={triggerStart}
        />
      </DialogContent>
    </Dialog>
  )
}
