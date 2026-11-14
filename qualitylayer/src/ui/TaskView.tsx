// One task: the header (title, the file chip, Cost, Archive and Delete), the three step tabs, the
// step line of the step in view, the Needs you card, the document or view, and the right sidebar
// (Conversation, Terminal and Files) as a column beside it. Marking text, an artifact or code lines
// opens the quick field, which sends to the task's session. In a narrow window the sidebar is a sheet.

import { cn } from "cn"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CircleXIcon,
  FileTextIcon,
  MessageSquarePlusIcon,
  PencilLineIcon,
  Trash2Icon,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  keepWhile,
} from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { AGENT_NAMES } from "../core/agents/ids.ts"
import type { Artifact } from "../core/artifact/format.ts"
import { parseArtifactReference } from "../core/artifact/reference.ts"
import { modelLabel } from "../core/cost/labels.ts"
import { FLOW_STEPS, flowStepOf } from "../core/flow.ts"
import { flattenItems, type Item, mainAction } from "../core/items.ts"
import { agentName } from "../core/live/liveness.ts"
import {
  type ContextDraftTarget,
  isTaskDraftTarget,
} from "./agent-window/conversation/context-draft.ts"
import { chooseWindowView } from "./agent-window/conversation/view-choice.ts"
import { useTerminalLayout } from "./agent-window/layout.tsx"
import type { TaskAgentControls } from "./agent-window/task-controls.ts"
import type { Api, ArtifactWhere, TaskDetail } from "./api.ts"
import type { ArtifactPageMark } from "./artifact/ArtifactPage.tsx"
import { ArtifactHostProvider } from "./artifact/ArtifactPreview.tsx"
import type { ArtifactFeedbackAddress } from "./artifact/feedback-api.ts"
import {
  artifactFileOfView,
  backWords,
  planningOver,
  TaskArtifactsTab,
  TaskArtifactView,
  useTaskArtifacts,
} from "./artifact/TaskArtifact.tsx"
import { ChatPage } from "./chat/ChatPage.tsx"
import type { ClipboardCopy } from "./clipboard.ts"
import { viewFile } from "./DocPathChip.tsx"
import { DocumentWorkspace } from "./docs/DocumentWorkspace.tsx"
import {
  setDocumentFullSize,
  setDocumentRecord,
  setDocumentReturn,
  useDocumentFullSize,
  useDocumentRecord,
  useDocumentReturn,
} from "./docs/mode.ts"
import { FocusQuestion, useFocus, useQuestionCard } from "./FocusQuestion.tsx"
import { useFollowOpenedGate } from "./gate-follow.ts"
import { type Route, useViewportWidth } from "./hooks.ts"
import { type BuildLaunchSelection, ImplementStart } from "./ImplementStart.tsx"
import { ItemMedia } from "./ItemMedia.tsx"
import type { TaskSurfaceProps, TurnFocusRequest } from "./interaction/props.ts"
import { StepWork } from "./interaction/StepWork.tsx"
import { TaskWorkspace } from "./interaction/TaskWorkspace.tsx"
import { LoadingState } from "./kit/LoadingState.tsx"
import { NeedsYou } from "./kit/NeedsYou.tsx"
import { copyItem, selectedInDocument, usePointClaim, usePointMenu } from "./kit/PointMenu.tsx"
import { statusOf } from "./live-status.ts"
import {
  additionsOf,
  agentInfo,
  autonomous,
  commentTarget,
  defaultDoc,
  fileOf,
  gateDocs,
  inReview,
  pendingGate,
  reviewGate,
  settledLineFor,
  stageTabs,
  stepLineFor,
  stepPhase,
  stepView,
  taskTag,
  viewedStep,
} from "./model.ts"
import { buildsNextLine, runsInApp } from "./outside.ts"
import { itemPreview } from "./question-preview.ts"
import { QuickAskHost } from "./quick-ask/QuickAsk.tsx"
import { onJumpToMark } from "./quick-ask/sent.ts"
import { openQuickAsk } from "./quick-ask/store.ts"
import { artifactMark, codeMark, passageMark, quoteMark } from "./quick-ask/task-marks.ts"
import { ReportThis } from "./ReportThis.tsx"
import { Resizer, type StoredWidth } from "./Resizer.tsx"
import {
  OUTLINE_MIN,
  OutlineButton,
  OutlineColumn,
  outlineOf,
  useActiveSection,
  withAgentsEntry,
  withSectionShow,
} from "./reader/DocOutline.tsx"
import { DocReader, type ReaderMark, readerDimmed } from "./reader/DocReader.tsx"
import { selectedContextPassage } from "./reader/selected-passage.ts"
import { ReviewWorkspaceHost } from "./review-workspace/Host.tsx"
import { openReviewWorkspace } from "./review-workspace/open.ts"
import type { CodeMark } from "./review-workspace/ReviewWorkspace.tsx"
import { StartupPromptCard } from "./run/StartupPromptCard.tsx"
import { useOptionalRuns } from "./run-context.tsx"
import { buildRunForTask, startupRunFor } from "./runs-api.ts"
import { StartSay } from "./StartSay.tsx"
import { StepActions } from "./StepActions.tsx"
import { StepTabs } from "./StepTabs.tsx"
import { TaskListToggle } from "./shell/TaskListToggle.tsx"
import { TaskTopBar } from "./shell/TaskTopBar.tsx"
import { SidebarButton } from "./sidebar/HeaderButtons.tsx"
import { ReaderBar } from "./sidebar/ReaderBar.tsx"
import { RightSidebar } from "./sidebar/RightSidebar.tsx"
import { NeedCard, NeedReceipt } from "./status/NeedCard.tsx"
import { StatusPill } from "./status/StatusPill.tsx"
import {
  artifactItem,
  artifactFile as pageArtifactFile,
  stepDocumentOrPending,
} from "./step-page/document.ts"
import type { StepLive } from "./step-page/live.ts"
import { jumpTo as jumpToPart } from "./step-page/StepPage.tsx"
import { forAgentOf } from "./step-page/StepTools.tsx"
import { jumpId, planPreparation, stepState } from "./step-page/state.ts"
import { useSteadyStep } from "./step-page/steady.ts"
import { stepIsWorking } from "./steps/readiness.ts"
import { StepPage } from "./steps/StepPage.tsx"
import { StepQuiet, stepBefore } from "./steps/StepQuiet.tsx"
import { questionActionsFor } from "./task-view/question-actions.ts"
import { TaskDialogs } from "./task-view/TaskDialogs.tsx"
import { useBuildHandoff } from "./task-view/useBuildHandoff.ts"
import { useTaskApproval } from "./task-view/useTaskApproval.ts"
import { useTaskData } from "./task-view/useTaskData.ts"
import { useTaskSidebar } from "./task-view/useTaskSidebar.ts"
import { humanQuestions } from "./turn/ApproveCard.tsx"
import { useTurnSnapshot, useTurnTask } from "./turn/projection.ts"
import { turnLayoutFor, YourTurn } from "./turn/YourTurn.tsx"
import { useAnswers } from "./useAnswers.ts"
import { artifactViewing, ViewingProvider } from "./viewing.tsx"

export { defaultDoc }

type Props = {
  contextTarget?: ContextDraftTarget
  task: TaskDetail
  archiveRequest?: number
  onArchiveRequested?(request: number): void
  planControls?: TaskAgentControls
  plainTerminal?: import("./run/AgentTab.tsx").AgentTabTerminal
  plainTerminalShown?: boolean
  doc: string | null
  /** A heading's slug in `doc` to jump to. */
  at?: string
  /** Moves when the task's files changed on disk. */
  version: number
  /**
   * Moves, at a calm pace, when the task's files changed or its agent showed a sign of life: what
   * the work changed in the checkout and what it cost move with the agent, not with a file. Without
   * it (the demo has no events) `version` stands for it.
   */
  activity?: number
  /** Moves when an artifact's page, note or picture changed. */
  artifacts?: number
  theme: string
  api: Api
  go: (route: Route) => void
  reload: () => void
  onQuestionAnswer?: (
    id: string,
    answer: import("../core/task/question.ts").AnsweredQuestion | null,
  ) => void
  onVisibleTask?: (task: TaskDetail) => void
  onCopy: ClipboardCopy
  onBuildLaunch?: (selection: BuildLaunchSelection) => void
  /** Where the person chose to run the build when they started or copied it, to open the card on next time. */
  onBuildWhere?: (runWhere: "app" | "terminal") => void
  onArtifactContext?: (address: ArtifactFeedbackAddress, title: string) => void
  /** The right sidebar (Comments | Files) is open. */
  railOpen: boolean
  onRail: (open: boolean) => void
  railSize?: StoredWidth
  resizing?: boolean
  onResizing?: (dragging: boolean) => void
  /** An artifact open full screen: both sidebars give way (the App hides its own). */
  fullScreen?: boolean
  onFullScreen?: (on: boolean) => void
  /** The left sidebar is hidden: an artifact's bar brings it back. */
  menu?: { compact: boolean; onOpen: () => void } | null
}

const RAIL_FALLBACK: StoredWidth = {
  width: 320,
  min: 280,
  max: 600,
  setWidth: () => {},
  reset: () => {},
}

