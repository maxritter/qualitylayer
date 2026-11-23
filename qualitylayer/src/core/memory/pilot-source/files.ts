import { isAbsolute, join, resolve } from "node:path"
import type { AnchoredEntry } from "../../filesystem/anchored-root.ts"
import { hash } from "../identity.ts"
import { anchoredStamp, closeSourceAnchors, registerSourceAnchor, sourceAnchor } from "./anchor.ts"
import { streamSource } from "./snapshot.ts"
import {
  budget,
  PILOT_SOURCE_MAX_BYTES,
  type PilotSourceData,
  type SourceStamp,
  sourceData,
} from "./types.ts"

export async function selectedPath(input: string): Promise<string> {
  if (
    typeof input !== "string" ||
    !isAbsolute(input) ||
    input.includes("\0") ||
    input.length > 4096
  )
    throw new Error("Choose an absolute local Pilot source path.")
  return resolve(input)
}
export async function readSource(
  data: PilotSourceData,
  path: string,
  optional = false,
): Promise<Uint8Array | null> {
  budget(data)
  const anchor = await sourceAnchor(data, await selectedPath(path))
  anchor.root.assertCurrentRoot()
  const held = anchor.root.snapshot(anchor.child, PILOT_SOURCE_MAX_BYTES)
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
      ...anchoredStamp(anchor),
    })
    return null
  }
  data.bytes += held.bytes.length
  budget(data)
  data.stamps.set(path, {
    path,
    digest: hash(held.bytes),
    size: held.bytes.length,
    mtime: 0,
    ino: 0,
    kind: "file",
    identity: held.identity,
    version: held.version,
    ...anchoredStamp(anchor),
  })
  return held.bytes
}
export async function sourceEntries(
  data: PilotSourceData,
  path: string,
  optional = false,
): Promise<AnchoredEntry[]> {
  budget(data)
  const anchor = await sourceAnchor(data, await selectedPath(path))
  anchor.root.assertCurrentRoot()
  const entries = anchor.root.entries(anchor.child, 10_000)
  anchor.root.assertCurrentRoot()
  if (!entries && !optional) throw new Error("Choose an existing Pilot source directory.")
  const sorted = (entries ?? []).sort((a, b) => a.name.localeCompare(b.name))
  data.stamps.set(path, {
    path,
    digest: entries ? hash(JSON.stringify(sorted)) : "missing",
    size: sorted.length,
    mtime: 0,
    ino: 0,
    kind: entries ? "directory" : "missing",
    directory: true,
    ...anchoredStamp(anchor),
  })
  return sorted
}
export async function sourceDirectory(
  data: PilotSourceData,
  path: string,
  optional = false,
): Promise<string[]> {
  return (await sourceEntries(data, path, optional)).map((entry) => entry.name)
}
const STAMP_FIELDS = ["kind", "digest", "identity", "version", "rootPath", "rootIdentity"] as const

function stampMatches(actual: SourceStamp | undefined, expected: SourceStamp): boolean {
  return actual !== undefined && STAMP_FIELDS.every((field) => actual[field] === expected[field])
}

export async function verifySources(
  stamps: Map<string, SourceStamp>,
  signal?: AbortSignal,
  deadline?: number,
): Promise<void> {
  const current = sourceData()
  current.signal = signal
  if (deadline !== undefined) current.deadline = Math.min(current.deadline, deadline)
  try {
    for (const expected of stamps.values()) {
      if (!expected.rootPath || !expected.rootIdentity)
        throw new Error("Pilot source authority is missing. Scan the source again.")
      await registerSourceAnchor(current, expected.rootPath, expected.rootIdentity)
      if (expected.kind === "directory") await sourceDirectory(current, expected.path)
      else if (expected.streamed)
        await streamSource(current, expected.path, undefined, expected.kind === "missing")
      else if (expected.kind === "missing" && expected.directory)
        await sourceDirectory(current, expected.path, true)
      else await readSource(current, expected.path, expected.kind === "missing")
      if (!stampMatches(current.stamps.get(expected.path), expected))
        throw new Error("Pilot source changed since the preview. Scan it again before importing.")
    }
  } finally {
    closeSourceAnchors(current)
  }
}
export function utf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
}
export async function walkSources(
  data: PilotSourceData,
  root: string,
  extension: RegExp,
  optional = false,
  depth = 0,
): Promise<string[]> {
  if (depth > 32) throw new Error("Pilot knowledge directories are nested too deeply.")
  const result: string[] = []
  for (const entry of await sourceEntries(data, root, optional)) {
    budget(data)
    const path = join(root, entry.name)
    if (entry.kind === "other")
      throw new Error("Pilot knowledge cannot contain symbolic links or special files.")
    if (entry.kind === "directory")
      result.push(...(await walkSources(data, path, extension, false, depth + 1)))
    else if (entry.kind === "file" && extension.test(entry.name)) result.push(path)
    if (result.length > 5000) throw new Error("Pilot knowledge exceeds 5,000 documents.")
  }
  return result
}
