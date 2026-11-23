// The launcher's note. An agent's hook (`qualitylayer hook ...`) that finds the App's command line
// missing or blocked leaves the agent in peace: the launcher (app/launcher) exits 0 in silence and
// writes `launcher-problem.json` here, at most once a day. `doctor` shows the note, and an install
// (the repair) clears it.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"

export type LauncherProblem = {
  /** Days since the Unix epoch (UTC) of the day it was written. */
  day: number
  /** When, in Unix seconds. */
  at: number
  reason: string
  path: string
  call: string
}

const file = (ctx: Ctx) => join(ctx.home, "launcher-problem.json")

function isLauncherProblem(note: Partial<LauncherProblem> | null): note is LauncherProblem {
  if (!note || typeof note.day !== "number" || typeof note.at !== "number") return false
  return (
    typeof note.reason === "string" &&
    typeof note.path === "string" &&
    typeof note.call === "string"
  )
}

export async function readLauncherProblem(ctx: Ctx): Promise<LauncherProblem | null> {
  try {
    const note = JSON.parse(await ctx.fs.readFile(file(ctx))) as Partial<LauncherProblem> | null
    if (!isLauncherProblem(note)) return null
    return { day: note.day, at: note.at, reason: note.reason, path: note.path, call: note.call }
  } catch {
    return null
  }
}

export async function clearLauncherProblem(ctx: Ctx): Promise<void> {
  await ctx.fs.remove(file(ctx))
}

export function launcherProblemText(note: LauncherProblem): string {
  const date = new Date(note.at * 1000).toISOString().slice(0, 10)
  return [
    `On ${date} a hook from your agent could not reach QualityLayer: ${note.reason}${note.path !== "" ? ` (${note.path})` : ""}.`,
    "The hooks stay silent meanwhile, so your agent shows no error. Open the App once to repair this.",
  ].join(" ")
}
