// The change as the checkout shows it: a diff cut into files, and what counts as a task's own plan
// folder. Shared by the review, the landing dialog and the changes card.

/** The task's plan folder: documents and evidence, each approved at its own gate. */
export const isPlanPath = (path: string) => path.startsWith("docs/plans/")

export type DiffFile = {
  path: string
  /** `n` is the line's number in the new file (old file for a deletion); null for diff metadata. */
  lines: { kind: "add" | "del" | "hunk" | "ctx"; text: string; n: number | null }[]
}

const DIFF_HEADER_RE =
  /^(index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode)/

type DiffLineKind = DiffFile["lines"][number]["kind"]

function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith("@@")) return "hunk"
  if (line.startsWith("+")) return "add"
  if (line.startsWith("-")) return "del"
  return "ctx"
}

function appendDiffLine(
  current: DiffFile,
  line: string,
  state: { oldN: number; newN: number },
): void {
  if (line === "" || DIFF_HEADER_RE.test(line)) return
  if (line === "\\ No newline at end of file") {
    current.lines.push({ kind: "ctx", text: line, n: null })
    return
  }
  const kind = diffLineKind(line)
  if (kind === "hunk") {
    const at = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/)
    state.oldN = Number(at?.[1] ?? 0)
    state.newN = Number(at?.[2] ?? 0)
    current.lines.push({ kind, text: line, n: null })
    return
  }
  if (kind === "del") {
    current.lines.push({ kind, text: line, n: state.oldN++ })
    return
  }
  current.lines.push({ kind, text: line, n: state.newN++ })
  if (kind === "ctx") state.oldN++
}

export function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = []
  let current: DiffFile | null = null
  const state = { oldN: 0, newN: 0 }
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const path = line.match(/ b\/(.+)$/)?.[1] ?? line
      current = { path, lines: [] }
      files.push(current)
      continue
    }
    if (current !== null) appendDiffLine(current, line, state)
  }
  return files
}
