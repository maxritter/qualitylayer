// How Review words what the judges found: a headline the person reads at a glance, the judge's own
// words behind it, and whether a commit after the judged one touched what a finding names.

import type { Ctx } from "../../ctx.ts"
import { trimEndCharacters } from "../text-boundaries.ts"

const HEADLINE_MAX = 120

/**
 * A backticked span that names a file: a path with a folder, or a bare source file name. A bare
 * `config.json` is left out: too many files share such a name to say which one changed.
 */
const FILE_LIKE = /^[\w.@~-]+(?:\/[\w.@~-]+)+\/?$|^[\w.@~-]+\.(?:tsx?|jsx?|css|rs|sh|py|tmpl)$/i

function skipBefore(text: string, at: number, characters: RegExp): number {
  while (at > 0 && characters.test(text.charAt(at - 1))) at--
  return at
}

function withoutEvidenceSuffix(text: string): string {
  const separators = /[\s,;and]/u
  let end = skipBefore(text, text.length, separators)
  let cut = text.length
  while (end > 1 && text.charAt(end - 1) === "`") {
    const open = text.lastIndexOf("`", end - 2)
    if (open === -1) break
    const dash = skipBefore(text, open, /\s/u) - 1
    if (dash < open - 1 && text.charAt(dash) === "—") {
      const before = skipBefore(text, dash, /\s/u)
      if (before < dash) cut = before
    }
    end = skipBefore(text, open, separators)
  }
  return text.slice(0, cut)
}

/**
 * The first sentence of a verdict's text, without code, paths or the evidence it cites: the judge
 * opens every finding with one (the judge's phase text asks for it); a text that does
 * not is cut down the same way.
 */
export function headline(text: string): string {
  const body = withoutEvidenceSuffix(text)
    // an aside that is only code: " (`core/gate/revision.ts`)"
    .replace(/(?<!\s)\s*\([^()]*\)/g, (aside) => (aside.includes("`") ? "" : aside))
    .replace(/\*\*|__/g, "")
    .replace(/\s+/g, " ")
    .trim()
  const first = body.split(/(?<=[.!?])\s+(?=[A-Z0-9`"“*(])/u)[0] ?? body
  const phrase = first
    // code reads as its name: `NO_CODE_KINDS = new Set([…])` → NO_CODE_KINDS, `judgeShares(x)` → judgeShares
    .replace(/`([^`]*)`/g, (_, code: string) => code.replace(/^([\w.$]+)\s*(?:=|\().*$/s, "$1"))

  const words = trimEndCharacters(phrase, ".:;,").trim()
  const capital = words.charAt(0).toUpperCase() + words.slice(1)
  if (capital.length <= HEADLINE_MAX) return capital
  const cut = capital.slice(0, HEADLINE_MAX - 1)
  const space = cut.lastIndexOf(" ")
  return `${(space > HEADLINE_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, "")}…`
}

/** The files a verdict's text names in backticks, without line numbers and without its own evidence. */
export function citedPaths(text: string): string[] {
  const paths = new Set<string>()
  for (const match of text.matchAll(/`([^`\s]+)`/g)) {
    const span = (match[1] ?? "").replace(/:\d+(?::\d+)?$/, "")
    if (!FILE_LIKE.test(span)) continue
    if (/^(?:evidence|records)\//.test(span)) continue
    paths.add(span)
  }
  return [...paths]
}

/** A commit after the judged one: its slice, when its subject names one, and the files it changed. */
export type LaterCommit = { slice: number | null; files: string[] }

const KEEP_MS = 20_000
const later = new Map<string, { at: number; commits: LaterCommit[] | null }>()

/**
 * The commits since the judged revision, newest first. Review reads them on every App poll, so the
 * answer is kept for a few seconds per checkout and revision.
 */
export async function commitsSince(
  ctx: Ctx,
  checkout: string,
  revision: string,
): Promise<LaterCommit[] | null> {
  const key = `${checkout}\0${revision}`
  const kept = later.get(key)
  const now = ctx.clock.now()
  if (kept !== undefined && now - kept.at < KEEP_MS) return kept.commits
  const run = await ctx.git.run(checkout, [
    "log",
    "--no-merges",
    "--format=%x1e%s",
    "--name-only",
    `${revision}..HEAD`,
  ])
  const commits =
    run.code !== 0
      ? null
      : run.stdout
          .split("\x1e")
          .filter((record) => record.trim() !== "")
          .map((record) => {
            const [subject = "", ...files] = record.split("\n")
            const slice = subject.match(/\bslice (\d+)\b/i)
            return {
              slice: slice !== null ? Number(slice[1]) : null,
              files: files.map((f) => f.trim()).filter(Boolean),
            }
          })
  later.set(key, { at: now, commits })
  return commits
}

/** Whether a changed file is the one a finding names (a judge often leaves the package folder out). */
const names = (changed: string, cited: string) => changed === cited || changed.endsWith(`/${cited}`)

/**
 * What changed after the judges looked at a finding: the slices whose commits touched a file it
 * names (null slice: a commit outside any slice). Empty when nothing it names changed since.
 */
export function changedAfter(text: string, commits: LaterCommit[] | null): (number | null)[] {
  if (commits === null || commits.length === 0) return []
  const cited = citedPaths(text)
  if (cited.length === 0) return []
  const slices = new Set<number | null>()
  for (const commit of commits)
    if (commit.files.some((file) => cited.some((c) => names(file, c)))) slices.add(commit.slice)
  return [...slices].sort((a, b) => (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER))
}

/** "changed in slice 40", "changed in slices 40 and 41", "changed after checking". */
export function changedWords(slices: (number | null)[]): string | null {
  if (slices.length === 0) return null
  const numbered = slices.filter((s): s is number => s !== null)
  if (numbered.length === 0) return "changed after checking"
  if (numbered.length === 1) return `changed in slice ${numbered[0]}`
  return `changed in slices ${numbered.slice(0, -1).join(", ")} and ${numbered.at(-1)}`
}
