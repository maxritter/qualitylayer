// The billing task's Verify step in the states the artifacts show: checking live, all passed, one
// failure being fixed, a point left open after the rounds, and the security review that ran first. The
// change handles money, so the security review runs in every state. The shapes are the server's own
// (core/checklist.ts), with illustrative data.

import type { Checklist, CheckRow } from "../../core/checklist.ts"
import type { TaskDetail } from "../../server/api.ts"
import {
  CONFIRMED_EARLIER,
  FAILED_DONE,
  FINAL_RUN,
  PLAN_DONE,
  PROJECT_CHECKS,
  SECURITY_FINDINGS,
  SECURITY_RESULT,
} from "./story.ts"
import { setVerifyMode } from "./verify-mode.ts"

export const VERIFY_STATES = ["live", "passed", "fixing", "unsettled", "security"] as const
export type VerifyState = (typeof VERIFY_STATES)[number]

/** Done means, the way Verify words each point: the Plan's outcomes, in order. */
const DONE = PLAN_DONE.map((point) => point.outcome)
/** Done 4 was confirmed by the person while the build ran; Done 5 waits for them in their review. */
const CONFIRMED_DONE = PLAN_DONE.findIndex((point) => point.outcome.startsWith("Seat customers"))
const ONLY_YOU_DONE = PLAN_DONE.findIndex((point) => point.outcome.startsWith("History"))

const row = (
  id: string,
  label: string,
  state: CheckRow["state"],
  patch: Partial<CheckRow> = {},
): CheckRow => ({ id, label, state, ...patch })

/** `done[n]`: the state of Done means point n + 1; the rest wait. */
function checklist(done: CheckRow["state"][], extra: Partial<Checklist> = {}): Checklist {
  const before = [row("security", "Security review", "passed", { text: SECURITY_RESULT })]
  const groups: Checklist["groups"] = [
    { id: "before", title: "Before checking", rows: before },
    {
      id: "project",
      title: "Project checks",
      rows: PROJECT_CHECKS.map((c) => row(`check:${c}`, c, "passed", { text: "exit 0" })),
    },
    {
      id: "done",
      title: "Done means",
      rows: DONE.map((title, i) => {
        const only = i === ONLY_YOU_DONE
        const earlier = i === CONFIRMED_DONE
        const state = only ? "user" : earlier ? "passed" : (done[i] ?? "waiting")
        return row(`done:${i + 1}`, title, state, {
          ...(only ? { text: "one replayed day on the staging ledger" } : {}),
          ...(earlier ? { text: `proved on the running program; ${CONFIRMED_EARLIER}` } : {}),
          ...(state === "passed" && !earlier ? { text: "proved on the running program" } : {}),
        })
      }),
    },
    {
      id: "review",
      title: "Code review",
      rows: [row("review", "Code review", "waiting")],
    },
  ]
  const rows = groups.flatMap((g) => g.rows)
  const counted = rows.filter((r) => r.off !== true && r.state !== "user" && r.extra !== true)
  return {
    groups,
    total: counted.length,
    passed: counted.filter((r) => r.state === "passed").length,
    failed: rows.filter((r) => r.state === "failed").length,
    user: rows.filter((r) => r.state === "user"),
    minutes: { checks: 6, checking: 9 },
    now: [],
    rounds: 0,
    agents: 3,
    stale: [],
    ...extra,
  }
}

