// What the Plan page reads out of its document, apart from any drawing: the Summary's bullets and the
// Size line, the Diagrams and Interface as tab items, Done means as points with their steps (a bug's
// with Before and After), the Reviews line and the Decided with you rows (the text QualityLayer wrote
// between its markers). The order of the sections is the file's: the schema writes them in the
// order the page draws them, so nothing here sorts. Pure, so a test reads it as it is.

import { marked, type Token, type Tokens } from "marked"
import { referenceName } from "../../../core/artifact/reference.ts"
import { proofOfSection, stepsOfPoint } from "../../../core/docs/proof-list.ts"
import { proseLines } from "../../../core/docs/rules/types.ts"
import { verdictWords } from "../../../core/pages/sections/plan.ts"
import { isLineText } from "../../../core/text-boundaries.ts"
import type { TaskDetail } from "../../api.ts"
import type { Fact } from "../../step-page/bands/FactRow.tsx"
import {
  artifactName,
  disagreement,
  gapTail,
  isCallLine,
  reviewHead,
  reviewItem,
  verdictLength,
} from "./plan-scan.ts"

export type ByYouRow = { step: string; what: string; answer: string }

/** The lines of *Decided with you* (`- Plan · what — answer`); null when the section says there are none. */
export function byYouRows(fallback: string): ByYouRow[] | null {
  const rows: ByYouRow[] = []
  for (const raw of fallback.split(/\r?\n/)) {
    const row = raw.match(/^\s*-\s+([A-Z][a-z]+)\s·\s(.+?)\s[—–]\s(.*)$/)
    if (row) rows.push({ step: row[1] ?? "", what: row[2] ?? "", answer: row[3] ?? "" })
    else if (rows.length > 0 && !/^[-*+]\s/.test(raw) && !/^\s*-\s+[A-Z][a-z]+\s·/.test(raw)) {
      const previous = rows[rows.length - 1]
      if (previous) previous.answer += `\n${raw}`
    } else if (raw.trim()) return null
  }
  return rows.length > 0 ? rows.map((row) => ({ ...row, answer: row.answer.trim() })) : null
}

export type ReviewView = {
  /** "Second opinion · Codex, GPT-6.1 Sol", or "Plan review · Sonnet 5.5 (no second vendor installed)". */
  label: string
  /** What follows the label on the same line: the verdict and the tally, or what the reviewer is doing. */
  summary: string
  /** A review panel's reviewers by name ("Codex", "Grok", "Pi"); absent for one reviewer. */
  panel?: string[]
  findings: { what: string; answer: string; backing?: Backing }[]
}

/** Who backs a panel's finding: the backers, each objector with its reason, and what else the line says. */
export type Backing = {
  kind: "all" | "split" | "one"
  backers: string[]
  objections: { name: string; reason: string }[]
  /** The reviewer raised it in the second round, so nobody answered it. */
  secondRound?: true
  /** Reviewers whose second-round answer could not be read for this finding. */
  silent: string[]
}

/** A finding's `Panel:` words ("Grok, Pi · Codex disagrees: needs the time; Pi gave no readable answer") as parts. */
export function backingOf(kind: Backing["kind"], who: string): Backing {
  const late = who.match(/^(.+), second round$/)
  if (late?.[1] !== undefined)
    return { kind, backers: [late[1].trim()], objections: [], secondRound: true, silent: [] }
  // Only the closing "; <name> gave no readable answer" parts are gaps: a reason may hold a semicolon.
  const tail = gapTail(who)
  const main = tail === "" ? who : who.slice(0, -tail.length)
  const gaps = tail
    .split(/;\s*/)
    .map((gap) => gap.trim())
    .filter((gap) => gap !== "")
  const [names = "", ...against] = main.split(/\s·\s/)
  return {
    kind,
    backers: names
      .split(/,\s*/)
      .map((n) => n.trim())
      .filter((n) => n !== ""),
    objections: against.flatMap((part) => {
      const said = disagreement(part)
      return said !== null ? [{ name: said.name.trim(), reason: said.reason?.trim() ?? "" }] : []
    }),
    silent: gaps.flatMap((gap) => {
      const name = gap.match(/^(.+?) gave no readable answer$/)?.[1]
      return name !== undefined ? [name.trim()] : []
    }),
  }
}