const VIEWS = new Set(["checkpoint", "implement", "verify"])

/**
 * The view to show. The Implement start card is for a Plan that waits to be started: once the build
 * has begun (or finished), that address shows the build instead of a prompt that no longer applies.
 */
function viewOf(task: TaskDetail, doc: string | null): string {
  const view = doc ?? defaultDoc(task)
  if (view === "implement" && task.action !== "implement") {
    const started = ["implement", "verify", "shipped"].includes(task.stage)
    if (started) return "checkpoint"
  }
  return view
}

/** The shell's top bar holds a narrow window's task tools: this is where they go. */
export const TOP_BAR_TOOLS = "top-bar-tools"

/**
 * The header pins to one line once the page is scrolled down, and opens again on the way up. A
 * page too short to scroll far never pins; the moment after a change is not a scroll of its own.
 */
function usePinnedHeader(scroller: HTMLElement | null): boolean {
  const [pinned, setPinned] = useState(false)
  useEffect(() => {
    if (scroller === null) return
    let last = scroller.scrollTop
    let settled = 0
    let was = false
    const onScroll = () => {
      const top = scroller.scrollTop
      const room = scroller.scrollHeight - scroller.clientHeight
      const now = performance.now()
      const moved = top - last
      last = top
      // The header's own change moves the page a little: not a scroll of the person's.
      if (now < settled && top >= 24 && room >= 160) return
      let next = was
      if (top < 24 || room < 160) next = false
      else if (moved > 4) next = true
      else if (moved < -4) next = false
      if (next === was) return
      was = next
      settled = now + 250
      setPinned(next)
    }
    scroller.addEventListener("scroll", onScroll, { passive: true })
    return () => scroller.removeEventListener("scroll", onScroll)
  }, [scroller])
  return pinned
}

export function TaskView(props: Props) {
  const [handoffTask, setHandoffTask] = useState<string>()
  const chatSnapshot = useRef<Props["task"] | undefined>(undefined)
  if (props.task.type === "chat") chatSnapshot.current = props.task
  const handoffFlight = useCallback(
    (active: boolean) => {
      setHandoffTask((current) =>
        active ? props.task.id : current === props.task.id ? undefined : current,
      )
    },
    [props.task.id],
  )
  const chatTask =
    props.task.type === "chat"
      ? props.task
      : !props.task.archived &&
          handoffTask === props.task.id &&
          chatSnapshot.current?.id === props.task.id
        ? chatSnapshot.current
        : undefined
  const windows = useOptionalRuns()
  const record = useDocumentRecord()
  const eligible =
    (props.task.viewingEligible ?? props.task.session !== null) ||
    (windows?.runs.some((run) => buildRunForTask(run, props.task.id)) ?? false)
  const implicitPlan = useRef({
    task: props.task.id,
    hold: props.doc === null && props.task.stage === "plan",
  })
  if (implicitPlan.current.task !== props.task.id)
    implicitPlan.current = { task: props.task.id, hold: false }
  if (props.doc !== null || (props.task.stage !== "plan" && props.task.action !== "implement"))
    implicitPlan.current.hold = false
  else if (props.task.stage === "plan") implicitPlan.current.hold = true
  const selectedDoc =
    props.doc === null && implicitPlan.current.hold && props.task.action === "implement"
      ? fileOf(props.task, "plan")
      : props.doc
  const view = viewOf(props.task, selectedDoc)
  const artifact = artifactFileOfView(view)
  const file = viewFile(props.task, view)
  const location =
    record?.taskId === props.task.id
      ? null
      : artifact !== null
        ? artifactViewing(artifact)
        : file?.exists
          ? { doc: file.name }
          : null
  if (chatTask)
    return (
      <ChatPage
        archiveRequest={props.archiveRequest}
        onArchiveRequested={props.onArchiveRequested}
        version={props.version}
        onDeleted={() => props.go({ view: "home" })}
        key={props.task.id}
        task={chatTask}
        onHandoffFlight={handoffFlight}
        api={props.api}
        reload={props.reload}
        theme={props.theme}
        onCopy={props.onCopy}
        menu={props.menu}
        plainTerminal={props.plainTerminal}
        plainTerminalShown={props.plainTerminalShown}
      />
    )
  return (
    <ViewingProvider api={props.api} task={props.task.id} location={location} eligible={eligible}>
      <TaskViewContent {...props} doc={selectedDoc} />
    </ViewingProvider>
  )
}

