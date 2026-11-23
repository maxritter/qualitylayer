// Measures the footer row and chooses how far its chips fold (footer-usage.ts `chooseFold`). The chips fold
// to the row's real width, not to a breakpoint: every form of each chip is drawn out of sight in
// `.cv-chip-measure` so its width is known, and the pickers, the state word and the ring are read as they are.
// The row is measured again whenever it, or the ring (which drops its words in a narrow row), changes size.

import { type RefObject, useLayoutEffect, useState } from "react"
import { chooseFold, type Fold } from "./footer-usage.ts"

const width = (el: Element | null | undefined): number =>
  el ? el.getBoundingClientRect().width : 0
const px = (value: string): number => Number.parseFloat(value) || 0

/** An element's width with its side margins. */
function outer(el: HTMLElement): number {
  const style = getComputedStyle(el)
  return width(el) + px(style.marginLeft) + px(style.marginRight)
}

/** The pickers' width with their gaps, plus whatever the model's name is clipping; less their negative start. */
function picksWidth(picks: HTMLElement): number {
  const kids = [...picks.children] as HTMLElement[]
  const style = getComputedStyle(picks)
  const label = picks.querySelector<HTMLElement>(".cv-pick-model span")
  const clipped = label ? Math.max(0, label.scrollWidth - label.clientWidth) : 0
  const gaps = px(style.columnGap) * Math.max(0, kids.length - 1)
  return (
    kids.reduce((n, el) => n + outer(el), 0) + gaps + clipped + Math.min(0, px(style.marginLeft))
  )
}

function measureFold(foot: HTMLElement, forms: HTMLElement | null): Fold | undefined {
  const picks = foot.querySelector<HTMLElement>(".cv-picks")
  if (!forms || !picks) return undefined
  const form = (key: string) => width(forms.querySelector(`[data-m="${key}"]`))
  const style = getComputedStyle(foot)
  const has = (key: string) => forms.querySelector(`[data-m="${key}"]`) !== null
  return chooseFold({
    room: foot.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
    picks: picksWidth(picks),
    state: width(foot.querySelector(".cv-state")),
    ring: width(foot.querySelector(".cv-ctx")),
    gap: px(style.columnGap) || 4,
    files: has("files-0") ? [form("files-0"), form("files-1"), form("files-2")] : null,
    use: has("use-0") ? [form("use-0"), form("use-1")] : null,
  })
}

export function useChipFold(
  meta: RefObject<HTMLElement | null>,
  measure: RefObject<HTMLElement | null>,
  deps: readonly unknown[],
): Fold {
  const [fold, setFold] = useState<Fold>(0)
  useLayoutEffect(() => {
    const foot = meta.current
    if (!foot) return
    const run = () => {
      const next = measureFold(foot, measure.current)
      if (next !== undefined) setFold((before) => (before === next ? before : next))
    }
    run()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(run)
    observer.observe(foot)
    // The ring drops its words below some widths; its new width runs the fold again.
    const ring = foot.querySelector(".cv-ctx")
    if (ring) observer.observe(ring)
    return () => observer.disconnect()
    // biome-ignore lint/correctness/useExhaustiveDependencies: the caller names what changes the chips or the pickers
  }, deps)
  return fold
}
