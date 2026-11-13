import type { BrokenArtifact, HistoryEntry, LastingArtifact } from "../../core/artifact/format.ts"
import { lastingDocOf } from "../../core/artifact/format.ts"
import type { Checklist, CheckRow } from "../../core/checklist.ts"
import { STEPS } from "../../core/docs/names.ts"
import { laneResult } from "../../core/pages/lanes.ts"
import type { ProjectLooks } from "../../core/project-look.ts"
import type { Project, TaskDetail } from "../api.ts"
import { setBranchApi } from "../start-branch.ts"
import type { WalkthroughApi } from "../timeline/walkthrough-api.ts"
import { flagshipTask } from "./flagship.ts"
import { DEMO_TASK_ID } from "./identity.ts"
import { PLAN_AGENTS_DOCUMENT, PLAN_DOCUMENT } from "./plan-doc.ts"
import { queueConsole } from "./queue-console.ts"
import { demoTask, type Moment, TASK_AGENT_FILES, TASK_FILES, taskSections } from "./task/index.ts"
import { stepPage } from "./task/page.ts"
import { FINANCE_CONFIRMATION } from "./task/story.ts"
import { demoWalkthrough } from "./task/walkthrough.ts"
import { websiteArtifact } from "./website-artifact.ts"
import {
  BILLING_PATHS,
  websiteBillingCounts,
  websiteBillingDiff,
  websiteBillingTotals,
} from "./website-diffs.ts"
import reviewPictures from "./website-review-pictures.json"

export const WEBSITE_SCENES = [
  "plan-questions",
  "plan",
  "implement-start",
  "implement",
  "verify-checking",
  "verify",
  "pull-request",
  "artifact",
  "team",
  "home",
  "setup",
  "memory",
  "artifacts",
  "artifacts-open",
] as const
export type WebsiteScene = (typeof WEBSITE_SCENES)[number]
const MOMENT: Record<WebsiteScene, Moment> = {
  "plan-questions": "plan-q",
  plan: "plan-approve",
  "implement-start": "impl-start",
  implement: "now",
  "verify-checking": "verify-checking",
  verify: "verify",
  "pull-request": "pr-open",
  artifact: "plan-approve",
  team: "plan-approve",
  home: "plan-approve",
  setup: "plan-approve",
  memory: "plan-approve",
  artifacts: "plan-approve",
  "artifacts-open": "plan-approve",
}
export const websiteScene = (search: string) =>
  WEBSITE_SCENES.find((scene) => scene === new URLSearchParams(search).get("gallery"))
export const websiteMoment = (scene: WebsiteScene | undefined) =>
  scene === undefined ? undefined : MOMENT[scene]

const OUTCOMES = [
  "Every billable request counts exactly once",
  "Usage appears within five minutes",
  "Tiered invoices prorate a mid-cycle change",
  "Seat invoices stay unchanged",
  "A replay rebuilds ninety days of usage",
  "Gateway overhead stays below two milliseconds",
  "Finance controls each account's billing mode",
  "Every invoice line traces to usage windows",
]
const SLICE_NAMES = [
  "Meter one request end to end",
  "Survive retries and broker outages",
  "Bill usage tiers with proration",
  "Let customers set plans and limits",
  "Move accounts at the next renewal",
  "Rebuild ninety days of history",
  "Review the complete change",
]
/** The tasks of each slice (23 in all); the first `SLICE_DONE` of a slice are ticked at Implement. */
const SLICE_TASKS = [
  [
    "Failing test: one request, one ledger entry",
    "Emit one meter event per billable request",
    "Key each event by its request id",
    "Close a five-minute window per account",
    "Write the window once to the ledger",
  ],
  [
    "Failing test: ten retries, one entry",
    "Drop duplicate events by request id",
    "Buffer events on disk while Kafka is down",
    "Send late events to the correction queue",
  ],
  [
    "Failing test: a mid-cycle change prorates",
    "Price usage in tiers",
    "Prorate the tier change per line",
    "Send usage lines through the invoice outbox",
  ],
  [
    "Show this month's use against the plan",
    "Save the tier and an alert at 80 %",
    "Enforce the limit at the gateway",
  ],
  ["Add a billing mode per account", "Switch at the next renewal with a reason and an audit entry"],
  [
    "Read ninety days from the warehouse",
    "Write the history through the ledger path",
    "Compare the rebuilt usage with the logs",
  ],
  ["Run the eight scenarios end to end", "Check seat invoices and gateway overhead"],
]
const SUMMARY =
  "Meter billable API requests across the gateway, Kafka, aggregation, ledger and invoicing. Reuse the ledger's write-once path and Stripe outbox. Finance moves accounts at renewal; existing seat invoices stay unchanged."
const DIAGRAM =
  "\n\n```mermaid\nflowchart LR\n  API[API client] --> GW[Gateway]\n  GW --> Kafka[Kafka: meter events]\n  Kafka --> AG[Usage aggregator]\n  AG --> Ledger[(Write-once ledger)]\n  Ledger --> Invoice[Invoice outbox]\n  Invoice --> Stripe[Stripe]\n```\n"
