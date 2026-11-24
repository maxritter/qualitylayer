// What the review mode of the Verify page reads from the people's file (03-verify.md): the agent's
// Why and its Diagrams. The code row, the pictures and Done means as it ran come from the records,
// not from this text.

import { marked, type Token, type Tokens } from "marked"
import type { DocSections } from "../../api.ts"
import { bodyOf, sentencesOf } from "../../step-page/sections.ts"

const sectionOf = (sections: DocSections | null, title: string): string =>
  sections?.sections.find((section) => section.title === title)?.markdown ?? ""

const plain = (text: string) => text.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim()

export type ChangedDiagram = {
  id: string
  /** The `###` above the diagram, else its kind in words. */
  title: string
  kind: "sequence" | "flow" | "state"
  /** The Mermaid source. */
  code: string
  /** The one sentence before it, which says what it shows. */
  caption: string
}

const KIND_WORDS = { sequence: "Sequence", flow: "Flow", state: "States" } as const

const kindOf = (code: string): ChangedDiagram["kind"] => {
  const first = code.trim().split(/\s+/)[0] ?? ""
  if (first.startsWith("sequenceDiagram")) return "sequence"
  return first.startsWith("stateDiagram") ? "state" : "flow"
}

/** The diagrams of *Diagrams*, in the order written: a sentence, then its Mermaid fence. */
export function diagramsOf(markdown: string): ChangedDiagram[] {
  const out: ChangedDiagram[] = []
  let title: string | null = null
  let sentence = ""
  for (const token of marked.lexer(markdown.replace(/^## .*\n?/, "")) as Token[]) {
    if (token.type === "heading") title = plain((token as Tokens.Heading).text)
    else if (token.type === "paragraph") sentence = plain((token as Tokens.Paragraph).text)
    else if (token.type === "code" && (token as Tokens.Code).lang === "mermaid") {
      const code = (token as Tokens.Code).text
      const kind = kindOf(code)
      out.push({
        id: `d${out.length + 1}`,
        title: title ?? KIND_WORDS[kind],
        kind,
        code,
        caption: sentence,
      })
      title = null
      sentence = ""
    }
  }
  // Two diagrams of one kind are told apart by their number.
  return out.map((item, index) =>
    out.filter((other) => other.title === item.title).length > 1
      ? {
          ...item,
          title: `${item.title} ${out.slice(0, index).filter((o) => o.title === item.title).length + 1}`,
        }
      : item,
  )
}

export type ReviewRecord = {
  /** The agent's Why, in at most one sentence. */
  why: string
  diagrams: ChangedDiagram[]
}

export function reviewRecord(sections: DocSections | null, fallbackWhy = ""): ReviewRecord {
  const writtenWhy = sentencesOf(bodyOf(sectionOf(sections, "Why")))[0] ?? ""
  const why = writtenWhy !== "" ? writtenWhy : (sentencesOf(bodyOf(fallbackWhy))[0] ?? "")
  return {
    why,
    diagrams: diagramsOf(sectionOf(sections, "Diagrams")),
  }
}
