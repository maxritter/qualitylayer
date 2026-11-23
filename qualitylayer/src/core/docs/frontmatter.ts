// Minimal flat YAML frontmatter: the CLI writes it, agents preserve it.
// Supported values: strings, numbers, booleans, null, inline arrays.
// Deliberately no dependency and no nesting.

export type FrontmatterValue = string | number | boolean | null | FrontmatterValue[]
export type Frontmatter = Record<string, FrontmatterValue>

export type ParsedDoc = {
  frontmatter: Frontmatter | null
  body: string
  /** 1-based line number of the first body line. */
  bodyStart: number
}

function advanceQuote(inner: string, i: number, quote: string): { quote: string; skip: number } {
  const char = inner[i] ?? ""
  if (quote === '"' && char === "\\") return { quote, skip: 1 }
  if (char !== quote) return { quote, skip: 0 }
  if (quote === "'" && inner[i + 1] === "'") return { quote, skip: 1 }
  return { quote: "", skip: 0 }
}

/** Split YAML-style inline arrays without splitting quoted commas or nested arrays. */
function arrayItems(inner: string): string[] {
  const items: string[] = []
  let quote = ""
  let depth = 0
  let start = 0
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i] ?? ""
    if (quote !== "") {
      const next = advanceQuote(inner, i, quote)
      quote = next.quote
      i += next.skip
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === "[") depth++
    else if (char === "]") depth--
    else if (char === "," && depth === 0) {
      items.push(inner.slice(start, i))
      start = i + 1
    }
  }
  items.push(inner.slice(start))
  return items
}

const SCALAR_LITERALS: Record<string, FrontmatterValue> = {
  "": null,
  null: null,
  "~": null,
  true: true,
  false: false,
}

function parseQuotedString(value: string): string | undefined {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string
    } catch {
      // Preserve older hand-authored quoted values with non-JSON escapes.
      return value.slice(1, -1)
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'")
  }
  return undefined
}

function parseScalar(raw: string): FrontmatterValue {
  const value = raw.trim()
  if (Object.hasOwn(SCALAR_LITERALS, value)) return SCALAR_LITERALS[value] ?? null
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim()
    return inner === "" ? [] : arrayItems(inner).map((item) => parseScalar(item))
  }
  return parseQuotedString(value) ?? value
}

function stringifyScalar(value: FrontmatterValue): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return JSON.stringify(value)
  if (typeof value === "string") {
    const needsQuotes =
      /[,:#[\]{}"'\\\n\r\t]|^\s|\s$/.test(value) ||
      value === "" ||
      /^(true|false|null|~|-?\d+(\.\d+)?)$/.test(value)
    return needsQuotes ? JSON.stringify(value) : value
  }
  return String(value)
}

export function parseDoc(markdown: string): ParsedDoc {
  const lines = markdown.split(/\r?\n/)
  if (lines[0] !== "---") return { frontmatter: null, body: markdown, bodyStart: 1 }
  const frontmatter: Frontmatter = {}
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? ""
    if (line === "---") {
      return {
        frontmatter,
        body: lines.slice(i + 1).join("\n"),
        bodyStart: i + 2,
      }
    }
    const match = line.match(/^([A-Za-z0-9_-]+):(.*)$/)
    if (match?.[1] !== undefined) frontmatter[match[1]] = parseScalar(match[2] ?? "")
  }
  // Unterminated frontmatter fence: treat the whole document as body.
  return { frontmatter: null, body: markdown, bodyStart: 1 }
}

export function stringifyFrontmatter(frontmatter: Frontmatter): string {
  const lines = Object.entries(frontmatter).map(
    ([key, value]) => `${key}: ${stringifyScalar(value)}`,
  )
  return `---\n${lines.join("\n")}\n---\n`
}

export function withFrontmatter(frontmatter: Frontmatter, body: string): string {
  return `${stringifyFrontmatter(frontmatter)}${body.startsWith("\n") ? "" : "\n"}${body}`
}

/** Merge a patch into a document's frontmatter, preserving the body. */
export function patchFrontmatter(markdown: string, patch: Frontmatter): string {
  const { frontmatter, body } = parseDoc(markdown)
  return `${stringifyFrontmatter({ ...(frontmatter ?? {}), ...patch })}${body}`
}
