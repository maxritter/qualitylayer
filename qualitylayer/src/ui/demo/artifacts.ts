import { DEMO_TASK_ID } from "./identity.ts"
// The demo's lasting artifacts: an App Model, a Workflow and a Website kept by one project (the App Model
// is changing in two open tasks), a second project with one lasting artifact and a draft, and a project
// with none. Everything lives in memory: Keep adds an artifact, Fold in lands pages in one and moves its
// last change; a reset brings it back. The pages are small interactive documents so the source demo
// clicks through (a counter, a switch, links between the pages of an artifact); the bridge the server
// would add is added here, so the frame behaves as the App's does.

import {
  type AlsoArtifact,
  type Artifact,
  type ArtifactsOverview,
  type DraftEntry,
  type DraftOn,
  type FoldConflict,
  type FoldPage,
  type FoldPreview,
  type FoldResult,
  folderArtifactOf,
  type HistoryEntry,
  type KeepResult,
  type LastingArtifact,
  lastingDoc,
  lastingDocOf,
  type ProjectArtifacts,
  type TaskMark,
} from "../../core/artifact/format.ts"
import type { LibraryMutation, LibraryResult } from "../../core/artifact/library-manage.ts"
import type { ProjectLooks } from "../../core/project-look.ts"
import { withBridge } from "../../server/artifact-bridge.ts"
import {
  ApiError,
  type DraftedOn,
  type DraftOnRequest,
  type FoldRequest,
  type KeepRequest,
  type NewArtifactRequest,
  type Project,
} from "../api.ts"
import { artifactThumb, type ThumbKind } from "./artifact-thumbs.ts"
import { BACKEND_PAGES } from "./backend-artifact.ts"
import { FLAGSHIP_ARTIFACTS } from "./flagship.ts"

const DAY = 86_400_000

type Page = { page: string; title: string }
type DemoLasting = {
  project: string
  name: string
  title: string
  purpose: string
  pages: Page[]
  claudeDesign?: string
  history: HistoryEntry[]
  /** The draft it was kept from (`<task>/<draft>`): that draft begins from it, so it changes nothing. */
  from?: string
  /** Library management (archive, delete, restore, rename, copy) as the guarded route keeps it. */
  archivedAt?: number
  deletedAt?: number
  /** Bumped by every managed change, so a stale manager revision is refused. */
  rev?: number
}

