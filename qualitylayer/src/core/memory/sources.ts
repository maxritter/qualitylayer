import { existsSync } from "node:fs"
import { join } from "node:path"
import type { MemorySources } from "../../memory-contracts.ts"
import { type GitReader, gitReader } from "./source-git.ts"
import { MemorySourceHistory } from "./source-history.ts"
import { covers, SHA, type SourcesLesson } from "./source-log.ts"
import { MemorySourceState } from "./source-state.ts"

export type { GitReader } from "./source-git.ts"
export { boundedRun, gitReader } from "./source-git.ts"
export type { SourcesLesson } from "./source-log.ts"
export { checkPoint, covers } from "./source-log.ts"

const PATHS_MAX = 1000

async function absentLessons(root: string, lessons: SourcesLesson[], read: GitReader) {
  const absent = new Set<string>(),
    paths = [...new Set(lessons.flatMap(({ record }) => record.files))]
  if (paths.length > PATHS_MAX) return absent
  const present = await read(root, ["ls-tree", "-r", "--name-only", "-z", "HEAD", "--", ...paths])
  if (!present.ok || !present.complete) return absent
  const existing = present.stdout.split("\0").filter(Boolean)
  for (const { record } of lessons)
    if (
      !record.files.some(
        (file) => existing.some((path) => covers(file, path)) || existsSync(join(root, file)),
      )
    )
      absent.add(record.id)
  return absent
}

/** A bounded Git snapshot answers every active lesson without changing repository files. */
export async function projectSources(
  root: string,
  lessons: SourcesLesson[],
  read: GitReader = gitReader,
): Promise<Map<string, MemorySources>> {
  const states = new Map<string, MemorySources>(),
    tracked = lessons.filter(({ record }) => record.files.length > 0)
  for (const { record } of lessons)
    if (record.files.length === 0) states.set(record.id, { state: "none" })
  if (!tracked.length) return states
  const head = await read(root, ["rev-parse", "--verify", "HEAD"]),
    commit = head.ok ? head.stdout.trim() : ""
  if (!head.ok || !SHA.test(commit))
    return fillUnchecked(
      states,
      tracked,
      head.ok ? "This repository has no commit yet." : head.reason,
    )
  const absent = await absentLessons(root, tracked, read)
  const history = new MemorySourceHistory(root, tracked, read, commit),
    failure = await history.load()
  for (const [id, reason] of history.unchecked) states.set(id, { state: "unchecked", reason })
  if (failure !== null) {
    return fillUnchecked(states, tracked, failure)
  }
  const projection = new MemorySourceState(history, absent)
  for (const { record } of tracked)
    if (!states.has(record.id)) states.set(record.id, projection.state(record))
  return states
}

function fillUnchecked(
  states: Map<string, MemorySources>,
  tracked: SourcesLesson[],
  reason: string,
) {
  for (const { record } of tracked)
    if (!states.has(record.id)) states.set(record.id, { state: "unchecked", reason })
  return states
}
