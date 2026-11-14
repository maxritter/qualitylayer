// What this computer's page knows of its machines: the list its server answers, and what each
// machine's framed page last said waits there. One shared value, read by the frames, the switcher
// and Settings › Machines.

import { useSyncExternalStore } from "react"

import { sharedValue } from "../hooks.ts"

export type MachineState = "connecting" | "connected" | "offline" | "needs-you" | "unknown-host"

/** One machine as `GET /api/machines` lists it. */
export type Machine = {
  id: string
  name: string
  target: string
  state: MachineState
  since: number
  system?: string
  version?: string
  /** The port of this computer its page is served on, while connected. */
  port?: number
  /** Why it is not connected, when the last attempt said so. */
  reason?: string
  /** This computer's licence key is activated on it: it uses one of the key's computers. */
  activated?: true
  /** When an offline machine is tried next by itself (ms since the epoch). */
  retryAt?: number
  /** A VS Code dev container. */
  container?: true
  /** How the person reaches it (`max@mac-mini.local`), when its target is the Host name pairing wrote. */
  shown?: string
}

export type MachinesView = {
  /** Null until the list was read once. */
  machines: Machine[] | null
  /** Per machine id: what its Home lists under Needs you, as its framed page last said. */
  needsYou: Readonly<Record<string, number>>
}

const view = sharedValue<MachinesView>({ machines: null, needsYou: {} })

export const machinesView = view.get
export const useMachines = (): MachinesView => useSyncExternalStore(view.subscribe, view.get)

export async function readMachines(signal?: AbortSignal): Promise<Machine[]> {
  const response = await fetch("/api/machines", { signal: signal ?? AbortSignal.timeout(15_000) })
  const payload = (await response.json()) as { ok?: boolean; machines?: Machine[] }
  if (!response.ok || payload.ok !== true || !Array.isArray(payload.machines))
    throw new Error("The machines could not be read.")
  return payload.machines
}

export function setMachines(machines: Machine[]): void {
  const known = new Set(machines.map((machine) => machine.id))
  const current = view.get()
  // A machine that left takes its count with it.
  const needsYou = Object.fromEntries(
    Object.entries(current.needsYou).filter(([id]) => known.has(id)),
  )
  view.set({ machines, needsYou })
}

export function setNeedsYou(id: string, count: number): void {
  const current = view.get()
  if (current.needsYou[id] === count) return
  view.set({ ...current, needsYou: { ...current.needsYou, [id]: count } })
}

/** What ssh's runner says when the program is not on this computer, in a machine's reason and a check's. */
export const SSH_MISSING = "ssh was not found"

/** Set once a reply said ssh is not on this computer: Settings then says so in place of Add machine. */
const sshMissing = sharedValue<boolean>(false)
export const useSshMissing = (): boolean =>
  useSyncExternalStore(sshMissing.subscribe, sshMissing.get)
export const isSshMissing = (reason: string | undefined): boolean =>
  reason?.startsWith(SSH_MISSING) === true

/** For tests: forget everything. */
export function resetMachines(): void {
  view.set({ machines: null, needsYou: {} })
  sshMissing.set(false)
  shownPairing.set(null)
}

/** The server refused a change and said why: its words, and what stopped it (`reason`) when it named one. */
export class Refused extends Error {
  constructor(
    message: string,
    readonly reason: string | null,
    /** The last lines the machine's installer printed, when that is what failed. */
    readonly lines: string[],
  ) {
    super(message)
  }
}

const SHORT = 90_000
/** Installing and updating run an installer on the other computer. */
const LONG = 20 * 60_000

/** One request to the machines routes; the server's own words when it refuses. */
async function send<T extends { ok?: boolean }>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = SHORT,
): Promise<T> {
  const response = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: unknown
    reason?: unknown
    lines?: unknown
  }
  if (!response.ok || payload.ok !== true)
    throw new Refused(
      typeof payload.error === "string" && payload.error !== ""
        ? payload.error
        : "The machine could not be changed.",
      typeof payload.reason === "string" ? payload.reason : null,
      Array.isArray(payload.lines)
        ? payload.lines.filter((line): line is string => typeof line === "string")
        : [],
    )
  return payload
}

