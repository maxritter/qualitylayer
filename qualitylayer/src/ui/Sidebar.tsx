// The task list: the brand with the + menu beside it, Search (⌘K), Home and Artifacts,
// the list of tasks under their projects (or,
// grouped by status, Your turn, Running, Shipped and Archived) with Find, the View menu and Add beside
// its label, and at the foot the Plan limits, who you are, Settings, Docs, Theme and Report. It is a
// column of the page, never laid over it; below 900 px it is a sheet the Menu button opens. Find types
// here; ⌘K searches everything and sets the project filter.

import { FolderPlusIcon } from "lucide-react"
import { type ReactNode, useMemo, useState } from "react"
import { type LookPatch, NO_LOOKS, type ProjectLooks } from "../core/project-look.ts"
import type { HomeQuestion, Licence, Project, TaskSummary } from "./api.ts"
import { type Route, useNow } from "./hooks.ts"
import { NavLoading } from "./kit/LoadingState.tsx"
import { useSwitchView } from "./machines/MachineSwitch.tsx"
import type { TaskFilter } from "./model.ts"
import { PREF, useIdSet, usePref } from "./prefs.ts"
import { runAttention } from "./run-attention.ts"
import { type RunWindow, useOptionalRuns } from "./run-context.tsx"
import { buildRunsVersion, runTaskId } from "./runs-api.ts"
import { ACTIVITY_WINDOWS, type ActivityWindow, matchingTasks } from "./sidebar/activity.ts"
import type { NewKind } from "./sidebar/NewMenu.tsx"
import { ProjectList } from "./sidebar/ProjectList.tsx"
import {
  chipWords,
  knownProjects,
  orderProjects,
  projectFacts,
  projectView,
} from "./sidebar/project-model.ts"
import { SidebarFoot } from "./sidebar/SidebarFoot.tsx"
import { TaskRail } from "./sidebar/TaskRail.tsx"
import { useUnread } from "./sidebar/use-seen.ts"
import { type GroupBy, ROW_HEIGHTS, type RowsHeight, ViewMenu } from "./sidebar/ViewMenu.tsx"
import {
  deriveSidebarLists,
  isCurrentTaskHidden,
  sidebarCurrentGroup,
  sidebarManagedRuns,
  sidebarRailState,
} from "./sidebar-helpers.ts"
import { SidebarStatusGroups, SidebarTopChrome } from "./sidebar-status-groups.tsx"

type Props = {
  /** Explicitly enabled by the mounted interaction adapter; older adapters keep their list. */
  interaction?: boolean
  tasks: TaskSummary[]
  projects: Project[]
  /** What the View menu and ⌘K narrowed the list to (Show, Agent, a project). */
  filter: TaskFilter
  onFilter: (patch: Partial<TaskFilter>) => void
  route: Route
  go: (route: Route) => void
  /** What shows now: the choice, or the system's when following it. */
  theme: "light" | "dark"
  onToggleTheme: () => void
  /** "Search everything" under a Find with no match opens the command box (⌘K does the same). */
  onOpenSearch: () => void
  licence: Licence | null
  onHide: () => void
  /** The "Update ready" line, above the name; the updates fill it. */
  update?: ReactNode
  /** Collapsed to the task rail (window 900 px and wider): its toggle expands the list again. */
  rail?: { onExpand: () => void }
  onFeedback?: () => void
  /** The feedback sheet is open: its button takes the border. */
  feedbackOpen?: boolean
  /** The + beside the logo opens a menu, Task or Chat; the pick opens New task under it. Absent, no button. */
  onNewTask?: (button: HTMLElement, kind: NewKind) => void
  newTaskOpen?: boolean
  /** The first read of the tasks and projects has not landed: the list waits as an outline and says nothing is missing. */
  reading?: boolean
  /** Taskless questions remain on Home; they are not local tasks. */
  homeQuestions?: HomeQuestion[]
  /** A right-click on a task row: its own menu (open, archive, delete). */
  onTaskMenu?: (task: TaskSummary, event: React.MouseEvent) => void
  /** How the person shows their projects: order, color, name, hidden. Absent: every project as it is. */
  looks?: ProjectLooks
  /** A change of one project's color, name or hidden flag (the project menu, Rename, Show again). */
  onLook?: (projectId: string, patch: LookPatch) => void
  /** The new order of all projects (a drag, a move). Absent: headers do not drag. */
  onOrder?: (ids: string[]) => void
  /** Show a project's folder in the file manager. Absent: the menu has no "Open in Finder". */
  onReveal?: (projectId: string) => void
  /** + on a project's header (and "New task" on an empty one): New task under it with that project chosen. */
  onNewTaskIn?: (projectId: string, anchor: HTMLElement) => void
  /** Add in the list header: absent, there is no button. */
  onAddProject?: (anchor: HTMLElement) => void
  /** ⋯ on a project's header and a right-click on it. */
  onProjectMenu?: (projectId: string, event: React.MouseEvent) => void
}

