type Dimensions = { width: number; height: number }
type Rect = Dimensions & { top: number; left: number }

/** A section never shows smaller than this share of its own pixels; below it, its focus area shows. */
export const SECTION_FLOOR = 0.6
/** How tall an embedded section may be inline: about 280 to 360 px in the document column. */
export const SECTION_CAP = 320
/** The picture's padding around a focus area, and the room under it for its "Focus area" tag. */
const FOCUS_INSET = 12
const FOCUS_TAG = 24

type Input = {
  pageWidth: number
  pageHeight: number | undefined
  room: number
  cap: number
  unavailable: boolean
}

/** A whole page: fitted to the column's width, as tall as the page up to the cap, then it scrolls. */
export function previewSize({ pageWidth, pageHeight, room, cap, unavailable }: Input) {
  const scale = room > 0 ? Math.min(1, room / pageWidth) : 0.5
  const natural = pageHeight ?? 210 / scale
  const pictureHeight = unavailable ? 120 : Math.max(96, Math.ceil(natural * scale))
  const shownHeight = Math.min(pictureHeight, cap)
  return {
    scale,
    pictureHeight,
    pictureWidth: room,
    shownHeight,
    vertical: pictureHeight > shownHeight + 1,
  }
}

export type SectionMode = "whole" | "focus" | "top" | "unknown"

type SectionInput = {
  /** The referenced section, in page pixels; null until the page has said where its parts are. */
  section: Rect | null
  /** The part of it the artifact marks with `data-ql-focus`, in page pixels. */
  focus: Rect | null
  room: number
  cap: number
  unavailable: boolean
}

/**
 * An embedded section scales to fit the column's width and the cap's height, never below the floor.
 * Needing less than the floor, it shows its focus area at the floor or more, or, with no mark, its
 * top at the floor. It never scrolls at rest: the card opens the whole page. Before the section is
 * known, the box keeps the 2:1 height an average section takes, so the placeholder is as tall as
 * the picture that replaces it.
 */
export function sectionPreview({ section, focus, room, cap, unavailable }: SectionInput) {
  const wide = room > 0 ? room : Number.POSITIVE_INFINITY
  if (unavailable)
    return shape({ cap, mode: "top", scale: 1, inset: 0, region: null, pictureHeight: 120, room })
  if (section === null)
    return shape({
      cap,
      mode: "unknown",
      scale: 1,
      inset: 0,
      region: null,
      pictureHeight: Math.min(cap, Math.max(96, Math.round((room || 640) / 2))),
      room,
    })
  const whole = Math.min(1, wide / section.width, cap / section.height)
  if (whole >= SECTION_FLOOR) {
    return shape({
      cap,
      mode: "whole",
      scale: whole,
      inset: 0,
      region: section,
      pictureHeight: Math.ceil(section.height * whole),
      room,
    })
  }
  if (focus !== null && focus.width > 0 && focus.height > 0) {
    const fit = Math.min(
      1,
      (wide - 2 * FOCUS_INSET) / focus.width,
      (cap - 2 * FOCUS_INSET - FOCUS_TAG) / focus.height,
    )
    const scale = Math.max(SECTION_FLOOR, fit)
    const height = Math.ceil(focus.height * scale) + 2 * FOCUS_INSET + FOCUS_TAG
    return shape({
      cap,
      mode: "focus",
      scale,
      inset: FOCUS_INSET,
      region: focus,
      pictureHeight: height,
      room,
    })
  }
  // No focus mark: the section's top. It fills the card's width, never cut at the side and never above
  // its own pixels, so no empty band stands beside it. Drawn larger than the floor, the box grows by the
  // same share (up to TOP_CAP), so it shows as much of the screen's height as the floor would.
  const scale = Math.min(1, wide / section.width)
  const tall = Math.min(TOP_CAP, Math.max(cap, Math.round((cap * scale) / SECTION_FLOOR)))
  const region: Rect = {
    left: section.left,
    top: section.top,
    width: section.width,
    height: Math.min(section.height, tall / scale),
  }
  return shape({
    cap: tall,
    mode: "top",
    scale,
    inset: 0,
    region,
    pictureHeight: Math.ceil(region.height * scale),
    room,
  })
}

/** The tallest a section's top may grow when it is drawn larger than the floor to fill the card. */
export const TOP_CAP = 480

function shape(args: {
  cap: number
  mode: SectionMode
  scale: number
  inset: number
  region: Rect | null
  pictureHeight: number
  room: number
}) {
  const { cap, mode, scale, inset, region, pictureHeight, room } = args
  const height = Math.max(96, pictureHeight)
  const width = region === null ? room : Math.ceil(region.width * scale) + 2 * inset
  return {
    mode,
    scale,
    inset,
    region,
    pictureHeight: height,
    pictureWidth: room > 0 ? Math.min(width, room) : width,
    shownHeight: Math.min(height, cap),
  }
}

type ScrollArea = Pick<
  HTMLElement,
  "scrollTop" | "clientHeight" | "scrollHeight" | "scrollLeft" | "clientWidth" | "scrollWidth"
>
export function previewAtEnd(area: ScrollArea, horizontal: boolean): boolean {
  return (
    area.scrollTop + area.clientHeight >= area.scrollHeight - 2 &&
    (!horizontal || area.scrollLeft + area.clientWidth >= area.scrollWidth - 2)
  )
}

import type { CSSProperties } from "react"

/** The window onto the page: the region at the scale, clipped to it. */
export function previewWindow(
  region: Dimensions | null,
  scale: number,
  inset: number,
): CSSProperties {
  if (region === null) return { display: "contents" }
  return {
    position: "absolute",
    left: inset,
    top: inset,
    width: Math.ceil(region.width * scale),
    height: Math.ceil(region.height * scale),
    overflow: "hidden",
  }
}
