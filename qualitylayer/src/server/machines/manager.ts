// One connection and one listener per stored machine. A connection is whatever makes the machine's
// server reachable at a local end (ssh's forward; a fixture in tests); the manager then signs in on
// the machine with its key, keeps that session in memory and serves the machine's page on its port.

import type { Ctx } from "../../ctx.ts"
import type { GuardConfig } from "../guard.ts"
import { type ConnectionEvent, FIRST, next, retryAfterSeconds } from "./connection.ts"
import {
  ConnectFailure,
  type Connector,
  type Link,
  type LiveMachine,
  type Machines,
  type MachineView,
  machineViewOf,
  portInUse,
  queryMachineSessions,
  signIn,
  stillSignedIn,
  type Wait,
} from "./manager-link.ts"
import { type PassThrough, startPassThrough } from "./pass-through.ts"
import { moveMachine, readMachines, type StoredMachine } from "./store.ts"

export {
  ConnectFailure,
  type Connector,
  fixtureConnector,
  type Link,
  type Machines,
  type MachineView,
  type Wait,
} from "./manager-link.ts"

const realWait: Wait = (seconds, then) => {
  const timer = setTimeout(then, seconds * 1000)
  // A machine that is retried never keeps the server's process alive by itself.
  timer.unref?.()
  return () => clearTimeout(timer)
}

export function createMachines(
  ctx: Ctx,
  guard: GuardConfig,
  changed: () => void,
  connector: Connector | null,
  wait: Wait = realWait,
): Machines {
  return new MachineSet(ctx, guard, changed, connector, wait)
}

async function drop(machine: LiveMachine): Promise<void> {
  machine.cancelRetry?.()
  machine.link?.close()
  await machine.listener?.close()
}

class MachineSet implements Machines {
  private live = new Map<string, LiveMachine>()
  private stopped = false

  constructor(
    private ctx: Ctx,
    private guard: GuardConfig,
    private changed: () => void,
    private connector: Connector | null,
    private wait: Wait,
  ) {}

  get ownPort(): number {
    return this.guard.port
  }

  start = (): Promise<void> => this.reload().catch(() => {})

  list = (): MachineView[] => [...this.live.values()].map(machineViewOf)

  retry = (id: string): boolean => {
    const machine = this.live.get(id)
    if (machine === undefined) return false
    if (this.step(machine, { type: "try-again" })) void this.connect(machine)
    return true
  }

  sessions = async (id: string): Promise<number | null> => {
    const machine = this.live.get(id)
    return queryMachineSessions(machine?.link, machine?.connection.state === "connected")
  }

  reload = async (): Promise<void> => {
    if (this.stopped) return
    const stored = await readMachines(this.ctx)
    await this.forget(new Set(stored.map((machine) => machine.id)))
    const fresh = this.adopt(stored)
    if (fresh.length > 0) this.changed()
    await Promise.all(fresh.map((machine) => this.connect(machine)))
  }

  stop = async (): Promise<void> => {
    this.stopped = true
    const all = [...this.live.values()]
    this.live.clear()
    await Promise.all(all.map(drop))
  }

  /** Machines that left the store lose their connection and their listener. */
  private async forget(wanted: ReadonlySet<string>): Promise<void> {
    const gone = [...this.live].filter(([id]) => !wanted.has(id))
    for (const [id, machine] of gone) {
      this.live.delete(id)
      await drop(machine)
    }
    if (gone.length > 0) this.changed()
  }

  /** Take the stored machines in; the ones not known yet are returned to be connected. */
  private adopt(stored: StoredMachine[]): LiveMachine[] {
    const fresh: LiveMachine[] = []
    for (const one of stored) {
      const known = this.live.get(one.id)
      if (known === undefined) {
        const machine: LiveMachine = { stored: one, connection: FIRST, since: this.ctx.clock.now() }
        this.live.set(one.id, machine)
        fresh.push(machine)
        continue
      }
      // A rename keeps the connection.
      if (known.stored.name !== one.name) this.changed()
      known.stored = one
    }
    return fresh
  }

  private gone = (machine: LiveMachine): boolean =>
    this.stopped || this.live.get(machine.stored.id) !== machine

