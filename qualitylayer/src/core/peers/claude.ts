// Claude Code's side of the fabric: its session registry (one JSON record per
// live session, naming the session's messaging socket), how liveness is
// proven, and how one NDJSON frame reaches a session's socket.

import { createHash, randomUUID } from "node:crypto"
import { chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import { connect } from "node:net"
import { hostname } from "node:os"
import { dirname, join } from "node:path"
import { windows } from "../platform.ts"
import { pidAlive } from "../self.ts"
import { windowsProcessStart, windowsProcessStarts, windowsUserSid } from "../windows-processes.ts"
import {
  asRecord,
  C0_RE,
  claudeSessionsDir,
  isUuid,
  log,
  PeerError,
  readJson,
  runCmd,
} from "./base.ts"

export type ClaudeRecord = Record<string, unknown> & {
  pid?: number
  sessionId?: string
  name?: string
  cwd?: string
  status?: string
  messagingSocketPath?: string
  _path: string
}

export type Liveness = "live" | "dead" | "unverified"

/** The platform name Claude stamps on a record, so a pid from elsewhere reads as stale. */
export function pidDomain(): string {
  if (windows) return `win32:${hostname().toLowerCase()}`
  return process.platform === "darwin" ? "darwin" : process.platform
}

/** `ps -o lstart=` under a fixed locale and zone: [value, error]. */
export function procStartChecked(pid: number): [string | null, string | null] {
  if (windows) return windowsProcessStart(pid)
  const [code, out, err] = runCmd(["ps", "-o", "lstart=", "-p", String(pid)], {
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
  })
  if (code !== 0) return [null, err.trim() || `ps exited ${code}`]
  const value = out.trim()
  return value === "" ? [null, "ps returned no process start time"] : [value, null]
}

export function procStart(pid: number): string | null {
  return procStartChecked(pid)[0]
}

export function readClaudeRecords(): ClaudeRecord[] {
  const dir = claudeSessionsDir()
  let names: string[]
  try {
    names = readdirSync(dir).sort()
  } catch {
    return []
  }
  const out: ClaudeRecord[] = []
  for (const name of names) {
    if (!name.endsWith(".json")) continue
    const rec = asRecord(readJson(join(dir, name), null))
    if (rec !== null) out.push({ ...rec, _path: join(dir, name) } as ClaudeRecord)
  }
  return out
}

/**
 * Pid alive, same pid domain, and the recorded process start equal to `ps`.
 * A denied `ps` is `unverified`, never `dead`: a sandbox can hide a healthy
 * session. A record without a start cannot rule out pid reuse: `unverified`.
 */
export function recordLiveness(rec: ClaudeRecord, snapshot?: Map<number, string>): Liveness {
  const pid = rec.pid
  if (typeof pid !== "number" || !pidAlive(pid)) return "dead"
  if (rec.pidDomain !== undefined && rec.pidDomain !== null && rec.pidDomain !== pidDomain()) {
    return "dead"
  }
  const recorded = rec.procStart
  if (typeof recorded !== "string" || recorded === "") return "unverified"
  const [actual, error] =
    snapshot === undefined ? procStartChecked(pid) : [snapshot.get(pid) ?? null, null]
  if (error !== null || actual === null) return "unverified"
  const same =
    actual.trim() === recorded.trim() ||
    (windows && Number.isFinite(Date.parse(actual)) && Date.parse(actual) === Date.parse(recorded))
  return same ? "live" : "dead"
}

export function liveClaudeRecords(): ClaudeRecord[] {
  return classifyClaudeRecords(readClaudeRecords())
    .filter(([, state]) => state === "live")
    .map(([record]) => record)
}

export function classifyClaudeRecords(records: ClaudeRecord[]): [ClaudeRecord, Liveness][] {
  const snapshot = windows
    ? windowsProcessStarts(
        records.flatMap((rec) =>
          typeof rec.pid === "number" && pidAlive(rec.pid) ? [rec.pid] : [],
        ),
      )[0]
    : undefined
  return records.map((record) => [record, recordLiveness(record, snapshot)])
}

export function claudeRecordsByName(name: string, records = liveClaudeRecords()): ClaudeRecord[] {
  return records.filter((r) => r.name === name)
}

/** Records addressed by their mutable name or their stable session UUID. */
export function claudeRecordsByTarget(
  target: string,
  records = liveClaudeRecords(),
): ClaudeRecord[] {
  return isUuid(target)
    ? records.filter((r) => r.sessionId === target)
    : records.filter((r) => r.name === target)
}

function real(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

export function claudeRecordBySocket(
  socket: string,
  records = liveClaudeRecords(),
): ClaudeRecord | null {
  const want = real(socket)
  return (
    records.find(
      (r) => typeof r.messagingSocketPath === "string" && real(r.messagingSocketPath) === want,
    ) ?? null
  )
}

/** The optional `<pid>.<sha256(socket)>.key` token a session may ask senders for. */
export function peerKeyName(pid: number, socket: string): string {
  const canonical = windows ? socket.toLowerCase() : socket
  return `${pid}.${createHash("sha256").update(canonical, "utf8").digest("hex")}.key`
}

export function peerTokenFor(rec: ClaudeRecord): string | null {
  const pid = rec.pid
  const sock = rec.messagingSocketPath
  if (!pid || !sock) return null
  let raw: string
  try {
    raw = readFileSync(join(claudeSessionsDir(), peerKeyName(pid, sock)), "utf8").trim()
  } catch {
    return null
  }
  if (raw === "") return null
  try {
    const parsed = JSON.parse(raw) as unknown
    const obj = asRecord(parsed)
    if (obj !== null) {
      const token = obj.peerToken ?? obj.token
      return typeof token === "string" ? token : null
    }
    return typeof parsed === "string" ? parsed : raw
  } catch {
    return raw
  }
}

// ------------------------------------------------------------ socket allowlist

/** The folders Claude's sender will connect into. $TMPDIR is never one of them. */
export function allowlistedSocketDirs(): string[] {
  const uid = process.getuid?.() ?? 0
  const dirs: string[] = []
  if (process.platform === "darwin") {
    for (const base of ["/tmp", "/private/tmp"])
      dirs.push(`${base}/cc-socks`, `${base}/cc-socks-${uid}`)
  } else if (process.platform === "linux") {
    dirs.push(`/run/user/${uid}/cc-socks`, "/data/data/com.termux/files/usr/tmp/cc-socks")
  }
  const override = process.env.QUALITYLAYER_PEERS_SOCKET_DIR
  if (windows)
    dirs.push("\\\\.\\pipe\\LOCAL", "\\\\.\\pipe", `\\\\.\\pipe\\cc-socks-${windowsUserSid()}`)
  if (override) dirs.push(override)
  return dirs
}

export function dirIsAllowlisted(path: string): boolean {
  if (!path) return false
  const want = real(path)
  return allowlistedSocketDirs().some((d) => real(d) === want)
}

/** Refuse a symlinked endpoint, or one outside the allowlisted folders. */
export function socketPathOk(path: unknown): path is string {
  if (typeof path !== "string" || path === "") return false
  if (windows) {
    if (/^\\\\\.\\pipe\\(?:LOCAL\\)?cc-msg-[a-f0-9]{32}$/i.test(path)) return true
    // Windows IPC is a local named pipe, scoped to the current user's SID.
    return allowlistedSocketDirs().some(
      (dir) =>
        dir !== "\\\\.\\pipe" &&
        dir !== "\\\\.\\pipe\\LOCAL" &&
        dir.startsWith("\\\\.\\pipe\\") &&
        path.startsWith(`${dir}\\`) &&
        /^[A-Za-z0-9._-]+$/.test(path.slice(dir.length + 1)),
    )
  }
  try {
    if (lstatSync(path).isSymbolicLink()) return false
  } catch {
    // a socket that does not exist yet is judged by its folder
  }
  return dirIsAllowlisted(dirname(path))
}

/** Create, then verify, the socket folder: ours, a real folder, mode 700. */
export function ensureSocketDir(path: string): string {
  if (windows) {
    if (!path.startsWith("\\\\.\\pipe\\") || !dirIsAllowlisted(path)) {
      throw new PeerError(`refusing non-allowlisted Windows pipe namespace: ${path}`)
    }
    return path
  }
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const st = lstatSync(path)
  if (st.isSymbolicLink()) throw new PeerError(`refusing to bind: ${path} is a symlink`)
  if (!st.isDirectory()) throw new PeerError(`refusing to bind: ${path} is not a directory`)
  const uid = process.getuid?.()
  if (uid !== undefined && st.uid !== uid) {
    throw new PeerError(`refusing to bind: ${path} is owned by uid ${st.uid}, not ${uid}`)
  }
  if ((st.mode & 0o777) !== 0o700) {
    chmodSync(path, 0o700)
    if ((lstatSync(path).mode & 0o777) !== 0o700) {
      throw new PeerError(`refusing to bind: ${path} is not mode 700`)
    }
  }
  return path
}

/** The folder a live session's socket is in, else the platform default. */
export function defaultSocketDir(): string {
  const override = process.env.QUALITYLAYER_PEERS_SOCKET_DIR
  if (override) return override
  if (windows) return "\\\\.\\pipe\\LOCAL"
  for (const rec of liveClaudeRecords()) {
    if (typeof rec.messagingSocketPath === "string") return dirname(rec.messagingSocketPath)
  }
  return allowlistedSocketDirs()[0] ?? "/tmp/cc-socks"
}

// ------------------------------------------------------------------- frames

const WRAPPER_MARKUP_RE = /<(\/?)(cross-session-message)/gi
const REQUEST_MARKUP_RE = /<(\/?)(session-peers-request)/gi
const OPEN_FRAME = /^<cross-session-message\s+/
const CLOSE_FRAME = "</cross-session-message>"

function frameAttributes(header: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const tokens = /[A-Za-z0-9-]+/g
  for (let match = tokens.exec(header); match !== null; match = tokens.exec(header)) {
    if (!header.startsWith('="', tokens.lastIndex)) continue
    const firstLetter = match[0].search(/[A-Za-z]/)
    if (firstLetter === -1) continue
    const start = tokens.lastIndex + 2
    const end = header.indexOf('"', start)
    if (end === -1) break
    attrs[match[0].slice(firstLetter)] = header.slice(start, end)
    tokens.lastIndex = end + 1
  }
  return attrs
}

/** A visible stand-in for the `<` of a wrapper tag inside a body. */
const LT_SUBSTITUTE = "‹"
const PEER_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/

export function validPeerName(name: unknown): name is string {
  return typeof name === "string" && PEER_NAME_RE.test(name)
}

export function requirePeerName(name: unknown, what = "thread name"): string {
  if (!validPeerName(name)) {
    throw new PeerError(
      `${what} ${JSON.stringify(name)} is not usable as a peer name: only letters, digits, dot, underscore and hyphen (up to 64). /rename the thread.`,
    )
  }
  return name
}

export function escapeAttr(value: unknown): string {
  const text = (value === null || value === undefined ? "" : String(value))
    .replace(/[\r\n]/g, "")
    .replace(C0_RE, "")
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function neutraliseWrapperMarkup(body: string): string {
  return (body ?? "").replace(WRAPPER_MARKUP_RE, `${LT_SUBSTITUTE}$1$2`)
}

export function neutraliseRequestMarkup(body: string): string {
  return (body ?? "").replace(REQUEST_MARKUP_RE, `${LT_SUBSTITUTE}$1$2`)
}

/**
 * The wrapper Claude's parser accepts, without `from-mode`: Codex has no
 * Claude permission class, and claiming one would be a lie with a security
 * consequence. Every attribute is escaped and the body cannot close the element.
 */
export function buildWrapper(
  body: string,
  fromSocket: string,
  fromSession: string,
  fromName: string | null,
): string {
  const socket = String(fromSocket ?? "")
  // biome-ignore lint/suspicious/noControlCharactersInRegex: a reply address must carry no control characters
  if (/[\x00-\x1f\x7f"<>&]/.test(socket)) {
    throw new PeerError(`socket path ${JSON.stringify(socket)} cannot be put in a wrapper`)
  }
  return (
    `<cross-session-message from="uds:${escapeAttr(socket)}" from-session="${escapeAttr(fromSession)}" from-name="${escapeAttr(fromName)}">\n` +
    `${neutraliseWrapperMarkup(body)}\n</cross-session-message>`
  )
}

/** [body, attributes] of a wrapped frame; a bare one gives [content, {}]. */
export function unwrapMessage(content: unknown): [string, Record<string, string>] {
  let text: unknown = content
  if (Array.isArray(content)) {
    text = content
      .map((block) =>
        typeof block === "string"
          ? block
          : typeof asRecord(block)?.text === "string"
            ? (asRecord(block)?.text as string)
            : null,
      )
      .filter((part): part is string => part !== null)
      .join("\n")
  }
  if (typeof text !== "string") return ["", {}]
  const frame = text.trim()
  const opening = OPEN_FRAME.exec(frame)
  if (!opening || !frame.endsWith(CLOSE_FRAME)) return [text, {}]
  const end = frame.length - CLOSE_FRAME.length
  const start = frame.indexOf(">", opening[0].length)
  if (start === -1 || start >= end) return [text, {}]
  const head = frame.slice(opening[0].length, start)
  const body = frame.slice(start + 1, end).replace(/^\n|\n$/g, "")
  return [body, frameAttributes(head)]
}

export type UserFrame = {
  msgV: 1
  msg_id: string
  type: "user"
  message: { role: "user"; content: string }
  priority: "next"
  from?: string
}

/** The exact frame Claude itself sends between sessions. */
export function buildUserFrame(body: string, fromSocket?: string | null): UserFrame {
  const frame: UserFrame = {
    msgV: 1,
    msg_id: randomUUID(),
    type: "user",
    message: { role: "user", content: body },
    priority: "next",
  }
  if (fromSocket) frame.from = `uds:${fromSocket}`
  return frame
}

/** Prefix a reply with the id of the message it answers, so crossed replies can be told apart. */
export function replyText(text: string, msgId: string | null | undefined, held = false): string {
  if (!msgId) return text
  return `[${held ? "held reply, in reply to message" : "in reply to message"} ${msgId}]\n${text}`
}

/** Wrapped when the thread has a stand-in socket to reply to; bare, with its own attribution, otherwise. */
export function buildCcBody(
  text: string,
  threadId: string,
  threadName: string | null,
  shimSocket: string | null,
): string {
  if (shimSocket) return buildWrapper(text, shimSocket, threadId, threadName)
  return `Message from Codex thread ${threadName || threadId}:\n${text}`
}

/** One NDJSON frame to a peer socket; rejects on a failed connect. */
export function sendFrame(
  socketPath: string,
  frame: unknown,
  authToken: string | null = null,
  timeoutMs = 10_000,
): Promise<void> {
  if (windows && !authToken) throw new PeerError("a Windows peer requires an authentication key")
  return new Promise((resolve, reject) => {
    const sock = connect({ path: socketPath })
    const timer = setTimeout(() => {
      sock.destroy()
      reject(new Error(`timed out writing to ${socketPath}`))
    }, timeoutMs)
    sock.on("error", (cause) => {
      clearTimeout(timer)
      reject(cause)
    })
    sock.on("connect", () => {
      const lines: string[] = []
      if (authToken) lines.push(JSON.stringify({ type: "auth", token: authToken }))
      lines.push(JSON.stringify(frame))
      sock.end(`${lines.join("\n")}\n`, () => {
        clearTimeout(timer)
        resolve()
      })
    })
  })
}

/** Send one frame to a Claude session record, with its auth line when it has one. */
export async function deliverToRecord(rec: ClaudeRecord, frame: unknown): Promise<boolean> {
  const sock = rec.messagingSocketPath
  if (!socketPathOk(sock)) {
    log(`refusing to write to ${JSON.stringify(sock)}: symlink or non-allowlisted folder`)
    return false
  }
  try {
    await sendFrame(sock, frame, peerTokenFor(rec))
    return true
  } catch (cause) {
    log(`delivery to ${rec.name ?? rec.pid} failed: ${(cause as Error).message}`)
    return false
  }
}
