import { FENCE_MAX_BYTES, type FragmentKind, readHeaderLine, SURFACES } from "./fence-header.ts"
import { boundedErrors, FRAGMENT_ATTRS, FRAGMENT_TAGS } from "./fragment-dom.ts"
import { inspectFragment } from "./fragment-inspect.ts"

export { type FragmentKind, SURFACES } from "./fence-header.ts"
export { panelNodes } from "./fragment-dom.ts"

export type FragmentError = {
  rule: string
  message: string
  line: number
  severity: "error" | "warning"
}

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/

export const LENSES = new Set(
  "request-lifecycle data-flow state-transitions route-page-map command-surface external-integrations dependency-map orchestration storage architecture sequence state data screens commands services flow".split(
    " ",
  ),
)

export function fragmentVocabulary(kind: FragmentKind): { tags: string[]; attrs: string[] } {
  return {
    tags: [...FRAGMENT_TAGS, ...(kind === "panel" ? ["section"] : [])],
    attrs: [
      ...FRAGMENT_ATTRS,
      ...(kind === "panel" ? ["data-title", "data-role", "data-id"] : []),
    ].filter((a) => kind !== "panel" || a !== "id"),
  }
}

/** A fence with no error: what a team copy keeps (core/team/publication.ts). */
export function fenceValid(kind: FragmentKind, text: string): boolean {
  return !parseFence(kind, text).errors.some((error) => error.severity === "error")
}

function parseHeaderLines(
  kind: FragmentKind,
  headerLines: string[],
  header: Record<string, string>,
  fail: (message: string, line: number) => void,
): void {
  const keys =
    kind === "wireframe" ? ["name", "surface", "title", "state"] : ["name", "lens", "title"]
  headerLines.forEach((line, index) => {
    const match = readHeaderLine(line)
    const key = match?.[1] ?? ""
    const value = match?.[2] ?? ""
    if (!keys.includes(key)) fail(`unknown header: ${key || line}`, index + 1)
    else if (key in header) fail(`duplicate header: ${key}`, index + 1)
    else header[key] = value
    if (key === "name" && !NAME.test(value))
      fail("name must be at most 40 lowercase letters, digits or dashes", index + 1)
    if ((key === "title" && value.length > 80) || (key === "state" && value.length > 40))
      fail(`${key} is too long`, index + 1)
    if (key === "lens" && !LENSES.has(value)) fail("invalid lens", index + 1)
  })
  if (kind === "wireframe" && !Object.hasOwn(SURFACES, header.surface ?? ""))
    fail("surface must be browser, desktop, phone, popover or panel", 1)
}

export function parseFence(
  kind: FragmentKind,
  body: string,
): { header: Record<string, string>; fragment: string; errors: FragmentError[] } {
  const header: Record<string, string> = {}
  const errors: FragmentError[] = []
  const fail = (message: string, line: number) =>
    errors.push({ rule: `${kind}-header`, message, line, severity: "error" as const })
  if (body.length > FENCE_MAX_BYTES || new TextEncoder().encode(body).length > FENCE_MAX_BYTES) {
    return {
      header,
      fragment: "",
      errors: [{ rule: "fence-size", message: "fence exceeds 24 KB", line: 1, severity: "error" }],
    }
  }
  const lines = body.split(/\r?\n/)
  const split = lines.findIndex((l) => l.trim() === "")
  if (split < 0) fail("header needs a blank line before the fragment", 1)
  parseHeaderLines(kind, lines.slice(0, split < 0 ? lines.length : split), header, fail)
  const inspected = inspectFragment(kind, split < 0 ? "" : lines.slice(split + 1).join("\n"))
  errors.push(...inspected.errors.map((e) => ({ ...e, line: e.line + Math.max(0, split + 1) })))
  return {
    header,
    fragment: errors.some((e) => e.severity === "error") ? "" : inspected.fragment,
    errors: boundedErrors(errors),
  }
}

export function sanitizeFragment(kind: FragmentKind, html: string): string {
  if (html.length > FENCE_MAX_BYTES || new TextEncoder().encode(html).length > FENCE_MAX_BYTES)
    return ""
  return inspectFragment(kind, html).fragment
}
