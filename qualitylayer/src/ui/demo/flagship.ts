import { DEMO_TASK_ID } from "./identity.ts"
// The flagship of the public Cockpit demo: usage-based billing across nine
// services. Every service, path, number and person is illustrative.
//
// Written by hand now. It started as the output of video/flagship/build.ts, which has since
// diverged (other document names), so do not regenerate it: the facts every screen shares
// (Done means, the checks, the runs, the costs) live in story.ts and are kept in step by hand.

import agents from "../../core/agents/agents.json" with { type: "json" }
import { type DocRole, NAMES, STEPS, type Step, taskFiles } from "../../core/docs/names.ts"
import { FLOW_STEPS } from "../../core/flow.ts"
import { implementPrompt } from "../../core/handoff/prompt.ts"
import type { ReviewDetail } from "../../core/review/summary.ts"
import type { CommitView, Note, Timeline, TimelineSlice } from "../../core/timeline.ts"
import type { ImplementOption, TaskDetail } from "../api.ts"
import { ME } from "./person.ts"
import { SECURITY_FINDINGS, SECURITY_RESULT } from "./story.ts"
import type { Moment } from "./task/moments.ts"
import { verifyModeField } from "./verify-mode.ts"

/** Verify's quality pass of the finished demo task: what the security review found. */
const DEMO_QUALITY: TaskDetail["quality"] = [
  {
    step: "security",
    state: "done",
    result: `done · ${SECURITY_RESULT}`,
    findings: SECURITY_FINDINGS,
  },
]

/** What the build decided on its own while it ran, as the Implement document's Deviations section tells it. */
const BUILD_DEVIATIONS =
  "- T2 (tactical): the public API marks health checks with a route tag, not a path prefix; the emitter reads the tag.\n- T6 (amended): the dedupe store keeps request ids for 24 hours in the aggregator's state store instead of Redis, so a replay never depends on a second system.\n- T8 (tactical): the emitter retries a failed send twice before it buffers; the Plan said once.\n- T8 (tactical): buffer 30 minutes on disk, not 10; the agent took the recommended way and went on."

const FLAGSHIP_PR_DESCRIPTION =
  "# Usage-based billing\n\nAPI customers are billed for what they use. A billable request is metered in the gateway, counted once in Kafka and the ledger, and billed in tiers with proration; seat customers are unchanged.\n\n## What changed\n\n- The gateway emits one meter event per billable request, keyed by its request id, and never waits on Kafka.\n- A stream job drops duplicates and closes 5-minute usage windows; the ledger writes each window once.\n- Invoices carry tiered usage lines with proration, through the existing outbox.\n- The Plan and limits page lets an owner pick a tier, set each limit and an alert threshold; finance switches billing mode in the admin.\n- A backfill rebuilt 90 days from the warehouse; the parity report is within 0.1%.\n\n## Validation\n\n- 8 end-to-end scenarios, including a retry storm, a Kafka outage and the 90-day backfill.\n- The acceptance test: a replayed day's ledger usage equals the gateway's billable count.\n- 12 golden seat invoices unchanged; gateway overhead +1.1 ms at p99.\n\nAll services, paths, checks and numbers in this demo are illustrative."

/** A slice as generated: the build state (risky, each task's state) is added per stage below. */
type PlannedSlice = Omit<TimelineSlice, "risky" | "tasks"> & {
  tasks: Omit<TimelineSlice["tasks"][number], "state">[]
}

/** The slices whose scenarios come first in the independent review: money or exactly-once counting changes there. */
const RISKY_SLICES: ReadonlySet<number> = new Set([1, 2, 3, 6])

