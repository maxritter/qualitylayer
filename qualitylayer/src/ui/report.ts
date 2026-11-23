// What the page keeps for feedback: the errors it showed in the last hour (kinds and a count, never
// their text), the kind of page the person is on, and the one way anything asks for the sheet to open:
// the sidebar's Feedback button, ⌘K, and "Report this" on every error toast.

import { toast } from "sonner"
import {
  ERROR_KINDS,
  type ErrorKind,
  type PANELS,
  pageKindOf,
  type RecentErrors,
} from "../core/feedback/words.ts"
import type { FlowStepId } from "../core/flow.ts"
import type { TaskDetail } from "../server/api.ts"
import type { Route } from "./hooks.ts"
import { defaultDoc, viewedStep } from "./model.ts"

export type FeedbackRequest = {
  kind?: "bug" | "idea"
  /** The error a toast showed: the sheet opens with it written in, and the page kind in its diagnostics. */
  error?: string
}

// ── Opening the sheet ──────────────────────────────────────────────────────────

const listeners = new Set<(request: FeedbackRequest) => void>()

/** Ask the sheet to open; the App is the one listener. */
export function requestFeedback(request: FeedbackRequest = {}): void {
  for (const listener of listeners) listener(request)
}

export function onFeedbackRequest(listener: (request: FeedbackRequest) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// ── Errors of the last hour ────────────────────────────────────────────────────

const HOUR = 3_600_000
const noted: { kind: ErrorKind; at: number }[] = []

/** The kind an error message belongs to; only the kind is ever kept. */
export function errorKindOf(message: string): ErrorKind {
  const kinds: [ErrorKind, RegExp][] = [
    ["network", /network|offline|failed to fetch|reach|timed out|connection/i],
    ["licence", /licen[cs]e|trial|\bseat/i],
    ["update", /\bupdate/i],
    ["feedback", /feedback|\breport\b/i],
    ["server", /server|\b5\d\d\b|did not answer|session|internal/i],
  ]
  return kinds.find(([, pattern]) => pattern.test(message))?.[0] ?? "other"
}

/** An error shown both inline and as a toast is one error: the same words within a few seconds count once. */
const SAME_ERROR_MS = 5_000
const lately = new Map<string, number>()

export function noteError(message: string, kind: ErrorKind = errorKindOf(message)): void {
  const now = Date.now()
  if (message !== "") {
    if (now - (lately.get(message) ?? 0) < SAME_ERROR_MS) return
    for (const [text, at] of lately) if (now - at >= SAME_ERROR_MS) lately.delete(text)
    lately.set(message, now)
  }
  noted.push({ kind, at: now })
  if (noted.length > 200) noted.splice(0, noted.length - 200)
}

/** How many errors the page showed in the last hour, and which kinds. */
export function recentErrors(now = Date.now()): RecentErrors {
  const live = noted.filter((entry) => now - entry.at < HOUR)
  return {
    count: live.length,
    kinds: ERROR_KINDS.filter((kind) => live.some((entry) => entry.kind === kind)),
  }
}

export function forgetErrors(): void {
  noted.length = 0
  lately.clear()
}

/**
 * Every error toast offers Report this, and is counted. The toast is the one place the App shows an
 * error, so the offer is made where they all pass: no call site repeats it.
 */
export function reportableErrors(): void {
  const original = toast.error
  if ((original as { reportable?: boolean }).reportable === true) return
  const patched = ((
    message: Parameters<typeof toast.error>[0],
    data?: Parameters<typeof toast.error>[1],
  ) => {
    const text = typeof message === "string" ? message : ""
    noteError(text)
    return original(message, {
      ...(text !== "" && data?.action === undefined
        ? {
            duration: 10_000,
            action: {
              label: "Report this",
              onClick: () => requestFeedback({ kind: "bug", error: text }),
            },
          }
        : {}),
      ...data,
    })
  }) as typeof toast.error & { reportable: true }
  patched.reportable = true
  toast.error = patched
}

// ── Where the person is ────────────────────────────────────────────────────────

const STEP_WORD: Record<FlowStepId, string> = {
  plan: "Plan",
  implement: "Implement",
  verify: "Verify",
}

const TAB_WORD: Record<string, string> = {
  workflow: "Workflow",
  licence: "Licence",
  about: "About",
}

type Panel = (typeof PANELS)[number]

const PANEL_SELECTORS: readonly (readonly [string, Panel])[] = [
  // The overlays first: they sit over whatever else is open.
  ['[data-testid="command-box"]', "Command box"],
  ['[data-testid="update-sheet"]', "Update sheet"],
  ['[data-testid^="share-"]', "Share"],
  ['[data-testid="comments-panel"]', "Comments panel"],
  ['[data-testid="cost-panel"]', "Cost panel"],
]

const APPROVE_MENU_SELECTOR =
  '.review-approval-menu[role="menu"], button[aria-expanded="true"][aria-label="More ways to approve"]'

/** The panel that is open on the page now, found by the marks the panels carry. */
export function openPanel(root: ParentNode = document): Panel | undefined {
  for (const [selector, panel] of PANEL_SELECTORS) {
    if (root.querySelector(selector) !== null) return panel
  }
  const hasApproveMenu =
    root.querySelector('[role="menu"]') !== null &&
    root.querySelector(APPROVE_MENU_SELECTOR) !== null
  return hasApproveMenu ? "Approve menu" : undefined
}

/**
 * The page as a kind: "Home", "Settings › About", "a task · Verify step · Approve menu open". Never a
 * task's title or id: a form the site does not know is dropped before it is sent.
 */
export function pageKindFor(
  route: Route,
  where: { step?: FlowStepId | null; panel?: Panel | null },
): string | undefined {
  if (route.view === "home") return "Home"
  if (route.view === "settings") {
    return pageKindOf(`Settings › ${TAB_WORD[route.tab ?? "workflow"] ?? ""}`)
  }
  if (route.view === "task" && where.step !== undefined && where.step !== null) {
    const base = `a task · ${STEP_WORD[where.step]} step`
    return pageKindOf(where.panel ? `${base} · ${where.panel} open` : base)
  }
  return undefined
}

/** The kind of page the person is on now, for the diagnostics of a report. */
export function pageNow(route: Route, task: TaskDetail | null): string | undefined {
  const step =
    route.view === "task" && task !== null ? viewedStep(route.doc ?? defaultDoc(task)) : null
  return pageKindFor(route, {
    step,
    panel: typeof document === "undefined" ? null : (openPanel() ?? null),
  })
}
