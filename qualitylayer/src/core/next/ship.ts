// After the final approval: the ship step (the approved description, the pull request the person
// chose), and, while the pull request is open, the author's triage of what GitHub says. Also the
// "show me" view and the copy of a task folder into the checkout that builds it.

import { join } from "node:path"
import { phaseText } from "#workflow"
import type { Ctx } from "../../ctx.ts"
import { showMeName } from "../docs/visuals.ts"
import { buildBase } from "../git/base.ts"
import { currentBranch } from "../git/repo.ts"
import { projectRuntimeDir, type RepoRef } from "../paths.ts"
import { readShipRecord } from "../ship/choice.ts"
import { shipStatePath } from "../ship/closing-record.ts"
import { pullRequestBodyFile } from "../ship/pr-body.ts"
import { commandsFor, storedUrl } from "../ship/pull-request.ts"
import { appendEvent, loadTask, type Task } from "../task/store.ts"
import { codeDiff } from "../verification.ts"
import type { NextPayload } from "./shared.ts"

export { adoptPlan } from "./plan-handoff.ts"
export { shippedPayload } from "./ship-triage.ts"

export async function showMePayload(
  ctx: Ctx,
  task: Task | null,
  topic: string,
): Promise<NextPayload> {
  const name = showMeName(topic)
  const page =
    task !== null
      ? {
          page: join(task.dir, "artifacts", `${name}.html`),
          create: `qualitylayer artifact new ${name} --purpose ${JSON.stringify(`Show me: ${topic}`)}`,
          show: `qualitylayer artifact show ${name}`,
        }
      : {}
  if (task !== null) await appendEvent(ctx, task, { event: "show_me", topic })
  return {
    ...(task !== null ? { task: task.slug, stage: task.stage } : {}),
    phase: "show-me",
    topic,
    instructions: phaseText("show-me"),
    ...page,
    done: true,
  }
}

/** Shipped tasks whose ship step was not announced yet, newest first. */
export async function waitingShips(
  ctx: Ctx,
  repo: RepoRef,
): Promise<
  { slug: string; tasksDir: string; statePath: string; state: { announced?: boolean } }[]
> {
  const tasksDir = join(projectRuntimeDir(ctx, repo.id), "tasks")
  if (!(await ctx.fs.exists(tasksDir))) return []
  const waiting = []
  for (const slug of (await ctx.fs.readdir(tasksDir)).sort().reverse()) {
    const statePath = shipStatePath({ runtimeDir: join(tasksDir, slug) })
    if (!(await ctx.fs.exists(statePath))) continue
    const state = JSON.parse(await ctx.fs.readFile(statePath)) as { announced?: boolean }
    if (state.announced !== true) waiting.push({ slug, tasksDir, statePath, state })
  }
  return waiting
}

/** How long a ship step that nothing settled is handed out again to a repeated `ship`. */
const SHIP_REPEAT_MS = 15 * 60_000

async function isUnsettledShip(
  ctx: Ctx,
  repo: RepoRef,
  tasksDir: string,
  slug: string,
): Promise<boolean> {
  const statePath = shipStatePath({ runtimeDir: join(tasksDir, slug) })
  if (!(await ctx.fs.exists(statePath))) return false
  const state = JSON.parse(await ctx.fs.readFile(statePath)) as {
    announced?: boolean
    announcedAt?: number
  }
  if (
    state.announced !== true ||
    typeof state.announcedAt !== "number" ||
    ctx.clock.now() - state.announcedAt >= SHIP_REPEAT_MS
  )
    return false
  const shipped = await loadTask(ctx, repo, slug)
  if (shipped === null) return false
  return (await readShipRecord(ctx, shipped)) === null && (await storedUrl(ctx, shipped)) === null
}

/**
 * Shipped tasks whose ship step was announced a moment ago and is not settled: no pull request is
 * open and the person's choice at the approval is not recorded. A `ship` that repeats (the first
 * reply was cut off in the agent's output) gets the step again instead of the triage.
 */
