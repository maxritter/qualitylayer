// The change of the demo task ("Usage-based billing"), top to bottom, as Verify's review page
// walkthrough draws it at the `verify` moment: eleven slices of the billing story
// with their tasks, the decisions each slice recorded and the files each slice changed, with their
// diffs (`diffs.ts`); slice 2's first file carries the person's line comment on line 5. The same view writes the three generated sections of
// the demo's 03-verify.md (the real writers), so the page, the Reader and the pull request's body
// tell one story. Illustrative content only.

import { stepsOfPoint } from "../../../core/docs/proof-list.ts"
import { proofOfPlan } from "../../../core/docs/proof-of-plan.ts"
import { laneNameOf } from "../../../core/pages/lanes.ts"
import { lineTotal } from "../../../core/review/line-counts.ts"
import type { AcceptanceAsRun, AcceptanceRow } from "../../../core/review/screen-evidence.ts"
import type {
  WalkFile,
  WalkPoint,
  WalkSlice,
  Walkthrough,
} from "../../../core/review/walkthrough.ts"
import type { Changes } from "../../api.ts"
import { FLAGSHIP_ARTIFACTS, OCTOBER_AVERAGE, OCTOBER_REQUESTS } from "../flagship.ts"
import { ACCEPTANCE_OUTPUT } from "../pictures.ts"
import { SLICE_RISKS } from "./cards.ts"
import { demoCodeDiff, demoSliceFiles, METER_PATH } from "./diffs.ts"
import { TASK_BASE_DOCUMENTS, TASK_FILES } from "./documents.ts"
import { DEMO_PLAN } from "./plan.ts"
import { FINANCE_CONFIRMATION } from "./story.ts"
import { BUILD_DECISIONS, DEMO_SLICE_COLUMNS, DONE_MEANS, SLICES } from "./story-data.ts"
import { demoLanes } from "./verify.ts"

/**
 * The billing-mode page as the build drew it, in the dark theme the review captured it in: the approved
 * design's account page with a reason typed, at 840 wide. Drawn when read, as flagship.ts may still be loading.
 */
function builtBillingMode(): string {
  const ink = "#ededed"
  const muted = "#a1a1a1"
  const line = "#2e2e2e"
  const panel = "#141414"
  const blue = "#5da3e5"
  const green = "#3ecf8e"
  const amber = "#f7b23b"
  const box = (x: number, y: number, w: number, h: number, extra = "") =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${panel}" stroke="${line}"${extra}/>`
  const text = (x: number, y: number, s: string, size = 11, fill = muted, more = "") =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}"${more}>${s}</text>`
  const bold = ' font-weight="600"'
  const end = ' text-anchor="end"'
  const kpis = [
    ["Requests in October", "138,320", "▲ 18 % on September"],
    ["Seats in use", "14 of 15", "2 added on 3 October"],
    ["November on seats", "$826.00", "the invoice it gets today"],
    ["November on usage", "$1,184.40", "+$358.40 at October's volume"],
  ]
    .map(([k, v, d], i) => {
      const x = 24 + i * 201
      return `${box(x, 104, 189, 62)}${text(x + 14, 122, k ?? "")}${text(x + 14, 146, v ?? "", 18, ink, bold)}${text(x + 14, 160, d ?? "", 10, i === 0 || i === 3 ? green : muted)}`
    })
    .join("")
  // October's bars over a 120-high plot whose top is 8,000 requests a day.
  const baseline = 340
  const scale = (n: number) => (n / 8000) * 120
  const bars = OCTOBER_REQUESTS.map((n, i) => {
    const day = (4 + i) % 7
    const h = scale(n).toFixed(1)
    return `<rect x="${(60 + i * 14.6).toFixed(1)}" y="${(baseline - scale(n)).toFixed(1)}" width="11" height="${h}" rx="2" fill="${blue}"${day === 0 || day === 6 ? ' opacity=".38"' : ""}/>`
  }).join("")
  const grid = [2000, 4000, 6000, 8000]
    .map((s) => {
      const y = (baseline - scale(s)).toFixed(1)
      return `<line x1="60" x2="512" y1="${y}" y2="${y}" stroke="${line}" stroke-dasharray="3 3"/>${text(52, Number(y) + 3, `${s / 1000}k`, 9, muted, end)}`
    })
    .join("")
  const avg = (baseline - scale(OCTOBER_AVERAGE)).toFixed(1)
  const log = [
    ["PS", "Priya Shah added 2 seats", "3 October · “two new analysts”"],
    ["LB", "Lena Brandt raised the API limit", "12 September · support ticket 4471"],
    ["DO", "Dana Ortiz switched usage to seats", "2 August · “the usage pilot ended”"],
  ]
    .map(([who, what, when], i) => {
      const y = 444 + i * 28
      return `<circle cx="572" cy="${y}" r="10" fill="#1f2b38"/>${text(572, y + 3, who ?? "", 8, ink, `${bold} text-anchor="middle"`)}${text(590, y - 1, what ?? "", 10.5, ink, bold)}${text(590, y + 12, when ?? "", 9.5)}`
    })
    .join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="840" height="552" viewBox="0 0 840 552"><rect width="840" height="552" fill="#0a0a0a"/><g font-family="system-ui,sans-serif">
