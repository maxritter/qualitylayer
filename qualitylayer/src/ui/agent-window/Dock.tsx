import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  CircleAlertIcon,
  CopyIcon,
  EllipsisIcon,
  HistoryIcon,
  InfoIcon,
  PauseIcon,
  SlidersHorizontalIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { AGENT_NAMES } from "../../core/agents/ids.ts"
import type { AgentView } from "../../core/config-values.ts"
import type { RunSettings } from "../../core/run/contracts.ts"
import type { HostFrame, ViewerState } from "../../core/run/protocol.ts"
import { holdsAntigravityStartup, STARTUP_PROMPT_STATUS } from "../../core/run/startup-prompt.ts"
import { useViewportWidth } from "../hooks.ts"
import { type ScopedTerminalReceipt, TerminalReceipt } from "../quick-ask/TerminalReceipt.tsx"
import { useQuickAskTerminal } from "../quick-ask/terminal.ts"
import { AgentSwitchButton, StoppedAgentSwitch } from "../run/AgentSwitch.tsx"
import { StartupPromptCard } from "../run/StartupPromptCard.tsx"
import {
  type RunAction,
  type RunWindow,
  useOptionalRuns,
  useRuns,
  type WorkflowController,
} from "../run-context.tsx"
import { runStatusText, runTaskId, taskAgentRuns } from "../runs-api.ts"
import { Appearance } from "./Appearance.tsx"
import { ContextDraftHandoff } from "./conversation/ContextDraftAttachment.tsx"
import {
  Conversation,
  ConversationTurnObserver,
  emptyMessageDraft,
  type MessageDraft,
} from "./conversation/Conversation.tsx"
import { withExternalMessage, withQuestionDraft } from "./conversation/composer-draft.ts"
import type { ContextDraftTarget } from "./conversation/context-draft.ts"
import {
  contextLaunchPending,
  hasUnsupportedContextOwner,
  useContextDraftHandoff,
  usePendingContextDraft,
} from "./conversation/context-draft-store.ts"
import {
  completeDraftHandoff,
  mergeDrafts,
  onDraftBudget,
  onDraftHandoff,
  pruneDrafts,
  type RetainedDrafts,
  type RetainedQueue,
  releaseDraftHandoff,
  reserveDraftHandoff,
  retainDrafts,
  retainedDrafts,
} from "./conversation/draft-handoff.ts"
import { sessionPermissionLabel } from "./conversation/footer-values.ts"
import { typedMessage } from "./conversation/model.ts"
import { conversationMore } from "./conversation/more.ts"
import { type Held, sameQueue } from "./conversation/queue.ts"
import { createPulse } from "./conversation/useConversation.ts"
import { ViewSwitch } from "./conversation/ViewSwitch.tsx"
import { useWindowView } from "./conversation/view-choice.ts"
import { useConversationSay } from "./conversation-say.ts"
import { TerminalLayoutProvider, useTerminalLayout } from "./layout.tsx"
import { type PlanFeedbackActor, planningRun, updatePlanFromFeedback } from "./plan-feedback.ts"
import { RunIntentNote } from "./RunIntentNote.tsx"
import { retainedRunKeys } from "./retained-runs.ts"
import { SendRequest } from "./send-request.tsx"
import { requireStopped, type TaskAgentControls, useTaskControls } from "./task-controls.ts"
import { imagePaste, imagePasteSettles } from "./terminal-images.ts"
import type {
  PresentationState,
  RendererState,
  TerminalControlSender,
  TerminalTheme,
  TerminalView,
} from "./view.ts"

export type { TaskAgentControls } from "./task-controls.ts"

import { Disclosure } from "../kit/Fold.tsx"
import "./dock.css"

const shellTab = (run: Pick<RunWindow, "purpose">) =>
  run.purpose.kind === "terminal" && run.purpose.shell === true
const agentName = (run: RunWindow) =>
  shellTab(run) ? "Shell" : run.agent === "other" ? "Agent" : AGENT_NAMES[run.agent]
function titledRun(run: RunWindow, titles?: Readonly<Record<string, string>>): RunWindow {
  const task = runTaskId(run)
  const title = task && titles?.[task]
  return title && title !== run.title ? { ...run, title } : run
}
export function terminalTheme(root: HTMLElement): TerminalTheme {
  const style = getComputedStyle(root)
  return {
    foreground: style.getPropertyValue("--ql-text").trim() || "#171717",
    background: style.getPropertyValue("--ql-bg-sunken").trim() || "#fafafa",
    cursor: style.getPropertyValue("--ql-accent").trim() || "#2076c5",
  }
}

function AgentSurface({ children, active }: { children: ReactNode; active: boolean }) {
  const layout = useTerminalLayout()
  const [host] = useState(() => document.createElement("div"))
  const fallback = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const parent = layout?.sidebarSheetHost ?? fallback.current
    if (parent) parent.append(host)
    return () => host.remove()
  }, [host, layout?.sidebarSheetHost])
  useLayoutEffect(() => {
    host.className = "q-agent-surface"
    host.dataset.sheet = layout?.sidebarSheetHost ? "true" : "false"
    host.dataset.active = active ? "true" : "false"
  }, [host, active, layout?.sidebarSheetHost])
  return (
    <>
      <div ref={fallback} className="q-agent-surface-anchor" />
      {createPortal(children, host)}
    </>
  )
}