const SLICES: PlannedSlice[] = [
  {
    n: 1,
    title: "One billable request reaches the ledger",
    summary:
      "After this slice a single billable request travels from the gateway through Kafka and the aggregator into the ledger. Nothing is billed yet; the path exists end to end.",
    validation: "automated: `npm test -- tests/billing stream/aggregator` · manual: none",
    commit: null,
    tasks: [
      {
        id: "T1",
        title: "A billable request becomes one ledger entry",
        checked: false,
        objective: "Pin the whole path in one test before any part of it exists.",
        files: [
          {
            path: "tests/billing/path.test.ts",
            mark: "+",
            note: "one request in, one ledger entry out",
          },
        ],
        testFirst: {
          kind: "test",
          text: "`tests/billing/path.test.ts` sends one request through the in-memory stack and expects one usage entry; it fails because nothing meters.",
        },
        dod: ["the test fails for the right reason: no meter event is emitted"],
        proof: "npm test -- tests/billing/path.test.ts",
        design: ["The request id is the metering key", "Meter events"],
        owner: null,
        userAction: null,
      },
      {
        id: "T2",
        title: "The gateway emits a meter event per billable request",
        checked: false,
        objective:
          "Billable requests (2xx and 4xx on the public API) emit an event keyed by the request id; 5xx and health checks emit none.",
        files: [
          {
            path: "gateway/middleware/meter.go",
            mark: "+",
            note: "emits one meter event per billable request",
          },
          {
            path: "gateway/middleware/meter_test.go",
            mark: "",
            note: "",
          },
        ],
        testFirst: {
          kind: "test",
          text: "`gateway/middleware/meter_test.go` sends a 200, a 404, a 503 and a health check and expects two events; it fails because the middleware does not exist.",
        },
        dod: ["a 2xx and a 4xx emit one event each; a 5xx and a health check emit none"],
        proof: "go test ./gateway/middleware -run Meter",
        design: [
          "The request id is the metering key",
          "Metering never blocks a request",
          "Meter events",
        ],
        owner: null,
        userAction: null,
      },
      {
        id: "T3",
        title: "Usage windows close every five minutes",
        checked: false,
        objective:
          "The aggregator counts events per account and meter and closes a window every five minutes.",
        files: [
          {
            path: "stream/aggregator/windows.ts",
            mark: "+",
            note: "closes 5-minute usage windows",
          },
          {
            path: "stream/aggregator/windows.test.ts",
            mark: "",
            note: "",
          },
        ],
        testFirst: {
          kind: "test",
          text: "`stream/aggregator/windows.test.ts` feeds 7 events across two windows and expects counts 4 and 3.",
        },
        dod: ["events land in the window of their timestamp, per account and meter"],
        proof: "npm test -- stream/aggregator",
        design: ["Usage windows"],
        owner: null,
        userAction: null,
      },
      {
        id: "T4",
        title: "The ledger stores a usage entry",
        checked: false,
        objective: "A closed window becomes one usage entry in the ledger.",
        files: [
          {
            path: "ledger/entries.ts",
            mark: "",
            note: "",
          },
          {
            path: "tests/billing/path.test.ts",
            mark: "+",
            note: "one request in, one ledger entry out",
          },
        ],
        testFirst: {
          kind: "test",
          text: "The T1 test, now expected to pass end to end.",
        },
        dod: ["one request in, one usage entry out, with its window key"],
        proof: "npm test -- tests/billing/path.test.ts",
        design: ["A usage window is written to the ledger once"],
        owner: null,
        userAction: null,
      },
    ],
  },
  {
    n: 2,
    title: "Retries, replays and a Kafka outage never change the count",
    summary:
      "After this slice the count is exactly once under every failure the artifact names, and the gateway stays under its latency budget. This is the promise everything else depends on.",
    validation:
      "automated: `npm test -- tests/billing` · `go test ./gateway/middleware` · manual: none",
    commit: null,
    tasks: [
      {
        id: "T5",
        title: "A retry storm counts once",
        checked: false,
        objective:
          "Pin exactly-once before building it: the same request id, sent five times, counts one.",
        files: [
          {
            path: "tests/billing/exactly-once.test.ts",
            mark: "",
            note: "",
          },
        ],
        testFirst: {
          kind: "test",
          text: "`tests/billing/exactly-once.test.ts` replays one request id five times and one window twice; it fails with a count of five.",
        },
        dod: ["the test fails for the right reason: duplicates are counted"],
        proof: "npm test -- tests/billing/exactly-once.test.ts",
        design: [
          "The request id is the metering key",
          "A usage window is written to the ledger once",
        ],
        owner: null,
        userAction: null,
      },
      {
        id: "T6",
        title: "Duplicate events are dropped by request id",
        checked: false,
        objective: "The aggregator remembers request ids for 24 hours and drops repeats.",
        files: [
          {
            path: "stream/aggregator/dedupe.ts",
            mark: "+",
            note: "drops request ids seen in the last 24 hours",
          },
          {
            path: "stream/aggregator/dedupe.test.ts",
            mark: "",
            note: "",
          },
        ],
        testFirst: {
          kind: "test",
          text: "`stream/aggregator/dedupe.test.ts` sends one id twice an hour apart and expects one count.",
        },
        dod: ["a repeated id within 24 hours is dropped and counted in a metric"],
        proof: "npm test -- stream/aggregator/dedupe.test.ts",
        design: ["The request id is the metering key", "Usage windows"],
        owner: null,
        userAction: null,
      },
      {
        id: "T7",
        title: "A window is written to the ledger once",
        checked: false,
        objective:
          "Usage windows go through the ledger's write-once path, keyed by account, meter and window start.",
        files: [
          {
            path: "ledger/write.ts",
            mark: "",
            note: "",
          },
          {
            path: "tests/billing/exactly-once.test.ts",
            mark: "",
            note: "",
          },
        ],
        testFirst: {
          kind: "test",
          text: "The T5 test's replayed window, now expected to leave one entry.",
        },
        dod: ["a replayed window returns the existing entry and writes nothing"],
        proof: "npm test -- tests/billing/exactly-once.test.ts",
        design: ["A usage window is written to the ledger once"],
        owner: null,
        userAction: null,
      },
      {
        id: "T8",
        title: "A Kafka outage never blocks a request",
        checked: false,
        objective:
          "When Kafka is down the emitter spills to disk for up to 30 minutes, then sheds events and alerts.",
        files: [
          {
            path: "gateway/middleware/buffer.go",
            mark: "+",
            note: "spills to disk when Kafka is down",
          },
          {
            path: "gateway/middleware/buffer_test.go",
            mark: "",
            note: "",
          },
        ],
        testFirst: {
          kind: "test",
          text: "`gateway/middleware/buffer_test.go` stops the fake broker, sends 1,000 requests and expects 1,000 responses and a full buffer.",
        },
        dod: [
          "requests succeed while Kafka is down; buffered events arrive after it returns",
          "after 30 minutes events are shed and the `meter_shed` alert fires",
        ],
        proof: "go test ./gateway/middleware -run Buffer",
        design: ["Metering never blocks a request"],
        owner: null,
        userAction: null,
      },
      {
        id: "T9",
        title: "Metering stays under 2 ms at p99",
        checked: false,
        objective: "A benchmark guards the latency budget.",
        files: [
          {
            path: "gateway/middleware/meter_bench_test.go",
            mark: "",
            note: "",
          },
        ],
        testFirst: {
          kind: "test",
          text: "`gateway/middleware/meter_bench_test.go` measures the middleware's overhead over 100,000 requests and fails above 2 ms at p99.",
        },
        dod: ["p99 overhead under 2 ms on the CI runner"],
        proof: "go test ./gateway/middleware -bench Meter",
        design: ["Metering never blocks a request"],
        owner: null,
        userAction: null,
      },
    ],
  },
  {
    n: 3,
    title: "Invoices bill tiered usage, with proration",
    summary:
      "After this slice an invoice carries tiered usage lines, prorated across a mid-cycle plan change, and goes to Stripe through the outbox. Seat invoices do not change by a byte.",
    validation:
      "automated: `npm test -- tests/invoicing` · manual: check the prorated numbers in the dark invoice",
    commit: null,
    tasks: [
      {
        id: "T10",
        title: "Tier boundaries price usage correctly",
        checked: false,
        objective: "Pin the tier arithmetic at its boundaries before writing it.",
        files: [
          {
            path: "tests/invoicing/tiers.test.ts",
            mark: "+",
            note: "boundaries, proration, seat golden files",
          },
        ],
        testFirst: {
          kind: "test",
          text: "`tests/invoicing/tiers.test.ts` prices 9,999, 10,000, 10,001 and 1,000,001 requests against a three-tier plan; it fails because nothing prices usage.",
        },
        dod: ["the test fails for the right reason: no usage pricing exists"],
        proof: "npm test -- tests/invoicing/tiers.test.ts",
        design: ["Tiered pricing and proration"],
        owner: null,
        userAction: null,
      },
      {
        id: "T11",
        title: "Usage lines reach Stripe through the outbox",
        checked: false,
        objective:
          "The invoice gets one line per tier used; the outbox pushes them with the invoice.",
        files: [
          {
            path: "invoicing/usage-lines.ts",
            mark: "+",
            note: "tiered lines from ledger entries",
          },
          {
            path: "invoicing/outbox/push.ts",
            mark: "",
            note: "",
          },
          {
            path: "tests/invoicing/tiers.test.ts",
            mark: "+",
            note: "boundaries, proration, seat golden files",
          },
        ],
        testFirst: {
          kind: "test",
          text: "`tests/invoicing/tiers.test.ts`: an invoice for 1,000,001 requests has three usage lines in the outbox.",
        },
        dod: ["usage lines are created with the invoice and pushed only by the outbox"],
        proof: "npm test -- tests/invoicing",
        design: ["Usage invoices go through the outbox", "Tiered pricing and proration"],
        owner: null,
        userAction: null,
      },
      {
        id: "T12",
        title: "A mid-cycle plan change is prorated",
        checked: false,
        objective:
          "Proration splits the cycle at the change and prices each part by its plan, for tiers as for seats.",
        files: [
          {
            path: "billing/proration.ts",
            mark: "",
            note: "",
          },
          {
            path: "tests/invoicing/tiers.test.ts",
            mark: "+",
            note: "boundaries, proration, seat golden files",
          },
        ],
        testFirst: {
          kind: "test",
          text: "`tests/invoicing/tiers.test.ts`: a change on day 10 of 30 bills a third at the old plan and two thirds at the new.",
        },
        dod: ["both parts of a split cycle are priced by their own plan"],
        proof: "npm test -- tests/invoicing/tiers.test.ts",
        design: ["Tiered pricing and proration"],
        owner: null,
        userAction: null,
      },
      {
        id: "T13",
        title: "Seat invoices stay byte-identical",
        checked: false,
        objective: "Golden files guard every seat invoice shape.",
        files: [
          {
            path: "tests/invoicing/seat-golden.test.ts",
            mark: "",
            note: "",
          },
        ],
        testFirst: {
          kind: "test",
          text: "`tests/invoicing/seat-golden.test.ts` renders 12 recorded seat invoices and compares them byte for byte.",
        },
        dod: ["all 12 golden seat invoices are unchanged"],
        proof: "npm test -- tests/invoicing/seat-golden.test.ts",
        design: ["Tiered pricing and proration"],
        owner: null,
        userAction: null,
      },
    ],
  },
  {
    n: 4,
    title: "Customers set their plan and limits",
    summary:
      "After this slice the Plan and limits page lets an account owner pick a tier, set a limit for each meter and save them, with an alert at 80 %.",
    validation:
      "automated: `npm test -- api/usage web/usage` · manual: open the Plan and limits page for the test account",
    commit: null,
    tasks: [
      {
        id: "T14",
        title: "The usage API returns use per meter and plan limit",
        checked: false,
        objective: "One account's usage for a range, read from the ledger.",
        files: [
          {
            path: "api/usage/route.ts",
            mark: "+",
            note: "use per meter and plan limit for one account",
          },
          {
            path: "api/usage/route.test.ts",
            mark: "",
            note: "",
          },
        ],
        testFirst: {
          kind: "test",
          text: "`api/usage/route.test.ts` asks for 30 days and expects 30 rows that add up to the ledger's total.",
        },
        dod: ["the rows add up to the ledger's total for the range"],
        proof: "npm test -- api/usage",
        design: ["Usage windows"],
        owner: null,
        userAction: null,
      },
      {
        id: "T15",
        title: "The Plan and limits page saves the limits",
        checked: false,
        objective:
          "A table of meters (API calls, seats, storage) with this month's use against the plan's limit, the plan tier picker and an alert-at-80 % control, plus empty, loading and error states.",
        files: [
          {
            path: "web/usage/UsagePage.tsx",
            mark: "+",
            note: "meters table, tier picker, alert, empty and loading states",
          },
          {
            path: "web/usage/UsagePage.test.tsx",
            mark: "",
            note: "",
          },
        ],
        testFirst: {
          kind: "test",
          text: "`web/usage/UsagePage.test.tsx` renders three meters and expects the current tier, a mark on a meter at or above 80 %, and the empty state for a new account.",
        },
        dod: [
          "the current tier is named; a meter at or above 80 % is marked; a new account sees the empty state",
        ],
        proof: "npm test -- web/usage",
        design: ["Usage windows", "Tiered pricing and proration"],
        owner: "User",
        userAction:
          "Look at the Plan and limits page in the dark theme and say whether the error under an invalid limit reads well.",
      },
      {
        id: "T16",
        title: "The page alerts at 80 % of a limit",
        checked: false,
        objective: "The alert uses the same plan limits as invoicing.",
        files: [
          {
            path: "web/usage/alert.ts",
            mark: "",
            note: "",
          },
          {
            path: "web/usage/UsagePage.test.tsx",
            mark: "",
            note: "",
          },
        ],
        testFirst: {
          kind: "test",
          text: "`web/usage/UsagePage.test.tsx`: the alert fires once when a meter first reaches 80 % of the plan limit the invoice uses.",
        },
        dod: ["one alert at 80 %, none below it, none repeated in the same cycle"],
        proof: "npm test -- web/usage",
        design: ["Tiered pricing and proration"],
        owner: null,
        userAction: null,
      },
    ],
  },
  {
    n: 5,
    title: "Finance moves an account between seat and usage billing",
    summary:
      "After this slice finance switches an account in the admin, effective at the next cycle, with a reason and an audit entry, and can switch it back.",
    validation:
      "automated: `npm test -- billing admin/accounts` · manual: switch the test account and back",
    commit: null,
    tasks: [
      {
        id: "T17",
        title: "A billing mode changes at the next cycle",
        checked: false,
        objective: "A switch records the mode with the next cycle's start as its effective date.",
        files: [
          {
            path: "billing/modes.ts",
            mark: "+",
            note: "billing mode with an effective date",
          },
          {
            path: "billing/modes.test.ts",
            mark: "",
            note: "",
          },
        ],
        testFirst: {
          kind: "test",
          text: "`billing/modes.test.ts` switches on day 12 and expects the current cycle to stay on seats.",
        },
        dod: ["the current cycle never changes mode; the next one does"],
        proof: "npm test -- billing/modes.test.ts",
        design: ["Billing mode changes at the next cycle"],
        owner: null,
        userAction: null,
      },
      {
        id: "T18",
        title: "The plan editor previews both invoices",
        checked: false,
        objective: "Finance sees the seat and usage invoice side by side before switching.",
        files: [
          {
            path: "admin/accounts/PlanEditor.tsx",
            mark: "+",
            note: "switch, reason, side-by-side preview",
          },
          {
            path: "admin/accounts/PlanEditor.test.tsx",
            mark: "",
            note: "",
          },
        ],
        testFirst: {
          kind: "test",
          text: "`admin/accounts/PlanEditor.test.tsx` expects both totals and a disabled Switch until a reason is typed.",
        },
        dod: ["Switch stays disabled without a reason"],
        proof: "npm test -- admin/accounts",
        design: ["Billing mode changes at the next cycle", "Tiered pricing and proration"],
        owner: null,
        userAction: null,
      },
      {
        id: "T19",
        title: "Every switch leaves an audit entry",
        checked: false,
        objective: "Who, when, from which mode to which, and why.",
        files: [
          {
            path: "billing/modes.ts",
            mark: "+",
            note: "billing mode with an effective date",
          },
          {
            path: "billing/modes.test.ts",
            mark: "",
            note: "",
          },
        ],
        testFirst: {
          kind: "test",
          text: "`billing/modes.test.ts`: a switch and a switch back leave two audit entries with reasons.",
        },
        dod: ["both switches are in the audit log with their reasons"],
        proof: "npm test -- billing/modes.test.ts",
        design: ["Billing mode changes at the next cycle"],
        owner: null,
        userAction: null,
      },
    ],
  },
  {
    n: 6,
    title: "The backfill rebuilds 90 days and matches the logs",
    summary:
      "After this slice the last 90 days of usage are rebuilt from the warehouse through the same ledger path, dark invoices sit next to the real ones, and a parity report compares both with the gateway logs.",
    validation: "automated: `npm test -- jobs/backfill` · manual: read the parity report",
    commit: null,
    tasks: [
      {
        id: "T20",
        title: "The backfill rebuilds windows from the access logs",
        checked: false,
        objective:
          "Read the chosen window from the warehouse, join on the API key hash and write windows through the ledger's write-once path.",
        files: [
          {
            path: "jobs/backfill/usage.ts",
            mark: "+",
            note: "windows from the warehouse access logs",
          },
          {
            path: "jobs/backfill/usage.test.ts",
            mark: "",
            note: "",
          },
        ],
        testFirst: {
          kind: "test",
          text: "`jobs/backfill/usage.test.ts` backfills a recorded day twice and expects one set of entries.",
        },
        dod: ["a second run writes nothing new"],
        proof: "npm test -- jobs/backfill",
        design: ["Backfill parity", "A usage window is written to the ledger once"],
        owner: null,
        userAction: null,
      },
      {
        id: "T21",
        title: "Dark invoices sit next to the real ones",
        checked: false,
        objective: "Usage invoices for the backfilled period, marked dark, never pushed to Stripe.",
        files: [
          {
            path: "jobs/backfill/usage.ts",
            mark: "+",
            note: "windows from the warehouse access logs",
          },
          {
            path: "jobs/backfill/usage.test.ts",
            mark: "",
            note: "",
          },
        ],
        testFirst: {
          kind: "test",
          text: "`jobs/backfill/usage.test.ts` expects dark invoices and an empty outbox.",
        },
        dod: ["no dark invoice reaches the outbox"],
        proof: "npm test -- jobs/backfill",
        design: ["Usage invoices go through the outbox"],
        owner: null,
        userAction: null,
      },
      {
        id: "T22",
        title: "The parity report is within 0.1%",
        checked: false,
        objective: "Compare backfilled counts with the gateway logs per account and day.",
        files: [
          {
            path: "jobs/backfill/parity.ts",
            mark: "+",
            note: "counts against the gateway logs, per account and day",
          },
          {
            path: "jobs/backfill/parity.test.ts",
            mark: "",
            note: "",
          },
        ],
        testFirst: {
          kind: "test",
          text: "`jobs/backfill/parity.test.ts` feeds a known gap of 0.2% and expects the report to fail that day.",
        },
        dod: ["every account and day within 0.1%, or named in the report"],
        proof: "npm test -- jobs/backfill/parity.test.ts",
        design: ["Backfill parity"],
        owner: null,
        userAction: null,
      },
    ],
  },
  {
    n: 7,
    title: "The whole change is simpler, with the same behaviour",
    summary:
      "After this slice another agent has read the whole change and simplified it: near-copies merged, existing code reused, what is not needed removed. Every test and scenario still passes.",
    validation: "automated: `npm test` · manual: none",
    commit: null,
    tasks: [
      {
        id: "T23",
        title: "Simplify the whole change",
        checked: false,
        objective:
          "Merge the near-copies the slices left behind and reuse existing helpers; behaviour stays the same.",
        files: [
          {
            path: "stream/aggregator/windows.ts",
            mark: "",
            note: "",
          },
          {
            path: "invoicing/usage-lines.ts",
            mark: "",
            note: "",
          },
        ],
        testFirst: {
          kind: "trivial",
          text: "`npm test` and every scenario below prove the behaviour did not change.",
        },
        dod: ["fewer lines than before the pass, every test and scenario green"],
        proof: "npm test",
        design: ["Usage windows", "Tiered pricing and proration"],
        owner: null,
        userAction: null,
      },
    ],
  },
]

