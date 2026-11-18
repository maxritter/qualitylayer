// The demo's content for the Implement documents of the task ("Usage-based billing"): QualityLayer's
// summary, the slices and the decisions between markers, the limits and the program design; and the
// agents' file with the task cards and the build session's notes. The check record, raw output and the
// pictures the build saved are what the Files tab's Records row counts.

import type { CheckProgress } from "../../../core/check-progress.ts"
import type { LiveSignals } from "../../../core/live/liveness.ts"
import type { Need } from "../../../core/need/need.ts"
import { when } from "../../../core/pages/render.ts"
import type { TaskDetail } from "../../api.ts"
import { helperOf, todoOf } from "../live-rows.ts"
import type { Area } from "./area.ts"
import { cardsSections, PROGRAM_DESIGN } from "./cards.ts"
import { agentFilesThrough, TASK_AGENT_FILES, TASK_FILES } from "./documents.ts"
import type { Moment } from "./moments.ts"

/** The build began 3 h 10 min ago, today: written as the server's `when()` writes a time. */
const STARTED = when(Date.now() - 190 * 60_000)

const IMPLEMENT = `# Implement: the build as it runs

## Summary

<!-- ql:summary -->
14 of 28 tasks · 4 of 11 slices
Building now: started ${STARTED}, 3 h 10 min so far.
<!-- /ql:summary -->

## Slices

<!-- ql:slices live -->
| # | Slice | In plain words | Now |
|---|---|---|---|
| 1 | Meter one request end to end | One request is counted once, end to end. | done |
| 2 | Survive retries and broker outages | Retries and outages never change the count. | done |
| 3 | Keep metering under two milliseconds | The plan is cached and a benchmark holds the meter under 2 ms. | done |
| 4 | Bill usage tiers with proration | Usage is priced at the tier boundaries and leaves through the outbox. | done |
| 5 | Keep seat invoices unchanged | Seat accounts never take the usage path. | task 2 of 2 |
| 6 | Let customers set plans and limits | Customers set their plan and limits. | task 2 of 3 |
| 7 | Alert customers at 80 % of a limit | One alert per billing cycle at 80 % of a limit. | next |
| 8 | Move accounts at the next renewal | Finance switches an account's billing mode for the next cycle. | task 1 of 3 |
| 9 | Rebuild ninety days of history | The backfill rebuilds usage from the access logs. | next |
| 10 | Trace every invoice line to its windows | Each invoice line links to the windows it bills. | after 4 and 9 |
| 11 | Simplify the whole change | One pass removes duplicate paths across the change. | after everything else |
<!-- /ql:slices -->

## Decided while building

<!-- ql:decisions -->
- Slice 2 · A late event older than seven days goes to the correction queue instead of the live window.
- Slice 4 · Proration rounds to the cent per line, matching the seat invoices.
- Build order · Slices 2 and 9 get their steps checked first: every request passes through the meter, and the backfill rewrites history.
<!-- /ql:decisions -->

## Known limits

<!-- ql:limits -->
None.
<!-- /ql:limits -->

${PROGRAM_DESIGN}`

const IMPLEMENT_AGENTS = `# For agents: the build, slice by slice

${cardsSections()}
## Resume

Slices 1 to 4 are done. Slice 5 is at task 2 of 2, slice 6 at task 2 of 3. Next card: T16, the limits form.

## Notes

- T8 (tactical): the plan cache lives 60 seconds, so a plan change reaches every gateway within a minute; nothing you approved changes.
- T12 (tactical): retain exact amounts until the invoice line, then round to the cent as seat invoices do. The tier-boundary and seat-invoice regression tests guard this rule.

## For Verify

Open the limits form on the Plan and limits page with an account that has two meters; the alert fires once at 80 %.
`

export const IMPLEMENT_CHECKS = `# Checks

- T1 · 7d2e9b4 · \`npm test -- tests/gateway/meter.test.ts\` · exit 0 · 1.7s
- T1 · 7d2e9b4 · \`npm run lint\` · exit 0 · 8.2s
- T2 · 7d2e9b4 · \`npm test -- tests/aggregator/window.test.ts\` · exit 0 · 2.4s
- T3 · 7d2e9b4 · \`npm test -- tests/ledger/usage-entry.test.ts tests/ledger/write-once.test.ts tests/ledger/region-key.test.ts\` · exit 1 · 4.1s
- T3 · a41c9e2 · \`npm test -- tests/ledger/usage-entry.test.ts tests/ledger/write-once.test.ts tests/ledger/region-key.test.ts\` · exit 0 · 4.0s
- T4 · a41c9e2 · \`npm run test:integration -- billing --timeout 120000 --reporter=dots\` · exit 0 · 92.4s
- T1 · a41c9e2 · \`npm test -- tests/gateway/meter.test.ts\` · exit 0 · 1.6s
- slice 1 · a41c9e2 · \`npm run typecheck\` · exit 0 · 18.0s
- slice 4 · a41c9e2 · \`npm test -- tests/invoicing/proration.test.ts\` · exit 1 · 3.2s
- all · a41c9e2 · \`npm run typecheck\` · exit 0 · 18.0s
- all · a41c9e2 · \`npm run lint\` · exit 0 · 8.6s
`