/** A 64-hex stamp for the demo, shaped like the server's manager revision. */
function stamp(text: string): string {
  let out = ""
  for (let salt = 0; salt < 8; salt += 1) {
    let h = 0x811c9dc5 ^ salt
    for (const ch of `${salt}:${text}`) {
      h ^= ch.charCodeAt(0)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    out += h.toString(16).padStart(8, "0")
  }
  return out
}
type DemoDraft = {
  project: string
  task: string
  name: string
  title: string
  purpose: string
  pages: Page[]
  draftOn?: DraftOn
  /** The pages it changes, by design page, and the files each brings. */
  changes: { page: string; status: FoldPage["status"] }[]
}

/** The drawing an artifact or a draft gets, by its name; a page of a known kind overrides it. */
const NAME_KIND: Record<string, ThumbKind> = {
  "app-model": "app",
  workflow: "flow",
  website: "site",
  checkout: "form",
  "old-sketch": "app",
  "sso-settings": "settings",
  "tokens-app": "app",
  "receipt-retry": "form",
  "queue-sketch": "flow",
  "billing-admin": "settings",
  "customer-portal": "site",
  "marketing-site": "site",
  "design-system": "app",
}
const PAGE_KIND: Record<string, ThumbKind> = {
  settings: "settings",
  receipt: "form",
  payment: "form",
  pricing: "site",
  "billing-mode": "settings",
  "usage-invoice": "form",
  "plan-limits": "settings",
}
const thumbFor = (name: string, page = "index.html") =>
  artifactThumb(PAGE_KIND[page.replace(/\.html$/, "")] ?? NAME_KIND[name] ?? "app")

const SHA = (n: number) => `${(0xa1b2c3d4 + n * 0x01010101).toString(16)}`.slice(-8)

const commit = (n: number) => `${SHA(n)}0000000000000000000000000000000000`.slice(0, 40)

/**
 * The story's Library (`?story`): acme/platform keeps the billing admin and the customer portal, which the
 * billing task is changing, with the real pages the Plan shows; the website keeps its marketing site and
 * design system. Nothing of QualityLayer's own models appears in the example company's day.
 */
function storySeed(now: number) {
  const HOUR = 3_600_000
  let n = 20
  /** A lasting artifact of the story: its pages by title (the first is index.html unless named), changed `ago` ms back. */
  const kept = (
    project: string,
    name: string,
    title: string,
    purpose: string,
    pages: (string | Page)[],
    ago: number,
    subject: string,
  ): DemoLasting => ({
    project,
    name,
    title,
    purpose,
    pages: pages.map((p, i) =>
      typeof p === "string"
        ? {
            page: i === 0 ? "index.html" : `${p.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.html`,
            title: p,
          }
        : p,
    ),
    history: [
      { sha: commit(n++), at: now - ago, subject },
      {
        sha: commit(n++),
        at: now - ago - 9 * DAY,
        subject: `Keep the ${title.toLowerCase()} as a lasting artifact`,
      },
    ],
  })
  const lasting: DemoLasting[] = [
    kept(
      "platform",
      "platform-backend",
      "Backend",
      "The services behind every API request: what runs where, what each store keeps, who may call what.",
      [
        { page: "index.html", title: "Backend · acme/platform" },
        { page: "data.html", title: "Data and retention" },
      ],
      3 * HOUR,
      "Add the meter and the usage ledger to the backend",
    ),
    kept(
      "platform",
      "billing-admin",
      "Billing admin",
      "What Finance sees for each account: its billing mode, the invoice it gets, refunds and the audit log.",
      [
        { page: "billing-mode.html", title: "Billing mode" },
        { page: "usage-invoice.html", title: "Usage invoice" },
        "Accounts",
        "Refunds",
        "Audit log",
        "Plans",
      ],
      2 * DAY,
      "Add the invoice preview to the account page",
    ),
    kept(
      "platform",
      "customer-portal",
      "Customer portal",
      "What a customer sees of their plan, their use, their limits and their invoices.",
      [{ page: "plan-limits.html", title: "Plan and limits" }, "Usage", "Invoices", "API keys"],
      5 * DAY,
      "Show API keys per environment",
    ),
    kept(
      "platform",
      "api-reference",
      "API reference",
      "Every public endpoint with its request, its answer and its errors, generated from the gateway's routes.",
      [
        "Overview",
        "Authentication",
        "Accounts",
        "Usage",
        "Limits",
        "Invoices",
        "Webhooks",
        "Errors",
        "Rate limits",
        "Pagination",
        "Idempotency",
        "Changelog",
        "SDKs",
        "Events",
        "Plans",
        "Keys",
        "Regions",
        "Status",
      ],
      7 * HOUR,
      "Document the usage and limits endpoints",
    ),
    kept(
      "platform",
      "gateway-runbook",
      "Gateway runbook",
      "What on-call does when the gateway slows down, a region fails or Kafka lags.",
      ["Overview", "Slow requests", "Region failover", "Kafka lag", "Rollback"],
      4 * DAY,
      "Add the Kafka lag steps",
    ),
    kept(
      "platform",
      "usage-launch",
      "Usage billing launch",
      "Who is moved when, what Finance checks first, and how a customer is told.",
      ["Timeline", "Finance checklist", "Customer e-mails"],
      26 * HOUR,
      "Move the first accounts to 1 November",
    ),
    kept(
      "platform",
      "onboarding-emails",
      "Onboarding e-mails",
      "The seven e-mails a new account gets in its first month.",
      [
        "Welcome",
        "First key",
        "First request",
        "Invite the team",
        "Usage report",
        "Limits",
        "Upgrade",
      ],
      8 * DAY,
      "Shorten the first-key e-mail",
    ),
    kept(
      "platform",
      "status-page",
      "Status page",
      "What customers see during an incident, per region and per service.",
      ["Status", "Incident"],
      11 * DAY,
      "Add the per-region view",
    ),
    kept(
      "platform",
      "admin-search",
      "Admin search",
      "Finding an account by name, key, invoice or request id.",
      ["Search", "Results", "Account card"],
      13 * DAY,
      "Search by request id",
    ),
    kept(
      "platform",
      "partner-portal",
      "Partner portal",
      "What resellers see of the accounts they manage.",
      ["Accounts", "Payouts"],
      16 * DAY,
      "Draw the payouts page",
    ),
    kept(
      "pay",
      "checkout",
      "Checkout",
      "The payment form, its receipt and the retry screen.",
      [
        { page: "index.html", title: "Payment" },
        { page: "receipt.html", title: "Receipt" },
        "Retry",
      ],
      5 * DAY,
      "Add the retry screen",
    ),
    kept(
      "pay",
      "payouts-dashboard",
      "Payouts dashboard",
      "Balances, payouts and the reconciliation report.",
      ["Balances", "Payouts", "Reconciliation", "Exports"],
      3 * DAY,
      "Add the reconciliation report",
    ),
    kept(
      "pay",
      "dunning-emails",
      "Dunning e-mails",
      "The reminders a failed payment sends, in order.",
      ["First reminder", "Second reminder", "Last notice", "Paused", "Recovered"],
      9 * DAY,
      "Soften the last notice",
    ),
    kept(
      "web",
      "design-system",
      "Design system",
      "Colours, type and the shared components, light and dark.",
      [
        "Components",
        "Colours",
        "Type",
        "Buttons",
        "Forms",
        "Tables",
        "Charts",
        "Usage bar",
        "Empty states",
        "Icons",
        "Spacing",
        "Motion",
        "Dark theme",
        "Tokens",
        "Layout",
        "Dialogs",
        "Menus",
        "Toasts",
        "Badges",
        "Cards",
        "Navigation",
        "Tabs",
        "Avatars",
        "Code",
      ],
      30 * HOUR,
      "Add the usage bar component",
    ),
    kept(
      "web",
      "marketing-site",
      "Marketing site",
      "Home, pricing and the product pages, as visitors see them.",
      [
        { page: "index.html", title: "Home" },
        { page: "pricing.html", title: "Pricing" },
        "Usage billing",
        "Customers",
        "Security",
        "Changelog",
        "Contact",
        "About",
        "Careers",
        "Press",
        "Legal",
        "Status",
      ],
      6 * DAY,
      "Add the usage tiers to pricing",
    ),
    kept(
      "web",
      "docs-site",
      "Docs",
      "The getting-started guide and the concepts, with screenshots.",
      [
        "Getting started",
        "Keys",
        "Usage",
        "Limits",
        "Invoices",
        "Webhooks",
        "SDKs",
        "Errors",
        "Glossary",
      ],
      2 * DAY,
      "Explain usage windows",
    ),
  ]
  // The billing task draws on both: its Plan's Interface shows these pages as they will be.
  const drafts: DemoDraft[] = [
    {
      project: "platform",
      task: DEMO_TASK_ID,
      name: "billing-admin-usage",
      title: "Billing admin with usage",
      purpose: "The billing-mode switch and the invoice with usage lines.",
      pages: [
        { page: "billing-mode.html", title: "Billing mode" },
        { page: "usage-invoice.html", title: "Usage invoice" },
      ],
      draftOn: { artifact: "billing-admin", project: "platform" },
      changes: [
        { page: "billing-mode.html", status: "changed" },
        { page: "usage-invoice.html", status: "changed" },
      ],
    },
    {
      project: "platform",
      task: DEMO_TASK_ID,
      name: "portal-limits",
      title: "Plan and limits with usage",
      purpose: "Use against the limits, and the alerts at 80 % and 100 %.",
      pages: [{ page: "plan-limits.html", title: "Plan and limits" }],
      draftOn: { artifact: "customer-portal", project: "platform", page: "plan-limits.html" },
      changes: [{ page: "plan-limits.html", status: "changed" }],
    },
  ]
  return { lasting, drafts }
}

/**
 * The story's real pages, by `<artifact>/<page>`: the ones the billing Plan shows in its Interface, and the
 * backend model. Other pages of the story's Library draw the plain demo page.
 */
const STORY_PAGES: Record<string, () => string> = {
  "billing-admin/billing-mode.html": FLAGSHIP_ARTIFACTS[
    "artifacts/billing-mode.html"
  ] as () => string,
  "billing-admin/usage-invoice.html": FLAGSHIP_ARTIFACTS[
    "artifacts/usage-invoice.html"
  ] as () => string,
  "customer-portal/plan-limits.html": FLAGSHIP_ARTIFACTS[
    "artifacts/plan-limits.html"
  ] as () => string,
  "platform-backend/index.html": () => BACKEND_PAGES["index.html"] as string,
  "platform-backend/data.html": () => BACKEND_PAGES["data.html"] as string,
}

/** The line the agent's change adds under the billing-mode switch, once feedback asked for it. */
const AUDIT_ROW = "Every switch is audited: who, when and why.</span></div>"
const LAST_SWITCH =
  '<div class="last" id="last-switch"><b class="av g">DO</b><span><b>Last switch</b> · Dana Ortiz, Finance · 2 August · usage to seats, “the usage pilot ended”</span></div>'

/** A story page as the frame shows it, with the agent's change once it was made. */
function storyPage(artifact: string, page: string, changed: boolean): string | null {
  const html = STORY_PAGES[`${artifact}/${page}`]?.()
  if (html === undefined) return null
  return page === "billing-mode.html" && changed
    ? html.replace(AUDIT_ROW, `${AUDIT_ROW}${LAST_SWITCH}`)
    : html
}

function seed(now: number, reviewing?: { task: string; project: string }, story = false) {
  if (story) return storySeed(now)
  const lasting: DemoLasting[] = [
    {
      project: "web",
      name: "app-model",
      title: "App Model",
      purpose: "Every screen of the App, light and dark, desktop and phone.",
      claudeDesign: "https://claude.ai/design/p/demo-app-model",
      pages: [
        { page: "index.html", title: "Home" },
        { page: "settings.html", title: "Settings" },
        { page: "verify.html", title: "Verify" },
      ],
      history: [
        {
          sha: `${SHA(1)}0000000000000000000000000000000000`.slice(0, 40),
          at: now - DAY,
          subject: "artifact: fold review into app-model (Rate-limit the export API)",
          task: { id: "export", title: "Rate-limit the export API" },
        },
        {
          sha: `${SHA(2)}0000000000000000000000000000000000`.slice(0, 40),
          at: now - 4 * DAY,
          subject: "artifact: fold home into app-model (Legacy CSV importer)",
          task: { id: "importer", title: "Legacy CSV importer" },
        },
        {
          sha: `${SHA(3)}0000000000000000000000000000000000`.slice(0, 40),
          at: now - 9 * DAY,
          subject: "Keep the App Model as a lasting artifact",
        },
      ],
    },
    {
      project: "web",
      name: "workflow",
      title: "Workflow",
      purpose: "The three steps and what the person does at each.",
      claudeDesign: "https://claude.ai/design/p/demo-workflow",
      pages: [{ page: "index.html", title: "Workflow" }],
      history: [
        {
          sha: `${SHA(4)}0000000000000000000000000000000000`.slice(0, 40),
          at: now - 3 * DAY,
          subject: "Describe the Verify step",
        },
      ],
    },
    {
      project: "web",
      name: "website",
      title: "Website",
      purpose: "Home, pricing, the docs entry and the tour.",
      pages: [
        { page: "index.html", title: "Home" },
        { page: "pricing.html", title: "Pricing" },
      ],
      history: [
        {
          sha: `${SHA(5)}0000000000000000000000000000000000`.slice(0, 40),
          at: now - 6 * DAY,
          subject: "Add the pricing page",
        },
      ],
    },
    {
      project: "pay",
      name: "checkout",
      title: "Checkout",
      purpose: "The payment form and its receipt.",
      pages: [
        { page: "index.html", title: "Payment" },
        { page: "receipt.html", title: "Receipt" },
      ],
      history: [
        {
          sha: `${SHA(6)}0000000000000000000000000000000000`.slice(0, 40),
          at: now - 5 * DAY,
          subject: "Keep the checkout as a lasting artifact",
        },
      ],
    },
  ]
  const drafts: DemoDraft[] = [
    {
      project: "web",
      task: "sso",
      name: "sso-settings",
      title: "Settings with groups",
      purpose: "A group column on the settings page.",
      pages: [{ page: "settings.html", title: "Settings with groups" }],
      draftOn: { artifact: "app-model", project: "web", page: "settings.html" },
      changes: [{ page: "settings.html", status: "changed" }],
    },
    {
      project: "web",
      task: "tokens",
      name: "tokens-app",
      title: "Tokens in the App",
      purpose: "Home and Settings with the synced tokens.",
      pages: [
        { page: "index.html", title: "Home with tokens" },
        { page: "settings.html", title: "Settings with tokens" },
      ],
      draftOn: { artifact: "app-model", project: "web" },
      changes: [
        { page: "index.html", status: "changed" },
        { page: "settings.html", status: "changed" },
      ],
    },
    {
      project: "pay",
      task: "queue",
      name: "receipt-retry",
      title: "Receipt with a retry",
      purpose: "A retry line on the receipt.",
      pages: [{ page: "receipt.html", title: "Receipt with a retry" }],
      draftOn: { artifact: "checkout", project: "pay", page: "receipt.html" },
      changes: [{ page: "receipt.html", status: "changed" }],
    },
    {
      project: "pay",
      task: "queue",
      name: "queue-sketch",
      title: "Queue overview",
      purpose: "A sketch of the queue, not part of a lasting artifact yet.",
      pages: [{ page: "index.html", title: "Queue overview" }],
      changes: [],
    },
  ]
  // The demo task at the person's review drafts on the App Model: its Verify page shows the
  // fold card (two changed pages and a new one; Settings is also drafted by two other open tasks).
  if (reviewing !== undefined)
    drafts.push({
      project: reviewing.project,
      task: reviewing.task,
      name: "app-model-review",
      title: "Settings and Verify with groups",
      purpose: "Groups on Settings and Verify, and a page for the group sync.",
      pages: [
        { page: "settings.html", title: "Settings" },
        { page: "verify.html", title: "Verify" },
        { page: "groups.html", title: "Groups" },
      ],
      draftOn: { artifact: "app-model", project: reviewing.project },
      changes: [
        { page: "settings.html", status: "changed" },
        { page: "verify.html", status: "changed" },
        { page: "groups.html", status: "new" },
      ],
    })
  return { lasting, drafts }
}

// ---------------------------------------------------------------- the pages

const esc = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

/** A small interactive page: a counter, a switch, and links to the artifact's other pages. */
function pageHtml(artifact: string, title: string, page: string, pages: Page[], draft: boolean) {
  const links = pages
    .filter((p) => p.page !== page)
    .map((p) => `<a href="${p.page}">${esc(p.title)}</a>`)
    .join(" · ")
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="description" content="${esc(artifact)}, ${esc(title)}"><meta name="viewport" content="width=900">
<style>
:root{color-scheme:light dark;--bg:#fbfaf8;--ink:#1f1d1a;--dim:#6f6a62;--line:#e3dfd8;--accent:#2f5fd0;--soft:#e8eefb}
@media (prefers-color-scheme:dark){:root{--bg:#1b1a18;--ink:#efece6;--dim:#a39d92;--line:#33302b;--accent:#8fb0ff;--soft:#242b3d}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--ink)}
header{display:flex;gap:16px;align-items:center;padding:14px 28px;border-bottom:1px solid var(--line)}
header b{font-size:16px}header nav{margin-left:auto;font-size:13px;color:var(--dim)}a{color:var(--accent)}
main{padding:28px;max-width:760px}h1{font-size:24px;margin:0 0 6px}p{color:var(--dim);margin:0 0 18px}
.card{border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:0 0 14px}
button{font:inherit;padding:7px 14px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink);cursor:pointer}
button.on{background:var(--soft);border-color:var(--accent)}.row{display:flex;gap:10px;align-items:center}
.note{background:var(--soft);border-radius:8px;padding:8px 12px;font-size:13px;margin:0 0 14px}
</style></head><body>
<header><b>${esc(artifact)}</b><nav>${links || "&nbsp;"}</nav></header>
<main>
<h1>${esc(title)}</h1><p>${esc(page)}${draft ? " · a draft" : ""}</p>
${draft ? '<div class="note" id="draft" data-screen-label="Draft">This page is a draft. The task changes it; the artifact keeps the last folded version.</div>' : ""}
<section class="card" id="count" data-screen-label="1 Counter"><div class="row"><button id="plus" type="button">Add one</button><span>Clicked <b id="n">0</b> times</span></div></section>
<section class="card" id="switch" data-screen-label="2 Switch"><div class="row"><button id="mode" type="button" aria-pressed="false">Notifications off</button></div></section>
</main>
<script>
var n=0,on=false;
document.getElementById("plus").addEventListener("click",function(){n++;document.getElementById("n").textContent=String(n)});
document.getElementById("mode").addEventListener("click",function(){on=!on;this.textContent="Notifications "+(on?"on":"off");this.classList.toggle("on",on);this.setAttribute("aria-pressed",String(on))});
</script></body></html>`
}

// ---------------------------------------------------------------- the demo's artifacts

export type DemoArtifactsOptions = {
  now?: () => number
  /** The task as the Artifacts place marks it; undefined for a task the demo does not have. */
  markOf: (id: string) => TaskMark | undefined
  projects: () => Project[]
  /** The task at its final review, which drafts on the App Model; none unless the demo opens there. */
  reviewing?: { task: string; project: string }
  /** `?story`: the example company's own Library instead of the full demo's. */
  story?: boolean
}

export function createDemoArtifacts(options: DemoArtifactsOptions) {
  const now = options.now ?? (() => Date.now())
  // Keep artifact ages stable across reads of the same demo.
  const opened = now()
  let state = seed(opened, options.reviewing, options.story)
  /** The agent changed the billing-mode page after the person's feedback (the story only). */
  let lastSwitchShown = false
  const kept: DemoLasting[] = []
  const PERSONAL: { project: string; name: string; title: string; purpose: string }[] =
    options.story
      ? [
          {
            project: "platform",
            name: "incident-review",
            title: "Incident review · 3 October",
            purpose:
              "What slowed the gateway for 14 minutes, and the three changes since. A draft, only for me so far.",
          },
          {
            project: "platform",
            name: "pricing-experiments",
            title: "Pricing experiments",
            purpose: "Three ways to price the Growth tier, side by side, before Finance sees them.",
          },
        ]
      : [
          {
            project: "web",
            name: "old-sketch",
            title: "Old sketch",
            purpose: "An early sketch, kept only on this computer.",
          },
        ]
  const personal = [...PERSONAL]
  /** Pages folded in so far, by draft: they no longer differ. */
  const folded = new Set<string>()
  /** Pages a lasting artifact gained or lost since a draft began, by `<artifact>/<page>`. */
  const moved = new Set<string>()

  const pagesOf = (d: DemoLasting) =>
    d.pages.map((p) => ({
      file: lastingDoc(d.name, p.page),
      page: p.page,
      title: p.title,
      thumb: thumbFor(d.name, p.page),
    }))

  const changing = (d: DemoLasting) =>
    state.drafts
      .filter(
        (x) => x.draftOn?.artifact === d.name && (x.draftOn.project ?? x.project) === d.project,
      )
      .flatMap((x) => {
        const mark = options.markOf(x.task)
        const pages = x.changes.filter((c) => !folded.has(`${x.name}/${c.page}`)).map((c) => c.page)
        return mark === undefined || (pages.length === 0 && x.changes.length > 0)
          ? []
          : [
              {
                task: mark,
                draft: x.name,
                file: `artifacts/${x.name}/${(x.pages[0] as Page).page}`,
                pages,
              },
            ]
      })

  const describe = (d: DemoLasting): LastingArtifact => ({
    name: d.name,
    title: d.title,
    purpose: d.purpose,
    entry: (d.pages[0] as Page).page,
    folder: `.qualitylayer/artifacts/${d.name}`,
    ...(d.claudeDesign !== undefined ? { claudeDesign: d.claudeDesign } : {}),
    pages: pagesOf(d),
    thumb: thumbFor(d.name),
    updated: d.history[0]?.at ?? now(),
    lastChange: d.history[0] ?? null,
    changing: changing(d),
    alsoIn: [],
    managerRevision: revisionOf(d),
    ...(d.archivedAt !== undefined ? { archivedAt: d.archivedAt } : {}),
    ...(d.deletedAt !== undefined ? { deletedAt: d.deletedAt } : {}),
  })
  const revisionOf = (d: DemoLasting) =>
    stamp(
      `${d.project}:${d.name}:${d.rev ?? 0}:${d.title}:${d.purpose}:${d.archivedAt ?? ""}:${d.deletedAt ?? ""}`,
    )

  const draftEntry = (x: DemoDraft): DraftEntry | null => {
    const mark = options.markOf(x.task)
    if (mark === undefined) return null
    return {
      task: mark,
      name: x.name,
      file: `artifacts/${x.name}/${(x.pages[0] as Page).page}`,
      title: x.title,
      purpose: x.purpose,
      updated: opened - 2 * 3_600_000,
      thumb: thumbFor(x.name, (x.pages[0] as Page).page),
      pages: x.pages.map((p) => ({
        file: `artifacts/${x.name}/${p.page}`,
        page: p.page,
        title: p.title,
        thumb: thumbFor(x.name, p.page),
      })),
      ...(x.draftOn !== undefined ? { draftOn: x.draftOn } : {}),
    }
  }

  const overview = (looks: ProjectLooks): ArtifactsOverview => {
    const lasting = new Map(
      options.projects().map((p) => [
        p.id,
        [...state.lasting, ...kept]
          .filter((d) => d.project === p.id)
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
          .map(describe),
      ]),
    )
    const out: ProjectArtifacts[] = []
    for (const project of options.projects()) {
      const also: AlsoArtifact[] = []
      for (const ref of looks.projects[project.id]?.artifacts ?? []) {
        const at = ref.indexOf(":")
        const artifact = lasting.get(ref.slice(0, at))?.find((d) => d.name === ref.slice(at + 1))
        if (artifact !== undefined) {
          artifact.alsoIn.push(project.id)
          also.push({ project: ref.slice(0, at), artifact })
        }
      }
      out.push({
        id: project.id,
        name: project.name,
        lasting: lasting.get(project.id) ?? [],
        also,
        personal: personal
          .filter((p) => p.project === project.id)
          .map((p) => ({
            file: `docs/artifacts/${p.name}.html`,
            name: p.name,
            scope: "project" as const,
            title: p.title,
            purpose: p.purpose,
            changed: null,
            updated: opened - 20 * DAY,
            sections: [],
            width: null,
            thumb: thumbFor(p.name),
            comments: 0,
          })),
        drafts: state.drafts
          .filter((x) => x.project === project.id)
          .flatMap((x) => draftEntry(x) ?? []),
      })
    }
    return { projects: structuredClone(out) }
  }

  const find = (project: string, name: string) =>
    [...state.lasting, ...kept].find((d) => d.project === project && d.name === name)

  /** The preview of a draft's fold: its changed pages and what is in the way. */
  const preview = (task: string, draftName: string): FoldPreview => {
    const draft = state.drafts.find((x) => x.task === task && x.name === draftName)
    if (draft?.draftOn === undefined)
      throw new ApiError(`${draftName} does not draft on a lasting artifact`, 400, "bad_args")
    const artifact = draft.draftOn.artifact
    const target = find(draft.project, artifact)
    const pages: FoldPage[] = draft.pages.map((p) => {
      const change = draft.changes.find((c) => c.page === p.page)
      const done = folded.has(`${draft.name}/${p.page}`)
      return {
        page: p.page,
        status: change === undefined || done ? "unchanged" : change.status,
        before: change?.status === "new" ? null : lastingDoc(artifact, p.page),
        after: `artifacts/${draft.name}/${p.page}`,
        files: [],
      }
    })
    const conflicts: FoldConflict[] = []
    for (const p of pages) {
      if (p.status === "unchanged") continue
      if (moved.has(`${artifact}/${p.page}`) && !folded.has(`${draft.name}/${p.page}`))
        conflicts.push({ page: p.page, kind: "changed", blocking: true })
      const others = state.drafts
        .filter(
          (x) =>
            x.task !== task &&
            x.draftOn?.artifact === artifact &&
            !folded.has(`${x.name}/${p.page}`) &&
            x.changes.some((c) => c.page === p.page),
        )
        .flatMap((x) => {
          const mark = options.markOf(x.task)
          return mark === undefined ? [] : [{ id: mark.id, title: mark.title }]
        })
      if (others.length > 0)
        conflicts.push({ page: p.page, kind: "also-drafted", blocking: false, tasks: others })
    }
    return {
      draft: draft.name,
      artifact,
      project: draft.project,
      folder: target === undefined ? "" : `.qualitylayer/artifacts/${artifact}`,
      message: `artifact: fold ${draft.name} into ${artifact} (${options.markOf(task)?.title ?? task})`,
      pages,
      conflicts,
    }
  }

  /** The task's drafts as its Files tab lists them. */
  const draftsOf = (task: string): Artifact[] =>
    state.drafts
      .filter((x) => x.task === task)
      .map((x) => ({
        file: `artifacts/${x.name}/${(x.pages[0] as Page).page}`,
        name: x.name,
        scope: "task" as const,
        title: x.title,
        purpose: x.purpose,
        changed: null,
        updated: opened - 2 * 3_600_000,
        sections: [],
        width: null,
        thumb: thumbFor(x.name, (x.pages[0] as Page).page),
        comments: 0,
        pages: x.pages.map((p) => ({
          file: `artifacts/${x.name}/${p.page}`,
          page: p.page,
          title: p.title,
          thumb: thumbFor(x.name, p.page),
        })),
        ...(x.draftOn !== undefined ? { draftOn: structuredClone(x.draftOn) } : {}),
      }))

  /** A copy of a lasting artifact (or one page) in the task, with the server's refusals. */
  const draftOn = (task: string, project: string, request: DraftOnRequest): DraftedOn => {
    const refuse = (message: string): never => {
      throw new ApiError(message, 400, "bad_args")
    }
    const artifact = find(project, request.artifact)
    if (artifact === undefined) return refuse(`${request.artifact}: artifact.json is missing`)
    const page =
      request.page === undefined
        ? undefined
        : request.page.endsWith(".html")
          ? request.page
          : `${request.page}.html`
    if (request.draft !== undefined) {
      // A draft of the task, recorded as a draft on the artifact: its pages are what it adds.
      const own = state.drafts.find((x) => x.task === task && x.name === request.draft)
      if (own === undefined) return refuse(`this task has no draft named ${request.draft}`)
      if (own.draftOn !== undefined)
        return refuse(`${own.name} already drafts on ${own.draftOn.artifact}`)
      if (page !== undefined && !/^[A-Za-z0-9_][A-Za-z0-9._-]*\.html$/.test(page))
        return refuse(`"${request.page}" is not a page name`)
      const only = own.pages.length === 1 ? (own.pages[0] as Page) : undefined
      if (only !== undefined && page !== undefined) only.page = page
      const recorded: DraftOn = {
        artifact: artifact.name,
        project,
        ...(own.pages.length > 1 && page !== undefined ? { page } : {}),
      }
      own.draftOn = recorded
      own.changes = own.pages
        .filter(() => artifact.from !== `${task}/${own.name}`)
        .filter((p) => recorded.page === undefined || p.page === recorded.page)
        .map((p) => ({
          page: p.page,
          status: artifact.pages.some((d) => d.page === p.page)
            ? ("changed" as const)
            : ("new" as const),
        }))
      return {
        draft: own.name,
        file: `artifacts/${own.name}/${(own.pages[0] as Page).page}`,
        draftOn: structuredClone(recorded),
        copied: [],
      }
    }
    if (page !== undefined && !artifact.pages.some((p) => p.page === page))
      return refuse(
        `${artifact.name} has no page ${page} (it has ${artifact.pages.map((p) => p.page).join(", ")})`,
      )
    const name =
      request.as ??
      (page === undefined
        ? artifact.name
        : `${artifact.name}-${page.replace(/\.html$/, "").replace(/[^a-z0-9]+/g, "-")}`)
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || name.length > 60)
      return refuse(`"${name}" is not an artifact name (lower-case letters, digits and dashes)`)
    if (state.drafts.some((x) => x.task === task && x.name === name))
      return refuse(`artifacts/${name} already exists in this task: draft on it under another name`)
    const pages =
      page === undefined ? artifact.pages : artifact.pages.filter((p) => p.page === page)
    const draftOn: DraftOn = {
      artifact: artifact.name,
      project,
      ...(page !== undefined ? { page } : {}),
    }
    state.drafts.push({
      project,
      task,
      name,
      title: artifact.title,
      purpose: artifact.purpose,
      pages: structuredClone(pages),
      draftOn,
      changes: [],
    })
    return {
      draft: name,
      file: `artifacts/${name}/${(pages[0] as Page).page}`,
      draftOn: structuredClone(draftOn),
      copied: pages.map((p) => p.page),
    }
  }

  return {
    overview,
    draftsOf,
    draftOn,
    history: (project: string, name: string) => {
      const artifact = find(project, name)
      if (artifact === undefined)
        throw new ApiError(`${name} is not a lasting artifact of this project`, 404, "no_task")
      return { entries: structuredClone(artifact.history), truncated: false }
    },
    keep: (project: string, request: KeepRequest): KeepResult => {
      const name = request.name.trim()
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || name.length > 60)
        throw new ApiError(
          `"${name}" is not an artifact name (lower-case letters, digits and dashes)`,
          400,
          "bad_args",
        )
      if (request.title.trim() === "")
        throw new ApiError("a title has 1 to 120 characters", 400, "bad_args")
      if (request.claudeDesign !== undefined && !request.claudeDesign.startsWith("https://"))
        throw new ApiError("Claude Design link: the link must be https", 400, "bad_args")
      const from = request.from
      const draft =
        "task" in from
          ? state.drafts.find((x) => x.task === from.task && x.name === from.draft)
          : undefined
      const old = "personal" in from ? personal.find((p) => p.name === from.personal) : undefined
      if (draft === undefined && old === undefined)
        throw new ApiError("the artifact to keep does not exist", 400, "bad_args")
      if (request.where === "mac" && old !== undefined)
        throw new ApiError("this artifact is already on this computer", 400, "bad_args")
      const exists =
        find(project, name) !== undefined ||
        personal.some((p) => p.project === project && p.name === name)
      if (exists)
        throw new ApiError(
          request.where === "mac"
            ? `docs/artifacts/${name} already exists: choose another name`
            : `.qualitylayer/artifacts/${name} already exists: choose another name`,
          400,
          "bad_args",
        )
      if (request.where === "mac") {
        personal.push({
          project,
          name,
          title: request.title.trim(),
          purpose: request.purpose.trim(),
        })
        return { name, where: "mac", path: `docs/artifacts/${name}`, files: 2 }
      }
      // Save to library with chosen pages: those pages (and what they use) are copied; the draft keeps all.
      const chosen =
        draft !== undefined && request.pages !== undefined
          ? draft.pages.filter((p) => request.pages?.includes(p.page))
          : draft?.pages
      if (chosen !== undefined && chosen.length === 0)
        throw new ApiError("Choose at least one page to save", 400, "bad_args")
      kept.push({
        project,
        name,
        title: request.title.trim(),
        purpose: request.purpose.trim(),
        ...(request.claudeDesign !== undefined ? { claudeDesign: request.claudeDesign } : {}),
        pages: chosen ?? [{ page: "index.html", title: old?.title ?? name }],
        history: [],
        ...(draft !== undefined ? { from: `${draft.task}/${draft.name}` } : {}),
      })
      return { name, where: "repository", path: `.qualitylayer/artifacts/${name}`, files: 3 }
    },
    /**
     * Library management as the guarded route answers it: a stale revision, a taken name and an open
     * draft (on Delete) are refused with the server's words; nothing is removed, only marked.
     */
    manage: (project: string, name: string, request: LibraryMutation): LibraryResult => {
      const artifact = find(project, name)
      if (artifact === undefined)
        throw new ApiError(`${name} is not a Library artifact of this project`, 404, "no_task")
      if (request.expected !== revisionOf(artifact))
        throw new ApiError(
          "This artifact changed since you opened it. Read it again, then try once more.",
          409,
          "conflict",
        )
      const bump = () => {
        artifact.rev = (artifact.rev ?? 0) + 1
        return { name: artifact.name, revision: revisionOf(artifact) }
      }
      if (request.action === "rename") {
        if (request.title.trim() === "")
          throw new ApiError("a title has 1 to 120 characters", 400, "bad_args")
        artifact.title = request.title.trim()
        artifact.purpose = request.purpose.trim()
        return bump()
      }
      if (request.action === "archive") {
        artifact.archivedAt = now()
        return bump()
      }
      if (request.action === "restore") {
        delete artifact.archivedAt
        delete artifact.deletedAt
        return bump()
      }
      if (request.action === "delete") {
        const users = changing(artifact)
        if (users.length > 0 && request.confirmInUse !== true)
          throw new ApiError(
            `${users.map((c) => c.task.title).join(", ")} still drafts on it: confirm to delete it anyway`,
            409,
            "conflict",
          )
        artifact.deletedAt = now()
        return bump()
      }
      if (request.action !== "copy") throw new ApiError("unknown library action", 400, "bad_args")
      const copyName = request.name.trim()
      if (!/^[a-z0-9][a-z0-9-]*$/.test(copyName) || copyName.length > 60)
        throw new ApiError(
          `"${copyName}" is not an artifact name (lower-case letters, digits and dashes)`,
          400,
          "bad_args",
        )
      if (find(request.project, copyName) !== undefined)
        throw new ApiError(
          `.qualitylayer/artifacts/${copyName} already exists in that project: choose another name`,
          400,
          "bad_args",
        )
      kept.push({
        project: request.project,
        name: copyName,
        title: request.title.trim() || artifact.title,
        purpose: request.purpose.trim(),
        pages: artifact.pages.map((p) => ({ ...p })),
        history: [],
      })
      return {
        name: copyName,
        revision: revisionOf(artifact),
        result: {
          name: copyName,
          where: "repository",
          path: `.qualitylayer/artifacts/${copyName}`,
          files: artifact.pages.length + 1,
        },
      }
    },
    /** New artifact: one blank page, kept in the repository. */
    create: (project: string, request: NewArtifactRequest): KeepResult => {
      const name = request.name.trim()
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || name.length > 60)
        throw new ApiError(
          `"${name}" is not an artifact name (lower-case letters, digits and dashes)`,
          400,
          "bad_args",
        )
      if (request.title.trim() === "")
        throw new ApiError("a title has 1 to 120 characters", 400, "bad_args")
      if (find(project, name) !== undefined)
        throw new ApiError(
          `.qualitylayer/artifacts/${name} already exists: choose another name`,
          400,
          "bad_args",
        )
      kept.push({
        project,
        name,
        title: request.title.trim(),
        purpose: request.purpose.trim(),
        pages: [{ page: "index.html", title: request.title.trim() }],
        history: [],
      })
      return { name, where: "repository", path: `.qualitylayer/artifacts/${name}`, files: 2 }
    },
    foldPreview: (task: string, draft: string) => structuredClone(preview(task, draft)),
    fold: (task: string, request: FoldRequest): FoldResult => {
      const before = preview(task, request.draft)
      if (request.pages.length === 0)
        throw new ApiError("choose the pages to fold in", 400, "bad_args")
      for (const name of request.pages)
        if (!before.pages.some((p) => p.page === name))
          throw new ApiError(`${request.draft} has no page ${name} to fold in`, 400, "bad_args")
      const stops = before.conflicts.filter((c) => c.blocking && request.pages.includes(c.page))
      if (stops.length > 0 && request.force !== true)
        return { folded: false, preview: structuredClone(before) }
      const draft = state.drafts.find((x) => x.task === task && x.name === request.draft)
      const target = find(before.project, before.artifact)
      const chosen = before.pages.filter(
        (p) => request.pages.includes(p.page) && p.status !== "unchanged",
      )
      if (draft === undefined || target === undefined || chosen.length === 0)
        return {
          folded: true,
          commit: null,
          subject: null,
          files: [],
          preview: structuredClone(before),
        }
      for (const p of chosen) {
        folded.add(`${draft.name}/${p.page}`)
        moved.add(`${before.artifact}/${p.page}`)
      }
      const commit = SHA(target.history.length + 10)
      target.history.unshift({
        sha: `${commit}0000000000000000000000000000000000`.slice(0, 40),
        at: now(),
        subject: before.message,
        task: { id: task, title: options.markOf(task)?.title ?? task },
      })
      return {
        folded: true,
        commit,
        subject: before.message,
        files: chosen.map((p) => `${before.folder}/${p.page}`),
        preview: structuredClone(preview(task, request.draft)),
      }
    },
    /** An artifact page for the frame: the lasting artifact's, or a task's draft. */
    page: (file: string): string | null => {
      const lasting = lastingDocOf(file)
      if (lasting !== null) {
        const artifact = [...state.lasting, ...kept].find((d) => d.name === lasting.name)
        const page = artifact?.pages.find((p) => p.page === lasting.page)
        if (artifact === undefined || page === undefined) return null
        const real = options.story ? storyPage(artifact.name, page.page, lastSwitchShown) : null
        return withBridge(
          real ?? pageHtml(artifact.title, page.title, page.page, artifact.pages, false),
        )
      }
      const named = folderArtifactOf(file)
      if (named !== null && named.root === "artifacts") {
        const draft = state.drafts.find((x) => x.name === named.name)
        const page = draft?.pages.find((p) => p.page === named.page)
        if (draft === undefined || page === undefined) return null
        // A draft shows the page of the artifact it changes, as the task draws it.
        const real = options.story
          ? storyPage(draft.draftOn?.artifact ?? draft.name, page.page, lastSwitchShown)
          : null
        return withBridge(real ?? pageHtml(draft.title, page.title, page.page, draft.pages, true))
      }
      return null
    },
    /** The agent's change after feedback on the billing-mode page: the last switch shows under the button. */
    showLastSwitch: () => {
      lastSwitchShown = true
      // The change is the artifact's newest version: the viewer reads the page again, its history says who.
      state.lasting
        .find((d) => d.name === "billing-admin")
        ?.history.unshift({
          sha: commit(14),
          at: now(),
          subject: "Show the last switch under the billing-mode button",
          task: {
            id: DEMO_TASK_ID,
            title: options.markOf(DEMO_TASK_ID)?.title ?? "Usage-based billing",
          },
        })
    },
    reset: () => {
      lastSwitchShown = false
      state = seed(now(), options.reviewing, options.story)
      kept.length = 0
      folded.clear()
      moved.clear()
      personal.splice(0, personal.length, ...PERSONAL)
    },
  }
}

export type DemoArtifacts = ReturnType<typeof createDemoArtifacts>
