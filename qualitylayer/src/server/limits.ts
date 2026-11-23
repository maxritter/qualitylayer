// `GET /api/limits`: every agent's plan limits (core/limits) with the resumes planned for builds
// that stopped on one, `POST /api/limits/resume/cancel` for the person to cancel one on its task,
// and `GET /api/usage` (usage.ts). The existing visible App/tray clocks share a five-minute automatic
// quota source; explicit refresh keeps its one-minute floor and Claude turns refresh old readings.
// A plain read answers from the committed shared snapshot without starting another report.

import type { NativeAgent } from "../core/agents/ids.ts"
import { readConfig } from "../core/config.ts"
import { forgetReached } from "../core/limits/claude.ts"
import {
  type AgentLimits,
  agentLimits,
  type LimitSources,
  limitSources,
  readLimits,
  tightestLeft,
} from "../core/limits/index.ts"
import type { LimitResume } from "../core/limits/resume.ts"
import { readRun } from "../core/run/registry.ts"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import { markUsageDirty, readUsage } from "./usage.ts"
import {
  readUsageDisplay,
  readUsageLimits,
  rememberUsageLimits,
  subscribeUsageLimits,
} from "./usage-display.ts"
import type { Hub } from "./watch.ts"

export type PlannedResume = {
  run: string
  task: string | null
  agent: string
  window: string | null
  resetsAt: number
  resumeAt: number
}

/** A task's run that stands stopped on its agent's plan limit: not running, whatever its spinner says. */
export type StoppedRun = {
  run: string
  task: string | null
  agent: string
  window: string | null
  /** When the plan resets, when the agent said; null otherwise. */
  resetsAt: number | null
  /** When the agent is told to go on; null when nothing is planned (off in Settings, or no reset time). */
  resumeAt: number | null
  /** When it stopped, when the record says. */
  at: number | null
}

export type LimitsPayload = {
  limits: AgentLimits[]
  /** Builds that stopped on a plan limit and will be told to go on, each with when. */
  resumes: PlannedResume[]
  /** Every build that stands stopped on a plan limit now, resume planned or not. */
  stopped: StoppedRun[]
  /** Whether Settings allows resuming at all. */
  resumeAfterReset: boolean
}

/** Kept for the life of the server: each agent's own limits command is asked at most every five minutes. */
const sources: LimitSources = limitSources()

export async function limitsPayload(
  ctx: Ctx,
  resume: LimitResume,
  given: LimitSources = sources,
  refresh = false,
  automatic = false,
): Promise<Result<LimitsPayload>> {
  const [limits, config] = await Promise.all([
    readUsageLimits(ctx, given, refresh, automatic),
    readConfig(ctx),
  ])
  return ok({
    limits,
    resumes: resume.scheduled().map((entry) => ({
      run: entry.run,
      task: entry.task,
      agent: entry.agent,
      window: entry.window,
      resetsAt: entry.resetsAt ?? 0,
      resumeAt: entry.resumeAt ?? 0,
    })),
    stopped: resume.stopped().map((entry) => ({
      run: entry.run,
      task: entry.task,
      agent: entry.agent,
      window: entry.window,
      resetsAt: entry.resetsAt,
      resumeAt: entry.resumeAt,
      at: entry.stoppedAt ?? null,
    })),
    resumeAfterReset: config.limits.resumeAfterReset,
  })
}

/**
 * The percent left in the agent's tightest plan window, or null when it reports no figure. What
 * decides whether waking an agent is worth a turn on the person's plan.
 */
export async function tightestLeftFor(ctx: Ctx, agent: NativeAgent): Promise<number | null> {
  return tightestLeft((await agentLimits(ctx, agent, sources)).windows)
}

/** Cancel the resume planned for a run. */
export async function cancelResume(
  resume: LimitResume,
  input: Record<string, unknown>,
): Promise<Result<{ cancelled: boolean }>> {
  if (typeof input.run !== "string" || input.run === "")
    return err({ code: "bad_args", message: "run must name a run" })
  try {
    return ok({ cancelled: await resume.cancel(input.run) })
  } catch {
    return err({ code: "bad_args", message: "run must name a run" })
  }
}

function reply(result: Result<unknown>): Response {
  const headers = { "cache-control": "no-store" }
  return result.ok
    ? Response.json({ ok: true, ...(result.data as object) }, { headers })
    : Response.json(
        { ok: false, error: result.error },
        { status: result.error.code === "bad_args" ? 400 : 500, headers },
      )
}

const MAX_BODY_BYTES = 4096

async function inputOf(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return {}
  try {
    const value: unknown = await request.json()
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

async function limitsReadRoute(ctx: Ctx, url: URL, resume: LimitResume): Promise<Response | null> {
  if (url.pathname === "/api/usage/display") {
    return reply(
      ok(
        await readUsageDisplay(
          ctx,
          sources,
          url.searchParams.get("refresh") === "1",
          url.searchParams.get("menu") === "1",
        ),
      ),
    )
  }
  if (url.pathname === "/api/limits") {
    return reply(
      await limitsPayload(
        ctx,
        resume,
        sources,
        url.searchParams.get("refresh") === "1",
        url.searchParams.get("refresh") === "auto" && url.searchParams.get("claude") !== "0",
      ),
    )
  }
  if (url.pathname === "/api/usage") {
    // How Claude Code is billed follows its last limits reading, read from the home: nothing is run.
    return reply(
      await readUsage(ctx, url.searchParams.get("period"), {
        claude: () => sources.claude.cached(ctx),
      }),
    )
  }
  return null
}

/**
 * The plan-limit and usage routes; null for any other request. Cancelling a resume is the person's
 * own act, so it needs a browser the App opened (`keyPaired`).
 */
export async function limitsRoute(
  ctx: Ctx,
  request: Request,
  resume: LimitResume,
  keyPaired: boolean,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (request.method === "GET") return limitsReadRoute(ctx, url, resume)
  if (url.pathname !== "/api/limits/resume/cancel" || request.method !== "POST") return null
  if (!keyPaired)
    return new Response("Only the App and browsers it opened may cancel a resume.", {
      status: 403,
    })
  return reply(await cancelResume(resume, await inputOf(request)))
}

const RUN_OF_PATH = /[\\/]runs[\\/]([^\\/]+)[\\/]/

/**
 * Hear when a run host records a finished turn. Only a Claude Code turn can have moved Claude Code's
 * limits, so only its end may ask for the report again (and only when the last reading is old: see
 * `claudeLimits`), and it looks at once for a limit that stopped the turn in Claude Code's own record.
 * Other agents' turns ask nothing. Returns what ends the listening.
 */
export function startLimitTurns(ctx: Ctx, hub: Hub, given: LimitSources = sources): () => void {
  const stopUsage = subscribeUsageLimits(ctx, (revision) =>
    hub.publishClients({ type: "usage-changed", revision }),
  )
  const stopTurns = hub.observe((event) => {
    if (event.type === "turn-recorded") markUsageDirty()
    const id =
      event.type === "turn-recorded" && event.path ? RUN_OF_PATH.exec(event.path)?.[1] : undefined
    if (id === undefined || readRun(ctx.home, id)?.agent !== "claude-code") return
    forgetReached(ctx)
    void given.claude
      .turnEnded(ctx)
      .then(async (asked) => {
        if (!asked) return
        markUsageDirty()
        rememberUsageLimits(ctx, await readLimits(ctx, given))
      })
      .catch(() => {})
  })
  return () => {
    stopTurns()
    stopUsage()
  }
}
