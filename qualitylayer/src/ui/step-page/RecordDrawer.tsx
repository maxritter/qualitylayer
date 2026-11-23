// A raw record of the agent's, opened from the one spot it explains: a read-only drawer from the
// right with Copy path and Open in editor. Esc closes the drawer.

import {
  CopyIcon,
  ExternalLinkIcon,
  ListChecksIcon,
  LockIcon,
  ScrollTextIcon,
  XIcon,
} from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { trimEndCharacters } from "../../core/text-boundaries.ts"
import { offersHostActions } from "../machines/framed.ts"
import { terminalText } from "../reader/terminal-text.ts"
import type { StepLive } from "./live.ts"
import type { CardsPlace, RecordView, TaskCard } from "./state.ts"
import { TaskCards } from "./TaskCards.tsx"

export { TaskCards }

/** What the drawer shows: a record, or a slice's task cards. */
export type Drawer =
  | { kind: "record"; record: RecordView }
  | {
      kind: "cards"
      slice: number
      title: string
      cards: TaskCard[]
      place: CardsPlace
      /** The card that opens with the drawer (a task picked on the build's board). */
      open?: string
    }

const fullPath = (dir: string, path: string) => `${trimEndCharacters(dir, "\\/")}/${path}`

function RecordBody({ record, live }: { record: RecordView; live: StepLive }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reads = record.evidence !== undefined
  useEffect(() => {
    if (record.evidence === undefined) return
    let on = true
    live.loadRecord(record.evidence).then(
      (t) => on && setText(t),
      (e: Error) => on && setError(e.message),
    )
    return () => {
      on = false
    }
  }, [record, live])
  const lines =
    text !== null
      ? trimEndCharacters(terminalText(text), "\n").split("\n")
      : (record.lines ?? []).map(terminalText)
  return (
    <>
      {record.facts !== undefined && record.facts.length > 0 ? (
        <dl className="sp-dr-m">
          {record.facts.map((f) => (
            <div key={f.label} className="contents">
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {error !== null ? (
        <p className="sp-dr-o">{error}</p>
      ) : reads && text === null ? (
        <p className="sp-dr-o">Loading…</p>
      ) : lines.length > 0 ? (
        <pre className="sp-dr-o" data-testid="record-text">
          {lines.join("\n")}
        </pre>
      ) : (
        <p className="sp-dr-o">Nothing was recorded beyond the facts above.</p>
      )}
    </>
  )
}

export function RecordDrawer({
  drawer,
  live,
  onClose,
}: {
  drawer: Drawer | null
  live: StepLive
  onClose: () => void
}) {
  const where =
    drawer === null
      ? { path: "", place: "" }
      : drawer.kind === "record"
        ? { path: drawer.record.path, place: drawer.record.place }
        : drawer.place
  const file = where.path
  let title: ReactNode = null
  if (drawer?.kind === "record") title = drawer.record.title
  if (drawer?.kind === "cards") title = `Task cards · slice ${drawer.slice}`
  return (
    <Dialog open={drawer !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        showCloseButton={false}
        data-testid="record-drawer"
        className="sp-drawer top-0 right-0 left-auto flex h-full w-[min(100%,520px)] max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-w-none"
      >
        <div className="sp-dr-h">
          {drawer?.kind === "cards" ? (
            <ListChecksIcon className="size-3.5" aria-hidden="true" />
          ) : (
            <ScrollTextIcon className="size-3.5" aria-hidden="true" />
          )}
          <DialogTitle className="sp-dr-t">{title}</DialogTitle>
          <DialogDescription className="sr-only">
            The agent's record, read-only. Copy its path or open it in your editor.
          </DialogDescription>
          <span className="sp-ro">
            <LockIcon className="size-3" aria-hidden="true" />
            Read-only
          </span>
          <button type="button" className="sp-ib" aria-label="Close · Esc" onClick={onClose}>
            <XIcon className="size-3.5" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {drawer?.kind === "record" ? <RecordBody record={drawer.record} live={live} /> : null}
          {drawer?.kind === "cards" ? (
            <div className="px-4 pb-3">
              <TaskCards
                // A new pick remounts the list, so the card the person chose is the one open.
                key={drawer.open ?? ""}
                cards={drawer.cards}
                initial={drawer.open !== undefined ? [drawer.open] : []}
              />
            </div>
          ) : null}
        </div>
        <div className="sp-dr-f">
          <span className="p">{where.place}</span>
          <button
            type="button"
            className="sp-act"
            onClick={() => live.copy(fullPath(live.dir, file), "Copied the path")}
          >
            <CopyIcon className="size-3" aria-hidden="true" />
            Copy path
          </button>
          {offersHostActions() ? (
            <button type="button" className="sp-act" onClick={() => live.open(file)}>
              <ExternalLinkIcon className="size-3" aria-hidden="true" />
              Open in editor
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
