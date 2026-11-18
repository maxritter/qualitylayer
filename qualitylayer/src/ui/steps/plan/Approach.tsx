// The Plan's Approach uses optional labelled lines and native disclosures for explicit lead bullets.
// Plain bullets and other prose retain their full text.

import { SplitIcon } from "lucide-react"
import { marked, type Token, type Tokens } from "marked"
import { Fragment } from "react"
import { Disclosure } from "../../kit/Fold.tsx"
import { InlineMarkdown } from "../../reader/DocReader.tsx"
import { CommentBlock, DocMarkdown } from "../../step-page/DocMarkdown.tsx"
import type { StepLive } from "../../step-page/live.ts"
import { bodyOf } from "../../step-page/sections.ts"
import type { StepState } from "../../step-page/state.ts"
import { useShown } from "./BoundaryParts.tsx"
import { PlanPart } from "./Pictures.tsx"
import { DetailsToggle } from "./Technical.tsx"

type ApproachLabel = { key: string; label: string; text: string; raw: string }
type ApproachBullet = {
  key: string
  text: string
  raw: string
  lead: ReturnType<typeof labelledBullet>
}
type ApproachBlock = { key: string } & (
  | { kind: "labels"; rows: ApproachLabel[] }
  | { kind: "bullets"; rows: ApproachBullet[] }
  | { kind: "markdown"; raw: string }
)

const LABEL = /^\*\*(Chosen|Gives|Costs):\*\*[^\S\r\n\u2028\u2029]*(\S.*)$/
const BULLET = /^[-*][^\S\r\n\u2028\u2029]+(\S.*)$/

function occurrenceKey(seen: Map<string, number>, source: string): string {
  const number = (seen.get(source) ?? 0) + 1
  seen.set(source, number)
  return `${source}\0${number}`
}

function labelRowsOf(paragraph: Tokens.Paragraph): ApproachLabel[] | null {
  const seen = new Map<string, number>()
  const rows: ApproachLabel[] = []
  for (const raw of paragraph.text.split(/\r?\n/)) {
    const match = LABEL.exec(raw.trim())
    if (match === null) return null
    rows.push({
      key: occurrenceKey(seen, raw),
      label: match[1] as string,
      text: match[2] as string,
      raw,
    })
  }
  return rows
}

function bulletRowsOf(list: Tokens.List): ApproachBullet[] | null {
  if (list.ordered || list.items.length === 0) return null
  const seen = new Map<string, number>()
  const rows: ApproachBullet[] = []
  for (const item of list.items) {
    const raw = item.raw
    const match = BULLET.exec(raw.trim())
    if (match === null || item.task || item.tokens.some((token) => token.type !== "text"))
      return null
    const text = match[1] as string
    rows.push({ key: occurrenceKey(seen, raw), text, raw, lead: labelledBullet(text) })
  }
  return rows
}

function approachBlock(token: Token, key: string): ApproachBlock {
  if (token.type === "paragraph") {
    const rows = labelRowsOf(token as Tokens.Paragraph)
    if (rows) return { key, kind: "labels", rows }
  }
  if (token.type === "list") {
    const rows = bulletRowsOf(token as Tokens.List)
    if (rows) return { key, kind: "bullets", rows }
  }
  return { key, kind: "markdown", raw: token.raw }
}

/** Recognize the styled blocks without parsing paragraphs, tables or complex lists as rows. */
export function approachOf(markdown: string): ApproachBlock[] {
  const body = withoutOpeningHeading(markdown)
  const seen = new Map<string, number>()
  return marked
    .lexer(body.replace(/<!--\s*fill:[\s\S]*?-->/g, ""))
    .filter((token) => token.type !== "space")
    .map((token) => approachBlock(token, occurrenceKey(seen, token.raw)))
}

function withoutOpeningHeading(markdown: string): string {
  if (!markdown.startsWith("##") || !/[^\S\r\n]/.test(markdown.charAt(2))) return markdown
  const end = markdown.indexOf("\n")
  const carriage = markdown.indexOf("\r")
  if (end < 0) return carriage < 0 ? "" : markdown
  return carriage >= 0 && carriage < end - 1 ? markdown : markdown.slice(end + 1)
}

