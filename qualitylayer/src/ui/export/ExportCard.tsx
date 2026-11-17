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
import { exportName } from "./filename.ts"

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

export function downloadExport(file: ExportFile) {
  const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: file.type }))
  const link = document.createElement("a")
  link.href = url
  link.download = file.name
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function ExportCard({ title, kind, pages = 1, disabled, write, prepare }: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<ExportFormat>("pdf")
  const [scope, setScope] = useState<ExportScope>("all")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState("")
  const pending = useRef<AbortController | null>(null)
  const again = useRef<HTMLButtonElement | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  useEffect(() => {
    if (done) again.current?.focus()
  }, [done])
  const choices: ExportFormat[] =
    kind === "artifact" ? ["pdf", "png", "html"] : ["pdf", "markdown", "html"]
  const selected = formats[format]
  const extension =
    format === "markdown" || (format === "png" && scope === "all" && pages > 1) ? "zip" : format
  const filename = `${exportName(title)}.${extension}`
  const reset = () => {
    setError("")
    setDone("")
  }
  const changeOpen = (next: boolean) => {
    if (!next) {
      pending.current?.abort()
      pending.current = null
      setBusy(false)
    }
    setOpen(next)
  }
  const run = async () => {
    if (!write || busy) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    reset()
    try {
      const input = await prepare(format, scope, controller.signal)
      if (controller.signal.aborted) return
      const file = await write(input, controller.signal)
      if (controller.signal.aborted) return
      downloadExport(file)
      setDone(file.name)
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Could not export. Try again.")
    } finally {
      if (pending.current === controller) {
        pending.current = null
        setBusy(false)
      }
    }
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
                  onChange={() => {
                    setFormat(choice)
                    reset()
                  }}
                />
                <option.Icon aria-hidden="true" />
                <b>{option.title}</b>
                <small>{option.hint}</small>
              </label>
            )
          })}
        </fieldset>
        {kind === "artifact" && pages > 1 ? (
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
                    onChange={() => {
                      setScope(value)
                      reset()
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <div className="q-export-file">
          <selected.Icon aria-hidden="true" />
          <span title={done || filename}>{done || filename}</span>
          <small>
            {kind === "artifact"
              ? `${scope === "all" ? pages : 1} ${format === "png" ? "image" : "page"}${scope === "all" && pages > 1 ? "s" : ""}`
              : kind === "plan"
                ? "Plan"
                : "Review"}
          </small>
        </div>
        {error ? (
          <p className="q-export-error" role="alert">
            {error}
          </p>
        ) : null}
        {done ? (
          <div className="q-export-done" role="status">
            <CheckCircle2Icon aria-hidden="true" />
            <span>Download started</span>
            <Button ref={again} variant="ghost" size="sm" onClick={reset}>
              Export again
            </Button>
          </div>
        ) : (
          <Button
            className="q-export-go"
            aria-disabled={busy}
            aria-busy={busy}
            onClick={() => void run()}
          >
            <DownloadIcon aria-hidden="true" />
            {busy ? "Exporting…" : `Export ${format === "png" ? "images" : selected.title}`}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
