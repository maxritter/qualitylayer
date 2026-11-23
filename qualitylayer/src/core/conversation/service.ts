// Reads one run's session record a little at a time and keeps what it drew in memory, so the Conversation view
// can poll for changes: a stat when nothing changed, only the new bytes when something did. The agent's own file
// is never written; a record this cannot read gives an empty answer, never an error.
import type { Ctx } from "../../ctx.ts"
import agents from "../agents/agents.json" with { type: "json" }
import type { NativeAgent } from "../agents/ids.ts"
import type { RunRecord } from "../run/contracts.ts"
import { type AntigravityState, antigravityState, mapAntigravity } from "./antigravity.ts"
import { type ClaudeState, claudeState, mapClaude } from "./claude.ts"
import type { ClaudeSettingsScope } from "./claude-settings.ts"
import { type CodexState, codexState, mapCodex } from "./codex.ts"
import { type CopilotState, copilotState, mapCopilot } from "./copilot.ts"
import { type CursorState, cursorState, mapCursor } from "./cursor.ts"
import { type GrokState, grokState, mapGrok } from "./grok.ts"
import { locateRecord } from "./locate.ts"
import { selectNativePlan } from "./native-plan.ts"
import { readOpencode } from "./opencode.ts"
import { mapPi, piState } from "./pi.ts"
import {
  type CacheEntry,
  CONVERSATION_CACHE_BYTES,
  CONVERSATION_EVENT_BYTES,
  cachedEvents,
  clearConversationCache,
  clearWorkerConversationCache,
  continues,
  conversationCache,
  conversationCacheBytes,
  conversationCacheSize,
  cursorOf,
  freshEntry,
  IDLE_MS,
  MAX_ENTRIES,
  STOPPED_IDLE_MS,
  sequenceOf,
  sweepCaches,
} from "./service-cache.ts"
import { readDatabase, readTranscript } from "./service-read.ts"
import {
  claudeWorkers,
  derivedState,
  snapshotChecklist,
  snapshotQuestion,
  usageOf,
} from "./service-snapshot.ts"
import { readWorkerConversationWith } from "./service-worker.ts"
import {
  CONVERSATION_LIMITS,
  type ConversationEvent,
  type ConversationPart,
  type ConversationSnapshot,
  type ConversationWorker,
  type MapResult,
} from "./types.ts"

export {
  CONVERSATION_CACHE_BYTES,
  CONVERSATION_EVENT_BYTES,
  cachedEvents,
  clearConversationCache,
  clearWorkerConversationCache,
  continues,
  conversationCacheBytes,
  conversationCacheSize,
  IDLE_MS,
  MAX_ENTRIES,
  STOPPED_IDLE_MS,
}

export type NativeRun = RunRecord & { agent: NativeAgent }
export const nativeRun = (run: RunRecord): run is NativeRun => run.agent !== "other"

/** A reader for one JSONL agent: fresh state, then complete lines in and events out. */
export type JsonlMapper = {
  state(parent?: string, scope?: ClaudeSettingsScope): unknown
  map(lines: string, state: unknown, sourceOffset?: number): MapResult<unknown>
  rewrites?: true
}

export type OpencodeReader = (
  db: string,
  session: string,
  since?: number,
) => ReturnType<typeof readOpencode>

/** The agents' readers; tests hand in fakes. */
export type ConversationDeps = {
  jsonl: Record<Exclude<NativeAgent, "opencode">, JsonlMapper>
  opencode: OpencodeReader
}

const defaultDeps: ConversationDeps = {
  jsonl: {
    "claude-code": {
      state: claudeState,
      map: (lines, state) => mapClaude(lines, state as ClaudeState),
    },
    codex: {
      state: codexState,
      map: (lines, state, sourceOffset) =>
        mapCodex(lines, state as ReturnType<typeof codexState>, sourceOffset),
    },
    pi: {
      state: piState,
      map: (lines, state) => mapPi(lines, state as ReturnType<typeof piState>),
    },
    cursor: {
      state: cursorState,
      map: (lines, state) => mapCursor(lines, state as CursorState),
      rewrites: true,
    },
    grok: {
      state: grokState,
      map: (lines, state) => mapGrok(lines, state as GrokState),
    },
    copilot: {
      state: copilotState,
      map: (lines, state) => mapCopilot(lines, state as CopilotState),
    },
    antigravity: {
      state: antigravityState,
      map: (lines, state) => mapAntigravity(lines, state as AntigravityState),
    },
  },
  opencode: readOpencode,
}

const LOCATE_RETRY_MS = 2_000

/** What the agent's record does not give the Conversation, as `agents.json` lists it. */
function gapsOf(agent: NativeAgent): Pick<ConversationSnapshot, "missing"> {
  const missing = (agents[agent].capabilities as { conversationMissing?: ConversationPart[] })
    .conversationMissing
  return missing?.length ? { missing } : {}
}

