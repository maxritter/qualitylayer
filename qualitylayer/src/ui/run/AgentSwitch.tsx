// Model: app-model/agent-switch.html#agent-switch
import { ArrowRightLeftIcon, ClipboardCheckIcon, FolderIcon, LoaderCircleIcon } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { type Config, DEFAULT_CONFIG } from "../../core/config-values.ts"
import { agentName } from "../../core/live/liveness.ts"
import { permissionChoices } from "../agent-window/conversation/footer-values.ts"
import type { SubagentModels, TaskDetail } from "../api.ts"
import { AgentMark } from "../kit/marks/index.ts"
import { ModelPick } from "../ModelPick.tsx"
import { type RunWindow, useRuns } from "../run-context.tsx"
import { runColors } from "../runs-api.ts"
import {
  AgentLaunchFields,
  type AgentLaunchValue,
  availableLaunchAgents,
  launchAgentAvailable,
} from "./AgentLaunchFields.tsx"
import { continueInAnotherAgent } from "./agent-switch.ts"
import { taskAgentDefaults, taskAgentRequest, taskPlanningLaunch } from "./task-launch.ts"
import "./agent-switch.css"

const ended = (run: RunWindow) => run.status === "stopped" || run.status === "failed"

function SwitchFolder({ path }: { path: string }) {
  const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
  return (
    <div className="q-switch-folder" title={path}>
      <FolderIcon size={14} aria-hidden="true" />
      <b>{name}</b>
      <code>{path}</code>
    </div>
  )
}

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
      availableLaunchAgents(installed).find((agent) => agent !== previous.agent) ?? previous.agent
    return { agent, ...taskAgentDefaults(task, saved, agent), runWhere: "app" }
  })
  const [permission, setPermission] = useState("own")
  const [confirmed, setConfirmed] = useState(false)
  const [phase, setPhase] = useState<"choose" | "stopping" | "starting">("choose")
  const [error, setError] = useState<string>()
  const operation = useRef<{ cancelled: boolean; starting: boolean } | undefined>(undefined)
  const permissionField = useRef<HTMLDivElement>(null)
  const permissionConfirm = useRef<HTMLFieldSetElement>(null)
  const startButton = useRef<HTMLButtonElement>(null)
  const leadId = useId()
  const attempt = useRef({ key: "", id: "" })
  const current = runs.runs.find((run) => run.id === previous.id)
  const available =
    current?.generation === previous.generation && current.nativeSession === previous.nativeSession
  const active = !ended(current ?? previous)
  const planning = taskPlanningLaunch(task)
  const modes = permissionChoices(value.agent)
  const bypass = modes.find((mode) => mode.id === permission)?.bypass === true
  const busy = phase !== "choose"
  useEffect(() => {
    if (bypass && !confirmed) {
      permissionConfirm.current?.focus()
      permissionConfirm.current?.scrollIntoView({ block: "nearest" })
    } else if (confirmed) startButton.current?.focus()
  }, [bypass, confirmed])
  const ready =
    config !== null &&
    installed != null &&
    available &&
    runs.support?.supported === true &&
    runs.support?.canStart === true &&
    value.agent !== previous.agent &&
    value.agent !== "other" &&
    launchAgentAvailable(value.agent, installed) &&
    (!bypass || confirmed)
  useEffect(
    () => () => {
      if (operation.current) operation.current.cancelled = true
    },
    [],
  )
  const close = () => {
    if (operation.current?.starting) return
    if (operation.current) operation.current.cancelled = true
    onClose()
  }
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
    setError(undefined)
  }
  const start = async () => {
    if (!ready || busy || (operation.current && !operation.current.cancelled)) return
    const state = { cancelled: false, starting: false }
    operation.current = state
    const launch = taskAgentRequest(task, value)
    const request = {
      ...launch,
      cwd: previous.cwd,
      settings: {
        ...launch.settings,
        ...(permission === "own" ? { perm: "own" as const } : { permMode: permission }),
      },
      ...(bypass ? { confirmBypass: confirmed } : {}),
    }
    const key = JSON.stringify(request)
    if (attempt.current.key !== key) attempt.current = { key, id: crypto.randomUUID() }
    setPhase("stopping")
    setError(undefined)
    try {
      const next = await continueInAnotherAgent({
        previous,
        request: { ...request, idempotencyKey: attempt.current.id, colors: runColors() },
        control: runs.control,
        start: runs.start,
        cancelled: () => state.cancelled,
        onStarting: () => {
          state.starting = true
          setPhase("starting")
        },
      })
      if (next && !state.cancelled) {
        onStarted()
        onClose()
      }
    } catch (cause) {
      if (!state.cancelled)
        setError(
          cause instanceof Error
            ? cause.message
            : "The new conversation could not start. Your choices are kept.",
        )
    } finally {
      const wasCancelled = state.cancelled
      state.starting = false
      state.cancelled = true
      if (!wasCancelled) setPhase("choose")
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      <DialogContent
        className="q-agent-switch-dialog"
        aria-describedby={leadId}
        showCloseButton={phase !== "starting"}
      >
        <DialogHeader>
          <DialogTitle>
            {active ? "Stop and continue in another agent" : "Continue in another agent"}
          </DialogTitle>
        </DialogHeader>
        <section className="q-switch-choice" data-testid="agent-switch-dialog">
          <p className="q-switch-task">{task.title}</p>
          <p id={leadId} className="q-switch-lead">
            {active
              ? `${agentName(previous.agent)} is still working. Stop its session before a replacement starts.`
              : planning
                ? `${agentName(previous.agent)} has stopped. Continue planning with another installed agent.`
                : `${agentName(previous.agent)} has stopped. Continue the approved work with another installed agent.`}
          </p>
          {phase === "stopping" ? (
            <div className="q-switch-stopping" role="status">
              <LoaderCircleIcon size={16} className="animate-spin" aria-hidden="true" />
              <b>Waiting for {agentName(previous.agent)} to stop</b>
              <p>No replacement starts until the current session has ended.</p>
            </div>
          ) : (
            <>
              <AgentLaunchFields
                scope="Continue task"
                value={value}
                defaultModel={taskAgentDefaults(task, saved, value.agent).model}
                onChange={change}
                installed={installed}
                supported={runs.support?.supported === true}
                disabled={busy}
                nativeOnly
                location={false}
                canConfigure={runs.support?.canConfigure === true}
              />
              {value.agent === previous.agent ? (
                <p className="q-switch-validation">
                  Choose a different agent, or Cancel to resume the previous conversation.
                </p>
              ) : null}
              {modes.length ? (
                <div className="q-switch-permission" ref={permissionField}>
                  <span>Permissions</span>
                  <ModelPick
                    label="New conversation permissions"
                    value={permission}
                    options={modes.map((mode) => ({ id: mode.id, name: mode.label }))}
                    onChange={(next) => {
                      setPermission(next)
                      setConfirmed(false)
                    }}
                    disabled={busy || runs.support?.canConfigure !== true}
                  />
                </div>
              ) : (
                <p className="q-switch-note">
                  This agent's native settings control its permissions.
                </p>
              )}
              {bypass && !confirmed ? (
                <fieldset
                  className="cv-permission-confirm"
                  ref={permissionConfirm}
                  tabIndex={-1}
                  aria-label="Confirm new conversation permissions"
                >
                  <b>Use {modes.find((mode) => mode.id === permission)?.label}?</b>
                  <p>This new conversation skips the agent's normal permission checks.</p>
                  <div className="q-switch-ended-links">
                    <button
                      type="button"
                      className="q-btn sm"
                      onClick={() => {
                        setPermission("own")
                        permissionField.current
                          ?.querySelector<HTMLButtonElement>('[role="combobox"]')
                          ?.focus()
                      }}
                    >
                      Cancel
                    </button>
                    <button type="button" className="q-btn sm" onClick={() => setConfirmed(true)}>
                      Use for this conversation
                    </button>
                  </div>
                </fieldset>
              ) : null}
              <SwitchFolder path={previous.cwd} />
              <div className="q-switch-kept">
                <ClipboardCheckIcon size={15} aria-hidden="true" />
                <span>
                  <b>{planning ? "Same task" : "Same approved task"}</b>
                  <span>Plan, answers, current work and approvals stay.</span>
                </span>
              </div>
              <p className="q-switch-note">
                A new conversation starts. The previous conversation stays in History.
              </p>
              {!available ? (
                <p role="alert">
                  The previous session changed. Close this chooser and open it again.
                </p>
              ) : null}
              {error ? (
                <p role="alert" className="q-switch-error">
                  {error}{" "}
                  <button
                    type="button"
                    className="q-lnk"
                    disabled={!ready || busy}
                    onClick={() => void start()}
                  >
                    Try again
                  </button>
                </p>
              ) : null}
            </>
          )}
        </section>
        <footer className="q-switch-actions">
          <button type="button" className="q-btn" disabled={phase === "starting"} onClick={close}>
            Cancel
          </button>
          {phase !== "stopping" ? (
            <button
              type="button"
              className="q-btn primary"
              ref={startButton}
              disabled={!ready || busy}
              onClick={() => void start()}
            >
              {phase === "starting"
                ? `Starting ${agentName(value.agent)}…`
                : `${active ? "Stop & continue with" : "Continue with"} ${agentName(value.agent)}`}
            </button>
          ) : null}
        </footer>
      </DialogContent>
    </Dialog>
  )
}