/** Ask this computer's server to try a machine again now. */
export const retryMachine = async (id: string): Promise<void> => {
  await send("POST", `/api/machines/${encodeURIComponent(id)}/retry`)
}

/** Give a machine another name; the server keeps what ssh reaches it by. */
export const renameMachine = async (id: string, name: string): Promise<void> => {
  await send("PATCH", `/api/machines/${encodeURIComponent(id)}`, { name })
}

/** The plain `Host` names of the person's ssh config that are not machines yet; none when unread. */
export async function readHosts(signal?: AbortSignal): Promise<string[]> {
  try {
    const response = await fetch("/api/machines/hosts", {
      signal: signal ?? AbortSignal.timeout(15_000),
    })
    const payload = (await response.json()) as { ok?: boolean; hosts?: unknown }
    if (!response.ok || payload.ok !== true || !Array.isArray(payload.hosts)) return []
    return payload.hosts.filter((host): host is string => typeof host === "string")
  } catch {
    return []
  }
}

/** Update QualityLayer on a machine that is added; the server runs the same installer as for an add. */
export async function updateMachine(id: string): Promise<{ version: string | null }> {
  const done = await send<{ ok: boolean; version?: unknown }>(
    "POST",
    `/api/machines/${encodeURIComponent(id)}/update`,
    undefined,
    LONG,
  )
  return { version: typeof done.version === "string" ? done.version : null }
}

/**
 * Forget a machine. Its licence stays where it is unless `release` is true, which deactivates it
 * on the machine first. Unless `keepKey`, QualityLayer's key is taken off it and its ssh config
 * entry here goes; nothing else there is touched.
 */
export async function removeMachine(id: string, release: boolean, keepKey = false): Promise<void> {
  // Releasing asks the machine's QualityLayer to reach the licence service, which may take a while.
  await send("DELETE", `/api/machines/${encodeURIComponent(id)}`, { release, keepKey }, 4 * 60_000)
}

/* ── Pairing: the server's job for a machine being added (server/machines/pairing.ts) ── */

export type PairingStepKey =
  | "find"
  | "reach"
  | "key"
  | "config"
  | "system"
  | "install"
  | "licence"
  | "connect"

export type PairingStep = {
  key: PairingStepKey
  state: "wait" | "now" | "done" | "fail"
  detail: string
  warn?: true
  fail?: { cause: string; fix: string; said?: string[]; again: boolean }
}

export type PairingWaiting =
  | { for: "password"; target: string; hostKey: string | null; key: string; wrong?: true }
  | { for: "keys-only"; target: string; command: string }
  | { for: "code"; target: string; prompt: string }

export type Pairing = {
  id: string
  kind: "computer" | "container"
  name: string
  target: string
  state: "running" | "waiting" | "failed" | "done"
  steps: PairingStep[]
  waiting?: PairingWaiting
  machine?: { id: string; name: string }
  started: number
}

/** A pairing the Add dialog opens on (Settings' Show, Pair again); this computer's page draws it. */
const shownPairing = sharedValue<Pairing | null>(null)
export const showPairing = (pairing: Pairing): void => shownPairing.set(pairing)
export const clearShownPairing = (): void => shownPairing.set(null)
export const useShownPairing = shownPairing.use

const pairingPath = (id: string, act = "") =>
  `/api/machines/pairings/${encodeURIComponent(id)}${act === "" ? "" : `/${act}`}`

/** Start pairing a machine: `user@host`, a running dev container, or an added machine again. */
export async function startPairing(
  what: { target: string; name?: string } | { container: string } | { machine: string },
): Promise<Pairing> {
  return (await send<{ ok: boolean; pairing: Pairing }>("POST", "/api/machines/pairings", what))
    .pairing
}

export async function readPairing(id: string): Promise<Pairing> {
  return (await send<{ ok: boolean; pairing: Pairing }>("GET", pairingPath(id))).pairing
}

/** The pairings this computer's server runs or finished lately. */
export async function readPairings(signal?: AbortSignal): Promise<Pairing[]> {
  try {
    const response = await fetch("/api/machines/pairings", {
      signal: signal ?? AbortSignal.timeout(15_000),
    })
    const payload = (await response.json()) as { ok?: boolean; pairings?: Pairing[] }
    return response.ok && Array.isArray(payload.pairings) ? payload.pairings : []
  } catch {
    return []
  }
}