/** The one thing only the person can set at `impl-need`: the build goes on with every other slice. */
const STRIPE_KEY: Need = {
  for: "T11",
  what: "A Stripe test key for the usage products",
  why: "Usage lines are sent to Stripe's test mode. The agent cannot create a key in your Stripe account.",
  kind: "secret",
  check: "stripe products list --limit 1",
  steps: [
    "In the Stripe dashboard, switch to test mode, then create a restricted key with write access to invoices.",
  ],
  place: null,
  ignored: false,
  state: "open",
  opened: Date.now() - 12 * 60_000,
  waiting: null,
  set: null,
  reopened: null,
  resolved: null,
  told: false,
}

/** The agent's signs of life at a moment: working a few seconds ago, quiet for seven minutes, or gone. */
function signalsAt(moment: Moment, now: number): LiveSignals {
  const quiet = moment === "impl-quiet"
  const gone = moment === "impl-stopped"
  const last = now - (quiet || gone ? 7 * 60_000 : 4_000)
  return {
    agent: "claude-code",
    session: "demo-session",
    sessionId: "8eb6b210-4f15-4f64-a3a0-6f1c6c5fdc01",
    hook: {
      at: last,
      event: gone ? "SessionEnd" : "PostToolUse",
      words: gone ? "" : quiet ? "running the full test suite" : "editing the limits form",
    },
    tool: null,
    transcript: last,
    cli: null,
    question: null,
    process: gone ? "gone" : "alive",
    stoppedAt: gone ? last : null,
    end: gone ? { at: last, kind: "session-end" } : null,
    // The lead's own task list (its fourth item in hand) and the helper it started: a stopped lead has
    // neither, and a lead is only quiet while no helper of it is at work.
    agents: gone || quiet ? [] : [helperOf("Explore", now)],
    ...(gone
      ? {}
      : {
          todo: todoOf(
            [
              "Show the remaining credit on the limits form",
              "Send usage lines to the invoice outbox",
              "Block the plan change while a charge is open",
              "Edit the limits form",
              "Cover the alert threshold in the form test",
              "Update the billing notes",
            ],
            3,
            now,
          ),
        }),
  }
}

/** Where the build stands, in the words the chip and Home say. */
type Progress = NonNullable<NonNullable<TaskDetail["live"]>["progress"]>
export const PROGRESS: Progress = {
  slices: 11,
  slice: { n: 6, at: 6 },
  task: { id: "T16", at: 2, of: 3 },
  done: 14,
  total: 28,
  // Three cards of slice 6 have a helper editing their files.
  underWay: 3,
  words: {
    place: "slice 6 of 11 · task 2 of 3 (T16) · 3 under way",
  },
}

/** The same build once its agent has stopped: nothing is under way. */
export const STOPPED_PROGRESS: Progress = {
  ...PROGRESS,
  underWay: 0,
  words: { place: "slice 6 of 11 · task 2 of 3 (T16)" },
}

/** The test suite at `impl-checks`: running in the background, 142 of 372 files in. */
const checksAt = (now: number): CheckProgress[] => [
  {
    check: "all",
    scope: "all",
    started: now - 11 * 60_000,
    command: "npm test",
    i: 1,
    of: 3,
    files: { done: 142, total: 372 },
    passed: 1842,
    failed: 0,
    pid: 4242,
    heartbeat: now - 2_000,
    running: true,
  },
]

/** The proration check that failed at `impl-fix`: the build session fixes it while slice 6 goes on. */
const failedAt = (now: number): CheckProgress[] => [
  {
    check: "T12",
    scope: "T12",
    started: now - 3 * 60_000,
    command: "npm test -- tests/invoicing/proration.test.ts",
    i: 1,
    of: 1,
    files: { done: 1, total: 1 },
    passed: 9,
    failed: 2,
    pid: 4243,
    heartbeat: now - 60_000,
    running: false,
    exit: 1,
    ended: now - 2 * 60_000,
  },
]

export const implement: Area = {
  documents: {
    [TASK_FILES.implement]: IMPLEMENT,
    [TASK_AGENT_FILES.implement]: IMPLEMENT_AGENTS,
  },
  patch: (task: TaskDetail, moment: Moment): TaskDetail => {
    // The Files tab's Records row starts with Implement: the raw output and the pictures saved so far.
    if (
      !["now", "impl-fix", "impl-stopped", "impl-checks", "impl-need", "impl-quiet"].includes(
        moment,
      )
    )
      return task
    const now = Date.now()
    return {
      ...task,
      records: ["it1-acceptance.txt", "checks-all.txt", "checks.md"],
      evidence: ["cp-2-run-2-retries.png"],
      // The agents' own files, Plan to Implement: the same row counts them, never lists them.
      agents: agentFilesThrough("implement"),
      live: {
        signals: signalsAt(moment, now),
        progress: moment === "impl-stopped" ? STOPPED_PROGRESS : PROGRESS,
        needs: moment === "impl-need" ? [STRIPE_KEY] : [],
        refusal: null,
        question: null,
      },
      ...(moment === "impl-checks" ? { checkProgress: checksAt(now) } : {}),
      ...(moment === "impl-fix" ? { checkProgress: failedAt(now) } : {}),
    }
  },
}
