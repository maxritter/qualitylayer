// The Your calls of the Plan, read once at approval and kept in the baseline. An answered call
// is the person's decision: the Decided-by-you row is built from that record (the option the person
// picked, with the option's words as approved), so a later edit that reformats the block, say from
// `**A:**` lines into prose, cannot take the row away or move the approved digest.

import { isYourCall } from "../docs/rules/doc-rules.ts"
import { proseLines } from "../docs/rules/types.ts"

/** A Your call as approved: the decision's title and the words of its two options. */
export type YourCallRecord = { what: string; A?: string; B?: string; recommended?: "A" | "B" }

export type CallBlock = { title: string; text: string[]; id?: string }

/** The `### ` blocks under `## Engineering decisions`, each with its `ql:decide <id>` marker if any. */
export function decisionBlocks(plan: string): CallBlock[] {
  let inDecisions = false
  const blocks: CallBlock[] = []
  for (const { text: line } of proseLines(plan)) {
    if (/^## /.test(line)) inDecisions = line.trim() === "## Engineering decisions"
    if (!inDecisions) continue
    const head = line.match(/^### (.+)$/)
    if (head?.[1] !== undefined) {
      blocks.push({ title: head[1].trim(), text: [] })
      continue
    }
    const marker = line.match(/^\s*<!--\s*ql:decide\s+(\S+)\s*-->\s*$/)
    const last = blocks[blocks.length - 1]
    if (last !== undefined) {
      if (marker?.[1] !== undefined) last.id = marker[1]
      last.text.push(line)
    }
  }
  return blocks
}

/** The words of option `letter` (A or B) in a block's text. */
export function optionText(text: string, letter: "A" | "B"): string | undefined {
  return text.match(new RegExp(`^\\s*\\*\\*${letter}:\\*\\*\\s*(.+)$`, "m"))?.[1]?.trim()
}

/** Every Your call the Plan holds now, by its decision id. */
export function yourCallsOf(plan: string): Record<string, YourCallRecord> {
  const calls: Record<string, YourCallRecord> = {}
  for (const block of decisionBlocks(plan)) {
    const text = block.text.join("\n")
    if (block.id === undefined || !isYourCall(text)) continue
    const a = optionText(text, "A")
    const b = optionText(text, "B")
    calls[block.id] = {
      what: block.title,
      recommended: /^[^\S\r\n\u2028\u2029]*\*\*Recommended:\*\*\s*B\b/im.test(text) ? "B" : "A",
      ...(a !== undefined ? { A: a } : {}),
      ...(b !== undefined ? { B: b } : {}),
    }
  }
  return calls
}
