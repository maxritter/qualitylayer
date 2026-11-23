// Illustrative step documents for the demo's tasks other than Usage-based billing (whose own
// documents are `task/documents.ts`). Every task has the three-step layout: one Markdown file per
// step for people (01-plan.md, 02-implement.md, 03-verify.md) and one for agents beside it, written
// up to the step the task has reached. No repository is read; every service, path and number is
// made up.

import { agentFileOf, NAMES, STEPS, type Step } from "../../core/docs/names.ts"
import { limitsText } from "../../core/limits-text.ts"
import {
  type LaneRow,
  laneResult,
  stageRows,
  stagesText,
  summaryText,
} from "../../core/pages/lanes.ts"
import { when } from "../../core/pages/render.ts"
import type { Timeline } from "../../core/timeline.ts"
import { type DemoSlice, type DemoStory, renderPlan, renderPlanAgents } from "./documents-plan.ts"
import { exportTimeline, tokensTimeline, webhookTimeline } from "./timeline.ts"

export type { DemoSlice, DemoStory }

/** One task card of a story's build, in the agents' file. The first names the Plan's decision under Notes. */
function card(
  slice: DemoSlice,
  [id, title]: [string, string],
  index: number,
  design: string | null,
) {
  const file = `src/s${slice.n}-${index + 1}.ts`
  const test = `tests/s${slice.n}.test.ts`
  return [
    `#### ${id} ${title}`,
    "",
    `- **Objective:** ${title}.`,
    `- **Files:** \`${file}\`, \`${test}\``,
    ...(design === null ? [] : [`- **Notes:** follows "${design}"`]),
    `- **Test first:** \`${test}\` covers it; it fails today.`,
    `- **Done when:** ${title.toLowerCase()} · verify: \`npm test -- ${test}\``,
  ].join("\n")
}

function implement(story: DemoStory): string {
  const slices = story.slices ?? []
  const all = slices.reduce((n, s) => n + s.tasks.length, 0)
  const done = slices.reduce((n, s) => n + s.done, 0)
  const finished = slices.filter((s) => s.done === s.tasks.length).length
  return `# Implement: the build as it runs

## Summary

<!-- ql:summary -->
${summaryText([`${done} of ${all} tasks`, `${finished} of ${slices.length} slices`], `Building now: started ${when(Date.now() - 22 * 60_000)}, 22 min so far.`)}
<!-- /ql:summary -->

## Slices

<!-- ql:slices live -->
| # | Slice | In plain words | Now |
|---|---|---|---|
${slices
  .map(
    (s) =>
      `| ${s.n} | ${s.title} | ${s.words} | ${s.done === s.tasks.length ? "done" : s.done > 0 ? `task ${s.done + 1} of ${s.tasks.length}` : "next"} |`,
  )
  .join("\n")}
<!-- /ql:slices -->

## Decided while building

<!-- ql:decisions -->
- ${story.plan?.made[0] ?? "Nothing was decided beyond the Plan."}
<!-- /ql:decisions -->

## Known limits

<!-- ql:limits -->
${limitsText([])}
<!-- /ql:limits -->
`
}

/** Implement's agents' file: the slices with their cards, the proof order of a bug, the notes and the checks. */
function implementAgents(story: DemoStory, bug: boolean): string {
  const slices = story.slices ?? []
  const design = bug ? null : (story.plan?.decision[0] ?? null)
  const proof = bug ? story.plan?.proof : undefined
  return `# For agents: ${story.title}

## Task cards

${slices
  .map((s) =>
    [
      `### Slice ${s.n}: ${s.title}`,
      "",
      s.words,
      "",
      `**Validation:** ${s.validation}`,
      "",
      ...s.tasks.map((task, index) =>
        card(s, task, index, index === 0 && s.n === 1 ? design : null),
      ),
    ].join("\n\n"),
  )
  .join("\n\n")}
${
  proof === undefined
    ? ""
    : `
## Proof order

${proof.map((step, i) => `- A${i + 1} · after slice ${step.slice}`).join("\n")}
`
}
## Notes

No deviations from the approved Plan.

## Checks

${slices
  .flatMap((s) =>
    s.tasks.slice(0, s.done).map(([id]) => `- ${id} · 3f1c2a9 · \`npm test\` · exit 0 · 4.2s`),
  )
  .slice(-4)
  .join("\n")}
