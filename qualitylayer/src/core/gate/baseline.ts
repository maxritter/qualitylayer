// What the person decided, remembered so a later change to the Plan can tell whether it touches it:
// the parts of the Plan only they change (the problem, the scope, each Done means point as agreed)
// and its *Decided with you*. Recorded when the Plan is approved, and renewed by every answer the
// person gives. The steps under each point, the approach and the rest are the agents' to amend.

import { createHash } from "node:crypto"
import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { includingAdded } from "../docs/added.ts"
import { sectionText } from "../docs/build-log.ts"
import { type ApprovedCommands, commandsOf } from "../docs/commands.ts"
import { parseDoc } from "../docs/frontmatter.ts"
import { withoutMarkerText } from "../docs/markers.ts"
import { allTasks } from "../docs/outline.ts"
import { readCards } from "../docs/outline-files.ts"
import { type YourCallRecord, yourCallsOf } from "../pages/your-calls.ts"
import { planningQuestionAnswers } from "../task/planning-answers.ts"
import { planDetailsText, type Task, taskDocPath } from "../task/store.ts"
import { keepApprovedPlan } from "./approved-plan.ts"

/** The Plan section that holds the person's own decisions. */
export const DECIDED_BY_YOU = "Decided with you"

const digest = (value: string) => createHash("sha256").update(value).digest("hex")
const baselinePath = (task: Pick<Task, "runtimeDir">) => join(task.runtimeDir, "plan-baseline.json")

export type Baseline = {
  /** The person's parts of the Plan as approved (`agreedOf`), as a digest. */
  agreed: string
  /** The person's own text in Decided with you, without QualityLayer's marker text. */
  decided: string
  /** The planning answers as approved (`decisionAnswers`). */
  answers: [string, string][]
  /** The commands the approval covers: `check` runs these and no others. */
  commands?: ApprovedCommands
  /**
   * The ids of the cards when the Plan was last approved or amended. Past Implement every one of
   * them was done, so a box found open again there is a reopened task; one not in this list is a
   * card added since.
   */
  tasks?: string[]
  /**
   * Every card's Files when the Plan was last approved or amended: a Done means step's path is
   * stale only when a card named it then.
   */
  files?: string[]
  /**
   * The Your calls of the Plan as approved (title and option words, by decision id). The
   * Decided-by-you rows read them, so a later reformatting of a call's block moves nothing the
   * person approved.
   */
  yourCalls?: Record<string, YourCallRecord>
}

/**
 * The person's parts of a Plan's body: Problem and Scope as written, and of Done means each
 * point's heading and the sentence on how it shows; the steps' tables, the `also` lines and the
 * `Runs as:` line are the agents'. QualityLayer's text between markers is left out.
 */
export function agreedOf(body: string): string {
  const text = withoutMarkerText(includingAdded(body))
  const points = sectionText(text, "Done means")
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim()
      return (
        !trimmed.startsWith("|") &&
        !/^[*_]*also\b/i.test(trimmed) &&
        !/^(?:\*\*|__)?runs as\b/i.test(trimmed)
      )
    })
    .join("\n")
  return [sectionText(text, "Problem"), sectionText(text, "Scope"), points].join("\n\0\n")
}

async function planBody(ctx: Ctx, task: Task): Promise<string> {
  const path = taskDocPath(task, "plan")
  return (await ctx.fs.exists(path)) ? parseDoc(await ctx.fs.readFile(path)).body : ""
}

/** The planning answers standing now, by question and choice, as the Plan's approval binds them. */
export async function decisionAnswers(ctx: Ctx, task: Task): Promise<[string, string][]> {
  return (await planningQuestionAnswers(ctx, task))
    .filter((a) => a.reopened !== true && a.gate === undefined)
    .map((a): [string, string] => [a.id ?? String(a.number), a.choice])
}

/**
 * The person's parts of the Plan, the Decided with you text they own, and their answers. The rows
 * QualityLayer writes between its markers come from the answers and the calls, so the digests
 * leave them out, as the approval's digest does, and the answers are kept beside them.
 */
export async function userDecisions(
  ctx: Ctx,
  task: Task,
): Promise<{ agreed: string; decided: string; answers: [string, string][] }> {
  const body = await planBody(ctx, task)
  return {
    agreed: digest(agreedOf(body)),
    decided: digest(withoutMarkerText(sectionText(body, DECIDED_BY_YOU))),
    answers: await decisionAnswers(ctx, task),
  }
}

/** The ids and the Files of the cards now, or null before the cards file exists. */
async function cardsNow(
  ctx: Ctx,
  task: Task,
): Promise<{ tasks: string[]; files: string[] } | null> {
  const cards = allTasks(await readCards(ctx, task.dir))
  if (cards.length === 0) return null
  return { tasks: cards.map((t) => t.id), files: [...new Set(cards.flatMap((t) => t.files))] }
}

