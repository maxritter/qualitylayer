// The flow scales itself by fixed rules on the task's signals: the cards' slices, the Plan's
// risks, its Size and Trust boundary lines, its questions for helpers, the task's
// UI flag and the user's overrides in words; no setting is read. Nothing asks the user
// up front; the agent says in one line what applied (`flowLine`). Plain values,
// so the App page imports it like config-values.ts.

import type { Result } from "../ctx.ts"
import { allTasks, codeSlices, type Outline } from "./docs/outline.ts"
import { smallBounds } from "./small-change.ts"
import type { Task } from "./task/store.ts"

export { flowLine } from "./scaling-line.ts"

/** The switches `task override` accepts: the only words the scaling rules read. */
export const OVERRIDES = [
  "+security",
  "-security",
  // The second opinion on the Plan and on the change together, or on one of them.
  "+second-opinion",
  "-second-opinion",
  "+second-opinion:plan",
  "-second-opinion:plan",
  "+second-opinion:change",
  "-second-opinion:change",
  // The way the task runs: `-small` keeps it the full workflow, `+small` asks for a small change
  // (still refused while a bound does not hold).
  "+small",
  "-small",
] as const

/**
 * Who reads the Plan before the person: the other vendor's second opinion, a fresh same-vendor
 * reviewer on Sonnet when no other vendor can run, or nobody.
 */
export type PlanReview = "second-opinion" | "sonnet" | "none"

export type Flow = {
  /** Blind research helpers: the Plan's agents' file holds questions for helpers. */
  researchHelpers: boolean
  /** The Plan's Trust boundary line is not `none`, the build changed agent controls, or the user asked for it. */
  security: boolean
  /** The changed files that steer an agent, a hook or CI; set once the build has changed one. */
  agentControls?: string[]
  /** Who reviews the Plan before the person is told (Settings › Second opinion › On the Plan). */
  planReview: PlanReview
  /**
   * A small change: picked at intake from the first look and confirmed by the Plan's lines, it
   * takes one page, one build step and one independent review (`lightPlan`).
   */
  light?: boolean
  /**
   * The independent reviewer also adds the missing tests: one fresh agent that never wrote the code.
   * False only with the independent review off in Settings.
   */
  combinedReview?: boolean
  /** The other agent reviews the built change (Settings › Second opinion › On the built change). */
  changeSecondOpinion: boolean
  /** Too big for one task: propose splitting it to the user. */
  splitProposal: boolean
}

/** What the scaling rules read of a task's documents beyond its slices. */
export type FlowSignals = {
  /** The Plan's questions for helpers. */
  researchQuestions: number
  /** The planner left areas its own reading could not trace: it wrote questions for helpers. */
  untraced: boolean
  /** The Plan's `**Trust boundary:**` value, null while it has none. */
  trustBoundary: string | null
  /** An explicit one-task answer applies to this still-current approved Plan. */
  oneTaskApproved?: boolean
  /** The text of the agents' Plan file's *Risks*: a new dependency, an outside system or a migration makes the change risky. */
  risks?: string | null
  /** The slices the Plan's `**Size:**` line names; null without such a line. */
  plannedSlices?: number | null
  /** The files the Plan's Findings name in a table; null when they name none. Absent: not measured. */
  firstLookFiles?: string[] | null
  /** The Plan's artifact markers; null while there is no Plan. */
  screens?: string[] | null
}

/** The most code slices a small change has: the Plan's Size line and, once written, the cards. */
export const LIGHT_SLICES = 1

export const NO_SIGNALS: FlowSignals = {
  researchQuestions: 0,
  untraced: false,
  trustBoundary: null,
}

/** Above this the Plan is proposed as several tasks. */
export const SPLIT_SLICES = 8
export const SPLIT_TASKS = 25

/** A Trust boundary line that names something crossing it. */
export const crossesBoundary = (line: string | null): boolean =>
  line !== null && line.trim() !== "" && !/^none\b/i.test(line.trim())

const has = (task: Pick<Task, "overrides">, word: string) => task.overrides.includes(word)

const RISK_WORDS =
  /\b(?:(?:new|added|adds?|introduc\w+)\s+(?:\w+\s+){0,2}(?:dependenc\w*|librar\w*|packages?|crates?|sdks?)|third[- ]party|external\s+(?:system|service|api|vendor|dependenc\w*)s?|outside\s+(?:system|service)s?|migrat\w*)/gi
