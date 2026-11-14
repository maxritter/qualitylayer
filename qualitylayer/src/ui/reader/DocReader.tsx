// The centre column: one document at reading width, split into top-level
// blocks. A text selection in it is a mark: `onMark` opens the quick field
// there, whose message goes to the task's session with the passage as context.

import { cn } from "cn"
import DOMPurify from "dompurify"
import { marked, type Token, type Tokens } from "marked"
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { parseArtifactReference, referenceName } from "../../core/artifact/reference.ts"
import { addedBlocks } from "../../core/docs/added.ts"
import { headingSlug } from "../../core/docs/anchor.ts"
import { fenceHeaderName } from "../../core/docs/fence-header.ts"
import { passageText, passageWords } from "../../core/docs/passage.ts"
import type { PassageSelection } from "../agent-window/conversation/context-draft.ts"
import { selectedContextPassage } from "./selected-passage.ts"

export { passageSection, selectedPassage } from "./selected-passage.ts"

import type { DocSections, Evidence } from "../api.ts"
import { ArtifactPreview } from "../artifact/ArtifactPreview.tsx"
import { useClaimReaderBar, useReaderBarSlot } from "../sidebar/ReaderBar.tsx"
import { NamedScreen } from "../step-page/kit/GalleryTabs.tsx"
import { LeadFold } from "../step-page/LeadFold.tsx"
import { useSectionViewing } from "../viewing.tsx"
import { AGENTS_SLUG, AgentsPart } from "./AgentsPart.tsx"
import { CopyMenu } from "./CopyMenu.tsx"
import {
  agentsPathOf,
  copyPictureBody,
  escapeHtml,
  type Rasterise,
  type StepFile,
  stepCopy,
} from "./copy-out.ts"
import { FoldButtons, QaList, RowList } from "./FoldedParts.tsx"
import {
  type Fold,
  foldDocument,
  glanceKind,
  listRows,
  type QaRow,
  qaRows,
  type Row,
  withoutSections,
} from "./folding.ts"
import { MermaidBlock, type Renderer, renderWithMermaid } from "./MermaidBlock.tsx"
import { browserRasterise } from "./rasterise.ts"
import { WireframeBlock } from "./WireframeBlock.tsx"

export type Block = (
  | {
      kind: "html"
      key: string
      html: string
      text: string
      /** The words of a heading block, for jump links, and its level. */
      heading?: string
      level?: number
      table?: true
      paragraph?: true
      /** A list whose items all open with a bold headline, and whether it is numbered. */
      rows?: Row[]
      ordered?: boolean
      /** A two-column question/answer table. */
      qa?: QaRow[]
    }
  /** A later finding written into this document: `> [!ADDED] <stage> · <reason>`; `anchor` is its jump link. */
  | {
      kind: "added"
      key: string
      html: string
      text: string
      stage: string
      reason: string
      anchor: string
      /** The numbered, headline-led items it carries. */
      rows?: Row[]
    }
  | { kind: "mermaid"; key: string; source: string; text: string; lens?: string }
  | { kind: "wireframe"; key: string; source: string; name: string; text: string }
  | { kind: "panel"; key: string; source: string; name: string; text: string }
  | { kind: "artifact"; key: string; path: string; text: string }
  // The glance pages only (see folding.ts):
  /** A list as one folded row per item, later findings already in place. */
  | { kind: "rows"; key: string; text: string; rows: Row[]; ordered: boolean }
  | { kind: "qa"; key: string; text: string; rows: QaRow[] }
  /** The paragraph a page leads with. */
) & {
  /** The passages of blocks merged into this one, which comments on them still find. */
  also?: string[]
  passage?: string
  /** The fold this block sits behind. */
  fold?: string
}

export function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---")) return markdown
  const end = markdown.indexOf("\n---", 3)
  return end === -1 ? markdown : markdown.slice(markdown.indexOf("\n", end + 1) + 1)
}

const quoteOf = (raw: string) => raw.replace(/\s+/g, " ").trim().slice(0, 200)

/** What the document's own markdown yields: the kinds the glance pages fold are made from these. */
export type PlainBlock = Extract<
  Block,
  { kind: "html" | "added" | "mermaid" | "artifact" | "wireframe" | "panel" }
>

const SAFE_URL = /^(https?:|mailto:|data:image\/(png|jpeg|gif|webp);)/i