async function unsettledShips(
  ctx: Ctx,
  repo: RepoRef,
): Promise<{ slug: string; tasksDir: string }[]> {
  const tasksDir = join(projectRuntimeDir(ctx, repo.id), "tasks")
  if (!(await ctx.fs.exists(tasksDir))) return []
  const found = []
  for (const slug of (await ctx.fs.readdir(tasksDir)).sort().reverse()) {
    if (await isUnsettledShip(ctx, repo, tasksDir, slug)) found.push({ slug, tasksDir })
  }
  return found
}

/** A task that shipped but whose PR description has not been handed to the agent yet. */
export async function pendingShip(
  ctx: Ctx,
  repo: RepoRef,
  selected?: string,
): Promise<NextPayload | null> {
  for (const { slug, tasksDir, statePath, state } of await waitingShips(ctx, repo)) {
    if (selected !== undefined && selected !== slug) continue
    await ctx.fs.writeFile(
      statePath,
      `${JSON.stringify({ ...state, announced: true, announcedAt: ctx.clock.now() }, null, 2)}\n`,
    )
    return shipPayload(ctx, repo, slug, tasksDir)
  }
  // Only a `ship` that names or resolves the shipped task repeats the step; a bare one finds none.
  if (selected === undefined) return null
  for (const { slug, tasksDir } of await unsettledShips(ctx, repo)) {
    if (selected !== slug) continue
    return shipPayload(ctx, repo, slug, tasksDir)
  }
  return null
}

async function shipPayload(
  ctx: Ctx,
  repo: RepoRef,
  slug: string,
  tasksDir: string,
): Promise<NextPayload> {
  const shipped = await loadTask(ctx, repo, slug)
  const descriptionFile =
    shipped !== null
      ? await pullRequestBodyFile(ctx, shipped)
      : join(tasksDir, slug, "pr-description.md")
  const description = (await ctx.fs.exists(descriptionFile))
    ? await ctx.fs.readFile(descriptionFile)
    : ""
  const since = shipped !== null ? await buildBase(ctx, shipped) : null
  return {
    task: slug,
    phase: "ship",
    done: true,
    instructions: phaseText("ship"),
    description,
    description_file: descriptionFile,
    ...(since !== null ? { diff: codeDiff(`${since}..HEAD`) } : {}),
    ...(shipped !== null ? await shipChoiceFields(ctx, shipped) : {}),
  }
}

/** How long the ship step waits for the App to finish opening the pull request it was asked for. */
const PULL_REQUEST_WAIT_MS = 45_000

const PULL_REQUEST_POLL_MS = 250

/**
 * What the person chose at the final approval in the App: the pull request is open (its address) or
 * could not be opened (the reason and the commands to run by hand), they chose Approve only, or they
 * push it themselves. The App writes the choice before it records the approval and opens the pull
 * request after, so a ship step that arrives first waits for the outcome instead of offering it.
 */
async function shipChoiceFields(ctx: Ctx, task: Task): Promise<Record<string, unknown>> {
  let record = await readShipRecord(ctx, task)
  const until = ctx.clock.now() + PULL_REQUEST_WAIT_MS
  while (record?.state === "opening" && ctx.clock.now() < until) {
    await ctx.clock.sleep(PULL_REQUEST_POLL_MS)
    record = await readShipRecord(ctx, task)
  }
  const url = (await storedUrl(ctx, task)) ?? record?.url ?? null
  if (
    record?.choice === "pull-request" &&
    url === null &&
    (record.state === "failed" || record.state === "opening")
  ) {
    const branch = await currentBranch(ctx, task.repoRoot)
    return {
      ship_choice: record.choice,
      pull_request_error:
        record.state === "failed"
          ? (record.error ?? "The pull request could not be opened.")
          : "Opening the pull request did not finish.",
      ...(branch !== null ? { pull_request_commands: await commandsFor(ctx, task, branch) } : {}),
    }
  }
  return {
    ...(record !== null ? { ship_choice: record.choice } : {}),
    ...(url !== null ? { pull_request: url } : {}),
  }
}
