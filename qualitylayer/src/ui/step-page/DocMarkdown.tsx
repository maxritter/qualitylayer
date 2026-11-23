// A step document's own Markdown, rendered as written and sanitised as the reader sanitises it.
// The page dresses a few things the way the approved artifact draws them, never changing the words:
// the title the header already shows is left out, the opening line reads as the lead, a heading
// gets the count its part adds, a numbered decision or step shows its number apart, a `###` that
// only repeats its section's name is left out, the person's own words under Problem are labelled,
// Scope's two lists sit side by side, each command in How to try it gets a Copy button, and a
// labelled step (Do, Run, Expect, Saw) reads as a label list with its commands one per line.

import { marked, type Token, type Tokens } from "marked"
import { Fragment, type ReactNode, useMemo } from "react"
import { InlineMarkdown, stripFrontmatter } from "../reader/DocReader.tsx"
import { diagramTheme } from "../reader/MermaidBlock.tsx"
import { ChecksFold } from "./ChecksFold.tsx"
import {
  CommentBlock,
  Heading,
  Html,
  LabelList,
  Scope,
  StepLines,
  TryIt,
} from "./DocMarkdownParts.tsx"
import {
  collectLabelRun,
  collectScopeLists,
  diagramLensOf,
  extractChecksBlock,
  hasWrittenMarkdown,
  isRepeatedSubheading,
  joinRawBlocks,
  runCommands,
  sameTitle,
  stepLines,
} from "./doc-markdown-parse.ts"
import type { StepLive } from "./live.ts"
import { OWN_TITLE, type StepState } from "./state.ts"

export { CommentBlock, hasWrittenMarkdown, runCommands, stepLines }

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

type WalkContext = {
  tokens: readonly Token[]
  state: StepState
  live: StepLive | undefined
  quoteLive: StepLive | undefined
  theme: string
  hiddenHeadings: ReadonlySet<string> | undefined
  section: string
  lead: boolean
  kind: string | undefined
}

type StepResult = { node?: ReactNode; nextIndex: number }

function renderH2(
  h: Tokens.Heading,
  index: number,
  key: string,
  ctx: WalkContext,
): StepResult | null {
  ctx.section = h.text
  if (ctx.hiddenHeadings?.has(h.text)) return { nextIndex: index }
  if (ctx.state.step === "implement" && h.text === "Checks") {
    const found = extractChecksBlock(ctx.tokens, index)
    if (found !== null) {
      ctx.lead = false
      return {
        nextIndex: found.end - 1,
        node: (
          <CommentBlock key={key} raw={found.raw} live={ctx.quoteLive}>
            <ChecksFold checks={found.checks} live={ctx.live} />
          </CommentBlock>
        ),
      }
    }
  }
  if (ctx.lead && h.text === "Summary") return { nextIndex: index }
  ctx.lead = false
  if (OWN_TITLE.has(h.text)) return { nextIndex: index }
  return null
}

function renderHeadingToken(
  h: Tokens.Heading,
  index: number,
  key: string,
  ctx: WalkContext,
): StepResult {
  if (h.depth === 1) {
    const node = sameTitle(h.text, ctx.state.title) ? undefined : (
      <CommentBlock key={key} raw={h.raw} live={ctx.quoteLive}>
        <h1>
          <InlineMarkdown text={h.text} />
        </h1>
      </CommentBlock>
    )
    return { nextIndex: index, node }
  }
  if (h.depth === 2) {
    const handled = renderH2(h, index, key, ctx)
    if (handled !== null) return handled
  }
  if (isRepeatedSubheading(h, ctx.tokens[index - 1], ctx.section)) return { nextIndex: index }
  if (h.depth === 3 && ctx.section === "Scope") {
    const { lists, nextIndex } = collectScopeLists(ctx.tokens, index)
    if (lists.length > 0) {
      return {
        nextIndex: nextIndex - 1,
        node: <Scope key={key} lists={lists} live={ctx.quoteLive} />,
      }
    }
  }
  return {
    nextIndex: index,
    node: (
      <CommentBlock key={key} raw={h.raw} live={ctx.quoteLive}>
        <Heading token={h} state={ctx.state} />
      </CommentBlock>
    ),
  }
}

function renderParagraphToken(
  token: Tokens.Paragraph,
  index: number,
  key: string,
  ctx: WalkContext,
): StepResult | null {
  if (ctx.lead) {
    ctx.lead = false
    return {
      nextIndex: index,
      node: (
        <CommentBlock key={key} raw={token.raw} live={ctx.quoteLive}>
          <p className="sp-lead">
            <InlineMarkdown text={token.text} />
          </p>
        </CommentBlock>
      ),
    }
  }
  const lens = diagramLensOf(token, ctx.tokens[index + 1])
  if (lens !== undefined) {
    ctx.kind = lens
    return { nextIndex: index }
  }
  const { rows, nextIndex } = collectLabelRun(ctx.tokens, index)
  if (rows.length >= 2) {
    const raw = joinRawBlocks(ctx.tokens, index, nextIndex)
    return {
      nextIndex: nextIndex - 1,
      node: <LabelList key={key} rows={rows} raw={raw} live={ctx.quoteLive} />,
    }
  }
  return null
}

function renderBodyToken(token: Token, index: number, key: string, ctx: WalkContext): StepResult {
  if (token.type === "heading") {
    return renderHeadingToken(token as Tokens.Heading, index, key, ctx)
  }
  if (token.type === "list" && ctx.section === "How to try it") {
    return {
      nextIndex: index,
      node: (
        <TryIt key={key} list={token as Tokens.List} live={ctx.live} quoteLive={ctx.quoteLive} />
      ),
    }
  }
  if (token.type === "paragraph") {
    const handled = renderParagraphToken(token as Tokens.Paragraph, index, key, ctx)
    if (handled !== null) return handled
  }
  const steps = token.type === "list" ? stepLines(token as Tokens.List) : null
  if (steps !== null) {
    return {
      nextIndex: index,
      node: (
        <StepLines
          key={key}
          rows={steps}
          raw={token.raw}
          live={ctx.live}
          quoteLive={ctx.quoteLive}
        />
      ),
    }
  }
  const kind = ctx.kind
  ctx.kind = undefined
  return {
    nextIndex: index,
    node: <Html key={key} raw={token.raw} live={ctx.quoteLive} theme={ctx.theme} kind={kind} />,
  }
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
  const ctx: WalkContext = {
    tokens,
    state,
    live,
    quoteLive,
    theme,
    hiddenHeadings,
    section: "",
    lead: first,
    kind: undefined,
  }
  let i = 0
  while (i < tokens.length) {
    const token = tokens[i] as Token
    const key = `${i}-${token.type}`
    if (bare) {
      out.push(<Html key={key} raw={token.raw} live={quoteLive} theme={theme} />)
      i += 1
      continue
    }
    const step = renderBodyToken(token, i, key, ctx)
    if (step.node !== undefined) out.push(step.node)
    i = step.nextIndex + 1
  }
  return <Fragment>{out}</Fragment>
}
