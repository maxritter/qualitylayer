// The projects and tasks of `?scale=large` (scale.ts): 12 projects and about 90 tasks in every
// state. A task is the demo task at one of its moments (`task/moments.ts`),
// re-labelled: its own title, project, branch and pull request number, with the moment's state
// (needs you, running, quiet, stopped, shipped, archived) kept as the moment draws it. Nothing is
// random: the same address gives the same list.

import type { DocSections } from "../../server/doc-sections-split.ts"
import type { Project, TaskDetail } from "../api.ts"
import { LONG_PROJECT, PROJECTS } from "./fixtures.ts"
import { growBatch, growItems, growPullRequest } from "./scale-demo-task.ts"
import { demoTask, TASK_FILES, taskDocument, taskSections } from "./task/index.ts"
import type { Moment } from "./task/moments.ts"

/** The 12 projects: the demo's four, then eight more, some with names no list has room for. */
export const LARGE_PROJECTS: Project[] = [
  ...PROJECTS,
  {
    id: "recon",
    name: "acme/payments-reconciliation-service",
    paths: ["/demo/acme/payments-reconciliation-service"],
    lastSeen: 0,
  },
  {
    id: "identity",
    name: "acme/identity-and-access-management-gateway",
    paths: ["/demo/acme/identity-and-access-management-gateway"],
    lastSeen: 0,
  },
  { id: "mobile", name: "acme/mobile-app", paths: ["/demo/acme/mobile-app"], lastSeen: 0 },
  { id: "docs", name: "acme/docs-site", paths: ["/demo/acme/docs-site"], lastSeen: 0 },
  {
    id: "infra",
    name: "platform-engineering/terraform-infrastructure-modules",
    paths: ["/demo/platform-engineering/terraform-infrastructure-modules"],
    lastSeen: 0,
  },
  {
    id: "data",
    name: "data-team/analytics-warehouse-transformations",
    paths: ["/demo/data-team/analytics-warehouse-transformations"],
    lastSeen: 0,
  },
  { id: "ml", name: "acme/ml-feature-store", paths: ["/demo/acme/ml-feature-store"], lastSeen: 0 },
  LONG_PROJECT,
]

