// Claude Code's plan limits as its own `/usage` command gives them. Claude Code hands its limits to a
// status line only, which QualityLayer never touches. Run headless (`claude -p "/usage"`) the command
// answers without a model turn and without a cost, with each limit as data: its kind, percent and
// reset time. This runs it for one answer, in the way that costs a person nothing: no hooks, no
// session kept, a folder of QualityLayer's own.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { agentBinary, configuredBinary } from "../agents/binary.ts"
import { findAgentBinary, PASSED } from "../install/agents-found.ts"
import { pickEnv } from "../platform.ts"
import { runBounded } from "./bounded-run.ts"
import {
  type LimitCause,
  type ReportedWindow,
  usedShare,
  WEEK_MINUTES,
  windowLabel,
} from "./window.ts"

type Json = Record<string, unknown>
const record = (value: unknown): Json | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null

/** `claude -p "/usage"` gives its limits as data: how a limit's kind is named and how long it lasts. */
const KINDS: Record<string, { minutes: number; label: string }> = {
  session: { minutes: 300, label: windowLabel(300) },
  weekly_all: { minutes: WEEK_MINUTES, label: windowLabel(WEEK_MINUTES) },
}

/** The older cache reason that treated an empty report as an account with no plan. */
export const CLAUDE_UNREPORTED = "Claude Code doesn't report limits for this sign-in"
/**
 * Why Claude Code has no plan limits on an API key. It has no plan to limit, so its `/usage` prints
 * the session cost summary and no report.
 */
export const CLAUDE_NO_PLAN = "Claude Code is signed in with an API key, which has no plan limits"
/** Why nothing is known when the command could not be run or answered nothing usable. */
export const CLAUDE_UNANSWERED = "Claude Code didn't answer its /usage command"

export type ClaudeReport =
  | { at: number; windows: ReportedWindow[] }
  | { reason: string; cause: LimitCause }

const unanswered = (): ClaudeReport => ({ reason: CLAUDE_UNANSWERED, cause: "failed" })
const noPlan = (reason: string): ClaudeReport => ({ reason, cause: "no-plan" })

/** A held answer that says there is no plan to limit; it stays true until the sign-in changes. */
const holdsNoPlan = (report: ClaudeReport | undefined): boolean =>
  report !== undefined && "cause" in report && report.cause === "no-plan"

function windowOfLimit(limit: Json): ReportedWindow | null {
  const scope = record(record(record(limit.scope)?.model))
  const named =
    limit.kind === "weekly_scoped" && typeof scope?.display_name === "string"
      ? { minutes: WEEK_MINUTES, label: `${windowLabel(WEEK_MINUTES)} · ${scope.display_name}` }
      : KINDS[String(limit.kind)]
  const used = usedShare(limit.percent)
  if (named === undefined || used === null) return null
  const resets = typeof limit.resets_at === "string" ? Date.parse(limit.resets_at) : Number.NaN
  return {
    minutes: named.minutes,
    label: named.label,
    usedPercent: used,
    resetsAt: Number.isNaN(resets) ? null : resets,
  }
}

/** The report one output line carries; null for a line that is not one. */
function reportOf(line: string): Json | null {
  if (!line.includes('"usage_report"')) return null
  try {
    return record(record(JSON.parse(line))?.usage_report)
  } catch {
    return null
  }
}

/**
 * Whether a line is the answer of `/usage` for a sign-in with no plan: the command's own result row,
 * which holds the session cost summary where a plan would have a report. Anything else is not.
 */
function costSummary(line: string): boolean {
  if (!line.includes('"local_command"')) return false
  try {
    const row = record(JSON.parse(line))
    if (row?.type !== "result" || row.local_command !== "usage" || row.is_error === true)
      return false
    return typeof row.result === "string" && row.result.startsWith("Total cost:")
  } catch {
    return false
  }
}

/** The report in the command's stream-json output: its limits, or why it has none. */
export function parseUsageReport(text: string, at: number): ClaudeReport {
  const lines = text.split("\n")
  for (const line of lines) {
    const report = reportOf(line)
    if (report === null) continue
    const limits = record(report.rate_limits)?.limits
    const windows = (Array.isArray(limits) ? limits : [])
      .map((entry) => windowOfLimit(record(entry) ?? {}))
      .filter((window): window is ReportedWindow => window !== null)
    return windows.length === 0 ? unanswered() : { at, windows }
  }
  return lines.some(costSummary) ? noPlan(CLAUDE_NO_PLAN) : unanswered()
}

