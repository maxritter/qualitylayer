import { read, toArrayBuffer } from "bun:ffi"
import { randomUUID } from "node:crypto"
import { constants, fsyncSync, writeSync } from "node:fs"
import { type AnchoredEntry, relativeParts } from "./anchored-root.ts"
import {
  api,
  child,
  closeOnExec,
  cString,
  directoryFlags,
  failure,
  openLock,
  tryNativeLock,
} from "./posix-ffi.ts"
import { bounded, fileVersion, probe, snapshot, stream } from "./posix-read.ts"

export {
  api,
  bounded,
  child,
  closeOnExec,
  cString,
  directoryFlags,
  failure,
  fileVersion,
  openLock,
  probe,
  snapshot,
  stream,
  tryNativeLock,
}

const fileFlags =
  constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW | closeOnExec

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
  const dirStream = api().fdopendir(copied)
  if (!dirStream) {
    api().close(copied)
    throw failure("Read directory")
  }
  const entries: AnchoredEntry[] = []
  try {
    while (true) {
      api().clearError()
      const entry = api().readdir(dirStream)
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
    api().closedir(dirStream)
  }
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
