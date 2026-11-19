import { BracesIcon, TerminalIcon } from "lucide-react"
import { type FormEvent, useEffect, useEffectEvent, useId, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Config } from "../api.ts"
import { MONO_INPUT } from "./CommitField.tsx"
import { SettingRow, SettingsGroup } from "./Rows.tsx"
import { useAgentSave, type WriteAgentSetting } from "./useAgentSave.ts"

function AgentField({
  name,
  value,
  placeholder,
  disabled,
  invalid,
  error,
  change,
}: {
  name: string
  value: string
  placeholder: string
  disabled: boolean
  invalid: boolean
  error: string
  change: (value: string) => void
}) {
  const note = useId()
  return (
    <div className="q-field">
      <Input
        type="text"
        className={MONO_INPUT}
        aria-label={name}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? note : undefined}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => change(event.target.value)}
      />
      {invalid && (
        <span className="q-sr-err" role="alert" id={note}>
          {error}
        </span>
      )}
    </div>
  )
}

function useFormExit(save: () => Promise<void>) {
  const form = useRef<HTMLFormElement>(null)
  const inside = useRef(false)
  const leave = useEffectEvent((event: PointerEvent) => {
    const element = form.current
    if (
      element &&
      event.target instanceof Node &&
      !element.contains(event.target) &&
      !element.contains(document.activeElement)
    )
      void save()
  })
  useEffect(() => {
    const onPointer = (event: PointerEvent) => leave(event)
    document.addEventListener("pointerdown", onPointer, true)
    return () => document.removeEventListener("pointerdown", onPointer, true)
  }, [])
  return {
    ref: form,
    onPointerDownCapture() {
      inside.current = true
      setTimeout(() => {
        inside.current = false
      }, 0)
    },
    onBlur(event: React.FocusEvent<HTMLFormElement>) {
      if (event.currentTarget.contains(event.relatedTarget)) return
      if (event.relatedTarget === null && inside.current) return
      void save()
    },
  }
}

export function AnotherAgent({
  config,
  permitted,
  onChange,
}: {
  config: Config
  permitted: boolean
  onChange: WriteAgentSetting
}) {
  const { draft, dirty, update, save, problems, state } = useAgentSave(
    config.otherAgent,
    permitted,
    onChange,
  )
  const exit = useFormExit(save)
  const composing = useRef(false)
  const saving = state === "saving"
  const confirmed = state === "saved" && !dirty
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void save()
  }
  return (
    <SettingsGroup title="Another agent" testId="another-agent">
      <form
        {...exit}
        className="q-other-agent"
        onSubmit={submit}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={() => {
          composing.current = false
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing))
            event.preventDefault()
        }}
      >
        <SettingRow
          label="Program"
          icon={<TerminalIcon className="size-[15px]" />}
          hint={
            permitted
              ? "Enter the command name or path for the agent’s terminal."
              : "Change this from QualityLayer or a browser it opened."
          }
        >
          <AgentField
            name="Another agent program"
            value={draft.program}
            placeholder="/opt/homebrew/bin/aider"
            disabled={!permitted}
            invalid={problems.program}
            error="Enter a command or path without control characters (up to 4,096 characters)."
            change={(value) => update("program", value)}
          />
        </SettingRow>
        <SettingRow
          label="Arguments"
          icon={<BracesIcon className="size-[15px]" />}
          hint="Optional flags and values passed to the program each time it starts."
        >
          <AgentField
            name="Another agent arguments"
            value={draft.args}
            placeholder="--model sonnet"
            disabled={!permitted}
            invalid={problems.args}
            error="Use up to 128 arguments without NUL characters."
            change={(value) => update("args", value)}
          />
        </SettingRow>
        <footer className="q-other-agent-save">
          <span aria-live="polite" role={saving || confirmed ? "status" : undefined}>
            {saving ? "Saving…" : confirmed ? "Saved" : ""}
          </span>
          {state === "refused" && (
            <span className="q-sr-err" role="alert">
              Could not save. Try again.
            </span>
          )}
          <Button size="sm" type="submit" disabled={!permitted || !dirty || saving}>
            Save
          </Button>
        </footer>
      </form>
    </SettingsGroup>
  )
}
