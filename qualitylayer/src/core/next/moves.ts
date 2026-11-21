// The moves open in each state of a task: one table that `next`, `status` and every refusal read, so
// the three can never disagree (plan §3.7). Free of imports beyond types.

import type { VerifyMode } from "../task/stages.ts"

export type Move = {
  /** The command, as the agent types it. */
  command: string
  /** One line on what it does. */
  does: string
  /** Who takes it: the agent alone, or the person (the agent waits with `wait`). */
  by: "agent" | "person"
}

/**
 * Where the Plan's gate stands: none yet, open, its reviewers at work, their review in and waiting
 * for the agent's answers, answered by the person with changes, or approved.
 */
export type PlanGate =
  | "none"
  | "open"
  | "reviewing"
  | "reviewed"
  | "changes"
  | "approved"
  | "earlier-approval"

export type MoveState =
  | { stage: "none" }
  | { stage: "chat" }
  | { stage: "plan"; gate: PlanGate }
  | {
      stage: "implement"
      started: boolean
      unticked: number
      unproven: number
      /** Another session took the build (or this one was resumed under a new id). */
      ledElsewhere?: boolean
    }
  | { stage: "verify"; mode: VerifyMode }
  | { stage: "shipped" }
  | { stage: "abandoned" }

const START: Move = {
  command: 'qualitylayer task start "<request>"',
  does: "start a task at Plan",
  by: "agent",
}
const brief = (step: string): Move => ({
  command: `qualitylayer brief ${step}`,
  does: "the step's text, once per session",
  by: "agent",
})
const wait = (what: string, does: string): Move => ({
  command: `qualitylayer wait --for ${what}`,
  does,
  by: "person",
})
const abandon: Move = {
  command: "qualitylayer task abandon",
  does: "stop the task; its files stay",
  by: "agent",
}

/** The moves legal now. Every state holds a move the agent can take alone, or a wait on the person. */
export function movesOf(state: MoveState): Move[] {
  switch (state.stage) {
    case "none":
      return [START]
    case "chat":
      return [
        { ...START, does: "start a task at Plan from this Chat" },
        {
          command: "qualitylayer chat plan save --text <markdown>",
          does: "save the Chat's plan",
          by: "agent",
        },
      ]
    case "plan":
      return planMoves(state.gate)
    case "implement":
      return implementMoves(state)
    case "verify":
      return verifyMoves(state.mode)
    case "shipped":
      return [{ command: "qualitylayer ship", does: "finish the approved handoff", by: "agent" }]
    case "abandoned":
      return [{ ...START, does: "start a new task" }]
  }
}

function planMoves(gate: PlanGate): Move[] {
  switch (gate) {
    case "reviewing":
      return [wait("review", "until the Plan's reviewers finish"), brief("plan")]
    case "reviewed":
      return [
        {
          command: "qualitylayer gate open plan",
          does: "unlock Approve once each finding in reviews/plan.md is answered",
          by: "agent",
        },
        {
          command: "qualitylayer plan draft",
          does: "validate the Plan; start the enabled review or reuse its existing run",
          by: "agent",
        },
      ]
    case "open":
      return [
        wait(
          "approval",
          "your move while the person reads: returns when they approve or comment, in the App or here; again while it says pending",
        ),
        {
          command: "qualitylayer plan draft",
          does: "validate the Plan; start the enabled review or reuse its existing run",
          by: "agent",
        },
        {
          command: "qualitylayer gate open plan",
          does: "reopen the gate after folding a comment in",
          by: "agent",
        },
      ]
    case "changes":
      return [
        {
          command: "qualitylayer wait --for approval",
          does: "hear the person's comments, then apply them",
          by: "agent",
        },
        {
          command: "qualitylayer gate open plan",
          does: "ask again once they are applied",
          by: "agent",
        },
      ]
    case "approved":
      return [
        {
          command: "qualitylayer build start",
          does: "take the approved Plan's build here",
          by: "agent",
        },
      ]
    case "earlier-approval":
    case "none":
      return [
        brief("plan"),
        {
          command: "qualitylayer plan draft",
          does: "validate the Plan; start the enabled review or reuse its existing run",
          by: "agent",
        },
        {
          command: "qualitylayer gate open plan",
          does: "ask the person to approve the Plan",
          by: "agent",
        },
        {
          command: 'qualitylayer task handback "<reason>" --prompt "<prompt>"',
          does: "hand back a plain prompt",
          by: "agent",
        },
        abandon,
      ]
  }
}

