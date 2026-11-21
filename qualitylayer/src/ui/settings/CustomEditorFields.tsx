import { BracesIcon, TerminalIcon } from "lucide-react"
import { type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Config } from "../api.ts"
import { MONO_INPUT } from "./CommitField.tsx"
import { SettingRow } from "./Rows.tsx"

export function CustomEditorFields({
  initial,
  permitted,
  save,
}: {
  initial: Config["customEditor"]
  permitted: boolean
  save: (patch: unknown) => unknown
}) {
  const [program, setProgram] = useState(initial.program)
  const [args, setArgs] = useState(initial.args.join("\n"))
  const [message, setMessage] = useState("")
  const [saving, setSaving] = useState(false)
  const disabled = !permitted || saving
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (disabled || !program.trim()) return
    setSaving(true)
    try {
      const result = await save({
        editor: "custom",
        customEditor: { program: program.trim(), args: args.split(/\r?\n/).filter(Boolean) },
      })
      setMessage(typeof result === "string" ? result : "Saved")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the editor. Try again.")
    } finally {
      setSaving(false)
    }
  }
  return (
    <form className="q-editor-fields" onSubmit={submit} onChange={() => setMessage("")}>
      <SettingRow label="Program" hint="Executable name or path" icon={<TerminalIcon size={15} />}>
        <Input
          aria-label="Program"
          className={MONO_INPUT}
          placeholder="/usr/bin/open"
          value={program}
          disabled={disabled}
          onChange={(event) => setProgram(event.target.value)}
        />
      </SettingRow>
      <SettingRow
        label="Arguments"
        hint="One per line. QualityLayer adds the file or folder path last."
        icon={<BracesIcon size={15} />}
      >
        <textarea
          className={MONO_INPUT}
          aria-label="Arguments"
          rows={3}
          placeholder={"-a\nTextEdit"}
          value={args}
          disabled={disabled}
          onChange={(event) => setArgs(event.target.value)}
        />
        <div className="q-editor-actions">
          <span role="status">{message}</span>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={disabled || !program.trim() || message === "Saved"}
          >
            Save editor
          </Button>
        </div>
      </SettingRow>
    </form>
  )
}
