// How the person chose to ship at the final approval: "Approve and open a pull request", "Approve
// only" or "Copy the git commands" (they push it themselves). Kept with the task so the agent's ship
// step knows not to ask again, and Shipped can say it. A pull request takes seconds to open, so the
// choice is written before the approval is recorded, as `opening`, and ends as `open` or `failed`:
// the agent's ship step waits for it, and a reload still finds why a pull request is missing.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import type { Task } from "../task/store.ts"

export type ShipChoice = "pull-request" | "only" | "commands"

export type PullRequestState = "opening" | "open" | "failed"

export type ShipRecord = {
  choice: ShipChoice
  /** Only for "pull-request". */
  state?: PullRequestState
  url?: string
  error?: string
  /** When the choice was written, for an opening that never finished. */
  at?: number
}

/** An opening this old was cut off (the App closed with it half done): it counts as failed. */
const OPENING_STALE_MS = 3 * 60_000

const choicePath = (task: Pick<Task, "runtimeDir">) => join(task.runtimeDir, "ship-choice.json")

const VALID_CHOICES = new Set<ShipChoice>(["pull-request", "only", "commands"])
const VALID_STATES = new Set<PullRequestState>(["opening", "open", "failed"])

function applyPullRequestFields(
  record: ShipRecord,
  parsed: Record<string, unknown>,
  now: number,
): void {
  const at = typeof parsed.at === "number" ? parsed.at : undefined
  if (typeof parsed.state === "string" && VALID_STATES.has(parsed.state as PullRequestState))
    record.state = parsed.state as PullRequestState
  if (typeof parsed.url === "string") record.url = parsed.url
  if (typeof parsed.error === "string") record.error = parsed.error
  if (at !== undefined) record.at = at
  if (record.state === "opening" && at !== undefined && now - at > OPENING_STALE_MS) {
    record.state = "failed"
    record.error = "Opening the pull request did not finish."
  }
}

export async function readShipRecord(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<ShipRecord | null> {
  try {
    const parsed = JSON.parse(await ctx.fs.readFile(choicePath(task))) as Record<string, unknown>
    if (typeof parsed.choice !== "string" || !VALID_CHOICES.has(parsed.choice as ShipChoice))
      return null
    const choice = parsed.choice as ShipChoice
    const record: ShipRecord = { choice }
    if (choice === "pull-request") applyPullRequestFields(record, parsed, ctx.clock.now())
    return record
  } catch {
    return null
  }
}

export async function writeShipRecord(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  record: ShipRecord,
): Promise<void> {
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(
    choicePath(task),
    `${JSON.stringify({ ...record, at: record.at ?? ctx.clock.now() })}\n`,
  )
}

/** A choice that was not carried through (the approval turned into changes, or was refused). */
export async function clearShipRecord(ctx: Ctx, task: Pick<Task, "runtimeDir">): Promise<void> {
  await ctx.fs.remove(choicePath(task))
}

/** The state of the pull request a "pull-request" choice asked for, with the reason it failed. */
export async function pullRequestState(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<{ state: PullRequestState; error: string | null } | null> {
  const record = await readShipRecord(ctx, task)
  if (record === null || record.choice !== "pull-request" || record.state === undefined) return null
  return { state: record.state, error: record.error ?? null }
}