/** The one point only the person can confirm: no step proves it, and Verify marks it as theirs. */
const YOURS = 7
/** The points Verify has passed; the next one is being checked and the person's waits for them. */
const PASSED = 6
/** What shows under a passed point at Verify: the recorded fact that proved it. */
const PROVED = [
  "ten retries of one request leave one ledger entry",
  "a request shows in the account's usage after 3 min 40 s",
  "a mid-cycle tier change bills each part at its own rate",
  "the seat invoice is identical before and after",
  "ninety days rebuilt, within 0.1 % of the access logs",
  "1.1 ms added at p99 in the gateway benchmark",
]
/** What the person confirms for their own point, as their review words it. */
const YOURS_WHAT =
  "Signed in as Finance on the live admin, switch a test account to usage billing and back; a support login cannot see the switch."
/** The Done means steps: each proves one point, after the slice that completes it. */
const SCENARIOS: { point: number; title: string; after: number; steps: [string, string][] }[] = [
  {
    point: 1,
    title: "A retried request counts once",
    after: 2,
    steps: [
      ["Send one request ten times with the same id", "the gateway answers each"],
      ["Read the ledger", "one entry"],
    ],
  },
  {
    point: 2,
    title: "A new request shows in usage within five minutes",
    after: 2,
    steps: [
      ["Send one request and wait for its window to close", "the window closes after five minutes"],
      ["Read the account's usage", "the request is counted"],
    ],
  },
  {
    point: 3,
    title: "A mid-cycle tier change prorates",
    after: 3,
    steps: [
      ["Move an account to a higher tier on day 10", "the change is recorded for that day"],
      ["Read the invoice", "each part is billed at its own rate"],
    ],
  },
  {
    point: 4,
    title: "A seat invoice does not change",
    after: 5,
    steps: [
      ["Render a seat customer's invoice before and after the change", "both renders are created"],
      ["Compare them", "they are identical"],
    ],
  },
  {
    point: 5,
    title: "A replay rebuilds ninety days of usage",
    after: 6,
    steps: [
      ["Run the backfill over ninety days of access logs", "usage is written through the ledger"],
      ["Compare the rebuilt usage with the logs", "the difference is under 0.1 %"],
    ],
  },
  {
    point: 6,
    title: "The gateway adds under two milliseconds",
    after: 2,
    steps: [
      ["Run the gateway benchmark with metering on", "the benchmark completes"],
      ["Read the added latency at p99", "under 2 ms"],
    ],
  },
  {
    point: 8,
    title: "An invoice line traces to its usage windows",
    after: 3,
    steps: [
      ["Open a usage line on a finished invoice", "the line lists its windows"],
      ["Sum the windows", "the sum equals the line"],
    ],
  },
]
/** Verify's Done means as QualityLayer writes it from the walkthrough (`pages/sections/review.ts`). */
const reviewProofText = OUTCOMES.map((title, index) => {
  const scenarioAt = SCENARIOS.findIndex((s) => s.point === index + 1)
  const scenario = SCENARIOS[scenarioAt]
  const head = `- **${index + 1}. ${title}.**`
  return scenario === undefined
    ? `${head} Only you can confirm: ${YOURS_WHAT} · waits for your confirmation`
    : `${head} A${scenarioAt + 1}: ${scenario.title}, after slice ${scenario.after} · passed`
}).join("\n")
type PointState = "passed" | "running" | "user"
/** Each point's state at Verify: the first six passed, the person's is theirs, the last is being checked. */
const pointStateOf = (point: number): PointState =>
  point === YOURS ? "user" : point <= PASSED ? "passed" : "running"