function TaskViewContent({
  contextTarget,
  task: serverTask,
  planControls,
  doc,
  at,
  version,
  activity,
  artifacts: artifactEvents = 0,
  theme,
  api,
  go,
  reload,
  onQuestionAnswer,
  onVisibleTask,
  onCopy,
  onBuildLaunch,
  onBuildWhere,
  onArtifactContext,
  railOpen,
  onRail,
  railSize = RAIL_FALLBACK,
  resizing = false,
  onResizing,
  fullScreen = false,
  onFullScreen = () => {},
  menu = null,
}: Props) {
  const task = useTurnTask(serverTask)
  const terminalLayout = useTerminalLayout()
  const effectiveRailOpen = railOpen
  const effectiveRailWidth = terminalLayout?.rightActive ? terminalLayout.width : railSize.width
  const windows = useOptionalRuns()
  const managedRun = windows?.runs.some((run) => buildRunForTask(run, task.id)) ?? false
  const buildsNext = buildsNextLine(
    task.start,
    (agent) => (agent === "other" || agent === "" ? "your agent" : agentName(agent)),
    task.gate?.decided,
  )
  // The task's agent waits on its own start-up question (trust this folder, …), which shows only in its terminal.
  const startupRun = windows ? startupRunFor(windows.runs, task.id) : undefined
  const startupAgent =
    startupRun === undefined || startupRun.agent === "other"
      ? "Your agent"
      : AGENT_NAMES[startupRun.agent]
  const view = viewOf(task, doc)
  const turnLayoutReady = turnLayoutFor(view, api, task.id)
  // An artifact open full size: the whole content area under its own bar.
  const artifactFile = artifactFileOfView(view)
  const bindArtifactContext = useCallback(
    (address: ArtifactFeedbackAddress, title: string) => onArtifactContext?.(address, title),
    [onArtifactContext],
  )
  const isDoc = !VIEWS.has(view) && artifactFile === null
  const fileInView = viewFile(task, view)
  const fullDocument = useDocumentFullSize()
  const foreground = useRef({ task: task.id, view, reader: fullDocument })
  if (
    foreground.current.task !== task.id ||
    foreground.current.view !== view ||
    foreground.current.reader !== fullDocument
  )
    foreground.current = { task: task.id, view, reader: fullDocument }
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const pageStep = viewedStep(view)
  // A file is the Reader's when it was opened whole (from Files, a "Read the …" link, a link to one
  // of its headings such as the "More in this document" strip), or when no step page stands for it:
  // the Reader shows every section, the step page the lead ones. It reads under the slim bar.
  const fileReader =
    isDoc &&
    fileInView !== undefined &&
    (fullDocument || at !== undefined || pageStep === null || view !== stepView(task, pageStep))
  const readsFile = fileReader
  // A step's own page is its document with the live parts drawn over it.
  const stepDoc =
    pageStep !== null && view === stepView(task, pageStep) && !fileReader
      ? stepDocumentOrPending(task, pageStep)
      : null
  const compact = useViewportWidth() <= 820
  // The answers picked and not sent yet: saved as drafts, and sent by the step's main button.
  const { answers, answer, flush, clear } = useAnswers(api, task, reload)
  const visibleTask = useMemo(
    () => itemPreview(task, answers, turnLayoutReady),
    [task, answers, turnLayoutReady],
  )
  const [turnFocus, setTurnFocus] = useState<TurnFocusRequest | null>(null)
  const focusSequence = useRef(0)
  const arrivedFocus = useRef<number | null>(null)
  const currentTurn = useTurnSnapshot(task.id)
  const focusQuestions = humanQuestions(visibleTask, currentTurn?.questions)
  const focusNavigation = window.location.hash
  useEffect(() => {
    if (turnFocus?.view === view) arrivedFocus.current = turnFocus.sequence
    if (
      turnFocus !== null &&
      (turnFocus.task !== task.id ||
        turnFocus.navigation !== focusNavigation ||
        (turnFocus.view !== view &&
          (turnFocus.fromView !== view || arrivedFocus.current === turnFocus.sequence)) ||
        turnFocus.step !== flowStepOf(task.stage) ||
        task.archived ||
        task.stage === "shipped" ||
        task.stage === "abandoned" ||
        fullDocument ||
        !turnFocus.questions.some((target) =>
          focusQuestions.some(
            (question) => question.id === target.id && question.asked === target.asked,
          ),
        ))
    )
      setTurnFocus(null)
  }, [
    turnFocus,
    task.id,
    task.stage,
    task.archived,
    view,
    fullDocument,
    focusNavigation,
    focusQuestions,
  ])
  useEffect(() => {
    onVisibleTask?.(visibleTask)
  }, [visibleTask, onVisibleTask])
  const [diffOpen, setDiffOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // The right sidebar: its tab, and whether it opened by itself.
  const readingFrom = useDocumentReturn()
  // The task owns reading mode; changing the stage's reader parent must preserve it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different task releases the previous task's local reading state
  useEffect(
    () => () => {
      setDocumentFullSize(false)
      setDocumentRecord(null)
      setDocumentReturn(null)
    },
    [task.id],
  )
  const backToStage = useCallback(() => {
    setDocumentFullSize(false)
    setDocumentReturn(null)
    if (readingFrom?.taskId === task.id) go({ view: "task", id: task.id, doc: readingFrom.view })
  }, [readingFrom, task.id, go])
  // The step an artifact was opened from, for its bar's Back.
  const artifactFrom = useRef<string | null>(null)
  const artifactReturnFull = useRef(false)
  const artifactReturnReading = useRef(readingFrom)
  if (artifactFile === null) artifactFrom.current = view
  const {
    sideTab,
    setSideTab,
    focusKey,
    showSidebar,
    showConversation,
    reopenSidebar,
    closeSidebar,
  } = useTaskSidebar({
    task,
    railOpen,
    onRail,
    artifactFile,
    fullScreen,
    readingFrom,
    backToStage,
  })

  // Reads of what an agent's work changes outside the task's files wait for the calm pace.
  const slow = activity ?? version
  const { content, sections, cost, loadArtifact, loadEvidence } = useTaskData({
    api,
    task,
    view,
    isDoc,
    fileInView,
    stepDoc,
    fileReader,
    version,
    slow,
  })
  // While an agent writes the step's file, the page keeps its last complete rendering (26b).
  const stepFile = stepDoc
    ? (task.pages ?? []).find((page) => page.step === stepDoc.step)
    : undefined
  const steady = useSteadyStep(
    `${task.id}:${stepDoc?.step ?? viewedStep(view) ?? ""}:${fileReader ? `reader:${view}` : "page"}`,
    stepDoc,
    sections.data,
    stepDoc !== null &&
      (stepFile?.problems.length ?? 0) === 0 &&
      planPreparation(task, stepDoc) === undefined,
  )
  // The task's artifacts and its project's: the Artifacts tab, the Plan's previews, an artifact open.
  const openArtifact = (
    where: ArtifactWhere,
    artifact: Pick<Artifact, "file">,
    section?: string,
  ) => {
    if (compact) onRail(false)
    if (where.scope === "task")
      go({ view: "task", id: task.id, doc: artifact.file, ...(section ? { at: section } : {}) })
    else
      go({
        view: "artifact",
        project: where.id,
        file: artifact.file,
        ...(section ? { at: section } : {}),
      })
  }
  const artifacts = useTaskArtifacts(
    api,
    task,
    slow + artifactEvents,
    openArtifact,
    theme === "dark" ? "dark" : "light",
  )
  // A long document's sections.
  const markdown = isDoc ? content.data?.markdown : undefined
  const cut = fileReader ? sections.data?.sections : undefined
  // A step file is read with its agents' file under For agents, which the outline lists last.
  const fileRole = isDoc ? task.files.find((file) => file.name === view)?.role : undefined
  const outline = useMemo(() => {
    const found = markdown !== undefined ? outlineOf(markdown) : []
    const entries = cut !== undefined ? withSectionShow(found, cut) : found
    return entries.length >= OUTLINE_MIN
      ? fileRole !== undefined
        ? withAgentsEntry(entries)
        : entries
      : []
  }, [markdown, cut, fileRole])
  // The detail and folded sections the Reader dims, by their headings.
  const cutSections = fileReader ? sections.data : null
  const dimmed = useMemo(() => readerDimmed(cutSections ?? null), [cutSections])
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const activeSection = useActiveSection(scroller, outline)
  // An outline click: a jump within this view, counted so the same heading can be jumped to again.
  const [jump, setJump] = useState<{ view: string; at: string; n: number } | null>(null)
  const jumpTo = (slug: string) => setJump((was) => ({ view, at: slug, n: (was?.n ?? 0) + 1 }))
  const jumpHere = jump !== null && jump.view === view ? jump : null
  const docPath = `docs/plans/${task.slug}/${view}`
  // A mark (selected words, an artifact's spot or region, code lines) opens the quick field, which
  // sends to this task's session. Only the task's own connected App can name its session.
  const markTarget =
    contextTarget !== undefined && isTaskDraftTarget(contextTarget, task) ? contextTarget : null
  const markPassage = (mark: ReaderMark, page = view) => {
    if (markTarget === null) return
    openQuickAsk(passageMark(task, markTarget, page, mark))
  }
  // Back from a sent message's chip: the marked place comes into view.
  const [back, setBack] = useState<{ quote: string; key: number } | null>(null)
  useEffect(
    () =>
      onJumpToMark((mark) => {
        if (mark.task !== undefined && mark.task !== task.id) return
        if (mark.mark === "code") {
          openReviewWorkspace(task.id, mark.page)
          return
        }
        if (mark.mark === "artifact") {
          const file = mark.artifact?.file ?? mark.page
          go({
            view: "task",
            id: task.id,
            doc: file,
            ...(mark.section ? { at: mark.section } : {}),
          })
          return
        }
        const heading = mark.section && mark.section !== "document-start" ? mark.section : undefined
        go({ view: "task", id: task.id, doc: mark.page, ...(heading ? { at: heading } : {}) })
        setBack((was) => ({ quote: mark.quote, key: (was?.key ?? 0) + 1 }))
      }),
    [task.id, go],
  )
  // A right-click on words selected in the document: ask the agent about them, or copy them.
  const docMenu = usePointMenu()
  usePointClaim((event) => {
    const words = selectedInDocument()
    if (words === null) return
    const selection = window.getSelection()
    const passage = selection ? selectedContextPassage(selection) : null
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const boxes = range
      ? Array.from(range.getClientRects())
          .filter((box) => box.width > 1)
          .map((box) => ({ x: box.left, y: box.top, width: box.width, height: box.height }))
      : []
    const source = stepDoc?.markdown ?? markdown
    docMenu.open(event, [
      ...(closed || markTarget === null || source === undefined
        ? []
        : [
            {
              label: "Ask agent",
              icon: <MessageSquarePlusIcon aria-hidden="true" />,
              onSelect: () =>
                markPassage({
                  passage: passage ?? {
                    quote: words,
                    before: "",
                    after: "",
                    section: "document-start",
                  },
                  source,
                  boxes,
                }),
            },
            "separator" as const,
          ]),
      copyItem(words),
    ])
  })
  const questionActions = questionActionsFor({ api, task, reload, onQuestionAnswer })
  const {
    busy,
    decisionError,
    decide,
    implementationChoice,
    buildOpener,
    buildBusy,
    buildLaunchFailed,
    openBuildChoice,
    dismissImplementationChoice,
    confirmBuildStart,
    prepareBuild,
    buildApproved,
    currentBuildApproved,
    takeDecisionFailure,
    resetBuildFailure,
  } = useTaskApproval({
    api,
    task,
    view,
    answers,
    flush,
    clear,
    reload,
    foreground,
    mounted,
    openStart: () => open("implement"),
    onBuildLaunch,
    showBuild: () => {
      terminalLayout?.setPanel("terminal")
      onRail(true)
    },
  })
  const {
    planner,
    buildHereReason,
    waitingHere,
    approvedUnstarted,
    outlineHere,
    startHere,
    buildHere,
    terminalPlanner,
    buildInTerminal,
  } = useBuildHandoff({
    api,
    task,
    view,
    windows,
    planControls,
    answers,
    flush,
    reload,
    approval: {
      prepareBuild,
      confirmBuildStart,
      buildApproved,
      openBuildChoice,
      resetBuildFailure,
    },
  })
  // The Agent tab's Ready to build card asks for the choice of how to build: the same dialog Approve opens.
  const openBuildChoiceRef = useRef(openBuildChoice)
  openBuildChoiceRef.current = openBuildChoice
  useEffect(() => {
    const open = (event: Event) => {
      if ((event as CustomEvent<string>).detail === task.id) openBuildChoiceRef.current()
    }
    window.addEventListener("qualitylayer:build-options", open)
    return () => window.removeEventListener("qualitylayer:build-options", open)
  }, [task.id])
  const openDoc = (doc: string, heading?: string) => {
    setTurnFocus(null)
    if (readingFrom?.taskId !== task.id) setDocumentReturn({ taskId: task.id, view })
    setDocumentFullSize(true)
    go({ view: "task", id: task.id, doc, ...(heading !== undefined ? { at: heading } : {}) })
  }

  const archive = async (archived: boolean) => {
    try {
      await api.archive(task.id, archived)
      toast.success(archived ? "Archived. It waits under Archived in the sidebar." : "Restored")
      reload()
      void windows?.refresh()
      if (archived) go({ view: "home" })
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const remove = async () => {
    try {
      if (!task.archived) await api.archive(task.id, true)
      const done = await api.deleteTask(task.id)
      setConfirmDelete(false)
      toast.success(done.plan !== null ? `Deleted, with ${done.plan}` : "Deleted")
      reload()
      void windows?.refresh()
      go({ view: "home" })
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  // Before the gate opens, the drafts are the ones on the document in view.
  const target = commentTarget(view, task)
  const reviewed = gateDocs(task).length > 0 ? gateDocs(task) : target !== null ? [target] : []
  const gateDraftCount = task.comments.filter(
    (c) =>
      reviewed.includes(c.doc) &&
      c.delivered !== true &&
      !(c.kind !== undefined && c.remark.trim() === ""),
  ).length
  // The line of the step in view: where the task is it is the next step, behind it the step is
  // done, ahead of it not started. A running review's clock moves with the event stream, not a timer.
  const askingChanges = mainAction(
    (task.items ?? []).filter((item) => item.step === viewedStep(view)),
    answers,
  ).changes
  const step = stepLineFor(task, view, gateDraftCount, Date.now(), askingChanges)
  const tabTurn = useTurnSnapshot(task.id)
  const tabs = stageTabs(task, Date.now(), tabTurn)
  // A step whose page cannot be shown yet: the page is one sentence of what happens there.
  // A document that is on screen is read, whatever the tab says; a step ahead never is.
  const unopened = tabs.find(
    (tab) =>
      tab.step === viewedStep(view) &&
      !tab.enabled &&
      !(isDoc && content.data !== null) &&
      (stepPhase(task, view) === "future" || !isDoc || content.data === null),
  )
  // The step the agent is writing, before its file exists: the quiet state, not one bare line.
  const writingStep = viewedStep(view)
  const writingBefore = writingStep === null ? null : stepBefore(writingStep)
  const writingQuiet =
    unopened !== undefined && unopened.tone === "live" && writingStep !== null
      ? {
          step: writingStep,
          back:
            writingBefore === null
              ? null
              : { label: writingBefore.label, to: stepView(task, writingBefore.id) },
        }
      : null
  const additions = additionsOf(task)
  const checks = content.data?.validation?.errors ?? []
  const errors = checks.filter((e) => e.severity === "error")
  const warnings = checks.filter((e) => e.severity === "warning")
  // The document the current stage is writing, before its gate opens: open checks are
  // work in progress, not a failure.
  const writing = viewedStep(view) === "plan" && task.stage === "plan" && pendingGate(task) === null
  const documentRole = task.files.find((file) => file.name === view)?.role
  const documentStep = documentRole ?? viewedStep(view)
  const historicalFormat =
    task.archived ||
    task.stage === "shipped" ||
    task.stage === "abandoned" ||
    (documentStep !== null &&
      documentStep !== undefined &&
      FLOW_STEPS.findIndex((step) => step.id === documentStep) <
        FLOW_STEPS.findIndex((step) => step.id === flowStepOf(task.stage)))
  const tag = taskTag(task)
  const agent = agentInfo(task.session?.agent)
  const closed = task.stage === "shipped" || task.stage === "abandoned"
  const open = (next: string) => {
    setTurnFocus(null)
    if (artifactFileOfView(next) !== null && artifactFile === null) {
      artifactReturnFull.current = fullDocument
      artifactReturnReading.current = readingFrom
    }
    setDocumentRecord(null)
    setDocumentFullSize(false)
    if (artifactFileOfView(next) !== null) {
      if (artifactFile === null && readingFrom?.taskId !== task.id)
        setDocumentReturn({ taskId: task.id, view })
      setDocumentFullSize(true)
    } else if (next !== view) {
      setDocumentReturn(null)
    }
    go({ view: "task", id: task.id, doc: next })
  }
  const revealQuestion = (origin?: HTMLElement) => {
    const current = flowStepOf(task.stage)
    if (!focusQuestions.length || !current) return false
    const destination = stepView(task, current)
    const focusAtRequest = document.activeElement
    open(destination)
    setTurnFocus({
      task: task.id,
      view: destination,
      fromView: view,
      navigation: window.location.hash,
      step: current,
      questions: focusQuestions.map(({ id, asked }) => ({ id, asked })),
      sequence: ++focusSequence.current,
      focusAtRequest,
      ...(origin ? { origin } : {}),
    })
    return true
  }
  // A gate that opens takes the person to its step page, where its Your turn waits (gate-follow.ts).
  useFollowOpenedGate(pendingGate(task), closed, () => {
    const target = defaultDoc(task)
    if (target !== view && artifactFileOfView(view) === null) open(target)
  })
  // What needs you in the step in view, in one card. A gate with no item for it, or a task that
  // carries no list at all, says so: an empty list, not the old reader.
  const viewed = viewedStep(view)
  // The step in view is the agents': Implement, and Verify until it turns to the person.
  const viewedAgents = viewed === "implement" || (viewed === "verify" && !inReview(task))
  // A finding of the other agent's review the agent already answered is a line in the Reviewer
  // findings row, not an item here.
  const stepItems = (task.items ?? []).filter(
    (item) => item.step === viewed && !(item.kind === "finding" && item.state === "settled"),
  )
  // While the agent asks, its card sits above the whole page; answers are marked on it.
  const focus = useFocus(task, view)
  const card = useQuestionCard()
  // The one live status: its pill in the header, which pins to one line on the way down.
  const pinned = usePinnedHeader(scroller)
  // The pill keeps its own clock; the page renders again only on the server's events.
  const statusNow = Date.now()
  const [topBar, setTopBar] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setTopBar(compact ? document.getElementById(TOP_BAR_TOOLS) : null)
  }, [compact])
  /** Needs you: the pill takes the person to what waits, on its page. */
  const goToStatus = () => {
    setDocumentFullSize(false)
    setDocumentRecord(null)
    setDocumentReturn(null)
    const target = statusOf(visibleTask, Date.now()).target
    // The page it opens is drawn by the next frames; the card is there then.
    const scrollTo = (selector: string) =>
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() =>
          document.querySelector(selector)?.scrollIntoView({ block: "start", behavior: "smooth" }),
        ),
      )
    if (target?.kind === "question") {
      if (!revealQuestion()) open(defaultDoc(task))
      return
    }
    if (target?.kind === "item") {
      open(target.view)
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => jumpToPart(jumpId(target.id))),
      )
      return
    }
    if (target?.kind === "need") {
      if (view !== "checkpoint" && view !== "verify") open("checkpoint")
      scrollTo(`#need-${target.for}`)
      return
    }
    open(target?.kind === "view" ? target.view : defaultDoc(task))
    scroller?.scrollTo({ top: 0, behavior: "smooth" })
  }
  const needs = task.live?.needs ?? []
  const openNeedsHere = needs.filter((n) => n.state !== "resolved")
  // A need the agent found stays as a receipt while the build is on.
  const foundNeeds = needs.filter(
    (n) => n.state === "resolved" && n.resolved !== null && statusNow - n.resolved < 2 * 3_600_000,
  )
  // A step page draws each need under the slice it blocks instead.
  const showNeeds =
    stepDoc === null &&
    (view === "checkpoint" || view === "verify") &&
    (openNeedsHere.length > 0 || foundNeeds.length > 0)
  // The tab of the step a need came up in counts it; it turns to you once the build waits.
  const stillOpen = needs.filter((n) => n.state === "open")
  const needTab =
    stillOpen.length > 0 && (task.stage === "implement" || task.stage === "verify")
      ? {
          step: task.stage,
          count: stillOpen.length,
          blocking: stillOpen.some((n) => n.waiting !== null),
        }
      : null
  const setNeed = async (forTask: string, note: string): Promise<boolean> => {
    try {
      await api.needSet(task.id, forTask, note)
      toast.success(`Sent. ${agentName(task.session?.agent ?? null)} checks for it now`)
      reload()
      return true
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
      return false
    }
  }
  // What a step page can do: the actions this page already has, by the ids the page knows.
  const forAgent = forAgentOf(task)
  const stepLive: StepLive = {
    ...(approvedUnstarted && (waitingHere !== null || (outlineHere && planner !== null))
      ? {
          buildHere: {
            ...(waitingHere !== null ? { waiting: waitingHere } : {}),
            ...(waitingHere === null && outlineHere && planner !== null
              ? {
                  offer: {
                    lead: `${agentName(planner.agent)}${planner.settings?.model ? ` · ${modelLabel(planner.settings.model)}` : ""}`,
                    start: () => startHere(planner),
                  },
                }
              : {}),
          },
        }
      : {}),
    buildArtifacts: {
      data: artifacts.list.data?.task ?? null,
      loading: artifacts.list.loading,
      error: artifacts.list.error,
      reload: artifacts.list.reload,
    },
    answer: (id, given) => {
      const item = flattenItems(task.items ?? []).find((i) => i.id === id)
      if (item !== undefined) answer(item, given)
    },
    ...(markTarget !== null && (stepDoc?.markdown ?? markdown) !== undefined
      ? {
          mark: (mark: ReaderMark) => markPassage(mark),
          markSource: steady.doc?.markdown ?? stepDoc?.markdown ?? markdown,
          askAbout: (words: string, anchor: Element) =>
            openQuickAsk(
              quoteMark(
                task,
                markTarget,
                view,
                steady.doc?.markdown ?? stepDoc?.markdown ?? markdown ?? "",
                words,
                anchor,
              ),
            ),
        }
      : {}),
    decide: (decision) => void decide(decision),
    ship: (choice) => void decide("approved", undefined, choice),
    question: questionActions,
    openArtifact: (name) => {
      const reference = parseArtifactReference(name)
      if (reference && (reference.scope === "project" || reference.section))
        artifacts.host.open(reference.file, reference.section)
      else open(pageArtifactFile(name, artifactItem(task.items ?? [], name)))
    },
    setNeed,
    copy: onCopy,
    open: (path) =>
      void api
        .openFile(task.id, path, "open")
        .then(() => toast.success(`Opened ${path.split("/").pop() ?? path}`))
        .catch((cause: unknown) =>
          toast.error(cause instanceof Error ? cause.message : String(cause)),
        ),
    dir: task.dir,
    copyDoc: {
      branch: task.branch ?? null,
      ...(forAgent !== undefined ? { forAgent } : {}),
      planExport: task.type === "feature" || task.type === "bugfix",
    },
    loadArtifact,
    loadDoc: (name) => api.doc(task.id, name).then((read) => read.markdown),
    loadEvidence,
    loadRecord: (evidence) =>
      api
        .evidence(task.id, evidence)
        .then((e) => (e.kind === "text" ? e.text : `evidence/${e.name}`)),
    theme,
    busy,
  }
  const taskTitleOf = (id: string) =>
    task.slices.flatMap((s) => s.tasks).find((t) => t.id.toUpperCase() === id.toUpperCase())
      ?.title ?? null
  const surfaceProps: TaskSurfaceProps = {
    task: visibleTask,
    api,
    view,
    version,
    activity: slow,
    theme,
    live: stepLive,
    step,
    tabs,
    onOpen: open,
    onRevealTurn: (origin) => {
      if (!revealQuestion(origin)) goToStatus()
    },
    ...(turnFocus?.task === task.id &&
    turnFocus.view === view &&
    turnFocus.navigation === focusNavigation &&
    turnFocus.questions.some((target) =>
      focusQuestions.some(
        (question) => question.id === target.id && question.asked === target.asked,
      ),
    )
      ? { turnFocus }
      : {}),
    onTurnFocusHandled: (sequence) =>
      setTurnFocus((current) => (current?.sequence === sequence ? null : current)),
    onOpenDoc: openDoc,
    onCopy,
    reload,
    onDeleted: () => {
      reload()
      void windows?.refresh()
      go({ view: "home" })
    },
    onPlanDiff: () => setDiffOpen(true),
    onPlanDecision: decide,
    // A task planned in the person's terminal: its waiting planner can build on the person's click.
    ...(terminalPlanner !== null
      ? {
          buildHere: {
            available: terminalPlanner.waiting === true,
            ...(terminalPlanner.waiting === true
              ? {}
              : { reason: `${agentName(terminalPlanner.agent ?? "")} is no longer waiting` }),
            lead: agentName(terminalPlanner.agent ?? ""),
            route: "terminal" as const,
            start: buildInTerminal,
          },
        }
      : !runsInApp(task) || task.outside
        ? {}
        : {
            buildHere: {
              available: buildHereReason === null,
              ...(buildHereReason !== null ? { reason: buildHereReason } : {}),
              ...(planner
                ? {
                    lead: `${agentName(planner.agent)}${planner.settings?.model ? ` · ${modelLabel(planner.settings.model)}` : ""}`,
                  }
                : {}),
              ...(waitingHere !== null ? { waiting: waitingHere } : {}),
              start: buildHere,
            },
          }),
    onReviewDecision: async (decision, remark, ship) => {
      const result = await decide(decision, remark, ship)
      if (result === false) {
        const reason = takeDecisionFailure()
        if (reason !== null) throw new Error(reason)
      }
      return result
    },
    onSidebar: showSidebar,
    ...(railOpen ? {} : { onOpenAgent: reopenSidebar }),
    onFullScreen,
    planning: { renderMedia: (item) => renderMedia(item) },
  }
  // Everything else is built: the need is the last thing before Verify.
  const lastBeforeVerify = (id: string) =>
    task.slices.every((s) =>
      s.tasks.every((t) => t.checked || t.id.toUpperCase() === id.toUpperCase()),
    )
  const pill = (
    <StatusPill
      task={visibleTask}
      compact={compact}
      onGo={goToStatus}
      onCopy={onCopy}
      onOpen={open}
    />
  )
  const gateHere = pendingGate(task) !== null && gateDocs(task).includes(view)
  const headerPlanApproval =
    viewed === "plan" && task.stage === "plan" && gateHere && !task.archived
  // A gate decided in the agent's window: the answers left here are comments now, not answers to send.
  const elsewhere =
    task.decidedElsewhere !== undefined &&
    viewed === (reviewGate(task)?.target === "final" ? "verify" : "plan")
      ? task.decidedElsewhere
      : undefined
  // The Plan draws its items inside its own page; the other steps keep the one card.
  // A step page draws everything in its own document, so none of these pages is drawn there.
  const oldPage = stepDoc === null
  const planPage =
    oldPage && view === fileOf(task, "plan") && task.items !== undefined && stepItems.length > 0
  // Implement and Verify have step pages only; a document without one has nothing to draw here.
  const implementPage = oldPage && view === "checkpoint" && task.timeline !== null
  const verifyPage = oldPage && view === "verify" && task.timeline !== null
  // Verify draws its own page once the person sent changes (their notes) or the task shipped.
  const reviewNotes =
    viewed === "verify" &&
    (task.stage === "shipped" ||
      (task.changesRequested?.notes.some((n) => n.state !== "checked") ?? false))
  const showItems =
    // A file read from the Files tab is the file alone; its step's items are on the step's page.
    !readsFile &&
    stepPhase(task, view) !== "future" &&
    oldPage &&
    elsewhere === undefined &&
    !reviewNotes &&
    !implementPage &&
    !verifyPage &&
    (stepItems.length > 0 || gateHere)
  const hasOpenItems = stepItems.some((item) => item.state !== "settled")
  const revisionRound = (reviewGate(task)?.round ?? 1) >= 2 && gateHere
  const settlingGate = reviewGate(task)
  const settledDecision =
    settlingGate?.target === (viewed === "verify" ? "final" : fileOf(task, "plan")) &&
    settlingGate.decision === "changes"
      ? "changes"
      : "approved"
  const settledLine =
    viewed === "plan" || viewed === "verify"
      ? settledLineFor(stepItems, revisionRound, settledDecision)
      : undefined
  const renderMedia = (item: Item) =>
    // A settled item of the final review is one line: what was decided, not the thing again.
    item.media !== undefined && !(item.step === "verify" && item.state === "settled") ? (
      <ItemMedia
        artifactHost={artifacts.host}
        media={item.media}
        theme={theme}
        loadArtifact={loadArtifact}
        loadEvidence={loadEvidence}
      />
    ) : undefined
  const sidebar = (
    <RightSidebar
      surface={surfaceProps}
      open={effectiveRailOpen}
      tab={sideTab}
      onTab={setSideTab}
      artifactCount={artifacts.count}
      artifactsNew={artifacts.fresh}
      onClose={closeSidebar}
      focusKey={focusKey}
      sheet={compact}
      headerToggle
      artifacts={(afterDrafts) => (
        <TaskArtifactsTab
          planned={planningOver(task)}
          state={artifacts}
          current={artifactFile !== null ? { where: artifacts.where, file: artifactFile } : null}
          onOpen={openArtifact}
          afterDrafts={afterDrafts}
        />
      )}
    />
  )
  // The quick field of this task: its marks send to the task's session, Conversation or Terminal.
  const quickAsk =
    markTarget !== null ? (
      <QuickAskHost task={task.id} agentName={agent.name} show={showConversation} />
    ) : null
  // A file opened by a link that is not a step's own page reads under a slim bar.
  const backTab =
    tabs.find((t) => t.step === viewedStep(view)) ?? tabs.find((t) => t.key === defaultDoc(task))
  const readerBar =
    unopened === undefined && readsFile ? (
      <ReaderBar
        detail={task}
        name={view}
        {...(fileInView !== undefined ? { file: fileInView } : {})}
        back={{
          label: backTab?.label ?? "the task",
          onClick: () => open(backTab?.key ?? defaultDoc(task)),
        }}
        api={api}
        onCopy={onCopy}
      />
    ) : null
  // Sections, or the path where the document has no sections, share the header row with Copy. The
  // The Plan page keeps the path in the task header's chip, so it has only the button.
  const shownOutline = outline
  const sectionTools =
    isDoc && content.data !== null ? (
      shownOutline.length > 0 ? (
        <OutlineButton
          entries={shownOutline}
          active={activeSection}
          onJump={jumpTo}
          path={docPath}
        />
      ) : planPage || readsFile ? null : (
        <span
          className="min-w-0 flex-1 truncate text-right font-mono text-[11.5px] text-muted-foreground"
          data-testid="doc-path"
        >
          {docPath}
        </span>
      )
    ) : null

  const docReader =
    isDoc && content.data !== null ? (
      <DocReader
        key={`${task.id}:${task.created}:${view}`}
        markdown={content.data?.markdown ?? ""}
        loadEvidence={loadEvidence}
        planExport={
          (task.type === "feature" || task.type === "bugfix") && view === fileOf(task, "plan")
        }
        unfolded
        {...(dimmed !== undefined ? { dimmed } : {})}
        {...(forAgent !== undefined && view === fileOf(task, "plan") ? { forAgent } : {})}
        {...(fileRole !== undefined
          ? {
              stepFile: {
                step: fileRole,
                task: task.slug,
                load: (name: string) => api.doc(task.id, name).then((read) => read.markdown),
              },
            }
          : {})}
        {...(sectionTools !== null ? { tools: sectionTools } : {})}
        theme={theme}
        loadArtifact={loadArtifact}
        {...(!closed && markTarget !== null
          ? { onMark: (mark: ReaderMark) => markPassage(mark) }
          : {})}
        {...(back !== null ? { back } : {})}
        at={jumpHere?.at ?? at}
        jumpKey={jumpHere?.n}
      />
    ) : null
  // The Plan's artifact shows as a preview that opens full size.
  const reader =
    docReader !== null ? (
      <ArtifactHostProvider value={artifacts.host}>{docReader}</ArtifactHostProvider>
    ) : null
  // The Plan read in full puts this in place of the page below, so it carries its own
  // sections column; Sections in the tools row is hidden where that column has room.
  const outlinedReader =
    reader !== null && outline.length > 0 ? (
      <div className="doc-with-outline">
        <div className="doc-main">{reader}</div>
        <OutlineColumn entries={outline} active={activeSection} onJump={jumpTo} />
      </div>
    ) : (
      reader
    )

  /** Closed, nothing stays on the right: this brings the sidebar back. */
  const sidebarToggle = (
    <SidebarButton
      shown={effectiveRailOpen}
      onOpen={() => (effectiveRailOpen ? closeSidebar() : reopenSidebar())}
    />
  )
  // The sidebar is a full-height column beside the page, a sibling of the left one; in a narrow
  // window it is a sheet from the right.
  const sidebarColumn = (
    <div
      className={cn(
        "ir-task-sidebar-column relative flex min-h-0 min-w-0 [&>aside]:flex-1",
        !effectiveRailOpen && "overflow-hidden",
      )}
    >
      {effectiveRailOpen && !compact && !terminalLayout?.rightActive ? (
        <Resizer
          side="left"
          label="Resize the sidebar"
          width={railSize.width}
          min={railSize.min}
          max={railSize.max}
          onResize={railSize.setWidth}
          onReset={railSize.reset}
          onDragging={onResizing}
          onCollapse={closeSidebar}
        />
      ) : null}
      {!compact ? sidebar : null}
    </div>
  )
  // Full screen, both sidebars give way to the artifact.
  const railShown = effectiveRailOpen && !fullScreen
  // The Review workspace opens from anywhere on the page, at any stage, at the file asked for.
  const reviewWorkspace = (
    <ReviewWorkspaceHost
      task={task}
      api={api}
      live={stepLive}
      reload={reload}
      {...(markTarget !== null && !closed
        ? { onMark: (mark: CodeMark) => openQuickAsk(codeMark(task, markTarget, mark)) }
        : {})}
    />
  )

  const buildDialog = (
    <Dialog
      key="build-start-choice"
      open={implementationChoice === task.id}
      onOpenChange={(open, details) =>
        open ? undefined : keepWhile(buildBusy, open, details, dismissImplementationChoice)
      }
    >
      <DialogContent
        className="q-build-launch-dialog max-h-[calc(100dvh-2rem)] overflow-hidden sm:max-w-[640px]"
        overlayProps={{ forceRender: true }}
        showCloseButton={!buildBusy}
        finalFocus={() => {
          const opener = buildOpener.current
          if (!opener || opener.task !== task.id || foreground.current.task !== task.id)
            return false
          const active = document.activeElement
          if (
            active instanceof HTMLElement &&
            active !== document.body &&
            active !== opener.element &&
            !active.closest(".q-build-launch-dialog")
          )
            return false
          if (opener.element?.isConnected) return opener.element
          return (
            Array.from(
              document.querySelectorAll<HTMLButtonElement>(
                '[data-testid="task-agent-build-ready"] .q-agent-ready-actions > button',
              ),
            ).find(
              (button) =>
                button.textContent?.trim() === "Start the build" &&
                button.getClientRects().length > 0 &&
                button.closest("[inert], [hidden]") === null,
            ) ?? true
          )
        }}
      >
        <DialogHeader>
          <DialogTitle>Start the build</DialogTitle>
          <DialogDescription className="sr-only">
            Choose where this Plan is built.
          </DialogDescription>
        </DialogHeader>
        <ImplementStart
          task={task.slug}
          planned={task.session?.agent ?? "claude-code"}
          flow={task.flow}
          onCopy={onCopy}
          onStarted={dismissImplementationChoice}
          onOpened={dismissImplementationChoice}
          onConfirmStart={confirmBuildStart}
          planApproved={
            task.stage !== "plan" || task.gate?.decision === "approved" || currentBuildApproved()
          }
          artifacts={{
            data: artifacts.list.data?.task ?? null,
            loading: artifacts.list.loading,
            error: artifacts.list.error,
            reload: artifacts.list.reload,
          }}
          confirmLabel={(selection) => {
            const approved = buildApproved() || task.stage !== "plan"
            if (!approved) return selection.runWhere === "app" ? "Approve & start" : "Approve"
            return selection.runWhere === "app"
              ? buildLaunchFailed
                ? "Retry start"
                : "Start the build"
              : // Outside the App the person asks their own agent; this only records where it builds.
                buildLaunchFailed
                ? "Retry"
                : "Done"
          }}
          onRemember={onBuildWhere}
          onCancel={dismissImplementationChoice}
          cancelDisabled={buildBusy}
          compact
        />
      </DialogContent>
    </Dialog>
  )

  const taskDialogs = (
    <TaskDialogs
      key="task-dialogs"
      task={task.id}
      compact={compact}
      fullScreen={fullScreen}
      sidebarOpen={effectiveRailOpen}
      foregroundOpen={implementationChoice === task.id}
      onSidebarChange={(open) => (open ? onRail(true) : closeSidebar())}
      sidebar={sidebar}
    >
      {buildDialog}
    </TaskDialogs>
  )

  // An artifact open full size: its thin bar and the artifact take the whole content area.
  if (artifactFile !== null) {
    const fromTab =
      tabs.find((t) => t.step === viewedStep(artifactFrom.current ?? "")) ??
      tabs.find((t) => t.key === defaultDoc(task))
    return (
      <>
        {reviewWorkspace}
        <div
          className={cn(
            "ir-task-frame grid min-h-0 flex-1 grid-rows-[auto_auto_minmax(0,1fr)]",
            !resizing && "transition-[grid-template-columns] duration-200 ease-ql",
          )}
          style={{
            gridTemplateColumns:
              railShown && !compact ? `minmax(0,1fr) ${effectiveRailWidth}px` : "minmax(0,1fr) 0px",
          }}
          data-testid="task-view"
          data-rail={railShown ? "open" : "closed"}
        >
          {/* The shell's header spans the grid, as a step page's does; the artifact is its main. */}
          <TaskArtifactView
            surface={surfaceProps}
            cost={cost.data}
            topBar={topBar}
            api={api}
            task={task}
            state={artifacts}
            file={artifactFile}
            onArtifactContext={bindArtifactContext}
            version={version + slow + artifactEvents}
            back={{
              label: backWords(fromTab?.label ?? "the task"),
              onClick: () => {
                onFullScreen(false)
                setDocumentFullSize(artifactReturnFull.current)
                setDocumentReturn(artifactReturnReading.current)
                go({
                  view: "task",
                  id: task.id,
                  doc: artifactFrom.current ?? fromTab?.key ?? defaultDoc(task),
                })
              },
            }}
            status={
              <StatusPill
                task={visibleTask}
                compact
                onGo={goToStatus}
                onCopy={onCopy}
                onOpen={open}
              />
            }
            rail={{
              open: railOpen,
              what: "Conversation and Files",
              onToggle: () => (railOpen ? closeSidebar() : reopenSidebar()),
            }}
            fullScreen={fullScreen}
            section={at}
            onFullScreen={onFullScreen}
            menu={menu}
            compact={compact}
            {...(markTarget !== null && !closed
              ? {
                  onMark: (mark: ArtifactPageMark, title: string) =>
                    openQuickAsk(artifactMark(task, markTarget, title, artifactFile, mark)),
                }
              : {})}
            reload={reload}
          />
          {quickAsk}
          {fullScreen ? <div /> : sidebarColumn}
        </div>
        {taskDialogs}
      </>
    )
  }

  return (
    <>
      {/* The sidebar is a full-height column beside the page, a sibling of the left one. */}
      {docMenu.menu}
      {quickAsk}
      {reviewWorkspace}
      <div
        className={cn(
          "ir-task-frame grid min-h-0 flex-1 grid-rows-[auto_auto_minmax(0,1fr)]",
          !resizing && "transition-[grid-template-columns] duration-200 ease-ql",
        )}
        style={{
          gridTemplateColumns:
            effectiveRailOpen && !compact
              ? `minmax(0,1fr) ${effectiveRailWidth}px`
              : "minmax(0,1fr) 0px",
        }}
        data-testid="task-view"
        data-rail={effectiveRailOpen ? "open" : "closed"}
      >
        <TaskTopBar {...surfaceProps} cost={cost.data} actions>
          <div
            className={cn("q-head", pinned && "pinned")}
            data-testid="task-head"
            data-pinned={pinned ? "true" : "false"}
            // A narrow window keeps one line in the shell's top bar: Menu, the title, the pill, the toggle.
            hidden={compact}
          >
            <div
              className={cn(
                "flex flex-1 items-center gap-2",
                compact ? "min-w-13" : "min-w-0 min-[900px]:min-w-40",
              )}
            >
              {menu ? (
                <TaskListToggle
                  look="ghost"
                  className="order-first shrink-0"
                  onOpen={menu.onOpen}
                />
              ) : null}
              <h1 className="q-title" title={task.title}>
                <span className="truncate">{task.title}</span>
              </h1>
              {!turnLayoutReady || (isDoc && content.data?.validation && errors.length > 0) ? (
                <div className="q-sub">
                  {/* Only a bug fix gets a tag here. */}
                  {tag !== null && !turnLayoutReady ? (
                    <span className="q-chip mono">{tag}</span>
                  ) : null}
                  {isDoc && content.data?.validation && errors.length > 0 ? (
                    <Popover>
                      <PopoverTrigger
                        render={
                          <Badge
                            variant="outline"
                            className={cn(
                              "h-[22px] cursor-pointer gap-1.5 px-2 text-xs",
                              writing || historicalFormat
                                ? "border-strong text-muted-foreground"
                                : "border-danger text-danger",
                            )}
                            render={
                              <button
                                type="button"
                                data-testid="checks-chip"
                                title="How this document compares with the current document format"
                              />
                            }
                          />
                        }
                      >
                        {writing ? (
                          <PencilLineIcon className="size-3" />
                        ) : historicalFormat ? (
                          <FileTextIcon className="size-3" />
                        ) : (
                          <CircleXIcon className="size-3" />
                        )}
                        {historicalFormat
                          ? `Older document format · ${errors.length} finding${errors.length === 1 ? "" : "s"}`
                          : writing
                            ? `being written · ${errors.length} format finding${errors.length === 1 ? "" : "s"}`
                            : `Document format · ${errors.length} finding${errors.length === 1 ? "" : "s"}`}
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        className="w-[380px] max-w-[calc(100vw-24px)] max-h-[70vh] overflow-y-auto"
                      >
                        <p className="m-0 mb-2 text-[13px] font-semibold">
                          {writing && !historicalFormat
                            ? "Still being written"
                            : "Document format findings"}
                        </p>
                        <p className="m-0 mb-2 text-[13px] text-muted-foreground">
                          {historicalFormat
                            ? "These findings compare this saved document with the current format. Code check results are shown in Verify."
                            : writing
                              ? `${agent.name} fills these parts before it asks for your approval; nothing here needs you.`
                              : "These findings concern the document format. Code check results are shown in Verify."}
                        </p>
                        <div className="grid gap-2">
                          {[...errors, ...warnings].map((c) => (
                            <div key={`${c.rule}-${c.line}-${c.message}`} className="text-[13px]">
                              <span
                                className={cn(
                                  "font-mono text-xs",
                                  c.severity === "error" && !writing && !historicalFormat
                                    ? "text-danger"
                                    : "text-muted-foreground",
                                )}
                              >
                                {c.rule} · line {c.line}
                              </span>
                              <p className="m-0">{c.message}</p>
                              {c.fix_hint !== "" ? (
                                <p className="m-0 text-xs text-muted-foreground">{c.fix_hint}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="q-tools">
              {/* Where the head is hidden, the shell's bar holds the chip instead (below). */}
              {compact ? null : pill}
              {compact && topBar !== null ? null : sidebarToggle}
            </div>
          </div>
          {/* A narrow window's top bar: the pill and the toggle. */}
          {compact && topBar !== null
            ? createPortal(
                <span
                  className="ir-pinned-status flex flex-none items-center gap-2"
                  data-testid={turnLayoutReady ? "top-bar-live-status" : "top-bar-task-tools"}
                >
                  {/* The header the bar stands in for is hidden: the agent's chip keeps its name here. */}
                  {pill}
                  {sidebarToggle}
                </span>,
                topBar,
              )
            : null}

          {/* The page grid places its parts in order: pinned, an empty cell holds the tabs' place, so
              the document and the sidebar never slide one cell along (selecting text scrolls and pins). */}
          {pinned ? <div className="ir-step-tabs-cell" aria-hidden="true" /> : null}
          <div hidden={pinned} data-testid="step-tabs-row">
            <StepTabs
              tabs={tabs}
              badges={!turnLayoutReady}
              // A change handed back as too small is over: nothing in it counts as open.
              items={
                closed || task.archived || task.handedBack !== undefined
                  ? undefined
                  : visibleTask.items
              }
              needs={needTab}
              view={view}
              starting={task.action === "implement"}
              onOpen={open}
              approves
            />
          </div>
        </TaskTopBar>
        <main className="@container flex min-h-0 min-w-0 flex-col">
          {task.archived ? (
            <p
              className="m-0 flex items-center gap-3 border-b border-line bg-surface-2 px-8 py-2 text-[13px] text-muted-foreground"
              data-testid="archived-banner"
            >
              <ArchiveIcon className="size-4" />
              {task.earlier === true
                ? "Archived: an earlier-workflow task cannot be continued; its files stay as they are."
                : "Archived: no agent picks this task up until you restore it."}
              {task.earlier === true ? null : (
                <Button variant="outline" size="sm" onClick={() => void archive(false)}>
                  <ArchiveRestoreIcon />
                  Restore
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="text-coral"
                title="Delete this task and its files for good"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2Icon />
                Delete…
              </Button>
            </p>
          ) : null}
          {task.earlier === true ? (
            <p
              className="m-0 flex items-center gap-3 border-b border-line bg-surface-2 px-8 py-2 text-[13px] text-muted-foreground"
              data-testid="earlier-banner"
            >
              <FileTextIcon className="size-4" />
              Earlier workflow: this task was made before the three steps. It cannot be continued;
              its files stay as they are. Open them under Files.
            </p>
          ) : null}
          <Dialog open={diffOpen} onOpenChange={setDiffOpen}>
            <DialogContent className="w-[min(960px,90vw)] max-w-none sm:max-w-none">
              <DialogHeader>
                <DialogTitle>What the agent changed in the Plan</DialogTitle>
                <DialogDescription>
                  Since you last sent changes. Lines the agent added are marked +, lines it removed
                  −.
                </DialogDescription>
              </DialogHeader>
              <div className="q-diff max-h-[60vh] overflow-auto" data-testid="plan-diff">
                {(task.planDiff ?? "").split("\n").map((line, index) => (
                  <div
                    // The lines of one diff never reorder.
                    // biome-ignore lint/suspicious/noArrayIndexKey: a diff has no ids
                    key={index}
                    className={`q-ln${line.startsWith("+") ? " add" : line.startsWith("-") ? " del" : ""}`}
                  >
                    {line}
                  </div>
                ))}
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete “{task.title}”?</DialogTitle>
                <DialogDescription>
                  Its plan folder
                  {` (docs/plans/${task.slug})`} and its state are removed from this computer.
                  Commits and branches in git stay.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="items-center sm:justify-between">
                {task.archived ? (
                  <span />
                ) : (
                  <button
                    type="button"
                    className="q-link"
                    onClick={() => {
                      setConfirmDelete(false)
                      void archive(true)
                    }}
                  >
                    Archive it instead
                  </button>
                )}
                <span className="flex gap-2">
                  <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Button>
                  <Button variant="destructive" onClick={() => void remove()}>
                    Delete for good
                  </Button>
                </span>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {decisionError !== null ? (
            <p
              role="alert"
              className="m-0 flex flex-wrap items-baseline gap-x-3 border-b border-line bg-danger-soft px-8 py-2 text-[13px] text-danger"
            >
              <span className="min-w-0">{decisionError}</span>
              <ReportThis error={decisionError} className="ml-auto" />
            </p>
          ) : null}

          <TaskWorkspace now={<YourTurn {...surfaceProps} />}>
            <DocumentWorkspace {...surfaceProps}>
              <div className="flex min-h-0 flex-1">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  {readerBar}
                  <div
                    ref={setScroller}
                    data-testid="task-scroll"
                    data-scroll-root
                    // A narrow pane on a desktop keeps a 48 px gutter with every + shown; a phone
                    // gives the words that width and shows a + when its block is tapped (reader.css).
                    className="min-h-0 flex-1 overflow-auto @max-[680px]:[&_.page]:pr-5 max-[680px]:[&_.page]:pl-5 min-[681px]:@max-[680px]:[&_.page]:pl-12 min-[681px]:@max-[680px]:[&_.block-add]:opacity-100"
                  >
                    <StepWork {...surfaceProps} documentReader={outlinedReader}>
                      {showNeeds && !turnLayoutReady && !autonomous(task) && !viewedAgents ? (
                        <div className="q-body pb-0 grid gap-3" data-testid="needs">
                          {foundNeeds.map((n) => (
                            <NeedReceipt key={`${n.for}-found`} need={n} agent={agent.name} />
                          ))}
                          {openNeedsHere.map((n) => (
                            <NeedCard
                              key={n.for}
                              need={n}
                              agent={agent.name}
                              taskTitle={taskTitleOf(n.for)}
                              last={lastBeforeVerify(n.for)}
                              compact={compact}
                              review={viewed === "verify"}
                              onSet={(note) => setNeed(n.for, note)}
                            />
                          ))}
                        </div>
                      ) : null}
                      {/* The shared Plan header owns approval while its whole document is read too. */}
                      {!turnLayoutReady &&
                      !headerPlanApproval &&
                      (!readsFile || gateHere) &&
                      stepDoc === null ? (
                        <StepActions
                          step={step}
                          busy={busy}
                          items={elsewhere !== undefined ? undefined : stepItems}
                          answers={answers}
                          onApprove={() => void decide("approved")}
                          onChanges={() => void decide("changes")}
                          elsewhere={elsewhere}
                          onDiff={() => setDiffOpen(true)}
                          onComment={() => showSidebar("comments")}
                          {...(task.review?.approve !== undefined &&
                          pendingGate(task) === "final" &&
                          viewed === "verify"
                            ? {
                                ship: {
                                  choices: task.review.approve,
                                  ready:
                                    stepItems.length > 0 &&
                                    stepItems.every((i) => i.state === "settled"),
                                  onShip: (choice: "pull-request" | "only" | "commands") =>
                                    void decide("approved", undefined, choice),
                                },
                              }
                            : {})}
                          onOpen={open}
                          onCopy={onCopy}
                        />
                      ) : null}
                      {!turnLayoutReady &&
                      ((!autonomous(task) && !viewedAgents) || focus?.kind === "approved") &&
                      focus !== null &&
                      (focus.kind !== "answered" || focus.last.via !== "app") &&
                      unopened === undefined ? (
                        <FocusQuestion
                          key={focus.kind === "asking" ? focus.question.id : focus.kind}
                          task={task}
                          focus={focus}
                          doc={view}
                          theme={theme}
                          cardRef={card.ref}
                          onOpenDoc={openDoc}
                          actions={questionActions}
                          artifactTask={{ id: task.id, api }}
                          onOpenArtifact={open}
                          {...(step.fact !== undefined ? { fact: step.fact } : {})}
                        />
                      ) : null}
                      {showItems && !turnLayoutReady ? (
                        <div className="q-body pb-0" data-testid="step-items">
                          <NeedsYou
                            items={
                              // From the second round, what you decided in the questions folds into the kept line.
                              revisionRound
                                ? stepItems.map((i) =>
                                    i.state === "settled" && i.settledAt === undefined
                                      ? { ...i, settledAt: reviewGate(task)?.opened ?? 1 }
                                      : i,
                                  )
                                : stepItems
                            }
                            answers={answers}
                            onAnswer={answer}
                            renderMedia={renderMedia}
                            keepSettled={viewed === "verify"}
                            {...(settledLine !== undefined ? { settledLine } : {})}
                            empty={
                              viewed === "verify"
                                ? "Nothing needs a closer look; read the change and approve."
                                : viewed === "plan"
                                  ? "Nothing needs a closer look; read the Plan and approve."
                                  : "Nothing needs a closer look; read it and approve."
                            }
                            side={
                              viewed === "plan" && hasOpenItems
                                ? revisionRound
                                  ? "the rest of your first review still stands"
                                  : "you can also give feedback anywhere in the Plan"
                                : undefined
                            }
                          />
                        </div>
                      ) : null}
                      {/* One surface, not two: the Agent tab carries the card while it is in view, the page
                          only when the sidebar is closed or shows another tab. */}
                      {startupRun?.startupPrompt !== undefined &&
                      !(railOpen && terminalLayout?.panel === "terminal") ? (
                        <div className="q-body pb-0" data-testid="startup-prompt-slot">
                          <StartupPromptCard
                            agent={startupAgent}
                            kind={startupRun.startupPrompt}
                            onOpen={() => {
                              chooseWindowView(startupRun.id, "terminal")
                              showSidebar("files")
                              terminalLayout?.setPanel("terminal")
                            }}
                          />
                        </div>
                      ) : null}
                      {steady.doc !== null ? (
                        <ArtifactHostProvider value={artifacts.host}>
                          {/* A step renders from its own folder (steps/<step>/Page.tsx). */}
                          <StepPage
                            task={task}
                            document={steady.doc}
                            sections={steady.sections}
                            state={stepState(visibleTask, steady.doc, {
                              answers,
                              mode: "live",
                            })}
                            mode="live"
                            live={stepLive}
                            api={api}
                            reload={reload}
                          />
                        </ArtifactHostProvider>
                      ) : unopened !== undefined ? (
                        writingQuiet !== null ? (
                          <StepQuiet
                            step={writingQuiet.step}
                            kind={stepIsWorking(task) ? "writing" : "draft"}
                            back={
                              writingQuiet.back === null
                                ? null
                                : {
                                    label: writingQuiet.back.label,
                                    open: () => open(writingQuiet.back?.to ?? view),
                                  }
                            }
                          />
                        ) : writingStep !== null ? (
                          // A step not reached yet: its name, what happens there and who writes it.
                          <StepQuiet
                            step={writingStep}
                            kind="future"
                            back={
                              writingBefore === null
                                ? null
                                : {
                                    label: writingBefore.label,
                                    open: () => open(stepView(task, writingBefore.id)),
                                  }
                            }
                          />
                        ) : (
                          <p className="q-body q-dim m-0" data-testid="step-not-started">
                            {unopened.sentence ?? ""}
                          </p>
                        )
                      ) : view === "checkpoint" || view === "verify" ? (
                        <div className="px-10 py-16 text-muted-foreground">
                          {["implement", "verify", "shipped"].includes(task.stage)
                            ? "The build's record is not available."
                            : "Implement starts once the Plan is approved."}
                        </div>
                      ) : view === "implement" &&
                        task.action === "implement" &&
                        !managedRun &&
                        buildsNext !== null ? (
                        // Approved for its own outside session: no start card while it gets going.
                        <p className="q-body q-dim m-0" data-testid="implement-builds-next">
                          {buildsNext}
                        </p>
                      ) : view === "implement" && task.action === "implement" && !managedRun ? (
                        <div className="px-8 py-6 @max-[900px]:px-5">
                          {/* What to do with the card, above it: the pill says whose move it is. */}
                          <p className="m-0 mb-3 text-[13.5px] text-muted-foreground">
                            <StartSay />
                          </p>
                          <ImplementStart
                            task={task.slug}
                            planned={agent.id}
                            flow={task.flow}
                            onCopy={onCopy}
                            artifacts={{
                              data: artifacts.list.data?.task ?? null,
                              loading: artifacts.list.loading,
                              error: artifacts.list.error,
                              reload: artifacts.list.reload,
                            }}
                          />
                        </div>
                      ) : view === "implement" ? (
                        <p className="q-body q-dim m-0" data-testid="implement-start-note">
                          The agents build the Plan slice by slice, every task test first. Each
                          slice, what it decided on its own and what changed shows here as it goes.
                        </p>
                      ) : content.data !== null ? (
                        <div className={outline.length > 0 ? "doc-with-outline" : undefined}>
                          <div className={outline.length > 0 ? "doc-main" : undefined}>
                            {additions !== null && viewedStep(view) === additions.stage ? (
                              <p
                                className="m-0 mx-8 mt-6 max-w-[716px] rounded-lg border border-line bg-sunken px-3 py-2 text-[12.5px] @max-[900px]:mx-5"
                                data-testid="also-in-review"
                              >
                                <b>Also in this review:</b> {additions.count}{" "}
                                {additions.count === 1 ? "addition" : "additions"} to{" "}
                                {additions.docs.map((d, i) => (
                                  <span key={d.name}>
                                    {i > 0 ? ", " : ""}
                                    <button
                                      type="button"
                                      className="cursor-pointer underline underline-offset-2"
                                      onClick={() => openDoc(d.name, d.anchor)}
                                    >
                                      {d.words}
                                    </button>
                                  </span>
                                ))}
                                , from {additions.from}.
                              </p>
                            ) : null}
                            {/* Below the cards, the document has their width and gutters. */}
                            <div className={planPage ? "plan-reader" : undefined}>{reader}</div>
                          </div>
                          {shownOutline.length > 0 ? (
                            <OutlineColumn
                              entries={shownOutline}
                              active={activeSection}
                              onJump={jumpTo}
                            />
                          ) : null}
                        </div>
                      ) : task.handedBack !== undefined ? null : (
                        <div className="px-10 py-8">
                          <LoadingState
                            kind="task"
                            what={`Opening the ${tabs.find((tab) => tab.key === view)?.label ?? "page"}`}
                            error={content.error}
                            failedTitle="This page didn't open"
                            onRetry={content.reload}
                          />
                        </div>
                      )}
                    </StepWork>
                  </div>
                </div>
              </div>
            </DocumentWorkspace>
          </TaskWorkspace>
        </main>
        {sidebarColumn}
      </div>
      {taskDialogs}
    </>
  )
}
