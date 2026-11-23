// The pictures of a step (Workflow model, Verify and Review: `.vstrip`, `.vview`, `.vidx`): a strip of
// thumbnails, and the App's fullscreen dialog that shows one picture at a time with Previous and Next,
// an Actual size toggle, and an All pictures index grouped by the run that took them, latest run first.
// Every picture says how its run happened. The index draws a run's first pictures and pages the rest,
// so a task with hundreds of pictures stays fast. Focus returns to the thumbnail that opened it.

import { GridIcon } from "lucide-react"
import { type KeyboardEvent, useMemo, useRef, useState } from "react"
import { FullscreenDialog } from "../../reader/VisualParts.tsx"

/** How the run happened: a script drove the screens, or an agent ran a real session. */
export type PictureMode = "scripted" | "real-session"

export type Picture = {
  src: string
  /** What the picture shows, one line. */
  caption: string
  /** The run that took it: pictures of one run are grouped in the index. */
  run: string
  /** The run's name for the index heading ("Second review"). */
  runLabel: string
  mode: PictureMode
  /** The acceptance step it shows, when it shows one ("A2"). */
  step?: string
}

/** The viewer's and the index's words for how a run happened. */
export const PICTURE_MODE_LABEL: Record<PictureMode, string> = {
  scripted: "scripted run",
  "real-session": "real agent session",
}

/** Thumbnails drawn in the strip before "+N", and per run in the index before "Show more". */
const STRIP_SHOWN = 8
const INDEX_PAGE = 48

type RunGroup = { run: string; label: string; items: { picture: Picture; at: number }[] }

/**
 * Pictures arrive oldest first, so the latest run is the one whose picture comes last. The index
 * lists runs newest first; inside a run the pictures keep their order.
 */
export function groupByRun(pictures: readonly Picture[], latestFirst = false): RunGroup[] {
  const groups = new Map<string, RunGroup>()
  pictures.forEach((picture, at) => {
    const group = groups.get(picture.run) ?? {
      run: picture.run,
      label: picture.runLabel,
      items: [],
    }
    group.items.push({ picture, at })
    groups.set(picture.run, group)
  })
  // Pictures that already arrive latest first keep their runs in that order.
  return latestFirst ? [...groups.values()] : [...groups.values()].reverse()
}

const sizeOf = (picture: Picture) => `${picture.caption}${picture.step ? ` · ${picture.step}` : ""}`

function Thumb({
  picture,
  label,
  onOpen,
}: {
  picture: Picture
  label: string
  onOpen: (button: HTMLButtonElement) => void
}) {
  return (
    <button
      type="button"
      className="pv-thumb"
      aria-label={label}
      onClick={(event) => onOpen(event.currentTarget)}
    >
      <span className="pv-img">
        {/* biome-ignore lint/performance/noImgElement: raster capture served from task evidence */}
        <img src={picture.src} alt="" loading="lazy" decoding="async" />
      </span>
    </button>
  )
}

