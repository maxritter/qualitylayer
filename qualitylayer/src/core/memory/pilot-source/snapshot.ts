import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { type FileHandle, open } from "node:fs/promises"
import { anchoredStamp, sourceAnchor } from "./anchor.ts"
import {
  budget,
  PILOT_SNAPSHOT_MAX_BYTES,
  PILOT_SQLITE_MAX_BYTES,
  type PilotSourceData,
} from "./types.ts"

const SNAPSHOT_LIMIT_ERROR =
  "Pilot database snapshot exceeds 4 GiB. Choose an existing backup or exported knowledge."

function openSnapshotFile(destination: string): Promise<FileHandle> {
  return open(destination, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
}

async function writeAllBytes(target: FileHandle, bytes: Uint8Array): Promise<void> {
  let written = 0
  while (written < bytes.length) {
    const result = await target.write(bytes, written, bytes.length - written, null)
    if (!result.bytesWritten) throw new Error("Pilot snapshot write did not make progress.")
    written += result.bytesWritten
  }
}

/** Bounded memory even when most of a Pilot database consists of excluded session history. */
export async function streamSource(
  data: PilotSourceData,
  path: string,
  destination?: string,
  optional = false,
): Promise<void> {
  budget(data)
  const anchor = await sourceAnchor(data, path)
  let target: FileHandle | undefined
  try {
    if (!anchor.root.stream) {
      throw new Error("Safe local source streaming is unavailable on this platform.")
    }
    anchor.root.assertCurrentRoot()
    const digest = createHash("sha256")
    let length = 0
    const held = await anchor.root.stream(anchor.child, PILOT_SQLITE_MAX_BYTES, async (bytes) => {
      budget(data)
      length += bytes.length
      if (data.snapshotBytes + length > PILOT_SNAPSHOT_MAX_BYTES) {
        throw new Error(SNAPSHOT_LIMIT_ERROR)
      }
      digest.update(bytes)
      if (!destination) return
      target ??= await openSnapshotFile(destination)
      await writeAllBytes(target, bytes)
    })
    anchor.root.assertCurrentRoot()
    if (!held) {
      if (!optional) throw new Error("Pilot source file was not found.")
      data.stamps.set(path, {
        path,
        digest: "missing",
        size: 0,
        mtime: 0,
        ino: 0,
        kind: "missing",
        streamed: true,
        ...anchoredStamp(anchor),
      })
      return
    }
    if (destination && !target) target = await openSnapshotFile(destination)
    data.snapshotBytes += length
    if (data.snapshotBytes > PILOT_SNAPSHOT_MAX_BYTES) throw new Error(SNAPSHOT_LIMIT_ERROR)
    data.stamps.set(path, {
      path,
      digest: digest.digest("hex"),
      size: length,
      mtime: held.mtimeMs,
      ino: 0,
      kind: "file",
      streamed: true,
      identity: held.identity,
      version: held.version,
      ...anchoredStamp(anchor),
    })
  } finally {
    await target?.close()
  }
}
