// Where a stop's unit is in the window: the scrolling page it sits in, the ring round it and the one scroll
// that brings it into view.

import type { TourStop } from "./stops.ts"

export type Box = { x: number; y: number; w: number; h: number }

type RectLike = {
  width: number
  height: number
  right: number
  left: number
  bottom: number
  top: number
}

const hasSize = (r: RectLike) => r.width > 0 && r.height > 0
const overlapsWindow = (r: RectLike) =>
  r.right > 0 && r.left < window.innerWidth && r.bottom > 0 && r.top < window.innerHeight
const inWindow = (r: RectLike) => hasSize(r) && overlapsWindow(r)

/** The scrolling page a unit sits in: its nearest ancestor that scrolls vertically, if any. */
export function scrollerOf(element: Element): HTMLElement | null {
  for (
    let node = element.parentElement;
    node && node !== document.body;
    node = node.parentElement
  ) {
    const overflow = getComputedStyle(node).overflowY
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight)
      return node
  }
  return null
}

function visibleRect(el: Element | null, clipTo: DOMRect | null): DOMRect | null {
  if (el === null) return null
  const r = el.getBoundingClientRect()
  if (clipTo === null) return r
  const top = Math.max(r.top, clipTo.top)
  const height = Math.max(0, Math.min(r.bottom, clipTo.bottom) - top)
  return new DOMRect(r.left, top, r.width, height)
}

/**
 * The ring: one rectangle round the stop's unit and its second part, 6 px outside them. A unit that is
 * partly out of its scrolling page, or taller than the window, is ringed where it is seen.
 */
export function ringOf(stop: TourStop): Box | null {
  const main = document.querySelector(stop.sel)
  const also = stop.also ? document.querySelector(stop.also) : null
  if (main === null && also === null) return null
  const view = main ? (scrollerOf(main)?.getBoundingClientRect() ?? null) : null
  const rects = [visibleRect(main, view), visibleRect(also, null)].filter(
    (r): r is DOMRect => r !== null && inWindow(r),
  )
  if (rects.length === 0) return null
  const left = Math.min(...rects.map((r) => r.left))
  const top = Math.min(...rects.map((r) => r.top))
  const right = Math.max(...rects.map((r) => r.right))
  const bottom = Math.max(...rects.map((r) => r.bottom))
  const x = Math.max(6, left - 6)
  const y = Math.max(6, top - 6)
  return {
    x,
    y,
    w: Math.max(1, Math.min(window.innerWidth - 6, right + 6) - x),
    h: Math.max(1, Math.min(window.innerHeight - 6, bottom + 6) - y),
  }
}

/**
 * A unit outside its scrolling page is scrolled into view once, on entry. One taller than the page puts
 * its top 12 px under the header; the ring then takes the part that is visible. True when it scrolled.
 */
export function bringIntoView(stop: TourStop): boolean {
  const target = document.querySelector(stop.sel)
  const page = target ? scrollerOf(target) : null
  if (!target || !page) return false
  const view = page.getBoundingClientRect()
  const box = target.getBoundingClientRect()
  const delta =
    box.top < view.top || box.height > view.height - 24
      ? box.top - view.top - 12
      : box.bottom > view.bottom
        ? box.bottom - view.bottom + 12
        : 0
  if (Math.abs(delta) <= 1) return false
  page.scrollTop += delta
  return true
}

function preferredPlacement(
  ring: Box,
  width: number,
  height: number,
  card: { w: number; h: number },
  first?: "left" | "right",
): { left: number; top: number } | null {
  const gap = 14
  const clampX = (x: number) => Math.max(12, Math.min(x, width - card.w - 12))
  const clampY = (y: number) => Math.max(12, Math.min(y, height - card.h - 12))
  const sideY = clampY(ring.y + 24)
  const candidates: [boolean, { left: number; top: number }][] = [
    [first === "left" && ring.x - gap - card.w >= 12, { left: ring.x - gap - card.w, top: sideY }],
    [
      first === "right" && ring.x + ring.w + gap + card.w <= width - 12,
      { left: ring.x + ring.w + gap, top: sideY },
    ],
    [ring.y + ring.h + gap + card.h < height, { left: clampX(ring.x), top: ring.y + ring.h + gap }],
    [ring.y - gap - card.h > 0, { left: clampX(ring.x), top: ring.y - gap - card.h }],
    [ring.x + ring.w + gap + card.w < width, { left: ring.x + ring.w + gap, top: sideY }],
    [ring.x - gap - card.w > 0, { left: ring.x - gap - card.w, top: sideY }],
  ]
  return candidates.find(([fits]) => fits)?.[1] ?? null
}

/**
 * Where the card goes beside the ring in a window of `width` × `height`: below it, else above it, else to
 * its right, else to its left (`first` tries the left or the right first, for a part that makes room
 * there), always inside the window. With no free side it takes the roomiest side and overlaps only the unit's edge
 * there, never its top, where a unit keeps its heading and actions.
 */
export function placeCard(
  ring: Box,
  width: number,
  height: number,
  card: { w: number; h: number },
  first?: "left" | "right",
): { left: number; top: number } {
  const free = preferredPlacement(ring, width, height, card, first)
  if (free !== null) return free
  const gap = 14
  const clampX = (x: number) => Math.max(12, Math.min(x, width - card.w - 12))
  const clampY = (y: number) => Math.max(12, Math.min(y, height - card.h - 12))
  const below = height - (ring.y + ring.h)
  const right = width - (ring.x + ring.w)
  if (below >= right && below >= ring.x)
    return { left: clampX(ring.x), top: clampY(ring.y + ring.h + gap) }
  const left = right >= ring.x ? Math.max(12, width - card.w - 12) : 12
  return { left, top: clampY(ring.y + 24) }
}