function SidebarListBody({
  reading,
  byProject,
  view,
  emptyFiltered,
  searching,
  query,
  onOpenSearch,
  filtered,
  chip,
  matchingCount,
  outside,
  showAll,
  projectListProps,
  statusProps,
}: {
  reading?: boolean
  byProject: boolean
  view: ReturnType<typeof projectView> | null
  emptyFiltered: boolean
  searching: boolean
  query: string
  onOpenSearch: () => void
  filtered: boolean
  chip: string[]
  matchingCount: number
  outside: number
  showAll: () => void
  projectListProps: Omit<React.ComponentProps<typeof ProjectList>, "view">
  statusProps: Omit<React.ComponentProps<typeof SidebarStatusGroups>, "nothingFound">
}) {
  const noMatches = emptyFiltered ? (
    <p className="pj-quiet-note" data-testid="sidebar-no-matches">
      No tasks match this view.{" "}
      <button type="button" className="q-link" onClick={showAll}>
        Clear filters
      </button>
    </p>
  ) : null
  const nothingFound = searching ? (
    <p className="pj-quiet-note" data-testid="find-nothing">
      Nothing here matches “{query}”.{" "}
      <button type="button" className="q-link" onClick={onOpenSearch}>
        Search everything
      </button>
    </p>
  ) : null
  return (
    <div className="-mx-1 min-h-0 flex-1 overflow-auto px-1">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3.5">
        {filtered ? (
          <div className="q-filter-chip" data-testid="filter-note">
            <span className="min-w-0 truncate">{chip.join(" · ")}</span>
            <button type="button" className="q-link ml-auto" onClick={showAll}>
              Clear filters
            </button>
          </div>
        ) : null}
        <span role="status" className="sr-only" data-testid="sidebar-results">
          {matchingCount} matching tasks. {outside} other open tasks outside this view.
        </span>
        {!reading ? (emptyFiltered && searching ? nothingFound : noMatches) : null}
        {reading ? (
          <NavLoading />
        ) : byProject && view !== null ? (
          <>
            <ProjectList
              {...projectListProps}
              view={emptyFiltered ? { ...view, quietNote: null } : view}
            />
            {view.groups.length === 0 && !emptyFiltered ? nothingFound : null}
          </>
        ) : (
          <SidebarStatusGroups {...statusProps} nothingFound={nothingFound} />
        )}
        {filtered && outside > 0 ? (
          <p className="pj-quiet-note" data-testid="sidebar-outside">
            {outside} other open tasks outside this view.
          </p>
        ) : null}
      </div>
    </div>
  )
}

function useSidebarPrefs() {
  const [groupBy, setGroupBy] = usePref<GroupBy>(PREF.groupBy, "project", ["project", "status"])
  const [rows, setRows] = usePref<RowsHeight>(PREF.rows, "detailed", ROW_HEIGHTS)
  const [activity, setActivity] = usePref<ActivityWindow>(PREF.activity, "any", ACTIVITY_WINDOWS)
  const [folded, toggleFold, assignFolded] = useIdSet(PREF.folded)
  const [doneOpen, toggleDone] = useIdSet(PREF.doneOpen)
  const [shippedFold, setShippedFold] = usePref(PREF.shipped, "closed", ["open", "closed"])
  const [archivedFold, setArchivedFold] = usePref(PREF.archived, "closed", ["open", "closed"])
  const [typed, setTyped] = useState("")
  return {
    groupBy,
    setGroupBy,
    rows,
    setRows,
    activity,
    setActivity,
    folded,
    toggleFold,
    assignFolded,
    doneOpen,
    toggleDone,
    shippedFold,
    setShippedFold,
    archivedFold,
    setArchivedFold,
    typed,
    setTyped,
  }
}

