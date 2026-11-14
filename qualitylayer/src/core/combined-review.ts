// The independent review that also adds the missing tests: one fresh agent writes them and then
// reviews. This module holds what that lane adds to the judge's brief and the receipts it reuses;
// the lane plan itself is `Flow.combinedReview` (`scaling.ts`), and what its new tests may change
// afterwards is `REVIEWER_TEST_PATHS` (`verification.ts`).

import type { Ctx } from "../ctx.ts"
import { type CheckRecord, readCheckRecords } from "./checks.ts"
import type { Verdict } from "./docs/build-log.ts"
import { agentFileOf } from "./docs/names.ts"
import { buildRevision } from "./gate/revision.ts"
import type { Task } from "./task/store.ts"

/** A final project check that passed on exactly the source the review reads. */
export type SourceReceipt = { command: string; at: number }

/**
 * The commands whose latest full run passed on exactly `revision`: it ran (or reused a run that
 * did), exited 0, and did none of its work in name only. A command that last failed, did not run, or
 * ran on other source is not here, so it is run again. Pure: the records and the revision are given.
 */
export function matchedReceipts(
  records: readonly CheckRecord[],
  revision: string,
): SourceReceipt[] {
  const latest = new Map<string, CheckRecord>()
  for (const record of records) if (record.scope === "all") latest.set(record.command, record)
  return [...latest.values()]
    .filter(
      (record) =>
        record.revision === revision &&
        record.ran &&
        record.exit === 0 &&
        record.notRun === undefined,
    )
    .map((record) => ({ command: record.command, at: record.at }))
}

/** The source-matched receipts of the task's final project checks at its current build revision. */
export async function sourceReceipts(ctx: Ctx, task: Task): Promise<SourceReceipt[]> {
  const revision = await buildRevision(ctx, task).catch(() => null)
  return revision === null ? [] : matchedReceipts(await readCheckRecords(ctx, task), revision)
}

/**
 * What the combined lane adds to the judge's brief: the missing tests, the order of the two, the
 * defects a new test shows, and the receipts to reuse. `repoRoot` is the real checkout the new tests
 * are written in; the review itself reads the source it was handed.
 */
export function combinedSection(repoRoot: string, receipts: readonly SourceReceipt[]): string {
  const reuse =
    receipts.length === 0
      ? "No final check has a receipt for this source yet: run a command you need once, and cite what QualityLayer recorded."
      : `QualityLayer already ran these commands on exactly this source and recorded their receipts under \`## Checks\` in \`${agentFileOf("implement")}\`. Cite each receipt and do **not** run it again, not as the acceptance test either:\n\n${receipts.map((r) => `- \`${r.command}\``).join("\n")}\n\nWrite each as \`- [PASS] check: reused receipt — <the line as written>\`. Run the acceptance test's own command only when no receipt above covers it.`
  return [
    "## You also add the missing tests",
    "",
    "You are this change's **Independent review**, and you did not write any of the code. Add the missing tests first, subject to the judge brief's no-file-change rule: propose tests/docs instead of editing them when it applies.",
    "",
    `1. **The missing tests, in the checkout at \`${repoRoot}\`.** Read the diff once and add the tests nobody wrote: for each function, command or screen the change adds or alters, the empty or malformed input, the boundary, the error path a person sees. Name the plausible wrong implementation each test would reject; leave out a test none could fail. Expected values come from the contract, never from what the code prints. Make a doc the change made wrong true. Do not refactor, rename or restructure. Leave every file you write unstaged (tests and docs only, never production code), run each new test once, and list the files in your report: the session commits them after your report.`,
    "2. **A new test that fails has found a defect.** Keep it out of the checkout, and record it in your iteration as `[FAIL] review: D<n> · <the test and what it showed>`. The fix round writes the test and fixes the code.",
    "3. **Then the Independent review**, as the judge brief above says, on the source you were handed: a verdict for every Done means point, the scenarios, the acceptance test and the diff. Your own new tests are not evidence for a point until you ran them and cite their output.",
    "",
    "### Receipts",
    "",
    reuse,
    "",
    "Say in the review line what you added: `tests: <n> tests added · docs: <paths or no doc impact>`. Label proposals as proposals.",
  ].join("\n")
}

/**
 * How many of a review's check lines cite a receipt instead of running the command
 * (`- [PASS] check: reused receipt — …`): the lane view says so beside the points it passed.
 */
export const reusedReceiptCount = (verdicts: readonly Pick<Verdict, "kind" | "text">[]): number =>
  verdicts.filter((v) => v.kind === "check" && /^\s*reused receipt\b/i.test(v.text)).length
