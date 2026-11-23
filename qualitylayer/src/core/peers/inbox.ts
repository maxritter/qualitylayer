import { mkdirSync, readdirSync } from "node:fs"
import { join } from "node:path"
import {
  asRecord,
  isUuid,
  nowIso,
  nowSeconds,
  PeerError,
  type PeerKind,
  readJson,
  stateDir,
  unlinkQuiet,
  writeJsonAtomic,
  writeJsonExclusive,
} from "./base.ts"
import { withLock } from "./lock.ts"

export type NativePeer = { kind: PeerKind; uuid: string }
const ordinaryDir = () => {
  const path = join(stateDir(), "messages")
  mkdirSync(path, { recursive: true, mode: 0o700 })
  return path
}
export const ordinaryPath = (id: string) => {
  if (!isUuid(id)) throw new PeerError("--message-id must be a UUID", 2)
  return join(ordinaryDir(), `${id}.json`)
}

function samePeer(raw: Record<string, unknown> | null, peer: NativePeer | null): boolean {
  return (
    (raw?.kind ?? null) === (peer?.kind ?? null) && (raw?.uuid ?? null) === (peer?.uuid ?? null)
  )
}

export function saveOrdinary(
  id: string,
  target: NativePeer,
  message: string,
  sender: NativePeer | null = null,
): boolean {
  const path = ordinaryPath(id)
  return withLock(`${path}.lock`, () => {
    const existing = asRecord(readJson(path, null))
    if (existing) {
      const matches =
        existing.message === message &&
        samePeer(asRecord(existing.target), target) &&
        samePeer(asRecord(existing.sender), sender)
      if (!matches) throw new PeerError("message id already belongs to different content or peers")
      return false
    }
    return writeJsonExclusive(path, {
      message_id: id,
      target,
      sender,
      message,
      created_at: nowIso(),
      expires_at: nowSeconds() + 7 * 86_400,
      delivery_status: "transport_pending",
    })
  })
}

export function updateOrdinary(
  id: string,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const path = ordinaryPath(id)
  return withLock(`${path}.lock`, () => {
    const record = asRecord(readJson(path, null))
    if (record === null) throw new PeerError(`message ${id} is unknown`)
    const updated = { ...record, ...patch }
    writeJsonAtomic(path, updated)
    return updated
  })
}

export function ordinaryStatus(record: Record<string, unknown>) {
  return record.acknowledged_at
    ? "acknowledged"
    : record.picked_up_at
      ? "picked_up"
      : record.delivery_status
}

export type OrdinaryDelivery = { createdAt: string; acknowledgedAt?: string }
const deliveryTime = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value))
export function ordinaryDelivery(id: string): OrdinaryDelivery | undefined {
  const record = asRecord(readJson(ordinaryPath(id), null))
  if (!record || !deliveryTime(record.created_at)) return undefined
  return {
    createdAt: record.created_at,
    ...(deliveryTime(record.acknowledged_at) ? { acknowledgedAt: record.acknowledged_at } : {}),
  }
}

/** Ids of the caller's unacknowledged messages saved at or after `since` (epoch seconds); records nothing. */
export function arrivedOrdinary(caller: NativePeer, since: number): string[] {
  return readdirSync(ordinaryDir())
    .filter((name) => name.endsWith(".json") && isUuid(name.slice(0, -5)))
    .flatMap((name) => {
      const record = asRecord(readJson(join(ordinaryDir(), name), null))
      if (record === null || record.acknowledged_at) return []
      const created = Date.parse(String(record.created_at ?? "")) / 1000
      return samePeer(asRecord(record.target), caller) && created >= since
        ? [name.slice(0, -5)]
        : []
    })
}

export function ownOrdinary(caller: NativePeer): Record<string, unknown>[] {
  return readdirSync(ordinaryDir())
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      const id = name.slice(0, -5)
      if (!isUuid(id)) return []
      const record = asRecord(readJson(ordinaryPath(id), null))
      if (record === null) return []
      if (Number(record.expires_at ?? 0) <= nowSeconds()) {
        unlinkQuiet(ordinaryPath(id))
        return []
      }
      const target = asRecord(record.target)
      if (
        target?.kind !== caller.kind ||
        target.uuid !== caller.uuid ||
        record.acknowledged_at ||
        (record.delivery_status === "delivery_failed" && !record.picked_up_at)
      )
        return []
      const picked = record.picked_up_at ? record : updateOrdinary(id, { picked_up_at: nowIso() })
      return [{ ...picked, status: ordinaryStatus(picked) }]
    })
}
