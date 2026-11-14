import { CopyIcon, FolderIcon, HammerIcon, PlayIcon } from "lucide-react"
import { useRef, useState } from "react"
import { type Config, DEFAULT_CONFIG } from "../../core/config-values.ts"
import { startDefaults } from "../../core/handoff/start-values.ts"
import { agentIdOf } from "../../core/interaction-shell/status.ts"
import { agentName } from "../../core/live/liveness.ts"
import { taskLaunchPrompt } from "../../core/run/launch-spec.ts"
import { ContextDraftHandoff } from "../agent-window/conversation/ContextDraftAttachment.tsx"
import type { ContextDraftTarget } from "../agent-window/conversation/context-draft.ts"
import type { SubagentModels, TaskDetail } from "../api.ts"
import { WhoMark } from "../kit/WhoMark.tsx"
import { approvesOutside } from "../outside.ts"
import { useOptionalRuns } from "../run-context.tsx"
import { runColors } from "../runs-api.ts"
import {
  AgentLaunchFields,
  type AgentLaunchValue,
  launchAgentAvailable,
  preferredLaunchAgent,
} from "./AgentLaunchFields.tsx"
import { AgentTabLinks, type AgentTabTerminal, OutsideDialog } from "./AgentTab.tsx"
import { taskApprovalReady } from "./approval-ready.ts"
import { ExistingPlanContext } from "./ExistingPlanContext.tsx"
import "./task-agent-launch.css"

function planningLaunch(task: Pick<TaskDetail, "stage" | "gate">): boolean {
  return task.stage === "plan" && task.gate?.decision !== "approved"
}

export function taskLaunchKey(task: Pick<TaskDetail, "id" | "stage" | "gate">): string {
  return `${task.id}:${planningLaunch(task) ? "planning" : "build"}`
}

