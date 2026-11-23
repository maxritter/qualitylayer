import type { MemoryEngine } from "../memory-contracts.ts"
import { materializeMemoryEngine } from "./extract.ts"
import {
  runNeighbours,
  runPin,
  runRemove,
  runSearch,
  runUpsert,
  validateUpsertRecord,
} from "./operations.ts"
import { embeddedMemoryEngine, type MemoryEnginePayload } from "./payload.ts"
import {
  type EngineSessionState,
  resolveEngineConfig,
  runSerializedEngineTask,
  validateIdentifier,
} from "./storage-db.ts"

export type MemoryEngineOptions = {
  home: string
  payload?: MemoryEnginePayload
  timeoutMs?: number
  maxPending?: number
  maxProjectBytes?: number
  maxTotalBytes?: number
}

/**
 * The observation numbers of mem_timeline's text reply, in order. Each entry starts its line with
 * `#N`, the focus entry with `>>> #N`; anything else (headings, previews, dates) is skipped, and a
 * reply in another shape yields none.
 */
export function timelineObservations(result: unknown): number[] {
  if (typeof result !== "string") return []
  const out: number[] = []
  for (const line of result.slice(0, 65536).split("\n")) {
    const match = /^\s*(?:>>>\s*)?#(\d{1,15})\s+\[/.exec(line)
    const value = match ? Number(match[1]) : Number.NaN
    // The engine lists a session by ascending observation number; a lesson's own text that looks
    // like an entry can only repeat or reorder numbers, so it is dropped.
    if (Number.isSafeInteger(value) && value > (out.at(-1) ?? 0)) out.push(value)
  }
  return out
}

function checked<T>(validate: () => void, action: () => Promise<T>): Promise<T> {
  try {
    validate()
  } catch (error) {
    return Promise.reject(error)
  }
  return action()
}

export function createMemoryEngine(options: MemoryEngineOptions): MemoryEngine {
  const state: EngineSessionState = {
    config: resolveEngineConfig(options),
    closed: false,
    active: null,
    own: new Set<Promise<unknown>>(),
  }
  return {
    upsert(project, record) {
      return checked(
        () => validateUpsertRecord(project, record),
        () =>
          runSerializedEngineTask(state, project, (engine, map) =>
            runUpsert(engine, map, project, record),
          ),
      )
    },
    search(project, query, limit) {
      if (typeof query !== "string" || Buffer.byteLength(query) > 2048 || !query.trim())
        return Promise.reject(new Error("Invalid memory search query"))
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        return Promise.reject(new Error("Invalid memory search limit"))
      return runSerializedEngineTask(state, project, (engine, map) =>
        runSearch(engine, map, project, query, limit),
      )
    },
    pin(project, id, pinned) {
      return checked(
        () => {
          validateIdentifier(id, "record ID")
          if (typeof pinned !== "boolean") throw new Error("Invalid memory pin")
        },
        () =>
          runSerializedEngineTask(state, project, (engine, map) => runPin(engine, map, id, pinned)),
      )
    },
    neighbours(project, id, around) {
      return checked(
        () => {
          validateIdentifier(id, "record ID")
          if (!Number.isSafeInteger(around) || around < 1 || around > 3)
            throw new Error("Invalid memory neighbourhood")
        },
        () =>
          runSerializedEngineTask(state, project, (engine, map) =>
            runNeighbours(engine, map, { project, id, around }, timelineObservations),
          ),
      )
    },
    remove(project, id) {
      return checked(
        () => validateIdentifier(id, "record ID"),
        () =>
          runSerializedEngineTask(state, project, (engine, map) =>
            runRemove(engine, map, project, id),
          ),
      )
    },
    async close() {
      state.closed = true
      state.active?.abort()
      await Promise.allSettled([...state.own])
    },
  }
}

export { materializeMemoryEngine } from "./extract.ts"
export { memoryEngineNotices } from "./notices.ts"
export type { MemoryEnginePayload } from "./payload.ts"

export function memoryEngineInstallationInfo() {
  const payload = embeddedMemoryEngine()
  return {
    name: "Engram",
    version: payload.version,
    target: payload.target,
    sha256: payload.sha256,
    source: payload.source ?? null,
    toolchain: payload.toolchain ?? null,
  }
}

export async function prepareMemoryEngineHome(home: string) {
  const path = await materializeMemoryEngine(home, embeddedMemoryEngine())
  return { ...memoryEngineInstallationInfo(), path }
}
