// Canonical App routes shared by the CLI and browser-opening server actions.
import { folderArtifactOf } from "./artifact/format.ts"
import { FLOW_STEPS } from "./flow.ts"

/** One path segment of a link: the same alphabet the App's links accept. */
const SEGMENT = /^[A-Za-z0-9._~-]{1,120}$/
const ARITY = new Map<string, readonly [number, number]>([
  ["task", [1, 3]],
  ["ask", [2, 2]],
  ["team", [1, 2]],
  ["artifact", [2, 3]],
])
const TASK_ARTIFACT = /^artifacts%2[fF][a-z0-9][a-z0-9-]*\.html$/
const PROJECT_ARTIFACT = /^docs%2[fF]artifacts%2[fF][a-z0-9][a-z0-9-]*\.html$/

function artifactDocument(segment: string, project: boolean): boolean {
  if ((project ? PROJECT_ARTIFACT : TASK_ARTIFACT).test(segment)) return true
  try {
    const file = decodeURIComponent(segment)
    if (encodeURIComponent(file).toLowerCase() !== segment.toLowerCase()) return false
    const folder = folderArtifactOf(file)
    const task = folder?.root === "artifacts" || folder?.root === "design"
    return folder !== null && (project ? !task : task)
  } catch {
    return false
  }
}

/** Use the same checked route for CLI artifact opening and explicit App links. */
export function artifactAppRoute(
  scope: "project" | "task",
  id: string,
  file: string,
  section?: string,
  query?: string,
): string | null {
  return routeOf(
    `${scope === "project" ? "artifact" : "task"}/${encodeURIComponent(id)}/${encodeURIComponent(file)}${section === undefined ? "" : `/${encodeURIComponent(section)}`}${query === undefined ? "" : `?query=${encodeURIComponent(query)}`}`,
  )
}

export function artifactQuery(query: string): string | null {
  if (
    query.length > 2048 ||
    Array.from(query).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    return null
  const normalized = new URLSearchParams(query.replace(/^\?/, "")).toString()
  return normalized.length <= 2048 ? normalized : null
}

/**
 * `machine/<id>[/<place>]`: a machine of this computer's list (the page checks the id against the list)
 * and a place on it, which is any place below and never another machine. The shell's link parser keeps
 * the same forms (`links.rs`).
 */
function machineRoute(parts: string[]): string | null {
  const [, id, ...place] = parts
  if (id === undefined || !SEGMENT.test(id) || id === "." || id === "..") return null
  if (place.length === 0) return parts.join("/")
  // A place has an area and what follows it: a bare id is not one here, and a machine is not one.
  if (place.length < 2 || place[0] === "machine") return null
  const inner = place.join("/")
  return routeOf(inner) === inner ? parts.join("/") : null
}

const TASK_OR_TEAM = new Set(["task", "team"])

function hasC1OrControlChar(text: string): boolean {
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (code < 32 || (code >= 127 && code <= 159)) return true
  }
  return false
}

function isArtifactParts(parts: readonly string[]): boolean {
  if (parts[0] === "artifact") return true
  return parts[0] === "task" && artifactDocument(parts[2] ?? "", false)
}

function isValidSectionSegment(part: string): boolean {
  try {
    const section = decodeURIComponent(part)
    if (section.length === 0 || section.length > 200) return false
    if (section === "." || section === ".." || hasC1OrControlChar(section)) return false
    return encodeURIComponent(section).toLowerCase() === part.toLowerCase()
  } catch {
    return false
  }
}

function isValidRoutePart(part: string, index: number, parts: readonly string[]): boolean {
  if (index === 3 && isArtifactParts(parts)) return isValidSectionSegment(part)
  if (part.length > 120 || part === "." || part === "..") return false
  if (index === 2 && parts[0] === "artifact") return artifactDocument(part, true)
  if (SEGMENT.test(part)) return true
  return index === 2 && TASK_OR_TEAM.has(parts[0] ?? "") && artifactDocument(part, false)
}

function routeWithQuery(route: string, mark: number): string | null {
  const path = route.slice(0, mark)
  const params = new URLSearchParams(route.slice(mark + 1))
  const value = params.get("query")
  const normalized = value === null ? null : artifactQuery(value)
  if (normalized === null || [...params.keys()].length !== 1) return null
  if (!isArtifactParts(path.split("/"))) return null
  const checked = routeOf(path)
  return checked ? `${checked}?query=${encodeURIComponent(normalized)}` : null
}

function validateRouteArity(route: string, parts: readonly string[]): string | null {
  if (parts.length === 1) return `task/${route}`
  if (parts.length > 3 && TASK_OR_TEAM.has(parts[0] ?? "") && parts[2] === "artifacts") return null
  if (parts[0] === "step") {
    return parts.length === 3 && FLOW_STEPS.some((step) => step.id === parts[2]) ? route : null
  }
  const arity = ARITY.get(parts[0] ?? "")
  const count = parts.length - 1
  return arity !== undefined && count >= arity[0] && count <= arity[1] ? route : null
}

/**
 * The link route for a task/document/heading, ask, team task, step or project artifact. Artifact
 * documents encode the slashes of their known folder; no other escape or free path is accepted.
 */
export function routeOf(route: string): string | null {
  const mark = route.indexOf("?")
  if (mark !== -1) return routeWithQuery(route, mark)
  const parts = route.split("/")
  if (parts[0] === "machine") return machineRoute(parts)
  if (!parts.every((part, index) => isValidRoutePart(part, index, parts))) return null
  return validateRouteArity(route, parts)
}
