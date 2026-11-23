// progress "<line>" [--for T<n>] [--agent <id>]: one line on what is being done. The build's own line
// (with the card it is on, `--for`), or a helper's (`--agent`); `progress done --agent <id>` says the
// helper is over, so the App stops showing it as running.

import { reportBuild, reportProgress } from "../../core/helpers.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { parseArgs, requireTask } from "./shared.ts"

const USAGE = 'usage: qualitylayer progress "<line>" [--for T<n>] [--agent <id>]'

async function reportHelperProgress(
  ctx: Ctx,
  agent: string,
  line: string,
  forFlag: string | true | undefined,
): Promise<Result<unknown>> {
  if (typeof forFlag === "string")
    return err({
      code: "bad_args",
      message: `--for names the build's card; a helper's line takes --agent alone. ${USAGE}`,
    })
  if (!(await reportProgress(ctx, agent, line)))
    return err({ code: "bad_args", message: `no running agent is called ${agent}` })
  return ok({ recorded: true, agent })
}

export async function progressCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const { positional, flags } = parseArgs(args, ["for", "agent"])
  const line = positional.join(" ").trim()
  if (line === "" || flags.for === true || flags.agent === true)
    return err({ code: "bad_args", message: USAGE })
  if (typeof flags.agent === "string")
    return reportHelperProgress(ctx, flags.agent, line, flags.for)
  const task = await requireTask(ctx)
  if (!task.ok) return task
  const recorded = await reportBuild(ctx, task.data, {
    line,
    ...(typeof flags.for === "string" ? { task: flags.for } : {}),
  })
  return ok({
    task_id: `${task.data.repoId}~${task.data.slug}`,
    step: task.data.stage,
    card: recorded.task,
    recorded,
  })
}
