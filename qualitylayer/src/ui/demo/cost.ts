import type { CostHelper, CostStep, TaskCost } from "../../core/cost/labels.ts"
import { modelLabel, tokenWords } from "../../core/cost/labels.ts"
import { PRICE_NOTE } from "../../core/cost/prices.ts"
import type { FlowStepId } from "../../core/flow.ts"
import { DEMO_TASK_ID } from "./identity.ts"
import { MIN } from "./story.ts"

const opus = "claude-opus-5-5"
const sonnet = "claude-sonnet-5-5"
const codex = "gpt-6.1-sol"

/** Cache reads are most of a real run's tokens, so the demo shows every line as cache reads. */
const line = (usd: number) => {
  const all = Math.round(usd * 2_880_000)
  return {
    tokens: { input: 0, output: 0, cacheRead: all, cacheWrite5m: 0, cacheWrite1h: 0 },
    all,
    usd,
  }
}

const session = (model: string, usd: number) => ({
  model,
  modelLabel: modelLabel(model),
  ...line(usd),
})

const helper = (
  id: string,
  kind: CostHelper["kind"],
  label: string,
  model: string,
  step: CostHelper["step"],
  minutes: number,
  usd: number,
  calls: number,
): CostHelper => ({
  id,
  kind,
  label,
  model,
  modelLabel: modelLabel(model),
  step,
  ms: minutes * MIN,
  calls,
  ...line(usd),
})

const sum = (values: (number | null)[]) =>
  Math.round(values.reduce<number>((a, b) => a + (b ?? 0), 0) * 100) / 100

/** One step's row: the person's own session plus the helpers that began in it, added up. */
function step(
  id: FlowStepId,
  minutes: number,
  usd: number,
  helpers: CostHelper[],
  model = opus,
): CostStep {
  const own =
    Math.round((usd - sum(helpers.filter((h) => h.step === id).map((h) => h.usd))) * 100) / 100
  return { step: id, ms: minutes * MIN, session: session(model, own), ...line(usd) }
}

function total(steps: CostStep[], helpers: CostHelper[], checks: TaskCost["checks"]): TaskCost {
  return {
    steps,
    helpers,
    checks,
    total: { ms: sum(steps.map((s) => s.ms)), ...line(sum(steps.map((s) => s.usd ?? 0))) },
    note: PRICE_NOTE,
    missing: 0,
  }
}

// ----------------------------------------------------------------------------- the export task

/** Rate-limit the export API: two slices, two checking runs, and the price of the fix it needed. */
function exportCost(): TaskCost {
  const all: CostHelper[] = [
    helper("s1-a1", "slice", "Slice 1 · Rate limit per key", sonnet, "implement", 8, 2.2, 61),
    helper("s2-a1", "slice", "Slice 2 · Export route", sonnet, "implement", 6, 1.35, 38),
    helper("j1-s1", "judge", "Checking run 1 · part 1 of 2", codex, "verify", 3, 0.55, 18),
    helper("j1-s2", "judge", "Checking run 1 · part 2 of 2", codex, "verify", 3, 0.45, 16),
    helper("fx-a1", "fix", "Fix the retry-after rounding", sonnet, "verify", 3, 0.4, 14),
    helper("j2-s1", "judge", "Checking run 2 · part 1 of 2", codex, "verify", 2, 0.3, 12),
    helper("j2-s2", "judge", "Checking run 2 · part 2 of 2", codex, "verify", 2, 0.25, 10),
  ]
  const steps = [
    step("plan", 21, 3, all),
    step("implement", 19, 4.0, all),
    step("verify", 17, 3.55, all),
  ]
  return total(steps, all, { step: "verify", runs: 4, ms: 3 * MIN })
}

// ----------------------------------------------------------------------------- the other tasks

/** A task with no helpers worth naming: each step is the person's own session, minutes and dollars. */
function plain(rows: [FlowStepId, number, number][]): TaskCost {
  return total(
    rows.map(([id, minutes, usd]) => step(id, minutes, usd, [])),
    [],
    null,
  )
}

const OTHERS: Record<string, [FlowStepId, number, number][]> = {
  queue: [["plan", 28, 4.05]],
  webhook: [
    ["plan", 19, 2.5],
    ["implement", 26, 3.8],
  ],
  invoice: [["plan", 11, 1.35]],
  sso: [
    ["plan", 24, 3.3],
    ["implement", 31, 5.5],
    ["verify", 22, 4.2],
  ],
  tokens: [
    ["plan", 22, 2.9],
    ["implement", 38, 3.9],
  ],
  reindex: [["plan", 5, 0.55]],
  pager: [["plan", 7, 0.85]],
  "retry-audit": [["plan", 4, 1.2]],
  audit: [
    ["plan", 10, 1.3],
    ["implement", 12, 1.7],
    ["verify", 5, 0.8],
  ],
  importer: [["plan", 17, 1.6]],
  // The bug and the too-small change the Plan states add.
  "export-timeout": [["plan", 14, 2.1]],
  "rename-heading": [["plan", 3, 0.4]],
}

/**
 * The cost of a demo task, in dollars and minutes of its own. Usage-based billing, the demo
 * task, has its own rows by the step it stands at; every other task has the figures of its own
 * story, never another task's.
 */
export function demoCost(id: string, stage = "verify"): TaskCost {
  if (id === DEMO_TASK_ID) return demoTaskCost(stage)
  if (id === "export") return exportCost()
  return plain(OTHERS[id] ?? [["plan", 5, 0.6]])
}

/** The token warning the demo task carries at `?tokens=high`: its own tokens, against a usual task a quarter of it. */
export function demoTokenWarning(tokens: number): NonNullable<TaskCost["tokenWarning"]> {
  const typical = Math.round(tokens / 4)
  return {
    tokens,
    typical,
    text: `This task has used ${tokenWords(tokens)} tokens, about 4× your usual task.`,
  }
}

/** The demo task's cost: one row per step it has reached, each with its own tint in the panel. */
const TASK_ROWS: [FlowStepId, number, number][] = [
  ["plan", 64, 37.9],
  ["implement", 204, 50],
  ["verify", 46, 10.4],
]

export function demoTaskCost(stage: string): TaskCost {
  const at = TASK_ROWS.findIndex(([id]) => id === stage)
  return plain(TASK_ROWS.slice(0, stage === "shipped" ? undefined : at + 1))
}
