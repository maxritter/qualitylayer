import { createHeadlessTerminal } from "restty/headless"
import type { PickerHost, PickerRequest } from "../core/conversation/codex-picker.ts"
import { nativeRun, readConversation } from "../core/conversation/service.ts"
import type { RunRecord } from "../core/run/contracts.ts"
import { type connectHost, readRun } from "../core/run/registry.ts"
import { screenText } from "../core/run/restore.ts"
import { connectOrRevive } from "../core/run/settle.ts"
import type { Ctx } from "../ctx.ts"
import { TerminalReceiver } from "../ui/agent-window/transport.ts"

export const pickerRunId = (path: string) =>
  /^\/api\/agent-runs\/([a-f0-9-]{1,128})\/picker$/.exec(path)?.[1]
function isValidCallId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 128
}

function isValidGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
}

function isValidPicks(picks: unknown): picks is PickerRequest["picks"] {
  if (Array.isArray(picks)) {
    return (
      picks.length >= 1 &&
      picks.length <= 20 &&
      picks.every((item) => typeof item === "string" && item.length <= 8000)
    )
  }
  return Boolean(
    picks && typeof picks === "object" && typeof (picks as { own?: unknown }).own === "string",
  )
}

export function pickerRequest(
  value: unknown,
): (PickerRequest & { generation: number; answers?: unknown }) | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (!isValidCallId(row.callId) || !isValidGeneration(row.generation)) return null
  if (row.answers !== undefined) {
    return {
      callId: row.callId,
      questionId: "",
      generation: row.generation,
      picks: [],
      answers: row.answers,
    }
  }
  const validQuestion =
    typeof row.questionId === "string" && row.questionId.length > 0 && row.questionId.length <= 256
  if (!validQuestion || !isValidPicks(row.picks)) return null
  return {
    callId: row.callId,
    questionId: row.questionId as string,
    generation: row.generation,
    picks: row.picks,
  }
}

type PickerConnectionState = {
  closed: boolean
  replaying: boolean
}

function matchesLiveRun(latest: RunRecord | null | undefined, run: RunRecord): boolean {
  return (
    latest?.status === "running" &&
    latest.generation === run.generation &&
    latest.nativeSession === run.nativeSession
  )
}

async function waitForPickerReplay(ctx: Ctx, state: PickerConnectionState) {
  const deadline = ctx.clock.now() + 2000
  while (state.replaying && !state.closed && ctx.clock.now() < deadline) await ctx.clock.sleep(25)
  if (state.replaying || state.closed) throw new Error("The native screen could not be read")
}

function attachPickerReceiver(
  connection: Awaited<ReturnType<typeof connectHost>>,
  terminal: Awaited<ReturnType<typeof createHeadlessTerminal>>,
  state: PickerConnectionState,
  close: () => void,
) {
  const receiver = new TerminalReceiver(
    {
      write: (text) => terminal.write(text),
      resize: (cols, rows) => terminal.resize(cols, rows),
    },
    (frame) => {
      if (frame.type === "replay-begin") state.replaying = true
      if (frame.type === "replay-end") state.replaying = false
      if (frame.type === "exit" || frame.type === "resync" || frame.type === "error")
        state.closed = true
    },
  )
  connection.socket.once("close", () => {
    state.closed = true
  })
  return connection.onFrame((frame) => {
    if (state.closed) return
    try {
      receiver.receive(frame)
    } catch {
      close()
    }
  })
}

type PickerSnapshotInput = {
  ctx: Ctx
  run: RunRecord
  callId: string
  state: PickerConnectionState
  allowed: () => Promise<boolean>
  terminal: Awaited<ReturnType<typeof createHeadlessTerminal>>
}

async function readPickerSnapshot(input: PickerSnapshotInput) {
  const { ctx, run, callId, state, allowed, terminal } = input
  const latest = readRun(ctx.home, run.id)
  const active = !state.closed && !state.replaying && matchesLiveRun(latest, run)
  const permitted = active && (await allowed())
  const snapshot = latest && nativeRun(latest) ? readConversation(ctx, latest) : null
  const result = snapshot?.events.findLast(
    (event) => event.kind === "tool-result" && event.callId === callId,
  )
  return {
    allowed: permitted,
    version: latest?.binary?.version ?? "",
    identity: `${latest?.nativeSession}:${latest?.generation}`,
    question: snapshot?.question ?? null,
    result: result?.kind === "tool-result" ? (result.output ?? "") : undefined,
    screen: state.closed ? "" : screenText(terminal),
  }
}

/** One bounded screen subscription per active answer, disposed before the request returns. */
export async function pickerHost(
  ctx: Ctx,
  run: RunRecord,
  callId: string,
  allowed: () => Promise<boolean>,
  currentAuthority: () => boolean,
): Promise<PickerHost & { close: () => void }> {
  const terminal = await createHeadlessTerminal({
    cols: 80,
    rows: 24,
    maxScrollbackBytes: 64 * 1024,
    replay: { maxBytes: 64 * 1024 },
  })
  let host: Awaited<ReturnType<typeof connectHost>> | undefined
  let unsubscribe = () => {}
  let disposed = false
  const state: PickerConnectionState = { closed: false, replaying: true }
  const close = () => {
    if (disposed) return
    disposed = true
    state.closed = true
    unsubscribe()
    host?.close()
    terminal.dispose()
  }
  try {
    host = await connectOrRevive(ctx.home, run.id)
    if (host.ready.generation !== run.generation)
      throw new Error("The native host generation changed")
    const connection = host
    unsubscribe = attachPickerReceiver(connection, terminal, state, close)
    connection.send({ type: "attach", generation: run.generation })
    await waitForPickerReplay(ctx, state)
    const current = () => readPickerSnapshot({ ctx, run, callId, state, allowed, terminal })
    return {
      clock: ctx.clock,
      read: current,
      write: async (keys) => {
        const snapshot = await current()
        // No await after the final authority and open-call checks and before the host write.
        const latest = readRun(ctx.home, run.id)
        const ready = snapshot.allowed && currentAuthority() && snapshot.question?.id === callId
        const hostReady = latest?.generation === run.generation && !connection.socket.destroyed
        if (!ready || !hostReady) throw new Error("The controller or native question changed")
        connection.send({ type: "input", data: Buffer.from(keys) })
      },
      close,
    }
  } catch (cause) {
    close()
    throw cause
  }
}
