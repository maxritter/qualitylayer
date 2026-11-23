// Rules that only hold once the build has run: they guard the step from Verify's checks to the
// final gate, not the Plan's own gate. The Plan says what must be judged; agents/03-verify.md holds
// the judge's iterations.

import { join } from "node:path"
import type { Ctx, ValidationError } from "../../../ctx.ts"
import { assignedPlan } from "../../judge-records.ts"
import { isRecheck, type Recheck, recheckOf, roundAssignment } from "../../recheck.ts"
import { proofList } from "../acceptance.ts"
import { type Iteration, parseIterations } from "../build-log.ts"
import { parseDoc } from "../frontmatter.ts"
import { folderDoc } from "../names.ts"
import { emptyOutline, evidenceIn, type Outline } from "../outline.ts"
import { readCards } from "../outline-files.ts"
import { type Rule, verr } from "./types.ts"
import { type PartsCheckResult, partsComplete } from "./verify-parts.ts"

/**
 * What a round is held to, from the Plan's Done means: the step ids (`A1`…). A round is complete
 * with a verdict per step and one for the diff.
 */
export type AcceptanceBasis = {
  ids: readonly string[]
  /** Each step's text (`A1` → `action → expected`), kept with an assignment so a recheck knows a rewrite. */
  texts?: Record<string, string>
  /**
   * A recheck: the steps QualityLayer carries into the round (no verdict needed) and the ones the
   * round must record, with why. Absent for a full round.
   */
  recheck?: Pick<Recheck, "carried" | "again">
}

const basisOf = (acceptance: readonly string[] | AcceptanceBasis): AcceptanceBasis =>
  "ids" in acceptance ? acceptance : { ids: acceptance }

/** The Done means steps of the Plan in a task folder, as a round is held to them. */
export async function acceptanceBasis(ctx: Ctx, taskDir: string): Promise<AcceptanceBasis> {
  const plan = join(taskDir, folderDoc("plan"))
  const list = proofList(
    (await ctx.fs.exists(plan)) ? parseDoc(await ctx.fs.readFile(plan)).body : "",
  )
  return {
    ids: list.steps.map((step) => step.id),
    texts: Object.fromEntries(list.steps.map((step) => [step.id, step.text])),
  }
}

/** The exact line a missing verdict is recorded with. */
const verdictHint = (words: string, item: string) =>
  `add a verdict line to the iteration: \`- [${words}] ${item}: <${item.startsWith("acceptance") ? "what you ran and saw" : "evidence"}>\``

function checkAcceptanceVerdicts(
  iteration: Iteration,
  acceptance: readonly string[],
  recheck: AcceptanceBasis["recheck"],
  split: PartsCheckResult,
  errors: ValidationError[],
): void {
  const hasAcceptance = (id: string) =>
    iteration.verdicts.some(
      (v) => v.kind === "acceptance" && v.subject.toLowerCase() === id.toLowerCase(),
    )
  for (const id of acceptance) {
    // Step shares hold steps; otherwise the diff-wide share holds the Done means steps.
    const unjudgedStep = split.byStep ? split.unjudged.steps.has(id) : split.unjudged.diff
    if (recheck?.carried.has(id) === true || unjudgedStep || hasAcceptance(id)) continue
    const why = recheck?.again.get(id)
    errors.push(
      verr(
        iteration.line,
        "verdicts-complete",
        `no verdict for acceptance step ${id}${why === undefined ? "" : ` (${why})`}`,
        `${verdictHint("PASS|FAIL|MISSING|USER", `acceptance ${id}`)}; a pass cites the file under evidence/ or records/ in backticks, and [USER] is for a step only the person can check`,
      ),
    )
  }
}

function checkIterationMeta(
  iteration: Iteration,
  split: PartsCheckResult,
  errors: ValidationError[],
): void {
  const hasReview = iteration.verdicts.some((v) => v.kind === "review")
  if (!split.unjudged.diff && !hasReview) {
    errors.push(
      verr(
        iteration.line,
        "verdicts-complete",
        "the diff review has no verdict",
        "add `- [PASS] review: <what the review of the diff covered>`",
      ),
    )
  }
  if (iteration.judge === null) {
    errors.push(
      verr(
        iteration.line,
        "verdicts-complete",
        "the iteration does not say who judged it",
        "add `**Judge:** fresh helper` (or `**Judge:** build session, no helpers available`)",
      ),
    )
  }
  // Parts of a shared iteration each name their own missing result above.
  if (iteration.result === null && !split.checked) {
    errors.push(
      verr(
        iteration.line,
        "verdicts-complete",
        "the iteration has no **Result:** line",
        "end the iteration with `**Result:** pass` or `**Result:** fail`",
      ),
    )
  }
}

