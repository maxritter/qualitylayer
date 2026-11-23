// The flagship of the public Cockpit demo: usage-based billing across nine
// services. Every service, path, number and person is illustrative.

import agents from "../../core/agents/agents.json" with { type: "json" }
import { type DocRole, NAMES, STEPS, type Step, taskFiles } from "../../core/docs/names.ts"
import { FLOW_STEPS } from "../../core/flow.ts"
import { implementPrompt } from "../../core/handoff/prompt.ts"
import type { ImplementOption, TaskDetail } from "../api.ts"
import {
  FLAGSHIP_ARTIFACTS,
  OCTOBER_AVERAGE,
  OCTOBER_REQUESTS,
  planLimits,
} from "./flagship-mockups.ts"
import {
  type FlagshipStage,
  flagshipReview,
  flagshipTimeline,
  phaseOf,
  SLICES,
} from "./flagship-slices.ts"
import { DEMO_TASK_ID } from "./identity.ts"
import { ME } from "./person.ts"
import { SECURITY_FINDINGS, SECURITY_RESULT } from "./story.ts"
import type { Moment } from "./task/moments.ts"
import { verifyModeField } from "./verify-mode.ts"

export { FLAGSHIP_ARTIFACTS, type FlagshipStage, OCTOBER_AVERAGE, OCTOBER_REQUESTS, planLimits }

export const FLAGSHIP_STAGES: readonly FlagshipStage[] = [
  "plan",
  "implement",
  "verify-checking",
  "verify",
]

export const FLAGSHIP_MOMENT: Record<FlagshipStage, Moment> = {
  plan: "plan-approve",
  implement: "now",
  "verify-checking": "verify-checking",
  verify: "verify",
}

const MIN = 60_000
const HOUR = 60 * MIN

const DEMO_QUALITY: TaskDetail["quality"] = [
  {
    step: "security",
    state: "done",
    result: `done · ${SECURITY_RESULT}`,
    findings: SECURITY_FINDINGS,
  },
]

const BUILD_DEVIATIONS =
  "- T2 (tactical): the public API marks health checks with a route tag, not a path prefix; the emitter reads the tag.\n- T6 (amended): the dedupe store keeps request ids for 24 hours in the aggregator's state store instead of Redis, so a replay never depends on a second system.\n- T8 (tactical): the emitter retries a failed send twice before it buffers; the Plan said once.\n- T8 (tactical): buffer 30 minutes on disk, not 10; the agent took the recommended way and went on."

const FLAGSHIP_PR_DESCRIPTION =
  "# Usage-based billing\n\nAPI customers are billed for what they use. A billable request is metered in the gateway, counted once in Kafka and the ledger, and billed in tiers with proration; seat customers are unchanged.\n\n## What changed\n\n- The gateway emits one meter event per billable request, keyed by its request id, and never waits on Kafka.\n- A stream job drops duplicates and closes 5-minute usage windows; the ledger writes each window once.\n- Invoices carry tiered usage lines with proration, through the existing outbox.\n- The Plan and limits page lets an owner pick a tier, set each limit and an alert threshold; finance switches billing mode in the admin.\n- A backfill rebuilt 90 days from the warehouse; the parity report is within 0.1%.\n\n## Validation\n\n- 8 end-to-end scenarios, including a retry storm, a Kafka outage and the 90-day backfill.\n- The acceptance test: a replayed day's ledger usage equals the gateway's billable count.\n- 12 golden seat invoices unchanged; gateway overhead +1.1 ms at p99.\n\nAll services, paths, checks and numbers in this demo are illustrative."

const FLOW_LINE =
  "Flow: 7 slices built in this session, test first · security review (money paths) · the independent reviewer also adds the missing tests."

const STAGE_STEP: Record<FlagshipStage, Step> = {
  plan: "plan",
  implement: "implement",
  "verify-checking": "verify",
  verify: "verify",
}

const SESSION_MINUTES: Record<FlagshipStage, number> = {
  implement: 72,
  "verify-checking": 9,
  verify: 240,
  plan: 6,
}

const STAGE_ITERATIONS: Record<FlagshipStage, number> = {
  plan: 0,
  implement: 0,
  "verify-checking": 1,
  verify: 2,
}

const VERIFY_EVIDENCE = [
  "it2-usage-1280.png",
  "it2-billing-mode.png",
  "it2-scenario-2.txt",
  "it2-scenario-3.txt",
  "it2-scenario-4.txt",
  "it2-scenario-5.txt",
  "it2-scenario-6.txt",
  "it2-scenario-7.txt",
  "it2-scenario-8.txt",
  "it2-trace.txt",
  "it2-acceptance.txt",
]

const VERIFICATION_ROUNDS: TaskDetail["verification"] = [
  {
    n: 1,
    result: "fail",
    judge: "Codex",
    verdicts: [
      { verdict: "PASS", kind: "check", subject: "", text: "`npm test` exit 0 · 1,412 pass" },
      {
        verdict: "FAIL",
        kind: "dod",
        subject: "T12",
        text: "A plan change on day 10 bills 3 cents more than the contract: the Growth part rounded each day before summing — `invoicing/usage-lines.ts:5`",
      },
      {
        verdict: "MISSING",
        kind: "dod",
        subject: "T19",
        text: "A switch back leaves its own audit entry: no test or observation covers it",
      },
    ],
  },
  {
    n: 2,
    result: "pass",
    judge: "Codex",
    verdicts: [
      { verdict: "PASS", kind: "check", subject: "", text: "`npm run typecheck` exit 0" },
      { verdict: "PASS", kind: "check", subject: "", text: "`npm test` exit 0 · 1,431 pass" },
      { verdict: "PASS", kind: "check", subject: "", text: "`go test ./...` exit 0" },
      {
        verdict: "PASS",
        kind: "check",
        subject: "",
        text: "`go test ./gateway/middleware -bench Meter` p99 +1.1 ms",
      },
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
        verdict: "PASS",
        kind: "scenario",
        subject: String(n),
        text: `every step as expected — \`evidence/it2-scenario-${n}.txt\``,
      })),
      {
        verdict: "PASS",
        kind: "acceptance",
        subject: "A1",
        text: "A replayed day: ledger usage 2,418,903 = gateway billable 2,418,903 — `evidence/it2-acceptance.txt`",
      },
      {
        verdict: "PASS",
        kind: "review",
        subject: "",
        text: "money paths, concurrency, idempotency keys, test quality: nothing found",
      },
    ],
  },
]