`
}

/** The lanes of a finished Verify of one of the smaller tasks. */
export const DONE_LANES: LaneRow[] = [
  {
    id: "security",
    who: "a fresh agent · Opus 5.5",
    state: "skipped",
    result: laneResult("skipped", []),
    why: "Does not run because the change crosses no trust boundary.",
  },
  {
    id: "checks",
    who: "QualityLayer itself · no agent",
    state: "done",
    result: laneResult("done", ["every command passed"]),
  },
  {
    id: "judge",
    who: "a fresh agent · Opus 5.5",
    state: "done",
    result: laneResult("done", ["every point proved", "2 tests added"]),
  },
  {
    id: "second",
    who: "Codex · GPT-6.1 Sol",
    state: "done",
    result: laneResult("done", ["no findings"]),
  },
]

/** Verify's people file, written as the pull request description: Why, Code, Done means as it ran, the Checks and Ship. */
function verify(story: DemoStory, openItem: string | null, ship: string): string {
  const last = story.done.length - 1
  return `# ${story.title}

## Why

${story.problem}

## Code

<!-- ql:code -->
${openItem === null ? story.done.length : story.done.length - 1} of ${story.done.length} points pass
<!-- /ql:code -->

## Done means

<!-- ql:acceptance -->
${story.done.map(([head], i) => `${i + 1}. **${head}.** ${openItem !== null && i === last ? "still open after two checking runs" : `A${i + 1} passed`}.`).join("\n")}
<!-- /ql:acceptance -->

## Checks

<!-- ql:stages -->
${stagesText(stageRows(DONE_LANES, openItem === null ? { state: "done", result: "everything checked passed" } : { state: "fail", result: "one point still open" }))}
<!-- /ql:stages -->

## Ship

<!-- ql:ship -->
${ship}
<!-- /ql:ship -->
`
}

/** Verify's agents' file: the proof, the recorded checks, the security result, the rounds, the judge's iterations and the ship steps. */
function verifyAgents(story: DemoStory, openItem: string | null, ship: string): string {
  return `# For agents: what was checked and what ships

## For the fix round

<!-- ql:fix-round -->
${openItem === null ? "Nothing to fix: every point passes." : `- **Point ${story.done.length}.** ${openItem}`}
<!-- /ql:fix-round -->

## Done means, checked

<!-- ql:proof -->
| Done means | Proof | |
|---|---|---|
${story.done.map(([head], i) => `| ${i + 1}. ${head} | acceptance A${i + 1} | ${openItem !== null && i === story.done.length - 1 ? "failed" : "passed"} |`).join("\n")}
<!-- /ql:proof -->

## Findings

<!-- ql:findings -->
None.
<!-- /ql:findings -->

## Commands

<!-- ql:checks -->
- all · 3f1c2a9 · \`npm test\` · exit 0 · 41.7s
- all · 3f1c2a9 · \`npm run typecheck\` · exit 0 · 14.0s
<!-- /ql:checks -->

## Security

Not run: the change crosses no trust boundary.

## Second opinion

<!-- ql:reviews -->
**Second opinion · Codex, GPT-6.1 Sol** · nothing found.
<!-- /ql:reviews -->

## Fix rounds

<!-- ql:fix-rounds -->
${openItem !== null ? "- Round 1 · one point still open\n- Recheck · one point still open" : "- Round 1 · one point still open\n- Recheck · everything checked passed"}
<!-- /ql:fix-rounds -->

## Verification

### Iteration 1

**Result:** fail · one point open

### Iteration 2

**Result:** ${openItem !== null ? "fail · one point still open" : "pass"}
${openItem !== null ? "\n### Iteration 3\n\n**Result:** fail · one point still open\n" : ""}
## Ship steps

${ship} The push, the merge and the deploy stay with the release session.
`
}

/** The slices a task's timeline draws, as its task cards list them. */
function slicesOf(timeline: Timeline, done: number[]): DemoSlice[] {
  return timeline.slices.map((s, i) => ({
    n: s.n,
    title: s.title,
    words: s.summary,
    tasks: s.tasks.map((t): [string, string] => [t.id, t.title]),
    validation: s.validation,
    done: done[i] ?? 0,
  }))
}