const POINT_WORD: Record<PointState, string> = {
  passed: "passed",
  running: "checking",
  user: "yours to confirm",
}
/** The sentence under a point at Verify: the recorded proof, or why it is the person's. */
const proofOf = (point: number): string => {
  const state = pointStateOf(point)
  if (state === "user") return "it needs a Finance login on the live admin"
  return state === "passed" ? (PROVED[point - 1] ?? "") : ""
}
const proofTable = [
  "| Done means | Proof | |",
  "|---|---|---|",
  ...OUTCOMES.map(
    (title, index) =>
      `| ${index + 1}. ${title} | ${proofOf(index + 1)} | ${POINT_WORD[pointStateOf(index + 1)]} |`,
  ),
].join("\n")
/** Verify's checklist of the example: its own eight points, not the source demo's twelve. */
function billingChecklist(base: Checklist): Checklist {
  const rows = OUTCOMES.map((label, index): CheckRow => {
    const point = index + 1
    const text = proofOf(point)
    return {
      id: `done:${point}`,
      label,
      state: pointStateOf(point),
      ...(text !== "" ? { text } : {}),
    }
  })
  const counted = rows.filter((row) => row.state !== "user")
  return {
    ...base,
    groups: [{ id: "done", title: "Done means", rows }],
    total: counted.length,
    passed: counted.filter((row) => row.state === "passed").length,
    failed: 0,
    user: rows.filter((row) => row.state === "user"),
    now: [
      {
        who: "Checking · the Independent review",
        line: `point ${PASSED + 2} of ${rows.length}: ${OUTCOMES[PASSED + 1] ?? ""}`,
      },
    ],
  }
}
// The lanes in the lane grammar (rule `lane-grammar`): a state word, then at most three counted facts.
const laneRows = [
  {
    id: "checks",
    who: "QualityLayer itself",
    state: "done",
    result: laneResult("done", ["3 commands pass"]),
  },
  {
    id: "scans",
    who: "QualityLayer itself",
    state: "done",
    result: laneResult("done", ["2 findings", "1 not needed"]),
  },
  {
    id: "security",
    who: "A fresh agent · read-only",
    state: "done",
    result: laneResult("done", ["2 areas checked", "1 defect fixed"]),
  },
  {
    id: "judge",
    who: "Claude Code · Opus 5.5",
    state: "running",
    result: laneResult("running", [`point ${PASSED + 2} of ${OUTCOMES.length}`, "4 tests added"]),
  },
  {
    id: "second",
    who: "Codex · independent review",
    state: "done",
    result: laneResult("done", ["2 findings", "2 taken"]),
  },
  {
    id: "fix",
    who: "The build session",
    state: "done",
    result: laneResult("done", ["1 defect fixed"]),
  },
] as const
/** The lanes at your review, where the Independent review has finished. */
const reviewLaneRows = laneRows.map((row) =>
  row.id === "judge"
    ? {
        ...row,
        state: "done" as const,
        result: laneResult("done", ["7 of 8 points pass", "1 yours", "6 tests added"]),
      }
    : row,
)
/** The first task ID of each slice. */
const FIRST_TASK = SLICE_TASKS.map(
  (_, index) => SLICE_TASKS.slice(0, index).reduce((n, list) => n + list.length, 0) + 1,
)
/** The billing example's agents' file of Implement: each slice with its task cards. */
const BILLING_CARDS = `# For agents: build usage billing in 7 slices

## Task cards

${SLICE_TASKS.map(
  (tasks, index) =>
    `### Slice ${index + 1}: ${SLICE_NAMES[index]}

${index === 0 ? "Start with a failing end-to-end test, then connect the gateway, aggregator and ledger." : "Build against the recorded contract and prove the slice before committing."}

**Validation:** ${index === 0 ? "send one request and see one ledger entry" : "the slice's tests pass and the earlier steps still hold"}.

${tasks
  .map((task, at) => {
    const id = (FIRST_TASK[index] ?? 1) + at
    return `#### T${id} ${task}

- **Objective:** ${task}.
- **Files:** \`services/billing/t${id}.ts\`, \`tests/billing/t${id}.test.ts\`
- **Test first:** \`tests/billing/t${id}.test.ts\` fails today.
- **Done when:** ${task.toLowerCase()} · verify: \`npm test -- tests/billing/t${id}.test.ts\`
`
  })
  .join("\n")}`,
).join("\n")}
## Proof order

${SCENARIOS.map((s, index) => `- A${index + 1} · after slice ${s.after}`).join("\n")}
`
const docs: Record<string, string> = {
  [TASK_FILES.plan]: PLAN_DOCUMENT.replaceAll(
    "artifacts/plan-limits.html",
    "artifacts/plan-limits.html",
  )
    .replaceAll("artifacts/plan-editor.html", "artifacts/plan-editor.html")
    .replace(
      "Finance moves an account from seats to usage in the admin.",
      `The existing admin page gains a billing-mode choice for Finance. Illustrative wireframe:

\`\`\`wireframe
name: account-billing-mode
surface: desktop
title: Account billing mode

<div class="screen">
  <h1>Account billing</h1>
  <div class="field" id="account">Account <span class="box">Example account</span></div>
  <div class="field" id="current-mode">Current billing <span class="box">Seats</span></div>
  <div class="field" id="next-mode">Next billing cycle <span class="box">Usage</span></div>
  <div class="field" id="reason">Reason <span class="box">Finance approval required</span></div>
  <button class="primary" id="preview">Preview invoices</button>
</div>
\`\`\`

Finance moves an account from seats to usage in the admin.`,
    ),
  // The App's own Implement format: QualityLayer's summary line and live slice board between markers.
  [TASK_FILES.implement]: `# Implement: usage-based billing\n\n## Summary\n\n<!-- ql:summary -->\n11 of 23 tasks done · 2 of 7 slices finished · started 9 Oct, 09:12 · 2 h 40 min so far.\n<!-- /ql:summary -->\n\n## Slices\n\n<!-- ql:slices live -->\n| # | Slice | In plain words | Now |\n|---|---|---|---|\n${SLICE_NAMES.map((title, index) => `| ${index + 1} | ${title} | ${["One request is counted once, end to end.", "Retries and outages never change the count.", "Invoices bill usage tiers with proration.", "Customers set their plan and limits.", "Finance moves accounts at renewal.", "History is rebuilt and matches the logs.", "The whole change is reviewed together."][index]} | ${index < 2 ? "done" : index === 2 ? "task 2 of 4" : index < 5 ? "next" : "waits on 3–5"} |`).join("\n")}\n<!-- /ql:slices -->\n\n## Decided while building\n\n<!-- ql:decisions -->\n- Slice 2 · A late event older than seven days goes to the correction queue instead of the live window.\n- Slice 3 · Proration rounds to the cent per line, matching the current seat invoices.\n<!-- /ql:decisions -->\n\n## Known limits\n\n<!-- ql:limits -->\nNone.\n<!-- /ql:limits -->\n`,
  // Verify's people file, the pull request description: the checks as they ended and each point as it ran.
  [TASK_FILES.verify]: `# Usage-based billing\n\n## Why\n\nAPI traffic now determines usage charges while seat accounts keep their existing invoices.\n\n## Code\n\n<!-- ql:code -->\nAll 8 points pass · ${SLICE_NAMES.length} commits\n<!-- /ql:code -->\n\n## Diagrams\n\n${SUMMARY}\n${DIAGRAM}\n## Done means\n\n<!-- ql:acceptance -->\n${reviewProofText}\n<!-- /ql:acceptance -->\n\n## Checks\n\n<!-- ql:stages -->\n1. Checks and security · done\n2. Independent review · done\n3. Fix round · done\n4. Recheck · done\n<!-- /ql:stages -->\n\n## Ship\n\n<!-- ql:ship -->\nApprove the change, then open its pull request.\n<!-- /ql:ship -->\n`,
}

