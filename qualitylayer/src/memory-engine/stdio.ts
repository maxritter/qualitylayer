import {
  type JsonObject,
  type PendingRequest,
  parseRpcLine,
  parseToolCallResult,
  parseToolInventory,
  settleRpcResponse,
} from "./stdio-protocol.ts"

export const MEMORY_ENGINE_TOOLS = [
  "mem_save",
  "mem_search",
  "mem_update",
  "mem_delete",
  "mem_pin",
  "mem_unpin",
  "mem_timeline",
] as const
const MAX_MESSAGE = 256 * 1024
const MAX_OUTPUT = 1024 * 1024

type MemoryStdioArgs = [
  binary: string,
  home: string,
  data: string,
  project: string,
  timeout: number,
  databaseBytes?: number,
]

export function memoryEngineEnvironment(
  home: string,
  data: string,
  project: string,
  databaseBytes = 16 * 1024 * 1024,
): Record<string, string> {
  return {
    HOME: home,
    USERPROFILE: home,
    TMPDIR: home,
    TMP: home,
    TEMP: home,
    LANG: "C.UTF-8",
    ENGRAM_DATA_DIR: data,
    ENGRAM_PROJECT: project,
    ENGRAM_CLOUD_AUTOSYNC: "0",
    ENGRAM_CLOUD_SYNC: "0",
    GOMAXPROCS: "2",
    QUALITYLAYER_MEMORY_DB_BYTES: String(databaseBytes),
  }
}

export class MemoryStdio {
  private child: Bun.Subprocess<"pipe", "pipe", "ignore">
  private pending = new Map<number, PendingRequest>()
  private sequence = 0
  private failure: Error | null = null
  private timer: ReturnType<typeof setTimeout>
  private reader: Promise<void>

  constructor(...args: MemoryStdioArgs) {
    const [binary, home, data, project, timeout, databaseBytes = 16 * 1024 * 1024] = args
    this.child = Bun.spawn([binary], {
      cwd: home,
      env: memoryEngineEnvironment(home, data, project, databaseBytes),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    })
    this.timer = setTimeout(() => this.fail(new Error("Project memory engine timed out")), timeout)
    this.reader = this.read()
    void this.child.exited.then(() => this.fail(new Error("Project memory engine exited")))
  }

  private fail(error: Error): void {
    this.failure ??= error
    for (const request of this.pending.values()) request.reject(this.failure)
    this.pending.clear()
    if (this.child.exitCode === null) this.child.kill("SIGKILL")
  }

  private drainLines(buffered: Buffer): Buffer {
    let remaining = buffered
    let newline = remaining.indexOf(10)
    while (newline !== -1) {
      if (newline > MAX_MESSAGE) throw new Error("Project memory engine message exceeds limit")
      const response = parseRpcLine(remaining.subarray(0, newline))
      settleRpcResponse(response, this.pending)
      remaining = remaining.subarray(newline + 1)
      newline = remaining.indexOf(10)
    }
    if (remaining.byteLength > MAX_MESSAGE)
      throw new Error("Project memory engine message exceeds limit")
    return remaining
  }

  private async read(): Promise<void> {
    let total = 0
    let buffered: Buffer = Buffer.alloc(0)
    try {
      for await (const chunk of this.child.stdout) {
        total += chunk.byteLength
        if (total > MAX_OUTPUT) throw new Error("Project memory engine output exceeds limit")
        buffered = this.drainLines(Buffer.concat([buffered, chunk]))
      }
      if (buffered.byteLength) throw new Error("Incomplete project memory engine response")
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error("Invalid project memory engine output"))
    }
  }

  private write(message: JsonObject): void {
    const line = `${JSON.stringify(message)}\n`
    if (Buffer.byteLength(line) > MAX_MESSAGE)
      throw new Error("Project memory engine input exceeds limit")
    if (this.failure) throw this.failure
    void Promise.resolve(this.child.stdin.write(line)).catch(() =>
      this.fail(new Error("Project memory engine input closed")),
    )
    void Promise.resolve(this.child.stdin.flush()).catch(() =>
      this.fail(new Error("Project memory engine input closed")),
    )
  }

  private rpc(method: string, params: JsonObject): Promise<JsonObject> {
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.write({ jsonrpc: "2.0", id, method, params })
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  async initialize(version: string): Promise<void> {
    const result = await this.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "qualitylayer-private-memory", version: "1" },
    })
    if ((result.serverInfo as JsonObject | undefined)?.version !== version)
      throw new Error("Unexpected pinned project memory engine version")
    this.write({ jsonrpc: "2.0", method: "notifications/initialized" })
  }

  async toolNames(): Promise<string[]> {
    const result = await this.rpc("tools/list", {})
    return parseToolInventory(result)
  }

  async call(name: (typeof MEMORY_ENGINE_TOOLS)[number], args: JsonObject): Promise<JsonObject> {
    if (!MEMORY_ENGINE_TOOLS.includes(name)) throw new Error("Project memory tool is not allowed")
    const result = await this.rpc("tools/call", { name, arguments: args })
    return parseToolCallResult(name, result)
  }

  async close(): Promise<void> {
    const deadline = setTimeout(() => this.child.kill("SIGKILL"), 500)
    try {
      try {
        await this.child.stdin.end()
      } catch {
        this.fail(new Error("Project memory engine input closed"))
      }
      await this.child.exited
      await this.reader
    } finally {
      clearTimeout(deadline)
      clearTimeout(this.timer)
      this.fail(new Error("Project memory engine closed"))
    }
  }

  abort(): void {
    this.fail(new Error("Project memory engine closed"))
  }
}