const STORIES: Record<string, DemoStory> = {
  queue: {
    title: "Queue migration",
    request:
      "Move our eleven job producers to the new queue client, and let on-call move each job type back without a deploy.",
    problem:
      "The legacy queue client is switched off next quarter. Moving all eleven producers at once cannot be undone per job type, and for payment capture a duplicate cannot be taken back.",
    done: [
      [
        "Each of the eleven producers enqueues through the JobQueue adapter",
        "No producer calls the legacy client directly.",
      ],
      ["On-call moves one job type, or back, from a panel", "No deploy is needed."],
      ["Retries stay at three attempts", "For every job type, before and after the move."],
      ["Payment capture moves last", "After a checkpoint that tries one capture."],
    ],
    notDoing: ["No change to job payloads.", "The existing dead-letter page stays."],
    decided: [
      ["How does on-call move a job type?", "A switch panel in the admin, no deploy"],
      ["When does payment capture move?", "In the last slice, with a checkpoint"],
      ["Can on-call move a type back?", "Yes, from the same panel, at any time"],
    ],
    code: [
      ["Producers", "eleven call the legacy enqueue function", "jobs/producers/"],
      ["Retries", "three attempts, set per client", "jobs/retry.ts"],
      ["Payments", "capture keys its job so a retry is not a second charge", "payments/capture.ts"],
    ],
    research: {
      summary:
        "All eleven producers enqueue through the same client. One adapter can switch each job type independently. Payment capture is the only path where a duplicate cannot be undone.",
      questions: [
        ["Where do the producers meet the queue?", "Start at the enqueue function."],
        ["What does a retry keep?", "Look at the job key."],
      ],
      findings: [
        [
          "Every producer calls one enqueue function",
          "Eleven call sites reach `jobs/enqueue.ts`, so one adapter can sit in front of all of them.",
          "each producer has a route test with a fake client",
        ],
        [
          "The job key is stable across retries",
          "The payment key does not change on a retry (`tests/payments/idempotency.test.ts`).",
          "the idempotency test; not a switch between two clients",
        ],
      ],
      risks: [
        "A duplicate capture cannot be undone.",
        "On-call runbooks assume today's retry count.",
      ],
      refs: [
        ["jobs/enqueue.ts", "the one enqueue function"],
        ["jobs/retry.ts", "retry settings"],
        ["tests/payments/idempotency.test.ts", "the capture key"],
      ],
    },
    plan: {
      summary:
        "All eleven producers call one JobQueue adapter. The adapter reads a per-type switch and forwards the payload and job key to the old or the new client, so a type can move back at any time.",
      rests: [
        "All eleven producers call one JobQueue adapter.",
        "The new client supports job keys, so the idempotency test can stay.",
      ],
      decision: [
        "Jobs move behind one adapter, switched per job type",
        "The adapter is the one place a producer enqueues a job. A switch panel in the admin moves a type to the new client or back, without a deploy.",
        "architecture",
      ],
      made: [
        "Retries: switched job types use its default of five attempts. Unswitched types keep today's behavior, so the on-call runbooks stay valid.",
        "Payment capture stays on the legacy client until the last slice, because a duplicate capture cannot be undone.",
      ],
      notDoing: [
        "Dead-letter handling is out of scope. It keeps using the existing dead-letter page.",
        "The legacy client is not removed in this task.",
      ],
      acceptance:
        "One payment capture through the new client leaves one charge, and a rollback through the panel leaves none.",
      size: "about 3 slices and 11 tasks.",
      risky: "payment capture, where a duplicate cannot be undone",
      pattern: "`jobs/enqueue.ts` keeps producer dependencies behind one interface.",
      risks: ["A switch left on the new client while a bug is found: the panel moves it back."],
      review: true,
    },
  },
  webhook: {
    title: "Webhook retries",
    request:
      "Retry a failed webhook delivery on a schedule, and show customers every attempt in the delivery log.",
    problem:
      "A webhook that fails once is lost. Customers ask support to resend it by hand, and nobody can see how many tries were made.",
    done: [
      [
        "A failed delivery is retried after 1, 5 and 30 minutes",
        "A delivery that fails twice arrives on the third attempt.",
      ],
      ["The delivery drawer lists every attempt", "With its time, status and response."],
    ],
    notDoing: ["No change to the payload or the signature.", "No retry for a 4xx answer."],
    decided: [
      ["How long between tries?", "1, 5 and 30 minutes"],
      ["Which answers are retried?", "Timeouts and 5xx; a 4xx is final"],
    ],
    code: [
      ["Delivery", "sends once and records the result", "webhooks/deliver.ts"],
      ["Delivery log", "one row per delivery, no attempts", "web/webhooks/DeliveryDrawer.tsx"],
    ],
    research: {
      summary:
        "Delivery sends once and writes one row. A queue with delayed jobs already exists, so a retry is a delayed job.",
      questions: [["Can the queue delay a job?", "Look at the options of enqueue."]],
      findings: [
        [
          "The queue supports delayed jobs",
          "`enqueue(type, payload, { delay })` schedules a job for later.",
          "delay is tested for the report job only",
        ],
      ],
      risks: ["A retry that never waits its minute floods a failing receiver."],
      refs: [["webhooks/deliver.ts", "the delivery function"]],
    },
    plan: {
      summary:
        "A failed delivery enqueues itself again with a growing delay, and each attempt is a row in the delivery log that the drawer lists.",
      rests: ["The queue can delay a job.", "A delivery row can carry an attempt count."],
      decision: [
        "A retry is a delayed job, not a loop",
        "The delivery job re-enqueues itself with a delay of 1, 5 and then 30 minutes, so nothing waits in memory.",
        "engineering",
      ],
      made: ["A delivery stops after the third retry and is marked failed."],
      notDoing: ["Customers cannot change the schedule."],
      acceptance:
        "A receiver that fails twice and then answers gets the event on the third attempt.",
      size: "about 2 slices and 4 tasks.",
      pattern: "`webhooks/deliver.ts` keeps its result writing in one place.",
      risks: ["The queue ignores the delay option for a legacy client."],
    },
    slices: slicesOf(webhookTimeline(), [3, 0]),
  },
  invoice: {
    title: "Invoice PDF totals",
    request:
      "The PDF of an invoice sometimes shows a total one cent off from the invoice page. Fix it.",
    problem:
      "An invoice with two fractional line totals differs by one cent between the PDF and the invoice page, and customers notice on their statements.",
    done: [
      ["The PDF and the page show the same total", "For every recorded invoice."],
      ["A test reproduces the difference first", "It fails before the fix and passes after."],
      ["Tax and currency tests stay green", "No other invoice changes."],
    ],
    notDoing: ["No change to how a line is rounded for display."],
    decided: [["Which total is right?", "The page's: full values summed, rounded once"]],
    code: [
      ["PDF", "sums the rounded display values", "invoicing/pdf/total.ts"],
      ["Invoice page", "sums full values and rounds once", "web/invoices/total.ts"],
    ],
    research: {
      summary:
        "The PDF sums rounded display values; the invoice page sums full values and rounds once.",
      questions: [["Where do the two totals diverge?", "Compare the two sums."]],
      findings: [
        [
          "The PDF rounds each line before summing",
          "Two lines of 10.004 show 10.00 each, so the PDF says 20.00 where the page says 20.01.",
          "no test compares the two views",
        ],
      ],
      risks: ["A shared total function touches every invoice."],
      refs: [
        ["invoicing/pdf/total.ts", "the PDF sum"],
        ["web/invoices/total.ts", "the page sum"],
      ],
    },
    plan: {
      summary: "Both views call one total function that sums full values and rounds once.",
      rests: ["The invoice page's total is the one finance signs off."],
      decision: [
        "One total function for both views",
        "The PDF and the page import the same calculation, so they cannot drift apart again.",
        "engineering",
      ],
      made: ["The PDF keeps displaying each line rounded."],
      notDoing: ["No change to tax or currency handling."],
      acceptance: "Two lines of 10.004 give 20.01 in the PDF and on the page.",
      proof: [
        {
          action: "Open the invoice with two lines of 10.004 and download its PDF",
          before: "the page shows 20.01, the PDF 20.00",
          after: "both show 20.01",
          slice: 2,
        },
        {
          action: "Run the new test on the code before the fix, then after it",
          before: "it fails by one cent",
          after: "it passes",
          slice: 1,
        },
        {
          action: "Run the tax and currency tests",
          before: "they pass",
          after: "they still pass, and no other invoice changes",
          slice: 2,
        },
      ],
      size: "about 2 slices and 4 tasks.",
      pattern: "`web/invoices/total.ts` becomes the shared module.",
      risks: ["A rounding change shows up on every future invoice."],
    },
    slices: [
      {
        n: 1,
        title: "A failing test pins the one-cent difference",
        words: "A test sums two fractional lines both ways and fails by one cent.",
        tasks: [
          ["T1", "Failing test: the PDF and the page agree on two fractional lines"],
          ["T2", "Failing test: tax and currency totals are unchanged"],
        ],
        validation: "automated: `npm test -- tests/invoicing`",
        done: 0,
      },
      {
        n: 2,
        title: "The PDF uses the page's total",
        words: "Both views call one total function.",
        tasks: [
          ["T3", "Move the total into a shared module"],
          ["T4", "Use it in the PDF"],
        ],
        validation: "automated: `npm test -- tests/invoicing`",
        done: 0,
      },
    ],
  },
  export: {
    title: "Rate-limit the export API",
    request:
      "A script that exports too fast slows the reports database. Give each API key a limit, and let support raise it.",
    problem:
      "One customer's script exported every minute and pushed the reports database's p95 from 38 ms to 240 ms for everyone.",
    done: [
      [
        "The export API refuses the 61st request in a minute",
        "It answers 429 with a Retry-After header.",
      ],
      ["A customer sees how long to wait", "The page counts down from the header."],
      ["Support raises a key's limit", "The new limit applies to the next export."],
    ],
    notDoing: ["No limit on reads other than exports."],
    decided: [
      ["What is the budget?", "60 exports a minute per key, 20 on the free plan"],
      ["Who raises a limit?", "Support, from the admin"],
    ],
    code: [
      ["Export route", "no limit today", "api/export/route.ts"],
      ["Admin", "has no limits page", "admin/keys/"],
    ],
    research: {
      summary:
        "The export route runs straight on the reports database. A limiter can wrap the route; keys already carry a plan.",
      questions: [["Where does a limit belong?", "Look at the route and the key's plan."]],
      findings: [
        [
          "Keys carry their plan",
          "`apiKey.plan` is read on every request, so the limit can come from it.",
          "plan reads are tested for billing only",
        ],
      ],
      risks: ["A limiter that counts wrongly locks a customer out."],
      refs: [["api/export/route.ts", "the export route"]],
    },
    plan: {
      summary:
        "One limiter wraps the export route. Above the key's budget the API answers 429 with Retry-After; support raises a key's limit in the admin.",
      rests: ["Keys carry their plan.", "Support already has an admin."],
      decision: [
        "A per-key budget in front of the route",
        "The limiter counts exports per key per minute and refuses above the budget, so the database never sees the burst.",
        "engineering",
      ],
      made: ["The free plan gets 20 exports a minute."],
      notDoing: ["No change to filters or CSV columns."],
      acceptance: "Sixty-one exports in a minute: the last one is refused with a Retry-After.",
      size: "about 2 slices and 4 tasks.",
      pattern: "`api/middleware/` holds every wrapper of a route.",
      risks: ["Clock edges of the minute window."],
    },
    slices: slicesOf(exportTimeline(), [2, 2]),
  },
  sso: {
    title: "SSO group sync",
    request:
      "Keep a user's groups in step with the identity provider, so removing someone from a group removes their access.",
    problem:
      "Groups are copied once at sign-up. A person removed in the identity provider keeps their access until an admin notices.",
    done: [
      ["A new group is created on the next sync", "With its members."],
      ["A removed group stops granting access", "Within one sync."],
    ],
    notDoing: ["No nested groups."],
    decided: [["How often does it sync?", "Every ten minutes, and at sign-in"]],
    code: [
      ["Sync", "runs once at sign-up", "auth/sync.ts"],
      ["Session cache", "keeps a user's groups for an hour", "auth/session.ts"],
    ],
    research: {
      summary: "Groups are read once at sign-up and cached in the session for an hour.",
      questions: [["Where do groups come from?", "Look at the sync and the session."]],
      findings: [
        [
          "The session cache holds groups for an hour",
          "`auth/session.ts` reads the groups once per session.",
          "no test removes a group",
        ],
      ],
      risks: ["Access that outlives the group."],
      refs: [["auth/sync.ts", "the sign-up sync"]],
    },
    plan: {
      summary:
        "A sync job reads the provider's groups every ten minutes and clears the session cache of anyone it changed.",
      rests: ["The provider lists a user's groups on request."],
      decision: [
        "Sync on a schedule and clear the cache",
        "A job writes the groups and clears the session cache for each changed user.",
        "security",
      ],
      made: ["A user in two groups keeps the one that stays."],
      notDoing: ["No nested groups."],
      acceptance: "A user removed from a group has no access after one sync.",
      size: "about 2 slices and 5 tasks.",
      pattern: "`auth/` keeps provider calls behind one client.",
      risks: ["A user with two groups can keep the removed one."],
    },
    slices: [
      {
        n: 1,
        title: "Groups follow the provider",
        words: "The sync creates and removes groups.",
        tasks: [
          ["T1", "Failing test: a removed group is gone after a sync"],
          ["T2", "Sync groups every ten minutes"],
        ],
        validation: "automated: `npm test -- tests/auth`",
        done: 2,
      },
      {
        n: 2,
        title: "Access follows the groups",
        words: "A changed user's session cache is cleared.",
        tasks: [
          ["T3", "Failing test: a removed group stops granting access"],
          ["T4", "Clear the session cache of a changed user"],
          ["T5", "Keep one group when a user has two"],
        ],
        validation: "automated: `npm test -- tests/auth`",
        done: 3,
      },
    ],
  },
  tokens: {
    title: "Design tokens sync",
    request:
      "Keep the app's colours in step with the Figma export, for the light and the dark theme.",
    problem:
      "Colours are copied by hand from the style guide. They drift, and the dark theme misses new tokens.",
    done: [
      ["An export lists every colour token by its CSS name", "Nested groups included."],
      ["Switching the style guide to dark changes every colour", "No colour stays behind."],
      ["No hard-coded colour is left in the app", "A lint rule keeps it so."],
    ],
    notDoing: ["No spacing or type tokens."],
    decided: [["One file or two?", "One file per theme"]],
    code: [
      ["Colours", "hard-coded in 212 places", "web/"],
      ["Style guide", "reads a hand-written css file", "tools/tokens/"],
    ],
    research: {
      summary:
        "The Figma export is a JSON file with nested groups. Nothing in the repo reads it yet.",
      questions: [["What does an export look like?", "Read a recent one."]],
      findings: [
        [
          "Groups nest at any depth",
          "The September export has `color/<mode>/<group>/<name>` for 23 tokens.",
          "no reader exists",
        ],
      ],
      risks: ["A reader that stops at two levels loses tokens."],
      refs: [["tools/tokens/", "where the reader will live"]],
    },
    plan: {
      summary:
        "A reader turns the export into CSS variables per theme, and the app reads colours only through them.",
      rests: ["The export is a plain JSON file."],
      decision: [
        "Each theme is its own file",
        "A token file per theme keeps an explicit user choice working, where a media query would not.",
        "engineering",
      ],
      made: ["The reader skips other token types and counts them."],
      notDoing: ["No spacing or type tokens."],
      acceptance: "Switching the style guide to dark changes every colour of the app.",
      size: "about 3 slices and 9 tasks.",
      pattern: "`tools/` scripts take a file path and print what they wrote.",
      risks: ["Hard-coded colours hidden in third-party widgets."],
    },
    slices: slicesOf(tokensTimeline(), [3, 2, 0]),
  },
  reindex: {
    title: "Search reindex",
    request: "Rebuild the search index when a document changes, instead of every night.",
    problem:
      "Search shows yesterday's documents until the nightly rebuild runs, and editors ask why their change is missing.",
    done: [
      ["A changed document is searchable within a minute", ""],
      ["The nightly rebuild still runs", "As a safety net."],
    ],
    notDoing: ["No change to ranking."],
    decided: [["How fresh must search be?", "Within a minute"]],
    code: [["Index", "rebuilt by one nightly job", "search/rebuild.ts"]],
  },
  pager: {
    title: "Fix: pager skips the last page",
    request: "When a listing fills whole pages exactly, the last page never shows.",
    problem:
      "When a listing fills whole pages exactly, the pager stops one page early and the last page never shows.",
    done: [
      ["A listing of 40 rows at 20 per page shows both pages", ""],
      ["A listing of 41 rows still shows three pages", ""],
      ["A listing that does not fill its last page behaves as before", ""],
    ],
    notDoing: ["No change to the page size or the key bindings."],
    decided: [["Is the page size part of this?", "No"]],
    code: [["Pager", "rounds the page count down", "cli/pager.ts"]],
    research: {
      summary: "The pager rounds the page count down and adds one only when there is a remainder.",
      questions: [["Why does a full last page vanish?", "Read the page count."]],
      findings: [
        [
          "A full last page has no remainder",
          "40 rows at 20 per page gives 2, but the loop stops at index 1.",
          "no test covers a full last page",
        ],
      ],
      risks: ["Other listings share the pager."],
      refs: [["cli/pager.ts", "the page count"]],
    },
  },
  "retry-audit": {
    title: "Queue retry audit",
    request: "Find out how every queue retry behaves today, before we change the queue client.",
    problem:
      "Nobody can say how many times a job is retried, or after how long, across the producers.",
    done: [
      ["A table lists every producer's retry count and wait", ""],
      ["Each row cites where the setting lives", ""],
    ],
    notDoing: ["No change to any retry setting."],
    decided: [["Which producers?", "All eleven"]],
    code: [
      ["Retries", "set in jobs/retry.ts", "jobs/retry.ts"],
      ["Producers", "eleven, each with its own tests", "jobs/producers/"],
    ],
    research: {
      summary: "",
      questions: [
        ["Where are retry settings read?", "Start at the retry module."],
        ["Which producers set their own?", "Read the producers' tests and the fake queue."],
      ],
      findings: [],
      risks: ["A producer that overrides the default is easy to miss."],
      refs: [["jobs/retry.ts", "retry settings"]],
      writing: true,
    },
  },
  audit: {
    title: "Audit log filters",
    request:
      "Let admins filter the audit log by actor and date range, and share a filtered view by link.",
    problem:
      "The audit log is one long list. Admins scroll for minutes to find what one person did.",
    done: [
      ["Picking an actor shows only their entries", ""],
      ["A date range includes its first and last day", ""],
      ["A filtered log opens from a copied link", "The same entries show in a new tab."],
    ],
    notDoing: ["No export of the filtered log."],
    decided: [["Where do filters live?", "In the address"]],
    code: [["Audit log", "lists every entry", "audit/filters.ts"]],
    research: {
      summary: "The log is a plain list; filters can run on the entries in memory.",
      questions: [["How many entries load?", "Look at the page size."]],
      findings: [
        [
          "The log loads 500 entries at a time",
          "Filtering in memory is fast enough for one page.",
          "no filter exists",
        ],
      ],
      risks: ["A filter that hides the newest entry."],
      refs: [["audit/filters.ts", "the list"]],
    },
    plan: {
      summary:
        "Two filters narrow the loaded entries, and both live in the address so a link shows the same entries.",
      rests: ["The log loads 500 entries at a time."],
      decision: [
        "Filters live in the address",
        "The actor and the dates are read from and written to the query string, so a copied link shows the same entries.",
        "engineering",
      ],
      made: ["A range includes both of its days."],
      notDoing: ["No export of the filtered log."],
      acceptance: "A copied link of a filtered log shows the same entries in a new tab.",
      size: "about 3 slices and 6 tasks.",
      pattern: "`audit/` keeps list logic out of components.",
      risks: ["Time zones at the edge of a day."],
    },
    slices: [
      {
        n: 1,
        title: "Filter by actor",
        words: "Pick an actor and see only their entries.",
        tasks: [
          ["T1", "Failing test: an actor filter keeps only their entries"],
          ["T2", "Filter the entries by actor"],
        ],
        validation: "Open the audit log, pick an actor and see only their entries",
        done: 2,
      },
      {
        n: 2,
        title: "Filter by date range",
        words: "Pick two dates and see only the entries between them.",
        tasks: [
          ["T3", "Failing test: a range includes its first and last day"],
          ["T4", "Filter the entries by date range"],
        ],
        validation: "Pick two dates and see only the entries between them, both days included",
        done: 2,
      },
      {
        n: 3,
        title: "Keep the filter in the address",
        words: "A copied link shows the same entries.",
        tasks: [
          ["T5", "Failing test: the address carries both filters"],
          ["T6", "Read and write the filter in the address"],
        ],
        validation:
          "Copy the address of a filtered log, open it in a new tab and see the same entries",
        done: 2,
      },
    ],
  },
  importer: {
    title: "Old report CSV import",
    request:
      "Let customers upload the CSV exports of the old reporting tool and see them as reports in the new one.",
    problem:
      "Customers who used the old reporting tool lose their history when they move, and ask us to import it.",
    done: [
      ["A CSV from the old tool imports with its column names unchanged", ""],
      ["A row the importer cannot read is listed, not dropped", ""],
      ["An import of 50,000 rows finishes in under a minute", ""],
    ],
    notDoing: ["No import of the old tool's saved views."],
    decided: [["Which formats?", "The old tool's one CSV format"]],
    code: [["Report loader", "takes rows from the new tool only", "reports/load.ts"]],
    research: {
      summary:
        "The old tool has had one export format since 2021, so a fixed column map is enough.",
      questions: [["How many formats exist?", "Compare exports from 2021 to now."]],
      findings: [
        [
          "One export format since 2021",
          "Every sample has the same header row.",
          "no importer exists",
        ],
      ],
      risks: ["A different header must be refused with a clear message."],
      refs: [["reports/load.ts", "the report loader"]],
    },
    plan: {
      summary:
        "One upload route reads the old tool's CSV with a fixed column map, writes the rows through the existing report loader and returns the unreadable rows as a download.",
      rests: ["The old tool has had one export format since 2021."],
      decision: [
        "The old tool's column map is fixed in code",
        "The importer maps its columns in a table and refuses any other header with a clear message.",
        "architecture",
      ],
      made: ["Unreadable rows come back as a download."],
      notDoing: ["The old tool's saved views are out of scope."],
      acceptance:
        "An export of 50,000 rows imports in under a minute and lists what it could not read.",
      size: "about 2 slices and 5 tasks.",
      pattern: "`reports/load.ts` stays the only writer of report rows.",
      risks: ["A header the map does not know."],
    },
    stopped:
      "The task was dropped before the build: the old tool is switched off at the end of the month, and the customers who still use it were moved by hand.",
  },
}

