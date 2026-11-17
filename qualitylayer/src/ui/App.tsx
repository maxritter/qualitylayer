// The Cockpit: one shell, three routes, one push stream that invalidates each affected
// query. The open task also re-reads liveness every thirty seconds. The task list and the
// Comments panel are columns: open, they take their width and the middle column
// gets narrower; closed, they take none.

import { cn } from "cn"
import {
  type ContextType,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AGENT_NAMES, isNativeAgent } from "../core/agents/ids.ts"
import { type DefaultsAgent, defaultAgentView, themeOf } from "../core/config-values.ts"
import { type LookPatch, NO_LOOKS, type ProjectLooks } from "../core/project-look.ts"
import type { AnsweredQuestion } from "../core/task/question.ts"
import { selectsQuota } from "../core/usage-display.ts"
import type { Notification as ShellNotification } from "../interaction/contracts.ts"
import {
  type ConversationActions,
  ConversationActionsContext,
  taskBackgroundWork,
  taskConversationActions,
  waitsOnAnswer,
} from "./agent-window/conversation/actions.ts"
import { taskContextTarget } from "./agent-window/conversation/context-draft.ts"
import { RunDock } from "./agent-window/Dock.tsx"
import { TerminalLayoutProvider, useTerminalLayout } from "./agent-window/layout.tsx"
import type { TaskAgentControls } from "./agent-window/task-controls.ts"
import {
  type Api,
  ApiError,
  type Config,
  api as defaultApi,
  interactionApi,
  type Licence,
  type TaskDetail,
  type TaskSummary,
} from "./api.ts"
import {
  type ArtifactFeedbackAddress,
  type ArtifactFeedbackApi,
  artifactFeedbackApi as realArtifactFeedbackApi,
} from "./artifact/feedback-api.ts"
import { artifactFileOfView } from "./artifact/TaskArtifact.tsx"
import { ArtifactRoute } from "./artifacts/ArtifactRoute.tsx"
import { ArtifactsPage } from "./artifacts/ArtifactsPage.tsx"
import { artifactContextTarget } from "./artifacts/artifact-context.ts"
import { useArtifactsOverview } from "./artifacts/useArtifacts.ts"
import { BuildHereContinuation } from "./BuildHereContinuation.tsx"
import { BoundedCache } from "./bounded-cache.ts"
import { type ClipboardText, writeClipboardText } from "./clipboard.ts"
import { useNativeDownloads } from "./export/useNativeDownloads.ts"
import { FeedbackSheet, type FeedbackStart } from "./FeedbackSheet.tsx"
import { FirstRun } from "./FirstRun.tsx"
import { useFollowUp } from "./follow-up.ts"
import { NoKey, pageOf } from "./Handover.tsx"
import { Home } from "./Home.tsx"
import { useHomeQuestions } from "./HomeQuestion.tsx"
import {
  type OutsideConversationInterest,
  OutsideConversationInterestContext,
  parseRoute,
  RestoredRouteContext,
  type Route,
  routeHash,
  useEventStream,
  useNow,
  useQuery,
  useRoute,
  useScrollMemory,
  useViewportWidth,
} from "./hooks.ts"
import type { BuildLaunchSelection } from "./ImplementStart.tsx"
import { CommandBox } from "./kit/CommandBox.tsx"
import { taskFileEntries } from "./kit/command-files.ts"
import { HomeLoading } from "./kit/LoadingState.tsx"
import { useAppPointMenu } from "./kit/PointMenu.tsx"
import { useCommandApp } from "./kit/use-command-app.ts"
import { useFeedKnownModels } from "./known-models.ts"
import { Logo } from "./Logo.tsx"
import {
  confirmedQuestions,
  liveNoticesFor,
  noticeOptions,
  noticeWakeAt,
  setNoticeSound,
  showTitle,
  staleToasts,
  tellShell,
  windowTitle,
} from "./live-notify.ts"
import { MachineLayer, type MachinePage, type ReadMachines } from "./machines/MachineFrames.tsx"
import { useHostTheme } from "./machines/MachineSwitch.tsx"
import { type Theme, toParent } from "./machines/relay.ts"
import { momentOf, type Need, notificationsFor } from "./model.ts"
import { useMotion } from "./motion.ts"
import { NewTask } from "./NewTask.tsx"
import { nativeShell } from "./native-shell.ts"
import { approvesOutside, onContinueInQualityLayer, runsOutside } from "./outside.ts"
import type { ProjectTarget } from "./ProjectPicker.tsx"
import { PREF, store, stored, usePref } from "./prefs.ts"
import { questionPreview } from "./question-preview.ts"
import { Resizer, useStoredWidth } from "./Resizer.tsx"
import { onFeedbackRequest, pageNow, reportableErrors } from "./report.ts"
import { type AgentLaunchValue, preferredLaunchAgent } from "./run/AgentLaunchFields.tsx"
import { AgentSwitchDialog } from "./run/AgentSwitch.tsx"
import { ShellBar } from "./run/AgentTab.tsx"
import { AgentTabMenu, type AgentTabMode } from "./run/AgentTabMenu.tsx"
import { ArtifactAgentLaunch } from "./run/ArtifactAgentLaunch.tsx"
import { canSwitchTaskAgent } from "./run/agent-switch.ts"
import { taskApprovalReady } from "./run/approval-ready.ts"
import { OpenTerminal } from "./run/OpenTerminal.tsx"
import { continueOutsideLead, outsideAsks, taskAgentEmpty } from "./run/OutsideLead.tsx"
import { TaskAgentLaunch, taskLaunchKey } from "./run/TaskAgentLaunch.tsx"
import { runAttention } from "./run-attention.ts"
import { type RunAdapter, RunProvider, type RunWindow, useOptionalRuns } from "./run-context.tsx"
import { buildRunsVersion, runsApi } from "./runs-api.ts"
import { Settings } from "./Settings.tsx"
import { defaultSetupPageApi, Setup, type SetupPageApi } from "./Setup.tsx"
import { Sidebar } from "./Sidebar.tsx"
import { useSettingsNav } from "./settings/useSettingsNav.tsx"
import { NeedsYouCountProvider } from "./shell/needs-you-count.tsx"
import { TaskListToggle } from "./shell/TaskListToggle.tsx"
import { WorkspaceResize } from "./shell/WorkspaceResize.tsx"
import { AddProject } from "./sidebar/AddProject.tsx"
import {
  applyLook,
  applyOrder,
  createMemoryLookApi,
  type LookApi,
  realLookApi,
} from "./sidebar/look-api.ts"
import { ProjectLooksContext } from "./sidebar/look-context.tsx"
import { type NewKind, NewMenu } from "./sidebar/NewMenu.tsx"
import { projectFacts } from "./sidebar/project-model.ts"
import { StartContext } from "./start-context.ts"
import { TaskLoading } from "./TaskLoading.tsx"
import { useTaskPointMenu } from "./TaskPointMenu.tsx"
import { TaskView, TOP_BAR_TOOLS } from "./TaskView.tsx"
import { TrialEnded } from "./TrialEnded.tsx"
import { ServerDown, unreachable } from "./Trouble.tsx"
import {
  dispositionTasks,
  originalTaskApi,
  taskDispositionScope,
  useTaskDispositions,
} from "./task-disposition.ts"
import { useTextSize, useUiFont } from "./text-look.ts"
import { useTourEnding } from "./tour/ending.ts"
import { tourLocation } from "./tour/location.ts"
import {
  beginAutomaticTour,
  clearCodexHooksPending,
  codexHooksPending,
  pausedTour,
  tourNeedsCurrentRevision,
} from "./tour/session.ts"
import { useTurnDetail, useTurnTasks } from "./turn/projection.ts"
import { useUpdates } from "./Updates.tsx"
import { UsageDisplayProvider } from "./usage/display-context.tsx"
import { useVisibleQuotas, useVisibleUsageRefresh } from "./usage/refresh.ts"

/** Below this width the task list is a Menu button that opens it as a sheet. */
const NAV_MIN = 900
/** The page between the panels keeps at least this much room while they are dragged wider. */
const MIDDLE_MIN = 520
/** Below this width the task list and the right sidebar share one slot: opening one steps the other aside. */
const SLOT_MIN = 1100

const darkQuery = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null

/** Whether the operating system asks for dark, followed live. */
function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => darkQuery()?.matches ?? false)
  useEffect(() => {
    const query = darkQuery()
    if (query === null) return
    const on = () => setDark(query.matches)
    query.addEventListener("change", on)
    return () => query.removeEventListener("change", on)
  }, [])
  return dark
}

function copy(text: ClipboardText): Promise<boolean> {
  return writeClipboardText(text)
}

/**
 * Whether this page may fire a notification itself. Inside the App window the shell does, from
 * the same events, so the page would only repeat it.
 */
const pageNotifies = () => typeof Notification !== "undefined" && !pageOf().inApp

/** Fire a browser notification when a task newly needs you or ships. */
function useNotifications(tasks: TaskSummary[] | null, config: Config | null) {
  const seen = useRef<Map<string, string> | null>(null)
  useEffect(() => {
    if (tasks === null || config === null || !pageNotifies()) return
    const now = new Map(tasks.map((t) => [t.id, momentOf(t)]))
    const before = seen.current
    seen.current = now
    if (before === null || Notification.permission !== "granted") return
    for (const note of notificationsFor(
      before,
      now,
      // A task asked wholly in its agent tells nothing here; a split one tells its App side.
      tasks.filter((task) => !(runsOutside(task) && approvesOutside(task))),
      {
        ...config.notifications,
        gateOpened: false,
      },
    ))
      new Notification(note.title, noticeOptions(note.body))
  }, [tasks, config])
}