function RunIndex({
  pictures,
  onPick,
  latestFirst,
}: {
  pictures: readonly Picture[]
  onPick: (at: number) => void
  latestFirst: boolean
}) {
  const groups = useMemo(() => groupByRun(pictures, latestFirst), [pictures, latestFirst])
  const [pages, setPages] = useState<Record<string, number>>({})
  return (
    <div className="pv-index" data-testid="picture-index">
      {groups.map((group) => {
        const shown = pages[group.run] ?? INDEX_PAGE
        return (
          <section key={group.run} aria-label={group.label}>
            <h3>
              {group.label} · {group.items.length}
            </h3>
            <div className="pv-strip">
              {group.items.slice(0, shown).map(({ picture, at }) => (
                <Thumb
                  key={at}
                  picture={picture}
                  label={`Open ${picture.caption}`}
                  onOpen={() => onPick(at)}
                />
              ))}
              {group.items.length > shown ? (
                <button
                  type="button"
                  className="pv-more"
                  onClick={() =>
                    setPages((before) => ({ ...before, [group.run]: shown + INDEX_PAGE }))
                  }
                >
                  Show more · {group.items.length - shown}
                </button>
              ) : null}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function LargeStrip({
  pictures,
  shown,
  onOpen,
}: {
  pictures: readonly Picture[]
  shown: readonly number[]
  onOpen: (index: number, from: HTMLElement | null) => void
}) {
  return (
    <div className="pv-large">
      {shown.map((index) => {
        const item = pictures[index]
        if (!item) return null
        return (
          <button
            key={index}
            type="button"
            className="pv-wide"
            aria-label={`Open picture: ${sizeOf(item)}`}
            onClick={(event) => onOpen(index, event.currentTarget)}
          >
            {/* biome-ignore lint/performance/noImgElement: raster capture served from task evidence */}
            <img src={item.src} alt="" loading="lazy" decoding="async" />
          </button>
        )
      })}
    </div>
  )
}

function ThumbStrip({
  pictures,
  shown,
  rest,
  onOpen,
}: {
  pictures: readonly Picture[]
  shown: readonly number[]
  rest: number
  onOpen: (index: number, from: HTMLElement | null, withIndex?: boolean) => void
}) {
  return (
    <div className="pv-strip">
      {shown.map((index) => {
        const item = pictures[index]
        if (!item) return null
        return (
          <Thumb
            key={index}
            picture={item}
            label={`Open picture: ${sizeOf(item)}`}
            onOpen={(button) => onOpen(index, button)}
          />
        )
      })}
      {rest > 0 ? (
        <button
          type="button"
          className="pv-more"
          aria-label={`Open all ${pictures.length} pictures`}
          onClick={(event) => onOpen(shown.length, event.currentTarget, true)}
        >
          +{rest}
        </button>
      ) : null}
    </div>
  )
}

function ViewerBar({
  indexed,
  picture,
  at,
  total,
}: {
  indexed: boolean
  picture: Picture
  at: number
  total: number
}) {
  if (indexed) {
    return (
      <span className="pv-cap">
        <b>All pictures</b>
        <span>{total}, latest run first</span>
      </span>
    )
  }
  return (
    <span className="pv-cap">
      <b>{picture.caption}</b>
      <span>
        {picture.step ? `${picture.step} · ` : ""}
        {PICTURE_MODE_LABEL[picture.mode]} · {at + 1} of {total}
      </span>
    </span>
  )
}

function ViewerActions({
  indexed,
  actual,
  at,
  total,
  onToggleIndex,
  onToggleActual,
  onMove,
}: {
  indexed: boolean
  actual: boolean
  at: number
  total: number
  onToggleIndex: () => void
  onToggleActual: () => void
  onMove: (to: number) => void
}) {
  return (
    <>
      <button type="button" className="q-btn sm" aria-pressed={indexed} onClick={onToggleIndex}>
        <GridIcon className="size-3.5" aria-hidden="true" />
        All pictures
      </button>
      {indexed ? null : (
        <>
          <button type="button" className="q-btn sm" aria-pressed={actual} onClick={onToggleActual}>
            {actual ? "Fit picture" : "Actual size"}
          </button>
          <button
            type="button"
            className="q-btn sm"
            disabled={at <= 0}
            onClick={() => onMove(at - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            className="q-btn sm"
            disabled={at >= total - 1}
            onClick={() => onMove(at + 1)}
          >
            Next
          </button>
        </>
      )}
    </>
  )
}

function ViewerDialog({
  pictures,
  picture,
  at,
  actual,
  indexed,
  latestFirst,
  opener,
  onClose,
  onToggleIndex,
  onToggleActual,
  onMove,
  onPickIndex,
}: {
  pictures: readonly Picture[]
  picture: Picture
  at: number
  actual: boolean
  indexed: boolean
  latestFirst: boolean
  opener: React.RefObject<HTMLElement | null>
  onClose: () => void
  onToggleIndex: () => void
  onToggleActual: () => void
  onMove: (to: number) => void
  onPickIndex: (index: number) => void
}) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (indexed) return
    const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0
    if (delta === 0) return
    event.preventDefault()
    onMove(at + delta)
  }
  return (
    <FullscreenDialog
      open
      onClose={onClose}
      title={indexed ? "All pictures" : `Picture: ${sizeOf(picture)}`}
      returnFocus={opener}
      testId="picture-dialog"
      onKeyDown={onKeyDown}
      bar={<ViewerBar indexed={indexed} picture={picture} at={at} total={pictures.length} />}
      actions={
        <ViewerActions
          indexed={indexed}
          actual={actual}
          at={at}
          total={pictures.length}
          onToggleIndex={onToggleIndex}
          onToggleActual={onToggleActual}
          onMove={onMove}
        />
      }
    >
      {indexed ? (
        <RunIndex latestFirst={latestFirst} pictures={pictures} onPick={onPickIndex} />
      ) : (
        <div className="pv-view" data-actual={actual}>
          {/* biome-ignore lint/performance/noImgElement: raster capture served from task evidence */}
          <img src={picture.src} alt={`${picture.caption}, ${PICTURE_MODE_LABEL[picture.mode]}`} />
        </div>
      )}
    </FullscreenDialog>
  )
}

export function PictureViewer({
  pictures,
  show,
  large = false,
  more = show === undefined,
  latestFirst = false,
}: {
  /** Every picture the viewer steps through, oldest first unless `latestFirst`. */
  pictures: readonly Picture[]
  /** The pictures arrive latest first: the strip, the viewer and the index all keep that order. */
  latestFirst?: boolean
  /** The pictures drawn as thumbnails, by index. Default: the first eight, then "+N". */
  show?: readonly number[]
  /** Draw each shown picture at its own width, as an acceptance step does, not as a thumbnail. */
  large?: boolean
  /** Draw the "+N" tile for the pictures not shown; on by default only when `show` is not given. */
  more?: boolean
}) {
  const [at, setAt] = useState<number | null>(null)
  const [actual, setActual] = useState(false)
  const [indexed, setIndexed] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  const shown = show ?? pictures.slice(0, STRIP_SHOWN).map((_, index) => index)
  const rest = more ? pictures.length - shown.length : 0

  const open = (index: number, from: HTMLElement | null, withIndex = false) => {
    opener.current = from
    setActual(false)
    setIndexed(withIndex)
    setAt(index)
  }
  const move = (to: number) => {
    if (to < 0 || to >= pictures.length) return
    setActual(false)
    setAt(to)
  }
  const picture = at === null ? undefined : pictures[at]

  if (pictures.length === 0) return null
  return (
    <div className="pv" data-testid="picture-viewer">
      {large ? (
        <LargeStrip pictures={pictures} shown={shown} onOpen={open} />
      ) : (
        <ThumbStrip pictures={pictures} shown={shown} rest={rest} onOpen={open} />
      )}
      {at !== null && picture ? (
        <ViewerDialog
          pictures={pictures}
          picture={picture}
          at={at}
          actual={actual}
          indexed={indexed}
          latestFirst={latestFirst}
          opener={opener}
          onClose={() => setAt(null)}
          onToggleIndex={() => setIndexed((value) => !value)}
          onToggleActual={() => setActual((value) => !value)}
          onMove={move}
          onPickIndex={(index) => {
            setIndexed(false)
            move(index)
          }}
        />
      ) : null}
    </div>
  )
}
