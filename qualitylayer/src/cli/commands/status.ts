// `qualitylayer status --json`: the open task's step, gate, build progress, quality pass, helpers
// and second opinion, for the Claude Code mod to draw; `--board`, every other task's row. It reads
// only, and makes one git call.

import { realpathSync } from "node:fs"
import { moveStateOf } from "../../core/next/compass.ts"
import { movesOf } from "../../core/next/moves.ts"
import { readBoard } from "../../core/status/board.ts"
import { probeCheckout, statusFor } from "../../core/status/report.ts"
import { loadTask, resolveTask } from "../../core/task/store.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"

/**
 * `--board [--except <task>]`: every other task's row for the mod, read on its own slower clock so
 * the band's own report stays quick.
 */
async function boardCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const except = args.indexOf("--except")
  const task = except === -1 ? undefined : args[except + 1]
  if (except !== -1 && (task === undefined || task.startsWith("--")))
    return err({
      code: "bad_args",
      message: "usage: qualitylayer status --board [--except <task>]",
    })
  try {
    return ok({ board: await readBoard(ctx, task) })
  } catch (cause) {
    return err({
      code: "bad_args",
      message: `the board could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    })
  }
}

async function readCheckoutStatus(ctx: Ctx, session: string): Promise<Result<unknown>> {
  // The repository id hashes a real path; the mod may run in a directory reached through a symlink.
  const checkout = probeCheckout(realpathSync(ctx.env.cwd()))
  const selected = ctx.invocationTask && checkout ? await resolveTask(ctx, checkout.repo) : null
  if (ctx.invocationTask && selected === null)
    return err({
      code: "no_task",
      message: `Task ${JSON.stringify(ctx.invocationTask)} was not found in this checkout.`,
    })
  const report =
    checkout !== null
      ? await statusFor(ctx, checkout, session.trim(), {
          boundOnly: session !== "",
          ...(selected ? { task: selected } : {}),
        })
      : null
  if (report === null || checkout === null) return ok({ task: null })
  // The same moves `next` lists, from the one table, so the two can never disagree.
  const task = selected ?? (await loadTask(ctx, checkout.repo, report.task.slug))
  const moves = task === null ? [] : movesOf((await moveStateOf(ctx, task)).state)
  return ok({ ...report, moves })
}

/**
 * No open task is `{ ok: true, task: null }`; anything that goes wrong is an error envelope, which the
 * mod draws as a failure. `--session <id>` (the mod passes its Claude Code session's id) reports only
 * the task that session works on: a session that never ran QualityLayer sees none.
 */
export async function statusCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  if (args.includes("--board")) return boardCmd(ctx, args)
  const at = args.indexOf("--session")
  const session = at === -1 ? "" : (args[at + 1] ?? "")
  if (at !== -1 && session.trim() === "") {
    return err({ code: "bad_args", message: "usage: qualitylayer status [--session <id>]" })
  }
  try {
    return await readCheckoutStatus(ctx, session)
  } catch (cause) {
    return err({
      code: "bad_args",
      message: `status could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    })
  }
}
