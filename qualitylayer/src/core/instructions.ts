// The person's and the team's own instructions: two local files read for every step, composed
// into one block. QualityLayer's rules stay above them; the block says so.

import { createHash } from "node:crypto"
import { join } from "node:path"
import type { Ctx } from "../ctx.ts"
import { FLOW_STEPS, type FlowStepId } from "./flow.ts"
import type { Task } from "./task/store.ts"
import { trimEndCharacters } from "./text-boundaries.ts"

export const INSTRUCTIONS_MAX_CHARS = 12_000
const CUT_NOTE = "(cut at 12,000 characters)"
const FENCE = /^ {0,3}(`{3,}|~{3,})/

export type InstructionsSource = { text: string; updated: number; by?: string }

/** Characters are code points: the same in the editor, the local route, the backend and the cut. */
export const instructionsLength = (text: string): number => [...text].length

/** The UTC date of `updated`, so the same inputs give the same block. */
const changed = (by: string, updated: number) =>
  `changed by ${by}, ${new Date(updated).toISOString().slice(0, 10)}`

/** The step headings of the seven-step workflow, and the step each one's lines now belong to. */
const EARLIER_HEADINGS: Record<string, FlowStepId> = {
  discuss: "plan",
  research: "plan",
  outline: "implement",
  review: "verify",
}

/** Where the person's file was kept as it was before its headings were renamed. */
export const INSTRUCTIONS_BACKUP = "instructions.seven-steps.md"

/**
 * The text with each `## ` heading of an earlier step renamed to the step it now belongs to
 * (`## Discuss` and `## Research` to `## Plan`, `## Outline` to `## Implement`, `## Review` to
 * `## Verify`); headings inside a fenced block stay. The text is returned unchanged when it has none.
 */
export function withThreeStepHeadings(text: string): string {
  let fence: string | null = null
  const lines = text.split("\n")
  let changed = false
  for (const [at, line] of lines.entries()) {
    const marker = FENCE.exec(line)?.[1]
    if (fence !== null) {
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length)
        fence = null
      continue
    }
    if (marker !== undefined) {
      fence = marker
      continue
    }
    if (!line.startsWith("## ")) continue
    const step = EARLIER_HEADINGS[trimEndCharacters(line.slice(3), " \r").toLowerCase()]
    if (step === undefined) continue
    const label = FLOW_STEPS.find((s) => s.id === step)?.label ?? step
    lines[at] = `## ${label}${line.endsWith("\r") ? "\r" : ""}`
    changed = true
  }
  return changed ? lines.join("\n") : text
}

/**
 * Rename the earlier steps' headings in `~/.qualitylayer/instructions.md` once, keeping the file as
 * it was beside it (`instructions.seven-steps.md`, never overwritten). A file with none of them is
 * left alone, so running it again changes nothing. Returns whether it rewrote the file.
 */
export async function migrateInstructionHeadings(ctx: Ctx): Promise<boolean> {
  const path = join(ctx.home, "instructions.md")
  let text: string
  try {
    text = await ctx.fs.readFile(path)
  } catch {
    return false
  }
  const renamed = withThreeStepHeadings(text)
  if (renamed === text) return false
  const backup = join(ctx.home, INSTRUCTIONS_BACKUP)
  if (!(await ctx.fs.exists(backup))) await ctx.fs.atomicWrite(backup, text)
  await ctx.fs.atomicWrite(path, renamed)
  return true
}

/**
 * `~/.qualitylayer/instructions.md` and when it last changed; null when missing or unreadable. A
 * file still written for the seven steps has its headings renamed first (`migrateInstructionHeadings`).
 */
export async function readPersonal(ctx: Ctx): Promise<InstructionsSource | null> {
  const path = join(ctx.home, "instructions.md")
  await migrateInstructionHeadings(ctx)
  try {
    const text = await ctx.fs.readFile(path)
    const stat = await ctx.fs.stat?.(path)
    return { text, updated: Math.floor(stat?.mtimeMs ?? 0) }
  } catch {
    return null
  }
}

export type InstructionsSave =
  | { status: 200; body: { text: string; updated: number } }
  | { status: 400; body: { error: string } }
  | { status: 409; body: { error: "changed elsewhere"; current: number } }

/**
 * Save the person's file for the editor. `base` is the `updated` the editor opened with: a file that
 * changed since is refused, so two editors never overwrite each other unseen. An empty text removes
 * the file.
 */
