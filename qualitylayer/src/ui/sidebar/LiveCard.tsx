// The task toggle of a live row: on the row's third line, the agent's own task list as one bar per item
// (drawn like the step strip), done of total, and its helpers; a click lists them under the row. Closed
// by default and always the row's third line, so a live row stays three lines high. The list comes from
// the agent's hooks only; an agent that reports none gets no toggle.

import { cn } from "cn"
import { BotIcon, CheckIcon, ChevronDownIcon, CircleIcon, ListTodoIcon } from "lucide-react"
import { useId, useLayoutEffect, useRef, useState } from "react"
import type { LiveRow, LiveRowState } from "../../core/interaction-shell/status.ts"
import type { RowTone } from "../home-rows.ts"
import "./live-card.css"

/** The most items the open list shows; past it the current one stays in view and the rest fold. */
export const LIVE_LIST_SHOWN = 5

const TONE: Record<LiveRowState, RowTone> = {
  starting: "work",
  working: "work",
  needs: "you",
  asks: "you",
  turn: "done",
  quiet: "quiet",
  "stopped-early": "stop",
  stopped: "done",
}

type Todo = NonNullable<LiveRow["todo"]>

/** Whether the agent reported anything to list: a task list or helpers at work. */
export const hasLiveCard = (row: LiveRow): boolean => row.todo !== null || row.helpers.length > 0

function words(row: LiveRow): string {
  const done = row.todo?.filter((i) => i.state === "done").length ?? 0
  const helpers = row.helpers.reduce((n, h) => n + h.n, 0)
  const tasks = row.todo !== null ? `${done} of ${row.todo.length} tasks done` : ""
  const bots = helpers > 0 ? `${helpers} ${helpers === 1 ? "helper" : "helpers"}` : ""
  return [tasks, bots].filter(Boolean).join(", ")
}

/** Five items with the current one in view; "all" shows every item. */
function visibleItems(todo: Todo, all: boolean): Todo {
  if (all || todo.length <= LIVE_LIST_SHOWN) return todo
  const now = Math.max(
    0,
    todo.findIndex((i) => i.state === "now"),
  )
  const start = Math.max(0, Math.min(now - 1, todo.length - LIVE_LIST_SHOWN))
  return todo.slice(start, start + LIVE_LIST_SHOWN)
}

function ItemMark({ state, tone }: { state: Todo[number]["state"]; tone: RowTone }) {
  if (state === "done") return <CheckIcon className="size-3" aria-hidden="true" />
  if (state === "next") return <CircleIcon className="size-3" aria-hidden="true" />
  return (
    <i
      className={cn("q-m ses-now", tone === "you" ? "q-m-you" : "q-m-agent")}
      data-running={tone === "work" ? "true" : undefined}
      aria-hidden="true"
    />
  )
}

function OpenList({ row, id }: { row: LiveRow; id: string }) {
  const [all, setAll] = useState(false)
  const tone = TONE[row.state]
  const shown = row.todo === null ? [] : visibleItems(row.todo, all)
  const hidden = row.todo === null ? 0 : row.todo.length - shown.length
  return (
    <div id={id} className="ses-open" data-testid="task-item-list">
      {shown.length > 0 ? (
        <ol className="ses-todo">
          {shown.map((item) => (
            <li key={`${item.state}:${item.text}`} data-s={item.state}>
              <ItemMark state={item.state} tone={tone} />
              <span title={item.text}>{item.text}</span>
              <span className="sr-only">
                {item.state === "done" ? " (done)" : item.state === "now" ? " (in progress)" : ""}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {hidden > 0 ? (
        <button type="button" className="ses-more" onClick={() => setAll(true)}>
          {hidden} more
        </button>
      ) : null}
      {row.helpers.map((h) => (
        <p key={h.kind} className="ses-help">
          <BotIcon className="size-3" aria-hidden="true" />
          <span>
            {h.n} {h.n === 1 ? "helper" : "helpers"} · {h.kind}
          </span>
        </p>
      ))}
    </div>
  )
}

function useTogglePadding(
  card: React.RefObject<HTMLDivElement | null>,
  sum: React.RefObject<HTMLButtonElement | null>,
) {
  // The row's third line leaves exactly the toggle's width (and its 20 px of offset and gap) free.
  useLayoutEffect(() => {
    const host = card.current
    const toggle = sum.current
    if (host === null || toggle === null) return
    const apply = () =>
      host.style.setProperty(
        "--ses-pad",
        `${Math.ceil(toggle.getBoundingClientRect().width) + 20}px`,
      )
    apply()
    if (typeof ResizeObserver === "undefined") return
    const watch = new ResizeObserver(apply)
    watch.observe(toggle)
    return () => watch.disconnect()
  }, [card, sum])
}

function TodoSummary({ todo, tone }: { todo: Todo; tone: RowTone }) {
  const done = todo.filter((i) => i.state === "done").length
  return (
    <>
      <ListTodoIcon className="size-3" aria-hidden="true" />
      <span className="tm-strip ses-strip" data-droppable="bars" aria-hidden="true">
        {todo.map((item, i) => (
          <i
            // biome-ignore lint/suspicious/noArrayIndexKey: bars are positions in the agent's list
            key={i}
            data-s={item.state === "done" ? "past" : item.state}
            data-tone={item.state === "now" ? tone : undefined}
          />
        ))}
      </span>
      <span className="ses-n">
        {done}/{todo.length}
      </span>
    </>
  )
}

/**
 * Wraps the task's row: the toggle sits on its third line, the opened list follows the row. Under
 * 260 px of sidebar the bars and the helpers drop and the count stays (live-card.css).
 */
export function LiveCard({ row, children }: { row: LiveRow; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const card = useRef<HTMLDivElement>(null)
  const sum = useRef<HTMLButtonElement>(null)
  useTogglePadding(card, sum)
  const helpers = row.helpers.reduce((n, h) => n + h.n, 0)
  const summary = words(row)
  const label = row.todo !== null ? "tasks" : "helpers"
  return (
    <div
      ref={card}
      className={cn("ses-card", `ses-${row.state}`, open && "open")}
      data-testid="task-item-live"
    >
      <div className="ses-box">
        {children}
        <button
          type="button"
          ref={sum}
          className="ses-sum"
          aria-expanded={open}
          aria-controls={id}
          aria-label={`${open ? "Hide" : "Show"} ${label} · ${summary}`}
          title={open ? `Hide ${label}` : `Show ${label}`}
          onClick={() => setOpen(!open)}
        >
          {row.todo !== null ? <TodoSummary todo={row.todo} tone={TONE[row.state]} /> : null}
          {helpers > 0 ? (
            <span className="ses-bots">
              <BotIcon className="size-3" aria-hidden="true" />
              {helpers}
            </span>
          ) : null}
          <ChevronDownIcon className="size-3 ses-chev" aria-hidden="true" />
        </button>
      </div>
      {open ? <OpenList row={row} id={id} /> : null}
    </div>
  )
}
