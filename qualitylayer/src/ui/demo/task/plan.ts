// The demo's content for the Plan of the task ("Usage-based billing"): the document the person
// approves, and what each of its moments asks of them. Before the first draft the Plan asks its two
// batches (`batch.ts`) while the helpers read the code (`research.ts`). At `plan-work` and
// `plan-findings` the agent is still writing and folding the review in, so nothing is asked and no
// gate is open (D19). At `plan-decide` one Your call waits inside the Plan and Approve is locked. At
// `plan-approve` the call is answered and the Plan is ready; the build cuts it into slices after
// approval. The document is the same at every moment; what differs is the state around it.

import type { Item } from "../../../core/items.ts"
import { EVIDENCE_HEADING } from "../../../core/pages/render.ts"
import type { Question } from "../../../core/task/question.ts"
import type { TaskDetail } from "../../api.ts"
import type { Area } from "./area.ts"
import { TASK_AGENT_FILES, TASK_FILES } from "./documents.ts"
import type { Moment } from "./moments.ts"
import { choicesEvidence, FINDINGS_LINES } from "./research.ts"

/**
 * The Plan's one Your call: an architectural choice only the person can make, because it decides what a
 * customer's product does at the limit. Blocking puts a usage check in front of every request; serving
 * keeps the request path as it is and bills what was used. Drawn as both paths side by side.
 */
const CALL_OPTIONS = [
  "Keep serving: bill the overage at the tier price and alert at 80 % and 100 %.",
  "Block at the limit: the gateway checks the count and answers 429 when it is used up.",
] as const
const CALL_WHY =
  "Blocking protects budgets but can stop customers' products. Choose how limits work."
// One request, the two answers as branches after the gateway, drawn left to right: wide and short, so
// it reads at the Plan's width without filling the screen.
const CALL_DIAGRAM = `flowchart LR
  gw["Request at the gateway"] -->|"A · keep serving"| api["Your API"]
  api -.->|"after"| bill["Overage billed, alerts sent"]
  gw -->|"B · block"| chk{"Limit left?"}
  chk -->|"yes"| api2["Your API"]
  chk -->|"no"| refused["429"]
  counter[("Usage counter")] -.->|"read on every request"| chk
`
const CALL = `late: true

**A:** ${CALL_OPTIONS[0]}
**B:** ${CALL_OPTIONS[1]}
**Recommended:** A`

export const ACCOUNT_WIREFRAME = `name: account-billing-mode
surface: desktop
title: Account › Billing

<div class="screen">
  <h1>Account billing</h1>
  <div class="field" id="account">Account <span class="box">Example account</span></div>
  <div class="field" id="current-mode">Current billing <span class="box">Seats</span></div>
  <div class="field" id="next-mode">Next billing cycle <span class="box">Usage</span></div>
  <div class="field" id="reason">Reason <span class="box">Finance approval required</span></div>
  <button class="primary" id="preview">Preview invoices</button>
</div>`

/** Today and after the change: the request's path through the gateway, drawn left to right. */
const BEFORE_AFTER = `flowchart LR
  subgraph today["Today"]
    t1["Request"] --> t2["Gateway and service"]
  end
  subgraph after["After the change"]
    a1["Request"] --> a2["Gateway and service"]
    a2 -.->|"meter event"| a3[("Usage ledger")] --> a4["Invoice outbox"]
  end`

/** How one request is counted once, even when the client retries it. */
const COUNT_ONCE = `sequenceDiagram
  participant C as API client
  participant G as Gateway
  participant K as Kafka
  participant L as Ledger
  C->>G: request req_8f2a
  G->>K: meter event req_8f2a
  C->>G: retry req_8f2a
  G->>K: meter event req_8f2a again
  K->>L: window written once`

/** One Done means point: its heading, the sentence on how it shows, and its steps. */
const point = (n: number, title: string, shows: string, steps: string[], also?: string): string =>
  [
    `### ${n}. ${title}`,
    "",
    shows,
    "",
    "| Step | Action | Expected |",
    "|---|---|---|",
    ...steps,
    ...(also === undefined ? [] : ["", `also ${also}`]),
    "",
  ].join("\n")

