// The values the design file (and the product palette it reads) held for each token in its git history.
// A page whose value differs from the design file's counts as behind only when that value is one the
// file held before: the design moved on and the page did not follow. A value the file never held is the
// page's own choice. Nothing is written and nothing watches: the last commits that touched those files
// are read once with git, and the answer is kept while the newest such commit stands.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { headOf } from "./lasting-history.ts"
import { parseDesign, parsePalette } from "./tokens.ts"

/** At most this many commits touching the design file or palette are read. */
export const TOKEN_HISTORY_COMMITS = 30
/** A version of a file larger than this is not read. */
export const TOKEN_HISTORY_FILE_BYTES = 256 * 1024
/** The values kept for one checkout hold at most about this many characters. */
export const TOKEN_HISTORY_BYTES = 128 * 1024
/** How many checkouts' newest-commit answers are remembered, and their `.git` HEADs. */
const KEYS_KEPT = 64
/** Versions are read this many at a time. */
const READ_AT_ONCE = 6

/** The values each token held, by `<theme>\0<token>`: a colour by its name, any other by its variable. */
export type TokenHistory = { values: Map<string, Set<string>>; weight: number }

export const NO_HISTORY = (): TokenHistory => ({ values: new Map(), weight: 0 })

/** The files whose history counts: the design file the tokens are read from, and the palette. */
export type HistorySources = { design: string | null; palette: string | null }

const literal = (path: string) => `:(literal)${path}`

type Known = { head: string; files: string; key: string }
const known = new Map<string, Known>()

/** Forget what was remembered (a test starts clean). */
export function forgetTokenHistory(): void {
  known.clear()
}

/**
 * What the history of `files` stands at: the newest commit that touched any of them, so it changes when
 * the history can change and not otherwise. HEAD is read from `.git` without a process; git runs only
 * when HEAD moved (or cannot be read that way). Outside a repository, and for files git does not know,
 * the answer is a fixed word and no history is read.
 */
export async function historyKey(ctx: Ctx, root: string, files: string[]): Promise<string> {
  if (files.length === 0) return "no files"
  if (ctx.fs.lstat !== undefined && (await ctx.fs.lstat(join(root, ".git"))) === null)
    return "no git"
  const list = files.join("|")
  const head = await headOf(ctx, root)
  const had = known.get(root)
  if (head !== null && had !== undefined && had.head === head && had.files === list) return had.key
  const run = await ctx.git.run(root, ["log", "-n1", "--format=%H", "--", ...files.map(literal)])
  const newest = run.code === 0 ? run.stdout.trim() : ""
  const key = newest === "" ? "untracked" : newest
  if (head !== null) {
    known.delete(root)
    known.set(root, { head, files: list, key })
    while (known.size > KEYS_KEPT) known.delete(known.keys().next().value as string)
  }
  return key
}

const HASH = /^[0-9a-f]{40,64}$/

/** The last commits that touched the files, newest first, each with the files it touched. */
async function commitsOf(
  ctx: Ctx,
  root: string,
  files: string[],
): Promise<{ sha: string; files: string[] }[]> {
  const run = await ctx.git.run(root, [
    "log",
    `-n${TOKEN_HISTORY_COMMITS}`,
    "-z",
    "--relative",
    "--name-only",
    "--format=%H",
    "--",
    ...files.map(literal),
  ])
  if (run.code !== 0) return []
  const commits: { sha: string; files: string[] }[] = []
  for (const token of run.stdout.split("\0")) {
    const text = token.replace(/^\n/, "")
    if (text === "") continue
    if (HASH.test(text)) commits.push({ sha: text, files: [] })
    else commits.at(-1)?.files.push(text)
  }
  // A merge commit lists no files of its own: it stands for every file's version at that point.
  return commits.map((commit) => ({
    sha: commit.sha,
    files: commit.files.length === 0 ? files : commit.files.filter((file) => files.includes(file)),
  }))
}

/** A file as one commit had it (any content filter applied, as the working tree would have it); null when absent. */
async function versionOf(
  ctx: Ctx,
  root: string,
  sha: string,
  file: string,
): Promise<string | null> {
  const run = await ctx.git.run(root, ["cat-file", "--filters", `${sha}:./${file}`])
  if (run.code !== 0 || run.stdout.length > TOKEN_HISTORY_FILE_BYTES) return null
  return run.stdout
}

function addHistoryValue(
  history: TokenHistory,
  theme: "light" | "dark",
  token: string,
  value: string,
): void {
  if (history.weight + value.length + token.length > TOKEN_HISTORY_BYTES) return
  const key = `${theme}\0${token}`
  const set = history.values.get(key) ?? new Set<string>()
  if (set.has(value)) return
  set.add(value)
  history.values.set(key, set)
  history.weight += value.length + key.length
}

function ingestHistoryText(
  history: TokenHistory,
  file: string,
  text: string,
  paletteFile: string | null,
): void {
  if (file === paletteFile) {
    for (const [name, pair] of parsePalette(text) ?? []) {
      addHistoryValue(history, "light", name, pair.light)
      addHistoryValue(history, "dark", name, pair.dark)
    }
    return
  }
  const parsed = parseDesign(text)
  for (const [name, colour] of parsed.colours) {
    addHistoryValue(history, "light", name, colour.light)
    if (colour.twin) addHistoryValue(history, "dark", name, colour.dark)
  }
  for (const [name, value] of parsed.others) addHistoryValue(history, "light", name, value)
}

/**
 * Every value the design file and the palette held for a token over their last commits, the newest
 * first, within a size cap. The working-tree file is not read here: the caller has it.
 */
export async function readHistory(
  ctx: Ctx,
  root: string,
  sources: HistorySources,
): Promise<TokenHistory> {
  const history = NO_HISTORY()
  const files = [sources.design, sources.palette].filter((file): file is string => file !== null)
  if (files.length === 0) return history
  const reads = (await commitsOf(ctx, root, files)).flatMap((commit) =>
    commit.files.map((file) => ({ sha: commit.sha, file })),
  )
  for (let from = 0; from < reads.length; from += READ_AT_ONCE) {
    const texts = await Promise.all(
      reads.slice(from, from + READ_AT_ONCE).map(async (read) => ({
        file: read.file,
        text: await versionOf(ctx, root, read.sha, read.file),
      })),
    )
    for (const { file, text } of texts) {
      if (text !== null) ingestHistoryText(history, file, text, sources.palette)
    }
  }
  return history
}