/** The bug the extra "bug" task of the Plan states reproduces. */
const BUG_STORY: DemoStory = {
  title: "Exports time out for large accounts",
  request:
    "An export of more than 100,000 rows times out after 30 seconds and the user gets an empty file.",
  problem:
    "An account with 120,000 rows exports to CSV: the request times out after 30 seconds and the file is empty.",
  done: [
    ["A 120,000-row export finishes and downloads", ""],
    ["A test reproduces the timeout first and passes after the fix", ""],
    ["A 50-row export is as fast as before", ""],
  ],
  notDoing: ["No change to the CSV columns or their order."],
  decided: [["How large can an export be?", "Any size"]],
  code: [["Export", "runs one database query per row", "export/rows.ts"]],
}

/** The step each task has reached, whether its Plan is still a draft, and what it holds besides. */
type Reached = {
  through: Step
  /** The Plan is still being written: the agent reads the code and asks. */
  draft?: boolean
  /** Verify ended on a point that stayed open. */
  openItem?: string
  /** The Implement documents are not written: the build waits to be started. */
  starts?: boolean
  ship?: string
  bug?: boolean
}

const REACHED: Record<string, Reached> = {
  queue: { through: "plan" },
  webhook: { through: "implement" },
  invoice: { through: "implement", starts: true, bug: true },
  export: { through: "verify", ship: "Not shipped yet. Branch `feat/export-limit`." },
  sso: {
    through: "verify",
    openItem: "A removed group still grants access after two checking runs.",
    ship: "Not shipped yet. Branch `feat/sso-group-sync`.",
  },
  tokens: { through: "implement" },
  reindex: { through: "plan", draft: true },
  pager: { through: "plan", draft: true, bug: true },
  "retry-audit": { through: "plan", draft: true },
  audit: { through: "verify", ship: "Shipped in PR #412 on `main`." },
  importer: { through: "plan" },
}

