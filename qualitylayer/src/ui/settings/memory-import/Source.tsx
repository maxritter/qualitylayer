import { type MutableRefObject, useEffect, useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { PilotSourceInput, PilotSourceKind } from "../../../pilot-memory-contracts.ts"
import { api } from "../../api.ts"
import { Disclosure } from "../../kit/Fold.tsx"
import { offersHostActions } from "../../machines/framed.ts"
import { pilotFile } from "./files.ts"

export const sourceNames: Record<PilotSourceKind, string> = {
  folder: "Pilot memory folder",
  database: "Pilot SQLite database",
  backup: "Pilot backup",
  files: "Exported memory files",
}
const sourceHints: Record<PilotSourceKind, string> = {
  folder: "Read the local database and private knowledge together.",
  database: "Choose a .db file; add private knowledge separately.",
  backup: "Use a .backup.json or .backup.gz archive.",
  files: "Use existing Markdown or JSONL exports.",
}
export const importError = (cause: unknown) =>
  cause instanceof Error ? cause.message : "The request did not finish. Try again."

async function browseSourceFolder(params: {
  value: string
  controller: MutableRefObject<AbortController | null>
  setBusy: (busy: boolean) => void
  setError: (error: string | null) => void
  onChange: (path: string) => void
}): Promise<void> {
  const control = new AbortController()
  params.controller.current = control
  params.setBusy(true)
  params.setError(null)
  try {
    const picked = await api.pickProjectFolder(params.value || undefined, control.signal)
    if (!control.signal.aborted && picked.kind === "selected") params.onChange(picked.folder.path)
  } catch (cause) {
    if (!control.signal.aborted) params.setError(importError(cause))
  } finally {
    if (!control.signal.aborted) params.setBusy(false)
  }
}

export function SourcePath({
  label,
  value,
  onChange,
  folder = true,
  disabled = false,
}: {
  label: string
  value: string
  onChange: (path: string) => void
  folder?: boolean
  disabled?: boolean
}) {
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const locked = disabled || busy
  return (
    <div className="q-pilot-path">
      <label htmlFor={id}>{label}</label>
      <div>
        <Input
          id={id}
          value={value}
          placeholder={folder ? "Absolute folder path" : "Absolute file path"}
          spellCheck={false}
          autoComplete="off"
          disabled={locked}
          onChange={(event) => {
            setError(null)
            onChange(event.target.value)
          }}
        />
        {folder && offersHostActions() ? (
          <Button
            type="button"
            variant="outline"
            disabled={locked}
            onClick={() =>
              void browseSourceFolder({ value, controller, setBusy, setError, onChange })
            }
          >
            {busy ? "Choosing…" : "Choose folder"}
          </Button>
        ) : null}
      </div>
      {error ? <p role="alert">{error} Enter the absolute path to continue.</p> : null}
    </div>
  )
}

export function AdditionalFolders({
  input,
  onChange,
  busy,
}: {
  input: PilotSourceInput
  onChange: (input: PilotSourceInput) => void
  busy: boolean
}) {
  const [projectPath, setProjectPath] = useState("")
  return (
    <>
      {input.kind === "database" ? (
        <>
          <p>
            A database does not contain private knowledge documents. Choose their memory folder to
            include them.
          </p>
          <SourcePath
            label="Private knowledge memory folder (optional)"
            value={input.knowledgeFolder ?? ""}
            disabled={busy}
            onChange={(path) => onChange({ ...input, knowledgeFolder: path || undefined })}
          />
        </>
      ) : null}
      <Disclosure className="q-pilot-details" head="Project knowledge">
        <p>Add .pilot/knowledge and legacy exports from a checkout you choose.</p>
        <SourcePath
          label="Checkout folder"
          value={projectPath}
          onChange={setProjectPath}
          disabled={busy}
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy || !projectPath.trim()}
          onClick={() => {
            onChange({
              ...input,
              projectFolders: [...new Set([...(input.projectFolders ?? []), projectPath.trim()])],
            })
            setProjectPath("")
          }}
        >
          Add folder
        </Button>
        {input.projectFolders?.map((path) => (
          <div className="q-pilot-folder" key={path}>
            <code>{path}</code>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() =>
                onChange({
                  ...input,
                  projectFolders: input.projectFolders?.filter((item) => item !== path),
                })
              }
            >
              Remove folder
            </Button>
          </div>
        ))}
      </Disclosure>
    </>
  )
}

