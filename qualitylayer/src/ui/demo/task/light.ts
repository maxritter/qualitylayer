// The demo's small change, at the App Model's `impl-start-light`, `verify-light` and `plan-small`
// ("Show invoice dates in the customer's time zone", one build step, no trust boundary, one
// existing screen's wording at most). It runs on the demo task with only what makes it small changed:
// the Plan's quiet row says how the task runs, the start card's flow line says what the build
// skips, and Verify draws the Security review and the Second opinion as not run, the project checks
// as done, and the one independent review (it adds the missing tests) checking 3 points in two rounds.

import type { Checklist, CheckRow } from "../../../core/checklist.ts"
import { type LaneRow, laneResult } from "../../../core/pages/lanes.ts"
import type { Flow } from "../../../core/scaling.ts"
import type { TaskDetail } from "../../api.ts"
import type { Area } from "./area.ts"
import { isLight, type Moment } from "./moments.ts"

/** The agent's one line when the build starts; the last clause is what a light task adds. */
const FLOW_LINE =
  "One build step in this session, no second opinion on the change (small), small change: no Plan review, and the independent reviewer also adds the missing tests, in two rounds."

const TITLE = "Show invoice dates in the customer's time zone"

/** The flow of a small task: no Security review, no second opinion, one fresh reviewer. */
const LIGHT_FLOW: Flow = {
  researchHelpers: false,
  security: false,
  planReview: "none",
  light: true,
  combinedReview: true,
  changeSecondOpinion: false,
  splitProposal: false,
}

/** The security scans of the small change: nothing found, two scanners had nothing to read. */
const LIGHT_SCANS = [
  "- scans · a41c9e2 · Betterleaks 8.30.0 · secrets · 4 files · none found",
  "- scans · a41c9e2 · OpenGrep 1.12.0 · code · 3 files · none found",
  "- scans · a41c9e2 · OSV-Scanner 2.3.0 · dependencies · not needed · no changed lockfile",
  "- scans · a41c9e2 · zizmor 1.5.2 · workflows · not needed · no changed GitHub workflow",
]

/** The six lanes of a small change while the judge reads: the lanes that do not apply are not run. */
export function lightLanes(scansOff = false): LaneRow[] {
  return [
    {
      id: "checks",
      who: "QualityLayer itself · no agent",
      state: "done",
      result: laneResult("done", ["372 files pass", "2 reused"]),
    },
    scansOff
      ? {
          id: "scans",
          who: "QualityLayer itself · no agent",
          state: "skipped",
          result: laneResult("not run", ["off in Settings"]),
          why: "Off in Settings › Security scans.",
        }
      : {
          id: "scans",
          who: "QualityLayer itself · no agent",
          state: "done",
          result: laneResult("done", ["no findings", "2 not needed"]),
        },
    {
      id: "security",
      who: "a fresh agent · read-only",
      state: "skipped",
      result: laneResult("skipped", []),
      why: "Does not run because the Plan's Trust boundary line says none, and no agent instructions, hooks, package scripts or CI workflows changed.",
    },
    {
      id: "judge",
      who: "Claude Code · Opus 5.5 · never saw the build",
      state: "running",
      result: laneResult("running", ["point 2 of 3", "1 test added"]),
    },
    {
      id: "second",
      who: "Codex · GPT-6.1 Sol · another vendor",
      state: "skipped",
      result: laneResult("skipped", []),
      why: "Does not run because the change is small: one screen's wording and no trust boundary.",
    },
    { id: "fix", who: "the build session", state: "waiting", result: "" },
  ]
}

/** Done means, checked, for a small change: one point passed, the judge on the second, the third waiting. */
export const LIGHT_PROOF = `| Done means | Proof | |
|---|---|---|
| 1. The invoice shows its date in the customer's time zone | an account in Tokyo: the invoice read "1 Nov 2026" where UTC still said 31 Oct | passed |
| 2. An account without a time zone shows UTC and says so | the agent renders an invoice for an account with no time zone | checking |
| 3. The PDF and the email show the same date | | waiting |`

export const LIGHT_SECOND = "**Second opinion** · not run: the change is small."

export const LIGHT_SECURITY = "Not run: the Plan's Trust boundary line says none."

/** The fix rounds of a small change, for agents/03-verify.md. */
export const LIGHT_FIX_ROUNDS = "- No fixes yet."

/** The recorded project checks of a small change, for agents/03-verify.md: no security review. */
export const lightChecks = (
  scansOff: boolean,
): string => `- all · a41c9e2 · \`bun run test\` · exit 0 · 188.0s
- all · a41c9e2 · \`bun run typecheck\` · exit 0 · 21.1s · reused
- all · a41c9e2 · \`bun run lint\` · exit 0 · 8.6s · reused${scansOff ? "" : `\n${LIGHT_SCANS.join("\n")}`}`

/** The three points of Done means: one passed, the judge on the second, the third waiting. */
const LIGHT_POINTS: CheckRow[] = [
  {
    id: "done:1",
    label: "The invoice shows its date in the customer's time zone",
    state: "passed",
    text: 'an account in Tokyo: the invoice read "1 Nov 2026" where UTC still said 31 Oct',
  },
  {
    id: "done:2",
    label: "An account without a time zone shows UTC and says so",
    state: "running",
    who: "Checking",
    text: "the agent renders an invoice for an account with no time zone",
  },
  { id: "done:3", label: "The PDF and the email show the same date", state: "waiting" },
]

/** Verify's checklist of a small change: only its three points; no Security review. */
function lightChecklist(base: Checklist | null | undefined): Checklist | null | undefined {
  if (base === undefined || base === null) return base
  return {
    ...base,
    groups: [{ id: "done", title: "Done means", rows: LIGHT_POINTS }],
    total: LIGHT_POINTS.length,
    passed: 1,
    failed: 0,
    user: [],
    minutes: { checks: 3, checking: 2 },
    agents: 1,
    // A small change's rounds: two judge runs, the first under way.
    budget: { rounds: { used: 1, limit: null }, since: Date.now() - 9 * 60_000 },
  }
}

export const light: Area = {
  patch: (task: TaskDetail, moment: Moment): TaskDetail => {
    // The Plan of a small change: the quiet row under the gist, the system's pick and its one choice.
    if (moment === "plan-small")
      return {
        ...task,
        intake: {
          pick: "small",
          chosen: false,
          offered: true,
          reason: "3 files in one area · nothing untraced · no schema, backend or security surface",
        },
      }
    if (!isLight(moment)) return task
    return {
      ...task,
      title: TITLE,
      flow: LIGHT_FLOW,
      ...(task.stage === "verify" ? { checklist: lightChecklist(task.checklist) } : {}),
      // The Security review does not run: the quality pass is empty.
      quality: [],
      implementStart:
        task.implementStart === null
          ? null
          : {
              ...task.implementStart,
              slices: 1,
              tasks: 4,
              flowLine: FLOW_LINE,
            },
    }
  },
}