/**
 * The first layer, independent of any DOM: a plan is markdown, so raw HTML in it
 * is shown as text, and a link that does not go to the web or a mail address becomes its words.
 * Rich HTML belongs in an artifact, which is sandboxed.
 */
function neutralise(tokens: Token[]): void {
  marked.walkTokens(tokens, (token) => {
    if (token.type === "html")
      token.text = /^<!--[\s\S]*?-->[ \t\r\n]*$/.test(token.raw) ? "" : escapeHtml(token.raw)
    if ((token.type === "link" || token.type === "image") && !SAFE_URL.test(token.href.trim())) {
      // Keep the words, drop the target. Not even "#": the URL hash belongs to the router.
      token.type = "text"
    }
  })
}

// Bound to the window on first use, not at import: a sanitiser created without a
// DOM silently returns its input unchanged.
let purifier: { window: Window; purify: ReturnType<typeof DOMPurify> } | null = null
export function sanitize(html: string): string {
  if (purifier === null || purifier.window !== window) {
    const purify = DOMPurify(window)
    // An allow-list on top of the sanitiser's own URL check: a plan links to the web,
    // to a mail address, or within the page. Nothing else survives.
    purify.addHook("afterSanitizeAttributes", (node) => {
      for (const name of ["href", "src", "xlink:href", "action", "formaction"]) {
        const value = node.getAttribute?.(name)
        if (value != null && !SAFE_URL.test(value.trim())) node.removeAttribute(name)
      }
      // A code block that scrolls sideways takes the keyboard's focus, so it can be read without a mouse.
      if (node.tagName === "PRE") node.setAttribute("tabindex", "0")
      // A task list's box says done or not done: a disabled control with no name is no use to a reader that speaks it.
      if (node.tagName === "INPUT" && node.getAttribute("type") === "checkbox")
        node.setAttribute("aria-label", node.hasAttribute("checked") ? "Done" : "Not done")
      if (node.tagName === "A" && node.hasAttribute("href")) {
        node.setAttribute("rel", "noopener noreferrer")
        node.setAttribute("target", "_blank")
      }
    })
    purifier = { window, purify }
  }
  if (!purifier.purify.isSupported) throw new Error("no DOM to sanitise the document with")
  return purifier.purify.sanitize(html, {
    FORBID_TAGS: ["style", "iframe", "form", "object", "embed"],
    FORBID_ATTR: ["style", "onerror", "onclick"],
  })
}

/** A ```diff fence as a review tool shows it: added, removed and hunk lines marked one by one. */
export function diffHtml(source: string): string {
  const lines = source.replace(/\n$/, "").split("\n")
  const rows = lines.map((line) => {
    const kind = line.startsWith("@@")
      ? "hunk"
      : line.startsWith("+")
        ? "add"
        : line.startsWith("-")
          ? "del"
          : "ctx"
    return `<span class="d-${kind}">${line === "" ? " " : escapeHtml(line)}</span>`
  })
  return `<pre class="diff"><code>${rows.join("")}</code></pre>`
}

/** Separator breaks add no characters to a path’s copied or quoted text. */
function markdownRenderer() {
  const renderer = new marked.Renderer()
  const codespan = renderer.codespan.bind(renderer)
  renderer.codespan = (token) =>
    token.text.includes("/") && !/\s/.test(token.text)
      ? `<code>${escapeHtml(token.text).replace(/([/-])/g, "$1<wbr>")}</code>`
      : codespan(token)
  return renderer
}

/** Tokens as sanitised HTML, block by block or inline. */
const htmlOf = (tokens: Token[]) => {
  const list = [...tokens] as Token[] & { links: Record<string, never> }
  list.links = {}
  return sanitize(marked.parser(list, { renderer: markdownRenderer() }))
}
const inlineOf = (tokens: Token[]) =>
  sanitize(marked.Parser.parseInline(tokens, { renderer: markdownRenderer() }))

/**
 * One line of agent-written prose with its bold, italics and code, rendered and sanitised the way
 * the document reader renders them.
 */
export const InlineMarkdown = memo(function InlineMarkdown({ text }: { text: string }) {
  const tokens = marked.Lexer.lexInline(text)
  neutralise(tokens)
  // Sanitised inside an element: a parser may treat a tag at the very start of a string
  // specially (the test DOM's drops a leading <strong>), and the line is inline anyway.
  const html = sanitize(
    `<span>${marked.Parser.parseInline(tokens, { renderer: markdownRenderer() })}</span>`,
  )
  // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised by the reader's own sanitiser
  return <span dangerouslySetInnerHTML={{ __html: html }} />
})