/** A finding line's rest after its text: a panel's backing, then the planner's answer. */
const BACKED =
  /^Panel: (all|split|one) · (.*?) · ((?:Taken|Kept|Asked of you|answered|not answered yet)\b.*)$/

/** The text of *Reviews*, or null while no review stands in it. */
export function reviewOf(fallback: string): ReviewView | null {
  const lines = fallback.split(/\r?\n/).filter((l) => l.trim() !== "")
  // `**label** · summary`, or `**The Plan review could not run:** reason` (a review that did not run).
  const head = lines[0] === undefined ? null : reviewHead(lines[0])
  if (head === null) return null
  const [label, said] = head
  const findings = lines.slice(1).flatMap((l) => {
    const item = reviewItem(l)
    if (item === null) return []
    const [what, rest] = item
    const backed = rest.match(BACKED)
    return backed !== null
      ? [
          {
            what,
            answer: backed[3] ?? "",
            backing: backingOf(backed[1] as Backing["kind"], backed[2] ?? ""),
          },
        ]
      : [{ what, answer: rest }]
  })
  const panel = label.match(/^Review panel · (.+)$/)?.[1]
  // A Plan written before the verdict was put in words still says `REVISE: 2 items`: say it plainly.
  const trimmed = said.trim()
  const cut = verdictLength(trimmed)
  const verdict = trimmed.slice(0, cut)
  const summary = cut < 0 ? trimmed : `${verdictWords(verdict) ?? verdict}${trimmed.slice(cut)}`
  return {
    label,
    summary,
    ...(panel !== undefined ? { panel: panel.split(/,\s*/).map((n) => n.trim()) } : {}),
    findings,
  }
}

/**
 * The review in the header's meta line: "Codex reviewed it, 2 changes taken". Null while no review
 * stands, so the line says nothing rather than guess.
 */
