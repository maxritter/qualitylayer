// The tour's own script, /tour.js: fetched only when the person asks for the tour (`/?tour`). It shows
// the real App on a connected in-memory example, starting on Home.
// Nothing reaches this machine's tasks: the App reads the demo's API. The viewer's own preferences
// (the last page, the panels) are put back when the tour ends, so Home opens as it was left.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { type Animations, animationsOf } from "../../core/config-values.ts"
import { folderDoc } from "../../core/docs/names.ts"
import { App } from "../App.tsx"
import { type Licence, api as liveApi } from "../api.ts"
import { createDemoApi } from "../demo/api.ts"
import { createDemoArtifactFeedback } from "../demo/artifact-feedback.ts"
import { demoArtifactSource } from "../demo/artifact-source.ts"
import { installDemoFetch } from "../demo/fetch.ts"
import { DEMO_TASK_ID } from "../demo/task/index.ts"
import { WEBSITE_LOOKS } from "../demo/website-gallery.ts"
import { applyMotion } from "../motion.ts"
import { asNativeShell } from "../native-shell.ts"
import { PREF, stored } from "../prefs.ts"
import { createMemoryLookApi } from "../sidebar/look-api.ts"
import { tourBuildChoiceOpen, watchTourDom } from "./dom.ts"
import { connectedTourCatalog, type TourTier, tourExampleApi, tourTier } from "./example.ts"
import { tourLocation, tourStopAsked } from "./location.ts"
import { openNewTaskCard } from "./new-task-step.ts"
import { beginTourPreferences, type TourPreferences } from "./preferences.ts"
import {
  acknowledgeTourRevision,
  clearPausedTour,
  markTourEnding,
  pausedTourLength,
  pauseTour,
} from "./session.ts"
import { stopAt, stopInLength, type TourLength, tourStops } from "./stops.ts"
import { Tour, type TourEnd } from "./Tour.tsx"

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
  const [mode, setMode] = useState<"tour" | "blocked" | "returning" | "failed">(
    initial ? "tour" : "blocked",
  )
  const [at, setAt] = useState(start)
  const ended = useRef<TourEnd>({ how: "skip", at: 0 })
  const keptRuns = useRef<ReturnType<typeof createDemoApi>["runs"] | undefined>(undefined)
  const [tier, setTier] = useState<TourTier>(() => tourTier(licence))
  const entitlement = useRef<Promise<Licence | null> | undefined>(undefined)
  const readEntitlement = useCallback(() => {
    entitlement.current ??=
      licence === undefined ? liveApi.licence().catch(() => null) : Promise.resolve(licence)
    return entitlement.current
  }, [licence])
  // Short by default; a paused tour continues at the length it had.
  const [length, setLength] = useState<TourLength>(() => (start > 0 ? pausedTourLength() : "short"))
  const stops = useMemo(() => tourStops(length), [length])
  const changeLength = (next: TourLength) => {
    if (next === length) return
    setAt(stopInLength(stops, at, tourStops(next)))
    setLength(next)
  }
  const place = stops[at]?.place ?? "home"
  useEffect(() => {
    let current = true
    // /api/licence reads local cached entitlement; it does not validate with a provider.
    void readEntitlement().then(
      (licence) => {
        if (current) setTier(tourTier(licence))
      },
      () => {},
    )
    return () => {
      current = false
    }
  }, [readEntitlement])
  // The Plan first asks questions; Plan and the build start wait for approval; from the
  // Conversation on, the build runs; the last stop is Home with the task waiting on your review in Verify.
  const moment =
    place === "verify"
      ? "verify-checking"
      : place === "review" || place === "home"
        ? "verify"
        : ["chat", "conversation", "terminal", "files", "report"].includes(place)
          ? "now"
          : ["plan", "build"].includes(place)
            ? "plan-approve"
            : "plan-q"
  const chatScene = place === "chat"
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
  useEffect(() => {
    if (tier !== null) TourEvents.changed()
  }, [tier])
  useEffect(() => {
    if (!["chat", "conversation", "terminal", "files", "report"].includes(place)) return
    if (mode !== "tour") return
    let active = true
    void demo.runs
      .list()
      .then((rows) => {
        if (!active || rows.some((run) => run.task === DEMO_TASK_ID)) return
        return demo.runs.start({
          agent: "claude-code",
          purpose: { kind: "task", task: DEMO_TASK_ID },
          idempotencyKey: "tour-illustrative-agent",
          settings: { model: "claude-opus-5-5", effort: "high", perm: "own" },
        })
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [demo, place, mode])
  // The Feedback stop shows a thread the person could have left: one open item for the agent, posted
  // once into the example's own memory, as the composer would, before the tab is opened.
  const feedbackSeeded = useRef<unknown>(null)
  useEffect(() => {
    if (!["conversation", "terminal", "files", "report"].includes(place)) return
    if (mode !== "tour" || feedbackSeeded.current === demo) return
    feedbackSeeded.current = demo
    void demo.api
      .docsRoute(DEMO_TASK_ID, "docs", "thread", {
        method: "POST",
        body: JSON.stringify({
          doc: folderDoc("plan"),
          quote: "Usage lines leave through the existing invoice outbox",
          remark:
            "Show the date the limit resets next to the alert. The support ticket that asked for it is attached.",
          for: "agent",
        }),
      })
      .catch(() => {})
  }, [demo, place, mode])
  const look = useMemo(() => createMemoryLookApi({ seed: WEBSITE_LOOKS }), [])
  const runs = useMemo(
    () => ({
      ...demo.runs,
      support: () => ({ supported: true, canStart: true, canConfigure: true }),
    }),
    [demo],
  )
  // Where the tour ended decides what Home does next: Done celebrates, Escape offers Continue.
  const end = (how?: TourEnd) => {
    if (how !== undefined) ended.current = how
    if (ended.current.how === "done" || ended.current.how === "skip") acknowledgeTourRevision()
    if (ended.current.how === "done") {
      clearPausedTour()
      markTourEnding()
    } else if (ended.current.how === "pause")
      pauseTour(ended.current.at, stops.length, stops[ended.current.at]?.id)
    else clearPausedTour()
    setMode("returning")
  }
  useEffect(() => () => preferences.current?.dispose(), [])
  useEffect(() => {
    if (mode !== "returning") return
    if (preferences.current !== null && !preferences.current.restore()) {
      setMode("failed")
      return
    }
    preferences.current?.dispose()
    window.location.replace(returnTo ?? tourLocation())
  }, [mode, returnTo])
  useEffect(() => {
    if (mode !== "tour") return
    const asked = new WeakSet<HTMLElement>()
    let actions = 0
    const activate = (element: HTMLElement | null) => {
      if (!element || asked.has(element) || actions >= 40) return
      asked.add(element)
      actions++
      element.click()
    }
    const show = () => {
      if (actions >= 40) return true
      if (place !== "new-task")
        activate(
          document.querySelector<HTMLElement>("[data-testid=new-task] button[aria-label=Close]"),
        )
      // A dialog closes when the tour moves on; the build's launch choice is the person's own and
      // stays until they choose.
      if (place !== "build" && place !== "new-task" && place !== "report")
        activate(
          document.querySelector<HTMLElement>(
            "[data-testid=new-task] button[aria-label=Close], [role=dialog][aria-labelledby]:not(.q-tour-tip) [data-slot=dialog-close]",
          ),
        )
      if (place === "home") {
        window.location.hash = "#/"
        if (document.querySelector("[data-testid=home]")) return true
        activate(document.querySelector<HTMLButtonElement>(".ir-home-nav"))
        return false
      }
      if (place === "new-task") {
        window.location.hash = "#/"
        return openNewTaskCard(activate)
      }
      if (place === "artifacts" || place === "artifact-viewer") {
        if (place === "artifact-viewer" && document.querySelector("[data-testid=artifact-page]"))
          return true
        if (!document.querySelector("[data-testid=artifacts-page]")) {
          window.location.hash = "#/artifacts"
          return false
        }
        if (place === "artifacts") return true
        const entry = document.querySelector<HTMLElement>(
          '[data-testid=library-row] .lib-title[data-lib="web:app-model"]',
        )
        if (!entry) return false
        activate(entry)
        return true
      }
      if (place === "settings") {
        window.location.hash = "#/settings/agents"
        return document.querySelector("[data-testid=settings]") !== null
      }
      if (place === "chat") {
        window.location.hash = `#/task/${DEMO_TASK_ID}`
        return document.querySelector("[data-testid=chat-page]") !== null
      }
      if (place === "build") {
        if (tourBuildChoiceOpen()) return true
        const plan = `#/task/${DEMO_TASK_ID}/${folderDoc("plan")}`
        if (window.location.hash !== plan) {
          window.location.hash = plan
          return false
        }
        const shell = document.querySelector("[data-testid=shell]")
        const actions = [
          ...(shell?.querySelectorAll<HTMLButtonElement>(
            "[data-testid=plan-review-actions] button",
          ) ?? []),
        ]
        const choose =
          actions.find((button) => button.textContent?.trim() === "Choose where to build") ??
          actions.find((button) => button.textContent?.trim() === "Approve Plan")
        activate(choose ?? null)
        return false
      }
      const view = ["conversation", "terminal", "files", "report"].includes(place)
        ? "checkpoint"
        : place === "verify"
          ? "verify"
          : place === "review"
            ? "verify"
            : folderDoc("plan")
      const hash = `#/task/${DEMO_TASK_ID}/${view}`
      if (window.location.hash !== hash) window.location.hash = hash
      if (place === "report") {
        // The sidebar foot's own Report button opens the real sheet; nothing is sent from the example.
        if (document.querySelector("[data-testid=feedback-sheet]")) return true
        activate(document.querySelector<HTMLElement>("[data-testid=feedback-button]"))
        return false
      }
      return document.querySelector("[data-testid=task-view]") !== null
    }
    return watchTourDom(show)
  }, [mode, place])
  // Follow the person's actual approval and launch rather than drawing a second chooser.
  useEffect(() => {
    if (mode !== "tour" || (place !== "plan" && place !== "build")) return
    return watchTourDom(() => {
      const choosing = tourBuildChoiceOpen()
      if (place === "plan" && choosing) {
        setAt(stopAt("build", stops))
        return true
      }
      if (place === "build" && !choosing && document.querySelector("[data-testid=agent-window]")) {
        setAt(stopAt("conversation", stops))
        return true
      }
      return false
    })
  }, [mode, place, stops])
  const active = mode === "tour"
  return (
    <>
      <style>{"[data-sonner-toaster][data-y-position='bottom'] { bottom: 64px; }"}</style>
      {active ? (
        <div
          style={{
            height: "calc(100dvh - 52px)",
            overflow: "hidden",
          }}
        >
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
        <div className="q-onb">
          <div className="q-onb-card narrow">
            <h1>
              {mode === "blocked"
                ? "The example could not start safely"
                : "Your view and draft are kept"}
            </h1>
            <p role="alert">
              {mode === "blocked"
                ? "Your browser could not protect your preferences. Retry, or return without starting the example."
                : "Could not restore your view yet. Your saved preferences are kept for retry; returning waits until they can be restored."}
            </p>
            <div className="foot">
              {mode === "blocked" ? (
                <button
                  type="button"
                  className="q-btn"
                  onClick={() => {
                    preferences.current = beginTourPreferences()
                    if (preferences.current) setMode("tour")
                  }}
                >
                  Retry example
                </button>
              ) : null}
              <button type="button" className="q-btn primary" onClick={() => end()}>
                {mode === "failed" ? "Retry return" : "Return to my view"}
              </button>
            </div>
          </div>
        </div>
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
