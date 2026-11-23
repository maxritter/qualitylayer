// First: globals.css declares the cascade layer order before any component stylesheet (see main.tsx).
import "../globals.css"
import { useEffect } from "react"
import { createRoot } from "react-dom/client"
import { App } from "../App.tsx"
import { Handover } from "../Handover.tsx"
import { applyMotion } from "../motion.ts"
import { loadFragmentsFrom } from "../reader/fragments.ts"
import { loadMermaidFrom } from "../reader/MermaidBlock.tsx"
import { loadDiffsFrom } from "../review-workspace/load.ts"
import { createMemoryLookApi } from "../sidebar/look-api.ts"
import { mount as mountTour } from "../tour/entry.tsx"
import { tourExampleApi, tourTier } from "../tour/example.ts"
import { createDemoApi } from "./api.ts"
import { createDemoArtifactFeedback } from "./artifact-feedback.ts"
import { demoArtifactSource } from "./artifact-source.ts"
import { installDemoFetch } from "./fetch.ts"
import { demoTaskHash } from "./identity.ts"
import { calmFrom, variantFrom } from "./items.ts"
import { forgetSharedRoute, machineWorldFrom } from "./machines.ts"
import {
  buildDemoApi,
  createDemoRunAdapter,
  installDemoEvents,
  installDemoWindowListeners,
  resolveGalleryRun,
  resolveTourLicence,
  seedStoryFavorites,
} from "./main-setup.ts"
import { demoSetup, handoverPage, screenFrom } from "./onboarding.ts"
import { openFromAddress } from "./open-steps.ts"
import { demoTourLocation, demoTourReturn, flagshipFrom } from "./route.ts"
import { seedUnread } from "./seen.ts"
import { STORY_LOOKS, storyWorldFrom } from "./story-world.ts"
import { momentFrom } from "./task/index.ts"
import { websiteLooks, websiteMoment, websiteScene } from "./website-gallery.ts"

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

const Events = installDemoEvents()
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
const variant = {
  ...calmFrom(window.location.search, import.meta.env?.VITE_DEMO_TASKS === "all"),
  ...variantFrom(window.location.search),
}

let quiet = false
const demo = createDemoApi(
  () => {
    if (!quiet) Events.changed()
  },
  flagshipFrom(window.location.search),
  variant,
  websiteMoment(gallery) ?? momentFrom(window.location.search),
  resolveGalleryRun(gallery),
)
const runDemo = demo.runs
const runAdapter = createDemoRunAdapter(runDemo)

// Setup's name lands in the demo's config the way the server's does: with no change signal.
const saveSetupQuietly = async (patch: unknown) => {
  quiet = true
  try {
    return await demo.api.putConfig(patch)
  } finally {
    quiet = false
  }
}

installDemoWindowListeners(() => {
  demo.reset()
  runDemo.reset()
})

const story = storyWorldFrom(window.location.search)
const machineWorld = machineWorldFrom(window.location.search)
if (machineWorld) forgetSharedRoute()
if (story) seedStoryFavorites()

const look =
  gallery !== undefined
    ? createMemoryLookApi({ seed: websiteLooks(gallery) })
    : story
      ? createMemoryLookApi({ seed: STORY_LOOKS })
      : demo.look

const screen = screenFrom(window.location.search)
const tourLicence = resolveTourLicence(window.location.search, screen)
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
    void openFromAddress(window.location.search)
  }, [])
  const api = buildDemoApi(tourExampleApi(demo.api, tier), {
    screen,
    story,
    machineWorld,
    gallery,
    search: window.location.search,
  })
  const setup =
    screen === undefined
      ? undefined
      : demoSetup(screen, window.location.search, saveSetupQuietly, api)
  const app = (
    <App
      api={api}
      look={look}
      {...(setup !== undefined ? { setup } : {})}
      runAdapter={runAdapter}
      onTour={openTour}
      artifactFeedbackApi={artifactFeedback}
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

const mounted = window as { __qualitylayerDemoMounted?: boolean }
const root = document.getElementById("root")
if (root === null) throw new Error("The App demo root is missing")
if (mounted.__qualitylayerDemoMounted !== true) {
  mounted.__qualitylayerDemoMounted = true
  if (new URLSearchParams(window.location.search).has("tour"))
    mountTour(root, { licence: tourLicence, returnTo: demoTourReturn(window.location.href) })
  else createRoot(root).render(<Demo />)
}
