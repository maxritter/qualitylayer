// Ask another reviewer, from the Review workspace. The person picks only the scope (a file or the
// whole change); QualityLayer picks an installed agent that did not build the change (the working
// agent's own vendor on its helper model when no other is installed) and it looks for everything.
// It runs detached and read-only, like the Second opinion, stops after BUDGET_MS at most, and its
// findings arrive as threads on their lines (review/findings.ts).

import { spawn } from "node:child_process"
import { closeSync, openSync } from "node:fs"
import { join } from "node:path"
import { phaseText } from "#workflow"
import type { Ctx } from "../../ctx.ts"
import type { Reviewer } from "../agents/binary.ts"
import { AGENT_NAMES, isNativeAgent } from "../agents/ids.ts"
import { modelName } from "../agents/model-values.ts"
import { otherReviewers } from "../agents/reviewer-pick.ts"
import { readConfig } from "../config.ts"
import { recordReviewCost } from "../cost/reviews.ts"
import { agentFileOf, NAMES } from "../docs/names.ts"
import { buildBase } from "../git/base.ts"
import { nativeCommand } from "../platform.ts"
import { pidAlive, selfCommand } from "../self.ts"
import { readSession, type Task } from "../task/store.ts"
import {
  agentFolders,
  brokeRule,
  installedAgents,
  reviewCommand,
  reviewerBinary,
  reviewWorkerEnv,
  runReviewer,
} from "./cross.ts"
import { answerOf, progressOf } from "./events.ts"
import {
  type AnotherRun,
  type AskedFinding,
  anchorIn,
  anotherRunsPath,
  readAnotherRuns,
} from "./findings.ts"
import { reviewerContext } from "./vendors.ts"

/** The reviewer's hard stop; tests shorten it with QUALITYLAYER_ANSWER_TIMEOUT_MS. */
const BUDGET_MS = 8 * 60_000

async function writeRuns(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  edit: (runs: AnotherRun[]) => AnotherRun[],
) {
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.withLock(`${anotherRunsPath(task)}.lock`, async () => {
    const runs = edit(await readAnotherRuns(ctx, task))
    await ctx.fs.writeFile(anotherRunsPath(task), `${JSON.stringify(runs)}\n`)
  })
}

const updateRun = (
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  id: string,
  patch: Partial<AnotherRun>,
) => writeRuns(ctx, task, (runs) => runs.map((r) => (r.id === id ? { ...r, ...patch } : r)))

/** The reviewer: an installed agent that did not build the change, else the builder's own vendor. */
export async function anotherReviewer(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<{ by: Reviewer; model: string; name: string } | null> {
  const installed = await installedAgents(ctx)
  const working = (await readSession(ctx, task))?.agent
  const config = await readConfig(ctx)
  const other = otherReviewers(
    working ?? "",
    installed,
    await reviewerContext(ctx, working ?? "unknown", task),
  )[0]
  if (other !== undefined) {
    const model = config.secondOpinion.models[other]
    return { by: other, model, name: AGENT_NAMES[other] }
  }
  const own =
    working !== undefined && isNativeAgent(working) && installed.includes(working) ? working : null
  if (own === null) return null
  const model = config.secondOpinion.models[own]
  return { by: own, model, name: modelName(own, model) }
}

/** A reviewer of this task still running: one at a time. */
export async function runningReview(ctx: Ctx, task: Pick<Task, "runtimeDir">) {
  return (await readAnotherRuns(ctx, task)).find(
    (r) => r.state === "running" && r.pid !== undefined && pidAlive(r.pid),
  )
}

/** Start one more review of `file`, or of the whole change; the run, or why none started. */
export async function startAnotherReview(
  ctx: Ctx,
  task: Task,
  file: string | null,
): Promise<{ run: AnotherRun } | { error: string }> {
  const busy = await runningReview(ctx, task)
  if (busy !== undefined) return { run: busy }
  const reviewer = await anotherReviewer(ctx, task)
  if (reviewer === null) return { error: "No agent is installed to review it." }
  const id = String(ctx.clock.now())
  const run: AnotherRun = {
    id,
    by: reviewer.name,
    model: reviewer.model,
    ...(file !== null ? { file } : {}),
    state: "running",
    started: ctx.clock.now(),
    findings: [],
  }
  await writeRuns(ctx, task, (runs) => [...runs, run])
  const [command, ...args] = selfCommand(["review", "another", "--task", task.slug, "--run", id])
  const [program, ...parameters] = nativeCommand(command as string, args)
  const log = join(task.runtimeDir, `another-${id}-startup.log`)
  await ctx.fs.writeFile(log, "", { mode: 0o600 })
  const stderr = openSync(log, "a")
  try {
    const child = spawn(program as string, parameters, {
      cwd: task.repoRoot,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", stderr, stderr],
      env: await reviewWorkerEnv(ctx, await installedAgents(ctx), { by: reviewer.by }),
    })
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve)
      child.once("error", reject)
    })
    child.unref()
    const started = { ...run, ...(child.pid !== undefined ? { pid: child.pid } : {}) }
    await updateRun(ctx, task, id, started)
    return { run: started }
  } catch (cause) {
    const reason = `${reviewer.name} could not be started`
    await updateRun(ctx, task, id, { state: "failed", ended: ctx.clock.now(), reason })
    return { error: `${reason}: ${cause instanceof Error ? cause.message : String(cause)}` }
  } finally {
    closeSync(stderr)
  }
}

