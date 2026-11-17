// The machines this computer reaches over ssh: a name, how ssh reaches it, and the local port its
// page is served on. Nothing that signs in is ever stored here: no password, no key, no server key.

import { join } from "node:path"

import type { Ctx } from "../../ctx.ts"

export type StoredMachine = {
  /** Stable, safe in a route and a link: letters, digits and `._~-`. */
  id: string
  /** The person's name for it; need not be the host name. */
  name: string
  /** Native ssh destination: a config host or `user@host`, optionally with an explicit port. */
  target: string
  /** The port of this computer its page is served on; kept, so the page keeps its saved state. */
  localPort: number
  added: number
  /**
   * This computer's key was activated on the machine when it was added (and not released since).
   * Absent for a machine on its own trial or key, and for entries saved before this was kept.
   */
  activated?: true
  /** The marked config block pairing owns; it may add only an identity to a native host. */
  alias?: string
  /** QualityLayer's own key was put in its authorized_keys; Remove can take it out again. */
  ownKey?: true
  /** A VS Code dev container, by the folder it was opened from: a rebuilt one is paired again by itself. */
  container?: { folder: string }
  /** What the person typed when it was paired (`user@host:2222`), so the same machine is not added twice. */
  typed?: string
}

/** What pairing records besides the name and the target. */
export type PairedBy = Pick<StoredMachine, "alias" | "ownKey" | "container" | "typed">

/** One listener per machine; the range belongs to this computer's server. */
export const FIRST_MACHINE_PORT = 41940
export const LAST_MACHINE_PORT = 41999

/** What this computer's page may frame: each port of the range by name, since a policy knows no range. */
export const MACHINE_FRAME_SOURCES = Array.from(
  { length: LAST_MACHINE_PORT - FIRST_MACHINE_PORT + 1 },
  (_, n) => `http://127.0.0.1:${FIRST_MACHINE_PORT + n}`,
).join(" ")

const storePath = (ctx: Ctx) => join(ctx.home, "machines.json")

/**
 * What an id may be, for every consumer: the store, ssh's forward, a `#/machine/<id>/` route and a
 * `qualitylayer://machine/<id>` link (the page's and the shell's patterns take the same characters).
 * A host's dots stay in the id, so an entry saved with one keeps working.
 */
export const isMachineId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9._~-]{1,60}$/.test(id) && id !== "." && id !== ".."

const isStored = (value: unknown): value is StoredMachine => {
  if (typeof value !== "object" || value === null) return false
  const m = value as Record<string, unknown>
  if (!isMachineId(m.id)) return false
  if (typeof m.name !== "string" || typeof m.target !== "string") return false
  return isMachinePort(m.localPort) && typeof m.added === "number"
}

const isMachinePort = (port: unknown): port is number =>
  typeof port === "number" &&
  Number.isInteger(port) &&
  port >= FIRST_MACHINE_PORT &&
  port <= LAST_MACHINE_PORT

/** The stored machines, oldest first. A missing or unreadable file means none. */
export async function readMachines(ctx: Ctx): Promise<StoredMachine[]> {
  try {
    const stored: unknown = JSON.parse(await ctx.fs.readFile(storePath(ctx)))
    if (!Array.isArray(stored)) return []
    const seen = new Set<string>()
    return stored.filter((m): m is StoredMachine => {
      if (!isStored(m) || seen.has(m.id)) return false
      seen.add(m.id)
      return true
    })
  } catch {
    return []
  }
}

async function change<T>(ctx: Ctx, action: (machines: StoredMachine[]) => T): Promise<T> {
  await ctx.fs.mkdir(ctx.home)
  return ctx.fs.withLock(join(ctx.home, "machines.json.lock"), async () => {
    const machines = await readMachines(ctx)
    const result = action(machines)
    await ctx.fs.atomicWrite(storePath(ctx), `${JSON.stringify(machines, null, 2)}\n`, {
      mode: 0o600,
    })
    return result
  })
}

/** A machine's id from its name: what a route and a `qualitylayer://` link can carry. */
export function machineId(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._~-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 40) || "machine"
  // `this` names this computer in the page's switcher.
  let id = base === "this" ? "machine" : base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

export type AddRefusal = "no-port" | "duplicate" | "bad-target" | "bad-name"

/** What ssh accepts as one argument and cannot read as an option. */
export const isTarget = (target: string): boolean =>
  /^[A-Za-z0-9._~@:[\]-]{1,255}$/.test(target) && !target.startsWith("-")