/** The demo tasks that carry documents of their own. */
export const DEMO_STORY_IDS: readonly string[] = Object.keys(REACHED)

/** The steps a task has a file for. */
export function writtenSteps(id: string): Step[] {
  const reached = REACHED[id]
  if (reached === undefined) return []
  const last = STEPS.indexOf(reached.through)
  return STEPS.filter(
    (step, index) => index <= last && !(reached.starts === true && step === "implement"),
  )
}

/** The story of a demo task, for the walkthrough of its change. */
export const storyOf = (id: string): DemoStory | undefined => STORIES[id]

/** The slices of a task's build, for the task's own card and the build log. */
export const demoSlices = (id: string): DemoSlice[] => STORIES[id]?.slices ?? []

/** The task's step documents by file name: written up to the step it has reached. */
export function storyDocuments(id: string): Record<string, string> {
  const story = STORIES[id]
  const reached = REACHED[id]
  if (story === undefined || reached === undefined) return {}
  const steps = new Set(writtenSteps(id))
  const out: Record<string, string> = {}
  const put = (step: Step, text: string, agents: string) => {
    if (!steps.has(step)) return
    out[NAMES[step]] = text
    out[agentFileOf(step)] = agents
  }
  const bug = reached.bug === true
  const ship = reached.ship ?? "Not shipped yet."
  put("plan", renderPlan(story, bug, reached.draft === true), renderPlanAgents(story, bug))
  put("implement", implement(story), implementAgents(story, bug))
  put(
    "verify",
    verify(story, reached.openItem ?? null, ship),
    verifyAgents(story, reached.openItem ?? null, ship),
  )
  if (id === "importer" && story.stopped !== undefined)
    out[NAMES.plan] = `${out[NAMES.plan] ?? ""}\n## Stopped\n\n${story.stopped}\n`
  return out
}

/** The documents of the extra bug task the Plan states add: its Plan while the agent reproduces it. */
export function bugDocuments(): Record<string, string> {
  return {
    [NAMES.plan]: renderPlan(BUG_STORY, true, true),
    [agentFileOf("plan")]: renderPlanAgents(BUG_STORY, true),
  }
}

export const PR_DESCRIPTION = `# Rate-limit the export API

Exports now share one per-account limit. A burst returns 429 with Retry-After; a later request succeeds.

## What changed

- One limiter wraps the export route.
- Existing filters and CSV columns are unchanged.
- The account page explains when the next export can run.

## Validation

- Burst scenario: 429 and Retry-After recorded.
- Separate accounts do not share a limit.
- Normal export and existing filter tests pass.

## Manual check

Try three exports in a row, wait for the displayed retry period, then export again.

All repository paths, checks and results in this demo are illustrative.`
