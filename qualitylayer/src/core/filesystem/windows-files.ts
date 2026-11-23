import { createHash } from "node:crypto"
import type { NativeFileProbe, NativeFileSnapshot, NativeFileStream } from "./anchored-root.ts"
import {
  access,
  api,
  failure,
  type HeldParent,
  openChild,
  requireKind,
  requireReadableKind,
  share,
} from "./windows-system.ts"

export { atomic, dispose, listing, lock, rename } from "./windows-files-write.ts"

export function readHeld(handle: bigint, maximum: number, maximumLinks = 1): NativeFileSnapshot {
  if (!Number.isSafeInteger(maximum) || maximum < 0) throw new Error("Invalid record byte cap")
  const before = requireKind(handle, false, maximumLinks)
  if (before.size > BigInt(maximum)) throw new Error("Unsafe or oversized owner record")
  if (!api().SetFilePointerEx(handle, 0n, null, 0)) throw failure("Seek native file")
  const bytes = Buffer.alloc(Number(before.size)),
    count = Buffer.alloc(4)
  let used = 0
  while (used < bytes.length) {
    const chunk = bytes.subarray(used, used + 1024 * 1024)
    if (!api().ReadFile(handle, chunk, chunk.length, count, null)) throw failure("Read native file")
    const received = count.readUInt32LE()
    if (!received || received > chunk.length) throw new Error("Incomplete native file read")
    used += received
  }
  if (before.version !== requireKind(handle, false, maximumLinks).version)
    throw new Error("Owner record changed during read")
  return {
    bytes,
    identity: before.identity,
    version: `${before.version}:${createHash("sha256").update(bytes).digest("hex")}`,
  }
}

export function bounded(parent: HeldParent, maximum: number): NativeFileSnapshot {
  const handle = openChild(parent.handle, parent.name, {
    desired: access.read,
    disposition: 1,
    directory: false,
  })
  try {
    return readHeld(handle, maximum)
  } finally {
    api().CloseHandle(handle)
  }
}

export async function stream(
  parent: HeldParent,
  maximum: number,
  consume: (bytes: Uint8Array) => Promise<void>,
): Promise<NativeFileStream> {
  if (!Number.isSafeInteger(maximum) || maximum < 0) throw new Error("Invalid stream byte cap")
  const handle = openChild(parent.handle, parent.name, {
    desired: access.read,
    disposition: 1,
    directory: false,
  })
  try {
    const before = requireKind(handle, false)
    if (before.size > BigInt(maximum)) throw new Error("Unsafe or oversized streamed source")
    const bytes = Buffer.alloc(64 * 1024),
      count = Buffer.alloc(4)
    let used = 0
    for (;;) {
      if (!api().ReadFile(handle, bytes, bytes.length, count, null))
        throw failure("Read streamed source")
      const received = count.readUInt32LE()
      if (!received) break
      used += received
      if (received > bytes.length || BigInt(used) > before.size)
        throw new Error("Source changed during stream")
      await consume(bytes.subarray(0, received))
    }
    if (BigInt(used) !== before.size || before.version !== requireKind(handle, false).version)
      throw new Error("Source changed during stream")
    return {
      identity: before.identity,
      version: before.version,
      size: used,
      mtimeMs: before.mtimeMs,
    }
  } finally {
    api().CloseHandle(handle)
  }
}

export function probe(parent: HeldParent, maximum: number): NativeFileProbe {
  if (!Number.isSafeInteger(maximum) || maximum < 0) throw new Error("Invalid tail byte cap")
  const handle = openChild(parent.handle, parent.name, {
    desired: access.read,
    disposition: 1,
    directory: false,
    sharing: share.read | share.write,
    readOnly: true,
  })
  try {
    const info = requireReadableKind(handle, false)
    const size = Number(info.size)
    if (!Number.isSafeInteger(size)) throw new Error("Unsafe native probe file size")
    const bytes = Buffer.alloc(Math.min(size, maximum)),
      count = Buffer.alloc(4)
    if (bytes.length && !api().SetFilePointerEx(handle, BigInt(size - bytes.length), null, 0))
      throw failure("Seek native tail")
    let used = 0
    while (used < bytes.length) {
      const chunk = bytes.subarray(used, used + 1024 * 1024)
      if (!api().ReadFile(handle, chunk, chunk.length, count, null))
        throw failure("Read native tail")
      const received = count.readUInt32LE()
      if (!received) break
      if (received > chunk.length) throw new Error("Invalid native tail read")
      used += received
    }
    return { bytes: bytes.subarray(0, used), size, mtimeMs: info.mtimeMs }
  } finally {
    api().CloseHandle(handle)
  }
}

/** Windows permits restoring ChangeTime; the held, deny-write stream must match too. */
export function verifyVersion(handle: bigint, expected: string) {
  const before = requireKind(handle, false)
  if (
    !expected.startsWith(`${before.version}:`) ||
    readHeld(handle, Number(before.size)).version !== expected
  )
    throw new Error("Moved source version changed")
}
