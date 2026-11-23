import { VECTOR_DIMENSIONS } from "../core/memory/ranking.ts"
import type { MemoryEmbedder } from "../memory-contracts.ts"

export type EmbeddingWorker = {
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
  postMessage(message: unknown): void
  ref(): void
  unref(): void
  terminate(): void
}
type Timer = ReturnType<typeof setTimeout>
export type EmbedClock = {
  set(callback: () => void, ms: number): Timer
  clear(timer: Timer | undefined): void
}
type Pending = {
  id: number
  count: number
  deadline?: Timer
  resolve(vectors: Float32Array[]): void
  reject(cause: Error): void
}
type Active = { worker: EmbeddingWorker; pending: Pending | null; detach(): void }
const clock: EmbedClock = { set: setTimeout, clear: clearTimeout }
const REQUEST_MS = 15_000

type EmbedderPool = {
  spawn: () => EmbeddingWorker
  idleMs: number
  time: EmbedClock
  active: Active | undefined
  timer: Timer | undefined
  epoch: number
  request: number
  queue: Promise<void>
}

function clearPoolIdle(pool: EmbedderPool): void {
  pool.time.clear(pool.timer)
  pool.timer = undefined
}

function dropPoolActive(
  pool: EmbedderPool,
  state: Active,
  cause = new Error("The memory embedder was closed."),
): void {
  if (pool.active !== state) return
  pool.active = undefined
  clearPoolIdle(pool)
  state.detach()
  const pending = state.pending
  state.pending = null
  pool.time.clear(pending?.deadline)
  state.worker.unref()
  state.worker.terminate()
  pending?.reject(cause)
}

function isValidVectorBatch(vectors: unknown, expectedCount: number): vectors is Float32Array[] {
  if (!Array.isArray(vectors) || vectors.length !== expectedCount) return false
  return vectors.every(
    (vector) => vector instanceof Float32Array && vector.length === VECTOR_DIMENSIONS,
  )
}

function handleWorkerMessage(pool: EmbedderPool, state: Active, event: Event): void {
  if (pool.active !== state || !state.pending) return
  const data = (event as MessageEvent).data as {
    id?: unknown
    vectors?: unknown
    error?: unknown
  } | null
  if (!data || data.id !== state.pending.id) return
  if (typeof data.error === "string") {
    dropPoolActive(pool, state, new Error(data.error))
    return
  }
  if (!isValidVectorBatch(data.vectors, state.pending.count)) {
    dropPoolActive(pool, state, new Error("The memory worker returned invalid vectors."))
    return
  }
  const pending = state.pending
  state.pending = null
  pool.time.clear(pending.deadline)
  pending.resolve(data.vectors)
}

function startPoolWorker(pool: EmbedderPool): Active {
  const worker = pool.spawn()
  const state: Active = { worker, pending: null, detach: () => {} }
  const message: EventListener = (event) => handleWorkerMessage(pool, state, event)
  const error: EventListener = (event) => {
    event.preventDefault()
    dropPoolActive(
      pool,
      state,
      new Error((event as ErrorEvent).message || "The memory worker failed."),
    )
  }
  const close: EventListener = () =>
    dropPoolActive(pool, state, new Error("The memory worker stopped."))
  state.detach = () => {
    worker.removeEventListener("message", message)
    worker.removeEventListener("error", error)
    worker.removeEventListener("messageerror", error)
    worker.removeEventListener("close", close)
  }
  worker.addEventListener("message", message)
  worker.addEventListener("error", error)
  worker.addEventListener("messageerror", error)
  worker.addEventListener("close", close)
  pool.active = state
  return state
}

function dispatchEmbedRequest(
  pool: EmbedderPool,
  state: Active,
  texts: string[],
): Promise<Float32Array[]> {
  return new Promise<Float32Array[]>((resolve, reject) => {
    const id = ++pool.request
    const pending: Pending = { id, count: texts.length, resolve, reject }
    state.pending = pending
    pending.deadline = pool.time.set(() => {
      if (pool.active === state && state.pending?.id === id)
        dropPoolActive(pool, state, new Error("The memory worker timed out."))
    }, REQUEST_MS)
    pending.deadline.unref()
    try {
      state.worker.postMessage({ id, texts })
    } catch (cause) {
      dropPoolActive(
        pool,
        state,
        cause instanceof Error ? cause : new Error("The memory worker failed."),
      )
    }
  })
}

function schedulePoolIdle(pool: EmbedderPool, state: Active): void {
  if (pool.active !== state) return
  state.worker.unref()
  const idle = pool.time.set(() => {
    if (pool.timer === idle && state.pending === null) dropPoolActive(pool, state)
  }, pool.idleMs)
  pool.timer = idle
  idle.unref()
}

async function runEmbedBatch(
  pool: EmbedderPool,
  admitted: number,
  texts: string[],
): Promise<Float32Array[]> {
  if (admitted !== pool.epoch) throw new Error("The memory embedder was closed.")
  clearPoolIdle(pool)
  const state = pool.active ?? startPoolWorker(pool)
  state.worker.ref()
  try {
    return await dispatchEmbedRequest(pool, state, texts)
  } finally {
    schedulePoolIdle(pool, state)
  }
}

/** Owns one disposable runtime realm; only an outstanding inference keeps it ref'd. */
export function createWorkerEmbedder(
  spawn: () => EmbeddingWorker,
  idleMs: number,
  time: EmbedClock = clock,
): MemoryEmbedder {
  const pool: EmbedderPool = {
    spawn,
    idleMs,
    time,
    active: undefined,
    timer: undefined,
    epoch: 0,
    request: 0,
    queue: Promise.resolve(),
  }
  return {
    embed(texts) {
      const admitted = pool.epoch
      const run = pool.queue.then(() => runEmbedBatch(pool, admitted, texts))
      pool.queue = run.then(
        () => {},
        () => {},
      )
      return run
    },
    close() {
      pool.epoch++
      clearPoolIdle(pool)
      if (pool.active) dropPoolActive(pool, pool.active)
    },
  }
}
