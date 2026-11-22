import { realpath, stat } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { folderDoc } from "../docs/names.ts"
import { allTasks } from "../docs/outline.ts"
import { approvalCurrent } from "../gate/revision.ts"
import type { Task } from "../task/store.ts"
import { readOutline } from "../task-flow.ts"
import { readBuildStart } from "./build-start.ts"
import { covers } from "./slice-commit.ts"

type Token = { kind: "word" | "write" | "read" | "here"; text: string; literal: boolean }
type Segment = { tokens: Token[]; end: string }
const SHELLS = /^(?:sh|bash|dash|ksh|zsh)$/
const TOOLS = new Set(["Bash", "bash", "shell", "powershell", "exec_command", "local_shell"])
export const shellWriteTool = (tool: unknown): tool is string =>
  typeof tool === "string" && TOOLS.has(tool)
const MAX_COMMAND = 64 * 1024
const MAX_PATHS = 32

function inPlace(tool: string, word: string): boolean {
  if (word.startsWith("--")) return /^--in-place(?:=|$)/.test(word)
  if (!word.startsWith("-")) return false
  const takesRest = tool === "perl" ? "eEfFMmIxCdD" : "efl"
  for (const letter of word.slice(1)) {
    if (letter === "i") return true
    if (takesRest.includes(letter)) return false
  }
  return false
}

