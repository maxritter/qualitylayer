// The Cockpit: one shell, three routes, one push stream that invalidates each affected
// query. The open task also re-reads liveness every thirty seconds. The task list and the
// Comments panel are columns: open, they take their width and the middle column
// gets narrower; closed, they take none.

import { cn } from "cn"
import { type ContextType, type ReactNode, useCallback, useMemo, useState } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { taskContextTarget } from "./agent-window/conversation/context-draft.ts"
import { TerminalLayoutProvider } from "./agent-window/layout.tsx"
import { type Api, api as defaultApi } from "./api.ts"
import { useAppPageController, useAppTaskSessionBindings } from "./app-controller.ts"
import { AppRunDock } from "./app-dock.tsx"
import { TASK_RAIL } from "./app-layout.ts"
import { AppOverlays } from "./app-overlays.tsx"
import { artifactRunFor } from "./app-runs.ts"
import {
  AppNavColumn,
  renderAppGateScreen,
  shouldShowAppTopBar,
  useAppConversationActions,
  useAppFeedbackAndCopy,
  useAppWorkspaceModes,
} from "./app-shell-parts.tsx"
import { AppMainRoutes, AppQuitFailureAlert, AppTopChrome } from "./app-views.tsx"
import { useArtifactBinding } from "./app-workspace.ts"
import {
  type ArtifactFeedbackApi,
  artifactFeedbackApi as realArtifactFeedbackApi,
} from "./artifact/feedback-api.ts"
import { artifactContextTarget } from "./artifacts/artifact-context.ts"
import { BuildHereContinuation } from "./BuildHereContinuation.tsx"
import { useNativeDownloads } from "./export/useNativeDownloads.ts"
import { type OutsideConversationInterest, OutsideConversationInterestContext } from "./hooks.ts"
import { taskFileEntries } from "./kit/command-files.ts"
import { useAppPointMenu } from "./kit/PointMenu.tsx"
import { useCommandApp } from "./kit/use-command-app.ts"
import { MachineLayer, type MachinePage, type ReadMachines } from "./machines/MachineFrames.tsx"
import type { Theme } from "./machines/relay.ts"
import { nativeShell } from "./native-shell.ts"
import { runAttention } from "./run-attention.ts"
import { type RunAdapter, RunProvider } from "./run-context.tsx"
import { runsApi } from "./runs-api.ts"
import { defaultSetupPageApi, type SetupPageApi } from "./Setup.tsx"
import { Sidebar } from "./Sidebar.tsx"
import { useSettingsNav } from "./settings/useSettingsNav.tsx"
import { NeedsYouCountProvider } from "./shell/needs-you-count.tsx"
import type { LookApi } from "./sidebar/look-api.ts"
import { ProjectLooksContext } from "./sidebar/look-context.tsx"
import { useTaskPointMenu } from "./TaskPointMenu.tsx"
import { ServerDown, unreachable } from "./Trouble.tsx"
import { originalTaskApi, taskDispositionScope } from "./task-disposition.ts"
import { tourLocation } from "./tour/location.ts"
import { useUpdates } from "./Updates.tsx"
import { UsageDisplayProvider } from "./usage/display-context.tsx"

