import type { ConversationEvent, ConversationSnapshot } from "../../core/conversation/types.ts"
import type { TurnChanges } from "../../core/run/turn-snapshots.ts"

type Scene = {
  request: string
  reads: string[]
  command: string
  result: string
  answer: string
  working?: boolean
  /** While it works: the file it edits after its answer, and the command it has started but not finished. */
  running?: { edit: string; command: string }
  followup?: [string, string]
  /** What the first turn changed in the worktree: a path, the lines added and removed. */
  changed?: [path: string, added: number, removed: number][]
}

/** The page's start: the first turn began 7 minutes before it and ended 5 minutes before it. */
const START = Date.now()
const ago = (seconds: number) => new Date(START - seconds * 1000).toISOString()
const TURN_BEGAN = 420
const TURN_ENDED = 300

const scenes: Record<string, Scene> = {
  formatting: {
    request: "Compare the service timeouts and summarize the follow-up.",
    reads: ["services/gateway/src/retry.ts"],
    command: "Read the timeout configuration",
    result: "Three limits found",
    answer: [
      "# Service timeouts",
      "The shortest timeout is **5 seconds**.",
      "| Service | Timeout | Source |\n| --- | --- | --- |\n| Gateway | 5 s | `services/gateway/src/retry.ts` |\n| Worker | 30 s | `services/events/src/producer.ts` |\n| SDK | 60 s | `services/invoicing/src/outbox.ts` |",
      "> Changing the retry budget also changes the time a person waits.",
      "## Follow-up",
      "3. Keep the gateway limit.\n   - Check *slow responses*.\n4. Replace the ~~unbounded retry~~ with a bounded one.",
      "- [x] Read the limits\n\n- [ ] Run the regression\n\n  Keep `services/gateway/src/provider-client-with-a-long-name.ts` in the check.",
      "[API reference](https://example.com/reference) · ![Architecture diagram](https://example.com/diagram.png)",
      "```ts\nconst timeoutMs = 5_000\nawait send({ timeoutMs })\n```",
      "---",
      "The `timeoutMs` limit was added in `9ece81d`.",
      '<button onclick="run()">Run</button>',
      "## Wide comparison",
      "| Service | Current | Proposed | Owner | Verification |\n| --- | --- | --- | --- | --- |\n| Gateway | 5 s | 5 s | Platform | `services/gateway/src/provider-client-with-a-long-name.ts` |\n| Worker | 30 s | 20 s | Operations | very-long-unbroken-reference-abcdefghijklmnopqrstuvwxyz-abcdefghijklmnopqrstuvwxyz |",
    ].join("\n\n"),
  },
  "plan-questions": {
    followup: [
      "Should a manual replay get a new delivery ID?",
      "Keep the original delivery ID so replay stays idempotent. Record each attempt separately, so support can see what happened without creating another event.",
    ],
    request: "Add reliable webhook delivery, including retries and replay.",
    reads: ["delivery/worker.ts", "retries/backoff.ts"],
    command: "qualitylayer question ask",
    result: "Four choices ready in the Plan",
    answer:
      "Five attempts is my recommendation: brief outages recover, while permanent failures stay visible for replay.\n\nThe request and the problem are in `01-plan.md`. Answer the choices in the Plan. I’ll keep each decision with the task.",
    changed: [["docs/plans/webhook-delivery/01-plan.md", 31, 0]],
  },
  plan: {
    followup: [
      "How do we prove replay cannot change an invoice?",
      "Replay the same history through the write-once ledger, then compare every invoice line with the original. The Plan includes duplicate requests, broker outages and a ninety-day replay.",
    ],
    request: "Explain how retries and replay stay safe.",
    reads: ["services/metering/emitter.ts", "reviews/plan.md"],
    command: "qualitylayer plan draft",
    result: "Plan validates",
    answer:
      "The diagram follows one request through a retry, an outage and a replay.\n\n- Request IDs survive retries.\n- The gateway never waits for Kafka.\n- Live traffic and replay use the same ledger key.\n\nBoth review findings are addressed in `01-plan.md`, committed as `9ece81d`. The Plan is ready for your approval.",
    changed: [
      ["docs/plans/usage-based-billing/01-plan.md", 18, 4],
      ["docs/plans/usage-based-billing/diagrams/retry-replay.mmd", 24, 0],
    ],
  },
  implement: {
    followup: [
      "Is the seat-billing path part of this change?",
      "Seat invoices must stay byte-identical. That regression check is on this slice’s board, alongside tier boundaries, invoice delivery and mid-cycle proration.",
    ],
    request: "Build the approved usage-billing Plan.",
    reads: ["services/invoicing/src/proration.ts", "tests/invoicing/proration.test.ts"],
    command: "bun test tests/invoicing/proration.test.ts",
    result: "12 tests passed · seat invoices unchanged",
    answer:
      "The mid-cycle invoice now prices each period at its own tier. Existing seat invoices still match their original output.\n\nI’m adding the usage-line trace in `services/invoicing/src/proration.ts` before committing this slice.",
    working: true,
    changed: [
      ["services/invoicing/src/proration.ts", 34, 6],
      ["tests/invoicing/proration.test.ts", 52, 0],
    ],
  },
  "verify-checking": {
    followup: [
      "Which part still needs a person?",
      "The Finance-only switch needs a person’s account check. In this example, a simulated question settles that answer before Verify turns to you.",
    ],
    request: "Check the completed change against every agreed point.",
    reads: ["reviews/security.md"],
    command: "bun test tests/billing/replay.test.ts",
    result: "Ninety-day replay matched · no duplicate ledger entries",
    answer:
      "Six points have passing evidence. Retry, invoicing, seat-invoice compatibility and replay checks are recorded in `agents/03-verify.md`.\n\nI’m checking invoice-line tracing now. The Finance account check is settled through a question before Verify turns to you.",
    working: true,
    changed: [["docs/plans/usage-based-billing/agents/03-verify.md", 41, 3]],
  },
  verify: {
    request: "Show me the finished change and its proof.",
    reads: ["docs/plans/usage-based-billing/03-verify.md"],
    command: "qualitylayer gate open final",
    result: "8 of 8 points settled · illustrative confirmation recorded",
    answer:
      "The change is ready for your review and approval. All eight agreed points are settled in this illustrative example, including the simulated Finance account confirmation. Opening a pull request is optional.",
  },
  "pull-request": {
    followup: [
      "What happens after the checks pass?",
      "You review and merge the pull request. I can fix failing checks, but the merge stays yours.",
    ],
    request: "Approve the change and open its pull request.",
    reads: ["docs/plans/usage-based-billing/03-verify.md"],
    command: "gh pr checks 412",
    result: "Linux and shell checks passed · macOS checks running",
    answer:
      "Pull request #412 is open. Your approval and the verification evidence stay with this task.\n\nI’m following its checks and reviews; its head is `9f3c1a7`. You keep control of the merge.",
    changed: [["docs/plans/usage-based-billing/03-verify.md", 14, 2]],
  },
  // The usage-billing task's own session at the steps where the website shows other example work
  // (docs/artifacts/demo-story.md): what the demo task's moments draw beside each step.
  "billing-plan-questions": {
    followup: [
      "How late can a usage event really arrive?",
      "Up to seven days: that is how long the meter topic keeps events, and a broker outage in March delivered some six days late. Anything older has missed its invoice, so question 3 asks what happens to it.",
    ],
    request:
      "Bill API customers for usage while keeping seat customers on the invoices they know, and keep the gateway fast.",
    reads: ["services/gateway/src/request-id.ts", "services/billing/src/price.ts"],
    command: "qualitylayer question ask",
    result: "Four questions ready in the Plan",
    answer:
      "The first question is yours to decide: about 400 accounts pay by seat today. I recommend keeping them on the invoices they know until Finance moves each one.\n\nFour questions settle what done means: existing seat customers, the free allowance, late events and currency. Three helpers read the code meanwhile; their reports go to `research/`.",
    changed: [["docs/plans/usage-based-billing/agents/01-plan.md", 38, 0]],
  },
  "billing-plan-reading": {
    followup: [
      "Can the meter slow the gateway down?",
      "Yes, every request passes through it. The reading marks that as the main risk, so the Plan has to cache each account's plan and hold metering under two milliseconds at p99.",
    ],
    request: "Trace how a billable request travels today, from the gateway to the invoice.",
    reads: ["services/gateway/src/request-id.ts", "services/ledger/src/write-once.ts"],
    command:
      "rg -n 'x-request-id|idempotencyKey' services/gateway services/ledger services/billing",
    result: "Request id, write-once ledger and invoice outbox found",
    answer:
      "The request id survives retries, so it can key the meter. The ledger already writes once per key, and invoices leave through an outbox with an idempotency key.\n\nKafka can deliver an event up to seven days late. Three helpers that never saw your request checked these findings in `research/`; the Plan builds on them next.",
    working: true,
    changed: [["docs/plans/usage-based-billing/research/r1.md", 64, 0]],
  },
  "billing-implement": {
    request: "Build the approved usage-billing Plan.",
    reads: ["services/billing/src/limits.ts", "tests/billing/limits.test.ts"],
    command: "npm test -- tests/billing/limits.test.ts",
    result: "1 failing test, as written first: a saved limit is not stored yet",
    running: {
      edit: "services/billing/src/limits.ts",
      command: "npm test -- tests/billing/limits.test.ts",
    },
    answer:
      "T15 is done: the usage API returns each meter's use against the plan limit.\n\nNow T16, saving a limit on the Plan and limits page. The failing test comes first in `tests/billing/limits.test.ts`; a limit saved mid-window applies from the next window, as decided in slice 6.",
    working: true,
    changed: [
      ["services/billing/src/limits.ts", 41, 3],
      ["tests/billing/limits.test.ts", 58, 0],
    ],
  },
  "billing-plan": {
    followup: [
      "Why is the limit question yours and not mine to decide?",
      "Because it changes what your customers' products do at the limit: blocking protects their budget but can stop them mid-month. The Plan recommends A and shows both paths.",
    ],
    request: "Turn the answers and the reading into a Plan I can approve.",
    reads: ["docs/plans/usage-based-billing/agents/01-plan.md", "reviews/plan.md"],
    command: "qualitylayer plan draft",
    result: "Plan validates · one call is yours",
    answer:
      "The Plan counts each request once at the gateway, writes each five-minute window once and sends usage lines through the existing invoice outbox.\n\nOne call is yours before you can approve: what happens when a customer reaches their limit. I recommend A, keep serving and alert at 80 % and 100 %. The Codex review is folded in: 7 taken, 1 kept, 1 asked of you.",
    changed: [["docs/plans/usage-based-billing/01-plan.md", 212, 0]],
  },
  "billing-plan-ready": {
    followup: [
      "What changed in the Plan?",
      "Your comment on the 80 % alert: alerts alone let a runaway client run up a bill. The Plan now caps the overage at 50 % of the plan and blocks after that, with a 429.",
    ],
    request: "Turn the answers and the reading into a Plan I can approve.",
    reads: ["docs/plans/usage-based-billing/01-plan.md"],
    command: "qualitylayer plan draft",
    result: "Plan validates · ready for your approval",
    answer:
      "You chose A: keep serving, bill the overage and alert at 80 % and 100 %. The Plan is ready for your approval.\n\nAfter approval, the build session cuts it into slices and builds them.",
    changed: [["docs/plans/usage-based-billing/01-plan.md", 14, 3]],
  },
  "billing-verify-checking": {
    followup: [
      "Which part still needs a person?",
      "Point 7: Finance switching an account's billing mode on the live admin. In this example, a simulated question settles that answer before Verify turns to you.",
    ],
    request: "Check the completed change against every agreed point.",
    reads: ["docs/plans/usage-based-billing/agents/02-implement.md", "reviews/security.md"],
    command: "npm run test:integration -- billing",
    result: "Run 1 of 2 · 4 of 12 points passed so far",
    answer:
      "Four of twelve points have passing evidence so far; the independent review is reading point 6 now, with the second opinion beside it.\n\nWhat fails goes to the build session as a fix round. The Finance account check is settled through a question before Verify turns to you.",
    working: true,
    changed: [["docs/plans/usage-based-billing/agents/03-verify.md", 41, 3]],
  },
  "billing-verify": {
    request: "Show me the finished change and its proof.",
    reads: ["docs/plans/usage-based-billing/03-verify.md"],
    command: "qualitylayer gate open final",
    result: "12 of 12 points settled · illustrative confirmation recorded",
    answer:
      "The change is ready for your review and approval. One fix round addressed the failures; the recheck passed.\n\nAll twelve agreed points are settled in this illustrative example, including the simulated Finance account confirmation.",
  },
  "billing-pr": {
    followup: [
      "What happens after the checks pass?",
      "You review and merge the pull request. I can fix failing checks, but the merge stays yours.",
    ],
    request: "Approve the change and open its pull request.",
    reads: ["docs/plans/usage-based-billing/03-verify.md"],
    command: "gh pr checks 412",
    result: "Typecheck and lint passed · integration tests running",
    answer:
      "Pull request #412 is open. Your approval and the verification evidence stay with this task.\n\nI’m following its checks. You keep control of the merge.",
    changed: [["docs/plans/usage-based-billing/03-verify.md", 14, 2]],
  },
  // The same session once the pull request is merged: the end of the story.
  "billing-merged": {
    followup: [
      "Is anything left for me to do?",
      "No. The branch is merged and the task is closed. Its questions, the Plan, the acceptance run and the review stay with the task, so the next change to billing can start from them.",
    ],
    request: "Merge it.",
    reads: ["docs/plans/usage-based-billing/03-verify.md"],
    command: "gh pr merge 412 --squash",
    result: "Merged into main · 5 checks passed",
    answer:
      "Pull request #412 is merged into `main`. All five checks passed.\n\nFrom your first answer in the Plan to your approval took 7 h 40 min.",
  },
  artifact: {
    followup: [
      "Can a half-moved job type run on both clients?",
      "Yes, by share: report.nightly sends 25 % of its jobs to the new client. Each job still runs on exactly one.",
    ],
    request: "Draw the queue migration console before we build it.",
    reads: ["artifacts/queue-console.html", "reviews/queue-console-feedback.md"],
    command: "qualitylayer artifact check queue-console",
    result: "Default, Loading and Error states checked",
    answer:
      "Each job type moves only after its parity check passes, and Roll back stays beside Move.\n\nA locked job type now names who must review it. The page is `artifacts/queue-console.html`.",
    changed: [["artifacts/queue-console.html", 58, 9]],
  },
}

