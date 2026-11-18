// The demo's content for Verify of the task ("Usage-based billing"): its two files at each of
// Verify's modes, with the six lanes in the order they run (Project checks, Security scans and
// Security review together, then the Independent review with the Second opinion beside it, then Fix
// rounds). At `verify-checking` the project checks and scans passed and the independent review reads
// point 6 with the security review done and the second opinion beside it; `verify-red` is the same
// with a red project check, which the review takes as evidence; at `verify-fixing` the first
// judgement failed and the review rechecks after the fix round; at `verify-asked` two fix rounds left
// point 3 open and one question asks how to go on; at `verify` every lane is done and the person
// reviews; at `verify-rechecking` the person's comment reopened the pass and point 3 is rechecked.

import {
  type LaneRow,
  type LaneState,
  laneResult,
  stageRows,
  stagesText,
} from "../../../core/pages/lanes.ts"
import type { VerificationRun } from "../../../core/review/screen-evidence.ts"
import type { TaskDetail } from "../../api.ts"
import { applyVerifyVariant } from "../verify.ts"
import { setVerifyMode, verifyModeField } from "../verify-mode.ts"
import type { Area } from "./area.ts"
import { demoDescription } from "./description.ts"
import { agentFilesThrough, TASK_AGENT_FILES, TASK_FILES } from "./documents.ts"
import {
  LIGHT_FIX_ROUNDS,
  LIGHT_PROOF,
  LIGHT_SECOND,
  LIGHT_SECURITY,
  lightChecks,
  lightLanes,
} from "./light.ts"
import { atReview, type Moment } from "./moments.ts"
import { stepPage } from "./page.ts"
import { FINANCE_CONFIRMATION, failedWords, pointState } from "./story.ts"
import { DONE_MEANS } from "./story-data.ts"
import { DEMO_WHY } from "./walkthrough.ts"

/** Verify's modes as the demo draws them; `red` is checking with a red project check. */
export type VerifyDemoMode = "checking" | "red" | "fixing" | "asked" | "yours" | "rechecking"
type Mode = VerifyDemoMode

const modeOf = (moment: Moment): Mode | null =>
  moment === "verify-checking" || moment === "verify-light"
    ? "checking"
    : moment === "verify-red"
      ? "red"
      : moment === "verify-fixing"
        ? "fixing"
        : moment === "verify-asked"
          ? "asked"
          : moment === "verify-rechecking"
            ? "rechecking"
            : atReview(moment)
              ? "yours"
              : null

/** The agents are still checking: the first judgement, with or without a red check. */
const reading = (mode: Mode): boolean => mode === "checking" || mode === "red"

const SECURITY: LaneRow = {
  id: "security",
  who: "a fresh agent · read-only",
  state: "done",
  result: laneResult("done", ["1 high fixed before the review", "2 medium to the pull request"]),
  why: "Runs because the change adds a Finance-only switch and reads account data.",
}
const CHECKS_PASSED: LaneRow = {
  id: "checks",
  who: "QualityLayer itself · no agent",
  state: "done",
  result: laneResult("done", ["372 files pass", "2 reused"]),
}
const CHECKS_RED: LaneRow = {
  id: "checks",
  who: "QualityLayer itself · no agent",
  state: "fail",
  result: laneResult("fail", ["1 of 4 checks red"]),
}
/** `?scans=off` (or Settings › Security scans Off): the lane says so and no scanner ran. */
const scansOff = (): boolean =>
  typeof location !== "undefined" && new URLSearchParams(location.search).get("scans") === "off"

const SCANS_WHO = "QualityLayer itself · no agent"
const SCANS_PASSED: LaneRow = {
  id: "scans",
  who: SCANS_WHO,
  state: "done",
  result: laneResult("done", ["2 findings", "1 not needed"]),
}
/** A scan that could not read a file is not checked, never clean: the lane is red and the reviewers see it. */
const SCANS_RED: LaneRow = {
  id: "scans",
  who: SCANS_WHO,
  state: "fail",
  result: laneResult("fail", ["2 findings", "1 not checked"]),
}
const SCANS_OFF: LaneRow = {
  id: "scans",
  who: SCANS_WHO,
  state: "skipped",
  result: laneResult("not run", ["off in Settings"]),
  why: "Off in Settings › Security scans.",
}