/** Verify's people file while the agents check: the Why, and the stages under way. */
const CHECKING_VERIFY = `# Usage-based billing\n\n## Why\n\nAPI traffic now determines usage charges while seat accounts keep their existing invoices.\n\n## Checks\n\n<!-- ql:stages -->\n1. Checks and security · done\n2. Independent review · running · point ${PASSED + 2} of ${OUTCOMES.length}\n3. Fix round · waiting\n4. Recheck · waiting\n<!-- /ql:stages -->\n`

/**
 * The example work as four separate projects. They sit on the demo's own project ids, so everything
 * the demo keys by project (the lasting artifacts, the drafts, the colors) stays together; the names are
 * what the pictures show.
 */
const BILLING = { id: "pay", name: "acme/billing" }
const NOTIFICATIONS = { id: "cli", name: "acme/notifications" }
const IDENTITY = { id: "web", name: "acme/identity" }
const JOBS = { id: "platform", name: "acme/jobs" }
const WORLD = [BILLING, NOTIFICATIONS, IDENTITY, JOBS]
/** The demo's own project names, as the demo's answers carry them, and what the pictures call them. */
const RENAMED: [string, string][] = [
  ["acme/payments", BILLING.name],
  ["tools/cli", NOTIFICATIONS.name],
  ["acme/web", IDENTITY.name],
  ["acme/platform", JOBS.name],
  ["Queue migration", "Retry failed receipts"],
  ["Webhook retries", "Customer quiet hours"],
  ["Fix: pager skips the last page", "Digest skips a page"],
  ["Orders keep their place", "Ordered job delivery"],
]
/** The names the demo gives its own projects. */
const DEMO_NAMES = ["acme/payments", "tools/cli", "acme/web", "acme/platform"]
/** How the projects look in the sidebar: in this order, each with a color the App allows. */
export const WEBSITE_LOOKS: ProjectLooks = {
  order: [BILLING.id, NOTIFICATIONS.id, IDENTITY.id, JOBS.id],
  projects: {
    [BILLING.id]: { label: "billing", artifacts: ["web:workflow"] },
    [NOTIFICATIONS.id]: { label: "notifications" },
    [IDENTITY.id]: { label: "identity" },
    [JOBS.id]: { label: "jobs" },
  },
}
/** The Artifacts place shows the project with the most artifacts first, so its page fills the picture with them. */
export const websiteLooks = (scene: WebsiteScene | undefined): ProjectLooks =>
  scene === "artifacts" || scene === "artifacts-open"
    ? {
        ...WEBSITE_LOOKS,
        order: [IDENTITY.id, ...WEBSITE_LOOKS.order.filter((id) => id !== IDENTITY.id)],
      }
    : WEBSITE_LOOKS
/** The project whose list is folded in the pictures: it shows what waits on the person as a count. */
export const WEBSITE_FOLDED = [IDENTITY.id]
/** Which project each of the demo's tasks belongs to here; a task not named stays where it is, one named `null` is left out. */
const HOMES: Record<string, string | null> = {
  queue: BILLING.id,
  invoice: BILLING.id,
  export: null,
  webhook: NOTIFICATIONS.id,
  pager: NOTIFICATIONS.id,
  reindex: null,
  sso: IDENTITY.id,
  tokens: IDENTITY.id,
  audit: IDENTITY.id,
  "retry-audit": JOBS.id,
  "product-brief": JOBS.id,
  importer: JOBS.id,
}
const projectOfWorld = (id: string) => WORLD.find((project) => project.id === id)

