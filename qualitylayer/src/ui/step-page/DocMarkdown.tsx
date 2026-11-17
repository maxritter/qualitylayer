// A step document's own Markdown, rendered as written and sanitised as the reader sanitises it.
// The page dresses a few things the way the approved artifact draws them, never changing the words:
// the title the header already shows is left out, the opening line reads as the lead, a heading
// gets the count its part adds, a numbered decision or step shows its number apart, a `###` that
// only repeats its section's name is left out, the person's own words under Problem are labelled,
// Scope's two lists sit side by side, each command in How to try it gets a Copy button, and a
// labelled step (Do, Run, Expect, Saw) reads as a label list with its commands one per line.

import { CopyIcon } from "lucide-react"
import { marked, type Token, type Tokens } from "marked"
import { Fragment, type ReactNode, useMemo } from "react"
import { headingSlug } from "../../core/docs/anchor.ts"
import { isLineText, trimEndCharacters, trimEndWhile } from "../../core/text-boundaries.ts"
import { InlineMarkdown, stripFrontmatter, toBlocks } from "../reader/DocReader.tsx"
import { diagramTheme, MermaidBlock } from "../reader/MermaidBlock.tsx"
import { WireframeBlock } from "../reader/WireframeBlock.tsx"
import { ChecksFold } from "./ChecksFold.tsx"
import { parseChecks } from "./checks.ts"
import type { StepLive } from "./live.ts"
import { SafeHtml } from "./SafeHtml.tsx"
import { OWN_TITLE, type StepState } from "./state.ts"

type Props = {
  markdown: string
  state: StepState
  /** The document's first stretch, where its title and lead line are. */
  first: boolean
  live: StepLive | undefined
  /** Plain mode: the Markdown as written, nothing dressed. */
  bare?: boolean
  hiddenHeadings?: ReadonlySet<string>
}

export function hasWrittenMarkdown(markdown: string): boolean {
  return marked.lexer(markdown).some((token) => {
    if (token.type === "space" || token.type === "heading") return false
    if (token.type === "html" && /^<!--[\s\S]*-->$/.test(token.raw.trim())) return false
    if (token.type === "paragraph" && /^Not written yet\.?$/i.test(token.text.trim())) return false
    if (token.type === "table" && token.rows.length === 0) return false
    return true
  })
}

const sameTitle = (heading: string, title: string) =>
  heading.trim().toLowerCase().startsWith(title.trim().toLowerCase())

/**
 * One passage of a live step page: words selected inside it are a mark whose quote and section come
 * from this block (selected-passage.ts). Quotes the actual Markdown, not rendered counts or labels.
 */
