import { createHash } from "node:crypto"
import { chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { type Env, realCtx } from "../../ctx.ts"
import { detectAgent, sessionVariables } from "../agents/detect.ts"
import { NATIVE_PEERS_MAX } from "../home-caps.ts"
import type { ProcessIdentity } from "../run/contracts.ts"
import { identityState } from "../run/registry.ts"
import { protectWindowsObject } from "../run/windows.ts"
import { sessionKey } from "../task/binding.ts"
import { isUuid, PeerError, stateDir, unlinkQuiet } from "./base.ts"
import { ResolveError, ResolveNotFound } from "./codex.ts"
import { resetNativeReplyBudget } from "./native-delivery.ts"
import { dropHookQueue } from "./native-queue.ts"

export {
  deliverNative,
  nativeReplyBudget,
  peerEnvelope,
  resetNativeReplyBudget,
} from "./native-delivery.ts"
export {
  isPeerEnvelope,
  queueHookMessage,
  takeHookMessages,
} from "./native-queue.ts"
export {
  nativeRegistrationCommand,
  registerHookPeer,
  registerNative,
  unregisterHookPeer,
} from "./native-register.ts"

/** Pi and OpenCode reach a session through the socket of their in-process plugin. */
export const SOCKET_KINDS = ["pi", "opencode"] as const
/**
 * Agents with a hook file and no plugin API: their hooks register the session and hand it queued
 * messages, at the end of a turn and with the next prompt.
 */
export const HOOK_PEER_KINDS = ["copilot", "grok", "cursor", "antigravity"] as const
export const NATIVE_KINDS = [...SOCKET_KINDS, ...HOOK_PEER_KINDS] as const
export type NativeKind = (typeof NATIVE_KINDS)[number]
export type HookPeerKind = (typeof HOOK_PEER_KINDS)[number]
export const isNativeKind = (kind: unknown): kind is NativeKind =>
  (NATIVE_KINDS as readonly unknown[]).includes(kind)
export const isHookPeerKind = (kind: unknown): kind is HookPeerKind =>
  (HOOK_PEER_KINDS as readonly unknown[]).includes(kind)

export type NativeRegistration = {
  kind: NativeKind
  uuid: string
  session: string
  name: string
  cwd: string
  port?: number
  token?: string
  identity: ProcessIdentity
  status: "busy" | "idle"
  updated: string
  key?: string
  peerTurn?: boolean
}

const REGISTRATION_FILE = new RegExp(`^(${NATIVE_KINDS.join("|")})-[a-f0-9-]{36}\\.json$`)
export const MAX_NATIVE = NATIVE_PEERS_MAX
let protectedDirectory: string | undefined

export const nativeDir = () => {
  const dir = join(stateDir(), "native")
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (protectedDirectory !== dir) {
    const stat = lstatSync(dir)
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw new PeerError("Unsafe native peer directory")
    if (process.platform === "win32") protectWindowsObject(dir, true)
    else chmodSync(dir, 0o700)
    protectedDirectory = dir
  }
  return dir
}

export function nativeStorageAvailable(): void {
  if (readdirSync(nativeDir()).length >= MAX_NATIVE * 4)
    throw new PeerError("Native peer storage is full")
}

export function nativePeerId(kind: NativeKind, session: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(session)) throw new PeerError("Invalid native session id", 2)
  if (kind === "pi" && isUuid(session)) return session.toLowerCase()
  const hash = createHash("sha256").update(`${kind}:${session}`).digest("hex").slice(0, 32)
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`
}

export const pathOf = (kind: NativeKind, id: string) => {
  if (!isUuid(id)) throw new PeerError("Invalid native peer id", 2)
  return join(nativeDir(), `${kind}-${id}.json`)
}

function hasValidSocketEndpoint(row: NativeRegistration): boolean {
  if (isHookPeerKind(row.kind)) return true
  const validPort =
    Number.isInteger(row.port) && (row.port as number) >= 1 && (row.port as number) <= 65535
  return validPort && /^[a-f0-9]{64}$/.test(row.token ?? "")
}

function isValidRegistrationRow(row: NativeRegistration, path: string): boolean {
  if (!isNativeKind(row.kind) || row.uuid !== nativePeerId(row.kind, row.session)) return false
  if (path !== pathOf(row.kind, row.uuid) || !hasValidSocketEndpoint(row)) return false
  return Boolean(row.identity) && Number.isSafeInteger(row.identity.pid)
}

export function nativeRegistrations(): NativeRegistration[] {
  return readdirSync(nativeDir())
    .filter((name) => REGISTRATION_FILE.test(name))
    .slice(0, MAX_NATIVE + 1)
    .flatMap((name) => {
      const path = join(nativeDir(), name)
      try {
        if (statSync(path).size > 16384) return []
        const row = JSON.parse(readFileSync(path, "utf8")) as NativeRegistration
        if (!isValidRegistrationRow(row, path)) return []
        if (identityState(row.identity) === "dead") {
          unlinkQuiet(path)
          resetNativeReplyBudget(row)
          dropHookQueue(row)
          return []
        }
        return [row]
      } catch {
        return []
      }
    })
}

function matchesNativeTarget(row: NativeRegistration, kind: NativeKind, target: string): boolean {
  if (row.kind !== kind) return false
  if (row.uuid === target || row.session === target || row.name === target) return true
  return target.length >= 8 && row.uuid.startsWith(target)
}

export function resolveNative(kind: NativeKind, target: string): NativeRegistration {
  const rows = nativeRegistrations().filter((r) => matchesNativeTarget(r, kind, target))
  if (rows.length === 0)
    throw new ResolveNotFound(`No live ${kind} session matches ${JSON.stringify(target)}`)
  if (rows.length !== 1)
    throw new ResolveError(
      `Several ${kind} sessions match ${JSON.stringify(target)}; use a full UUID`,
    )
  const row = rows[0] as NativeRegistration
  if (identityState(row.identity) !== "live")
    throw new ResolveError(`Cannot verify ${kind} session ownership`)
  return row
}

export function nativeCallerOf(env: Pick<Env, "get">): { kind: NativeKind; uuid: string } | null {
  const kind = detectAgent(env)
  if (kind === "pi" || kind === "opencode") {
    const session = env.get(kind === "pi" ? "PI_SESSION_ID" : "OPENCODE_SESSION_ID")
    return session ? { kind, uuid: nativePeerId(kind, session) } : null
  }
  if (!isHookPeerKind(kind)) return null
  const direct = sessionVariables(kind)
    .map((name) => env.get(name)?.trim())
    .find(Boolean)
  if (direct)
    return /^[A-Za-z0-9_-]{1,128}$/.test(direct) ? { kind, uuid: nativePeerId(kind, direct) } : null
  const key = sessionKey(env)
  if (key === null) return null
  const rows = nativeRegistrations().filter((row) => row.kind === kind && row.key === key)
  return rows.length === 1 ? { kind, uuid: (rows[0] as NativeRegistration).uuid } : null
}

export const nativeCaller = () => nativeCallerOf(realCtx().env)
