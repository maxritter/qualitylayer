import { useEffect, useMemo, useState } from "react"
import type { WalkFile } from "../../core/review/walkthrough.ts"
import type { DiffsModule } from "./load.ts"
import { parseReviewPatch } from "./patch.ts"

export type ReviewDiff = ReturnType<DiffsModule["parsePatchFiles"]>[number]["files"][number]
type Input = {
  files: readonly WalkFile[]
  current: string | null
  parse: DiffsModule["parsePatchFiles"] | null
  load: (path: string, signal?: AbortSignal, revision?: string, since?: string) => Promise<string>
  since?: string | null
}
const identity = (file: WalkFile, since?: string | null) =>
  JSON.stringify([file.path, file.stamp ?? [file.additions, file.deletions], since ?? ""])

function matchesEntry(entry: ReviewDiff | undefined, path: string, from?: string): boolean {
  if (entry === undefined) return false
  if (entry.name === path || entry.prevName === path) return true
  if (from === undefined) return false
  return entry.name === from || entry.prevName === from
}

function selectMatchedDiffs(
  parsed: readonly ReviewDiff[],
  file: WalkFile,
  since?: string | null,
): ReviewDiff[] {
  const parts = since ? undefined : file.parts
  const diffs = parsed.filter((entry) =>
    parts?.length
      ? parts.some((part) => matchesEntry(entry, part.path, part.from))
      : matchesEntry(entry, file.path, file.from),
  )
  if (diffs.length === 0) throw new Error("The patch contains no matching file.")
  const matched = parts?.length
    ? diffs.length === parts.length &&
      parts.every((part, index) => matchesEntry(diffs[index], part.path, part.from))
    : diffs.length === 1
  if (!matched) {
    throw new Error("The task's file versions could not be matched. Refresh Review and try again.")
  }
  return diffs
}

class DiffReads {
  private cache = new Map<string, ReviewDiff[]>()
  private failures = new Map<string, string>()
  private pending = new Set<string>()
  private controllers = new Map<string, AbortController>()
  private input: Input | null = null
  private active = false
  constructor(private changed: () => void) {}
  start(input: Input) {
    this.input = input
    this.active = true
    const current = new Set(input.files.map((file) => identity(file, input.since)))
    for (const [key, controller] of this.controllers) if (!current.has(key)) controller.abort()
    this.pump()
  }
  stop() {
    this.active = false
    for (const controller of this.controllers.values()) controller.abort()
  }
  snapshot(files: readonly WalkFile[], since?: string | null) {
    return {
      loaded: new Map(
        files.flatMap((file) => {
          const diff = this.cache.get(identity(file, since))
          return diff === undefined ? [] : [[file.path, diff] as const]
        }),
      ),
      errors: new Map(
        files.flatMap((file) => {
          const error = this.failures.get(identity(file, since))
          return error === undefined ? [] : [[file.path, error] as const]
        }),
      ),
    }
  }
  retry(paths: readonly string[]) {
    for (const file of this.input?.files ?? [])
      if (paths.includes(file.path)) this.failures.delete(identity(file, this.input?.since))
    this.changed()
    this.pump()
  }
  private pump() {
    const input = this.input
    if (!this.active || !input?.parse) return
    const selected = input.files.find((file) => file.path === input.current)
    const queue = selected
      ? [selected, ...input.files.filter((file) => file !== selected)]
      : input.files
    for (const file of queue) {
      if (this.pending.size >= 4) break
      const key = identity(file, input.since)
      if (this.cache.has(key) || this.failures.has(key) || this.pending.has(key)) continue
      this.pending.add(key)
      void this.read(file, input.parse, input.load, input.since)
    }
  }
  private async read(
    file: WalkFile,
    parse: NonNullable<Input["parse"]>,
    load: Input["load"],
    since?: string | null,
  ) {
    const key = identity(file, since)
    const controller = new AbortController()
    this.controllers.set(key, controller)
    try {
      const patch = await load(file.path, controller.signal, file.stamp, since ?? undefined)
      if (controller.signal.aborted) return
      const parsed = parseReviewPatch(parse, patch).flatMap((entry) => entry.files)
      this.cache.set(key, selectMatchedDiffs(parsed, file, since))
    } catch (cause) {
      if (!controller.signal.aborted)
        this.failures.set(key, cause instanceof Error ? cause.message : String(cause))
    } finally {
      this.pending.delete(key)
      this.controllers.delete(key)
      if (this.active) {
        this.changed()
        this.pump()
      }
    }
  }
}

/** Four bounded requests, with the selected file next; failures wait for an explicit retry. */
export function useDiffFiles({ files, current, parse, load, since }: Input) {
  const [version, changed] = useState(0)
  const [reads] = useState(() => new DiffReads(() => changed((value) => value + 1)))
  useEffect(() => () => reads.stop(), [reads])
  useEffect(() => {
    reads.start({ files, current, parse, load, since })
  }, [reads, files, current, parse, load, since])
  const snapshot = useMemo(
    () => ({ version, ...reads.snapshot(files, since) }),
    [version, reads, files, since],
  )
  return { ...snapshot, retry: (paths: readonly string[]) => reads.retry(paths) }
}
