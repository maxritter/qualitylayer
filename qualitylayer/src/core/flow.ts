// The steps every surface names the same way: the CLI's replies, the App, the phase texts, the docs
// and the website (which imports this file). Free of imports, so the browser bundles read it as it is.

export type FlowStepId = "plan" | "implement" | "verify"

export type FlowStep = {
  id: FlowStepId
  label: string
  /** One plain line on what happens in the step. */
  caption: string
  /** What the user does in it; null when the agents work on their own. */
  you: string | null
}

/** The three steps, in order, with the App Model's onboarding line for each. */
export const FLOW_STEPS: readonly FlowStep[] = [
  {
    id: "plan",
    label: "Plan",
    caption:
      "The agent reads the code and asks; you approve what will be built, once, before any code.",
    you: "Approve the Plan",
  },
  {
    id: "implement",
    label: "Implement",
    caption: "Agents cut it into slices and build it test first.",
    you: null,
  },
  {
    id: "verify",
    label: "Verify",
    caption: "Checks and a fresh reviewer prove every point; then you look, approve and ship.",
    you: "Approve the change",
  },
]

/** The two steps where the person approves: the Plan before any code, the change before it ships. */
export const APPROVAL_STEPS: readonly FlowStepId[] = ["plan", "verify"]

/**
 * Whether the agents work on their own: Implement, and Verify while its mode is not `yours`. A
 * question asked meanwhile holds nothing (plan §3.6 point 10): the agents go on. While they work,
 * the person's follow-ups wait for their review and the agent's own question tool is held.
 */
export function isAutonomousBuildStage(stage: string, verifyMode?: string): boolean {
  if (stage === "implement") return true
  return stage === "verify" && verifyMode !== "yours"
}

/** The step a stage belongs to: a shipped build shows on Verify. */
export function flowStepOf(stage: string): FlowStepId | null {
  if (stage === "shipped") return "verify"
  return FLOW_STEPS.some((step) => step.id === stage) ? (stage as FlowStepId) : null
}

export type VerifyLaneId = "security" | "checks" | "scans" | "judge" | "second" | "fix"

export type VerifyLane = {
  id: VerifyLaneId
  name: string
  /** One line under the lane's name. */
  short: string
  /** What it does, in full, on demand. */
  description: string
}

/** Verify's six lanes in the order they run, named the same in the CLI, the App and the docs. */
export const VERIFY_LANES: readonly VerifyLane[] = [
  {
    id: "checks",
    name: "Project checks",
    short: "Tests, lint, types and build, once · a red check never holds the review back",
    description:
      "Tests, lint, types and build, once, on the committed build. A result stays current until this task's own commits change what it covers. A red check is evidence the Independent review rules on.",
  },
  {
    id: "scans",
    name: "Security scans",
    short: "Secrets, dependencies, GitHub workflows and code, on what this task changed",
    description:
      "Beside the project checks, on this computer, on what this task changed: Betterleaks for secrets, OSV-Scanner for known-vulnerable and malicious packages when a lockfile changed, zizmor for unsafe GitHub workflows, OpenGrep with QualityLayer's rules for request input reaching a dangerous call. A scan with nothing to read is not needed; one that could not read a file is not checked, never clean. Findings are records: the Security review starts from them and the Independent review rules on them.",
  },
  {
    id: "security",
    name: "Security review",
    short: "When the change crosses a trust boundary · reads, never edits",
    description:
      "Beside the project checks, when the Plan names a trust boundary or the change edits agent instructions, hooks, package scripts or CI workflows. It starts from the security scans' findings and keeps what it is at least 8 in 10 sure of: the build session fixes critical and high findings before the Independent review starts; medium and low go into the pull request. It reads, never edits.",
  },
  {
    id: "judge",
    name: "Independent review",
    short: "One fresh agent adds the missing tests and proves each Done means point",
    description:
      "One fresh agent that never wrote the code. It adds the missing tests (tests and docs only), compares the changed screens with their artifacts, runs the scenarios and the acceptance test on the running program, rules on every Done means point and reads the whole diff. Pass or fail, never a score.",
  },
  {
    id: "second",
    name: "Second opinion",
    short: "Another model family looks for what would break · beside the review · changes nothing",
    description:
      "Runs beside the Independent review when the change is risky and Settings › Second opinion is Automatic, or when the task asks. QualityLayer picks a model from another family on this computer. It reads the diff for what would break: bugs, regressions, claims the code does not support, and tests that would pass without the change. It changes nothing. The build session answers each finding, Taken or Kept.",
  },
  {
    id: "fix",
    name: "Fix rounds",
    short: "The build session fixes the gaps · one more fresh reviewer rechecks",
    description:
      "The build session fixes the gaps and commits. One more fresh reviewer rechecks what failed and the lines the fix changed. Keep fixing while evidence supports progress; a real blocker that only you can settle comes to you as one question.",
  },
]
