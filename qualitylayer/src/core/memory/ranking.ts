import { trimEndCharacters } from "../text-boundaries.ts"
// How a search ranks lessons: full-text hits and meaning (cosine similarity) are fused, and a lesson
// that matches neither way never enters. Pure: no I/O, so the ranking test calls it directly.

/** Pipeline identity for derived vectors; tokenizer changes must invalidate earlier vectors. */
export const VECTOR_MODEL = "all-MiniLM-L6-v2-q8-bert-clean-v2"
export const VECTOR_DIMENSIONS = 384
/**
 * A lesson enters through meaning only at this cosine or above. Tuned on the ranking set with the
 * int8 model: its 12 paraphrases score 0.158 to 0.435 against their lesson, and the 6 unrelated
 * queries score at most 0.113 against any lesson. The plan's 0.30 (measured with the fp32 model)
 * would drop 3 of the 12 paraphrases.
 */
export const MIN_COSINE = 0.15

const STOPWORDS = new Set(
  `a an the is are was were be been being am do does did has have had will would should could can
  may might must shall to of in on at by for from with without into onto over under up down out
  off about after before when while where which who whom whose what whether why how there here
  this that these those it its i me my we us our you your he him his she her they them their and
  or but not no nor so than then as if still just also very`.split(/\s+/),
)

/** The words of a query that carry meaning for full-text matching, in order, at most 20. */
export function contentWords(query: string): string[] {
  const words = query.match(/[\p{L}\p{N}_-]+/gu) ?? []
  return words.filter((word) => !STOPWORDS.has(word.toLowerCase())).slice(0, 20)
}

/** The text cut to at most `max` characters, never inside a surrogate pair. */
export function cutChars(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

/** Folders and extensions that name every other file of a project: too common to find a lesson by. */
const COMMON_PATH_WORDS = new Set(["src", "lib", "app", "dist", "test", "tests", "index"])

export function queryPaths(query: string): string[] {
  const text = query.replaceAll("\\", "/")
  const path = /(?:[\w.@-]+\/)+[\w.@-]+/g
  const files =
    text
      .replace(path, " ")
      .match(
        /\b[\w.@-]+\.(?:tsx?|jsx?|go|rs|py|md|jsonc?|toml|ya?ml|css|html|sh|sql|txt|svg|png|webp)\b/g,
      ) ?? []
  return [...new Set([...(text.match(path) ?? []), ...files])].slice(0, 8)
}

export function querySymbols(query: string, paths: readonly string[]): string[] {
  let topic = query.replaceAll("\\", "/")
  for (const path of paths) topic = topic.replaceAll(path, " ")
  return contentWords(topic)
    .filter((word) => word.includes("_") || /^[a-z].*[a-z][A-Z]/.test(word))
    .map((word) => word.toLowerCase())
}

function matchesFileOrFolder(file: string, path: string) {
  const sameFile = file === path || file.endsWith(`/${path}`) || path.endsWith(`/${file}`)
  const inFolder = file.startsWith(`${path}/`) || file.includes(`/${path}/`)
  return sameFile || inFolder
}

export function matchesPaths(paths: readonly string[], files: readonly string[]): boolean {
  return paths.some((path) => files.some((file) => matchesFileOrFolder(file, path)))
}

/**
 * The words that search a lesson by full text: the names a file path in the query carries first
 * (`src/export.ts` gives `export`), so a long text never loses its files behind its first words,
 * then the content words, at most 20 in all.
 */
export function searchWords(query: string): string[] {
  const paths = /(?:[\w.-]+\/)+[\w.-]+/g
  const fromPaths = (query.match(paths) ?? []).flatMap((path) =>
    trimEndCharacters(path, ".-")
      .replace(/\.[A-Za-z0-9]{1,8}$/, "")
      .split(/[/.]/)
      .filter((part) => part.length >= 3 && !COMMON_PATH_WORDS.has(part.toLowerCase())),
  )
  const seen = new Set<string>()
  return [...fromPaths, ...contentWords(query.replace(paths, " "))]
    .filter((word) => !seen.has(word.toLowerCase()) && seen.add(word.toLowerCase()))
    .slice(0, 20)
}

/** A list of several concrete search terms asks for a combined topic, not any one term. */
export function specificKeywords(query: string): string[] | null {
  const raw = query.match(/[\p{L}\p{N}_-]+/gu) ?? []
  if (raw.length < 5 || raw.length > 20 || contentWords(query).length !== raw.length) return null
  return [...new Set(raw.map((word) => word.toLowerCase()))]
}

export function supportsKeywords(terms: readonly string[], text: string): boolean {
  const words = text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []
  return (
    terms.filter((term) => words.some((word) => word.startsWith(term))).length >=
    Math.ceil(terms.length / 2)
  )
}

/** Strong meaning can support a specific keyword query without sharing its wording. */
export const SPECIFIC_COSINE = 0.55

/** The dot product; the cosine of two unit-length vectors. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += (a[i] as number) * (b[i] as number)
  return sum
}

const FTS_WEIGHT = 1
const VECTOR_WEIGHT = 2
const K = 10

/**
 * `1/(10 + rank_fts) + 2 x cosine` with a 1-based full-text rank; a lesson missing from a list adds
 * nothing for it. A word hit adds at most 1/11 = 0.091, so one shared word outranks a closer
 * meaning only when the cosines are within 0.045 of each other. The meaning term is the cosine
 * itself, not its position in the list: a position gives rank 1 and rank 2 almost the same credit
 * however far apart their cosines are. Cosines under `MIN_COSINE` add nothing. Both lists empty
 * returns nothing.
 */
export function fuseRanks(
  fts: string[],
  vector: { id: string; cosine: number }[],
  limit: number,
): string[] {
  const score = new Map<string, number>()
  const add = (id: string, amount: number) => score.set(id, (score.get(id) ?? 0) + amount)
  for (const [index, id] of [...new Set(fts)].entries()) add(id, FTS_WEIGHT / (K + index + 1))
  const near = vector
    .filter((entry) => entry.cosine >= MIN_COSINE)
    .sort((a, b) => b.cosine - a.cosine || a.id.localeCompare(b.id))
  for (const entry of near) add(entry.id, VECTOR_WEIGHT * entry.cosine)
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(0, limit))
    .map(([id]) => id)
}

/** The slots a page keeps for the person's lessons, so a full page of the repository's cannot hide them. */
export const PERSONAL_SLOTS = 2

/**
 * One page from two ranked lists: the repository's relevance order, then the person's. Source
 * freshness remains a fact on each hit, not a new relevance order. The person keeps up to `PERSONAL_SLOTS` slots,
 * but never the page's last repository slot when it has more than one, and gets what the repository
 * leaves free. The total stays within `limit`.
 */
export function composeHits<T extends { sources?: { state: string } }>(
  repo: T[],
  you: T[],
  limit: number,
): T[] {
  const kept = Math.min(you.length, PERSONAL_SLOTS, Math.max(limit - 1, 0))
  const first = repo.slice(0, limit - kept)
  return [...first, ...you.slice(0, limit - first.length)]
}
