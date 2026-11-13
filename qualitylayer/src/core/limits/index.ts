// Plan limits per agent, from where each agent reports them. `agents.json` names the source in each
// agent's `limits` capability (`usage-command`, `session-record`, or null for an agent that reports
// nothing), so no agent is named here. Every answer says where it came from and when; an agent that
// reports nothing says why. Nothing here polls: it reads when something asks.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { agentBinary, configuredBinary } from "../agents/binary.ts"
import { AGENT_NAMES, NATIVE_AGENTS, type NativeAgent } from "../agents/ids.ts"
import { roots } from "../install/agent-settings.ts"
import { findAgentBinary, PASSED } from "../install/agents-found.ts"
import { pickEnv } from "../platform.ts"
import { AGENT_CAPABILITIES } from "../run/launch-spec.ts"
import { claudeReached } from "./claude.ts"
import { CLAUDE_NOT_READ, type ClaudeLimits, claudeLimits } from "./claude-usage.ts"
import { accountReading, type CodexReading } from "./codex.ts"
import { readAccountRateLimits } from "./codex-app-server.ts"
import { latestRecordReading } from "./codex-record.ts"
import { latestCopilotReading } from "./copilot-record.ts"
import { kept } from "./kept.ts"
import {
  type AgentLimits,
  type LimitCause,
  type LimitSource,
  type LimitWindow,
  shownWindow,
} from "./window.ts"

export type { AgentLimits, LimitWindow } from "./window.ts"
export { tightestLeft } from "./window.ts"

/** A reading older than this is refreshed from the account service, when one of its windows shows limits. */
export const STALE_RECORD_MS = 10 * 60_000
/** The account service is asked at most this often. */
export const ACCOUNT_CACHE_MS = 5 * 60_000

/** The account service's answer, kept for `ACCOUNT_CACHE_MS` whether it gave limits or not. */
export type AccountLimits = {
  read(ctx: Ctx): Promise<CodexReading | null>
}

async function askAccount(ctx: Ctx): Promise<unknown> {
  // A command the person set in Settings that cannot run is not searched past.
  const executable =
    (await agentBinary(ctx, "codex")) ??
    ((await configuredBinary(ctx, "codex")) === "" ? await findAgentBinary(ctx, "codex") : null)
  const codexHome = roots(ctx)?.codex
  if (executable === null || codexHome === undefined) return null
  return readAccountRateLimits(executable, { codexHome, env: pickEnv(ctx.env, PASSED) })
}

/**
 * A kept, shared answer from the account service: concurrent readers wait for one question, and a
 * failed question (no login, no program) is not asked again for five minutes either.
 */
export function accountLimits(ask: (ctx: Ctx) => Promise<unknown> = askAccount): AccountLimits {
  let source: string | null = null
  let identity: string | undefined
  const load = () => {
    let last: CodexReading | null = null
    return kept(ACCOUNT_CACHE_MS, async (ctx) => {
      const fresh = accountReading(await ask(ctx).catch(() => null), ctx.clock.now())
      last = fresh ?? last
      return last
    })
  }
  let read = load()
  return {
    async read(ctx) {
      const home = roots(ctx)?.codex ?? ""
      const key = JSON.stringify([
        ctx.home,
        home,
        await configuredBinary(ctx, "codex"),
        ctx.env.get("QUALITYLAYER_CODEX_BIN"),
      ])
      const observed = await codexIdentity(ctx, home)
      if (source !== key || (observed !== undefined && identity !== observed)) {
        read = load()
        source = key
        identity = observed
      }
      return read(ctx)
    },
  }
}

/** Account metadata bounds a held quota; unreadable auth data cannot establish an account switch. */
async function codexIdentity(ctx: Ctx, home: string): Promise<string | undefined> {
  try {
    const auth = JSON.parse(await ctx.fs.readFile(join(home, "auth.json")))
    if (!auth || typeof auth !== "object" || Array.isArray(auth)) return undefined
    if (auth.auth_mode === "apikey") return "apikey"
    const account = auth.tokens?.account_id
    return auth.auth_mode === "chatgpt" && typeof account === "string" && account !== ""
      ? JSON.stringify(["chatgpt", account])
      : undefined
  } catch {
    return undefined
  }
}

/** What reads the limits that cost a process: each is kept and asked for once at a time. */
export type LimitSources = { account: AccountLimits; claude: ClaudeLimits }

export const limitSources = (given: Partial<LimitSources> = {}): LimitSources => ({
  account: given.account ?? accountLimits(),
  claude: given.claude ?? claudeLimits(),
})