/**
 * The live status in the background: a notice once for each moment that waits for the person (a
 * question, a need, a permission prompt, a stopped agent), the window title and the dock badge. In
 * the App the shell shows the notice; in a browser the page does, when allowed. None steals focus:
 * the first question after /ql is the CLI's to bring forward. Agent progress never notifies.
 */
function useLiveNotifications(
  tasks: TaskSummary[] | null,
  config: Config | null,
  current: TaskDetail | null,
  currentId: string | null,
  notifications: ShellNotification[] | null | undefined,
) {
  const seen = useRef<Set<string> | null>(null)
  /** The toasts this hook put on screen: key → the route they open. */
  const toasts = useRef(new Map<string, string>())
  // Twenty quiet minutes come with no event of their own: the clock moves every half minute, and
  // fetches nothing.
  const tick = useNow(true, 30_000)
  // A held notice (Needs you waits 1.5 s, Your turn 2 s) falls due with no new signal: look again then.
  const [due, setDue] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `due` re-arms the timer for the next held notice once one fell due
  useEffect(() => {
    const at = tasks === null ? null : noticeWakeAt(tasks, Date.now())
    if (at === null) return
    const timer = setTimeout(() => setDue((n) => n + 1), Math.max(0, at - Date.now()) + 20)
    return () => clearTimeout(timer)
  }, [tasks, due])
  // biome-ignore lint/correctness/useExhaustiveDependencies: the tick is the clock moving on
  useEffect(() => {
    if (tasks === null) return
    // The task detail can refresh before the list. Its current ask owns the visible page's title.
    const shown = current === null ? tasks : tasks.map((t) => (t.id === current.id ? current : t))
    showTitle(windowTitle(shown, current?.id).title)
    if (config === null) return
    if (notifications === null) return
    const batchRows = notifications?.filter(
      (n) => n.state === "open" && n.batch !== null && !n.target.itemId.startsWith("question:"),
    )
    const batchTexts = batchRows
      ? new Map(batchRows.map((n) => [n.target.taskId, n.text]))
      : undefined
    const batches =
      notifications === undefined
        ? undefined
        : new Map(
            (batchRows ?? []).map((n) => [
              n.target.taskId,
              n.batch?.slice(n.target.taskId.length + 1) ?? "",
            ]),
          )
    const questions = notifications === undefined ? undefined : confirmedQuestions(notifications)
    const {
      notices,
      seen: now,
      current: moments,
    } = liveNoticesFor(seen.current, tasks, Date.now(), batches, questions, batchTexts)
    seen.current = now
    // A toast lasts as long as its moment: answered, approved or opened, it goes.
    for (const key of staleToasts(toasts.current, moments, currentId)) {
      toast.dismiss(key)
      toasts.current.delete(key)
    }
    if (!config.notifications.gateOpened) return
    const foreground = document.visibilityState === "visible" && document.hasFocus()
    if (foreground) {
      // The shell records even a moment read on its own task, so minimizing cannot repeat it.
      if (pageOf().inApp) tellShell(notices, true)
      for (const notice of notices) {
        if (notice.route === `#/task/${encodeURIComponent(currentId ?? "")}`) continue
        toasts.current.set(notice.key, notice.route)
        toast(notice.title, {
          onDismiss: () => toasts.current.delete(notice.key),
          onAutoClose: () => toasts.current.delete(notice.key),
          id: notice.key,
          description: notice.body,
          action: {
            label:
              notice.key.includes("question|") || notice.key.includes("batch|")
                ? "Answer"
                : notice.key.includes("|chat-")
                  ? "Open the Chat"
                  : "Open task",
            onClick: () => {
              window.location.hash = notice.route
            },
          },
        })
      }
      return
    }
    if (pageOf().inApp) {
      tellShell(notices)
      return
    }
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return
    for (const notice of notices) {
      const shown = new Notification(notice.title, noticeOptions(notice.body))
      shown.onclick = () => {
        window.focus()
        window.location.hash = notice.route
      }
    }
  }, [tasks, config, current, currentId, notifications, tick, due])
  return tick
}

type Panel = "auto" | "open" | "closed"
const PANELS: Panel[] = ["auto", "open", "closed"]

/**
 * Whether the left column shows. Settings always show their own sidebar on a desktop window, whatever
 * the person did to the task list; every other page follows that choice, and a full-screen artifact hides it.
 */
function navShown(route: Route, compact: boolean, fullScreen: boolean, nav: Panel, width: number) {
  if (route.view === "settings" && !compact) return true
  // Untouched, a task or an artifact expands the list only where it does not take the right sidebar's slot; below
  // that the task rail keeps its place until the person expands it. Home and Artifacts expand from 900 px.
  const from = DETAIL_VIEWS.has(route.view) ? SLOT_MIN : NAV_MIN
  return !fullScreen && (nav === "open" || (nav === "auto" && width >= from))
}

/** The pages of one task or artifact, as opposed to Home, Artifacts and Settings. */
const DETAIL_VIEWS: ReadonlySet<string> = new Set(["task", "artifact"])

/** The collapsed task list's width (App Model task-rail.html). */
const TASK_RAIL = 52

/** Whether the task rail stands in for the collapsed list: a desktop window, not Settings, not full screen. */
function railShown(route: Route, compact: boolean, fullScreen: boolean, navOpen: boolean) {
  if (compact || navOpen) return false
  return !fullScreen && route.view !== "settings"
}

/** What the handle between the left column and the page is called. */
const navResizeLabel = (route: Route) =>
  route.view === "settings" ? "Resize the sidebar" : "Resize the task list"
const NEEDS: Need[] = ["", "you", "running", "shipped"]

function artifactRunFor(runs: readonly RunWindow[], address: ArtifactFeedbackAddress | null) {
  if (!address) return null
  const active = (run: RunWindow) => ["starting", "running", "stopping"].includes(run.status)
  return (
    [...runs]
      .filter((run) => {
        const purpose = run.purpose
        return (
          !run.pendingFresh &&
          purpose?.kind === "artifact" &&
          purpose.scope === address.scope &&
          purpose.id === address.id &&
          purpose.file === address.file
        )
      })
      .sort(
        (a, b) =>
          Number(active(b)) - Number(active(a)) ||
          (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0) ||
          b.generation - a.generation ||
          b.id.localeCompare(a.id),
      )[0] ?? null
  )
}

function ArtifactAgentBinding({
  address,
  title,
  onAddress,
}: {
  address: ArtifactFeedbackAddress
  title: string
  onAddress: (address: ArtifactFeedbackAddress, title: string) => void
}) {
  const { scope, id, file } = address
  useLayoutEffect(() => {
    onAddress({ scope, id, file }, title)
  }, [scope, id, file, title, onAddress])
  return null
}

/** What the whole shell reads: each project's look, and how many tasks wait on the person. */
function ShellContexts({
  looks,
  needsYou,
  machines,
  machinePage,
  theme,
  onTheme,
  children,
}: {
  /** How this page reads its server's machines; null where the API has none. */
  machines: ReadMachines | null
  /** This page's theme as it shows, for the machines' pages; and how one of them switches it. */
  theme: Theme
  onTheme: (theme: Theme) => void
  /** Where a machine's page is served; the demo hands its own. */
  machinePage: MachinePage | undefined
  looks: ContextType<typeof ProjectLooksContext>
  needsYou: number
  children: ReactNode
}) {
  return (
    <ProjectLooksContext.Provider value={looks}>
      <NeedsYouCountProvider count={needsYou}>
        {children}
        <MachineLayer
          needsYou={needsYou}
          read={machines}
          page={machinePage}
          theme={theme}
          onTheme={onTheme}
        />
      </NeedsYouCountProvider>
    </ProjectLooksContext.Provider>
  )
}

export function App({
  runAdapter,
  ...props
}: Parameters<typeof AppPage>[0] & { runAdapter?: RunAdapter }) {
  useNativeDownloads()
  const [outsideInterest, setOutsideInterest] = useState<OutsideConversationInterest | null>(null)
  const registerOutside = useCallback((interest: OutsideConversationInterest) => {
    setOutsideInterest(interest)
    return () => setOutsideInterest((current) => (current === interest ? null : current))
  }, [])
  const outsideStream = useMemo(
    () => ({ interest: outsideInterest, register: registerOutside }),
    [outsideInterest, registerOutside],
  )
  const adapter = runAdapter ?? ((props.api ?? defaultApi) === defaultApi ? runsApi : undefined)
  const sourceApi = props.api ?? defaultApi
  const scope = taskDispositionScope(sourceApi, originalTaskApi(sourceApi) === defaultApi)
  const content = adapter ? (
    <RunProvider adapter={adapter} taskDispositions={scope.store}>
      <BuildHereContinuation />
      <TerminalLayoutProvider>
        <AppPage {...props} api={scope.api} />
      </TerminalLayoutProvider>
    </RunProvider>
  ) : (
    <TerminalLayoutProvider>
      <AppPage {...props} api={scope.api} />
    </TerminalLayoutProvider>
  )
  return (
    <OutsideConversationInterestContext value={outsideStream}>
      {content}
    </OutsideConversationInterestContext>
  )
}