/** A line of a paragraph that opens with a bold label (`**Size:** …`), after the paragraph's first. */
const LABEL_LINE = /\n(?=\*\*[^*\n]+:\*\*)/g

/**
 * Labelled lines written one under another (`**Size:** …` then `**Risky:** …`) are separate facts:
 * each keeps its own line, where Markdown would run them together into one.
 */
function labelledLines(tokens: Token[]): void {
  for (const token of tokens) {
    if (token.type !== "paragraph" || !/\n\*\*[^*\n]+:\*\*/.test(token.text)) continue
    token.tokens = marked.Lexer.lexInline(token.text.replace(LABEL_LINE, "  \n"))
  }
}

/** Split a document into commentable blocks; agent-written markdown is sanitised before it is rendered. */
export function toBlocks(markdown: string, options: { artifacts?: boolean } = {}): PlainBlock[] {
  const blocks: PlainBlock[] = []
  const tokens = marked.lexer(stripFrontmatter(markdown))
  labelledLines(tokens)
  neutralise(tokens)
  let added = 0
  let lens: string | undefined
  tokens.forEach((token: Token, index) => {
    if (token.type === "space") return
    if (token.type === "heading") lens = undefined
    if (token.type === "paragraph") {
      const namedLens = /^\*\*(?:Lens|Kind):\*\*\s*([a-z-]+)\s*$/i.exec(token.text.trim())?.[1]
      if (namedLens !== undefined) lens = namedLens.toLowerCase()
    }
    const key = `${index}-${token.type}`
    const lang =
      token.type === "code" ? token.lang?.trim().split(/\s+/)[0]?.toLowerCase() : undefined
    // Any other alert type stays the quote it is; only an added block is a callout.
    const finding = token.type === "blockquote" ? addedBlocks(token.raw)[0] : undefined
    if (
      finding !== undefined &&
      token.raw.trimStart().startsWith(finding.text.split("\n")[0] ?? "")
    ) {
      const inner = marked.lexer(
        finding.text
          .split("\n")
          .slice(1)
          .map((line) => line.replace(/^>\s?/, ""))
          .join("\n"),
      )
      neutralise(inner)
      added++
      // A callout that is one numbered list can replace the item it restates (see folding.ts).
      const body = inner.filter((t) => t.type !== "space")
      const only = body.length === 1 && body[0]?.type === "list" ? (body[0] as Tokens.List) : null
      const rows = only?.ordered === true ? listRows(only, htmlOf, inlineOf) : null
      blocks.push({
        kind: "added",
        key,
        html: htmlOf(inner),
        text: quoteOf(token.raw),
        stage: finding.stage,
        reason: finding.reason,
        anchor: `added-${added}`,
        ...(rows !== null ? { rows } : {}),
      })
      return
    }
    // A page that draws artifacts shows the one a `ql:artifact <name>` marker names where the marker stands.
    const artifact =
      options.artifacts === true && token.type === "html"
        ? /^<!--\s*ql:artifact\s+(\S+)\s*-->/.exec(token.raw.trim())
        : null
    const artifactReference =
      artifact?.[1] === undefined ? null : parseArtifactReference(artifact[1])
    if (artifactReference !== null) {
      blocks.push({
        kind: "artifact",
        key,
        path:
          artifactReference.file +
          (artifactReference.section ? `#${artifactReference.section}` : ""),
        text: quoteOf(token.raw),
      })
      return
    }
    // A template's comments are notes to the agent, not text: a section still to
    // fill reads as being written (its note is the agent's, never shown), every
    // other comment stays hidden.
    const comment = token.type === "html" ? token.raw.trim().match(/^<!--([\s\S]*?)-->$/) : null
    if (comment !== null && comment !== undefined) {
      if (/^fill:/.test((comment[1] ?? "").trim())) {
        blocks.push({
          kind: "html",
          key,
          html: `<p class="fill-pending">Being written</p>`,
          text: quoteOf(token.raw),
        })
      }
      return
    }
    if (token.type === "code" && (lang === "wireframe" || lang === "panel")) {
      const name = fenceHeaderName(token.text) ?? `${lang}:${index}`
      blocks.push({
        kind: lang,
        key,
        source: token.text,
        name,
        text: `${lang} ${name}`,
      })
      return
    }
    if (token.type === "code" && lang === "mermaid") {
      blocks.push({
        kind: "mermaid",
        key,
        source: token.text,
        text: quoteOf(token.raw),
        ...(lens !== undefined ? { lens } : {}),
      })
      return
    }
    if (token.type === "code" && lang === "artifact") {
      const path = token.text.trim()
      blocks.push({ kind: "artifact", key, path, text: `\`\`\`artifact ${path}` })
      return
    }
    if (token.type === "code" && lang === "diff") {
      blocks.push({
        kind: "html",
        key,
        html: sanitize(diffHtml(token.text)),
        text: quoteOf(token.raw),
      })
      return
    }
    const rows = token.type === "list" ? listRows(token as Tokens.List, htmlOf, inlineOf) : null
    const qa = token.type === "table" ? qaRows(token as Tokens.Table, inlineOf) : null
    blocks.push({
      kind: "html",
      key,
      html: htmlOf([token]),
      text: quoteOf(token.raw),
      ...(token.type === "heading" ? { heading: token.text, level: token.depth } : {}),
      ...(token.type === "table" ? { table: true as const } : {}),
      ...(token.type === "paragraph" ? { paragraph: true as const } : {}),
      ...(rows !== null ? { rows, ordered: token.type === "list" && token.ordered } : {}),
      ...(qa !== null ? { qa } : {}),
    })
  })
  return blocks.map((block) => {
    const token = tokens[Number(block.key.split("-")[0])]
    return token === undefined
      ? block
      : { ...block, passage: passageText(passageWords([token])).trim() }
  })
}

