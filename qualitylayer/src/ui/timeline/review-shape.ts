import { trimEndWhile } from "../../core/text-boundaries.ts"

// How Review keeps its long lists short: a Try it step split into its words, its commands (each
// copied on its own) and what to expect; the terminal proof grouped by kind with one row per
// scenario or truth; the plan's changes once each. Plain functions, so the suite pins them.

/** A code span that is a command to run, not a name or a value: it starts with a program, after any `VAR=value`. */
const COMMAND =
  /^(?:[A-Z_][A-Z0-9_]*=\S+\s+)*(?:qualitylayer|ql|cd|bun|bunx|npm|npx|node|git|gh|claude|codex|curl|open|python3?|bash|sh|make)\s/

export const isCommand = (code: string): boolean => COMMAND.test(code)

export type TryShape = { say: string; commands: string[]; expect: string }

/** The step's words before its first command, its commands in order, and the words after the last. */
export function splitTry(text: string): TryShape {
  // Odd indexes are the code spans.
  const parts = text.split(/`([^`]*)`/)
  const at = parts.flatMap((part, i) => (i % 2 === 1 && isCommand(part) ? [i] : []))
  if (at.length === 0) return { say: text, commands: [], expect: "" }
  const join = (from: number, to: number) =>
    parts
      .slice(from, to)
      .map((part, i) => ((from + i) % 2 === 1 ? `\`${part}\`` : part))
      .join("")
  const first = at[0] as number
  const last = at[at.length - 1] as number
  const before = trimEndWhile(join(0, first), (char) => /[\s:,;(]/.test(char))
  const say = /\sthen$/i.test(before) ? before.slice(0, -4).trimEnd() : before
  const after = join(last + 1, parts.length).replace(/^[\s.,:;)]+/, "")
  return {
    say,
    commands: at.map((i) => parts[i] as string),
    expect: after === "" ? "" : `${after.charAt(0).toUpperCase()}${after.slice(1)}`,
  }
}

export type Proof = { file: string; title: string; caption: string }
export type ProofRow = { label: string; caption: string; files: string[] }
export type ProofGroup = { kind: "Checks" | "Scenarios" | "Truths"; rows: ProofRow[] }

const KINDS: [string, ProofGroup["kind"]][] = [
  ["check", "Checks"],
  ["scenario", "Scenarios"],
  ["truth", "Truths"],
]

/** Numbers in order, and a word (the oracle) before them. */
const byLabel = (a: ProofRow, b: ProofRow) => {
  const na = Number(a.label)
  const nb = Number(b.label)
  if (Number.isNaN(na) || Number.isNaN(nb)) return Number.isNaN(na) ? -1 : 1
  return na - nb
}

/** The judge's terminal proof by kind: a check per command, a scenario or truth once with every file that proves it. */
export function proofGroups(proofs: Proof[]): ProofGroup[] {
  return KINDS.flatMap(([word, kind]) => {
    const rows = new Map<string, ProofRow>()
    for (const p of proofs) {
      const [head = "", ...rest] = p.title.split(" ")
      if (head.toLowerCase() !== word) continue
      const label = rest.join(" ")
      const key = word === "check" ? p.caption : label
      const row = rows.get(key)
      if (row === undefined) rows.set(key, { label, caption: p.caption, files: [p.file] })
      else if (!row.files.includes(p.file)) row.files.push(p.file)
    }
    const list = [...rows.values()]
    if (word !== "check") list.sort(byLabel)
    return list.length > 0 ? [{ kind, rows: list }] : []
  })
}