function checkVerdictEntries(iteration: Iteration, errors: ValidationError[]): void {
  for (const v of iteration.verdicts) {
    if (v.text.trim() === "") {
      errors.push(
        verr(
          v.line,
          "evidence-required",
          "A verdict has no evidence",
          "Record the command/output, observation or source evidence behind this verdict",
        ),
      )
    }
    // [USER] is the person's: a Done means point or a step of it can be; a judge never moves a
    // check it can run.
    if (v.verdict === "USER" && v.kind !== "done" && v.kind !== "acceptance") {
      errors.push(
        verr(
          v.line,
          "verdicts-complete",
          `\`[USER] ${v.kind} ${v.subject}\`: only a Done means step can be the person's`,
          "judge it yourself and record `[PASS]` or `[FAIL]`; `[USER]` is for an `acceptance A<n>` step only the person can check",
        ),
      )
    }
  }
  // A NOTE is reported, never failed: the build passes with it.
  const failing = iteration.verdicts.filter((v) => v.verdict === "FAIL" || v.verdict === "MISSING")
  if (iteration.result === "pass" && failing.length > 0) {
    errors.push(
      verr(
        failing[0]?.line ?? iteration.line,
        "verdicts-complete",
        `the result says pass but ${failing.length} verdict(s) are FAIL or MISSING`,
        '"mostly" is fail: set `**Result:** fail`, or fix the gaps and verify again',
      ),
    )
  }
}

/**
 * The verdicts a round holds: a verdict per step of the Plan's Done means and one for the diff. A
 * line that is not required is accepted when a reviewer writes it, and fails the round when it is
 * `[FAIL]` or `[MISSING]`.
 */
export function verdictsComplete(
  outline: Outline,
  iteration: Iteration,
  basis: readonly string[] | AcceptanceBasis = [],
): ValidationError[] {
  const { ids: acceptance, recheck } = basisOf(basis)
  const split = partsComplete(outline, iteration)
  const errors: ValidationError[] = [...split.errors]
  checkVerdictEntries(iteration, errors)
  checkAcceptanceVerdicts(iteration, acceptance, recheck, split, errors)
  checkIterationMeta(iteration, split, errors)
  return errors
}

/** The Verify file's iterations, each held to the cards; without cards, to empty ones. */
export const verifyVerdicts: Rule = async ({ ctx, taskDir, markdown, runtimeDir }) => {
  const outline = await readCards(ctx, taskDir)
  return recordVerdictErrors(
    ctx,
    runtimeDir,
    outline,
    parseIterations(markdown),
    await acceptanceBasis(ctx, taskDir),
  )
}

/** The same historical scope rules apply when `next` reads records and when `validate` checks them. */
export async function recordVerdictErrors(
  ctx: Ctx,
  runtimeDir: string | null,
  plan: Outline | null,
  iterations: Iteration[],
  acceptance: readonly string[] | AcceptanceBasis = [],
): Promise<ValidationError[]> {
  const outline = plan ?? emptyOutline()
  const basis = basisOf(acceptance)
  const errors = await Promise.all(
    iterations.map(async (iteration) => {
      const assigned = await assignedPlan(ctx, runtimeDir, iteration.assignment)
      // A recheck is read as it was counted: the evidence it carried is not looked at again here
      // (`lostEvidenceWarnings` says when it is gone).
      const ruled = await roundAssignment(ctx, runtimeDir, iteration.assignment)
      const recheck = isRecheck(ruled) ? await recheckOf(ctx, runtimeDir, ruled, iterations) : null
      return verdictsComplete(assigned?.outline ?? outline, iteration, {
        ids: assigned?.acceptance ?? basis.ids,
        ...(recheck !== null ? { recheck } : {}),
      })
    }),
  )
  return errors.flat()
}

/**
 * A file under evidence/ or records/, directly or in subfolders; every segment starts with a
 * letter or digit.
 */
const EVIDENCE_PATH = /^(?:evidence|records)(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/

/** The files a round cites as proof: the pictures it captions and the paths its verdicts name. */
export function citedFiles(iteration: Iteration): string[] {
  return [
    ...new Set([
      ...iteration.pictures.map((picture) => picture.file),
      ...iteration.verdicts.flatMap((verdict) => evidenceIn(verdict.text)),
    ]),
  ]
}

/** Whether a cited path is one the task folder can hold: under evidence/ or records/, nothing above it. */
export const isEvidencePath = (path: string): boolean =>
  EVIDENCE_PATH.test(path) && !path.includes("..")

/** Every evidence file a verdict cites, and every picture the round captions, exists in the task folder. */
export async function evidenceResolves(
  iteration: Iteration,
  exists: (relative: string) => Promise<boolean>,
): Promise<ValidationError[]> {
  const errors: ValidationError[] = []
  for (const picture of iteration.pictures) {
    if (!(await exists(picture.file))) {
      errors.push(
        verr(
          iteration.line,
          "evidence-resolves",
          `\`${picture.file}\` is captioned as a picture but is not in the task folder`,
          "use the capture command's returned file under evidence/ or records/ in the task folder, or caption what exists",
        ),
      )
    }
  }
  for (const verdict of iteration.verdicts) {
    const paths = evidenceIn(verdict.text)
    if (verdict.verdict === "PASS" && verdict.kind === "acceptance" && paths.length === 0) {
      errors.push(
        verr(
          verdict.line,
          "evidence-required",
          "A runtime pass cites no captured proof",
          "Capture the observed output or screenshot and cite the returned file under evidence/ or records/ in backticks, unchanged",
        ),
      )
    }
    for (const path of paths) {
      if (!isEvidencePath(path) || !(await exists(path))) {
        errors.push(
          verr(
            verdict.line,
            "evidence-resolves",
            `\`${path}\` is cited as evidence but is not in the task folder`,
            "use the capture command's returned file under evidence/ or records/ in the task folder, or cite what exists",
          ),
        )
      }
    }
  }
  return errors
}