function loadEntryRecord(
  ctx: Ctx,
  run: NativeRun,
  initial: CacheEntry,
  now: number,
  deps: ConversationDeps,
): { entry: CacheEntry; workers: ConversationWorker[] | undefined } {
  let entry = initial
  let workers = entry.workers
  try {
    if (!entry.location && now >= entry.nextLocateAt) {
      entry.location = locateRecord(ctx, run)
      if (!entry.location) entry.nextLocateAt = now + LOCATE_RETRY_MS
    }
    const location = entry.location
    if (location?.kind === "jsonl") {
      entry.source = "transcript"
      entry = readTranscript(entry, {
        path: location.path,
        mapper: deps.jsonl[run.agent as keyof ConversationDeps["jsonl"]],
        retainEvents: true,
        scope:
          run.agent === "claude-code" && run.nativeSession
            ? { session: run.nativeSession, cwd: run.cwd }
            : undefined,
      })
      if (run.agent === "claude-code") {
        workers = claudeWorkers(
          entry,
          location.path,
          deps.jsonl["claude-code"],
          Math.max(0, CONVERSATION_LIMITS.readBytes - entry.readBytes),
        )
      }
      if (!entry.location) entry.nextLocateAt = now + LOCATE_RETRY_MS
    } else if (location?.kind === "sqlite") {
      entry.source = "database"
      readDatabase(entry, location, now, deps.opencode)
    }
  } catch {
    // Whatever was read before is still good.
  }
  return { entry, workers }
}

function collectEvents(entry: CacheEntry, seq: number | null): ConversationEvent[] {
  const events: ConversationEvent[] = []
  if (seq === entry.seq) return events
  for (const stored of entry.events.values()) {
    if (seq === null || stored.seq > seq) events.push(stored.event)
  }
  return events
}

function ensureRunEntry(run: NativeRun, now: number): { key: string; entry: CacheEntry } {
  const key = `${run.id}:${run.generation}`
  for (const [other, existing] of conversationCache) {
    if (other.startsWith(`${run.id}:`) && existing.generation !== run.generation)
      conversationCache.delete(other)
  }
  let entry = conversationCache.get(key) ?? freshEntry(run.generation, now)
  if (entry.session !== run.nativeSession) {
    entry = freshEntry(run.generation, now)
    clearWorkerConversationCache(run.id)
  }
  entry.session = run.nativeSession
  entry.lastRead = now
  entry.finished = run.status === "stopped" || run.status === "failed"
  return { key, entry }
}

function buildConversationSnapshot(
  ctx: Ctx,
  run: NativeRun,
  entry: CacheEntry,
  workers: ConversationWorker[] | undefined,
  after?: string,
): ConversationSnapshot {
  const state = entry.finished
    ? "idle"
    : workers?.length || entry.workersIncomplete
      ? "working"
      : (entry.nativeState ?? derivedState(entry))
  const selected =
    run.agent === "codex"
      ? selectNativePlan(
          ctx,
          run.nativeSession,
          entry.checklist,
          entry.location?.kind === "jsonl" ? entry.location.path : undefined,
          (entry.state as CodexState | undefined)?.planObservation,
        )
      : { checklist: entry.checklist, captured: false }
  return {
    agent: run.agent,
    ...gapsOf(run.agent),
    question: snapshotQuestion(entry),
    checklist: snapshotChecklist(
      selected.checklist,
      run.nativeSession ?? entry.epoch,
      entry.hasMore,
      selected.captured,
    ),
    source: entry.source,
    events: collectEvents(entry, sequenceOf(run, entry, after)),
    ...usageOf(entry, run),
    ...(state ? { state } : {}),
    ...(workers ? { workers: entry.finished ? [] : workers } : {}),
    ...(entry.workersIncomplete !== undefined
      ? { workersIncomplete: entry.finished ? false : entry.workersIncomplete }
      : {}),
    cursor: cursorOf(run, entry),
    truncated: entry.truncated,
    ...(entry.hasMore ? { hasMore: true } : {}),
  }
}

export function readConversation(
  ctx: Ctx,
  run: NativeRun,
  after?: string,
  deps: ConversationDeps = defaultDeps,
): ConversationSnapshot {
  const now = ctx.clock.now()
  const { key, entry: initial } = ensureRunEntry(run, now)
  const { entry, workers } = loadEntryRecord(ctx, run, initial, now, deps)
  conversationCache.set(key, entry)
  entry.finished = run.status === "stopped" || run.status === "failed"
  sweepCaches(now)
  return buildConversationSnapshot(ctx, run, entry, workers, after)
}

/** A read-only view of a proven native child. No file supplied by the caller is opened and
 * no parent conversation is returned as a fallback when membership/history is unavailable. */
export function readWorkerConversation(
  ctx: Ctx,
  run: NativeRun,
  worker: string,
  after?: string,
): ConversationSnapshot | undefined {
  return readWorkerConversationWith(ctx, run, worker, {
    after,
    defaultDeps,
    refreshParent: (parentCtx, parentRun) => {
      readConversation(parentCtx, parentRun)
    },
  })
}
