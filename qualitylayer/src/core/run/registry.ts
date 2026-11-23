import { randomUUID } from "node:crypto"
import { existsSync, lstatSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { isAgentKind, isRunPurpose, type RunRecord } from "./contracts.ts"
import { cleanupOwned, signalOwned } from "./registry-cleanup.ts"
import { connectHost, type HostConnection, startHost } from "./registry-host.ts"
import {
  launchOwner,
  privateDir,
  readHost,
  readLaunch,
  readToken,
  recordLock,
  runDir,
  setLaunchPhase,
  socketPath,
  withRunRecord,
  writeHost,
  writeLaunch,
  writePrivate,
  writeToken,
} from "./registry-io.ts"
import { identityState, ownedProcesses, processIdentity } from "./registry-ownership.ts"
import { reconcileRuns } from "./registry-reconcile.ts"
import { activeRun, listRuns, readRun } from "./registry-state.ts"

export {
  activeRun,
  cleanupOwned,
  connectHost,
  type HostConnection,
  identityState,
  listRuns,
  ownedProcesses,
  processIdentity,
  readHost,
  readLaunch,
  readRun,
  readToken,
  reconcileRuns,
  runDir,
  setLaunchPhase,
  signalOwned,
  socketPath,
  startHost,
  withRunRecord,
  writeHost,
  writeLaunch,
  writeToken,
}

type CreateRunInput = Pick<RunRecord, "agent" | "cwd" | "purpose" | "idempotencyKey"> &
  Partial<
    Pick<
      RunRecord,
      "settings" | "nativeSession" | "sourceCheckout" | "artifactBinding" | "previousRun"
    >
  >

function assertValidPreviousRun(home: string, records: RunRecord[], input: CreateRunInput): void {
  if (!input.previousRun) return
  const prev = input.previousRun
  const source = records.find((record) => record.id === prev.id)
  const matchesIdentity =
    source !== undefined &&
    source.generation === prev.generation &&
    source.nativeSession === prev.nativeSession
  const cleanAndMatching =
    source !== undefined &&
    source.status === "stopped" &&
    source.cleanup?.complete === true &&
    !activeRun(home, source)
  const sameTarget =
    source !== undefined && source.agent === input.agent && source.cwd === resolve(input.cwd)
  if (!matchesIdentity || !cleanAndMatching || !sameTarget)
    throw new Error(
      "The previous conversation identity and cleanup must be verified before allocation",
    )
}

export function createRun(home: string, input: CreateRunInput): RunRecord {
  if (!isRunPurpose(input.purpose)) throw new Error("invalid run purpose")
  if (!isAgentKind(input.agent) || !input.idempotencyKey || input.idempotencyKey.length > 256)
    throw new Error("invalid run start")
  privateDir(join(home, "runs"))
  return recordLock(join(home, "runs", ".registry.lock"), () => {
    const records = listRuns(home)
    const previous = records.find((run) => run.idempotencyKey === input.idempotencyKey)
    if (previous) {
      if (
        previous.agent !== input.agent ||
        (previous.sourceCheckout ?? previous.cwd) !== resolve(input.cwd) ||
        JSON.stringify(previous.purpose) !== JSON.stringify(input.purpose) ||
        (input.previousRun !== undefined &&
          JSON.stringify(previous.previousRun) !== JSON.stringify(input.previousRun))
      )
        throw new Error("idempotency key belongs to another start")
      return previous
    }
    assertValidPreviousRun(home, records, input)
    const now = new Date().toISOString()
    const run: RunRecord = {
      ...input,
      cwd: resolve(input.cwd),
      id: randomUUID(),
      generation: 1,
      status: "validated",
      startPhase: "validated",
      launchOwner: launchOwner(1),
      startedAt: now,
      updatedAt: now,
    }
    privateDir(runDir(home, run.id))
    writePrivate(join(runDir(home, run.id), "run.json"), run)
    return run
  })
}

/** Retention and Resume share one transaction boundary; a stale sweep cannot remove a new generation. */
export function removeCompletedRun(
  home: string,
  id: string,
  expectedGeneration: number,
  beforeRemove?: (run: Readonly<RunRecord>) => void,
): boolean {
  const dir = runDir(home, id)
  if (!existsSync(dir)) return false
  return recordLock(join(home, "runs", ".registry.lock"), () => {
    const st = lstatSync(dir)
    if (!st.isDirectory() || st.isSymbolicLink() || (process.getuid && st.uid !== process.getuid()))
      return false
    return recordLock(join(dir, ".record.lock"), () => {
      const run = readRun(home, id)
      if (!run || run.generation !== expectedGeneration || activeRun(home, run)) return false
      beforeRemove?.(run)
      rmSync(dir, { recursive: true, force: true })
      return true
    })
  })
}

export function updateRun(
  home: string,
  id: string,
  generation: number,
  patch:
    | Partial<Omit<RunRecord, "id" | "generation" | "purpose">>
    | ((
        run: Readonly<RunRecord>,
      ) => Partial<Omit<RunRecord, "id" | "generation" | "purpose">> | null),
): RunRecord {
  return recordLock(join(runDir(home, id), ".record.lock"), () => {
    const run = readRun(home, id)
    if (!run || run.generation !== generation) throw new Error("stale or missing run generation")
    const change = typeof patch === "function" ? patch(run) : patch
    if (change === null) return run
    const next = {
      ...run,
      ...change,
      id: run.id,
      generation: run.generation,
      purpose: run.purpose,
      updatedAt: new Date().toISOString(),
    }
    writePrivate(join(runDir(home, id), "run.json"), next)
    return next
  })
}

export function nextGeneration(
  home: string,
  id: string,
  expected: number,
  patch: Partial<Omit<RunRecord, "id" | "generation" | "purpose">> = {},
  guard?: (run: Readonly<RunRecord>) => void,
): RunRecord {
  return recordLock(join(home, "runs", ".registry.lock"), () =>
    recordLock(join(runDir(home, id), ".record.lock"), () => {
      const run = readRun(home, id)
      if (!run || run.generation !== expected) throw new Error("stale or missing run generation")
      guard?.(run)
      if (!["stopped", "failed"].includes(run.status))
        throw new Error("run must be stopped before its next generation")
      if (activeRun(home, run))
        throw new Error("run cleanup must finish before its next generation")
      const next: RunRecord = {
        ...run,
        ...patch,
        id: run.id,
        purpose: run.purpose,
        generation: expected + 1,
        generationStartedAt: new Date().toISOString(),
        launchOwner: launchOwner(expected + 1),
        updatedAt: new Date().toISOString(),
      }
      writePrivate(join(runDir(home, id), "run.json"), next)
      return next
    }),
  )
}
