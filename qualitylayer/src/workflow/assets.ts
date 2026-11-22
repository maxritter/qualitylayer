// Readable workflow composition. Development uses these imports directly; official
// clients carry the exact-version bundle generated from the same public inputs.

import artifactSkill from "../skills/ql-artifact/SKILL.md" with { type: "text" }
import chatSkill from "../skills/ql-chat/SKILL.md" with { type: "text" }
import manageSkill from "../skills/ql-manage/SKILL.md" with { type: "text" }
import peersSkill from "../skills/ql-peer/SKILL.md" with { type: "text" }
import qualitySkill from "../skills/ql-quality/SKILL.md" with { type: "text" }
import skill from "../skills/ql-workflow/SKILL.md" with { type: "text" }
import artifactTemplate from "./artifacts/artifact.html.tmpl" with { type: "text" }
import wireframeTemplate from "./artifacts/wireframe.html.tmpl" with { type: "text" }
import pictures from "./phases/_pictures.md" with { type: "text" }
import style from "./phases/_style.md" with { type: "text" }
import anotherReview from "./phases/another-review.md" with { type: "text" }
import artifactAuthoring from "./phases/artifact-authoring.md" with { type: "text" }
import artifactCheck from "./phases/artifact-check.md" with { type: "text" }
import crossReview from "./phases/cross-review.md" with { type: "text" }
import crossReviewRound from "./phases/cross-review-round.md" with { type: "text" }
import final from "./phases/final.md" with { type: "text" }
import handback from "./phases/handback.md" with { type: "text" }
import implement from "./phases/implement.md" with { type: "text" }
import implementBugfix from "./phases/implement-bugfix.md" with { type: "text" }
import judge from "./phases/judge.md" with { type: "text" }
import judgeBugfix from "./phases/judge-bugfix.md" with { type: "text" }
import judgeRerun from "./phases/judge-rerun.md" with { type: "text" }
import lineQuestion from "./phases/line-question.md" with { type: "text" }
import plan from "./phases/plan.md" with { type: "text" }
import planAdopted from "./phases/plan-adopted.md" with { type: "text" }
import planBugfix from "./phases/plan-bugfix.md" with { type: "text" }
import qualitySecurity from "./phases/quality-security.md" with { type: "text" }
import qualitySecurityRecheck from "./phases/quality-security-recheck.md" with { type: "text" }
import researchHelper from "./phases/research-helper.md" with { type: "text" }
import reviewTriage from "./phases/review-triage.md" with { type: "text" }
import ship from "./phases/ship.md" with { type: "text" }
import showMe from "./phases/show-me.md" with { type: "text" }
import verify from "./phases/verify.md" with { type: "text" }
import verifyBugfix from "./phases/verify-bugfix.md" with { type: "text" }
import verifyJudge from "./phases/verify-judge.md" with { type: "text" }
import implementSchema from "./schemas/implement.json"
import planSchema from "./schemas/plan.json"
import planAdoptedSchema from "./schemas/plan-adopted.json"
import planBugfixSchema from "./schemas/plan-bugfix.json"
import researchSchema from "./schemas/research.json"
import verifySchema from "./schemas/verify.json"

/** True in a development build and in the tests; a release build is compiled with this defined false. */
declare const QUALITYLAYER_DEV_BUILD: boolean | undefined
export const isDevBuild: boolean =
  typeof QUALITYLAYER_DEV_BUILD === "undefined" || QUALITYLAYER_DEV_BUILD

const join = (...parts: string[]) =>
  parts
    .map((p) => p.trimEnd())
    .join("\n\n")
    .concat("\n")

/**
 * Keyed by phase, with `<phase>-bugfix` variants where the method differs. The helper briefs
 * (`research-helper`, `quality-security`, `judge`) are composed with task paths in core/briefs.ts.
 * A bug's Plan and Implement texts add their differences to the feature's text.
 */
