import { fstatSync } from "node:fs"
import { join } from "node:path"
import { type AnchoredRoot, relativeParts } from "./anchored-root.ts"
import {
  exchangePosix,
  movePosixDirectoryExclusive,
  movePosixExclusive,
} from "./posix-mutations.ts"
import {
  openPosixRootHandle,
  removePosixEmptyDirectory,
  unlinkPosixRegularFile,
} from "./posix-root-ops.ts"
import {
  api,
  atomic,
  child,
  listing,
  openLock,
  PosixFile,
  probe,
  snapshot,
  stream,
  tryNativeLock,
} from "./posix-system.ts"

class PosixRoot implements AnchoredRoot {
  private readonly locks = new Map<string, number>()
  private closed = false

  constructor(private readonly owner: ReturnType<typeof openPosixRootHandle>) {}

  get identity() {
    return `${this.owner.identity.dev}:${this.owner.identity.ino}`
  }

  private alive() {
    if (this.closed) throw new Error("Native root is closed")
  }

  private readFrom<T>(
    path: string,
    read: (parent: ReturnType<PosixRoot["parent"]>) => T,
  ): T | null {
    let parent: ReturnType<PosixRoot["parent"]> | undefined
    try {
      parent = this.parent(path, false)
      return read(parent)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null
      throw cause
    } finally {
      parent?.close()
    }
  }

  directory(path: string): AnchoredRoot {
    this.alive()
    const parts = relativeParts(path)
    const handles: number[] = []
    let fd = this.owner.fd
    try {
      for (const part of parts) {
        fd = child(fd, part, false)
        handles.push(fd)
      }
      return new PosixRoot({
        root: join(this.owner.root, ...parts),
        handles,
        fd,
        identity: fstatSync(fd),
      })
    } catch (cause) {
      for (const held of handles.toReversed()) api().close(held)
      throw cause
    }
  }

  parent(path: string, create: boolean) {
    this.alive()
    const parts = relativeParts(path)
    const name = parts.pop() as string
    const handles: number[] = []
    let fd = this.owner.fd
    try {
      for (const part of parts) {
        fd = child(fd, part, create)
        handles.push(fd)
      }
      return {
        fd,
        name,
        close: () => {
          for (const held of handles.toReversed()) api().close(held)
        },
      }
    } catch (cause) {
      for (const held of handles.toReversed()) api().close(held)
      throw cause
    }
  }

  read(path: string, maximum: number) {
    return this.snapshot(path, maximum)?.bytes ?? null
  }

  snapshot(path: string, maximum: number) {
    return this.readFrom(path, (parent) => snapshot(parent.fd, parent.name, maximum))
  }

  probe(path: string, maximum: number) {
    return this.readFrom(path, (parent) => probe(parent.fd, parent.name, maximum))
  }

  async stream(path: string, maximum: number, consume: (bytes: Uint8Array) => Promise<void>) {
    let parent: ReturnType<PosixRoot["parent"]> | undefined
    let consuming = false
    try {
      parent = this.parent(path, false)
      return await stream(parent.fd, parent.name, maximum, async (bytes) => {
        consuming = true
        await consume(bytes)
      })
    } catch (cause) {
      if (!consuming && (cause as NodeJS.ErrnoException).code === "ENOENT") return null
      throw cause
    } finally {
      parent?.close()
    }
  }

  write(path: string, bytes: Uint8Array, replace: boolean) {
    const parent = this.parent(path, true)
    try {
      atomic(parent.fd, parent.name, bytes, replace)
    } finally {
      parent.close()
    }
  }

  entries(path: string, maximum: number) {
    this.alive()
    const handles: number[] = []
    let fd = this.owner.fd
    try {
      for (const part of relativeParts(path, true)) {
        fd = child(fd, part, false)
        handles.push(fd)
      }
      return listing(fd, maximum)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null
      throw cause
    } finally {
      for (const held of handles.toReversed()) api().close(held)
    }
  }

  moveExclusive(from: string, to: string, expectedVersion?: string) {
    return movePosixExclusive(this, from, to, expectedVersion)
  }

  exchangeState(from: string, to: string, _fromVersion: string, _toVersion: string) {
    return { from: this.snapshot(from, 10 * 1024 * 1024), to: this.snapshot(to, 10 * 1024 * 1024) }
  }

  exchange(from: string, to: string, fromVersion: string, toVersion: string) {
    return exchangePosix(this, from, to, fromVersion, toVersion)
  }

  moveDirectoryExclusive(from: string, to: string, identity: string) {
    return movePosixDirectoryExclusive(this, from, to, identity)
  }

  unlinkFile(path: string) {
    const parent = this.parent(path, false)
    try {
      unlinkPosixRegularFile(parent.fd, parent.name)
    } finally {
      parent.close()
    }
  }

  removeEmptyDirectory(path: string) {
    const parent = this.parent(path, false)
    try {
      removePosixEmptyDirectory(parent.fd, parent.name)
    } finally {
      parent.close()
    }
  }

  tryLock(path: string) {
    this.alive()
    relativeParts(path)
    let fd = this.locks.get(path)
    if (fd === undefined) {
      const parent = this.parent(path, true)
      try {
        fd = openLock(parent.fd, parent.name)
        this.locks.set(path, fd)
      } finally {
        parent.close()
      }
    }
    return tryNativeLock(fd)
  }

  assertCurrentRoot() {
    this.alive()
    const current = openPosixRootHandle(this.owner.root)
    try {
      if (
        current.identity.dev !== this.owner.identity.dev ||
        current.identity.ino !== this.owner.identity.ino
      )
        throw new Error("Registered root identity changed")
    } finally {
      for (const fd of current.handles.toReversed()) api().close(fd)
    }
  }

  close() {
    if (this.closed) return
    this.closed = true
    for (const fd of this.locks.values()) api().close(fd)
    for (const fd of this.owner.handles.toReversed()) api().close(fd)
  }
}

/** Pin every root component with O_NOFOLLOW; all later operations are descriptor-relative. */
export function openPosixRoot(root: string): AnchoredRoot {
  return new PosixRoot(openPosixRootHandle(root))
}

/** Compatibility boundary for a record that holds its final parent across caller work. */
export function openPosixFile(root: string, path: string, createParents: boolean) {
  const pinned = new PosixRoot(openPosixRootHandle(root))
  let parent: ReturnType<PosixRoot["parent"]>
  try {
    parent = pinned.parent(path, createParents)
  } catch (cause) {
    pinned.close()
    throw cause
  }
  return new PosixFile(parent, () => pinned.close())
}
