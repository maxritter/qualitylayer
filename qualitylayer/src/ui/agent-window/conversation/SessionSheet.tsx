// The sheet that changes the model, effort and permission mode of a session: the model list, the
// effort, the permission modes, the Bypass question and the restart request.

import {
  CheckIcon,
  HandIcon,
  PencilLineIcon,
  ShieldAlertIcon,
  SignalHighIcon,
  SignalIcon,
  SignalLowIcon,
  SignalMediumIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
} from "lucide-react"
import { useEffect, useRef } from "react"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { StepAgent } from "../../../core/agents/model-values.ts"
import { AddModelRow } from "../../AddModelField.tsx"
import { AgentMark } from "../../kit/marks/index.ts"
import { customModelAgent, useKnownModels } from "../../known-models.ts"
import type { NativeSettingField } from "../../native-settings-error.ts"
import type { RunWindow } from "../../run-context.tsx"
import { Segmented } from "../../Segmented.tsx"
import {
  effortChoices,
  effortKind,
  effortLabel,
  type PermissionChoice,
  waitPhrase,
} from "./footer-values.ts"
import { type SessionSettingsProps, type SheetProps, useSessionSheet } from "./use-session-sheet.ts"

export type { SessionSettingsProps }

const PERMISSION_ICONS = {
  sliders: SlidersHorizontalIcon,
  hand: HandIcon,
  pencil: PencilLineIcon,
  sparkles: SparklesIcon,
  shield: ShieldAlertIcon,
} as const

const EFFORT_ICONS = {
  low: SignalLowIcon,
  medium: SignalMediumIcon,
  high: SignalHighIcon,
  xhigh: SignalIcon,
  max: SignalIcon,
} as const

/** The picture of an effort level: a rising signal, full for the highest; one signal for no known level. */
export function EffortGlyph({ effort, size }: { effort: string | undefined; size: number }) {
  const Glyph = EFFORT_ICONS[effort as keyof typeof EFFORT_ICONS] ?? SignalIcon
  return <Glyph size={size} aria-hidden="true" />
}

function ModelRows({
  options,
  value,
  onChange,
  disabled,
  custom,
}: {
  options: { id: string; name: string }[]
  value: string
  onChange(id: string): void
  disabled: boolean
  /** The agent whose list ends in a Add a model row that opens a provider/model field. */
  custom: StepAgent | undefined
}) {
  return (
    <>
      <RadioGroup
        aria-label="Session model"
        className="cv-rows"
        value={value}
        disabled={disabled}
        onValueChange={(next) => onChange(String(next))}
      >
        {options.map((option) => (
          <RadioGroupItem key={option.id} value={option.id} className="cv-row">
            <span>{option.name}</span>
            <CheckIcon size={14} aria-hidden="true" data-on={value === option.id} />
          </RadioGroupItem>
        ))}
      </RadioGroup>
      <AddModelRow agent={custom} value={value} disabled={disabled} onUse={onChange} />
    </>
  )
}

export function PermissionGlyph({ icon, size }: { icon: PermissionChoice["icon"]; size: number }) {
  const Glyph = PERMISSION_ICONS[icon]
  return <Glyph className="cv-perm-ic" size={size} aria-hidden="true" />
}

function PermissionRows({
  choices,
  value,
  onChange,
  disabled,
}: {
  choices: PermissionChoice[]
  value: string
  onChange(id: string): void
  disabled: boolean
}) {
  return (
    <RadioGroup
      aria-label="Session permissions"
      className="cv-rows"
      value={value}
      disabled={disabled}
      onValueChange={(next) => onChange(String(next))}
    >
      {choices.map((choice) => (
        // The mode's explanation is the row's tooltip; only Full access / Bypass keeps a line, amber,
        // since it asks the person to confirm.
        <RadioGroupItem
          key={choice.id}
          value={choice.id}
          title={choice.hint}
          className={`cv-row cv-row-two${choice.bypass ? " bypass" : ""}`}
        >
          <PermissionGlyph icon={choice.icon} size={16} />
          <span>
            <b>{choice.label}</b>
            {choice.bypass ? <small>Confirm a session change</small> : null}
          </span>
          <CheckIcon size={14} aria-hidden="true" data-on={value === choice.id} />
        </RadioGroupItem>
      ))}
    </RadioGroup>
  )
}