const DONE_MEANS = [
  point(
    1,
    "Every billable request counts exactly once.",
    "A retry, a replay or a duplicate event never adds a second charge.",
    [
      "| A1 | Send one request ten times with the same id | the ledger holds one entry and the invoice one line |",
    ],
    "A2",
  ),
  point(
    2,
    "Usage appears within five minutes.",
    "A customer sees a request on the Plan and limits page within five minutes.",
    [
      "| A2 | Send one request with a test key and read the usage API every 30 s | the Plan and limits page shows the request within five minutes |",
    ],
  ),
  point(
    3,
    "Tiered invoices prorate a mid-cycle change.",
    "A plan change halfway through a cycle bills each part at its own tiers.",
    [
      "| A3 | Change the plan on day 12 of a 30-day cycle with a fixed clock, then build the invoice | each part is billed at its own tiers, to the cent |",
    ],
  ),
  point(
    4,
    "Seat invoices stay unchanged.",
    "An account on seats gets the same invoice as before, byte for byte.",
    [
      "| A4 | Build last month's seat invoices again and compare them with the sent ones | no difference, byte for byte |",
    ],
  ),
  point(
    5,
    "A replay rebuilds ninety days of usage.",
    "The backfill matches the access logs within 0.1 %.",
    [
      "| A5 | Run the backfill over ninety days of access logs | the dark invoices come within 0.1 % of the real ones |",
    ],
  ),
  point(
    6,
    "Gateway overhead stays below two milliseconds.",
    "Metering adds less than 2 ms at p99.",
    [
      "| A6 | Run the gateway benchmark at 2,000 requests a second | metering adds under 2 ms at p99 |",
    ],
  ),
  point(
    7,
    "Finance controls each account's billing mode.",
    "Only Finance switches an account, and the switch takes effect at renewal.",
    [
      "| A7 | Open the billing mode page as support, then as Finance, and schedule a switch | the field is read-only for support; Finance sees both invoices before the switch |",
    ],
  ),
  point(
    8,
    "Every invoice line traces to its usage windows.",
    "Each line links to the windows it bills.",
    [
      "| A8 | Open a usage line on a test invoice and add up its windows | the sum equals the line |",
    ],
  ),
  point(
    9,
    "A retry storm or a Kafka outage never changes the count.",
    "A thousand retries of one request count once, and requests during a ten-minute broker outage are all counted after it.",
    [
      "| A9 | Send 1,000 retries of one request while Kafka is stopped for ten minutes | every request is answered and the count is unchanged |",
    ],
  ),
  point(
    10,
    "Customers see their use per meter against their plan limit.",
    "The Plan and limits page shows each meter's use this cycle against its limit, and a saved limit applies within five minutes.",
    [
      "| A10 | Save a limit of 100 requests on the Plan and limits page | the page and the usage API show the same limit and use |",
    ],
  ),
  point(
    11,
    "Customers are alerted at 80 % of a limit.",
    "Crossing 80 % of a limit sends one email to the billing contact and shows one alert on the page, once per cycle.",
    ["| A11 | Set a limit of 100 requests and send 86 | one alert on the page and one email |"],
  ),
  point(
    12,
    "Every billing-mode switch leaves an audit entry.",
    "Each switch records the old mode, the new mode, who made it and when, and the audit log lists it.",
    [
      "| A12 | Read the audit log after the switch of A7 | one entry with the old mode, the new mode, who and when |",
    ],
  ),
].join("\n")

