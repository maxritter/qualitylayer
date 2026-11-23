// `qualitylayer memory mcp`: the four memory tools over standard input and output as newline-
// delimited JSON-RPC (the Model Context Protocol's stdio transport). It answers initialize, ping,
// tools/list and tools/call, and exits when its input closes. Nothing here polls or waits: an idle
// server holds no timer, and its service opens on the first call.

import type { Ctx } from "../../ctx.ts"
import { memoryService } from "../../memory-runtime.ts"
import { handleMcpLine, type MemoryMcpService, mcpFailure } from "./memory-mcp-protocol.ts"

const LINE_MAX = 1024 * 1024

type StreamState = { pending: string; skipping: boolean }

function consumeChunk(
  state: StreamState,
  text: string,
  enqueue: (task: () => Promise<void> | void) => void,
  handle: (line: string) => Promise<void>,
  reply: (message: object) => void,
): void {
  state.pending += text
  for (let at = state.pending.indexOf("\n"); at !== -1; at = state.pending.indexOf("\n")) {
    const line = state.pending.slice(0, at)
    state.pending = state.pending.slice(at + 1)
    if (state.skipping) state.skipping = false
    else enqueue(() => handle(line))
  }
  if (state.pending.length > LINE_MAX) {
    // A line this long is no request: say so once, then drop the rest of it.
    state.pending = ""
    if (!state.skipping) enqueue(() => reply(mcpFailure(null, -32600, "Line too long")))
    state.skipping = true
  }
}

/**
 * Serves lines from `input` until it ends, writing one JSON line per reply with `write`. Requests
 * run one after another, in the order they came; a line that is not a request gets an error and the
 * next line is read as usual.
 */
export async function serveMemoryMcp(
  ctx: Ctx,
  input: AsyncIterable<string | Uint8Array>,
  write: (line: string) => void,
  open: () => MemoryMcpService = () => memoryService(ctx),
): Promise<void> {
  // One service for the server's life keeps the loaded embedder; each call gets it with close muted.
  let shared: MemoryMcpService | undefined
  const make = (): MemoryMcpService => {
    shared ??= open()
    return { ...shared, close: async () => {} }
  }
  const reply = (message: object) => write(JSON.stringify(message))
  const handle = (line: string) => handleMcpLine(ctx, line, make, reply)

  const decoder = new TextDecoder()
  const state: StreamState = { pending: "", skipping: false }
  let queue: Promise<void> = Promise.resolve()
  const enqueue = (task: () => Promise<void> | void) => {
    queue = queue.then(task)
  }
  for await (const chunk of input) {
    const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true })
    consumeChunk(state, text, enqueue, handle, reply)
  }
  if (state.pending.trim() && !state.skipping) enqueue(() => handle(state.pending))
  await queue
  await shared?.close()
}

/** The command: standard input in, standard output out; the exit code is 0 once the input closes. */
export async function memoryMcpCmd(ctx: Ctx): Promise<number> {
  await serveMemoryMcp(ctx, process.stdin, (line) => {
    process.stdout.write(`${line}\n`)
  })
  return 0
}