function implementMoves(state: Extract<MoveState, { stage: "implement" }>): Move[] {
  if (!state.started)
    return [
      {
        command: "qualitylayer build start",
        does: "take the build here and get its text",
        by: "agent",
      },
      abandon,
    ]
  const moves: Move[] = [
    ...(state.ledElsewhere === true
      ? [
          {
            command: "qualitylayer build start",
            does: "take the build over in this session (a resumed or new one)",
            by: "agent" as const,
          },
        ]
      : []),
    {
      command: 'qualitylayer progress "<line>" --for T<n>',
      does: "say what is being built",
      by: "agent",
    },
    { command: "qualitylayer check task T<n>", does: "record a card's focused check", by: "agent" },
    { command: "qualitylayer commit slice <n>", does: "commit a finished slice", by: "agent" },
  ]
  if (state.unproven > 0)
    moves.push({
      command: "qualitylayer check step A<n> -- <program> <args…>",
      does: "run the command that proves a Done means step on the built tree and record it",
      by: "agent",
    })
  if (state.unticked === 0 && state.unproven === 0)
    moves.unshift({
      command: "qualitylayer build done",
      does: "the build is ready: start Verify",
      by: "agent",
    })
  else
    moves.push({
      command: 'qualitylayer build done --defer "<why>"',
      does: "start Verify with cards or steps still open",
      by: "agent",
    })
  return [...moves, brief("implement"), abandon]
}

function verifyMoves(mode: VerifyMode): Move[] {
  switch (mode) {
    case "checking":
      return [
        brief("verify"),
        { command: "qualitylayer check all", does: "the project checks and scans", by: "agent" },
        { command: "qualitylayer verify judge", does: "hand out the fresh reviewer", by: "agent" },
      ]
    case "fixing":
      return [
        {
          command: "qualitylayer verify fix",
          does: "fix actionable failures within the approved scope",
          by: "agent",
        },
        { command: "qualitylayer commit fix", does: "commit a fix", by: "agent" },
        {
          command: "qualitylayer verify recheck",
          does: "a fresh reviewer rechecks what failed and what the change affected",
          by: "agent",
        },
      ]
    case "asked":
      return [
        {
          command: "qualitylayer wait --for answer",
          does: "hear the person's answer to the exit question; it holds nothing open, so with no answer yet end your turn",
          by: "agent",
        },
        {
          command: "qualitylayer verify fix",
          does: "one more fix round, on their answer",
          by: "agent",
        },
        {
          command: "qualitylayer verify keep-red",
          does: "keep red checks and review it, on their answer",
          by: "agent",
        },
      ]
    case "yours":
      return [
        wait("approval", "until the person approves the change"),
        { command: "qualitylayer commit fix", does: "commit a fix for their comment", by: "agent" },
        { command: "qualitylayer verify recheck", does: "recheck after a fix", by: "agent" },
      ]
    case "rechecking":
      return [
        {
          command: "qualitylayer verify recheck",
          does: "recheck the fix for their comment",
          by: "agent",
        },
        wait("approval", "their approval still saves while it rechecks"),
      ]
  }
}

/** Who a state waits for, when it waits for someone other than the agent; null when the agent moves. */
export function waitingFor(state: MoveState): string | null {
  if (state.stage === "plan")
    return state.gate === "open"
      ? "the person's approval of the Plan"
      : state.gate === "reviewing"
        ? "the Plan's reviewers"
        : null
  if (state.stage === "verify")
    return state.mode === "asked"
      ? "the person's answer to the exit question"
      : state.mode === "yours"
        ? "the person's review and approval"
        : null
  return null
}

/** The step a state's brief is for, or null where no step text applies. */
export function briefStepOf(state: MoveState): "plan" | "implement" | "verify" | null {
  return state.stage === "plan" || state.stage === "implement" || state.stage === "verify"
    ? state.stage
    : null
}

/**
 * The verb an old `next <word>` meant, read against the state: a word after `next` changes nothing,
 * the reply only names the command that does what it asked. Null for words that name no verb.
 */
export function meantVerb(words: string, state: MoveState): string | null {
  const said = words.trim()
  const word = said.toLowerCase().split(/\s+/)[0] ?? ""
  const start = said.match(/^start\s+(feature|bug|bugfix|chat)\s*:\s*([\s\S]+)$/i)
  if (start !== null) {
    const type = (start[1] ?? "").toLowerCase()
    return `qualitylayer task start ${JSON.stringify((start[2] ?? "").trim())}${type === "feature" ? "" : type === "chat" ? " --type chat" : " --type bug"}`
  }
  if (/^hand\s*back\b/i.test(said))
    return 'qualitylayer task handback "<reason>" --prompt "<prompt>"'
  if (/^show\s+me\b/i.test(said))
    return `qualitylayer show ${said.replace(/^show\s+me\b[:,]?\s*/i, "") || "<topic>"}`
  switch (word) {
    case "":
    case "status":
      return null
    case "done":
      if (state.stage === "plan") return "qualitylayer plan draft, then qualitylayer gate open plan"
      if (state.stage === "implement") return "qualitylayer build done"
      if (state.stage === "verify") return "qualitylayer verify judge"
      return null
    case "judge":
      return "qualitylayer verify judge"
    case "rerun":
      return "qualitylayer verify recheck"
    case "round":
      return "qualitylayer verify fix"
    case "keep":
      return "qualitylayer verify keep-red"
    case "abandon":
      return "qualitylayer task abandon"
    case "implement":
      return "qualitylayer build start"
    case "accept":
      return "qualitylayer wait --for approval"
    case "outline-early":
      return "qualitylayer build start, once the Plan is approved"
  }
  return null
}
