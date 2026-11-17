// The website demonstration uses the real UI and this in-memory API.
// It never fetches a local Cockpit or starts an agent. Demo settings stay in this browser.

import agents from "../../core/agents/agents.json" with { type: "json" }
import type { AgentHealth } from "../../core/agents/health-types.ts"
import { NATIVE_AGENTS, type NativeAgent } from "../../core/agents/ids.ts"
import type { Artifact } from "../../core/artifact/format.ts"
import { helperDoc, threadHandling } from "../../core/comment-handling.ts"
import { DEFAULT_CONFIG } from "../../core/config-values.ts"
import { NAMES, taskFiles } from "../../core/docs/names.ts"
import { calendarPeriods, homeFacts } from "../../core/interaction-shell/home.ts"
import { agentIdOf } from "../../core/interaction-shell/status.ts"
import { ANSWER_KINDS, changeCount, flattenItems, type Item, openCount } from "../../core/items.ts"
import { needsOf } from "../../core/needs.ts"
import type { ProjectLooks } from "../../core/project-look.ts"
import { reviewComments } from "../../core/review/comments.ts"
import type { PullRequestView } from "../../core/review/summary.ts"
import type { CommentThread } from "../../interaction/contracts.ts"
import { recommendedIndices, recommendedLabel } from "../../interaction/question-recommendations.ts"
import { withBridge } from "../../server/artifact-bridge.ts"
import type {
  Comment,
  Config,
  InstructionsText,
  interactionApi,
  SubagentModels,
  TaskDetail,
} from "../api.ts"
import { createMemoryLookApi } from "../sidebar/look-api.ts"
import { setBranchApi } from "../start-branch.ts"
import type { ScreenEvidenceApi } from "../steps/verify/screens-api.ts"
import type { WalkthroughApi } from "../timeline/walkthrough-api.ts"
import { createDemoIntegration, demoAccount, demoAgentSetup } from "./agent-setup.ts"
import { createDemoRunAdapter, type RunDemoMoment, runMomentFrom } from "./agent-window.ts"
import { demoArtifactSource } from "./artifact-source.ts"
import { createDemoArtifacts } from "./artifacts.ts"
import { createDemoAutomations } from "./automations.ts"
import { demoTaskChanges } from "./changes.ts"
import {
  chatChanges,
  chatConversation,
  chatFileDiff,
  chatTurnChanges,
  chatWalkthrough,
} from "./chat-changes.ts"
import { demoCost } from "./cost.ts"
import {
  EARLIER_DOCS,
  EARLIER_TASK,
  LONG_PROJECT,
  makeTasks,
  momentTasks,
  PRODUCT_TALL_PAGE,
  PRODUCT_TASK,
  PRODUCT_WIREFRAME,
  PROJECTS,
  productDocument,
  productSections,
  QUIET_TASKS,
} from "./fixtures.ts"
import { FLAGSHIP_ARTIFACTS, FLAGSHIP_MOMENT, type FlagshipStage, planLimits } from "./flagship.ts"
import { CROWD_TASKS, type DemoVariant, EXPORT_TASK, exportItems, extraTask } from "./items.ts"
import { liveReportOf, signalsOf, todoOf } from "./live-rows.ts"
import { createDemoMemory } from "./memory.ts"
import { ME } from "./person.ts"
import { flagshipEvidenceSvg, flagshipEvidenceText, refusedExportSvg } from "./pictures.ts"
import { switchPanel } from "./queue-console.ts"
import { shipDemoReview } from "./review.ts"
import { createDemoServerPort } from "./server-port.ts"
import { createDemoSessions } from "./sessions.ts"
import { advanceBatch, focusMember } from "./task/batch.ts"
import { demoBranch } from "./task/branch.ts"
import { demoPullRequestBody } from "./task/description.ts"
import { TASK_FILES } from "./task/documents.ts"
import { DEMO_TASK_ID, demoTask, type Moment, taskDocument, taskSections } from "./task/index.ts"
import { atReview } from "./task/moments.ts"
import { stepPage } from "./task/page.ts"
import { ALERT_SENTENCE, capOverage } from "./task/plan.ts"
import { demoPlanEntry } from "./task/plan-entry.ts"
import { demoCancelMore, demoMore, demoMulti } from "./task/question-more.ts"
import { DEMO_DECISIONS } from "./task/review.ts"
import { demoVerificationRuns } from "./task/verify.ts"
import { demoFileDiff, demoWalkthrough } from "./task/walkthrough.ts"
import { createDemoTools } from "./tools.ts"
import { demoUpdates } from "./updates.ts"
import { demoUsage, demoUsageFails, demoUsageScenario } from "./usage.ts"
import { atYourReview, setVerifyMode } from "./verify-mode.ts"
import { DEMO_VERSION } from "./version.ts"
import { taskFileDiff, taskWalkthrough } from "./walkthrough.ts"

const clone = <T>(value: T): T => structuredClone(value)
const SETTINGS_KEY = "qualitylayer-demo-settings"

function savedSettings(): unknown {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null")
  } catch {
    return null
  }
}

function keepSettings(config: Config) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(config))
  } catch {
    /* Storage is optional. */
  }
}

function merge<T extends object>(base: T, patch: unknown): T {
  if (typeof patch !== "object" || patch === null) return base
  const next = { ...base } as Record<string, unknown>
  for (const key of Object.keys(base)) {
    if (!(key in patch)) continue
    const value = (patch as Record<string, unknown>)[key]
    const previous = next[key]
    if (previous !== null && typeof previous === "object" && !Array.isArray(previous))
      next[key] = merge(previous, value)
    else if (typeof value === typeof previous) next[key] = value
  }
  return next as T
}

/** Every native agent found and ready, each with the version line its own command prints. */
const DEMO_AGENT_VERSIONS: Record<NativeAgent, string> = {
  "claude-code": "Claude Code 2.1.302",
  codex: "codex-cli 0.163.0",
  pi: "1.3.0",
  opencode: "opencode v2.0.32",
  cursor: "cursor-agent 2026.10.19",
  grok: "grok 1.0.62",
  antigravity: "agy 1.4.4",
  copilot: "GitHub Copilot CLI 1.0.105.",
}

function demoAgentHealth(): AgentHealth[] {
  const now = Date.now()
  return NATIVE_AGENTS.map(
    (agent): AgentHealth => ({
      agent,
      status: "available",
      checkedAt: now,
      path: `/example/bin/${agent}`,
      version: DEMO_AGENT_VERSIONS[agent],
      detail: null,
      ...demoAccount(agent, now),
    }),
  )
}

/** What OpenCode lists for the providers its settings connect, after the catalog's models. */
const OPENCODE_LISTED = [
  "openrouter/anthropic/claude-sonnet-5-5",
  "openrouter/deepseek/deepseek-v4.1",
]

function helpers(): SubagentModels[] {
  return NATIVE_AGENTS.map((id) => {
    const entry = agents[id]
    const catalog = Object.entries(entry.helperModels).map(([key, name]) => ({ id: key, name }))
    const lists = id === "opencode"
    const models = [
      ...catalog,
      ...(lists ? OPENCODE_LISTED.map((key) => ({ id: key, name: key })) : []),
    ]
    const listed = lists
      ? { models: models.map((model) => model.id), own: catalog[0]?.id ?? null }
      : undefined
    return {
      agent: id,
      label: entry.name,
      file: "Illustrative agent settings",
      models,
      ...(listed === undefined ? {} : { listed }),
      current: null,
      recommended: models[0]?.id ?? "",
      effort: null,
      efforts: ["low", "medium", "high", "xhigh"],
      runnable: true,
      fastModeModels:
        id === "claude-code"
          ? ["opus"]
          : id === "codex"
            ? ["gpt-6.1-sol", "gpt-6-astra", "gpt-6.1-terra", "gpt-6-luna"]
            : [],
    }
  })
}

/** A step document of a task: the body its page holds when the file is written, else (for the demo task) the shared text. */
function pageText(task: TaskDetail, name: string, shared: boolean): string | undefined {
  return (
    task.pages?.find((page) => page.name === name && page.exists)?.body ??
    (shared ? taskDocument(name) : undefined)
  )
}

/**
 * What a helper answers to a comment: on the billing task, an answer about that comment's subject; on the
 * other tasks, the SSO example's answer they were written around.
 */
/** The agent's answer once the person's comment on the 80 % alert is folded into the Plan. */
const CAP_ANSWER =
  "Changed the Plan: the overage is capped at 50 % above the plan. Past the cap the gateway answers 429, and the 100 % alert says when that happens."

function helperAnswerFor(task: { id: string }, remark: string): string {
  if (task.id !== DEMO_TASK_ID)
    return "Yes. The Google ID token carries the name, so the app reads it from there and does not call the profile API."
  if (/restart|crash|open window/i.test(remark))
    return "On a restart the aggregator replays the open window from Kafka's last committed offset. The ledger writes each window once per key, so the replay never counts twice. I've added that to the Plan's second decision."
  return "Noted in the Plan. I fold it in before you approve, and your review shows where it changed."
}