const COLUMNS: Timeline["columns"] = [
  [{ n: 1, after: null }],
  [{ n: 2, after: null }],
  [
    { n: 3, after: null },
    { n: 6, after: 3 },
    { n: 4, after: null },
    { n: 5, after: null },
  ],
  [{ n: 7, after: null }],
]

const PREREQUISITES: Timeline["prerequisites"] = [
  {
    n: "P1",
    what: "A Stripe test key for the usage products",
    metBy: "the build, reading `.env.stripe-test`",
    status: "permission granted",
    settled: true,
  },
  {
    n: "P2",
    what: "The backfill window",
    metBy: "you, now",
    status: "met: 2 July to 29 September",
    settled: true,
  },
  {
    n: "P3",
    what: "The warehouse answers a read of the access logs",
    metBy: "the agent",
    status: "met · [evidence/p3-warehouse-read.txt](evidence/p3-warehouse-read.txt)",
    settled: true,
  },
  {
    n: "P4",
    what: "Kafka accepts a test event on `meter.events`",
    metBy: "the agent",
    status: "met · [evidence/p4-kafka-test-event.txt](evidence/p4-kafka-test-event.txt)",
    settled: true,
  },
]

const CONTRACTS: Timeline["contracts"] = [
  {
    name: "The request id is the metering key",
    section: "System design",
    tasks: ["T1", "T2", "T5", "T6"],
  },
  {
    name: "Metering never blocks a request",
    section: "System design",
    tasks: ["T2", "T8", "T9"],
  },
  {
    name: "A usage window is written to the ledger once",
    section: "System design",
    tasks: ["T4", "T5", "T7", "T20"],
  },
  {
    name: "Usage invoices go through the outbox",
    section: "System design",
    tasks: ["T11", "T21"],
  },
  {
    name: "Billing mode changes at the next cycle",
    section: "System design",
    tasks: ["T17", "T18", "T19"],
  },
  {
    name: "Meter events",
    section: "Program design",
    tasks: ["T1", "T2"],
  },
  {
    name: "Usage windows",
    section: "Program design",
    tasks: ["T3", "T6", "T14", "T15", "T23"],
  },
  {
    name: "Tiered pricing and proration",
    section: "Program design",
    tasks: ["T10", "T11", "T12", "T13", "T15", "T16", "T18", "T23"],
  },
  {
    name: "Backfill parity",
    section: "Program design",
    tasks: ["T20", "T22"],
  },
]

