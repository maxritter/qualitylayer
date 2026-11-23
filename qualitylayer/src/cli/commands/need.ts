// need "<what and why>" --for T<n> [--kind …] [--check <ENV_VAR or file>] [--step "<text>"]…
// need resolved T<n> · need reopen T<n> "<why>" · need list
// Thin parsing over core/need: a need of the build, recorded without stopping anything.

import {
  markReopened,
  markResolved,
  NEED_KINDS,
  readNeeds,
  recordNeed,
  terminalNeed,
} from "../../core/need/need.ts"
import { autonomousNow } from "../../core/review/in-review.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { requireTask } from "./shared.ts"

const USAGE = `usage: qualitylayer need "<what is needed. Why the agent cannot do it>" --for T<n> [--kind ${NEED_KINDS.join("|")}] [--check <ENV_VAR or file>] [--step "<one step for the person>"] · need resolved T<n> (after verifying the prerequisite) · need reopen T<n> "<what you did not find>" · need list`

/** `--name value`, repeatable for `--step`; the rest are the words. */
function parse(args: string[]): { words: string[]; flags: Record<string, string[]> } {
  const words: string[] = []
  const flags: Record<string, string[]> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    if (arg.startsWith("--") && args[i + 1] !== undefined) {
      const name = arg.slice(2)
      flags[name] = [...(flags[name] ?? []), args[i + 1] as string]
      i++
    } else words.push(arg)
  }
  return { words, flags }
}

type LoadedTask = Awaited<ReturnType<typeof requireTask>> extends Result<infer T> ? T : never

async function needResolved(ctx: Ctx, task: LoadedTask, target: string): Promise<Result<unknown>> {
  const done = await markResolved(ctx, task, target)
  if (!done.ok) return done
  return ok({
    need: done.data.for,
    state: "resolved",
    instructions: `Availability recorded for ${done.data.for}; keep the prerequisite's verification evidence. This command runs no check and grants no permission or approval. Run \`qualitylayer next\`.`,
  })
}

async function needReopen(ctx: Ctx, task: LoadedTask, rest: string[]): Promise<Result<unknown>> {
  const [word, ...why] = rest
  const back = await markReopened(ctx, task, word ?? "", why.join(" "))
  if (!back.ok) return back
  const autonomous = await autonomousNow(ctx, task)
  if (task.answers === "terminal" && !autonomous) {
    const chat = await terminalNeed(ctx, task, back.data, true)
    return chat.ok ? ok({ need: back.data.for, state: "open", ...chat.data }) : chat
  }
  return ok({
    need: back.data.for,
    state: "open",
    ...(autonomous ? { deferred_until: "verify" } : { wait: "qualitylayer wait" }),
    instructions: autonomous
      ? `Recorded as unverified for the person's review in Verify. Continue available work with \`qualitylayer next\`; ${back.data.for} remains unresolved.`
      : `Open again; the App says what you did not find.`,
  })
}

async function needRecord(ctx: Ctx, task: LoadedTask, args: string[]): Promise<Result<unknown>> {
  const { words, flags } = parse(args)
  const recorded = await recordNeed(ctx, task, {
    words: words.join(" "),
    for: flags.for?.[0] ?? "",
    ...(flags.kind?.[0] !== undefined ? { kind: flags.kind[0] } : {}),
    ...(flags.check?.[0] !== undefined ? { check: flags.check[0] } : {}),
    ...(flags.step !== undefined ? { steps: flags.step } : {}),
  })
  if (!recorded.ok) return recorded
  const need = recorded.data
  const autonomous = await autonomousNow(ctx, task)
  if (task.answers === "terminal" && !autonomous) {
    const chat = await terminalNeed(ctx, task, need)
    return chat.ok ? ok({ need: need.for, state: need.state, ...chat.data }) : chat
  }
  return ok({
    need: need.for,
    ...(autonomous ? { deferred_until: "verify" } : { wait: "qualitylayer wait" }),
    state: need.state,
    ...(need.place !== null ? { place: need.place } : {}),
    instructions: autonomous
      ? `Recorded as unverified for the person's review in Verify. \`qualitylayer next\` continues available work without asking the person; ${need.for} remains unresolved. Never ask for a secret value or print it.`
      : `Recorded. The App asks the person. Never ask for a secret value or print it. Their answer reaches you with a later reply; build everything else meanwhile.`,
  })
}

function dispatchNeed(
  ctx: Ctx,
  task: LoadedTask,
  sub: string,
  rest: string[],
  args: string[],
): Promise<Result<unknown>> {
  if (sub === "list") return readNeeds(ctx, task).then((needs) => ok({ needs }))
  if (sub === "resolved") return needResolved(ctx, task, rest[0] ?? "")
  if (sub === "reopen") return needReopen(ctx, task, rest)
  return needRecord(ctx, task, args)
}

export async function needCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const [sub, ...rest] = args
  if (sub === undefined || sub === "help") return err({ code: "bad_args", message: USAGE })
  const task = await requireTask(ctx)
  if (!task.ok) return task
  return dispatchNeed(ctx, task.data, sub, rest, args)
}