const NEGATION = /\b(?:no|none|not|without|never|nothing|neither|nor|doesn'?t|does not)\b/i

/**
 * Whether the Plan's *Risks* name a new dependency, an external system or a migration: each clause
 * is read apart, and one that says it has none ("no new dependency") names nothing.
 */
export function risksNameRisk(text: string | null | undefined): boolean {
  if (text === null || text === undefined) return false
  return text.split(/[.;,\n]|\s[-—–]\s/).some((clause) => {
    for (const match of clause.matchAll(RISK_WORDS))
      if (!NEGATION.test(clause.slice(0, match.index))) return true
    return false
  })
}

/**
 * The one definition of a risky change, for the Plan's second opinion and the built change's: the
 * trust boundary crosses something, or the Plan's *Risks* name a new dependency, an external system
 * or a migration.
 */
export const riskyPlan = (_plan: Outline | null, signals: FlowSignals): boolean =>
  crossesBoundary(signals.trustBoundary) || risksNameRisk(signals.risks)

function fitsLightSize(plan: Outline | null, signals: FlowSignals): boolean {
  const slices = signals.plannedSlices
  if (slices === null || slices === undefined || slices < 1 || slices > LIGHT_SLICES) return false
  if (signals.trustBoundary === null || crossesBoundary(signals.trustBoundary)) return false
  return !riskyPlan(plan, signals) && (plan === null || codeSlices(plan).length <= LIGHT_SLICES)
}

/**
 * A small change: the task's first look proposed it (`profile: small`) or the person asked for it
 * (`+small`). Known risk and trust-boundary records keep their review behavior. The Plan and
 * cards describe one build step; file, area, question and screen counts do not decide the view.
 * Missing size/risk records keep the full view. `-small` keeps the person's full choice.
 */
export function lightPlan(
  task: Pick<Task, "ui" | "overrides" | "profile">,
  plan: Outline | null,
  signals: FlowSignals,
): boolean {
  const requested = !has(task, "-small") && (task.profile === "small" || has(task, "+small"))
  if (!requested || signals.untraced || signals.firstLookFiles === undefined) return false
  if (!smallBounds({ files: signals.firstLookFiles, untraced: false }).ok) return false
  return fitsLightSize(plan, signals)
}

/**
 * What the user's settings say about the flow: whether a second opinion may run by itself (Automatic:
 * on a risky Plan or change), and whether the other vendor's agent can run at all. `plan` and
 * `change` say when each is read; Settings sets both to `risky` or `off`.
 */
export type FlowSettings = {
  secondOpinion: boolean
  plan?: "off" | "always" | "risky"
  change?: "off" | "risky" | "always"
  /** False when only one agent is installed: a Sonnet reviewer reads the Plan instead. */
  otherVendor?: boolean
}

/** When Settings sends a Plan to review: a risky Plan with the second opinion on, else never. */
export function planReviewWhen(second: { enabled: boolean }): "off" | "risky" {
  return second.enabled ? "risky" : "off"
}

/** Whether the task's words switch the second opinion on or off for one point, or for both. */
function opinionWord(task: Pick<Task, "overrides">, point: "plan" | "change"): boolean | null {
  if (has(task, "-second-opinion") || has(task, `-second-opinion:${point}`)) return false
  if (has(task, "+second-opinion") || has(task, `+second-opinion:${point}`)) return true
  return null
}

export function flowFor(
  task: Pick<Task, "ui" | "overrides" | "profile"> & { layout?: string },
  plan: Outline | null,
  signals: FlowSignals = NO_SIGNALS,
  settings: FlowSettings = { secondOpinion: true },
): Flow {
  const slices = plan !== null ? codeSlices(plan) : []
  const risky = riskyPlan(plan, signals)
  const researchHelpers = signals.researchQuestions > 0 || signals.untraced
  const light = lightPlan(task, plan, signals)
  // Switched off in Settings, a review runs only for a task that asks for one.
  const planWord = opinionWord(task, "plan")
  // A small change skips the Plan review (the Settings row says so); only the task's own `+second-opinion` brings it.
  const planWanted =
    planWord ??
    (!light &&
      settings.secondOpinion &&
      settings.plan !== "off" &&
      ((settings.plan ?? "always") === "always" || risky))
  const changeWord = opinionWord(task, "change")
  const changeWanted =
    changeWord ??
    (settings.secondOpinion &&
      settings.change !== "off" &&
      ((settings.change ?? "risky") === "always" || risky))
  return {
    researchHelpers,
    security: has(task, "-security")
      ? false
      : has(task, "+security") || crossesBoundary(signals.trustBoundary),
    planReview: !planWanted ? "none" : settings.otherVendor === false ? "sonnet" : "second-opinion",
    light,
    // Every task gets the missing tests a fresh agent adds: skipping them on a light task cost the
    // medium bench task a planted fault in every Claude Code run (2026-10-12). The independent
    // reviewer adds them; `taskFlow` turns this off when Settings turn the independent review off.
    combinedReview: true,
    changeSecondOpinion: changeWanted,
    splitProposal:
      !signals.oneTaskApproved &&
      (slices.length > SPLIT_SLICES || (plan !== null && allTasks(plan).length > SPLIT_TASKS)),
  }
}

/**
 * `task override +security -checkpoint`: each word switches a scaling rule on or off for this task,
 * replacing its opposite. Refused: a word outside the vocabulary.
 */
export function applyOverrides(current: readonly string[], words: string[]): Result<string[]> {
  const known = OVERRIDES as readonly string[]
  const out = [...current]
  if (words.length === 0) {
    return {
      ok: false,
      error: { code: "bad_args", message: `name an override: ${known.join(", ")}` },
    }
  }
  for (const word of words) {
    if (!known.includes(word)) {
      return {
        ok: false,
        error: {
          code: "bad_args",
          message: `"${word}" is not an override; the overrides are ${known.join(", ")}`,
        },
      }
    }
    const name = word.slice(1).replace(/:all$/, "")
    // A word replaces every earlier word about the same rule: the last one said counts.
    for (let i = out.length - 1; i >= 0; i--)
      if ((out[i] ?? "").slice(1).replace(/:all$/, "") === name) out.splice(i, 1)
    out.push(word)
  }
  return { ok: true, data: out }
}

/** The roles a fresh-context helper is handed out for, with what the instructions call its subagent. */
export const HELPER_ROLES = {
  research: "research",
  "plan-review": "Plan review",
  "artifact-check": "artifact check",
  /** A Chat build's slice (`chat build`); a workflow build's session builds its own slices. */
  slice: "slice build",
  security: "security review",
  judge: "verify judge",
} as const
export type HelperRole = keyof typeof HELPER_ROLES

export const helperRoleName = (role: HelperRole): string => HELPER_ROLES[role]