function AppPage({
  api = defaultApi,
  look,
  events = true,
  setup = defaultSetupPageApi,
  onTour = (at) => window.location.assign(tourLocation(window.location, true, at)),
  artifactFeedbackApi: suppliedArtifactFeedbackApi,
}: {
  api?: Api
  /** How the sidebar's project looks are read and written: the server's, else an in-memory one (the demo brings its own). */
  look?: LookApi
  events?: boolean
  setup?: SetupPageApi
  /** The published example keeps its own local tour inside the demo pathname. */
  onTour?: (at: number) => void
  artifactFeedbackApi?: ArtifactFeedbackApi
}) {
  const dispositions = useTaskDispositions(taskDispositionScope(api).store)
  const productionApi = originalTaskApi(api) === defaultApi
  const runs = useOptionalRuns()
  const buildVersion = buildRunsVersion(runs?.runs ?? [])
  const terminalLayout = useTerminalLayout()
  const [route, go, restored] = useRoute()
  const outsideStream = useContext(OutsideConversationInterestContext)
  const outsideInterest =
    route.view === "task" && outsideStream?.interest?.task === route.id
      ? outsideStream.interest
      : null
  const streamed = useEventStream(
    "/stream",
    events,
    route.view === "task" ? route.id : null,
    outsideInterest,
  )
  // What each read depends on is in hooks.ts: `version` is the task files, `live` an agent's sign of
  // life, `slow` both at a calmer pace. Nothing here moves for an event that cannot change it.
  const version = streamed.files
  const live = streamed.live
  const slow = streamed.slow
  const bumpEvent = streamed.bump
  useEffect(() => {
    const again = () => {
      // The settings and the project list change outside the page too (the command line, a hand
      // edit); no file event says so, so coming back to the window is what reads them again.
      bumpEvent("home")
      bumpEvent("files")
    }
    window.addEventListener("focus", again)
    return () => window.removeEventListener("focus", again)
  }, [bumpEvent])
  const protectTerminalKeys = useCallback((root: HTMLDivElement | null) => {
    if (!root) return
    const key = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".q-run-terminal") &&
        !(event.ctrlKey && event.code === "Backquote")
      )
        event.stopPropagation()
    }
    root.addEventListener("keydown", key)
    return () => root.removeEventListener("keydown", key)
  }, [])
  // The filters ⌘K sets and panels opened or closed by hand stay as the viewer left them.
  const [project, setProject] = usePref<string>(PREF.project, "")
  const [agent, setAgent] = usePref<string>(PREF.agent, "")
  const [need, setNeed] = usePref<Need>(PREF.need, "", NEEDS)
  const filter = { need, agent, project }
  const setFilter = (patch: Partial<typeof filter>) => {
    if (patch.need !== undefined) setNeed(patch.need)
    if (patch.agent !== undefined) setAgent(patch.agent)
    if (patch.project !== undefined) setProject(patch.project)
  }
  // The feedback sheet: closed, or open with what it starts from (a kind, an error, the page).
  const [feedback, setFeedback] = useState<FeedbackStart | null>(null)
  const [nav, setNav] = usePref<Panel>(PREF.nav, "auto", PANELS)
  const [rail, setRail] = usePref<Panel>(PREF.rail, "auto", PANELS)
  const taskArtifactFile =
    route.view === "task" && route.doc !== null ? artifactFileOfView(route.doc) : null
  const artifactDetail = route.view === "artifact" || taskArtifactFile !== null
  const routeScope =
    route.view === "task"
      ? `task:${route.id}${taskArtifactFile ? `:artifact:${taskArtifactFile}` : ""}`
      : route.view === "artifact"
        ? `artifact:${route.project}:${route.file}`
        : route.view
  const previousScope = useRef<string | undefined>(undefined)
  useLayoutEffect(() => {
    if (previousScope.current === routeScope) return
    const previous = previousScope.current
    previousScope.current = routeScope
    // On a desktop window the task list stays as the person left it, expanded or collapsed to the task rail
    // (App Model task-rail.html, issue #231). Below 900 px it is the Menu sheet, which a task still closes.
    const sheet = typeof window !== "undefined" && window.innerWidth < NAV_MIN
    if (route.view === "task" || route.view === "artifact") {
      if (sheet) setNav("closed")
      setRail(route.view === "artifact" || taskArtifactFile !== null ? "closed" : "auto")
    } else {
      setRail("closed")
      if (sheet && [...DETAIL_VIEWS].some((view) => previous?.startsWith(`${view}:`)))
        setNav("auto")
    }
  }, [routeScope, route.view, setNav, setRail, taskArtifactFile])
  const [taskLaunchChoices, setTaskLaunchChoices] = useState<Record<string, AgentLaunchValue>>({})
  const rememberTaskLaunch = (id: string, choice: AgentLaunchValue) =>
    setTaskLaunchChoices((before) => {
      const entries = Object.entries({ ...before, [id]: choice }).slice(-128)
      return Object.fromEntries(entries)
    })
  const [artifactBinding, setArtifactBinding] = useState<{
    route: string
    address: ArtifactFeedbackAddress
    title: string
  } | null>(null)
  const bindArtifact = useCallback(
    (address: ArtifactFeedbackAddress, title: string) =>
      setArtifactBinding((before) =>
        before?.route === routeScope &&
        before.address.scope === address.scope &&
        before.address.id === address.id &&
        before.address.file === address.file &&
        before.title === title
          ? before
          : { route: routeScope, address, title },
      ),
    [routeScope],
  )
  const artifactAddress =
    artifactDetail && artifactBinding?.route === routeScope ? artifactBinding.address : null
  const standaloneArtifactAddress = route.view === "artifact" ? artifactAddress : null
  const artifactRun = artifactRunFor(runs?.runs ?? [], standaloneArtifactAddress)
  // The Agent tab shows the built-in agent; a plain terminal is the other thing it can show, one click away.
  const [workspaceModes, setWorkspaceModes] = useState<Record<string, AgentTabMode>>({})
  const workspaceKey =
    route.view === "task"
      ? `task:${route.id}`
      : standaloneArtifactAddress
        ? `artifact:${standaloneArtifactAddress.scope}:${standaloneArtifactAddress.id}:${standaloneArtifactAddress.file}`
        : routeScope
  const workspaceMode = workspaceModes[workspaceKey] ?? "agent"
  const shellRun = (runs?.runs ?? [])
    .filter((run) => {
      if (run.pendingFresh) return false
      const context = run.purpose.kind === "terminal" ? run.purpose.context : undefined
      return (
        context &&
        (standaloneArtifactAddress
          ? context.kind === "artifact" &&
            context.scope === standaloneArtifactAddress.scope &&
            context.id === standaloneArtifactAddress.id &&
            context.file === standaloneArtifactAddress.file
          : route.view === "task" && context.kind === "task" && context.task === route.id)
      )
    })
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0]
  // Going back to the agent keeps the shell running; the card and the menu then offer to return to it.
  const shellLive = !!shellRun && !["stopped", "failed"].includes(shellRun.status)
  const changeWorkspaceMode = (mode: AgentTabMode) => {
    setWorkspaceModes((before) =>
      Object.fromEntries(Object.entries({ ...before, [workspaceKey]: mode }).slice(-128)),
    )
    terminalLayout?.setPanel("terminal")
  }
  // Run it in my own agent: open for one task or artifact at a time.
  const [outsideKey, setOutsideKey] = useState<string | null>(null)
  const outside = outsideKey === workspaceKey
  const showOutside = (open: boolean) => setOutsideKey(open ? workspaceKey : null)
  const plainTerminal = { live: shellLive, open: () => changeWorkspaceMode("shell") }
  const closeShell = async () => {
    if (shellRun && runs)
      await runs
        .control(shellRun.id, { action: "stop", generation: shellRun.generation })
        .catch(() => runs.refresh())
    changeWorkspaceMode("agent")
  }
  // Continue in QualityLayer on a terminal task brings the Agent sidebar back to running here.
  const continueHere = useRef(changeWorkspaceMode)
  continueHere.current = changeWorkspaceMode
  useEffect(() => onContinueInQualityLayer(() => continueHere.current("agent")), [])
  const artifactFeedback =
    suppliedArtifactFeedbackApi ?? (productionApi ? realArtifactFeedbackApi : undefined)
  const width = useViewportWidth()
  const compact = width < NAV_MIN
  const navToggle = useRef<HTMLButtonElement | null>(null)
  const navSize = useStoredWidth("qualitylayer-nav-width", 232, 200, Number.POSITIVE_INFINITY)
  const railSize = useStoredWidth("qualitylayer-rail-width", 320, 280, Number.POSITIVE_INFINITY)
  const [resizing, setResizing] = useState(false)
  // Expanding an artifact hides chrome without changing the window or saved sidebar preferences.
  const [fullScreenAsked, setFullScreenAsked] = useState(false)
  const askFullScreen = useCallback((on: boolean) => {
    setFullScreenAsked(on)
  }, [])

  const tasks = useQuery(() => api.tasks(), [version, live, buildVersion, streamed.noticeVersion])
  const homeQuestions = useHomeQuestions(api, slow)
  // The Artifacts place and an artifact open read every project's artifacts; no other page does. They are
  // read when opened and again on the artifact events and the slow file events, never on a timer.
  const artifactsVersion = streamed.artifacts + slow
  const artifactsOverview = useArtifactsOverview(
    api,
    route.view === "artifacts" || route.view === "artifact",
    artifactsVersion,
    route.view === "artifacts",
  )
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, AnsweredQuestion>>({})
  const [visibleTask, setVisibleTask] = useState<TaskDetail | null>(null)
  const showVisibleTask = useCallback((next: TaskDetail) => {
    setVisibleTask((previous) =>
      previous?.id === next.id &&
      previous.openItems === next.openItems &&
      JSON.stringify(previous.needs) === JSON.stringify(next.needs)
        ? previous
        : next,
    )
  }, [])
  const previewAnswer = (id: string, answer: AnsweredQuestion | null) =>
    setQuestionAnswers((was) => {
      if (answer !== null) return { ...was, [id]: answer }
      const next = { ...was }
      delete next[id]
      return next
    })
  const projects = useQuery(() => api.projects(), [streamed.home])
  const config = useQuery(() => api.config(), [streamed.home])
  const textSize = useTextSize(
    config.data?.textSize,
    !config.loading && config.error === null,
    (patch) => persistSetting(patch),
  )
  // The person's order, colors, names and hidden projects: kept on the server, read with the projects
  // and again as files change (a paired browser changed them), written at once and rolled back on a
  // refusal.
  const lookApi = useMemo(
    () => look ?? (originalTaskApi(api) === defaultApi ? realLookApi : createMemoryLookApi()),
    [look, api],
  )
  const looksQuery = useQuery(() => lookApi.looks(), [lookApi, streamed.home, slow])
  const [looks, setLooks] = useState<ProjectLooks>(NO_LOOKS)
  const looksNow = useRef(looks)
  looksNow.current = looks
  useEffect(() => {
    if (looksQuery.data !== null) setLooks(looksQuery.data)
  }, [looksQuery.data])
  const writeLooks = useCallback(async (next: ProjectLooks, save: () => Promise<ProjectLooks>) => {
    const was = looksNow.current
    setLooks(next)
    try {
      setLooks(await save())
    } catch (cause) {
      setLooks(was)
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])
  const changeLook = useCallback(
    (id: string, patch: LookPatch) =>
      writeLooks(applyLook(looksNow.current, id, patch), () => lookApi.setLook(id, patch)),
    [lookApi, writeLooks],
  )
  const changeOrder = useCallback(
    (ids: string[]) => writeLooks(applyOrder(looksNow.current, ids), () => lookApi.setOrder(ids)),
    [lookApi, writeLooks],
  )
  const revealProject = useCallback(
    async (id: string) => {
      try {
        await lookApi.revealProject?.(id)
        toast.success("Showed the folder")
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause))
      }
    },
    [lookApi],
  )
  // A task of a project the list does not have yet (the command line made it): read the list again.
  // The ids are the dependency, so a task of a project that is gone does not read it on every event.
  const known = new Set((projects.data ?? []).map((p) => p.id))
  const missing =
    projects.data === null
      ? ""
      : [...new Set((tasks.data ?? []).map((t) => t.project).filter((id) => !known.has(id)))]
          .sort()
          .join("|")
  const reloadProjects = projects.reload
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a changed set of missing projects asks again
  useEffect(() => {
    if (missing !== "") reloadProjects()
  }, [missing])
  const notificationVersion = slow + streamed.noticeVersion
  const shellNotifications = useQuery(
    async () => ({
      version: notificationVersion,
      notifications: productionApi
        ? (await interactionApi.shell<{ notifications: ShellNotification[] }>("notifications"))
            .notifications
        : undefined,
    }),
    [api, notificationVersion],
  )
  const liveShellNotifications = productionApi
    ? shellNotifications.data?.version === notificationVersion
      ? (shellNotifications.data.notifications ?? [])
      : null
    : undefined
  const openId = route.view === "task" ? route.id : null
  const [agentSwitch, setAgentSwitch] = useState<{ task: string; previous: RunWindow }>()
  useEffect(
    () => setAgentSwitch((before) => (before?.task === openId ? before : undefined)),
    [openId],
  )
  const [planControls, setPlanControls] = useState<{
    task: string | null
    controls: TaskAgentControls | undefined
  }>()
  const bindPlanControls = useCallback(
    (controls: TaskAgentControls | undefined) => setPlanControls({ task: openId, controls }),
    [openId],
  )
  const liveRead = useNow(openId !== null, 30_000)
  const fetched = useQuery(
    (signal) => (openId !== null ? api.task(openId, signal) : Promise.resolve(null)),
    [openId, streamed.taskFiles, streamed.taskLive, liveRead, buildVersion],
    events && typeof WebSocket !== "undefined" && version === 0 && !streamed.disconnected,
  )
  // A task opened before shows at once while it is read again, and never another task's detail.
  const seenTasks = useRef(new BoundedCache<TaskDetail>(8, 8 * 1024 * 1024))
  if (fetched.data != null) seenTasks.current.set(fetched.data.id, fetched.data)
  const readTask = useMemo(
    () =>
      fetched.data?.id === openId
        ? questionPreview(fetched.data, questionAnswers[openId ?? ""])
        : openId !== null
          ? (seenTasks.current.get(openId) ?? null)
          : null,
    [fetched.data, openId, questionAnswers],
  )
  const shown = useMemo(
    () => (readTask === null ? null : (dispositionTasks([readTask], dispositions)[0] ?? null)),
    [readTask, dispositions],
  )
  const open = {
    ...fetched,
    data: shown,
  }
  // One list per read: a new array on every render made the turn projection, the notification
  // hooks and every list below recompute for a page that had not changed.
  const previewed = useMemo(() => {
    const catalog = tasks.data ?? []
    const current = shown?.id === openId ? shown : null
    const known =
      current && !catalog.some((task) => task.id === current.id) ? [...catalog, current] : catalog
    return known.map((t) => {
      const current = questionPreview(t, questionAnswers[t.id])
      return visibleTask?.id === t.id && openId === t.id
        ? { ...current, openItems: visibleTask.openItems, needs: visibleTask.needs }
        : current
    })
  }, [tasks.data, questionAnswers, visibleTask, openId, shown])
  const disposedTasks = useMemo(
    () => dispositionTasks(previewed, dispositions),
    [previewed, dispositions],
  )
  const allTasks = useTurnTasks(disposedTasks)
  const currentTurn = useTurnDetail(open.data)
  // The Plan was approved while its task is open: the App goes to Implement, where the start is.
  const reloadTask = useCallback(() => {
    open.reload()
    tasks.reload()
  }, [open.reload, tasks.reload])
  const archiveSequence = useRef(0)
  const [chatArchive, setChatArchive] = useState<{ task: string; request: number } | null>(null)
  useEffect(() => {
    setChatArchive((current) =>
      route.view === "task" && route.id === current?.task ? current : null,
    )
  }, [route])
  const consumeChatArchive = useCallback((request: number) => {
    setChatArchive((current) => (current?.request === request ? null : current))
  }, [])
  // Right-clicks: a task row's own menu, and the App's fallback in place of the browser's.
  const taskMenu = useTaskPointMenu({
    api,
    rename: lookApi.renameTask,
    route,
    go,
    reload: reloadTask,
    onChatArchive: (task) => {
      setChatArchive({ task: task.id, request: ++archiveSequence.current })
      go({ view: "task", id: task.id, doc: null })
    },
  })
  const pointMenu = useAppPointMenu()
  const lastAction = useRef<{ id: string; action: string | null } | null>(null)
  useEffect(() => {
    const task = open.data
    if (task === null || route.view !== "task") return
    const was = lastAction.current
    lastAction.current = { id: task.id, action: task.action }
    if (
      was?.id === task.id &&
      was.action !== "implement" &&
      task.action === "implement" &&
      route.doc !== "implement"
    ) {
      go({ view: "task", id: task.id, doc: "implement" })
    }
  }, [open.data, route, go])
  // The name on the licence (and so the avatar's initials) follows a name saved in Settings.
  const licence = useQuery<Licence | null>(
    () => api.licence().catch(() => null),
    [route.view, config.data?.profile.name],
  )
  // New task: open or closed, what was typed (kept while it is closed), and the + it hangs under.
  const [newTask, setNewTask] = useState(false)
  const [newTaskAfterNav, setNewTaskAfterNav] = useState(false)
  const [newTaskDraft, setNewTaskDraft] = useState("")
  const [newTaskLaunchDraft, setNewTaskLaunchDraft] = useState<
    import("./new-task-state.ts").NewTaskDraft | null
  >(null)
  const [newTaskAgent, setNewTaskAgent] = useState<DefaultsAgent | null>(null)
  // The + menu's pick that opened the card; every other opening leaves the card's own kind.
  const [newTaskKind, setNewTaskKind] = useState<NewKind | undefined>(undefined)
  const [newTaskTarget, setNewTaskTarget] = useState<ProjectTarget | null>(null)
  const newTaskAnchor = useRef<HTMLElement | null>(null)
  // The project a "+" on its header asked for; "" is the plain +.
  const [newTaskProject, setNewTaskProject] = useState("")
  const closeNewTask = useCallback(() => {
    setNewTask(false)
    setNewTaskProject("")
    newTaskAnchor.current?.focus()
  }, [])
  const closeNavForNewTask = () => {
    if (!compact || nav !== "open") return
    // Mount the card after the drawer releases its focus trap and return-focus callback.
    setNewTaskAfterNav(true)
    setNav("closed")
  }
  const openNewTask = (button: HTMLElement, kind: NewKind = "task") => {
    setNewTaskKind(kind)
    setNewTaskAgent(null)
    newTaskAnchor.current = button
    closeNavForNewTask()
    setNewTaskProject("")
    // A modal dialog: the + is out of reach while it is open (only the tour presses it again), so a
    // press opens it and never closes it.
    setNewTask(true)
  }
  const openNewTaskIn = (projectId: string, header: HTMLElement | null) => {
    setNewTaskKind(undefined)
    setNewTaskAgent(null)
    newTaskAnchor.current = header
    closeNavForNewTask()
    setAdding(null)
    setNewTaskProject(projectId)
    setNewTask(true)
  }
  // New task on an artifact: the project chosen and the request started as "Change <artifact>: ".
  const openNewTaskOn = (projectId: string, request: string, button: HTMLElement) => {
    setNewTaskKind(undefined)
    setNewTaskAgent(null)
    newTaskAnchor.current = button
    closeNavForNewTask()
    setAdding(null)
    setNewTaskDraft(request)
    setNewTaskLaunchDraft(null)
    setNewTaskProject(projectId)
    setNewTask(true)
  }
  useFollowUp(openNewTaskOn)
  const loadTaskFiles = useCallback((id: string) => taskFileEntries(api, id), [api])
  const commandApp = useCommandApp({
    route,
    tasks: allTasks,
    go,
    // From ⌘K or ⇧⌘N: the card hangs under the + button when the page has one.
    openNewTask: (projectId) =>
      openNewTaskIn(projectId, document.querySelector<HTMLElement>("[data-new-task-toggle]")),
    toggleTaskList: () => {
      if (!fullScreen && route.view !== "settings") setNav(navOpen ? "closed" : "open")
    },
    // Saved like the setting; the installed App's window takes the new zoom from config.json.
    textSize: (by) => {
      void textSize.step(by)
    },
  })
  // Add a project: the card under the list header's Add button.
  const [adding, setAdding] = useState<HTMLElement | null>(null)
  const openAddProject = (button: HTMLElement) => {
    if (compact) setNav("closed")
    setAdding((was) => (was === null ? button : null))
  }
  // The installed agents name the tabs of Settings' defaults, of New task and of the first-task page.
  const attentionItems = runAttention(
    {
      tasks: allTasks,
      project,
      agent,
      now: Date.now(),
    },
    runs?.runs ?? [],
  ).items
  const firstRun = route.view === "home" && tasks.data !== null && allTasks.length === 0
  const autoTourAttempted = useRef(false)
  useEffect(() => {
    if (route.view !== "home" || !tourNeedsCurrentRevision() || autoTourAttempted.current) return
    if (new URLSearchParams(window.location.search).has("tour")) return
    if (
      tasks.data === null ||
      config.data === null ||
      newTask ||
      newTaskAfterNav ||
      adding !== null
    )
      return
    if (
      runs?.loaded === false ||
      runs?.runs.some((run) => run.status === "running" || run.status === "starting")
    )
      return
    const observer = new MutationObserver(attempt)
    function attempt() {
      if (
        parseRoute(window.location.hash).view !== "home" ||
        new URLSearchParams(window.location.search).has("tour")
      )
        return
      if (!document.querySelector('[data-testid="home"], [data-testid="first-run"]')) return
      const focused = document.activeElement
      if (focused?.matches("input,textarea,select,[contenteditable=true]")) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      if (autoTourAttempted.current || !beginAutomaticTour()) return
      autoTourAttempted.current = true
      observer.disconnect()
      onTour(0)
    }
    observer.observe(document.body, { childList: true, subtree: true })
    document.addEventListener("focusout", attempt)
    attempt()
    return () => {
      observer.disconnect()
      document.removeEventListener("focusout", attempt)
    }
  }, [
    route.view,
    tasks.data,
    config.data,
    newTask,
    newTaskAfterNav,
    adding,
    runs?.runs,
    runs?.loaded,
    onTour,
  ])
  // Done in the tour came back to Home: the ending plays once from Start your first task.
  useTourEnding(route.view === "home" && tasks.data !== null)
  const wantsAgents =
    route.view === "settings" ||
    route.view === "task" ||
    route.view === "artifact" ||
    route.view === "artifacts" ||
    newTask ||
    firstRun
  const subagents = useQuery(
    () => (wantsAgents ? api.subagents() : Promise.resolve(null)),
    [wantsAgents],
  )
  // The choice lives in the config (it survives a restart); the browser keeps a
  // copy so the first paint before the config arrives is already right.
  // A machine's page inside this computer's App shows that App's theme, not the machine's setting.
  const hostTheme = useHostTheme()
  const choice = hostTheme ?? themeOf(config.data?.theme ?? stored(PREF.theme, "system"))
  const systemDark = useSystemDark()
  const theme: "light" | "dark" = choice === "system" ? (systemDark ? "dark" : "light") : choice
  useEffect(() => {
    const root = document.documentElement
    if (choice === "system") delete root.dataset.theme
    else root.dataset.theme = choice
    root.classList.toggle("dark", theme === "dark")
    if (hostTheme === null) store(PREF.theme, choice)
  }, [choice, theme, hostTheme])
  // Animations: the config's choice (else this browser's copy) against the system's Reduce motion,
  // put on the root as data-motion so the reduced-motion styles can be overridden by Full.
  useMotion(config.data?.animations ?? stored(PREF.animations, "system"))
  useUiFont(config.data?.uiFont ?? stored(PREF.font, "geist"))
  // One toggle: the system decides until the first click; from then on the last manual choice holds.
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark"
    // On a machine's page the toggle switches the theme of the App around it.
    if (hostTheme !== null) toParent({ ql: 1, type: "theme", theme: next })
    else void changeConfig({ theme: next })
  }

  // A reopened page whose task was deleted meanwhile falls back to Home.
  useEffect(() => {
    if (
      restored &&
      route.view === "task" &&
      open.error instanceof ApiError &&
      open.error.status === 404
    ) {
      go({ view: "home" })
    }
  }, [restored, route, open.error, go])

  const noticeSound = config.data?.notifications.sound ?? true
  useEffect(() => setNoticeSound(noticeSound), [noticeSound])
  useNotifications(tasks.data !== null ? allTasks : null, config.data)
  const usageClock = useLiveNotifications(
    tasks.data !== null ? allTasks : null,
    config.data,
    route.view === "task" ? currentTurn : null,
    route.view === "task" ? route.id : null,
    liveShellNotifications,
  )

  const onCopy = useCallback(async (text: ClipboardText, note: string) => {
    const done = await copy(text)
    if (done) toast.success(note)
    else toast.error("Copy failed: select the text instead")
    return done
  }, [])

  /** Saves a setting; resolves to why it was refused (also toasted), or null when it was kept. */
  const persistSetting = async (patch: unknown): Promise<string | null> => {
    try {
      await api.putConfig(patch)
      config.reload()
      return null
    } catch (cause) {
      const said = cause instanceof Error ? cause.message : "Could not save settings"
      toast.error(`${said}. Try saving again.`)
      return said
    }
  }
  const saveSetting = textSize.save
  const changeConfig = async (patch: unknown) => {
    await saveSetting(patch)
  }
  useFeedKnownModels(subagents.data, config.data, changeConfig)
  // An artifact open full screen hides both sidebars; leaving the artifact ends it.
  const artifactOpen =
    route.view === "artifact" ||
    (route.view === "task" && route.doc !== null && artifactFileOfView(route.doc) !== null)
  const artifactOwnsPhoneHeader = route.view === "artifact" && width <= 480
  const fullScreen = fullScreenAsked && artifactOpen
  useEffect(() => {
    if (fullScreenAsked && !artifactOpen) askFullScreen(false)
  }, [fullScreenAsked, artifactOpen, askFullScreen])
  const navOpen = navShown(route, compact, fullScreen, nav, width)
  const taskRail = railShown(route, compact, fullScreen, navOpen)
  // While the rail shows, the list's toggle lives in it: the page headers carry none.
  const listToggle = (!navOpen || compact) && !taskRail
  const quotaSettings = route.view === "settings" && route.tab === "usage"
  const conversationQuota = useVisibleQuotas()
  const quotaSidebar =
    navOpen && route.view !== "settings" && config.data !== null && selectsQuota(config.data.usage)
  const usageVisible = quotaSettings || quotaSidebar || conversationQuota.visible
  const claudeVisible =
    quotaSettings ||
    (quotaSidebar && config.data !== null && selectsQuota(config.data.usage, "claude-code")) ||
    conversationQuota.claude
  useVisibleUsageRefresh(usageClock, api === defaultApi && usageVisible, claudeVisible)
  // Before the first read of the tasks and projects lands, the lists wait as outlines: an empty list would say
  // "No projects yet" and "Nothing is waiting on you".
  const firstRead =
    (tasks.data === null && tasks.error === null) ||
    (projects.data === null && projects.error === null)
  // Reopening a page puts it back where it was scrolled, once it has rendered (a task after its load).
  useScrollMemory(
    routeHash(route),
    route.view === "task"
      ? open.data !== null
      : route.view === "settings"
        ? config.data !== null
        : route.view === "home"
          ? !firstRead
          : true,
  )
  // The right sidebar opens from its header toggle or a task file; otherwise the page keeps the room.
  const slotShared = !compact && width < SLOT_MIN
  const railOpen = (rail === "open" || (rail === "auto" && !compact)) && !(slotShared && navOpen)
  // Asking for the right sidebar on a small window closes the task list; closing the list brings it back.
  const railToggle = (next: boolean) => {
    setRail(next ? "open" : "closed")
    if (next && slotShared) setNav("closed")
  }
  // A remembered width never squeezes the page below reading width on a smaller window.
  const railRoom =
    railOpen && !compact && route.view === "task"
      ? Math.min(railSize.width, Math.max(0, width - navSize.min - MIDDLE_MIN))
      : 0
  const navMax = Math.max(navSize.min, width - railRoom - MIDDLE_MIN)
  const navWidth = Math.min(navSize.width, navMax)
  const railMax = Math.max(
    compact ? railSize.min : 0,
    width - (navOpen ? navWidth : taskRail ? TASK_RAIL : 0) - MIDDLE_MIN,
  )
  const railFit = {
    ...railSize,
    width: Math.min(railSize.width, railMax),
    min: Math.min(railSize.min, railMax),
    max: railMax,
    setWidth: (next: number) => railSize.setWidth(Math.min(next, railMax)),
  }

  // Feedback: from the sidebar, ⌘K or "Report this" on an error toast. The page is named as a kind
  // of page when the sheet opens, never by its task's title.
  const startFeedback = useCallback(
    (request: Partial<FeedbackStart> = {}) => {
      const page = pageNow(route, open.data)
      setFeedback({ kind: "bug", ...request, ...(page !== undefined ? { page } : {}) })
    },
    [route, open.data],
  )
  useEffect(() => {
    reportableErrors()
    return onFeedbackRequest((request) => startFeedback(request))
  }, [startFeedback])
  // Updates: the sidebar line, the sheet, and the toast after one.
  const updates = useUpdates({
    api,
    version: streamed.update,
    openAbout: () => go({ view: "settings", tab: "about" }),
  })
  // Settings take the task list's place; Back returns to the page the person came from.
  const settingsNav = useSettingsNav({
    route,
    go,
    config: config.data,
    licence: licence.data,
    updates,
    compact,
    closeNav: () => setNav("closed"),
  })

  // A file or a commit named in a task's Conversation opens the Reader or the Review workspace.
  const conversationActions = useMemo<ConversationActions>(
    () => ({
      ...taskConversationActions(go, route),
      awaitingYou: (task: string) => open.data?.id === task && waitsOnAnswer(open.data),
      earlier: (id: string) =>
        (open.data?.id === id ? open.data : tasks.data?.find((task) => task.id === id))?.earlier ===
        true,
      backgroundWork: (id: string) => {
        const task = open.data?.id === id ? open.data : tasks.data?.find((task) => task.id === id)
        return task ? taskBackgroundWork(task) : { count: 0, line: null }
      },
    }),
    [go, route, open.data, tasks.data],
  )

  const blocked = [tasks.error, projects.error].find(
    (e) => e instanceof ApiError && (e.status === 401 || e.status === 402),
  )
  // A browser the server does not know has no key to show: it is paired, not given one in a link.
  if (blocked instanceof ApiError && blocked.status === 401) return <NoKey />
  // The licence is one of setup's own steps, so setup shows before the licence screen does.
  if (route.view === "setup")
    return (
      <Setup
        api={setup}
        onDone={() => go({ view: "home" })}
        onStartTask={(target, agent) => {
          openNewTaskIn(target.project.id, null)
          setNewTaskTarget(target)
          setNewTaskAgent(agent)
          go({ view: "home" })
          projects.reload()
        }}
      />
    )
  if (blocked instanceof ApiError) {
    return (
      <TrialEnded
        message={blocked.message}
        buyUrl={blocked.url}
        unchecked={blocked.code === "licence_unchecked"}
        onKey={async (key) => {
          await setup.licence(key)
          licence.reload()
          tasks.reload()
          projects.reload()
        }}
        onRetry={() => {
          licence.reload()
          tasks.reload()
          projects.reload()
        }}
      />
    )
  }

  const allProjects = projects.data ?? []
  const opening = route.view === "task" ? allTasks.find((task) => task.id === route.id) : undefined
  // The server cannot be reached: one red line, and the page asks again every few seconds.
  const serverDown = streamed.disconnected || unreachable(tasks.error) || unreachable(open.error)
  const retry = () => {
    tasks.reload()
    projects.reload()
    open.reload()
  }

  // An artifact open hides the top bar: its own bar brings the task list back.
  const artifactMenu = !navOpen && !taskRail ? { compact, onOpen: () => setNav("open") } : null

  const sidebar = settingsNav ?? (
    <Sidebar
      interaction={nativeShell(api)}
      onTaskMenu={taskMenu.onTaskMenu}
      looks={looks}
      onLook={changeLook}
      onOrder={changeOrder}
      onReveal={lookApi.revealProject ? revealProject : undefined}
      onNewTaskIn={openNewTaskIn}
      onAddProject={openAddProject}
      tasks={allTasks}
      homeQuestions={homeQuestions.data ?? []}
      reading={firstRead}
      projects={allProjects}
      filter={filter}
      onFilter={setFilter}
      route={route}
      go={(next) => {
        go(next)
        if (compact) setNav("closed")
      }}
      theme={theme}
      onToggleTheme={toggleTheme}
      onOpenSearch={() => {
        if (compact) setNav("closed")
        commandApp.open()
      }}
      licence={licence.data}
      onHide={() => setNav("closed")}
      rail={taskRail ? { onExpand: () => setNav("open") } : undefined}
      onFeedback={() => {
        if (compact) setNav("closed")
        startFeedback()
      }}
      onNewTask={openNewTask}
      newTaskOpen={newTask}
      feedbackOpen={feedback !== null}
      update={updates.line}
    />
  )

  const draftTarget =
    route.view === "task" && open.data?.id === route.id
      ? taskContextTarget(window.location.href, open.data)
      : route.view === "artifact" && artifactAddress?.scope === "project"
        ? artifactContextTarget(window.location.href, artifactAddress.id, artifactAddress.file)
        : undefined
  return (
    <UsageDisplayProvider value={config.data?.usage}>
      <TooltipProvider>
        <ShellContexts
          looks={looks}
          needsYou={attentionItems.length}
          machines={api.machines ?? null}
          machinePage={api.machinePage}
          theme={theme}
          onTheme={(next) => void changeConfig({ theme: next })}
        >
          <div
            ref={protectTerminalKeys}
            className={cn(
              "grid h-full overflow-hidden bg-background",
              !resizing && "transition-[grid-template-columns] duration-200 ease-ql",
            )}
            style={{
              gridTemplateColumns:
                navOpen && !compact
                  ? `${navWidth}px minmax(0,1fr)`
                  : `${taskRail ? TASK_RAIL : 0}px minmax(0,1fr)`,
            }}
            data-testid="shell"
            data-nav={navOpen ? "open" : "closed"}
          >
            <div
              className={
                (navOpen && !compact) || taskRail
                  ? "relative flex min-h-0 min-w-0 [&>aside]:flex-1"
                  : "invisible flex min-h-0 min-w-0 overflow-hidden"
              }
            >
              {(navOpen || taskRail) && !compact ? (
                <Resizer
                  side="right"
                  label={navResizeLabel(route)}
                  width={navOpen ? navWidth : TASK_RAIL}
                  collapsed={!navOpen}
                  expandedWidth={navWidth}
                  min={navSize.min}
                  max={navMax}
                  onResize={(next) => navSize.setWidth(Math.min(next, navMax))}
                  onReset={navSize.reset}
                  onDragging={setResizing}
                  onCollapse={route.view === "settings" ? undefined : () => setNav("closed")}
                  onExpand={route.view === "settings" ? undefined : () => setNav("open")}
                />
              ) : null}
              {taskRail || !compact ? sidebar : null}
            </div>
            <div
              className="q-terminal-workspace flex min-h-0 min-w-0 flex-col overflow-hidden"
              ref={terminalLayout?.workspace}
              data-terminal-right={
                terminalLayout?.rightActive && terminalLayout.sidebarRect ? "true" : undefined
              }
              data-terminal-shared={terminalLayout?.sidebarRect ? "true" : undefined}
            >
              {serverDown ? <ServerDown retry={retry} /> : null}
              {runs?.support?.appQuitFailure ? (
                <div role="alert" className="q-run-error px-4 py-3 border-b border-line">
                  <b>Some agents could not be stopped when the App quit.</b>
                  <ul>
                    {runs.support.appQuitFailure.failures.map((failure) => (
                      <li key={failure.run}>{failure.message}</li>
                    ))}
                  </ul>
                  <span>Open the agent's window to check it.</span>
                </div>
              ) : null}
              {/* An update that has waited: a bar above every page but Settings, which has its own. */}
              {route.view === "settings" ? null : updates.bar}
              {/* An artifact open has its own thin bar, which brings the task list back itself. */}
              {listToggle &&
              (!artifactOpen || width <= 820) &&
              !artifactOwnsPhoneHeader &&
              (route.view !== "task" ||
                width <= 820 ||
                (open.data === null && opening === undefined)) ? (
                <div
                  className="flex h-12 flex-none items-center gap-2.5 border-b border-line bg-sidebar px-3 text-sm"
                  data-testid="top-bar"
                  data-interaction-task={
                    productionApi && route.view === "task" ? "true" : undefined
                  }
                >
                  <TaskListToggle
                    look="ghost"
                    compact={compact}
                    ref={navToggle}
                    onOpen={() => setNav("open")}
                  />
                  <Logo className="size-[18px]" />
                  <b className="min-w-0 truncate">
                    {route.view === "task" && open.data !== null ? open.data.title : "QualityLayer"}
                  </b>
                  <span className="flex-1" />
                  <NewMenu cardOpen={newTask} onPick={openNewTask} />
                  {/* A task in a narrow window puts its Archive, Delete and sidebar toggle here. */}
                  <span id={TOP_BAR_TOOLS} className="contents" />
                </div>
              ) : null}
              {firstRun ? (
                <FirstRun
                  draft={newTaskDraft || undefined}
                  name={config.data?.profile.name ?? ""}
                  onStart={(request, agent, button) => {
                    clearCodexHooksPending()
                    openNewTaskOn("", request, button)
                    setNewTaskAgent(agent)
                  }}
                  onSetup={() => go({ view: "setup" })}
                  installed={subagents.data}
                  paused={pausedTour()}
                  hooksPending={codexHooksPending()}
                  onTour={onTour}
                  place={config.data ?? undefined}
                  onPlace={(patch) => void persistSetting(patch)}
                />
              ) : route.view === "artifacts" ? (
                <ArtifactsPage
                  api={api}
                  config={config.data ?? undefined}
                  installed={subagents.data}
                  contextApi={artifactFeedback}
                  overview={artifactsOverview}
                  projects={allProjects}
                  tasks={allTasks}
                  looks={looks}
                  go={go}
                />
              ) : route.view === "artifact" ? (
                <RestoredRouteContext.Provider value={restored}>
                  <ArtifactRoute
                    api={api}
                    route={route}
                    overview={artifactsOverview}
                    projects={allProjects}
                    tasks={allTasks}
                    looks={looks}
                    version={artifactsVersion}
                    go={go}
                    width={width}
                    compact={width <= 820}
                    railSize={railFit}
                    resizing={resizing}
                    onResizing={setResizing}
                    fullScreen={fullScreen}
                    onFullScreen={askFullScreen}
                    menu={artifactMenu}
                    artifactAgentName={
                      isNativeAgent(artifactRun?.agent)
                        ? AGENT_NAMES[artifactRun.agent]
                        : "The agent"
                    }
                    artifactAgentId={
                      artifactRun?.agent ??
                      (preferredLaunchAgent(subagents.data) === "other"
                        ? null
                        : preferredLaunchAgent(subagents.data))
                    }
                    artifactAgentRunning={
                      artifactRun !== null &&
                      ["starting", "running", "stopping"].includes(artifactRun.status)
                    }
                    artifactAgent={({ address, title }) => (
                      <ArtifactAgentBinding
                        key={`${address.scope}:${address.id}:${address.file}`}
                        address={address}
                        title={title}
                        onAddress={bindArtifact}
                      />
                    )}
                  />
                </RestoredRouteContext.Provider>
              ) : route.view === "home" && firstRead ? (
                <HomeLoading />
              ) : route.view === "home" ? (
                <Home
                  api={api}
                  tasks={allTasks}
                  homeQuestions={homeQuestions.data ?? []}
                  onReloadQuestions={homeQuestions.reload}
                  project={project}
                  agent={agent}
                  need={need}
                  onNeed={setNeed}
                  go={go}
                  onNewTask={(button) => openNewTask(button)}
                  unfinished={
                    !newTask && newTaskDraft.trim()
                      ? { request: newTaskDraft, project: newTaskTarget?.project.name }
                      : null
                  }
                  onContinueUnfinished={(button) => openNewTask(button)}
                  onDiscardUnfinished={() => {
                    setNewTaskDraft("")
                    setNewTaskLaunchDraft(null)
                  }}
                  onCopy={onCopy}
                  reload={tasks.reload}
                />
              ) : null}
              {route.view === "settings" && config.data !== null ? (
                <Settings
                  config={config.data}
                  licence={licence.data}
                  tab={route.tab}
                  initialModelsAgent={route.modelAgent}
                  initialMemoryLesson={route.memoryLesson}
                  initialMemoryProject={
                    route.memoryProject
                      ? {
                          id: route.memoryProject,
                          name:
                            allProjects.find((item) => item.id === route.memoryProject)?.name ??
                            route.memoryProject,
                        }
                      : undefined
                  }
                  onChange={saveSetting}
                  subagents={subagents.data}
                  onLicenceKey={async (key) => {
                    await setup.licence(key)
                    licence.reload()
                  }}
                  api={api}
                  updates={updates}
                  onCopy={onCopy}
                />
              ) : null}
              {route.view === "task" ? (
                open.data !== null && open.data.id === route.id ? (
                  <StartContext.Provider
                    value={{
                      task: open.data,
                      config: config.data,
                      installed: subagents.data
                        ?.filter((entry) => entry.runnable)
                        .map((entry) => entry.agent),
                      launchAgents: subagents.data ?? undefined,
                      runSupport: runs?.support,
                      saveConfig: changeConfig,
                      openSettings: (agent) =>
                        go({
                          view: "settings",
                          tab: "models",
                          ...(agent ? { modelAgent: agent } : {}),
                        }),
                      recordStart: async (id, choice) => {
                        await api.start(id, choice)
                      },
                    }}
                  >
                    <TaskView
                      contextTarget={draftTarget}
                      task={open.data}
                      plainTerminal={plainTerminal}
                      plainTerminalShown={workspaceMode === "shell"}
                      archiveRequest={
                        chatArchive?.task === open.data.id ? chatArchive.request : undefined
                      }
                      onArchiveRequested={consumeChatArchive}
                      planControls={
                        planControls?.task === route.id ? planControls.controls : undefined
                      }
                      doc={route.doc}
                      at={route.at}
                      version={streamed.taskFiles}
                      activity={streamed.taskSlow}
                      artifacts={streamed.artifacts}
                      theme={theme}
                      api={api}
                      go={go}
                      reload={reloadTask}
                      onQuestionAnswer={previewAnswer}
                      onVisibleTask={showVisibleTask}
                      onCopy={onCopy}
                      onBuildLaunch={(selection: BuildLaunchSelection) =>
                        rememberTaskLaunch(route.id, {
                          agent: selection.agent,
                          model: selection.model,
                          effort: selection.effort,
                          runWhere: selection.runWhere,
                        })
                      }
                      onArtifactContext={bindArtifact}
                      railOpen={railOpen}
                      onRail={railToggle}
                      railSize={railFit}
                      resizing={resizing}
                      onResizing={setResizing}
                      fullScreen={fullScreen}
                      onFullScreen={askFullScreen}
                      menu={artifactMenu}
                    />
                  </StartContext.Provider>
                ) : (
                  <TaskLoading
                    title={opening?.title}
                    project={
                      opening
                        ? projectFacts({ id: opening.project, name: opening.projectName }, looks)
                        : undefined
                    }
                    view={route.doc}
                    menu={
                      opening && listToggle && !compact ? { onOpen: () => setNav("open") } : null
                    }
                    error={open.error}
                    onRetry={open.reload}
                    onHome={() => go({ view: "home" })}
                    onSearch={() => commandApp.open()}
                    railWidth={
                      railOpen && !compact ? (terminalLayout?.width ?? railSize.width) : undefined
                    }
                  />
                )
              ) : null}
              <ConversationActionsContext.Provider value={conversationActions}>
                {route.view === "task" &&
                open.data?.id === route.id &&
                open.data.type === "chat" &&
                workspaceMode !== "shell" ? null : (
                  <RunDock
                    continueAgent={
                      route.view === "task" &&
                      open.data?.id === route.id &&
                      workspaceMode === "agent" &&
                      runs?.support?.supported &&
                      runs.support.canStart
                        ? {
                            available: canSwitchTaskAgent.bind(null, open.data),
                            open: (run) => setAgentSwitch({ task: route.id, previous: run }),
                          }
                        : undefined
                    }
                    contextTarget={draftTarget}
                    keepSessionControls
                    onTaskControls={
                      route.view === "task" && workspaceMode !== "shell"
                        ? bindPlanControls
                        : undefined
                    }
                    agentView={defaultAgentView(config.data ?? undefined)}
                    onOpenTaskFile={(task, name) => go({ view: "task", id: task, doc: name })}
                    taskAgent={route.view === "task" || route.view === "artifact"}
                    followOutside={
                      route.view === "task" &&
                      open.data?.id === route.id &&
                      open.data.outside !== undefined
                    }
                    agentRunId={
                      workspaceMode === "shell"
                        ? (shellRun?.id ?? null)
                        : route.view === "artifact"
                          ? (artifactRun?.id ?? null)
                          : undefined
                    }
                    agentHeader={
                      workspaceMode === "shell" && (route.view === "task" || artifactDetail) ? (
                        <ShellBar
                          folder={shellRun?.cwd || undefined}
                          onBack={() => changeWorkspaceMode("agent")}
                        />
                      ) : undefined
                    }
                    agentMenu={
                      route.view === "task" || artifactDetail
                        ? (live) => (
                            <AgentTabMenu
                              approvalReady={
                                route.view === "task" &&
                                open.data &&
                                (open.data.outside !== undefined ||
                                  open.data.answers === "terminal")
                                  ? taskApprovalReady(open.data) !== null
                                  : false
                              }
                              mode={workspaceMode}
                              live={live}
                              shellLive={shellLive}
                              canClose={shellRun?.viewer?.canStop !== false}
                              onShell={plainTerminal.open}
                              onBack={() => changeWorkspaceMode("agent")}
                              onClose={() => void closeShell()}
                              {...(route.view === "task" && open.data?.outside
                                ? {
                                    onContinueHere: () => continueOutsideLead(route.id),
                                    askedOutside: outsideAsks(open.data),
                                  }
                                : {})}
                              {...((artifactDetail && artifactAddress && artifactBinding) ||
                              (route.view === "task" && open.data?.id === route.id)
                                ? { onOutside: () => showOutside(true) }
                                : {})}
                            />
                          )
                        : undefined
                    }
                    agentScopeKey={
                      standaloneArtifactAddress
                        ? `artifact:${standaloneArtifactAddress.scope}:${standaloneArtifactAddress.id}:${standaloneArtifactAddress.file}`
                        : route.view === "task"
                          ? `task:${route.id}`
                          : routeScope
                    }
                    agentEmpty={
                      workspaceMode === "shell" && (route.view === "task" || artifactDetail) ? (
                        <OpenTerminal
                          key={workspaceKey}
                          autoStart={!shellRun}
                          context={async () => {
                            if (standaloneArtifactAddress)
                              return {
                                kind: "artifact",
                                ...standaloneArtifactAddress,
                                revision: (
                                  await (artifactFeedback ?? realArtifactFeedbackApi).context(
                                    standaloneArtifactAddress,
                                  )
                                ).revision,
                              }
                            if (route.view === "task") return { kind: "task", task: route.id }
                            throw new Error("Open a task or artifact first.")
                          }}
                          onStarted={() => terminalLayout?.setPanel("terminal")}
                        />
                      ) : route.view === "artifact" ? (
                        artifactAddress && artifactBinding ? (
                          <ArtifactAgentLaunch
                            contextTarget={draftTarget}
                            key={`${artifactAddress.scope}:${artifactAddress.id}:${artifactAddress.file}`}
                            address={artifactAddress}
                            title={artifactBinding.title}
                            installed={subagents.data}
                            config={config.data}
                            outside={outside}
                            onOutside={showOutside}
                            terminal={plainTerminal}
                            contextApi={artifactFeedback}
                            onStarted={() => terminalLayout?.setPanel("terminal")}
                          />
                        ) : undefined
                      ) : route.view === "task" && open.data?.id === route.id ? (
                        // While the lead runs outside the App the tab follows it; its launch card waits behind Continue it here.
                        taskAgentEmpty(
                          open.data,
                          <TaskAgentLaunch
                            contextTarget={draftTarget}
                            key={route.id}
                            task={open.data}
                            config={config.data}
                            outside={outside}
                            onOutside={showOutside}
                            terminal={plainTerminal}
                            installed={subagents.data}
                            value={taskLaunchChoices[taskLaunchKey(open.data)]}
                            onChange={(choice) => {
                              const current = open.data
                              if (current?.id === route.id)
                                rememberTaskLaunch(taskLaunchKey(current), choice)
                            }}
                            onCopy={onCopy}
                            onStarted={() => terminalLayout?.setPanel("terminal")}
                            onBuildOptions={() => {
                              const current = open.data
                              if (!current) return
                              // The task's page opens the choice of how to build (its dialog).
                              window.dispatchEvent(
                                new CustomEvent("qualitylayer:build-options", {
                                  detail: current.id,
                                }),
                              )
                            }}
                          />,
                          plainTerminal,
                        )
                      ) : undefined
                    }
                    taskTitles={Object.fromEntries(allTasks.map((task) => [task.id, task.title]))}
                    currentTask={route.view === "task" ? route.id : undefined}
                  />
                )}
              </ConversationActionsContext.Provider>
              {agentSwitch &&
              route.view === "task" &&
              open.data?.id === agentSwitch.task &&
              route.id === agentSwitch.task &&
              runs?.runs.some((run) => run.id === agentSwitch.previous.id) &&
              canSwitchTaskAgent(open.data, agentSwitch.previous) ? (
                <AgentSwitchDialog
                  key={`${agentSwitch.task}:${agentSwitch.previous.id}:${agentSwitch.previous.generation}`}
                  task={open.data}
                  previous={agentSwitch.previous}
                  config={config.data}
                  installed={subagents.data}
                  onClose={() => setAgentSwitch(undefined)}
                  onStarted={() => terminalLayout?.setPanel("terminal")}
                />
              ) : null}
            </div>
          </div>
          {compact ? (
            <Dialog open={navOpen} onOpenChange={(next) => setNav(next ? "open" : "closed")}>
              <DialogContent
                className="top-0 left-0 flex h-full w-[min(88vw,320px)] max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-w-none [&>aside]:flex-1"
                showCloseButton={false}
                finalFocus={() => {
                  if (newTaskAfterNav) {
                    setNewTaskAfterNav(false)
                    return false
                  }
                  return navToggle.current
                }}
              >
                <DialogTitle className="sr-only">Tasks</DialogTitle>
                <DialogDescription className="sr-only">
                  Choose a task, filter the workspace, or change your appearance.
                </DialogDescription>
                {sidebar}
              </DialogContent>
            </Dialog>
          ) : null}
          <CommandBox
            {...commandApp.box}
            tasks={allTasks}
            projects={allProjects}
            onSearch={(q) => api.find(q)}
            go={go}
            filter={filter}
            onFilter={setFilter}
            onFeedback={() => startFeedback()}
            theme={theme}
            onToggleTheme={toggleTheme}
            loadFiles={loadTaskFiles}
          />
          <WorkspaceResize />
          <FeedbackSheet
            api={api}
            open={feedback !== null}
            onOpenChange={(next) => {
              if (!next) setFeedback(null)
            }}
            start={feedback ?? { kind: "bug" }}
            update={
              updates.note
                ? {
                    ...updates.note,
                    // The report is put away first, with its text kept; the update sheet then has the screen.
                    restart: () => {
                      setFeedback(null)
                      updates.note?.restart()
                    },
                  }
                : null
            }
          />
          {newTask && !newTaskAfterNav && config.data !== null ? (
            <NewTask
              key={newTaskProject}
              project={newTaskProject === "" ? undefined : newTaskProject}
              config={config.data}
              draft={newTaskLaunchDraft}
              onDraft={setNewTaskLaunchDraft}
              initialAgent={newTaskAgent}
              initialKind={newTaskKind}
              historyApi={api.agentHistory}
              selectedTarget={newTaskTarget}
              onTarget={setNewTaskTarget}
              folderApi={
                api.projectFolder && api.chooseProjectFolder
                  ? {
                      projectFolder: api.projectFolder,
                      projectFolders: api.projectFolders,
                      chooseProjectFolder: api.chooseProjectFolder,
                      pickProjectFolder: api.pickProjectFolder,
                    }
                  : undefined
              }
              runSupport={runs?.support}
              installed={subagents.data}
              projects={allProjects}
              prompt={newTaskDraft}
              onPrompt={setNewTaskDraft}
              onCopy={onCopy}
              onRememberPlanning={async (choice) => {
                await api.putConfig({ planning: { lastStart: choice } })
                config.reload()
              }}
              onStarted={(run) => {
                config.reload()
                tasks.reload()
                projects.reload()
                if (run.task) {
                  runs?.select(run.id)
                  go({ view: "task", id: run.task, doc: null })
                  terminalLayout?.setPanel("terminal")
                }
              }}
              onClose={closeNewTask}
            />
          ) : null}
          {adding !== null ? (
            <AddProject
              projects={allProjects}
              folderApi={
                api.projectFolder && api.chooseProjectFolder
                  ? {
                      projectFolder: api.projectFolder,
                      projectFolders: api.projectFolders,
                      chooseProjectFolder: api.chooseProjectFolder,
                      pickProjectFolder: api.pickProjectFolder,
                    }
                  : undefined
              }
              canChoose={runs?.support?.canConfigure === true}
              anchor={adding}
              compact={compact}
              onClose={() => setAdding(null)}
              onAdd={async (added, chosen) => {
                const shownAs = chosen.label ?? added.name
                const patch: LookPatch = {
                  color: chosen.color,
                  label: chosen.label,
                  ...(looksNow.current.projects[added.id]?.hidden === true
                    ? { hidden: false }
                    : {}),
                }
                setLooks(await lookApi.setLook(added.id, patch))
                projects.reload()
                setAdding(null)
                toast.success(`Added ${shownAs}`)
              }}
            />
          ) : null}
          {updates.sheet}
          {taskMenu.node}
          {pointMenu}
          <Toaster theme={theme} position="bottom-center" />
        </ShellContexts>
      </TooltipProvider>
    </UsageDisplayProvider>
  )
}
