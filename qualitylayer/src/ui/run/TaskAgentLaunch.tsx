import { type Config, DEFAULT_CONFIG } from "../../core/config-values.ts"
import { taskLaunchPrompt } from "../../core/run/launch-spec.ts"
import { ContextDraftHandoff } from "../agent-window/conversation/ContextDraftAttachment.tsx"
import type { ContextDraftTarget } from "../agent-window/conversation/context-draft.ts"
import type { SubagentModels, TaskDetail } from "../api.ts"
import { approvesOutside } from "../outside.ts"
import { useOptionalRuns } from "../run-context.tsx"
import {
  AgentLaunchFields,
  type AgentLaunchValue,
  launchAgentAvailable,
  preferredLaunchAgent,
} from "./AgentLaunchFields.tsx"
import { AgentTabLinks, type AgentTabTerminal, OutsideDialog } from "./AgentTab.tsx"
import { taskApprovalReady } from "./approval-ready.ts"
import { ExistingPlanContext } from "./ExistingPlanContext.tsx"
import {
  launchHeadingText,
  TaskApprovalReadyCard,
  TaskBuildReadyCard,
  TaskCheckoutFolder,
} from "./TaskAgentReadyCards.tsx"
import { taskAgentDefaults, taskPlanningLaunch } from "./task-launch.ts"
import { useTaskLaunchActions } from "./useTaskLaunchActions.ts"
import "./task-agent-launch.css"

export function taskLaunchKey(task: Pick<TaskDetail, "id" | "stage" | "gate">): string {
  return `${task.id}:${taskPlanningLaunch(task) ? "planning" : "build"}`
}

function LaunchStatusHints({
  inApp,
  ready,
  canStart,
  reason,
  error,
}: {
  inApp: boolean
  ready: boolean
  canStart: boolean
  reason: string | undefined
  error: string | undefined
}) {
  return (
    <>
      {!inApp || !ready ? (
        <p className="q-lands-note">
          {reason ?? "Choose an installed agent, or run it in your own agent."}
        </p>
      ) : null}
      {!canStart && inApp ? (
        <p className="q-lands-note">Start from the App or a browser it opened.</p>
      ) : null}
      {error ? (
        <p role="alert" className="q-run-error">
          {error}
        </p>
      ) : null}
    </>
  )
}

function TaskEndedNotice({ earlier, ended }: { earlier: boolean; ended: boolean }) {
  if (earlier) {
    return (
      <p>
        This task was made before the three steps. Its files stay as they are; open them under
        Files.
      </p>
    )
  }
  if (ended) return <p>This task is closed. Its recorded conversations remain in History.</p>
  return null
}

function TaskContextHandoff({
  contextTarget,
  taskId,
  agent,
  installed,
  terminal,
}: {
  contextTarget?: ContextDraftTarget
  taskId: string
  agent: AgentLaunchValue["agent"]
  installed: SubagentModels[] | null | undefined
  terminal?: AgentTabTerminal
}) {
  if (contextTarget?.kind !== "task" || contextTarget.task !== taskId) return null
  return (
    <ContextDraftHandoff
      target={contextTarget}
      unsupported={agent === "other" || !launchAgentAvailable(agent, installed)}
      onTerminal={terminal?.open}
    />
  )
}

function TaskLaunchControls({
  task,
  planning,
  choice,
  defaultModel,
  installed,
  supported,
  canConfigure,
  canStart,
  reason,
  inApp,
  ready,
  headerPrimary,
  outside,
  command,
  terminal,
  actions,
  onPatch,
  onOutside,
  onCopy,
}: {
  task: TaskDetail
  planning: boolean
  choice: AgentLaunchValue
  defaultModel: string
  installed: SubagentModels[] | null | undefined
  supported: boolean
  canConfigure: boolean
  canStart: boolean
  reason: string | undefined
  inApp: boolean
  ready: boolean
  headerPrimary: boolean
  outside: boolean
  command: string
  terminal?: AgentTabTerminal
  actions: ReturnType<typeof useTaskLaunchActions>
  onPatch: (patch: Partial<AgentLaunchValue>) => void
  onOutside?: (open: boolean) => void
  onCopy:
    | ((text: string, note: string) => Promise<boolean>)
    | ((text: string, note: string) => void)
}) {
  const outsideContext = task.checkout
    ? {
        context: { label: "Project folder", path: task.checkout },
        onCopyPath: async (path: string) =>
          (await onCopy(path, "Copied the project folder")) !== false,
      }
    : {}
  return (
    <>
      <AgentLaunchFields
        scope="Task agent"
        modelRole={planning ? "Planner" : "Lead"}
        defaultModel={defaultModel}
        value={choice}
        installed={installed}
        supported={supported}
        disabled={actions.busy}
        canConfigure={canConfigure}
        onChange={onPatch}
        nativeOnly
        location={false}
      />
      <TaskCheckoutFolder checkout={task.checkout} />
      <button
        type="button"
        className={headerPrimary ? "q-btn" : "q-btn primary"}
        disabled={!ready || actions.busy || !inApp || !canStart}
        onClick={() => void actions.start()}
      >
        {actions.busy && !outside ? "Starting…" : "Start here"}
      </button>
      <LaunchStatusHints
        inApp={inApp}
        ready={ready}
        canStart={canStart}
        reason={reason}
        error={actions.error}
      />
      <AgentTabLinks terminal={terminal} onOutside={() => onOutside?.(true)} />
      <OutsideDialog
        open={outside}
        onClose={() => onOutside?.(false)}
        request={command}
        copyLabel="Copy task request"
        busy={actions.busy}
        disabled={!ready}
        copied={actions.copied}
        error={actions.outsideError}
        onCopy={() => void actions.copy()}
        {...outsideContext}
      />
    </>
  )
}