  /** Move the machine's connection by one event; true when a connection attempt should start now. */
  private step(machine: LiveMachine, event: ConnectionEvent): boolean {
    const before = machine.connection
    machine.connection = next(before, event)
    if (machine.connection.state !== before.state) {
      machine.since = this.ctx.clock.now()
      this.changed()
    }
    this.planRetry(machine)
    if (
      machine.connection.state === "reconnecting" &&
      (event.type === "retry" || event.type === "try-again")
    ) {
      return true
    }
    return machine.connection.state === "connecting" && before.state !== "connecting"
  }

  /** An offline machine is tried again by itself; every other state has no wait. */
  private planRetry(machine: LiveMachine): void {
    machine.cancelRetry?.()
    machine.cancelRetry = undefined
    machine.retryAt = undefined
    const seconds = retryAfterSeconds(machine.connection)
    if (seconds === null || this.connector === null) return
    machine.retryAt = this.ctx.clock.now() + seconds * 1000
    machine.cancelRetry = this.wait(seconds, () => {
      machine.cancelRetry = undefined
      if (!this.gone(machine) && this.step(machine, { type: "retry" })) void this.connect(machine)
    })
  }

  /** One attempt; the machine is `connecting` when this is called. */
  private async connect(machine: LiveMachine): Promise<void> {
    if (this.connector === null) {
      this.step(machine, { type: "failed", as: "offline" })
      return
    }
    try {
      const link = await this.connector(machine.stored)
      // Removed, or the server stopped, while ssh was still connecting.
      if (this.gone(machine)) {
        link.close()
        return
      }
      await this.serve(machine, link)
      this.step(machine, { type: "up" })
      this.watch(machine, link)
    } catch (error) {
      machine.link?.close()
      machine.link = undefined
      if (this.gone(machine)) return
      machine.reason = error instanceof Error ? error.message.slice(0, 200) : undefined
      this.step(machine, {
        type: "failed",
        as: error instanceof ConnectFailure ? error.state : "offline",
      })
    }
  }

  /** A forward that ends by itself leaves the machine offline, to be tried again. */
  private watch(machine: LiveMachine, link: Link): void {
    void link.ended?.then(() => this.lost(machine, link))
  }

  /**
   * The connection is of no use any more: its forward ended, or the machine's server stopped
   * answering behind it (it stops when idle). The next attempt starts that server again.
   */
  private lost(machine: LiveMachine, link: Link): void {
    if (this.gone(machine) || machine.link !== link) return
    machine.link = undefined
    link.close()
    this.step(machine, { type: "ended" })
  }

  /** Sign in on the machine (or keep the session of the last connection) and serve its page. */
  private async serve(machine: LiveMachine, link: Link): Promise<void> {
    machine.link?.close()
    machine.link = link
    machine.seen = { system: link.system, version: link.version }
    if (machine.access === undefined || !(await stillSignedIn(link, machine.access)))
      machine.access = await signIn(link)
    const wantedPort = link.listenPort ?? machine.stored.localPort
    const canSwap =
      machine.listener !== undefined && (wantedPort === 0 || machine.listener.port === wantedPort)
    if (canSwap) {
      machine.listener?.swap({
        end: link.end,
        machineHost: link.machineHost,
        unreachable: () => this.lost(machine, link),
      })
      return
    }
    await machine.listener?.close()
    machine.listener = await this.listen(machine, link)
  }

  /**
   * Start the machine's listener on its stored port. A port that is in use (this computer's own
   * server, another program) moves the machine to the next free port of the range, stored, instead
   * of failing the same way at every attempt.
   */
  private async listen(machine: LiveMachine, link: Link): Promise<PassThrough> {
    const tried = new Set<number>()
    for (;;) {
      const port = link.listenPort ?? machine.stored.localPort
      try {
        return await startPassThrough({
          port,
          guard: this.guard,
          end: link.end,
          machineHost: link.machineHost,
          access: () => machine.access ?? null,
          unreachable: () => this.lost(machine, link),
        })
      } catch (error) {
        if (link.listenPort !== undefined || !portInUse(error)) throw error
        tried.add(port)
        const moved = await moveMachine(this.ctx, machine.stored.id, tried, [this.guard.port])
        if (moved === null) throw error
        machine.stored = { ...machine.stored, localPort: moved }
      }
    }
  }
}