type Reading = { source: LimitSource; at: number; plan: string | null; windows: LimitWindow[] }
type Reader = (
  ctx: Ctx,
  sources: LimitSources,
  refresh: boolean,
  agent: NativeAgent,
) => Promise<Reading | { reason: string; cause: LimitCause }>

/** Copilot's allowance from the snapshots its own session records carry; nothing is run. */
async function copilotLimits(ctx: Ctx): Promise<Reading | { reason: string; cause: LimitCause }> {
  const record = await latestCopilotReading(ctx)
  if (record === null)
    return {
      reason: "No Copilot session has reported its request allowance yet.",
      cause: "not-read",
    }
  return { source: "session-record", at: record.at, plan: null, windows: record.windows }
}

/** The windows of the last report with those a refusal in Claude Code's own record says ran out: the refusal wins. */
function withReached(
  base: Reading | null,
  reached: { at: number; windows: LimitWindow[] },
): Reading {
  const out = new Set(reached.windows.map((window) => window.label))
  const kept = (base?.windows ?? []).filter((window) => !out.has(window.label))
  return {
    source: base === null ? "session-record" : "usage-command",
    at: Math.max(base?.at ?? 0, reached.at),
    plan: null,
    windows: [...kept, ...reached.windows].sort((a, b) => a.minutes - b.minutes),
  }
}

const READERS: Record<"usage-command" | "session-record", Reader> = {
  "usage-command": async (ctx, { claude }, refresh) => {
    // Only an explicit ask runs Claude Code; otherwise this is the last reading, read from disk.
    const report = refresh ? await claude.refresh(ctx) : await claude.cached(ctx)
    const now = ctx.clock.now()
    const base: Reading | null =
      report !== null && "windows" in report
        ? {
            source: "usage-command",
            at: report.at,
            plan: null,
            windows: report.windows.map((window) => shownWindow(window, now)),
          }
        : null
    // A limit Claude Code's own record shows it ran into is a limit, known for free and at once.
    const reached = await claudeReached(ctx)
    if (reached !== null) return withReached(base, reached)
    if (base !== null) return base
    return report !== null && "reason" in report
      ? report
      : { reason: CLAUDE_NOT_READ, cause: "not-read" }
  },
  "session-record": async (ctx, { account }, _refresh, agent) => {
    if (agent === "copilot") return copilotLimits(ctx)
    const record = await latestRecordReading(ctx)
    if (record === null)
      return { reason: "No Codex session has reported plan limits yet.", cause: "not-read" }
    let best: { source: LimitSource } & CodexReading = { source: "session-record", ...record }
    if (ctx.clock.now() - record.at > STALE_RECORD_MS) {
      const fresh = await account.read(ctx)
      if (fresh !== null && fresh.at > record.at) best = { source: "app-server", ...fresh }
    }
    const now = ctx.clock.now()
    return { ...best, windows: best.windows.map((window) => shownWindow(window, now)) }
  },
}

function unavailable(agent: NativeAgent, reason: string, cause: LimitCause): AgentLimits {
  return {
    agent,
    name: AGENT_NAMES[agent],
    state: "unavailable",
    cause,
    source: null,
    at: null,
    plan: null,
    windows: [],
    reason,
  }
}

/**
 * One agent's limits as they stand now. `refresh` is a person's explicit ask and may run the agent's
 * own command; without it nothing is run and the last reading is what answers.
 */
export async function agentLimits(
  ctx: Ctx,
  agent: NativeAgent,
  sources: LimitSources,
  refresh = false,
): Promise<AgentLimits> {
  const source = AGENT_CAPABILITIES[agent].limits
  if (source === null)
    return unavailable(agent, `Not reported by ${AGENT_NAMES[agent]}`, "unreported")
  const answer = await READERS[source](ctx, sources, refresh, agent)
  if ("reason" in answer) return unavailable(agent, answer.reason, answer.cause)
  const credits = (answer as { credits?: { balance: string | null } }).credits
  return {
    agent,
    name: AGENT_NAMES[agent],
    state: "reported",
    cause: null,
    source: answer.source,
    at: answer.at,
    plan: answer.plan,
    windows: answer.windows,
    reason: null,
    ...(credits === undefined ? {} : { credits }),
  }
}

/** Every agent's limits, in the catalog's order. */
export async function readLimits(
  ctx: Ctx,
  sources: LimitSources = limitSources(),
  refresh = false,
): Promise<AgentLimits[]> {
  return Promise.all(NATIVE_AGENTS.map((agent) => agentLimits(ctx, agent, sources, refresh)))
}
