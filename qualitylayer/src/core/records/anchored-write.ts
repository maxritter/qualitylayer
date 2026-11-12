import { isAbsolute, relative, resolve, sep } from "node:path"
import { openPosixRecord } from "./anchored-posix.ts"
import { openWindowsRecord } from "./anchored-windows.ts"
import { type RecordOwner, recordOwnerKey, recordRuntimeDirectory, token } from "./contract.ts"

export type AnchoredRecordFile = {
  read(maxBytes: number): Uint8Array
  write(bytes: Uint8Array, replace: boolean): void
  tryLock(): boolean
  close(): void
}

function nativeRecord(runtime: string, file: string, createParents: boolean): AnchoredRecordFile {
  if (process.platform === "darwin" || process.platform === "linux")
    return openPosixRecord(runtime, file, createParents)
  if (process.platform === "win32") return openWindowsRecord(runtime, file, createParents)
  throw new Error("Safe owner-bound record I/O is unavailable on this platform")
}

/** All mutations below this boundary use pinned directory objects, never re-resolved ancestors. */
export function openAnchoredRecord(
  owner: RecordOwner,
  file: string,
  createParents = true,
): AnchoredRecordFile {
  if (!["task", "artifact"].includes(owner.address.kind) || !token(owner.address.projectId))
    throw new Error("Invalid record owner address")
  if (owner.address.kind === "task" && !token(owner.address.slug))
    throw new Error("Invalid task record owner")
  if (isAbsolute(file) || file.includes("\\") || file.includes("\0") || file.includes(":"))
    throw new Error("Invalid record output")
  if (file.split("/").some((part) => !part || part === "." || part === ".."))
    throw new Error("Invalid record output")
  const runtime = resolve(owner.runtimeDir)
  if (
    runtime !== recordRuntimeDirectory(owner.home, owner.address) ||
    owner.key !== recordOwnerKey(owner.address)
  )
    throw new Error("Record owner identity changed")
  const scope = relative(resolve(owner.home), runtime)
  if (isAbsolute(scope) || scope.startsWith(`..${sep}`) || scope === "..")
    throw new Error("Record owner escapes its home")
  return nativeRecord(runtime, file, createParents)
}

/** The lock file, its parents and its lifetime share the same native owner boundary as writes. */
export async function withRecordLock<T>(
  owner: RecordOwner,
  name: string,
  action: () => Promise<T>,
): Promise<T> {
  if (!token(name)) throw new Error("Invalid record lock")
  const lock = openAnchoredRecord(owner, `record-locks/${name}.lock`)
  const deadline = Date.now() + 10_000
  try {
    while (!lock.tryLock()) {
      if (Date.now() >= deadline) throw new Error("Another process holds this record")
      await new Promise((done) => setTimeout(done, 5))
    }
    return await action()
  } finally {
    lock.close()
  }
}
