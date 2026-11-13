// First: globals.css declares the cascade layer order before any component stylesheet (see main.tsx).
import "../globals.css"
import { useEffect } from "react"
import { createRoot } from "react-dom/client"
import { App } from "../App.tsx"
import { FAVORITES_PREF, favoriteKey } from "../artifacts/favorites.ts"
import { Handover } from "../Handover.tsx"
import { parseRoute, routeHash } from "../hooks.ts"
import { applyMotion } from "../motion.ts"
import { asNativeShell } from "../native-shell.ts"
import { loadFragmentsFrom } from "../reader/fragments.ts"
import { loadMermaidFrom } from "../reader/MermaidBlock.tsx"
import { loadDiffsFrom } from "../review-workspace/load.ts"
import { createMemoryLookApi } from "../sidebar/look-api.ts"
import { mount as mountTour } from "../tour/entry.tsx"
import { tourExampleApi, tourTier } from "../tour/example.ts"
import { runMomentFrom } from "./agent-window.ts"
import { createDemoApi } from "./api.ts"
import { createDemoArtifactFeedback } from "./artifact-feedback.ts"
import { demoArtifactSource } from "./artifact-source.ts"
import { withDemoConfig } from "./config.ts"
import { withDemoDelays } from "./delay.ts"
import { withDemoFailures } from "./fail.ts"
import { installDemoFetch } from "./fetch.ts"
import { demoTaskHash } from "./identity.ts"
import { calmFrom, variantFrom } from "./items.ts"
import {
  forgetSharedRoute,
  machineWorldFrom,
  macMiniWorldApi,
  withDemoMachines,
} from "./machines.ts"
import {
  demoSetup,
  firstRun,
  handoverPage,
  licenceUnchecked,
  screenFrom,
  trialEnded,
} from "./onboarding.ts"
import { openFromAddress } from "./open-steps.ts"
import { withDemoApproval } from "./outside-approval.ts"
import { demoTourLocation, demoTourReturn, flagshipFrom, validRoute } from "./route.ts"
import { withLargeData } from "./scale.ts"
import { seedUnread } from "./seen.ts"
import { STORY_LOOKS, storyWorldApi, storyWorldFrom } from "./story-world.ts"
import { momentFrom } from "./task/index.ts"
import { websiteGalleryApi, websiteLooks, websiteMoment, websiteScene } from "./website-gallery.ts"

// A change reaching this module (the API, the fixtures) reloads the page: run again by hot reload it
// would mount a second App on the same container, and every shortcut would fire twice.
;(import.meta as { hot?: { decline(): void } }).hot?.decline()

// On the website a plain /app-demo/ opens the story's ordinary day (story-world.ts), the same Home the
// guided demo shows; the source server keeps the full demo, whose checks need every task's states.
if (
  (import.meta as { env?: { PROD?: boolean } }).env?.PROD === true &&
  window.location.search === ""
)
  window.history.replaceState(null, "", `?story${window.location.hash}`)

// The website serves no /mermaid.js: the demonstration bundles Mermaid, loaded when a diagram is drawn.
loadMermaidFrom(() => import("mermaid"))
// Nor /fragments.js: the wireframe and artboard parsers are bundled too.
loadFragmentsFrom(() => import("../reader/fragments-entry.ts"))
// Nor /diffs.js: the review workspace's viewer is bundled too, and colours code on the page.
loadDiffsFrom(() => import("../review-workspace/diffs-entry.ts"), null)

