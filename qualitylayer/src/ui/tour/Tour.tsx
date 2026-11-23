// The tour over the real App: one ring around the whole part a person acts on and a card beside it that
// names it. Between stops the card's words fade out, the page underneath changes, then the ring and the
// card glide to the new part together and the new words fade in; Done fades the whole tour. Arrows move
// outside editors; Enter and Space keep native button actions; Escape leaves and keeps the stop.

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { ListIcon, UserRoundIcon, ZapIcon } from "lucide-react"
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { Segmented } from "../Segmented.tsx"
import { holdTourDom, tourHost } from "./dom.ts"
import { TOUR_STOPS, type TourLength, type TourStop } from "./stops.ts"
import {
  scheduleTourLeave,
  scheduleTourTransition,
  useTourAcknowledgePaint,
  useTourKeyboard,
  useTourReachable,
} from "./tour-hooks.ts"
import { CARD, useTourPosition } from "./tour-position.ts"

/** How the tour ended: Done, Skip tour, or Escape, which keeps the stop so Home can offer to continue. */
export type TourEnd = { how: "done" | "skip" | "pause"; at: number }

/** The tour's card is drawn inside the tour's own frame, once that frame exists. */
function InTour({ host, children }: { host: HTMLElement | null; children: ReactNode }) {
  return host === null ? null : (
    <DialogPrimitive.Portal container={host}>{children}</DialogPrimitive.Portal>
  )
}

function useStopLifecycle(stop: TourStop | undefined) {
  const held = useRef<TourStop | undefined>(undefined)
  const restore = useCallback(() => {
    const was = held.current
    held.current = undefined
    was?.leave?.(tourHost())
  }, [])
  useEffect(() => {
    if (!stop) return
    if (held.current !== stop) restore()
    if (stop.enter === undefined) return
    held.current = stop
    const enter = stop.enter
    const host = tourHost()
    return holdTourDom(() => enter(host))
  }, [stop, restore])
  useEffect(() => restore, [restore])
  return restore
}

function useTourRootDataset(stopPlace: TourStop["place"] | undefined) {
  useLayoutEffect(() => {
    if (stopPlace === undefined) return
    const root = document.documentElement
    root.dataset.tourTo = stopPlace
    return () => {
      delete root.dataset.tourTo
    }
  }, [stopPlace])
}

function TourCardProgress({
  all,
  shownIndex,
  busy,
  length,
  onLength,
  onGoTo,
}: {
  all: readonly TourStop[]
  shownIndex: number
  busy: boolean
  length?: TourLength
  onLength?: (length: TourLength) => void
  onGoTo: (index: number) => void
}) {
  if (length !== undefined && onLength) {
    return (
      <div className="q-tour-length" data-testid="tour-length">
        <Segmented
          size="md"
          label="Tour length"
          value={length}
          onChange={(next) => {
            if (!busy) onLength(next)
          }}
          options={[
            { id: "short", label: "Short", icon: <ZapIcon aria-hidden="true" /> },
            { id: "full", label: "Full", icon: <ListIcon aria-hidden="true" /> },
          ]}
        />
        <span className="q-tour-count">
          {shownIndex + 1} of {all.length}
        </span>
      </div>
    )
  }
  return (
    <nav className="q-tour-dots" aria-label={`Stop ${shownIndex + 1} of ${all.length}`}>
      {all.map((st, j) => (
        <button
          key={st.id}
          type="button"
          className={j < shownIndex ? "seen" : undefined}
          aria-label={`Go to ${st.label}`}
          aria-current={j === shownIndex ? "step" : undefined}
          onClick={() => onGoTo(j)}
        />
      ))}
    </nav>
  )
}

function TourPopupCard({
  attachTip,
  nextRef,
  place,
  hiddenUntilPlaced,
  shown,
  shownIndex,
  all,
  pending,
  hasPositioned,
  busy,
  length,
  onLength,
  onGoTo,
  onSkip,
  onBack,
  onForward,
}: {
  attachTip: (node: HTMLDivElement | null) => void
  nextRef: RefObject<HTMLButtonElement | null>
  place: { left: number; top: number }
  hiddenUntilPlaced: boolean
  shown: TourStop | undefined
  shownIndex: number
  all: readonly TourStop[]
  pending: boolean
  hasPositioned: boolean
  busy: boolean
  length?: TourLength
  onLength?: (length: TourLength) => void
  onGoTo: (index: number) => void
  onSkip: () => void
  onBack: () => void
  onForward: () => void
}) {
  const last = shownIndex + 1 === all.length
  return (
    <DialogPrimitive.Popup
      ref={attachTip}
      className="q-tour-tip"
      initialFocus={false}
      finalFocus={false}
      style={{
        left: place.left,
        top: place.top,
        width: Math.min(CARD.w, window.innerWidth - 24),
        visibility: hiddenUntilPlaced ? "hidden" : undefined,
        maxHeight: "calc(100dvh - 84px)",
        overflowY: "auto",
      }}
    >
      <div className="q-tour-body" key={shownIndex}>
        <div className="q-tour-hd">
          <span className="q-tour-ic" data-who={shown?.you ? "you" : undefined} aria-hidden="true">
            {shown ? <shown.icon className="size-4" /> : null}
          </span>
          <DialogPrimitive.Title>{shown?.label}</DialogPrimitive.Title>
          {shown?.you ? (
            <span className="q-tour-you">
              <UserRoundIcon className="size-3" aria-hidden="true" />
              You approve
            </span>
          ) : null}
        </div>
        <DialogPrimitive.Description className="q-tour-tx">
          {shown?.text}
        </DialogPrimitive.Description>
      </div>
      {pending && !hasPositioned ? (
        <p role="status" className="q-tour-wait">
          Opening the next example. You can skip the tour at any time.
        </p>
      ) : null}
      <TourCardProgress
        all={all}
        shownIndex={shownIndex}
        busy={busy}
        length={length}
        onLength={onLength}
        onGoTo={onGoTo}
      />
      <div className="acts">
        <button type="button" className="q-btn quiet sm skip" onClick={onSkip}>
          Skip tour
        </button>
        <span className="sp" />
        {shownIndex > 0 ? (
          <button type="button" className="q-btn sm" onClick={onBack} disabled={busy}>
            Back
          </button>
        ) : null}
        <button
          ref={nextRef}
          type="button"
          className="q-btn primary sm"
          onClick={onForward}
          disabled={busy}
        >
          {last ? "Done" : "Next"}
        </button>
      </div>
    </DialogPrimitive.Popup>
  )
}