export function reviewMeta(
  review: ReviewView | null,
  /** The Plan changed after the review settled: no reviewer read the last change. */
  before = false,
): string | null {
  if (review === null) return null
  // Only the fresh check of the Plan's designs stands (a small task has no Plan review): say what it found.
  if (/^design reviewed$/i.test(review.label.trim()))
    return `design reviewed, ${review.summary.replace(/\.\s*$/, "")}`
  const who = /·\s*([^,(]+)/.exec(review.label)?.[1]?.trim() ?? "the reviewer"
  if (/could not run/i.test(review.label)) return `${who} could not run the review`
  // A panel is counted, never named one by one: "3 reviewers read it". While it runs the header's
  // own words say the round.
  if (review.panel !== undefined && /\bround [12] of 2\b/.test(review.summary)) return null
  const did =
    review.panel !== undefined ? `${review.panel.length} reviewers read it` : `${who} reviewed it`
  if (before) return `${did} before the last change`
  const taken = Number(/(?<!\d)(\d+)\s+taken/i.exec(review.summary)?.[1] ?? Number.NaN)
  if (!Number.isNaN(taken) && taken > 0)
    return `${did}, ${taken} ${taken === 1 ? "change" : "changes"} taken`
  if (/(?:^approved)|(?:nothing to change)|(?:\b0 findings)/i.test(review.summary))
    return `${did}, no changes`
  return did
}

/** "9 findings": the verdict's own count when it gives one, else the findings the section lists. */
export function reviewCount(review: ReviewView | null): string | undefined {
  const n = reviewTotal(review)
  return n !== undefined ? `${n} ${n === 1 ? "finding" : "findings"}` : undefined
}

/** How many findings the review gave: the verdict's own count when it states one, else the rows. */
export function reviewTotal(review: ReviewView | null): number | undefined {
  if (review === null) return undefined
  const stated = /asked for (\d+)\s+change/i.exec(review.summary)?.[1]
  const n = stated !== undefined ? Number(stated) : review.findings.length
  return n > 0 ? n : undefined
}

/** The slug the Reader scrolls to for a heading. */
export const slugOf = (heading: string): string =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

/** The lines that only describe a Your call (`late: true`, its options and recommendation): the call itself draws them. */
export function withoutCallLines(markdown: string): string {
  const prose = new Set(proseLines(markdown).map((l) => l.line))
  return markdown
    .split("\n")
    .filter((line, index) => {
      if (!prose.has(index + 1)) return true
      return !isCallLine(line)
    })
    .join("\n")
}

// ---------------------------------------------------------------- the header: size, summary, meta

/** A line that opens a label paragraph (`**Size:** …`) or something that is not a wrapped sentence. */
const LABEL_LINE = /^\*\*[^*\n]+:\*\*/
const NOT_PROSE = /^(?:#|```|<!--|[-*+]\s|\d+[.)]\s|\|)/

/**
 * The text after a `**Label:**` at the start of a line. A planner wraps its lines, so the value runs
 * on over the following lines until a blank line, the next label or a list, table or fence.
 */
export function labelValue(markdown: string, label: string): string | null {
  const lines = markdown.split(/\r?\n/)
  const opener = new RegExp(`^\\*\\*${label}:\\*\\*\\s*`, "i")
  const at = lines.findIndex((line) => opener.test(line) && line.replace(opener, "").trim() !== "")
  if (at < 0) return null
  const parts = [(lines[at] ?? "").replace(opener, "").trim()]
  for (const line of lines.slice(at + 1)) {
    const text = line.trim()
    if (text === "" || LABEL_LINE.test(text) || NOT_PROSE.test(text)) break
    parts.push(text)
  }
  return parts.join(" ")
}

export type PlanIndicator = {
  kind: "Risk" | "Complexity"
  value: string
  evidence: string
  section: "Done means" | "Approach"
}

function riskParts(line: string | null): { value: string; evidence: string } | null {
  if (line === null || !isLineText(line)) return null
  for (let at = line.indexOf("—"); at >= 0; at = line.indexOf("—", at + 1)) {
    if (!/\s/.test(line.charAt(at - 1)) || !/\s/.test(line.charAt(at + 1))) continue
    const value = line.slice(0, at).trimEnd()
    const evidence = line.slice(at + 1).trimStart()
    if (value && evidence) return { value, evidence }
  }
  return null
}

export function planIndicators(
  summary: string,
  acceptance: string,
  approach: string,
): PlanIndicator[] {
  const indicators: PlanIndicator[] = []
  const exposure = riskParts(labelValue(summary, "Risk"))
  if (exposure && acceptance.trim()) {
    indicators.push({
      kind: "Risk",
      ...exposure,
      section: "Done means",
    })
  }
  const named =
    labelValue(summary, "Integrations")
      ?.split(",")
      .map((name) => name.trim())
      .filter(Boolean) ?? []
  const systems = new Map<string, string>()
  for (const name of named) {
    const key = name.toLowerCase()
    if (!systems.has(key)) systems.set(key, name)
  }
  const approachText = approach.toLowerCase()
  if (
    systems.size &&
    [...systems.keys()].every((name) => name !== "none" && approachText.includes(name))
  ) {
    indicators.push({
      kind: "Complexity",
      value: `${systems.size} integration${systems.size === 1 ? "" : "s"}`,
      evidence: [...systems.values()].join(" · "),
      section: "Approach",
    })
  }
  return indicators
}

export type PlanSize = { slices: number; tasks: number | null; about: boolean }

const countBefore = (text: string, word: RegExp): number | null => {
  const found = word.exec(text)?.[1]
  return found === undefined ? null : Number(found)
}

/** From `**Size:** about 11 slices and 28 tasks`; null when the Plan states no slices. */
export function sizeOf(markdown: string): PlanSize | null {
  const size = labelValue(markdown, "Size") ?? ""
  const slices = countBefore(size, /(?<!\d)(\d+)\s+slices?/i)
  if (slices === null) return null
  return {
    slices,
    tasks: countBefore(size, /(?<!\d)(\d+)\s+tasks?/i),
    about: /\babout\b/i.test(size),
  }
}

/** The one size chip: "≈7 slices · ≈39 tasks", the sentence it abbreviates its tooltip. */
export function sizeFact(size: PlanSize | null): Fact | null {
  if (size === null) return null
  const mark = size.about ? "≈" : ""
  const slices = `${size.slices} ${size.slices === 1 ? "slice" : "slices"}`
  const tasks = size.tasks === null ? null : `${size.tasks} ${size.tasks === 1 ? "task" : "tasks"}`
  return {
    value: `${mark}${size.slices}`,
    label: size.slices === 1 ? "slice" : "slices",
    icon: "slices",
    ...(tasks !== null ? { sub: `${mark}${tasks}` } : {}),
    tip: `${size.about ? "About " : ""}${slices}${tasks !== null ? ` and ${tasks}` : ""}`,
  }
}

/** The Summary's bullets: the agent's own list, else its sentences; the label lines are not bullets. */
export function summaryBullets(markdown: string): string[] {
  const items: string[] = []
  const prose: string[] = []
  let inItem = false
  let afterBlank = false
  for (const line of markdown
    .replace(/^## .*\n?/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/\r?\n/)) {
    const text = line.trim()
    if (text === "") {
      afterBlank = true
      continue
    }
    const start = /^(?:[-*+]|\d+[.)])\s+/.exec(text)
    if (start !== null) {
      items.push(text.slice(start[0].length))
      inItem = true
    } else if (inItem && (!afterBlank || /^\s+/.test(line)) && !LABEL_LINE.test(text)) {
      // A bullet wrapped over several lines stays one bullet.
      items[items.length - 1] = `${items[items.length - 1]} ${text}`
    } else {
      inItem = false
      if (!LABEL_LINE.test(text)) prose.push(text)
    }
    afterBlank = false
  }
  if (items.length > 0) return items
  return prose
    .join(" ")
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence !== "")
    .slice(0, 5)
}

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })

/** The meta line of the Plan: the document's state, when, and what it needs from the person. */
export function planMeta(input: {
  phase: "open" | "writing" | "decided"
  locked: string | null
  /** The lock is a late answer the planner folds in: when the person sent it. */
  folding?: number | undefined
  reviewState?: TaskDetail["helpers"][number]["state"]
  callsLeft: number
  decision?: string | undefined
  at?: number | undefined
  /** The task's agent runs in the terminal: it asks and takes approval there. */
  outside?: boolean | undefined
  /** Approved by a review on the Plan's pull request: who, and where. */
  approvedBy?: { login: string; via: "github" } | undefined
}): string {
  const { phase, locked, callsLeft, decision, at, outside = false, approvedBy } = input
  if (phase === "writing") return "draft · Approve unlocks when it is complete"
  if (phase === "decided")
    return decision === "changes"
      ? `changes sent${at !== undefined ? ` ${clock(at)}` : ""} · the planner folds them in`
      : `approved${approvedBy ? ` by @${approvedBy.login} on GitHub` : ""}${at !== undefined ? ` ${clock(at)}` : ""}`
  if (locked !== null) {
    // A panel's lock line says its round ("round 2 of 2"); one reviewer has none.
    const round = /\bround ([12]) of 2\b/.exec(locked)?.[1]
    if (input.reviewState === "running")
      return round !== undefined ? `reviewing Plan · round ${round} of 2` : "reviewing Plan"
    if (input.reviewState === "done") return "updating Plan"
    if (input.reviewState === "failed" || input.reviewState === "timed_out") return "review paused"
    if (input.folding !== undefined)
      return `answer sent ${clock(input.folding)} · the planner folds it in`
    return "not ready to approve"
  }
  if (callsLeft > 0)
    return outside
      ? `ready to approve after your call${callsLeft === 1 ? "" : "s"} · answer ${callsLeft === 1 ? "it" : "them"} in your own agent`
      : `ready to approve after your call${callsLeft === 1 ? "" : "s"}`
  return "ready to approve"
}

// ---------------------------------------------------------------- Diagrams and Interface as tab items

