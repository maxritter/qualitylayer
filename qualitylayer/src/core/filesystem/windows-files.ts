import { createHash, randomUUID } from "node:crypto"
import type {
  AnchoredEntry,
  NativeFileProbe,
  NativeFileSnapshot,
  NativeFileStream,
} from "./anchored-root.ts"
import {
  access,
  api,
  checked,
  failure,
  type HeldParent,
  openChild,
  pointer,
  requireKind,
  requireReadableKind,
  share,
  utf16,
  windowsRelativeParts,
} from "./windows-system.ts"

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
export function rename(handle: bigint, target: HeldParent, replace: boolean) {
  if (windowsRelativeParts(target.name).length !== 1)
    throw new Error("Native rename requires one relative component")
  requireKind(target.handle, true)
  const name = utf16(target.name).subarray(0, -2)
  // FILE_RENAME_INFORMATION on x64: BOOLEAN, 7 padding, HANDLE, ULONG, WCHAR[].
  const bytes = Buffer.alloc(20 + name.length)
  bytes[0] = Number(replace)
  pointer(bytes, 8, target.handle)
  bytes.writeUInt32LE(name.length, 16)
  name.copy(bytes, 20)
  checked(
    api().NtSetInformationFile(handle, Buffer.alloc(16), bytes, bytes.length, 10),
    "Rename native file",
  )
}
export function dispose(handle: bigint) {
  checked(
    api().NtSetInformationFile(handle, Buffer.alloc(16), Buffer.from([1]), 1, 13),
    "Remove native object",
  )
}
export function atomic(parent: HeldParent, bytes: Uint8Array, replace: boolean) {
  const temporary = { ...parent, name: `.qualitylayer-${randomUUID()}.tmp` }
  const handle = openChild(parent.handle, temporary.name, {
    desired: access.write | access.delete,
    disposition: 2,
    directory: false,
  })
  let committed = false
  try {
    const count = Buffer.alloc(4)
    let used = 0
    while (used < bytes.length) {
      const chunk = bytes.subarray(used, used + 1024 * 1024)
      if (!api().WriteFile(handle, chunk, chunk.length, count, null))
        throw failure("Write native file")
      const written = count.readUInt32LE()
      if (!written || written > chunk.length) throw new Error("Incomplete native file write")
      used += written
    }
    if (!api().FlushFileBuffers(handle)) throw failure("Flush native file")
    let existing = 0n
    try {
      existing = openChild(parent.handle, parent.name, {
        desired: access.attributes,
        disposition: 1,
        directory: false,
        sharing: 7,
      })
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause
    } finally {
      if (existing) api().CloseHandle(existing)
    }
    rename(handle, parent, replace)
    committed = true
  } finally {
    try {
      if (!committed) dispose(handle)
    } finally {
      api().CloseHandle(handle)
    }
  }
}
export function lock(handle: bigint) {
  requireKind(handle, false)
  if (api().LockFileEx(handle, 3, 0, 1, 0, Buffer.alloc(32))) return true
  if (api().GetLastError() === 33) return false
  throw failure("Lock native file")
}

function entry(bytes: Buffer, used: number): AnchoredEntry | null {
  if (used < 64 || used > bytes.length) throw new Error("Invalid native directory entry")
  const length = bytes.readUInt32LE(60)
  if (length % 2 || length === 0 || length > used - 64)
    throw new Error("Invalid native directory name")
  const name = bytes.toString("utf16le", 64, 64 + length)
  if (name === "." || name === "..") return null
  windowsRelativeParts(name)
  const attributes = bytes.readUInt32LE(56)
  if (attributes & (0x400 | 0x40)) return { name, kind: "other" }
  return { name, kind: attributes & 0x10 ? "directory" : "file" }
}

export function listing(handle: bigint, maximum: number) {
  const entries: AnchoredEntry[] = []
  let restart = true
  for (;;) {
    requireKind(handle, true)
    const bytes = Buffer.alloc(4096),
      iosb = Buffer.alloc(16)
    const status = api().NtQueryDirectoryFile(
      handle,
      null,
      null,
      null,
      iosb,
      bytes,
      bytes.length,
      1,
      1,
      null,
      Number(restart),
    )
    restart = false
    if (status >>> 0 === 0x80000006) return entries // STATUS_NO_MORE_FILES
    checked(status, "Enumerate native directory")
    const decoded = entry(bytes, Number(iosb.readBigUInt64LE(8)))
    if (!decoded) continue
    if (entries.length === maximum) throw new Error("Directory entry cap exceeded")
    entries.push(decoded)
  }
}