const EXAMPLE = {
  artifact: {
    title: "Review the queue migration console",
    slug: "queue-console",
    project: JOBS.id,
    name: JOBS.name,
    step: "plan",
  },
  "plan-questions": {
    title: "Deliver webhooks reliably",
    slug: "webhook-delivery",
    project: NOTIFICATIONS.id,
    name: NOTIFICATIONS.name,
    step: "plan",
  },
} as const
const EXAMPLE_DOCS: Partial<Record<WebsiteScene, string>> = {
  artifact:
    "# Queue migration console: move job types safely\n\n## Summary\n\nOperators move each job type to the new queue client after its parity check passes, and roll it back in one click. The console shows rollout progress, live numbers and why a job type is locked.\n\n## Interface\n\nOpen the queue-console artifact, try Move and Roll back, and comment before the build.\n",
  "plan-questions":
    "# Deliver webhooks reliably\n\n## Summary\n\nA durable retry queue, signed delivery attempts and an audit trail for failed webhooks, within the provider's rate limit and each customer's quiet hours.\n\n## Problem\n\nAn outage drops events today, and a retry can send the same event twice.\n\n## Done means\n\n- A provider outage keeps every event in the queue.\n- Retries preserve the delivery ID and signature.\n- Five failed attempts move an event to the dead-letter queue.\n- A replay is visible in the customer's delivery history.\n\n## Scope\n\nDurable queue, backoff policy, provider rate limits, signing and customer history.\n",
}
const VERIFY_AGENT_DOCUMENT = `# For agents: what was checked\n\n## Done means, checked\n\n<!-- ql:proof -->\n${proofTable}\n<!-- /ql:proof -->\n\n## Commands\n\n<!-- ql:checks -->\n- **Types:** passed · tsc --noEmit\n- **Integration tests:** passed · 128 tests\n- **Gateway benchmark:** passed · 1.1 ms added at p99\n<!-- /ql:checks -->\n`
const AGENT_DOCS: Record<string, string> = {
  [TASK_AGENT_FILES.plan]: PLAN_AGENTS_DOCUMENT,
  [TASK_AGENT_FILES.implement]: BILLING_CARDS,
  [TASK_AGENT_FILES.verify]: VERIFY_AGENT_DOCUMENT,
}
/** The agents' files beside the three documents of a scene. */
export const agentDocumentsFor = (_scene: WebsiteScene): Record<string, string> => AGENT_DOCS
/** The three documents the public screenshots of a scene draw from (the example tasks swap one in). */
export const documentsFor = (scene: WebsiteScene) => {
  const example = scene in EXAMPLE ? EXAMPLE[scene as keyof typeof EXAMPLE] : undefined
  if (scene === "pull-request")
    // The change was approved, so the person has confirmed their own point.
    return {
      ...docs,
      [TASK_FILES.verify]: (docs[TASK_FILES.verify] ?? "").replace(
        "waits for your confirmation",
        "confirmed by you: it works on the live admin",
      ),
    }
  if (scene === "verify-checking") return { ...docs, [TASK_FILES.verify]: CHECKING_VERIFY }
  return example ? { ...docs, [TASK_FILES[example.step]]: EXAMPLE_DOCS[scene] ?? "" } : docs
}

function billingWalkthrough(confirmed: boolean) {
  const view = structuredClone(demoWalkthrough())
  const theme =
    typeof document !== "undefined" &&
    getComputedStyle(document.documentElement).colorScheme === "dark"
      ? "dark"
      : "light"
  view.screens = Object.entries(reviewPictures.pictures).map(([name, variants]) => {
    const picture = variants[theme]
    return {
      key: name === "billing" ? "account-billing-mode" : "plan-and-limits",
      width: picture.width,
      height: picture.height,
      theme,
      outcome: "captured" as const,
      stale: false,
      built: picture.uri,
      verdict:
        name === "billing"
          ? "The invoice preview keeps the current cycle unchanged and records the reason."
          : "An invalid limit shows its error beside the field and disables Save.",
    }
  })
  const point = view.points[0]
  const slice = view.slices[0]
  if (point === undefined || slice === undefined) {
    throw new Error("The billing walkthrough needs a point and slice template")
  }
  view.why = {
    sentence:
      "API customers need usage-based billing without changing seat accounts or slowing the gateway.",
  }
  view.changed = SUMMARY
  // The live-admin point carries a simulated answer before Verify turns to the person.
  view.points = OUTCOMES.map((outcome, index) => {
    const scenarioAt = SCENARIOS.findIndex((s) => s.point === index + 1)
    const scenario = SCENARIOS[scenarioAt]
    if (scenario === undefined)
      return {
        ...point,
        n: index + 1,
        outcome,
        status: confirmed ? ("confirmed by you" as const) : ("yours to confirm" as const),
        proof: confirmed ? FINANCE_CONFIRMATION : "",
        evidence: null,
        onlyYou: {
          what: YOURS_WHAT,
          confirmed: confirmed
            ? {
                by: "you" as const,
                at: Date.UTC(2026, 9, 10, 15),
                text: FINANCE_CONFIRMATION,
              }
            : null,
        },
      }
    return {
      ...point,
      n: index + 1,
      outcome,
      status: "passed" as const,
      proof: "Checked in the example integration environment",
      evidence: null,
    }
  })
  view.slices = SLICE_NAMES.map((title, index) => {
    const path = BILLING_PATHS[index]
    if (path === undefined)
      throw new Error(`The billing walkthrough needs a path for slice ${index + 1}`)
    const { additions, deletions } = websiteBillingCounts(path)
    return {
      ...slice,
      n: index + 1,
      title,
      summary: "The approved billing contract is implemented and its example checks pass.",
      tasks: [{ id: `T${index + 1}`, title, done: true }],
      decisions: [],
      files: [{ path, status: "M", additions, deletions, tasks: [`T${index + 1}`] }],
      additions,
      deletions,
      commits: 1,
    }
  })
  // The totals are the slices' own: one commit and one file each, so no number contradicts a file row.
  view.totals = { ...websiteBillingTotals(), slices: view.slices.length, tasks: 23 }
  view.planDecisions = []
  view.decided = []
  view.fixes = []
  view.notDoing = {
    plan: ["Seat pricing, currencies and tax calculation stay as they are."],
    otherFiles: [],
    otherCommits: [],
  }
  view.checked = {
    ...view.checked,
    lanes: view.checked.lanes.map((lane, index) => ({
      ...lane,
      ...reviewLaneRows[index],
      state: "done",
    })),
  }
  view.ship = { branch: "feat/usage-billing", base: "main", pr: null, shipped: false }
  return view
}