/**
 * What the command is given: print mode, the report as data, no settings but the project's own (the
 * folder is empty, so none: no hooks of the person's or a plugin's fire) and no session kept on disk.
 */
export const CLAUDE_USAGE_ARGS = [
  "-p",
  "/usage",
  "--output-format",
  "stream-json",
  "--verbose",
  "--setting-sources",
  "local",
  "--no-session-persistence",
]
export const CLAUDE_USAGE_TIMEOUT_MS = 20_000
/** An explicit ask runs the command at most this often, however many readers ask. */
export const CLAUDE_REFRESH_MIN_MS = 60_000
export const CLAUDE_VISIBLE_REFRESH_MS = 5 * 60_000
/** At the end of a Claude Code turn the report is asked for again once it is this old... */
export const CLAUDE_STALE_MS = 30 * 60_000
/** ...or this old when the last reading had a window this far used up. */
export const CLAUDE_STALE_BUSY_MS = 10 * 60_000
export const CLAUDE_BUSY_PERCENT = 80
/** Why nothing is known yet: the report was never read on this computer. */
export const CLAUDE_NOT_READ = "Claude Code's limits have not been read yet"

/** What Claude Code signs in with instead of a plan when it is set. */
const KEY_VARIABLES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]

/** Run the command and read its report; `timeoutMs` is for a test that does not wait twenty seconds. */
export async function askClaude(
  ctx: Ctx,
  timeoutMs: number = CLAUDE_USAGE_TIMEOUT_MS,
): Promise<ClaudeReport> {
  // A command the person set in Settings that cannot run is not searched past.
  const executable =
    (await agentBinary(ctx, "claude-code")) ??
    ((await configuredBinary(ctx, "claude-code")) === ""
      ? await findAgentBinary(ctx, "claude-code")
      : null)
  // An empty folder of QualityLayer's own, never a project: Claude Code notes each folder it runs in.
  const cwd = join(ctx.home, "limits", "claude-usage")
  if (executable === null) return unanswered()
  // An API key in the environment is the sign-in: it has no plan, so there is nothing to run.
  if (KEY_VARIABLES.some((name) => (ctx.env.get(name) ?? "") !== "")) return noPlan(CLAUDE_NO_PLAN)
  await ctx.fs.mkdir(cwd)
  const configDir = ctx.env.get("CLAUDE_CONFIG_DIR")
  const env = {
    ...pickEnv(ctx.env, PASSED),
    ...(configDir === undefined ? {} : { CLAUDE_CONFIG_DIR: configDir }),
  }
  const output = await runBounded(executable, CLAUDE_USAGE_ARGS, {
    cwd,
    env,
    timeoutMs,
  })
  return output === null || output.code !== 0
    ? unanswered()
    : parseUsageReport(output.stdout, ctx.clock.now())
}

/** The report as it was last read, and when: what the sidebar shows between asks. */
export type Reading = { at: number; report: ClaudeReport }

const CAUSES: readonly string[] = ["unreported", "no-plan", "failed", "not-read"]
const readingFile = (ctx: Ctx) => join(ctx.home, "limits", "claude-reading.json")

async function readStored(ctx: Ctx): Promise<Reading | null> {
  try {
    const value = record(JSON.parse(await ctx.fs.readFile(readingFile(ctx))))
    const report = record(value?.report)
    if (typeof value?.at !== "number" || report === null) return null
    if (report.cause === "no-plan" && report.reason === CLAUDE_UNREPORTED)
      Object.assign(report, unanswered())
    if (typeof report.reason === "string")
      return CAUSES.includes(report.cause as LimitCause)
        ? { at: value.at, report: { reason: report.reason, cause: report.cause as LimitCause } }
        : null
    if (typeof report.at !== "number" || !Array.isArray(report.windows)) return null
    return { at: value.at, report: report as unknown as ClaudeReport }
  } catch {
    return null
  }
}

async function persist(ctx: Ctx, reading: Reading): Promise<void> {
  try {
    await ctx.fs.mkdir(join(ctx.home, "limits"))
    await ctx.fs.atomicWrite(readingFile(ctx), JSON.stringify(reading))
  } catch {
    // The reading is kept in memory all the same; a restart then asks again.
  }
}

