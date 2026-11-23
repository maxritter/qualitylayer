import {
  CheckCircle2Icon,
  DownloadIcon,
  FileTextIcon,
  GlobeIcon,
  HashIcon,
  ImageIcon,
  ShareIcon,
  XIcon,
} from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { ExportFile, ExportFormat, ExportInput } from "../../core/export/types.ts"
import "./export.css"
import { type DownloadOutcome, downloadExport } from "./download-export.ts"
import { exportName } from "./filename.ts"

export { downloadExport }
export type ExportWriter = (input: ExportInput, signal?: AbortSignal) => Promise<ExportFile>
export type ExportScope = "current" | "all"
type Props = {
  title: string
  kind: "artifact" | "plan" | "review"
  pages?: number
  disabled?: boolean
  write?: ExportWriter
  prepare: (format: ExportFormat, scope: ExportScope, signal: AbortSignal) => Promise<ExportInput>
}

const formats = {
  pdf: { title: "PDF", hint: "Document", Icon: FileTextIcon },
  png: { title: "Images", hint: "PNG per page", Icon: ImageIcon },
  html: { title: "Web page", hint: "Opens offline", Icon: GlobeIcon },
  markdown: { title: "Markdown", hint: "With pictures", Icon: HashIcon },
}

const kindLabels = { plan: "Plan", review: "Review" } as const

function exportFilename(title: string, format: ExportFormat, scope: ExportScope, pages: number) {
  const isZip = format === "markdown" || (format === "png" && scope === "all" && pages > 1)
  return `${exportName(title)}.${isZip ? "zip" : format}`
}

function exportSummaryLabel(
  kind: Props["kind"],
  scope: ExportScope,
  format: ExportFormat,
  pages: number,
) {
  if (kind !== "artifact") return kindLabels[kind]
  const count = scope === "all" ? pages : 1
  const unit = format === "png" ? "image" : "page"
  return `${count} ${unit}${count > 1 ? "s" : ""}`
}

function FormatOptions({
  id,
  choices,
  format,
  busy,
  onChange,
}: {
  id: string
  choices: ExportFormat[]
  format: ExportFormat
  busy: boolean
  onChange: (choice: ExportFormat) => void
}) {
  return (
    <fieldset className="q-export-formats" disabled={busy}>
      <legend className="sr-only">Format</legend>
      {choices.map((choice) => {
        const option = formats[choice]
        return (
          <label key={choice} className="q-export-format" data-selected={format === choice}>
            <input
              type="radio"
              name={`${id}-format`}
              value={choice}
              checked={format === choice}
              onChange={() => onChange(choice)}
            />
            <option.Icon aria-hidden="true" />
            <b>{option.title}</b>
            <small>{option.hint}</small>
          </label>
        )
      })}
    </fieldset>
  )
}

