import type { Token } from "marked"
import type { ReactNode } from "react"
import { CommitChip, FileChip } from "../../kit/marks/index.ts"
import { type Chip, chipOf } from "./chips.ts"

export type Opens = {
  file?(path: string): void
  commit?(sha: string): void
  changes?(): void
}

export const bareLineBreak = (raw: string): boolean => /^<br[ \t]*\/?>[ \t\r\n]*$/i.test(raw)

function chipFor(chip: Chip, opens: Opens, key: number, label?: ReactNode): ReactNode {
  if (chip.kind === "commit") {
    if (!opens.commit) return undefined
    return label === undefined ? (
      <CommitChip key={key} sha={chip.sha} onOpen={opens.commit} />
    ) : (
      <button key={key} type="button" className="q-link" onClick={() => opens.commit?.(chip.sha)}>
        {label}
      </button>
    )
  }
  if (!opens.file) return undefined
  const name = chip.path.split("/").pop() ?? chip.path
  return (
    <FileChip key={key} path={chip.path} onOpen={opens.file}>
      {label ?? (chip.line === undefined ? undefined : `${name}:${chip.line}`)}
    </FileChip>
  )
}

function textOf(text: string): string {
  if (!text.includes("&") || typeof document === "undefined") return text
  const field = document.createElement("textarea")
  // Only entities reach the HTML decoder; angle brackets stay text, and React escapes the result.
  field.innerHTML = text.replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  return field.value
}

/** Links never control the App's route or execute a URL scheme supplied by a message. */
function webTarget(href: string): string | undefined {
  if (!/^(?:https?:\/\/|mailto:)/i.test(href.trim())) return undefined
  try {
    const url = new URL(href)
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}

function linkOf(token: Token, opens: Opens, key: number): ReactNode {
  const href = "href" in token ? String(token.href) : ""
  const image = token.type === "image"
  const children = image
    ? `Image: ${textOf(token.text || "Image")}`
    : inlineTokens("tokens" in token ? (token.tokens ?? []) : [], opens)
  const target = webTarget(href)
  if (target)
    return (
      <a key={key} href={target} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  const chip = chipOf(href)
  return (chip && chipFor(chip, opens, key, children)) || children
}

function nestedInline(token: Token, opens: Opens): ReactNode[] {
  return inlineTokens("tokens" in token ? (token.tokens ?? []) : [], opens)
}

function codeSpanOf(text: string, opens: Opens, key: number): ReactNode {
  const chip = chipOf(text)
  return (chip && chipFor(chip, opens, key)) || <code key={key}>{text}</code>
}

type InlineRenderer = (token: Token, key: number, opens: Opens) => ReactNode

const INLINE_RENDERERS: Record<string, InlineRenderer> = {
  codespan: (token, key, opens) => codeSpanOf("text" in token ? token.text : "", opens, key),
  strong: (token, key, opens) => <strong key={key}>{nestedInline(token, opens)}</strong>,
  em: (token, key, opens) => <em key={key}>{nestedInline(token, opens)}</em>,
  del: (token, key, opens) => <del key={key}>{nestedInline(token, opens)}</del>,
  link: (token, key, opens) => linkOf(token, opens, key),
  image: (token, key, opens) => linkOf(token, opens, key),
  br: (_token, key) => <br key={key} />,
  html: (token, key) => (bareLineBreak(token.raw) ? <br key={key} /> : token.raw),
  checkbox: () => null,
  text: (token, _key, opens) =>
    "tokens" in token && token.tokens
      ? nestedInline(token, opens)
      : textOf("text" in token ? token.text : ""),
  escape: (token) => ("text" in token ? token.text : token.raw),
}

function part(token: Token, key: number, opens: Opens): ReactNode {
  const render = INLINE_RENDERERS[token.type]
  return render ? render(token, key, opens) : token.raw
}

export function inlineTokens(tokens: readonly Token[], opens: Opens): ReactNode[] {
  return tokens.map((token, index) => part(token, index, opens))
}