/** The billing task's own page, drawn before the build (App Model: artifact `plan-limits`). */
const PLAN_LIMITS_ARTIFACT: Artifact = {
  file: "artifacts/plan-limits.html",
  name: "plan-limits",
  scope: "task",
  title: "Plan and limits",
  purpose:
    "The customer's Plan and limits page: use per meter against the limit, saving a limit, and the alert at 80 %",
  changed: "Invalid limits show an error beside the field and keep Save disabled",
  // Drawn while the Plan was written, this morning.
  updated: Date.now() - 50 * 60_000,
  sections: [],
  width: 760,
  thumb: null,
  comments: 0,
}

/** The two designs the billing Plan shows in its Interface (task/plan.ts). */
const PLAN_DESIGNS: Artifact[] = [
  {
    ...PLAN_LIMITS_ARTIFACT,
    file: "artifacts/billing-mode.html",
    name: "billing-mode",
    title: "Billing mode",
    purpose: "Finance moves an account between seats and usage, with both invoices side by side",
    changed: "Every switch asks for a reason, kept in the audit log",
  },
  {
    ...PLAN_LIMITS_ARTIFACT,
    file: "artifacts/usage-invoice.html",
    name: "usage-invoice",
    title: "Invoice with usage",
    purpose:
      "The customer's invoice: usage priced by tier, the overage, and a correction for a late event",
    changed: "Usage lines open the windows they bill",
  },
]

/** How the demo's projects look to begin with: colors, one renamed, one hidden. */
export const DEMO_LOOKS: ProjectLooks = {
  order: ["pay", "web", "platform", "cli"],
  projects: {
    // acme/payments also lists the website's Workflow under its own artifacts.
    pay: { color: "teal", artifacts: ["web:workflow"] },
    web: { color: "olive", label: "website" },
    platform: { color: "plum" },
    cli: { color: "gray", hidden: true },
  },
}

/**
 * The demo's world. Usage-based billing is the demo task of `task/` in every mode: `stage` (the
 * website's `?flagship=<stage>`) picks the moment it opens at, and `?moment=<id>` (`askedMoment`) picks
 * any moment and adds the product task.
 */
