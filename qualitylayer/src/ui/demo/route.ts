// The pages the website may open inside the demo: a route from the page around it is checked before
// it becomes the address, so the demo never follows a link it does not draw.

import { NATIVE_AGENTS } from "../../core/agents/ids.ts"
import type { Route } from "../hooks.ts"
import { FLAGSHIP_STAGES, type FlagshipStage } from "./flagship.ts"

/** The step the address asks the flagship task to open at: `?flagship=implement`. */
export function flagshipFrom(search: string): FlagshipStage | undefined {
  const asked = new URLSearchParams(search).get("flagship")
  return FLAGSHIP_STAGES.find((stage) => stage === asked)
}

/** Explicit illustrative client selection; it never starts a real provider. */
export function nativeAgentFrom(search: string) {
  const asked = new URLSearchParams(search).get("native-agent")
  return NATIVE_AGENTS.find((agent) => agent === asked)
}

export function demoTourLocation(href: string, tier: string, at = 0): string {
  const address = new URL(href)
  const previous = `${address.pathname}${address.search}${address.hash}`
  address.search = ""
  address.searchParams.set("tour", at > 0 ? String(Math.floor(at)) : "")
  address.searchParams.set("tier", tier)
  if (previous.length <= 8192) address.searchParams.set("return", previous)
  address.hash = ""
  return address.href
}

/** A demo return stays in that same example path; a URL parameter cannot become an outside link. */
export function demoTourReturn(href: string): string {
  const address = new URL(href)
  const asked = address.searchParams.get("return")
  if (asked && asked.length <= 8192 && asked.startsWith("/") && !asked.startsWith("//")) {
    const target = new URL(asked, address)
    if (target.origin === address.origin && target.pathname === address.pathname)
      return `${target.pathname}${target.search}${target.hash}`
  }
  return `${address.pathname}#/`
}

function isNonEmptyBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max
}

function isValidArtifactRoute(route: Record<string, unknown>): boolean {
  if (!isNonEmptyBoundedString(route.project, 256) || !isNonEmptyBoundedString(route.file, 1024))
    return false
  const printable = [...(route.project + route.file)].every((ch) => ch.charCodeAt(0) >= 32)
  if (!printable || route.file.split(/[\\/]/).includes("..")) return false
  const validAt = route.at === undefined || typeof route.at === "string"
  const validQuery = route.query === undefined || typeof route.query === "string"
  return validAt && validQuery
}

const isValidTaskRoute = (route: Record<string, unknown>): boolean =>
  typeof route.id === "string" && (route.doc === null || typeof route.doc === "string")

const ROUTE_CHECKERS: Record<string, (route: Record<string, unknown>) => boolean> = {
  home: () => true,
  artifacts: () => true,
  artifact: isValidArtifactRoute,
  settings: (route) => route.tab === undefined || typeof route.tab === "string",
  task: isValidTaskRoute,
  "team-task": isValidTaskRoute,
}

export function validRoute(value: unknown): value is Route {
  if (!value || typeof value !== "object") return false
  const route = value as Record<string, unknown>
  const check = typeof route.view === "string" ? ROUTE_CHECKERS[route.view] : undefined
  return check?.(route) === true
}
