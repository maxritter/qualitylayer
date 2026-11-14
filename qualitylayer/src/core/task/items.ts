// What needs a person, per step, computed from the task's documents and state: the one shape
// (core/items.ts) every surface draws, so the App never parses Markdown for it. Each step has its
// sources here (the Plan, the final review); state comes from the answers stored as comments, the
// gate, and decided.json, which says what each earlier decision covered.
//
//   open     no answer yet
//   chosen   an answer saved as a draft: it goes with the next decision
//   sent     the agent has it (a decision delivered it); its reply shows when there is one
//   settled  its gate was decided and it was answered or approved with it, and it has not changed
//
// An item the agent changed since a decision covered it opens again with `changedSinceReview`;
// one that changes under an unsent answer is `updated` and the answer stays.

import { createHash } from "node:crypto"
import { basename, join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { filesIn } from "../../files.ts"
import { recommendedIndices } from "../../interaction/question-recommendations.ts"
import { proofOf } from "../acceptance.ts"
import { numberedItems } from "../briefs.ts"
import { userPoints } from "../checklist.ts"
import type { CrossReviewPoint } from "../config-values.ts"
import { withoutAdded } from "../docs/added.ts"
import { type BuildLog, readBuildRecord, sectionText } from "../docs/build-log.ts"
import { parseFence } from "../docs/fragments.ts"
import { parseDoc } from "../docs/frontmatter.ts"
import { parseMarkers } from "../docs/markers.ts"
import { diagramKind } from "../docs/mermaid-style.ts"
import { agentFileOf, folderDoc, isAgentFile, RESEARCH_QUESTIONS } from "../docs/names.ts"
import { parsePrerequisites } from "../docs/outline.ts"
import { isYourCall } from "../docs/rules/doc-rules.ts"
import { proseLines, sectionRanges } from "../docs/rules/types.ts"
import { artifactPath, extractFences } from "../docs/visuals.ts"
import { doneMeans, doneMeansOf } from "../done-means.ts"
import { withoutExemptNotes } from "../exempt-notes.ts"
import { type Comment, readComments } from "../gate/comments.ts"
import { readDecided } from "../gate/decided.ts"
import type { GateFile } from "../gate/gate.ts"
import { commitBlockedSlices, committedSlices } from "../git/build-start.ts"
import {
  type AnswerKind,
  defaultAnswers,
  FAMILY_OF,
  type Item,
  type ItemMedia,
  KIND_LABEL,
  orderItems,
  resolveItem,
  type StepChecks,
  type StepParts,
} from "../items.ts"
import { readRun, reviewFile } from "../review/cross.ts"
import { backingLine } from "../review/line-readers.ts"
import { crossesBoundary } from "../scaling.ts"
import { findingAnswers } from "../small-findings.ts"
import { taskFlow } from "../task-flow.ts"
import { isStructured, readTeamComments } from "../team/comments.ts"
import { commentAuthor } from "../team/people.ts"
import { readAssignment } from "../verification.ts"
import { readHandback } from "./handback.ts"
import { applyPointAgreements, pointAgreements } from "./point-confirmations.ts"
import { answeredQuestions, openQuestion, type Question, questionsAhead } from "./question.ts"
import {
  changedAfter,
  changedWords,
  commitsSince,
  headline,
  type LaterCommit,
} from "./review-notes.ts"
import { readEvents, readSession, type Task, taskDocPath } from "./store.ts"
import { readVerifyMode } from "./verify-mode.ts"

const FINAL = "final"
const IMAGE = /\.(png|jpe?g|webp|gif)$/i
const MAX_PICTURES = 6

const hash = (value: unknown, length = 12) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, length)

/** A template's guidance comments are notes to the agent, not content: a section holding only one is empty. */
const withoutComments = (text: string) => text.replace(/<!--[\s\S]*?-->/g, "")

const plain = (text: string) =>
  text
    .replace(/\*\*|__/g, "")
    .replace(/\s+/g, " ")
    .trim()

const clip = (text: string, length: number) =>
  text.length <= length ? text : `${text.slice(0, length - 1).trimEnd()}…`

const humanize = (name: string) => {
  const words = name
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .trim()
  return words === "" ? name : words.charAt(0).toUpperCase() + words.slice(1)
}

type Make = Partial<Item> & Pick<Item, "id" | "step" | "kind" | "what">

function make(input: Make): Item {
  const family = input.family ?? FAMILY_OF[input.kind]
  const answers = input.answers ?? defaultAnswers(input.kind)
  return {
    family,
    kindLabel: KIND_LABEL[input.kind],
    blocking: false,
    state: "open",
    ...input,
    answers,
  }
}

/** Bullet lines of a section, each with its continuation lines. */
function bullets(section: string): string[] {
  const out: string[] = []
  for (const raw of section.split(/\r?\n/)) {
    if (/^\s*[-*]\s+/.test(raw)) out.push(raw.replace(/^\s*[-*]\s+/, "").trim())
    else if (raw.trim() !== "" && /^\s+\S/.test(raw) && out.length > 0)
      out[out.length - 1] = `${out[out.length - 1]} ${raw.trim()}`
  }
  return out
}

/** The first sentence of a paragraph, kept short. */
const firstSentence = (text: string) => clip(plain(text).split(/(?<=[.!?])\s/)[0] ?? "", 220)

