// The usage-billing story of the App Model (artifacts/app/app-model/data.jsx, docs/artifacts/demo-story.md),
// as the demo task's Done means, slices and "Decided while building" lines: one story at every moment.

export type StoryPoint = { n: number; text: string; withdrawn: boolean }
export type StorySlice = {
  n: number
  title: string
  words: string
  tasks: string[]
  state: "done" | "running" | "next" | "after"
  /** How many of its tasks are done. */
  done: number
  /** Upstream slices this slice depends on. */
  dependsOn?: number[]
  /** Why this slice depends on its upstream slices. */
  dependsReason?: string
  /** Done means points this slice proves. */
  points?: number[]
}

/** Five dependency waves across the eleven usage-billing slices. */
export const DEMO_SLICE_COLUMNS: { n: number; after: number | null }[][] = [
  [{ n: 1, after: null }],
  [
    { n: 2, after: 1 },
    { n: 3, after: 1 },
    { n: 9, after: 1 },
  ],
  [
    { n: 4, after: 2 },
    { n: 5, after: 2 },
    { n: 6, after: 3 },
  ],
  [
    { n: 7, after: 6 },
    { n: 8, after: 4 },
    { n: 10, after: 4 },
  ],
  [{ n: 11, after: 8 }],
]
export type StoryDecision = { where: string; what: string; note: string }

export const DONE_MEANS: StoryPoint[] = [
  { n: 1, text: "Every billable request counts exactly once", withdrawn: false },
  { n: 2, text: "Usage appears within five minutes", withdrawn: false },
  { n: 3, text: "Tiered invoices prorate a mid-cycle change", withdrawn: false },
  { n: 4, text: "Seat invoices stay unchanged", withdrawn: false },
  { n: 5, text: "A replay rebuilds ninety days of usage", withdrawn: false },
  { n: 6, text: "Gateway overhead stays below two milliseconds", withdrawn: false },
  { n: 7, text: "Finance controls each account's billing mode", withdrawn: false },
  { n: 8, text: "Every invoice line traces to its usage windows", withdrawn: false },
  { n: 9, text: "A retry storm or a Kafka outage never changes the count", withdrawn: false },
  { n: 10, text: "Customers see their use per meter against their plan limit", withdrawn: false },
  { n: 11, text: "Customers are alerted at 80 % of a limit", withdrawn: false },
  { n: 12, text: "Every billing-mode switch leaves an audit entry", withdrawn: false },
  { n: 13, text: "Usage is shown in the customer's own currency", withdrawn: true },
]

