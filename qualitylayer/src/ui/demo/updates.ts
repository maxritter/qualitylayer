// The demonstration's updates and feedback, in memory. `?update=ready|waiting|installing|failed` opens
// the demo with an update in that state (nothing, by default); Restart and update then comes back updated. `?updated=12.1.0` shows the toast after one.
// A report is never sent anywhere: the demo says it reached us.

import type {
  PublicDelivery,
  PublicReviewView,
  PublicSystem,
} from "../../core/feedback/public-contract.ts"
import type { Release } from "../../core/update/notes.ts"
import type { Api, Diagnostics, UpdateInfo } from "../api.ts"
import { DEMO_NEXT_VERSION, DEMO_VERSION } from "./version.ts"

export const DEMO_STATES = ["ready", "waiting", "installing", "failed"] as const
type DemoState = (typeof DEMO_STATES)[number]

const NOTES = `### New

- Plan limits show in the sidebar, in Settings and under the message box
- Cursor, Grok, Antigravity and GitHub Copilot run next to Claude Code, Codex, Pi and OpenCode
- Long conversations fold finished turns into one line and list the files each turn changed

### Fixed

- The App counts a task's changes when it was started from the Dock
- Opening a file from a task uses the editor you chose in Settings

### Good to know

- Moving from an earlier version asks nothing; your tools and memories stay.
`

const CURRENT = DEMO_VERSION
const AVAILABLE = DEMO_NEXT_VERSION

const PUBLIC_SYSTEM: PublicSystem = {
  appVersion: CURRENT,
  os: { family: "macOS", version: "27.0" },
  architecture: "arm64",
}

const RELEASES: Release[] = [
  { version: AVAILABLE, label: AVAILABLE, notes: NOTES },
  {
    version: CURRENT,
    label: CURRENT,
    notes:
      "### New\n\n- A notice tells you when the agent answers your question.\n\n### Fixed\n\n- Reopening the App no longer lands on Home.",
  },
  {
    version: "11.9.2",
    label: "11.9.2",
    notes:
      "### New\n\n- The Cost panel names each agent by its work.\n\n### Fixed\n\n- The step tabs work in a browser tab.",
  },
  {
    version: "11.9.1",
    label: "11.9.1",
    notes: "### Fixed\n\n- Plans keep their diagrams when they are exported.",
  },
]

const checkedAt = () => {
  const day = new Date()
  day.setHours(9, 12, 0, 0)
  return day.getTime()
}

function initialUpdateInfo(asked: string | null): UpdateInfo {
  const start = (DEMO_STATES as readonly string[]).includes(asked ?? "")
    ? (asked as DemoState)
    : null
  return {
    current: CURRENT,
    available: start === null ? null : AVAILABLE,
    notes: start === null ? null : NOTES,
    downloaded: start !== null,
    checkedAt: checkedAt(),
    state: start === null ? "idle" : start === "ready" ? "ready" : start,
    ...(start === "waiting" ? { waitingFor: 2 } : {}),
    ...(start === "failed" ? { error: "signature" } : {}),
    later: false,
    managed: true,
  }
}

function parseWaitedDays(query: URLSearchParams): number | null {
  const raw = query.get("waited")
  const days = Number(raw)
  return raw !== null && Number.isFinite(days) && days >= 0 ? days : null
}

function releasesFor(waited: number | null): Release[] {
  if (waited === null) return RELEASES
  const published = new Date(Date.now() - waited * 86_400_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
  return RELEASES.map((release) =>
    release.version === AVAILABLE ? { ...release, published } : release,
  )
}

async function buildPublicPreview(
  form: FormData,
  publicReviews: Map<string, PublicReviewView>,
): Promise<PublicReviewView> {
  const input = JSON.parse(String(form.get("report"))) as {
    id: string
    kind: "bug" | "idea"
    title: string
    description: string
  }
  const images = form
    .getAll("image")
    .filter((file): file is File => file instanceof File)
    .map((file, index) => ({ url: URL.createObjectURL(file), alt: `Screenshot ${index + 1}` }))
  const content = {
    kind: input.kind,
    title: input.title.trim(),
    description: input.description.trim(),
    system: PUBLIC_SYSTEM,
    screenshots: [],
  }
  const issue = {
    repository: "maxritter/qualitylayer" as const,
    title: content.title,
    body: `## Description\n\n${content.description}\n\n## Environment\n\n- **QualityLayer version**: ${CURRENT}\n- **OS**: macOS 27.0\n- **Architecture**: arm64`,
    labels: [input.kind === "bug" ? "bug" : "enhancement", "needs-triage"],
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        destination: "maxritter/qualitylayer",
        id: input.id,
        content,
        issue,
      }),
    ),
  )
  const contentSha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
  const view: PublicReviewView = {
    preview: { id: input.id, content, issue, review: { version: 1, contentSha256 } },
    images,
  }
  publicReviews.get(input.id)?.images.forEach((image) => {
    URL.revokeObjectURL(image.url)
  })
  publicReviews.set(input.id, view)
  return view
}