function ScopeOptions({
  id,
  pages,
  scope,
  busy,
  onChange,
}: {
  id: string
  pages: number
  scope: ExportScope
  busy: boolean
  onChange: (value: ExportScope) => void
}) {
  return (
    <fieldset className="q-export-scope" disabled={busy}>
      <legend>Pages</legend>
      <div>
        {(
          [
            ["current", "This page"],
            ["all", `All ${pages}`],
          ] as const
        ).map(([value, label]) => (
          <label key={value} data-selected={scope === value}>
            <input
              type="radio"
              name={`${id}-scope`}
              value={value}
              checked={scope === value}
              onChange={() => onChange(value)}
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function ExportAction({
  done,
  result,
  busy,
  format,
  again,
  onReset,
  onRun,
}: {
  done: string
  result: DownloadOutcome | ""
  busy: boolean
  format: ExportFormat
  again: React.RefObject<HTMLButtonElement | null>
  onReset: () => void
  onRun: () => void
}) {
  if (done) {
    return (
      <div className="q-export-done" role="status">
        <CheckCircle2Icon aria-hidden="true" />
        <span>{result === "saved" ? "Saved" : "Download started"}</span>
        <Button ref={again} variant="ghost" size="sm" onClick={onReset}>
          Export again
        </Button>
      </div>
    )
  }
  const label = busy
    ? "Exporting…"
    : `Export ${format === "png" ? "images" : formats[format].title}`
  return (
    <Button className="q-export-go" aria-disabled={busy} aria-busy={busy} onClick={onRun}>
      <DownloadIcon aria-hidden="true" />
      {label}
    </Button>
  )
}

type ExportAttempt =
  | { status: "aborted" }
  | { status: "error"; message: string }
  | { status: "done"; filename: string; outcome: DownloadOutcome }

async function runExportSteps(
  prepare: Props["prepare"],
  write: ExportWriter,
  format: ExportFormat,
  scope: ExportScope,
  signal: AbortSignal,
) {
  const abortError = () => new DOMException("Export cancelled", "AbortError")
  const input = await prepare(format, scope, signal)
  if (signal.aborted) throw abortError()
  const file = await write(input, signal)
  if (signal.aborted) throw abortError()
  const outcome = await downloadExport(file, signal)
  if (signal.aborted) throw abortError()
  return { filename: file.name, outcome }
}

async function performExport(
  prepare: Props["prepare"],
  write: ExportWriter,
  format: ExportFormat,
  scope: ExportScope,
  signal: AbortSignal,
): Promise<ExportAttempt> {
  try {
    const done = await runExportSteps(prepare, write, format, scope, signal)
    return { status: "done", ...done }
  } catch (cause) {
    if (signal.aborted) return { status: "aborted" }
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "Could not export. Try again.",
    }
  }
}

function useExportRunner({
  write,
  prepare,
  format,
  scope,
}: {
  write: ExportWriter | undefined
  prepare: Props["prepare"]
  format: ExportFormat
  scope: ExportScope
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState("")
  const [result, setResult] = useState<DownloadOutcome | "">("")
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  const reset = () => {
    setError("")
    setDone("")
    setResult("")
  }
  const cancel = () => {
    pending.current?.abort()
    pending.current = null
    setBusy(false)
  }
  const run = async () => {
    if (!write || busy) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    reset()
    const attempt = await performExport(prepare, write, format, scope, controller.signal)
    if (pending.current === controller) {
      pending.current = null
      setBusy(false)
    }
    if (attempt.status === "error") setError(attempt.message)
    if (attempt.status === "done") {
      setResult(attempt.outcome)
      if (attempt.outcome !== "cancelled") setDone(attempt.filename)
    }
  }
  return { busy, error, done, result, reset, cancel, run }
}

export function ExportCard({ title, kind, pages = 1, disabled, write, prepare }: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<ExportFormat>("pdf")
  const [scope, setScope] = useState<ExportScope>("all")
  const again = useRef<HTMLButtonElement | null>(null)
  const runner = useExportRunner({ write, prepare, format, scope })
  useEffect(() => {
    if (runner.done) again.current?.focus()
  }, [runner.done])
  const choices: ExportFormat[] =
    kind === "artifact" ? ["pdf", "png", "html"] : ["pdf", "markdown", "html"]
  const selected = formats[format]
  const filename = exportFilename(title, format, scope, pages)
  const changeOpen = (next: boolean) => {
    if (!next) runner.cancel()
    setOpen(next)
  }
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || !write}
            title={!write ? "Export is available in the App" : undefined}
            data-testid="export-trigger"
          />
        }
      >
        <ShareIcon aria-hidden="true" />
        Export
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={8}
        className="q-export"
        aria-labelledby={`${id}-title`}
      >
        <div className="q-export-head">
          <b id={`${id}-title`}>Export</b>
          <span title={title}>{title}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close export"
            onClick={() => changeOpen(false)}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
        <FormatOptions
          id={id}
          choices={choices}
          format={format}
          busy={runner.busy}
          onChange={(choice) => {
            setFormat(choice)
            runner.reset()
          }}
        />
        {kind === "artifact" && pages > 1 ? (
          <ScopeOptions
            id={id}
            pages={pages}
            scope={scope}
            busy={runner.busy}
            onChange={(value) => {
              setScope(value)
              runner.reset()
            }}
          />
        ) : null}
        <div className="q-export-file">
          <selected.Icon aria-hidden="true" />
          <span title={runner.done || filename}>{runner.done || filename}</span>
          <small>{exportSummaryLabel(kind, scope, format, pages)}</small>
        </div>
        {runner.error ? (
          <p className="q-export-error" role="alert">
            {runner.error}
          </p>
        ) : null}
        {runner.result === "cancelled" ? <p role="status">Save cancelled</p> : null}
        <ExportAction
          done={runner.done}
          result={runner.result}
          busy={runner.busy}
          format={format}
          again={again}
          onReset={runner.reset}
          onRun={() => void runner.run()}
        />
      </PopoverContent>
    </Popover>
  )
}
