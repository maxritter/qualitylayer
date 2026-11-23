// The contracts a task card names under `**Design:**`: the H3 sections of the
// Plan's *Engineering decisions*, its agents' file's *Contracts* and Implement's *Program design*;
// for a bug also the H3 sections of the Plan's *What breaks* and *Why* (and those sections as a
// whole). One reader serves the slice rules, `next` and `qualitylayer card`.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { contractKey } from "./contract-key.ts"
import { parseMarkers } from "./markers.ts"
import { agentFileOf, folderDoc } from "./names.ts"
import { proseLines } from "./rules/types.ts"
import type { DocType } from "./schema.ts"

export type Contract = {
  name: string
  /** The document it is written in. */
  doc: string
  /** The H2 it sits under. */
  section: string
  /** The section verbatim, its heading line first. */
  text: string
  line: number
  /** Stable Plan decision marker, when this contract is an Engineering decision. */
  id?: string
}

export type ContractSource = {
  /** The documents the contracts live in, each with the H2 sections whose H3 headings are contracts. */
  places: { doc: string; sections: string[] }[]
  /** A bug's whole *What breaks* and *Why* may be named too. */
  wholeSections: boolean
}

/**
 * The contract documents: the decisions in the Plan, the contracts between components in its
 * agents' file and the program design in Implement's file, so a card names an H3 of any.
 */
export function contractSource(type: DocType): ContractSource {
  if (type === "chat") return { places: [], wholeSections: false }
  const places = [
    {
      doc: folderDoc("plan"),
      sections:
        type === "bugfix"
          ? ["What breaks", "Why", "Engineering decisions"]
          : ["Engineering decisions"],
    },
    { doc: agentFileOf("plan"), sections: ["Contracts"] },
    { doc: folderDoc("implement"), sections: ["Program design"] },
  ]
  return { places, wholeSections: type === "bugfix" }
}

export { contractKey }

type Heading = { level: 2 | 3; text: string; index: number }

function headings(lines: string[]): Heading[] {
  const out: Heading[] = []
  proseLines(lines.join("\n")).forEach(({ text: line, line: number }) => {
    const match = line.match(/^(##|###) (.+)/)
    if (match === null || line.slice(match[0].length).trim() !== "") return
    out.push({ level: match[1] === "##" ? 2 : 3, text: (match[2] ?? "").trim(), index: number - 1 })
  })
  return out
}

function sliceHeadingBody(lines: string[], all: Heading[], start: number, level: 2 | 3): string {
  const end = all.find((h) => h.index > start && h.level <= level)?.index ?? lines.length
  const body = lines.slice(start, end)
  while (body.length > 1 && (body[body.length - 1] ?? "").trim() === "") body.pop()
  return body.join("\n")
}

function decisionMarkerId(section: string, text: string): string | undefined {
  if (section !== "Engineering decisions") return undefined
  const decisions = parseMarkers(text).markers.filter((marker) => marker.name === "decide")
  return decisions.length === 1 ? decisions[0]?.args[0] : undefined
}

/** The H3 contracts (and, with `whole`, the H2 sections themselves) under the named H2 sections. */
export function parseContracts(
  markdown: string,
  doc: string,
  sections: string[],
  whole = false,
): { contracts: Contract[]; wholes: Contract[] } {
  const lines = markdown.split(/\r?\n/)
  const all = headings(lines)
  const contracts: Contract[] = []
  const wholes: Contract[] = []
  let current: string | null = null
  for (const h of all) {
    if (h.level === 2) {
      current = sections.includes(h.text) ? h.text : null
      if (current !== null && whole) {
        wholes.push({
          name: h.text,
          doc,
          section: h.text,
          text: sliceHeadingBody(lines, all, h.index, 2),
          line: h.index + 1,
        })
      }
      continue
    }
    if (current === null) continue
    const text = sliceHeadingBody(lines, all, h.index, 3)
    const id = decisionMarkerId(current, text)
    contracts.push({
      name: h.text,
      doc,
      section: current,
      text,
      line: h.index + 1,
      ...(id === undefined ? {} : { id }),
    })
  }
  return { contracts, wholes }
}

/** The task's contracts as the build reads them; null when none of the documents exists yet. */
export async function readContracts(
  ctx: Ctx,
  taskDir: string,
  type: DocType,
): Promise<{ contracts: Contract[]; wholes: Contract[] } | null> {
  const source = contractSource(type)
  const found: { contracts: Contract[]; wholes: Contract[] } = { contracts: [], wholes: [] }
  let any = false
  for (const { doc, sections } of source.places) {
    const path = join(taskDir, doc)
    if (!(await ctx.fs.exists(path))) continue
    any = true
    const read = parseContracts(await ctx.fs.readFile(path), doc, sections, source.wholeSections)
    found.contracts.push(...read.contracts)
    found.wholes.push(...read.wholes)
  }
  return any ? found : null
}

/** The contract a name on a task card refers to, if any. */
export function resolveContract(
  name: string,
  found: { contracts: Contract[]; wholes: Contract[] },
): Contract | undefined {
  const key = contractKey(name)
  const matches = [...found.contracts, ...found.wholes].filter(
    (c) =>
      contractKey(c.name) === key ||
      (c.id !== undefined && key === `plan:decision:${c.id.toLowerCase()}`),
  )
  return matches.length === 1 ? matches[0] : undefined
}