export const DEMO_PLAN = `---
title: Usage-based billing
type: feature
stage: plan
layout: three
---

# Plan: count each request once and bill it

## Summary

The gateway counts each billable request once, even when it is retried; seat invoices keep their current path. Five-minute usage windows reach invoices through the existing outbox. Customers see their use against their limits and are alerted at 80 %.

**Size:** about 11 slices and 28 tasks, up to four side by side.
**Trust boundary:** gateway requests and the Finance-only billing-mode switch.
**Risk:** Duplicate charges — Replaying the same usage event could charge a customer twice.
**Integrations:** Gateway, Ledger

## Success measure

Ninety days of access logs replayed through the new path give invoices within 0.1 % of the real ones, and a retry storm in staging leaves the count unchanged.

## Problem

- Nine services touch a request, and none counts it once.
- A retry, an outage or a late event can turn it into a duplicate or a missing charge.
- Seat customers must keep the invoices they know.

## Done means

${DONE_MEANS}
Runs as: a scripted run on the built App with a fixture repository; no live Stripe account

## Scope

### In scope

- Gateway metering and stream aggregation
- The usage ledger and tiered invoicing
- Customer limits and alerts
- A ninety-day backfill

### Out of scope

- Usage in the customer's own currency
- Real-time spend alerts by SMS

## First release

API customers are billed for what they use after a free allowance. Seat customers keep the invoices they know.

## Diagrams

### Before and after

\`\`\`mermaid
${BEFORE_AFTER}
\`\`\`

One new path beside the request: the gateway adds an event, nothing in the response changes.

### A retried request counts once

\`\`\`mermaid
${COUNT_ONCE}
\`\`\`

The retry carries the same id, so the window holds it once.

## Interface

Two screens change. Finance switches an account between seats and usage on its own page, with both invoices side by side before the switch. The customer's invoice gains usage lines, priced by tier.

<!-- ql:artifact billing-mode -->
<!-- /ql:artifact -->

<!-- ql:artifact usage-invoice -->
<!-- /ql:artifact -->

## Approach

**Chosen:** count at the gateway, keyed by the request id, and bill through the existing outbox.
**Gives:** usage within five minutes, a retry never counted twice, seat invoices on their current path.
**Costs:** about 1 ms per request at the gateway, and a correction line for events that arrive late.

- **The gateway counts each billable request once.** It emits one meter event per request, keyed by the request id, so a retry is never counted twice.
- **Usage windows close every five minutes.** An aggregator sums the events and the ledger writes each window once, through the existing outbox.
- **Finance switches an account between seats and usage.** The billing-mode page shows both invoices before the switch. Seat accounts keep their current path.
- **Customers see their use against their limits.** The invoice gains usage lines priced by tier, and an alert goes out at 80 %.

## Decided with you

<!-- ql:decided-by-you -->
- Plan · Existing seat customers: move them, or keep them on seats? — Keep them on seats until Finance moves them
- Plan · Bill usage from the first request, or after a free allowance? — A free allowance per plan
- Plan · Late events older than seven days: rebill, or correct the next invoice? — Correct the next invoice
- Plan · Usage in the customer's own currency: now, or a later task? — A later task
- Plan · Count a request at the gateway, or from the access logs? — At the gateway, keyed by request id
- Plan · Close a usage window on the clock, or when its events stop? — Every five minutes; late events correct the next invoice
- Plan · About eleven slices: keep one task, or split the backfill off? — Keep one task
<!-- /ql:decided-by-you -->

## Decisions made for you

- A usage window closes every five minutes — usage shows soon, and a late event becomes a correction line.
- The gateway caches each account's plan for 60 seconds — a plan lookup per request would cost more than the meter.

## Prerequisites

| # | Prerequisite | Met by | Status |
|---|---|---|---|
| P1 | Permission to run the agreed build | you, at approval | at approval |

## Later

- Usage in the customer's own currency: a later task decides it.

## Launch

Seat customers stay on seats until Finance moves each account. Usage invoices start with the next billing cycle.

## Worth it when

API customers' invoices follow what they use, and nobody pays twice for the same request.

## Reference

The pricing sheet Finance approved on 2 October.

## Reviews

<!-- ql:reviews -->
**Second opinion · Codex, GPT-6.1 Sol** · REVISE: 9 items · 7 taken, 1 kept, 1 asked of you.
- Two regions can write the same window · Taken: the window key includes the region.
- A plan change mid-window prices the whole window at the new tier · Taken: the window splits at the change.
- The gateway reads the plan on every request · Kept: it is cached for 60 seconds, and the benchmark covers it.
<!-- /ql:reviews -->

## Data and interfaces

| Name | Where | Values |
|---|---|---|
| \`meter event\` | Kafka topic | \`{ requestId, account, meter, plan, at }\` |
| \`usage window\` | ledger | keyed by account, meter, region and start |
| \`billing mode\` | account | \`seats\` or \`usage\`, set by Finance |

## Engineering decisions

### Count at the gateway, keyed by request id

Every billable request passes the gateway once. Its id survives retries, so a retry is counted once. Not chosen: counting from the access logs, which shows usage an hour late.

<!-- ql:decide d1 -->
<!-- /ql:decide -->

### The ledger writes each window once

A window is open while events arrive, closed after five minutes and invoiced once. Not chosen: closing a window when its events stop, which may never happen for a busy account.

**Lens:** state

\`\`\`mermaid
stateDiagram-v2
  direction LR
  [*] --> Open
  Open --> Closed: five minutes pass
  Closed --> Invoiced: the cycle ends
  Closed --> Corrected: a late event arrives
  Corrected --> Invoiced: the next cycle ends
\`\`\`

<!-- ql:decide d2 -->
<!-- /ql:decide -->

### Usage invoices go through the existing outbox

A usage line is written to the same outbox seat invoices use, so a retry never charges twice. Not chosen: a second path to Stripe.

**Lens:** architecture

\`\`\`mermaid
flowchart LR
  ledger[("Ledger")] -->|"usage windows"| price["price()"]
  plans[("Plans")] -->|"seat plans"| price
  price -->|"invoice lines"| outbox[("Invoice outbox")]
  outbox -->|"once per invoice"| stripe["Stripe"]
\`\`\`

<!-- ql:decide d3 -->
<!-- /ql:decide -->

### What happens when a customer reaches their limit

${CALL_WHY}

**Kind:** architecture

${CALL}

\`\`\`mermaid
${CALL_DIAGRAM}
\`\`\`

<!-- ql:decide d4 -->
<!-- /ql:decide -->
`