function BypassAsk({
  agentName,
  codex,
  busy,
  onKeep,
  onUse,
}: {
  agentName: string
  codex: boolean
  busy: boolean
  onKeep(): void
  onUse(): void
}) {
  const section = useRef<HTMLElement>(null)
  // The question opens below the lists: bring it into view and put focus on it.
  useEffect(() => {
    section.current?.scrollIntoView?.({ block: "nearest" })
    section.current?.focus({ preventScroll: true })
  }, [])
  return (
    <section
      ref={section}
      tabIndex={-1}
      className="cv-permission-confirm"
      aria-label="Confirm session permissions"
    >
      <b>
        {codex ? "Bypass Codex sandbox and approvals?" : `Bypass ${agentName} permission checks?`}
      </b>
      <p>
        {codex
          ? "Codex runs without its sandbox and command approval prompts. A branch or worktree does not limit its access."
          : `${agentName} skips its approval prompts for this session and can run commands with your account’s access.`}{" "}
        QualityLayer’s Plan and final approvals still apply.
      </p>
      <button type="button" className="q-btn sm" disabled={busy} onClick={onKeep}>
        Cancel
      </button>
      <button type="button" className="q-btn sm" disabled={busy} onClick={onUse}>
        Use Bypass for this session
      </button>
    </section>
  )
}

function EffortSection({
  agent,
  agentName,
  value,
  disabled,
  onChange,
}: {
  agent: RunWindow["agent"]
  agentName: string
  value: string | undefined
  disabled: boolean
  onChange(id: string): void
}) {
  const kind = effortKind(agent)
  if (kind === "in-model")
    return <p className="cv-set-note">{agentName} sets the effort through the model you choose.</p>
  if (kind !== "separate") return null
  return (
    <>
      <div className="cv-set-h">{value ? `Effort · ${effortLabel(value)}` : "Effort"}</div>
      <Segmented
        label="Session effort"
        size="md"
        iconOnly
        value={value?.toLowerCase() ?? ""}
        options={effortChoices(agent).map((id) => ({
          id,
          label: effortLabel(id),
          icon: <EffortGlyph effort={id} size={13} />,
          disabled,
        }))}
        onChange={onChange}
      />
    </>
  )
}

function NativeConfirm({ fields }: { fields: NativeSettingField[] }) {
  return (
    <section aria-label="Confirm native session choices">
      <b>Confirm the session choices</b>
      <p>
        The latest native {fields.join(" and ")} could not be verified. Confirm the displayed
        choices before restarting; the previous session stays running until then.
      </p>
    </section>
  )
}

export function SheetBody(props: SheetProps) {
  const { run, agentName, busy } = props
  useKnownModels()
  const sheet = useSessionSheet(props)
  const confirming = sheet.missing.length > 0
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const target = body.current?.querySelector<HTMLElement>(
      `[data-settings-section="${props.section ?? "model"}"]`,
    )
    target?.scrollIntoView?.({ block: "start" })
    target?.focus({ preventScroll: true })
  }, [props.section])
  return (
    <div className="cv-sheet">
      <div className="cv-sheet-body" ref={body}>
        <h3>
          <AgentMark agent={run.agent} size={14} />
          Session settings · {agentName}
        </h3>
        {run.pendingSettings ? (
          <p role={run.pendingSettings.error ? "alert" : "status"} className="cv-set-note">
            {run.pendingSettings.error ??
              `Changes saved · applies ${waitPhrase(run.pendingSettings.waiting)}`}
          </p>
        ) : null}
        <div className="cv-set-h" data-settings-section="model" tabIndex={-1}>
          Model
        </div>
        <ModelRows
          options={sheet.models}
          custom={customModelAgent(run.agent)}
          value={sheet.selected}
          disabled={busy}
          onChange={(id) => sheet.edit("model", id)}
        />
        <div data-settings-section="effort" tabIndex={-1}>
          <EffortSection
            agent={run.agent}
            agentName={agentName}
            value={sheet.draft.effort}
            disabled={busy}
            onChange={(id) => sheet.edit("effort", id)}
          />
        </div>
        <div className="cv-set-h" data-settings-section="perm" tabIndex={-1}>
          Permissions
        </div>
        {sheet.choices.length === 0 ? (
          <p>{agentName} has no built-in permission mode. Extension controls stay in Terminal.</p>
        ) : (
          <PermissionRows
            choices={sheet.choices}
            value={sheet.draft.perm}
            disabled={busy}
            onChange={sheet.choosePermission}
          />
        )}
        {sheet.asking ? (
          <BypassAsk
            agentName={agentName}
            codex={run.agent === "codex"}
            busy={busy}
            onKeep={sheet.stopAsking}
            onUse={sheet.useBypass}
          />
        ) : null}
        {confirming ? <NativeConfirm fields={sheet.missing} /> : null}
        {sheet.problem ? <p role="alert">{sheet.problem}</p> : null}
      </div>
      <div className="cv-set-apply">
        <button
          type="button"
          className="q-btn primary sm"
          title="Applies after this turn and keeps the conversation."
          disabled={
            !sheet.ready ||
            !sheet.changed ||
            (confirming && sheet.missing.some((field) => !sheet.draft[field]))
          }
          onClick={() => (confirming ? sheet.confirmNative(sheet.draft) : void sheet.commit())}
        >
          {confirming ? "Confirm and apply" : "Apply changes"}
        </button>
      </div>
    </div>
  )
}