const body = (markdown: string): Token[] =>
  marked.lexer(markdown.replace(/^## .*\n?/, "")).filter((token) => token.type !== "space")

function isReproductionOutput(token: Token): boolean {
  if (token.type !== "code") return false
  const { lang = "", text } = token as Tokens.Code
  if (/^(?:console|terminal|shell-session)$/i.test(lang)) return true
  return /^(?:text|plaintext)?$/i.test(lang) && /^\s*\$\s+\S[^\n]*\n\s*\S/.test(text)
}

function endsReproduction(token: Token, depth: number): boolean {
  if (token.type === "heading") return (token as Tokens.Heading).depth <= depth
  return token.type === "code" && (token as Tokens.Code).lang === "mermaid"
}

/** Keep the diagnosis visible and tuck away a named reproduction or its terminal transcript. */
export function reproductionOf(
  markdown: string,
): { diagnosis: string; reproduction: string } | null {
  const tokens = marked.lexer(markdown)
  const heading = tokens.findIndex(
    (token) => token.type === "heading" && /^reproduction:?$/i.test((token as Tokens.Heading).text),
  )
  const start = heading < 0 ? tokens.findIndex(isReproductionOutput) : heading
  if (start < 0) return null
  const depth = heading < 0 ? 0 : (tokens[heading] as Tokens.Heading).depth
  const next = tokens.findIndex((token, index) => index > start && endsReproduction(token, depth))
  const end = heading < 0 ? start + 1 : next < 0 ? tokens.length : next
  const join = (part: readonly Token[]) =>
    part
      .map((token) => token.raw)
      .join("")
      .trim()
  const reproduction = join(tokens.slice(heading < 0 ? start : start + 1, end))
  if (reproduction === "") return null
  return { diagnosis: join([...tokens.slice(0, start), ...tokens.slice(end)]), reproduction }
}

const plainText = (text: string): string =>
  text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim()

export type DiagramKind = "before-after" | "flow" | "sequence" | "state"

export type DiagramItem = {
  id: string
  /** The choice's heading or a title derived from its caption. */
  title: string
  kind: DiagramKind
  /** The Mermaid source. */
  code: string
  /** The one caption line under it; empty when none was written. */
  caption: string
}

const diagramKind = (code: string, title: string): DiagramKind => {
  const first = code.trim().split(/\s+/)[0] ?? ""
  if (first.startsWith("sequenceDiagram")) return "sequence"
  if (first.startsWith("stateDiagram")) return "state"
  return /before\b.*\bafter|today/i.test(title) ? "before-after" : "flow"
}

const KIND_WORDS: Record<DiagramKind, string> = {
  "before-after": "Before and after",
  flow: "Flow",
  sequence: "Sequence",
  state: "States",
}

const GENERIC_DIAGRAM_TITLE = /^(?:diagram|flow(?:chart)?|sequence(?: diagram)?|states?)(?: \d+)?$/i

/** Read the label of a caption's simple inline link; leave other bracketed text as written. */
function captionLinkLabels(caption: string): string {
  const pieces: string[] = []
  let from = 0
  let open = -1
  let cursor = 0
  while (cursor < caption.length) {
    const at = cursor++
    if (caption[at] === "[" && open < 0) open = at
    if (caption[at] !== "]" || open < 0) continue
    const label = open
    open = -1
    if (at === label + 1 || caption[at + 1] !== "(") continue
    const end = caption.indexOf(")", at + 2)
    if (end < 0) break
    if (end === at + 2) continue
    pieces.push(caption.slice(from, label), caption.slice(label + 1, at))
    from = end + 1
    cursor = from
  }
  pieces.push(caption.slice(from))
  return pieces.join("")
}

/** Use a complete short caption as a title, or finish at a word when it has more detail. */
function titleFromCaption(caption: string): string {
  const words = captionLinkLabels(caption)
  const sentence = words.search(/[.!?] /)
  const title = sentence < 0 ? words : words.slice(0, sentence + 1)
  if (title.length <= 72) return title.replace(/[.!?]$/, "")
  const edge = title.slice(0, 73)
  const end = edge.lastIndexOf(" ")
  const short = (end < 0 ? edge : edge.slice(0, end)).trimEnd()
  return `${short}…`
}

/** Every choice has a distinct accessible name, even for identical legacy headings and captions. */
function distinctTitle(title: string, used: Set<string>): string {
  let chosen = title
  let occurrence = 1
  while (used.has(chosen.toLowerCase())) chosen = `${title} (${++occurrence})`
  used.add(chosen.toLowerCase())
  return chosen
}

/** The tab items made of a section's `###` titles, fences, `ql:artifact` markers and caption lines. */
function itemsOf(markdown: string) {
  type Raw = {
    title: string | null
    fence?: Tokens.Code
    artifact?: string
    /** The name the still's `**Artifact: <name>.**` line gives, its last part ("Plan reviewers"). */
    named?: string
    caption: string
  }
  const items: Raw[] = []
  let title: string | null = null
  let last: Raw | null = null
  for (const token of body(markdown)) {
    if (token.type === "heading") {
      title = plainText((token as Tokens.Heading).text)
      last = null
    } else if (token.type === "code") {
      last = { title, fence: token as Tokens.Code, caption: "" }
      items.push(last)
      title = null
    } else if (token.type === "html") {
      const marker = /<!--\s*ql:artifact\s+(\S+)\s*-->/.exec(token.raw)
      if (marker?.[1] !== undefined) {
        last = { title, artifact: marker[1], caption: "" }
        items.push(last)
        title = null
      }
    } else if (token.type === "paragraph" && last !== null) {
      // A caption is the line under its item, never a label line, the still's picture or its
      // `**Artifact: <name>.**` line (that one names the tab).
      const raw = (token as Tokens.Paragraph).raw.trim()
      const named = artifactName(raw)
      if (named !== undefined) {
        if (last.artifact !== undefined && last.named === undefined)
          last.named = named.split(" · ").pop()?.trim()
        continue
      }
      if (/^!\[[^\]]*\]\([^)]*\)$/.test(raw) || last.caption !== "") continue
      const text = plainText(token.text)
      if (!LABEL_LINE.test(raw) && !/^\*\*Lens/i.test(text)) last.caption = text
    }
  }
  return items
}