/** Titles of 60 to 90 characters, the length a person's request gets. */
export const TITLES = [
  "Replace the nightly reconciliation batch job with an event-driven settlement pipeline",
  "Let enterprise administrators export the complete audit trail as signed CSV archives",
  "Migrate every customer-facing webhook from polling retries to exponential backoff",
  "Add per-organisation rate limits to the public API and show remaining quota in headers",
  "Move invoice PDF rendering into a worker pool so month-end runs never block checkout",
  "Backfill missing tax identifiers for accounts created before the 2025 billing rewrite",
  "Show a clear read-only banner while the database fails over to the replica region",
  "Split the monolithic notification service into email, push and in-app delivery workers",
  "Support single sign-on group mapping with nested groups and just-in-time provisioning",
  "Cache currency conversion rates for ninety seconds and surface stale rates in invoices",
  "Make the onboarding checklist resumable across devices and remember dismissed steps",
  "Introduce idempotency keys on every payment endpoint and reject duplicate submissions",
  "Rewrite the search indexer to stream documents instead of loading whole collections",
  "Add keyboard shortcuts and focus management to the bulk-edit table in the admin app",
  "Replace hand-written date maths in the billing calendar with the shared temporal helpers",
  "Report failed deployments to the owning team's channel with the failing check attached",
  "Let customers pause a subscription for up to three months without losing their history",
  "Record who approved each refund over five hundred dollars and show it on the order page",
  "Upgrade the mobile app's networking layer and retry uploads when the connection returns",
  "Generate the public changelog from merged pull requests grouped by customer-visible area",
  "Teach the importer to read semicolon-separated files with quoted line breaks correctly",
  "Throttle background sync on metered connections and let people choose when it runs",
  "Add a dry-run mode to every destructive maintenance command and print what would change",
  "Show the cost of each pipeline run next to its duration in the build history table",
  "Fix the dashboard timezone drift that moved daily totals across midnight for APAC users",
  "Consolidate three copies of the permission checks into one policy module with tests",
  "Stream large report downloads from object storage instead of buffering them in memory",
  "Warn before a team removes the last owner and offer to transfer ownership first",
  "Cut cold-start time of the reporting lambdas by lazy-loading the chart renderer",
  "Add contract tests between the gateway and the ledger so a schema change fails early",
  "Introduce feature flags for the new checkout and roll it out to five percent of traffic",
  "Replace the polling status page with server-sent events and a graceful fallback",
  "Normalise phone numbers on signup and keep the original input for support to read",
  "Add an undo for archived projects that restores their tasks, comments and artifacts",
  "Give every background job a trace id and link it from the failing request's log line",
  "Reduce the size of the web bundle by splitting the editor and the charts into routes",
  "Add column-level lineage to the analytics warehouse models and publish it to the catalog",
  "Rotate the signing keys for webhooks every ninety days without dropping a delivery",
  "Allow CSV and JSON exports of a saved filter with the same columns as the screen",
  "Make the dark theme meet contrast requirements on charts, badges and disabled controls",
  "Detect duplicate customer accounts by email and company name and offer to merge them",
  "Support right-to-erasure requests by deleting personal data across services in one run",
  "Replace the custom queue with the managed one and keep ordering per account key",
  "Display usage against plan limits on the billing page and alert at eighty percent",
  "Let reviewers filter the pull request list by failing checks and unresolved threads",
  "Add an offline mode to the field-service app that syncs work orders on reconnect",
  "Port the legacy report builder to the new query engine and keep saved reports working",
  "Add structured audit entries for every permission change with before and after values",
  "Show each customer's seven-day error rate on the account page and link the failing calls",
  "Retire the v1 REST endpoints after a deprecation window and publish the migration guide",
  "Let support impersonate a customer read-only and record every page they open for audit",
  "Batch the nightly ledger snapshots by region so one slow region never delays the rest",
  "Replace the hand-rolled retry loops in the SDK with one tested policy for every client",
  "Add a status line to every long-running import that says which row it is working on now",
  "Move image resizing to the edge and cache the results for as long as the original lives",
  "Add two-factor recovery codes and show how many are left in the security settings page",
  "Teach the linter to flag queries without an account filter in multi-tenant code paths",
  "Make the invoice email preview match the real email in Outlook, Gmail and Apple Mail",
  "Replace polling in the build dashboard with a push channel and show reconnects clearly",
  "Split the shared utilities package into focused packages with explicit public entry points",
  "Add a per-tenant kill switch for the experimental recommendations feature in production",
  "Compress archived event logs after thirty days and keep them searchable by request id",
  "Surface slow database queries in the admin with the plan, the caller and a code link",
  "Allow teams to define their own approval chains for refunds above a configurable amount",
  "Show a timeline of everything that changed on an invoice from draft to paid on one page",
  "Replace the ad-hoc cron jobs with a scheduler that records every run and its result",
  "Let customers download their data as a single archive and notify them when it is ready",
  "Fix flaky end-to-end tests by waiting on explicit events instead of fixed sleeps",
  "Add a health endpoint per service that reports its dependencies and their latencies",
  "Redesign the empty states of the reporting section and explain what appears there first",
  "Support multi-currency price books and convert at invoice time using the stored rate",
  "Add an approval step before a production migration runs and show the dry-run output",
  "Make the CSV importer tell people which row and column failed and offer to skip it",
  "Introduce per-environment secrets scanning in CI and block merges that expose a token",
  "Add a customer-facing audit log with filters by actor, date range and action type",
  "Let admins schedule a maintenance banner and show it to affected customers in advance",
  "Move the session store to a replicated cache and keep people signed in during failover",
  "Rewrite the permissions table to show inherited access and where each grant comes from",
] as const

type Spec = {
  moment: Moment
  /** Tasks of this moment. */
  count: number
  /** Put away by the person: out of the working lists. */
  archived?: true
}

/**
 * The tasks, by the moment they are at: about a third wait on the person, a quarter are at work,
 * and the rest are quiet, stopped, shipped or archived. The demo's own 16 tasks come on top.
 */
const MIX: Spec[] = [
  // Your move.
  { moment: "plan-approve", count: 2 },
  { moment: "verify", count: 2 },
  { moment: "impl-start", count: 2 },
  { moment: "plan-q", count: 4 },
  { moment: "plan-choices", count: 2 },
  { moment: "verify-rechecking", count: 1 },
  { moment: "pr-threads", count: 1 },
  // At work.
  { moment: "now", count: 2 },
  { moment: "plan-reading", count: 1 },
  { moment: "plan-work", count: 1 },
  { moment: "verify-checking", count: 2 },
  { moment: "verify-fixing", count: 1 },
  { moment: "impl-checks", count: 1 },
  { moment: "plan-small", count: 1 },
  { moment: "plan-quiet", count: 1 },
  // Quiet and stopped.
  { moment: "impl-quiet", count: 3 },
  { moment: "impl-stopped", count: 2 },
  // Shipped and archived.
  { moment: "pr-open", count: 4 },
  { moment: "pr-merged", count: 26 },
  { moment: "pr-merged", count: 16, archived: true },
]

