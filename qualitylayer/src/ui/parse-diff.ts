// The change as the checkout shows it: a diff cut into files, and what counts as a task's own plan
// folder. Shared by the review, the landing dialog and the changes card.

/** The task's plan folder: documents and evidence, each approved at its own gate. */
export const isPlanPath = (path: string) => path.startsWith("docs/plans/")

export type DiffFile = {
  path: string
  /** `n` is the line's number in the new file (old file for a deletion); null for diff metadata. */
  lines: { kind: "add" | "del" | "hunk" | "ctx"; text: string; n: number | null }[]
}

export function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = []
  let current: DiffFile | null = null
  let oldN = 0
  let newN = 0
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const path = line.match(/ b\/(.+)$/)?.[1] ?? line
      current = { path, lines: [] }
      files.push(current)
      continue
    }
    if (current === null) continue
    if (line === "") continue
    if (line === "\\ No newline at end of file") {
      current.lines.push({ kind: "ctx", text: line, n: null })
      continue
    }
    if (
      /^(index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode)/.test(line)
    )
      continue
    const kind = line.startsWith("@@")
      ? "hunk"
      : line.startsWith("+")
        ? "add"
        : line.startsWith("-")
          ? "del"
          : "ctx"
    if (kind === "hunk") {
      const at = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/)
      oldN = Number(at?.[1] ?? 0)
      newN = Number(at?.[2] ?? 0)
      current.lines.push({ kind, text: line, n: null })
    } else if (kind === "del") {
      current.lines.push({ kind, text: line, n: oldN++ })
    } else {
      current.lines.push({ kind, text: line, n: newN++ })
      if (kind === "ctx") oldN++
    }
  }
  return files
}