const used = (reading: Reading): boolean =>
  "windows" in reading.report &&
  reading.report.windows.some((window) => window.usedPercent >= CLAUDE_BUSY_PERCENT)

/**
 * A reading old enough for the end of a turn to ask again: 30 minutes, 10 when a window is nearly used
 * up. A sign-in with no plan has nothing that a turn moves, so a turn never asks again.
 */
export const staleAfterTurn = (reading: Reading | null, now: number): boolean =>
  reading === null ||
  (!holdsNoPlan(reading.report) &&
    now - reading.at >= (used(reading) ? CLAUDE_STALE_BUSY_MS : CLAUDE_STALE_MS))

/**
 * Claude Code's report under one policy, because asking costs a whole Claude Code process.
 * `cached` is the last reading, kept in the QualityLayer home so it
 * survives a restart. `refresh` is the person's explicit ask: it runs the command, but not within a
 * minute of the last run, and asked together it runs once. `turnEnded` is the background ask, for the
 * end of a Claude Code turn only, and only when the reading is old enough. A visible selected quota
 * consumer shares `automatic`: five minutes between attempts, with known no-plan readings skipped.
 */
export type ClaudeLimits = {
  cached(ctx: Ctx): Promise<ClaudeReport | null>
  refresh(ctx: Ctx): Promise<ClaudeReport>
  /** Whether the end of a turn asked. */
  turnEnded(ctx: Ctx): Promise<boolean>
  /** A visible quota consumer; separate from cost/index invalidation and manual refresh. */
  automatic?(ctx: Ctx): Promise<boolean>
}

/** The reading a run of the command makes; the one held stays when the run could not answer. */
async function runCommand(
  ctx: Ctx,
  ask: (ctx: Ctx) => Promise<ClaudeReport>,
  before: Reading | null,
): Promise<Reading | null> {
  const report = await ask(ctx).catch(unanswered)
  const failed = "cause" in report && report.cause === "failed"
  return failed && before !== null ? null : { at: ctx.clock.now(), report }
}

class KeptClaudeLimits implements ClaudeLimits {
  private held: Reading | null | undefined
  private pending: Promise<ClaudeReport> | null = null
  private lastRun = Number.NEGATIVE_INFINITY

  constructor(private readonly ask: (ctx: Ctx) => Promise<ClaudeReport>) {}

  private async load(ctx: Ctx): Promise<Reading | null> {
    if (this.held === undefined) this.held = await readStored(ctx)
    return this.held
  }

  private async run(ctx: Ctx): Promise<ClaudeReport> {
    const before = await this.load(ctx)
    const now = ctx.clock.now()
    const since = Math.max(this.lastRun, before?.at ?? Number.NEGATIVE_INFINITY)
    // A sign-in with no plan is asked again no sooner than the end of a turn would ask, in case it changed.
    const wait = holdsNoPlan(before?.report) ? CLAUDE_STALE_MS : CLAUDE_REFRESH_MIN_MS
    if (now - since >= wait) {
      this.lastRun = now
      const made = await runCommand(ctx, this.ask, before)
      if (made !== null) {
        this.held = made
        await persist(ctx, made)
      }
    }
    return this.held?.report ?? unanswered()
  }

  async cached(ctx: Ctx): Promise<ClaudeReport | null> {
    return (await this.load(ctx))?.report ?? null
  }

  refresh(ctx: Ctx): Promise<ClaudeReport> {
    this.pending ??= this.run(ctx).finally(() => {
      this.pending = null
    })
    return this.pending
  }

  async turnEnded(ctx: Ctx): Promise<boolean> {
    const asking = staleAfterTurn(await this.load(ctx), ctx.clock.now())
    if (asking) await this.refresh(ctx)
    return asking
  }

  async automatic(ctx: Ctx): Promise<boolean> {
    const before = await this.load(ctx)
    if (holdsNoPlan(before?.report)) return false
    const since = Math.max(this.lastRun, before?.at ?? Number.NEGATIVE_INFINITY)
    if (ctx.clock.now() - since < CLAUDE_VISIBLE_REFRESH_MS) return false
    await this.refresh(ctx)
    return true
  }
}

export const claudeLimits = (ask: (ctx: Ctx) => Promise<ClaudeReport> = askClaude): ClaudeLimits =>
  new KeptClaudeLimits(ask)