export function websiteTask(scene: WebsiteScene): TaskDetail {
  const documents = documentsFor(scene)
  const example = scene in EXAMPLE ? EXAMPLE[scene as keyof typeof EXAMPLE] : undefined
  const moment = MOMENT[scene]
  const base = demoTask(moment)
  const built = ["implement", "verify-checking", "verify", "pull-request"].includes(scene)
  const sample = flagshipTask(
    scene === "verify-checking"
      ? "verify-checking"
      : scene === "verify" || scene === "pull-request"
        ? "verify"
        : built
          ? "implement"
          : "plan",
  )
  const task: TaskDetail = {
    ...base,
    title: example?.title ?? "Usage-based billing",
    slug: example?.slug ?? "usage-based-billing",
    answers: "app",
    project: example?.project ?? BILLING.id,
    projectName: example?.name ?? BILLING.name,
    dir:
      "/workspace/" +
      (example?.name ?? BILLING.name) +
      "/docs/plans/" +
      (example?.slug ?? "usage-based-billing"),
    branch: `feat/${example?.slug ?? "usage-billing"}`,
    helpers: [],
    timeline: sample.timeline,
    slices: sample.slices,
    quality: sample.quality,
    verification: sample.verification,
    buildLog: sample.buildLog,
    implementStart: scene === "implement-start" ? base.implementStart : sample.implementStart,
    prDescription: sample.prDescription,
    review: sample.review,
    comments: [],
    events: [],
    evidence: [],
    showMe: [],
    pages: STEPS.map((step) => stepPage(step, documents[TASK_FILES[step]] ?? null)),
  }
  // The pull request's header counts the change the review page lists, file for file.
  if (task.pullRequest) task.pullRequest = { ...task.pullRequest, stats: websiteBillingTotals() }
  // The checks the Verify page draws are the billing task's own eight points.
  if (scene === "verify-checking" && task.checklist)
    task.checklist = billingChecklist(task.checklist)
  // Pinned remarks on the queue console, in artifact pixels on the part the picture shows, as a reviewer leaves them.
  if (scene === "artifact") {
    const doc = "artifacts/queue-console.html"
    const at = Date.UTC(2026, 9, 10, 11)
    task.comments = [
      {
        id: "dc1",
        doc,
        quote: "",
        remark: "Say what rollback under 30 s means for jobs already running.",
        created: at,
        spot: { x: 472, y: 232 },
        answer: "Running jobs finish on the client that took them; the line now says so.",
        answered: at + 20 * 60_000,
      },
      {
        id: "dc2",
        doc,
        quote: "",
        remark: "Ask before moving webhook.deliver while its parity check runs.",
        created: at + 5 * 60_000,
        spot: { x: 352, y: 172 },
      },
      {
        id: "dc3",
        doc,
        quote: "",
        remark: "Show the jobs behind this dead-letter count.",
        created: at + 9 * 60_000,
        spot: { x: 430, y: 462 },
      },
    ]
  }
  // The billing build's own place, so the sidebar and the slice board tell the same story.
  if (task.live?.progress) {
    task.live.progress = {
      ...task.live.progress,
      slices: 7,
      slice: { n: 3, at: 3 },
      task: { id: "T12", at: 3, of: 4 },
      done: 11,
      total: 23,
      words: {
        place: "slice 3 of 7 · task 3 of 4 (T12)",
      },
    }
  }
  if (scene === "plan-questions" && task.batch && task.question) {
    task.batch = {
      ...task.batch,
      title: "Delivery and retries",
      ahead: "Four decisions before the Plan is written",
      members: task.batch.members.map((member, index) => ({
        ...member,
        text:
          [
            "How many failed attempts before an event stops retrying?",
            "What should happen during a provider outage?",
            "Should retries respect the customer's quiet hours?",
            "Who can replay an event from the dead-letter queue?",
          ][index] ?? member.text,
      })),
    }
    task.question = {
      ...task.question,
      question: "How many failed attempts before an event stops retrying?",
      why: "Transient outages need another attempt. A permanent failure must not fill the queue forever, and the customer needs a clear delivery history.",
      choices: [
        { label: "Five attempts, then the dead-letter queue" },
        { label: "Three attempts, then stop" },
        { label: "Keep retrying until it succeeds" },
      ],
      recommended: 0,
    }
  } else {
    task.items =
      scene === "verify"
        ? [
            {
              id: "verify:result:billing",
              step: "verify",
              family: "look",
              kind: "result",
              kindLabel: "Look at the result",
              what: "Account billing at the next renewal",
              why: "Browser capture of the fictional billing project. Check the invoice preview, effective date and recorded reason.",
              media: {
                kind: "screenshot",
                name: "evidence/gallery-account-billing.png",
                caption: "Captured billing screen · next-cycle invoice preview",
              },
              answers: {
                options: ["agree", "change"],
                labels: { agree: "Looks right", change: "Change" },
              },
              blocking: true,
              state: "open",
            },
            {
              id: "verify:confirm:finance",
              step: "verify",
              family: "confirm",
              kind: "confirm",
              kindLabel: "Only you can confirm",
              what: OUTCOMES[6] ?? "Finance controls billing mode",
              why: YOURS_WHAT,
              answers: { options: ["confirm", "record"] },
              blocking: true,
              state: "settled",
              answer: {
                kind: "confirm",
                note: FINANCE_CONFIRMATION,
                at: Date.UTC(2026, 9, 10, 15),
              },
            },
          ]
        : []
    task.openItems = task.items.filter((item) => item.state === "open").length
    task.batch = null
    task.question = null
    if (scene !== "verify" && scene !== "pull-request") task.answeredQuestions = []
  }
  return JSON.parse(JSON.stringify(task)) as TaskDetail
}