const phases: Record<string, string> = {
  "artifact-authoring": join(artifactAuthoring),
  "artifact-check": join(artifactCheck),
  // The Plan: understand, read, ask, write, draft and gate, in one text for the whole step.
  // The steps that draw carry the picture rules (_pictures.md).
  plan: join(plan, style, pictures),
  "plan-bugfix": join(plan, planBugfix, style, pictures),
  // A task started from an existing plan: the Plan maps the person's original.
  "plan-adopted": join(planAdopted, style),
  "research-helper": join(researchHelper),
  "cross-review": join(crossReview),
  "cross-review-round": join(crossReviewRound),
  // Implement cuts the Plan into slices and cards, then builds them; it asks the person nothing
  // and has no Diagrams section, so it omits _style.md and _pictures.md.
  implement: join(implement),
  "implement-bugfix": join(implement, implementBugfix),
  handback: join(handback),
  "quality-security": join(qualitySecurity),
  "quality-security-recheck": join(qualitySecurityRecheck),
  verify: join(verify),
  "verify-bugfix": join(verify, verifyBugfix),
  judge: join(judge),
  "judge-rerun": join(judgeRerun),
  "verify-judge": join(verifyJudge),
  "judge-bugfix": join(judgeBugfix),
  final: join(final),
  "review-triage": join(reviewTriage),
  ship: join(ship),
  "show-me": join(showMe),
  // A question on a line of the change, answered by a fresh read-only helper (review/answers.ts).
  "line-question": join(lineQuestion),
  // One more review asked from the Review workspace (review/another.ts).
  "another-review": join(anotherReview),
  style: join(style),
}

const schemas: Record<string, unknown> = {
  // The research helpers' findings, the base of their reply template (core/briefs.ts).
  research: researchSchema,
  // The three steps' documents, one schema per step (a bug's and an adopted plan's Plan have their own).
  plan: planSchema,
  "plan-bugfix": planBugfixSchema,
  "plan-adopted": planAdoptedSchema,
  implement: implementSchema,
  verify: verifySchema,
}

const templates: Record<string, string> = {
  artifact: artifactTemplate,
  wireframe: wireframeTemplate,
}

/** One phase's text, or undefined for a name that is not a phase. */
export const phaseText = (name: string): string | undefined => phases[name]
/** One document schema as JSON text. */
export const schemaText = (name: string): string | undefined =>
  schemas[name] === undefined ? undefined : JSON.stringify(schemas[name])
/** One page template (`artifact` or `wireframe`). */
export const templateText = (name: string): string | undefined => templates[name]
export const skillText = (): string => skill
export const peersSkillText = (): string => peersSkill
export const artifactSkillText = (): string => artifactSkill
export const manageSkillText = (): string => manageSkill
export const qualitySkillText = (): string => qualitySkill
export const chatSkillText = (): string => chatSkill

/** The phases a human can print with `qualitylayer show <phase>` in a development build. */
export const PHASES = [
  "plan",
  "plan-bugfix",
  "plan-adopted",
  "implement",
  "implement-bugfix",
  "verify",
  "verify-bugfix",
  "judge",
  "final",
  "review-triage",
  "ship",
  "show-me",
]

/**
 * Static phase, schema, template and skill composition, keyed by stable asset id.
 * Native/bootstrap inputs and runtime composition sources are also recorded by the bundle generator.
 */
export function everyText(): Record<string, string> {
  const all: Record<string, string> = {}
  for (const [name, text] of Object.entries(phases)) all[`phase:${name}`] = text
  for (const name of Object.keys(schemas)) all[`schema:${name}`] = schemaText(name) as string
  for (const [name, text] of Object.entries(templates)) all[`template:${name}`] = text
  all["skill:main"] = skill
  all["skill:peers"] = peersSkill
  all["skill:artifact"] = artifactSkill
  all["skill:manage"] = manageSkill
  all["skill:quality"] = qualitySkill
  all["skill:chat"] = chatSkill
  return all
}
