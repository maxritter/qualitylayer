import { dlopen, read, toArrayBuffer } from "bun:ffi"
import { randomUUID } from "node:crypto"
import { constants, fstatSync, fsyncSync, readSync, type Stats, writeSync } from "node:fs"
import { sameFileIdentity } from "../../regular-file.ts"
import {
  type AnchoredEntry,
  type NativeFileProbe,
  type NativeFileSnapshot,
  type NativeFileStream,
  relativeParts,
} from "./anchored-root.ts"

export const cString = (value: string) => Buffer.from(`${value}\0`, "utf8")
export const closeOnExec = process.platform === "darwin" ? 0x01000000 : 0x00080000
export const directoryFlags =
  constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | closeOnExec
const fileFlags =
  constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW | closeOnExec

function system() {
  const darwin = process.platform === "darwin"
  if (!darwin && process.platform !== "linux") throw new Error("POSIX record writes require POSIX")
  const library = darwin ? "libSystem.B.dylib" : "libc.so.6"
  const common = dlopen(library, {
    mkdirat: { args: ["i32", "ptr", "u32"], returns: "i32" },
    renameat: { args: ["i32", "ptr", "i32", "ptr"], returns: "i32" },
    unlinkat: { args: ["i32", "ptr", "i32"], returns: "i32" },
    flock: { args: ["i32", "i32"], returns: "i32" },
    fdopendir: { args: ["i32"], returns: "ptr" },
    readdir: { args: ["ptr"], returns: "ptr" },
    closedir: { args: ["ptr"], returns: "i32" },
    close: { args: ["i32"], returns: "i32" },
  })
  if (darwin) {
    const extra = dlopen(library, {
      // Apple's public variadic wrapper reads mode from the arm64 varargs stack. Its fixed
      // syscall entry is required for a four-argument FFI call; never call variadic O_CREAT.
      __openat: { args: ["i32", "ptr", "i32", "u32"], returns: "i32" },
      __error: { args: [], returns: "ptr" },
      renameatx_np: { args: ["i32", "ptr", "i32", "ptr", "u32"], returns: "i32" },
    })
    return {
      ...common.symbols,
      openat: extra.symbols.__openat,
      error: () => read.i32(extra.symbols.__error() as number),
      clearError: () =>
        new DataView(toArrayBuffer(extra.symbols.__error() as number, 0, 4)).setInt32(0, 0, true),
      exclusive: (fromFd: number, from: Buffer, toFd: number, to: Buffer) =>
        extra.symbols.renameatx_np(fromFd, from, toFd, to, 4),
      exchange: (fromFd: number, from: Buffer, toFd: number, to: Buffer) =>
        extra.symbols.renameatx_np(fromFd, from, toFd, to, 2),
    }
  }
  const extra = dlopen(library, {
    openat: { args: ["i32", "ptr", "i32", "u32"], returns: "i32" },
    __errno_location: { args: [], returns: "ptr" },
    renameat2: { args: ["i32", "ptr", "i32", "ptr", "u32"], returns: "i32" },
  })
  return {
    ...common.symbols,
    openat: extra.symbols.openat,
    error: () => read.i32(extra.symbols.__errno_location() as number),
    clearError: () =>
      new DataView(toArrayBuffer(extra.symbols.__errno_location() as number, 0, 4)).setInt32(
        0,
        0,
        true,
      ),
    exclusive: (fromFd: number, from: Buffer, toFd: number, to: Buffer) =>
      extra.symbols.renameat2(fromFd, from, toFd, to, 1),
    exchange: (fromFd: number, from: Buffer, toFd: number, to: Buffer) =>
      extra.symbols.renameat2(fromFd, from, toFd, to, 2),
  }
}
let loaded: ReturnType<typeof system> | undefined
export const api = () => (loaded ??= system())
export const failure = (operation: string) => {
  const errno = api().error()
  const linked = errno === 20 || errno === (process.platform === "darwin" ? 62 : 40)
  return Object.assign(
    new Error(
      `${linked ? "Linked or non-directory path: " : ""}${operation} failed (errno ${errno})`,
    ),
    {
      code: linked
        ? "ELOOP"
        : (({ 2: "ENOENT", 17: "EEXIST" } as Record<number, string>)[errno] ?? "EIO"),
      errno,
    },
  )
}

