// The sections QualityLayer writes in a task's Review document (03-verify.md), one writer per `ql:`
// marker: Changed from the Plan, the Code line (the points that pass, the task's own commits and the
// security counts), the Screens designed beside built, and the Plan's Acceptance test as it ran. Ship
// is drawn by `fallbackOf` (render.ts). Everything above Ship is the pull request's body, exported as
// written (core/ship/pr-body.ts): names only, no pictures. Review opens when every point passes, so no
// section lists what is left.

import type { AcceptanceAsRun } from "../../review/screen-evidence.ts"
import { screenSize } from "../../review/screen-pairs.ts"
import type { RiskAtMerge, Walkthrough } from "../../review/walkthrough.ts"
import { countedFacts } from "../lanes.ts"
import type { PageState, SectionWriters } from "../render.ts"

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/**
 * *Changed from the Plan*: what left the approved Plan, in one line when nothing did. The agent reads it and
 * names where to look first under *Code*.
 */
export function riskMarkdown(risk: RiskAtMerge, pending = false): string {
  const dependencies = risk.dependencies.filter((path) => risk.outside.includes(path))
  const names = (files: readonly string[]) =>
    `${files
      .slice(0, 3)
      .map((f) => `\`${f}\``)
      .join(", ")}${files.length > 3 ? ` and ${files.length - 3} more` : ""}`
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const lines = [
    ...(risk.outside.length > 0
      ? [
          `- ${count(risk.outside.length, "file", "files")} outside the task cards: ${names(risk.outside)}`,
        ]
      : []),
    ...(dependencies.length > 0
      ? [
          `- ${count(dependencies.length, "dependency file", "dependency files")} changed: ${names(dependencies)}`,
        ]
      : []),
    ...(risk.amendments > 0
      ? [`- ${count(risk.amendments, "amendment", "amendments")} to the approved Plan`]
      : []),
  ]
  if (lines.length > 0) return lines.join("\n")
  return pending ? "" : "As planned."
}

/**
 * The judge's passes were given on an earlier commit than the code the person approved: its short
 * id (null when none is recorded), and whether the code moved since or the Plan and its review did.
 */
export type PassJudgedOn = { commit: string | null; code: boolean }

/** How the points line ends when the passes were judged on other code than the approved one. */
function judgedOnWords(judged: PassJudgedOn): string {
  const moved = judged.code ? "the code" : "the Plan or its review"
  return judged.commit === null
    ? `passed before ${moved} changed`
    : `passed on commit ${judged.commit}; ${moved} changed since`
}

/** The points line as `codeMarkdown` writes it while the pass stands, at the start of the Code line. */
const POINTS_PASS = /^(All \d+ points?|\d+ of \d+ points?) pass(?= · |$)/

/**
 * A Code line written while the pass stood, said again for an approval of code the judge did not
 * pass: the same counts, with the commit they were judged on. A line that claims no pass stays.
 */
export function codeLineJudgedOn(written: string, judged: PassJudgedOn): string {
  const [first = "", ...rest] = written.split("\n")
  return [
    first.replace(POINTS_PASS, (_, counted: string) => `${counted} ${judgedOnWords(judged)}`),
    ...rest,
  ].join("\n")
}

/**
 * *Code*: the points that pass, the task's own commits and the security counts, in one line, for
 * the pull request description. With `judged`, the passes are named with the commit
 * they were given on, because the code approved is not the code the judge passed.
 */
export function codeMarkdown(
  view: Walkthrough,
  security: PageState["checks"][number] | undefined,
  judged?: PassJudgedOn,
): string {
  const passing = view.points.filter(
    (point) => point.status === "passed" || point.status === "confirmed by you",
  ).length
  const facts = security === undefined ? [] : countedFacts(security.result)
  const counted =
    passing === view.points.length
      ? `All ${plural(view.points.length, "point")}`
      : `${passing} of ${plural(view.points.length, "point")}`
  return [
    ...(view.points.length > 0
      ? [`${counted} ${judged === undefined ? "pass" : judgedOnWords(judged)}`]
      : []),
    ...(view.totals.commits > 0 ? [plural(view.totals.commits, "commit")] : []),
    ...(security === undefined
      ? []
      : [`Security: ${facts.length > 0 ? facts.join(", ") : security.result.trim()}`]),
  ].join(" · ")
}

/**
 * *Screens*: each screen the Plan showed with its size, theme, capture outcome and freshness, and the
 * independent review's comparison. The pictures stay local; the line names the approved one.
 */
export function screensMarkdown(view: Walkthrough): string {
  if (!view.screens?.length) return "No screens were drawn in the Plan."
  return view.screens
    .map((screen) =>
      [
        `- **${screen.key}** · ${screenSize(screen)} · ${screen.theme} · ${screen.outcome.replace(/[\r\n]/g, " ")} · ${screen.stale ? "stale" : "current"}`,
        ...(screen.approved ? [`  - Designed: \`${screen.approved}\``] : []),
        `  - Independent review: ${screen.verdict.replace(/[\r\n]/g, " ")}`,
        ...(screen.staleReason
          ? [`  - Refresh: ${screen.staleReason.replace(/[\r\n]/g, " ")}`]
          : []),
      ].join("\n"),
    )
    .join("\n")
}