function ShellContexts({
  looks,
  needsYou,
  machines,
  machinePage,
  theme,
  onTheme,
  children,
}: {
  machines: ReadMachines | null
  theme: Theme
  onTheme: (theme: Theme) => void
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

function buildSidebarNode(opts: {
  api: Api
  c: ReturnType<typeof useAppPageController>
  settingsNav: ReactNode
  taskMenu: ReturnType<typeof useTaskPointMenu>
  commandApp: ReturnType<typeof useCommandApp>
  feedbackOpen: boolean
  startFeedback: () => void
  updatesLine: ReturnType<typeof useUpdates>["line"]
}) {
  const { api, c, settingsNav, taskMenu, commandApp, feedbackOpen, startFeedback, updatesLine } =
    opts
  if (settingsNav) return settingsNav
  const { q, nt, filter, setFilter, route, go, layout } = c
  return (
    <Sidebar
      interaction={nativeShell(api)}
      onTaskMenu={taskMenu.onTaskMenu}
      looks={q.looks}
      onLook={q.changeLook}
      onOrder={q.changeOrder}
      onReveal={q.lookApi.revealProject ? q.revealProject : undefined}
      onNewTaskIn={nt.openNewTaskIn}
      onAddProject={nt.openAddProject}
      tasks={q.allTasks}
      homeQuestions={q.homeQuestions.data ?? []}
      reading={q.firstRead}
      projects={q.projects.data ?? []}
      filter={filter}
      onFilter={setFilter}
      route={route}
      go={(next) => {
        go(next)
        if (layout.compact) layout.setNav("closed")
      }}
      theme={c.theme}
      onToggleTheme={c.toggleTheme}
      onOpenSearch={() => {
        if (layout.compact) layout.setNav("closed")
        commandApp.open()
      }}
      licence={q.licence.data}
      onHide={() => layout.setNav("closed")}
      rail={layout.taskRail ? { onExpand: () => layout.setNav("open") } : undefined}
      onFeedback={() => {
        if (layout.compact) layout.setNav("closed")
        startFeedback()
      }}
      onNewTask={nt.openNewTask}
      newTaskOpen={nt.newTask}
      feedbackOpen={feedbackOpen}
      update={updatesLine}
    />
  )
}

function deriveAppShellState(
  c: ReturnType<typeof useAppPageController>,
  artifactAddress: ReturnType<typeof useArtifactBinding>["artifactAddress"],
) {
  const { route, q, layout, streamed, runs } = c
  const allProjects = q.projects.data ?? []
  const opening =
    route.view === "task" ? q.allTasks.find((task) => task.id === route.id) : undefined
  const serverDown =
    streamed.disconnected || unreachable(q.tasks.error) || unreachable(q.open.error)
  const artifactMenu =
    !layout.navOpen && !layout.taskRail
      ? { compact: layout.compact, onOpen: () => layout.setNav("open") }
      : null
  const draftTarget =
    route.view === "task" && q.open.data?.id === route.id
      ? taskContextTarget(window.location.href, q.open.data)
      : route.view === "artifact" && artifactAddress?.scope === "project"
        ? artifactContextTarget(window.location.href, artifactAddress.id, artifactAddress.file)
        : undefined
  const gridTemplateColumns =
    layout.navOpen && !layout.compact
      ? `${layout.navWidth}px minmax(0,1fr)`
      : `${layout.taskRail ? TASK_RAIL : 0}px minmax(0,1fr)`
  const attentionCount = runAttention(
    { tasks: q.allTasks, project: c.project, agent: c.agent, now: Date.now() },
    runs?.runs ?? [],
  ).items.length
  return {
    allProjects,
    opening,
    serverDown,
    artifactMenu,
    draftTarget,
    gridTemplateColumns,
    attentionCount,
  }
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
  look?: LookApi
  events?: boolean
  setup?: SetupPageApi
  onTour?: (at: number) => void
  artifactFeedbackApi?: ArtifactFeedbackApi
}) {
  const c = useAppPageController({ api, look, events, onTour })
  const { runs, terminalLayout, route, go, restored, streamed, filter, setFilter, q, layout, nt } =
    c
  const session = useAppTaskSessionBindings(route, q.openId)
  const { artifactBinding, bindArtifact, artifactAddress } = useArtifactBinding(
    layout.routeScope,
    layout.artifactDetail,
  )
  const standaloneArtifactAddress = route.view === "artifact" ? artifactAddress : null
  const artifactRun = artifactRunFor(runs?.runs ?? [], standaloneArtifactAddress)
  const ws = useAppWorkspaceModes({
    route,
    routeScope: layout.routeScope,
    standaloneArtifactAddress,
    runs,
    terminalLayout,
  })
  const artifactFeedback =
    suppliedArtifactFeedbackApi ?? (q.productionApi ? realArtifactFeedbackApi : undefined)
  const taskMenu = useTaskPointMenu({
    api,
    rename: q.lookApi.renameTask,
    route,
    go,
    reload: q.reloadTask,
    onChatArchive: (task) => {
      session.requestChatArchive(task.id)
      go({ view: "task", id: task.id, doc: null })
    },
  })
  const pointMenu = useAppPointMenu()
  const loadTaskFiles = useCallback((id: string) => taskFileEntries(api, id), [api])
  const commandApp = useCommandApp({
    route,
    tasks: q.allTasks,
    go,
    openNewTask: (projectId) =>
      nt.openNewTaskIn(projectId, document.querySelector<HTMLElement>("[data-new-task-toggle]")),
    toggleTaskList: () => {
      if (!layout.fullScreen && route.view !== "settings")
        layout.setNav(layout.navOpen ? "closed" : "open")
    },
    textSize: (by) => {
      void q.textSize.step(by)
    },
  })
  const { feedback, setFeedback, startFeedback, onCopy } = useAppFeedbackAndCopy(route, q.open.data)
  const updates = useUpdates({
    api,
    version: streamed.update,
    openAbout: () => go({ view: "settings", tab: "about" }),
  })
  const settingsNav = useSettingsNav({
    route,
    go,
    config: q.config.data,
    licence: q.licence.data,
    updates,
    compact: layout.compact,
    closeNav: () => layout.setNav("closed"),
  })
  const conversationActions = useAppConversationActions(go, route, q.open.data, q.tasks.data)
  const gateScreen = renderAppGateScreen({
    route,
    tasksError: q.tasks.error,
    projectsError: q.projects.error,
    setup,
    go,
    nt,
    reloadLicence: q.licence.reload,
    reloadTasks: q.tasks.reload,
    reloadProjects: q.projects.reload,
  })
  if (gateScreen !== null) return gateScreen
  const {
    allProjects,
    opening,
    serverDown,
    artifactMenu,
    draftTarget,
    gridTemplateColumns,
    attentionCount,
  } = deriveAppShellState(c, artifactAddress)
  const retry = () => {
    q.tasks.reload()
    q.projects.reload()
    q.open.reload()
  }
  const sidebar = buildSidebarNode({
    api,
    c,
    settingsNav,
    taskMenu,
    commandApp,
    feedbackOpen: feedback !== null,
    startFeedback,
    updatesLine: updates.line,
  })
  return (
    <UsageDisplayProvider value={q.config.data?.usage}>
      <TooltipProvider>
        <ShellContexts
          looks={q.looks}
          needsYou={attentionCount}
          machines={api.machines ?? null}
          machinePage={api.machinePage}
          theme={c.theme}
          onTheme={(next) => void c.changeConfig({ theme: next })}
        >
          <div
            ref={layout.protectTerminalKeys}
            className={cn(
              "grid h-full overflow-hidden bg-background",
              !layout.resizing && "transition-[grid-template-columns] duration-200 ease-ql",
            )}
            style={{ gridTemplateColumns }}
            data-testid="shell"
            data-nav={layout.navOpen ? "open" : "closed"}
          >
            <AppNavColumn layout={layout} route={route} sidebar={sidebar} />
            <div
              className="q-terminal-workspace flex min-h-0 min-w-0 flex-col overflow-hidden"
              ref={terminalLayout?.workspace}
              data-terminal-right={
                terminalLayout?.rightActive && terminalLayout.sidebarRect ? "true" : undefined
              }
              data-terminal-shared={terminalLayout?.sidebarRect ? "true" : undefined}
            >
              {serverDown ? <ServerDown retry={retry} /> : null}
              <AppQuitFailureAlert runs={runs} />
              {route.view === "settings" ? null : updates.bar}
              <AppTopChrome
                showTopBar={shouldShowAppTopBar({ layout, route, openTask: q.open.data, opening })}
                productionApi={q.productionApi}
                route={route}
                openTask={q.open.data}
                compact={layout.compact}
                navToggle={layout.navToggle}
                onOpenNav={() => layout.setNav("open")}
                newTask={nt.newTask}
                openNewTask={nt.openNewTask}
              />
              <AppMainRoutes
                p={{
                  api,
                  setup,
                  route,
                  go,
                  restored,
                  firstRun: c.firstRun,
                  firstRead: q.firstRead,
                  theme: c.theme,
                  config: q.config.data,
                  licence: q.licence.data,
                  reloadLicence: q.licence.reload,
                  subagents: c.subagents.data,
                  allProjects,
                  allTasks: q.allTasks,
                  looks: q.looks,
                  homeQuestions: q.homeQuestions.data ?? [],
                  reloadHomeQuestions: q.homeQuestions.reload,
                  reloadTasks: q.tasks.reload,
                  project: c.project,
                  agent: c.agent,
                  need: c.need,
                  setNeed: c.setNeed,
                  newTask: nt.newTask,
                  newTaskDraft: nt.newTaskDraft,
                  newTaskTargetName: nt.newTaskTarget?.project.name,
                  openNewTask: nt.openNewTask,
                  openNewTaskOn: nt.openNewTaskOn,
                  setNewTaskAgent: nt.setNewTaskAgent,
                  discardUnfinished: () => {
                    nt.setNewTaskDraft("")
                    nt.setNewTaskLaunchDraft(null)
                  },
                  onTour,
                  persistSetting: q.persistSetting,
                  saveSetting: c.saveSetting,
                  changeConfig: c.changeConfig,
                  onCopy,
                  updates,
                  artifactsOverview: q.artifactsOverview,
                  artifactsVersion: q.artifactsVersion,
                  artifactFeedback,
                  artifactRun,
                  bindArtifact,
                  width: layout.width,
                  compact: layout.compact,
                  listToggle: layout.listToggle,
                  setNavOpen: () => layout.setNav("open"),
                  railOpen: layout.railOpen,
                  railToggle: layout.railToggle,
                  railFit: layout.railFit,
                  railWidthFallback: layout.railSize.width,
                  resizing: layout.resizing,
                  setResizing: layout.setResizing,
                  fullScreen: layout.fullScreen,
                  askFullScreen: layout.askFullScreen,
                  artifactMenu,
                  openTask: q.open.data,
                  openTaskError: q.open.error,
                  reloadOpenTask: q.open.reload,
                  opening,
                  runs,
                  terminalLayout,
                  draftTarget,
                  plainTerminal: ws.plainTerminal,
                  workspaceMode: ws.workspaceMode,
                  chatArchive: session.chatArchive,
                  consumeChatArchive: session.consumeChatArchive,
                  planControls: session.planControls,
                  streamedTaskFiles: streamed.taskFiles,
                  streamedTaskSlow: streamed.taskSlow,
                  streamedArtifacts: streamed.artifacts,
                  reloadTask: q.reloadTask,
                  previewAnswer: q.previewAnswer,
                  showVisibleTask: q.showVisibleTask,
                  rememberTaskLaunch: session.rememberTaskLaunch,
                  openCommandBox: () => commandApp.open(),
                }}
              />
              <AppRunDock
                route={route}
                go={go}
                routeScope={layout.routeScope}
                workspaceKey={ws.workspaceKey}
                workspaceMode={ws.workspaceMode}
                changeWorkspaceMode={ws.changeWorkspaceMode}
                artifactDetail={layout.artifactDetail}
                artifactAddress={artifactAddress}
                standaloneArtifactAddress={standaloneArtifactAddress}
                artifactBinding={artifactBinding}
                artifactFeedback={artifactFeedback}
                artifactRun={artifactRun}
                shellRun={ws.shellRun}
                shellLive={ws.shellLive}
                plainTerminal={ws.plainTerminal}
                closeShell={ws.closeShell}
                outside={ws.outside}
                showOutside={ws.showOutside}
                draftTarget={draftTarget}
                openTask={q.open.data}
                allTasks={q.allTasks}
                config={q.config.data}
                subagents={c.subagents.data}
                runs={runs}
                terminalLayout={terminalLayout}
                conversationActions={conversationActions}
                bindPlanControls={session.bindPlanControls}
                taskLaunchChoices={session.taskLaunchChoices}
                rememberTaskLaunch={session.rememberTaskLaunch}
                onCopy={onCopy}
                agentSwitch={session.agentSwitch}
                setAgentSwitch={session.setAgentSwitch}
              />
            </div>
          </div>
          <AppOverlays
            api={api}
            compact={layout.compact}
            navOpen={layout.navOpen}
            setNav={layout.setNav}
            navToggle={layout.navToggle}
            sidebar={sidebar}
            commandApp={commandApp}
            allTasks={q.allTasks}
            allProjects={allProjects}
            go={go}
            filter={filter}
            setFilter={setFilter}
            startFeedback={startFeedback}
            theme={c.theme}
            toggleTheme={c.toggleTheme}
            loadTaskFiles={loadTaskFiles}
            feedback={feedback}
            setFeedback={setFeedback}
            updates={updates}
            newTask={nt.newTask}
            newTaskAfterNav={nt.newTaskAfterNav}
            setNewTaskAfterNav={nt.setNewTaskAfterNav}
            newTaskProject={nt.newTaskProject}
            config={q.config.data}
            reloadConfig={q.config.reload}
            reloadTasks={q.tasks.reload}
            reloadProjects={q.projects.reload}
            newTaskLaunchDraft={nt.newTaskLaunchDraft}
            setNewTaskLaunchDraft={nt.setNewTaskLaunchDraft}
            newTaskAgent={nt.newTaskAgent}
            newTaskKind={nt.newTaskKind}
            newTaskTarget={nt.newTaskTarget}
            setNewTaskTarget={nt.setNewTaskTarget}
            newTaskDraft={nt.newTaskDraft}
            setNewTaskDraft={nt.setNewTaskDraft}
            closeNewTask={nt.closeNewTask}
            runs={runs}
            subagents={c.subagents.data}
            onCopy={onCopy}
            terminalLayout={terminalLayout}
            adding={nt.adding}
            setAdding={nt.setAdding}
            looksNow={q.looksNow}
            lookApi={q.lookApi}
            setLooks={q.setLooks}
            taskMenuNode={taskMenu.node}
            pointMenu={pointMenu}
          />
        </ShellContexts>
      </TooltipProvider>
    </UsageDisplayProvider>
  )
}