const FILES: { path: string; slice: number; mark: string }[] = [
  {
    path: "tests/billing/path.test.ts",
    slice: 1,
    mark: "+",
  },
  {
    path: "gateway/middleware/meter.go",
    slice: 1,
    mark: "+",
  },
  {
    path: "gateway/middleware/meter_test.go",
    slice: 1,
    mark: "+",
  },
  {
    path: "stream/aggregator/windows.ts",
    slice: 1,
    mark: "+",
  },
  {
    path: "stream/aggregator/windows.test.ts",
    slice: 1,
    mark: "+",
  },
  {
    path: "ledger/entries.ts",
    slice: 1,
    mark: "~",
  },
  {
    path: "tests/billing/exactly-once.test.ts",
    slice: 2,
    mark: "+",
  },
  {
    path: "stream/aggregator/dedupe.ts",
    slice: 2,
    mark: "+",
  },
  {
    path: "stream/aggregator/dedupe.test.ts",
    slice: 2,
    mark: "+",
  },
  {
    path: "ledger/write.ts",
    slice: 2,
    mark: "~",
  },
  {
    path: "gateway/middleware/buffer.go",
    slice: 2,
    mark: "+",
  },
  {
    path: "gateway/middleware/buffer_test.go",
    slice: 2,
    mark: "+",
  },
  {
    path: "gateway/middleware/meter_bench_test.go",
    slice: 2,
    mark: "+",
  },
  {
    path: "tests/invoicing/tiers.test.ts",
    slice: 3,
    mark: "+",
  },
  {
    path: "invoicing/usage-lines.ts",
    slice: 3,
    mark: "+",
  },
  {
    path: "invoicing/outbox/push.ts",
    slice: 3,
    mark: "~",
  },
  {
    path: "billing/proration.ts",
    slice: 3,
    mark: "~",
  },
  {
    path: "tests/invoicing/seat-golden.test.ts",
    slice: 3,
    mark: "+",
  },
  {
    path: "api/usage/route.ts",
    slice: 4,
    mark: "+",
  },
  {
    path: "api/usage/route.test.ts",
    slice: 4,
    mark: "+",
  },
  {
    path: "web/usage/UsagePage.tsx",
    slice: 4,
    mark: "+",
  },
  {
    path: "web/usage/UsagePage.test.tsx",
    slice: 4,
    mark: "+",
  },
  {
    path: "web/usage/alert.ts",
    slice: 4,
    mark: "~",
  },
  {
    path: "billing/modes.ts",
    slice: 5,
    mark: "+",
  },
  {
    path: "billing/modes.test.ts",
    slice: 5,
    mark: "+",
  },
  {
    path: "admin/accounts/PlanEditor.tsx",
    slice: 5,
    mark: "+",
  },
  {
    path: "admin/accounts/PlanEditor.test.tsx",
    slice: 5,
    mark: "+",
  },
  {
    path: "jobs/backfill/usage.ts",
    slice: 6,
    mark: "+",
  },
  {
    path: "jobs/backfill/usage.test.ts",
    slice: 6,
    mark: "+",
  },
  {
    path: "jobs/backfill/parity.ts",
    slice: 6,
    mark: "+",
  },
  {
    path: "jobs/backfill/parity.test.ts",
    slice: 6,
    mark: "+",
  },
]

/**
 * Where the tour shows the flagship: the Plan up for approval, Implement running, Verify's judge at
 * work (`verify-checking`), or the finished change waiting for the person's review (`verify`).
 */
export type FlagshipStage = "plan" | "implement" | "verify-checking" | "verify"

export const FLAGSHIP_STAGES: readonly FlagshipStage[] = [
  "plan",
  "implement",
  "verify-checking",
  "verify",
]

/** The moment of the demo task each tour stage stands for (`task/moments.ts`). */
export const FLAGSHIP_MOMENT: Record<FlagshipStage, Moment> = {
  plan: "plan-approve",
  implement: "now",
  "verify-checking": "verify-checking",
  verify: "verify",
}

const MIN = 60_000
const HOUR = 60 * MIN
const ago = (minutes: number) => Date.now() - minutes * MIN

// ---------------------------------------------------------------- mockups

const palette = () => {
  const dark =
    typeof document !== "undefined" &&
    getComputedStyle(document.documentElement).colorScheme === "dark"
  return {
    dark,
    css: dark
      ? "--bg:#0a0a0a;--panel:#141414;--ink:#ededed;--muted:#a1a1a1;--line:#2e2e2e;--blue:#5da3e5;--amber:#f7b23b;--green:#3ecf8e;--danger:#f07178"
      : "--bg:#fff;--panel:#fafafa;--ink:#171717;--muted:#4d4d4d;--line:#e6e6e6;--blue:#2076c5;--amber:#9d6607;--green:#0f7b4f;--danger:#c42b31",
  }
}

const SHELL =
  "*{box-sizing:border-box}body{margin:0;padding:18px;background:var(--bg);color:var(--ink);font:13px/1.5 system-ui,sans-serif}" +
  "header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}" +
  "h1{margin:0;font-size:14px}h1 small{display:block;color:var(--muted);font-size:12px;font-weight:400}" +
  ".modes{display:flex;gap:4px}button{min-height:34px;cursor:pointer;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);padding:4px 10px;font:inherit}" +
  "button[aria-pressed=true]{color:var(--blue);background:var(--panel)}:focus-visible{outline:2px solid var(--blue);outline-offset:3px}" +
  ".loading{padding:30px;color:var(--muted)}.error{padding:14px;border:1px solid var(--amber);color:var(--amber);border-radius:6px}"

const HEIGHT =
  "function height(){parent.postMessage({type:'qualitylayer:height',height:document.body.scrollHeight},'*')}height();new ResizeObserver(height).observe(document.body);" +
  "document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-mode]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));['default','loading','error'].forEach(id=>{const e=document.getElementById(id);if(e)e.hidden=id!==b.dataset.mode});height()});"