export const SLICES: StorySlice[] = [
  {
    n: 1,
    title: "Meter one request end to end",
    words:
      "The gateway emits one meter event per billable request, the aggregator closes a usage window every five minutes, and the ledger stores the entry.",
    tasks: [
      "T1 Emit a meter event per billable request",
      "T2 Close usage windows every five minutes",
      "T3 Store a usage entry in the ledger",
    ],
    state: "done",
    done: 3,
    points: [1, 2],
  },
  {
    n: 2,
    title: "Survive retries and broker outages",
    words:
      "A retry storm counts once, duplicate events are dropped by request id, each window is written once, and a Kafka outage never blocks a request.",
    tasks: [
      "T4 Count a retry storm once",
      "T5 Drop duplicate events by request id",
      "T6 Write each window to the ledger once",
      "T7 Keep serving requests through a Kafka outage",
    ],
    state: "done",
    done: 4,
    dependsOn: [1],
    dependsReason: "hardens the gateway meter and five-minute window",
    points: [1, 9],
  },
  {
    n: 3,
    title: "Keep metering under two milliseconds",
    words:
      "The gateway caches each account's plan for 60 seconds, and a benchmark holds metering under two milliseconds at p99.",
    tasks: ["T8 Cache the plan at the gateway for 60 s", "T9 Benchmark metering at p99"],
    state: "done",
    done: 2,
    dependsOn: [1],
    dependsReason: "caches plans on the gateway metering path",
    points: [6],
  },
  {
    n: 4,
    title: "Bill usage tiers with proration",
    words:
      "Usage is priced at the tier boundaries, usage lines reach Stripe through the existing invoice outbox, and a mid-cycle plan change is prorated.",
    tasks: [
      "T10 Price usage at the tier boundaries",
      "T11 Send usage lines through the invoice outbox",
      "T12 Prorate a mid-cycle plan change",
    ],
    state: "done",
    done: 3,
    dependsOn: [2],
    dependsReason: "prices deduplicated ledger windows",
    points: [3],
  },
  {
    n: 5,
    title: "Keep seat invoices unchanged",
    words:
      "Seat accounts never take the usage path, and their invoices are compared byte for byte with last month's.",
    tasks: [
      "T13 Compare seat invoices byte for byte",
      "T14 Route seat accounts around the usage path",
    ],
    state: "running",
    done: 1,
    dependsOn: [2],
    dependsReason: "keeps seat billing isolated from the usage ledger",
    points: [4],
  },
  {
    n: 6,
    title: "Let customers set plans and limits",
    words:
      "The usage API returns use per meter against the plan limit, the Plan and limits page saves limits, and a saved limit applies within five minutes.",
    tasks: [
      "T15 Return use per meter and plan limit",
      "T16 Save limits on the Plan and limits page",
      "T17 Apply a saved limit within five minutes",
    ],
    state: "running",
    done: 1,
    dependsOn: [3],
    dependsReason: "reads the 60-second gateway plan cache",
    points: [10],
  },
  {
    n: 7,
    title: "Alert customers at 80 % of a limit",
    words:
      "An account crossing 80 % of a limit gets one alert per billing cycle, and the Plan and limits page shows it.",
    tasks: [
      "T18 Send the 80 % alert once per cycle",
      "T19 Show the alert on the Plan and limits page",
    ],
    state: "next",
    done: 0,
    dependsOn: [6],
    dependsReason: "evaluates limits saved on the Plan and limits page",
    points: [11],
  },
  {
    n: 8,
    title: "Move accounts at the next renewal",
    words:
      "Finance switches an account between seat and usage billing on the account page, the switch takes effect at the next cycle, and every switch is audited.",
    tasks: [
      "T20 Change billing mode at the next cycle",
      "T21 Preview both invoices in the account page",
      "T22 Write an audit entry for every switch",
    ],
    state: "running",
    done: 0,
    dependsOn: [4, 5],
    dependsReason: "previews both usage and seat invoices side by side",
    points: [7, 12],
  },
  {
    n: 9,
    title: "Rebuild ninety days of history",
    words:
      "The backfill rebuilds usage windows from ninety days of access logs, runs dark invoices next to the real ones and reports parity within 0.1 %.",
    tasks: [
      "T23 Rebuild windows from the access logs",
      "T24 Run dark invoices next to the real ones",
      "T25 Report parity within 0.1 %",
    ],
    state: "next",
    done: 0,
    dependsOn: [1],
    dependsReason: "replays access logs through the same window schema",
    points: [5],
  },
  {
    n: 10,
    title: "Trace every invoice line to its windows",
    words: "Each invoice line links to the usage windows it bills, and the admin shows them.",
    tasks: ["T26 Link each invoice line to its windows", "T27 Show the windows behind a line"],
    state: "after",
    done: 0,
    dependsOn: [4, 9],
    dependsReason: "links live and backfilled windows to invoice lines",
    points: [8],
  },
  {
    n: 11,
    title: "Simplify the whole change",
    words: "With every slice in, one pass removes duplicate paths across the change.",
    tasks: ["T28 Simplify the whole change"],
    state: "after",
    done: 0,
    dependsOn: [7, 8, 10],
    dependsReason: "runs once every functional slice is green",
  },
]

export const BUILD_DECISIONS: StoryDecision[] = [
  {
    where: "Slice 2",
    what: "A late event older than seven days goes to the correction queue instead of the live window",
    note: "nothing you approved changes",
  },
  {
    where: "The Plan",
    what: "Add the region to the window key so two regions never share a window",
    note: "nothing you approved changes",
  },
  {
    where: "Slice 1",
    what: "The meter event carries the plan id so the aggregator never looks it up",
    note: "nothing you approved changes",
  },
  {
    where: "Slice 4",
    what: "Proration rounds to the cent per line, matching the seat invoices",
    note: "nothing you approved changes",
  },
  {
    where: "Slice 3",
    what: "The plan cache is per gateway instance; a plan change reaches every instance within 60 seconds",
    note: "nothing you approved changes",
  },
  {
    where: "The Plan",
    what: "Reuse the warehouse usage table for the backfill instead of a new store",
    note: "nothing you approved changes",
  },
  {
    where: "Slice 6",
    what: "A limit saved mid-window applies from the next window",
    note: "nothing you approved changes",
  },
  {
    where: "Slice 8",
    what: "The invoice preview reads the same pricing code the invoices use",
    note: "nothing you approved changes",
  },
  {
    where: "Slice 9",
    what: "The backfill reads the logs in daily batches so the warehouse stays responsive",
    note: "nothing you approved changes",
  },
  {
    where: "Slice 2",
    what: "The outage buffer holds events on local disk for up to an hour",
    note: "nothing you approved changes",
  },
]
