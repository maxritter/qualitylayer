// What the cost view calls things: each helper after its work, each model as people say it, the
// project checks' runs, and the one line worth a look. Free of Node imports, so the App's bundle
// reads it as it is (the panel decides what is worth a look from the figures it was sent).

import { FLOW_STEPS, type FlowStepId } from "../flow.ts"
import type { Tokens } from "./prices.ts"
import type { Call } from "./transcripts.ts"

export type CostLine = {
  tokens: Tokens
  all: number
  usd: number | null
  reportedCreditValueUsd?: number
  nativeCredits?: Call["nativeCredits"]
  estimateUsd?: number
  unpriced?: { model: string; tokens: number }[]
}

export type HelperKind =
  | "research"
  | "slice"
  | "security"
  | "judge"
  | "fix"
  | "cross-review"
  | "own-helper"

export type CostStep = {
  step: FlowStepId
  /** Minutes the agents worked in this step: the gaps between their calls, with idle waits left out. */
  ms: number
  /** The person's own session in this step; null when only helpers ran. */
  session: (CostLine & { model: string; modelLabel: string }) | null
} & CostLine

export type CostHelper = {
  id: string
  kind: HelperKind
  /** Named after its work ("Security check", "Checking · part 1 of 3"), never its role in the machinery. */
  label: string
  model: string
  modelLabel: string
  ms: number
  /** The step it began in: all of its cost is counted there. */
  step: FlowStepId
  /** Model calls it made. */
  calls: number
} & CostLine

/** The project's own full runs of its checks (tests, types, lint): no tokens, no cost. */
export type CostChecks = { step: FlowStepId; runs: number; ms: number | null }

export type TaskCost = {
  steps: CostStep[]
  helpers: CostHelper[]
  checks: CostChecks | null
  total: { ms: number } & CostLine
  /** Describes recorded credit usage value, verified list estimates, or their combination. */
  note: string
  /** The sessions whose transcript was not found on this machine. */
  missing: number
  /** Set when the task's tokens run well above the person's usual task (token-warning.ts). */
  tokenWarning?: { tokens: number; typical: number | null; text: string }
}

/** Tokens as a person reads them: 2.4M, 340K, 812. */
export function tokenWords(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1))}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}K`
  return String(n)
}

// ---------------------------------------------------------------------------- models

const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

/** "claude-sonnet-5-5" reads "Sonnet 5.5"; "gpt-6.1-sol" reads "GPT-6.1 Sol". */
export function modelLabel(model: string): string {
  if (model === "" || model === "unknown") return "unknown model"
  if (model.startsWith("gpt-")) {
    const [version, ...rest] = model.slice(4).split("-")
    return [`GPT-${version}`, ...rest.map(cap)].join(" ")
  }
  if (!model.startsWith("claude-")) return model
  const parts = model
    .slice("claude-".length)
    .replace(/-\d{8}$/, "")
    .split("-")
  const name = parts.filter((p) => !/^\d+$/.test(p)).map(cap)
  const version = parts.filter((p) => /^\d+$/.test(p)).join(".")
  return [...name, version].filter((p) => p !== "").join(" ")
}

// ---------------------------------------------------------------------------- helpers

export {
  helperLabel,
  kindOfId,
  kindOfText,
  labelHelpers,
} from "./labels-helpers.ts"

// ---------------------------------------------------------------------------- project checks

type Run = { scope: string; command: string; at: number; ms?: number }

/**
 * How often the project's full set of checks ran and how long it took. A full run is one pass over
 * the all-scope commands: a command seen again starts the next pass. Null when it never ran.
 */
export function projectChecks(
  records: Run[],
): { runs: number; ms: number | null; firstAt: number } | null {
  const all = records.filter((r) => r.scope === "all").sort((a, b) => a.at - b.at)
  if (all.length === 0) return null
  let runs = 0
  let current = new Set<string>()
  for (const r of all) {
    if (runs === 0 || current.has(r.command)) {
      runs++
      current = new Set()
    }
    current.add(r.command)
  }
  const timed = all.filter((r) => typeof r.ms === "number")
  return {
    runs,
    ms: timed.length === 0 ? null : timed.reduce((n, r) => n + (r.ms ?? 0), 0),
    firstAt: all[0]?.at ?? 0,
  }
}

// ---------------------------------------------------------------------------- worth a look

const stepName = (id: FlowStepId) => FLOW_STEPS.find((s) => s.id === id)?.label ?? id
const dollars = (usd: number) => `$${usd.toFixed(2)}`

/** A step cheaper than this is never flagged: there is nothing to save. */
const WORTH_MIN_USD = 1
/** Three full runs of the project's checks is a repeat; fewer is just checking. */
const REPEAT_RUNS = 3

/** 24_000_000 reads "24M", 1_200_000 "1.2M": no trailing ".0". */
const millions = (n: number) => `${Number((n / 1e6).toFixed(1))}M`

/**
 * One line, only when something dominates a step, and why: one helper over half of the step's cost
 * (with its calls and the tokens it re-read), and project checks that ran three or more times and
 * took over half of their step's time. When both apply the line says both.
 */
export function worthALook(cost: TaskCost): { step: FlowStepId; text: string } | null {
  let found: { step: FlowStepId; text: string } | null = null
  for (const s of cost.steps) {
    const stepUsd = s.usd
    if (stepUsd === null || stepUsd < WORTH_MIN_USD || s.unpriced?.some((row) => row.tokens > 0))
      continue
    const big = cost.helpers
      .filter(
        (h) =>
          h.step === s.step &&
          h.usd !== null &&
          h.usd > stepUsd / 2 &&
          !h.unpriced?.some((row) => row.tokens > 0),
      )
      .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))[0]
    if (big?.usd != null) {
      const name = big.label
      const why =
        big.calls > 0 && big.tokens.cacheRead > 0
          ? ` (${big.calls} calls, ${millions(big.tokens.cacheRead)} tokens re-read)`
          : ""
      found = {
        step: s.step,
        text: `${name} cost ${dollars(big.usd)} of ${stepName(s.step)}'s ${dollars(stepUsd)}, over half of that step${why}.`,
      }
      break
    }
  }
  const checks = cost.checks
  const step = cost.steps.find((s) => s.step === checks?.step)
  if (
    checks?.ms != null &&
    checks.runs >= REPEAT_RUNS &&
    step !== undefined &&
    checks.ms > step.ms / 2
  ) {
    if (found !== null)
      return {
        ...found,
        text: `${found.text} The project checks ran ${checks.runs} times in ${stepName(checks.step)}.`,
      }
    return {
      step: checks.step,
      text: `The project checks ran ${checks.runs} times in ${stepName(checks.step)}, over half of its time.`,
    }
  }
  return found
}