/** The scanners' lines under `## Commands`, one per scanner, as `qualitylayer check` writes them. */
function scanLines(mode: Mode): string {
  const code =
    mode === "red"
      ? "- scans · a41c9e2 · OpenGrep 1.31.0 · code · 14 files · 2 findings · 1 not checked (services/gateway/src/legacy-export.ts: could not parse)"
      : "- scans · a41c9e2 · OpenGrep 1.31.0 · code · 14 files · 2 findings"
  return [
    "- scans · a41c9e2 · Betterleaks 1.9.0 · secrets · 38 files · none found",
    "- scans · a41c9e2 · OSV-Scanner 2.7.0 · dependencies · 1 file · 1 finding",
    code,
    "- scans · a41c9e2 · zizmor 1.31.1 · workflows · not needed · no changed GitHub workflow",
  ].join("\n")
}

const JUDGE = "Claude Code · Opus 5.5 · never saw the build"
const SECOND = "Codex · GPT-6.1 Sol · another vendor"
const SECOND_WHY =
  "Runs because every request passes through the meter and the backfill rewrites history."
const FIXER = "the build session"

/** The judge's lane at each mode. */
const JUDGE_LANE: Record<Mode, Omit<LaneRow, "id" | "who">> = {
  checking: { state: "running", result: laneResult("running", ["point 6 of 12", "4 tests added"]) },
  red: { state: "running", result: laneResult("running", ["point 6 of 12", "4 tests added"]) },
  fixing: { state: "running", result: laneResult("running", ["point 6 of 12", "6 tests added"]) },
  asked: { state: "fail", result: laneResult("fail", ["11 of 12 points pass", "point 3 open"]) },
  rechecking: {
    state: "running",
    result: laneResult("running", ["point 3, after your comment"]),
  },
  yours: {
    state: "done",
    result: laneResult("done", [
      "12 of 12 points pass",
      "1 illustrative confirmation",
      "6 tests added",
    ]),
  },
}

/** The fix rounds' lane at each mode. */
const FIX_LANE: Record<Mode, Omit<LaneRow, "id" | "who">> = {
  checking: { state: "waiting", result: "" },
  red: { state: "waiting", result: "" },
  fixing: { state: "done", result: laneResult("done", ["1 round"]) },
  asked: { state: "fail", result: laneResult("fail", ["2 rounds", "point 3 open"]) },
  rechecking: { state: "done", result: laneResult("done", ["1 recheck"]) },
  yours: { state: "done", result: laneResult("done", ["1 recheck"]) },
}

/** The six lanes as the document writes them at each mode. */
export function demoLanes(mode: VerifyDemoMode, light = false): LaneRow[] {
  if (light) return lightLanes(scansOff())
  const judge: LaneRow = { id: "judge", who: JUDGE, ...JUDGE_LANE[mode] }
  const second: LaneRow = reading(mode)
    ? {
        id: "second",
        who: SECOND,
        state: "running",
        result: laneResult("running", ["reading the diff"]),
        why: SECOND_WHY,
      }
    : {
        id: "second",
        who: SECOND,
        state: "done",
        result: laneResult("done", ["4 findings", "3 taken", "1 kept"]),
        why: SECOND_WHY,
      }
  const fix: LaneRow = { id: "fix", who: FIXER, ...FIX_LANE[mode] }
  const scans = scansOff() ? SCANS_OFF : mode === "red" ? SCANS_RED : SCANS_PASSED
  return [mode === "red" ? CHECKS_RED : CHECKS_PASSED, scans, SECURITY, judge, second, fix]
}

const FIX_ROUNDS: Record<Mode, string> = {
  checking: "- Round 1 · being checked",
  red: "- Round 1 · being checked",
  fixing: [
    "- Round 1 · the build session fixed 3 points",
    "- Recheck · point 6 being checked",
  ].join("\n"),
  asked: [
    "- Round 1 · the build session fixed 2 of 3 points",
    "- Round 2 · point 3 still open",
  ].join("\n"),
  rechecking: [
    "- Round 1 · the build session fixed 3 points",
    "- Recheck · everything checked passed",
    "- Your comment · point 3 being rechecked",
  ].join("\n"),
  yours: [
    "- Round 1 · the build session fixed 3 points",
    "- Recheck · everything checked passed",
  ].join("\n"),
}

const POINTS = DONE_MEANS.filter((p) => !p.withdrawn)

/** The moment a mode stands for, so the points read their state at it. */
const MOMENT_OF: Record<Mode, Moment> = {
  checking: "verify-checking",
  red: "verify-red",
  fixing: "verify-fixing",
  asked: "verify-asked",
  rechecking: "verify-rechecking",
  yours: "verify",
}

