// Source pointers and known risk surfaces used by the small-change view.

const FILE =
  /(?:^|[\s`(|])((?:[\w.@-]+\/)*[\w@][\w.@-]*\.[A-Za-z][A-Za-z0-9]{0,5})(:\d+(?:-\d+)?)?/g

/** Extensions a bare root name needs to count as a file: `process.argv` or `console.log` in a note is code, not a file. */
const FILE_EXT = new Set(
  "ts tsx js jsx mjs cjs json jsonc md mdx markdown rst adoc txt py rs go rb java kt swift c h cc cpp hpp cs php sh bash zsh ps1 yml yaml toml ini cfg lock css scss html vue svelte sql gradle xml".split(
    " ",
  ),
)

/** A framework's name, such as Node.js or Vue.js. */
const PRODUCT_NAME = /^[A-Z][a-z]+\.js$/

/** A match that names a file: with a line, with a folder, or a bare name with a file extension that is not a call, an index or a product name. */
function namesFile(path: string, line: string | undefined, next: string): boolean {
  if (line !== undefined || path.includes("/")) return true
  if (PRODUCT_NAME.test(path)) return false
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase()
  return FILE_EXT.has(ext) && next !== "(" && next !== "["
}

/**
 * The files Discuss's first look names in its table rows (`| path:line | … |`), each once, in
 * order. Null when the section has no table row with a file: a first look without its files says
 * too little to be small.
 */
export function firstLookFiles(section: string): string[] | null {
  const files: string[] = []
  for (const line of section.split(/\r?\n/)) {
    if (!/^\s*\|/.test(line) || /^\s*\|[\s:|-]+$/.test(line)) continue
    for (const match of line.matchAll(FILE)) {
      const path = match[1] ?? ""
      const next = line.charAt((match.index ?? 0) + match[0].length)
      if (path !== "" && namesFile(path, match[2], next) && !files.includes(path)) files.push(path)
    }
  }
  return files.length === 0 ? null : files
}

const RISK_PATH =
  /(^|\/)(migrations?|schemas?|auth|authz|authn|permissions?|secrets?|credentials?|\.github\/workflows)(\/|\.|$)|\.sql$|(^|\/)(package\.json|bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.(toml|lock)|go\.(mod|sum)|requirements[\w.-]*\.txt|pyproject\.toml|Dockerfile|\.env[\w.-]*)$/i

/** A path that is a risk surface: a schema or migration, authentication, a secret, a dependency manifest, CI. */
export const riskSurfaceOf = (path: string): boolean => RISK_PATH.test(path)

export type SmallBounds = {
  ok: boolean
  /** Each bound that does not hold, in a person's words. */
  broken: string[]
  files: number
}

/**
 * A known first look with no risk surface; counts and folder layout are not workflow limits.
 */
export function smallBounds(input: { files: string[] | null; untraced: boolean }): SmallBounds {
  const broken: string[] = []
  if (input.files === null) {
    broken.push("the first look names no files in a table")
    return { ok: false, broken, files: 0 }
  }
  const risky = input.files.filter(riskSurfaceOf)
  if (risky.length > 0) broken.push(`a risk surface: ${risky.join(", ")}`)
  if (input.untraced) broken.push("an area the first look could not trace")
  return { ok: broken.length === 0, broken, files: input.files.length }
}

/** The artifact references of a Plan (`<!-- ql:artifact … -->`), in order. */
export function artifactMarkers(plan: string): string[] {
  return [...plan.matchAll(/<!--\s*ql:artifact\s+(\S+?)\s*-->/g)].map((match) => match[1] ?? "")
}