function AgentEmpty({
  children,
  header,
  menu,
  recovering,
  onView,
}: {
  children?: ReactNode
  header?: ReactNode
  /** The tab's other ways to work, ahead of Appearance in the session menu. */
  menu?: ReactNode
  recovering?: RunWindow
  onView?(view: AgentView): void
}) {
  const layout = useTerminalLayout()
  const runs = useRuns()
  const [appearance, setAppearance] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  const [view, setView] = useWindowView(
    recovering?.id ?? `empty:${layout?.taskAgent ?? "agent"}`,
    recovering?.settings?.agentView ?? "conversation",
  )
  const viewTabs = layout?.agentViews
    ? createPortal(
        <ViewSwitch
          tabs
          active={layout.panel === "terminal"}
          value={view}
          onChange={(next) => {
            setView(next)
            onView?.(next)
            layout.setPanel("terminal")
          }}
          conversationAvailable
          tabId={layout.sidebarTabId}
        />,
        layout.agentViews,
      )
    : null
  if (!layout?.sidebarRect) return viewTabs
  const rect = layout.sidebarRect
  return (
    <>
      {viewTabs}
      {layout.agentControls
        ? createPortal(
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                render={<button type="button" className="q-run-ib" aria-label="Agent controls" />}
              >
                <EllipsisIcon size={15} aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="q-run-menu q-agent-menu">
                {menu ? (
                  <>
                    {menu}
                    <DropdownMenuSeparator />
                  </>
                ) : null}
                <DropdownMenuItem onClick={() => setAppearance(true)}>
                  <SlidersHorizontalIcon size={14} aria-hidden="true" />
                  Appearance…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>,
            layout.agentControls,
          )
        : null}
      <AgentSurface active={layout.panel === "terminal"}>
        <section
          className="q-task-agent-empty"
          id="terminal-right-panel"
          hidden={layout.panel !== "terminal"}
          role="tabpanel"
          aria-labelledby={
            view === "conversation"
              ? layout.sidebarTabId?.replace(/(?:terminal|agent)$/, "conversation")
              : layout.sidebarTabId
          }
          style={
            layout.sidebarSheetHost
              ? undefined
              : {
                  position: "fixed",
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                }
          }
        >
          {header}
          {recovering ? (
            <div className="q-run-recovery">
              <p>
                {recovering.status === "failed"
                  ? "The session could not continue · work kept"
                  : "Session ended · work kept"}
              </p>
              {recovering.error ? <p role="alert">{recovering.error}</p> : null}
              {recovering.intent?.state === "blocked" ? (
                <RunIntentNote
                  intent={recovering.intent}
                  fallback="The agent is blocked. Inspect this conversation before continuing."
                />
              ) : null}
              {recovering.nativeSession && recovering.canResume ? (
                <button
                  type="button"
                  className="q-btn sm"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    setProblem(undefined)
                    try {
                      await runs.control(recovering.id, {
                        action: "resume",
                        mode: "continue",
                        generation: recovering.generation,
                      })
                    } catch (cause) {
                      setProblem(
                        cause instanceof Error ? cause.message : "Could not resume. Try again.",
                      )
                      await runs.refresh()
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  Resume previous session
                </button>
              ) : null}
              {problem ? <p role="alert">{problem}</p> : null}
            </div>
          ) : null}
          {runs.error ? (
            <div className="q-run-error" role="alert">
              <p>{runs.error}</p>
              <button type="button" className="q-btn sm" onClick={() => void runs.refresh()}>
                Retry status
              </button>
            </div>
          ) : null}
          {appearance ? (
            <Appearance running={false} onClose={() => setAppearance(false)} />
          ) : (
            (children ?? (
              <div className="q-agent-empty-message">
                <h2>No App session connected</h2>
                <p>
                  Use the task’s current action to start or continue its agent. An external session
                  appears here after it reports.
                </p>
              </div>
            ))
          )}
        </section>
      </AgentSurface>
    </>
  )
}

type RunDockProps = {
  /** Exact machine/project identity supplied by the local workspace owner, never inferred from a title. */
  contextTarget?: ContextDraftTarget
  onWorkflowController?(value: WorkflowController | undefined): void
  onTaskControls?(value: TaskAgentControls | undefined): void
  keepSessionControls?: boolean
  agentReadOnly?: boolean
  phone?: boolean
  currentTask?: string | null
  taskTitles?: Readonly<Record<string, string>>
  taskAgent?: boolean
  /**
   * What the Agent tab shows without a lead session to draw. A function also gets the task's earlier
   * conversations (the planner's among them) and the way to open one read-only.
   */
  agentEmpty?: AgentEmptyContent
  /**
   * The task's lead runs outside the App: no App session leads the tab, and the App's planning
   * conversations are history the empty view opens.
   */
  followOutside?: boolean
  /** Drawn above the Agent tab's body: the plain terminal's bar. */
  agentHeader?: ReactNode
  /** The tab's other ways to work in its session menu; `live` while the shown session runs. */
  agentMenu?: (live: boolean) => ReactNode
  continueAgent?: { available(run: RunWindow): boolean; open(run: RunWindow): void }
  agentRunId?: string | null
  agentScopeKey?: string
  /** How windows the person has not switched are drawn: Settings, else the level. */
  agentView?: AgentView
  /** Opens a task document in the Reader, from a task file the Conversation shows. */
  onOpenTaskFile?(task: string, name: string): void
}
/** The Agent tab's view without a lead session: content, or content built from the task's earlier conversations. */
export type AgentEmptyContent =
  | ReactNode
  | ((history: { runs: RunWindow[]; open: (id: string) => void }) => ReactNode)

export function RunDock(props: RunDockProps) {
  const context = useOptionalRuns()
  const layout = useTerminalLayout()
  const width = useViewportWidth()
  if (!context) return null
  const panes = (
    <DockRuns {...props} phone={props.phone ?? width < 600} taskAgent={props.taskAgent === true} />
  )
  return layout ? panes : <TerminalLayoutProvider>{panes}</TerminalLayoutProvider>
}
type PendingView = { scope: string; view: AgentView; at: number }
function arrivingView(
  pending: PendingView | undefined,
  scope: string | undefined,
  started?: string,
) {
  if (!pending || pending.scope !== scope || !started) return undefined
  const at = Date.parse(started)
  return Number.isFinite(at) && at <= pending.at ? pending.view : undefined
}

function DockRuns({
  contextTarget,
  phone,
  currentTask,
  taskTitles,
  taskAgent,
  agentEmpty,
  followOutside = false,
  agentRunId,
  agentScopeKey,
  agentHeader,
  agentMenu,
  continueAgent,
  agentView,
  onOpenTaskFile,
  agentReadOnly = false,
  onWorkflowController,
  onTaskControls,
  keepSessionControls,
}: {
  contextTarget?: ContextDraftTarget
  phone: boolean
  currentTask?: string | null
  taskTitles?: Readonly<Record<string, string>>
  taskAgent?: boolean
  agentEmpty?: AgentEmptyContent
  followOutside?: boolean
  agentHeader?: ReactNode
  agentMenu?: (live: boolean) => ReactNode
  continueAgent?: { available(run: RunWindow): boolean; open(run: RunWindow): void }
  agentRunId?: string | null
  agentScopeKey?: string
  agentView?: AgentView
  onOpenTaskFile?(task: string, name: string): void
  agentReadOnly?: boolean
  onWorkflowController?(value: WorkflowController | undefined): void
  onTaskControls?(value: TaskAgentControls | undefined): void
  keepSessionControls?: boolean
}) {
  const { loaded, runs, select } = useRuns()
  const layout = useTerminalLayout()
  const scope = taskAgent
    ? (agentScopeKey ?? currentTask ?? (agentRunId ? `agent-run:${agentRunId}` : "agent-empty"))
    : undefined
  const [pendingView, setPendingView] = useState<PendingView>()
  useEffect(
    () => setPendingView((before) => (before?.scope === scope ? before : undefined)),
    [scope],
  )
  useLayoutEffect(() => {
    layout?.setTaskAgent(scope)
    return () => layout?.setTaskAgent(undefined)
  }, [scope, layout?.setTaskAgent])
  const [history, setHistory] = useState<{ task: string; id: string }>()
  const taskRuns = currentTask == null ? [] : taskAgentRuns(runs, currentTask)
  const leadTaskRuns = taskRuns.filter((run) => !run.pendingFresh)
  const lead =
    agentRunId !== undefined
      ? runs.find(
          (run) =>
            run.id === agentRunId && (run.purpose.kind !== "terminal" || !!run.purpose.context),
        )
      : followOutside
        ? undefined
        : (leadTaskRuns.find(
            (run) => run.purpose.kind === "task" && run.purpose.phase !== "planning",
          ) ?? leadTaskRuns[0])
  const conversations =
    agentRunId === undefined ? taskRuns.filter((run) => run.id !== lead?.id) : []
  const previousLead = useRef<string | undefined>(undefined)
  const leadKey = scope && lead ? `${scope}:${lead.id}:${lead.generation}` : undefined
  useLayoutEffect(() => {
    if (!scope || !lead || previousLead.current === leadKey) return
    previousLead.current = leadKey
    setHistory(undefined)
    select(lead.id)
  }, [scope, lead, leadKey, select])
  const historyRun = scope
    ? taskRuns.find((run) => history?.task === scope && run.id === history.id)
    : undefined
  const shownRun = taskAgent ? lead : undefined
  const continuation =
    shownRun && !agentReadOnly && continueAgent?.available(shownRun) ? continueAgent : undefined
  const inheritedView = arrivingView(pendingView, scope, shownRun?.startedAt)
  const shownId = shownRun?.id
  useEffect(() => {
    if (shownId) setPendingView(undefined)
  }, [shownId])
  const recovering =
    (shownRun?.status === "stopped" || shownRun?.status === "failed") &&
    !(shownRun.fresh?.generation === shownRun.generation && shownRun.fresh.state !== "started")
      ? shownRun
      : undefined
  const showHistory = useCallback(
    (id?: string) => {
      if (!scope) return
      setHistory(id ? { task: scope, id } : undefined)
      layout?.setPanel("terminal")
    },
    [scope, layout?.setPanel],
  )
  const setRunOpener = layout?.setRunOpener
  useLayoutEffect(() => {
    if (!scope || !setRunOpener) return
    setRunOpener((id) => {
      if (!taskRuns.some((run) => run.id === id)) return
      select(id)
      showHistory(id === lead?.id && !recovering ? undefined : id)
    })
    return () => setRunOpener(null)
  }, [scope, setRunOpener, taskRuns, lead?.id, recovering, select, showHistory])
  const [visited, setVisited] = useState(new Set<string>())
  const key = shownRun ? `${shownRun.id}:${shownRun.generation}` : ""
  useEffect(() => {
    const valid = new Set(runs.map((r) => `${r.id}:${r.generation}`))
    if (loaded) pruneDrafts(new Set(runs.map((run) => run.id)))
    setVisited((before) => retainedRunKeys(before, valid, key))
  }, [runs, key, loaded])
  return (
    <>
      {continuation &&
      shownRun &&
      !historyRun &&
      layout?.agentControls &&
      layout.panel === "terminal"
        ? createPortal(
            <AgentSwitchButton onClick={() => continuation.open(shownRun)} />,
            layout.agentControls,
          )
        : null}
      {runs
        .filter(
          (r) =>
            (r.id !== shownRun?.id || r.id !== historyRun?.id) &&
            (visited.has(`${r.id}:${r.generation}`) || r.id === shownRun?.id),
        )
        .map((run) => (
          <DockWindow
            key={run.id}
            run={titledRun(run, taskTitles)}
            contextTarget={run.id === shownRun?.id ? contextTarget : undefined}
            readOnly={agentReadOnly}
            allowReadOnlyStop={taskAgent && run.id === shownRun?.id}
            visible={run.id === shownRun?.id && !historyRun && !recovering}
            phone={phone}
            history={conversations}
            onHistory={showHistory}
            agentView={agentView}
            inheritedView={run.id === shownRun?.id ? inheritedView : undefined}
            onOpenTaskFile={onOpenTaskFile}
            onWorkflowController={run.id === shownRun?.id ? onWorkflowController : undefined}
            onTaskControls={run.id === shownRun?.id ? onTaskControls : undefined}
            keepSessionControls={keepSessionControls}
            {...(run.id === shownRun?.id ? { header: agentHeader, menu: agentMenu?.(true) } : {})}
          />
        ))}
      {taskAgent && historyRun ? (
        <DockWindow
          key={`history:${historyRun.id}:${historyRun.generation}`}
          run={titledRun(historyRun, taskTitles)}
          visible
          phone={phone}
          readOnly
          {...(followOutside ? { historyBack: "Back to the build" } : {})}
          onHistory={showHistory}
          history={conversations}
          agentView={agentView}
          onOpenTaskFile={onOpenTaskFile}
        />
      ) : null}
      {loaded && taskAgent && (!lead || recovering) && !historyRun ? (
        <AgentEmpty
          header={agentHeader}
          menu={agentMenu?.(false)}
          recovering={agentReadOnly || continuation ? undefined : recovering}
          onView={
            scope && !recovering
              ? (view) => setPendingView({ scope, view, at: Date.now() })
              : undefined
          }
        >
          {recovering && continuation ? (
            <StoppedAgentSwitch
              run={recovering}
              onSwitch={() => continuation.open(recovering)}
              onHistory={() => showHistory(recovering.id)}
            />
          ) : typeof agentEmpty === "function" ? (
            agentEmpty({ runs: conversations, open: showHistory })
          ) : (
            agentEmpty
          )}
        </AgentEmpty>
      ) : null}
    </>
  )
}
function DockWindow({
  contextTarget,
  run,
  phone,
  visible,
  onWorkflowController,
  onTaskControls,
  keepSessionControls = false,
  readOnly = false,
  allowReadOnlyStop = false,
  historyBack,
  history = [],
  onHistory,
  agentView = "terminal",
  inheritedView,
  onOpenTaskFile,
  header,
  menu,
}: {
  contextTarget?: ContextDraftTarget
  run: RunWindow
  phone: boolean
  visible: boolean
  onWorkflowController?(value: WorkflowController | undefined): void
  onTaskControls?(value: TaskAgentControls | undefined): void
  keepSessionControls?: boolean
  readOnly?: boolean
  allowReadOnlyStop?: boolean
  /** A history window's way back, named for what the tab shows then ("Back to the build"). */
  historyBack?: string
  history?: RunWindow[]
  onHistory?: (id?: string) => void
  agentView?: AgentView
  inheritedView?: AgentView
  onOpenTaskFile?(task: string, name: string): void
  /** Drawn above the window's body: a plain terminal's bar. */
  header?: ReactNode
  /** The tab's other ways to work, in this window's session menu. */
  menu?: ReactNode
}) {
  const { adapter, control, start, refresh, select } = useRuns()
  const layout = useTerminalLayout()
  const right = layout?.rightActive === true
  const label = agentName(run)
  const plainShell = shellTab(run)
  const pendingContext = usePendingContextDraft(contextTarget)
  const pendingArtifactLaunch =
    !readOnly &&
    pendingContext !== undefined &&
    contextTarget?.kind === "artifact" &&
    contextLaunchPending(contextTarget, run)
  const unsupportedContext =
    !readOnly && pendingContext !== undefined && hasUnsupportedContextOwner(contextTarget, run)
  const windowId = useId()
  const root = useRef<HTMLElement>(null)
  const currentRun = useRef(run)
  currentRun.current = run
  // One value for the window's life, so what reads it does not start again at every draw.
  const more = useMemo(() => conversationMore(adapter, currentRun), [adapter])
  const terminal = useRef<TerminalView | undefined>(undefined)
  const attachmentControl = useRef<TerminalControlSender | undefined>(undefined)
  const [viewer, setViewer] = useState<ViewerState | undefined>(run.viewer)
  useEffect(() => {
    if (!onWorkflowController) return
    onWorkflowController(
      visible &&
        !readOnly &&
        run.status === "running" &&
        run.nativeSession &&
        viewer?.controller &&
        viewer.canType &&
        viewer.generation === run.generation &&
        viewer.pickerProof
        ? {
            run: run.id,
            generation: run.generation,
            nativeSession: run.nativeSession,
            proof: viewer.pickerProof,
          }
        : undefined,
    )
    return () => onWorkflowController(undefined)
  }, [
    onWorkflowController,
    visible,
    readOnly,
    run.id,
    run.generation,
    run.nativeSession,
    run.status,
    viewer?.controller,
    viewer?.canType,
    viewer?.generation,
    viewer?.pickerProof,
  ])
  const [status, setStatus] = useState(run.status)
  const [attention, setAttention] = useState(run.attention ?? "clear")
  const [truncated, setTruncated] = useState(run.truncated ?? false)
  const [error, setError] = useState(run.error)
  const [actionError, setActionError] = useState(false)
  const [busy, setBusy] = useState<RunAction>()
  const [connection, reconnect] = useState(0)
  const [renderer, setRenderer] = useState<RendererState>()
  const [presentation, setPresentation] = useState<PresentationState>("loading")
  const [terminalReceipt, setTerminalReceipt] = useState<ScopedTerminalReceipt>()
  const [informationOpen, setInformationOpen] = useState(false)
  const [section, openSection] = useState<"appearance" | undefined>(undefined)
  // The menu's Model & effort… asks the Conversation's footer to open its session sheet, once.
  const [sheetRequested, requestSheet] = useState(!readOnly && run.settingsOpen === true)
  const settingsButton = useRef<HTMLButtonElement>(null)
  const cached = !readOnly ? retainedDrafts(run.id) : undefined
  const [messageDraft, setMessageDraft] = useState(() => cached?.current ?? emptyMessageDraft())
  const [keptDrafts, setKeptDrafts] = useState<readonly MessageDraft[]>(
    () => cached?.previous ?? [],
  )
  const [draftLimit, setDraftLimit] = useState(false)
  const [messageQueue, setMessageQueue] = useState<RetainedQueue | undefined>(cached?.queue)
  const entryRef = useRef<RetainedDrafts>({
    current: messageDraft,
    previous: keptDrafts,
    queue: messageQueue,
  })
  entryRef.current = { current: messageDraft, previous: keptDrafts, queue: messageQueue }
  const draftRef = useRef(messageDraft)
  draftRef.current = messageDraft
  const remember = useCallback(
    (entry: RetainedDrafts) => {
      if (readOnly) return true
      const saved = retainDrafts(run.id, entry)
      setDraftLimit(!saved)
      return saved
    },
    [run.id, readOnly],
  )
  const changeMessageDraft = useCallback(
    (next: MessageDraft | ((before: MessageDraft) => MessageDraft)) => {
      const value = typeof next === "function" ? next(entryRef.current.current) : next
      const entry = { ...entryRef.current, current: value }
      if (!remember(entry)) return
      draftRef.current = value
      entryRef.current = entry
      setMessageDraft(value)
    },
    [remember],
  )
  const changeMessageQueue = (
    items: readonly Held[],
    draft?: MessageDraft,
    kept: readonly MessageDraft[] = [],
  ): boolean => {
    if (
      currentRun.current.generation !== run.generation ||
      currentRun.current.nativeSession !== run.nativeSession
    )
      return false
    const queue = items.length
      ? { generation: run.generation, nativeSession: run.nativeSession, items }
      : undefined
    const entry = {
      ...entryRef.current,
      queue,
      current: draft ?? entryRef.current.current,
      previous: [...entryRef.current.previous, ...kept],
    }
    if (!remember(entry)) return false
    entryRef.current = entry
    setKeptDrafts(entry.previous)
    setMessageQueue(queue)
    if (draft) {
      draftRef.current = draft
      setMessageDraft(draft)
    }
    return true
  }
  const changeQuestionDraft = (draft: MessageDraft) => {
    const entry = withQuestionDraft(entryRef.current, draft)
    if (!remember(entry)) return
    entryRef.current = entry
    draftRef.current = entry.current
    setMessageDraft(entry.current)
    setKeptDrafts(entry.previous)
  }
  // A request another part of the App puts into this task's composer (Review's merge, deploy buttons).
  const takeExternalMessage = useCallback(
    (text: string) => {
      const entry = withExternalMessage(entryRef.current, text)
      if (!remember(entry)) return false
      entryRef.current = entry
      draftRef.current = entry.current
      setMessageDraft(entry.current)
      setKeptDrafts(entry.previous)
      return true
    },
    [remember],
  )
  useConversationSay(runTaskId(run), visible && !readOnly, takeExternalMessage)
  useEffect(() => {
    if (readOnly) return
    const offBudget = onDraftBudget(() => setDraftLimit(false))
    const offHandoff = onDraftHandoff(run.id, (incoming) => {
      const combined = incoming
      entryRef.current = combined
      draftRef.current = combined.current
      setMessageDraft(combined.current)
      setKeptDrafts(combined.previous)
      setMessageQueue(combined.queue)
      remember(combined)
    })
    return () => {
      offBudget()
      offHandoff()
    }
  }, [run.id, readOnly, remember])
  const contextOpened = useCallback(() => layout?.setPanel("terminal"), [layout?.setPanel])
  const contextLimited = useCallback(() => setDraftLimit(true), [])
  useContextDraftHandoff(
    contextTarget,
    run,
    visible && !readOnly && !plainShell,
    contextOpened,
    contextLimited,
  )
  useEffect(() => {
    if (
      !messageQueue ||
      sameQueue(messageQueue, { generation: run.generation, nativeSession: run.nativeSession })
    )
      return
    const combined = mergeDrafts(
      { ...entryRef.current, queue: undefined },
      { current: emptyMessageDraft(), previous: messageQueue.items },
    )
    if (!remember(combined)) return
    entryRef.current = combined
    draftRef.current = combined.current
    setMessageDraft(combined.current)
    setKeptDrafts(combined.previous)
    setMessageQueue(undefined)
  }, [messageQueue, run.generation, run.nativeSession, remember])
  const draftGeneration = useRef(run.generation)
  useEffect(() => {
    if (draftGeneration.current === run.generation) return
    draftGeneration.current = run.generation
    changeMessageDraft((before) => ({ ...before, id: crypto.randomUUID() }))
  }, [run.generation, changeMessageDraft])
  const watching = readOnly || viewer?.canType !== true
  const initialWatching = useRef(readOnly || run.viewer?.canType === false)
  const initialPhone = useRef(phone)
  const attachmentKey = `${run.id}:${run.generation}:${connection}`
  const attachable =
    run.status !== "validated" && (run.status !== "starting" || run.startPhase === "ready")
  const active = !["stopped", "failed"].includes(status)
  const firstTurnStarted =
    run.agent === "other" || run.purpose.kind === "terminal" || !!run.firstPromptAt
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new generation must reset same-status viewer state
  useEffect(() => {
    setStatus(run.status)
    if (run.viewer) setViewer(run.viewer)
  }, [run.status, run.viewer, run.generation])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new attachment clears its predecessor's transport error
  useEffect(() => {
    setError(run.error)
  }, [run.error, attachmentKey])
  useEffect(() => {
    setAttention(run.attention ?? "clear")
  }, [run.attention])
  // What the terminal prints tells the Conversation view the record may have moved; a ref-held signal,
  // so a stream of output frames re-renders nothing.
  const [output] = useState(createPulse)
  const event = useCallback(
    (frame: HostFrame) => {
      if (frame.type === "output") output.notify()
      if (frame.type === "attention") {
        setAttention(frame.kind)
      }
      if (frame.type === "replay-begin") {
        setTruncated(frame.truncated)
        setPresentation("restoring")
      }
      if (frame.type === "status") {
        setStatus(frame.status)
      }
      if (frame.type === "error") {
        setError(frame.message)
      }
      if (frame.type === "exit") {
        setStatus("stopped")
      }
    },
    [output],
  )
  const updateViewer = useCallback(
    (state: ViewerState) => {
      if (state.generation === run.generation) setViewer(state)
    },
    [run.generation],
  )
  useEffect(() => {
    if (!root.current || !attachable) return
    const attachedRun = currentRun.current
    const attachFiles = adapter.attachFiles
    let retired = false
    let reportsPresentation = false
    setPresentation("loading")
    root.current.dataset.attachment = attachmentKey
    const view = adapter.attach(attachedRun, {
      url: `/api/agent-runs/${encodeURIComponent(attachedRun.id)}/attach`,
      generation: attachedRun.generation,
      watching: initialWatching.current,
      phone: initialPhone.current,
      resume: attachedRun.resumeLine,
      theme: terminalTheme(root.current),
      attachFiles:
        attachedRun.agent !== "other" &&
        !(attachedRun.purpose.kind === "terminal" && attachedRun.purpose.shell) &&
        attachFiles
          ? (draft, files) => {
              if (
                retired ||
                currentRun.current.id !== attachedRun.id ||
                currentRun.current.generation !== attachedRun.generation
              )
                return Promise.reject(new Error("This agent window is no longer current."))
              return attachFiles(attachedRun, draft, files)
            }
          : undefined,
      onEvent: (frame) => {
        if (!retired) event(frame)
      },
      onViewer: (state) => {
        if (!retired) updateViewer(state)
      },
      onControl: (sender) => {
        if (!retired) attachmentControl.current = sender
      },
      onRenderer: (state) => {
        if (!retired) setRenderer(state)
      },
      onPresentation: (state) => {
        reportsPresentation = true
        if (!retired) setPresentation(state)
      },
    })
    terminal.current = view
    void view.mount(root.current).then(
      () => {
        if (!retired && !reportsPresentation) setPresentation("ready")
      },
      (cause) => {
        if (retired) return
        setError(cause instanceof Error ? cause.message : "The agent's window could not connect.")
      },
    )
    const unsubscribe = view.onInput(() => {
      if (attachedRun.agent === "other") setAttention("clear")
    })
    return () => {
      retired = true
      attachmentControl.current = undefined
      unsubscribe()
      view.dispose()
      terminal.current = undefined
    }
  }, [adapter, attachmentKey, attachable, event, updateViewer])
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new attachment must inherit the current phone layout even when that layout did not change
  useEffect(() => {
    terminal.current?.setPhone?.(phone)
  }, [phone, attachmentKey])
  const shared = right && layout?.sidebarRect !== null && layout?.sidebarRect !== undefined
  const shown = visible && shared && !(shared && layout?.panel !== "terminal")
  // The Conversation view draws instead of the terminal, which stays attached underneath; another
  // agent has only the terminal.
  const [chosenView, chooseView] = useWindowView(
    run.id,
    run.settings?.agentView ?? agentView,
    inheritedView,
  )
  const conversationAvailable = run.agent !== "other" || unsupportedContext
  const conversationShown = !plainShell && conversationAvailable && chosenView === "conversation"
  const incomingContext = pendingContext?.current.id
  useEffect(() => {
    if (!unsupportedContext || !visible || !incomingContext) return
    chooseView("conversation")
    layout?.setPanel("terminal")
  }, [unsupportedContext, visible, incomingContext, chooseView, layout?.setPanel])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new attachment starts visible and must hear the current state
  useEffect(() => {
    terminal.current?.setVisible?.(shown && !conversationShown)
  }, [shown, conversationShown, attachmentKey])
  // A quick message from a mark while this session shows as a terminal: typed in as the person would.
  useQuickAskTerminal(
    runTaskId(run),
    visible && !readOnly && !plainShell && !conversationShown,
    {
      attach: (draft, files) =>
        adapter.attachFiles?.(currentRun.current, draft, files) ?? Promise.resolve([]),
      paste: async (paths) =>
        currentRun.current.generation === run.generation &&
        (imagePasteSettles(run.agent)
          ? ((await terminal.current?.pasteImages?.(paths)) ?? false)
          : (terminal.current?.sendInput?.(paths.map(imagePaste).join("")) ?? false)),
      type: (text) => currentRun.current.generation === run.generation && type(text),
    },
    (receipt) => {
      if (currentRun.current.id === run.id && currentRun.current.generation === run.generation)
        setTerminalReceipt({ ...receipt, run: run.id, generation: run.generation })
    },
  )
  useEffect(() => {
    if (!shown || !active || watching || !plainShell || section || informationOpen) return
    const focused = document.activeElement
    // Opened from the card's link or the session menu, the new shell takes the keyboard.
    if (
      focused === document.body ||
      focused?.closest('.q-agent-tab-links, .q-shell-bar, [aria-label="Agent controls"]')
    )
      terminal.current?.focus()
  }, [shown, active, watching, plainShell, section, informationOpen])
  useEffect(() => {
    const update = () => {
      if (root.current) terminal.current?.setTheme(terminalTheme(root.current))
    }
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    })
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    })
    const media = window.matchMedia?.("(prefers-color-scheme: dark)")
    media?.addEventListener("change", update)
    update()
    return () => {
      observer.disconnect()
      media?.removeEventListener("change", update)
    }
  }, [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (visible && event.ctrlKey && !event.shiftKey && event.code === "Backquote") {
        event.preventDefault()
        event.stopPropagation()
        if (layout?.sidebarRect) {
          if (layout.panel === "terminal") layout.hideTerminal()
          else layout.setPanel("terminal")
        }
      }
    }
    window.addEventListener("keydown", key, true)
    return () => window.removeEventListener("keydown", key, true)
  }, [visible, layout])
  async function act(
    action: RunAction,
    options: {
      settings?: Partial<RunSettings>
      mode?: "open" | "continue"
      confirmBypass?: boolean
    } = {},
    settingsFeedback = false,
  ) {
    if (busy) return
    if (["restart", "resume", "configure"].includes(action) && !remember(entryRef.current)) {
      setError(
        "The draft cache is full. This session stays open; send or remove a draft before restarting.",
      )
      return false
    }
    setBusy(action)
    setError(undefined)
    setActionError(false)
    taskControls.actionStarted(action)
    try {
      if (action === "take-control") {
        if (!attachmentControl.current?.("take-control"))
          throw new Error("This window could not take control. Reconnect and try again.")
      } else {
        const settled = await control(run.id, { action, generation: run.generation, ...options })
        requireStopped(action, onTaskControls !== undefined, settled)
      }
      return true
    } catch (cause) {
      taskControls.actionFailed(action)
      if (action === "send-request") throw cause
      if (["resume", "restart", "move", "configure"].includes(action)) await refresh()
      setActionError(true)
      setError(cause instanceof Error ? cause.message : "This action could not finish. Try again.")
      if (settingsFeedback) throw cause
      return false
    } finally {
      setBusy(undefined)
    }
  }
  const state =
    attention === "waiting" && active
      ? `${label} is waiting for your answer in the window.`
      : run.startupPrompt && active
        ? STARTUP_PROMPT_STATUS[run.startupPrompt]
        : status === "starting" ||
            status === "validated" ||
            (status === "running" && !firstTurnStarted)
          ? "Starting · answer here if it asks"
          : status === "stopping"
            ? "Stopping…"
            : active
              ? "Running in the App"
              : "Session ended"
  const modelAndEffort =
    [run.settings?.model, run.settings?.effort && `${run.settings.effort} effort`]
      .filter(Boolean)
      .join(" · ") || "Your agent's settings"
  const permissions = sessionPermissionLabel(run)
  const statusSummary =
    status === "failed"
      ? "Couldn't start"
      : status === "stopped"
        ? "Stopped"
        : status === "stopping"
          ? "Stopping"
          : !firstTurnStarted && run.agent !== "other"
            ? "Starting"
            : attention === "waiting"
              ? "Waiting"
              : "Running"
  const sessionSummary = (
    <DropdownMenuGroup className="q-run-facts" aria-label="Session summary">
      <b>
        {label} · {statusSummary}
      </b>
      <span>Last launch · {modelAndEffort}</span>
      <span>
        {readOnly
          ? allowReadOnlyStop
            ? "Read-only conversation"
            : "Read-only history"
          : permissions}
      </span>
    </DropdownMenuGroup>
  )
  const informationAction = (
    <DropdownMenuItem onClick={() => setInformationOpen(true)}>
      <InfoIcon size={14} aria-hidden="true" />
      Session information
    </DropdownMenuItem>
  )
  const sideWidth = shared ? (layout?.sidebarRect?.width ?? 0) : (layout?.width ?? 0)
  // An unmeasured side (0) is not narrow: the full bar shows until the width is known.
  const narrow = phone || (right && sideWidth > 0 && sideWidth < 460)
  const placement: CSSProperties = layout?.sidebarSheetHost
    ? {}
    : layout?.sidebarRect
      ? {
          position: "fixed",
          left: layout.sidebarRect.left,
          top: layout.sidebarRect.top,
          width: layout.sidebarRect.width,
          height: layout.sidebarRect.height,
        }
      : { display: "none" }
  // A session the App cannot change (an Ask run, a host that cannot restart safely) offers no menu entry either.
  const configurable =
    run.canConfigure &&
    !run.settingsLocked &&
    (!active || !watching) &&
    run.agent !== "other" &&
    !shellTab(run)
  const toggleSettings = (next: typeof section) => {
    openSection((before) => (before && !next ? undefined : before === next ? undefined : next))
  }
  const openSessionSheet = () => {
    chooseView("conversation")
    requestSheet(true)
  }
  const closeSettings = () => {
    openSection(undefined)
    settingsButton.current?.focus()
  }
  const canInterrupt =
    active &&
    status === "running" &&
    firstTurnStarted &&
    !watching &&
    run.agent !== "other" &&
    attention !== "waiting"
  const planFeedbackActor = useRef<PlanFeedbackActor>({
    run,
    status,
    attention,
    viewer,
    readOnly,
    busy: busy !== undefined,
    hasDraft: false,
    load: () => Promise.resolve(undefined),
    send: () => false,
    resume: () => Promise.resolve(false),
  })
  planFeedbackActor.current = {
    run: currentRun.current,
    status,
    attention,
    viewer,
    readOnly,
    busy: busy !== undefined,
    hasDraft:
      Boolean(draftRef.current.context) ||
      !!draftRef.current.text.trim() ||
      draftRef.current.files.length > 0,
    load: () => adapter.conversation?.(currentRun.current) ?? Promise.resolve(undefined),
    send: (text) => type(text),
    resume: () => act("resume", { mode: "continue" }),
  }
  const updatePlan = useCallback(() => updatePlanFromFeedback(() => planFeedbackActor.current), [])
  const taskControls = useTaskControls({
    run,
    status,
    attention,
    viewer,
    readOnly,
    allowReadOnlyStop,
    busy: busy !== undefined,
    canInterrupt,
    act,
    onControls: onTaskControls,
    updatePlan: planningRun(run) ? updatePlan : undefined,
    // The Chat's agent chip is the session's menu: it opens what this window's own menu would.
    session:
      onTaskControls && !keepSessionControls
        ? {
            ...(configurable && !readOnly ? { configure: openSessionSheet } : {}),
            appearance: () => toggleSettings("appearance"),
            information: () => setInformationOpen(true),
            ...(!readOnly && active && !watching && run.agent !== "other"
              ? { move: () => void act("move") }
              : {}),
            ...(!readOnly && !active && run.agent !== "other" && run.nativeSession && run.canResume
              ? { resume: () => void act("resume", { mode: "continue" }) }
              : {}),
            ...(run.resumeLine ? { resumeLine: run.resumeLine } : {}),
            facts: `${modelAndEffort} · ${permissions}`,
          }
        : undefined,
  })
  const readConversation = useCallback(
    async (after?: string) => {
      const bound = currentRun.current
      const scope = {
        id: bound.id,
        generation: bound.generation,
        nativeSession: bound.nativeSession,
      }
      if (
        scope.id !== run.id ||
        scope.generation !== run.generation ||
        scope.nativeSession !== run.nativeSession
      )
        return undefined
      const snapshot = await adapter.conversation?.(bound, after, viewer?.pickerProof)
      const current = currentRun.current
      return scope.id === current.id &&
        scope.generation === current.generation &&
        scope.nativeSession === current.nativeSession
        ? snapshot
        : undefined
    },
    [adapter, run.id, run.generation, run.nativeSession, viewer?.pickerProof],
  )
  const canStop = taskControls.canStop
  const headerOwnsSessionControls = !!onTaskControls && !keepSessionControls
  const blocked =
    !readOnly &&
    run.intent?.state === "blocked" &&
    run.intent.task === runTaskId(run) &&
    run.intent.nativeSession === run.nativeSession
  const viewHistory = (id?: string) => {
    onHistory?.(id)
    requestAnimationFrame(() =>
      layout?.agentControls
        ?.querySelector<HTMLButtonElement>('button[aria-label="Agent controls"]')
        ?.focus(),
    )
  }
  // Answers the agent waits for are typed in its own window.
  const showTerminal = () => {
    chooseView("terminal")
    requestAnimationFrame(() => {
      if (!watching && active) terminal.current?.focus()
    })
  }
  // A native startup question opens Terminal once. Antigravity's setup can remain after the
  // first recorded prompt. Later permissions keep Conversation's own answer controls.
  const startupEpisode = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (
      run.startupPrompt === undefined ||
      (run.firstPromptAt && !holdsAntigravityStartup(run.agent, run.startupPrompt))
    ) {
      startupEpisode.current = undefined
      return
    }
    if (!visible || watching || !active) return
    const episode = `${run.id}:${run.generation}:${run.startupPrompt}`
    if (startupEpisode.current === episode) return
    startupEpisode.current = episode
    chooseView("terminal")
  }, [
    run.id,
    run.generation,
    run.agent,
    run.startupPrompt,
    run.firstPromptAt,
    visible,
    watching,
    active,
    chooseView,
  ])
  const canContinue = run.agent !== "other" && !!run.nativeSession && !!run.canResume
  const type = (text: string) =>
    !holdsAntigravityStartup(currentRun.current.agent, currentRun.current.startupPrompt) &&
    (terminal.current?.sendInput?.(typedMessage(text)) ?? false)
  // A Chat's agent chip is the session's one menu (the controls' `session` rows): this window's own
  // menu stays only to reach earlier conversations, and is not drawn when there are none.
  const earlierConversations = readOnly || history.length > 0
  const agentControls =
    headerOwnsSessionControls && !earlierConversations ? null : (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="q-run-ib"
              aria-label="Agent controls"
              ref={settingsButton}
            />
          }
        >
          <EllipsisIcon size={15} aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="q-run-menu q-agent-menu">
          {headerOwnsSessionControls ? null : sessionSummary}
          {!readOnly && !headerOwnsSessionControls ? (
            <>
              <DropdownMenuSeparator />
              {canInterrupt ? (
                <DropdownMenuItem disabled={!!busy} onClick={() => void act("interrupt")}>
                  <PauseIcon size={14} aria-hidden="true" />
                  Interrupt
                </DropdownMenuItem>
              ) : null}
              {/* A plain terminal's tab menu closes it and returns to the agent instead. */}
              {canStop && !(plainShell && menu) ? (
                <DropdownMenuItem
                  disabled={!!busy || status === "stopping"}
                  onClick={() => void act("stop")}
                >
                  <SquareIcon size={14} aria-hidden="true" />
                  Stop session
                </DropdownMenuItem>
              ) : null}
              {configurable ? (
                <DropdownMenuItem onClick={openSessionSheet}>
                  <SlidersHorizontalIcon size={14} aria-hidden="true" />
                  Model & effort…
                </DropdownMenuItem>
              ) : null}
              {active && !watching && run.agent !== "other" ? (
                <DropdownMenuItem disabled={!!busy} onClick={() => void act("move")}>
                  <ArrowUpRightIcon size={14} aria-hidden="true" />
                  Move to my own agent…
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
          {readOnly && canStop && !headerOwnsSessionControls ? (
            <DropdownMenuItem
              disabled={!!busy || status === "stopping"}
              onClick={() => void act("stop")}
            >
              <SquareIcon size={14} aria-hidden="true" />
              Stop session
            </DropdownMenuItem>
          ) : null}
          {run.resumeLine && !headerOwnsSessionControls ? (
            <DropdownMenuItem onClick={() => void navigator.clipboard?.writeText(run.resumeLine)}>
              <CopyIcon size={14} aria-hidden="true" />
              Copy resume command
            </DropdownMenuItem>
          ) : null}
          {menu && !readOnly ? (
            <>
              <DropdownMenuSeparator />
              {menu}
            </>
          ) : null}
          {headerOwnsSessionControls ? null : <DropdownMenuSeparator />}
          {readOnly ? (
            <DropdownMenuItem onClick={() => viewHistory()}>
              <ArrowRightIcon size={14} aria-hidden="true" />
              Current agent
            </DropdownMenuItem>
          ) : null}
          {history
            .filter((item) => item.id !== run.id)
            .map((item) => (
              <DropdownMenuItem key={item.id} onClick={() => viewHistory(item.id)}>
                <HistoryIcon size={14} aria-hidden="true" />
                {item.purpose.kind === "new-task"
                  ? "Planning conversation"
                  : "Earlier conversation"}{" "}
                · {agentName(item)}
              </DropdownMenuItem>
            ))}
          {headerOwnsSessionControls ? null : (
            <>
              <DropdownMenuItem onClick={() => toggleSettings("appearance")}>
                <SlidersHorizontalIcon size={14} aria-hidden="true" />
                Appearance…
              </DropdownMenuItem>
              {informationAction}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  return (
    <>
      {visible && layout?.agentViews
        ? createPortal(
            <ViewSwitch
              tabs
              active={layout.panel === "terminal"}
              value={conversationShown ? "conversation" : "terminal"}
              onChange={(next) => {
                if (!plainShell) chooseView(next)
                layout.setPanel("terminal")
              }}
              conversationAvailable={conversationAvailable && !plainShell}
              plainShell={plainShell}
              tabId={layout.sidebarTabId}
            />,
            layout.agentViews,
          )
        : null}
      {visible && layout?.agentControls
        ? createPortal(
            <>
              {!layout.agentViews && !plainShell ? (
                <ViewSwitch
                  value={conversationShown ? "conversation" : "terminal"}
                  onChange={chooseView}
                  conversationAvailable={conversationAvailable}
                />
              ) : null}
              {agentControls}
            </>,
            layout.agentControls,
          )
        : null}
      <AgentSurface active={shown}>
        <section
          className={`q-run-dock${attention === "waiting" && active ? " waiting" : ""}`}
          data-view={conversationShown ? "conversation" : "terminal"}
          aria-label={`${label}'s window`}
          data-testid="agent-window"
          data-task-agent="true"
          data-position="right"
          data-folded="false"
          data-agent-history={readOnly ? "true" : undefined}
          data-terminal-dock=""
          data-run-active={visible}
          data-narrow={narrow ? "true" : undefined}
          hidden={!visible || !shared || layout?.panel !== "terminal"}
          style={placement}
          id={shared && visible ? "terminal-right-panel" : undefined}
          role={shared ? "tabpanel" : undefined}
          aria-labelledby={
            shared
              ? conversationShown
                ? layout?.sidebarTabId?.replace(/(?:terminal|agent)$/, "conversation")
                : layout?.sidebarTabId
              : undefined
          }
        >
          <div id={windowId} className="q-run-body">
            {header}
            {blocked && run.intent ? (
              // A halted auto-continue is a pause the person resumes by writing, not a failure.
              <RunIntentNote
                intent={run.intent}
                fallback="The agent is blocked. Inspect this conversation before continuing."
                framed
              />
            ) : null}
            {run.startupPrompt && active && !readOnly ? (
              <div className="q-run-startup">
                <StartupPromptCard
                  agent={label}
                  kind={run.startupPrompt}
                  here={!conversationShown}
                  onOpen={showTerminal}
                />
              </div>
            ) : null}
            {readOnly && !allowReadOnlyStop ? (
              <p className="q-run-strip" data-testid="history-strip">
                {run.purpose.kind === "new-task" ||
                (run.purpose.kind === "task" && run.purpose.phase === "planning")
                  ? `Planning conversation · ${label} · read-only.`
                  : "Earlier conversation · read-only."}{" "}
                {historyBack ? (
                  <button type="button" className="q-link" onClick={() => viewHistory()}>
                    {historyBack}
                  </button>
                ) : (
                  "Its unsent input is kept in the original session."
                )}
              </p>
            ) : null}
            {section ? (
              <section
                className="q-run-settings-panel"
                aria-label="Terminal settings"
                onKeyDown={(event) => {
                  if (
                    event.key === "Escape" &&
                    !(event.target instanceof Element && event.target.closest('[role="listbox"]'))
                  ) {
                    event.preventDefault()
                    event.stopPropagation()
                    closeSettings()
                  }
                }}
              >
                <header className="q-set-head">
                  <b>Appearance</b>
                  <button
                    type="button"
                    className="q-run-ib"
                    aria-label="Close settings"
                    onClick={closeSettings}
                  >
                    <XIcon size={14} aria-hidden="true" />
                  </button>
                </header>
                <Appearance running={active} onClose={closeSettings} />
              </section>
            ) : null}
            {renderer === "failed" ? (
              <p className="q-run-notice drawing" role="status">
                <span>
                  WebGL stopped working, so this terminal draws without it. Nothing was lost.
                </span>
                <button
                  type="button"
                  className="q-btn quiet sm"
                  onClick={() => terminal.current?.retryRenderer?.()}
                >
                  Try WebGL again
                </button>
              </p>
            ) : null}
            {truncated && (
              <p className="q-run-notice" role="status">
                Earlier output was trimmed
              </p>
            )}

            {(error || run.pendingSettings?.error) && (
              <div className="q-run-error" role="alert">
                <p>{run.pendingSettings?.error ?? error}</p>
                <button
                  type="button"
                  className="q-btn sm"
                  onClick={() => {
                    if (run.pendingSettings?.error) {
                      openSessionSheet()
                      return
                    }
                    setError(undefined)
                    if (actionError) void refresh()
                    else reconnect((value) => value + 1)
                  }}
                >
                  {run.pendingSettings?.error
                    ? "Change settings"
                    : actionError
                      ? "Refresh status"
                      : "Reconnect"}
                </button>
              </div>
            )}
            {!conversationShown && taskControls.interruptRequested ? (
              <ConversationTurnObserver
                key={`${run.id}:${run.generation}:${run.nativeSession ?? ""}:interrupt`}
                run={run}
                load={adapter.conversation ? readConversation : undefined}
                on={shown}
                output={output}
                onTurnEnd={taskControls.observeTurnEnd}
                onClosed={() => void adapter.conversationClosed?.(run)}
              />
            ) : null}
            {conversationShown && run.agent !== "other" && !pendingArtifactLaunch ? (
              <Conversation
                key={`${run.id}:${run.generation}:${run.nativeSession ?? ""}`}
                run={run}
                agentName={label}
                task={runTaskId(run)}
                answerQuestion={
                  adapter.answerPicker &&
                  active &&
                  viewer?.generation === run.generation &&
                  viewer.controller &&
                  viewer.canType &&
                  viewer.pickerProof
                    ? async (answer, upload) => {
                        const proof = viewer.pickerProof
                        const answerPicker = adapter.answerPicker
                        if (!proof || !answerPicker)
                          throw new Error("Take control to answer this question.")
                        const result = await answerPicker(currentRun.current, answer, proof, upload)
                        output.notify()
                        return result
                      }
                    : undefined
                }
                load={adapter.conversation ? readConversation : undefined}
                onTurnEnd={onTaskControls ? taskControls.observeTurnEnd : undefined}
                interruptPending={taskControls.interruptRequested}
                output={output}
                loadCommands={
                  adapter.commandCatalog
                    ? async (refresh) => {
                        const catalog = await adapter.commandCatalog?.(currentRun.current, refresh)
                        if (!catalog) throw new Error("Skill discovery is unavailable.")
                        return catalog
                      }
                    : undefined
                }
                supportsCommands={["fresh"]}
                command={
                  run.canFresh
                    ? async (action) => {
                        if (action !== "fresh") {
                          showTerminal()
                          return false
                        }
                        const source = currentRun.current
                        const sequence =
                          source.acceptedStopSequence ??
                          (source.fresh?.generation === source.generation
                            ? source.fresh.sequence
                            : undefined)
                        if (!sequence || !terminal.current?.fresh)
                          throw new Error(
                            "This session has no verified fresh boundary. Use Terminal instead.",
                          )
                        if (!remember(entryRef.current))
                          throw new Error(
                            "The draft cache is full. Send or remove a draft before starting fresh; this conversation stays open.",
                          )
                        const saved = entryRef.current
                        const reservation = reserveDraftHandoff(saved)
                        if (!reservation)
                          throw new Error(
                            "The draft cache is full. Send or remove a saved draft before starting fresh; this conversation stays open.",
                          )
                        try {
                          const result = await terminal.current.fresh(sequence)
                          await refresh()
                          if (result.status !== "started") throw new Error(result.message)
                          completeDraftHandoff(reservation, result.run, {
                            current: {
                              ...saved.current,
                              id: crypto.randomUUID(),
                              text: /^\/[^\s]*$/.test(saved.current.text.trim())
                                ? ""
                                : saved.current.text,
                              files: [...saved.current.files],
                            },
                            previous: [...saved.previous, ...(saved.queue?.items ?? [])],
                          })
                          const empty = { current: emptyMessageDraft(), previous: [] }
                          entryRef.current = empty
                          draftRef.current = empty.current
                          setMessageDraft(empty.current)
                          setKeptDrafts([])
                          setMessageQueue(undefined)
                          remember(empty)
                          select(result.run)
                          return true
                        } finally {
                          releaseDraftHandoff(reservation)
                        }
                      }
                    : undefined
                }
                keptDrafts={keptDrafts}
                draftLimit={draftLimit}
                onUseKeptDraft={
                  keptDrafts.length
                    ? () => {
                        const next = entryRef.current.previous.find(
                          (item) => !item.nativeQuestionId,
                        )
                        if (!next) return
                        const remaining = entryRef.current.previous.filter((item) => item !== next)
                        const current = entryRef.current.current
                        const previous = [
                          ...remaining,
                          ...(current.text || current.files.length ? [current] : []),
                        ]
                        const entry = { ...entryRef.current, current: next, previous }
                        if (!remember(entry)) return
                        entryRef.current = entry
                        draftRef.current = next
                        setMessageDraft(next)
                        setKeptDrafts(previous)
                      }
                    : undefined
                }
                more={more}
                loadChanges={
                  adapter.turnChanges
                    ? async () => adapter.turnChanges?.(currentRun.current)
                    : undefined
                }
                loadLimits={adapter.limits}
                loadUsage={adapter.usage}
                openSettings={sheetRequested}
                onSettingsOpened={() => requestSheet(false)}
                loadWorker={
                  adapter.conversationWorker
                    ? (worker, after) =>
                        adapter.conversationWorker?.(currentRun.current, worker, after) ??
                        Promise.resolve(undefined)
                    : undefined
                }
                onClosed={() => void adapter.conversationClosed?.(run)}
                answer={
                  adapter.answerApproval
                    ? (approval, decision) =>
                        adapter.answerApproval?.(currentRun.current, approval.id, decision) ??
                        Promise.resolve()
                    : undefined
                }
                on={shown}
                active={active}
                started={firstTurnStarted}
                waiting={attention === "waiting"}
                readOnly={readOnly}
                viewer={viewer}
                busy={!!busy}
                canInterrupt={canInterrupt}
                showInterruptControl={!headerOwnsSessionControls}
                canResume={canContinue}
                send={(text) => currentRun.current.generation === run.generation && type(text)}
                pasteImages={async (paths) =>
                  currentRun.current.generation === run.generation &&
                  (imagePasteSettles(run.agent)
                    ? ((await terminal.current?.pasteImages?.(paths)) ?? false)
                    : (terminal.current?.sendInput?.(paths.map(imagePaste).join("")) ?? false)) &&
                  currentRun.current.generation === run.generation
                }
                draft={messageDraft}
                onDraft={changeMessageDraft}
                contextTarget={contextTarget}
                onQuestionDraft={changeQuestionDraft}
                queued={messageQueue && sameQueue(messageQueue, run) ? messageQueue.items : []}
                onQueued={changeMessageQueue}
                attachFiles={
                  adapter.attachFiles
                    ? (draft, files) =>
                        adapter.attachFiles?.(currentRun.current, draft, files) ??
                        Promise.resolve([])
                    : undefined
                }
                canConfigure={configurable}
                applySettings={async (settings, confirmBypass) =>
                  (await act(
                    "configure",
                    {
                      settings,
                      ...(confirmBypass ? { confirmBypass: true } : {}),
                    },
                    true,
                  )) === true
                }
                onInterrupt={async () => (await act("interrupt")) === true}
                onTakeControl={() => void act("take-control")}
                onResume={() => void act("resume", { mode: "continue" })}
                onShowTerminal={showTerminal}
                onOpenTaskFile={onOpenTaskFile}
              />
            ) : null}
            {conversationShown && (unsupportedContext || pendingArtifactLaunch) && contextTarget ? (
              <ContextDraftHandoff
                target={contextTarget}
                unsupported={unsupportedContext}
                onTerminal={showTerminal}
              />
            ) : null}
            <div className="q-run-terminal-frame" hidden={conversationShown}>
              {presentation !== "ready" && presentation !== "failed" && !error ? (
                <div className="q-run-loading" role="status">
                  <span className="q-run-loading-mark" aria-hidden="true" />
                  <div>
                    <strong>
                      {presentation === "restoring" ? "Restoring" : "Connecting to"} {label}
                    </strong>
                    <p>
                      {presentation === "restoring"
                        ? "Loading this session’s output…"
                        : "Restoring this session’s output…"}
                    </p>
                  </div>
                </div>
              ) : null}
              <section
                className="q-run-terminal"
                ref={root}
                // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users must be able to scroll the terminal output, including a watching window
                tabIndex={0}
                aria-label={`${label}'s output`}
                data-terminal-surface=""
                onPointerDown={() => {
                  if (!watching && !phone && active) terminal.current?.focus()
                }}
                onPointerUp={(event) => {
                  if (event.target === event.currentTarget && !watching && !phone && active)
                    terminal.current?.focus()
                }}
              />
            </div>
            {!conversationShown ? <TerminalReceipt receipt={terminalReceipt} run={run} /> : null}
            {/* The Conversation view says all of this itself: its strip, its waiting card and its composer. */}
            {conversationShown ? null : active && attention === "waiting" ? (
              <p className="q-run-strip amber" role="status">
                <CircleAlertIcon size={14} aria-hidden="true" />
                {state}
              </p>
            ) : active && !firstTurnStarted && !run.startupPrompt ? (
              <p className="q-run-strip">{state}</p>
            ) : null}
            {watching && active && !readOnly && !conversationShown && viewer?.canTakeControl && (
              <div className="q-run-strip q-run-watch">
                <button
                  type="button"
                  className="q-btn sm"
                  disabled={!!busy}
                  onClick={() => void act("take-control")}
                >
                  Take control
                </button>
              </div>
            )}
            {active &&
            !readOnly &&
            run.taskLifecycle?.stage === "plan" &&
            run.workflowHandoff &&
            run.workflowHandoff.generation === run.generation &&
            run.workflowHandoff.nativeSession === run.nativeSession &&
            run.workflowHandoff.status !== "sent" ? (
              <div className="q-run-strip q-run-error" role="alert">
                <span>
                  {run.workflowHandoff.status === "uncertain"
                    ? "The Plan request has not been confirmed. Inspect Terminal before sending anything again."
                    : "The Plan is ready, but its request was not sent. Take control of this same agent window, then retry."}
                </span>
                {run.workflowHandoff.status === "pending" ? (
                  <button
                    type="button"
                    className="q-btn sm"
                    disabled={
                      !!busy ||
                      !viewer?.controller ||
                      !viewer.canType ||
                      !viewer.pickerProof ||
                      !adapter.handoffWorkflow
                    }
                    onClick={() => {
                      const send = adapter.handoffWorkflow
                      const proof = viewer?.pickerProof
                      const receipt = run.workflowHandoff
                      if (!send || !proof || !receipt) return
                      setBusy("send-request")
                      void send(run, receipt.type, proof, true)
                        .then(() => refresh())
                        .catch((cause) =>
                          setError(
                            cause instanceof Error
                              ? cause.message
                              : "The Plan request could not be sent",
                          ),
                        )
                        .finally(() => setBusy(undefined))
                    }}
                  >
                    Retry Plan request
                  </button>
                ) : (
                  <button type="button" className="q-btn sm" onClick={showTerminal}>
                    Inspect Terminal
                  </button>
                )}
              </div>
            ) : null}
            {active && !readOnly && run.agent === "other" && run.request && (
              <SendRequest
                sent={run.requestSent ?? false}
                disabled={watching || !!busy}
                send={async () => {
                  await act("send-request")
                }}
              />
            )}
            {!active && !readOnly && !(conversationShown && canContinue) && (
              <div className="q-run-ended">
                <p>Session ended. The work in your checkout is kept.</p>
                {run.agent !== "other" && run.nativeSession && run.canResume ? (
                  <div className="q-run-ended-actions">
                    <button
                      type="button"
                      className="q-btn sm primary"
                      disabled={!!busy}
                      onClick={() =>
                        void act("resume", {
                          mode: "continue",
                        })
                      }
                    >
                      Resume here
                    </button>
                    <button
                      type="button"
                      className="q-btn quiet sm"
                      disabled={!!busy}
                      onClick={() =>
                        void act("resume", {
                          mode: "open",
                        })
                      }
                    >
                      Open the conversation
                    </button>
                  </div>
                ) : (
                  <>
                    <p>
                      {shellTab(run)
                        ? "Open another shell in this project to continue."
                        : run.agent === "other"
                          ? "Start this agent again from New task."
                          : "The native session is gone or cannot be resumed here. Start a fresh run from the task."}
                    </p>
                    {run.canStart && (shellTab(run) || run.purpose.kind !== "terminal") && (
                      <button
                        type="button"
                        className="q-btn sm"
                        onClick={() =>
                          void start({
                            agent: run.agent,
                            purpose: run.purpose,
                            ...(run.purpose.kind === "artifact" ||
                            (run.purpose.kind === "terminal" && run.purpose.context)
                              ? {}
                              : { cwd: run.cwd }),
                            idempotencyKey: crypto.randomUUID(),
                          }).catch((cause) =>
                            setError(
                              cause instanceof Error
                                ? cause.message
                                : "A fresh run could not start.",
                            ),
                          )
                        }
                      >
                        {shellTab(run) ? "Open a new shell" : "Start a fresh run"}
                      </button>
                    )}
                  </>
                )}
                {run.resumeLine ? (
                  <Disclosure head="Resume in my terminal">
                    <code>{run.resumeLine}</code>
                  </Disclosure>
                ) : null}
              </div>
            )}
          </div>
        </section>
      </AgentSurface>
      <Dialog open={informationOpen && visible} onOpenChange={setInformationOpen}>
        <DialogContent
          className="q-run-information"
          aria-describedby={undefined}
          finalFocus={() => (settingsButton.current?.isConnected ? settingsButton.current : true)}
        >
          <DialogHeader>
            <DialogTitle>Session information</DialogTitle>
          </DialogHeader>
          <p>
            {label} · {runStatusText(run)}
          </p>
          <dl>
            <dt>Last launch model & effort</dt>
            <dd>{modelAndEffort}</dd>
            <dt>Permissions</dt>
            <dd>{permissions}</dd>
            <dt>Workspace</dt>
            <dd>{run.cwd}</dd>
            {run.branch ? (
              <>
                <dt>Branch</dt>
                <dd>{run.branch}</dd>
              </>
            ) : null}
            {run.nativeSession ? (
              <>
                <dt>Native session</dt>
                <dd>{run.nativeSession}</dd>
              </>
            ) : null}
            {run.facts ? (
              <>
                <dt>Details</dt>
                <dd>{run.facts}</dd>
              </>
            ) : null}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  )
}
