import { PROTOCOL_VERSION, type RunControl, type RunStatus } from "./contracts.ts"

export { PROTOCOL_VERSION }
export const LIMITS = {
  frameBytes: 64 * 1024,
  inputBytes: 16 * 1024,
  inboundBytes: 256 * 1024,
  attachmentBytes: 1024 * 1024,
  attachments: 16,
  replayBytes: 2 * 1024 * 1024,
  scrollbackBytes: 4 * 1024 * 1024,
  helloMs: 2000,
} as const
export type InputBoundary = {
  generation: number
  nativeSession: string
  sequence: number
  task: string
}
export type ServerFrame =
  | { type: "hello"; protocol: number; token: string }
  | { type: "input"; data: Uint8Array; boundary?: InputBoundary }
  | { type: "resize"; cols: number; rows: number }
  | { type: "control"; action: RunControl; generation: number }
  | { type: "attach"; generation: number }
  /**
   * How many bytes of the host's frames this viewer has taken in since it connected (the wire bytes,
   * length prefixes included). The first one says the viewer acknowledges; the host then counts what it
   * has sent beyond the last one and drops the viewer that falls LIMITS.attachmentBytes behind. A viewer
   * that never sends one is judged by its socket's own queue alone.
   */
  | { type: "ack"; bytes: number }
  | {
      type: "restart"
      generation: number
      sequence: number
      permission?: { nativeSession: string; inputAt: number }
    }
  | { type: "guarded-stop"; generation: number; sequence: number }
  | { type: "fresh"; generation: number; sequence: number; request: string }
export type HostFrame =
  | {
      type: "ready"
      protocol: number
      run: string
      generation: number
      pid: number
      processStart: string
      guardedRestart?: boolean
      permissionRestart?: boolean
      /** The host takes `ack` frames: only a viewer that sees this sends them (an older host would close on one). */
      acknowledges?: boolean
      guardedInput?: boolean
    }
  | { type: "output"; seq: number; data: Uint8Array }
  | {
      type: "replay-begin"
      epoch: number
      cols: number
      rows: number
      kind: "replay" | "rebuild"
      truncated: boolean
      upTo: number
    }
  | { type: "replay-chunk"; epoch: number; data: Uint8Array }
  | { type: "replay-end"; epoch: number }
  | { type: "status"; status: RunStatus; cols: number; rows: number }
  | { type: "attention"; kind: "attention" | "waiting" | "clear" }
  | { type: "resync"; reason: string }
  | { type: "error"; code: string; message: string }
  | { type: "exit"; code: number; cleanupComplete: boolean }
  | { type: "input-result"; generation: number; sequence: number; accepted: boolean }
  | {
      type: "fresh-result"
      generation: number
      request: string
      status: "started"
      run: string
      nextGeneration: number
    }
  | { type: "fresh-result"; generation: number; request: string; status: "failed"; message: string }
export type Frame = ServerFrame | HostFrame
export type Direction = "server" | "host"
export const FRAME_SCHEMA = {
  hello: { id: 1, direction: "server", introduced: 1 },
  input: { id: 2, direction: "server", introduced: 1 },
  resize: { id: 3, direction: "server", introduced: 1 },
  control: { id: 4, direction: "server", introduced: 1 },
  attach: { id: 5, direction: "server", introduced: 1 },
  ready: { id: 6, direction: "host", introduced: 1 },
  output: { id: 7, direction: "host", introduced: 1 },
  "replay-begin": { id: 8, direction: "host", introduced: 1 },
  "replay-chunk": { id: 9, direction: "host", introduced: 1 },
  "replay-end": { id: 10, direction: "host", introduced: 1 },
  status: { id: 11, direction: "host", introduced: 1 },
  attention: { id: 12, direction: "host", introduced: 1 },
  resync: { id: 13, direction: "host", introduced: 1 },
  error: { id: 14, direction: "host", introduced: 1 },
  exit: { id: 15, direction: "host", introduced: 1 },
  restart: { id: 16, direction: "server", introduced: 1 },
  fresh: { id: 17, direction: "server", introduced: 1 },
  "fresh-result": { id: 18, direction: "host", introduced: 1 },
  "guarded-stop": { id: 19, direction: "server", introduced: 1 },
  ack: { id: 20, direction: "server", introduced: 1 },
  "input-result": { id: 21, direction: "host", introduced: 1 },
} as const
const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true })
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max
export const validSize = (cols: unknown, rows: unknown) =>
  integer(cols, 2, 500) && integer(rows, 1, 300)