export function Sidebar(props: Props) {
  const { tasks, projects, filter, route, go } = props
  const looks = props.looks ?? NO_LOOKS
  const windows = useOptionalRuns()
  const prefs = useSidebarPrefs()
  const byProject = prefs.groupBy === "project"
  const oneLine = prefs.rows === "one"
  const detailed = prefs.rows === "detailed"
  const query = prefs.typed.trim()
  const searching = query !== ""
  const closeFind = () => prefs.setTyped("")
  const { managedRuns, unboundRuns } = sidebarManagedRuns(windows?.runs, filter, tasks, searching)
  const openRun = (run: RunWindow) => {
    windows?.select(run.id)
    const task = runTaskId(run)
    if (task && tasks.some((item) => item.id === task)) go({ view: "task", id: task, doc: null })
  }
  const now = useNow(true, 30_000)
  const openId = route.view === "task" ? route.id : null
  const unread = useUnread(tasks, openId)
  const buildVersion = buildRunsVersion(windows?.runs ?? [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: buildVersion covers build transitions; output timestamps do not change attention or project grouping.
  const attention = useMemo(
    () =>
      runAttention(
        { tasks, project: filter.project, agent: filter.agent, now },
        windows?.runs ?? [],
      ),
    [tasks, filter.project, filter.agent, now, buildVersion],
  )
  const factsById = useMemo(
    () => new Map(knownProjects(projects, tasks).map((p) => [p.id, projectFacts(p, looks)])),
    [projects, tasks, looks],
  )
  const fullOrder = useMemo(
    () => orderProjects(knownProjects(projects, tasks), tasks, looks).map((p) => p.id),
    [projects, tasks, looks],
  )
  const factsOf = (task: TaskSummary) =>
    factsById.get(task.project) ?? projectFacts({ id: task.project, name: task.projectName }, looks)
  const { listShell, groups, counts } = deriveSidebarLists({
    tasks,
    looks,
    filter,
    activity: prefs.activity,
    byProject,
    query,
    openId,
    now,
    interaction: props.interaction === true,
    attentionShell: attention.shell,
    managed: attention.managed,
    factsOf,
  })
  const view = useMemo(
    () =>
      byProject
        ? projectView({
            tasks,
            projects,
            looks,
            filter: { need: filter.need, agent: filter.agent, project: filter.project },
            folded: prefs.folded,
            doneOpen: prefs.doneOpen,
            openId,
            now,
            query,
            managed: attention.managed,
            activity: prefs.activity,
          })
        : null,
    [
      byProject,
      tasks,
      projects,
      looks,
      filter.need,
      filter.agent,
      filter.project,
      prefs.folded,
      prefs.doneOpen,
      openId,
      now,
      query,
      attention.managed,
      prefs.activity,
    ],
  )
  const shippedOpen = prefs.shippedFold === "open" || filter.need === "shipped" || searching
  const archivedOpen = prefs.archivedFold === "open" || searching
  const currentTask = tasks.find((t) => t.id === openId)
  const currentHidden = isCurrentTaskHidden({
    currentTask,
    openId,
    filterNeed: filter.need,
    groups,
    shippedOpen,
    archivedOpen,
  })
  const showAll = () => {
    props.onFilter({ project: "", need: "", agent: "" })
    prefs.setActivity("any")
    closeFind()
  }
  const home = () => {
    showAll()
    go({ view: "home" })
  }
  const homeWaiting = attention.items.length
  const machines = useSwitchView(homeWaiting)
  if (props.rail !== undefined) {
    const { railGroups, open } = sidebarRailState({
      tasks,
      looks,
      openId,
      now,
      interaction: props.interaction === true,
      managed: attention.managed,
    })
    return (
      <TaskRail
        you={railGroups.you}
        running={railGroups.running}
        open={open}
        route={route}
        go={go}
        now={now}
        interaction={props.interaction === true}
        projectOf={factsOf}
        homeWaiting={homeWaiting}
        onHome={home}
        onArtifacts={() => go({ view: "artifacts" })}
        onExpand={props.rail.onExpand}
        machines={machines}
        updateReady={props.update !== undefined && props.update !== null}
      />
    )
  }
  const chip = chipWords({
    query,
    need: filter.need,
    agent: filter.agent,
    project: filter.project === "" ? "" : (factsById.get(filter.project)?.label ?? filter.project),
    activity: prefs.activity,
  })
  const filtered = chip.length > 0
  const matching = matchingTasks(groups, listShell.open, filter.need, searching)
  const matched = new Set(matching.map((task) => task.id))
  const { currentGroup, outside } = sidebarCurrentGroup(
    tasks,
    openId,
    now,
    attention.managed,
    matched,
  )
  const emptyFiltered = filtered && matching.length === 0
  const firstRun = tasks.length === 0 && unboundRuns.length === 0

  return (
    <aside
      className="q-side q-model-side @container/side min-w-0"
      aria-label="Tasks"
      data-testid="sidebar"
      data-interaction={props.interaction === true}
    >
      <SidebarTopChrome
        machines={machines}
        onHome={home}
        onHide={props.onHide}
        onNewTask={props.onNewTask}
        newTaskOpen={props.newTaskOpen}
        onOpenSearch={props.onOpenSearch}
        route={route}
        interaction={props.interaction}
        homeWaiting={homeWaiting}
        onArtifacts={() => {
          closeFind()
          go({ view: "artifacts" })
        }}
      />

      <div className="q-list-header" data-testid="task-list-header">
        <h2 className="pj-label">{byProject ? "Projects" : "Tasks"}</h2>
        <ViewMenu
          query={prefs.typed}
          onQuery={prefs.setTyped}
          groupBy={prefs.groupBy}
          onGroupBy={prefs.setGroupBy}
          need={filter.need}
          counts={counts}
          onNeed={(need) => props.onFilter({ need })}
          agent={filter.agent}
          onAgent={(agent) => props.onFilter({ agent })}
          activity={prefs.activity}
          onActivity={prefs.setActivity}
          rows={prefs.rows}
          onRows={prefs.setRows}
          onFoldAll={() => prefs.assignFolded(fullOrder)}
          onUnfoldAll={() => prefs.assignFolded([])}
        />
        {props.onAddProject !== undefined ? (
          <button
            type="button"
            className="q-ic"
            aria-label="Add a project"
            data-add-project-toggle
            title="Add a project"
            onClick={(event) => props.onAddProject?.(event.currentTarget)}
          >
            <FolderPlusIcon className="size-[13px]" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <SidebarListBody
        reading={props.reading}
        byProject={byProject}
        view={view}
        emptyFiltered={emptyFiltered}
        searching={searching}
        query={query}
        onOpenSearch={props.onOpenSearch}
        filtered={filtered}
        chip={chip}
        matchingCount={matching.length}
        outside={outside}
        showAll={showAll}
        projectListProps={{
          tasks,
          route,
          go,
          now,
          interaction: props.interaction,
          onTaskMenu: props.onTaskMenu,
          onToggleFold: prefs.toggleFold,
          onToggleDone: prefs.toggleDone,
          runs: managedRuns,
          onOpenRun: openRun,
          showRuns: filter.need === "" || filter.need === "running",
          order: fullOrder,
          onLook: props.onLook,
          onOrder: props.onOrder,
          onReveal: props.onReveal,
          onNewTaskIn: props.onNewTaskIn,
          onProjectMenu: props.onProjectMenu,
          onAddProject: props.onAddProject,
          onShowAll: showAll,
          oneLine,
          detailed,
          unread,
        }}
        statusProps={{
          groups,
          currentTask,
          currentHidden,
          currentGroup,
          filterNeed: filter.need,
          filtered,
          firstRun,
          searching,
          openId,
          shippedOpen,
          archivedOpen,
          onToggleShipped: () => prefs.setShippedFold(shippedOpen ? "closed" : "open"),
          onToggleArchived: () => prefs.setArchivedFold(archivedOpen ? "closed" : "open"),
          unboundRuns,
          onOpenRun: openRun,
          emptyFiltered,
          base: {
            onTaskMenu: props.onTaskMenu,
            oneLine,
            detailed,
            unread,
            factsOf,
            route,
            go,
            now,
            interaction: props.interaction,
          },
        }}
      />

      <SidebarFoot
        update={props.update}
        licence={props.licence}
        planPrimary={!firstRun}
        route={route}
        go={go}
        now={now}
        theme={props.theme}
        onToggleTheme={props.onToggleTheme}
        feedbackOpen={props.feedbackOpen}
        onFeedback={props.onFeedback}
      />
    </aside>
  )
}
