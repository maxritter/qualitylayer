// After `plan amend`, the Plan's Done means steps may name what the cards no longer hold: a file no
// card names any more and the repository does not hold, a slice the cards no longer have, a branch
// that does not exist. They are flagged in the amend's reply, so the agent corrects the step in the
// same amendment rather than a judge failing on it later. (A line of *Proof order* that names a step
// or slice that is gone fails the cards' own validation.)

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { allTasks, extractPaths, type Outline } from "../docs/outline.ts"
import type { ProofStep } from "../docs/proof-list.ts"
import type { Task } from "../task/store.ts"

export type StaleStep = {
  /** The step's id: `A3`. */
  step: string
  problem: string
}

/** A word that names a branch: `origin/main`, `feature/x`, `refs/heads/y`. */
const BRANCH = /^(?:origin|upstream|refs|remotes|heads|feature|feat|fix|bugfix|hotfix|release)\//

/** Whether a card's Files entry covers this path: the file itself, or a directory above it. */
const covers = (file: string, path: string) =>
  file === path || path.startsWith(file.endsWith("/") ? file : `${file}/`)

async function stalePathProblem(
  ctx: Ctx,
  repoRoot: string,
  files: readonly string[],
  before: readonly string[] | undefined,
  path: string,
): Promise<string | null> {
  if (/^(~|\/|\$)/.test(path)) return null
  if (BRANCH.test(path)) {
    const ref = await ctx.git.run(repoRoot, ["rev-parse", "--verify", "--quiet", path])
    return ref.code !== 0 ? `names the branch \`${path}\`, which does not exist` : null
  }
  const namedThen = before?.some((f) => covers(f, path)) === true
  const named = files.some((f) => covers(f, path))
  if (namedThen && !named && !(await ctx.fs.exists(join(repoRoot, path))))
    return `names \`${path}\`, which no card names and the repository does not hold`
  return null
}

function staleSliceProblems(
  slices: ReadonlySet<number>,
  stepId: string,
  text: string,
): StaleStep[] {
  const out: StaleStep[] = []
  for (const match of text.matchAll(/\bslice (\d+)\b/gi)) {
    if (!slices.has(Number(match[1])))
      out.push({ step: stepId, problem: `names slice ${match[1]}, which the cards no longer have` })
  }
  return out
}

/**
 * `before` is every card's Files in the baseline the amendment read: a path is flagged only when
 * a card named it then. A path no card ever named (a file the step creates, one in the
 * QualityLayer home) is not the amendment's doing, and a baseline without the record flags none.
 */
export async function staleSteps(
  ctx: Ctx,
  task: Task,
  outline: Outline,
  before: string[] | undefined,
  plan: readonly ProofStep[],
): Promise<StaleStep[]> {
  const files = allTasks(outline).flatMap((t) => t.files)
  const slices = new Set(outline.slices.map((s) => s.n))
  const stale: StaleStep[] = []
  for (const step of plan) {
    const text = `${step.action} ${step.expected}`
    for (const path of extractPaths(text)) {
      const problem = await stalePathProblem(ctx, task.repoRoot, files, before, path)
      if (problem !== null) stale.push({ step: step.id, problem })
    }
    stale.push(...staleSliceProblems(slices, step.id, text))
  }
  return stale
}
