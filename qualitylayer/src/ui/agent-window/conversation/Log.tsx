// The rows of a conversation: the agent's thinking and words, tool calls with their results, edits with
// their diffs, task files, errors and entries this view cannot draw.
import { BracesIcon, BrainIcon } from "lucide-react"
import { type ReactNode, useId, useState } from "react"
import type { ToolKind } from "../../../core/conversation/types.ts"
import { WhoMark } from "../../kit/WhoMark.tsx"
import { EditRow } from "./LogEditRow.tsx"
import { Disclosure, ICONS, Lead, type LogContext, ShowMore, ToolRow } from "./LogToolRow.tsx"
import { groupWhat, type Item, type Row, resultOf, verbOf } from "./model.ts"
import { Say } from "./Say.tsx"

export type { LogContext }

function Subagent({ row, ctx }: { row: Row; ctx: LogContext }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className="cv-group">
      <Disclosure open={open} onToggle={() => setOpen(!open)} className="cv-tool" id={id}>
        <span className="cv-ic">
          <Lead row={{ ...row, tool: "subagent" }} />
        </span>
        <b>Subagent</b>
        <span className="cv-what">
          {row.detail ? <code>{row.detail}</code> : null}
          {row.detail && row.target ? " · " : null}
          {row.target}
        </span>
        <span className="cv-res">{resultOf(row) || (row.running ? "working…" : "")}</span>
      </Disclosure>
      {open ? (
        <div className="cv-nest" id={id}>
          {row.children.map((child) => (
            <ToolRow key={child.id} row={child} ctx={ctx} nested />
          ))}
          {row.reply ? (
            <div className="cv-subsay">
              <Say text={row.reply} />
            </div>
          ) : null}
          {row.children.length === 0 && !row.reply ? (
            <p className="cv-subsay">{row.output ?? "Nothing was recorded under this subagent."}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function Rowed({ row, ctx }: { row: Row; ctx: LogContext }) {
  if (row.tool === "subagent") return <Subagent row={row} ctx={ctx} />
  if (row.tool === "edit" || row.tool === "write") return <EditRow row={row} ctx={ctx} />
  return <ToolRow row={row} ctx={ctx} />
}

function Group({ tool, rows, ctx }: { tool: ToolKind; rows: Row[]; ctx: LogContext }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const Icon = ICONS[tool]
  const running = rows.filter((row) => row.running).length
  return (
    <div className="cv-group">
      <Disclosure open={open} onToggle={() => setOpen(!open)} className="cv-tool" id={id}>
        <span className="cv-ic">
          {running ? <WhoMark who="agent" running /> : <Icon size={14} aria-hidden="true" />}
        </span>
        <b>{verbOf(tool, running > 0)}</b>
        <span className="cv-what">{groupWhat(tool, rows.length)}</span>
        <span className="cv-res">
          {running ? `${rows.length - running} of ${rows.length} done` : `${rows.length} done`}
        </span>
      </Disclosure>
      {open ? (
        <div className="cv-nest" id={id}>
          {rows.map((row) => (
            <ToolRow key={row.id} row={row} ctx={ctx} nested />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Thinking({
  text,
  seconds,
  more,
  ctx,
}: {
  text: string
  seconds?: number
  more: readonly string[]
  ctx: LogContext
}) {
  const mode = ctx.thinking ?? "collapsed"
  const [open, setOpen] = useState(mode === "expanded")
  const id = useId()
  if (mode === "hidden" || (!text.trim() && more.length === 0)) return null
  return (
    <div className="cv-think">
      <Disclosure open={open} onToggle={() => setOpen(!open)} className="cv-think-h" id={id}>
        <BrainIcon size={14} aria-hidden="true" />
        Thinking{seconds !== undefined ? ` · ${Math.round(seconds)} s` : ""}
      </Disclosure>
      {open ? (
        <>
          <div id={id}>
            <Say text={text} />
          </div>
          <ShowMore ids={more} ctx={ctx} />
        </>
      ) : null}
    </div>
  )
}

function UnknownEntry({ labels, onShowTerminal }: { labels: string[]; onShowTerminal(): void }) {
  return (
    <div className="cv-tool cv-unknown">
      <span className="cv-ic">
        <BracesIcon size={14} aria-hidden="true" />
      </span>
      <span className="cv-what" title={labels.join(", ")}>
        {labels.length === 1
          ? "1 event this view doesn’t show yet"
          : `${labels.length} events this view doesn’t show yet`}
      </span>
      <span className="cv-res">
        <button type="button" className="q-link" onClick={onShowTerminal}>
          Show in terminal
        </button>
      </span>
      <span className="cv-chev-space" />
    </div>
  )
}

export function Entry({ item, ctx }: { item: Item; ctx: LogContext }): ReactNode {
  let view: ReactNode = null
  switch (item.kind) {
    case "think":
      view = (
        <Thinking
          key={ctx.thinking ?? "collapsed"}
          text={item.text}
          seconds={item.seconds}
          more={item.more}
          ctx={ctx}
        />
      )
      break
    case "say":
      view = <Say text={item.text} />
      break
    case "tool":
      view = ctx.hidden?.has(item.row.callId) ? null : <Rowed row={item.row} ctx={ctx} />
      break
    case "group":
      view = <Group tool={item.tool} rows={item.rows} ctx={ctx} />
      break
    case "error":
      view = (
        <div className="cv-error" role="status">
          <WhoMark who="stop" />
          <div>
            <b>{item.text}</b>
          </div>
        </div>
      )
      break
    case "unknown":
      view = <UnknownEntry labels={item.labels} onShowTerminal={ctx.onShowTerminal} />
      break
  }
  return view
}
