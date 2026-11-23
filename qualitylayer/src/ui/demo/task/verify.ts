// The demo's content for Verify of the task ("Usage-based billing"): its two files at each of
// Verify's modes, with the six lanes in the order they run (Project checks, Security scans and
// Security review together, then the Independent review with the Second opinion beside it, then Fix
// rounds).

import type { VerificationRun } from "../../../core/review/screen-evidence.ts"
import type { TaskDetail } from "../../api.ts"
import { applyVerifyVariant } from "../verify.ts"
import { setVerifyMode, verifyModeField } from "../verify-mode.ts"
import type { Area } from "./area.ts"
import { agentFilesThrough, TASK_AGENT_FILES, TASK_FILES } from "./documents.ts"
import type { Moment } from "./moments.ts"
import { stepPage } from "./page.ts"
import {
  demoLanes,
  demoVerifyAgents,
  demoVerifyDocument,
  finalStages,
  modeOf,
  reading,
  type VerifyDemoMode,
} from "./verify-docs.ts"

export { demoLanes, demoVerifyAgents, demoVerifyDocument, finalStages, type VerifyDemoMode }

type Mode = VerifyDemoMode

/** Long on purpose: a command with a path never fits one line of a phone's column. */
const REUSED_CHECKS = [
  "npm run typecheck",
  "npm run lint",
  "cd services/billing && npx vitest run src/pricing.test.ts src/outbox.test.ts",
]

const MINUTE = 60_000

function demoCheckReceipt(mode: Mode): NonNullable<TaskDetail["verifyActivity"]> {
  const checked = { head: "a41c9e2", branch: "feat/usage-billing" }
  return {
    projectChecks: {
      at: Date.now() - 25 * MINUTE,
      checked,
      checkout: checked,
      commands: [
        ...REUSED_CHECKS.map((command) => ({ command, exit: 0, outcome: "passed" as const })),
        mode === "red"
          ? { command: "npm run build", exit: 1, outcome: "failed" }
          : { command: "npm run build", exit: 0, outcome: "passed" },
      ],
    },
  }
}

/** The question the fix rounds' exit asks at `verify-asked`: how Verify goes on with point 3 open. */
const exitQuestion = (now: number): NonNullable<TaskDetail["question"]> => ({
  id: "verify-exit-2-1",
  number: 9,
  asked: now - 5 * MINUTE,
  question: "Point 3 needs a decision about what Done means. How should Verify go on?",
  choices: [
    {
      label: "Change what Done means",
      detail: "Say what point 3 promises for a downgrade; the checks run again against it.",
      words: true,
    },
    {
      label: "One more fix round",
      detail: "The agents fix what is open once more, then it is checked again.",
    },
    {
      label: "Keep it red and review it",
      detail: "Point 3 stays failed in the review; you decide there.",
    },
    { label: "Stop the task", detail: "End the task here. Its files stay." },
  ],
  recommended: 1,
  grade: 1,
  why: "1 point is open after 2 fix rounds.",
})

/** The events of Verify at one mode, laid over the moment's task. */
function verifyEvents(task: TaskDetail, mode: Mode): Record<string, unknown>[] {
  const now = Date.now()
  const at = (ago: number) => now - ago * MINUTE
  const failed = (ago: number) => ({ event: "verify_result", passed: false, ts: at(ago) })
  const events: Record<string, unknown>[] = [
    ...task.events,
    {
      event: "stage",
      from: "implement",
      to: "verify",
      ts: at(mode === "yours" || mode === "rechecking" ? 135 : reading(mode) ? 45 : 70),
    },
  ]
  if (mode === "fixing") events.push(failed(40))
  if (mode === "asked")
    events.push(failed(100), failed(60), failed(20), {
      event: "verify_exit",
      reason: "person_needed",
      ts: at(5),
    })
  if (mode === "yours" || mode === "rechecking")
    events.push(
      failed(100),
      { event: "verify_result", passed: true, ts: at(30) },
      { event: "verify_ready", ts: at(29) },
    )
  if (mode === "rechecking") events.push({ event: "verify_reopened", ts: at(8) })
  return events
}

/** The pictures the verdicts cite at a mode, latest run first: the review's run, then the recheck's. */
export function demoVerificationRuns(moment: Moment): VerificationRun[] {
  const mode = modeOf(moment)
  if (mode === null) return []
  return reading(mode) || mode === "fixing" ? [FIRST_RUN] : [SECOND_RUN, FIRST_RUN]
}

const hex = (n: number) => n.toString(16).padStart(24, "0")
const pictureFile = (n: number, cites: string, step?: string) => ({
  file: `evidence/screen-${hex(n)}.png`,
  kind: "picture" as const,
  cites,
  at: 1_700_000_000_000 + n,
  ...(step === undefined ? {} : { step }),
})
const FIRST_RUN: VerificationRun = {
  run: "it1",
  mode: "scripted",
  at: 1_700_000_000_000,
  passed: false,
  files: [
    pictureFile(1, "Done means 1"),
    pictureFile(2, "Done means 2, A3"),
    pictureFile(3, "Done means 4"),
    pictureFile(4, "A5"),
    pictureFile(5, "Done means 6"),
    pictureFile(6, "A7"),
  ],
}
const SECOND_RUN: VerificationRun = {
  run: "it2",
  mode: "real-session",
  at: 1_700_000_900_000,
  passed: true,
  files: [
    pictureFile(11, "Done means 3", "A1"),
    pictureFile(12, "A4", "A2"),
    pictureFile(13, "Done means 8"),
    pictureFile(14, "A9"),
  ],
}

let at: Moment = "verify-checking"

export const verify: Area = {
  documents: {
    get [TASK_FILES.verify]() {
      return demoVerifyDocument(modeOf(at) ?? "checking", at === "verify-light")
    },
    get [TASK_AGENT_FILES.verify]() {
      return demoVerifyAgents(modeOf(at) ?? "checking", at === "verify-light")
    },
  },
  patch: (task: TaskDetail, moment: Moment): TaskDetail => {
    at = moment
    const mode = modeOf(moment)
    if (mode === null) return task
    const light = moment === "verify-light"
    const displayedMode = mode === "red" ? "checking" : mode
    if (reading(mode) || mode === "fixing" || mode === "asked") applyVerifyVariant(task, "live")
    if (mode === "rechecking") applyVerifyVariant(task, "unsettled")
    setVerifyMode(task, displayedMode)
    return {
      ...task,
      pages: task.pages?.map((page) =>
        page.step === "verify" ? stepPage("verify", demoVerifyDocument(mode, light)) : page,
      ),
      verifyLanes: demoLanes(mode, light),
      ...(reading(mode) && !light ? { verifyActivity: demoCheckReceipt(mode) } : {}),
      events: verifyEvents(task, mode),
      ...verifyModeField(displayedMode),
      ...(mode === "asked" ? { question: exitQuestion(Date.now()) } : {}),
      records: [
        "it1-acceptance.txt",
        "it1-acceptance-a1.txt",
        "it2-acceptance.txt",
        "checks-all.txt",
      ],
      agents: agentFilesThrough("verify"),
      reusedChecks: REUSED_CHECKS,
      evidence: ["it1-retries.png", "it2-ledger.png", "it2-invoice.png"],
    }
  },
}
