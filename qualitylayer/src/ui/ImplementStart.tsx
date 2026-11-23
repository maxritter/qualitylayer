// The model's compact handoff: Start the build. Like New task it asks where the agent runs. In
// QualityLayer a fresh native agent session builds beside the task (agent row, then the branch choice);
// in the person's terminal, app or IDE the card shows the one prompt to copy, which works in the
// planning session or a fresh one.
import { CodeXmlIcon, WalletIcon } from "lucide-react"
import { permissionDescription } from "../core/run/launch-spec.ts"
import { type BuildLaunchSelection, updateBuildPicks } from "./implement-start-actions.ts"
import { type ImplementStartProps, useImplementStartModel } from "./implement-start-model.ts"
import {
  BuildArtifactFiles,
  type BuildArtifacts,
  BuildExplain,
  BuildRoleLine,
} from "./implement-start-parts.tsx"
import { AgentLaunchFields } from "./run/AgentLaunchFields.tsx"
import { LaunchAttachments } from "./run/LaunchAttachments.tsx"
import { LaunchBranch } from "./run/LaunchBranch.tsx"
import { LaunchWhere } from "./run/LaunchChoice.tsx"
import { TerminalHandoff } from "./run/LaunchPrompt.tsx"
import { runStatusText } from "./runs-api.ts"
import "./implement-start.css"
import "./start-model.css"

export type { StartAgent } from "../core/handoff/start-values.ts"
export type { BuildArtifacts, BuildLaunchSelection }

function ImplementStartAppPanel({ m }: { m: ReturnType<typeof useImplementStartModel> }) {
  return (
    <div className="q-start-app">
      <AgentLaunchFields
        scope="Build"
        modelRole="Build model"
        heading={{ label: "Builder", icon: <CodeXmlIcon size={13} aria-hidden="true" /> }}
        defaultModel={m.mine.model}
        installed={m.services?.launchAgents ?? m.services?.installed}
        supported={m.supported}
        disabled={m.starting || m.copying}
        canConfigure={!m.supported || m.canConfigure}
        location={false}
        nativeOnly
        value={{
          agent: m.agent,
          model: m.choice.model,
          effort: m.choice.effort,
          runWhere: "app",
        }}
        models={m.sessionOptions}
        onChange={(patch) => {
          if (patch.agent) m.setAgent(patch.agent)
          m.setAgentPicks((current) => updateBuildPicks(current, m.agent, patch))
        }}
        afterModels={
          m.agent === "other" ? null : (
            <div className="q-start-explain-block">
              <BuildExplain agent={m.agent} small={m.small} workers={m.workers} />
              <BuildRoleLine
                agent={m.agent}
                workers={m.workers}
                disabled={m.starting || m.copying || !m.canConfigure}
                onPick={(workers) =>
                  m.setAgentPicks((current) => updateBuildPicks(current, m.agent, { workers }))
                }
                onDefaults={m.services?.openSettings ? m.openModelDefaults : null}
              />
            </div>
          )
        }
      />
      <p className="q-nt-hint">
        Permissions · {permissionDescription(m.agent, m.permission.perm, m.permission.permMode)} ·{" "}
        <a
          className="q-link"
          href="#/settings/agents"
          aria-label="Change permissions in Agent settings"
        >
          Change
        </a>
      </p>
    </div>
  )
}

function ImplementStartFooter({
  m,
  onCancel,
  cancelDisabled,
}: {
  m: ReturnType<typeof useImplementStartModel>
  onCancel?: () => void
  cancelDisabled: boolean
}) {
  return (
    <div className="q-start-go">
      {m.reason ? (
        <p className="q-start-note" role="status" data-testid="start-note">
          {m.reason}
        </p>
      ) : null}
      {m.credits !== null ? (
        <p className="q-start-note q-start-credit" role="status" data-testid="start-credits">
          <WalletIcon className="size-3" aria-hidden="true" />
          {m.credits}
        </p>
      ) : null}
      {onCancel ? (
        <button type="button" className="q-btn quiet" disabled={cancelDisabled} onClick={onCancel}>
          Cancel
        </button>
      ) : null}
      {m.inApp ? (
        <button
          type="button"
          className="q-btn primary"
          data-testid="step-main"
          disabled={m.blocked}
          aria-disabled={m.blocked}
          onClick={() => void m.start()}
        >
          {m.starting ? "Starting…" : m.copying ? "Preparing…" : m.actionLabel}
        </button>
      ) : null}
    </div>
  )
}

export function ImplementStart(props: ImplementStartProps) {
  const {
    onCopy,
    compact = false,
    onConfirmStart,
    onCancel,
    cancelDisabled = false,
    artifacts,
    planApproved,
  } = props
  const m = useImplementStartModel(props)
  if (m.activeRun) {
    const activeRun = m.activeRun
    return (
      <section className="q-start q-start-model" data-testid="implement-start">
        <p role="status">{runStatusText(activeRun)}</p>
        <button type="button" className="q-btn" onClick={() => m.runs?.select(activeRun.id)}>
          Open its window
        </button>
      </section>
    )
  }
  const approved =
    planApproved ??
    (m.detail !== null && (m.detail.stage !== "plan" || m.detail.gate?.decision === "approved"))
  return (
    <section
      className="q-start q-start-model q-start-launch"
      data-testid="implement-start"
      data-agent={m.inApp ? m.agent : "other"}
      data-compact={compact}
    >
      <div className="q-start-body">
        <section className="q-start-sec" aria-labelledby={m.whereId}>
          <span className="q-start-k" id={m.whereId}>
            Where the agent runs
          </span>
          <LaunchWhere
            scope="Build"
            value={m.where}
            appOff={m.appOff}
            disabled={m.starting || m.copying}
            quiet
            onChange={m.setChosenWhere}
          />
        </section>
        {m.inApp ? (
          <ImplementStartAppPanel m={m} />
        ) : (
          <div data-testid="outside-continue">
            <TerminalHandoff
              prompt={m.copyState?.key === m.previewKey ? m.copyState.text : m.previewText}
              files={m.files.length}
              testId="start-command"
              onCopy={() => void m.copy()}
              action={onConfirmStart && planApproved === false ? "Approve and copy" : undefined}
              copied={m.done}
              copying={m.copying}
              folder={m.checkout}
              folderLabel="project folder"
              onCopyFolder={async (path) =>
                (await onCopy(path, "Copied the project folder")) !== false
              }
            />
          </div>
        )}
        <section className="q-start-context" aria-label="Files for the build">
          <BuildArtifactFiles state={artifacts} task={m.detail} approved={approved} />
          <LaunchAttachments
            scope="Start the build"
            files={m.files}
            disabled={m.starting || m.copying || (m.inApp && !m.canStart)}
            onChange={(next) => {
              m.setFiles(next)
              m.setFileRevision((value) => value + 1)
            }}
          />
        </section>
        {m.inApp ? (
          <LaunchBranch
            scope="Build"
            heading="Workspace"
            icons
            state={m.branchState}
            resolved={m.resolved}
            current={m.branch.state?.branch}
            checkout={m.checkout}
            disabled={m.starting || m.copying || (m.supported && !m.canConfigure)}
            contested={m.contested}
            onChange={(patch) => m.setPickedBranch({ ...m.branchState, ...patch })}
          />
        ) : null}
        {m.problem ? (
          <p role="alert" className="q-run-error">
            {m.problem}
          </p>
        ) : null}
      </div>
      <ImplementStartFooter m={m} onCancel={onCancel} cancelDisabled={cancelDisabled} />
    </section>
  )
}