const EXACT_SCENES: Record<string, string> = {
  "plan-q": "billing-plan-questions",
  "plan-choices": "billing-plan-questions",
  "plan-outside": "billing-plan-questions",
  "plan-small": "billing-plan-questions",
  "plan-reading": "billing-plan-reading",
  "plan-approve": "billing-plan-ready",
  now: "billing-implement",
  verify: "billing-verify",
  "verify-rechecking": "billing-verify",
  "verify-outside": "billing-verify",
  "pr-merged": "billing-merged",
}

const PREFIX_SCENES: readonly [string, string][] = [
  ["plan", "billing-plan"],
  ["impl", "billing-implement"],
  ["verify", "billing-verify-checking"],
  ["pr-", "billing-pr"],
]

/** The usage-billing session a moment (`?moment=`) draws: the one for the moment's step. */
export function storyScene(moment: string): string | undefined {
  return EXACT_SCENES[moment] ?? PREFIX_SCENES.find(([prefix]) => moment.startsWith(prefix))?.[1]
}

/** Illustrative stage-specific records, rendered by the production Conversation component. */
export function galleryConversation(
  scene: string,
): Pick<ConversationSnapshot, "events" | "state" | "workers"> | undefined {
  const base = scenes[scene === "terminal" ? "plan" : scene]
  if (!base) return undefined
  const rechecking =
    scene === "billing-verify" &&
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("moment") === "verify-rechecking"
  const value = rechecking
    ? {
        ...base,
        request: "Recheck the proration fix after my review feedback.",
        reads: ["services/invoicing/src/proration.ts"],
        command: "npm test -- tests/invoicing/proration.test.ts",
        result: "Illustrative recheck running · point 3 of 12",
        answer:
          "The proration fix is being checked after your feedback. Approval waits for the recheck; the other eleven points stay settled.",
        working: true,
      }
    : base
  const events: ConversationEvent[] = [
    {
      id: "gallery-request",
      kind: "user",
      text: value.request,
      at: ago(TURN_BEGAN),
    },
    ...value.reads.flatMap((path, i): ConversationEvent[] => [
      {
        id: `gallery-read-${i}`,
        kind: "tool",
        callId: `gallery-read-${i}`,
        name: "Read",
        tool: "read",
        target: `~/code/platform/${path}`,
      },
      {
        id: `gallery-read-${i}-result`,
        kind: "tool-result",
        callId: `gallery-read-${i}`,
        ok: true,
        summary: "Read the current source",
      },
    ]),
    {
      id: "gallery-check",
      kind: "tool",
      callId: "gallery-check",
      name: "Bash",
      tool: "qualitylayer",
      target: value.command,
    },
    {
      id: "gallery-check-result",
      kind: "tool-result",
      callId: "gallery-check",
      ok: true,
      summary: value.result,
    },
    { id: "gallery-answer", kind: "assistant", text: value.answer },
  ]
  return {
    events: [...events, ...afterAnswer(value)],
    state: value.working ? "working" : "idle",
    workers: [],
  }
}