function labelledBullet(text: string): { lead: string; detail: string } | null {
  if (!text.startsWith("**")) return null
  const closing = /\*\*(?=[ \t])/g
  closing.lastIndex = 3
  const end = closing.exec(text)?.index
  if (end === undefined) return null
  let start = end + 3
  while (start < text.length - 1 && (text[start] === " " || text[start] === "\t")) start++
  if (start === text.length) return null
  return { lead: text.slice(2, end), detail: text.slice(start) }
}

/**
 * A bug's What breaks: its two-column table as label and sentence rows (When, Today, Expected …), the
 * empty header row left out. Null when the section is not such a table.
 */
export function keyRowsOf(markdown: string): { label: string; text: string }[] | null {
  const rows: { label: string; text: string }[] = []
  for (const raw of bodyOf(markdown).split(/\r?\n/)) {
    const line = raw.trim()
    if (line === "") continue
    if (!line.startsWith("|")) return null
    const cells = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim())
    if (cells.every((cell) => /^:?-*:?$/.test(cell))) continue
    if (cells.length !== 2) return null
    rows.push({ label: cells[0] as string, text: cells[1] as string })
  }
  return rows.length === 0 ? null : rows
}

/** Label and sentence rows in one bordered table, the labels quiet (Workflow model: bug Plan, What breaks). */
export function KeyRows({ rows }: { rows: readonly { label: string; text: string }[] }) {
  return (
    <dl className="pl-keyrows" data-testid="plan-key-rows">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>
            <InlineMarkdown text={row.text} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** The bullets the Approach shows before "Show all N". */
const SHOWN = 5

function ApproachLabels({
  rows,
  followedByBullets,
  live,
}: {
  rows: readonly ApproachLabel[]
  followedByBullets: boolean
  live: StepLive | undefined
}) {
  return (
    <dl
      className={followedByBullets ? "pl-appr" : "pl-appr alone"}
      data-testid="plan-approach-labels"
    >
      {rows.map(({ key, label, text, raw }) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>
            <CommentBlock raw={raw} live={live}>
              <InlineMarkdown text={text} />
            </CommentBlock>
          </dd>
        </div>
      ))}
    </dl>
  )
}

function ApproachBullets({
  rows,
  live,
}: {
  rows: readonly ApproachBullet[]
  live: StepLive | undefined
}) {
  return (
    <div className="bd-sumb" data-testid="plan-approach-bullets">
      <ul className="bd-bul">
        {rows.map(({ key, text, raw, lead }) => (
          <li key={key} className={lead === null ? undefined : "pl-approach-lead"}>
            <CommentBlock raw={raw} live={live}>
              {lead === null ? (
                <InlineMarkdown text={text} />
              ) : (
                <Disclosure
                  className="pl-approach-fold"
                  head={
                    <b>
                      <InlineMarkdown text={lead.lead} />
                    </b>
                  }
                >
                  <p>
                    <InlineMarkdown text={lead.detail} />
                  </p>
                </Disclosure>
              )}
            </CommentBlock>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ApproachPart({
  blocks,
  state,
  live,
}: {
  blocks: readonly ApproachBlock[]
  state: StepState
  live: StepLive | undefined
}) {
  const bullets = blocks.flatMap((block) => (block.kind === "bullets" ? block.rows : []))
  const { rows, more } = useShown(bullets, SHOWN)
  const shown = new Set(rows)
  const last = rows.at(-1)
  return (
    <PlanPart
      title="Approach"
      icon={SplitIcon}
      action={
        <>
          {bullets.length > 0 ? <span className="q-disc-n">{bullets.length}</span> : null}
          {rows.some((row) => row.lead !== null) ? <DetailsToggle /> : null}
        </>
      }
    >
      {blocks.map((block, index) => {
        if (block.kind === "markdown")
          return (
            <DocMarkdown
              key={block.key}
              markdown={block.raw}
              state={state}
              first={false}
              live={live}
              bare
            />
          )
        if (block.kind === "labels")
          return (
            <ApproachLabels
              key={block.key}
              rows={block.rows}
              followedByBullets={blocks[index + 1]?.kind === "bullets"}
              live={live}
            />
          )
        const visible = block.rows.filter((row) => shown.has(row))
        if (visible.length === 0) return null
        return (
          <Fragment key={block.key}>
            <ApproachBullets rows={visible} live={live} />
            {visible.at(-1) === last ? more : null}
          </Fragment>
        )
      })}
    </PlanPart>
  )
}
