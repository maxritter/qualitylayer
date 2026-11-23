// The tour's own script, /tour.js: fetched only when the person asks for the tour (`/?tour`). It shows
// the real App on a connected in-memory example, starting on Home.
// Nothing reaches this machine's tasks: the App reads the demo's API. The viewer's own preferences
// (the last page, the panels) are put back when the tour ends, so Home opens as it was left.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { type Animations, animationsOf } from "../../core/config-values.ts"
import { App } from "../App.tsx"
import { type Licence, api as liveApi } from "../api.ts"
import { createDemoApi } from "../demo/api.ts"
import { createDemoArtifactFeedback } from "../demo/artifact-feedback.ts"
import { demoArtifactSource } from "../demo/artifact-source.ts"
import { installDemoFetch } from "../demo/fetch.ts"
import { WEBSITE_LOOKS } from "../demo/website-gallery.ts"
import { applyMotion } from "../motion.ts"
import { asNativeShell } from "../native-shell.ts"
import { PREF, stored } from "../prefs.ts"
import { createMemoryLookApi } from "../sidebar/look-api.ts"
import { connectedTourCatalog, type TourTier, tourExampleApi, tourTier } from "./example.ts"
import { tourLocation, tourStopAsked } from "./location.ts"
import { beginTourPreferences, type TourPreferences } from "./preferences.ts"
import {
  acknowledgeTourRevision,
  clearPausedTour,
  markTourEnding,
  pausedTourLength,
  pauseTour,
} from "./session.ts"
import { stopInLength, type TourLength, tourStops } from "./stops.ts"
import { Tour, type TourEnd } from "./Tour.tsx"
import { TourRecoveryCard, useTourDemoEffects } from "./TourRecovery.tsx"
import {
  momentForPlace,
  type TourMode,
  useTourApprovalFollow,
  useTourNavigationEffect,
} from "./tour-navigation.tsx"

// Same in-memory message contract as demo/main.tsx; no EventSource reaches a server.
class TourEvents {
  static instances = new Set<TourEvents>()
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  constructor(_url: string) {
    TourEvents.instances.add(this)
  }
  close() {
    TourEvents.instances.delete(this)
  }
  static changed() {
    for (const stream of TourEvents.instances)
      stream.onmessage?.(new MessageEvent("message", { data: "illustrative-state-changed" }))
  }
}

function useTourEntitlement(licence: Licence | undefined) {
  const [tier, setTier] = useState<TourTier>(() => tourTier(licence))
  const entitlement = useRef<Promise<Licence | null> | undefined>(undefined)
  const readEntitlement = useCallback(() => {
    entitlement.current ??=
      licence === undefined ? liveApi.licence().catch(() => null) : Promise.resolve(licence)
    return entitlement.current
  }, [licence])
  useEffect(() => {
    let current = true
    // /api/licence reads local cached entitlement; it does not validate with a provider.
    void readEntitlement().then(
      (value) => {
        if (current) setTier(tourTier(value))
      },
      () => {},
    )
    return () => {
      current = false
    }
  }, [readEntitlement])
  useEffect(() => {
    if (tier !== null) TourEvents.changed()
  }, [tier])
  return { tier, readEntitlement }
}

function useTourReturnEffect(
  mode: TourMode,
  preferences: React.RefObject<TourPreferences | null>,
  returnTo: string | undefined,
  setMode: (mode: TourMode) => void,
) {
  useEffect(() => () => preferences.current?.dispose(), [preferences])
  useEffect(() => {
    if (mode !== "returning") return
    if (preferences.current !== null && !preferences.current.restore()) {
      setMode("failed")
      return
    }
    preferences.current?.dispose()
    window.location.replace(returnTo ?? tourLocation())
  }, [mode, preferences, returnTo, setMode])
}

function recordTourEnd(how: TourEnd, stops: ReturnType<typeof tourStops>) {
  if (how.how === "done" || how.how === "skip") acknowledgeTourRevision()
  if (how.how === "done") {
    clearPausedTour()
    markTourEnding()
  } else if (how.how === "pause") {
    pauseTour(how.at, stops.length, stops[how.at]?.id)
  } else {
    clearPausedTour()
  }
}

