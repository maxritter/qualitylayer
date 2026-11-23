// One story for the whole demo. The flagship (usage-based billing) is told at every step by several
// fixtures: the Plan writes the Done means points, Verify checks and proves them, the person reviews
// them, Cost adds up what each step spent. The facts they must agree on are written here once.

import { defaultAnswers, FAMILY_OF, type Item, KIND_LABEL } from "../../core/items.ts"

export const MIN = 60_000
export const AT = (minutes: number) => Date.now() - minutes * MIN

/** Done means as the Plan writes them: eight points; two are only the person's to confirm. */
export const PLAN_DONE: { outcome: string; how: string; onlyYou?: string }[] = [
  {
    outcome: "Every billable request counts exactly once",
    how: "Retries, replays and gateway restarts never add a second count.",
  },
  {
    outcome: "Usage shows within five minutes",
    how: "It reaches the ledger, and the limits the customer set on the Plan and limits page apply to it.",
  },
  {
    outcome: "Invoices bill tiered usage",
    how: "A plan change mid-cycle is prorated.",
  },
  {
    outcome: "Seat customers see no change",
    how: "Their invoices stay byte-identical until finance moves them.",
    onlyYou: "against finance's own totals",
  },
  {
    outcome: "History is rebuilt",
    how: "A backfill reproduces the last 90 days and matches the gateway logs to within 0.1%.",
    onlyYou: "the staging ledger comparison",
  },
  {
    outcome: "The gateway stays fast",
    how: "Metering adds less than 2 ms at p99 and never blocks a request.",
  },
  {
    outcome: "Finance controls the switch",
    how: "An account moves between seat and usage billing, and back, from the admin, at the next cycle, with an audit entry.",
  },
  {
    outcome: "Every charge is traceable",
    how: "An invoice line leads back to its usage windows and their request ids.",
  },
]

/** Done 3 is the point the first checking run failed: a plan change on day 10 billed 3 cents too much. */
export const FAILED_DONE = 3
/** The point only the person confirms in their review (the other one, finance's totals, was confirmed while the build ran). */
export const REVIEW_CONFIRM_DONE = 5
/** What finance's totals check looked like: you confirmed Done 4 against them while the build ran. */
export const CONFIRMED_EARLIER = "you confirmed finance's totals while the build ran"

/** The project's own checks, as the second checking run recorded them: no lint, a benchmark for the 2 ms budget. */
export const PROJECT_CHECKS = [
  "npm run typecheck",
  "npm test",
  "go test ./...",
  "go test ./gateway/middleware -bench Meter",
]

/** The task's own evidence is named after the checking run that saved it: run 2 was the one that passed. */
export const FINAL_RUN = 2

/** What the security review found: the change handles money, so it always ran. */
export const SECURITY_RESULT = "1 high fixed, 1 medium listed"
export const SECURITY_FINDINGS = [
  {
    severity: "high" as const,
    text: "`gateway/middleware/meter.go:5` a client-sent account id is metered: fixed, checked again",
  },
  {
    severity: "medium" as const,
    text: "`web/usage/UsagePage.tsx:5` the tier picker shows the old tier for up to a minute after a change: accepted, the page says when it was updated",
  },
]

/** The words of the empty state: the page says it, not the mockup. */
export const EMPTY_USAGE = "No requests yet this cycle."

/** What the review found about a meter with no use: the invoice and the page disagree. */
export const FOUND_EMPTY = `An invoice shows a meter with no use as "0 requests" where the Plan and limits page says "${EMPTY_USAGE.replace(/\.$/, "")}"`

export const item = (
  id: string,
  step: Item["step"],
  kind: Item["kind"],
  what: string,
  patch: Partial<Item> = {},
): Item => ({
  id,
  step,
  family: patch.family ?? FAMILY_OF[kind],
  kind,
  kindLabel: KIND_LABEL[kind],
  what,
  answers: defaultAnswers(kind),
  blocking: false,
  state: "open",
  ...patch,
})

/** The review's items as the agents wrote them, before any answer (also the ones Verify says wait for the person). */
export const REVIEW_BASE = (): Item[] => [
  item(
    `verify:confirm:done:${REVIEW_CONFIRM_DONE}`,
    "verify",
    "confirm",
    "One replayed day matches to the cent on the staging ledger",
    {
      family: "confirm",
      why: `Done ${REVIEW_CONFIRM_DONE} asks for 90 days rebuilt and one replayed day compared to the cent. The agents saved the parity report (evidence/it${FINAL_RUN}-scenario-8.txt); only you can compare the replayed day on the staging ledger.`,
      blocking: true,
    },
  ),
  item(
    "verify:result:1",
    "verify",
    "result",
    "Plan and limits page, as built: this month's use, and an invalid limit shows its error",
    {
      family: "look",
      media: {
        kind: "screenshot",
        name: `it${FINAL_RUN}-usage-1280.png`,
        proves: [{ n: 2, point: "Usage shows within five minutes" }],
        also: ["scenario 6"],
      },
    },
  ),
  item(
    "verify:found:1",
    "verify",
    "found",
    "The Plan and limits page keeps Save enabled with an empty limit",
    {
      family: "fix",
      why: "After a limit is cleared, Save should stay disabled until it holds a number.",
    },
  ),
  item("verify:found:2", "verify", "found", FOUND_EMPTY, {
    family: "fix",
    why: "`invoicing/usage-lines.ts:7` · a customer may read it as an error. A one-line change with two test strings.",
  }),
]
