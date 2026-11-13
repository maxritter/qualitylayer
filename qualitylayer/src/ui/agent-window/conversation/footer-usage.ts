// What the Conversation footer's right side says besides the context ring: the files this session changed,
// the usage chip (the tightest plan window, or this session's estimated cost when its agent is billed by
// use), and how the two give way to the pickers as the row narrows. Pure: the footer draws these.

import type { UsageBilling } from "../../../core/cost/usage.ts"
import type { AgentLimits } from "../../../core/limits/index.ts"
import type { TurnChanges } from "../../../core/run/turn-snapshots.ts"
import { type PercentageMode, percentage } from "../../../core/usage-display.ts"
import { tightestWindow } from "../../sidebar/limits-face.ts"
import { usd } from "../../usage/format.ts"
import { leftIn, resetIn } from "./limit-values.ts"

/** The plan windows' short names in the chip: the full label for any other. */
const SHORT_WINDOW: Record<string, string> = {
  "5 hours": "5 h",
  "This week": "Week",
  "This week · Fable": "Fable week",
}

export type SessionUse =
  | {
      kind: "plan"
      word: string
      /** Running ahead of an even pace: the one state that is amber. */
      ahead: boolean
      title: string
      label: string
    }
  | { kind: "key"; word: string; title: string; label: string }

/**
 * The usage chip. Billed by use (an API key, a gateway) it is this session's estimated cost; on a plan the
 * agent's tightest window and what is left of it, never a dollar amount. An agent whose billing is not
 * known is judged by its limits: a window makes it a plan, nothing makes no chip.
 */
export function sessionUse(input: {
  billing: UsageBilling | undefined
  limits: AgentLimits | undefined
  estimatedUsd: number | undefined
  now: number
  percentMode?: PercentageMode
}): SessionUse | null {
  const { billing, limits, estimatedUsd, now } = input
  if (billing === "key" || billing === "gateway") {
    if (estimatedUsd === undefined) return null
    const amount = estimatedUsd < 0.005 ? "< $0.01" : usd(estimatedUsd)
    return {
      kind: "key",
      word: amount,
      title: `This session, ${amount} · estimated at list prices`,
      label: `This session ${amount}, estimate · usage details`,
    }
  }
  const window = limits === undefined ? undefined : tightestWindow(limits, now)
  if (window === undefined) return null
  const left = leftIn(window)
  const mode = input.percentMode ?? "used"
  const amount = percentage(window.reached ? 100 : window.usedPercent, mode)
  if (amount === null) return null
  const ahead = window.pacePercent !== null && 100 - window.pacePercent > left
  const reset = resetIn(window.resetsAt, now)
  return {
    kind: "plan",
    word: `${SHORT_WINDOW[window.label] ?? window.label} · ${amount} % ${mode}`,
    ahead,
    title: `Plan pacing: ${window.label.toLowerCase()} · ${amount} % ${mode}${reset ? ` · resets in ${reset}` : ""}${ahead ? " · ahead of pace" : ""}`,
    label: `Plan pacing: ${window.label}, ${amount} percent ${mode}${ahead ? ", ahead of pace" : ""} · open pacing details`,
  }
}

export type SessionChanges = { files: number; added: number; removed: number }

/** What the whole session changed: every file once, however many turns edited it, and the lines of every turn. */
export function sessionChanges(turns: readonly TurnChanges[]): SessionChanges | null {
  const paths = new Set<string>()
  let more = 0
  let added = 0
  let removed = 0
  for (const turn of turns) {
    if (!("files" in turn)) continue
    for (const file of turn.files) paths.add(file.path)
    more += turn.more
    added += turn.added
    removed += turn.removed
  }
  const files = paths.size + more
  return files === 0 ? null : { files, added, removed }
}

/** How far the chips are folded: see `chooseFold`. */
export type Fold = 0 | 1 | 2 | 3 | 4 | 5

/**
 * The widths the fold is chosen from: the row's room, what the pickers, the state word and the ring take
 * (all in px), the gap between them, and each form of each chip (null when the chip is not there). A chip
 * also takes the 2 px gap of its cluster, and 8 px stay free so the row never touches.
 */
export type FoldInput = {
  room: number
  picks: number
  state: number
  ring: number
  gap: number
  /** The files chip: full ("5 files +120 −30"), without the counts, and as an icon and a number. */
  files: readonly [number, number, number] | null
  /** The usage chip: icon and words, and the icon alone. */
  use: readonly [number, number] | null
}

/**
 * The chips fold to the footer's measured width, never by a fixed breakpoint, so the pickers and the ring keep
 * one line: 0 everything · 1 without the +/− counts · 2 files as icon and number · 3 usage as its icon · 4 no files
 * chip · 5 no usage chip (the ring's popover still holds it).
 */
export function chooseFold(input: FoldInput): Fold {
  const { room, files, use } = input
  if (room <= 0 || (files === null && use === null)) return 0
  const forms: [number | null, number | null][] = [
    [files?.[0] ?? null, use?.[0] ?? null],
    [files?.[1] ?? null, use?.[0] ?? null],
    [files?.[2] ?? null, use?.[0] ?? null],
    [files?.[2] ?? null, use?.[1] ?? null],
    [null, use?.[1] ?? null],
    [null, null],
  ]
  const fixed = input.picks + input.state + input.ring + input.gap * (input.state > 0 ? 2 : 1) + 8
  const at = forms.findIndex(
    ([f, u]) => fixed + (f === null ? 0 : f + 2) + (u === null ? 0 : u + 2) <= room,
  )
  return (at < 0 ? 5 : at) as Fold
}
