export type NativeEdit = {
  path: string
  from?: string
  kind: "write" | "edit" | "delete"
  content?: string
  replacements?: { before: string; after: string; all?: boolean }[]
  hunks?: { before: string[]; after: string[] }[]
}

const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const text = (value: unknown) => (typeof value === "string" ? value : "")

type PatchHunk = NonNullable<NativeEdit["hunks"]>[number]
type PatchState = { current?: NativeEdit; hunk?: PatchHunk }

function patchFile(operation: string, path: string): NativeEdit {
  if (operation === "Add") return { path, kind: "write", content: "" }
  if (operation === "Delete") return { path, kind: "delete" }
  return { path, kind: "edit", hunks: [] }
}

function patchMetadata(state: PatchState, line: string): boolean {
  const current = state.current
  if (current?.kind !== "edit") return false
  if (line.startsWith("*** Move to: ")) {
    current.from = current.path
    current.path = line.slice(13)
    return true
  }
  if (!line.startsWith("@@")) return false
  state.hunk = { before: [], after: [] }
  current.hunks ??= []
  current.hunks.push(state.hunk)
  return true
}

function patchContent({ current, hunk }: PatchState, line: string): boolean {
  if (current?.kind === "write" && line.startsWith("+")) {
    current.content += `${line.slice(1)}\n`
    return true
  }
  if (!hunk || !/^[ +-]/.test(line)) return line === ""
  if (line[0] !== "+") hunk.before.push(line.slice(1))
  if (line[0] !== "-") hunk.after.push(line.slice(1))
  return true
}

function patchEdits(patch: string): NativeEdit[] {
  if (!patch.startsWith("*** Begin Patch\n") || !patch.includes("\n*** End Patch")) return []
  const edits: NativeEdit[] = []
  const state: PatchState = {}
  for (const line of patch.split("\n").slice(1)) {
    if (line === "*** End Patch") break
    const named = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line)
    if (named) {
      state.current = patchFile(named[1] ?? "", named[2] ?? "")
      state.hunk = undefined
      edits.push(state.current)
    } else if (
      !line.startsWith("*** End") &&
      !patchMetadata(state, line) &&
      !patchContent(state, line)
    )
      return []
  }
  return edits
}

function replacementEdits(path: string, args: Record<string, unknown>): NativeEdit[] {
  const changes = Array.isArray(args.edits) ? args.edits.map(object) : [args]
  const replacements = changes.map((change) => ({
    before: text(change.old_string ?? change.oldText ?? change.oldString),
    after: text(change.new_string ?? change.newText ?? change.newString),
    all: change.replace_all === true || change.replaceAll === true,
  }))
  return replacements.every((change) => change.before.length > 0)
    ? [{ path, kind: "edit", replacements }]
    : []
}

function fileEdits(name: string, args: Record<string, unknown>): NativeEdit[] {
  const path = text(args.file_path ?? args.filePath ?? args.path)
  if (!path) return []
  if (name === "write" && typeof args.content === "string")
    return [{ path, kind: "write", content: args.content }]
  return ["edit", "multiedit"].includes(name) ? replacementEdits(path, args) : []
}

/** Native file operations only. Shell text is deliberately not parsed as an edit receipt. */
export function nativeEdits(tool: unknown, input: unknown): NativeEdit[] {
  if (typeof tool !== "string") return []
  const name = tool.split(/[.:]/).at(-1)?.toLowerCase() ?? ""
  const args = object(input)
  if (["apply_patch", "patch"].includes(name))
    return patchEdits(
      typeof input === "string"
        ? input
        : text(args.input ?? args.patch ?? args.patchText ?? args.command),
    )
  return fileEdits(name, args)
}

export { replayNativeEdit } from "./native-edit-replay.ts"