/** A tap on one of these works the control, never a mark on the block's words. */
export const TAP_CONTROLS =
  'a, button, input, textarea, select, summary, label, [role="button"], [contenteditable="true"]'

/** Whether a jump link lands on this block: its heading, or the callout it shows (itself or as a row). */
const jumpsTo = (block: Block, at: string) =>
  block.kind === "added"
    ? block.anchor === at
    : block.kind === "rows"
      ? block.rows.some((row) => row.anchors.includes(at))
      : block.kind === "html" && block.heading !== undefined && headingSlug(block.heading) === at

/**
 * The words a sent message quotes, as a range in the block's text: the quote is whitespace-collapsed
 * and cut at 200 characters, so it is looked for the same way in the rendered text. Null when the
 * block no longer holds those words. Going back from the message's chip marks them.
 */
export function rangeOfQuote(
  host: Element,
  quote: string,
  context?: { before?: string; after?: string },
): Range | null {
  let want = quote.replace(/\s+/g, " ").trim()
  if (want === "") return null
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let raw = ""
  const starts: number[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text
    nodes.push(text)
    starts.push(raw.length)
    raw += text.data
  }
  const flat = raw.replace(/\s+/g, " ")
  let at = flat.indexOf(want)
  if (at === -1) {
    // Block comments keep Markdown, while a text selection already contains rendered words.
    want = passageText(passageWords(marked.lexer(quote))).trim()
    if (want === "") return null
    at = flat.indexOf(want)
  }
  if (at === -1) return null
  if (context && (context.before || context.after)) {
    const before = passageText(context.before ?? "")
    const after = passageText(context.after ?? "")
    let candidate = at
    while (candidate !== -1) {
      if (
        flat.slice(0, candidate).endsWith(before) &&
        flat.slice(candidate + want.length).startsWith(after)
      ) {
        at = candidate
        break
      }
      candidate = flat.indexOf(want, candidate + want.length)
    }
  }
  const locate = (offset: number): [Text, number] | null => {
    let rawOffset = offset
    for (const space of raw.matchAll(/\s+/g)) {
      if (space.index >= rawOffset) break
      rawOffset += space[0].length - 1
    }
    for (let i = nodes.length - 1; i >= 0; i--) {
      const start = starts[i] as number
      if (rawOffset >= start)
        return [nodes[i] as Text, Math.min(rawOffset - start, nodes[i]?.data.length ?? 0)]
    }
    return null
  }
  const from = locate(at)
  const to = locate(at + want.length)
  if (from === null || to === null) return null
  const range = document.createRange()
  range.setStart(from[0], from[1])
  range.setEnd(to[0], to[1])
  return range
}

/** A passage the person selected: what it says, its place in the source, and where it sits on screen. */
export type ReaderMark = {
  passage: PassageSelection
  /** The Markdown the selection was made on; its hash is the revision the agent is told. */
  source: string
  /** The selection's line boxes, in viewport pixels. */
  boxes: { x: number; y: number; width: number; height: number }[]
}