export function TaskAgentLaunch({
  task,
  config,
  installed,
  value,
  onChange,
  onCopy,
  onStarted,
  onBuildOptions,
  outside = false,
  onOutside,
  terminal,
  contextTarget,
}: {
  task: TaskDetail
  config: Config | null
  installed: SubagentModels[] | null | undefined
  value?: AgentLaunchValue
  onChange: (value: AgentLaunchValue) => void
  onCopy:
    | ((text: string, note: string) => Promise<boolean>)
    | ((text: string, note: string) => void)
  onStarted?: () => void
  onBuildOptions?: () => void
  outside?: boolean
  onOutside?: (open: boolean) => void
  terminal?: AgentTabTerminal
  contextTarget?: ContextDraftTarget
}) {
  const runs = useOptionalRuns()
  const saved = config ?? DEFAULT_CONFIG
  const agent = value?.agent ?? preferredLaunchAgent(installed)
  const planning = taskPlanningLaunch(task)
  const own = agent === "other" ? null : agent
  const defaultsFor = (next: AgentLaunchValue["agent"]) => taskAgentDefaults(task, saved, next)
  const choice: AgentLaunchValue =
    value?.agent === agent ? value : { agent, ...defaultsFor(agent), runWhere: "app" }
  const supported = runs?.support?.supported === true
  const contextRequest = (
    <TaskContextHandoff
      contextTarget={contextTarget}
      taskId={task.id}
      agent={agent}
      installed={installed}
      terminal={terminal}
    />
  )
  const earlier = task.earlier === true
  const ended = task.archived || task.stage === "abandoned" || earlier
  const ready =
    config !== null && installed != null && launchAgentAvailable(agent, installed) && !ended
  const promptStage = !planning && task.stage === "plan" ? "implement" : task.stage
  const command = taskLaunchPrompt(agent, task.id, promptStage, "terminal")
  const actions = useTaskLaunchActions({
    runs,
    task,
    choice,
    command,
    canLaunchInApp: own !== null,
    ready,
    onCopy,
    onStarted,
  })
  const approval = approvesOutside(task) && !task.outside ? taskApprovalReady(task) : null
  if (approval) {
    return <TaskApprovalReadyCard task={task} approval={approval} contextRequest={contextRequest} />
  }
  if (!planning && task.action === "implement") {
    return (
      <TaskBuildReadyCard
        task={task}
        contextRequest={contextRequest}
        onBuildOptions={onBuildOptions}
        onCopy={onCopy}
      />
    )
  }
  const awaitsPullRequest = task.stage === "shipped" && task.pullRequest?.state === "open"
  return (
    <div className="q-agent-empty-message" data-testid="task-agent-launch">
      {contextRequest}
      <h2>{launchHeadingText(task, earlier, planning, awaitsPullRequest)}</h2>
      <TaskEndedNotice earlier={earlier} ended={ended} />
      <ExistingPlanContext task={task} />
      {!ended ? (
        <TaskLaunchControls
          task={task}
          planning={planning}
          choice={choice}
          defaultModel={defaultsFor(agent).model}
          installed={installed}
          supported={supported}
          canConfigure={!supported || runs?.support?.canConfigure === true}
          canStart={runs?.support?.canStart === true}
          reason={runs?.support?.reason}
          inApp={supported && own !== null}
          ready={ready}
          headerPrimary={taskApprovalReady(task) !== null}
          outside={outside}
          command={command}
          terminal={terminal}
          actions={actions}
          onPatch={(patch) => {
            onChange({
              ...choice,
              ...patch,
              ...(patch.agent ? defaultsFor(patch.agent) : {}),
            })
            actions.setError(undefined)
            actions.setCopied(false)
          }}
          onOutside={onOutside}
          onCopy={onCopy}
        />
      ) : null}
    </div>
  )
}