/** The nearest heading above a line: what a picture is about. */
function headingAbove(lines: string[], line: number): string | null {
  for (let index = line - 2; index >= 0; index--) {
    const match = (lines[index] ?? "").match(/^#{2,4}\s+(.+)$/)
    if (match?.[1] !== undefined) return plain(match[1])
  }
  return null
}

async function readText(ctx: Ctx, path: string): Promise<string> {
  return (await ctx.fs.exists(path)) ? await ctx.fs.readFile(path) : ""
}

/** The Plan's items, from the Plan and the flow: the order of the Plan page. */
async function planItems(ctx: Ctx, task: Task): Promise<Item[]> {
  const planText = await readText(ctx, taskDocPath(task, "plan"))
  if (planText.trim() === "") return []
  const body = withoutComments(withoutAdded(parseDoc(planText).body))
  const madeText = body
  const lines = body.split(/\r?\n/)
  const ranges = sectionRanges(body)
  const range = (heading: string) => ranges.find((r) => r.heading === heading)
  const items: Item[] = []

  // The mockups: each artifact fence in the Interface section.
  const interfaceRange = range("Interface")
  for (const fence of extractFences(body)) {
    if (interfaceRange === undefined) continue
    if (fence.line < interfaceRange.start || fence.line >= interfaceRange.end) continue
    if (fence.kind === "wireframe" || fence.kind === "panel") {
      const parsed = parseFence(fence.kind, fence.body)
      if (parsed.fragment === "" || parsed.header.name === undefined) continue
      items.push(
        make({
          id: `plan:fence:${parsed.header.name}`,
          step: "plan",
          kind: "mockup",
          what: parsed.header.title ?? humanize(parsed.header.name),
          media: { kind: fence.kind, name: parsed.header.name, source: fence.body },
        }),
      )
      continue
    }
    if (fence.kind !== "artifact") continue
    const found = artifactPath(fence)
    if (!("path" in found)) continue
    // An artifact keeps its folder in the name (`artifacts/<name>.html`); an older mockup is named alone.
    const name = found.path.replace(/^artifacts\//, "")
    const heading = headingAbove(lines, fence.line)
    items.push(
      make({
        id: `plan:mockup:${items.length + 1}`,
        step: "plan",
        kind: "mockup",
        what: heading !== null && heading !== "Interface" ? heading : humanize(basename(name)),
        media: { kind: "artifact", name },
      }),
    )
  }

  // The engineering decisions: one per `### ` of the section the template marks them in.
  items.push(...decisionItems(body, decideIds(planText)))

  // Done means: the points the finished change must pass.
  const done = doneMeans(sectionText(body, "Done means"))
  if (done.length > 0) {
    items.push(
      make({
        id: "plan:done:1",
        step: "plan",
        kind: "done",
        uncounted: true,
        blocking: false,
        kindLabel: `${KIND_LABEL.done} · ${done.length}`,
        what:
          task.type === "bugfix"
            ? "The checks the fix must pass"
            : "The checks the finished change must pass",
        count: done.length,
        // The points open in place; each takes a comment.
        answers: { options: [], link: "change" },
        children: done.map((point, index) =>
          make({
            id: `plan:done:1:${index + 1}`,
            step: "plan",
            kind: "done",
            uncounted: true,
            blocking: false,
            what: point.outcome,
            ...(point.how !== "" ? { why: point.how } : {}),
            answers: { options: [] },
          }),
        ),
      }),
    )
  }

  // What the agent decided for you: one line each, with its reason.
  const decided = bullets(sectionText(madeText, "Decisions made for you"))
  if (decided.length > 0) {
    items.push(
      make({
        id: "plan:decided:1",
        step: "plan",
        kind: "decided",
        kindLabel: `${KIND_LABEL.decided} · ${decided.length}`,
        what: "Change any you disagree with",
        count: decided.length,
        children: decided.map((line, index) => {
          const [what, why] = splitReason(plain(line))
          return make({
            id: `plan:decided:1:${index + 1}`,
            step: "plan",
            kind: "decided",
            what,
            ...(why !== undefined ? { why } : {}),
            answers: { options: [], link: "change" },
          })
        }),
      }),
    )
  }

  // Extra review: the trust boundary line and what the flow checks on its own.
  const flowed = await taskFlow(ctx, task)
  const boundary = flowed.signals.trustBoundary
  const checks: string[] = []
  if (flowed.flow.changeSecondOpinion) checks.push("A second agent reads the Plan and the change.")
  items.push(
    make({
      id: "plan:extra-review:1",
      step: "plan",
      kind: "extra-review",
      what: crossesBoundary(boundary)
        ? `A security review runs before your review: ${plain(boundary ?? "")} crosses a trust boundary`
        : "None planned: no login, secret or outside input changes",
      ...(checks.length > 0 ? { why: checks.join(" ") } : {}),
    }),
  )

  // The Plan's proposals are documentary. A heading or artifact does not ask the person a
  // question: only the planner's explicit question transport creates a human choice.
  // A Your call is the exception: the person settles it, and Approve waits for the answer.
  const documentary = (rows: Item[]): Item[] =>
    rows.map((item) =>
      item.call !== undefined
        ? item
        : {
            ...item,
            uncounted: true,
            ...(item.children ? { children: documentary(item.children) } : {}),
          },
    )
  return documentary(items)
}

type Decision = {
  label: string
  what: string
  why?: string
  media?: ItemMedia
  /** A Your call: the person settles it (`late: true`), choosing between two options. */
  call?: NonNullable<Item["call"]>
}

/** The two options, the recommendation and the artifact a Your call names, from the decision's own lines. */
function yourCallOf(text: string): Decision["call"] | undefined {
  if (!isYourCall(text)) return undefined
  const line = (key: string) =>
    text.match(new RegExp(`^\\s*\\*\\*${key}:\\*\\*\\s*(.+)$`, "im"))?.[1]?.trim()
  const a = line("A")
  const b = line("B")
  if (a === undefined || b === undefined) return undefined
  const artifact = line("Artifact")
  return {
    options: [plain(a), plain(b)],
    recommended: /^b\b/i.test(line("Recommended") ?? "") ? 1 : 0,
    ...(artifact !== undefined ? { artifact: plain(artifact) } : {}),
  }
}

/** The lenses a decision's Kind line can name (the house style lists them, with their diagrams). */
const LENSES: readonly string[] = [
  "architecture",
  "sequence",
  "state",
  "data",
  "screens",
  "commands",
  "services",
  "flow",
]

/** What a decision's diagram is, in one word, from its Kind line or from the diagram itself. */
function diagramWord(kind: string | undefined, media: ItemMedia | undefined): string | undefined {
  const named = kind?.toLowerCase()
  if (named !== undefined && LENSES.includes(named)) return named
  // The same word the diagram's frame shows, read from the source: a `**Kind:**` line is optional.
  if (media?.kind === "mermaid") return diagramKind(media.source)
  if (media?.kind === "diff") return "diff"
  return undefined
}

/**
 * The Plan's engineering decisions: the `### ` blocks of `## Engineering decisions`, each with its
 * first paragraph as the reason and its first Mermaid diagram or `diff` as the thing itself.
 * Empty for a Plan that does not have the section.
 */
export function engineeringDecisions(body: string): Decision[] {
  const section = sectionRanges(body).find((r) => r.heading === "Engineering decisions")
  if (section === undefined) return []
  const blocks: { title: string; lines: string[] }[] = []
  const fences = extractFences(body)
  for (const [index, raw] of body.split(/\r?\n/).entries()) {
    if (index + 1 <= section.start || index + 1 >= section.end) continue
    const heading = fences.some((f) => index + 1 >= f.line && index + 1 <= f.endLine)
      ? null
      : raw.match(/^### (.+)$/)
    if (heading?.[1] !== undefined) blocks.push({ title: plain(heading[1]), lines: [] })
    else blocks[blocks.length - 1]?.lines.push(raw)
  }
  return blocks.map((block) => {
    const text = block.lines.join("\n")
    const kind = text.match(/^\*\*Kind:\*\*\s*([A-Za-z]+)/im)?.[1]
    const fences = extractFences(text)
    const mermaid = fences.find((f) => f.kind === "mermaid")
    const diff = fences.find((f) => f.lang === "diff")
    const bounded = fences.find((f) => f.kind === "wireframe" || f.kind === "panel")
    const parsed =
      bounded !== undefined && (bounded.kind === "wireframe" || bounded.kind === "panel")
        ? parseFence(bounded.kind, bounded.body)
        : undefined
    const media: ItemMedia | undefined =
      bounded !== undefined &&
      (bounded.kind === "wireframe" || bounded.kind === "panel") &&
      parsed !== undefined &&
      parsed.fragment !== ""
        ? { kind: bounded.kind, name: parsed.header.name ?? bounded.kind, source: bounded.body }
        : mermaid !== undefined
          ? { kind: "mermaid", source: mermaid.body.trim() }
          : diff !== undefined
            ? { kind: "diff", title: "Code shape", lines: diff.body.trimEnd() }
            : undefined
    // The prose outside the fences: its first paragraph says what was decided and what was not chosen.
    const prose = text
      .split(/\r?\n/)
      .filter((_, index) => !fences.some((f) => index + 1 >= f.line && index + 1 <= f.endLine))
      .filter((line) => !/^\*\*Kind:\*\*/i.test(line.trim()))
      .filter((line) => !/^\s*(?:\*\*(?:late|A|B|Recommended|Artifact):\*\*|late:)/i.test(line))
      .join("\n")
    const call = yourCallOf(text)
    const paragraph = prose
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find((p) => p !== "" && !/^[|#]/.test(p))
    const word = diagramWord(kind, media)
    return {
      label: word !== undefined ? `${KIND_LABEL.decision} · ${word}` : KIND_LABEL.decision,
      what: clip(block.title, 160),
      ...(paragraph !== undefined ? { why: clip(plain(paragraph), 320) } : {}),
      ...(media !== undefined ? { media } : {}),
      ...(call !== undefined ? { call } : {}),
    }
  })
}

/**
 * The `ql:decide <id>` of each engineering decision of the Plan, in the order of the decisions;
 * undefined for a decision that has none.
 */
export function decideIds(planText: string): (string | undefined)[] {
  const raw = withoutAdded(parseDoc(planText).body)
  const section = sectionRanges(raw).find((r) => r.heading === "Engineering decisions")
  if (section === undefined) return []
  const decides = parseMarkers(raw).markers.filter((m) => m.name === "decide")
  const heads: number[] = []
  proseLines(raw).forEach(({ text: line, line: number }) => {
    if (number > section.start && number < section.end && /^### /.test(line)) heads.push(number)
  })
  return heads.map((head, index) => {
    const end = heads[index + 1] ?? section.end
    return decides.find((m) => m.line > head && m.line < end)?.args[0]
  })
}

/**
 * The engineering decisions of a Plan as items: one each, in order, with its diagram as the thing
 * itself. A decision named with a `ql:decide` id (`ids`, in order) keeps that id; any other finds
 * an answer by the decision's title.
 */
export function decisionItems(body: string, ids?: (string | undefined)[]): Item[] {
  const used = new Set<string>()
  return engineeringDecisions(body).map((decision, index) => {
    const marked = ids?.[index]
    if (marked !== undefined) {
      used.add(marked)
      return make({
        id: `plan:decision:${marked}`,
        step: "plan",
        kind: "decision",
        kindLabel: decision.label,
        what: decision.what,
        ...(decision.why !== undefined ? { why: decision.why } : {}),
        ...(decision.media !== undefined ? { media: decision.media } : {}),
        ...(decision.call !== undefined ? { call: decision.call } : {}),
      })
    }
    // An answer finds its decision by its title, so adding or moving another decision leaves it be.
    const base = decision.what
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40)
      .replace(/-$/, "")
    let slug = base === "" ? "decision" : base
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`
    used.add(slug)
    return make({
      id: `plan:decision:${slug}`,
      step: "plan",
      kind: "decision",
      kindLabel: decision.label,
      what: decision.what,
      ...(decision.why !== undefined ? { why: decision.why } : {}),
      ...(decision.media !== undefined ? { media: decision.media } : {}),
      ...(decision.call !== undefined ? { call: decision.call } : {}),
    })
  })
}

/** "decision, because reason" or "decision — reason" as a decision and its reason. */
function splitReason(line: string): [string, string | undefined] {
  const dash = line.match(/^(.+?)\s[—–]\s(.+)$/)
  if (dash?.[1] !== undefined && dash[2] !== undefined) return [dash[1], dash[2]]
  const because = line.match(/^(.+?),\s+(because\b.+)$/i)
  if (because?.[1] !== undefined && because[2] !== undefined) {
    const why = because[2]
    return [because[1], why.charAt(0).toUpperCase() + why.slice(1)]
  }
  return [line, undefined]
}

// ---------------------------------------------------------------- Implement and Verify

// Implement raises nothing: the agent's own decisions are plain lines the page reads from the build
// log.

/** What the review's findings are worded from: the commits since the judged one, the points, the scenarios. */
type Findings = {
  commits: LaterCommit[] | null
  done: Map<number, string>
  /** The Plan's Done means steps by id (`A3`), as written. */
  steps: Map<string, string>
  /** The points a decision above already covers (`done 28`): a gap on the same point is not listed again. */
  points: Set<string>
}

async function findingsContext(ctx: Ctx, task: Task): Promise<Findings> {
  // The commit the last judges were assigned at; a later commit may have touched what they found.
  const head = (await readAssignment(ctx, task).catch(() => null))?.head
  return {
    commits:
      head !== undefined && /^[0-9a-f]{7,40}$/i.test(head)
        ? await commitsSince(ctx, task.repoRoot, head)
        : null,
    done: new Map((await doneMeansOf(ctx, task)).map((p) => [p.n, p.outcome])),
    steps: new Map((await proofOf(ctx, task)).steps.map((s) => [s.id, s.action])),
    points: new Set(),
  }
}

/** A failed point's headline: the point itself, in the Plan's words, not the judge's first clause. */
function failedHeadline(verdict: { kind: string; subject: string; text: string }, seen: Findings) {
  const n = Number(verdict.subject)
  const outcome = verdict.kind === "done" ? seen.done.get(n) : undefined
  if (outcome !== undefined) return `Done means ${n} is not met: ${lowerFirst(plain(outcome))}`
  // A Done means step: named by its id and what it does.
  const id = verdict.kind === "acceptance" ? verdict.subject.toUpperCase() : ""
  const step = seen.steps.get(id)
  if (step !== undefined) return `Step ${id} fails: ${lowerFirst(plain(step))}`
  return headline(verdict.text)
}

const lowerFirst = (text: string) =>
  /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text

/** The latest time each slice's failing check was recorded open, after its last fix did not hold. */
export async function openedChecks(ctx: Ctx, task: Task): Promise<Map<number, number>> {
  const opened = new Map<number, number>()
  for (const event of await readEvents(ctx, task))
    if (event.event === "slice_check_open" && typeof event.slice === "number")
      opened.set(event.slice, Math.max(opened.get(event.slice) ?? 0, Number(event.ts)))
  return opened
}

/**
 * A slice whose own commit could not be taken cleanly (another session's hunks in its files, a hook
 * failing on someone else's file) was carried while the build went on: the review names it, unless
 * a later `commit slice` or `commit slice N --commit` released it.
 */
async function carriedCommitItems(ctx: Ctx, task: Task): Promise<Item[]> {
  const blocked = await commitBlockedSlices(ctx, task)
  const committed = await committedSlices(ctx, task)
  return Object.entries(blocked)
    .map(([n, row]) => ({ n: Number(n), row }))
    .filter(({ n }) => !committed.includes(n))
    .sort((a, b) => a.n - b.n)
    .map(({ n, row }) =>
      make({
        id: `verify:carried-commit:${n}`,
        step: "verify",
        kind: "found",
        what: `Slice ${n} was not committed on its own: ${clip(plain(row.reason), 200)}`,
        why: "The build went on without waiting for that commit; its changes are in the task's later commits or still uncommitted, so check them in the diff.",
      }),
    )
}

/**
 * Whether the judge's latest verdict on a point (`done 1`, `outline T4`: kind and subject as a gap
 * names them) is a pass: a gap left open earlier that a later judge passed is settled.
 */
export function pointPassed(log: Pick<BuildLog, "verification">, point: string): boolean {
  let latest: string | null = null
  for (const iteration of log.verification)
    for (const v of iteration.verdicts)
      if (v.verdict !== "NOTE" && `${v.kind} ${v.subject}`.trim() === point) latest = v.verdict
  return latest === "PASS"
}

/**
 * Gaps a fix round closed because no code change settles them (a Done means only the person can
 * settle, Plan wording the agent amends): listed here instead of going to another fix helper, until
 * a later judge passes the point.
 */
async function openGapItems(ctx: Ctx, task: Task, log: BuildLog, seen: Findings): Promise<Item[]> {
  const items = new Map<string, Item>()
  for (const event of await readEvents(ctx, task)) {
    if (event.event !== "fix_gaps_open" || !Array.isArray(event.gaps)) continue
    for (const gap of event.gaps as { subject?: unknown; text?: unknown; kind?: unknown }[]) {
      const text = typeof gap.text === "string" ? gap.text : ""
      const subject = typeof gap.subject === "string" ? gap.subject : ""
      const id = `verify:open-gap:${hash(`${subject} ${text}`, 8)}`
      if (text === "" || items.has(id) || (subject !== "" && pointPassed(log, subject))) continue
      // A decision above already covers the point: the same gap is not asked twice.
      if (subject !== "" && seen.points.has(subject)) continue
      const [kind = "", n = ""] = subject.split(" ")
      items.set(
        id,
        make({
          id,
          step: "verify",
          kind: "found",
          kindLabel: "Decide · still open after checking",
          what: failedHeadline({ kind, subject: n, text }, seen),
          why: `A fix round found no code to change for ${subject === "" ? "this" : subject}: it needs your decision or a change to the Plan.`,
          details: text,
        }),
      )
    }
  }
  return [...items.values()]
}

/**
 * The final review's items: the points only you can confirm, what the checks found, what the agent
 * decided, the result to look at.
 */
async function reviewItems(ctx: Ctx, task: Task): Promise<Item[]> {
  const parsed = await readBuildRecord(ctx, task)
  const items: Item[] = []
  const reviewPath = taskDocPath(task, "verify")
  const description = (await ctx.fs.exists(reviewPath))
    ? parseDoc(await ctx.fs.readFile(reviewPath)).body
    : ""
  const currentContext = sectionRanges(description)
    .filter((section) => /^(?:Fixed after Verify|Evidence)$/i.test(section.heading))
    .map(
      (section) =>
        `## ${section.heading}\n\n${description
          .split(/\r?\n/)
          .slice(section.start, section.end - 1)
          .join("\n")
          .trim()}`,
    )
    .join("\n\n")

  // Human-only outcomes remain evidence; final approval never manufactures an attestation.
  for (const point of await userPoints(ctx, task)) {
    const a = point.attested
    items.push(
      make({
        id: `verify:confirm:${point.id}`,
        step: "verify",
        kind: "confirm",
        what: point.label,
        ...(point.text !== "" || currentContext !== ""
          ? { why: [point.text, currentContext].filter(Boolean).join("\n\n") }
          : {}),
        blocking: false,
        uncounted: true,
        ask: point.ask,
        ...(a !== undefined
          ? {
              state: "settled" as const,
              settledAt: a.at,
              answer: { kind: "confirm" as const, at: a.at, by: a.by, note: a.text },
            }
          : {}),
      }),
    )
  }

  const last = parsed.verification[parsed.verification.length - 1]
  const seen = await findingsContext(ctx, task)
  // The judges' notes break nothing and wait for no answer: one line each, folded under the
  // decisions, the judge's words behind it. They add to no count.
  const found = new Set<string>()
  const answers = await findingAnswers(ctx, task)
  for (const verdict of await withoutExemptNotes(ctx, task, last?.verdicts ?? [])) {
    if (verdict.verdict !== "NOTE" || found.has(verdict.text)) continue
    found.add(verdict.text)
    const changed = changedWords(changedAfter(verdict.text, seen.commits))
    // A note answered under the independent review's findings (Kept or Taken) is settled.
    const written = answers(verdict)
    items.push(
      make({
        id: `verify:found:${hash(verdict.text, 8)}`,
        step: "verify",
        kind: "found",
        kindLabel: "Found while checking",
        what: headline(verdict.text),
        details: verdict.text,
        tag: changed ?? "follow-up",
        uncounted: true,
        ...(written !== undefined
          ? {
              state: "settled" as const,
              settledAt: written.at,
              answer: {
                kind: written.stance === "taken" ? ("fix" as const) : ("accept" as const),
                at: written.at,
                note: written.text,
              },
            }
          : {}),
      }),
    )
  }

  items.push(...(await carriedCommitItems(ctx, task)))
  items.push(...(await openGapItems(ctx, task, parsed, seen)))

  const points = await doneMeansOf(ctx, task)
  const list = await proofOf(ctx, task)
  const cites = (file: string) =>
    (last?.verdicts ?? []).filter((v) => v.text.includes(`evidence/${file}`))
  // The Done means points a verdict speaks for: its own, or those its step proves.
  const pointsOf = (v: { kind: string; subject: string }): number[] =>
    v.kind === "done"
      ? [Number(v.subject)]
      : v.kind === "acceptance"
        ? (list.steps.find((s) => s.id === v.subject.toUpperCase())?.points ?? [])
        : []
  const media = (name: string): ItemMedia => {
    const citing = cites(name)
    const proves = citing
      .filter((v) => v.verdict !== "FAIL" && v.verdict !== "MISSING")
      .flatMap((v) =>
        pointsOf(v).flatMap((n) => {
          const point = points.find((p) => p.n === n)
          return point !== undefined ? [{ n: point.n, point: point.outcome }] : []
        }),
      )
    const also = citing
      .filter((v) => v.kind !== "done")
      .map((v) => (v.subject === "" ? v.kind : `${v.kind} ${v.subject}`))
    return {
      kind: "screenshot",
      name,
      ...(proves.length > 0 ? { proves } : {}),
      ...(also.length > 0 ? { also } : {}),
    }
  }
  const evidence = (await filesIn(ctx.fs, join(task.dir, "evidence"), true)).filter((n) =>
    IMAGE.test(n),
  )
  const pictures = (last?.pictures ?? [])
    .map((p) => ({ name: p.file.replace(/^evidence\//, ""), caption: p.caption }))
    .filter((p) => evidence.includes(p.name))
  const shown =
    pictures.length > 0
      ? pictures
      : evidence.slice(0, MAX_PICTURES).map((name) => ({ name, caption: humanize(name) }))
  for (const picture of shown.slice(0, MAX_PICTURES)) {
    items.push(
      make({
        id: `verify:result:${hash(picture.name, 8)}`,
        step: "verify",
        kind: "result",
        what: picture.caption !== "" ? picture.caption : humanize(picture.name),
        media: media(picture.name),
      }),
    )
  }
  return items
}

// ---------------------------------------------------------------- the Plan's request and questions

/** The rows of a section's markdown table as cells, without its header and separator. */
function tableCells(section: string): string[][] {
  return section
    .split(/\r?\n/)
    .filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l))
    .map((l) =>
      l
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => plain(cell)),
    )
}

/** The lines of the `### ` block of a section whose heading is `heading`. */
function subsection(section: string, heading: string): string {
  const out: string[] = []
  let inside = false
  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^###\s+(.+)$/)
    if (match?.[1] !== undefined) inside = match[1].trim().toLowerCase() === heading.toLowerCase()
    else if (inside) out.push(line)
  }
  return out.join("\n")
}

/** The user's own words: the "Your request" quote of the Plan's agents' file, without the `>`. */
function yourWords(body: string): string {
  return sectionText(body, "Your request")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*>\s?/, ""))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim()
}

/** "Question 3 · about 2 to come": the number, and the agent's estimate when it gave one. */
function questionLabel(question: Question): string {
  const ahead = questionsAhead(question)
  return `Question ${question.number}${ahead === undefined ? "" : ahead === 0 ? " · last questions" : ` · about ${ahead} to come`}`
}

/**
 * What needs the person while the Plan is written, before its own items: the agent's question while
 * it waits, and "Is this what you asked for?" (or "Is this the bug?").
 */
async function askedItems(ctx: Ctx, task: Task): Promise<Item[]> {
  const text = await readText(ctx, taskDocPath(task, "plan"))
  const body = withoutComments(withoutAdded(parseDoc(text).body))
  const agents = withoutComments(await readText(ctx, join(task.dir, agentFileOf("plan"))))
  const items: Item[] = []

  const question = await openQuestion(ctx, task)
  if (question !== null) {
    const history = await answeredQuestions(ctx, task)
    const session = await readSession(ctx, task)
    items.push(
      make({
        id: `plan:question:${question.number}`,
        step: "plan",
        kind: "question",
        kindLabel: questionLabel(question),
        what: question.question,
        // The App's own line of why, never the picker's lead.
        ...(question.why !== undefined ? { why: question.why } : {}),
        blocking: true,
        media: {
          kind: "choices",
          choices: question.choices.map((c, index) => ({
            label: c.label,
            ...(c.detail !== undefined ? { detail: c.detail } : {}),
            ...(recommendedIndices(question).includes(index) ? { recommended: true } : {}),
          })),
          answered: history.length,
          agent: session?.agent ?? "claude-code",
        },
      }),
    )
  }

  return [...items, ...askedFromDocs(body, yourWords(agents), task.type === "bugfix")]
}

/**
 * "Is this what you asked for?" (or "Is this the bug?") from the Plan's Problem (a bug's What
 * breaks) and the person's own words. Pure: the server reads the files, the demo its own documents,
 * and both come through here.
 */
export function askedFromDocs(body: string, words: string, bug: boolean): Item[] {
  const rows = bug
    ? tableCells(sectionText(body, "What breaks"))
        .filter((cells) => (cells[0] ?? "") !== "" && (cells[1] ?? "") !== "")
        .map((cells) => ({ label: cells[0] ?? "", value: cells[1] ?? "" }))
    : []
  const problem = bug
    ? firstSentence(sectionText(body, "Summary"))
    : plain(sectionText(body, "Problem"))
  if (problem === "" && rows.length === 0) return []
  const media: ItemMedia | undefined =
    rows.length > 0
      ? { kind: "facts", rows }
      : !bug && words !== ""
        ? { kind: "words", text: words }
        : undefined
  return [
    make({
      id: "plan:asked:1",
      step: "plan",
      kind: "asked",
      uncounted: true,
      blocking: false,
      kindLabel: bug ? "Is this the bug?" : KIND_LABEL.asked,
      what: clip(problem !== "" ? problem : words, 280),
      ...(media !== undefined ? { media } : {}),
      answers: { options: [], link: "change" },
    }),
  ]
}

// ---------------------------------------------------------------- the other agent's review

const ANSWER_LINE =
  /^\s*(?:[-*>]\s*)?\*{0,2}Answer:?\*{0,2}\s*(?:(Taken|Kept|Ask)\b)?\s*[·:—–-]?\s*(.*)$/i

/**
 * One finding of the other agent's review, with the working agent's own answer under it, when it
 * has one. `ask`: the agent could not settle it and asks the person; `answer` is its question.
 */
export type Finding = {
  what: string
  detail: string
  /**
   * A panel's backing of the finding (`Panel: all · Codex, Grok`): every reviewer backs it, they
   * disagree, or one raised it. `who` is the rest of the line, as the panel wrote it. Absent in a
   * single review.
   */
  panel?: { backing: "all" | "split" | "one"; who: string }
  stance?: "taken" | "kept" | "ask"
  answer?: string
}

/** The heading of a review's closing section: `*Not checked:*`, `**Not checked:**` or `*Not checked*`. */
const NOT_CHECKED_LINE = /^\s*(\*{1,2})Not checked:?\1/i

/**
 * The numbered findings of a review file, each with the `Answer: Taken · …`, `Answer: Kept · …` or
 * `Answer: Ask · <the question>` line the working agent wrote under it. The header line and the
 * verdict line are not findings.
 */
export function reviewFindings(markdown: string): Finding[] {
  const blocks: string[][] = []
  // The reviewer's closing `*Not checked:*` section, with any answer under it, joins no finding.
  let open = false
  for (const raw of markdown.split(/\r?\n/)) {
    if (/^\s*\d+[.)]\s/.test(raw)) {
      blocks.push([raw.replace(/^\s*\d+[.)]\s+/, "")])
      open = true
    } else if (NOT_CHECKED_LINE.test(raw)) open = false
    else if (open && !/^#/.test(raw)) blocks[blocks.length - 1]?.push(raw)
  }
  return blocks.map((lines) => {
    const asked: string[] = []
    let answer: { stance?: "taken" | "kept" | "ask"; text: string } | undefined
    let panel: Finding["panel"]
    for (const line of lines) {
      const backed = backingLine(line)
      if (backed !== null) {
        panel = {
          backing: (backed[1] ?? "").toLowerCase() as "all" | "split" | "one",
          who: (backed[2] ?? "").trim(),
        }
        continue
      }
      const said = line.match(ANSWER_LINE)
      if (said !== null) {
        const stance = (said[1] ?? "").toLowerCase()
        answer = {
          ...(stance === "taken" || stance === "kept" || stance === "ask" ? { stance } : {}),
          text: plain(said[2] ?? ""),
        }
      } else asked.push(line)
    }
    const joined = plain(asked.join(" "))
    const first = joined.split(/(?<=[.!?])\s/)[0] ?? joined
    return {
      what: clip(first, 200),
      detail: clip(joined.slice(first.length).trim(), 360),
      ...(panel !== undefined ? { panel } : {}),
      ...(answer !== undefined && answer.text !== ""
        ? { answer: answer.text, ...(answer.stance !== undefined ? { stance: answer.stance } : {}) }
        : {}),
    }
  })
}

/**
 * Each finding of the other agent's review of the Plan or of the change. One the working agent
 * answered (`Taken` or `Kept`) is settled: a plain line, nothing to click, never counted under
 * Needs you. One with no answer, or marked `Ask`, is open: the agent asks the person in the chat
 * (the question names it in `settles`), and it waits until that is answered.
 */
async function findingItems(
  ctx: Ctx,
  task: Task,
  point: CrossReviewPoint = "plan",
): Promise<{ items: Item[]; line: string | null }> {
  const run = await readRun(ctx, task, point)
  if (run === null || run.state !== "done") return { items: [], line: null }
  const found = reviewFindings(await readText(ctx, reviewFile(task, point)))
  const step = point === "plan" ? "plan" : "verify"
  const taken = found.filter((finding) => finding.stance === "taken").length
  const line = `${run.name} reviewed it: ${found.length === 0 ? "nothing to change" : `${found.length} ${found.length === 1 ? "finding" : "findings"}, ${taken} taken`}`
  return {
    line,
    items: found.map((finding, index) => {
      const settled =
        finding.answer !== undefined && (finding.stance === "taken" || finding.stance === "kept")
      const why = settled
        ? `${finding.stance === "taken" ? "Taken" : "Kept"} · ${finding.answer}`
        : finding.stance === "ask"
          ? finding.answer
          : finding.detail
      return make({
        id: `${step}:finding:${index + 1}`,
        step,
        kind: "finding",
        blocking: step === "verify" && !settled,
        ...(step === "plan" ? { uncounted: true as const } : {}),
        kindLabel: `${run.name}'s review · ${index + 1} of ${found.length}`,
        what: finding.what,
        // Answered in the chat when it is open: the page offers no button for it.
        answers: { options: [] },
        ...(settled ? { state: "settled" as const } : {}),
        ...(why !== undefined && why !== "" ? { why } : {}),
      })
    }),
  }
}

/** A teammate's or a guest's comment on the documents of the Plan gate, as an item to reply to or resolve. */
async function teammateItems(ctx: Ctx, task: Task): Promise<Item[]> {
  const first = (name: string) => name.trim().split(/[\s@]/)[0] ?? name
  return (await readTeamComments(ctx, task))
    .filter(
      (c) =>
        !isStructured(c) &&
        c.resolved === undefined &&
        c.remark.trim() !== "" &&
        c.doc === folderDoc("plan"),
    )
    .map((c) =>
      make({
        id: `plan:teammate:${c.id}`,
        step: "plan",
        kind: "teammate",
        kindLabel: `Comment from ${first(commentAuthor(c))}${isAgentFile(c.doc) ? " · on the agent's version" : ""}`,
        what: clip(
          c.quote.trim() !== ""
            ? `On “${clip(plain(c.quote), 90)}”: ${plain(c.remark)}`
            : plain(c.remark),
          300,
        ),
      }),
    )
}

// ---------------------------------------------------------------- what the page says besides items

/** The Plan's lists: its scope, what was decided with the person, and what it rests on. */
async function planParts(ctx: Ctx, task: Task): Promise<NonNullable<StepParts["plan"]>> {
  return planLists(
    withoutComments(withoutAdded(parseDoc(await readText(ctx, taskDocPath(task, "plan"))).body)),
  )
}

/**
 * The Plan's Scope (In scope, Out of scope), its Decided with you rows and what it rests on
 * ("Assumptions"), as lists, with the task that rests on each assumption. Pure.
 */
export function planLists(plan: string): NonNullable<StepParts["plan"]> {
  const scope = sectionText(plan, "Scope")
  return {
    inScope: bullets(subsection(scope, "In scope")).map(plain),
    outOfScope: bullets(subsection(scope, "Out of scope")).map(plain),
    decided: tableCells(sectionText(plan, "Decided with you"))
      .slice(1)
      .filter((cells) => (cells[1] ?? "") !== "" && (cells[2] ?? "") !== "")
      .map((cells) => ({ what: cells[1] ?? "", answer: cells[2] ?? "" })),
    assumptions: bullets(sectionText(plan, "Assumptions")).map((line) => {
      const text = plain(line)
      const owner = text.match(/\b(T\d+)\b/)?.[1] ?? null
      // The task tag goes first, then the marker an answer the person did not know carries.
      const untagged = text.replace(/\s*[(·—–-]*\s*\bT\d+\b\)?\s*\.?$/, "").trim()
      const marker = /\s*\(unconfirmed\)$/i
      const unconfirmed = marker.test(untagged)
      return {
        text: untagged.replace(marker, "").trim(),
        task: owner,
        ...(unconfirmed ? { unconfirmed } : {}),
      }
    }),
  }
}

/**
 * The facts the agents proved, for the Plan's violet line: what was read and tested, never more
 * than the files say.
 */
async function checkFacts(ctx: Ctx, task: Task, review: string | null): Promise<StepChecks> {
  const agents = withoutComments(await readText(ctx, join(task.dir, agentFileOf("plan"))))
  const questions = numberedItems(sectionText(agents, RESEARCH_QUESTIONS)).length
  const researched = sectionText(agents, "Findings").trim() !== ""
  const planText = await readText(ctx, taskDocPath(task, "plan"))
  const plan: string[] = []
  if (task.type === "bugfix") {
    const body = withoutComments(withoutAdded(parseDoc(planText).body))
    if (sectionText(body, "What breaks") !== "") plan.push("reproduced the bug")
    if (sectionText(agents, "Investigation") !== "") plan.push("traced it to its cause")
  } else if (questions > 0) {
    plan.push(
      researched
        ? "research findings recorded"
        : `${questions} research ${questions === 1 ? "question" : "questions"} awaiting records`,
    )
  }
  const fs = ctx.fs.forPublication?.(task.repoRoot, task.dir) ?? ctx.fs
  const probes = (
    await Promise.all(
      parsePrerequisites(planText).rows.map(async (p) => {
        if (
          !/^P?\d+$/i.test(p.n) ||
          !/^met\b/i.test(plain(p.status)) ||
          !/^(?:the\s+)?(?:agent|codex|claude(?:[- ]code)?)\b/i.test(plain(p.metBy))
        )
          return false
        const paths = [
          ...new Set(
            `${p.status} ${p.what} ${p.metBy}`.match(/\b(?:evidence|records)\/[A-Za-z0-9._/-]+/g) ??
              [],
          ),
        ]
        for (const path of paths) {
          if (path.split("/").includes("..")) continue
          try {
            if (withoutComments(await fs.readFile(join(task.dir, path))).trim() !== "") return true
          } catch {
            /* Missing files and files outside the task boundary are not saved output. */
          }
        }
        return false
      }),
    )
  ).filter(Boolean).length
  if (probes > 0) {
    plan.push(`${probes} recorded agent ${probes === 1 ? "check" : "checks"} with saved output`)
  }
  if (review !== null) plan.push(review)
  return { plan }
}

/** What an item says, for telling whether the agent changed it. */
function digestOf(item: Item): string {
  return hash([
    item.kindLabel,
    item.what,
    item.why ?? null,
    item.media ?? null,
    (item.children ?? []).map((c) => c.digest ?? ""),
  ])
}

function stamp(items: Item[]): Item[] {
  return items.map((item) => {
    const children = item.children !== undefined ? stamp(item.children) : undefined
    const next = { ...item, ...(children !== undefined ? { children } : {}) }
    return { ...next, digest: digestOf(next) }
  })
}

/**
 * Answers to feedback stay in the document thread. They are information, never another
 * mandatory planning choice; a new unresolved choice uses the question transport.
 */
export function noteItems(comments: Comment[], gate: GateFile | null | true): Item[] {
  if (gate === null) return []
  // A comment posted after Plan approval is feedback for the build. Its answer stays in the
  // document thread; the retained Plan gate must not turn it into another planning decision.
  const decided = gate !== true && gate.decision === "approved" ? gate.decided : undefined
  return comments
    .filter(
      (c) =>
        c.delivered === true &&
        c.answer !== undefined &&
        c.item === undefined &&
        c.build === undefined &&
        c.source === undefined &&
        (decided === undefined || c.created <= decided) &&
        c.doc !== FINAL &&
        c.doc !== "build",
    )
    .map((c) => {
      const passage = c.quote.trim() !== ""
      return make({
        id: `plan:note:${c.id}`,
        step: "plan",
        kind: "note",
        uncounted: true,
        blocking: false,
        kindLabel: `${passage ? "Your comment" : KIND_LABEL.note} · answered`,
        what: clip(plain(c.answer ?? ""), 220),
        why: passage
          ? `On “${clip(plain(c.quote), 90)}” you wrote: ${clip(plain(c.remark), 160)}`
          : `You asked: “${clip(plain(c.remark), 160)}”`,
        answers: { options: passage ? (["resolve", "reply"] as AnswerKind[]) : [] },
      })
    })
}

export type TaskPage = {
  items: Item[]
  parts: StepParts
  checked: StepChecks
}

/**
 * Everything the step pages draw from the documents and state: the items of every step the task has
 * reached, with their state, in the order a person reads them (blocking first, settled last, per
 * step), the lists around them, and the facts for the violet lines. `gate` is the task's gate
 * file, which the caller may have read already.
 */
export async function taskPage(ctx: Ctx, task: Task, gate: GateFile | null): Promise<TaskPage> {
  if (task.type === "chat") return { items: [], parts: {}, checked: { plan: [] } }
  // A hand-back keeps its Plan file when present; its one action item is the prompt to copy.
  const handback = await readHandback(ctx, task)
  if (handback !== null) {
    return {
      items: [
        make({
          id: "plan:handback:1",
          step: "plan",
          kind: "handback",
          what: clip(plain(handback.words !== "" ? handback.words : handback.title), 220),
          ...(handback.reason !== "" ? { why: handback.reason } : {}),
          ...(handback.prompt !== ""
            ? { media: { kind: "prompt" as const, text: handback.prompt } }
            : {}),
        }),
      ],
      parts: {},
      checked: { plan: [] },
    }
  }
  const [comments, decided, asked, finding, teammates, parts] = await Promise.all([
    readComments(ctx, task),
    readDecided(ctx, task),
    askedItems(ctx, task),
    findingItems(ctx, task),
    teammateItems(ctx, task),
    planParts(ctx, task),
  ])
  const env = {
    comments,
    decided,
    ...(gate?.revision !== undefined ? { revision: gate.revision } : {}),
  }
  const out: Item[] = []

  // A finding the agent answered stays settled: nothing the person did or a gate decided reopens it.
  const resolve = (item: Item) =>
    (item.kind === "finding" && item.state === "settled") ||
    (item.kind === "confirm" && item.step === "verify")
      ? item
      : resolveItem(item, env)
  const plan = stamp([...asked, ...(await planItems(ctx, task))])
  const notes = stamp(noteItems(comments, gate?.target === folderDoc("plan") ? gate : null))
  const planAll = applyPointAgreements(
    [...plan, ...stamp(finding.items), ...stamp(teammates), ...notes].map(resolve),
    await pointAgreements(ctx, task, comments),
  )
  // A note that is still open arrived with the agent's answer: it is new since the last review.
  const marked = planAll.map((item) =>
    item.kind === "note" && item.state === "open" ? { ...item, changedSinceReview: true } : item,
  )
  out.push(...orderItems(marked))

  // Verify's items wait for the person's review: once a pass stands, or once the final gate is open.
  const mode = await readVerifyMode(ctx, task)
  if (
    mode === "yours" ||
    mode === "rechecking" ||
    task.stage === "shipped" ||
    gate?.target === FINAL
  ) {
    const changeFindings = await findingItems(ctx, task, "verify")
    const review = stamp([...(await reviewItems(ctx, task)), ...changeFindings.items]).map(resolve)
    out.push(...orderItems(review))
  }
  return {
    items: out,
    parts: { plan: parts },
    checked: await checkFacts(ctx, task, finding.line),
  }
}

/** The task's items alone; see `taskPage`. */
export async function taskItems(ctx: Ctx, task: Task, gate: GateFile | null): Promise<Item[]> {
  return (await taskPage(ctx, task, gate)).items
}

export { doneMeans }
