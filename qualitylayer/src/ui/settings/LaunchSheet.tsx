// One sheet per agent: how QualityLayer starts it. The default permission mode, the program, extra
// arguments for every start, and the folder the agent keeps its settings in (only for an agent whose
// folder can be moved). Nothing is saved until Save; an empty program or folder means "use the one shown".

import { type ReactNode, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { configDirVariable } from "../../core/agents/config-dir.ts"
import type { AgentHealth } from "../../core/agents/health-types.ts"
import { AGENT_NAMES, BINARIES, type NativeAgent } from "../../core/agents/ids.ts"
import {
  type AgentSettings,
  type EffortChoice,
  type RunPermission,
  validAbsolutePath,
} from "../../core/config-values.ts"
import {
  AGENT_CAPABILITIES,
  bypassArgsIn,
  permissionFor,
  resolvePermission,
} from "../../core/run/launch-spec.ts"
import { permissionChoices } from "../agent-window/conversation/footer-values.ts"
import { AgentMark } from "../kit/marks/index.ts"
import { ARGUMENT_EXAMPLE, DEFAULT_FOLDER, defaultModes, OWN_SETTING } from "./agent-facts.tsx"
import { joinArguments, splitArguments } from "./arguments.ts"
import { MONO_INPUT, type SaveResult } from "./CommitField.tsx"
import { effortName, fromPick, launchEfforts, toPick } from "./Defaults.tsx"
import {
  type EffortDefaultsPatch,
  effortDefaultsPatch,
  type LaunchEfforts,
} from "./launch-effort.ts"
import { Pick, SettingsMore } from "./Rows.tsx"
import "./launch-sheet.css"

const PATH_PROBLEM = "Use an absolute path, like /opt/homebrew/bin/agent, or leave it empty."

/** Why extra arguments are refused: they carry what Bypass mode starts the agent with. */
const bypassProblem = (flags: string[]): string | null =>
  flags.length === 0
    ? null
    : `These arguments skip every permission check (${flags.join(", ")}). Choose Bypass as a permission mode instead of putting it in extra arguments.`

type Draft = {
  command: string
  args: string
  configDir: string
  permMode: string
  effort: EffortChoice
}
type LaunchSettingsPatch = EffortDefaultsPatch & { agents?: Record<string, Partial<AgentSettings>> }

/** What changed from the saved settings, as the patch `PUT /api/config` takes; null when nothing did. */
export function launchPatch(
  agent: NativeAgent,
  saved: AgentSettings,
  draft: Draft,
): { agents: Record<string, Partial<AgentSettings>> } | null {
  const next: Partial<AgentSettings> = {}
  if (draft.command.trim() !== saved.command) next.command = draft.command.trim()
  const args = splitArguments(draft.args)
  if (joinArguments(args) !== joinArguments(saved.args)) next.args = args
  if (draft.configDir.trim() !== saved.configDir) next.configDir = draft.configDir.trim()
  if (draft.permMode !== saved.permMode) next.permMode = draft.permMode
  return Object.keys(next).length === 0 ? null : { agents: { [agent]: next } }
}

function Field({
  label,
  problem,
  children,
}: {
  label: string
  problem?: string | null
  children: (props: { id: string; describedBy: string | undefined }) => ReactNode
}) {
  const id = useId()
  const note = `${id}-note`
  return (
    <div className="q-ag-f">
      <label htmlFor={id}>{label}</label>
      {children({ id, describedBy: problem ? note : undefined })}
      {problem ? (
        <span id={note} className="q-sr-err" role="alert">
          {problem}
        </span>
      ) : null}
    </div>
  )
}

function ModeField({
  agent,
  value,
  disabled,
  onChange,
  permission,
}: {
  agent: NativeAgent
  value: string
  disabled: boolean
  onChange: (mode: string) => void
  permission: RunPermission
}) {
  const name = AGENT_NAMES[agent]
  const modes = defaultModes(agent)
  const inherited =
    resolvePermission(agent, permissionFor(agent, permission)).mode?.id ?? OWN_SETTING
  const shown =
    value === "" ? inherited : modes.some((mode) => mode.id === value) ? value : OWN_SETTING
  if (modes.length > 1)
    return (
      <div className="q-ag-f">
        <span>Default permission mode</span>
        <Pick
          label={`Default permission mode for ${name}`}
          value={shown}
          options={modes}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
    )
  return (
    <div className="q-ag-f">
      <span>Default permission mode</span>
      <b className="q-ag-fixed">
        {modes.length === 1
          ? (permissionChoices(agent)[0]?.hint ?? `${name}'s own settings`)
          : agent === "pi"
            ? `${value === "own" || permission !== "bypass" ? "Agent settings" : "Bypass"} · Pi has no approval switch`
            : `${name} has no permission mode`}
      </b>
    </div>
  )
}

function EffortField({
  agent,
  value,
  defaults,
  disabled,
  onChange,
}: {
  agent: NativeAgent
  value: EffortChoice
  defaults: LaunchEfforts
  disabled: boolean
  onChange: (effort: EffortChoice) => void
}) {
  const name = AGENT_NAMES[agent],
    capability = AGENT_CAPABILITIES[agent]
  if (capability.effort !== "separate")
    return (
      <div className="q-ag-f">
        <span>Default effort</span>
        <b className="q-ag-fixed">
          {capability.effort === "in-model"
            ? `Part of the model ${name} runs`
            : `${name} has no separate effort setting`}
        </b>
      </div>
    )
  const options = launchEfforts(agent)
    .filter((option) => option.id === "agent-settings" || capability.efforts.includes(option.id))
    .map((option) => ({
      ...option,
      ...(option.id === "high"
        ? { note: "Default" }
        : option.id === "xhigh" || option.id === "max"
          ? { note: "costs much more" }
          : {}),
    }))
  if (!options.some((option) => option.id === toPick(value)))
    options.unshift({
      id: toPick(value),
      name: effortName(value),
      note: `Not supported by ${name}`,
      disabled: true,
    })
  return (
    <div className="q-ag-f">
      <span>Default effort</span>
      <Pick
        label={`Default effort for ${name}`}
        value={toPick(value)}
        options={options}
        disabled={disabled}
        onChange={(next) => onChange(fromPick(next) as EffortChoice)}
        onReselect={(next) => onChange(fromPick(next) as EffortChoice)}
      />
      <p className="q-ag-note">
        New sessions start at this effort. A task’s own pick wins; running sessions keep theirs.
      </p>
      {defaults.planning !== defaults.implement ? (
        <p className="q-ag-note" role="note">
          Saved defaults differ: Planning {effortName(defaults.planning)} · Implement{" "}
          {effortName(defaults.implement)}. Choose an effort to apply it to both; other edits keep
          them.
        </p>
      ) : null}
    </div>
  )
}

export function LaunchSheet({
  agent,
  health,
  settings,
  permission,
  efforts,
  permitted,
  onSave,
  onClose,
}: {
  agent: NativeAgent
  health: AgentHealth | undefined
  settings: AgentSettings
  permission: RunPermission
  efforts: LaunchEfforts
  /** The person may change what starts a program here. */
  permitted: boolean
  /** Saves the patch; an answer of why it was refused keeps the sheet open with that said. */
  onSave: (patch: LaunchSettingsPatch) => SaveResult
  onClose: () => void
}) {
  const name = AGENT_NAMES[agent]
  const [draft, setDraft] = useState<Draft>({
    command: settings.command,
    args: joinArguments(settings.args),
    configDir: settings.configDir,
    permMode: settings.permMode,
    effort: efforts.planning,
  })
  const [effortPicked, setEffortPicked] = useState(false)
  const set = (patch: Partial<Draft>) => setDraft((held) => ({ ...held, ...patch }))
  const moves = configDirVariable(agent) !== null
  const [saving, setSaving] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const problems = {
    command: validAbsolutePath(draft.command.trim()) ? null : PATH_PROBLEM,
    args: bypassProblem(bypassArgsIn(agent, splitArguments(draft.args))),
    configDir: validAbsolutePath(draft.configDir.trim()) ? null : PATH_PROBLEM,
  }
  const effortPatch = effortDefaultsPatch(agent, efforts, draft.effort, effortPicked)
  const changed = { ...launchPatch(agent, settings, draft), ...effortPatch }
  const patch = Object.keys(changed).length ? changed : null
  const save = async () => {
    if (saving) return
    if (patch === null) return onClose()
    setSaving(true)
    setRefused(null)
    try {
      const refusal = await onSave(patch)
      if (typeof refusal === "string") return setRefused(refusal)
      onClose()
    } catch (error) {
      setRefused(error instanceof Error ? error.message : "Settings could not be saved.")
    } finally {
      setSaving(false)
    }
  }
  const blocked = Object.values(problems).some((problem) => problem !== null)
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="q-ag-sheet sm:max-w-[460px]" data-testid="launch-sheet">
        <header className="q-ag-sheet-h">
          <AgentMark agent={agent} size={16} />
          <DialogTitle className="m-0 text-[15px] font-semibold">
            {name} launch settings
          </DialogTitle>
        </header>
        <DialogDescription className="sr-only">
          How QualityLayer starts {name}. Nothing is saved until you press Save.
        </DialogDescription>
        <Field label="Command" problem={problems.command}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              className={MONO_INPUT}
              value={draft.command}
              placeholder={health?.path ?? BINARIES[agent]}
              disabled={!permitted || saving}
              aria-invalid={problems.command !== null || undefined}
              aria-describedby={describedBy}
              spellCheck={false}
              onChange={(event) => set({ command: event.target.value })}
            />
          )}
        </Field>
        <Field label="Extra arguments" problem={problems.args}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-invalid={problems.args !== null || undefined}
              aria-describedby={describedBy}
              className={MONO_INPUT}
              value={draft.args}
              placeholder={ARGUMENT_EXAMPLE[agent]}
              disabled={!permitted || saving}
              spellCheck={false}
              onChange={(event) => set({ args: event.target.value })}
            />
          )}
        </Field>
        {moves ? (
          <Field label="Config folder" problem={problems.configDir}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                className={MONO_INPUT}
                value={draft.configDir}
                placeholder={DEFAULT_FOLDER[agent]}
                disabled={!permitted || saving}
                aria-invalid={problems.configDir !== null || undefined}
                aria-describedby={describedBy}
                spellCheck={false}
                onChange={(event) => set({ configDir: event.target.value })}
              />
            )}
          </Field>
        ) : null}
        <ModeField
          agent={agent}
          value={draft.permMode}
          permission={permission}
          disabled={!permitted || saving}
          onChange={(permMode) => set({ permMode })}
        />
        <EffortField
          agent={agent}
          value={draft.effort}
          defaults={efforts}
          disabled={!permitted || saving}
          onChange={(effort) => {
            set({ effort })
            setEffortPicked(true)
          }}
        />
        {permitted ? (
          <SettingsMore summary="How it starts">
            <p className="q-ag-note">
              {`An empty command or folder uses the one shown; arguments are added to every start. Saved permission defaults apply to new sessions. Changing an existing session to ${permissionChoices(agent).find((choice) => choice.bypass)?.label ?? "Bypass"} asks you to confirm.`}
            </p>
          </SettingsMore>
        ) : (
          <p className="q-ag-note">Change these from QualityLayer or a browser it opened.</p>
        )}
        {effortPatch !== null ? (
          <p className="q-ag-note" role="status">
            Saving changes new sessions only:{" "}
            {efforts.planning !== efforts.implement
              ? `Planning ${effortName(efforts.planning)} · Implement ${effortName(efforts.implement)}`
              : effortName(efforts.planning)}{" "}
            → {effortName(draft.effort)}.
          </p>
        ) : null}
        {refused !== null ? (
          <p className="q-sr-err" role="alert" data-testid="launch-refused">
            Not saved: {refused}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!permitted || blocked || saving || patch === null}
            onClick={() => void save()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
