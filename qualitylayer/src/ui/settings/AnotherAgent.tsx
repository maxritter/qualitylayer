import { BracesIcon, TerminalIcon } from "lucide-react"
import { type FormEvent, useEffect, useEffectEvent, useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { validOtherAgentArgs, validOtherAgentProgram } from "../../core/config-values.ts"
import type { Config } from "../api.ts"
import { joinArguments, splitArguments } from "./arguments.ts"
import { MONO_INPUT, type SaveResult } from "./CommitField.tsx"
import { SettingRow, SettingsGroup } from "./Rows.tsx"

type Agent = Config["otherAgent"]
type Draft = { program: string; args: string }
type Problems = { program: boolean; args: boolean }
const NO_PROBLEMS: Problems = { program: false, args: false }

function sameAgent(left: Agent, right: Agent): boolean {
  return (
    left.program === right.program &&
    left.args.length === right.args.length &&
    left.args.every((arg, index) => arg === right.args[index])
  )
}

function edit(agent: Agent): Draft {
  return { program: agent.program, args: joinArguments(agent.args) }
}

function read(draft: Draft): Agent {
  return { program: draft.program.trim(), args: splitArguments(draft.args.trim()) }
}

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

export function AnotherAgent({
  config,
  permitted,
  onChange,
}: {
  config: Config
  permitted: boolean
  onChange: (patch: unknown) => SaveResult
}) {
  const [draft, setDraft] = useState(() => edit(config.otherAgent))
  const [kept, setKept] = useState(config.otherAgent)
  const [problems, setProblems] = useState(NO_PROBLEMS)
  const [refused, setRefused] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const requestedAgain = useRef(false)
  const pointerInside = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const composing = useRef(false)
  const sawConfig = useRef(config.otherAgent)
  const currentDraft = useRef(draft)
  const currentKept = useRef(kept)
  const canSave = useRef(permitted)
  canSave.current = permitted
  const dirty = !sameAgent(read(draft), kept)

  useEffect(() => {
    const next = config.otherAgent
    if (sameAgent(sawConfig.current, next)) return
    sawConfig.current = next
    if (inFlight.current || sameAgent(currentKept.current, next)) return
    const clean = sameAgent(read(currentDraft.current), currentKept.current)
    currentKept.current = next
    setKept(next)
    if (clean) {
      currentDraft.current = edit(next)
      setDraft(currentDraft.current)
      setConfirmed(false)
    }
  }, [config.otherAgent])

  const update = (field: keyof Draft, value: string) => {
    currentDraft.current = { ...currentDraft.current, [field]: value }
    setDraft(currentDraft.current)
    setProblems((previous) => ({ ...previous, [field]: false }))
    setRefused(false)
    setConfirmed(false)
  }

  const save = async () => {
    if (!canSave.current) return
    if (inFlight.current) {
      requestedAgain.current = true
      return
    }
    const next = read(currentDraft.current)
    if (sameAgent(next, currentKept.current)) return
    const invalid = {
      program: !validOtherAgentProgram(next.program),
      args: !validOtherAgentArgs(next.args),
    }
    setProblems(invalid)
    if (invalid.program || invalid.args) return
    inFlight.current = true
    setSaving(true)
    setConfirmed(false)
    setRefused(false)
    try {
      const refusal = await onChange({ otherAgent: next })
      if (typeof refusal === "string") {
        setRefused(true)
        return
      }
      currentKept.current = next
      setKept(next)
      setConfirmed(sameAgent(read(currentDraft.current), next))
    } catch {
      setRefused(true)
    } finally {
      inFlight.current = false
      setSaving(false)
      if (requestedAgain.current) {
        requestedAgain.current = false
        if (!sameAgent(read(currentDraft.current), next)) void save()
      }
    }
  }

  const leave = useEffectEvent((event: PointerEvent) => {
    if (!(event.target instanceof Node)) return
    if (!form.current?.contains(event.target) && !form.current?.contains(document.activeElement)) {
      void save()
    }
  })
  useEffect(() => {
    const outsidePointer = (event: PointerEvent) => leave(event)
    document.addEventListener("pointerdown", outsidePointer, true)
    return () => document.removeEventListener("pointerdown", outsidePointer, true)
  }, [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void save()
  }
  return (
    <SettingsGroup title="Another agent" testId="another-agent">
      <form
        ref={form}
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
        onPointerDownCapture={() => {
          pointerInside.current = true
          setTimeout(() => {
            pointerInside.current = false
          }, 0)
        }}
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget)) return
          if (event.relatedTarget === null && pointerInside.current) return
          void save()
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
          {refused && (
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