/** The reviewer's reply: one `## F<n> path:line` section per finding on a line of a changed file. */
export function findingsIn(reply: string, files: readonly string[]): AskedFinding[] {
  const parts = reply.split(/^##\s+F(\d+)\s+(.+)$/m)
  const found: AskedFinding[] = []
  for (let i = 1; i + 2 < parts.length; i += 3) {
    const at = anchorIn(parts[i + 1] as string, files)
    const what = (parts[i + 2] as string).trim()
    if (at !== null && what !== "") found.push({ n: Number(parts[i]), ...at, what })
  }
  return found
}

/** The worker (`review another`): run the reviewer once and keep what it found. */
export async function runAnotherReview(
  ctx: Ctx,
  task: Task,
  id: string,
): Promise<AnotherRun | null> {
  const run = (await readAnotherRuns(ctx, task)).find((r) => r.id === id)
  if (run === undefined) return null
  await updateRun(ctx, task, id, { pid: process.pid })
  const reviewer = await anotherReviewer(ctx, task)
  const binary = reviewer !== null ? await reviewerBinary(ctx, reviewer.by) : null
  if (reviewer === null || binary === null) {
    await updateRun(ctx, task, id, {
      state: "failed",
      ended: ctx.clock.now(),
      reason:
        reviewer === null
          ? "no agent is installed to review it"
          : `${reviewer.name} is not on PATH`,
    })
    return null
  }
  const base = await buildBase(ctx, task).catch(() => null)
  const listed =
    base !== null ? await ctx.git.run(task.repoRoot, ["diff", "--name-only", base]) : null
  const files = (listed?.code === 0 ? listed.stdout : "").split("\n").filter((f) => f !== "")
  const brief = [
    phaseText("another-review") ?? "",
    `# Scope\n\n${run.file !== undefined ? `The file ${run.file}.` : "The whole change."}`,
    `# The change\n\n${base !== null ? `Measured from ${base}.` : "The base is not known."} Changed files:\n${files.map((f) => `- ${f}`).join("\n")}`,
    `# The task's documents\n\nIn ${task.dir}: ${NAMES.plan}, ${agentFileOf("implement")}.`,
  ].join("\n\n")
  const override = Number(ctx.env.get("QUALITYLAYER_ANSWER_TIMEOUT_MS"))
  const stop = Number.isFinite(override) && override > 0 ? override : BUDGET_MS
  const lastMessage = join(task.runtimeDir, `another-${id}.last`)
  let lastWrite = 0
  const outcome = await runReviewer(
    task,
    reviewCommand(reviewer.by, binary, reviewer.model, task.repoRoot, lastMessage),
    brief,
    stop,
    (raw) => {
      const line = progressOf(reviewer.by, raw)
      if (line === null || ctx.clock.now() - lastWrite < 1000) return
      lastWrite = ctx.clock.now()
      void updateRun(ctx, task, id, { line })
    },
    reviewer.by,
    await agentFolders(ctx),
  )
  await recordReviewCost(
    ctx,
    task,
    {
      point: "another",
      by: reviewer.by,
      name: reviewer.name,
      model: reviewer.model,
      started: run.started,
      ended: ctx.clock.now(),
    },
    outcome.stdout.join("\n"),
  )
  let reply = answerOf(reviewer.by, outcome.stdout)
  if (reviewer.by === "codex" && (await ctx.fs.exists(lastMessage))) {
    reply = await ctx.fs.readFile(lastMessage)
    await ctx.fs.remove(lastMessage)
  }
  const scoped = run.file !== undefined ? files.filter((f) => f === run.file) : files
  const findings =
    outcome.broke === undefined ? findingsIn(reply, scoped.length > 0 ? scoped : files) : []
  const answered = !outcome.timedOut && outcome.code === 0 && reply.trim() !== ""
  await updateRun(ctx, task, id, {
    state: answered ? "done" : "failed",
    ended: ctx.clock.now(),
    findings,
    ...(answered
      ? {}
      : {
          reason:
            brokeRule(reviewer.name, outcome) ??
            (outcome.timedOut
              ? `${reviewer.name} ran out of time after ${Math.round(stop / 60_000) || 1} min`
              : `${reviewer.name} stopped with an error`),
        }),
  })
  return (await readAnotherRuns(ctx, task)).find((r) => r.id === id) ?? null
}