/** The Verify step's checklist in a state. */
export function verifyChecklist(variant: VerifyState): Checklist {
  if (variant === "passed") {
    const list = checklist(
      DONE.map(() => "passed"),
      {
        rounds: FINAL_RUN,
        fixed: [
          {
            id: `done:${FAILED_DONE}`,
            label: DONE[FAILED_DONE - 1] ?? "",
            text: "a mid-cycle change billed 3 cents more than the contract; it now sums the parts before rounding",
            round: 1,
          },
        ],
      },
    )
    const review = list.groups.find((g) => g.id === "review")
    if (review?.rows[0] !== undefined)
      review.rows[0] = {
        ...review.rows[0],
        state: "passed",
        text: "every changed file against its task",
      }
    return recount(list)
  }
  if (variant === "fixing" || variant === "unsettled") {
    const list = checklist(
      DONE.map((_, i) => (i === FAILED_DONE - 1 ? "failed" : "passed")),
      {
        rounds: variant === "fixing" ? 1 : 2,
        ...(variant !== "fixing"
          ? {
              fixed: [
                {
                  id: `done:${FAILED_DONE}`,
                  label: DONE[FAILED_DONE - 1] ?? "",
                  text: "a mid-cycle plan change was not prorated by day; it is now",
                  round: 1,
                },
              ],
            }
          : {}),
        ...(variant === "fixing"
          ? {
              now: [{ who: "Fixing", line: "a failing test for the Growth part, then the code" }],
              recheck: {
                rerun: [`done:${FAILED_DONE}`, "review"],
                carried: ["done:1", "done:2"],
                files: ["invoicing/usage-lines.ts", "tests/invoicing/tiers.test.ts"],
              },
            }
          : {}),
      },
    )
    const done = list.groups.find((g) => g.id === "done")?.rows[FAILED_DONE - 1]
    if (done !== undefined) done.text = "a mid-cycle change bills 3 cents more than the contract"
    const review = list.groups.find((g) => g.id === "review")
    // Unsettled: Verify ended after two rounds, so the code review ran too and nothing is left to check.
    if (review !== undefined)
      review.rows[0] =
        variant === "unsettled"
          ? {
              ...(review.rows[0] as CheckRow),
              state: "passed",
              text: "every changed file against its task",
            }
          : { ...(review.rows[0] as CheckRow), state: "waiting" }
    return recount(list)
  }
  // Live: the first Done means points have passed, two parts are checking.
  const done: CheckRow["state"][] = DONE.map((_, i) =>
    i < 2 ? "passed" : i === 2 || i === 5 ? "running" : "waiting",
  )
  const list = checklist(done, {
    now: [
      {
        who: "Checking · part 1 of 3",
        line: "point 3: changes the plan on day 10 and reads the dark invoice",
      },
      { who: "Checking · part 2 of 3", line: "point 6: switches account 42 to usage and back" },
    ],
  })
  const sixth = list.groups.find((g) => g.id === "done")?.rows[5]
  if (sixth !== undefined) sixth.who = "Checking · part 2 of 3"
  return recount(list)
}

function recount(list: Checklist): Checklist {
  const rows = list.groups.flatMap((g) => g.rows)
  const counted = rows.filter((r) => r.off !== true && r.state !== "user" && r.extra !== true)
  return {
    ...list,
    total: counted.length,
    passed: counted.filter((r) => r.state === "passed").length,
    failed: rows.filter((r) => r.state === "failed").length,
    user: rows.filter((r) => r.state === "user"),
  }
}

/** Change the flagship task as the server would show a state of Verify. */
export function applyVerifyVariant(task: TaskDetail, variant: VerifyState): void {
  task.checklist = verifyChecklist(variant)
  // The change handles money: the security review ran in every state, before the checks.
  task.quality = [
    {
      step: "security",
      state: "done",
      result: SECURITY_RESULT,
      findings: SECURITY_FINDINGS,
    },
  ]
  // Checking live has not finished a run yet; the later states carry the runs they went through.
  if (variant === "live" || variant === "security") {
    setVerifyMode(task, "checking")
    task.iterations = 0
    task.verification = []
  }
  if (variant === "passed") {
    // Every check passed: Verify turns to the person's review.
    task.stage = "verify"
    setVerifyMode(task, "yours")
    task.session = task.session !== null ? { ...task.session, state: "waiting" } : null
    return
  }
  if (variant === "fixing") {
    // As the server sends it while the builder fixes a failed check: the task stays in Verify, fixing.
    task.stage = "verify"
    setVerifyMode(task, "fixing")
    return
  }
  if (variant === "unsettled") {
    // The review and its recheck did not settle one check: your comment reopened the pass, and the
    // agents recheck it while the review lists it first.
    task.stage = "verify"
    setVerifyMode(task, "rechecking")
    task.iterations = 2
    task.verification = withRecheck(task.verification)
    task.session = task.session !== null ? { ...task.session, state: "waiting" } : null
    return
  }
}

/** The first checking round, and two more that failed the same check for another reason. */
function withRecheck(rounds: TaskDetail["verification"]): TaskDetail["verification"] {
  const first = rounds[0]
  if (first === undefined || rounds.length !== 1) return rounds
  const again = (n: number) => ({
    ...first,
    n,
    verdicts: first.verdicts.map((v) =>
      v.verdict === "FAIL"
        ? {
            ...v,
            text: "step 2: the Growth part is summed before rounding, but the day count still uses the old plan's cycle length — `invoicing/usage-lines.ts:5`",
          }
        : v,
    ),
  })
  return [first, again(2)]
}
