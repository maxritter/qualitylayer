// Who reviews the work as a second opinion. "Other model family" picks by the maker of the model
// that would do the review, not by the tool that runs it: Pi and OpenCode can both run GPT, so the
// pair would be one model looking twice. Pure values, so the App's Settings page and the server pick
// the same way; the callers say which agents are installed, which are signed out, and which models run.

import { AGENT_NAMES, type NativeAgent, readOnlyEnforced } from "./ids.ts"
import { MAKER_FAMILIES, MAKER_NAMES, type ModelMaker, modelMaker } from "./model-maker.ts"

/** The order agents are tried in when nothing else tells them apart. */
const REVIEWER_ORDER: readonly NativeAgent[] = [
  "claude-code",
  "codex",
  "grok",
  "pi",
  "opencode",
  "copilot",
  "cursor",
  "antigravity",
]

export type ReviewerContext = {
  /** The model the building session runs; absent or null when it is not known. */
  model?: string | null
  /** The model each agent would review with: Settings › Reviewer models. */
  models?: Readonly<Partial<Record<NativeAgent, string>>>
  /** Agents whose own status command said they are signed out. An unknown sign-in is not listed. */
  signedOut?: readonly NativeAgent[]
}

export type ReviewerPick = {
  agent: NativeAgent
  /** The reviewer's model is of the same maker as the builder's: a fresh agent, not another family. */
  sameFamily: boolean
  builderMaker: ModelMaker | null
  reviewerMaker: ModelMaker | null
  /** Why this agent, in a sentence for the Settings page and the review log. */
  why: string
}

type Candidate = { agent: NativeAgent; maker: ModelMaker | null; differs: boolean }

/** The agents that may review, best first: another maker, then an enforced read-only review, then the stable order. */
function ranked(
  working: string,
  installed: readonly NativeAgent[],
  context: ReviewerContext,
): { builder: ModelMaker | null; candidates: Candidate[] } {
  const builder = modelMaker(context.model)
  const signedOut = context.signedOut ?? []
  const candidates = installed
    .filter((agent) => agent !== working && !signedOut.includes(agent))
    .map((agent): Candidate => {
      const maker = modelMaker(context.models?.[agent])
      return { agent, maker, differs: builder !== null && maker !== null && maker !== builder }
    })
  const rank = (c: Candidate) =>
    (c.differs ? 0 : 4) + (readOnlyEnforced(c.agent) ? 0 : 2) + REVIEWER_ORDER.indexOf(c.agent) / 10
  return { builder, candidates: candidates.sort((a, b) => rank(a) - rank(b)) }
}

const wording = (maker: ModelMaker | null) => (maker === null ? null : MAKER_FAMILIES[maker])

/** Why a fresh session of the builder's own agent reviews, when no other agent can. */
export function freshSessionWhy(agent: NativeAgent, maker: ModelMaker | null): string {
  return maker === null
    ? `No other agent is available, so a fresh ${AGENT_NAMES[agent]} session reviews.`
    : `Only ${MAKER_NAMES[maker]} models are available, so a fresh ${AGENT_NAMES[agent]} session reviews.`
}

/** The sentence for a pick of the automatic choice. */
function whyAuto(agent: NativeAgent, c: Candidate, builder: ModelMaker | null): string {
  const name = AGENT_NAMES[agent]
  if (c.differs && builder !== null && c.maker !== null) {
    const family = MAKER_FAMILIES[c.maker]
    return `${family === name ? name : `${name} (${family})`} checks ${wording(builder)}'s work.`
  }
  if (builder !== null && c.maker === builder) return freshSessionWhy(agent, builder)
  return `${name} checks the work.`
}

function makePick(
  agent: NativeAgent,
  why: string,
  builder: ModelMaker | null,
  reviewerMaker: ModelMaker | null,
  sameFamilyOverride?: boolean,
): ReviewerPick {
  return {
    agent,
    sameFamily: sameFamilyOverride ?? (builder !== null && reviewerMaker === builder),
    builderMaker: builder,
    reviewerMaker,
    why,
  }
}

function pickNamedReviewer(
  choice: NativeAgent,
  rankedPool: { builder: ModelMaker | null; candidates: readonly Candidate[] },
  input: { working: string; installed: readonly NativeAgent[]; context: ReviewerContext },
): ReviewerPick | null {
  const { builder, candidates } = rankedPool
  const { working, installed, context } = input
  if (!installed.includes(choice)) return null
  if (choice !== working) {
    return makePick(
      choice,
      `${AGENT_NAMES[choice]} was chosen in Settings.`,
      builder,
      modelMaker(context.models?.[choice]),
    )
  }
  // It built the change: another agent checks it, picked as the automatic choice picks.
  const other = candidates[0]
  if (other !== undefined) {
    return makePick(other.agent, whyAuto(other.agent, other, builder), builder, other.maker)
  }
  return makePick(
    choice,
    `${AGENT_NAMES[choice]} was chosen in Settings and built the change, so a fresh session of it reviews.`,
    builder,
    modelMaker(context.models?.[choice]),
    true,
  )
}

/**
 * The reviewer of a change an agent built. A named agent is that agent, or another one when it built
 * the change; `auto` is Other model family: among the installed agents other than the builder that
 * are not known to be signed out, one whose model is of another maker than the builder's (an unknown
 * maker never counts as another), an enforced read-only review before a detected one, then the order
 * Claude Code, Codex, Grok, Pi, OpenCode, Copilot, Cursor, Antigravity. When no maker differs, a fresh agent
 * of the same maker, marked `sameFamily`. Null when no agent can.
 */
export function pickReviewer(
  working: string,
  choice: "auto" | NativeAgent,
  installed: readonly NativeAgent[],
  context: ReviewerContext = {},
): ReviewerPick | null {
  const pool = ranked(working, installed, context)
  if (choice !== "auto") {
    return pickNamedReviewer(choice, pool, { working, installed, context })
  }
  const best = pool.candidates[0]
  if (best === undefined) return null
  return makePick(best.agent, whyAuto(best.agent, best, pool.builder), pool.builder, best.maker)
}

/** The most reviewers a Plan's panel seats: a task's extra planners (`task start --planners`). */
export const PANEL_SEATS = 3

/**
 * The installed agents that did not build the change and are not known to be signed out, in the
 * order `pickReviewer` prefers them: another maker's model first.
 */
export function otherReviewers(
  working: string,
  installed: readonly NativeAgent[],
  context: ReviewerContext = {},
): NativeAgent[] {
  return ranked(working, installed, context).candidates.map((c) => c.agent)
}
