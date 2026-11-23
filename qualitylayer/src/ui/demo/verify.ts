// The billing task's Verify step in the states the artifacts show: checking live, all passed, one
// failure being fixed, a point left open after the rounds, and the security review that ran first. The
// change handles money, so the security review runs in every state. The shapes are the server's own
// (core/checklist.ts), with illustrative data.

import type { TaskDetail } from "../../server/api.ts"
import { SECURITY_FINDINGS, SECURITY_RESULT } from "./story.ts"
import { VERIFY_STATES, type VerifyState, verifyChecklist } from "./verify-checklist.ts"
import { setVerifyMode } from "./verify-mode.ts"

export { VERIFY_STATES, type VerifyState, verifyChecklist }

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
