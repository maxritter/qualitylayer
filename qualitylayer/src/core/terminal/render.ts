import { sourceBox as mermaidSourceBox, render } from "grok-mermaid"
import { extractFences } from "../docs/fence-scanner.ts"
import { parseFence } from "../docs/fragments.ts"
import { withoutMarks } from "../docs/mermaid-style.ts"
import { sectionRanges } from "../docs/rules/types.ts"
import { type DocFacts, schemaForDoc, sectionMatches, sectionShow } from "../docs/schema.ts"
import { renderMindmap } from "./mindmap.ts"
import { sketch } from "./sketch.ts"

/** `lead` filters the sections of the document `file` names, as its `facts` resolve its schema. */
export type TerminalOptions = { width: number; lead: boolean; file?: string; facts?: DocFacts }

function visibleControls(source: string): string {
  return Array.from(source, (char) => {
    const code = char.codePointAt(0) ?? 0
    return (code < 32 && char !== "\n" && char !== "\t") || (code >= 127 && code <= 159)
      ? `\\x${code.toString(16).padStart(2, "0")}`
      : char
  }).join("")
}

export function sourceBox(source: string, width: number): string {
  return mermaidSourceBox(visibleControls(source), width).plain.join("\n")
}

export function textFence(text: string): string {
  const marker = "`".repeat(
    Math.max(3, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length + 1)),
  )
  return `${marker}text\n${text}\n${marker}`
}

function diagram(source: string, width: number): string {
  const safe = visibleControls(source)
  if (/^\s*mindmap(?:\s|$)/.test(safe)) {
    const tree = renderMindmap(safe.trimStart())
    return tree.length > 0 && tree.split("\n").every((line) => Bun.stringWidth(line) <= width)
      ? tree
      : sourceBox(source, width)
  }
  try {
    // A terminal draws no colour, so a part's mark (`:::focal`) says nothing here, and the text
    // renderer does not read it in every diagram type.
    const art = render(withoutMarks(safe))
    if (art && art.warnings.length === 0 && art.width <= width) return art.plain.join("\n")
  } catch {
    // A diagram that cannot be parsed remains readable as source.
  }
  return sourceBox(source, width)
}

function leadSections(
  markdown: string,
  file: string | undefined,
  facts: DocFacts | undefined,
): string {
  if (file === undefined || facts === undefined) return markdown
  const schema = schemaForDoc(file, facts)
  if (!schema) return markdown
  const ranges = sectionRanges(markdown)
  const lines = markdown.split("\n")
  for (const range of ranges.reverse()) {
    const spec = schema.sections.find((section) => sectionMatches(section, range.heading))
    if (spec && spec.terminal_lead !== true && sectionShow(spec) !== "lead")
      lines.splice(range.start - 1, range.end - range.start)
  }
  return lines.join("\n")
}

export async function renderTerminal(markdown: string, options: TerminalOptions): Promise<string> {
  if (options.lead) markdown = leadSections(markdown, options.file, options.facts)
  const lines = markdown.split("\n")
  for (const fence of extractFences(markdown).reverse()) {
    if (fence.kind !== "mermaid" && fence.kind !== "wireframe") continue
    const parsed = fence.kind === "wireframe" ? parseFence("wireframe", fence.body) : null
    const body = parsed
      ? parsed.fragment
        ? sketch(parsed.fragment, options.width)
        : sourceBox(fence.body, options.width)
      : diagram(fence.body, options.width)
    lines.splice(fence.line - 1, fence.endLine - fence.line + 1, textFence(body))
  }
  return lines.join("\n")
}
