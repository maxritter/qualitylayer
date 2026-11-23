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

/** Focus reports carry terminal state, never the person's keys or paste. */
export function isTerminalFocusReport(bytes: Uint8Array): boolean {
  if (bytes.length === 0 || bytes.length % 3 !== 0) return false
  for (let at = 0; at < bytes.length; at += 3)
    if (
      bytes[at] !== 0x1b ||
      bytes[at + 1] !== 0x5b ||
      (bytes[at + 2] !== 0x49 && bytes[at + 2] !== 0x4f)
    )
      return false
  return true
}

import { validateFrame, validateViewerState } from "./protocol-validate.ts"

export { validateFrame, validateViewerState }

const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max
export const validSize = (cols: unknown, rows: unknown) =>
  integer(cols, 2, 500) && integer(rows, 1, 300)

function reviveBinary(_: string, v: unknown): unknown {
  if (!v || typeof v !== "object" || typeof (v as { base64?: unknown }).base64 !== "string")
    return v
  const base64 = (v as { base64: string }).base64
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
    throw new Error("invalid binary frame")
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

function decodeSingleFrame(
  bytes: Uint8Array,
  offset: number,
  length: number,
  direction: Direction,
): Frame {
  const schema = Object.entries(FRAME_SCHEMA).find(([, v]) => v.id === bytes[offset + 4])
  if (!schema || schema[1].direction !== direction)
    throw new Error("unknown or wrong-direction frame")
  const parsed = JSON.parse(
    decoder.decode(bytes.subarray(offset + 5, offset + 4 + length)),
    reviveBinary,
  )
  if (parsed?.type !== schema[0]) throw new Error("frame type mismatch")
  return validateFrame(parsed, direction)
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
      frames.push(decodeSingleFrame(bytes, offset, length, this.direction))
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