/** The Plan's agents' file (agents/01-plan.md): the request, what the build reads first, the findings and the risks the Plan accepts with their tests. */
const PLAN_AGENTS = `# For agents: count each request once and bill it

## Your request

> Bill API customers for usage while keeping seat customers on the invoices they know, and keep the gateway fast.

## Read first

- \`services/ledger/README.md\`: how the write-once ledger keys its entries.
- \`artifacts/billing-mode.html\` and \`artifacts/usage-invoice.html\`, the two designs the Interface shows.

## Constraints

- Every request passes through the gateway: the meter runs after the response is sent.

## Findings

${FINDINGS_LINES}

## ${EVIDENCE_HEADING}

<!-- ql:evidence -->
${choicesEvidence()}
<!-- /ql:evidence -->

## Contracts

### One meter event per billable request

The gateway emits \`{ requestId, account, meter, plan, at }\` once per billable request, after the response is sent.

### A usage window is keyed by account, meter, region and start

The key makes a replayed window a no-op in the ledger. A closed window changes only through a correction line.

### Finance switches the mode for the next cycle

The switch is stored with who made it and when, and takes effect at the next renewal.

## Code to imitate

- \`services/ledger/src/write-once.ts:30\` keys every entry; the usage window uses the same path.

## Start and test

Run \`npm test -- services/ledger\` for one service and \`npm run test:integration -- billing\` for the path from the gateway to the ledger (about ninety seconds).

## Checks

- \`npm run typecheck\`
- \`npm run lint\`
- \`npm test\`

**Project checks:** \`npm run typecheck\`, \`npm run lint\`, \`npm test\`

## Rejected approaches

- Counting from the access logs: usage would show an hour late.
- A second path to Stripe: the outbox already retries safely.

## Risks

- A slow meter slows every request. Guarded by: the plan cache (60 seconds) and the p99 benchmark under two milliseconds.
- A double charge. Guarded by: the window key in the ledger, tested by the replayed-window test.
- A changed seat invoice. Guarded by: the byte-for-byte comparison with last month's invoices.
- How the warehouse partitioned logs before 2026 is not traced; it only affects the backfill. Guarded by: the backfill's 0.1 % comparison.

## Pitfalls

- \`price()\` builds seat and usage lines; a change for usage must not move a seat total.
- The meter runs on every request: keep it after the response is sent.

## Proven before the gate

| Depends on | Proven how | Result |
|---|---|---|
| The request id survives the gateway's retries | a retry storm against staging on 2026-10-07 | one id on every attempt · \`records/p1-retry.txt\` |
| Stripe accepts metered prices on the existing products | created one in test mode on 2026-10-07 | accepted · \`records/p2-stripe.txt\` |
`

const decision = (n: number, what: string, why: string): Item => ({
  id: `plan:decision:d${n}`,
  step: "plan",
  family: "decide",
  kind: "decision",
  kindLabel: "Engineering decision · flow",
  what,
  why,
  answers: { options: ["agree", "change"] },
  blocking: false,
  uncounted: true,
  state: "open",
  digest: `demo-d${n}`,
})

