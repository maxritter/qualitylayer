// A raw record of the agent's, opened from the one spot it explains: a read-only drawer from the
// right with Copy path and Open in editor. Esc closes the drawer.

import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  FlaskConicalIcon,
  ListChecksIcon,
  LockIcon,
  ScrollTextIcon,
  XIcon,
} from "lucide-react"
import { type ReactNode, useEffect, useId, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { trimEndCharacters } from "../../core/text-boundaries.ts"
import { WhoMark } from "../kit/WhoMark.tsx"
import { offersHostActions } from "../machines/framed.ts"
import { InlineMarkdown } from "../reader/DocReader.tsx"
import { terminalText } from "../reader/terminal-text.ts"
import type { StepLive } from "./live.ts"
import type { CardsPlace, RecordView, TaskCard } from "./state.ts"
import "./task-cards.css"

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

/** The first sentence of a card's objective, read across its wrapped lines. */
export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim()
  const end = /^.*?[.!?](?=\s|$)/.exec(flat)
  return end?.[0] ?? flat
}

type Toggle = "files" | "test" | "done"

/** One task opened: a sentence, then the agents' card behind three closed toggles. */
function TaskDetails({ card, id }: { card: TaskCard; id: string }) {
  const [open, setOpen] = useState<ReadonlySet<Toggle>>(new Set())
  const flip = (key: Toggle) =>
    setOpen((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const toggles: { key: Toggle; label: string; count?: number; icon: ReactNode; show: boolean }[] =
    [
      {
        key: "files",
        label: "Files",
        count: card.files.length,
        icon: <CopyIcon className="size-3.5" aria-hidden="true" />,
        show: card.files.length > 0,
      },
      {
        key: "test",
        label: "Test first",
        icon: <FlaskConicalIcon className="size-3.5" aria-hidden="true" />,
        show: card.testFirst !== undefined,
      },
      {
        key: "done",
        label: "Done when",
        count: card.dod.length,
        icon: <ListChecksIcon className="size-3.5" aria-hidden="true" />,
        show: card.dod.length > 0,
      },
    ]
  const shown = toggles.filter((toggle) => toggle.show)
  return (
    <section
      id={id}
      aria-label={`Details for ${card.id}`}
      className="sp-task-detail"
      data-testid="task-detail"
    >
      {card.objective !== undefined ? (
        <p className="sp-task-sentence">
          <InlineMarkdown text={firstSentence(card.objective)} />
        </p>
      ) : null}
      {card.line !== undefined ? (
        <p className="sp-task-line" data-testid="task-line">
          <WhoMark who="agent" running />
          <b>In work</b>
          <span>{card.line}</span>
        </p>
      ) : null}
      {shown.length > 0 ? (
        <div className="sp-task-card" data-testid="task-card-toggles">
          <span className="sp-task-card-l">
            <BotIcon className="size-3.5" aria-hidden="true" />
            Agents' card
          </span>
          {shown.map((toggle) => (
            <button
              key={toggle.key}
              type="button"
              className="sp-task-toggle"
              aria-expanded={open.has(toggle.key)}
              onClick={() => flip(toggle.key)}
            >
              {toggle.icon}
              {toggle.label}
              {toggle.count !== undefined ? (
                <>
                  {" "}
                  <span className="n">{toggle.count}</span>
                </>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      {open.has("files") ? (
        <ul className="sp-task-files" data-testid="task-files">
          {card.files.map((path) => (
            <li key={path}>
              <code>{path}</code>
            </li>
          ))}
        </ul>
      ) : null}
      {open.has("test") && card.testFirst !== undefined ? (
        <p className="sp-task-body" data-testid="task-test-first">
          <InlineMarkdown text={card.testFirst} />
        </p>
      ) : null}
      {open.has("done") ? (
        <ul className="sp-task-done" data-testid="task-done-when">
          {card.dod.map((line) => (
            <li key={line}>
              <InlineMarkdown text={line} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

/**
 * What a bug's card says about its role: a reproduce card ticked before the fix reads "red as
 * expected" (the failing test is committed first), the fix card ticked reads "fixed".
 */
export function roleWords(card: TaskCard, cards: readonly TaskCard[]): string | null {
  if (card.role === undefined) return null
  const fixDone = cards.every((c) => c.role !== "fix" || c.state === "done")
  if (card.role === "reproduce" && card.state === "done" && !fixDone) return "red as expected"
  if (card.role === "fix" && card.state === "done") return "fixed"
  return card.role.charAt(0).toUpperCase() + card.role.slice(1)
}

/**
 * A slice's tasks, each its own row that opens in place (several can stay open); the agents' card
 * is one click further. A task in work carries its working mark, a done one its check.
 */
export function TaskCards({
  cards,
  initial,
}: {
  cards: TaskCard[]
  /** The cards that start open. */
  initial?: readonly string[]
}) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set(initial ?? []))
  const prefix = useId()
  const toggle = (id: string) =>
    setOpened((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  return (
    <div className="sp-task-cards min-w-0" data-testid="task-cards">
      {cards.map((card) => {
        const open = opened.has(card.id)
        const id = `${prefix}-${card.id}`
        return (
          <div key={card.id} data-task-id={card.id} data-state={card.state}>
            <button
              type="button"
              aria-label={`${card.id}: ${card.title}`}
              aria-expanded={open}
              aria-controls={open ? id : undefined}
              className="sp-task-row"
              onClick={() => toggle(card.id)}
            >
              {card.state === "done" ? (
                <span className="sp-task-completed" aria-hidden="true">
                  <CheckIcon size={11} />
                </span>
              ) : (
                <WhoMark
                  who={card.state === "building" ? "agent" : "todo"}
                  running={card.state === "building"}
                />
              )}
              <code>{card.id}</code>
              <span className="sp-task-row-copy">
                <span inert className="sp-task-row-title">
                  <InlineMarkdown text={card.title} />
                </span>
                {roleWords(card, cards) !== null ? (
                  <span className="sp-task-role" data-testid="task-role">
                    {roleWords(card, cards)}
                  </span>
                ) : null}
                {card.state === "stopped" ? (
                  <span className="sp-task-row-state">Stopped</span>
                ) : null}
              </span>
              {open ? (
                <ChevronDownIcon className="size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronRightIcon className="size-3.5 shrink-0" aria-hidden="true" />
              )}
            </button>
            {open ? <TaskDetails card={card} id={id} /> : null}
          </div>
        )
      })}
    </div>
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
