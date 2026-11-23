// Whether a shell command an agent asks permission for is QualityLayer's own and nothing else, so the
// permission hook may let it run. Copilot refuses any path outside the project, and the skills run
// QualityLayer by the absolute path of its install folder. Only a command made of QualityLayer calls,
// optionally fed by a plain `printf` or `echo` through a pipe, with no redirection, substitution or
// other path, passes; anything else gets no answer and the person is asked as before.

import { isAbsolute, relative, resolve } from "node:path"
import { segments, words } from "./own-command-parse.ts"

/** Shell syntax this check does not read: redirection, substitution, background jobs, subshells. */
const UNREAD = /[<>`$(){}&\\]|\|\|/

const inside = (folder: string, path: string): boolean => {
  const rel = relative(folder, path)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

function isSafePrintf(rest: string[]): boolean {
  const format = rest[0] === "--" ? rest[1] : rest[0]
  return (
    !rest[0]?.startsWith("-v") &&
    format !== undefined &&
    !format.replace(/%%|%s/g, "").includes("%")
  )
}

function argsStayInCwd(rest: string[], quoted: string[], cwd: string): boolean {
  for (const word of rest) {
    if (quoted.some((text) => text.slice(1, -1) === word)) continue
    const pathLike = word.startsWith("/") || word.startsWith("~") || word.includes("..")
    if (pathLike && !(isAbsolute(word) && inside(cwd, resolve(word)))) return false
  }
  return true
}

function classifySegment(part: string, binary: string, cwd: string): "call" | "helper" | "invalid" {
  const quoted = part.match(/'[^']*'|"[^"]*"/g) ?? []
  const list = words(part)
  if (list === null || list.length === 0) return "invalid"
  const [program, ...rest] = list
  if (program === "printf" && !isSafePrintf(rest)) return "invalid"
  if (program !== binary && program !== "printf" && program !== "echo") return "invalid"
  if (!argsStayInCwd(rest, quoted, cwd)) return "invalid"
  return program === binary ? "call" : "helper"
}

/**
 * True when `command` only runs QualityLayer (`binary`, an absolute path), its other paths stay in
 * `cwd`, and any other step is a plain `printf` or `echo` feeding it. Quoted text is not a path.
 */
export function ownCommand(command: string, binary: string, cwd: string): boolean {
  const unquoted = command.replace(/'[^']*'/g, "''").replaceAll("&&", ";")
  if (!isAbsolute(binary) || UNREAD.test(unquoted)) return false
  const parts = segments(command)
  if (parts === null || parts.length === 0) return false
  let calls = 0
  for (const part of parts) {
    const kind = classifySegment(part, binary, cwd)
    if (kind === "invalid") return false
    if (kind === "call") calls++
  }
  return calls > 0
}