/** The Your call at a moment: open at `plan-decide`, answered A once the person has read on. */
const call = (moment: Moment, now: number): Item => ({
  ...decision(4, "What happens when a customer reaches their limit", CALL_WHY),
  kindLabel: "Your call · architecture",
  uncounted: moment === "plan-decide" ? true : undefined,
  blocking: true,
  call: { options: [...CALL_OPTIONS], recommended: 0 },
  ...(moment === "plan-approve"
    ? {
        state: "settled" as const,
        answer: { kind: "agree" as const, note: "A", at: now - 9 * 60_000 },
      }
    : {}),
})

const callQuestion = (task: TaskDetail, now: number): Question => ({
  id: "plan-limit-call",
  number: 8,
  question: "What happens when a customer reaches their limit?",
  why: CALL_WHY,
  grade: 3,
  choices: [
    {
      label: CALL_OPTIONS[0],
      kind: "agree",
      facts: [
        "Timing: requests keep their current path.",
        "Adds: tier-priced overage and two alerts.",
      ],
      diagram:
        'flowchart LR\n  r["Request"] --> g["Gateway"] --> a["Your API"]\n  g -.->|"after"| b["Overage billed"]',
      evidence: [{ label: "Gateway and invoice contract", href: "agents/01-plan.md#contracts" }],
    },
    {
      label: CALL_OPTIONS[1],
      kind: "change",
      facts: [
        "Timing: every request reads the usage counter.",
        "Adds: a 429 response when the limit is reached.",
      ],
      diagram:
        'flowchart LR\n  r["Request"] --> c{"Limit left?"} -->|"yes"| a["Your API"]\n  c -->|"no"| s["429"]',
      evidence: [{ label: "Limit behavior decision", href: "01-plan.md#engineering-decisions" }],
    },
  ],
  recommended: 0,
  gate: TASK_FILES.plan,
  gateId: task.gate?.id,
  item: "plan:decision:d4",
  about: { doc: TASK_FILES.plan, section: "Engineering decisions" },
  agent: "claude-code",
  asked: now,
  ahead: 0,
})

/** The sentence the person's comment is on, and what the agent adds after it once it folds the comment in. */
export const ALERT_SENTENCE =
  "Customers see their use against their limits and are alerted at 80 %."
const CAP_SENTENCE =
  "The overage is capped at 50 % above the plan; past the cap the gateway answers 429."
let capped = false

/** The person's comment was folded in: the Plan says so from now on, in this page's memory only. */
export function capOverage() {
  capped = true
}

export const plan: Area = {
  documents: {
    get [TASK_FILES.plan]() {
      return capped
        ? DEMO_PLAN.replace(ALERT_SENTENCE, `${ALERT_SENTENCE} ${CAP_SENTENCE}`)
        : DEMO_PLAN
    },
    [TASK_AGENT_FILES.plan]: PLAN_AGENTS,
  },
  patch: (task: TaskDetail, moment: Moment): TaskDetail => {
    // Until the gate opens the agent is writing and folding the review in: nothing is asked.
    if (moment !== "plan-decide" && moment !== "plan-approve") return task
    const now = Date.now()
    const items: Item[] = [
      ...(task.items ?? []),
      decision(
        1,
        "Count at the gateway, keyed by request id",
        "Every billable request passes the gateway once, with an id that survives retries.",
      ),
      decision(
        2,
        "The ledger writes each window once",
        "A window is open, closed after five minutes, and invoiced once.",
      ),
      decision(
        3,
        "Usage invoices go through the existing outbox",
        "A usage line takes the path seat invoices use, so a retry never charges twice.",
      ),
      call(moment, now),
    ]
    return {
      ...task,
      question: moment === "plan-decide" ? callQuestion(task, now) : null,
      ...(moment === "plan-approve"
        ? {
            answeredQuestions: [
              ...(task.answeredQuestions ?? []),
              {
                id: "plan-limit-call",
                number: 8,
                question: "What happens when a customer reaches their limit?",
                choice: CALL_OPTIONS[0],
                at: now - 9 * 60_000,
                via: "app" as const,
                delivered: true,
                gate: TASK_FILES.plan,
              },
            ],
          }
        : {}),
      comments: [
        ...task.comments,
        {
          id: "demo-account-pin",
          doc: TASK_FILES.plan,
          quote:
            "Finance switches an account between seats and usage on its own page, with both invoices side by side before the switch.",
          section: "Interface",
          remark: "Ask for a reason on every switch; Finance's audit needs it.",
          for: "agent",
          created: now - 60_000,
        },
      ],
      items,
      openItems: moment === "plan-decide" ? 1 : 0,
    }
  },
}
