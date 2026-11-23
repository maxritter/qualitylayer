import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { isNativeAgent } from "../agents/ids.ts"
import { isSessionProof, type SessionAnswer, type SessionProof } from "./session-proof.ts"
import type { Task } from "./store.ts"

export type PickedTarget = {
  id: string
  question: string
  session: string
  openedAt: number
  gateOpenedAt?: number
}

type ConsumedCall = Pick<SessionProof, "agent" | "session" | "callId" | "recordedAt"> & {
  members: { id: string; question: string }[]
}
type Ledger = { version: 1; calls: ConsumedCall[] }
const MAX_CALLS = 4096
const MAX_BYTES = 2 * 1024 * 1024
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Tell me more remains open after its native call was consumed; it must not look unrecorded. */
export async function pickedCallComplete(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  proof: SessionProof,
): Promise<boolean> {
  if (!isSessionProof(proof)) return false
  try {
    const ledger = await readLedger(ctx, join(task.runtimeDir, "picked-calls.json"))
    const call = ledger?.calls.find(
      (value) =>
        value.agent === proof.agent &&
        value.session === proof.session &&
        value.callId === proof.callId &&
        value.recordedAt === proof.recordedAt,
    )
    return (
      call !== undefined &&
      proof.answers.every((answer) =>
        call.members.some((member) => same(member.question, answer.question)),
      )
    )
  } catch {
    return false
  }
}

function isValidMember(member: unknown): boolean {
  const m = object(member)
  return m !== null && typeof m.id === "string" && typeof m.question === "string"
}

function isValidConsumedCall(entry: unknown): boolean {
  const call = object(entry)
  if (!call || !isNativeAgent(call.agent)) return false
  if (typeof call.session !== "string" || typeof call.callId !== "string") return false
  if (typeof call.recordedAt !== "number" || !Number.isFinite(call.recordedAt)) return false
  return (
    Array.isArray(call.members) && call.members.length <= 100 && call.members.every(isValidMember)
  )
}

async function readLedger(ctx: Ctx, file: string): Promise<Ledger | null> {
  if (!(await ctx.fs.exists(file))) return { version: 1, calls: [] }
  const info = await ctx.fs.stat?.(file)
  if (info && info.size > MAX_BYTES) return null
  const text = await ctx.fs.readFile(file)
  if (Buffer.byteLength(text) > MAX_BYTES) return null
  const value = object(JSON.parse(text))
  const valid =
    value?.version === 1 &&
    Array.isArray(value.calls) &&
    value.calls.length <= MAX_CALLS &&
    value.calls.every(isValidConsumedCall)
  return valid ? (value as Ledger) : null
}

function validPickedTarget(
  target: PickedTarget | null,
  proof: SessionProof,
): target is PickedTarget {
  if (!target?.id || target.session !== proof.session) return false
  if (!Number.isFinite(target.openedAt) || proof.recordedAt <= target.openedAt) return false
  if (target.gateOpenedAt === undefined) return true
  return Number.isFinite(target.gateOpenedAt) && proof.recordedAt > target.gateOpenedAt
}

function reserveLedgerCall(ledger: Ledger, proof: SessionProof, target: PickedTarget): boolean {
  const known = ledger.calls.find(
    (call) =>
      call.agent === proof.agent && call.session === proof.session && call.callId === proof.callId,
  )
  const alreadyConsumed = known?.members.some(
    (member) => member.id === target.id || same(member.question, target.question),
  )
  if (alreadyConsumed) return false
  if (known) {
    if (known.recordedAt !== proof.recordedAt || known.members.length >= 100) return false
    known.members.push({ id: target.id, question: target.question })
    return true
  }
  if (ledger.calls.length >= MAX_CALLS) return false
  ledger.calls.push({
    agent: proof.agent,
    session: proof.session,
    callId: proof.callId,
    recordedAt: proof.recordedAt,
    members: [{ id: target.id, question: target.question }],
  })
  return true
}

async function writeReservedCall(
  ctx: Ctx,
  file: string,
  proof: SessionProof,
  target: PickedTarget,
): Promise<string | null> {
  const ledger = await readLedger(ctx, file)
  if (!ledger) return null
  const before = `${JSON.stringify(ledger)}\n`
  if (!reserveLedgerCall(ledger, proof, target)) return null
  const serialized = `${JSON.stringify(ledger)}\n`
  if (Buffer.byteLength(serialized) > MAX_BYTES) return null
  await ctx.fs.atomicWrite(file, serialized)
  return before
}

async function consumeLockedCall(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  proof: SessionProof,
  consumer: {
    target: () => Promise<PickedTarget | null>
    apply: (answer: SessionAnswer, target: PickedTarget) => Promise<boolean>
  },
): Promise<boolean> {
  const target = await consumer.target()
  if (!validPickedTarget(target, proof)) return false
  const answers = proof.answers.filter((answer) => same(answer.question, target.question))
  const answer = answers.length === 1 ? answers[0] : undefined
  if (!answer) return false
  const file = join(task.runtimeDir, "picked-calls.json")
  const before = await writeReservedCall(ctx, file, proof, target)
  if (before === null) return false
  try {
    if (await consumer.apply(answer, target)) return true
  } catch {
    // A normal application failure is retryable; a process crash leaves the reservation.
  }
  await ctx.fs.atomicWrite(file, before)
  return false
}

/** A native call can answer each of its members once; the current target is read inside the lock. */
export async function consumePickedCall(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  proof: SessionProof,
  consumer: {
    target: () => Promise<PickedTarget | null>
    apply: (answer: SessionAnswer, target: PickedTarget) => Promise<boolean>
  },
): Promise<boolean> {
  if (!isSessionProof(proof)) return false
  try {
    await ctx.fs.mkdir(task.runtimeDir)
    return await ctx.fs.withLock(join(task.runtimeDir, "picked-calls.lock"), () =>
      consumeLockedCall(ctx, task, proof, consumer),
    )
  } catch {
    return false
  }
}
