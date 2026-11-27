// One task: the header (title, the file chip, Cost, Archive and Delete), the three step tabs, the
// step line of the step in view, the Needs you card, the document or view, and the right sidebar
// (Conversation, Terminal and Files) as a column beside it. Marking text, an artifact or code lines
// opens the quick field, which sends to the task's session. In a narrow window the sidebar is a sheet.

import { cn } from "cn"
import { useCallback, useRef, useState } from "react"
import type { Item } from "../core/items.ts"
import { artifactFileOfView, planningOver, TaskArtifactsTab } from "./artifact/TaskArtifact.tsx"
import { ChatPage } from "./chat/ChatPage.tsx"
import { viewFile } from "./DocPathChip.tsx"
import { DocumentWorkspace } from "./docs/DocumentWorkspace.tsx"
import { useDocumentRecord } from "./docs/mode.ts"
import { ItemMedia } from "./ItemMedia.tsx"
import { StepWork } from "./interaction/StepWork.tsx"
import { TaskWorkspace } from "./interaction/TaskWorkspace.tsx"
import { defaultDoc, fileOf } from "./model.ts"
import { QuickAskHost } from "./quick-ask/QuickAsk.tsx"
import { openQuickAsk } from "./quick-ask/store.ts"
import { codeMark } from "./quick-ask/task-marks.ts"
import { ReviewWorkspaceHost } from "./review-workspace/Host.tsx"
import type { CodeMark } from "./review-workspace/ReviewWorkspace.tsx"
import { useOptionalRuns } from "./run-context.tsx"
import { buildRunForTask } from "./runs-api.ts"
import { SidebarButton } from "./sidebar/HeaderButtons.tsx"
import { RightSidebar } from "./sidebar/RightSidebar.tsx"
import { StatusPill } from "./status/StatusPill.tsx"
import { forAgentOf } from "./step-page/StepTools.tsx"
import { TaskDialogs } from "./task-view/TaskDialogs.tsx"
import { TaskArtifactFrame } from "./task-view-artifact.tsx"
import { TaskPrimaryBody } from "./task-view-body.tsx"
import { useTaskViewController } from "./task-view-controller.ts"
import { TaskStepControls } from "./task-view-controls.tsx"
import { TaskBuildDialog, TaskDeleteDialog, TaskPlanDiffDialog } from "./task-view-dialogs.tsx"
import { TaskBanners, TaskHeaderSection, TaskSidebarColumn } from "./task-view-header.tsx"
import { buildTaskDocReaders } from "./task-view-reader.tsx"
import { buildStepLive, buildSurfaceProps } from "./task-view-surface.tsx"
import { RAIL_FALLBACK, type TaskViewProps, TOP_BAR_TOOLS, viewOf } from "./task-view-types.ts"
import { YourTurn } from "./turn/YourTurn.tsx"
import { artifactViewing, ViewingProvider } from "./viewing.tsx"

export { defaultDoc, TOP_BAR_TOOLS }

function useTaskViewDocSelection(props: TaskViewProps) {
  const implicitPlan = useRef({
    task: props.task.id,
    hold: props.doc === null && props.task.stage === "plan",
  })
  if (implicitPlan.current.task !== props.task.id)
    implicitPlan.current = { task: props.task.id, hold: false }
  if (props.doc !== null || (props.task.stage !== "plan" && props.task.action !== "implement"))
    implicitPlan.current.hold = false
  else if (props.task.stage === "plan") implicitPlan.current.hold = true
  return props.doc === null && implicitPlan.current.hold && props.task.action === "implement"
    ? fileOf(props.task, "plan")
    : props.doc
}

function resolveViewingLocation(
  task: TaskViewProps["task"],
  selectedDoc: string | null,
  recordTaskId: string | undefined,
) {
  if (recordTaskId === task.id) return null
  const view = viewOf(task, selectedDoc)
  const artifact = artifactFileOfView(view)
  if (artifact !== null) return artifactViewing(artifact)
  const file = viewFile(task, view)
  return file?.exists ? { doc: file.name } : null
}

function resolveChatSnapshot(
  task: TaskViewProps["task"],
  handoffTask: string | undefined,
  snapshot: TaskViewProps["task"] | undefined,
) {
  if (task.type === "chat") return task
  if (!task.archived && handoffTask === task.id && snapshot?.id === task.id) return snapshot
  return undefined
}

