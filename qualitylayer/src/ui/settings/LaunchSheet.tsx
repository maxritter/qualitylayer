// One sheet per agent: how QualityLayer starts it. The default permission mode, the program, extra
// arguments for every start, and the folder the agent keeps its settings in (only for an agent whose
// folder can be moved). Nothing is saved until Save; an empty program or folder means "use the one shown".

import { useState } from "react"
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
import { bypassArgsIn } from "../../core/run/launch-spec.ts"
import { permissionChoices } from "../agent-window/conversation/footer-values.ts"
import { AgentMark } from "../kit/marks/index.ts"
import { ARGUMENT_EXAMPLE, DEFAULT_FOLDER } from "./agent-facts.tsx"
import { joinArguments, splitArguments } from "./arguments.ts"
import { MONO_INPUT, type SaveResult } from "./CommitField.tsx"
import { effortName } from "./Defaults.tsx"
import { EffortField, LaunchField, ModeField } from "./LaunchSheetFields.tsx"
import {
  type EffortDefaultsPatch,
  effortDefaultsPatch,
  type LaunchEfforts,
} from "./launch-effort.ts"
import { SettingsMore } from "./Rows.tsx"
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

function LaunchNotes({
  agent,
  permitted,
  effortPatch,
  efforts,
  nextEffort,
  refused,
}: {
  agent: NativeAgent
  permitted: boolean
  effortPatch: EffortDefaultsPatch | null
  efforts: LaunchEfforts
  nextEffort: EffortChoice
  refused: string | null
}) {
  const bypassLabel = permissionChoices(agent).find((choice) => choice.bypass)?.label ?? "Bypass"
  const priorEffort =
    efforts.planning !== efforts.implement
      ? `Planning ${effortName(efforts.planning)} · Implement ${effortName(efforts.implement)}`
      : effortName(efforts.planning)
  return (
    <>
      {permitted ? (
        <SettingsMore summary="How it starts">
          <p className="q-ag-note">
            {`An empty command or folder uses the one shown; arguments are added to every start. Saved permission defaults apply to new sessions. Changing an existing session to ${bypassLabel} asks you to confirm.`}
          </p>
        </SettingsMore>
      ) : (
        <p className="q-ag-note">Change these from QualityLayer or a browser it opened.</p>
      )}
      {effortPatch !== null ? (
        <p className="q-ag-note" role="status">
          Saving changes new sessions only: {priorEffort} → {effortName(nextEffort)}.
        </p>
      ) : null}
      {refused !== null ? (
        <p className="q-sr-err" role="alert" data-testid="launch-refused">
          Not saved: {refused}
        </p>
      ) : null}
    </>
  )
}

async function saveLaunchSettings(params: {
  saving: boolean
  patch: LaunchSettingsPatch | null
  onSave: (patch: LaunchSettingsPatch) => SaveResult
  onClose: () => void
  setSaving: (value: boolean) => void
  setRefused: (value: string | null) => void
}): Promise<void> {
  if (params.saving) return
  if (params.patch === null) return params.onClose()
  params.setSaving(true)
  params.setRefused(null)
  try {
    const refusal = await params.onSave(params.patch)
    if (typeof refusal === "string") return params.setRefused(refusal)
    params.onClose()
  } catch (error) {
    params.setRefused(error instanceof Error ? error.message : "Settings could not be saved.")
  } finally {
    params.setSaving(false)
  }
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
  permitted: boolean
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
  const disabled = !permitted || saving
  const blocked = Object.values(problems).some((problem) => problem !== null)
  const save = () =>
    void saveLaunchSettings({ saving, patch, onSave, onClose, setSaving, setRefused })
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
        <LaunchField label="Command" problem={problems.command}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              className={MONO_INPUT}
              value={draft.command}
              placeholder={health?.path ?? BINARIES[agent]}
              disabled={disabled}
              aria-invalid={problems.command !== null || undefined}
              aria-describedby={describedBy}
              spellCheck={false}
              onChange={(event) => set({ command: event.target.value })}
            />
          )}
        </LaunchField>
        <LaunchField label="Extra arguments" problem={problems.args}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-invalid={problems.args !== null || undefined}
              aria-describedby={describedBy}
              className={MONO_INPUT}
              value={draft.args}
              placeholder={ARGUMENT_EXAMPLE[agent]}
              disabled={disabled}
              spellCheck={false}
              onChange={(event) => set({ args: event.target.value })}
            />
          )}
        </LaunchField>
        {moves ? (
          <LaunchField label="Config folder" problem={problems.configDir}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                className={MONO_INPUT}
                value={draft.configDir}
                placeholder={DEFAULT_FOLDER[agent]}
                disabled={disabled}
                aria-invalid={problems.configDir !== null || undefined}
                aria-describedby={describedBy}
                spellCheck={false}
                onChange={(event) => set({ configDir: event.target.value })}
              />
            )}
          </LaunchField>
        ) : null}
        <ModeField
          agent={agent}
          value={draft.permMode}
          permission={permission}
          disabled={disabled}
          onChange={(permMode) => set({ permMode })}
        />
        <EffortField
          agent={agent}
          value={draft.effort}
          defaults={efforts}
          disabled={disabled}
          onChange={(effort) => {
            set({ effort })
            setEffortPicked(true)
          }}
        />
        <LaunchNotes
          agent={agent}
          permitted={permitted}
          effortPatch={effortPatch}
          efforts={efforts}
          nextEffort={draft.effort}
          refused={refused}
        />
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={disabled || blocked || patch === null} onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