/** The lowest event a frame can name: a restart needs a turn behind it, a guarded stop can be at the start. */
const FIRST_BOUNDARY = { restart: 1, "guarded-stop": 0 } as const
const text = (v: unknown, max = 4096): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max
export function validateFrame(value: unknown, direction?: Direction): Frame {
  if (!value || typeof value !== "object") throw new Error("invalid frame")
  const f = value as Record<string, unknown>
  const type = f.type as keyof typeof FRAME_SCHEMA
  const schema = FRAME_SCHEMA[type]
  if (!schema || (direction && schema.direction !== direction))
    throw new Error("unknown or wrong-direction frame")
  const binary = (limit: number) => f.data instanceof Uint8Array && f.data.length <= limit
  let valid = false
  switch (type) {
    case "hello":
      valid = integer(f.protocol, 1) && text(f.token, 256)
      break
    case "input":
      valid =
        binary(LIMITS.inputBytes) &&
        (f.boundary === undefined ||
          (typeof f.boundary === "object" &&
            f.boundary !== null &&
            integer((f.boundary as Record<string, unknown>).generation, 1) &&
            integer((f.boundary as Record<string, unknown>).sequence, 1) &&
            text((f.boundary as Record<string, unknown>).nativeSession, 128) &&
            text((f.boundary as Record<string, unknown>).task, 512) &&
            Object.keys(f.boundary).every((key) =>
              ["generation", "nativeSession", "sequence", "task"].includes(key),
            )))
      break
    case "input-result":
      valid = integer(f.generation, 1) && integer(f.sequence, 1) && typeof f.accepted === "boolean"
      break
    case "resize":
      valid = validSize(f.cols, f.rows)
      break
    case "control":
      valid =
        typeof f.action === "string" &&
        ["interrupt", "stop", "move", "take-control"].includes(f.action) &&
        integer(f.generation, 1)
      break
    case "attach":
      valid = integer(f.generation, 1)
      break
    case "ack":
      valid = integer(f.bytes) && Object.keys(f).every((key) => ["type", "bytes"].includes(key))
      break
    case "restart":
      valid =
        integer(f.generation, 1) &&
        integer(f.sequence, 1) &&
        (f.permission === undefined ||
          (typeof f.permission === "object" &&
            f.permission !== null &&
            text((f.permission as Record<string, unknown>).nativeSession, 128) &&
            integer((f.permission as Record<string, unknown>).inputAt) &&
            Object.keys(f.permission).every((key) =>
              ["nativeSession", "inputAt"].includes(key),
            ))) &&
        Object.keys(f).every((key) =>
          ["type", "generation", "sequence", "permission"].includes(key),
        )
      break
    case "guarded-stop":
      valid =
        integer(f.generation, 1) &&
        integer(f.sequence, FIRST_BOUNDARY[type]) &&
        Object.keys(f).every((key) => ["type", "generation", "sequence"].includes(key))
      break
    case "fresh":
      valid =
        integer(f.generation, 1) &&
        integer(f.sequence, 1) &&
        typeof f.request === "string" &&
        /^[a-f0-9]{32}$/.test(f.request) &&
        Object.keys(f).every((key) => ["type", "generation", "sequence", "request"].includes(key))
      break
    case "fresh-result":
      valid =
        integer(f.generation, 1) &&
        typeof f.request === "string" &&
        /^[a-f0-9]{32}$/.test(f.request) &&
        (f.status === "started"
          ? text(f.run, 128) &&
            integer(f.nextGeneration, 1) &&
            Object.keys(f).every((key) =>
              ["type", "generation", "request", "status", "run", "nextGeneration"].includes(key),
            )
          : f.status === "failed" &&
            text(f.message, 2048) &&
            Object.keys(f).every((key) =>
              ["type", "generation", "request", "status", "message"].includes(key),
            ))
      break
    case "ready":
      valid =
        integer(f.protocol, 1) &&
        text(f.run, 128) &&
        integer(f.generation, 1) &&
        integer(f.pid, 1) &&
        text(f.processStart)
      valid = valid && (f.guardedRestart === undefined || typeof f.guardedRestart === "boolean")
      valid =
        valid && (f.permissionRestart === undefined || typeof f.permissionRestart === "boolean")
      valid = valid && (f.acknowledges === undefined || typeof f.acknowledges === "boolean")
      valid = valid && (f.guardedInput === undefined || typeof f.guardedInput === "boolean")
      break
    case "output":
      valid = integer(f.seq, 1) && binary(32 * 1024)
      break
    case "replay-begin":
      valid =
        integer(f.epoch, 1) &&
        validSize(f.cols, f.rows) &&
        typeof f.kind === "string" &&
        ["replay", "rebuild"].includes(f.kind) &&
        typeof f.truncated === "boolean" &&
        integer(f.upTo)
      break
    case "replay-chunk":
      valid = integer(f.epoch, 1) && binary(32 * 1024)
      break
    case "replay-end":
      valid = integer(f.epoch, 1)
      break
    case "status":
      valid =
        typeof f.status === "string" &&
        ["validated", "starting", "running", "stopping", "stopped", "failed"].includes(f.status) &&
        validSize(f.cols, f.rows)
      break
    case "attention":
      valid = typeof f.kind === "string" && ["attention", "waiting", "clear"].includes(f.kind)
      break
    case "resync":
      valid = text(f.reason)
      break
    case "error":
      valid = text(f.code, 128) && text(f.message)
      break
    case "exit":
      valid = integer(f.code, -2147483648, 2147483647) && typeof f.cleanupComplete === "boolean"
      break
  }
  if (!valid) throw new Error(`invalid ${type} frame`)
  return value as Frame
}
export function encodeFrame(frame: Frame): Uint8Array {
  validateFrame(frame)
  const wire =
    "data" in frame
      ? { ...frame, data: { base64: btoa(String.fromCharCode(...frame.data)) } }
      : frame
  const payload = encoder.encode(JSON.stringify(wire))
  const length = 1 + payload.length
  if (length > LIMITS.frameBytes) throw new Error("frame exceeds cap")
  const bytes = new Uint8Array(length + 4)
  new DataView(bytes.buffer).setUint32(0, length)
  bytes[4] = FRAME_SCHEMA[frame.type].id
  bytes.set(payload, 5)
  return bytes
}
export class FrameDecoder {
  private pending = new Uint8Array(0)
  constructor(readonly direction: Direction) {}
  push(chunk: Uint8Array): Frame[] {
    const bytes = new Uint8Array(this.pending.length + chunk.length)
    bytes.set(this.pending)
    bytes.set(chunk, this.pending.length)
    const frames: Frame[] = []
    let offset = 0
    while (offset + 4 <= bytes.length) {
      const length = new DataView(bytes.buffer, bytes.byteOffset + offset).getUint32(0)
      if (length < 2 || length > LIMITS.frameBytes) throw new Error("invalid frame length")
      if (offset + 4 + length > bytes.length) break
      const schema = Object.entries(FRAME_SCHEMA).find(([, v]) => v.id === bytes[offset + 4])
      if (!schema || schema[1].direction !== this.direction)
        throw new Error("unknown or wrong-direction frame")
      const parsed = JSON.parse(
        decoder.decode(bytes.subarray(offset + 5, offset + 4 + length)),
        (_, v) => {
          if (v && typeof v === "object" && typeof v.base64 === "string") {
            if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.base64))
              throw new Error("invalid binary frame")
            return Uint8Array.from(atob(v.base64), (c) => c.charCodeAt(0))
          }
          return v
        },
      )
      if (parsed?.type !== schema[0]) throw new Error("frame type mismatch")
      frames.push(validateFrame(parsed, this.direction))
      offset += length + 4
    }
    this.pending = bytes.slice(offset)
    if (this.pending.length > LIMITS.frameBytes + 4) throw new Error("frame buffer exceeds cap")
    return frames
  }
  get bufferedBytes() {
    return this.pending.length
  }
}
export function decodeFrames(bytes: Uint8Array, direction: Direction): Frame[] {
  const decoder = new FrameDecoder(direction)
  const frames = decoder.push(bytes)
  if (decoder.bufferedBytes) throw new Error("incomplete frame")
  return frames
}
export function isAgentRunsRoute(path: string) {
  return path === "/api/agent-runs" || path.startsWith("/api/agent-runs/")
}