export function websiteGalleryApi(
  api: WalkthroughApi,
  scene: WebsiteScene | undefined,
): WalkthroughApi {
  if (scene === undefined) return api
  const documents = documentsFor(scene)
  /** A task of the demo, in the project the example work gives it. */
  const rehomed = <T extends { id: string; project: string; projectName: string }>(row: T): T => {
    const home = projectOfWorld(HOMES[row.id] ?? row.project)
    if (home === undefined) return row
    // The folder it lives in follows: its documents' paths and the checkout name the project.
    let text = JSON.stringify(row)
    for (const old of DEMO_NAMES) text = text.replaceAll(old, home.name)
    return { ...(JSON.parse(text) as T), project: home.id, projectName: home.name }
  }
  const task = rehomed(websiteTask(scene))
  let branch = {
    branch: `feat/${task.slug}`,
    base: "main",
    onBase: false,
    suggested: `ql/${task.slug}`,
  }
  setBranchApi({
    read: async () => ({ ...branch }),
    create: async (_id, name) => {
      branch = { ...branch, branch: name ?? branch.suggested }
      return { ...branch }
    },
  })
  const artifact = {
    file: scene === "artifact" ? "artifacts/queue-console.html" : "artifacts/plan-limits.html",
    name: scene === "artifact" ? "queue-console" : "plan-limits",
    scope: "task" as const,
    title: scene === "artifact" ? "Queue migration console" : "Plan and limits",
    purpose:
      scene === "artifact"
        ? "Move job types to the new queue client one at a time, with rollback one click away"
        : "Choose usage limits and alert thresholds",
    changed:
      scene === "artifact"
        ? "A locked job type names who must review it"
        : "Invalid limits show an error beside the field and keep Save disabled",
    updated: Date.UTC(2026, 9, 10, 9),
    sections: [],
    width: 760,
    thumb: null,
    comments: 0,
    inPlan: true as const,
  }
  const localLibrary = scene === "artifacts" || scene === "artifacts-open"
  const pageTitles: Record<string, string> = {
    "index.html": "Plan and limits",
    "settings.html": "Billing mode",
    "verify.html": "Invoice preview",
  }
  const historySubjects = [
    "artifact: clarify the rollout review",
    "artifact: update the operations overview",
    "Keep the Operations App Model as a local artifact",
  ]
  const localHistory = (entries: HistoryEntry[]) =>
    entries.map((entry, i) => ({ ...entry, subject: historySubjects[i] ?? entry.subject }))
  const localArtifact = (
    entry: LastingArtifact | BrokenArtifact,
  ): LastingArtifact | BrokenArtifact => {
    if (!("pages" in entry)) return entry
    const artifact = { ...entry }
    delete artifact.claudeDesign
    if (artifact.name !== "app-model") return artifact
    return {
      ...artifact,
      title: "Operations App Model",
      purpose:
        "An illustrative local artifact for account limits, billing mode and invoice previews.",
      pages: artifact.pages.map((page) => ({
        ...page,
        title: pageTitles[page.page] ?? page.title,
      })),
      lastChange: artifact.lastChange
        ? { ...artifact.lastChange, subject: historySubjects[0] ?? artifact.lastChange.subject }
        : null,
    }
  }
  const gallery: WalkthroughApi = {
    ...api,
    fileDiff: async (id, path) =>
      (id === DEMO_TASK_ID ? websiteBillingDiff(path) : undefined) ?? api.fileDiff(id, path),
    ...(scene === "verify" ? { currentTurnLayout: true as const } : {}),
    evidence: async (id, name) => {
      if (id !== DEMO_TASK_ID || name !== "evidence/gallery-account-billing.png")
        return api.evidence(id, name)
      const built = billingWalkthrough(scene === "verify" || scene === "pull-request").screens?.[0]
        ?.built
      if (!built?.startsWith("data:image/png;base64,"))
        throw new Error("Missing illustrative billing screen")
      return {
        name,
        kind: "image",
        type: "image/png",
        base64: built.slice(built.indexOf(",") + 1),
      }
    },
    projects: async () =>
      WORLD.map(
        ({ id, name }): Project => ({
          id,
          name,
          paths: [`/workspace/${name}`],
          lastSeen: 0,
        }),
      ),
    tasks: async () =>
      (await api.tasks())
        // The rows the website's projects have no room for stay off the public screenshots.
        .filter((row) => HOMES[row.id] !== null)
        .map((row) => rehomed(row.id === DEMO_TASK_ID ? task : row)),
    task: async (id) => (id === DEMO_TASK_ID ? structuredClone(task) : rehomed(await api.task(id))),
    walkthrough: async (id) => {
      if (id === DEMO_TASK_ID)
        return billingWalkthrough(scene === "verify" || scene === "pull-request")
      if (api.walkthrough) return api.walkthrough(id)
      throw new Error("This demo task has no recorded walkthrough")
    },
    doc: async (id, name) =>
      id === DEMO_TASK_ID && documents[name]
        ? { name, markdown: documents[name], validation: { valid: true, errors: [] } }
        : api.doc(id, name),
    // Cut by the schema's rules, as the server cuts a task's document, so each section is drawn,
    // folded or left to the Reader as it is on a real task.
    sections: async (id, name) => {
      const markdown = documents[name]
      if (id !== DEMO_TASK_ID || !markdown) return api.sections(id, name)
      const cut = taskSections(name, markdown, task.type)
      if (cut === undefined) throw new Error(`${name} does not exist yet`)
      return cut
    },
    homeFacts: async (scope) => {
      const facts = await api.homeFacts(scope)
      return JSON.parse(JSON.stringify(facts).replaceAll("Usage-based billing", task.title))
    },
    taskArtifacts: async (id) =>
      id === DEMO_TASK_ID
        ? { task: [artifact], projectId: task.project, projectName: task.projectName }
        : api.taskArtifacts(id),
    artifactsOverview: async () => {
      const overview = await api.artifactsOverview()
      if (!localLibrary) return overview
      return {
        projects: overview.projects.map((project) => ({
          ...project,
          lasting: project.lasting.map(localArtifact),
          also: project.also.map((entry) => ({
            ...entry,
            artifact: localArtifact(entry.artifact) as LastingArtifact,
          })),
        })),
      }
    },
    lastingHistory: async (project, name) => {
      const history = await api.lastingHistory(project, name)
      return localLibrary && project === "web" && name === "app-model"
        ? { ...history, entries: localHistory(history.entries) }
        : history
    },
    artifactPage: async (where, file) => {
      const registered = lastingDocOf(file)
      if (
        localLibrary &&
        where.scope === "project" &&
        where.id === "web" &&
        registered?.name === "app-model" &&
        registered.page in pageTitles
      )
        return websiteArtifact(registered.page)
      return where.id === DEMO_TASK_ID
        ? scene === "artifact"
          ? queueConsole()
          : api.artifact(DEMO_TASK_ID, file)
        : api.artifactPage(where, file)
    },
  }
  return new Proxy(gallery, {
    get(target, key) {
      const method = Reflect.get(target, key)
      if (typeof method !== "function") return method
      return async (...args: unknown[]) => {
        const value = await method(...args)
        if (
          value === undefined ||
          value === null ||
          (typeof value === "object" &&
            !Array.isArray(value) &&
            Object.getPrototypeOf(value) !== Object.prototype)
        )
          return value
        let text = JSON.stringify(value)
          .replaceAll("usage-based-billing", task.slug)
          .replaceAll("Usage-based billing", task.title)
        // Whole values only: a project's or task's name, never a part of a longer text.
        for (const [from, to] of RENAMED)
          text = text.replaceAll(JSON.stringify(from), JSON.stringify(to))
        return JSON.parse(text)
      }
    },
  })
}