/** The words in the Proof column of one point, and its status word. */
function proofCells(n: number, moment: Moment): [proof: string, status: string] {
  const state = pointState(n, moment)
  if (state === "failed") return [failedWords(n), "failed"]
  if (state === "user") return ["needs a Finance login on the live admin", "asked of you"]
  if (state === "running")
    return moment === "verify-rechecking"
      ? ["its fix is rechecked after your comment", "rechecking"]
      : ["the Independent review is reading it", "checking"]
  if (state === "waiting") return ["", "waiting"]
  if (n === 7) return [FINANCE_CONFIRMATION, "confirmed by you"]
  return [`acceptance A${n}`, "passed"]
}

/** Done means, checked: all twelve points, each with what proved it. */
function proofTable(moment: Moment): string {
  return [
    "| Done means | Proof | |",
    "|---|---|---|",
    ...POINTS.map((p) => {
      const [proof, status] = proofCells(p.n, moment)
      return `| ${p.n}. ${p.text} | ${proof} | ${status} |`
    }),
  ].join("\n")
}

/** The people's *Done means* while the agents check: one line per point, as far as it ran. */
function pointLines(moment: Moment): string {
  return POINTS.map((p) => {
    const [, status] = proofCells(p.n, moment)
    return `${p.n}. **${p.text}** ${status}.`
  }).join("\n")
}

/** The judge's blocks under Verification, one per judgement. */
function verificationBlocks(mode: Mode): string {
  const block = (n: number, result: string) => `### Iteration ${n}\n\n**Result:** ${result}\n`
  if (reading(mode)) return block(1, "running · point 6 of 12")
  if (mode === "fixing")
    return [
      block(1, "fail · 3 points failed · Passed: 9"),
      block(2, "running · point 6 of 12"),
    ].join("\n")
  if (mode === "asked")
    return [
      block(1, "fail · 3 points failed · Passed: 9"),
      block(2, "fail · point 3 · Passed: 11"),
      block(3, "fail · point 3 · Passed: 11"),
    ].join("\n")
  return [block(1, "fail · 3 points failed · Passed: 9"), block(2, "pass · Passed: 12")].join("\n")
}

/** The recheck's own stage, which no lane owns. */
const RECHECK: Record<Mode, { state: LaneState; result: string }> = {
  checking: { state: "waiting", result: "" },
  red: { state: "waiting", result: "" },
  fixing: { state: "running", result: "point 6" },
  asked: { state: "fail", result: "point 3 still open" },
  rechecking: { state: "running", result: "point 3" },
  yours: { state: "done", result: "everything checked passed" },
}

const stages = (mode: Mode, light: boolean): string =>
  stagesText(
    stageRows(demoLanes(mode, light), light ? { state: "waiting", result: "" } : RECHECK[mode]),
  )

/** The Checks as they ended, for the pull request's body. */
export const finalStages = (): string => stages("yours", false)

/**
 * 03-verify.md at one mode: the pull request description once the change is the person's, and
 * before that what the agents have written so far (Why, Done means as far as it ran, the Checks).
 */
export function demoVerifyDocument(mode: Mode, light = false): string {
  if (!light && (mode === "yours" || mode === "rechecking"))
    return demoDescription(stages(mode, light))
  return `# Usage-based billing

## Why

${DEMO_WHY}

## Code

<!-- ql:code -->
Being checked · the agents judge every point before the change is yours
<!-- /ql:code -->

## Done means

<!-- ql:acceptance -->
${light ? LIGHT_PROOF : pointLines(MOMENT_OF[mode])}
<!-- /ql:acceptance -->

## Checks

<!-- ql:stages -->
${stages(mode, light)}
<!-- /ql:stages -->

## Ship

<!-- ql:ship -->
Not shipped yet. Branch \`feat/usage-billing\`.
<!-- /ql:ship -->
`
}

/** What the fix round works from, at one mode. */
const FIX_ROUND: Record<Mode, string> = {
  checking: "Not judged yet.",
  red: "Not judged yet.",
  fixing: "Nothing open yet: the recheck is reading the points the fix reached.",
  asked:
    "- **Point 3.** The two proration tests still fail; a mid-cycle downgrade is prorated half a cent off.",
  rechecking:
    "- **Point 3.** Your comment: a mid-cycle downgrade looks half a cent off. The fix is being rechecked.",
  yours: "Nothing to fix: every point passes.",
}

const SHIP_STEPS = `## Ship steps

Branch \`feat/usage-billing\` into \`main\`. The push, the merge and the deploy stay with the release session.
`

