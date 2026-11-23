// The start the person copied on the Implement page, kept with the task's runtime state: the agent,
// the lead and native subagent defaults, effort and where it runs. Research and review helpers
// retain their own defaults; the build record describes the person's launch choices.

import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { NATIVE_AGENTS, type NativeAgent, validModelId } from "../agents/ids.ts"
import { AGENT_OWN } from "../agents/model-values.ts"
import { folderDoc } from "../docs/names.ts"
import type { GateFile } from "../gate/gate.ts"
import { AGENT_CAPABILITIES } from "../run/launch-spec.ts"
import { keyOf } from "../task/binding.ts"
import type { Task } from "../task/store.ts"
import {
  START_EFFORTS,
  START_WHERE,
  type StartAgent,
  type StartEffort,
  type StartRecord,
  type StartWhere,
} from "./start-values.ts"

const FILE = "start.json"
const AGENTS: readonly StartAgent[] = [...NATIVE_AGENTS, "other"]
/** A model id as the agents' flags take it: `opus`, `gpt-6.1-sol`, `session`. */

/** The levels an agent's entry lists; any level for one whose effort is part of its model id. */
const allowedEfforts = (agent: NativeAgent): readonly string[] =>
  AGENT_CAPABILITIES[agent].efforts.length > 0 ? AGENT_CAPABILITIES[agent].efforts : START_EFFORTS

const startPath = (task: Pick<Task, "runtimeDir">) => join(task.runtimeDir, FILE)

const bad = (message: string) => err({ code: "bad_args", message })

type StartBasics = {
  agent: StartAgent
  where: StartWhere
  goal: boolean
  answers?: "app" | "terminal"
}

function parseStartBasics(raw: Record<string, unknown>): Result<StartBasics> {
  const agent = raw.agent as StartAgent
  if (!AGENTS.includes(agent)) return bad(`unknown agent "${String(raw.agent)}"`)
  const where = raw.where as StartWhere
  if (!START_WHERE.includes(where)) return bad(`unknown place to start "${String(raw.where)}"`)
  if (typeof raw.goal !== "boolean") return bad("goal is true or false")
  if (raw.answers !== undefined && raw.answers !== "app" && raw.answers !== "terminal")
    return bad("answers is app or terminal")
  return ok({
    agent,
    where,
    goal: raw.goal,
    ...(raw.answers === undefined ? {} : { answers: raw.answers }),
  })
}

function parseAgentModels(
  raw: Record<string, unknown>,
  agent: StartAgent,
): Result<{ orchestrator: string | null; workers: string | null; effort: StartEffort | null }> {
  if (agent === "other") return ok({ orchestrator: null, workers: null, effort: null })
  const orchestrator = raw.orchestrator
  if (orchestrator !== AGENT_OWN && !validModelId(agent, orchestrator))
    return bad("orchestrator names a model")
  const workers = raw.workers
  if (workers !== AGENT_OWN && !validModelId(agent, workers)) return bad("workers names a model")
  if (raw.effort !== AGENT_OWN && !allowedEfforts(agent).includes(raw.effort as StartEffort))
    return bad(`unknown effort "${String(raw.effort)}"`)
  return ok({ orchestrator, workers, effort: raw.effort as StartEffort })
}

/** The record a start choice makes, or what is wrong with it. */
export function parseStart(input: unknown, at: number): Result<StartRecord> {
  if (typeof input !== "object" || input === null) return bad("a start choice is an object")
  const raw = input as Record<string, unknown>
  const basics = parseStartBasics(raw)
  if (!basics.ok) return basics
  const route = parseRoute(raw, basics.data.where)
  if (!route.ok) return route
  const models = parseAgentModels(raw, basics.data.agent)
  if (!models.ok) return models
  return ok({
    ...basics.data,
    ...models.data,
    ...route.data,
    at,
  })
}

type Route = Pick<StartRecord, "session" | "gate" | "compact">

function routeError(raw: Record<string, unknown>, where: StartWhere): string | null {
  const { session, gate, compact } = raw
  if (where !== "here") return "a planner's session is named only for a build here"
  if (typeof session !== "string" || session === "") return "session names the planner's session"
  if (typeof gate !== "string" || gate === "") return "gate names the Plan gate"
  return compact !== undefined && typeof compact !== "boolean" ? "compact is true or false" : null
}

/**
 * The planner the person chose to build in, from the App: its session key and the Plan gate the
 * choice belongs to, both or neither, and only for a build here. The App's own Build here names none.
 */
function parseRoute(raw: Record<string, unknown>, where: StartWhere): Result<Route> {
  const { session, gate, compact } = raw
  if (session === undefined && gate === undefined && compact === undefined) return ok({})
  const error = routeError(raw, where)
  if (error !== null) return bad(error)
  return ok({
    session: session as string,
    gate: gate as string,
    ...(compact === undefined ? {} : { compact: compact as boolean }),
  })
}

/** Record the start the person copied. Only an approved Plan waiting for its build takes one. */
export async function recordStart(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir" | "stage">,
  input: unknown,
): Promise<Result<StartRecord>> {
  if (task.stage !== "implement")
    return bad(`a build's start is recorded once the Plan is approved, not at "${task.stage}"`)
  const parsed = parseStart(input, ctx.clock.now())
  if (!parsed.ok) return parsed
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(startPath(task), `${JSON.stringify(parsed.data, null, 2)}\n`)
  return parsed
}

/**
 * Record the person's choice to build in the planner's own session, before the App approves the Plan:
 * the waiting planner sees the approval only after its route exists. A route names its session and
 * gate; `next` honours it only for that session and that gate, so one left by a failed approval
 * starts nothing.
 */
export async function recordRoute(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  input: unknown,
): Promise<Result<StartRecord>> {
  const parsed = parseStart(input, ctx.clock.now())
  if (!parsed.ok) return parsed
  if (parsed.data.session === undefined) return bad("a route names the planner's session")
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(startPath(task), `${JSON.stringify(parsed.data, null, 2)}\n`)
  return parsed
}

/**
 * Remove the route a Build in that session click wrote for `gate` when that approval did not land,
 * so a later approval of the same gate by another way does not hand the build to the planner.
 */
export async function dropRoute(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  gate: string,
): Promise<void> {
  const recorded = await readStart(ctx, task)
  if (recorded?.gate === gate) await ctx.fs.remove(startPath(task))
}

/** The start recorded for this task; null when none was, or the file does not read. */
export async function readStart(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<StartRecord | null> {
  const path = startPath(task)
  if (!(await ctx.fs.exists(path))) return null
  try {
    const raw = JSON.parse(await ctx.fs.readFile(path)) as { at?: unknown }
    const parsed = parseStart(raw, typeof raw.at === "number" ? raw.at : 0)
    return parsed.ok ? parsed.data : null
  } catch {
    return null
  }
}

function isApprovedPlanGateForSession(gate: GateFile, session: string): boolean {
  if (gate.target !== folderDoc("plan") || gate.decision !== "approved") return false
  if (gate.settled !== true || !gate.session) return false
  return keyOf(gate.session) === session
}

/** The App's existing choice belongs only to its approved Plan and the waiting planner. */
export function matchingStartRoute(
  start: StartRecord | null,
  gate: GateFile | null,
  session: string | null,
): StartRecord | null {
  if (start === null || gate === null || session === null) return null
  if (start.where !== "here" || start.session !== session || start.gate !== gate.id) return null
  return isApprovedPlanGateForSession(gate, session) ? start : null
}