/** Parse only shell words and literal redirection; heredoc bodies are data, never commands. */
function segments(command: string): Segment[] | null {
  const rows: Segment[] = [],
    here: { text: string; tabs: boolean }[] = []
  let tokens: Token[] = [],
    word = "",
    started = false,
    literal = true,
    quote = "",
    tabs = false
  const flush = () => {
    if (!started) return
    if (tokens.at(-1)?.kind === "here") here.push({ text: word, tabs })
    tokens.push({ kind: "word", text: word, literal })
    word = ""
    started = false
    literal = true
  }
  for (let i = 0; i < command.length; i++) {
    const char = command[i] ?? ""
    if (char === "\\" && quote !== "'" && i + 1 < command.length) {
      const next = command[i + 1] ?? ""
      if ((quote === "" && /[\s|&;<>"'\\$`]/.test(next)) || /[$`"\\\n]/.test(next)) {
        if (next !== "\n") word += next
        started = true
        i++
        continue
      }
    }
    if (quote) {
      if (char === quote) quote = ""
      else {
        word += char
        if (quote === '"' && /[$`]/.test(char)) literal = false
      }
      continue
    }
    if (char === "`") return null
    if (char === "'" || char === '"') {
      quote = char
      started = true
      continue
    }
    if (char === "#" && !started) {
      while (i + 1 < command.length && command[i + 1] !== "\n") i++
      continue
    }
    if (char === ">" || char === "<") {
      flush()
      const double = command[i + 1] === char
      const fd = char === ">" && command[i + 1] === "&"
      if (double || fd) i++
      tabs = char === "<" && double && command[i + 1] === "-"
      if (tabs) i++
      tokens.push({
        kind: char === ">" && !fd ? "write" : double && char === "<" ? "here" : "read",
        text: char,
        literal: true,
      })
      continue
    }
    if (char === ";" || char === "|" || char === "&" || char === "\n") {
      flush()
      const end = command[i + 1] === char && char !== "\n" ? char + command[++i] : char
      rows.push({ tokens, end })
      tokens = []
      if (char === "\n" && here.length) {
        if (here.length > 4) return null
        for (const delimiter of here) {
          let closed = false
          while (i + 1 < command.length) {
            const end = command.indexOf("\n", i + 1)
            const line = command.slice(i + 1, end < 0 ? command.length : end)
            i = end < 0 ? command.length : end
            if ((delimiter.tabs ? line.replace(/^\t+/, "") : line) === delimiter.text) {
              closed = true
              break
            }
          }
          if (!closed) return null
        }
        here.length = 0
      }
      continue
    }
    if (/\s/.test(char)) {
      flush()
      continue
    }
    word += char
    started = true
    if (/[$`*?[~]/.test(char)) literal = false
  }
  flush()
  if (quote || here.length) return null
  if (tokens.length) rows.push({ tokens, end: "" })
  return rows
}

async function literalWrites(command: string, cwd: string, depth = 0): Promise<string[]> {
  if (Buffer.byteLength(command) > MAX_COMMAND || depth > 2) return []
  const parsed = segments(command)
  if (!parsed) return []
  const found: string[] = []
  let at: string | null = cwd
  const add = (token?: Token) => {
    if (token?.kind !== "word" || !token.literal || !token.text) return
    if (isAbsolute(token.text)) found.push(resolve(token.text))
    else if (at) found.push(resolve(at, token.text))
  }
  for (const row of parsed) {
    const words: Token[] = []
    for (let i = 0; i < row.tokens.length; i++) {
      const token = row.tokens[i]
      if (!token) continue
      if (token.kind === "write") add(row.tokens[++i])
      else if (token.kind !== "word") i++
      else words.push(token)
    }
    const first = words[0]
    if (!first?.literal) continue
    const tool = basename(first.text)
    if (tool === "cd") {
      const target = words[1]
      if (
        !at ||
        !target?.literal ||
        target.text.startsWith("-") ||
        ![";", "&&", "\n"].includes(row.end)
      ) {
        at = null
        continue
      }
      const path = resolve(at, target.text)
      at = await stat(path)
        .then((entry) => (entry.isDirectory() ? path : null))
        .catch(() => null)
      continue
    }
    if (SHELLS.test(tool) && at) {
      const flag = words.findIndex(
        (word) => word.literal && /^-[a-z]+$/.test(word.text) && word.text.includes("c"),
      )
      const script = flag >= 0 ? words[flag + 1] : undefined
      if (script?.literal) found.push(...(await literalWrites(script.text, at, depth + 1)))
    }
    if (tool === "tee")
      for (const token of words.slice(1)) if (!token.text.startsWith("-")) add(token)
    if (tool === "sed" || tool === "perl") {
      const inplace = words.some((word) => word.literal && inPlace(tool, word.text))
      if (inplace) {
        let script = false
        for (let i = 1; i < words.length; i++) {
          const token = words[i]
          if (!token) continue
          if (["-e", "--expression", "-f", "--file"].includes(token.text)) {
            i++
            script = true
            continue
          }
          if (/^--(?:expression|file)=|^-[ef].+/.test(token.text)) {
            script = true
            continue
          }
          if (token.text === "-i" && words[i + 1]?.text === "") {
            i++
            continue
          }
          if (token.text.startsWith("-")) continue
          if (!script) {
            script = true
            continue
          }
          add(token)
        }
      }
    }
    if (found.length >= MAX_PATHS) break
  }
  return [...new Set(found)].slice(0, MAX_PATHS)
}

async function canonical(path: string): Promise<string | null> {
  const suffix: string[] = []
  for (let i = 0; i < 64; i++) {
    try {
      return join(await realpath(path), ...suffix)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null
      const parent = dirname(path)
      if (parent === path) return null
      suffix.unshift(basename(path))
      path = parent
    }
  }
  return null
}
const within = (root: string, path: string) => {
  const rel = relative(root, path)
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** A workflow-bound pre-tool hint, not a general shell sandbox or an opaque-script detector. */
export async function shellWriteDenial(
  ctx: Ctx,
  task: Task,
  tool: unknown,
  input: unknown,
): Promise<string | null> {
  if (!shellWriteTool(tool) || !input || typeof input !== "object") return null
  const raw = (input as Record<string, unknown>).command ?? (input as Record<string, unknown>).cmd
  let command: string
  if (typeof raw === "string") command = raw
  else if (
    Array.isArray(raw) &&
    raw.every((word) => typeof word === "string") &&
    SHELLS.test(basename(raw[0] ?? "")) &&
    /^-[a-z]+$/.test(raw[1] ?? "") &&
    (raw[1] ?? "").includes("c")
  )
    command = raw[2] ?? ""
  else return null
  const given = input as Record<string, unknown>
  const workdir =
    typeof given.workdir === "string"
      ? given.workdir
      : typeof given.cwd === "string"
        ? given.cwd
        : ""
  const candidates = await literalWrites(command, resolve(ctx.env.cwd(), workdir))
  if (!candidates.length) return null
  const root = await canonical(task.repoRoot),
    docs = await canonical(task.dir)
  if (!root || !docs) return null
  const resolved = await Promise.all(candidates.map(canonical))
  const paths = [
    ...new Set(
      [...candidates, ...resolved].filter(
        (path): path is string => path !== null && within(root, path),
      ),
    ),
  ]
  if (!paths.length) return null
  const capture = await readBuildStart(ctx, task)
  let approved = capture?.approvedFiles ?? []
  if (await approvalCurrent(ctx, task, folderDoc("plan"))) {
    const outline = await readOutline(ctx, task)
    if (outline) approved = [...approved, ...allTasks(outline).flatMap((card) => card.files)]
  }
  const tracked = await ctx.git.run(task.repoRoot, [
    "ls-files",
    "-z",
    "--",
    ...paths.map((path) => `:(literal)${relative(root, path).split(sep).join("/")}`),
  ])
  const trackedPaths = new Set(tracked.code === 0 ? tracked.stdout.split("\0") : [])
  const denied = paths.filter((path) => {
    const rel = relative(root, path).split(sep).join("/")
    if (approved.some((file) => covers(file, rel)) || trackedPaths.has(rel)) return true
    if (!within(docs, path)) return false
    const own = relative(docs, path).split(sep).join("/")
    return !["evidence/", "records/", "attachments/"].some((prefix) => own.startsWith(prefix))
  })
  if (!denied.length) return null
  const labels = denied
    .slice(0, 6)
    .map((path) => relative(root, path).split(sep).join("/").slice(0, 240))
  return `QualityLayer: this shell command names a literal write path: ${labels.join(", ")}${denied.length > labels.length ? " and other task source files" : ""}. Use your native Edit or Write file tool (apply_patch in Codex) for source and authored task documents. Keep shell commands for reads, checks, builds and generated evidence.`
}
