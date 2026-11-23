// A long document's sections, to see its shape and jump to a part: a column beside the
// page where the window is wide enough, and a button in the review bar where it is not.
// A jump goes through the reader's own jump links, so a section inside a fold opens.

import { cn } from "cn"
import { BotIcon, ListTreeIcon } from "lucide-react"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  OUTLINE_MIN,
  type OutlineEntry,
  outlineOf,
  useActiveSection,
  withAgentsEntry,
  withSectionShow,
} from "./outline-model.ts"

export {
  OUTLINE_MIN,
  type OutlineEntry,
  outlineOf,
  useActiveSection,
  withAgentsEntry,
  withSectionShow,
}

type ListProps = {
  entries: OutlineEntry[]
  active: string | null
  onJump: (slug: string) => void
}

function entryTitle(entry: OutlineEntry): string {
  if (entry.tag !== undefined) return `${entry.text} · ${entry.tag}`
  return entry.show === "detail" ? `${entry.text} · working section` : entry.text
}

function OutlineItem({
  entry,
  isActive,
  onJump,
}: {
  entry: OutlineEntry
  isActive: boolean
  onJump: (slug: string) => void
}) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        className={cn(
          "block w-full cursor-pointer truncate rounded-md px-2 py-1 text-left text-[13px] leading-snug text-muted-foreground hover:bg-surface-2 hover:text-foreground",
          entry.level === 3 && "pl-5 text-[12.5px]",
          (entry.show === "detail" || entry.tag !== undefined) && "text-dim",
          isActive && "bg-surface-2 font-medium text-foreground",
        )}
        title={entryTitle(entry)}
        data-show={entry.show}
        aria-current={isActive ? "location" : undefined}
        onClick={() => onJump(entry.slug)}
      >
        {entry.agents === true ? (
          <BotIcon aria-hidden="true" className="mr-1.5 inline size-3.5 align-[-2px]" />
        ) : null}
        {entry.text}
        {entry.show === "detail" && entry.level === 2 ? (
          <span className="ml-1.5 text-[11px] font-normal text-dim" data-testid="detail-tag">
            detail
          </span>
        ) : null}
        {entry.tag !== undefined && entry.level === 2 ? (
          <span
            className="ml-1.5 text-[11px] font-normal text-dim"
            data-testid={entry.agents === true ? "agents-tag" : "generated-tag"}
          >
            {entry.tag}
          </span>
        ) : null}
      </button>
    </li>
  )
}

function OutlineList({ entries, active, onJump }: ListProps) {
  return (
    <ol className="m-0 grid min-w-0 list-none gap-px p-0">
      {entries.map((entry) => (
        <OutlineItem
          key={entry.key}
          entry={entry}
          isActive={active === entry.slug}
          onJump={onJump}
        />
      ))}
    </ol>
  )
}

/** Beside the page in a wide window, staying in view while the page scrolls. */
export function OutlineColumn(props: ListProps) {
  return (
    <nav className="doc-outline" aria-label="Sections of this document" data-testid="doc-outline">
      <p className="m-0 mb-1.5 px-2 text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase">
        On this page
      </p>
      <OutlineList {...props} />
    </nav>
  )
}

/** In the review bar where the window is narrow; it also names the file the page shows. */
export function OutlineButton({
  path,
  always = false,
  ...props
}: ListProps & {
  path: string
  /** Shown at every width: a step page has no outline column beside it. */
  always?: boolean
}) {
  const [open, setOpen] = useState(false)
  const jumped = useRef(false)
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) jumped.current = false
        setOpen(next)
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={always ? undefined : "@min-[1180px]:hidden"}
            aria-label="On this page"
            title="On this page: the sections of this document"
            data-testid="outline-button"
          />
        }
      >
        <ListTreeIcon aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={8}
        finalFocus={() => {
          // The reader owns a chosen heading's jump. Refocusing Sections would scroll it back.
          const keepFocus = !jumped.current
          jumped.current = false
          return keepFocus
        }}
        className="max-h-[min(70dvh,var(--available-height))] w-[min(320px,calc(100vw-16px))] min-w-0 overflow-hidden p-2"
      >
        <p
          className="m-0 mb-1.5 shrink-0 truncate px-2 font-mono text-[11.5px] text-muted-foreground"
          title={path}
          data-testid="doc-path"
        >
          {path}
        </p>
        <div className="min-h-0 overflow-y-auto" data-testid="outline-scroll">
          <OutlineList
            {...props}
            onJump={(slug) => {
              jumped.current = true
              setOpen(false)
              props.onJump(slug)
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
