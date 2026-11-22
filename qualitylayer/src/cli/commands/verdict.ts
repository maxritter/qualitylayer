// `verdict <assignment> <item> pass|fail|missing|user|note "<text>" [--evidence <file>]`: a judge
// records one check as it finishes it; the App's list fills in live. Thin parsing over core/verdicts.ts.
// `attest <item> "<what the person said>" [--evidence <file>]`: the agent records what the person
// confirmed (an "Answer in words" answer), outside the build log.

import { recordAttestation } from "../../core/attestations.ts"
import { judgeRun } from "../../core/judge-run.ts"
import { recordVerdict, VERDICT_WORDS } from "../../core/verdicts.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { parseArgs, requireTask } from "./shared.ts"

const USAGE =
  'usage: qualitylayer verdict <assignment> <item> pass|fail|missing|user|note "<text>" [--evidence <file>] [--run <id> --mode scripted|real-session]'

const RUN_USAGE =
  "usage: qualitylayer verdict run <assignment> [--name <file>] [--timeout <seconds>] -- <program> [args…]"

/**
 * `verdict run <assignment> -- <program> [args…]`: run one project command in the judge's tree with
 * its lease's environment and keep the output under evidence/, to cite in the verdict.
 */
async function runCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const dash = args.indexOf("--")
  if (dash < 0) return err({ code: "bad_args", message: RUN_USAGE })
  const { positional, flags } = parseArgs(args.slice(1, dash), ["name", "timeout"])
  const [assignment] = positional
  if (assignment === undefined || positional.length > 1)
    return err({ code: "bad_args", message: RUN_USAGE })
  const task = await requireTask(ctx)
  if (!task.ok) return task
  return judgeRun(ctx, task.data, {
    assignment,
    argv: args.slice(dash + 1),
    ...(typeof flags.name === "string" ? { name: flags.name } : {}),
    ...(typeof flags.timeout === "string" ? { seconds: Number(flags.timeout) } : {}),
  })
}

export async function verdictCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  if (args[0] === "run") return runCmd(ctx, args)
  const { positional, flags } = parseArgs(args, ["evidence", "run", "mode"])
  const [assignment, ...rest] = positional
  // The item may be one word (`scenario:2`, `review`) or two (`scenario 2`); the verdict word ends it.
  const at = rest.findIndex(
    (word, i) => i > 0 && (VERDICT_WORDS as readonly string[]).includes(word.toLowerCase()),
  )
  if (assignment === undefined || at < 1) return err({ code: "bad_args", message: USAGE })
  const text = rest
    .slice(at + 1)
    .join(" ")
    .trim()
  const task = await requireTask(ctx)
  if (!task.ok) return task
  const recorded = await recordVerdict(ctx, task.data, {
    assignment,
    item: rest.slice(0, at).join(" "),
    verdict: rest[at] ?? "",
    text,
    ...(typeof flags.evidence === "string" ? { evidence: flags.evidence } : {}),
    ...(flags.run === undefined ? {} : { run: String(flags.run) }),
    ...(flags.mode === undefined ? {} : { mode: String(flags.mode) }),
  })
  return recorded.ok ? ok({ recorded: true, ...recorded.data }) : recorded
}

export async function attestCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const { positional, flags } = parseArgs(args, ["evidence"])
  const usage = 'usage: qualitylayer attest <item> "<what the person said>" [--evidence <file>]'
  // `attest done 8 "<words>"`: the item is the words before the last argument.
  const text = positional.length >= 2 ? (positional[positional.length - 1] ?? "") : ""
  const item = positional.slice(0, -1).join(" ")
  if (item === "" || text.trim() === "") return err({ code: "bad_args", message: usage })
  const task = await requireTask(ctx)
  if (!task.ok) return task
  return recordAttestation(ctx, task.data, {
    item,
    text,
    by: "agent",
    ...(typeof flags.evidence === "string" ? { evidence: flags.evidence } : {}),
  })
}