/** The person's answer: the password (sent once, never kept here), a code, or "" for Done · try again. */
export async function answerPairing(id: string, text: string): Promise<Pairing> {
  return (
    await send<{ ok: boolean; pairing: Pairing }>("POST", pairingPath(id, "answer"), { text })
  ).pairing
}

export async function pairAgain(id: string): Promise<Pairing> {
  return (await send<{ ok: boolean; pairing: Pairing }>("POST", pairingPath(id, "again"))).pairing
}

export async function cancelPairing(id: string): Promise<void> {
  await send("POST", pairingPath(id, "cancel"))
}

export type DevContainer = {
  id: string
  name: string
  folder: string
  user: string
  port: number | null
  added: boolean
  /** The folder as the person reads it (`~/code/api`). */
  place?: string
}

export type DevContainers =
  | {
      docker: true
      engine: string
      containers: DevContainer[]
      snippet: { port: number; text: string }
    }
  | { docker: false; reason: string }

export async function readContainers(signal?: AbortSignal): Promise<DevContainers> {
  try {
    const response = await fetch("/api/machines/containers", {
      signal: signal ?? AbortSignal.timeout(20_000),
    })
    const payload = (await response.json()) as DevContainers & { ok?: boolean }
    if (!response.ok || payload.ok !== true) return { docker: false, reason: "No Docker found" }
    return payload
  } catch {
    return { docker: false, reason: "No Docker found" }
  }
}

/** Computers on this network that announce ssh; none when nothing answers. */
export async function readNearby(signal?: AbortSignal): Promise<{ host: string; user: string }[]> {
  try {
    const response = await fetch("/api/machines/nearby", {
      signal: signal ?? AbortSignal.timeout(15_000),
    })
    const payload = (await response.json()) as { ok?: boolean; nearby?: unknown }
    if (!response.ok || !Array.isArray(payload.nearby)) return []
    return payload.nearby.filter(
      (one): one is { host: string; user: string } =>
        typeof (one as { host?: unknown }).host === "string" &&
        typeof (one as { user?: unknown }).user === "string",
    )
  } catch {
    return []
  }
}

/** The host key a machine shows now, and whether known_hosts holds another one. */
export async function readHostKey(id: string): Promise<{ fingerprint: string; changed: boolean }> {
  return await send<{ ok: boolean; fingerprint: string; changed: boolean }>(
    "GET",
    `/api/machines/${encodeURIComponent(id)}/host-key`,
  )
}

/** Trust the host key the person was shown; the server checks it is still that one. */
export async function trustHostKey(id: string, fingerprint: string): Promise<void> {
  await send("POST", `/api/machines/${encodeURIComponent(id)}/host-key`, { fingerprint })
}

/** How many agent sessions run on a connected machine, as its server counts them; null when that is not known. */
export async function readRunning(id: string, signal?: AbortSignal): Promise<number | null> {
  try {
    const response = await fetch(`/api/machines/${encodeURIComponent(id)}/sessions`, {
      signal: signal ?? AbortSignal.timeout(15_000),
    })
    const payload = (await response.json()) as { ok?: boolean; running?: unknown }
    return response.ok && payload.ok === true && typeof payload.running === "number"
      ? payload.running
      : null
  } catch {
    return null
  }
}

/** How many computers one licence key covers. */
export const COMPUTERS_PER_KEY = 5

/** The system as a person names it: `uname`'s Darwin is macOS. */
export const systemWord = (system: string | undefined): string | null => {
  const first = system?.trim().split(/\s+/)[0] ?? ""
  if (first === "") return null
  return first === "Darwin" ? "macOS" : first
}

/** The chosen machine and the place on it, from the page's address: `#/machine/<id>/<place>`. */
export function machineRouteOf(hash: string): { id: string; place: string } | null {
  const found = /^#\/machine\/([A-Za-z0-9._~-]{1,60})(?:\/(.*))?$/.exec(hash)
  if (found === null) return null
  return { id: found[1] as string, place: found[2] ?? "" }
}

export const machineHash = (id: string, place = ""): string => `#/machine/${id}/${place}`