/** `user@host:2223` → the unchanged native destination and its explicit port. */
export function splitTarget(typed: string): { target: string; port?: number } {
  const found = /^(.+@[^:@[\]]+):(\d{1,5})$/.exec(typed) ?? /^([^:@[\]]+):(\d{1,5})$/.exec(typed)
  if (found === null) return { target: typed }
  const port = Number(found[2])
  return port > 0 && port < 65_536 ? { target: found[1] as string, port } : { target: typed }
}

const cleanName = (name: string): string => name.replace(/\s+/g, " ").trim().slice(0, 60)

export type AddOptions = {
  /** Ports of this computer that no machine may take: its own server's, even inside the range. */
  avoid?: readonly number[]
  /** This computer's key was activated on the machine. */
  activated?: boolean
  paired?: PairedBy
}

/** The lowest free port for a machine, or why it cannot be added. Two machines never share a target. */
function place(
  machines: readonly StoredMachine[],
  target: string,
  avoid: readonly number[],
): number | AddRefusal {
  if (!isTarget(target)) return "bad-target"
  if (machines.some((m) => m.target === target)) return "duplicate"
  const used = new Set([...machines.map((m) => m.localPort), ...avoid])
  let localPort = FIRST_MACHINE_PORT
  while (used.has(localPort)) localPort++
  return localPort > LAST_MACHINE_PORT ? "no-port" : localPort
}

/**
 * What the add would refuse, asked before anything is installed or activated on the machine; null
 * when it would go on. The add itself asks again under the lock, for a change made meanwhile.
 */
export async function refusalBefore(
  ctx: Ctx,
  target: string,
  avoid: readonly number[],
): Promise<AddRefusal | null> {
  const found = place(await readMachines(ctx), target.trim(), avoid)
  return typeof found === "string" ? found : null
}

/** Store a machine on the lowest free port. Two machines never share an ssh target. */
export function addMachine(
  ctx: Ctx,
  wanted: { name: string; target: string },
  options: AddOptions = {},
): Promise<StoredMachine | AddRefusal> {
  return change(ctx, (machines) => {
    const target = wanted.target.trim()
    const name = cleanName(wanted.name) || target
    const localPort = place(machines, target, options.avoid ?? [])
    if (typeof localPort === "string") return localPort
    const machine: StoredMachine = {
      id: machineId(name, new Set(machines.map((m) => m.id))),
      name,
      target,
      localPort,
      added: ctx.clock.now(),
      ...(options.activated === true ? { activated: true as const } : {}),
      ...options.paired,
    }
    machines.push(machine)
    return machine
  })
}

/**
 * A machine could not bind its port (it is in use): give it the next free port of the range after
 * it, skipping the ports of the other machines, the ones named in `avoid` and the ones `tried`
 * already. The id stays. Null when the machine is gone or no port is left.
 */
export function moveMachine(
  ctx: Ctx,
  id: string,
  tried: ReadonlySet<number>,
  avoid: readonly number[],
): Promise<number | null> {
  return change(ctx, (machines) => {
    const machine = machines.find((m) => m.id === id)
    if (machine === undefined) return null
    const taken = new Set([
      ...machines.filter((m) => m !== machine).map((m) => m.localPort),
      ...avoid,
      ...tried,
    ])
    const size = LAST_MACHINE_PORT - FIRST_MACHINE_PORT + 1
    for (let step = 1; step <= size; step++) {
      const port = FIRST_MACHINE_PORT + ((machine.localPort - FIRST_MACHINE_PORT + step) % size)
      if (taken.has(port)) continue
      machine.localPort = port
      return port
    }
    return null
  })
}

/** The name is the person's; the id and the port stay, so links and the page's saved state hold. */
export function renameMachine(
  ctx: Ctx,
  id: string,
  name: string,
): Promise<StoredMachine | AddRefusal | null> {
  return change(ctx, (machines) => {
    const machine = machines.find((m) => m.id === id)
    if (machine === undefined) return null
    const next = cleanName(name)
    if (next === "") return "bad-name"
    machine.name = next
    return machine
  })
}

/** Pairing again recorded how the machine is reached now; the id, name and port stay. */
export function repairedMachine(
  ctx: Ctx,
  id: string,
  patch: { target: string; paired: PairedBy },
): Promise<StoredMachine | null> {
  return change(ctx, (machines) => {
    const machine = machines.find((m) => m.id === id)
    if (machine === undefined) return null
    if (isTarget(patch.target)) machine.target = patch.target
    Object.assign(machine, patch.paired)
    return machine
  })
}

export function removeMachine(ctx: Ctx, id: string): Promise<StoredMachine | null> {
  return change(ctx, (machines) => {
    const at = machines.findIndex((m) => m.id === id)
    return at < 0 ? null : (machines.splice(at, 1)[0] ?? null)
  })
}
