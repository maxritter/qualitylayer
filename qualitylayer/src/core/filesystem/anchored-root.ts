export type AnchoredEntry = { name: string; kind: "file" | "directory" | "other" }
export type NativeFileSnapshot = { bytes: Uint8Array; identity: string; version: string }
export type NativeFileProbe = { bytes: Uint8Array; size: number; mtimeMs: number }
export type NativeFileStream = { identity: string; version: string; size: number; mtimeMs: number }
export type AnchoredRoot = {
  readonly identity: string
  directory(path: string): AnchoredRoot
  read(path: string, maximum: number): Uint8Array | null
  snapshot(path: string, maximum: number): NativeFileSnapshot | null
  /** Metadata and at most the final maximum bytes, from one held regular file. */
  probe(path: string, maximum: number): NativeFileProbe | null
  /** Read chunks through one held regular file; no ancestor pathname is re-resolved. */
  stream?(
    path: string,
    maximum: number,
    consume: (bytes: Uint8Array) => Promise<void>,
  ): Promise<NativeFileStream | null>
  write(path: string, bytes: Uint8Array, replace: boolean): void
  entries(path: string, maximum: number): AnchoredEntry[] | null
  moveExclusive(from: string, to: string, expectedVersion?: string): void
  exchange(from: string, to: string, fromVersion: string, toVersion: string): void
  exchangeState(
    from: string,
    to: string,
    fromVersion: string,
    toVersion: string,
  ): { from: NativeFileSnapshot | null; to: NativeFileSnapshot | null }
  moveDirectoryExclusive(from: string, to: string, identity: string): void
  unlinkFile(path: string): void
  removeEmptyDirectory(path: string): void
  tryLock(path: string): boolean
  assertCurrentRoot(): void
  close(): void
}

export function relativeParts(path: string, allowRoot = false) {
  if (allowRoot && path === "") return []
  const parts = path.split("/")
  if (parts.some((part) => !part || part === "." || part === ".." || /[\\:\p{Cc}]/u.test(part)))
    throw new Error("Native path must stay relative to its registered root")
  return parts
}

/** Internal primitive; product adapters use openRegisteredRoot with their own trusted registry. */
export async function pinNativeRoot(root: string): Promise<AnchoredRoot> {
  if (process.platform === "darwin" || process.platform === "linux")
    return (await import("./anchored-posix.ts")).openPosixRoot(root)
  if (process.platform === "win32")
    return (await import("./anchored-windows.ts")).openWindowsRoot(root)
  throw new Error("Safe registered directory I/O is unavailable on this platform")
}

/** Pin first, verify the trusted registration while pinned, then reject a replaced root pathname. */
export async function openRegisteredRoot(
  root: string,
  verify: (pinned: AnchoredRoot) => Promise<void>,
): Promise<AnchoredRoot> {
  const pinned = await pinNativeRoot(root)
  try {
    await verify(pinned)
    pinned.assertCurrentRoot()
    return pinned
  } catch (cause) {
    pinned.close()
    throw cause
  }
}
