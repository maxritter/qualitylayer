// What a code span in the agent's text names: a file or a commit. Only a span that is clearly one becomes a
// chip; `user.name`, `npm test` and `1.5` stay ordinary code.

import { parseArtifactReference } from "../../../core/artifact/reference.ts"
import { fileKind } from "../../kit/marks/index.ts"

export type Chip = { kind: "file"; path: string; line?: number } | { kind: "commit"; sha: string }

/** A short or whole commit id: hex of 7 to 12 characters holding a digit and a letter, or all 40. */
const COMMIT = /^(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,12}$|^[0-9a-f]{40}$/

/** Letters of a path as agents write them, brackets included for routes such as `[id].tsx`. */
const PATH = /^[\w@.+~/\-[\]()]+$/

/** Extensions of files agents name that the marks do not have a kind for. */
const EXTENSIONS = new Set(
  "txt go java kt kts rb php c h cc cpp hpp cs swift sql toml xml csv tsv ini cfg conf gradle vue svelte astro tf proto graphql gql pdf".split(
    " ",
  ),
)

/** `src/a.ts:42` and `src/a.ts:42:7`: the file, and the line when one is named. */
const LINE = /^(.+?):(\d+)(?::\d+)?$/

/** `Node.js`, `Next.js`: a product's name, not a file, when it stands alone. */
const PRODUCT = /^[A-Z][A-Za-z]*\.js$/

/** Settings files that are all extension: `.env`, `.env.local`, `.gitignore`. */
const DOTFILE =
  /^(?:.*\/)?\.(?:env(?:\.[\w-]+)*|gitignore|gitattributes|npmrc|nvmrc|editorconfig|dockerignore|prettierrc|eslintrc)$/

/** What code reads a property of: `res.json`, `process.env`, `import.meta.env` are code, not files. */
const OBJECTS = new Set([
  "process",
  "import",
  "res",
  "req",
  "response",
  "request",
  "window",
  "document",
])

function isFile(path: string): boolean {
  if (!PATH.test(path) || path.startsWith("-") || path.endsWith("/") || PRODUCT.test(path))
    return false
  if (DOTFILE.test(path)) return true
  if (!path.includes("/") && OBJECTS.has(path.split(".")[0] ?? "")) return false
  const name = path.split("/").pop() ?? ""
  const dot = name.lastIndexOf(".")
  if (dot < 1) return false
  return fileKind(name) !== "generic" || EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
}

export function chipOf(text: string): Chip | undefined {
  if (COMMIT.test(text)) return { kind: "commit", sha: text }
  if (text.includes("/") && parseArtifactReference(text)) return { kind: "file", path: text }
  const lined = LINE.exec(text)
  const path = lined?.[1] ?? text
  if (!isFile(path)) return undefined
  return { kind: "file", path, ...(lined?.[2] ? { line: Number(lined[2]) } : {}) }
}