<rect width="840" height="36" fill="${panel}"/><line x1="0" x2="840" y1="36" y2="36" stroke="${line}"/><rect x="24" y="11" width="14" height="14" rx="4" fill="${blue}"/>${text(46, 22, "Acme admin", 11.5, ink, bold)}${text(132, 22, "Accounts")}<rect x="190" y="9" width="50" height="19" rx="5" fill="#0a0a0a" stroke="${line}"/>${text(200, 22, "Billing", 11, ink)}${text(252, 22, "Invoices")}${text(306, 22, "Refunds")}${text(364, 22, "Audit log")}${text(790, 22, "Priya Shah · Finance", 10.5, muted, end)}<circle cx="806" cy="18" r="10" fill="#1f2b38"/>${text(806, 21, "PS", 8, ink, `${bold} text-anchor="middle"`)}
<rect x="24" y="52" width="36" height="36" rx="8" fill="#14202c" stroke="${line}"/>${text(42, 74, "NT", 12, blue, `${bold} text-anchor="middle"`)}${text(70, 68, "Northwind Traders", 16, ink, bold)}${text(70, 84, "Account 42 · Growth tier · on seats since 2 August", 10.5)}
${kpis}
${box(24, 178, 508, 178)}${text(40, 198, "Requests per day", 12, ink, bold)}${text(516, 198, "4,462 a day on average", 10, amber, end)}${grid}${bars}<line x1="60" x2="512" y1="${avg}" y2="${avg}" stroke="${amber}" stroke-width="1.5" stroke-dasharray="5 4"/><line x1="60" x2="512" y1="${baseline}" y2="${baseline}" stroke="${line}"/>
${box(24, 368, 508, 140)}${text(40, 388, "November, both ways", 12, ink, bold)}${text(516, 388, "priced at October's volume", 10, muted, end)}
<rect x="40" y="400" width="230" height="94" rx="7" fill="#0a0a0a" stroke="${line}"/>${text(54, 418, "Seats", 11, ink, bold)}${text(54, 442, "$826.00", 17, ink, bold)}<rect x="54" y="452" width="202" height="5" rx="2.5" fill="${line}"/><rect x="54" y="452" width="141" height="5" rx="2.5" fill="${muted}"/>${text(54, 478, "14 seats × $59")}${text(256, 478, "$826.00", 11, muted, end)}
<rect x="286" y="400" width="230" height="94" rx="7" fill="#0a0a0a" stroke="${blue}" stroke-width="1.5"/>${text(300, 418, "Usage", 11, ink, bold)}${text(502, 418, "from 1 November", 9.5, blue, end)}${text(300, 442, "$1,184.40", 17, ink, bold)}<rect x="300" y="452" width="202" height="5" rx="2.5" fill="${blue}"/>${text(300, 472, "Growth, 138,320 × $0.0080", 10)}${text(502, 472, "$1,106.56", 10, muted, end)}${text(300, 486, "Starter and platform fee", 10)}${text(502, 486, "$77.84", 10, muted, end)}
${box(544, 178, 272, 214)}${text(560, 198, "Billing mode", 12, ink, bold)}${text(800, 198, "Finance only", 10, muted, end)}<rect x="560" y="210" width="240" height="28" rx="6" fill="#0a0a0a" stroke="${line}"/><rect x="680" y="210" width="120" height="28" rx="6" fill="#16222e"/>${text(620, 228, "Seats", 11, ink, ' text-anchor="middle"')}${text(740, 228, "Usage", 11, blue, ' text-anchor="middle"')}
<line x1="566" x2="566" y1="252" y2="292" stroke="${line}" stroke-width="2"/><circle cx="566" cy="254" r="4" fill="${line}"/><circle cx="566" cy="284" r="4" fill="${blue}"/>${text(578, 258, "Until 31 October", 11, ink, bold)}${text(686, 258, "seats, as today", 10)}${text(578, 288, "From 1 November", 11, ink, bold)}${text(686, 288, "usage, priced by tier", 10)}
<rect x="560" y="306" width="240" height="28" rx="6" fill="#0a0a0a" stroke="${line}"/>${text(570, 324, "The customer moves to the API plan", 10.5, ink)}<rect x="560" y="344" width="104" height="28" rx="6" fill="${blue}"/>${text(612, 362, "Switch to usage", 10.5, "#0a0a0a", `${bold} text-anchor="middle"`)}${text(672, 355, "Every switch is audited:", 9.5)}${text(672, 367, "who, when and why.", 9.5)}
${box(544, 404, 272, 116)}${text(560, 422, "Audit log", 12, ink, bold)}${log}
${text(24, 540, "Illustrative built screen · demo data", 10, "#6b7079")}</g></svg>`
}

/** The agent's *Why the change* and *What a reviewer must know*, as the demo's 03-verify.md has them. */
export const DEMO_WHY =
  "API customers pay for what they use, while seat customers keep the invoices they know."
export const DEMO_MUST_KNOW = [
  "A request is counted once, at the gateway, keyed by its request id.",
  "Seat accounts do not change until Finance moves them at renewal.",
]

/** *Try it yourself*, as the agent wrote it. */
export const DEMO_TRY_IT = [
  {
    title: "A retried request is billed once",
    do: "send the same request ten times with one request id, then wait for the window to close.",
    run: "npm run replay -- --request req_8f2a --times 10",
    expect: "the ledger holds one entry and the draft invoice one usage line.",
    saw: "one entry and one line after the window closed — `evidence/it2-ledger.png`",
  },
  {
    title: "Finance moves an account at renewal",
    do: "switch an account from seats to usage on the account page as a Finance user.",
    run: null,
    expect: "the preview shows both invoices, and the switch applies at the next cycle.",
    saw: "both invoices previewed; the audit log shows the switch — `evidence/it2-invoice.png`",
  },
]
export const DEMO_NOT_VERIFIED = ["A live Stripe invoice: the runs used Stripe's test mode."]
/** The medium and low findings *Security* lists. */
export const DEMO_SECURITY = [
  "**medium:** the usage export link carries the account id.",
  "**medium:** the replay job reads the logs with a broad bucket role.",
]

/** The point Finance confirmed on its own page. */
const FINANCE_POINT = 7

/** The first file of slice 2, whose diff the page opens with. */
export const DEMO_DIFF_FILE = METER_PATH
/** The line of it the person's comment is on. */
export const DEMO_THREAD_LINE = 5

const sum = lineTotal

const slicesOf = (): WalkSlice[] =>
  SLICES.map((s) => {
    const tasks = s.tasks.map((line) => {
      const [id = "", ...title] = line.split(" ")
      return { id, title: title.join(" "), done: true }
    })
    const files = demoSliceFiles(s.n)
    return {
      n: s.n,
      title: s.title,
      summary: s.words,
      tasks,
      decisions: BUILD_DECISIONS.filter((d) => d.where === `Slice ${s.n}`).map((d) => d.what),
      files,
      additions: sum(files, "additions"),
      deletions: sum(files, "deletions"),
      commits: 1,
      ...(s.dependsOn?.length ? { dependsOn: s.dependsOn } : {}),
      ...(s.dependsReason ? { dependsReason: s.dependsReason } : {}),
      ...(s.points?.length ? { points: s.points } : {}),
      ...(SLICE_RISKS[s.n] !== undefined ? { risky: SLICE_RISKS[s.n] as string } : {}),
    }
  })

/**
 * At `verify-rechecking` the proration fix is being rechecked after your feedback.
 * The moment is read from the address, as the scans switch is in verify.ts.
 */
const FAILING_POINT = 3
const recheckRunning = (): boolean =>
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("moment") === "verify-rechecking"

const pointsOf = (): WalkPoint[] =>
  DONE_MEANS.filter((p) => !p.withdrawn).map((p): WalkPoint => {
    const base: WalkPoint = {
      n: p.n,
      outcome: p.text,
      status:
        p.n === FINANCE_POINT
          ? "confirmed by you"
          : p.n === FAILING_POINT && recheckRunning()
            ? "checking"
            : "passed",
      proof:
        p.n === FINANCE_POINT
          ? FINANCE_CONFIRMATION
          : p.n === FAILING_POINT && recheckRunning()
            ? "Illustrative proration fix: the recheck is running after your feedback"
            : "proved on the running program",
      evidence: null,
    }
    return base
  })

const DOCUMENTS_DIR = "docs/plans/usage-based-billing/"
/** A document of the plan folder by its path in the change: its lines, each one added. */
const documentLines = (path: string): string[] | undefined => {
  const text = path.startsWith(DOCUMENTS_DIR)
    ? TASK_BASE_DOCUMENTS[path.slice(DOCUMENTS_DIR.length)]
    : undefined
  return text?.replace(/\n$/, "").split("\n")
}

/** The task's documents, as the plan folder holds them in the change. */
const DEMO_DOCUMENTS: WalkFile[] = [TASK_FILES.plan, TASK_FILES.implement, TASK_FILES.verify].map(
  (name) => ({
    path: `${DOCUMENTS_DIR}${name}`,
    status: "A",
    additions: documentLines(`${DOCUMENTS_DIR}${name}`)?.length ?? 0,
    deletions: 0,
    tasks: [],
  }),
)

/**
 * The test as the Plan lists it, by Done means point: each step's action and what passes apart, a row per
 * point with its steps (a step that proves two shows under both). The run's pictures and outputs stay.
 */
function byPoint(run: AcceptanceAsRun): AcceptanceAsRun {
  const list = proofOfPlan(DEMO_PLAN)
  const steps = run.steps.map((step): AcceptanceRow => {
    const planned = list.steps.find((s) => s.id === step.id)
    return planned === undefined
      ? step
      : { ...step, text: planned.text, action: planned.action, expected: planned.expected }
  })
  return {
    ...run,
    steps,
    points: list.points.map((point) => ({
      n: point.n,
      text: point.text,
      steps: stepsOfPoint(list, point.n).flatMap((s) => steps.find((r) => r.id === s.id) ?? []),
    })),
  }
}

let cached: Walkthrough | null = null

/** The change of the demo task at the person's review. */
export function demoWalkthrough(): Walkthrough {
  if (cached !== null) return cached
  const slices = slicesOf()
  const files = slices.flatMap((s) => s.files)
  cached = {
    totals: {
      commits: slices.length,
      files: files.length,
      additions: sum(files, "additions"),
      deletions: sum(files, "deletions"),
      slices: slices.length,
      tasks: slices.reduce((n, s) => n + s.tasks.length, 0),
    },
    counted: true,
    screens: [
      {
        key: "account-billing-mode",
        width: 840,
        theme: "dark",
        outcome: "captured",
        // Captured by the same scripted run as the acceptance test below.
        mode: "scripted",
        run: "it2",
        stale: false,
        // The design the Plan approved (the billing-mode page of its Interface) beside the built page.
        artifact: {
          kind: "html",
          // Read when drawn: flagship.ts is still loading while review.ts builds this walkthrough.
          get source() {
            return (FLAGSHIP_ARTIFACTS["artifacts/billing-mode.html"] as () => string)()
          },
        },
        get built() {
          return `data:image/svg+xml,${encodeURIComponent(builtBillingMode())}`
        },
        verdict:
          "Illustrative comparison: both invoices side by side, the reason and the audit note match the design. This is demo data, not installed App evidence.",
      },
    ],
    // The Plan's acceptance test as the run that passed ran it, one step per Done means point in the Plan's words: a
    // scripted run, terminal output or a picture per step (`pictures.ts` writes them, marked illustrative).
    acceptance: byPoint({
      run: "it2",
      mode: "scripted",
      steps: [
        {
          id: "A1",
          n: 1,
          text: "**Every billable request counts exactly once.** Send one request ten times with the same id → the ledger holds one entry and the invoice one line",
          evidence: [{ file: `records/${ACCEPTANCE_OUTPUT.retry}`, kind: "output" }],
        },
        {
          id: "A2",
          n: 2,
          text: "**Usage appears within five minutes.** Send one request with a test key and read the usage API every 30 s → the Plan and limits page shows the request within five minutes",
          evidence: [{ file: `records/${ACCEPTANCE_OUTPUT.latency}`, kind: "output" }],
        },
        {
          id: "A3",
          n: 3,
          text: "**Tiered invoices prorate a mid-cycle change.** Change the plan on day 12 of a 30-day cycle with a fixed clock, then build the invoice → each part is billed at its own tiers, to the cent",
          evidence: [{ file: `records/${ACCEPTANCE_OUTPUT.proration}`, kind: "output" }],
        },
        {
          id: "A4",
          n: 4,
          text: "**Seat invoices stay unchanged.** Build last month's seat invoices again and compare them with the sent ones → no difference, byte for byte",
          evidence: [{ file: `records/${ACCEPTANCE_OUTPUT.seats}`, kind: "output" }],
        },
        {
          id: "A5",
          n: 5,
          text: "**A replay rebuilds ninety days of usage.** Run the backfill over ninety days of access logs → the dark invoices come within 0.1 % of the real ones",
          evidence: [{ file: `records/${ACCEPTANCE_OUTPUT.replay}`, kind: "output" }],
        },
        {
          id: "A6",
          n: 6,
          text: "**Gateway overhead stays below two milliseconds.** Run the gateway benchmark at 2,000 requests a second → metering adds under 2 ms at p99",
          evidence: [{ file: `records/${ACCEPTANCE_OUTPUT.overhead}`, kind: "output" }],
        },
        {
          id: "A7",
          n: 7,
          text: "**Finance controls each account's billing mode.** Open the billing mode page as support, then as Finance, and schedule a switch → the field is read-only for support; Finance sees both invoices before the switch",
          evidence: [{ file: "evidence/it2-billing-mode.png", kind: "picture" }],
        },
        {
          id: "A8",
          n: 8,
          text: "**Every invoice line traces to its usage windows.** Open a usage line on a test invoice and add up its windows → the sum equals the line",
          evidence: [{ file: `records/${ACCEPTANCE_OUTPUT.trace}`, kind: "output" }],
        },
        {
          id: "A9",
          n: 9,
          text: "**A retry storm or a Kafka outage never changes the count.** Send 1,000 retries of one request while Kafka is stopped for ten minutes → every request is answered and the count is unchanged",
          evidence: [{ file: `records/${ACCEPTANCE_OUTPUT.outage}`, kind: "output" }],
        },
        {
          id: "A10",
          n: 10,
          text: "**Customers see their use per meter against their plan limit.** Save a limit of 100 requests on the Plan and limits page → the page and the usage API show the same limit and use",
          evidence: [{ file: `records/${ACCEPTANCE_OUTPUT.limit}`, kind: "output" }],
        },
        {
          id: "A11",
          n: 11,
          text: "**Customers are alerted at 80 % of a limit.** Set a limit of 100 requests and send 86 → one alert on the page and one email",
          evidence: [{ file: `records/${ACCEPTANCE_OUTPUT.alert}`, kind: "output" }],
        },
        {
          id: "A12",
          n: 12,
          text: "**Every billing-mode switch leaves an audit entry.** Read the audit log after the switch of A7 → one entry with the old mode, the new mode, who and when",
          evidence: [{ file: `records/${ACCEPTANCE_OUTPUT.audit}`, kind: "output" }],
        },
      ],
    }),
    why: { sentence: DEMO_WHY },
    changed: [
      "A request is counted once at the gateway, then billed from the ledger.",
      "",
      "```mermaid",
      "flowchart LR",
      "  A[Gateway counts the request] --> B[Ledger adds a usage line]",
      "  B --> C[Invoice shows seats and usage]",
      "  B --> D[Finance previews both totals]",
      "```",
      "",
      "Seat invoices are unchanged; a retry never adds a second line.",
      "",
      "```mermaid",
      "sequenceDiagram",
      "  Gateway->>Ledger: request id",
      "  Ledger-->>Gateway: counted once",
      "  Ledger->>Invoice: usage line",
      "```",
    ].join("\n"),
    points: pointsOf(),
    slices,
    planDecisions: BUILD_DECISIONS.filter((d) => d.where === "The Plan").map((d) => d.what),
    decided: [],
    fixes: [],
    // The task's own documents in the diff: the workspace lists them only on request.
    documents: DEMO_DOCUMENTS,
    notDoing: {
      plan: [
        "Usage in the customer's own currency. A later task decides it.",
        "Real-time spend alerts by SMS.",
      ],
      otherFiles: ["apps/web/src/pages/pricing.tsx", "CHANGELOG.md"],
      otherCommits: ["f653125"],
    },
    checked: {
      lanes: demoLanes("yours").map((l) => ({
        id: l.id,
        name: laneNameOf(l.id),
        who: l.who,
        state: l.state,
        result: l.result,
      })),
    },
    ship: {
      branch: "feat/usage-billing",
      base: "main",
      pr: null,
      shipped: false,
    },
    columns: DEMO_SLICE_COLUMNS,
    rounds: [
      {
        n: 1,
        revision: "demo-r1",
        files: [
          METER_PATH,
          "services/invoicing/src/proration.ts",
          "tests/invoicing/proration.test.ts",
          "services/billing/src/pricing.ts",
        ],
      },
      { n: 2, revision: "demo-r2", files: [] },
    ],
  }
  return cached
}

