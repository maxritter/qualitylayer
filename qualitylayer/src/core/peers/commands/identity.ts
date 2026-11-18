import { windows } from "../../platform.ts"
import { windowsProcesses } from "../../windows-processes.ts"
import { BUDDY_KINDS, isUuid, PeerError, type PeerKind, runCmd } from "../base.ts"
import {
  type ClaudeRecord,
  claudeRecordBySocket,
  claudeRecordsByTarget,
  readClaudeRecords,
} from "../claude.ts"
import { codexThreads } from "../codex.ts"
import { nativeCaller } from "../native.ts"

import { type Args, opt } from "./arguments.ts"

export function threadFromArgs(args: Args, required = false): string | null {
  const explicit = opt(args, "from-thread")
  const value =
    explicit ??
    (callingFrom() === "cc"
      ? undefined
      : (process.env.CODEX_THREAD_ID ?? process.env.CODEX_SESSION_ID))
  if (value && !isUuid(value)) {
    if (explicit !== undefined || required)
      throw new PeerError("--from-thread/CODEX_THREAD_ID must be a UUID", 2)
    return null
  }
  if (required && !value)
    throw new PeerError(
      "a request needs --from-thread or CODEX_THREAD_ID so its origin is explicit",
      2,
    )
  return value ?? null
}

/** This process's ancestors, nearest first; null when the process table cannot be read. */
export function processAncestors(): { pid: number; name: string }[] | null {
  const parent = new Map<number, number>()
  const names = new Map<number, string>()
  if (windows) {
    const [rows, error] = windowsProcesses()
    if (error !== null) return null
    for (const row of rows) {
      parent.set(row.pid, row.ppid)
      names.set(row.pid, row.name)
    }
  } else {
    const [code, out] = runCmd(["ps", "-axo", "pid=,ppid=,comm="])
    if (code !== 0) return null
    for (const line of out.split("\n")) {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S.*)$/)
      if (match === null) continue
      const pid = Number(match[1])
      parent.set(pid, Number(match[2]))
      names.set(pid, match[3] ?? "")
    }
  }
  const chain: { pid: number; name: string }[] = []
  let current = parent.get(process.pid)
  while (
    current !== undefined &&
    current > 1 &&
    !chain.some((p) => p.pid === current) &&
    chain.length < 64
  ) {
    chain.push({ pid: current, name: names.get(current) ?? "" })
    current = parent.get(current)
  }
  return chain
}

// Inherited variables can name both agents; the nearer ancestor identifies the caller.
export function callingFrom(): "cc" | "codex" | null {
  const threadId = process.env.CODEX_THREAD_ID
  const sock = process.env.CLAUDE_CODE_MESSAGING_SOCKET
  const sid = process.env.CLAUDE_CODE_SESSION_ID
  if (!isUuid(threadId) || (!sock && !sid)) return null
  const claudePid = (sock ? claudeRecordBySocket(sock) : claudeRecordsByTarget(sid ?? "")[0])?.pid
  const codexPid = codexThreads()[0].find((t) => t.id === threadId)?.holder_pid ?? null
  for (const { pid, name } of processAncestors() ?? []) {
    if (pid === codexPid || /^codex(?:\.exe)?$/i.test(name.split(/[\\/]/).pop() ?? ""))
      return "codex"
    if (pid === claudePid) return "cc"
  }
  return null
}

/** The live Claude session this command runs in, when it runs in one. */
export function callingClaudeRecord(): ClaudeRecord | null {
  if (callingFrom() === "codex") return null
  const sock = process.env.CLAUDE_CODE_MESSAGING_SOCKET
  if (sock) return claudeRecordBySocket(sock)
  const sid = process.env.CLAUDE_CODE_SESSION_ID
  if (isUuid(sid)) {
    const matches = claudeRecordsByTarget(sid as string)
    return matches.length === 1 ? (matches[0] as ClaudeRecord) : null
  }
  return null
}

export function currentClaudeSessionId(): string | null {
  if (callingFrom() === "codex") return null
  const sid = process.env.CLAUDE_CODE_SESSION_ID
  if (sid) return sid
  const sock = process.env.CLAUDE_CODE_MESSAGING_SOCKET
  if (sock) return claudeRecordBySocket(sock, readClaudeRecords())?.sessionId ?? null
  return null
}

export function parseTyped(value: string): { kind: PeerKind; uuid: string } {
  const index = value.indexOf(":")
  const kind = value.slice(0, index)
  const id = value.slice(index + 1)
  if (index === -1 || !(BUDDY_KINDS as readonly string[]).includes(kind) || !isUuid(id)) {
    throw new PeerError(`expected cc:<uuid> or codex:<uuid>, got ${JSON.stringify(value)}`, 2)
  }
  return { kind: kind as PeerKind, uuid: id }
}

/** The typed identity of the session running this command. */
export function callerIdentity(args: Args): { kind: PeerKind; uuid: string } {
  const explicit = opt(args, "as")
  if (explicit !== undefined) return parseTyped(explicit)
  const native = nativeCaller()
  if (native) return native
  const sid = currentClaudeSessionId()
  if (sid) {
    if (!isUuid(sid))
      throw new PeerError(`this Claude session's id ${JSON.stringify(sid)} is not a UUID`, 2)
    return { kind: "cc", uuid: sid }
  }
  const tid = threadFromArgs(args)
  if (tid) return { kind: "codex", uuid: tid }
  throw new PeerError("cannot tell which session is asking; pass --as", 2)
}