export function createDemoApi(
  onChange: () => void = () => {},
  /** `?flagship=<stage>`: the moment the billing task opens at when no `?moment=` is asked. */
  stage: FlagshipStage = "plan",
  variant: DemoVariant = {},
  /** `?moment=<id>`: the demo task at that moment, with the product task beside it. */
  askedMoment?: Moment,
  initialRun?: RunDemoMoment,
  /** The connected tour keeps the same illustrative native session as its step fixture changes. */
  sharedRuns?: ReturnType<typeof createDemoRunAdapter>,
  /** The guided tour reuses the real Chat fixture without changing the browser's address. */
  tourScene?: "chat",
) {
  const moment: Moment = askedMoment ?? FLAGSHIP_MOMENT[stage]
  const demoTasks = () => {
    const made = makeTasks(variant).filter(
      (task) => variant.home !== "calm" || !CROWD_TASKS.has(task.id),
    )
    // The moment's task is laid last of the two groups, so the Verify document the demo serves is the
    // asked moment's. The product task comes only with `?moment=`.
    return [
      ...made,
      demoPlanEntry(demoTask(moment)),
      ...(askedMoment === undefined ? [] : momentTasks()),
    ]
  }
  let tasks = demoTasks()
  const collaborationFixture = new URLSearchParams(
    typeof location === "undefined" ? "" : location.search,
  )
  const chatFixture = collaborationFixture.get("chat") ?? (tourScene === "chat" ? "running" : null)
  if (chatFixture) {
    const task = tasks.find((task) => task.id === DEMO_TASK_ID)
    if (task)
      Object.assign(task, {
        type: "chat",
        stage: "chat",
        gate: null,
        action: null,
        request: "Why does the usage export skip archived accounts?",
        title:
          collaborationFixture.get("chat-long") === "1"
            ? "Investigate why monthly exports omit accounts archived during the reporting period in services/reports/usage-export.ts"
            : "Usage export skips archived accounts",
        files: [
          {
            name: "chat-plan.md",
            exists: true,
            label: "Chat plan",
            kind: "document",
            path: "chat-plan.md",
          },
        ],
        docs: [
          { name: "chat-plan.md", label: "Chat plan", exists: true, status: "", approved: false },
        ],
        archived: chatFixture === "archived",
      })
  }
  /** The running Chat's Codex reports as its hooks do: at work, with its own task list three items in. */
  const chatLive = (now: number) =>
    liveReportOf(
      signalsOf("codex", now, {
        tool: { at: now - 2_000, words: "Editing src/export/account-filter.ts" },
        todo: todoOf(
          [
            "Reproduce the missing archived accounts",
            "Find the filter in the export",
            "Include accounts archived in the period",
            "Update the export tests",
            "Describe the change in docs/export.md",
          ],
          2,
          now,
        ),
      }),
    )
  const chatRunning = chatFixture === "running"
  const limitsMode = collaborationFixture.get("review-limits")
  const applyReviewLimits = () => {
    const task = tasks.find((task) => task.id === DEMO_TASK_ID && atYourReview(task))
    if (!task) return
    if (!["write", "failed", "accepted"].includes(limitsMode ?? "")) return
    const confirmation = DEMO_DECISIONS.find((item) => item.kind === "confirm")
    if (
      confirmation &&
      !flattenItems(task.items ?? []).some((item) => item.id === confirmation.id)
    ) {
      task.items = [...(task.items ?? []), structuredClone(confirmation)]
      task.openItems = openCount(task.items)
      task.needs = needsOf(task.items)
    }
    if (task.gate) task.gate.id ??= "demo-review-gate"
    const settled = (item: Item): Item => ({
      ...item,
      ...(item.children ? { children: item.children.map(settled) } : {}),
      ...(item.family === "look" && item.step === "verify"
        ? {
            state: "chosen" as const,
            updated: false,
            answer: {
              kind: "agree" as const,
              at: Date.now(),
            },
          }
        : {}),
    })
    task.items = task.items?.map(settled)
  }
  applyReviewLimits()
  const finalReview = tasks.find((task) => task.id === DEMO_TASK_ID && atYourReview(task))
  if (finalReview) {
    const checkedCode = "7d2c1e0".padEnd(64, "0")
    const changed = collaborationFixture.get("review-code") === "changed"
    finalReview.reviewEvidence = {
      current: !changed,
      currentCode: changed ? "9c41d0e".padEnd(64, "0") : checkedCode,
      checkedCode,
    }
    const branch = finalReview.branch ?? "feat/usage-billing"
    const commands = [
      `git push -u origin ${branch}`,
      "gh pr create --base main --body-file records/pull-request-body.md",
    ]
    finalReview.review = {
      round: null,
      judge: null,
      verified: false,
      doneMeans: [],
      tiles: [],
      pictures: [],
      proofs: [],
      second: null,
      tryIt: [],
      notVerified: [],
      threads: [],
      reviewers: [],
      pushed: false,
      pr: null,
      ...finalReview.review,
      approve: {
        branch,
        pullRequest: { ok: true, reason: null },
        commands,
        text: commands.join("\n"),
        lastError: null,
      },
    }
  }
  // After approval the shipped change is the code the checks ran on, so its review keeps its results.
  const shippedReview = tasks.find((task) => task.id === DEMO_TASK_ID && task.stage === "shipped")
  if (shippedReview) {
    const checkedCode = "7d2c1e0".padEnd(64, "0")
    shippedReview.reviewEvidence = { current: true, currentCode: checkedCode, checkedCode }
  }
  const demoSessions = createDemoSessions()
  const demoServer = createDemoServerPort(typeof location === "undefined" ? "" : location.search)
  const demoTools = createDemoTools()
  // The start card's branch row reads the demo's own checkout, never the App's routes.
  const branch = demoBranch(
    moment,
    DEMO_TASK_ID,
    typeof location !== "undefined" && new URLSearchParams(location.search).has("story"),
  )
  const runs =
    sharedRuns ??
    createDemoRunAdapter(
      runMomentFrom(typeof location === "undefined" ? "" : location.search) ??
        (chatFixture === "empty"
          ? undefined
          : chatFixture === "starting"
            ? "starting"
            : chatFixture === "failed"
              ? "stopped"
              : chatFixture
                ? "running"
                : initialRun),
      onChange,
      DEMO_TASK_ID,
      (request) => {
        const project = folderProjects.find((row) => row.paths.includes(request.cwd ?? ""))
        if (!project || request.purpose.kind !== "new-task")
          throw new Error("Choose a registered project for this illustrative task.")
        const slug = `demo-${request.idempotencyKey}`
        const id = `${project.id}~${slug}`
        const fresh = demoTask("plan-q")
        tasks.push({
          ...fresh,
          ...(request.purpose.type === "chat"
            ? { type: "chat" as const, stage: "chat" as const }
            : {}),
          id,
          slug,
          title: request.purpose.title ?? request.purpose.request,
          project: project.id,
          projectName: project.name,
          checkout: request.cwd,
          dir: `${request.cwd}/docs/plans/${slug}`,
          answers: request.settings?.answers ?? "app",
          files: taskFiles(project.name, slug, "feature", () => false),
          docs: fresh.docs.map((doc) => ({ ...doc, exists: false })),
          pages: undefined,
          session: null,
          items: [],
          openItems: 0,
          gate: null,
          helpers: [],
          action: null,
          waitingSince: null,
        })
        return id
      },
    )
  setBranchApi(branch.api)
  let nextId = 1
  let config: Config = merge(
    {
      ...clone(DEFAULT_CONFIG),
      theme: "system",
      agentView: "conversation",
      // A visitor is not asked how they work; Settings still shows the choice.
      role: "developer",
      // The demo runs a stable release, so it starts on the Stable channel; the choice is kept like the others.
      updates: { channel: "stable" },
      profile: { name: ME.name },
      notifications: { gateOpened: false, taskFinished: false, sound: true },
      // The story's Plan was reviewed by Codex: its Settings say so.
      ...(typeof location !== "undefined" && new URLSearchParams(location.search).has("story")
        ? { secondOpinion: { ...DEFAULT_CONFIG.secondOpinion, enabled: true, agent: "codex" } }
        : {}),
    } as Config,
    savedSettings(),
  )
  const subagents = helpers()
  // Your own instructions: written here, in memory, with the same base check as the real file.
  let instructions: InstructionsText = { text: "", updated: 0 }
  const get = (id: string): TaskDetail => {
    const found = tasks.find((t) => t.id === id)
    if (!found)
      throw new Error(
        "This illustrative task is no longer in the demo. Choose another task or reset the demo.",
      )
    // The agents at work stay at work as the demo stays open; the quiet one stays quiet.
    if (found.session && !QUIET_TASKS.has(found.id)) found.session.heartbeat = Date.now()
    if (chatRunning && found.id === DEMO_TASK_ID) found.live = chatLive(Date.now())
    return found
  }
  /** `?story`: the example company's day (story-world.ts), with its own Library. */
  const storyDemo =
    typeof location !== "undefined" && new URLSearchParams(location.search).has("story")
  // The lasting artifacts the Artifacts place shows; their open tasks are the demo's own tasks.
  const artifactsDemo = createDemoArtifacts({
    markOf: (id) => {
      const found = tasks.find((t) => t.id === id)
      if (found === undefined) return undefined
      return {
        id,
        title: found.title,
        step: found.stage,
        state: found.action !== null ? "you" : QUIET_TASKS.has(id) ? "quiet" : "work",
      }
    },
    projects: () => folderProjects,
    // The demo task at the person's review drafts on the App Model, so its review page folds pages in.
    ...(atReview(moment) ? { reviewing: { task: DEMO_TASK_ID, project: "web" } } : {}),
    story: storyDemo,
  })
  /** Comments on a lasting artifact's pages, kept for as long as the demo page stays open. */
  const lastingNotes: Comment[] = []
  /** The asks on one of the visitor's tasks, and the approval they hold back. */
  const withAsks = (found: TaskDetail): TaskDetail => {
    const copy = clone(found)
    // What needs you on the smaller tasks, as the server will compute it; the demo task asks its own.
    const extra = extraTask(found.id, found.comments)
    if (extra !== null) {
      copy.items = extra.items
      copy.parts = extra.parts
      copy.checked = extra.checked
      copy.openItems = openCount(extra.items)
    }
    if (found.id === EXPORT_TASK) {
      copy.items = exportItems(found.comments)
      copy.openItems = openCount(copy.items)
    }
    // `?busy=session`, `?busy=changes` or `?busy=overlap` shows the start card of a contested checkout.
    const busy = collaborationFixture.get("busy")
    if (busy === "session") copy.checkoutBusy = { kind: "session" }
    if (busy === "changes") copy.checkoutBusy = { kind: "changes", count: 14 }
    if (busy === "overlap") copy.checkoutBusy = { kind: "overlap", count: 3 }
    return copy
  }
  const folderFixture = new URLSearchParams(
    typeof window === "undefined" ? "" : window.location.search,
  ).get("project-folders")
  const folderProjects =
    folderFixture === "zero"
      ? []
      : folderFixture === "one"
        ? clone(PROJECTS.slice(0, 1))
        : clone(PROJECTS)
  if (variant.state === "long" && folderFixture !== "zero") folderProjects.push(clone(LONG_PROJECT))
  if (folderFixture === "checkouts" && folderProjects[0])
    folderProjects[0].paths.push("/demo/acme/payments-worktree")
  // A question on a line of the change: the demo's session waiting for your review takes it and answers.
  const answerInDemo = (task: TaskDetail, id: string) => {
    const set = (patch: Partial<TaskDetail["comments"][number]>) => {
      task.comments = task.comments.map((c) => (c.id === id ? { ...c, ...patch } : c))
      onChange()
    }
    setTimeout(() => set({ delivered: true, pickedAt: Date.now(), answeredBy: "session" }), 400)
    setTimeout(
      () =>
        set({
          answer:
            "The gateway's own limit wins: meter.ts reads it per plan, and the broker's default applies only when the gateway sends none.",
          answered: Date.now(),
        }),
      2600,
    )
  }
  // A comment on a planning document: the demo's agent is busy, so it queues; a helper steps in after a
  // short wait (the real one waits 90 s), answers a few seconds later, and "Answer now" skips the wait.
  const DEMO_PICK_MS = 12_000
  const demoComment = (task: TaskDetail, id: string) =>
    task.comments.find((c) => c.id === id) as Comment
  // What the Feedback and Agent tabs say: how many comments wait, and whether a helper answers.
  const syncAnswering = (task: TaskDetail) => {
    const open = task.comments.filter(
      (c) =>
        c.id.startsWith("demo-thread-") &&
        c.answer === undefined &&
        c.resolved === undefined &&
        c.for !== "person",
    )
    task.answering =
      open.length === 0
        ? null
        : {
            helper: open.some((c) => c.answeredBy === "helper")
              ? { name: "Sonnet 5.5", model: "sonnet-5.5", started: Date.now() }
              : null,
            waiting: open.length,
            since: Math.min(...open.map((c) => c.created)),
          }
  }
  const patchComment = (task: TaskDetail, id: string, patch: Partial<Comment>) => {
    task.comments = task.comments.map((c) => (c.id === id ? { ...c, ...patch } : c))
    syncAnswering(task)
    onChange()
  }
  const helperAnswers = (task: TaskDetail, id: string, after: number) => {
    const now = Date.now()
    patchComment(task, id, { answeredBy: "helper", delivered: true, pickedAt: now })
    setTimeout(() => {
      const c = demoComment(task, id)
      if (c.answer !== undefined || c.resolved !== undefined) return
      // The person's comment on the 80 % alert: the agent caps the overage and the Plan says so.
      if (
        task.id === DEMO_TASK_ID &&
        (c.quote === ALERT_SENTENCE || /overage|runaway|\bcap\b/i.test(c.remark))
      ) {
        capOverage()
        task.pages = task.pages?.map((page) =>
          page.step === "plan"
            ? stepPage("plan", taskDocument(TASK_FILES.plan) ?? page.body)
            : page,
        )
        patchComment(task, id, { answer: CAP_ANSWER, answered: Date.now(), changed: true })
        return
      }
      patchComment(task, id, { answer: helperAnswerFor(task, c.remark), answered: Date.now() })
    }, after)
  }
  const api: WalkthroughApi & ScreenEvidenceApi & { docsRoute: typeof interactionApi.taskRoute } = {
    currentTurnLayout: true,
    docsRoute: async <T>(id: string, lane: string, action: string, init?: RequestInit) => {
      if (lane !== "docs") throw new Error("This action is unavailable in the source demo.")
      const task = get(id)
      const threads = (): CommentThread[] => {
        const groups = new Map<string, Comment[]>()
        for (const comment of task.comments) {
          if (comment.kind !== undefined && comment.remark === "") continue
          const key = comment.thread?.id ?? comment.id
          groups.set(key, [...(groups.get(key) ?? []), comment])
        }
        return [...groups].map(([key, comments]) => {
          const root = comments[0] as Comment
          return {
            id: key,
            doc: root.doc,
            item: root.item ?? null,
            quote: root.quote,
            state: comments.every((c) => c.resolved !== undefined) ? "resolved" : "open",
            comments,
            replies: comments.flatMap(
              (comment) =>
                comment.teamReplies ??
                (comment.answer === undefined
                  ? []
                  : [
                      {
                        id: `${comment.id}:answer`,
                        author: { name: "Agent", email: "" },
                        text: comment.answer,
                        at: comment.answered ?? comment.created,
                        via: "agent" as const,
                        ...(comment.answeredBy === "helper" ? { helper: "Sonnet 5.5" } : {}),
                      },
                    ]),
            ),
            delivery: ["implement", "verify"].includes(task.stage) ? "saved" : "with-approval",
            ...(root.id.startsWith("demo-thread-") && helperDoc(root.doc)
              ? {
                  handling:
                    threadHandling(comments, {
                      now: Date.now(),
                      agent: "Claude Code",
                      reach: "busy",
                      // The step the agent is on, as its note names it ("Plan", "Implement").
                      busyWith: task.stage.charAt(0).toUpperCase() + task.stage.slice(1),
                      helper: { name: "Sonnet 5.5", line: `Reading ${root.doc}` },
                      deadline: DEMO_PICK_MS,
                    }) ?? undefined,
                }
              : {}),
            tally: null,
          }
        })
      }
      if (action === "threads") return clone({ threads: threads() }) as T
      if (init?.body instanceof FormData)
        throw new Error("Attachments are unavailable in this illustrative demo.")
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        thread?: string
        doc?: string
        quote?: string
        remark?: string
        for?: "agent" | "person"
        before?: string
        after?: string
        section?: string
        item?: string
        pin?: string
      }
      if (action === "resolve" || action === "reopen") {
        const thread = threads().find((one) => one.id === body.thread)
        if (!thread) throw new Error("This feedback is no longer in the demo.")
        for (const comment of thread.comments) {
          if (action === "resolve") comment.resolved = Date.now()
          else delete comment.resolved
        }
        onChange()
        return clone({ thread: threads().find((one) => one.id === body.thread) }) as T
      }
      if (action === "helper") {
        const open = threads().find((one) => one.id === body.thread)
        if (!open) throw new Error("This feedback is no longer in the demo.")
        for (const c of open.comments)
          if (c.answer === undefined && c.answeredBy !== "helper") helperAnswers(task, c.id, 2500)
        return clone({ thread: threads().find((one) => one.id === body.thread) }) as T
      }
      if (action !== "thread" || !body.remark?.trim())
        throw new Error("Write feedback before sending it.")
      const parent = body.thread ? threads().find((one) => one.id === body.thread) : undefined
      if (body.thread && !parent) throw new Error("This feedback is no longer in the demo.")
      const comment: Comment = {
        id: `demo-thread-${Date.now()}-${task.comments.length}`,
        doc: parent?.doc ?? body.doc ?? NAMES.plan,
        quote: parent?.quote ?? body.quote ?? "",
        remark: body.remark,
        created: Date.now(),
        ...(body.before !== undefined ? { before: body.before } : {}),
        ...(body.after !== undefined ? { after: body.after } : {}),
        ...(body.section !== undefined ? { section: body.section } : {}),
        ...(body.item !== undefined ? { item: body.item } : {}),
        ...(body.pin !== undefined ? { pin: body.pin } : {}),
        ...(parent ? { thread: { id: parent.id, state: "open" } } : {}),
        ...((parent?.comments[0]?.for ?? body.for)
          ? { for: parent?.comments[0]?.for ?? body.for }
          : {}),
      }
      task.comments.push(comment)
      syncAnswering(task)
      onChange()
      if (helperDoc(comment.doc) && comment.for !== "person")
        setTimeout(() => {
          const c = demoComment(task, comment.id)
          if (c.answeredBy === undefined && c.answer === undefined && c.resolved === undefined)
            helperAnswers(task, comment.id, 3500)
        }, DEMO_PICK_MS)
      return clone({ thread: threads().find((one) => one.id === (parent?.id ?? comment.id)) }) as T
    },
    memory: createDemoMemory(onChange),
    // Settings › Automations: the draft's three automations and five deliveries; nothing is sent.
    automations: createDemoAutomations(PROJECTS.map(({ id, name }) => ({ id, name }))),
    // New chat's resume list reads agent history from this computer; the demo has none to read.
    agentHistory: {
      sessions: async () => ({ total: 0, sessions: [] }),
      resume: async () => {
        throw new Error("This illustrative folder has no agent sessions to resume.")
      },
    },
    projects: async () => clone(folderProjects),
    projectFolders: async () => ({
      folders: [...new Set(folderProjects.flatMap((project) => project.paths))].map((path) => ({
        path,
        available: true,
      })),
      truncated: false,
    }),
    pickProjectFolder: async () => {
      if (folderFixture !== null) throw new Error("Enter a folder path for this example.")
      // The source demo selects an illustrative folder; it does not draw or claim an OS dialog.
      return {
        kind: "selected" as const,
        folder: { path: "/demo/empty-project", checkout: null, canInitialize: true },
      }
    },
    projectFolder: async (path = "/demo") => {
      if (!path.startsWith("/demo"))
        throw new Error("This illustrative folder does not exist. Choose a folder under /demo.")
      const known = folderProjects.flatMap((project) => project.paths)
      const checkout = known.find((at) => path === at || path.startsWith(`${at}/`)) ?? null
      return {
        path,
        parent: path === "/demo" ? null : "/demo",
        directories:
          path === "/demo"
            ? [
                { name: "empty-project", path: "/demo/empty-project" },
                ...known.map((at) => ({ name: at.slice(6), path: at })),
              ]
            : [],
        truncated: false,
        checkout,
        canInitialize: path === "/demo/empty-project",
      }
    },
    chooseProjectFolder: async (path, initialize = false) => {
      const project = PROJECTS.find((item) =>
        item.paths.some((at) => path === at || path.startsWith(`${at}/`)),
      )
      if (project) return { project: clone(project), path: project.paths[0] ?? path }
      if (path === "/demo/empty-project" && initialize) {
        // Choosing the folder registers it, as the real route does: the project list has it from now on.
        const made = { id: "empty-demo", name: "empty-project", paths: [path], lastSeen: 1 }
        if (!folderProjects.some((item) => item.id === made.id)) folderProjects.push(made)
        return { project: clone(made), path }
      }
      throw new Error("Choose a checkout or explicitly initialize the illustrative empty folder.")
    },
    // The pictures the verdicts cite, by run (Verify's Pictures).
    verificationScreens: async (id) => ({
      screens: [],
      runs: id === DEMO_TASK_ID ? demoVerificationRuns(moment) : [],
    }),
    // A task's change, top to bottom (the review's walkthrough): the billing task's own, or a smaller task's.
    walkthrough: async (id) => {
      const walk =
        id === DEMO_TASK_ID
          ? chatFixture
            ? chatWalkthrough()
            : demoWalkthrough()
          : taskWalkthrough(id)
      if (walk === null) throw new Error("The demo has no walkthrough for this task")
      const copy = structuredClone(walk)
      const items = flattenItems(get(id).items ?? [])
      for (const point of copy.points) {
        const answer = items.find(
          (item) => item.kind === "confirm" && item.id.endsWith(`:done:${point.n}`),
        )?.answer
        if (answer?.kind === "confirm") point.status = "confirmed by you"
      }
      return copy
    },
    tasks: async () =>
      clone(tasks)
        .filter((task) => !collaborationFixture.has("chat-entry") || task.slug.startsWith("demo-"))
        .map((t) => {
          if (chatRunning && t.id === DEMO_TASK_ID) return { ...t, live: chatLive(Date.now()) }
          const extra = extraTask(t.id, t.comments)
          if (extra !== null)
            return { ...t, openItems: openCount(extra.items), needs: needsOf(extra.items) }
          if (t.id === EXPORT_TASK) {
            const items = exportItems(t.comments)
            return { ...t, openItems: openCount(items), needs: needsOf(items) }
          }
          return t
        }),
    task: async (id) => withAsks(get(id)),
    chatPromotion: async (id) => ({
      allowed: get(id).stage === "chat" && chatFixture !== "helpers",
      running: chatFixture === "helpers" ? ["slice 2"] : [],
    }),
    promoteChat: async (id, type) => {
      const task = get(id)
      if (task.stage !== "chat") throw new Error("This task is no longer a Chat.")
      if (chatFixture === "helpers")
        throw new Error("A slice is still building: let it finish or stop it first")
      const promoted = demoTask("plan-q")
      const identity = {
        id: task.id,
        project: task.project,
        projectName: task.projectName,
        slug: task.slug,
        title: task.title,
        request: task.request,
        dir: task.dir,
        created: task.created,
        branch: task.branch,
        checkout: task.checkout,
        session: task.session,
      }
      Object.assign(task, {
        ...promoted,
        ...identity,
        stage: "plan",
        type,
        docs: promoted.docs,
        pages: promoted.pages,
        files: taskFiles(task.projectName, task.slug, type, (role) => role === "plan"),
      })
      onChange()
      return { task: clone(task), then: "Plan" }
    },
    sections: async (id, name) => {
      const task = get(id)
      const found =
        id === PRODUCT_TASK
          ? productSections(name)
          : pageText(task, name, id === DEMO_TASK_ID) === undefined
            ? undefined
            : taskSections(name, pageText(task, name, id === DEMO_TASK_ID), task.type)
      if (found === undefined) throw new Error(`${name} does not exist yet`)
      return found
    },
    doc: async (id, name) => {
      const known = get(id)
      if (chatFixture && id === DEMO_TASK_ID && ["chat-plan.md", "chat-slices.md"].includes(name))
        return {
          name,
          markdown: `# ${name === "chat-plan.md" ? "Usage export plan" : "Chat slices"}\n\nInclude accounts archived during the reporting period.\n\n1. Reproduce the missing accounts.\n2. Preserve period boundaries.\n3. Verify the exported rows.`,
          validation: { valid: true, errors: [] },
        }
      // A file the agent has not written yet is not there, as the server answers.
      // An earlier-workflow task's files are plain Markdown, read as they are.
      const markdown =
        id === PRODUCT_TASK
          ? productDocument(name)
          : id === EARLIER_TASK
            ? EARLIER_DOCS[name]
            : known.files.some((f) => f.name === name && !f.exists)
              ? undefined
              : pageText(known, name, id === DEMO_TASK_ID)
      if (markdown === undefined) throw new Error(`${name} does not exist yet`)
      return { name, markdown, validation: { valid: true, errors: [] } }
    },
    artifact: async (id, name) => {
      get(id)
      await Promise.resolve()
      // The product task's Plan has its wireframe.
      if (id === PRODUCT_TASK)
        return withBridge(name.endsWith("orders-page.html") ? PRODUCT_TALL_PAGE : PRODUCT_WIREFRAME)
      // The billing task draws its own mockups; the other tasks keep none of their own.
      if (id !== DEMO_TASK_ID) return switchPanel()
      const page = name.replace(/^artifacts\//, "")
      // With the bridge the server adds, so feedback can be pinned on a spot of the page.
      return withBridge((FLAGSHIP_ARTIFACTS[`artifacts/${page}`] ?? planLimits)())
    },
    // The demo's tasks keep their mockups in the Plan; on the shelf are the drafts on a lasting
    // artifact that the Artifacts place lists (the fold card at your review reads them), and the billing
    // task's own Plan and limits page (App Model: artifact `plan-limits`).
    taskArtifacts: async (id) => {
      const known = get(id)
      await Promise.resolve()
      const drafts = artifactsDemo.draftsOf(id)
      const own = id === DEMO_TASK_ID ? [...PLAN_DESIGNS, PLAN_LIMITS_ARTIFACT] : []
      const project = drafts.find((d) => d.draftOn?.project !== undefined)?.draftOn?.project ?? ""
      return {
        task: [...own, ...drafts],
        projectId: own.length ? known.project : project || "demo",
        projectName: own.length ? known.projectName : project || "demo",
      }
    },
    projectArtifacts: async () => ({ artifacts: [], comments: structuredClone(lastingNotes) }),
    // A lasting artifact's page or a task's draft is a small interactive document; any other artifact is the task's own mockup.
    artifactPage: async (where, file) =>
      artifactsDemo.page(file) ??
      (where.scope === "task" ? await api.artifact(where.id, file) : "<p></p>"),
    artifactContext: async (where, file) => {
      const source = await demoArtifactSource(api, { ...where, file })
      return {
        revision: source.revision,
        prompt: `Artifact: ${source.title}\nScope: ${where.scope}\nProject or task: ${where.id}\nSource: ${file}\nPages: ${source.pages.join(", ")}`,
      }
    },
    artifactsOverview: async () => artifactsDemo.overview(await look.looks()),
    lastingArtifact: async (project, name) => {
      const owner = artifactsDemo
        .overview(await look.looks())
        .projects.find((p) => p.id === project)
      const artifact = owner?.lasting.find((item) => item.name === name)
      if (owner === undefined || artifact === undefined)
        throw new Error(`${name} is not a lasting artifact of this project`)
      return { project: { id: owner.id, name: owner.name }, artifact }
    },
    lastingHistory: async (project, name) => artifactsDemo.history(project, name),
    keepArtifact: async (project, request) => {
      const kept = artifactsDemo.keep(project, request)
      onChange()
      return kept
    },
    newArtifact: async (project, request) => {
      const made = artifactsDemo.create(project, request)
      onChange()
      return made
    },
    manageLibraryArtifact: async (project, name, request) => {
      const done = artifactsDemo.manage(project, name, request)
      onChange()
      return done
    },
    alsoShowArtifact: async (project, ref) => {
      const current = (await look.looks()).projects[project]?.artifacts ?? []
      if (!current.includes(ref)) await look.setLook(project, { artifacts: [...current, ref] })
    },
    // Only the listing goes: the artifact stays in its owner project.
    stopShowingArtifact: async (project, ref) => {
      const current = (await look.looks()).projects[project]?.artifacts ?? []
      if (current.includes(ref))
        await look.setLook(project, { artifacts: current.filter((entry) => entry !== ref) })
    },
    draftOnArtifact: async (task, request) => {
      const found = get(task)
      const made = artifactsDemo.draftOn(task, found.project, request)
      onChange()
      return made
    },
    foldPreview: async (task, draft) => artifactsDemo.foldPreview(task, draft),
    foldArtifact: async (task, request) => {
      const result = artifactsDemo.fold(task, request)
      if (result.folded) onChange()
      return result
    },
    // Comments stay in memory, so Comment mode works in the source demo: a lasting artifact keeps
    // them with the library, a task's own artifact with the task's feedback, as the server does.
    artifactComment: async (where, file, remark, spot) => {
      const task = where.scope === "task" ? get(where.id) : undefined
      const comment: Comment = {
        id: `demo-artifact-${task ? `${task.id}-${task.comments.length + 1}` : lastingNotes.length + 1}`,
        doc: file,
        quote: "",
        remark,
        created: Date.now(),
        ...(spot !== undefined ? { spot } : {}),
      }
      if (task) task.comments.push(comment)
      else lastingNotes.push(comment)
      onChange()
      return comment
    },
    artifactResolve: async (where, file, id) => {
      const found = lastingNotes.find((c) => c.id === id && c.doc === file)
      if (where.scope === "project" && found !== undefined) found.resolved = Date.now()
      onChange()
    },
    artifactOpen: async (where, file, _how, options) => {
      if (chatFixture && options?.viewer && where.scope === "project")
        location.hash = `#/artifact/${encodeURIComponent(where.id)}/${encodeURIComponent(file)}`
    },
    // Evidence is drawn: the demo runs no test, and says so in each picture.
    evidence: async (id, name) => {
      get(id)
      // The Rate-limit task's own run is the terminal; the billing task's evidence is its pages and logs.
      if (id !== DEMO_TASK_ID)
        return { name, kind: "image", type: "image/svg+xml", base64: btoa(refusedExportSvg()) }
      return /\.(png|jpe?g|svg)$/i.test(name)
        ? { name, kind: "image", type: "image/svg+xml", base64: btoa(flagshipEvidenceSvg(name)) }
        : { name, kind: "text", text: flagshipEvidenceText(name) }
    },
    // The demo's tasks keep no agent/ folder: a record reads as its evidence text.
    record: async (id, path) => {
      get(id)
      // The demo task's pull request body, as GitHub gets it.
      if (id === DEMO_TASK_ID && path === "records/pull-request-body.md")
        return demoPullRequestBody()
      return flagshipEvidenceText(path.split("/").pop() ?? path)
    },
    // An illustrative cost, of the size a real feature run has; no transcript is read.
    cost: async (id) => {
      const found = get(id)
      return demoCost(id, found.stage)
    },
    // Explicitly illustrative ledger records exercise the same Home contract as the local server.
    homeFacts: async ({ project, agent, timezone }) => {
      const now = Date.now()
      const all = await api.tasks()
      const scoped = all.filter(
        (t) => (!project || t.project === project) && (!agent || agentIdOf(t) === agent),
      )
      const ids = new Set(scoped.map((t) => t.id))
      const costs = Object.fromEntries(all.map((t) => [t.id, demoCost(t.id, t.stage).total.usd]))
      const calls = all.map((t, index) => ({
        at: now - index * 18 * 3_600_000,
        taskId: t.id,
        title: t.title,
        usd: costs[t.id] ?? 0,
      }))
      const periods = calendarPeriods(now, timezone)
      const spending = Object.fromEntries(
        Object.entries(periods).map(([period, range]) => {
          const rows = calls
            .filter(
              (call) =>
                ids.has(call.taskId) &&
                call.at >= range.from &&
                call.at < Math.min(now + 1, range.to),
            )
            .map((call) => ({ id: call.taskId, title: call.title, usd: call.usd }))
          const unpriced = rows.some((row) => row.id === all[0]?.id)
            ? [{ model: "illustrative-unpriced-model", tokens: 349_000_000 }]
            : []
          return [
            period,
            { usd: rows.reduce((sum, row) => sum + row.usd, 0), tasks: rows, unpriced },
          ]
        }),
      )
      return homeFacts(scoped, now, timezone, costs, {}, spending)
    },
    changes: async (id) => {
      get(id)
      return chatFixture && id === DEMO_TASK_ID ? chatChanges() : demoTaskChanges(id)
    },
    // These illustrative fixtures retain no native history; Clear never deletes their code or walkthrough.
    clearTaskChanges: async (id) => {
      get(id)
      onChange()
      return { cleared: true as const }
    },
    fileDiff: async (id, path) =>
      id === DEMO_TASK_ID
        ? chatFixture
          ? chatFileDiff(path)
          : demoFileDiff(path)
        : taskFileDiff(id, path),
    reviewFileSource: async (id, request) => {
      get(id)
      const walk =
        id === DEMO_TASK_ID
          ? chatFixture
            ? chatWalkthrough()
            : demoWalkthrough()
          : taskWalkthrough(id)
      if (
        ![...(walk?.decided ?? []), ...(walk?.slices.flatMap((slice) => slice.files) ?? [])].some(
          (file) => file.path === request.path,
        )
      )
        throw new Error("That file is not part of this illustrative change.")
      throw new Error(
        "This demo supplies changed hunks, not complete source at a verified revision. Read the diff instead.",
      )
    },
    putComments: async (id, doc, drafts) => {
      const task = get(id)
      // What the team said stays: it is not the person's draft to replace.
      const kept = task.comments.filter(
        (c) => c.doc !== doc || c.delivered || c.build || c.source !== undefined,
      )
      const next: typeof task.comments = []
      // One draft answer per item: a later one replaces the earlier.
      const answered = new Map<string, number>()
      for (const d of drafts) {
        // Only a kind the model knows is an answer, as on the server.
        const isAnswer =
          d.item !== undefined &&
          d.kind !== undefined &&
          (ANSWER_KINDS as readonly string[]).includes(d.kind)
        if (d.remark.trim() === "" && !isAnswer) continue
        const comment = {
          id: d.id ?? `demo-${Date.now()}-${next.length}`,
          doc,
          quote: d.quote,
          remark: d.remark,
          created: Date.now(),
          ...(doc === "final" && d.anchor !== undefined ? { anchor: d.anchor } : {}),
          ...(doc === "final" && d.anchor !== undefined && d.ask !== undefined
            ? {
                ask: d.ask,
                ...(d.ask === "replace" && d.replace !== undefined ? { replace: d.replace } : {}),
              }
            : {}),
          ...(d.item !== undefined ? { item: d.item } : {}),
          ...(d.item !== undefined && d.pin !== undefined ? { pin: d.pin } : {}),
          ...(isAnswer ? { kind: d.kind } : {}),
          ...(isAnswer && d.seen !== undefined ? { seen: d.seen } : {}),
        }
        const same = isAnswer && d.item !== undefined ? answered.get(d.item) : undefined
        if (same !== undefined) next[same] = comment
        else {
          if (isAnswer && d.item !== undefined) answered.set(d.item, next.length)
          next.push(comment)
        }
      }
      task.comments = [...kept, ...next]
      const confirms = new Map(
        next
          .filter((comment) => comment.kind === "confirm" && comment.item)
          .map((comment) => [comment.item, comment]),
      )
      const confirmed = (items: Item[]): Item[] =>
        items.map((item) => {
          const receipt = confirms.get(item.id)
          if (
            item.kind === "confirm" &&
            receipt &&
            (item.digest === undefined || receipt.seen === item.digest)
          )
            return {
              ...item,
              state: "chosen",
              updated: false,
              answer: {
                kind: "confirm",
                at: receipt.created,
                ...(receipt.remark ? { note: receipt.remark } : {}),
              },
            }
          return item.children ? { ...item, children: confirmed(item.children) } : item
        })
      task.items = confirmed(task.items ?? [])
      task.openItems = openCount(task.items)
      task.needs = needsOf(task.items)
      for (const c of next) if (c.ask === "question") answerInDemo(task, c.id)
      onChange()
      return clone(task.comments)
    },
    // The demo has no reviewers to run: a finding is marked as the person chose, and Ask another
    // reviewer reports a review that found nothing, so the flow can be clicked through.
    finding: async (id, findingId, body) => {
      const task = get(id)
      task.findings = (task.findings ?? []).map((f) =>
        f.id === findingId
          ? {
              ...f,
              disposition: {
                kind: body.kind,
                ...(body.reason ? { reason: body.reason } : {}),
                at: Date.now(),
              },
            }
          : f,
      )
      onChange()
      return clone(task.findings)
    },
    anotherReview: async (id, file) => {
      const task = get(id)
      const run = {
        id: String(Date.now()),
        by: "Codex",
        model: "gpt-6.1-sol",
        ...(file !== null ? { file } : {}),
        state: "done" as const,
        started: Date.now(),
        ended: Date.now(),
      }
      task.anotherReviews = [...(task.anotherReviews ?? []), run]
      onChange()
      return clone(run)
    },
    askAgain: async (id, commentId) => {
      const task = get(id)
      task.comments = task.comments.map((c) => {
        if (c.id !== commentId) return c
        const { noAnswer: _gone, ...rest } = c
        return rest
      })
      answerInDemo(task, commentId)
      onChange()
      return clone(task.comments)
    },
    buildComment: async (id, anchor, remark) => {
      const task = get(id)
      const comment = {
        id: `demo-build-${Date.now()}`,
        doc: "build",
        quote: anchor.quote ?? "",
        remark,
        created: Date.now(),
        build: anchor,
      }
      task.comments = [...task.comments, comment]
      onChange()
      return clone(comment)
    },
    answerItem: async (_id, body) => {
      onChange()
      return { answered: body.kind }
    },
    review: async (id, action) => {
      if (action.t === "thread") {
        const task = get(id)
        if (action.thread && task.comments.some((comment) => comment.thread?.id === action.thread))
          return { review: null }
        const at = Date.now()
        task.comments.push(
          ...reviewComments({
            threads: [
              {
                id: action.thread ?? `demo-review-${nextId++}`,
                anchor: action.anchor,
                messages: [
                  { id: `d${nextId++}`, by: task.me.name, at, text: action.text, src: "me" },
                ],
                state: "open",
                created: at,
                by: task.me.name,
                src: "me",
              },
            ],
          }),
        )
        onChange()
      }
      return { review: null }
    },
    gate: async (id, requested, _remark, _gateId, ship, options) => {
      const task = get(id)
      let decision = requested
      if (task.gate?.decision !== "pending")
        throw new Error("This review is already decided. Reset the demo to try it again.")
      if (_gateId !== undefined && task.gate.id !== undefined && _gateId !== task.gate.id)
        throw new Error("The review changed. Open its current gate.")
      if (limitsMode === "failed" && requested === "approved" && options?.revision !== undefined)
        throw new Error("Illustrative save failure")
      const target = task.gate.target
      // An unsent answer that asks for a change turns an approval into changes, as the server does.
      const targets = [target]
      const unsent = task.comments.filter((c) => c.delivered !== true && targets.includes(c.doc))
      const asking = changeCount(
        unsent.flatMap((c) => (c.kind !== undefined ? [{ kind: c.kind }] : [])),
      )
      const turned = target !== "final" && decision === "approved" && asking > 0
      if (turned) decision = "changes"
      // Approve and open a pull request needs gh and the task's own branch: refused before anything is recorded.
      const choice = task.review?.approve?.pullRequest
      if (
        decision === "approved" &&
        target === "final" &&
        ship === "pull-request" &&
        choice?.ok === false
      ) {
        throw new Error(
          `${choice.reason ?? "The pull request is off"}. Approve only, or copy the git commands.`,
        )
      }
      task.gate.decision = decision
      task.gate.settled = true
      if (
        task.question?.gate === target &&
        task.question.item === undefined &&
        (task.question.gateId === undefined || task.question.gateId === task.gate.id)
      )
        task.question = null
      task.action = null
      // The answers and comments go to the agent with the decision: as changes, or as notes with an approval.
      task.comments.forEach((c) => {
        if (targets.includes(c.doc)) c.delivered = true
      })
      let pr: PullRequestView | null = null
      if (decision === "approved" && target === "final") {
        task.stage = "shipped"
        setVerifyMode(task, null)
        task.session = null
        // What shipped: the billing task's slices and files, or the smaller task's own.
        const walk = id === DEMO_TASK_ID ? demoWalkthrough() : null
        task.closing = {
          shipped: "just now",
          slices: walk?.totals.slices ?? (task.slices.length || 3),
          firstPass: id !== DEMO_TASK_ID,
          touched: walk?.slices.flatMap((s) => s.files.map((f) => f.path)) ?? [
            "src/export/limit.ts",
          ],
        }
        pr = shipDemoReview(task, ship)
      } else if (task.session) task.session.state = "busy"
      onChange()
      return {
        target,
        decision,
        ...(pr !== null ? { pr } : {}),
        ...(unsent.length > 0 ? { sent: unsent.length } : {}),
        ...(turned ? { turned: true as const } : {}),
      }
    },
    // The demo runs no agent: an answer closes the card, and nothing asks the next question.
    answerQuestion: async (id, body) => {
      const task = get(id)
      const open = task.question
      if (open == null || open.id !== body.id) throw new Error("That question is not open any more")
      if ("more" in body) {
        const asked = demoMore(task, open, body.more.request, onChange)
        onChange()
        return { more: asked }
      }
      const label =
        "choices" in body
          ? body.choices.map((i) => open.choices[i]?.label ?? "").join(" + ")
          : "choice" in body
            ? (open.choices[body.choice]?.label ?? "")
            : "text" in body
              ? body.text
              : recommendedLabel(open)
      const answered = {
        id: open.id,
        question: open.question,
        number: open.number,
        choice: label,
        at: Date.now(),
        via: "app" as const,
        choices: open.choices.map((c) => c.label),
        recommended: open.recommended,
        ...(open.recommendedChoices ? { recommendedChoices: open.recommendedChoices } : {}),
        ...(open.multi === true && open.gate === undefined ? { multi: true as const } : {}),
        ...("unsure" in body ? { kind: "unsure" as const } : {}),
        ...("choices" in body || ("unsure" in body && open.multi && open.recommendedChoices)
          ? {
              picked: "choices" in body ? body.choices : recommendedIndices(open),
              pickedLabels: ("choices" in body ? body.choices : recommendedIndices(open)).map(
                (i) => open.choices[i]?.label ?? "",
              ),
            }
          : {}),
      }
      task.answeredQuestions = [...(task.answeredQuestions ?? []), answered]
      const call = task.items?.find((item) => item.id === open.item && item.call !== undefined)
      if (call) {
        const kind = "choice" in body ? open.choices[body.choice]?.kind : "change"
        const note = "choice" in body ? (body.choice === 0 ? "A" : "B") : label
        task.items = task.items?.map(
          (item): Item =>
            item.id === call.id
              ? {
                  ...item,
                  state: "settled",
                  answer: { kind: kind ?? "agree", note, at: answered.at },
                }
              : item,
        )
        if (kind === "change")
          task.comments.push({
            id: `demo-call-${open.id}`,
            doc: open.gate ?? TASK_FILES.plan,
            quote: call.what,
            remark: note,
            kind: "change",
            item: call.id,
            seen: call.digest,
            created: answered.at,
          })
        task.openItems = openCount(task.items ?? [])
        task.needs = needsOf(task.items ?? [])
      }
      task.question = null
      // A batch hands the card its next open member and ticks the one answered.
      advanceBatch(task, open.id, label)
      // The answered question no longer waits for the person: its open item closes, and the top
      // bar's Your turn counts down.
      const asked = (task.items ?? []).findIndex((i) => i.kind === "question" && i.state === "open")
      if (asked >= 0) {
        task.items = (task.items ?? []).filter((_, at) => at !== asked)
        task.openItems = openCount(task.items)
      }
      demoMulti(task)
      onChange()
      return { answered }
    },
    focusQuestion: async (id, question) => {
      focusMember(get(id), question)
      onChange()
    },
    cancelMore: async (id) => {
      const task = get(id)
      demoCancelMore(task)
      onChange()
      return { question: task.question }
    },
    // The demo has no taskless Home questions.
    homeQuestions: async () => [],
    homeQuestion: async () => ({}),
    changeAnswer: async (id, body) => {
      const task = get(id)
      const all = task.answeredQuestions ?? []
      const at = all.findLastIndex((a) => a.number === body.number)
      const entry = all[at]
      if (entry === undefined) throw new Error("That question has no answer to change")
      const { picked: _picked, pickedLabels: _labels, note: _note, ...rest } = entry
      // A several-answer question's whole set replaces its picks; own words add one more.
      const picks = [
        ...(body.choices ??
          (entry.multi === true && body.choice !== undefined ? [body.choice] : [])),
      ].sort((x, y) => x - y)
      const words = body.text?.trim() ?? ""
      const named = picks.map((i) => entry.choices?.[i] ?? "")
      const choice =
        picks.length > 0
          ? [...named, ...(words !== "" ? [words] : [])].join(" + ")
          : body.choice !== undefined
            ? (entry.choices?.[body.choice] ?? entry.choice)
            : (body.text ?? "")
      task.answeredQuestions = all.map((a, i) =>
        i === at
          ? {
              ...rest,
              choice,
              ...(picks.length > 0
                ? { picked: picks, pickedLabels: named, ...(words !== "" ? { note: words } : {}) }
                : {}),
            }
          : a,
      )
      if (task.batch != null)
        task.batch = {
          ...task.batch,
          members: task.batch.members.map((m) =>
            m.id === entry.id ? { ...m, answer: choice } : m,
          ),
        }
      onChange()
      return { answered: task.answeredQuestions[at] }
    },
    // The demo runs no build to check a need: "Done, it's set" marks it set, and nothing more.
    needSet: async (id, need, note) => {
      const task = get(id)
      const found = task.live?.needs.find((n) => n.for === need)
      if (found === undefined) throw new Error(`no need is recorded for ${need}`)
      found.state = "set"
      found.set = { at: Date.now(), note }
      onChange()
      return found
    },
    // The demo pushes nothing: the fix's checks start again in the pull request's memory.
    pushFix: async (id) => {
      const task = get(id)
      const life = task.pullRequest
      if (life === undefined) throw new Error("This task has no pull request to push a fix to.")
      task.pullRequest = {
        ...life,
        checks: life.checks.map((c) =>
          c.result === "failed" ? { ...c, result: "running", detail: "in progress" } : c,
        ),
        waiting: { ...life.waiting, failing: 0, fixReady: false },
      }
      onChange()
      return { pushed: true, branch: life.branch, pullRequest: task.pullRequest }
    },
    // The demo reads no Git: the person's word lands the change, and approving a change moves the approved head.
    markMerged: async (id) => {
      const task = get(id)
      const landing = task.landing
      if (!landing) throw new Error("This task has no approved change to mark as merged.")
      task.landing = { ...landing, state: "landed", how: "person", at: Date.now(), since: [] }
      onChange()
      return task.landing
    },
    landingDiff: async (id) => {
      const landing = get(id).landing
      const from = landing?.approvedHead ?? ""
      const to = landing?.since[0]?.sha ?? from
      if (to === from) return { from, to, files: [], patch: "", truncated: false }
      return {
        from,
        to,
        files: [{ path: "src/usage/empty-state.tsx", added: 1, removed: 1 }],
        patch: [
          "diff --git a/src/usage/empty-state.tsx b/src/usage/empty-state.tsx",
          "--- a/src/usage/empty-state.tsx",
          "+++ b/src/usage/empty-state.tsx",
          "@@ -3,3 +3,3 @@",
          " export function EmptyState() {",
          "-  return <p>Nothing here</p>",
          "+  return <p>No usage yet</p>",
          " }",
          "",
        ].join("\n"),
        truncated: false,
      }
    },
    approveChange: async (id, sha) => {
      const task = get(id)
      const landing = task.landing
      if (!landing || landing.state !== "landing")
        throw new Error("This task has no approved change waiting.")
      task.landing = { ...landing, approvedHead: sha, since: [] }
      onChange()
      return task.landing
    },
    // Leave them for now: what waits stops asking in this memory, with nothing sent to GitHub.
    leavePullRequest: async (id) => {
      const task = get(id)
      const life = task.pullRequest
      if (life === undefined) throw new Error("This task has no open pull request.")
      task.pullRequest = {
        ...life,
        waiting: { ...life.waiting, threads: 0, failing: 0, changes: false, left: true },
      }
      onChange()
      return { left: true, pullRequest: task.pullRequest }
    },
    // Build in that session: the demo approves; no terminal planner runs here.
    buildHere: async (id, body) => api.gate(id, "approved", body.remark, body.gateId),
    // The demo runs no build: the start the visitor copied is only handed back.
    start: async (id, choice) => {
      get(id)
      return { ...choice, at: Date.now() }
    },
    archive: async (id, archived) => {
      const task = get(id)
      task.archived = archived
      task.archivedAt = archived ? Date.now() : undefined
      onChange()
      return { archived, disposition: { created: task.created, runs: [] } }
    },
    putProfile: async (id, profile) => {
      const task = get(id)
      const words = (task.overrides ?? []).filter((w) => w !== "+small" && w !== "-small")
      task.overrides = [...words, profile === "small" ? "+small" : "-small"]
      const intake = task.intake
        ? {
            ...task.intake,
            pick: profile,
            chosen: true,
            reason:
              profile === "small"
                ? task.intake.reason
                : "You chose the full workflow. The change fits a small one.",
          }
        : null
      task.intake = intake
      onChange()
      return { intake }
    },
    viewing: async () => {},
    // The demo has no files of the person's on disk to open; More's Show task folder answers as if
    // the folder were shown, so the menu reads as it does in the App.
    openFile: async (_id, _file, how) => {
      if (how !== "folder") throw new Error("The demo has no files on your computer.")
    },
    openIn: async () => {
      throw new Error("The demo has no files on your computer.")
    },
    deleteTask: async (id) => {
      const task = get(id)
      if (!task.archived) throw new Error("Archive the task before deleting it.")
      tasks = tasks.filter((t) => t.id !== id)
      onChange()
      return { plan: null, disposition: { created: task.created, runs: [] } }
    },
    find: async (query) =>
      tasks
        .filter((t) => `${t.title} ${t.projectName}`.toLowerCase().includes(query.toLowerCase()))
        .map((t) => ({
          id: t.id,
          task: t.id,
          title: t.title,
          projectName: t.projectName,
          status: t.stage,
          readonly: t.archived,
        })),
    config: async () => clone(config),
    putConfig: async (patch) => {
      config = merge(config, patch)
      // A pick of either place marks the place chosen, as the CLI's writeConfig does; approvals
      // are unset while they follow the questions (null clears them), so merge cannot type them.
      if (
        typeof patch === "object" &&
        patch !== null &&
        ("answers" in patch || "approvals" in patch)
      ) {
        const approvals = (patch as { approvals?: unknown }).approvals
        config = {
          ...config,
          answerPlaceChosen: true,
          ...(approvals === "app" || approvals === "terminal" ? { approvals } : {}),
          ...(approvals === null ? { approvals: undefined } : {}),
        }
      }
      keepSettings(config)
      onChange()
      return clone(config)
    },
    rememberBrowser: async () => {},
    instructions: async () => clone(instructions),
    putInstructions: async (text, base) => {
      if (base !== instructions.updated) return { conflict: clone(instructions) }
      instructions = { text, updated: text === "" ? 0 : Date.now() }
      return { saved: clone(instructions) }
    },
    licence: async () => ({
      state: "active",
      tier: "solo",
      email: ME.email,
      name: ME.name,
      version: DEMO_VERSION,
      // Masked as the server masks a key; the plan renews on a made-up date three weeks out.
      key: "QL-SOLO-••••-••••-••••-4F2A",
      renews: { every: "month", at: Date.now() + 20 * 86_400_000 },
    }),
    subagents: async () => clone(subagents),
    agentHealth: async () => demoAgentHealth(),
    agentSetup: async () => demoAgentSetup(),
    checkAgents: async () => demoAgentHealth(),
    tools: async () => demoTools.read(),
    checkTools: async () => demoTools.check(),
    usage: async (period) => {
      const search = typeof location === "undefined" ? "" : location.search
      if (demoUsageFails(search)) throw new Error("The usage could not be read")
      return demoUsage(period, demoUsageScenario(search))
    },
    agentSessions: async () => demoSessions.view(await runs.list()),
    stopIdle: async () => {
      const outcomes = demoSessions.stopIdle()
      onChange()
      return outcomes
    },
    // The illustrative home: a made-up size, and showing it opens nothing.
    diskUse: async () => ({
      ok: true as const,
      bytes: 412 * 1024 * 1024,
      partial: false,
      path: "~/.qualitylayer",
    }),
    revealHome: async () => undefined,
    serverPort: async () => demoServer.view(config.cockpit.port),
    restartServer: () => demoServer.restart(config.cockpit.port),
    ...createDemoIntegration(onChange),
    ...demoUpdates(typeof location === "undefined" ? "" : location.search, onChange),
  }
  // The sidebar's project looks live in memory; a task renamed there is renamed in the demo's tasks.
  const look = createMemoryLookApi({
    seed: DEMO_LOOKS,
    renameTask: (id, title) => {
      get(id).title = title
    },
    reveal: () => {},
    onChange,
  })
  const chatTasks = {
    scope: "native-session",
    revision: "1",
    coverage: "snapshot" as const,
    items: [
      { id: "1", text: "Reproduce archived account omission", status: "completed" as const },
      {
        id: "2",
        text: "Include accounts archived during the reporting period",
        status: "in_progress" as const,
      },
      {
        id: "3",
        text: "Verify exports across long reporting periods and account names",
        status: "pending" as const,
      },
    ],
  }
  let chatQuestion = chatFixture === "question" || chatFixture === "expired"
  const questionState = collaborationFixture.get("question-state")
  const questionAvailability =
    chatFixture === "expired"
      ? "expired"
      : questionState === "catching-up" ||
          questionState === "read-only" ||
          questionState === "unsupported"
        ? questionState
        : "ready"
  const workflowRuns: typeof runs = {
    ...runs,
    handoffWorkflow: async (run, type, proof) => {
      const current = (await runs.list()).find((item) => item.id === run.id)
      if (
        !current ||
        current.generation !== run.generation ||
        current.nativeSession !== run.nativeSession ||
        !current.viewer?.controller ||
        !current.viewer.canType ||
        current.viewer.pickerProof !== proof
      )
        throw new Error("Take control of this illustrative agent window before starting the Plan.")
      const task =
        current.task ?? (current.purpose.kind === "task" ? current.purpose.task : undefined)
      if (!task) throw new Error("This illustrative window has no task.")
      await api.promoteChat(task, type)
      return { handoff: "sent" }
    },
  }
  const chatRuns: typeof runs = {
    ...workflowRuns,
    turnChanges: async (run) => {
      const original = await runs.turnChanges?.(run)
      const turn = original?.[0]
      return turn ? chatTurnChanges(turn.at, turn.since) : original
    },
    list: async () =>
      (await runs.list()).map((run) =>
        run.viewer
          ? {
              ...run,
              ...(chatFixture === "failed"
                ? {
                    status: "failed" as const,
                    error: "The agent could not start. Your work is kept.",
                  }
                : {}),
              viewer: { ...run.viewer, pickerProof: "a".repeat(64) },
            }
          : run,
      ),
    attach: (run, options) =>
      runs.attach(run, {
        ...options,
        onViewer: (state) =>
          options.onViewer?.({
            ...state,
            ...(state.controller && state.canType ? { pickerProof: "a".repeat(64) } : {}),
          }),
      }),
    conversation: async (run, after) => {
      const snapshot = await runs.conversation?.(run, after)
      if (!snapshot) return snapshot
      return {
        ...snapshot,
        checklist: chatTasks,
        question: chatQuestion
          ? {
              id: "native-question",
              agent: run.agent === "codex" ? "codex" : "claude-code",
              answerable: questionAvailability === "ready",
              availability: questionAvailability,
              questions: [
                {
                  id: "archived-scope",
                  header: "Archived accounts",
                  question:
                    "Which accounts should the export include when the reporting period spans an archive date?",
                  multiSelect: false,
                  options: [
                    {
                      label:
                        collaborationFixture.get("chat-long") === "1"
                          ? "Include all usage recorded before each account was archived during the selected reporting period (Recommended)"
                          : "Archived during the period",
                      description: "Include usage recorded before the account was archived.",
                    },
                    {
                      label: "Every archived account",
                      description: "Include accounts archived before or during this period.",
                    },
                  ],
                },
                {
                  id: "columns",
                  header: "Columns",
                  question: "Which columns should the export add?",
                  multiSelect: true,
                  options: [{ label: "Archived on" }, { label: "Account status" }],
                },
              ],
            }
          : null,
        events: chatConversation(snapshot.events),
        workers: [],
      }
    },
    answerPicker: async (_run, answer) => {
      if (collaborationFixture.get("answer") === "error")
        throw new Error("The agent did not accept this answer. Your choices are kept.")
      if (collaborationFixture.get("answer") === "expired") return { status: "expired" }
      if (!("questionId" in answer) || answer.questionId === "columns") {
        chatQuestion = false
        onChange()
      }
      return { status: "confirmed" }
    },
  }
  return {
    api,
    look,
    runs: chatFixture ? chatRuns : workflowRuns,
    /** In the story, feedback on Finance's billing-mode page is taken by the agent, which changes the page. */
    artifactAgentChange: (file: string) =>
      storyDemo && file.endsWith("billing-mode.html")
        ? {
            answer:
              "Changed the page: the last switch now shows under the button, with who made it, when and why.",
            apply: () => {
              artifactsDemo.showLastSwitch()
              onChange()
            },
          }
        : undefined,
    reset: () => {
      look.reset()
      const added = folderProjects.findIndex((item) => item.id === "empty-demo")
      if (added !== -1) folderProjects.splice(added, 1)
      artifactsDemo.reset()
      runs.reset()
      demoSessions.reset()
      branch.reset()
      tasks = demoTasks()
      applyReviewLimits()
      onChange()
    },
  }
}
