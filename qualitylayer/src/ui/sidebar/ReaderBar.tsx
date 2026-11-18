// The one slim bar above a file opened from the Files tab (the agent's version, its research, a page the
// agent made): Back to the step's own page, the file's name, then icon buttons with tooltips: the
// document's sections (On this page), its risky points, Copy, and Open and Reveal. It is the only bar:
// the document's reader draws its tools into the slot below instead of in a row that scrolls away
// under this one, so the outline stays one click from any scroll position.

import { ArrowLeftIcon } from "lucide-react"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { TaskFile } from "../../core/docs/names.ts"
import type { Api, TaskDetail } from "../api.ts"
import { fullPathOf } from "../DocPathChip.tsx"
import { FileActions } from "./FileActions.tsx"

/** The bar as the document's reader sees it: where its tools go, and the way to copy the path. */
export type ReaderBarSlot = {
  element: HTMLElement
  copyPath: (() => void) | null
  /** A reader has put its tools in the slot, so the bar leaves its own Copy path out. */
  claimed: boolean
}

let slot: ReaderBarSlot | null = null
const listeners = new Set<() => void>()
const publish = (next: ReaderBarSlot | null) => {
  slot = next
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The bar's slot while one is on the page; null otherwise. */
export const useReaderBarSlot = (): ReaderBarSlot | null =>
  useSyncExternalStore(
    subscribe,
    () => slot,
    () => null,
  )

/** A reader that draws its tools in the bar says so, and says when it stops. */
export function useClaimReaderBar(claiming: boolean): void {
  useEffect(() => {
    if (!claiming || slot === null) return
    publish({ ...slot, claimed: true })
    return () => {
      if (slot !== null) publish({ ...slot, claimed: false })
    }
  }, [claiming])
}

export function ReaderBar({
  detail,
  name,
  file,
  back,
  api,
  onCopy,
}: {
  detail: Pick<TaskDetail, "id" | "dir">
  /** What the bar names: the file, or the page's title. */
  name: string
  /** The file in view; a page the agent made has none to copy, open or reveal. */
  file?: TaskFile
  back: { label: string; onClick: () => void }
  api: Pick<Api, "openFile">
  onCopy: (text: string, note: string) => void
}) {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const full = file !== undefined ? fullPathOf(detail, file.name) : null
  const copier = useRef(onCopy)
  copier.current = onCopy
  // The slot lives as long as the bar; the path to copy follows the file.
  useEffect(() => {
    if (element === null) return
    publish({
      element,
      copyPath: full !== null ? () => copier.current(full, "Copied the path") : null,
      claimed: slot?.claimed ?? false,
    })
    return () => publish(null)
  }, [element, full])
  const claimed = useReaderBarSlot()?.claimed === true
  return (
    <div className="rs-crumb" data-testid="reader-bar">
      <button
        type="button"
        className="back"
        onClick={back.onClick}
        aria-label={`Back to ${back.label}`}
      >
        <ArrowLeftIcon aria-hidden="true" />
        {name === "reviews/plan.md" ? `Back to ${back.label}` : back.label}
      </button>
      <span className="fname" title={name}>
        {name}
      </span>
      <span className="rs-tools" ref={setElement} data-testid="reader-tools" />
      {file !== undefined ? (
        <span className="acts">
          <FileActions
            detail={detail}
            file={file}
            api={api}
            onCopy={onCopy}
            icons
            withoutCopyPath={claimed}
          />
        </span>
      ) : null}
    </div>
  )
}
