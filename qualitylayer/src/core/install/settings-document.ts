// Pure edits of individual settings keys; callers own files, backups and rollback records.

export function jsonGet(doc: unknown, path: string[]): unknown {
  let node = doc
  for (const part of path) {
    if (typeof node !== "object" || node === null) return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

export function jsonSet(doc: Record<string, unknown>, path: string[], value: unknown): void {
  let node = doc
  for (const part of path.slice(0, -1)) {
    const next = node[part]
    if (typeof next !== "object" || next === null || Array.isArray(next)) node[part] = {}
    node = node[part] as Record<string, unknown>
  }
  const last = path[path.length - 1] as string
  if (value === undefined) delete node[last]
  else node[last] = value
}

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Line range [start, end) of a TOML table's body, or of the top level when table is null. */
function tomlRange(lines: string[], table: string | null): { start: number; end: number } | null {
  const header = /^\s*\[/
  if (table === null) {
    const end = lines.findIndex((l) => header.test(l))
    return { start: 0, end: end === -1 ? lines.length : end }
  }
  const at = lines.findIndex((l) => new RegExp(`^\\s*\\[${literal(table)}\\]\\s*(#.*)?$`).test(l))
  if (at === -1) return null
  let end = lines.findIndex((l, i) => i > at && header.test(l))
  if (end === -1) end = lines.length
  return { start: at + 1, end }
}

export function tomlGet(text: string, table: string | null, key: string): string | null {
  const lines = text.split("\n")
  const range = tomlRange(lines, table)
  if (range === null) return null
  const pattern = new RegExp(`^\\s*${literal(key)}\\s*=\\s*(.*?)\\s*(#.*)?$`)
  for (let i = range.start; i < range.end; i++) {
    const match = (lines[i] ?? "").match(pattern)
    if (match !== null) return match[1] ?? ""
  }
  return null
}

function removeTomlKey(
  lines: string[],
  at: number,
  table: string | null,
  dropTableIfEmpty: boolean,
): void {
  if (at !== -1) lines.splice(at, 1)
  if (!dropTableIfEmpty || table === null) return
  const again = tomlRange(lines, table)
  if (again === null) return
  if (lines.slice(again.start, again.end).every((l) => l.trim() === ""))
    lines.splice(again.start - 1, again.end - again.start + 1)
}

function insertTomlKey(
  lines: string[],
  range: { start: number; end: number },
  table: string | null,
  line: string,
): void {
  if (table !== null) {
    lines.splice(range.start, 0, line)
    return
  }
  // After the last top-level key, before the first table.
  let insert = range.end
  while (insert > 0 && (lines[insert - 1] ?? "").trim() === "") insert--
  lines.splice(insert, 0, line)
}

/** Set (or with value null, remove) one key; returns the new text and whether a table was created. */
export function tomlSet(
  text: string,
  table: string | null,
  key: string,
  value: string | null,
  dropTableIfEmpty = false,
): { text: string; createdTable: boolean } {
  const lines = text.replace(/\n$/, "").split("\n")
  const pattern = new RegExp(`^\\s*${literal(key)}\\s*=`)
  let range = tomlRange(lines, table)
  let createdTable = false
  if (range === null) {
    if (value === null) return { text, createdTable }
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("")
    lines.push(`[${table}]`)
    createdTable = true
    range = { start: lines.length, end: lines.length }
  }
  const at = lines.findIndex((l, i) => i >= range.start && i < range.end && pattern.test(l))
  if (value === null) removeTomlKey(lines, at, table, dropTableIfEmpty)
  else if (at !== -1) lines[at] = `${key} = ${value}`
  else insertTomlKey(lines, range, table, `${key} = ${value}`)
  const joined = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n+$/, "")
  return { text: `${joined}\n`, createdTable }
}