/** An SSE adapter entirely inside the demonstration. It has no network path. */
class DemoEventSource extends EventTarget {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2
  static instances = new Set<DemoEventSource>()
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSED = 2
  readonly withCredentials = false
  readyState = 1
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  constructor(readonly url: string) {
    super()
    DemoEventSource.instances.add(this)
    // `?fail=server`: the server goes away once the page has drawn, as the stream says first.
    if (new URLSearchParams(window.location.search).get("fail")?.split(",").includes("server"))
      setTimeout(() => {
        this.readyState = 0
        this.onerror?.(new Event("error"))
      }, 800)
  }
  close() {
    this.readyState = 2
    DemoEventSource.instances.delete(this)
  }
  static changed(type?: string) {
    for (const source of DemoEventSource.instances) {
      const event = new MessageEvent("message", {
        data: type ? JSON.stringify({ type }) : "illustrative-state-changed",
      })
      source.onmessage?.(event)
      source.dispatchEvent(event)
    }
  }
}
// The module can be evaluated twice (the dev server serves it under two addresses): the first copy's
// class stays the one every App reads, so a change in the API reaches the App that is mounted.
const shared = window as { __qualitylayerDemoEvents?: typeof DemoEventSource }
shared.__qualitylayerDemoEvents ??= DemoEventSource
const Events = shared.__qualitylayerDemoEvents
window.EventSource = Events as unknown as typeof EventSource
window.WebSocket = Events as unknown as typeof WebSocket
// Get approval and the machine dialogs ask the server directly: the demo answers them in the page.
installDemoFetch(window.location.search)
const canonicalHash = demoTaskHash(window.location.hash)
if (canonicalHash !== window.location.hash)
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${canonicalHash}`,
  )
applyMotion()
const gallery = websiteScene(window.location.search)
if (gallery === undefined) seedUnread()
const galleryRun =
  gallery === "plan-questions"
    ? "plan-asking"
    : gallery === "artifact"
      ? "artifact-working"
      : gallery === "plan"
        ? "plan-ready"
        : gallery && ["implement", "verify-checking", "verify", "pull-request"].includes(gallery)
          ? "plan-ready"
          : undefined
const variant = {
  ...calmFrom(window.location.search, import.meta.env?.VITE_DEMO_TASKS === "all"),
  ...variantFrom(window.location.search),
}
// Usage-based billing is the demo task (`#/task/demo`). `?moment=<id>` opens it at one of
// the App Model's moments and adds the product task; `?flagship=<stage>` opens it at
// the moment of that tour stage.
let quiet = false
const demo = createDemoApi(
  () => {
    if (!quiet) Events.changed()
  },
  flagshipFrom(window.location.search),
  variant,
  websiteMoment(gallery) ?? momentFrom(window.location.search),
  galleryRun,
)
const runDemo = demo.runs
const runAdapter = {
  ...runDemo,
  support: () =>
    new URLSearchParams(window.location.search).get("run-platform") === "win32"
      ? {
          supported: false,
          canStart: false,
          canConfigure: true,
          reason: "App agent sessions are unavailable on this computer.",
        }
      : {
          supported: true,
          canStart: runMomentFrom(window.location.search) !== "watching",
          canConfigure: runMomentFrom(window.location.search) !== "watching",
        },
}
// Setup's name lands in the demo's config the way the server's does: with no change signal.
const saveSetupQuietly = async (patch: unknown) => {
  quiet = true
  try {
    return await demo.api.putConfig(patch)
  } finally {
    quiet = false
  }
}
window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin || event.source !== window.parent) return
  if (event.data?.type === "qualitylayer-demo-open" && validRoute(event.data.route))
    window.location.hash = demoTaskHash(routeHash(event.data.route))
  if (event.data?.type === "qualitylayer-demo-reset") {
    demo.reset()
    runDemo.reset()
  }
})
window.addEventListener("hashchange", () => {
  const hash = demoTaskHash(window.location.hash)
  if (hash !== window.location.hash)
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${hash}`,
    )
  window.parent.postMessage(
    { type: "qualitylayer-demo-route", route: parseRoute(window.location.hash) },
    window.location.origin,
  )
})

// The demo story (`?story`) keeps one ordinary day's tasks, its own project first.
const story = storyWorldFrom(window.location.search)
// The Mac Mini's own page (`?machine=mac-mini`), framed inside this computer's: its world, not the story's.
const machineWorld = machineWorldFrom(window.location.search)
if (machineWorld) forgetSharedRoute()
// The story's Library opens with the four artifacts Sam keeps closest starred, as a Library in use has.
if (story)
  try {
    if (localStorage.getItem(FAVORITES_PREF) === null)
      localStorage.setItem(
        FAVORITES_PREF,
        JSON.stringify([
          favoriteKey("platform", "platform-backend"),
          favoriteKey("platform", "billing-admin"),
          favoriteKey("platform", "api-reference"),
          favoriteKey("web", "design-system"),
        ]),
      )
  } catch {
    // Without storage the Library opens with no favorites.
  }
// The website's pictures show four separate projects, each with its color: the gallery's own looks.
const look =
  gallery !== undefined
    ? createMemoryLookApi({ seed: websiteLooks(gallery) })
    : story
      ? createMemoryLookApi({ seed: STORY_LOOKS })
      : demo.look

// A first-run screen asked for in the address (`?screen=setup`): the real component on made-up data.
const screen = screenFrom(window.location.search)
const fixtureTier = new URLSearchParams(window.location.search).get("tier")
const tourLicence = {
  state: "active",
  tier:
    fixtureTier === "team" || fixtureTier === "solo" || fixtureTier === "trial"
      ? fixtureTier
      : fixtureTier === null
        ? screen === "first-run" && !new URLSearchParams(window.location.search).has("story")
          ? "trial"
          : "solo"
        : undefined,
}
const tier = tourTier(tourLicence)
const artifactFeedback = createDemoArtifactFeedback({
  localSource: (address) => demoArtifactSource(demo.api, address),
  agentChanges: (address) => demo.artifactAgentChange(address.file),
})
const openTour = (at = 0) => {
  window.location.assign(demoTourLocation(window.location.href, tourLicence.tier ?? "unknown", at))
}
if (screen === "setup" || screen === "no-agent") window.history.replaceState(null, "", "#/setup")

function Demo() {
  useEffect(() => {
    window.parent.postMessage({ type: "qualitylayer-demo-ready" }, window.location.origin)
    // `?open=` reaches a popover, dialog or menu the way a person would: see open-steps.ts.
    void openFromAddress(window.location.search)
  }, [])
  const roleApi = tourExampleApi(demo.api, tier)
  const shown =
    screen === "trial-ended"
      ? trialEnded(roleApi)
      : screen === "licence-unchecked"
        ? licenceUnchecked(roleApi)
        : screen === "first-run"
          ? firstRun(roleApi, story)
          : machineWorld
            ? macMiniWorldApi(websiteGalleryApi(roleApi, gallery))
            : story
              ? storyWorldApi(websiteGalleryApi(roleApi, gallery))
              : websiteGalleryApi(roleApi, gallery)
  // The demo draws the App as it ships: places, no workspace switch.
  const asked = window.location.search
  // `?scale=large` is the demo with a big team's amounts of data (scale.ts); it sits inside the other
  // layers, so a delay or a failure asked for in the address reaches its calls too.
  const scaled = withLargeData(shown, asked)
  const api = withDemoMachines(
    withDemoApproval(
      withDemoConfig(withDemoFailures(withDemoDelays(asNativeShell(scaled), asked), asked), asked),
      asked,
    ),
    asked,
  )
  const artifactApis = {
    artifactFeedbackApi: artifactFeedback,
  }
  const app =
    screen === undefined ? (
      <App api={api} look={look} runAdapter={runAdapter} onTour={openTour} {...artifactApis} />
    ) : (
      <App
        api={api}
        look={look}
        setup={demoSetup(screen, window.location.search, saveSetupQuietly, api)}
        runAdapter={runAdapter}
        onTour={openTour}
        {...artifactApis}
      />
    )
  const page = screen === undefined ? undefined : handoverPage(screen)
  return page === undefined ? (
    app
  ) : (
    <Handover page={page} open={() => {}} remember={async () => {}}>
      {app}
    </Handover>
  )
}

// The module can be loaded under two addresses (the site's alias and the dev server's own path):
// one App is mounted per window, whichever copy runs first.
const mounted = window as { __qualitylayerDemoMounted?: boolean }
const root = document.getElementById("root")
if (root === null) throw new Error("The App demo root is missing")
if (mounted.__qualitylayerDemoMounted !== true) {
  mounted.__qualitylayerDemoMounted = true
  if (new URLSearchParams(window.location.search).has("tour"))
    mountTour(root, { licence: tourLicence, returnTo: demoTourReturn(window.location.href) })
  else createRoot(root).render(<Demo />)
}