export function Tour({
  onEnd,
  onShown,
  stops: all = TOUR_STOPS,
  at: controlled,
  onStep,
  length,
  onLength,
}: {
  onEnd: (end: TourEnd) => void
  onShown?: () => void
  stops?: TourStop[]
  at?: number
  onStep?: (index: number) => void
  /** The tour's length and its switch; without them the card shows its stop dots. */
  length?: TourLength
  onLength?: (length: TourLength) => void
}) {
  const [at, setAt] = useState(controlled ?? 0)
  const [phase, setPhase] = useState<"rest" | "leave" | "out">("rest")
  const timer = useRef(0)
  const lastPlace = useRef<{ left: number; top: number } | null>(null)
  const tip = useRef<HTMLDivElement>(null)
  const [tipNode, setTipNode] = useState<HTMLDivElement | null>(null)
  const attachTip = useCallback((node: HTMLDivElement | null) => {
    tip.current = node
    setTipNode(node)
  }, [])
  const [tour, setTour] = useState<HTMLDivElement | null>(null)
  const next = useRef<HTMLButtonElement>(null)
  const i = Math.min(controlled ?? at, Math.max(0, all.length - 1))
  const stop = all[i]
  const positioned = useTourPosition(i, stop, tip)
  const pending = positioned?.index !== i
  const shown = positioned?.stop ?? stop
  const sourceDialogKey = positioned?.dialog ?? "page"
  useTourAcknowledgePaint({ tipNode, placed: Boolean(positioned?.place), pending, onShown })
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useTourReachable(tour)
  const restore = useStopLifecycle(stop)
  useTourRootDataset(stop?.place)

  const goTo = (to: number) =>
    scheduleTourTransition({
      to,
      current: i,
      total: all.length,
      phase,
      pending,
      timer,
      setPhase,
      restore,
      onEnd,
      onMove: (nextIndex) => {
        setAt(nextIndex)
        onStep?.(nextIndex)
      },
    })
  const leaveTour = (how: "skip" | "pause") =>
    scheduleTourLeave({ how, current: i, phase, timer, setPhase, restore, onEnd })
  useTourKeyboard({
    onPause: () => leaveTour("pause"),
    onForward: () => goTo(i + 1),
    onBack: () => goTo(i - 1),
  })
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus moves when the stop or the dialog changes
  useEffect(() => {
    if (pending || phase !== "rest") return
    next.current?.focus({ preventScroll: true })
    const again = window.setTimeout(() => next.current?.focus({ preventScroll: true }), 80)
    return () => window.clearTimeout(again)
  }, [i, pending, phase, sourceDialogKey])

  if (stop === undefined) return null
  const ring = positioned?.ring ?? null
  if (positioned?.place) lastPlace.current = positioned.place
  const place = positioned?.place ??
    lastPlace.current ?? {
      left: Math.max(12, window.innerWidth - CARD.w - 12),
      top: 12,
    }
  const shownIndex = positioned?.index ?? i
  const busy = pending || phase !== "rest"
  return (
    <div
      ref={setTour}
      className="q-tour q-motion-own"
      data-testid="tour"
      data-place={shown?.place}
      data-to={stop.place}
      data-phase={phase === "out" ? "out" : busy ? "swap" : "rest"}
      aria-busy={busy}
    >
      {ring ? (
        <div
          className="q-tour-ring"
          style={{ left: ring.x, top: ring.y, width: ring.w, height: ring.h }}
        >
          <i className="q-tour-edge" key={shownIndex} />
        </div>
      ) : null}
      <DialogPrimitive.Root key={sourceDialogKey} open modal={false}>
        <InTour host={tour}>
          <TourPopupCard
            attachTip={attachTip}
            nextRef={next}
            place={place}
            hiddenUntilPlaced={Boolean(positioned && !positioned.place && !lastPlace.current)}
            shown={shown}
            shownIndex={shownIndex}
            all={all}
            pending={pending}
            hasPositioned={positioned !== null}
            busy={busy}
            length={length}
            onLength={onLength}
            onGoTo={goTo}
            onSkip={() => leaveTour("skip")}
            onBack={() => goTo(i - 1)}
            onForward={() => goTo(i + 1)}
          />
        </InTour>
      </DialogPrimitive.Root>
    </div>
  )
}