/** Browser-only sideband; never accepted on the private host socket or from a viewer. */
export type ViewerState = {
  pickerProof?: string
  type: "viewer-state"
  generation: number
  controller: boolean
  canType: boolean
  canStop: boolean
  canResize: boolean
  canTakeControl: boolean
}
export const VIEWER_STATE_BYTES = 1024
export function validateViewerState(value: unknown): ViewerState {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid viewer state")
  const state = value as Record<string, unknown>
  const proof = Object.hasOwn(state, "pickerProof")
  const keys = [
    "type",
    "generation",
    "controller",
    "canType",
    "canStop",
    "canResize",
    "canTakeControl",
  ]
  if (
    Object.keys(state).length !== keys.length + Number(proof) ||
    keys.some((key) => !Object.hasOwn(state, key)) ||
    state.type !== "viewer-state" ||
    !integer(state.generation, 1) ||
    keys.slice(2).some((key) => typeof state[key] !== "boolean") ||
    encoder.encode(JSON.stringify(value)).length > VIEWER_STATE_BYTES
  )
    throw new Error("invalid viewer state")
  if (
    (state.canType && (!state.controller || !state.canTakeControl)) ||
    (state.canResize && !state.canType)
  )
    throw new Error("inconsistent viewer state")
  if (
    proof &&
    (!state.canType ||
      typeof state.pickerProof !== "string" ||
      !/^[a-f0-9]{64}$/.test(state.pickerProof))
  )
    throw new Error("invalid picker proof")
  return value as ViewerState
}
