// The transition table, free of imports so the CLI and the App's browser bundle read the very same
// data. The step track and every command's moves are readings of this one table.

export type Stage = "chat" | "plan" | "implement" | "verify" | "shipped" | "abandoned"

export type TaskEvent =
  | "workflow_started"
  /** The task was handed back as a plain prompt, its Plan file and the prompt preserved. */
  | "handed_back"
  /**
   * A new task started from the person's own plan (`task start --from-plan`): its original is kept
   * beside the task and the Plan maps it. Legal only with that original and its record (machine.ts).
   */
  | "plan_adopted"
  | "gate_approved"
  | "tasks_complete"
  /** The agent says the build is ready; unticked cards become open items in Verify. */
  | "work_deferred"
  | "user_abandoned"
  /**
   * A follow-up fix on a shipped task whose pull request is still open: the build reopens at Implement
   * and goes through Verify again before it ships once more.
   */
  | "follow_up"

type Counts = { judgeRuns: number; asked: number }
/** The counts so far, the counts before the last pass and whether that pass stands. */
type Rounds = Counts & { before: Counts; passStands: boolean }
const START: Rounds = {
  judgeRuns: 0,
  asked: 0,
  before: { judgeRuns: 0, asked: 0 },
  passStands: false,
}

function verifyResultStep(r: Rounds, event: Record<string, unknown>): Rounds {
  if (event.passed === true)
    return {
      judgeRuns: 0,
      asked: 0,
      before: { judgeRuns: r.judgeRuns, asked: r.asked },
      passStands: true,
    }
  return {
    ...r,
    judgeRuns: r.judgeRuns + (event.budgeted !== false ? 1 : 0),
    passStands: false,
  }
}

function roundStep(r: Rounds, event: Record<string, unknown>): Rounds {
  switch (event.event) {
    // Straight after a pass it undoes that pass (its counts are spent again); withdrawn again with no
    // pass between (no independent reviewer), each is one more failed judgement.
    case "verify_withdrawn":
      return r.passStands
        ? { ...r, judgeRuns: r.before.judgeRuns + 1, asked: r.before.asked, passStands: false }
        : { ...r, judgeRuns: r.judgeRuns + 1, passStands: false }
    case "verify_result":
      return verifyResultStep(r, event)
    case "plan_amended":
      return event.by === "user" ? START : r
    case "fix_round_asked":
      return { ...r, asked: r.asked + 1 }
    default:
      return r
  }
}

/**
 * Where Verify's rounds stand, read from the task's events (the record, so a crash loses nothing).
 * `judgeRuns` counts the failed judgements since the latest pass or the person's amendment; an
 * environment block spends none. The first judgement is no round: the rounds done are one fewer.
 * The person adds a round with `fix_round_asked`; their amendment (`plan_amended` by user) resets.
 * A pass the final full check then failed (`verify_withdrawn`) counts as one more failed judgement.
 */
export function fixRoundsOf(events: readonly Record<string, unknown>[]): {
  judgeRuns: number
  done: number
  asked: number
} {
  const { judgeRuns, asked } = events.reduce(roundStep, START)
  const done = Math.max(0, judgeRuns - 1)
  return { judgeRuns, done, asked }
}

/**
 * What Verify is doing, read from the task's events like the rounds above:
 * - `checking`: no judgement stands and none failed last (the first check, or after the person's amendment);
 * - `fixing`: the last judgement failed;
 * - `asked`: a real blocker has an exit question;
 * - `yours`: the last judgement passed and stands, so the person reviews;
 * - `rechecking`: a pass stood, then the person's comment or a moved base reopened it; their approval still saves.
 */
export type VerifyMode = "checking" | "fixing" | "asked" | "yours" | "rechecking"

export function verifyModeOf(
  events: readonly Record<string, unknown>[],
  openExit: boolean,
): VerifyMode {
  if (openExit) return "asked"
  let mode: VerifyMode = "checking"
  for (const event of events) {
    if (event.event === "verify_result") mode = event.passed === true ? "yours" : "fixing"
    else if (event.event === "verify_withdrawn") mode = "fixing"
    else if (event.event === "verify_reopened" && mode === "yours") mode = "rechecking"
    else if (event.event === "plan_amended" && event.by === "user") mode = "checking"
  }
  return mode
}

type Table = Record<Stage, Partial<Record<TaskEvent, Stage>>>

/**
 * Plan → Implement → Verify. The Plan's approval starts the build; the build's end starts Verify; the
 * final approval ships. Verify never sends a task back: what it does is its mode (`verifyModeOf`).
 */
export const transitions: Table = {
  chat: { workflow_started: "plan", plan_adopted: "plan", user_abandoned: "abandoned" },
  plan: { gate_approved: "implement", handed_back: "abandoned", user_abandoned: "abandoned" },
  implement: { tasks_complete: "verify", work_deferred: "verify", user_abandoned: "abandoned" },
  verify: { gate_approved: "shipped", user_abandoned: "abandoned" },
  shipped: { follow_up: "implement" },
  abandoned: {},
}

export const TERMINAL_STAGES: readonly Stage[] = ["shipped", "abandoned"]

/** Every stage in the order a task can reach it, for ranking copies of one task. */
export const STAGE_ORDER: readonly Stage[] = [
  "chat",
  "plan",
  "implement",
  "verify",
  "shipped",
  "abandoned",
]

export function nextStage(task: { stage: Stage }, event: TaskEvent): Stage | null {
  return transitions[task.stage][event] ?? null
}