/** The Diagrams section's pictures, in the order written: one tab each. */
export function diagramsOf(markdown: string): DiagramItem[] {
  const out: DiagramItem[] = []
  const used = new Set<string>()
  const counts = new Map<DiagramKind, number>()
  for (const item of itemsOf(markdown)) {
    if (item.fence?.lang !== "mermaid") continue
    const code = item.fence.text
    const kind = diagramKind(code, item.title ?? "")
    const ordinal = (counts.get(kind) ?? 0) + 1
    counts.set(kind, ordinal)
    const heading = item.title?.trim() ?? ""
    const captionTitle = titleFromCaption(item.caption)
    const written = heading && !GENERIC_DIAGRAM_TITLE.test(heading) ? heading : ""
    const title = written && !used.has(written.toLowerCase()) ? written : captionTitle || written
    out.push({
      id: `d${out.length + 1}`,
      title: distinctTitle(title || `${KIND_WORDS[kind]} ${ordinal}`, used),
      kind,
      code,
      caption: item.caption,
    })
  }
  return out
}

export type InterfaceItem = {
  id: string
  /**
   * The tab: the `###` above it, else the name its still's `**Artifact:**` line gives, else the
   * artifact's title, else the output's kind in words. Never the reference's path.
   */
  title: string
  /** The artifact's reference as `ql:artifact` names it; null for a code block. */
  artifact: string | null
  /** A picker, a diff or any output the design shows: the block as written. */
  code: string | null
  lang: string
  caption: string
}

/** The Interface section's screens and outputs, in the order written: one tab each. */
export function interfaceOf(markdown: string, titleOf: (reference: string) => string | undefined) {
  const out: InterfaceItem[] = []
  for (const item of itemsOf(markdown)) {
    if (item.fence?.lang === "mermaid") continue
    const lang = item.fence?.lang ?? ""
    out.push({
      id: `i${out.length + 1}`,
      title:
        (item.title?.trim() || undefined) ??
        item.named ??
        (item.artifact !== undefined
          ? (titleOf(item.artifact) ?? referenceName(item.artifact))
          : lang === "diff"
            ? "Change"
            : "Output"),
      artifact: item.artifact ?? null,
      code: item.fence?.text ?? null,
      lang,
      caption: item.caption,
    })
  }
  return out
}

// ---------------------------------------------------------------- Done means

export type AcceptanceTab = {
  /** `A1`: the step's identity in every later verdict and picture. */
  id: string
  n: number
  label: string
  /** What passes, without the step's action. */
  text: string
  /** What the step does, as written (code spans kept). */
  action: string
  /** What shows the bug before the fix: a bug's *Before the fix* column. "" for any other step. */
  before: string
  /** The Interface item the step shows (it names the artifact or the tab), when it names one. */
  screen: InterfaceItem | null
}