/** The moments whose agent works as the page stays open; the others keep their own signs of life. */
const AT_WORK: ReadonlySet<Moment> = new Set([
  "now",
  "plan-reading",
  "plan-work",
  "plan-findings",
  "verify-checking",
  "verify-red",
  "verify-fixing",
  "verify-light",
  "impl-checks",
  "impl-need",
  "impl-fix",
  "plan-quiet",
])

/** Heavy fields only the open task reads; the list leaves them out. */
const DETAIL_ONLY = [
  "pages",
  "timeline",
  "checklist",
  "review",
  "slices",
  "verification",
  "quality",
  "buildLog",
  "prDescription",
  "implementStart",
  "docs",
] as const

/** Which projects the tasks go to: a few have many, the long ones have few. */
const PROJECT_ORDER = [0, 1, 3, 0, 4, 2, 0, 5, 1, 6, 3, 0, 7, 2, 8, 1, 9, 3, 0, 10, 4, 1, 11, 5]

const slugOf = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

const HOUR = 3_600_000
const MIN = 60_000

type Spot = {
  id: string
  moment: Moment
  title: string
  slug: string
  project: Project
  branch: string
  pr: number
  archived: boolean
  shared: boolean
  /** How long ago it was last moved, so the lists have every age from minutes to days. */
  age: number
  /** When the list was made: the clock every age is counted back from. */
  now: number
}

/** The list of spots, in a fixed order that mixes the states instead of grouping them. */
function spotsOf(now: number): Spot[] {
  const flat = MIX.flatMap((spec) =>
    Array.from({ length: spec.count }, () => ({
      moment: spec.moment,
      archived: spec.archived === true,
    })),
  )
  // 37 and the length have no common factor, so the walk visits every task once.
  const step = 37
  return flat.map((_, at) => {
    const pick = flat[(at * step) % flat.length] as (typeof flat)[number]
    const title = TITLES[at % TITLES.length] as string
    const project = LARGE_PROJECTS[PROJECT_ORDER[at % PROJECT_ORDER.length] as number] as Project
    const slug = slugOf(title)
    return {
      id: `${project.id}~${slug}`,
      moment: pick.moment,
      title,
      slug,
      project,
      branch: `feat/${slugOf(project.name.split("/").at(-1) ?? "work")}/${slug}`.slice(0, 78),
      pr: 4017 + ((at * 53) % 5400),
      archived: pick.archived,
      // Every fifth open task is shared with the team.
      shared: at % 5 === 0 && !pick.archived,
      age: (6 + ((at * 83) % 2600)) * MIN,
      now,
    }
  })
}

/** The task of a spot: the moment's task, with this task's own name, project, branch and pull request. */
function build(spot: Spot): TaskDetail {
  const now = spot.now
  const atWork = AT_WORK.has(spot.moment)
  const base = demoTask(spot.moment, atWork ? now : now - spot.age)
  const text = JSON.stringify(base)
    .replaceAll("usage-based-billing", spot.slug)
    .replaceAll("Usage-based billing", spot.title)
  const task = JSON.parse(text) as TaskDetail
  // The lists a card shows beside the task's name: its batch of questions and its pull request.
  growBatch(task)
  growItems(task)
  growPullRequest(task)
  const projectPath = spot.project.paths[0] ?? `/demo/${spot.project.id}`
  const pr = task.pullRequest
  return {
    ...task,
    id: spot.id,
    title: spot.title,
    slug: spot.slug,
    project: spot.project.id,
    projectName: spot.project.name,
    branch: spot.branch,
    created: now - spot.age - 5 * HOUR,
    dir: `${projectPath}/docs/plans/${spot.slug}`,
    shared: spot.shared,
    archived: spot.archived,
    session: task.session === null ? null : { ...task.session, checkout: projectPath },
    ...(pr === undefined
      ? {}
      : {
          pullRequest: {
            ...pr,
            number: spot.pr,
            url: `https://github.com/${spot.project.name}/pull/${spot.pr}`,
            branch: spot.branch,
          },
        }),
    ...(task.closing === null
      ? {}
      : {
          closing: {
            ...task.closing,
            ...(task.closing.how === undefined ? {} : { how: `PR #${spot.pr}` }),
          },
        }),
    ...(task.shipped == null
      ? {}
      : {
          shipped: {
            ...task.shipped,
            ...(task.shipped.pr == null
              ? {}
              : {
                  pr: {
                    ...task.shipped.pr,
                    number: spot.pr,
                    title: spot.title,
                    url: `https://github.com/${spot.project.name}/pull/${spot.pr}`,
                    branch: spot.branch,
                  },
                }),
          },
        }),
  } as TaskDetail
}