type Props = {
  markdown: string
  theme: string
  loadArtifact: (name: string) => Promise<string>
  loadEvidence?: (name: string) => Promise<Evidence>
  /** A selection in the document: opens the quick field there; undefined when it is read-only. */
  onMark?: (mark: ReaderMark) => void
  /** Back from a sent message: these words come into view, marked for a moment; `key` repeats it. */
  back?: { quote: string; before?: string; after?: string; key: number }
  /** Replaces Mermaid itself; the component suites use it. */
  renderMermaid?: Renderer
  /** Replaces the canvas that draws diagrams and mockups for Copy formatted; the suites use it. */
  rasterise?: Rasterise
  /** A heading's slug: scroll to its section and mark it (the agent's jump links). */
  at?: string
  /** Changes with every outline click, so a second jump to the same heading scrolls again. */
  jumpKey?: number
  /** Copy › For another agent: the prompt that starts the build; set once the Plan is approved. */
  forAgent?: string
  /** Only a known feature or bug-fix Plan offers the partial human Markdown export. */
  planExport?: boolean
  /** Sections (their headings, lower case) shown elsewhere on the page and left out here. */
  hide?: readonly string[]
  /** Read the complete human planning document, including each point's reasoning. */
  unfolded?: boolean
  /** What sits in the header row beside Copy, such as the Sections button. */
  tools?: React.ReactNode
  /**
   * The second-level headings (lower case) of a document's detail sections: the Reader shows
   * them in file order like the rest, dimmed, because the step page leaves them out.
   */
  dimmed?: ReadonlySet<string>
  /**
   * The second-level headings (lower case) the product reading draws folded (`lead-folded`): each
   * part keeps its heading and first paragraph, the rest sits in a fold the person opens.
   */
  folded?: ReadonlySet<string>
  /**
   * Draw the artifact a `ql:artifact <name>` marker names where the marker stands; `open` shows it full size. Absent: the marker stays hidden.
   */
  artifacts?: { open?: ((name: string) => void) | undefined }
  /**
   * The document is a task's step file. Its copies read on their own (page title, a subtitle), the
   * agents' file follows under For agents, read on demand, and Copy for an agent gives both.
   */
  stepFile?: StepFile
}

/**
 * The headings (lower case) the Reader dims: only the working sections the step page leaves out
 * (`detail`). A folded section (`lead-folded`) is open in the Reader like a lead one.
 * Undefined until the document's sections are known.
 */
export function readerDimmed(sections: DocSections | null): Set<string> | undefined {
  if (sections === null) return undefined
  return new Set(
    sections.sections.filter((s) => s.show === "detail").map((s) => s.title.toLowerCase()),
  )
}

type LeadFoldOf = Map<string, { id: string; whole: boolean }>

/**
 * The blocks the product reading folds: inside a `folded` section, each part (the text before its
 * first `###`, or one `###` and what follows) keeps its heading and first paragraph; the rest of
 * the part's blocks share one fold.
 */
