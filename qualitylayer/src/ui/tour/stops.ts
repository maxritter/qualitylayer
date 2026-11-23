// The tour's stops (App Model: onboarding-tour-next): Home's Needs you first, then one task followed
// from request to approval, one real control and one sentence per stop. Short plays the main moments
// and is the default; Full plays every stop, and Team adds Share and the Team page.
// Icons follow the model's meaning map: the header's three step marks (Plan, Implement, Verify), the
// Conversation and Terminal views, Files, Feedback, Report, Team and Home.

import {
  BadgeCheckIcon,
  BotMessageSquareIcon,
  CodeXmlIcon,
  FlagIcon,
  FolderIcon,
  HouseIcon,
  type LucideIcon,
  Maximize2Icon,
  MessageCircleQuestionMarkIcon,
  MessageSquareIcon,
  NetworkIcon,
  PlusIcon,
  SettingsIcon,
  ShapesIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { type TourHost, tourBuildChoiceOpen } from "./dom.ts"

export { type Box, placeCard } from "./geometry.ts"

/** Under this window width the task list and the right sidebar take turns in one slot (App.tsx `SLOT_MIN`). */
const SHARED_SLOT_BELOW = 1100

/** Which part of the App the stop shows; the connected example opens it. */
export type TourPlace =
  | "new-task"
  | "chat"
  | "artifacts"
  | "artifact-viewer"
  | "settings"
  | "questions"
  | "plan"
  | "build"
  | "conversation"
  | "terminal"
  | "files"
  | "report"
  | "verify"
  | "review"
  | "home"

export type TourStop = {
  id: string
  place: TourPlace
  /** What the card names the stop. */
  label: string
  icon: LucideIcon
  /** The person's own approval: the card says "You approve". */
  you?: boolean
  /** The part the ring goes around: the whole unit a person acts on. */
  sel: string
  /** A second part the ring takes in as well, when it is there; the ring is one rectangle round both. */
  also?: string
  /** One sentence. */
  text: string
  /**
   * The card tries this side of the ring first, where the page or a dialog makes room for it (the launch
   * dialog moves right, Review's page keeps its right edge free); else below, above, right, left.
   */
  card?: "left" | "right"
  /**
   * The App's own state this stop shows in the background (the sidebars, a tab, the Conversation or
   * Terminal view). It is applied when the stop opens and again as the page changes for a moment, since
   * the App resets its sidebars on a change of route; it must press a control only when the state is
   * wrong. `leave` runs when the tour moves on or ends. Neither writes to anything but the example, and
   * the page and preferences the tour started from are restored when it ends.
   */
  enter?: (host: TourHost) => void
  leave?: (host: TourHost) => void
}

/** What a stop keeps open behind the card. */
export type Hold = {
  /** The task list on the left. */
  nav?: boolean
  /** The right sidebar. */
  rail?: boolean
  /** Its tab: `terminal` is the Agent tab. */
  tab?: "terminal" | "files" | "comments"
  /** The Agent tab's Conversation / Terminal switch. */
  view?: "Conversation" | "Terminal"
  /** A fold on the page that is shown open, so the part inside it can be seen. */
  fold?: string
}

function syncNav(host: TourHost, nav: boolean | undefined): boolean {
  if (nav === undefined || host.has("[data-testid=shell][data-nav=open]") === nav) return false
  return host.press(
    nav
      ? '[aria-label^="Show the task list"], [aria-label="Expand the task list"], [aria-label^="Menu"]'
      : '[aria-label="Hide the task list"]',
  )
}

function syncRail(host: TourHost, rail: boolean | undefined): boolean {
  if (rail === undefined || host.has("[data-rail=open]") === rail) return false
  return host.press("[data-testid=sidebar-button]")
}

function syncTab(host: TourHost, tab: Hold["tab"]): boolean {
  if (tab === undefined) return false
  const activeSelector =
    tab === "terminal"
      ? "#rs-tab-terminal[aria-selected=true], #rs-tab-conversation[aria-selected=true]"
      : `#rs-tab-${tab}[aria-selected=true]`
  return !host.has(activeSelector) && host.press(`#rs-tab-${tab}`)
}

function syncView(host: TourHost, view: Hold["view"]): boolean {
  return (
    view !== undefined &&
    !host.has("[role=radio][aria-checked=true]", view) &&
    host.press("[role=radio]", view)
  )
}

/** Press a control only when the App is not already in the wanted state. */
export const hold =
  (want: Hold) =>
  (host: TourHost): void => {
    if (syncNav(host, want.nav) || syncRail(host, want.rail) || want.rail === false) return
    if (syncTab(host, want.tab) || syncView(host, want.view)) return
    if (want.fold !== undefined) host.open(want.fold)
  }

const RAIL = "[data-testid=right-sidebar]"
/** Verify's status board: the four stages of checks and the verdicts they gather. */
const PROOF = "[data-testid=verify-board]"

export const STOPS: TourStop[] = [
  {
    id: "status",
    place: "home",
    label: "Needs you",
    icon: HouseIcon,
    // Needs you alone: the ring stops above Running.
    sel: "[data-testid=needs-you]",
    text: "Anything that needs you shows up here first, so you can step away while agents work.",
    enter: hold({ nav: true }),
  },
  {
    id: "new",
    place: "new-task",
    label: "New task",
    icon: PlusIcon,
    sel: "[data-testid=new-task]",
    text: "The + starts a Task to plan a feature or bug fix, or a Chat for free-form work with no steps.",
    // The + is in the task list: Back from Questions, which hides it, must bring it back to open the card.
    // Below 900 px the list is a sheet that closes as the card opens: it stays closed then, or the two
    // would take turns for ever (the Report stop does the same).
    enter: (host) =>
      hold({
        nav:
          window.innerWidth >= 900 ||
          !host.has("[data-testid=new-task], [data-testid=new-task-button][data-card-open]"),
      })(host),
  },
  {
    id: "questions",
    place: "questions",
    label: "Questions",
    icon: MessageCircleQuestionMarkIcon,
    sel: "[data-testid=focus-card]",
    text: "For a planned change, answer your agent's first few questions right here.",
    enter: hold({ nav: false }),
  },
  {
    id: "plan",
    place: "plan",
    label: "Plan",
    icon: NetworkIcon,
    you: true,
    sel: "[data-testid=step-gist]",
    also: ".ir-header-decisions",
    text: "Try the design, mark what should change to tell your agent, then approve the Plan.",
    enter: hold({ nav: false, rail: false }),
  },
  {
    id: "build",
    place: "build",
    label: "Start the build",
    icon: CodeXmlIcon,
    sel: "[role=dialog]:not(.q-tour-tip)",
    text: "Choose the lead, its helpers and workspace, then start the build.",
    card: "left",
    enter: (host) =>
      hold({ nav: false, rail: window.innerWidth >= 900 || !tourBuildChoiceOpen() })(host),
  },
  {
    id: "session",
    place: "conversation",
    label: "Conversation and Terminal",
    icon: BotMessageSquareIcon,
    sel: RAIL,
    text: "Read the agent's conversation, or switch to Terminal to see the same session.",
    enter: hold({ nav: false, rail: true, tab: "terminal" }),
  },
  {
    id: "files",
    place: "files",
    label: "Files",
    icon: FolderIcon,
    sel: RAIL,
    text: "The Plan, artifacts, reviews and changed files of this task are all here.",
    enter: hold({ nav: false, rail: true, tab: "files" }),
  },
  {
    id: "report",
    place: "report",
    label: "Report",
    icon: FlagIcon,
    sel: "[data-testid=feedback-sheet] .q-report-head",
    text: "Preview your bug or idea as a public GitHub issue before you send it.",
    enter: (host) =>
      hold({
        nav: window.innerWidth >= 900 || !host.has("[data-testid=feedback-sheet]"),
        // Below 1100 px the task list and the right sidebar share one slot (App.tsx `SLOT_MIN`): the list stays,
        // since the Report button lives in it, and asking for the sidebar as well would close it again.
        ...(window.innerWidth >= SHARED_SLOT_BELOW ? { rail: true, tab: "terminal" as const } : {}),
      })(host),
  },
  {
    id: "verify",
    place: "verify",
    label: "Verify",
    icon: ShieldCheckIcon,
    sel: PROOF,
    text: "Checks, security scans and independent agents verify the change; the evidence stays here.",
    enter: hold({ nav: false }),
  },
  {
    id: "review",
    place: "review",
    label: "Approve the change",
    icon: BadgeCheckIcon,
    you: true,
    sel: "[data-testid=review-code-row]",
    text: "Review the code, then approve the change or create a pull request.",
    card: "right",
    enter: hold({ nav: false, rail: false }),
  },
  {
    id: "chat",
    place: "chat",
    label: "Chat",
    icon: MessageSquareIcon,
    sel: "[data-testid=chat-page] .q-chat-body",
    text: "Work in full-screen Chat, follow the agent's task list, or convert it to a task when you want a planned change.",
    enter: hold({ nav: false, rail: false }),
  },
  {
    id: "artifacts",
    place: "artifacts",
    label: "Artifacts",
    icon: ShapesIcon,
    sel: "[data-testid=artifacts-page]",
    text: "Keep reusable designs and documents in the Artifacts library, grouped by project.",
    enter: hold({ nav: true, rail: false }),
  },
  {
    id: "artifact-viewer",
    place: "artifact-viewer",
    label: "Open an artifact",
    icon: Maximize2Icon,
    sel: "[data-testid=artifact-header]",
    text: "Open an artifact at full size, change its page, and click a spot to ask your agent about it.",
    enter: hold({ nav: false, rail: false }),
  },
  {
    id: "settings",
    place: "settings",
    label: "Settings",
    icon: SettingsIcon,
    sel: '[aria-label="Settings sections"] > button:last-of-type',
    card: "right",
    text: "Find agents, Usage, Memory and help in Settings.",
  },
]

/** How much of the tour plays: the main moments (the default), or every stop. */
export type TourLength = "short" | "full"

/** The Short tour's stops, in the full tour's order. */
const SHORT_STOPS = new Set([
  "status",
  "new",
  "questions",
  "plan",
  "build",
  "session",
  "verify",
  "review",
  "chat",
  "artifacts",
])

/** Every stop of the full tour. */
export const TOUR_STOPS: TourStop[] = STOPS

export const tourStops = (length: TourLength = "full"): TourStop[] =>
  length === "short" ? STOPS.filter((stop) => SHORT_STOPS.has(stop.id)) : TOUR_STOPS

/**
 * Where a tour of another length picks up: the same stop, else the closest stop before it, else its
 * first stop.
 */
export function stopInLength(from: TourStop[], at: number, to: TourStop[]): number {
  for (let index = Math.min(at, from.length - 1); index >= 0; index--) {
    const found = to.findIndex((stop) => stop.id === from[index]?.id)
    if (found >= 0) return found
  }
  return 0
}

/** The index of a place's stop. */
export const stopAt = (place: TourPlace, stops: TourStop[] = TOUR_STOPS): number =>
  stops.findIndex((stop) => stop.place === place)
