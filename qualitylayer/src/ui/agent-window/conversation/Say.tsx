// Structured agent prose shares one renderer; machine output stays literal in Log.
import { marked, type Token, type Tokens } from "marked"
import { createContext, memo, type ReactNode, useContext, useMemo, useRef } from "react"
import { bareLineBreak, inlineTokens, type Opens } from "./Inline.tsx"

export type { Opens } from "./Inline.tsx"
export const OpensContext = createContext<Opens>({})

/** The actions as one value that keeps its identity, so blocks already drawn are not drawn again. */
export function useOpens(actions: Opens): Opens {
  const latest = useRef(actions)
  latest.current = actions
  const hasFile = actions.file !== undefined
  const hasCommit = actions.commit !== undefined
  const hasChanges = actions.changes !== undefined
  return useMemo(
    () => ({
      ...(hasFile ? { file: (path: string) => latest.current.file?.(path) } : {}),
      ...(hasCommit ? { commit: (sha: string) => latest.current.commit?.(sha) } : {}),
      ...(hasChanges ? { changes: () => latest.current.changes?.() } : {}),
    }),
    [hasFile, hasCommit, hasChanges],
  )
}

function visible(tokens: readonly Token[]): Token[] {
  return tokens.filter((token) => !["space", "def", "checkbox"].includes(token.type))
}

function Table({ table, opens }: { table: Tokens.Table; opens: Opens }) {
  const cell = (value: Tokens.TableCell) => inlineTokens(value.tokens, opens)
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a wide table must remain keyboard-scrollable
    <section className="cv-table-scroll" aria-label="Message table" tabIndex={0}>
      <table>
        <thead>
          <tr>
            {table.header.map((value, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: columns retain their order while a table streams
              <th key={index} scope="col" style={{ textAlign: value.align ?? undefined }}>
                {cell(value)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are appended as the same reply streams
            <tr key={index}>
              {row.map((value, column) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: cells retain their column
                <td key={column} style={{ textAlign: value.align ?? undefined }}>
                  {cell(value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function List({ list, opens }: { list: Tokens.List; opens: Opens }) {
  const Tag = list.ordered ? "ol" : "ul"
  return (
    <Tag
      start={list.ordered && typeof list.start === "number" ? list.start : undefined}
      className={list.items.some((item) => item.task) ? "cv-task-list" : undefined}
    >
      {list.items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: list items retain their order while a reply streams
        <li key={index} className={item.task ? "cv-task-item" : undefined}>
          {item.task ? (
            <input
              type="checkbox"
              checked={item.checked === true}
              disabled
              aria-label={item.text}
            />
          ) : null}
          <div>
            {visible(item.tokens).map((token, at) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: blocks are in recorded order
              <Block key={at} token={token} opens={opens} />
            ))}
          </div>
        </li>
      ))}
    </Tag>
  )
}

function tokenChildren(token: Token, opens: Opens): ReactNode {
  if ("tokens" in token && token.tokens) return inlineTokens(token.tokens, opens)
  return "text" in token ? token.text : token.raw
}

function HeadingBlock({ token, opens }: { token: Tokens.Heading; opens: Opens }) {
  const Heading = token.depth <= 1 ? "h3" : token.depth === 2 ? "h4" : "h5"
  return <Heading>{tokenChildren(token, opens)}</Heading>
}

function QuoteBlock({ token, opens }: { token: Tokens.Blockquote; opens: Opens }) {
  return (
    <blockquote>
      {visible(token.tokens ?? []).map((child, at) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: quoted blocks are in recorded order
        <Block key={at} token={child} opens={opens} />
      ))}
    </blockquote>
  )
}

type BlockRenderer = (token: Token, opens: Opens) => ReactNode

const BLOCK_RENDERERS: Record<string, BlockRenderer> = {
  paragraph: (token, opens) => <p>{tokenChildren(token, opens)}</p>,
  text: (token, opens) => <>{tokenChildren(token, opens)}</>,
  heading: (token, opens) => <HeadingBlock token={token as Tokens.Heading} opens={opens} />,
  table: (token, opens) => <Table table={token as Tokens.Table} opens={opens} />,
  list: (token, opens) => <List list={token as Tokens.List} opens={opens} />,
  blockquote: (token, opens) => <QuoteBlock token={token as Tokens.Blockquote} opens={opens} />,
  code: (token) => (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: wide code must remain keyboard-scrollable
    <pre className="cv-code" tabIndex={0}>
      {"text" in token ? token.text : token.raw}
    </pre>
  ),
  hr: () => <hr />,
  html: (token) => (bareLineBreak(token.raw) ? <br /> : <p>{token.raw}</p>),
}

function Block({ token, opens }: { token: Token; opens: Opens }): ReactNode {
  const render = BLOCK_RENDERERS[token.type]
  return render ? render(token, opens) : <p>{token.raw}</p>
}

const PieceView = memo(
  function PieceView({ token }: { token: Token; references: string }) {
    const opens = useContext(OpensContext)
    return <Block token={token} opens={opens} />
  },
  (before, after) =>
    before.token.type === after.token.type &&
    before.token.raw === after.token.raw &&
    before.references === after.references,
)

function pieces(text: string) {
  const tokens = marked.lexer(text, { gfm: true })
  const blocks = visible(tokens).flatMap((token) => {
    if (token.type !== "paragraph" || !/^ {0,3}• /m.test(token.raw)) return [token]
    // Native bullet characters are prose; never rewrite their appearances inside fenced code.
    const lexer = new marked.Lexer({ gfm: true })
    lexer.tokens.links = tokens.links
    return visible(lexer.lex(token.raw.replace(/^([ ]{0,3})• /gm, "$1- ")))
  })
  return { blocks, references: JSON.stringify(tokens.links) }
}

export function Say({ text }: { text: string }) {
  const { blocks, references } = useMemo(() => pieces(text), [text])
  return (
    <div className="cv-say">
      {blocks.map((token, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks of one message, in order; a growing message only adds at the end
        <PieceView key={index} token={token} references={references} />
      ))}
    </div>
  )
}
