// `check slice <n>` · `check task T<n>` · `check all`: run the commands the approved Plan names
// and record them. `check step A<n> [-- <program> <args…>]`: run a Done means step on the built tree and
// record it, so `build done` knows it ran green. Thin parsing over core/checks.ts and
// core/next/steps.ts.

import { chatWorkflowRefusal } from "../../core/chat/task.ts"
import { type CheckScope, runCheck, startCheck } from "../../core/checks.ts"
import { runBaseCheck } from "../../core/checks-base.ts"
import { ciParityWarning } from "../../core/ci-parity.ts"
import { runStep } from "../../core/next/steps.ts"
import { selectedReviewCandidate } from "../../core/review-candidate.ts"
import { type Ctx, err, type Result } from "../../ctx.ts"
import { requireTask } from "./shared.ts"

const USAGE =
  "usage: qualitylayer check slice <n> | task T<n> | step A<n> [-- <program> <args…>] | all [--background] | all --base\n" +
  "`step A<n> -- <program> <args…>` runs that command on the built tree and records its exit code and output under records/: each argument reaches the program as given (`-- bun test tests/cli.test.ts`, `-- bash -c '<script>'`); one argument alone runs as a shell line (`-- 'bun test && bun run lint'`). Without `--` it runs the backticked command on the step's *Proof order* line; the Plan's Action is prose and never runs.\n" +
  "`all --base` runs the same project checks on a copy of the task's base commit and excuses only the failing tests that also fail there.\n" +
  "Checks have a 15-minute limit. Set QUALITYLAYER_CHECK_TIMEOUT_MS to an explicit budget in milliseconds (up to 2 hours) for a slower approved command."

function scopeOf(args: string[]): CheckScope | null {
  const [what, which] = args
  if (what === "all" && which === undefined) return { kind: "all" }
  if (what === "slice" && which !== undefined && /^\d+$/.test(which))
    return { kind: "slice", n: Number(which) }
  if (what === "task" && which !== undefined && /^T\d+$/i.test(which))
    return { kind: "task", id: which.toUpperCase() }
  return null
}

type CheckArgs = { scope: CheckScope; background: boolean; onBase: boolean; worker?: string }

/** The scope and flags of `qualitylayer check`, or null when the arguments are none of its forms. */
function parseCheckArgs(args: string[]): CheckArgs | null {
  const positional: string[] = []
  let background = false
  let onBase = false
  let worker: string | undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    if (arg === "--background") background = true
    else if (arg === "--base") onBase = true
    else if (arg !== "--worker") positional.push(arg)
    else {
      worker = args[++i]
      if (worker === undefined || !/^[a-f0-9-]{36}$/.test(worker)) return null
    }
  }
  const scope = scopeOf(positional)
  if (scope === null || (onBase && (scope.kind !== "all" || worker !== undefined))) return null
  return { scope, background, onBase, worker }
}

/** `check step A<n> [-- <command>]`: the step's run on the built tree, recorded. */
async function stepCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const [id, ...rest] = args
  const dash = rest.indexOf("--")
  // The words after `--` as the shell handed them over: an argv, never joined back unquoted.
  const command = dash === -1 ? null : rest.slice(dash + 1)
  if (
    id === undefined ||
    !/^A\d+$/i.test(id) ||
    (dash === -1 ? rest.length > 0 : dash !== 0 || !command?.some((word) => word.trim() !== ""))
  )
    return err({ code: "bad_args", message: USAGE })
  const task = await requireTask(ctx)
  if (!task.ok) return task
  if (task.data.type === "chat") return chatWorkflowRefusal()
  if (task.data.stage !== "implement" && task.data.stage !== "verify")
    return err({
      code: "bad_args",
      message: `a Done means step runs on the built tree; ${task.data.slug} is in ${task.data.stage}`,
    })
  const candidate =
    task.data.stage === "verify" ? await selectedReviewCandidate(ctx, task.data) : null
  const scoped = candidate ? { ...task.data, repoRoot: candidate.choice.checkout } : task.data
  return runStep(ctx, scoped, id.toUpperCase(), command)
}

export async function checkCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  if (args[0] === "step") return stepCmd(ctx, args.slice(1))
  const parsed = parseCheckArgs(args)
  if (parsed === null) return err({ code: "bad_args", message: USAGE })
  const { scope, background, onBase, worker } = parsed
  // The base run has no background worker: it waits for the check lock and runs in the foreground.
  if (onBase && background)
    return err({
      code: "bad_args",
      message:
        "`check all --base` runs in the foreground only: run it without --background and wait for it.",
    })
  const task = await requireTask(ctx)
  if (!task.ok) return task
  if (task.data.type === "chat") return chatWorkflowRefusal()
  const stage = task.data.stage
  // A shipped task's fix is checked again before the person pushes it to the open pull request.
  if (stage !== "implement" && stage !== "verify" && stage !== "shipped") {
    return err({
      code: "bad_args",
      message: `checks run once the Plan is approved; ${task.data.slug} is in ${stage}`,
    })
  }
  if (onBase) return runBaseCheck(ctx, task.data)
  const candidate = stage === "verify" ? await selectedReviewCandidate(ctx, task.data) : null
  const checkedTask = candidate ? { ...task.data, repoRoot: candidate.choice.checkout } : task.data
  // The worker loads the task in its recorded checkout, then applies the same candidate binding.
  if (background) return startCheck(ctx, task.data, scope)
  const result = await runCheck(ctx, checkedTask, scope, undefined, worker)
  if (result.ok && scope.kind === "all" && result.data.passed) {
    const warning = await ciParityWarning(ctx, checkedTask, undefined, true)
    if (warning !== null) return { ...result, data: { ...result.data, warnings: [warning] } }
  }
  return result
}