/** What the list reads of a task: the detail without the fields only an open task draws. */
function summaryOf(task: TaskDetail): TaskDetail {
  const light = { ...task } as Record<string, unknown>
  for (const key of DETAIL_ONLY) delete light[key]
  return light as unknown as TaskDetail
}

/** An agent at work keeps working as the page stays open; a quiet or stopped one keeps its silence. */
function alive(task: TaskDetail, now: number): TaskDetail {
  if (task.session !== null && task.session !== undefined) task.session.heartbeat = now
  const signals = task.live?.signals
  if (signals?.hook != null) signals.hook.at = now - 4_000
  if (signals != null && signals.transcript != null) signals.transcript = now - 4_000
  return task
}

export type LargeTasks = {
  projects: Project[]
  /** The generated tasks as the list reads them, with the agents at work alive. */
  summaries(): TaskDetail[]
  /** One generated task whole, or undefined for an id that is not one. */
  /** Whether the id is one of the generated tasks. */
  has(id: string): boolean
  detail(id: string): TaskDetail | undefined
  doc(
    id: string,
    name: string,
  ): { name: string; markdown: string; validation: { valid: true; errors: [] } } | undefined
  sections(id: string, name: string): DocSections | undefined
  /** The generated tasks the team shows as the member's own shared ones. */
  shared(): TaskDetail[]
}

function cachedSummary(light: Map<string, TaskDetail>, spot: Spot): TaskDetail {
  let kept = light.get(spot.id)
  if (kept === undefined) {
    kept = summaryOf(build(spot))
    light.set(spot.id, kept)
  }
  return kept
}

function cachedDetail(
  byId: Map<string, Spot>,
  full: Map<string, TaskDetail>,
  id: string,
): TaskDetail | undefined {
  const spot = byId.get(id)
  if (spot === undefined) return undefined
  let kept = full.get(id)
  if (kept === undefined) {
    kept = build(spot)
    full.set(id, kept)
  }
  const task = structuredClone(kept)
  return AT_WORK.has(spot.moment) ? alive(task, Date.now()) : task
}

function taskMarkdownFor(
  byId: Map<string, Spot>,
  full: Map<string, TaskDetail>,
  id: string,
  name: string,
): string | undefined {
  const spot = byId.get(id)
  const known = cachedDetail(byId, full, id)
  if (spot === undefined || known === undefined) return undefined
  if (!(Object.values(TASK_FILES) as string[]).includes(name)) return undefined
  if (known.files.some((file) => file.name === name && !file.exists)) return undefined
  return taskDocument(name)
    ?.replaceAll("usage-based-billing", spot.slug)
    .replaceAll("Usage-based billing", spot.title)
}

function requireMarkdown(
  byId: Map<string, Spot>,
  full: Map<string, TaskDetail>,
  id: string,
  name: string,
): string | undefined {
  if (!byId.has(id)) return undefined
  const markdown = taskMarkdownFor(byId, full, id, name)
  if (markdown === undefined) throw new Error(`${name} does not exist yet`)
  return markdown
}

export function largeTasks(now: number): LargeTasks {
  const spots = spotsOf(now)
  const byId = new Map(spots.map((spot) => [spot.id, spot]))
  const light = new Map<string, TaskDetail>()
  const full = new Map<string, TaskDetail>()
  const detail = (id: string) => cachedDetail(byId, full, id)
  return {
    projects: LARGE_PROJECTS,
    summaries: () =>
      spots.map((spot) => {
        const task = structuredClone(cachedSummary(light, spot))
        return AT_WORK.has(spot.moment) ? alive(task, Date.now()) : task
      }),
    has: (id) => byId.has(id),
    detail,
    doc: (id, name) => {
      const markdown = requireMarkdown(byId, full, id, name)
      return markdown === undefined
        ? undefined
        : { name, markdown, validation: { valid: true, errors: [] } }
    },
    sections: (id, name) => {
      const markdown = requireMarkdown(byId, full, id, name)
      return markdown === undefined ? undefined : taskSections(name, markdown, detail(id)?.type)
    },
    shared: () => spots.filter((spot) => spot.shared).map((spot) => cachedSummary(light, spot)),
  }
}