export function CommentBlock({
  raw,
  live,
  children,
}: {
  raw: string
  live: StepLive | undefined
  children: ReactNode
}) {
  // A block that opens with its section's heading quotes the words after it: "## Summary" is no passage.
  const quote = raw
    .replace(/^(?:\s*#{1,6} [^\n]*\n)+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200)
  if (live?.mark === undefined || !quote) return <>{children}</>
  return (
    <div className="sp-comment-block" data-comment-source={quote}>
      {children}
    </div>
  )
}

/** A label paragraph: `**Oracle:** one sentence`, outside the lines other parts read. */
const LABEL = /^\*\*([^*\n]{1,40}):\*\*\s+([\s\S]+)$/
const NOT_LABELS = /^(?:Kind|A|B|Recommended|late|Artifact|Answers)$/i
const labelOf = (token: Token | undefined) => {
  if (token?.type !== "paragraph") return null
  const found = LABEL.exec((token as Tokens.Paragraph).text.trim())
  if (found?.[1] === undefined || found[2] === undefined || NOT_LABELS.test(found[1])) return null
  return { label: found[1], value: found[2] }
}

/** Two or more label paragraphs in a row read as a short list of labels and values. */
function LabelList({
  rows,
  raw,
  live,
}: {
  rows: { label: string; value: string }[]
  raw: string
  live: StepLive | undefined
}) {
  return (
    <CommentBlock raw={raw} live={live}>
      <dl className="sp-labels" data-testid="label-list">
        {rows.map((row) => (
          <Fragment key={row.label}>
            <dt>{row.label}</dt>
            <dd
              className={
                /^risky$/i.test(row.label) && !/^none\b/i.test(row.value) ? "risky" : undefined
              }
            >
              <InlineMarkdown text={row.value} />
            </dd>
          </Fragment>
        ))}
      </dl>
    </CommentBlock>
  )
}

/** A list item that opens with a one-word label: `Do: …`, `Run: \`…\``, `**Expect:** …`. */
const ITEM_LABEL = /^(?:\*\*)?([A-Z][A-Za-z]{0,15}):(?:\*\*)?/
const itemLabel = (item: Tokens.ListItem) => {
  if (item.task || item.tokens.some((t) => t.type === "list" || t.type === "code")) return null
  const text = item.text.trim()
  const found = ITEM_LABEL.exec(text)
  if (found?.[1] === undefined) return null
  const rest = text.slice(found[0].length)
  if (!/^\s/.test(rest)) return null
  const value = rest.trim()
  if (!value) return null
  return {
    label: found[1],
    value: value
      .split("\n")
      .map((line) => line.trim())
      .join(" "),
  }
}

/**
 * A step written as labelled lines with a Run line (Try it yourself's `- Do:`, `- Run:`, `- Expect:`,
 * `- Saw:`): its labels and values, or null for any other list.
 */
export function stepLines(list: Tokens.List): { label: string; value: string }[] | null {
  if (list.ordered || list.items.length < 2) return null
  const rows: { label: string; value: string }[] = []
  for (const item of list.items) {
    const row = itemLabel(item)
    if (row === null) return null
    rows.push(row)
  }
  return rows.some((row) => /^run$/i.test(row.label)) ? rows : null
}

/**
 * A Run line's commands, one per line: its code spans when nothing but `;`, `,`, "then" or "and"
 * stands between them (a chain joined only by `&&` stays one command). Null when the line has
 * other words, so they are drawn as written.
 */
export function runCommands(value: string): string[] | null {
  if (value.includes("``")) return null
  const parts = value.split(/`([^`]+)`/)
  const commands = parts.filter((_, n) => n % 2 === 1)
  const between = parts.filter((_, n) => n % 2 === 0)
  if (commands.length === 0) return null
  const inner = between.slice(1, -1)
  const edges = `${between[0] ?? ""}${between.at(-1) ?? ""}`
  if (!/^[\s.;,]*$/.test(edges)) return null
  if (inner.length > 0 && inner.every((gap) => /^\s*&&\s*$/.test(gap)))
    return [commands.join(" && ")]
  return inner.every((gap) => /^(?:[\s;,]|then\b|and\b)*$/i.test(gap)) ? commands : null
}

/** Equal command or label text can occur twice; keep both without rekeying other values. */
function occurrenceKey(value: string, seen: Map<string, number>): string {
  const occurrence = seen.get(value) ?? 0
  seen.set(value, occurrence + 1)
  return JSON.stringify([value, occurrence])
}

/** Commands in one box, each on its own line, with one Copy for all of them. */
function CommandBox({ commands, live }: { commands: string[]; live: StepLive | undefined }) {
  const keys = new Map<string, number>()
  return (
    <div className="q-cmd sp-cmd">
      <code>
        {commands.map((command) => (
          <span key={occurrenceKey(command, keys)}>{command}</span>
        ))}
      </code>
      {live !== undefined ? (
        <button
          type="button"
          className="q-btn quiet sm"
          onClick={() =>
            live.copy(
              commands.join("\n"),
              commands.length > 1 ? "Copied the commands" : "Copied the command",
            )
          }
        >
          <CopyIcon className="size-3" aria-hidden="true" />
          Copy
        </button>
      ) : null}
    </div>
  )
}

/** A labelled step (Do, Run, Expect, Saw) as the label list, its Run line as a command box. */
function StepLines({
  rows,
  raw,
  live,
  quoteLive,
}: {
  rows: { label: string; value: string }[]
  raw: string
  live: StepLive | undefined
  quoteLive: StepLive | undefined
}) {
  const keys = new Map<string, number>()
  return (
    <CommentBlock raw={raw} live={quoteLive}>
      <dl className="sp-labels sp-steplines" data-testid="step-lines">
        {rows.map((row) => {
          const commands = /^run$/i.test(row.label) ? runCommands(row.value) : null
          return (
            <Fragment key={occurrenceKey(`${row.label}:${row.value}`, keys)}>
              <dt>{row.label}</dt>
              <dd>
                {commands !== null ? (
                  <CommandBox commands={commands} live={live} />
                ) : (
                  <InlineMarkdown text={row.value} />
                )}
              </dd>
            </Fragment>
          )
        })}
      </dl>
    </CommentBlock>
  )
}

/** "Start the Builder, then open it: `bun run dev:builder`" → the step and its command. */
export function stepCommand(text: string): { step: string; command: string | null } {
  const body = text.trim()
  const commandEnd = body.endsWith(".") ? body.slice(0, -1).trimEnd() : body
  const close = commandEnd.length - 1
  if (commandEnd.charAt(close) !== "`") return { step: text, command: null }
  const open = commandEnd.lastIndexOf("`", Math.max(0, close - 1))
  if (open < 0 || open >= close - 1) return { step: text, command: null }
  const prefix = trimEndWhile(commandEnd.slice(0, open), (character) => /[:\s]/.test(character))
  if (!isLineText(prefix)) return { step: text, command: null }
  const step = prefix.trim().replace(/[:,]$/, "")
  return {
    step: /[.!?]$/.test(step) ? step : `${step}.`,
    command: commandEnd.slice(open + 1, close),
  }
}

function Html({
  raw,
  live,
  theme,
  kind,
}: {
  raw: string
  live: StepLive | undefined
  theme: string
  /** The lens the passage's Kind line names, shown in the diagram's frame instead of the line. */
  kind?: string | undefined
}) {
  const blocks = useMemo(() => toBlocks(raw), [raw])
  return (
    <>
      {blocks.map((block) => {
        return block.kind === "mermaid" ? (
          <CommentBlock raw={raw} live={live} key={block.key}>
            <div className="sp-diagram">
              <MermaidBlock source={block.source} theme={theme} kind={block.lens ?? kind} enlarge />
            </div>
          </CommentBlock>
        ) : block.kind === "wireframe" || block.kind === "panel" ? (
          <CommentBlock key={block.key} raw={block.text} live={live}>
            <WireframeBlock
              kind={block.kind}
              identity={block.name}
              source={block.source}
              theme={theme}
            />
          </CommentBlock>
        ) : block.kind === "html" || block.kind === "added" ? (
          <CommentBlock key={block.key} raw={block.text} live={live}>
            <SafeHtml html={block.html} />
          </CommentBlock>
        ) : null
      })}
    </>
  )
}

function numberedHeading(text: string): { number: string; label: string } | null {
  // A required label can consume the final character of an otherwise whitespace-only tail.
  const match = /^(\d+)\.\s+(\S.*|[^\S\r\n\u2028\u2029])$/.exec(text)
  return match === null ? null : { number: match[1] ?? "", label: match[2] ?? "" }
}

function Heading({ token, state }: { token: Tokens.Heading; state: StepState }) {
  const text = token.text
  if (state.implement !== undefined && text === "Decided while building") return null
  // A numbered decision or step (`### 2. …`, `#### 1. …`) shows its number apart.
  const numbered = numberedHeading(text)
  if (token.depth === 3 || (token.depth === 4 && numbered !== null)) {
    const Tag = token.depth === 3 ? "h3" : "h4"
    return (
      <Tag
        data-passage-section={headingSlug(text)}
        aria-label={numbered !== null ? text : undefined}
        {...(token.depth === 4 ? { className: "sp-numbered" } : {})}
      >
        {numbered !== null ? <span className="sp-hno">{numbered.number}</span> : null}
        <InlineMarkdown text={numbered?.label ?? text} />
      </Tag>
    )
  }
  const extra = state.headings[text]
  const Tag = token.depth <= 2 ? "h2" : "h4"
  return (
    <Tag
      data-passage-section={headingSlug(text)}
      {...(extra?.target !== undefined ? { id: `${extra.target}-h` } : {})}
    >
      <InlineMarkdown text={text} />
      {extra?.count !== undefined ? <span className="c">{extra.count}</span> : null}
      {extra?.side !== undefined && extra.side !== "" ? (
        <span className="side">{extra.side}</span>
      ) : null}
    </Tag>
  )
}

function Scope({
  lists,
  live,
}: {
  lists: { title: string; list: Tokens.List; raw: string }[]
  live: StepLive | undefined
}) {
  return (
    <CommentBlock raw={lists.map((list) => list.raw).join("\n")} live={live}>
      <div className="q-two sp-scope" data-testid="scope">
        {lists.map(({ title, list }) => (
          <div className="q-box" key={title}>
            <h4>{title}</h4>
            <ul>
              {list.items.map((item) => (
                <li key={item.raw}>
                  <InlineMarkdown text={item.text} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </CommentBlock>
  )
}

function TryIt({
  list,
  live,
  quoteLive,
}: {
  list: Tokens.List
  live: StepLive | undefined
  quoteLive: StepLive | undefined
}) {
  const Tag = list.ordered ? "ol" : "ul"
  return (
    <Tag className="sp-try" data-testid="how-to-try">
      {list.items.map((item) => {
        const { step, command } = stepCommand(item.text)
        return (
          <li key={item.raw}>
            <CommentBlock raw={item.raw} live={quoteLive}>
              <InlineMarkdown text={step} />
              {command !== null ? <CommandBox commands={[command]} live={live} /> : null}
            </CommentBlock>
          </li>
        )
      })}
    </Tag>
  )
}

export function DocMarkdown({ markdown, state, first, live, bare = false, hiddenHeadings }: Props) {
  const quoteLive = state.closed ? undefined : live
  const tokens = useMemo(
    () => marked.lexer(stripFrontmatter(markdown)).filter((t) => t.type !== "space"),
    [markdown],
  )
  // Without a live surface, the page's own theme (its setting, else the system's): a diagram is
  // drawn in literal colours, so a fixed fallback would draw it light on a dark page.
  const theme = live?.theme ?? diagramTheme()
  const out: ReactNode[] = []
  let section = ""
  let lead = first
  let kind: string | undefined
  // The blank lines between blocks were dropped with the space tokens: put one back after each.
  const rawOf = (from: number, to: number) =>
    tokens
      .slice(from, to)
      .map((t) => `${trimEndCharacters(t.raw, "\n")}\n\n`)
      .join("")
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as Token
    const key = `${i}-${token.type}`
    if (bare) {
      out.push(<Html key={key} raw={token.raw} live={quoteLive} theme={theme} />)
      continue
    }
    if (token.type === "heading") {
      const h = token as Tokens.Heading
      if (h.depth === 1) {
        if (!sameTitle(h.text, state.title))
          out.push(
            <CommentBlock key={key} raw={token.raw} live={quoteLive}>
              {/* A title may hold a code span ("Count lines with `--lines`"): drawn, not its backticks. */}
              <h1>
                <InlineMarkdown text={h.text} />
              </h1>
            </CommentBlock>,
          )
        continue
      }
      if (h.depth === 2) {
        section = h.text
        if (hiddenHeadings?.has(h.text)) continue
        // Implement's recorded checks: one folded line that opens to a row per task or slice and
        // command. The document keeps every line; a section with no run line draws as written.
        if (state.step === "implement" && h.text === "Checks") {
          const next = tokens.findIndex(
            (t, at) => at > i && t.type === "heading" && (t as Tokens.Heading).depth <= 2,
          )
          const end = next < 0 ? tokens.length : next
          const checks = parseChecks(
            tokens
              .slice(i + 1, end)
              .map((t) => t.raw)
              .join(""),
          )
          if (checks !== null) {
            lead = false
            out.push(
              <CommentBlock
                key={key}
                raw={tokens
                  .slice(i, end)
                  .map((t) => t.raw)
                  .join("")}
                live={quoteLive}
              >
                <ChecksFold checks={checks} live={live} />
              </CommentBlock>,
            )
            i = end - 1
            continue
          }
        }
        // The Summary right under the title is the page's lead: its heading goes.
        if (lead && h.text === "Summary") continue
        lead = false
        if (OWN_TITLE.has(h.text)) continue
      }
      // A first `###` that only repeats its section's name ("Try it" under "Try it yourself") adds a
      // level, not words: the section's heading stands for it.
      const above = tokens[i - 1]
      if (
        h.depth === 3 &&
        above?.type === "heading" &&
        (above as Tokens.Heading).depth === 2 &&
        (section.trim().toLowerCase() === h.text.trim().toLowerCase() ||
          (section.trim().toLowerCase() === "try it yourself" &&
            h.text.trim().toLowerCase() === "try it"))
      )
        continue
      // Scope's two lists, side by side.
      if (h.depth === 3 && section === "Scope") {
        const lists: { title: string; list: Tokens.List; raw: string }[] = []
        let j = i
        while (
          tokens[j]?.type === "heading" &&
          (tokens[j] as Tokens.Heading).depth === 3 &&
          tokens[j + 1]?.type === "list"
        ) {
          lists.push({
            title: (tokens[j] as Tokens.Heading).text,
            list: tokens[j + 1] as Tokens.List,
            raw: `${tokens[j]?.raw ?? ""}${tokens[j + 1]?.raw ?? ""}`,
          })
          j += 2
        }
        if (lists.length > 0) {
          out.push(<Scope key={key} lists={lists} live={quoteLive} />)
          i = j - 1
          continue
        }
      }
      out.push(
        <CommentBlock key={key} raw={token.raw} live={quoteLive}>
          <Heading token={h} state={state} />
        </CommentBlock>,
      )
      continue
    }
    if (token.type === "paragraph" && lead) {
      lead = false
      out.push(
        <CommentBlock key={key} raw={token.raw} live={quoteLive}>
          <p className="sp-lead">
            <InlineMarkdown text={(token as Tokens.Paragraph).text} />
          </p>
        </CommentBlock>,
      )
      continue
    }
    if (token.type === "list" && section === "How to try it") {
      out.push(<TryIt key={key} list={token as Tokens.List} live={live} quoteLive={quoteLive} />)
      continue
    }
    if (token.type === "paragraph") {
      const text = (token as Tokens.Paragraph).text.trim()
      // The Kind line names the diagram under it: the frame says it, the line goes.
      const lens = /^\*\*(?:Lens|Kind):\*\*\s*([A-Za-z-]+)\s*$/.exec(text)?.[1]
      const next = tokens[i + 1]
      if (lens !== undefined && next?.type === "code" && (next as Tokens.Code).lang === "mermaid") {
        kind = lens.toLowerCase()
        continue
      }
      // Two or more label lines in a row (Oracle, Size, Risky) read as a short list.
      const rows: { label: string; value: string }[] = []
      let j = i
      for (let row = labelOf(tokens[j]); row !== null; row = labelOf(tokens[++j])) rows.push(row)
      if (rows.length >= 2) {
        out.push(<LabelList key={key} rows={rows} raw={rawOf(i, j)} live={quoteLive} />)
        i = j - 1
        continue
      }
    }
    // A labelled step with a Run line (Do, Run, Expect, Saw): labels apart, commands one per line.
    const steps = token.type === "list" ? stepLines(token as Tokens.List) : null
    if (steps !== null) {
      out.push(
        <StepLines key={key} rows={steps} raw={token.raw} live={live} quoteLive={quoteLive} />,
      )
      continue
    }
    out.push(<Html key={key} raw={token.raw} live={quoteLive} theme={theme} kind={kind} />)
    kind = undefined
  }
  return <Fragment>{out}</Fragment>
}