function checkoutContext(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean)
  const name = parts.at(-1) ?? path
  if (path.length <= 46 || parts.length <= 3) return { name, shown: path }
  const separator = path.includes("\\") ? "\\" : "/"
  const prefix = path.startsWith("\\\\")
    ? `\\\\${parts[0]}`
    : path.startsWith("/")
      ? `/${parts.slice(0, 2).join("/")}`
      : parts[0]
  return { name, shown: [prefix, "…", ...parts.slice(-2)].join(separator) }
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
  /** Open the task's existing build handoff instead of starting around its approved workspace. */
  onBuildOptions?: () => void
  /** Whether Run it in my own agent is open; the card's link and the session menu open it. */
  outside?: boolean
  onOutside?: (open: boolean) => void
  /** The plain terminal's link; absent where no shell can open. */
  terminal?: AgentTabTerminal
  contextTarget?: ContextDraftTarget
}) {
  const runs = useOptionalRuns()
  const saved = config ?? DEFAULT_CONFIG
  const agent = value?.agent ?? preferredLaunchAgent(installed)
  const planning = planningLaunch(task)
  const own = agent === "other" ? null : agent
  const defaultsFor = (next: AgentLaunchValue["agent"]) => ({
    model:
      next === "other"
        ? ""
        : planning
          ? saved.planning.defaults[next].model
          : startDefaults(saved, next, task.flow?.light === true, next).model,
    effort:
      next === "other"
        ? ("high" as const)
        : planning
          ? saved.planning.defaults[next].effort
          : saved.implement.defaults[next].effort,
  })
  const choice: AgentLaunchValue = {
    ...(value?.agent === agent
      ? value
      : {
          agent,
          ...defaultsFor(agent),
          runWhere: "app",
        }),
  }
  const supported = runs?.support?.supported === true
  const contextRequest =
    contextTarget?.kind === "task" && contextTarget.task === task.id ? (
      <ContextDraftHandoff
        target={contextTarget}
        unsupported={agent === "other" || !launchAgentAvailable(agent, installed)}
        onTerminal={terminal?.open}
      />
    ) : null
  const inApp = supported && own !== null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [outsideError, setOutsideError] = useState<string>()
  const [copied, setCopied] = useState(false)
  const attempt = useRef({ key: "", id: "" })
  // An open pull request is reviewed with `/ql review <task>`: the card's button says so.
  const awaitsPullRequest = task.stage === "shipped" && task.pullRequest?.state === "open"
  // Approval does not end the conversation: a shipped task keeps its chat for merge, deploy and
  // tweaks, landing or landed. Only an archived or abandoned task is closed.
  // A task from before the three steps opens as files only: nothing continues it.
  const earlier = task.earlier === true
  const ended = task.archived || task.stage === "abandoned" || earlier
  const folder = task.checkout ? checkoutContext(task.checkout) : null
  const ready =
    config !== null && installed != null && launchAgentAvailable(agent, installed) && !ended
  const purpose = {
    kind: "task" as const,
    task: task.id,
    ...(planning ? { phase: "planning" as const } : {}),
  }
  const command = taskLaunchPrompt(
    agent,
    task.id,
    !planning && task.stage === "plan" ? "implement" : task.stage,
    "terminal",
  )
  const start = async () => {
    if (!ready || !runs || !own || !runs.support?.canStart || busy) return
    const request = {
      agent: own,
      purpose,
      ...(task.checkout ? { cwd: task.checkout } : {}),
      works: "checkout" as const,
      mode: "plain" as const,
      settings: {
        answers: "app" as const,
        model: choice.model,
        effort: choice.effort,
      },
    }
    const { cwd: _checkout, ...choices } = request
    const key = JSON.stringify(choices)
    if (attempt.current.key !== key) attempt.current = { key, id: crypto.randomUUID() }
    setBusy(true)
    setError(undefined)
    try {
      await runs.start({ ...request, idempotencyKey: attempt.current.id, colors: runColors() })
      onStarted?.()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The agent could not start. Your choices are kept.",
      )
    } finally {
      setBusy(false)
    }
  }
  const copy = async () => {
    if (!ready || busy) return
    setBusy(true)
    setOutsideError(undefined)
    setCopied(false)
    try {
      const accepted = await onCopy(command, "Copied the task request")
      if (accepted !== false) setCopied(true)
      else
        setOutsideError(
          "The request could not be copied. Select it to copy manually, or try again.",
        )
    } catch (cause) {
      setOutsideError(cause instanceof Error ? cause.message : "The request could not be copied.")
    } finally {
      setBusy(false)
    }
  }
  // The header owns the one filled button while it carries Approve Plan or Approve review (DESIGN.md ›
  // Actions): Start here, a fresh session, is then the neutral secondary.
  const headerPrimary = taskApprovalReady(task) !== null
  const approval = approvesOutside(task) && !task.outside ? taskApprovalReady(task) : null
  if (approval)
    return (
      <div className="q-agent-empty-message" data-testid="task-agent-ready">
        {contextRequest}
        <h2>Ready for your {approval}</h2>
        <p>The recorded work is ready for your decision here or in your own agent.</p>
        <p>
          No outside session has reported its presence here. Approval does not start or move an
          agent.
        </p>
        <ExistingPlanContext task={task} />
      </div>
    )
  if (!planning && task.action === "implement") {
    // Ready to build (4 November 2026): one compact card with the Plan's size and the two moves.
    const start = task.implementStart
    const prompt =
      start?.agents.find((option) => option.agent === agentIdOf(task))?.prompt ??
      start?.agents[0]?.prompt ??
      null
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
    // Approved for its own outside session: that session builds it next, so no start card.
    const route = task.start?.route === true && task.start.where === "here" ? task.start : null
    if (route !== null) {
      const name =
        route.agent === undefined || route.agent === "other" ? "your agent" : agentName(route.agent)
      // The App Model's words for this choice (agent-build-outside-approved*.html), kept until it starts.
      return (
        <div className="q-agent-empty-message q-agent-ready" data-testid="task-agent-builds-next">
          <section className="q-agent-ready-card" aria-label="Builds next">
            <h2 className="q-agent-ready-head">
              <WhoMark who={route.compact === true ? "you" : "agent"} />
              {route.compact === true
                ? "Approved · build here, from the Plan"
                : "Approved · keeping this conversation"}
            </h2>
            <p className="q-agent-ready-size">
              <HammerIcon size={13} aria-hidden="true" />
              {route.compact === true
                ? `Run your compact command in ${name}, then say “build here”.`
                : "The same conversation builds it next."}
            </p>
          </section>
        </div>
      )
    }
    return (
      <div className="q-agent-empty-message q-agent-ready" data-testid="task-agent-build-ready">
        {contextRequest}
        <section className="q-agent-ready-card" aria-label="Ready to build">
          <h2 className="q-agent-ready-head">
            <WhoMark who="you" />
            Ready to build
          </h2>
          <p className="q-agent-ready-size">
            <HammerIcon size={13} aria-hidden="true" />
            {start && start.slices > 0
              ? `Plan approved · ${plural(start.slices, "slice")}${start.tasks > 0 ? ` · ${plural(start.tasks, "task")}` : ""}`
              : "Plan approved"}
          </p>
          <div className="q-agent-ready-actions">
            {onBuildOptions ? (
              <button type="button" className="q-btn sm primary" onClick={onBuildOptions}>
                <PlayIcon size={13} aria-hidden="true" />
                Start the build
              </button>
            ) : null}
            {prompt ? (
              <button
                type="button"
                className="q-btn sm"
                onClick={() => void onCopy(prompt, "Copied the build prompt")}
              >
                <CopyIcon size={13} aria-hidden="true" />
                Copy prompt
              </button>
            ) : null}
          </div>
        </section>
      </div>
    )
  }
  return (
    <div className="q-agent-empty-message" data-testid="task-agent-launch">
      {contextRequest}
      <h2>
        {earlier
          ? "Earlier workflow"
          : `Continue ${task.stage === "verify" ? "verification" : planning ? "planning" : awaitsPullRequest ? "review" : "this task"}`}
      </h2>
      {earlier ? (
        <p>
          This task was made before the three steps. Its files stay as they are; open them under
          Files.
        </p>
      ) : ended ? (
        <p>This task is closed. Its recorded conversations remain in History.</p>
      ) : null}
      <ExistingPlanContext task={task} />
      {!ended ? (
        <>
          <AgentLaunchFields
            scope="Task agent"
            modelRole={planning ? "Planner" : "Lead"}
            defaultModel={defaultsFor(agent).model}
            value={choice}
            installed={installed}
            supported={supported}
            disabled={busy}
            canConfigure={!supported || runs?.support?.canConfigure === true}
            onChange={(patch) => {
              onChange({
                ...choice,
                ...patch,
                ...(patch.agent ? defaultsFor(patch.agent) : {}),
              })
              setError(undefined)
              setCopied(false)
            }}
            nativeOnly
            location={false}
          />
          {task.checkout ? (
            <fieldset
              className="q-task-launch-folder"
              aria-label={`Project folder: ${task.checkout}`}
            >
              <span aria-hidden="true">
                <FolderIcon size={14} aria-hidden="true" />
                <b title={task.checkout}>{folder?.name}</b>
              </span>
              <code title={task.checkout} aria-hidden="true">
                {folder?.shown}
              </code>
            </fieldset>
          ) : null}
          <button
            type="button"
            className={headerPrimary ? "q-btn" : "q-btn primary"}
            disabled={!ready || busy || !inApp || !runs?.support?.canStart}
            onClick={() => void start()}
          >
            {busy && !outside ? "Starting…" : "Start here"}
          </button>
          {!inApp || !ready ? (
            <p className="q-lands-note">
              {runs?.support?.reason ?? "Choose an installed agent, or run it in your own agent."}
            </p>
          ) : null}
          {!runs?.support?.canStart && inApp ? (
            <p className="q-lands-note">Start from the App or a browser it opened.</p>
          ) : null}
          {error ? (
            <p role="alert" className="q-run-error">
              {error}
            </p>
          ) : null}
          <AgentTabLinks terminal={terminal} onOutside={() => onOutside?.(true)} />
          <OutsideDialog
            open={outside}
            onClose={() => onOutside?.(false)}
            request={command}
            copyLabel="Copy task request"
            busy={busy}
            disabled={!ready}
            copied={copied}
            error={outsideError}
            onCopy={() => void copy()}
            {...(task.checkout
              ? {
                  context: { label: "Project folder", path: task.checkout },
                  onCopyPath: async (path: string) =>
                    (await onCopy(path, "Copied the project folder")) !== false,
                }
              : {})}
          />
        </>
      ) : null}
    </div>
  )
}
