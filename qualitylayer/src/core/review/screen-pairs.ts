import { extractFences } from "../docs/fence-scanner.ts"
import type { PlanStill } from "../team/publication.ts"
import { type EvidenceSource, safeScreenKey } from "./screen-evidence.ts"

/** The browser-safe screen comparison carried by Review text and its optional raster stills. */
export type WalkScreen = Partial<EvidenceSource> & {
  key: string
  width: number
  height?: number
  theme: "light" | "dark"
  outcome:
    | "captured"
    | "not captured"
    | "skipped: no browser"
    | `unavailable: ${string}`
    | "omitted: size"
  stale: boolean
  staleReason?: string
  file?: string | null
  /** The picture the Plan's artifact was approved with (`assets/…`), when it has one. */
  approved?: string
  artifact?: { kind: "wireframe" | "html"; source: string }
  image?: string
  built?: string
  verdict: string
}

export const screenSize = (screen: Pick<WalkScreen, "width" | "height">): string =>
  `${screen.width}${screen.height === undefined ? "" : ` × ${screen.height}`} px`

export const screenStillKey = (
  screen: Pick<WalkScreen, "key" | "width" | "height" | "theme">,
): string =>
  `screen/${screen.key}/${screen.width}${screen.height === undefined ? "" : `x${screen.height}`}/${screen.theme}`

const SCREEN_ROW =
  /^- \*\*([^*\r\n]+)\*\* · (\d+)(?: × (\d+))? px · (light|dark) · (captured|not captured|skipped: no browser|unavailable: .+|omitted: size) · (stale|current)$/

function parseScreenRow(line: string): WalkScreen | null {
  const row = SCREEN_ROW.exec(line)
  const key = row?.[1] ?? ""
  if (!row || !safeScreenKey(key)) return null
  return {
    key,
    width: Number(row[2]),
    ...(row[3] ? { height: Number(row[3]) } : {}),
    theme: row[4] as "light" | "dark",
    outcome: row[5] as WalkScreen["outcome"],
    stale: row[6] === "stale",
    verdict: "No comparison recorded.",
  }
}

function applyScreenDetail(screen: WalkScreen | undefined, line: string): void {
  if (!screen) return
  const verdict = "  - Independent review: "
  if (line.startsWith(verdict)) screen.verdict = line.slice(verdict.length)
  else if (line.startsWith("  - Refresh: ")) screen.staleReason = line.slice(13)
  else if (line.startsWith("  - Designed: ")) screen.approved = line.slice(14).replace(/^`|`$/g, "")
}

export function screensFromReview(review: string): WalkScreen[] {
  const screens: WalkScreen[] = []
  const fences = extractFences(review)
  let inside = false
  for (const [index, line] of review.split(/\r?\n/).entries()) {
    if (fences.some((fence) => index + 1 >= fence.line && index + 1 <= fence.endLine)) continue
    if (/^## /.test(line)) {
      inside = /^## Screens\s*$/.test(line)
      continue
    }
    if (!inside) continue
    const parsed = parseScreenRow(line)
    if (parsed) screens.push(parsed)
    else applyScreenDetail(screens.at(-1), line)
  }
  return screens
}

export function withScreenStills(
  screens: readonly WalkScreen[],
  stills: Readonly<Record<string, PlanStill>>,
): WalkScreen[] {
  return screens.map((screen) => {
    const still = stills[screenStillKey(screen)]
    if (!still) return screen
    return still.outcome
      ? { ...screen, outcome: still.outcome }
      : {
          ...screen,
          image: still.image,
          ...(screen.outcome === "captured" && still.built ? { built: still.built } : {}),
        }
  })
}