/** The step names its screen by the artifact's reference or the tab's title (`billing-mode`, "Settings"). */
function screenOf(text: string, items: readonly InterfaceItem[]): InterfaceItem | null {
  const hay = text.toLowerCase()
  return (
    items.find((item) => {
      const names = [item.artifact, item.title]
        .filter((name): name is string => name !== null && name.length >= 4)
        .map((name) => name.toLowerCase())
      return names.some((name) => hay.includes(name) || hay.includes(name.replace(/-/g, " ")))
    }) ?? null
  )
}

/** A step under a Done means point; `shared` when it also proves another point, so it shows under each. */
export type AcceptancePointStep = AcceptanceTab & { shared: boolean }

export type AcceptancePointView = {
  /** The Plan's number for the Done means point. */
  n: number
  text: string
  /** How it shows: the sentence under the point's heading. */
  how: string
  /** Its own steps and the ones it names with `also`, in the order written. */
  tabs: AcceptancePointStep[]
}

export type AcceptanceView = {
  /** Every step once, in the order written. */
  tabs: AcceptanceTab[]
  /** The Done means points with their steps. */
  points: AcceptancePointView[]
  /** How the test runs, in the Plan's words. */
  runs: string | null
}

/**
 * The Plan's Done means for the page: the core proof list (docs/proof-list.ts, the one reader) with
 * the screen the design shows for each step.
 */
export function acceptanceOf(section: string, items: readonly InterfaceItem[]): AcceptanceView {
  const list = proofOfSection(section)
  const tabOf = (step: (typeof list.steps)[number]): AcceptanceTab => ({
    id: step.id,
    n: step.n,
    label: plainText(step.action),
    text: step.expected,
    action: step.action,
    before: step.before,
    screen: screenOf(`${step.action} ${step.expected}`, items),
  })
  return {
    tabs: list.steps.map(tabOf),
    points: list.points.map((point) => ({
      n: point.n,
      text: point.text,
      how: point.how,
      tabs: stepsOfPoint(list, point.n).map((step) => ({
        ...tabOf(step),
        shared: step.points.length > 1,
      })),
    })),
    runs: list.runsAs,
  }
}

// ---------------------------------------------------------------- the Technical part