function useTourDemoWorld(args: {
  moment: ReturnType<typeof momentForPlace>
  chatScene: boolean
  tier: TourTier
  readEntitlement: () => Promise<Licence | null>
  animations: Animations
}) {
  const { moment, chatScene, tier, readEntitlement, animations } = args
  const keptRuns = useRef<ReturnType<typeof createDemoApi>["runs"] | undefined>(undefined)
  const demo = useMemo(() => {
    const world = createDemoApi(
      () => TourEvents.changed(),
      "plan",
      {},
      moment,
      undefined,
      chatScene ? undefined : keptRuns.current,
      chatScene ? "chat" : undefined,
    )
    if (!chatScene) keptRuns.current ??= world.runs
    return world
  }, [moment, chatScene])
  const source = useRef(demo.api)
  source.current = demo.api
  const artifactFeedback = useMemo(
    () =>
      createDemoArtifactFeedback({
        localSource: (address) => demoArtifactSource(source.current, address),
      }),
    [],
  )
  const api = useMemo(
    () =>
      asNativeShell({
        ...connectedTourCatalog(tourExampleApi(demo.api, tier)),
        // The person's own choice, not the example's: the tour keeps their animations.
        config: async () => ({ ...(await demo.api.config()), animations }),
        licence: async () => {
          const known = tourTier(await readEntitlement())
          return {
            version: (await demo.api.licence()).version,
            state: "active",
            tier: known ?? undefined,
            name: "Sam Rivera",
            daysLeft: known === "trial" ? 7 : null,
          }
        },
      }),
    [demo, tier, readEntitlement, animations],
  )
  const look = useMemo(() => createMemoryLookApi({ seed: WEBSITE_LOOKS }), [])
  const runs = useMemo(
    () => ({
      ...demo.runs,
      support: () => ({ supported: true, canStart: true, canConfigure: true }),
    }),
    [demo],
  )
  return { demo, api, look, runs, artifactFeedback }
}

function ConnectedTour({
  preferences: initial,
  licence,
  returnTo,
  animations,
  start,
}: {
  preferences: TourPreferences | null
  licence?: Licence
  returnTo?: string
  /** The person's Animations choice, read before the tour set the App's preferences aside. */
  animations: Animations
  /** The stop the tour opens at: 0, or the one a paused tour continues from. */
  start: number
}) {
  const preferences = useRef(initial)
  const [mode, setMode] = useState<TourMode>(initial ? "tour" : "blocked")
  const [at, setAt] = useState(start)
  const ended = useRef<TourEnd>({ how: "skip", at: 0 })
  const { tier, readEntitlement } = useTourEntitlement(licence)
  // Short by default; a paused tour continues at the length it had.
  const [length, setLength] = useState<TourLength>(() => (start > 0 ? pausedTourLength() : "short"))
  const stops = useMemo(() => tourStops(length), [length])
  const changeLength = (next: TourLength) => {
    if (next === length) return
    setAt(stopInLength(stops, at, tourStops(next)))
    setLength(next)
  }
  const place = stops[at]?.place ?? "home"
  const moment = momentForPlace(place)
  const { demo, api, look, runs, artifactFeedback } = useTourDemoWorld({
    moment,
    chatScene: place === "chat",
    tier,
    readEntitlement,
    animations,
  })
  const end = (how?: TourEnd) => {
    if (how !== undefined) ended.current = how
    recordTourEnd(ended.current, stops)
    setMode("returning")
  }
  useTourDemoEffects(demo, place, mode)
  useTourReturnEffect(mode, preferences, returnTo, setMode)
  useTourNavigationEffect(mode, place)
  useTourApprovalFollow(mode, place, stops, setAt)
  return (
    <>
      <style>{"[data-sonner-toaster][data-y-position='bottom'] { bottom: 64px; }"}</style>
      {mode === "tour" ? (
        <div style={{ height: "calc(100dvh - 52px)", overflow: "hidden" }}>
          <App
            key={moment}
            api={api}
            look={look}
            runAdapter={runs}
            artifactFeedbackApi={artifactFeedback}
          />
        </div>
      ) : null}
      <p
        data-testid="tour-boundary"
        aria-live="polite"
        style={{
          position: "fixed",
          zIndex: 100,
          left: 0,
          right: 0,
          bottom: 0,
          margin: 0,
          padding: "8px 12px",
          background: "var(--ql-bg)",
          borderTop: "1px solid var(--ql-border)",
          color: "var(--ql-text)",
          fontSize: 12,
        }}
      >
        Interactive example. No agents start; no real reports or messages are sent.
      </p>
      {mode === "tour" ? (
        <Tour
          stops={stops}
          at={at}
          onStep={setAt}
          onEnd={end}
          onShown={acknowledgeTourRevision}
          length={length}
          onLength={changeLength}
        />
      ) : null}
      {mode === "blocked" || mode === "failed" ? (
        <TourRecoveryCard
          mode={mode}
          onRetry={() => {
            preferences.current = beginTourPreferences()
            if (preferences.current) setMode("tour")
          }}
          onReturn={() => end()}
        />
      ) : null}
    </>
  )
}

export function mount(
  root: HTMLElement,
  example: { licence?: Licence; returnTo?: string } = {},
): void {
  // The person's animations are read before the tour sets the App's preferences aside.
  const animations = animationsOf(stored(PREF.animations, "system"))
  applyMotion(animations)
  const preferences = beginTourPreferences()
  window.EventSource = TourEvents as unknown as typeof EventSource
  window.WebSocket = TourEvents as unknown as typeof WebSocket
  installDemoFetch(window.location.search)
  createRoot(root).render(
    <ConnectedTour
      preferences={preferences}
      licence={example.licence}
      returnTo={example.returnTo}
      animations={animations}
      start={tourStopAsked(window.location.search)}
    />,
  )
}
