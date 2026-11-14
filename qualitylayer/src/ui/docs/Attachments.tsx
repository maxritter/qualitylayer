// A comment's files: images as small pictures, other files as chips. In the composer each has a
// remove button; on a thread each opens the file.

import { FileTextIcon, PaperclipIcon, XIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { fileSize, IMAGE_TYPES } from "../../core/interaction-docs/attachment-rules.ts"
import { AttachmentPreview } from "./AttachmentPreview.tsx"

export type ShownFile = {
  name: string
  type: string
  size?: number
  /** Where the browser reads it; null while it cannot be shown (a teammate's file not fetched yet). */
  url: string | null
  /** Pending local bytes, read only when the person opens a preview. */
  blob?: Blob
}

function ImageThumbnail({
  file,
  label,
  open,
}: {
  file: ShownFile
  label: string
  open(event: React.MouseEvent<HTMLElement>): void
}) {
  const [failed, setFailed] = useState(false)
  return failed ? (
    <div className="cm-image-error" role="status">
      Image unavailable
    </div>
  ) : (
    <button
      type="button"
      className="cm-preview-trigger"
      aria-label={`Preview ${file.name}`}
      title={label}
      onClick={open}
    >
      <img
        src={file.url ?? undefined}
        alt={file.name}
        loading="lazy"
        width={132}
        height={84}
        onError={() => setFailed(true)}
      />
    </button>
  )
}

function AttachmentItem({
  file,
  open,
  remove,
}: {
  file: ShownFile
  open(event: React.MouseEvent<HTMLElement>): void
  remove?: () => void
}) {
  const size = file.size === undefined ? undefined : fileSize(file.size)
  const label = [file.name, size].filter(Boolean).join(" · ")
  const removal = remove ? (
    <button type="button" className="cm-x" aria-label={`Remove ${file.name}`} onClick={remove}>
      <XIcon className="size-3" aria-hidden="true" />
    </button>
  ) : null
  if (file.url === null)
    return (
      <li className="cm-file missing">
        <PaperclipIcon className="size-3.5" aria-hidden="true" />
        <span className="truncate">Couldn't fetch {file.name} yet</span>
      </li>
    )
  if ((IMAGE_TYPES as readonly string[]).includes(file.type))
    return (
      <li className="cm-img">
        <ImageThumbnail file={file} label={label} open={open} />
        <span className="cm-img-cap">
          <span className="truncate">{file.name}</span>
          <span>{size}</span>
        </span>
        {removal}
      </li>
    )
  return (
    <li className="cm-file">
      <FileTextIcon className="size-3.5 flex-none" aria-hidden="true" />
      <button
        type="button"
        className="cm-preview-trigger truncate"
        aria-label={`Preview ${file.name}`}
        title={label}
        onClick={open}
      >
        {file.name}
      </button>
      <span className="k">{file.type === "application/pdf" ? "PDF" : size}</span>
      {removal}
    </li>
  )
}

export function Attachments({
  files,
  onRemove,
}: {
  files: readonly ShownFile[]
  onRemove?: (index: number) => void
}) {
  const [selected, setSelected] = useState<ShownFile | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const preview =
    selected && files.some((file) => file.url === selected.url && file.name === selected.name)
      ? selected
      : null
  useEffect(() => {
    if (selected && !files.some((file) => file.url === selected.url && file.name === selected.name))
      setSelected(null)
  }, [files, selected])
  const show = (event: React.MouseEvent<HTMLElement>, file: ShownFile) => {
    opener.current = event.currentTarget
    setSelected(file)
  }
  if (files.length === 0) return null
  return (
    <>
      <ul className="cm-files" aria-label="Attached files">
        {files.map((file, index) => (
          <AttachmentItem
            key={`${file.name}:${file.size}:${file.url}`}
            file={file}
            open={(event) => show(event, file)}
            remove={onRemove ? () => onRemove(index) : undefined}
          />
        ))}
      </ul>
      {preview ? (
        <AttachmentPreview
          key={`${preview.name}:${preview.url}`}
          file={preview}
          close={() => setSelected(null)}
          returnFocus={opener}
        />
      ) : null}
    </>
  )
}

/** Files waiting in the composer, with a picture's preview made here and released when it goes. */
export function usePendingFiles(files: readonly File[]): ShownFile[] {
  const addresses = useRef(new Map<File, string>())
  const [urls, setUrls] = useState(new Map<File, string>())
  useEffect(() => {
    const next = new Map(addresses.current)
    let changed = false
    for (const [file, url] of next)
      if (!files.includes(file)) {
        URL.revokeObjectURL(url)
        next.delete(file)
        changed = true
      }
    for (const file of files)
      if (!next.has(file)) {
        next.set(file, URL.createObjectURL(file))
        changed = true
      }
    if (changed) {
      addresses.current = next
      setUrls(next)
    }
  }, [files])
  useEffect(
    () => () => {
      for (const url of addresses.current.values()) URL.revokeObjectURL(url)
      addresses.current.clear()
    },
    [],
  )
  return useMemo(
    () =>
      files.map((file) => ({
        name: file.name,
        type: file.type,
        size: file.size,
        url: urls.get(file) ?? null,
        blob: file,
      })),
    [files, urls],
  )
}
