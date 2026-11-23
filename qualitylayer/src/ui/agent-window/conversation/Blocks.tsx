// A turn drawn: the person's message, the agent's name, then either everything it did (while it runs) or
// one folded "Worked for …" line with the answer open below it, and the files the turn changed.
import { ChevronRightIcon, CodeXmlIcon, Columns2Icon, FileTextIcon, LayersIcon } from "lucide-react"
import { useId, useState } from "react"
import { Attachments } from "../../docs/Attachments.tsx"
import { sentJustNow } from "../../quick-ask/deliver.ts"
import {
  jumpToMark,
  readSentMessage,
  type SentMessage as SentMessageText,
} from "../../quick-ask/sent.ts"
import "../../quick-ask/quick-ask.css"
import { AgentMark } from "../../kit/marks/index.ts"
import { type ChangedFiles, type Folded, foldTurn, isFinished } from "./fold.ts"
import { Entry, type LogContext } from "./Log.tsx"
import { type Block, clock, type Turn, tokens } from "./model.ts"
import { TurnChanges } from "./TurnChanges.tsx"
import { useThinkingVisibility } from "./thinking.ts"
import "./turns.css"

type TurnProps = {
  turn: Turn
  ctx: LogContext
  finished: boolean
  /** The folded work is open. */
  open: boolean
  onToggle(id: string): void
  changes?: ChangedFiles
}

/** The person's message, then the agent's name: the head of a turn. */
function localAttachmentUrl(url: string | undefined): string | null {
  if (url?.startsWith("/api/")) return url
  if (url && /^data:image\/(?:png|jpeg|gif|webp);base64,[a-zA-Z0-9+/=\s]+$/.test(url)) return url
  return null
}

const MARK_ICON = { passage: FileTextIcon, artifact: Columns2Icon, code: CodeXmlIcon } as const

/**
 * A message sent from a mark: the compact chip (place and a short quote; it goes back to the
 * passage), the words, then the pictures and files. One sent just now has an accent edge for a while.
 */
function SentMessage({ sent, images }: { sent: SentMessageText; images: React.ReactNode }) {
  const { context } = sent
  const Mark = MARK_ICON[context.mark]
  const quote = context.quote.split("\n")[0]?.replace(/\s+/g, " ").trim() ?? ""
  return (
    <div className={`cv-you qa-you${sentJustNow(sent.words) ? " fresh" : ""}`}>
      <button
        type="button"
        className="qa-chip"
        title={context.quote}
        aria-label={`Go to ${context.place}`}
        onClick={() => jumpToMark(context)}
      >
        <Mark size={12} aria-hidden="true" />
        <b>{context.place}</b>
        {quote ? <q className={context.mark === "code" ? "code" : undefined}>{quote}</q> : null}
      </button>
      {sent.words ? <div className="qa-words">{sent.words}</div> : null}
      {images}
      {sent.files.length ? (
        <ul className="qa-files" aria-label="Attached files">
          {sent.files.map((path) => (
            <li key={path} title={path}>
              <FileTextIcon size={12} aria-hidden="true" />
              <span>{path.split(/[\\/]/).pop()}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function Asked({ turn, ctx }: { turn: Turn; ctx: LogContext }) {
  const at = clock(turn.user?.at)
  const you = ctx.userName ?? "You"
  const sent = turn.user?.text ? readSentMessage(turn.user.text) : undefined
  const images = turn.user ? (
    <Attachments
      files={(turn.user.attachments ?? []).map((image) => ({
        ...image,
        url: localAttachmentUrl(image.url),
      }))}
    />
  ) : null
  return (
    <>
      {turn.user ? (
        <>
          <div className="cv-meta">{at ? `${you} · ${at}` : you}</div>
          {sent ? (
            <SentMessage sent={sent} images={images} />
          ) : (
            <div className="cv-you">
              {images}
              {turn.user.text ? <div className="cv-you-text">{turn.user.text}</div> : null}
            </div>
          )}
        </>
      ) : null}
      {turn.items.length > 0 ? (
        <div className="cv-meta cv-agent">
          {ctx.agent ? <AgentMark agent={ctx.agent} size={12} /> : null}
          {ctx.agentName}
        </div>
      ) : null}
    </>
  )
}

/** The one line a finished turn's work folds into, and the work when it is opened. */
function WorkFold({
  id,
  folded,
  ctx,
  open,
  onToggle,
}: {
  id: string
  folded: Folded
  ctx: LogContext
  open: boolean
  onToggle(id: string): void
}) {
  const body = useId()
  return (
    <>
      <button
        type="button"
        className="cv-fold"
        aria-expanded={open}
        aria-controls={open ? body : undefined}
        onClick={() => onToggle(id)}
      >
        <span>{folded.label}</span>
        <ChevronRightIcon
          size={13}
          className={`cv-chev${open ? " open" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="cv-fold-body" id={body}>
          {folded.work.map((item) => (
            <Entry key={item.id} item={item} ctx={ctx} />
          ))}
        </div>
      ) : null}
    </>
  )
}

export function TurnView({ turn, ctx, finished, open, onToggle, changes }: TurnProps) {
  const at = clock(turn.user?.at)
  const folded = finished ? foldTurn(turn) : undefined
  return (
    <section className="cv-turn" data-turn="" aria-label={at ? `Turn at ${at}` : "Turn"}>
      <Asked turn={turn} ctx={ctx} />
      {folded?.work.length ? (
        <WorkFold id={turn.id} folded={folded} ctx={ctx} open={open} onToggle={onToggle} />
      ) : null}
      {(folded ? folded.open : turn.items).map((item) => (
        <Entry key={item.id} item={item} ctx={ctx} />
      ))}
      {finished && changes ? <TurnChanges changes={changes} /> : null}
    </section>
  )
}

export function Divider({ block }: { block: Extract<Block, { kind: "divider" }> }) {
  return (
    <div className="cv-divider">
      <LayersIcon size={13} aria-hidden="true" />
      <span>
        Conversation compacted
        {block.before !== undefined && block.after !== undefined
          ? ` · ${tokens(block.before)} → ${tokens(block.after)} tokens`
          : ""}
      </span>
    </div>
  )
}

/** Which block is the latest turn: the one a running agent is still writing. */
export const latestTurn = (blocks: readonly Block[]) =>
  blocks.findLastIndex((block) => block.kind === "turn")

/** The conversation as a plain list of turns, for a short transcript such as a subagent's. */
export function Log({
  blocks,
  ctx,
  live,
}: {
  blocks: Block[]
  ctx: LogContext
  /** The agent still works: its latest turn stays open. */
  live: boolean
}) {
  const latest = latestTurn(blocks)
  const thinking = useThinkingVisibility()
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const toggle = (id: string) =>
    setOpened((held) => {
      const next = new Set(held)
      if (!next.delete(id)) next.add(id)
      return next
    })
  return (
    <>
      {blocks.map((block, index) =>
        block.kind === "divider" ? (
          <Divider key={block.id} block={block} />
        ) : (
          <TurnView
            key={block.id}
            turn={block}
            ctx={{ ...ctx, thinking }}
            finished={isFinished(block, index === latest, live)}
            open={opened.has(block.id)}
            onToggle={toggle}
          />
        ),
      )}
    </>
  )
}