/**
 * The checkout's change against its base, as the Files tab's card reads it: the files of the walkthrough, a
 * recording nobody could count (a large file) and the task's own plan folder, which the card leaves out.
 */
export function demoChanges(): Changes {
  const files = demoWalkthrough().slices.flatMap((s) => s.files)
  return {
    base: "demo-base",
    head: "demo-build",
    files: files.map((f) => ({
      path: f.path,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    })),
    commits: demoWalkthrough().slices.map((s) => ({
      sha: `demo${String(s.n).padStart(3, "0")}`,
      subject: s.title,
      files: s.files.map((f) => f.path),
    })),
    uncommitted: [],
    diff: "",
    untracked: ["docs/plans/usage-based-billing/02-implement.md", "assets/demo/invoice-replay.mov"],
    untrackedLines: { "docs/plans/usage-based-billing/02-implement.md": 24 },
    // A workflow task's read carries its scope, which is what lets the card publish its count (Verify's Code row).
    changeScope: { pending: [], workingFiles: [] },
  }
}

/**
 * The demo's diff of one file: the code each slice wrote (`diffs.ts`) or a document of the plan
 * folder, added whole. A path outside the change has a diff without lines.
 */
export function demoFileDiff(path: string): string {
  const code = demoCodeDiff(path)
  if (code !== undefined) return code
  const head = `diff --git a/${path} b/${path}`
  const lines = documentLines(path)
  if (lines === undefined) return [head, `--- a/${path}`, `+++ b/${path}`, ""].join("\n")
  return [
    head,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    "",
  ].join("\n")
}