export function leadFoldsOf(blocks: Block[], folded: ReadonlySet<string> | undefined): LeadFoldOf {
  const out: LeadFoldOf = new Map()
  if (folded === undefined || folded.size === 0) return out
  let inside = false
  let lead = false
  let fold: { id: string; whole: boolean } | null = null
  for (const block of blocks) {
    const level = block.kind === "html" && block.heading !== undefined ? block.level : undefined
    if (level !== undefined && level <= 2) {
      inside = folded.has(
        (block.kind === "html" ? (block.heading ?? "") : "")
          .replace(/`|\*\*/g, "")
          .trim()
          .toLowerCase(),
      )
      lead = false
      fold = null
      continue
    }
    if (!inside) continue
    if (level === 3) {
      lead = false
      fold = null
      continue
    }
    if (!lead && fold === null && block.kind === "html" && block.paragraph === true) {
      lead = true
      continue
    }
    fold ??= { id: `lead-fold-${block.key}`, whole: !lead }
    lead = true
    out.set(block.key, fold)
  }
  return out
}

type LeadGroup =
  | { kind: "one"; block: Block }
  | { kind: "fold"; id: string; whole: boolean; blocks: Block[] }

/** `blocks` in order, each fold's blocks gathered where the fold begins. */
export function withLeadFolds(blocks: Block[], folds: LeadFoldOf): LeadGroup[] {
  const out: LeadGroup[] = []
  for (const block of blocks) {
    const fold = folds.get(block.key)
    if (fold === undefined) {
      out.push({ kind: "one", block })
      continue
    }
    const last = out[out.length - 1]
    if (last?.kind === "fold" && last.id === fold.id) last.blocks.push(block)
    else out.push({ kind: "fold", id: fold.id, whole: fold.whole, blocks: [block] })
  }
  return out
}

/** The CSS Custom Highlight API marks the quoted words; without it the block is tinted instead. */
const canHighlight = (): boolean =>
  (globalThis as { CSS?: { highlights?: unknown } }).CSS?.highlights !== undefined &&
  (globalThis as { Highlight?: unknown }).Highlight !== undefined

export function DocReader({
  markdown,
  theme,
  loadArtifact,
  onMark,
  back,
  renderMermaid = renderWithMermaid,
  rasterise = browserRasterise,
  at,
  jumpKey,
  forAgent,
  planExport,
  hide,
  unfolded = false,
  tools,
  dimmed,
  folded,
  artifacts,
  stepFile,
  loadEvidence,
}: Props) {
  const drawsArtifacts = artifacts !== undefined
  const plain = useMemo(
    () => toBlocks(markdown, { artifacts: drawsArtifacts }),
    [markdown, drawsArtifacts],
  )
  // What Copy takes out: a step file as a document that reads on its own, else the file as written.
  const stepTask = stepFile?.task
  const stepId = stepFile?.step
  const copied = useMemo(() => {
    const body = stripFrontmatter(markdown)
    const text = stepId !== undefined ? stepCopy(body, { step: stepId, task: stepTask }) : body
    return { body: text, blocks: stepId !== undefined ? toBlocks(text) : plain }
  }, [markdown, plain, stepId, stepTask])
  const loadAgents = stepFile?.load
  // Human planning readers opt into full content; records keep their existing folding.
  const { blocks, folds } = useMemo(() => {
    const shown =
      !unfolded && hide !== undefined && hide.length > 0 ? withoutSections(plain, hide) : plain
    return glanceKind(markdown) === null || unfolded
      ? { blocks: shown, folds: [] as Fold[] }
      : foldDocument(shown)
  }, [markdown, plain, hide, unfolded])
  // The blocks under a detail section's heading, the heading included.
  const detailKeys = useMemo(() => {
    const keys = new Set<string>()
    if (dimmed === undefined || dimmed.size === 0) return keys
    let inside = false
    for (const block of blocks) {
      if (block.kind === "html" && block.level === 2 && block.heading !== undefined)
        inside = dimmed.has(
          block.heading
            .replace(/`|\*\*/g, "")
            .trim()
            .toLowerCase(),
        )
      if (inside) keys.add(block.key)
    }
    return keys
  }, [blocks, dimmed])
  const leadFolds = useMemo(() => leadFoldsOf(blocks, folded), [blocks, folded])
  const page = useRef<HTMLDivElement>(null)
  // A file read under the slim bar puts its tools in that bar (one bar, nothing scrolls away); a
  // document read anywhere else keeps them in a row that stays at the top of its page.
  const bar = useReaderBarSlot()
  const [barHost, setBarHost] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const around = bar?.element.closest(".rs-crumb")?.parentElement
    setBarHost(
      bar !== null && around != null && page.current !== null && around.contains(page.current)
        ? bar.element
        : null,
    )
  }, [bar])
  useClaimReaderBar(barHost !== null)

  const focusedJump = useRef<number | undefined>(undefined)
  useSectionViewing(page, markdown, at)

  // A jump link lands on its heading and marks the section under it, up to the next
  // heading; the mark fades out in CSS (the SPA keeps no timers).
  useEffect(() => {
    const root = page.current
    if (root === null) return
    if (jumpKey === undefined) focusedJump.current = undefined
    for (const marked of root.querySelectorAll(".jump-target"))
      marked.classList.remove("jump-target")
    if (at === undefined || blocks.length === 0) return
    const target = blocks.find((b) => jumpsTo(b, at))
    if (target === undefined) return
    const block = root.querySelector<HTMLElement>(`[data-block-key="${target.key}"]`)
    // A callout folded into a list is a row of it.
    const row = [...(block?.querySelectorAll<HTMLElement>("[data-anchors]") ?? [])].find((el) =>
      el.dataset.anchors?.split(" ").includes(at),
    )
    // Only the heading is marked, briefly: enough to find the place, not a new colour to decode.
    const heading = row ?? block
    if (heading === null || heading === undefined) return
    heading.classList.add("jump-target")
    heading.scrollIntoView?.({ block: "start" })
    if (jumpKey !== undefined && focusedJump.current !== jumpKey) {
      focusedJump.current = jumpKey
      heading.tabIndex = -1
      heading.focus({ preventScroll: true })
    }
    // Diagrams and mockups above it grow as they load and push it down: keep it in view
    // while the page settles, until the reader scrolls on their own.
    if (typeof ResizeObserver === "undefined") return
    const follow = new ResizeObserver(() => heading.scrollIntoView?.({ block: "start" }))
    follow.observe(root)
    const stop = () => {
      follow.disconnect()
      for (const name of ["wheel", "touchstart", "keydown", "mousedown"]) {
        window.removeEventListener(name, stop)
      }
    }
    for (const name of ["wheel", "touchstart", "keydown", "mousedown"]) {
      window.addEventListener(name, stop, { passive: true })
    }
    return stop
  }, [at, blocks, jumpKey])

  // A selection inside the page is a mark: the quick field opens under it. Listening on the
  // document keeps the page a plain container and also hears a drag that ends outside it; the
  // latest `onMark` is read through a ref, so a re-render never drops a mouseup.
  const marking = useRef(onMark)
  marking.current = onMark
  const source = useRef(markdown)
  source.current = markdown
  const marks = onMark !== undefined
  // Attached in layout, so a selection made right after the page first shows is already heard.
  useLayoutEffect(() => {
    if (!marks) return
    const done = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Shift") return
      const picked = window.getSelection()
      const text = picked?.toString().trim() ?? ""
      if (picked === null || picked.rangeCount === 0 || text.length < 3) return
      const range = picked.getRangeAt(0)
      if (page.current?.contains(range.commonAncestorContainer) !== true) return
      if ((range.commonAncestorContainer as Element).closest?.(TAP_CONTROLS)) return
      const passage = selectedContextPassage(picked) ?? {
        quote: quoteOf(text),
        before: "",
        after: "",
        section: "document-start",
      }
      const boxes = Array.from(range.getClientRects())
        .filter((box) => box.width > 1)
        .map((box) => ({ x: box.left, y: box.top, width: box.width, height: box.height }))
      if (boxes.length) marking.current?.({ passage, source: source.current, boxes })
    }
    document.addEventListener("mouseup", done)
    document.addEventListener("keyup", done)
    return () => {
      document.removeEventListener("mouseup", done)
      document.removeEventListener("keyup", done)
    }
  }, [marks])

  const passageSections = useMemo(() => {
    const sections = new Map<string, string>()
    let section = ""
    for (const block of plain) {
      if (block.kind === "html" && block.heading !== undefined) section = headingSlug(block.heading)
      if (section) sections.set(block.key, section)
    }
    return sections
  }, [plain])

  // A fold opens on a click; it stays open while a jump link, a comment or an ask is inside it.
  const [chosen, setChosen] = useState<Record<string, boolean>>({})

  // Back from a sent message's chip: the quoted words come into view and are marked for a moment,
  // where the browser can paint a range (the CSS Custom Highlight API); otherwise their block is.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `blocks` change what is drawn
  useEffect(() => {
    const root = page.current
    if (back === undefined || root === null) return
    let range: Range | null = null
    let host: HTMLElement | null = null
    for (const block of root.querySelectorAll<HTMLElement>('[data-testid="block"]')) {
      range = rangeOfQuote(block, back.quote, back)
      if (range !== null) {
        host = block
        break
      }
    }
    if (host === null) return
    host.scrollIntoView?.({ block: "center" })
    const registry = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights
    const Highlight = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
    if (registry !== undefined && Highlight !== undefined && range !== null && canHighlight())
      registry.set("ql-quote", new Highlight(range))
    else host.classList.add("commented-fallback")
    const marked = host
    const timer = setTimeout(() => {
      registry?.delete("ql-quote")
      marked.classList.remove("commented-fallback")
    }, 4000)
    return () => {
      clearTimeout(timer)
      registry?.delete("ql-quote")
      marked.classList.remove("commented-fallback")
    }
  }, [back?.key, blocks])
  const foldOpen = (id: string) =>
    chosen[id] ?? blocks.some((b) => b.fold === id && at !== undefined && jumpsTo(b, at))

  const renderBlock = (block: Block) => {
    const html = block.kind === "html" ? block.html : ""
    return (
      <div
        key={block.key}
        className={cn("block", detailKeys.has(block.key) && "detail-section")}
        data-testid="block"
        data-block-key={block.key}
        data-comment-source={block.text}
        data-passage-section={passageSections.get(block.key)}
        data-section-show={detailKeys.has(block.key) ? "detail" : undefined}
      >
        {block.kind === "mermaid" ? (
          <MermaidBlock
            source={block.source}
            theme={theme}
            render={renderMermaid}
            kind={block.lens}
          />
        ) : null}
        {block.kind === "wireframe" || block.kind === "panel" ? (
          <WireframeBlock
            kind={block.kind}
            identity={block.name}
            source={block.source}
            theme={theme}
          />
        ) : null}
        {block.kind === "artifact" ? (
          <NamedScreen name={referenceName(block.path)}>
            <ArtifactPreview
              path={block.path}
              load={loadArtifact}
              loadScope={loadArtifact}
              {...(artifacts?.open !== undefined && block.path.startsWith("artifacts/")
                ? {
                    onOpen: () => artifacts.open?.(block.path.replace(/^artifacts\/|\.html$/g, "")),
                  }
                : {})}
            />
          </NamedScreen>
        ) : null}
        {block.kind === "html" ? (
          <div
            className={block.table === true ? "table-scroll" : undefined}
            {...(block.table === true
              ? { role: "region", "aria-label": "Table", tabIndex: 0 }
              : {})}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised by DOMPurify in toBlocks
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : null}
        {block.kind === "rows" ? <RowList rows={block.rows} at={at} /> : null}
        {block.kind === "qa" ? <QaList rows={block.rows} /> : null}
        {block.kind === "added" ? (
          <div className="amend" data-testid="added-block">
            <header>
              <span className="amend-pill">Added in {block.stage}</span>
              {block.reason !== "" ? <span className="amend-why">{block.reason}</span> : null}
            </header>
            {/* biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised by DOMPurify in toBlocks */}
            <div dangerouslySetInnerHTML={{ __html: block.html }} />
          </div>
        ) : null}
      </div>
    )
  }

  const toolRow = (
    <>
      {tools}
      <CopyMenu
        body={copied.body}
        blocks={copied.blocks}
        theme={theme}
        renderMermaid={renderMermaid}
        loadArtifact={loadArtifact}
        rasterise={rasterise}
        prepareBlocks={async () => {
          const load = loadEvidence
          return load ? toBlocks(await copyPictureBody(copied.body, load)) : copied.blocks
        }}
        {...(stepId !== undefined && loadAgents !== undefined
          ? { agents: { step: stepId, load: () => loadAgents(agentsPathOf(stepId)) } }
          : {})}
        {...(forAgent !== undefined ? { forAgent } : {})}
        {...(planExport === true ? { planExport: true } : {})}
        {...(bar?.copyPath != null && barHost !== null ? { copyPath: bar.copyPath } : {})}
      />
    </>
  )

  return (
    <div className="page" ref={page} data-testid="doc-reader">
      {barHost !== null ? (
        createPortal(toolRow, barHost)
      ) : (
        <div className="doc-tools" data-testid="doc-tools">
          {toolRow}
        </div>
      )}
      {withLeadFolds(
        blocks.filter((b) => b.fold === undefined),
        leadFolds,
      ).map((group) =>
        group.kind === "one" ? (
          renderBlock(group.block)
        ) : (
          <LeadFold
            key={group.id}
            whole={group.whole}
            diagram={group.blocks.some((b) => b.kind === "mermaid")}
          >
            {group.blocks.map(renderBlock)}
          </LeadFold>
        ),
      )}
      {folds.length > 0 ? (
        <FoldButtons
          folds={folds}
          isOpen={foldOpen}
          toggle={(id) => setChosen({ ...chosen, [id]: !foldOpen(id) })}
        />
      ) : null}
      {folds
        .filter((fold) => foldOpen(fold.id))
        .flatMap((fold) => blocks.filter((b) => b.fold === fold.id).map(renderBlock))}
      {stepId !== undefined && loadAgents !== undefined ? (
        <AgentsPart
          key={`${stepTask ?? ""}:${stepId}`}
          step={stepId}
          load={() => loadAgents(agentsPathOf(stepId))}
          parse={toBlocks}
          theme={theme}
          renderMermaid={renderMermaid}
          jump={at === AGENTS_SLUG ? (jumpKey ?? 0) : undefined}
        />
      ) : null}
    </div>
  )
}
