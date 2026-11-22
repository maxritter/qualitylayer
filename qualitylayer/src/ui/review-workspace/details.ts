// What a file's header in the Review workspace says besides its path: why it changed (the cards that
// wrote it, or in words when no card did) and its tags (new, risky with its slice). Read from the
// walkthrough the App already has; nothing here is written by an agent.

import type { WalkFile } from "../../core/review/walkthrough.ts"
import type { ReviewFileGroups } from "../timeline/Walkthrough.tsx"

/** Where a file stands in the change. */
export type FileRole = "slice" | "decided" | "fix" | "document"

export type FileFacts = {
  role: FileRole
  /** The slice that built it; null for a file outside every slice. */
  slice: number | null
}

/** How each file of the change stands: its role, its slice and its slice. */
export function factsOf(view: ReviewFileGroups): Map<string, FileFacts> {
  const facts = new Map<string, FileFacts>()
  for (const s of view.slices)
    for (const f of s.files) facts.set(f.path, { role: "slice", slice: s.n })
  for (const f of view.decided)
    if (!facts.has(f.path)) facts.set(f.path, { role: "decided", slice: null })
  for (const f of view.fixes)
    if (!facts.has(f.path)) facts.set(f.path, { role: "fix", slice: null })
  for (const f of view.documents ?? [])
    if (!facts.has(f.path)) facts.set(f.path, { role: "document", slice: null })
  return facts
}

/** The tag words a file's status earns: a plain modification has none. */
export function kindWord(file: WalkFile): string {
  return file.status === "A"
    ? "new"
    : file.status === "D"
      ? "deleted"
      : file.status === "R"
        ? "renamed"
        : ""
}

/** The task ids and titles of every card of the build. */
export function titlesOf(view: ReviewFileGroups): Map<string, string> {
  return new Map(view.slices.flatMap((s) => s.tasks.map((t): [string, string] => [t.id, t.title])))
}

export type Why = {
  /** The cards that wrote the file, with their titles. */
  tasks: { id: string; title: string }[]
  /** What stands in words: when the agent chose it, when no card did, what a document is. */
  note: string
}

/** Why a file changed. */
export function whyOf(
  file: WalkFile,
  facts: FileFacts | undefined,
  titles: ReadonlyMap<string, string>,
): Why {
  const tasks = file.tasks.map((id) => ({ id, title: titles.get(id) ?? "" }))
  const role = facts?.role ?? "slice"
  const treeNote = file.note?.trim() ?? ""
  if (role === "document") return { tasks: [], note: "The task's own document" }
  if (role === "fix") return { tasks: [], note: "Changed after your review, as you asked" }
  if (role === "decided")
    return {
      tasks,
      note: treeNote !== "" ? `${treeNote} · the agent's choice` : "the agent's choice",
    }
  if (treeNote !== "") return { tasks, note: treeNote }
  return { tasks, note: tasks.length === 0 ? "No card names it" : "" }
}