export async function saveInstructions(
  ctx: Ctx,
  text: unknown,
  base: unknown,
): Promise<InstructionsSave> {
  if (typeof text !== "string" || typeof base !== "number")
    return { status: 400, body: { error: "text and base are required" } }
  if (instructionsLength(text) > INSTRUCTIONS_MAX_CHARS)
    return { status: 400, body: { error: `at most ${INSTRUCTIONS_MAX_CHARS} characters` } }
  const path = join(ctx.home, "instructions.md")
  await ctx.fs.mkdir(ctx.home)
  return ctx.fs.withLock(`${path}.lock`, async (): Promise<InstructionsSave> => {
    const current = (await readPersonal(ctx))?.updated ?? 0
    if (current !== base) return { status: 409, body: { error: "changed elsewhere", current } }
    if (text === "") {
      await ctx.fs.remove(path)
      return { status: 200, body: { text: "", updated: 0 } }
    }
    await ctx.fs.atomicWrite(path, text)
    return { status: 200, body: { text, updated: (await readPersonal(ctx))?.updated ?? 0 } }
  })
}

/** The team's copy fetched earlier (`team-instructions.json`); null when missing or not valid. */
export async function readTeamCopy(ctx: Ctx): Promise<InstructionsSource | null> {
  try {
    const copy: unknown = JSON.parse(
      await ctx.fs.readFile(join(ctx.home, "team-instructions.json")),
    )
    if (typeof copy !== "object" || copy === null) return null
    const { text, by, updated } = copy as Record<string, unknown>
    if (typeof text !== "string") return null
    return {
      text,
      by: typeof by === "string" && by !== "" ? by : "your team",
      updated: typeof updated === "number" && Number.isFinite(updated) ? updated : 0,
    }
  } catch {
    return null
  }
}

const STEP_NAMES = new Set<string>(FLOW_STEPS.map((step) => step.id))

/** The step a `## ` line names (any case, trailing spaces allowed), or null. */
function stepHeading(line: string): string | null {
  if (!line.startsWith("## ")) return null
  const name = line.slice(3).replace(/ +$/, "").toLowerCase()
  return STEP_NAMES.has(name) ? name : null
}

/**
 * The part of a file that applies to one step: the lines before the first `## `, every section
 * that is not named after a step, and every section named after this one. Headings inside a
 * fenced code block start no section. Text over the cap is cut first, on the raw text.
 */
export function forStep(text: string, step: FlowStepId | null): string {
  const lf = text.replaceAll("\r\n", "\n")
  const points = [...lf]
  const cut = points.length > INSTRUCTIONS_MAX_CHARS
  const lines = (cut ? points.slice(0, INSTRUCTIONS_MAX_CHARS).join("") : lf).split("\n")
  const kept: string[] = []
  let keep = true
  let fence: string | null = null
  for (const line of lines) {
    const marker = FENCE.exec(line)?.[1]
    if (fence !== null) {
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length)
        fence = null
    } else if (marker !== undefined) {
      fence = marker
    } else if (line.startsWith("## ")) {
      const named = stepHeading(line)
      keep = named === null || named === step
    }
    if (keep) kept.push(line)
  }
  const result = kept.join("\n").trim()
  return cut && result !== "" ? `${result}\n\n${CUT_NOTE}` : result
}

/**
 * The brief section of a helper or reviewer working in `step`: it names one filed copy of the
 * step's block (written once per distinct block) and never holds the instructions. Null when the
 * step has no block.
 */
export async function instructionsSection(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  step: FlowStepId,
): Promise<string | null> {
  const block = await instructionsBlock(ctx, step)
  if (block === null) return null
  const digest = createHash("sha256").update(block).digest("hex").slice(0, 24)
  const dir = join(task.runtimeDir, "briefs")
  const file = join(dir, `instructions-${step}-${digest}.md`)
  if (!(await ctx.fs.exists(file))) {
    await ctx.fs.mkdir(dir)
    await ctx.fs.atomicWrite(file, block)
  }
  return `## Your team's and your own instructions\n\nRead \`${file}\` in full before you start; it applies to this work as the repository's own rules do, and QualityLayer's rules in this brief win where they conflict. Never copy it into a report or document.`
}

/** The block for one step; null when neither file has text for it. */
export async function instructionsBlock(ctx: Ctx, step: FlowStepId | null): Promise<string | null> {
  const [team, personal] = await Promise.all([readTeamCopy(ctx), readPersonal(ctx)])
  const teamText = team === null ? "" : forStep(team.text, step)
  const ownText = personal === null ? "" : forStep(personal.text, step)
  if (teamText === "" && ownText === "") return null
  return [
    "## Your team's and your own instructions",
    "Follow these in this step, as you follow the repository's own rules. QualityLayer's gates, approvals and the rules above still apply: where a line below conflicts with them, they win. Where the team's and your own instructions disagree, the team's win. Never copy these instructions into a task document or the chat.",
    ...(team !== null && teamText !== ""
      ? [`### From your team (${changed(team.by ?? "your team", team.updated)})`, teamText]
      : []),
    ...(ownText !== "" ? ["### Your own", ownText] : []),
  ].join("\n\n")
}