/** agents/03-verify.md at one mode, in the contract's order: the fix round, the proof, the findings, the commands, the security review, the second opinion, the rounds, the judge's iterations and the ship steps. */
export function demoVerifyAgents(mode: Mode, light = false): string {
  const checks = light
    ? lightChecks(scansOff())
    : `- all · a41c9e2 · \`npm test\` · exit 0 · 612.4s
- all · a41c9e2 · \`npm run typecheck\` · exit 0 · 18.0s · reused
- all · a41c9e2 · \`cd services/billing && npx vitest run src/pricing.test.ts src/outbox.test.ts\` · exit 0 · 8.6s · reused${scansOff() ? "" : `\n${scanLines(mode)}`}`
  const security = light
    ? LIGHT_SECURITY
    : `### Security

**Result:** fixes needed · 1 high, 2 medium
- [x] S1 high · apps/admin/src/accounts/billing-mode.ts:88 · a non-Finance role could switch the billing mode · fix: require Finance
- S2 medium · services/billing/src/export.ts:40 · the usage export link carries the account id · listed
- S3 medium · jobs/backfill/src/read-logs.ts:61 · the replay job reads the logs with a broad bucket role · listed

### Security re-check

**Result:** done · S1 is fixed`
  const second = light
    ? LIGHT_SECOND
    : "**Second opinion · Codex, GPT-6.1 Sol** · 4 findings: 3 fixed and checked, 1 kept.\n- A retry after the window closed was counted twice · Taken: the ledger key includes the request id\n- A passing test mirrors the pricing table it covers · Taken: it now asserts the published tiers\n- Proration rounds half a cent down · Taken: it keeps the exact amount until the invoice line\n- The gateway reads the plan on every request · Kept: the plan is cached for 60 seconds"
  const iterations = light
    ? "### Iteration 1\n\n**Result:** running · point 2 of 3\n"
    : verificationBlocks(mode)
  const ship = mode === "yours" || mode === "rechecking" ? `\n${SHIP_STEPS}` : ""
  return `# For agents: what was checked and what ships

## For the fix round

<!-- ql:fix-round -->
${light ? FIX_ROUND.checking : FIX_ROUND[mode]}
<!-- /ql:fix-round -->

## Done means, checked

<!-- ql:proof -->
${light ? LIGHT_PROOF : proofTable(MOMENT_OF[mode])}
<!-- /ql:proof -->

## Findings

<!-- ql:findings -->
None.
<!-- /ql:findings -->

## Commands

<!-- ql:checks -->
${checks}
<!-- /ql:checks -->

## Security

${security}

## Second opinion

<!-- ql:reviews -->
${second}
<!-- /ql:reviews -->

## Fix rounds

<!-- ql:fix-rounds -->
${light ? LIGHT_FIX_ROUNDS : FIX_ROUNDS[mode]}
<!-- /ql:fix-rounds -->

## Verification

${iterations}${ship}`
}

/** Long on purpose: a command with a path never fits one line of a phone's column. */
const REUSED_CHECKS = [
  "npm run typecheck",
  "npm run lint",
  "cd services/billing && npx vitest run src/pricing.test.ts src/outbox.test.ts",
]

const MINUTE = 60_000

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
    // The checks as the server shows them: the checklist and the quality pass, under way.
    if (reading(mode) || mode === "fixing" || mode === "asked") applyVerifyVariant(task, "live")
    // Your comment reopened the pass: the point is rechecked while the review lists it first.
    if (mode === "rechecking") applyVerifyVariant(task, "unsettled")
    setVerifyMode(task, mode === "red" ? "checking" : mode)
    return {
      ...task,
      // The page's own copy of the document is built before this runs: rebuilt for this moment.
      pages: task.pages?.map((page) =>
        page.step === "verify" ? stepPage("verify", demoVerifyDocument(mode, light)) : page,
      ),
      // The lanes the board draws, as the last refresh recorded them.
      verifyLanes: demoLanes(mode, light),
      events: verifyEvents(task, mode),
      ...verifyModeField(mode === "red" ? "checking" : mode),
      ...(mode === "asked" ? { question: exitQuestion(Date.now()) } : {}),
      // The raw output and the pictures the checks saved: the Files tab's Records row counts them.
      records: [
        "it1-acceptance.txt",
        "it1-acceptance-a1.txt",
        "it2-acceptance.txt",
        "checks-all.txt",
      ],
      // The agents' own files, one per step so far: the same row counts them, never lists them.
      agents: agentFilesThrough("verify"),
      // The commands the project checks skipped because nothing changed since they passed: the
      // Project checks lane lists them, the page has no block of its own for them.
      reusedChecks: REUSED_CHECKS,
      evidence: ["it1-retries.png", "it2-ledger.png", "it2-invoice.png"],
    }
  },
}