/** The account's "Plan and limits" settings: a tier picker, a limit per meter, an alert threshold, Save and Cancel. Try the states. */
export function planLimits(): string {
  const { dark, css } = palette()
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>:root{${css};color-scheme:${dark ? "dark" : "light"}}${SHELL}
  .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:12px 0}.seg{display:flex;border:1px solid var(--line);border-radius:6px;overflow:hidden}.seg button{border:0;border-radius:0}
  .note{color:var(--muted);font-size:12px}.fields{display:grid;grid-template-columns:minmax(0,1fr) 160px;gap:8px 12px;align-items:center;margin:12px 0}.fields label{font-weight:500}
  input,select{min-height:34px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);padding:4px 8px;font:inherit;width:100%}input[aria-invalid=true]{border-color:var(--danger)}
  .msg{grid-column:2;color:var(--danger);font-size:12px;min-height:0}.primary{background:var(--blue);border-color:var(--blue);color:var(--bg)}.primary:disabled{opacity:.45;cursor:default}
  label.sw{display:inline-flex;gap:8px;align-items:center;cursor:pointer}
  </style></head><body><header><h1>Plan and limits<small>acme/platform · Settings › Billing</small></h1><div class="modes"><button data-mode="default" aria-pressed="true">Form</button><button data-mode="loading" aria-pressed="false">Loading</button><button data-mode="error" aria-pressed="false">Error</button></div></header>
  <main id="default"><div class="row"><b>Plan</b><div class="seg" role="radiogroup" aria-label="Plan tier"><button data-tier aria-pressed="false">Starter</button><button data-tier aria-pressed="true">Growth</button><button data-tier aria-pressed="false">Scale</button></div><span class="note" id="tiernote">Growth applies from 1 November, the next cycle.</span></div>
  <div class="fields"><label for="calls">API calls per month</label><input id="calls" inputmode="numeric" value="1000000"><span class="msg" id="callsmsg" hidden>Enter a whole number, at least 1.</span>
  <label for="seats">Seats</label><input id="seats" inputmode="numeric" value="15"><span class="msg" id="seatsmsg" hidden>Enter a whole number, at least 1.</span>
  <label for="storage">Storage in GB</label><input id="storage" inputmode="numeric" value="250"><span class="msg" id="storagemsg" hidden>Enter a whole number, at least 1.</span></div>
  <div class="row"><label class="sw"><input type="checkbox" id="alert" checked style="width:auto;min-height:0"> Alert me at</label><select id="at" aria-label="Alert threshold" style="width:auto"><option>70 %</option><option selected>80 %</option><option>90 %</option></select><span class="note">of any limit, by e-mail to billing@acme.test.</span></div>
  <div class="row"><button id="save" class="primary">Save limits</button><button id="cancel">Cancel</button><span class="note" id="saved" hidden>Saved. New limits apply within five minutes.</span></div></main>
  <p id="loading" class="loading" hidden>Loading your plan…</p><p id="error" class="error" hidden>Your plan could not be loaded. Nothing was changed; try again in a minute.</p>
  <script>${HEIGHT}document.querySelectorAll('[data-tier]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tier]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));document.getElementById('tiernote').textContent=b.textContent+' applies from 1 November, the next cycle.';height()});
  const ids=['calls','seats','storage'],save=document.getElementById('save');function check(){let ok=true;ids.forEach(id=>{const v=document.getElementById(id),bad=!/^[1-9][0-9]*$/.test(v.value.trim());v.setAttribute('aria-invalid',String(bad));document.getElementById(id+'msg').hidden=!bad;if(bad)ok=false});save.disabled=!ok;document.getElementById('saved').hidden=true;height()}ids.forEach(id=>document.getElementById(id).oninput=check);save.onclick=()=>{document.getElementById('saved').hidden=false;height()};document.getElementById('cancel').onclick=()=>{ids.forEach((id,i)=>document.getElementById(id).value=['1000000','15','250'][i]);check()};</script></body></html>`
}

/**
 * Account 42's requests per day in October 2026 (1 October was a Thursday): busy weekdays, quiet weekends,
 * growing through the month, adding up to the 138,320 requests both invoices are priced at.
 */
export const OCTOBER_REQUESTS = (() => {
  const TOTAL = 138_320
  const raw = Array.from({ length: 31 }, (_, i) => {
    const day = (4 + i) % 7
    const base = day === 0 || day === 6 ? 1900 : 4700
    return (base + (((i * 37) % 11) - 5) * 60) * (1 + i * 0.012)
  })
  const sum = raw.reduce((a, b) => a + b, 0)
  const days = raw.map((v) => Math.round((v * TOTAL) / sum))
  days[30] = (days[30] ?? 0) + TOTAL - days.reduce((a, b) => a + b, 0)
  return days
})()

export const OCTOBER_AVERAGE = Math.round(138_320 / 31)

/** October's requests as bars, with the gridlines and the daily average drawn over them. */
function octoberChart(): string {
  const top = Math.ceil(Math.max(...OCTOBER_REQUESTS) / 2000) * 2000
  const pct = (n: number) => ((n / top) * 100).toFixed(1)
  const steps = Array.from({ length: top / 2000 + 1 }, (_, i) => i * 2000)
  const bars = OCTOBER_REQUESTS.map((n, i) => {
    const day = (4 + i) % 7
    const weekend = day === 0 || day === 6
    return `<i${weekend ? ' class="we"' : ""} style="height:${pct(n)}%" title="${i + 1} October · ${n.toLocaleString("en-US")} requests"></i>`
  }).join("")
  return `<div class="chart"><div class="axis">${steps.map((s) => `<span style="bottom:${pct(s)}%">${s === 0 ? "0" : `${s / 1000}k`}</span>`).join("")}</div>
  <div class="plot">${steps
    .slice(1)
    .map((s) => `<b style="bottom:${pct(s)}%"></b>`)
    .join("")}<div class="bars">${bars}</div><em style="bottom:${pct(OCTOBER_AVERAGE)}%"></em></div>
  <div class="x"><span>1 Oct</span><span>8</span><span>15</span><span>22</span><span>31 Oct</span></div></div>`
}

/**
 * Finance's page for one account: what it used in October, what November costs on seats and on usage, the
 * switch with its reason, and the audit log. Default, Loading and Error are there to review.
 */
function billingMode(): string {
  const { dark, css } = palette()
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>:root{${css};color-scheme:${dark ? "dark" : "light"}}${SHELL}
  body{padding:0}.top{display:flex;align-items:center;gap:20px;height:48px;padding:0 24px;border-bottom:1px solid var(--line);background:var(--panel)}
  .brand{display:flex;align-items:center;gap:8px;font-weight:600}.brand i{width:18px;height:18px;border-radius:5px;background:linear-gradient(135deg,var(--blue),var(--green))}
  .top nav{display:flex;gap:2px}.top nav a{padding:5px 10px;border-radius:6px;color:var(--muted);text-decoration:none}.top nav a[aria-current]{color:var(--ink);background:var(--bg);box-shadow:inset 0 0 0 1px var(--line)}
  .me{margin-left:auto;display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px}
  .av{display:inline-grid;place-items:center;flex:none;width:28px;height:28px;border-radius:50%;background:color-mix(in srgb,var(--blue) 24%,var(--panel));color:var(--ink);font-size:11px;font-weight:600}
  .av.g{background:color-mix(in srgb,var(--green) 24%,var(--panel))}.av.a{background:color-mix(in srgb,var(--amber) 26%,var(--panel))}
  .wrap{padding:20px 24px 24px}header{margin-bottom:18px}h1{display:flex;align-items:center;gap:12px;font-size:20px;letter-spacing:-.01em}h1 small{margin-top:2px}
  .acct{display:grid;place-items:center;width:42px;height:42px;border-radius:10px;background:color-mix(in srgb,var(--blue) 18%,var(--panel));border:1px solid var(--line);color:var(--ink);font-size:14px}
  .card{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:16px 18px}
  .kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}.kpi .k{color:var(--muted);font-size:12px}
  .kpi .v{margin-top:2px;font-size:24px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}.kpi .d{margin-top:2px;color:var(--muted);font-size:12px}
  .up{color:var(--green)}.cols{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(300px,1fr);gap:14px;align-items:start}.stack{display:grid;gap:14px;min-width:0}
  h2{margin:0;font-size:14px;font-weight:600}.head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:14px}.head span{color:var(--muted);font-size:12px}
  .chart{display:grid;grid-template-columns:28px minmax(0,1fr);column-gap:8px}.axis{position:relative;height:180px;color:var(--muted);font-size:11px}.axis span{position:absolute;right:0;transform:translateY(50%)}
  .plot{position:relative;height:180px;border-bottom:1px solid var(--line)}.plot b{position:absolute;left:0;right:0;border-top:1px dashed var(--line)}
  .bars{position:absolute;inset:0;display:flex;align-items:flex-end;gap:3px}.bars i{flex:1;border-radius:3px 3px 0 0;background:var(--blue)}.bars i.we{opacity:.38}.bars i:hover{filter:brightness(1.2)}
  .plot em{position:absolute;left:0;right:0;border-top:2px dashed var(--amber);font-style:normal}
  .key{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px}.key i{width:10px;height:10px;margin-left:8px;border-radius:2px;background:var(--blue)}.key i.we{opacity:.38}.key i.avg{width:14px;height:0;border-radius:0;background:none;border-top:2px dashed var(--amber)}
  .x{grid-column:2;display:flex;justify-content:space-between;margin-top:6px;color:var(--muted);font-size:11px}
  .both{display:grid;grid-template-columns:1fr 1fr;gap:12px}.way{border:1px solid var(--line);border-radius:8px;background:var(--bg);padding:12px 14px}.way.pick{border-color:var(--blue);box-shadow:0 0 0 1px var(--blue)}
  .wh{display:flex;justify-content:space-between;align-items:center}.pill{padding:1px 8px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:11px}.pick .pill{border-color:var(--blue);color:var(--blue)}
  .amt{margin:6px 0 8px;font-size:22px;font-weight:600;font-variant-numeric:tabular-nums}.meter{height:6px;border-radius:3px;background:var(--line);margin-bottom:10px}.meter i{display:block;height:100%;border-radius:3px;background:var(--muted)}.pick .meter i{background:var(--blue)}
  .line{display:flex;justify-content:space-between;gap:12px;padding:2px 0;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}.delta{margin:12px 0 0;color:var(--muted);font-size:12px}
  .seg{display:flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}.seg button{flex:1;border:0;border-radius:0;min-height:36px;background:var(--bg)}.seg button[aria-pressed=true]{color:var(--ink);background:color-mix(in srgb,var(--blue) 16%,var(--bg))}
  .when{list-style:none;margin:14px 0;padding:0 0 0 14px;border-left:2px solid var(--line);display:grid;gap:10px}.when li{position:relative;font-size:12px;color:var(--muted)}.when b{display:block;color:var(--ink);font-size:13px}
  .when li::before{content:"";position:absolute;left:-20px;top:4px;width:10px;height:10px;border-radius:50%;background:var(--line)}.when li.next::before{background:var(--blue)}
  .fl{display:block;margin-bottom:6px;font-size:12px;font-weight:500}input{width:100%;min-height:36px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);padding:6px 10px;font:inherit}
  .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px}.primary{background:var(--blue);border-color:var(--blue);color:var(--bg);font-weight:600}.primary:disabled{opacity:.45;cursor:default}.note{color:var(--muted);font-size:12px}
  .last{display:flex;gap:10px;align-items:center;margin-top:14px;padding:10px 12px;border-radius:8px;background:color-mix(in srgb,var(--green) 12%,var(--bg));border:1px solid color-mix(in srgb,var(--green) 40%,var(--line));font-size:12px}.last b{color:var(--ink)}
  .log{list-style:none;margin:0;padding:0;display:grid;gap:12px}.log li{display:flex;gap:10px;align-items:flex-start}.log p{margin:0;font-size:13px}.log p span{color:var(--muted)}.log small{color:var(--muted);font-size:12px}
  .skel{display:grid;gap:14px}.skel div{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.skel i{display:block;height:88px;border-radius:10px;background:linear-gradient(90deg,var(--panel) 30%,var(--line) 50%,var(--panel) 70%);background-size:300% 100%;animation:sh 1.4s linear infinite}.skel i.big{height:260px}
  @keyframes sh{from{background-position:100% 0}to{background-position:0 0}}@media (prefers-reduced-motion:reduce){.skel i{animation:none}}
  .fail{max-width:520px;margin:40px auto;text-align:center;border-color:color-mix(in srgb,var(--danger) 50%,var(--line))}.fail b{display:block;color:var(--danger);font-size:15px;margin-bottom:6px}.fail p{margin:0 0 14px;color:var(--muted)}
  @media (max-width:900px){.cols{grid-template-columns:1fr}.kpis,.skel div{grid-template-columns:1fr 1fr}.audit,.top nav{display:none}.kpi .v{font-size:20px}.wrap{padding:16px}}
  @media (max-width:560px){.both{grid-template-columns:1fr}.me span{display:none}}
  </style></head><body><div class="top"><span class="brand"><i></i>Acme admin</span><nav><a>Accounts</a><a aria-current="page">Billing</a><a>Invoices</a><a>Refunds</a><a>Audit log</a></nav><span class="me"><span>Priya Shah · Finance</span><b class="av">PS</b></span></div>
  <div class="wrap"><header><h1><span class="acct">NT</span><span>Northwind Traders<small>Account 42 · Growth tier · on seats since 2 August</small></span></h1><div class="modes"><button data-mode="default" aria-pressed="true">Default</button><button data-mode="loading" aria-pressed="false">Loading</button><button data-mode="error" aria-pressed="false">Error</button></div></header>
  <main id="default"><div class="kpis"><div class="card kpi"><div class="k">Requests in October</div><div class="v">138,320</div><div class="d"><span class="up">▲ 18 %</span> on September</div></div>
  <div class="card kpi"><div class="k">Seats in use</div><div class="v">14 of 15</div><div class="d">2 added on 3 October</div></div>
  <div class="card kpi"><div class="k">November on seats</div><div class="v">$826.00</div><div class="d">the invoice it gets today</div></div>
  <div class="card kpi"><div class="k">November on usage</div><div class="v">$1,184.40</div><div class="d"><span class="up">+$358.40</span> at October's volume</div></div></div>
  <div class="cols"><div class="stack"><section class="card"><div class="head"><h2>Requests per day</h2><span class="key"><i></i>weekdays<i class="we"></i>weekends<i class="avg"></i>${OCTOBER_AVERAGE.toLocaleString("en-US")} a day on average</span></div>${octoberChart()}</section>
  <section class="card"><div class="head"><h2>November, both ways</h2><span>priced at October's volume</span></div><div class="both">
  <div class="way" id="way-seats"><div class="wh"><b>Seats</b><span class="pill">today</span></div><div class="amt">$826.00</div><div class="meter"><i style="width:69.7%"></i></div><div class="line"><span>14 seats × $59</span><span>$826.00</span></div></div>
  <div class="way pick" id="way-usage"><div class="wh"><b>Usage</b><span class="pill">from 1 November</span></div><div class="amt">$1,184.40</div><div class="meter"><i style="width:100%"></i></div><div class="line"><span>Starter, 10,000 requests</span><span>$0.00</span></div><div class="line"><span>Growth, 138,320 × $0.0080</span><span>$1,106.56</span></div><div class="line"><span>Platform fee</span><span>$77.84</span></div></div></div>
  <p class="delta">October stays on seats. The first usage invoice covers November and goes out on 1 December.</p></section></div>
  <div class="stack"><section class="card"><div class="head"><h2>Billing mode</h2><span>Finance only</span></div><div class="seg" role="radiogroup" aria-label="Billing mode"><button id="seats" aria-pressed="false">Seats</button><button id="usage" aria-pressed="true">Usage</button></div>
  <ol class="when"><li><b>Until 31 October</b>seats, as today</li><li class="next"><b id="from">From 1 November</b><span id="fromnote">usage, priced by tier</span></li></ol>
  <label class="fl" for="reason">Reason</label><input id="reason" placeholder="Reason, kept in the audit log">
  <div class="row"><button id="switch" class="primary" disabled>Switch to usage</button><span class="note">Every switch is audited: who, when and why.</span></div></section>
  <section class="card audit"><div class="head"><h2>Audit log</h2><span>account 42</span></div><ul class="log" id="log">
  <li><b class="av">PS</b><div><p><b>Priya Shah</b> added 2 seats <span>12 → 14</span></p><small>3 October · “two new analysts”</small></div></li>
  <li><b class="av a">LB</b><div><p><b>Lena Brandt</b> raised the API limit <span>to 1M calls</span></p><small>12 September · support ticket 4471</small></div></li>
  <li><b class="av g">DO</b><div><p><b>Dana Ortiz</b> switched usage to seats</p><small>2 August · “the usage pilot ended”</small></div></li>
  <li><b class="av g">DO</b><div><p><b>Dana Ortiz</b> switched seats to usage</p><small>14 June · “a three-month usage pilot”</small></div></li></ul></section></div></div></main>
  <div id="loading" hidden><div class="skel"><div><i></i><i></i><i></i><i></i></div><i class="big"></i></div><p class="loading">Loading the account…</p></div>
  <div id="error" hidden><div class="card fail"><b>The billing service did not answer.</b><p>Nothing was changed: Northwind Traders stays on seats, and the audit log has no entry for this attempt.</p><button id="retry">Try again</button></div></div></div>
  <script>${HEIGHT}const r=document.getElementById('reason'),s=document.getElementById('switch');let mode='usage';r.oninput=()=>{s.disabled=mode==='seats'||r.value.trim()===''};
  ['seats','usage'].forEach(id=>document.getElementById(id).onclick=()=>{mode=id;['seats','usage'].forEach(x=>{document.getElementById(x).setAttribute('aria-pressed',String(x===id));document.getElementById('way-'+x).classList.toggle('pick',x===id)});s.textContent=id==='usage'?'Switch to usage':'Stays on seats';document.getElementById('fromnote').textContent=id==='usage'?'usage, priced by tier':'seats, nothing changes';r.oninput()});
  s.onclick=()=>{s.disabled=true;s.textContent='Switched';const li=document.createElement('li');li.innerHTML='<b class="av">PS</b><div><p><b>Priya Shah</b> switched seats to usage</p><small>just now · applies from 1 November</small></div>';li.querySelector('small').append(' · “'+r.value.trim()+'”');document.getElementById('log').prepend(li);height()};
  document.getElementById('retry').onclick=()=>document.querySelector('[data-mode=default]').click();</script></body></html>`
}