function validatePilotFiles(chosen: File[]): void {
  const totalBytes = chosen.reduce((sum, file) => sum + file.size, 0)
  if (chosen.length > 100 || totalBytes > 2 * 1024 * 1024)
    throw new Error("Choose up to 100 files, at most 2 MB in total.")
  if (chosen.some((file) => !/\.(jsonl|md)$/i.test(file.name)))
    throw new Error("Choose Pilot .jsonl or .md memory files.")
}

async function readSelectedPilotFiles(params: {
  chosen: File[]
  input: PilotSourceInput
  sequence: MutableRefObject<number>
  onChange: (input: PilotSourceInput) => void
  setError: (error: string | null) => void
  setReading: (reading: boolean) => void
}): Promise<void> {
  const token = ++params.sequence.current
  params.setError(null)
  params.setReading(true)
  params.onChange({ ...params.input, files: undefined })
  try {
    if (!params.chosen.length) return
    validatePilotFiles(params.chosen)
    const loaded = await Promise.all(params.chosen.map(pilotFile))
    const next = { ...params.input, files: loaded }
    if (new TextEncoder().encode(JSON.stringify(next)).byteLength > 3 * 1024 * 1024)
      throw new Error("These files are too large after encoding. Choose a smaller batch.")
    if (token === params.sequence.current) params.onChange(next)
  } catch (cause) {
    if (token === params.sequence.current) params.setError(importError(cause))
  } finally {
    if (token === params.sequence.current) params.setReading(false)
  }
}

export function PilotSource({
  input,
  onChange,
  busy,
  onScan,
  onCancel,
}: {
  input: PilotSourceInput
  onChange: (input: PilotSourceInput) => void
  busy: boolean
  onScan: () => void
  onCancel: () => void
}) {
  const id = useId()
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sequence = useRef(0)
  useEffect(
    () => () => {
      sequence.current++
    },
    [],
  )
  const locked = busy || reading
  const missingSource = input.kind === "files" ? !input.files?.length : !input.path?.trim()
  return (
    <>
      <div className="q-pilot-body" id="pilot-source">
        <p>
          Bring your saved knowledge into QualityLayer. Choose what to import before anything is
          saved.
        </p>
        <fieldset className="q-pilot-sources" disabled={locked}>
          <legend>Memory source</legend>
          {(Object.keys(sourceNames) as PilotSourceKind[]).map((kind) => (
            <label key={kind}>
              <input
                type="radio"
                name={`${id}-source`}
                checked={input.kind === kind}
                onChange={() => {
                  sequence.current++
                  setError(null)
                  onChange({ kind })
                }}
              />
              <span>
                <strong>{sourceNames[kind]}</strong>
                <span>{sourceHints[kind]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {input.kind === "files" ? (
          <label className="q-memory-file" htmlFor={`${id}-files`}>
            Memory files
            <Input
              id={`${id}-files`}
              type="file"
              accept=".jsonl,.md"
              multiple
              disabled={locked}
              onChange={(event) =>
                void readSelectedPilotFiles({
                  chosen: Array.from(event.target.files ?? []),
                  input,
                  sequence,
                  onChange,
                  setError,
                  setReading,
                })
              }
            />
            {input.files?.length ? <span>{input.files.length} files selected</span> : null}
          </label>
        ) : (
          <SourcePath
            label={sourceNames[input.kind]}
            value={input.path ?? ""}
            folder={input.kind === "folder"}
            disabled={busy}
            onChange={(path) => onChange({ ...input, path })}
          />
        )}
        <p className="q-pilot-muted">
          Paths refer to the computer running QualityLayer
          {offersHostActions() ? "." : ", including when you view it from another computer."}{" "}
          Nothing is read until you scan.
        </p>
        <p>The import stays on this computer. Pilot Shell files stay as they are.</p>
        <AdditionalFolders input={input} onChange={onChange} busy={locked} />
        <Disclosure className="q-pilot-details" head="What is included">
          <p>
            Saved observations, knowledge documents and selected session learnings. Prompts,
            transcripts, pending tool activity, credentials and settings are left out.
          </p>
        </Disclosure>
        {reading ? <p role="status">Reading selected exports…</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </div>
      <footer className="q-pilot-actions">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" disabled={locked || missingSource} onClick={onScan}>
          {busy ? "Scanning…" : "Scan memories"}
        </Button>
      </footer>
    </>
  )
}