export function TaskView(props: TaskViewProps) {
  const [handoffTask, setHandoffTask] = useState<string>()
  const chatSnapshot = useRef<TaskViewProps["task"] | undefined>(undefined)
  if (props.task.type === "chat") chatSnapshot.current = props.task
  const handoffFlight = useCallback(
    (active: boolean) => {
      setHandoffTask((current) =>
        active ? props.task.id : current === props.task.id ? undefined : current,
      )
    },
    [props.task.id],
  )
  const chatTask = resolveChatSnapshot(props.task, handoffTask, chatSnapshot.current)
  const windows = useOptionalRuns()
  const record = useDocumentRecord()
  const eligible =
    (props.task.viewingEligible ?? props.task.session !== null) ||
    (windows?.runs.some((run) => buildRunForTask(run, props.task.id)) ?? false)
  const selectedDoc = useTaskViewDocSelection(props)
  const location = resolveViewingLocation(props.task, selectedDoc, record?.taskId)
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

function TaskViewContent(props: TaskViewProps) {
  const {
    at,
    version,
    artifacts: artifactEvents = 0,
    theme,
    api,
    go,
    reload,
    onCopy,
    onBuildWhere,
    railOpen,
    onRail,
    railSize = RAIL_FALLBACK,
    resizing = false,
    onResizing,
    fullScreen = false,
    onFullScreen = () => {},
    menu = null,
  } = props
  const c = useTaskViewController(props)
  const forAgent = forAgentOf(c.task)
  const outsideTask = c.outsideTask
  const agentTabVisible =
    railOpen && Boolean(c.terminalLayout?.rightActive && c.terminalLayout.panel === "terminal")
  const stepLive = buildStepLive({
    task: c.task,
    api,
    reload,
    view: c.view,
    theme,
    busy: c.approval.busy,
    forAgent,
    artifacts: c.artifacts,
    answer: c.answer,
    markTarget: c.markTarget,
    stepDoc: c.stepDoc,
    steadyDoc: c.steady.doc,
    markdown: c.docState.markdown,
    markPassage: c.markPassage,
    decide: c.approval.decide,
    questionActions: c.questionActions,
    open: c.open,
    setNeed: c.setNeed,
    onCopy,
    loadArtifact: c.loadArtifact,
    loadEvidence: c.loadEvidence,
    handoff: c.handoff,
    ...(agentTabVisible ? {} : { onOpenAgent: c.sidebarState.showConversation }),
  })
  const renderMedia = (item: Item) =>
    item.media !== undefined && !(item.step === "verify" && item.state === "settled") ? (
      <ItemMedia
        artifactHost={c.artifacts.host}
        media={item.media}
        theme={theme}
        loadArtifact={c.loadArtifact}
        loadEvidence={c.loadEvidence}
      />
    ) : undefined
  const surfaceProps = buildSurfaceProps({
    task: c.task,
    visibleTask: c.visibleTask,
    api,
    view: c.view,
    version,
    slow: c.slow,
    theme,
    stepLive,
    step: c.derived.step,
    tabs: c.derived.tabs,
    open: c.open,
    revealQuestion: c.turnFocusState.revealQuestion,
    goToStatus: c.goToStatus,
    activeTurnFocus: c.activeTurnFocus,
    onTurnFocusHandled: (sequence) =>
      c.turnFocusState.setTurnFocus((current) => (current?.sequence === sequence ? null : current)),
    openDoc: c.openDoc,
    onCopy,
    reload,
    windows: c.windows,
    go,
    onPlanDiff: () => c.setDiffOpen(true),
    decide: c.approval.decide,
    takeDecisionFailure: c.approval.takeDecisionFailure,
    handoff: c.handoff,
    showSidebar: c.sidebarState.showSidebar,
    railOpen,
    agentTabVisible,
    reopenSidebar: c.sidebarState.reopenSidebar,
    showConversation: c.sidebarState.showConversation,
    onFullScreen,
    renderMedia,
  })
  const sidebar = (
    <RightSidebar
      surface={surfaceProps}
      open={railOpen}
      tab={c.sidebarState.sideTab}
      onTab={c.sidebarState.setSideTab}
      artifactCount={c.artifacts.count}
      artifactsNew={c.artifacts.fresh}
      filesFirst={outsideTask}
      onClose={c.sidebarState.closeSidebar}
      focusKey={c.sidebarState.focusKey}
      sheet={c.compact}
      headerToggle
      artifacts={(afterDrafts) => (
        <TaskArtifactsTab
          planned={planningOver(c.task)}
          state={c.artifacts}
          current={
            c.artifactFile !== null ? { where: c.artifacts.where, file: c.artifactFile } : null
          }
          onOpen={c.openArtifact}
          afterDrafts={afterDrafts}
        />
      )}
    />
  )
  const quickAsk =
    c.markTarget !== null ? (
      <QuickAskHost
        task={c.task.id}
        agentName={c.derived.agent.name}
        show={c.sidebarState.showConversation}
      />
    ) : null
  const sidebarColumn = (
    <TaskSidebarColumn
      effectiveRailOpen={railOpen}
      compact={c.compact}
      terminalRightActive={Boolean(c.terminalLayout?.rightActive)}
      railSize={railSize}
      onResizing={onResizing}
      closeSidebar={c.sidebarState.closeSidebar}
      sidebar={sidebar}
    />
  )
  const markTarget = c.markTarget
  const reviewWorkspace = (
    <ReviewWorkspaceHost
      task={c.task}
      api={api}
      live={stepLive}
      reload={reload}
      {...(markTarget !== null && !c.derived.closed
        ? { onMark: (mark: CodeMark) => openQuickAsk(codeMark(c.task, markTarget, mark)) }
        : {})}
    />
  )
  const taskDialogs = (
    <TaskDialogs
      key="task-dialogs"
      task={c.task.id}
      compact={c.compact}
      fullScreen={fullScreen}
      sidebarOpen={railOpen}
      foregroundOpen={c.approval.implementationChoice === c.task.id}
      onSidebarChange={(nextOpen) => (nextOpen ? onRail(true) : c.sidebarState.closeSidebar())}
      sidebar={sidebar}
    >
      <TaskBuildDialog
        task={c.task}
        approval={c.approval}
        foreground={c.foreground}
        artifacts={c.artifacts}
        onCopy={onCopy}
        onBuildWhere={onBuildWhere}
      />
    </TaskDialogs>
  )
  if (c.artifactFile !== null) {
    return (
      <TaskArtifactFrame
        reviewWorkspace={reviewWorkspace}
        resizing={resizing}
        railShown={railOpen && !fullScreen}
        compact={c.compact}
        effectiveRailWidth={c.effectiveRailWidth}
        surfaceProps={surfaceProps}
        costData={c.cost.data}
        topBar={c.topBar}
        api={api}
        task={c.task}
        visibleTask={c.visibleTask}
        artifacts={c.artifacts}
        artifactFile={c.artifactFile}
        artifactFrom={c.artifactFrom.current}
        artifactReturnFull={c.artifactReturnFull.current}
        artifactReturnReading={c.artifactReturnReading.current}
        tabs={c.derived.tabs}
        bindArtifactContext={c.bindArtifactContext}
        version={version + c.slow + artifactEvents}
        go={go}
        goToStatus={c.goToStatus}
        onCopy={onCopy}
        open={c.open}
        railOpen={railOpen}
        closeSidebar={c.sidebarState.closeSidebar}
        reopenSidebar={c.sidebarState.reopenSidebar}
        fullScreen={fullScreen}
        at={at}
        onFullScreen={onFullScreen}
        menu={menu}
        markTarget={c.markTarget}
        closed={c.derived.closed}
        reload={reload}
        quickAsk={quickAsk}
        sidebarColumn={sidebarColumn}
        taskDialogs={taskDialogs}
      />
    )
  }
  const { reader, outlinedReader, readerBar } = buildTaskDocReaders({
    task: c.task,
    view: c.view,
    at,
    isDoc: c.isDoc,
    readsFile: c.readsFile,
    readsPlanReview: c.readsPlanReview,
    fileInView: c.fileInView,
    contentData: c.content.data,
    derived: c.derived,
    docState: c.docState,
    artifacts: c.artifacts,
    api,
    theme,
    forAgent,
    loadArtifact: c.loadArtifact,
    loadEvidence: c.loadEvidence,
    markTarget: c.markTarget,
    markPassage: c.markPassage,
    back: c.back,
    open: c.open,
    onCopy,
  })
  return (
    <>
      {c.docMenu.menu}
      {quickAsk}
      {reviewWorkspace}
      <div
        className={cn(
          "ir-task-frame grid min-h-0 flex-1 grid-rows-[auto_auto_minmax(0,1fr)]",
          !resizing && "transition-[grid-template-columns] duration-200 ease-ql",
        )}
        style={{
          gridTemplateColumns:
            railOpen && !c.compact
              ? `minmax(0,1fr) ${c.effectiveRailWidth}px`
              : "minmax(0,1fr) 0px",
        }}
        data-testid="task-view"
        data-rail={railOpen ? "open" : "closed"}
      >
        <TaskHeaderSection
          surfaceProps={surfaceProps}
          costData={c.cost.data}
          task={c.task}
          visibleTask={c.visibleTask}
          view={c.view}
          pinned={c.pinned}
          compact={c.compact}
          topBar={c.topBar}
          menu={menu}
          turnLayoutReady={c.turnLayoutReady}
          isDoc={c.isDoc}
          hasValidation={Boolean(c.content.data?.validation)}
          derived={c.derived}
          pill={
            <StatusPill
              task={c.visibleTask}
              compact={c.compact}
              onGo={c.goToStatus}
              onCopy={onCopy}
              onOpen={c.open}
            />
          }
          sidebarToggle={
            <SidebarButton
              shown={railOpen}
              onOpen={() =>
                railOpen ? c.sidebarState.closeSidebar() : c.sidebarState.reopenSidebar()
              }
            />
          }
          onOpen={c.open}
        />
        <main className="@container flex min-h-0 min-w-0 flex-col">
          <TaskBanners
            task={c.task}
            decisionError={c.approval.decisionError}
            onRestore={() => void c.archive(false)}
            onConfirmDelete={() => c.setConfirmDelete(true)}
          />
          <TaskPlanDiffDialog
            open={c.diffOpen}
            onOpenChange={c.setDiffOpen}
            planDiff={c.task.planDiff}
          />
          <TaskDeleteDialog
            open={c.confirmDelete}
            onOpenChange={c.setConfirmDelete}
            task={c.task}
            onArchive={() => void c.archive(true)}
            onDelete={() => void c.remove()}
          />
          <TaskWorkspace now={<YourTurn {...surfaceProps} />}>
            <DocumentWorkspace {...surfaceProps}>
              <div className="flex min-h-0 flex-1">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  {readerBar}
                  <div
                    ref={c.docState.setScroller}
                    data-testid="task-scroll"
                    data-scroll-root
                    className="min-h-0 flex-1 overflow-auto @max-[680px]:[&_.page]:pr-5 max-[680px]:[&_.page]:pl-5 min-[681px]:@max-[680px]:[&_.page]:pl-12 min-[681px]:@max-[680px]:[&_.block-add]:opacity-100"
                  >
                    <StepWork {...surfaceProps} documentReader={outlinedReader}>
                      <TaskStepControls
                        task={c.task}
                        view={c.view}
                        theme={theme}
                        api={api}
                        compact={c.compact}
                        turnLayoutReady={c.turnLayoutReady}
                        readsPlanReview={c.readsPlanReview}
                        derived={c.derived}
                        answers={c.answers}
                        answer={c.answer}
                        renderMedia={renderMedia}
                        busy={c.approval.busy}
                        decide={c.approval.decide}
                        onDiff={() => c.setDiffOpen(true)}
                        showSidebar={c.sidebarState.showSidebar}
                        open={c.open}
                        openDoc={c.openDoc}
                        onCopy={onCopy}
                        setNeed={c.setNeed}
                        focus={c.focus}
                        card={c.card}
                        questionActions={c.questionActions}
                        startupRun={c.startupRun}
                        startupAgent={c.startupAgent}
                        railOpen={railOpen}
                        terminalLayout={c.terminalLayout}
                      />
                      <TaskPrimaryBody
                        task={c.task}
                        visibleTask={c.visibleTask}
                        view={c.view}
                        managedRun={c.managedRun}
                        buildsNext={c.buildsNext}
                        steady={c.steady}
                        artifacts={c.artifacts}
                        answers={c.answers}
                        stepLive={stepLive}
                        api={api}
                        reload={reload}
                        derived={c.derived}
                        open={c.open}
                        openDoc={c.openDoc}
                        onCopy={onCopy}
                        onBuildHere={() => c.approval.openBuildChoice()}
                        contentData={c.content.data}
                        contentError={c.content.error}
                        reloadContent={c.content.reload}
                        outline={c.docState.outline}
                        activeSection={c.docState.activeSection}
                        jumpTo={c.docState.jumpTo}
                        reader={reader}
                      />
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