/** The steps that ran the other way than the run did: ", A3 in a real agent session"; empty when none. */
function otherWay(acceptance: AcceptanceAsRun): string {
  const others = acceptance.steps.filter(
    (step) => step.mode !== undefined && step.mode !== acceptance.mode,
  )
  if (others.length === 0) return ""
  const kind = acceptance.mode === "scripted" ? "a real agent session" : "a scripted run"
  return `, ${others.map((step) => step.id).join(", ")} in ${kind}`
}

/**
 * *Acceptance test*: the Plan's steps as written, each with the pictures and outputs the run that
 * passed recorded for it, and how that run happened: a scripted run or a real agent session.
 */
export function acceptanceMarkdown(acceptance: AcceptanceAsRun): string {
  if (acceptance.steps.length === 0) return "The Plan has no acceptance test."
  const how =
    acceptance.mode === null
      ? acceptance.judged === true
        ? "Passed the independent review on the evidence it cited."
        : "No run has passed yet."
      : `Passed in ${acceptance.mode === "scripted" ? "a scripted run" : "a real agent session"}${otherWay(acceptance)} (run ${acceptance.run}).`
  const cited = (step: AcceptanceAsRun["steps"][number]) =>
    step.evidence.length > 0
      ? ` · ${step.evidence.map((item) => `\`${item.file}\``).join(", ")}${step.run !== undefined && step.run !== acceptance.run ? ` · run ${step.run}` : ""}`
      : ""
  // A Plan that lists its test by Done means point: a heading per point with its steps under it,
  // the step ids as the Plan has them (a step that proves two points is listed under both).
  if (acceptance.points !== undefined)
    return [
      how,
      ...acceptance.points.flatMap((point) => [
        "",
        `### ${point.n}. ${point.text}`,
        ...point.steps.flatMap((step) => [
          `- ${step.id} · ${step.text}${cited(step)}`,
          // A bug's step: what showed the bug before the fix, under it (`text` ends at what shows it gone).
          ...(step.before !== undefined ? [`  - Before the fix: ${step.before}`] : []),
        ]),
      ]),
    ].join("\n")
  const steps = acceptance.steps.map((step) => `${step.n}. ${step.text}${cited(step)}`)
  return [how, "", ...steps].join("\n")
}

export const reviewSections: SectionWriters = {
  /** What left the approved Plan. */
  risk: (state) =>
    state.walkthrough?.risk !== undefined
      ? riskMarkdown(
          state.walkthrough.risk,
          (state.walkthrough.changeScope?.pending.length ?? 0) > 0,
        )
      : null,
  /** The points that pass, the task's own commits and the security counts. */
  code: (state) =>
    state.walkthrough === undefined
      ? null
      : codeMarkdown(
          state.walkthrough,
          state.checks.find((check) => check.label === "Security review"),
        ),
  /** The Plan's screens, designed beside built. */
  screens: (state) => (state.walkthrough === undefined ? null : screensMarkdown(state.walkthrough)),
  /** The Plan's acceptance test as the run that passed ran it. */
  acceptance: (state) =>
    state.walkthrough === undefined ? null : acceptanceMarkdown(state.walkthrough.acceptance),
}