const codeCell = (cell: string): string => cell.replace(/`/g, "").trim()

/** A Data row's first cell without its trailing "new" or "(new)" mark, and whether it had one. */
function newMark(cell: string): { fresh: boolean; rest: string } {
  const text = cell.trimEnd()
  const lower = text.toLowerCase()
  for (const mark of ["(new)", "new"]) {
    const before = text.length - mark.length
    if (before > 0 && lower.endsWith(mark) && /\s/.test(text[before - 1] ?? ""))
      return { fresh: true, rest: text.slice(0, before).trimEnd() }
  }
  return { fresh: false, rest: text }
}

export type ReasonRow = { a: string; b: string; note: string | null }

/**
 * A list of `<text> — <why>` bullets as rows; `(unconfirmed)` / `(confirmed)` at the end becomes the
 * row's note. Null when the section is not a plain list.
 */
export function reasonRowsOf(markdown: string): ReasonRow[] | null {
  const tokens = body(markdown)
  if (tokens.length !== 1 || tokens[0]?.type !== "list") return null
  const list = tokens[0] as Tokens.List
  return list.items.map((item) => {
    const note = /\((unconfirmed|confirmed)\)\s*\.?$/i.exec(item.text)?.[1]?.toLowerCase() ?? null
    const text = item.text.replace(/\((?:unconfirmed|confirmed)\)\s*\.?$/i, "").trim()
    const pair =
      text.match(/^(.+?)\s[—–]\s([\s\S]+)$/) ?? text.match(/^\*\*(.+?)\.?\*\*\s+([\s\S]+)$/)
    return { a: pair?.[1] ?? text, b: pair?.[2] ?? "", note }
  })
}

/** The decision ids a block of Markdown names with `ql:decide` markers, in order. */
export const decideIdsOf = (markdown: string): string[] =>
  [...markdown.matchAll(/<!--\s*ql:decide\s+(\S+)\s*-->/g)].map((found) => found[1] ?? "")

/**
 * A passage's Markdown cut into its words and its pictures: each Mermaid diagram goes with the Lens
 * line that names it, so the page can draw it open beside the words.
 */
export function pulledViews(markdown: string): { views: string[]; rest: string } {
  const tokens = marked.lexer(markdown)
  const groups = new Map<number, number[]>()
  tokens.forEach((token, index) => {
    if (token.type !== "code" || (token as Tokens.Code).lang !== "mermaid") return
    let from = index
    for (let back = index - 1; back >= 0; back--) {
      const before = tokens[back]
      if (before?.type === "space") continue
      if (before?.type === "paragraph" && /^\*\*(?:Lens|Kind):\*\*/i.test(before.raw.trim()))
        from = back
      break
    }
    groups.set(
      index,
      Array.from({ length: index - from + 1 }, (_, step) => from + step),
    )
  })
  const taken = new Set([...groups.values()].flat())
  return {
    views: [...groups.values()].map((group) => group.map((at) => tokens[at]?.raw ?? "").join("")),
    rest: tokens
      .filter((_, index) => !taken.has(index))
      .map((t) => t.raw)
      .join(""),
  }
}

// ---------------------------------------------------------------- Done means: how the test runs

/** How the test runs, as the short mark in its heading: a scripted run unless the line says a real agent session. */
export function runKindOf(runs: string | null): "scripted run" | "real agent session" | null {
  if (runs === null || runs.trim() === "") return null
  return /\b(?:real|live) (?:agent )?(?:session|agent)\b/i.test(runs)
    ? "real agent session"
    : "scripted run"
}

type RunKind = "scripted run" | "real agent session"
const KIND_OF = { scripted: "scripted run", "real-session": "real agent session" } as const

/**
 * How the acceptance test ran, as Verify's heading says it: the way most steps ran, and the steps
 * that ran the other way ("A3"), so one mixed run is never named by one mode. A step with no mode
 * of its own ran as the run did.
 */
export function runKindsOf(acceptance: {
  mode: "scripted" | "real-session" | null
  steps: readonly { id: string; mode?: "scripted" | "real-session" }[]
}): { kind: RunKind; other?: { kind: RunKind; steps: string[] } } | null {
  const modes = acceptance.steps.map((step) => ({
    id: step.id,
    mode: step.mode ?? acceptance.mode,
  }))
  const known = modes.filter((m) => m.mode !== null)
  if (known.length === 0)
    return acceptance.mode === null ? null : { kind: KIND_OF[acceptance.mode] }
  const real = known.filter((m) => m.mode === "real-session")
  const scripted = known.filter((m) => m.mode === "scripted")
  if (real.length === 0 || scripted.length === 0)
    return { kind: real.length > 0 ? "real agent session" : "scripted run" }
  // The main way is the run's own, else the way most steps ran.
  const main = acceptance.mode ?? (real.length > scripted.length ? "real-session" : "scripted")
  const others = main === "scripted" ? real : scripted
  return {
    kind: KIND_OF[main],
    other: {
      kind: KIND_OF[main === "scripted" ? "real-session" : "scripted"],
      steps: others.map((m) => m.id),
    },
  }
}

// ---------------------------------------------------------------- Data and interfaces, one row per item

export type DataRow = { name: string; where: string; fresh: boolean; sentence: string }

/**
 * The Data and interfaces table as one row per item: its name, where it lives, and one sentence made
 * of the other columns (`Values: app · terminal. Default: app`). Null when the section is no table.
 */
export function dataRowsOf(markdown: string): DataRow[] | null {
  const table = body(markdown).find((token) => token.type === "table") as Tokens.Table | undefined
  if (table === undefined || table.rows.length === 0 || table.header.length < 2) return null
  const names = table.header.map((cell) => plainText(cell.text))
  const whereAt = names.findIndex(
    (name, at) => at > 0 && /^(?:where|location|in|path)$/i.test(name),
  )
  return table.rows.map((row) => {
    const cells = row.map((cell) => cell.text.trim())
    const first = cells[0] ?? ""
    const { fresh, rest } = newMark(first)
    const name = codeCell(rest).trim()
    const sentence = cells
      .map((cell, at) => ({ cell, at }))
      .filter(({ cell, at }) => at > 0 && at !== whereAt && cell !== "")
      .map(({ cell, at }) => `${names[at] ?? ""}: ${cell}`)
      .join(". ")
    return { name, where: whereAt >= 0 ? (cells[whereAt] ?? "") : "", fresh, sentence }
  })
}