/** The artifact's artifact fences, by path. */
export const FLAGSHIP_ARTIFACTS: Record<string, () => string> = {
  "artifacts/plan-limits.html": planLimits,
  "artifacts/plan-editor.html": billingMode,
  // The two designs the billing Plan shows in its Interface.
  "artifacts/billing-mode.html": billingMode,
  "artifacts/usage-invoice.html": usageInvoice,
}

/** The customer's November invoice with usage: seat lines unchanged, usage priced by tier, a late-event correction. */
function usageInvoice(): string {
  const { dark, css } = palette()
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>:root{${css};color-scheme:${dark ? "dark" : "light"}}${SHELL}
  .inv{border:1px solid var(--line);border-radius:6px;background:var(--panel);padding:14px 16px;margin-top:12px}.meta{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;margin-bottom:10px}
  table{width:100%;border-collapse:collapse;font-size:13px}td{padding:6px 0;border-bottom:1px solid var(--line)}td.n{text-align:right;font:12.5px ui-monospace,monospace}tr.sub td{color:var(--muted);font-size:12px;padding-top:2px}
  tr.total td{border-bottom:0;font-weight:600;padding-top:10px}.tag{display:inline-block;margin-left:6px;padding:0 6px;border:1px solid var(--line);border-radius:4px;color:var(--muted);font-size:11px}
  .note{color:var(--muted);font-size:12px;margin-top:10px}
  </style></head><body><header><h1>Invoice<small>acme/platform · Northwind Traders · November</small></h1><div class="modes"><button data-mode="default" aria-pressed="true">Invoice</button><button data-mode="loading" aria-pressed="false">Loading</button><button data-mode="error" aria-pressed="false">Error</button></div></header>
  <main id="default"><div class="inv"><div class="meta"><span>INV-2026-1142 · due 15 December</span><span>usage billing since 1 November</span></div>
  <table><tr><td>Starter tier, first 10,000 requests</td><td class="n">$0.00</td></tr>
  <tr><td>Growth tier, 138,320 requests × $0.0080</td><td class="n">$1,106.56</td></tr><tr class="sub"><td colspan="2">Each line opens the five-minute windows it bills</td></tr>
  <tr><td>Overage past your limit, 12,400 requests × $0.0080<span class="tag">alert sent at 80 % and 100 %</span></td><td class="n">$99.20</td></tr>
  <tr><td>Correction for 14 October, a late event<span class="tag">correction</span></td><td class="n">−$0.40</td></tr>
  <tr><td>Platform fee</td><td class="n">$77.84</td></tr>
  <tr class="total"><td>Total</td><td class="n">$1,283.20</td></tr></table>
  <p class="note">Seat customers keep the invoice they know; only accounts Finance moved to usage get these lines.</p></div></main>
  <p id="loading" class="loading" hidden>Loading the invoice…</p><p id="error" class="error" hidden>The invoice could not be loaded. Nothing was charged; try again in a minute.</p>
  <script>${HEIGHT}</script></body></html>`
}

// ---------------------------------------------------------------- timeline

/** How far the build is at a stage: not begun while planning, running in Implement, finished after. */
type BuildPhase = "planned" | "building" | "built"

const phaseOf = (stage: FlagshipStage): BuildPhase =>
  stage === "plan" ? "planned" : stage === "implement" ? "building" : "built"

/** The slices as the build sees them at a stage: which boxes are ticked, which commit closed each. */
function slicesAt(stage: FlagshipStage): TimelineSlice[] {
  const phase = phaseOf(stage)
  const done = new Set<string>(
    phase === "built"
      ? SLICES.flatMap((s) => s.tasks.map((t) => t.id))
      : phase === "building"
        ? ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T14", "T17"]
        : [],
  )
  // The cards the build session works on at once, with the subagents it started.
  const building = new Set(phase === "building" ? ["T12", "T15", "T18"] : [])
  const commits: Record<number, string> =
    phase === "built"
      ? {
          1: "4be1c07",
          2: "9a03f2d",
          3: "e61b9a4",
          4: "c2d7f11",
          5: "7f40be2",
          6: "51ac8e9",
          7: "0d9e3c6",
        }
      : phase === "building"
        ? { 1: "4be1c07", 2: "9a03f2d" }
        : {}
  return SLICES.map((s) => ({
    ...s,
    risky: RISKY_SLICES.has(s.n) ? "money or exactly-once counting changes here" : null,
    commit: commits[s.n] ?? null,
    tasks: s.tasks.map((t) => ({
      ...t,
      checked: done.has(t.id),
      state: done.has(t.id)
        ? ("done" as const)
        : building.has(t.id)
          ? ("building" as const)
          : ("open" as const),
    })),
  }))
}

const NOTES: Note[] = [
  {
    task: null,
    kind: "baseline",
    text: "Two proration tests already failed on main (a daylight-saving off-by-one). Left alone; not part of this change.",
    line: 8,
  },
  {
    task: "T2",
    kind: "tactical",
    text: "Health checks are marked by a route tag, not a path prefix; the emitter reads the tag.",
    line: 9,
  },
  {
    task: "T6",
    kind: "amended",
    text: "The dedupe store lives in the aggregator's own state store, not in Redis, so a replay never depends on a second system.",
    line: 10,
  },
  {
    task: "T8",
    kind: "tactical",
    text: "The emitter retries a failed send twice before it buffers; the Plan said once.",
    line: 11,
  },
  {
    task: "T8",
    kind: "tactical",
    text: "Buffer 30 minutes on disk, not 10. The agent took the recommended way and went on.",
    line: 12,
  },
]

/** How many files a slice's commit holds: the ones the plan lists for it. */
const filesOf = (slice: number) => FILES.filter((f) => f.slice === slice).length

function commitsAt(stage: FlagshipStage): CommitView[] {
  const all: CommitView[] = [
    {
      sha: "4be1c07aa",
      short: "4be1c07",
      subject: "feat(metering): one billable request reaches the ledger",
      slice: 1,
      tasks: ["T1", "T2", "T3", "T4"],
      files: filesOf(1),
      paths: [],
    },
    {
      sha: "9a03f2dbb",
      short: "9a03f2d",
      subject: "feat(metering): exactly once under retries, replays and Kafka outages",
      slice: 2,
      tasks: ["T5", "T6", "T7", "T8", "T9"],
      files: filesOf(2),
      paths: [],
    },
    {
      sha: "2c5e8d1cc",
      short: "2c5e8d1",
      subject: "fix(ledger): key usage windows by their start, not their close",
      slice: null,
      tasks: [],
      files: 2,
      paths: ["ledger/write.ts", "stream/aggregator/windows.ts"],
    },
    {
      sha: "e61b9a4dd",
      short: "e61b9a4",
      subject: "feat(invoicing): tiered usage lines with proration",
      slice: 3,
      tasks: ["T10", "T11", "T12", "T13"],
      files: filesOf(3),
      paths: [],
    },
    {
      sha: "c2d7f11ee",
      short: "c2d7f11",
      subject: "feat(web): the Plan and limits page with tiers, limits and an alert",
      slice: 4,
      tasks: ["T14", "T15", "T16"],
      files: filesOf(4),
      paths: [],
    },
    {
      sha: "7f40be2ff",
      short: "7f40be2",
      subject: "feat(admin): switch billing mode at the next cycle, audited",
      slice: 5,
      tasks: ["T17", "T18", "T19"],
      files: filesOf(5),
      paths: [],
    },
    {
      sha: "51ac8e900",
      short: "51ac8e9",
      subject: "feat(jobs): backfill 90 days and report parity",
      slice: 6,
      tasks: ["T20", "T21", "T22"],
      files: filesOf(6),
      paths: [],
    },
    {
      sha: "0d9e3c611",
      short: "0d9e3c6",
      subject: "refactor: one window helper, reuse the seat line formatter",
      slice: 7,
      tasks: ["T23"],
      files: 2,
      paths: ["stream/aggregator/windows.ts", "invoicing/usage-lines.ts"],
    },
  ]
  if (phaseOf(stage) === "building") return all.slice(0, 3)
  return phaseOf(stage) === "built" ? all : []
}

/** The flagship's timeline at a stage: the same plan, with the build state of that moment. */
function flagshipTimeline(stage: FlagshipStage): Timeline {
  const review = stage === "verify"
  const phase = phaseOf(stage)
  return {
    slices: slicesAt(stage),
    columns: COLUMNS,
    notes: phase === "planned" ? [] : NOTES,
    builder:
      phase === "building"
        ? {
            task: "T12",
            line: "three slices building side by side · 13 of 23 tasks",
            at: ago(0.1),
          }
        : review
          ? { task: null, line: "Waiting for your approval", at: ago(5) }
          : stage === "verify-checking"
            ? { task: null, line: "Agents check the build against the Plan", at: ago(1) }
            : null,
    judge: null,
    // The build's recorded checks show on the violet line while it goes.
    ...(phase === "building" ? { checks: 13 } : {}),
    commits: commitsAt(stage),
    plan: {
      commit: phase === "planned" ? null : "b7e2a90",
      diff: review
        ? [
            "diff --git a/docs/plans/usage-based-billing/01-plan.md b/docs/plans/usage-based-billing/01-plan.md",
            "@@ -19,1 +19,1 @@ ## Done means",
            "-### 6. The gateway stays fast: metering adds less than 2 ms at p99 and never blocks a request.",
            "+### 6. The gateway stays fast: metering adds less than 2 ms at p99, never blocks a request, and buffers 30 minutes of usage when Kafka is down.",
            "",
          ].join("\n")
        : "",
    },
    tries: review
      ? [
          {
            title: "A retry storm counts once",
            what: "Send one request id five times and read the ledger.",
            command: "npm run demo -- retry-storm --id r-81f",
            expected: "Five 200s; the ledger shows 1.",
            saw: "Five 200s; usage count 1 — `evidence/it2-scenario-2.txt`",
            evidence: ["evidence/it2-scenario-2.txt"],
          },
          {
            title: "A Kafka outage never blocks a request",
            what: "Stop Kafka, send 1,000 requests, start it again.",
            command: "npm run kafka:stop && npm run demo -- burst 1000 && npm run kafka:start",
            expected: "1,000 responses; 1,000 more in the ledger two minutes later.",
            saw: "1,000 × 200, p99 +1.1 ms; ledger +1,000 after 94 s — `evidence/it2-scenario-3.txt`",
            evidence: ["evidence/it2-scenario-3.txt"],
          },
          {
            title: "The backfill matches 90 days of logs",
            what: "Run the parity report for the backfill window.",
            command: "npm run backfill -- parity",
            expected: "Every account and day within 0.1%.",
            saw: "2,914 account-days, worst 0.04% — `evidence/it2-scenario-8.txt`",
            evidence: ["evidence/it2-scenario-8.txt"],
          },
        ]
      : [],
    notVerified: review
      ? [
          "The Plan and limits page on a phone: the checks used a desktop browser only.",
          "Stripe live mode: verified against the Stripe test mode, as the plan says.",
        ]
      : [],
    docsImpact: review
      ? ["`docs/billing/usage.md`: tiers, proration and the late-usage grace."]
      : [],
    prerequisites: PREREQUISITES,
    contracts: CONTRACTS,
  }
}

// ---------------------------------------------------------------- review

/** The person's review of the finished change: no teammates, only the evidence and the pull request. */
function flagshipReview(): ReviewDetail {
  const proof = (n: number, head: string, line: string, evidence: string[]) => ({
    n,
    head,
    text: "",
    proven: true,
    proof: line,
    evidence,
  })
  return {
    round: 2,
    judge: "Codex",
    verified: true,
    doneMeans: [
      proof(
        1,
        "Every billable request counts exactly once.",
        "A retry storm, a replay and an aggregator restart each left a count of 1.",
        ["it2-scenario-2.txt"],
      ),
      proof(
        2,
        "Usage shows within five minutes.",
        "500 requests showed on the Plan and limits page after 4 min 12 s, and a limit saved there applied to new requests.",
        ["it2-scenario-6.txt", "it2-usage-1280.png"],
      ),
      proof(
        3,
        "Invoices bill tiered usage.",
        "A plan change on day 10 billed a third at Starter and two thirds at Growth.",
        ["it2-scenario-4.txt"],
      ),
      proof(
        4,
        "Seat customers see no change.",
        "12 of 12 golden seat invoices byte-identical; you checked finance's totals while the build ran.",
        ["it2-scenario-5.txt"],
      ),
      proof(
        5,
        "History is rebuilt.",
        "90 days rebuilt; 2,914 account-days, the worst 0.04% off the gateway logs.",
        ["it2-scenario-8.txt"],
      ),
      proof(
        6,
        "The gateway stays fast.",
        "p99 overhead 1.1 ms; 1,000 requests answered while Kafka was down.",
        ["it2-scenario-3.txt"],
      ),
      proof(
        7,
        "Finance controls the switch.",
        "Switched to usage and back; two audit entries with reasons.",
        ["it2-scenario-7.txt", "it2-billing-mode.png"],
      ),
      proof(
        8,
        "Every charge is traceable.",
        "Invoice line 3 led to 288 windows and their request ids.",
        ["it2-trace.txt"],
      ),
    ],
    tiles: [
      { key: "checks", label: "Checks", passed: 4, total: 4, lines: [] },
      { key: "scenarios", label: "Scenarios", passed: 8, total: 8, lines: [] },
      { key: "acceptance", label: "Acceptance test", passed: 1, total: 1, lines: [] },
      { key: "done", label: "Definition of done", passed: 23, total: 23, lines: [] },
    ],
    pictures: [
      { file: "it2-scenario-8.txt", caption: "the parity report: 2,914 account-days within 0.1%" },
      {
        file: "it2-usage-1280.png",
        caption:
          "The Plan and limits page at 1280 px: this month's use, and an invalid limit refused",
      },
      {
        file: "it2-billing-mode.png",
        caption: "The billing mode in the admin, switched to usage",
      },
    ],
    proofs: [
      {
        file: "it2-acceptance.txt",
        title: "acceptance test",
        caption: "a replayed day: ledger usage equals the gateway's billable count",
      },
    ],
    second: { name: "Codex", state: "done", findings: 3 },
    tryIt: [
      { text: "Start the stack", command: "npm run dev:billing" },
      {
        text: "Send one request id five times and read the ledger",
        command: "npm run demo -- retry-storm --id r-81f",
      },
      { text: "Open the Plan and limits page as account 42", command: null },
    ],
    notVerified: [
      "The Plan and limits page on a phone: the checks used a desktop browser only.",
      "Stripe live mode: verified against the Stripe test mode, as the plan says.",
    ],
    threads: [],
    reviewers: [{ name: ME.name, role: "author", state: "author", at: 0 }],
    pushed: true,
    pr: {
      number: 318,
      title: "Usage-based billing",
      url: "https://github.com/acme/platform/pull/318",
      state: "open",
      checks: "14 checks passing",
      branch: "feat/usage-billing",
    },
  }
}

// ---------------------------------------------------------------- task

/** What the scaling rules applied to the flagship, as the CLI says it at the Implement stop. */
const FLOW_LINE =
  "Flow: 7 slices built in this session, test first · security review (money paths) · the independent reviewer also adds the missing tests."

/** The Implement start's prompt per agent: the CLI's own words (core/handoff/prompt.ts). */
function prompts(slug: string, size: { slices: number; tasks: number }): ImplementOption[] {
  return (["claude-code", "codex", "unknown"] as const).map((id) => {
    const start = implementPrompt({ slug }, id, FLOW_LINE, size)
    return {
      agent: id === "unknown" ? "other" : id,
      name: id === "unknown" ? "Other agent" : agents[id].name,
      prompt: start.prompt,
      advice: start.advice,
    }
  })
}

/** The step each tour stage stands at. */
const STAGE_STEP: Record<FlagshipStage, Step> = {
  plan: "plan",
  implement: "implement",
  "verify-checking": "verify",
  verify: "verify",
}

/** The flagship task as the base of the demo task, at the stage the tour shows. */
export function flagshipTask(stage: FlagshipStage, now = Date.now()): TaskDetail {
  const slug = "usage-based-billing"
  const planning = phaseOf(stage) === "planned"
  // Before the build, the timeline is the Plan's: every slice still to do.
  const timeline = flagshipTimeline(stage)
  const total = SLICES.reduce((n, s) => n + s.tasks.length, 0)
  const checked = timeline.slices.reduce((n, s) => n + s.tasks.filter((t) => t.checked).length, 0)
  // Every step up to the one the stage stands at has its file.
  const here = STEPS.indexOf(STAGE_STEP[stage])
  const written = (step: Step) => STEPS.indexOf(step) <= here
  const hasFile = (role: DocRole): boolean => written(role)
  const gate = stage === "plan" ? NAMES.plan : stage === "verify" ? "final" : null
  return {
    id: DEMO_TASK_ID,
    answers: "app",
    title: "Usage-based billing",
    project: "platform",
    projectName: "acme/platform",
    slug,
    type: "feature",
    files: taskFiles("acme/platform", slug, "feature", hasFile),
    overrides: [],
    stage: STAGE_STEP[stage],
    ...verifyModeField(
      stage === "verify-checking" ? "checking" : stage === "verify" ? "yours" : null,
    ),
    iterations: stage === "verify" ? 2 : stage === "verify-checking" ? 1 : 0,
    created: now - 26 * HOUR,
    dir: `/home/dev/.qualitylayer/projects/platform/tasks/${slug}`,
    archived: false,
    branch: "feat/usage-billing",
    gate:
      gate === null
        ? null
        : {
            id: `demo-flagship-${stage}`,
            target: gate,
            targets: [gate],
            // The final gate opened when the checks passed.
            opened: now - (stage === "verify" ? 4 * HOUR : 6 * MIN),
            decision: "pending",
            settled: false,
          },
    session: {
      agent: "claude-code",
      phase: STAGE_STEP[stage],
      state: stage === "implement" || stage === "verify-checking" ? "busy" : "waiting",
      heartbeat: now,
      since:
        now -
        (stage === "implement"
          ? 72
          : stage === "verify-checking"
            ? 9
            : stage === "verify"
              ? 240
              : 6) *
          MIN,
      checkout: "/demo/acme/platform",
    },
    progress: planning ? null : { checked, total, slices: SLICES.length },
    helpers: [],
    action: stage === "plan" ? "review" : stage === "verify" ? "final" : null,
    waitingSince: null,
    closing: null,
    slices: timeline.slices.map((s) => ({
      n: s.n,
      title: s.title,
      validation: s.validation,
      tasks: s.tasks.map((t) => ({ id: t.id, title: t.title, checked: t.checked })),
      approved: !planning,
    })),
    timeline,
    quality: phaseOf(stage) === "built" ? DEMO_QUALITY : [],
    flow: {
      researchHelpers: true,
      security: true,
      planReview: "second-opinion",
      changeSecondOpinion: true,
      splitProposal: false,
    },
    implementStart: planning
      ? null
      : {
          slices: SLICES.length,
          tasks: total,
          agents: prompts(slug, { slices: SLICES.length, tasks: total }),
          flowLine: FLOW_LINE,
        },
    buildLog: planning
      ? null
      : {
          deviations: BUILD_DEVIATIONS,
        },
    docs: FLOW_STEPS.map((flow) => ({
      name: NAMES[flow.id],
      label: flow.label,
      exists: written(flow.id),
      status: stage === "plan" && flow.id === "plan" ? "review" : "",
      approved: false,
    })),
    comments: [],
    events: [],
    prDescription: stage === "verify" ? FLAGSHIP_PR_DESCRIPTION : null,
    // Verify while checking shows the judge's first round sent back; the review both, the second passed.
    verification: (stage === "verify" || stage === "verify-checking"
      ? [
          {
            n: 1,
            result: "fail",
            judge: "Codex",
            verdicts: [
              {
                verdict: "PASS",
                kind: "check",
                subject: "",
                text: "`npm test` exit 0 · 1,412 pass",
              },
              {
                verdict: "FAIL",
                kind: "dod",
                subject: "T12",
                text: "A plan change on day 10 bills 3 cents more than the contract: the Growth part rounded each day before summing — `invoicing/usage-lines.ts:5`",
              },
              {
                verdict: "MISSING",
                kind: "dod",
                subject: "T19",
                text: "A switch back leaves its own audit entry: no test or observation covers it",
              },
            ],
          },
          {
            n: 2,
            result: "pass",
            judge: "Codex",
            verdicts: [
              { verdict: "PASS", kind: "check", subject: "", text: "`npm run typecheck` exit 0" },
              {
                verdict: "PASS",
                kind: "check",
                subject: "",
                text: "`npm test` exit 0 · 1,431 pass",
              },
              { verdict: "PASS", kind: "check", subject: "", text: "`go test ./...` exit 0" },
              {
                verdict: "PASS",
                kind: "check",
                subject: "",
                text: "`go test ./gateway/middleware -bench Meter` p99 +1.1 ms",
              },
              ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
                verdict: "PASS",
                kind: "scenario",
                subject: String(n),
                text: `every step as expected — \`evidence/it2-scenario-${n}.txt\``,
              })),
              {
                verdict: "PASS",
                kind: "acceptance",
                subject: "A1",
                text: "A replayed day: ledger usage 2,418,903 = gateway billable 2,418,903 — `evidence/it2-acceptance.txt`",
              },
              {
                verdict: "PASS",
                kind: "review",
                subject: "",
                text: "money paths, concurrency, idempotency keys, test quality: nothing found",
              },
            ],
          },
        ]
      : []
    ).slice(0, stage === "verify-checking" ? 1 : 2),
    showMe: [
      {
        name: "show-me-request-path.html",
        title: "A billable request, from the gateway to the invoice",
      },
    ],
    evidence:
      stage === "verify"
        ? [
            "it2-usage-1280.png",
            "it2-billing-mode.png",
            "it2-scenario-2.txt",
            "it2-scenario-3.txt",
            "it2-scenario-4.txt",
            "it2-scenario-5.txt",
            "it2-scenario-6.txt",
            "it2-scenario-7.txt",
            "it2-scenario-8.txt",
            "it2-trace.txt",
            "it2-acceptance.txt",
          ]
        : [],
    review: stage === "verify" ? flagshipReview() : null,
    me: ME,
  }
}
