import { win32 } from "node:path"
import { type AnchoredRoot, relativeParts } from "./anchored-root.ts"
import { exchangeFiles } from "./windows-exchange.ts"
import {
  atomic,
  bounded,
  dispose,
  listing,
  lock,
  probe,
  rename,
  stream,
  verifyVersion,
} from "./windows-files.ts"
import {
  access,
  api,
  close,
  failure,
  type HeldParent,
  openChild,
  requireKind,
  requireReadableKind,
  share,
  utf16,
  windowsRelativeParts,
} from "./windows-system.ts"

export { windowsRelativeParts } from "./windows-system.ts"

export function windowsRootParts(root: string) {
  if (!/^[A-Za-z]:\\/.test(root) || root.includes("/"))
    throw new Error("Native Windows root must be an absolute local drive directory")
  return {
    drive: root.slice(0, 3),
    parts: windowsRelativeParts(root.slice(3).replaceAll("\\", "/"), true),
  }
}

function child(parent: bigint, name: string, create: boolean) {
  const spec = {
    desired: access.read,
    disposition: 1,
    directory: true,
    sharing: share.read | share.write,
  }
  try {
    return openChild(parent, name, spec)
  } catch (cause) {
    if (!create || (cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause
  }
  try {
    return openChild(parent, name, { ...spec, disposition: 2 })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause
    return openChild(parent, name, spec)
  }
}
function rootOf(root: string) {
  const parsed = windowsRootParts(root)
  const opened = api().CreateFileW(
    utf16(`\\\\?\\${parsed.drive}`),
    access.read | access.attributes | access.sync,
    share.read | share.write,
    null,
    3,
    0x02000000 | 0x00200000,
    null,
  )
  const drive = opened ? BigInt(opened) : 0n
  if (!drive || drive === -1n || drive === 0xffffffffffffffffn)
    throw failure("Pin native volume root")
  const handles = [drive]
  try {
    requireKind(drive, true)
    const filesystem = Buffer.alloc(64)
    if (!api().GetVolumeInformationByHandleW(drive, null, 0, null, null, null, filesystem, 32))
      throw failure("Query native filesystem")
    if (filesystem.toString("utf16le").replace(/\0.*$/s, "") !== "NTFS")
      throw new Error("Native Windows directory I/O requires NTFS")
    let handle = drive
    for (const part of parsed.parts) {
      handle = child(handle, part, false)
      handles.push(handle)
    }
    return { root, handle, handles, identity: requireKind(handle, true).identity }
  } catch (cause) {
    close(handles)
    throw cause
  }
}

class WindowsRoot implements AnchoredRoot {
  private closed = false
  private readonly locks = new Map<string, { handle: bigint; acquired: boolean }>()
  constructor(private readonly owner: ReturnType<typeof rootOf>) {}
  get identity() {
    return this.owner.identity
  }
  private alive() {
    if (this.closed) throw new Error("Native root is closed")
    requireKind(this.owner.handle, true)
  }
  parent(path: string, create: boolean): HeldParent {
    this.alive()
    const parts = windowsRelativeParts(path),
      name = parts.pop() as string,
      handles: bigint[] = []
    let handle = this.owner.handle
    try {
      for (const part of parts) {
        handle = child(handle, part, create)
        handles.push(handle)
      }
      return { handle, name, close: () => close(handles) }
    } catch (cause) {
      close(handles)
      throw cause
    }
  }
  directory(path: string): AnchoredRoot {
    this.alive()
    const parts = windowsRelativeParts(path),
      handles: bigint[] = []
    let handle = this.owner.handle
    try {
      for (const part of parts) {
        handle = child(handle, part, false)
        handles.push(handle)
      }
      return new WindowsRoot({
        root: win32.join(this.owner.root, ...parts),
        handle,
        handles,
        identity: requireKind(handle, true).identity,
      })
    } catch (cause) {
      close(handles)
      throw cause
    }
  }
  read(path: string, maximum: number) {
    return this.snapshot(path, maximum)?.bytes ?? null
  }
  snapshot(path: string, maximum: number) {
    return this.readFrom(path, (parent) => bounded(parent, maximum))
  }
  probe(path: string, maximum: number) {
    return this.readFrom(path, (parent) => probe(parent, maximum))
  }

  async stream(path: string, maximum: number, consume: (bytes: Uint8Array) => Promise<void>) {
    let parent: HeldParent | undefined
    let consuming = false
    try {
      parent = this.parent(path, false)
      return await stream(parent, maximum, async (bytes) => {
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
  private readFrom<T>(path: string, read: (parent: HeldParent) => T): T | null {
    let parent: HeldParent | undefined
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
  write(path: string, bytes: Uint8Array, replace: boolean) {
    const parent = this.parent(path, true)
    try {
      atomic(parent, bytes, replace)
    } finally {
      parent.close()
    }
  }
  entries(path: string, maximum: number) {
    this.alive()
    if (!Number.isSafeInteger(maximum) || maximum < 0)
      throw new Error("Invalid directory entry cap")
    const handles: bigint[] = []
    let handle = this.owner.handle
    try {
      for (const part of windowsRelativeParts(path, true)) {
        handle = child(handle, part, false)
        handles.push(handle)
      }
      return listing(handle, maximum)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null
      throw cause
    } finally {
      close(handles)
    }
  }
  moveExclusive(from: string, to: string, expectedVersion?: string) {
    const source = this.parent(from, false)
    let target: HeldParent | undefined,
      handle = 0n
    try {
      windowsRelativeParts(to)
      handle = openChild(source.handle, source.name, {
        desired: access.read | access.delete,
        disposition: 1,
        directory: false,
      })
      const before = requireKind(handle, false)
      if (expectedVersion !== undefined) verifyVersion(handle, expectedVersion)
      target = this.parent(to, true)
      rename(handle, target, false)
      if (requireKind(handle, false).contentVersion !== before.contentVersion)
        throw new Error("Moved source identity or content changed")
    } finally {
      if (handle) api().CloseHandle(handle)
      target?.close()
      source.close()
    }
  }
  exchangeState(from: string, to: string, fromVersion: string, toVersion: string) {
    const source = this.parent(from, false)
    let target: HeldParent | undefined
    try {
      target = this.parent(to, false)
      return exchangeFiles(source, target, fromVersion, toVersion, false)
    } finally {
      target?.close()
      source.close()
    }
  }
  exchange(from: string, to: string, fromVersion: string, toVersion: string) {
    const source = this.parent(from, false)
    let target: HeldParent | undefined
    try {
      target = this.parent(to, false)
      exchangeFiles(source, target, fromVersion, toVersion, true)
      this.assertCurrentRoot()
    } finally {
      target?.close()
      source.close()
    }
  }
  moveDirectoryExclusive(from: string, to: string, identity: string) {
    const source = this.parent(from, false)
    let target: HeldParent | undefined,
      handle = 0n
    try {
      handle = openChild(source.handle, source.name, {
        desired: access.read | access.delete,
        disposition: 1,
        directory: true,
        sharing: share.read | share.write,
      })
      if (requireKind(handle, true).identity !== identity)
        throw new Error("Moved directory identity changed")
      target = this.parent(to, true)
      rename(handle, target, false)
      if (requireKind(handle, true).identity !== identity)
        throw new Error("Moved directory was replaced")
      this.assertCurrentRoot()
    } finally {
      if (handle) api().CloseHandle(handle)
      target?.close()
      source.close()
    }
  }

  private remove(path: string, directory: boolean) {
    const parent = this.parent(path, false)
    let handle = 0n
    try {
      handle = openChild(parent.handle, parent.name, {
        desired: access.delete,
        disposition: 1,
        directory,
        sharing: share.read | share.write,
      })
      dispose(handle)
    } finally {
      if (handle) api().CloseHandle(handle)
      parent.close()
    }
  }
  unlinkFile(path: string) {
    this.remove(path, false)
  }
  removeEmptyDirectory(path: string) {
    this.remove(path, true)
  }
  tryLock(path: string) {
    this.alive()
    let held = this.locks.get(path)
    if (!held) {
      const parent = this.parent(path, true)
      try {
        held = {
          handle: openChild(parent.handle, parent.name, {
            desired: access.read | access.write,
            disposition: 3,
            directory: false,
            sharing: share.read | share.write,
          }),
          acquired: false,
        }
        this.locks.set(path, held)
      } finally {
        parent.close()
      }
    }
    held.acquired ||= lock(held.handle)
    return held.acquired
  }
  assertCurrentRoot() {
    this.alive()
    const current = rootOf(this.owner.root)
    try {
      if (current.identity !== this.identity) throw new Error("Registered root identity changed")
    } finally {
      close(current.handles)
    }
  }
  close() {
    if (this.closed) return
    this.closed = true
    close([...this.locks.values()].map((held) => held.handle))
    close(this.owner.handles)
  }
}

export function openWindowsRoot(root: string): AnchoredRoot {
  return new WindowsRoot(rootOf(root))
}

function readPathParts(path: string) {
  const plain = path.startsWith("\\\\?\\UNC\\")
    ? `\\\\${path.slice(8)}`
    : path.startsWith("\\\\?\\")
      ? path.slice(4)
      : path
  if (/^[A-Za-z]:\\/.test(plain)) {
    const parsed = windowsRootParts(plain)
    return { volume: `\\\\?\\${parsed.drive}`, parts: parsed.parts }
  }
  if (!plain.startsWith("\\\\")) throw new Error("Native read requires an absolute filesystem path")
  const [server, shareName, ...parts] = relativeParts(plain.slice(2).replaceAll("\\", "/"))
  if (!server || !shareName || !parts.length)
    throw new Error("Native read requires a UNC file path")
  if (/[<>"|?*]/u.test(server + shareName)) throw new Error("Invalid native UNC authority")
  return {
    volume: `\\\\?\\UNC\\${server}\\${shareName}\\`,
    parts: windowsRelativeParts(parts.join("/")),
  }
}

/** Read-only local/UNC pinning; registered mutation roots retain their NTFS restriction. */
export function probeWindowsFile(path: string, maximum: number) {
  const { volume, parts } = readPathParts(path)
  const name = parts.pop()
  if (!name) throw new Error("Native read requires a regular file")
  const opened = api().CreateFileW(
    utf16(volume),
    access.read | access.attributes | access.sync,
    share.read | share.write,
    null,
    3,
    0x02000000 | 0x00200000,
    null,
  )
  const root = opened ? BigInt(opened) : 0n
  if (!root || root === -1n || root === 0xffffffffffffffffn) throw failure("Pin native read root")
  const handles = [root]
  try {
    requireReadableKind(root, true)
    let handle = root
    for (const part of parts) {
      handle = openChild(handle, part, {
        desired: access.read,
        disposition: 1,
        directory: true,
        sharing: share.read | share.write,
        readOnly: true,
      })
      handles.push(handle)
    }
    return probe({ handle, name, close: () => {} }, maximum)
  } finally {
    close(handles)
  }
}

/** Record files share the same backend and keep their native parent alive until close. */
export function openWindowsFile(runtime: string, file: string, createParents: boolean) {
  const root = new WindowsRoot(rootOf(runtime))
  let parent: HeldParent
  try {
    parent = root.parent(file, createParents)
  } catch (cause) {
    root.close()
    throw cause
  }
  let closed = false,
    lockHandle = 0n,
    acquired = false
  const alive = () => {
    if (closed) throw new Error("Native file is closed")
    requireKind(parent.handle, true)
  }
  return {
    read(maximum: number) {
      alive()
      return bounded(parent, maximum).bytes
    },
    write(bytes: Uint8Array, replace: boolean) {
      alive()
      atomic(parent, bytes, replace)
    },
    tryLock() {
      alive()
      lockHandle ||= openChild(parent.handle, parent.name, {
        desired: access.read | access.write,
        disposition: 3,
        directory: false,
        sharing: share.read | share.write,
      })
      acquired ||= lock(lockHandle)
      return acquired
    },
    close() {
      if (closed) return
      closed = true
      if (lockHandle) api().CloseHandle(lockHandle)
      parent.close()
      root.close()
    },
  }
}