const turnEnd = (id: string, endedAgo: number): ConversationEvent => ({
  id,
  kind: "turn-end",
  durationMs: 74_000,
  tokens: 28_000,
  at: ago(endedAgo),
})

/**
 * What follows the first answer. A follow-up means the first turn is finished: the Conversation folds
 * its work and lists what it changed. The last turn ends too, unless the agent is still at it.
 */
function afterAnswer({ followup, working, running }: Scene): ConversationEvent[] {
  const next: ConversationEvent[] = followup
    ? [
        turnEnd("gallery-first-end", TURN_ENDED),
        { id: "gallery-followup-question", kind: "user", text: followup[0], at: ago(120) },
        { id: "gallery-followup-answer", kind: "assistant", text: followup[1] },
      ]
    : []
  if (working && running)
    // The agent at work: its edit landed a moment ago, and its test run has not finished yet.
    next.push(
      {
        id: "gallery-edit",
        kind: "tool",
        callId: "gallery-edit",
        name: "Edit",
        tool: "edit",
        target: `~/code/platform/${running.edit}`,
        at: ago(25),
      },
      {
        id: "gallery-edit-result",
        kind: "tool-result",
        callId: "gallery-edit",
        ok: true,
        summary: "Updated the file",
      },
      {
        id: "gallery-run",
        kind: "tool",
        callId: "gallery-run",
        name: "Bash",
        tool: "shell",
        target: running.command,
        at: ago(8),
      },
    )
  return working ? next : [...next, turnEnd("gallery-end", followup ? 60 : TURN_ENDED)]
}

/** What the first turn of a gallery session changed, as the server's record of that turn would say. */
export function galleryTurnChanges(scene: string): TurnChanges[] {
  const files = scenes[scene === "terminal" ? "plan" : scene]?.changed
  if (!files) return []
  return [
    {
      turn: 1,
      since: ago(TURN_BEGAN + 20),
      at: ago(TURN_ENDED),
      files: files.map(([path, added, removed]) => ({
        path,
        status: removed === 0 ? ("added" as const) : ("modified" as const),
        added,
        removed,
      })),
      added: files.reduce((sum, [, added]) => sum + added, 0),
      removed: files.reduce((sum, [, , removed]) => sum + removed, 0),
      more: 0,
    },
  ]
}