function prompts(slug: string, size: { slices: number; tasks: number }): ImplementOption[] {
  return (["claude-code", "codex", "unknown"] as const).map((id) => {
    const start = implementPrompt({ slug }, id, FLOW_LINE, size)
    return {
      agent: id === "unknown" ? "other" : id,
      name: id === "unknown" ? "Other agent" : agents[id].name,
      prompt: start.prompt,
      advice: start.advice,
    }
  })
}

function flagshipGate(stage: FlagshipStage, now: number): TaskDetail["gate"] {
  const target = stage === "plan" ? NAMES.plan : stage === "verify" ? "final" : null
  if (target === null) return null
  return {
    id: `demo-flagship-${stage}`,
    target,
    targets: [target],
    opened: now - (stage === "verify" ? 4 * HOUR : 6 * MIN),
    decision: "pending",
    settled: false,
  }
}

function flagshipVerification(stage: FlagshipStage): TaskDetail["verification"] {
  if (stage === "verify-checking") return VERIFICATION_ROUNDS.slice(0, 1)
  if (stage === "verify") return VERIFICATION_ROUNDS
  return []
}

function flagshipSession(stage: FlagshipStage, now: number): TaskDetail["session"] {
  return {
    agent: "claude-code",
    phase: STAGE_STEP[stage],
    state: stage === "implement" || stage === "verify-checking" ? "busy" : "waiting",
    heartbeat: now,
    since: now - SESSION_MINUTES[stage] * MIN,
    checkout: "/demo/acme/platform",
  }
}

function flagshipDocs(stage: FlagshipStage, written: (step: Step) => boolean): TaskDetail["docs"] {
  return FLOW_STEPS.map((flow) => ({
    name: NAMES[flow.id],
    label: flow.label,
    exists: written(flow.id),
    status: stage === "plan" && flow.id === "plan" ? "review" : "",
    approved: false,
  }))
}

/** The flagship task as the base of the demo task, at the stage the tour shows. */
export function flagshipTask(stage: FlagshipStage, now = Date.now()): TaskDetail {
  const slug = "usage-based-billing"
  const planning = phaseOf(stage) === "planned"
  const timeline = flagshipTimeline(stage)
  const total = SLICES.reduce((n, s) => n + s.tasks.length, 0)
  const checked = timeline.slices.reduce((n, s) => n + s.tasks.filter((t) => t.checked).length, 0)
  const here = STEPS.indexOf(STAGE_STEP[stage])
  const written = (step: Step) => STEPS.indexOf(step) <= here
  const hasFile = (role: DocRole): boolean => written(role)
  const verifyMode = stage === "verify-checking" ? "checking" : stage === "verify" ? "yours" : null

  return {
    id: DEMO_TASK_ID,
    answers: "app",
    title: "Usage-based billing",
    project: "platform",
    projectName: "acme/platform",
    slug,
    type: "feature",
    files: taskFiles("acme/platform", slug, "feature", hasFile),
    overrides: [],
    stage: STAGE_STEP[stage],
    ...verifyModeField(verifyMode),
    iterations: STAGE_ITERATIONS[stage],
    created: now - 26 * HOUR,
    dir: `/home/dev/.qualitylayer/projects/platform/tasks/${slug}`,
    archived: false,
    branch: "feat/usage-billing",
    gate: flagshipGate(stage, now),
    session: flagshipSession(stage, now),
    progress: planning ? null : { checked, total, slices: SLICES.length },
    helpers: [],
    action: stage === "plan" ? "review" : stage === "verify" ? "final" : null,
    waitingSince: null,
    closing: null,
    slices: timeline.slices.map((s) => ({
      n: s.n,
      title: s.title,
      validation: s.validation,
      tasks: s.tasks.map((t) => ({ id: t.id, title: t.title, checked: t.checked })),
      approved: !planning,
    })),
    timeline,
    quality: phaseOf(stage) === "built" ? DEMO_QUALITY : [],
    flow: {
      researchHelpers: true,
      security: true,
      planReview: "second-opinion",
      changeSecondOpinion: true,
      splitProposal: false,
    },
    implementStart: planning
      ? null
      : {
          slices: SLICES.length,
          tasks: total,
          agents: prompts(slug, { slices: SLICES.length, tasks: total }),
          flowLine: FLOW_LINE,
        },
    buildLog: planning ? null : { deviations: BUILD_DEVIATIONS },
    docs: flagshipDocs(stage, written),
    comments: [],
    events: [],
    prDescription: stage === "verify" ? FLAGSHIP_PR_DESCRIPTION : null,
    verification: flagshipVerification(stage),
    showMe: [
      {
        name: "show-me-request-path.html",
        title: "A billable request, from the gateway to the invoice",
      },
    ],
    evidence: stage === "verify" ? VERIFY_EVIDENCE : [],
    review: stage === "verify" ? flagshipReview() : null,
    me: ME,
  }
}
