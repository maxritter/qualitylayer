import { type RefObject, useEffect, useState } from "react"
import { IMAGE_TYPES, TEXT_EXTENSIONS } from "../../core/interaction-docs/attachment-rules.ts"
import { FullscreenDialog } from "../reader/VisualParts.tsx"
import type { ShownFile } from "./Attachments.tsx"
import "./attachment-preview.css"

export const TEXT_PREVIEW_BYTES = 128 * 1024
export function attachmentPreviewKind(file: Pick<ShownFile, "name" | "type">) {
  if ((IMAGE_TYPES as readonly string[]).includes(file.type)) return "image"
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf"
  return file.type.startsWith("text/") ||
    TEXT_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))
    ? "text"
    : "other"
}

/** Read only the permitted prefix, including when a remote response omits its length. */
export async function previewBytes(file: ShownFile, limit: number, signal: AbortSignal) {
  if (file.blob) return new Uint8Array(await file.blob.slice(0, limit + 1).arrayBuffer())
  if (!file.url) throw new Error("The attachment is unavailable.")
  const response = await fetch(file.url, { signal })
  if (!response.ok || !response.body) throw new Error("Could not read this attachment.")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let count = 0
  try {
    while (count <= limit) {
      const next = await reader.read()
      if (next.done) break
      const chunk = next.value.subarray(0, limit + 1 - count)
      chunks.push(chunk)
      count += chunk.length
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const bytes = new Uint8Array(count)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

type PreviewResult = {
  text?: string
  clipped?: boolean
  error?: string
}

function useTextPreview(file: ShownFile, kind: ReturnType<typeof attachmentPreviewKind>) {
  const [result, setResult] = useState<PreviewResult>()
  useEffect(() => {
    if (kind !== "text") return
    const abort = new AbortController()
    let active = true
    setResult(undefined)
    void previewBytes(file, TEXT_PREVIEW_BYTES, abort.signal)
      .then((bytes) => {
        if (!active) return
        if (bytes.subarray(0, TEXT_PREVIEW_BYTES).includes(0))
          throw new Error("This file contains binary data. Download it to inspect it.")
        setResult({
          text: new TextDecoder().decode(bytes.subarray(0, TEXT_PREVIEW_BYTES)),
          clipped: bytes.length > TEXT_PREVIEW_BYTES,
        })
      })
      .catch((cause) => {
        if (active && !abort.signal.aborted)
          setResult({
            error: cause instanceof Error ? cause.message : "Could not read this attachment.",
          })
      })
    return () => {
      active = false
      abort.abort()
    }
  }, [file, kind])
  return { result, setResult }
}

function PreviewBody({
  file,
  kind,
  actual,
  result,
  onImageError,
}: {
  file: ShownFile
  kind: ReturnType<typeof attachmentPreviewKind>
  actual: boolean
  result: PreviewResult | undefined
  onImageError: () => void
}) {
  return (
    <div className="cm-preview-body" data-kind={kind} data-actual={actual}>
      {kind === "image" && !result?.error ? (
        <img src={file.url ?? undefined} alt={file.name} onError={onImageError} />
      ) : null}
      {result?.error ? <p role="alert">{result.error}</p> : null}
      {kind === "pdf" ? (
        <p>PDF preview is unavailable in this view. Download the file to inspect it.</p>
      ) : null}
      {kind === "text" && result?.text !== undefined ? (
        <>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users must be able to scroll long file contents */}
          <section tabIndex={0} aria-label={`Contents of ${file.name}`}>
            <pre>{result.text}</pre>
          </section>
          {result.clipped ? (
            <p className="cm-preview-note">
              Showing the first 128 KB. Download the file to read all of it.
            </p>
          ) : null}
        </>
      ) : null}
      {kind === "text" && !result ? <p role="status">Reading attachment…</p> : null}
      {kind === "other" ? (
        <p>This file type has no preview. Download the file to inspect it.</p>
      ) : null}
    </div>
  )
}

export function AttachmentPreview({
  file,
  close,
  returnFocus,
}: {
  file: ShownFile
  close: () => void
  returnFocus: RefObject<HTMLElement | null>
}) {
  const kind = attachmentPreviewKind(file)
  const { result, setResult } = useTextPreview(file, kind)
  const [actual, setActual] = useState(false)
  return (
    <FullscreenDialog
      open
      onClose={close}
      title={`Preview: ${file.name}`}
      returnFocus={returnFocus}
      testId="attachment-preview"
      style={{ width: "min(1400px,96vw)", height: "auto", maxHeight: "92vh" }}
      bar={
        <b className="cm-preview-title" title={file.name}>
          {file.name}
        </b>
      }
      actions={
        <>
          {kind === "image" ? (
            <button
              type="button"
              className="q-btn sm"
              aria-pressed={actual}
              onClick={() => setActual(!actual)}
            >
              {actual ? "Fit image" : "Actual size"}
            </button>
          ) : null}
          {file.url ? (
            <a className="q-btn sm" href={file.url} download={file.name}>
              Download file
            </a>
          ) : null}
        </>
      }
    >
      <PreviewBody
        file={file}
        kind={kind}
        actual={actual}
        result={result}
        onImageError={() =>
          setResult({ error: "Could not display this image. Download it to inspect it." })
        }
      />
    </FullscreenDialog>
  )
}
