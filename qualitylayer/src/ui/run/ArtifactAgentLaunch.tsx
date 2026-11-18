import { PlayIcon, SquarePenIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { planModel } from "../../core/agents/model-values.ts"
import type { Config } from "../../core/config-values.ts"
import { ContextDraftHandoff } from "../agent-window/conversation/ContextDraftAttachment.tsx"
import type { ContextDraftTarget } from "../agent-window/conversation/context-draft.ts"
import { usePendingContextDraft } from "../agent-window/conversation/context-draft-store.ts"
import type { SubagentModels } from "../api.ts"
import {
  type ArtifactContextAddress,
  type ArtifactContextReader,
  artifactSourceContext,
} from "../artifacts/artifact-context.ts"
import { useOptionalRuns } from "../run-context.tsx"
import { recommendedModel } from "../settings/Defaults.tsx"
import {
  AgentLaunchFields,
  type AgentLaunchValue,
  launchAgentAvailable,
  preferredLaunchAgent,
} from "./AgentLaunchFields.tsx"
import { AgentTabLinks, type AgentTabTerminal, OutsideDialog } from "./AgentTab.tsx"
import { useArtifactNativeLaunch, useArtifactOutsideCopy } from "./useArtifactAgentLaunch.ts"
import "./task-agent-launch.css"

const drafts = new Map<string, { request: string; choice: AgentLaunchValue | null }>()

type ArtifactAgentLaunchProps = {
  contextTarget?: ContextDraftTarget
  address: ArtifactContextAddress
  title: string
  installed?: readonly SubagentModels[] | null
  config?: Config | null
  onStarted?: () => void
  contextApi?: ArtifactContextReader
  outside?: boolean
  onOutside?: (open: boolean) => void
  terminal?: AgentTabTerminal
}

function exactTarget(target: ContextDraftTarget | undefined, address: ArtifactContextAddress) {
  if (target?.kind !== "artifact") return undefined
  if (target.scope !== address.scope || target.id !== address.id || target.file !== address.file)
    return undefined
  return target
}

function RequestField({
  value,
  onChange,
  disabled,
  labelled,
  className,
}: {
  value: string
  onChange(value: string): void
  disabled: boolean
  labelled: boolean
  className: string
}) {
  return (
    <label className={className}>
      {labelled ? "What would you like to change?" : null}
      <textarea
        className="q-artifact-agent-request"
        maxLength={8000}
        value={value}
        disabled={disabled}
        placeholder={labelled ? undefined : "Describe the change"}
        aria-label={labelled ? undefined : "What would you like to change?"}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function StartAction({
  contextual,
  terminalOnly,
  busy,
  unavailable,
  ready,
  failed,
  start,
}: {
  contextual: boolean
  terminalOnly: boolean
  busy: boolean
  unavailable: boolean
  ready: boolean
  failed: boolean
  start(): void
}) {
  if (contextual && terminalOnly) return null
  let label = contextual ? "Start and send request" : "Start here"
  if (contextual && failed) label = "Try again"
  if (busy) label = "Starting…"
  return (
    <button
      className="q-btn sm primary"
      type="button"
      disabled={busy || unavailable || !ready}
      onClick={start}
    >
      <PlayIcon size={13} aria-hidden="true" />
      {label}
    </button>
  )
}

export function ArtifactAgentLaunch(props: ArtifactAgentLaunchProps) {
  const { scope, id, file } = props.address
  return <ArtifactAgentLaunchForm key={JSON.stringify([scope, id, file])} {...props} />
}

function ArtifactAgentLaunchForm({
  contextTarget,
  address,
  title,
  installed,
  config,
  onStarted,
  contextApi = artifactSourceContext,
  outside = false,
  onOutside,
  terminal,
}: ArtifactAgentLaunchProps) {
  const runs = useOptionalRuns()
  const target = exactTarget(contextTarget, address)
  const pending = usePendingContextDraft(target)
  const scope = JSON.stringify([address.scope, address.id, address.file])
  const [selected, setChoice] = useState<AgentLaunchValue | null>(
    () => drafts.get(scope)?.choice ?? null,
  )
  const agent = preferredLaunchAgent(installed)
  const model =
    agent === "pi" ? (config?.planning.defaults.pi.model ?? recommendedModel(agent)) : null
  const choice: AgentLaunchValue = {
    ...(selected ?? {
      agent,
      model: model ?? (agent === "other" ? "session" : planModel(agent)),
      effort: "high",
      runWhere: "app",
    }),
  }
  const [request, setRequest] = useState(() => drafts.get(scope)?.request ?? "")
  useEffect(() => {
    drafts.delete(scope)
    drafts.set(scope, { request, choice: selected })
    while (drafts.size > 32) drafts.delete(drafts.keys().next().value as string)
  }, [scope, request, selected])
  const mutex = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const source = { address, contextApi, mutex, mounted }
  const native = useArtifactNativeLaunch(source, choice, onStarted, target)
  const copy = useArtifactOutsideCopy(source)
  const busy = native.busy || copy.busy
  const inApp = choice.agent !== "other" && runs?.support?.supported === true
  const unavailable =
    !inApp || !launchAgentAvailable(choice.agent, installed) || runs?.support?.canStart === false
  const changeRequest = (value: string) => {
    setRequest(value)
    copy.clear()
  }
  const contextual = pending !== undefined
  const activeDraft = pending?.current ?? { text: request, context: undefined, files: [] }
  const ready = Boolean(activeDraft.text.trim() || activeDraft.context || activeDraft.files.length)
  return (
    <section className="q-agent-ready" aria-label={`Agent for ${title}`}>
      <div className="q-agent-ready-card" data-testid="artifact-agent-card">
        <h2 className="q-agent-ready-head">
          <SquarePenIcon size={14} aria-hidden="true" />
          Iterate on this artifact
        </h2>
        {target && pending ? (
          <fieldset disabled={busy}>
            <ContextDraftHandoff
              target={target}
              unsupported={unavailable}
              onTerminal={terminal?.open}
            />
          </fieldset>
        ) : (
          <RequestField
            className="block text-sm"
            value={request}
            onChange={changeRequest}
            disabled={busy}
            labelled={false}
          />
        )}
        <AgentLaunchFields
          value={choice}
          onChange={(patch) => setChoice({ ...choice, ...patch })}
          installed={installed}
          supported={runs?.support?.supported === true}
          disabled={busy}
          canConfigure={runs?.support?.canConfigure !== false}
          scope="Artifact agent"
          nativeOnly
          location={false}
        />
        <div className="q-agent-ready-actions">
          <StartAction
            contextual={contextual}
            terminalOnly={!inApp}
            busy={native.busy}
            unavailable={unavailable}
            ready={ready}
            failed={native.problem !== undefined}
            start={() => {
              if (!unavailable) void native.start(request, pending, target)
            }}
          />
        </div>
      </div>
      {unavailable ? (
        <p className="q-lands-note">
          {runs?.support?.reason ?? "Choose an installed agent, or run it in your own agent."}
        </p>
      ) : null}
      {native.problem ? (
        <p role="alert" className="mt-3 text-sm">
          {native.problem}
        </p>
      ) : null}
      <AgentTabLinks terminal={terminal} onOutside={() => onOutside?.(true)} />
      <OutsideDialog
        open={outside}
        onClose={() => onOutside?.(false)}
        request={
          copy.command ??
          `Using QualityLayer, update this artifact: ${request.trim() || "…"}\n\nIts current source is added when you copy.`
        }
        copyLabel="Copy request"
        busy={busy}
        disabled={!request.trim()}
        copied={copy.copied}
        error={copy.problem}
        context={{
          label: copy.folder ? "Artifact folder" : "Artifact source",
          path: copy.folder || address.file,
        }}
        onCopy={() => void copy.copy(request)}
      >
        <RequestField
          className="q-outside-field"
          value={request}
          onChange={changeRequest}
          disabled={busy}
          labelled
        />
      </OutsideDialog>
    </section>
  )
}