export function child(parent: number, name: string, create: boolean) {
  const encoded = cString(name)
  let fd = api().openat(parent, encoded, directoryFlags, 0)
  if (fd >= 0) return fd
  if (!create || api().error() !== 2) throw failure("Open owner directory")
  if (api().mkdirat(parent, encoded, 0o700) !== 0 && api().error() !== 17)
    throw failure("Create owner directory")
  fd = api().openat(parent, encoded, directoryFlags, 0)
  if (fd < 0) throw failure("Open created owner directory")
  return fd
}

function regularRead(parent: number, name: string, maximum: number) {
  if (!Number.isSafeInteger(maximum) || maximum < 0) throw new Error("Invalid record byte cap")
  const fd = api().openat(
    parent,
    cString(name),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | closeOnExec,
    0,
  )
  if (fd < 0) throw failure("Open owner record")
  try {
    const before = fstatSync(fd)
    if (!before.isFile() || before.size > maximum)
      throw new Error("Unsafe or oversized owner record")
    const bytes = new Uint8Array(Math.min(before.size + 1, maximum + 1))
    let used = 0
    while (used < bytes.length) {
      const count = readSync(fd, bytes, used, bytes.length - used, used)
      if (!count) break
      used += count
    }
    if (used !== before.size || !sameFileIdentity(before, fstatSync(fd)))
      throw new Error("Owner record changed during read")
    return { bytes: bytes.subarray(0, used), info: before }
  } finally {
    api().close(fd)
  }
}

const fileObjectIdentity = (info: Stats) => JSON.stringify([info.dev, info.ino, info.birthtimeMs])
export const fileVersion = (info: Stats) =>
  JSON.stringify([fileObjectIdentity(info), info.size, info.mtimeMs, info.ctimeMs, info.mode])

export function bounded(parent: number, name: string, maximum: number) {
  return regularRead(parent, name, maximum).bytes
}

export function snapshot(parent: number, name: string, maximum: number): NativeFileSnapshot {
  const { bytes, info } = regularRead(parent, name, maximum)
  return { bytes, identity: fileObjectIdentity(info), version: fileVersion(info) }
}

export async function stream(
  parent: number,
  name: string,
  maximum: number,
  consume: (bytes: Uint8Array) => Promise<void>,
): Promise<NativeFileStream> {
  if (!Number.isSafeInteger(maximum) || maximum < 0) throw new Error("Invalid stream byte cap")
  const fd = api().openat(
    parent,
    cString(name),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | closeOnExec,
    0,
  )
  if (fd < 0) throw failure("Open streamed source")
  try {
    const before = fstatSync(fd)
    if (!before.isFile() || before.size > maximum)
      throw new Error("Unsafe or oversized streamed source")
    const bytes = new Uint8Array(64 * 1024)
    let used = 0
    for (;;) {
      const count = readSync(fd, bytes, 0, bytes.length, used)
      if (!count) break
      used += count
      if (used > before.size) throw new Error("Source changed during stream")
      await consume(bytes.subarray(0, count))
    }
    if (used !== before.size || !sameFileIdentity(before, fstatSync(fd)))
      throw new Error("Source changed during stream")
    return {
      identity: fileObjectIdentity(before),
      version: fileVersion(before),
      size: used,
      mtimeMs: before.mtimeMs,
    }
  } finally {
    api().close(fd)
  }
}

export function probe(parent: number, name: string, maximum: number): NativeFileProbe {
  if (!Number.isSafeInteger(maximum) || maximum < 0) throw new Error("Invalid tail byte cap")
  const fd = api().openat(
    parent,
    cString(name),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | closeOnExec,
    0,
  )
  if (fd < 0) throw failure("Open native probe")
  try {
    const info = fstatSync(fd)
    if (!info.isFile() || !Number.isSafeInteger(info.size))
      throw new Error("Unsafe native probe file")
    const bytes = Buffer.alloc(Math.min(info.size, maximum))
    let used = 0
    while (used < bytes.length) {
      const count = readSync(fd, bytes, used, bytes.length - used, info.size - bytes.length + used)
      if (!count) break
      used += count
    }
    return { bytes: bytes.subarray(0, used), size: info.size, mtimeMs: info.mtimeMs }
  } finally {
    api().close(fd)
  }
}