function buildPublicDelivery(id: string, feedbackMode: string | null): PublicDelivery {
  if (feedbackMode === "uncertain") {
    return {
      status: "uncertain",
      id,
      message:
        "Illustrative state: GitHub may have received the report. Automatic retry is paused and the draft is kept.",
    }
  }
  if (feedbackMode === "offline") {
    return {
      status: "queued",
      id,
      message:
        "Illustrative state: the reviewed public issue is saved to send when the connection returns.",
    }
  }
  return {
    status: "submitted",
    reference: "maxritter/qualitylayer#128",
    issueUrl: "https://github.com/maxritter/qualitylayer/issues/128",
  }
}

const previewDiagnostics = (page?: string): Diagnostics => ({
  app: CURRENT,
  cli: CURRENT,
  claudeCode: "2.1.302",
  codex: "0.163.0",
  os: "macOS 27.0",
  arch: "arm64",
  ...(page !== undefined ? { page } : {}),
  tier: "team",
  errors: { count: 0, kinds: [] },
})

const UPDATE_PATCHES: Record<string, () => Partial<UpdateInfo>> = {
  later: () => ({ later: true }),
  check: () => ({ checkedAt: Date.now() }),
  cancel: () => ({ state: "ready" }),
  install: () => ({
    current: AVAILABLE,
    available: null,
    notes: null,
    downloaded: false,
    state: "idle",
    updated: AVAILABLE,
    checkedAt: Date.now(),
  }),
}

export function demoUpdates(search: string, onChange: () => void) {
  const publicReviews = new Map<string, PublicReviewView>()
  const publicDeliveries = new Map<string, PublicDelivery>()
  const query = new URLSearchParams(search)
  const waited = parseWaitedDays(query)
  const feedbackMode = query.get("feedback")
  let info = initialUpdateInfo(query.get("update"))

  const api: Pick<
    Api,
    | "update"
    | "updateAction"
    | "releases"
    | "feedbackWho"
    | "feedbackPreview"
    | "sendFeedback"
    | "publicFeedbackSystem"
    | "publicFeedbackPreview"
    | "publicFeedbackSubmit"
    | "publicFeedbackCancel"
    | "publicFeedbackStatus"
  > = {
    update: async () => ({ ok: true as const, ...info }),
    updateAction: async (action) => {
      const makePatch = UPDATE_PATCHES[action]
      if (makePatch) {
        info = { ...info, ...makePatch() }
        onChange()
      }
      return { requested: action }
    },
    releases: async () => releasesFor(waited),
    feedbackWho: async () => ({
      kind: "licence" as const,
      tier: "team" as const,
      name: "Sam Rivera",
      email: "sam@example.com",
    }),
    feedbackPreview: async ({ page }) => previewDiagnostics(page),
    sendFeedback: async () =>
      feedbackMode === "offline"
        ? { status: "queued" as const, id: "demo", why: "offline" as const }
        : { status: "sent" as const, reference: "QL-128" },
    publicFeedbackSystem: async () => PUBLIC_SYSTEM,
    publicFeedbackPreview: (form) => buildPublicPreview(form, publicReviews),
    publicFeedbackSubmit: async (id, digest) => {
      if (publicReviews.get(id)?.preview.review.contentSha256 !== digest)
        throw new Error("Preview the report again.")
      const delivery = buildPublicDelivery(id, feedbackMode)
      publicDeliveries.set(id, delivery)
      return delivery
    },
    publicFeedbackCancel: async (id) => {
      publicDeliveries.delete(id)
      return { stopped: true }
    },
    publicFeedbackStatus: async (id) => publicDeliveries.get(id) ?? null,
  }
  return api
}
