// The flagship's Plan as the agent writes it, in the order of the three-step Plan: the summary, Done
// means with its steps, the scope, the diagrams, the mockups under Interface, the approach, what was
// decided with and for the person, the prerequisites and the reviews, then the engineering decisions
// drawn from the one list the page's items also read. Its agents' file is PLAN_AGENTS_DOCUMENT.
// Every name is illustrative.

import { DEMO_DECIDED, decisionsMarkdown } from "./decisions.ts"

export const PLAN_DOCUMENT = `# Usage flows from the gateway through Kafka to the ledger, counted once

## Summary

The gateway counts each billable request once, including retries and replay. Invoices price usage by tier while seat invoices keep their current path. Customers set limits and alerts; Finance schedules billing-mode changes for the next cycle.

**Size:** about 7 slices and 23 tasks.
**Trust boundary:** metered requests and the Finance-only billing-mode switch.
**Risk:** Duplicate charges — Replaying the same usage event could charge a customer twice.
**Integrations:** Gateway, Ledger

## Done means

### 1. A retried request counts once.

A retry or a replay never adds a second charge.

| Step | Action | Expected |
|---|---|---|
| A1 | Send one request ten times with the same id | the ledger holds one entry and the invoice one line |

### 2. A broker outage loses nothing.

Requests during an outage are all counted after it.

| Step | Action | Expected |
|---|---|---|
| A2 | Stop Kafka for ten minutes while requests arrive | the count is unchanged after it starts again |

### 3. Seat invoices stay unchanged.

A seat customer gets the same invoice as before.

| Step | Action | Expected |
|---|---|---|
| A3 | Render a seat customer's invoice before and after the change | the two are identical |

### 4. Finance previews before it switches.

The account page shows both invoices before the mode changes.

| Step | Action | Expected |
|---|---|---|
| A4 | Schedule a switch as Finance on the account page | both invoices show, and the switch applies at the next cycle |

Runs as: a scripted run of the illustrative fixture over the full gateway-to-invoice path; the person-only account check is answered through a simulated question

## Scope

### In scope

- Gateway metering, usage windows and the write-once ledger
- Tiered usage lines on invoices, limits and alerts
- The Finance billing-mode switch and a ninety-day backfill

### Out of scope

- No change to seat invoices, tax handling or currencies
- The access-log pipeline stays as it is; the backfill only reads from it
- No self-serve plan purchase
- No new pricing page

## Diagrams

### A retry keeps its identity

\`\`\`mermaid
flowchart LR
  R[API request] -->|request ID| G["Gateway meter<br/>local disk buffer"]
  G -->|async| K[Kafka]
  K --> A["Deduplicate IDs<br/>5-minute windows"]
  A -->|unique window key| L[(Write-once ledger)]
  L --> O[Invoice outbox]
\`\`\`

A broker outage waits in the local buffer. Replay uses the same ledger key and the outbox retries invoice delivery.

## Interface

Customers see this month's use of each meter against their plan, pick the plan tier and set an alert at 80 %. Try the tiers and the empty and loading states.

<!-- ql:artifact artifacts/plan-limits.html -->
<!-- /ql:artifact -->

Finance moves an account from seats to usage in the admin. The change applies at the next cycle and needs a reason; the preview shows both invoices side by side.

<!-- ql:artifact artifacts/plan-editor.html -->
<!-- /ql:artifact -->

## Approach

**Chosen:** meter in the gateway, asynchronously, and count each window once in the ledger.
**Gives:** a retry or a replay never charges twice, and a broker outage never blocks a request.
**Costs:** a local disk buffer at the gateway and 1.1 ms at p99.

- **The gateway counts each billable request once.** Retries and replay reuse the request id, so a broker outage loses nothing.
- **Invoices price usage by tier.** Seat invoices keep their current path.
- **Customers set limits and alerts.** This month's use shows against each meter, with an alert at 80 %.
- **Finance schedules billing-mode changes.** A switch applies at the next cycle and needs a reason.

## Decided with you

<!-- ql:decided-by-you -->
- Plan · Meter in the gateway or from the access logs? — In the gateway, asynchronous, with a local buffer
- Plan · Where does a usage window close? — In the stream job, every 5 minutes
- Plan · What if Kafka is down? — Buffer on disk for 30 minutes, then shed and alert; never block a request
- Plan · How late may usage arrive? — Two hours of grace before an invoice finalizes
- Plan · How do seat customers move? — Finance switches them one by one, at the next cycle
<!-- /ql:decided-by-you -->

## Decisions made for you

${DEMO_DECIDED.map(([what, why]) => `- ${what} — ${why}`).join("\n")}

## Prerequisites

| # | Prerequisite | Met by | Status |
|---|---|---|---|
| P1 | Permission to run the agreed build | you, at approval | at approval |
| P2 | The backfill window | settled during planning | met: 1 July to 29 September |
| P3 | The warehouse answers a read of the access logs | the agent | met · [evidence/p3-warehouse-read.txt](evidence/p3-warehouse-read.txt) |
| P4 | Kafka accepts a test event on \`meter.events\` | the agent | met · [evidence/p4-kafka-test-event.txt](evidence/p4-kafka-test-event.txt) |

## Reviews

<!-- ql:reviews -->
Codex read the Plan: 6 findings, 5 taken, 1 kept.
<!-- /ql:reviews -->

${decisionsMarkdown()}`

/** The flagship Plan's agents' file: what the build reads first, how to start and test, the checks and the risks it accepts. */
export const PLAN_AGENTS_DOCUMENT = `# For agents: usage flows through Kafka to the ledger, counted once

## Code to imitate

- \`services/ledger/write-once.ts:30\` keys every entry; the usage entry takes the same path.

## Start and test

Run \`npm test -- services/ledger\` for one service and \`npm run test:integration -- billing\` for the path from the gateway to the ledger.

## Checks

- \`npm run typecheck\`
- \`npm test\`
- \`npm run test:integration -- billing\`

**Project checks:** \`npm run typecheck\`, \`npm test\`

## Risks

- The gateway's meter middleware, which every request passes through. Guarded by: the p99 benchmark under two milliseconds.
- The admin switch changes what an account is billed. Guarded by: the audit entry and the two-invoice preview.
`