export function atomic(parent: number, name: string, bytes: Uint8Array, replace: boolean) {
  const temporary = cString(`.${name}.${randomUUID()}.tmp`)
  const fd = api().openat(parent, temporary, fileFlags, 0o600)
  if (fd < 0) throw failure("Create owner temporary file")
  try {
    let offset = 0
    while (offset < bytes.length) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset)
      if (written <= 0) throw new Error("Incomplete owner file write")
      offset += written
    }
    fsyncSync(fd)
    const target = cString(name)
    const result = replace
      ? api().renameat(parent, temporary, parent, target)
      : api().exclusive(parent, temporary, parent, target)
    if (result !== 0) throw failure("Commit owner file")
  } finally {
    api().close(fd)
    api().unlinkat(parent, temporary, 0)
  }
}

function directoryEntry(entry: number | bigint): AnchoredEntry | null {
  const darwin = process.platform === "darwin"
  const offset = darwin ? 21 : 19
  const length = read.u16(entry, 16)
  if (length <= offset || length > 4096) throw new Error("Invalid native directory entry")
  const bytes = new Uint8Array(toArrayBuffer(entry, offset, length - offset))
  const end = bytes.indexOf(0)
  if (end < 0) throw new Error("Unterminated native directory entry")
  const name = new TextDecoder("utf8", { fatal: true }).decode(bytes.subarray(0, end))
  if (name === "." || name === "..") return null
  relativeParts(name)
  const type = read.u8(entry, darwin ? 20 : 18)
  return { name, kind: type === 8 ? "file" : type === 4 ? "directory" : "other" }
}

export function listing(fd: number, maximum: number): AnchoredEntry[] {
  if (!Number.isSafeInteger(maximum) || maximum < 0) throw new Error("Invalid directory entry cap")
  const copied = api().openat(fd, cString("."), directoryFlags, 0)
  if (copied < 0) throw failure("Duplicate directory")
  const stream = api().fdopendir(copied)
  if (!stream) {
    api().close(copied)
    throw failure("Read directory")
  }
  const entries: AnchoredEntry[] = []
  try {
    while (true) {
      api().clearError()
      const entry = api().readdir(stream)
      if (!entry) {
        if (api().error()) throw failure("Enumerate directory")
        return entries
      }
      const decoded = directoryEntry(entry)
      if (!decoded) continue
      if (entries.length === maximum) throw new Error("Directory entry cap exceeded")
      entries.push(decoded)
    }
  } finally {
    api().closedir(stream)
  }
}

export function openLock(parent: number, name: string) {
  const fd = api().openat(
    parent,
    cString(name),
    constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW | closeOnExec,
    0o600,
  )
  if (fd < 0) throw failure("Open owner lock")
  const info = fstatSync(fd)
  if (!info.isFile() || info.nlink !== 1) {
    api().close(fd)
    throw new Error("Unsafe owner lock file")
  }
  return fd
}

export function tryNativeLock(fd: number) {
  if (api().flock(fd, 2 | 4) === 0) return true
  if ([11, 35].includes(api().error())) return false
  throw failure("Lock owner file")
}

type HeldParent = { fd: number; name: string; close(): void }

/** One regular file retains its parent and optional lock until its caller closes it. */
export class PosixFile {
  private closed = false
  private lock: number | undefined

  constructor(
    private readonly parent: HeldParent,
    private readonly closeRoot: () => void,
  ) {}

  private alive() {
    if (this.closed) throw new Error("Native file is closed")
  }

  read(maximum: number) {
    this.alive()
    return bounded(this.parent.fd, this.parent.name, maximum)
  }

  write(bytes: Uint8Array, replace: boolean) {
    this.alive()
    atomic(this.parent.fd, this.parent.name, bytes, replace)
  }

  tryLock() {
    this.alive()
    this.lock ??= openLock(this.parent.fd, this.parent.name)
    return tryNativeLock(this.lock)
  }

  close() {
    if (this.closed) return
    this.closed = true
    if (this.lock !== undefined) api().close(this.lock)
    this.parent.close()
    this.closeRoot()
  }
}