async function planCommands(ctx: Ctx, task: Task): Promise<ApprovedCommands | undefined> {
  const details = await planDetailsText(ctx, task)
  return details !== null ? commandsOf(details, await readCards(ctx, task.dir)) : undefined
}

async function saveBaseline(ctx: Ctx, task: Task, baseline: Baseline): Promise<void> {
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(baselinePath(task), `${JSON.stringify(baseline)}\n`)
}

/** Remember what the person decided, and the commands they approved with the Plan. */
export async function writeBaseline(ctx: Ctx, task: Task): Promise<void> {
  const commands = await planCommands(ctx, task)
  const cards = await cardsNow(ctx, task)
  await saveBaseline(ctx, task, {
    ...(await userDecisions(ctx, task)),
    ...(commands !== undefined ? { commands } : {}),
    ...(cards !== null ? cards : {}),
    yourCalls: yourCallsOf(await planBody(ctx, task)),
  })
  await keepApprovedPlan(ctx, task)
}

/**
 * Take the amended Plan's commands as the ones `check` runs, and keep what the person decided as
 * it was: an amendment is recorded, so a command it changed is no longer one only the agent may run.
 */
export async function rebaseCommands(ctx: Ctx, task: Task): Promise<void> {
  const before = await readBaseline(ctx, task)
  if (before === null) return writeBaseline(ctx, task)
  const commands = await planCommands(ctx, task)
  const cards = await cardsNow(ctx, task)
  const { commands: _old, tasks: _tasks, files: _files, ...decided } = before
  await saveBaseline(ctx, task, {
    ...decided,
    ...(commands !== undefined ? { commands } : {}),
    ...(cards !== null ? cards : {}),
  })
  // The amendment is accepted: the copy a later refusal diffs against is the Plan as it stands.
  await keepApprovedPlan(ctx, task)
}

/**
 * Whether a slice or card the baseline holds names other commands now: once the build is declared
 * ready, `check` leaves such a command to the agent until an amendment. A new card is no change.
 */
export async function commandsMoved(
  ctx: Ctx,
  task: Task,
  baseline: Baseline | null,
): Promise<boolean> {
  const before = baseline?.commands
  const now = before === undefined ? undefined : await planCommands(ctx, task)
  if (before === undefined || now === undefined) return false
  const moved = (was: Record<string, string[]>, is: Record<string, string[]>) =>
    Object.entries(was).some(
      ([id, commands]) => id in is && JSON.stringify(is[id]) !== JSON.stringify(commands),
    )
  return moved(before.slices, now.slices) || moved(before.tasks, now.tasks)
}

/**
 * The cards come after the Plan's approval: the baseline takes their ids, Files and commands as they
 * stand, keeping the project checks and Done means steps the person approved. While the build runs
 * the cards' commands are read as they are; `recordCards` fixes the cards when the build is
 * declared ready, so a box found open again later is a reopened task.
 */
async function withCards(ctx: Ctx, task: Task, before: Baseline): Promise<Baseline> {
  const cards = await cardsNow(ctx, task)
  if (cards === null) return before
  const now = await planCommands(ctx, task)
  const commands =
    now === undefined
      ? before.commands
      : {
          ...now,
          all: before.commands?.all ?? now.all,
          proof: before.commands?.proof ?? now.proof,
        }
  return { ...before, ...cards, ...(commands !== undefined ? { commands } : {}) }
}

/** Record the cards as they stand in the baseline (the build declared ready). */
export async function recordCards(ctx: Ctx, task: Task): Promise<void> {
  const before = await storedBaseline(ctx, task)
  if (before === null) return
  await saveBaseline(ctx, task, await withCards(ctx, task, before))
}

async function storedBaseline(ctx: Ctx, task: Pick<Task, "runtimeDir">): Promise<Baseline | null> {
  try {
    return JSON.parse(await ctx.fs.readFile(baselinePath(task))) as Baseline
  } catch {
    return null
  }
}

export async function readBaseline(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir"> | Task,
): Promise<Baseline | null> {
  const stored = await storedBaseline(ctx, task)
  if (stored === null || !("stage" in task) || task.stage !== "implement") return stored
  // The cards come after the approval: the first read in Implement that finds them records them,
  // so an amendment's stale-step check compares against the cards as the build first wrote them.
  if (stored.tasks === undefined) {
    const recorded = await withCards(ctx, task, stored)
    if (recorded.tasks !== undefined) await saveBaseline(ctx, task, recorded)
    return recorded
  }
  // While the build runs, `check` runs the cards' commands as they stand; their ids and Files stay
  // as last recorded.
  const { commands } = await withCards(ctx, task, stored)
  return commands !== undefined ? { ...stored, commands } : stored
}
