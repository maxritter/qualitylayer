// machines list · add · containers · snippet · nearby · status · pair · retry · trust · rename · remove:
// the App's Machines, by command, so an agent or a script pairs a machine the same way the App does.
// Every command asks this computer's server (started when it is not running) over its key-guarded
// routes, so a pairing started here shows in the App and one started there can be read here. A
// password is never an argument: in a terminal it is asked with the input hidden, and a script
// passes it on standard input (`--password-stdin`).

import { type Ctx, ok, type Result } from "../../ctx.ts"
import { ensureCockpit, type Lock } from "../../server/lock.ts"
import { snippetOf } from "../../server/machines/containers.ts"
import type { MachineView } from "../../server/machines/manager.ts"
import type { PairingView } from "../../server/machines/pairing.ts"
import {
  addMachineCmd,
  listContainersCmd,
  listMachinesCmd,
  listNearbyCmd,
  removeMachineCmd,
  renameMachineCmd,
  trustMachineCmd,
} from "./machines-actions.ts"
import {
  askMachine,
  badMachineArgs,
  MACHINES_USAGE,
  machineFlag,
  machineNamed,
  stateWords,
} from "./machines-client.ts"
import { followPairing } from "./machines-pair.ts"

export { MACHINES_USAGE }

function snippetCmd(rest: string[]): Result<unknown> {
  const port = Number(machineFlag(rest, "port") ?? 2222)
  if (!Number.isInteger(port) || port < 1024 || port > 65_535)
    return badMachineArgs("--port takes a port from 1024 to 65535")
  const text = snippetOf(port)
  return ok({
    port,
    snippet: text,
    printed: `${text}\n\nPut these lines in .devcontainer/devcontainer.json, rebuild the container, then: qualitylayer machines add --container <name>`,
  })
}

async function pairNamedMachine(
  ctx: Ctx,
  lock: Lock,
  machine: MachineView,
  rest: string[],
): Promise<Result<unknown>> {
  const started = await askMachine(ctx, lock, {
    method: "POST",
    path: "/api/machines/pairings",
    body: { machine: machine.id },
  })
  if (!started.ok) return badMachineArgs(started.message)
  return followPairing(ctx, lock, started.body.pairing as PairingView, rest.slice(1))
}

async function retryNamedMachine(
  ctx: Ctx,
  lock: Lock,
  machine: MachineView,
  path: string,
): Promise<Result<unknown>> {
  const done = await askMachine(ctx, lock, { method: "POST", path: `${path}/retry` })
  return done.ok ? ok({ message: `Trying ${machine.name} now.` }) : badMachineArgs(done.message)
}

async function dispatchNamedMachine(
  ctx: Ctx,
  lock: Lock,
  sub: string,
  rest: string[],
): Promise<Result<unknown>> {
  const named = await machineNamed(ctx, lock, rest[0])
  if ("ok" in named) return named
  const path = `/api/machines/${encodeURIComponent(named.id)}`
  const handlers: Record<string, () => Promise<Result<unknown>> | Result<unknown>> = {
    status: () =>
      ok({ machine: named, printed: `${named.name}  ${named.target}  ${stateWords(named)}` }),
    pair: () => pairNamedMachine(ctx, lock, named, rest),
    retry: () => retryNamedMachine(ctx, lock, named, path),
    trust: () => trustMachineCmd(ctx, lock, named, path, rest),
    rename: () => renameMachineCmd(ctx, lock, named, path, rest),
    remove: () => removeMachineCmd(ctx, lock, named, path, rest),
  }
  const handler = handlers[sub]
  return handler ? handler() : badMachineArgs(MACHINES_USAGE)
}

const GENERAL_SUBS: Record<
  string,
  (ctx: Ctx, lock: Lock, rest: string[]) => Promise<Result<unknown>>
> = {
  list: (ctx, lock) => listMachinesCmd(ctx, lock),
  containers: (ctx, lock) => listContainersCmd(ctx, lock),
  nearby: (ctx, lock) => listNearbyCmd(ctx, lock),
  add: addMachineCmd,
}

export async function machinesCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const [sub, ...rest] = args
  if (sub === undefined || sub === "help" || sub === "--help") return badMachineArgs(MACHINES_USAGE)
  // The snippet needs no server: it is the same lines the App shows.
  if (sub === "snippet") return snippetCmd(rest)
  const lock = await ensureCockpit(ctx, { explicit: false })
  if (lock === null)
    return badMachineArgs("This computer's QualityLayer server could not be started.")
  const general = GENERAL_SUBS[sub]
  return general ? general(ctx, lock, rest) : dispatchNamedMachine(ctx, lock, sub, rest)
}
