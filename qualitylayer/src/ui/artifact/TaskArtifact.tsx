// A task's artifacts in its page: which view is an artifact, the Files tab's groups, the Plan's previews
// (ArtifactHost) and the artifact open full size, where a mark opens the quick field. Kept apart from
// TaskView, which only places them.

import { LayersIcon, PinIcon, ShapesIcon } from "lucide-react"
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { type Artifact, isArtifactDoc } from "../../core/artifact/format.ts"
import { parseArtifactReference } from "../../core/artifact/reference.ts"
import type { TaskCost } from "../../core/cost/labels.ts"
import { flowStepOf } from "../../core/flow.ts"
import type { Api, ArtifactWhere, TaskArtifacts, TaskDetail } from "../api.ts"
import { PLAN_TURN_READY } from "../docs/PlanTurn.tsx"
import { type Query, useQuery } from "../hooks.ts"
import type { TaskSurfaceProps } from "../interaction/props.ts"
import { fileOf } from "../model.ts"
import { AgentChip } from "../shell/AgentChip.tsx"
import { TaskListToggle } from "../shell/TaskListToggle.tsx"
import { TaskTopBar } from "../shell/TaskTopBar.tsx"
import { SidebarButton } from "../sidebar/HeaderButtons.tsx"
import { useTurnData } from "../turn/actions.ts"
import { useArtifactMenus } from "./ArtifactMenus.tsx"
import { ArtifactPage, type ArtifactPageMark } from "./ArtifactPage.tsx"
import type { ArtifactHostValue } from "./ArtifactPreview.tsx"
import { type ArtifactGroup, ArtifactsTab, anyNew } from "./ArtifactsTab.tsx"
import type { ArtifactFeedbackAddress } from "./feedback-api.ts"
import { previewCache } from "./preview-cache.ts"
import { markSeen, useSeenArtifacts } from "./seen.ts"
import { TaskFilesArtifacts } from "./TaskFilesArtifacts.tsx"
import { draftLine, useTaskLasting } from "./task-lasting.ts"

/** The artifact a view shows: `artifacts/<name>.html`, or a show-me page by its file name. */
export function artifactFileOfView(view: string): string | null {
  if (isArtifactDoc(view) && !view.startsWith("docs/")) return view
  if (/^show-me-[a-z0-9-]*\.html$/.test(view)) return `artifacts/${view}`
  return null
}

/** "Back to the Plan": how the bar names the step an artifact was opened from. */
export function backWords(label: string): string {
  return label === "Plan" ? "the Plan" : label
}

export type TaskArtifactState = {
  readOnly: boolean
  list: Query<TaskArtifacts | null>
  where: ArtifactWhere
  groups: ArtifactGroup[]
  /** An artifact is new to this viewer: the tab's dot. */
  fresh: boolean
  count: number
  host: ArtifactHostValue
  /** The App's API and the task, for the menus and the lasting artifacts of the Files tab; absent in a bare list. */
  api?: Api
  task?: TaskDetail
  /** Open an artifact of the task or a Library artifact, as the task's page does. */
  open?: (where: ArtifactWhere, artifact: Artifact) => void
}

export function useTaskArtifacts(
  api: Api,
  task: TaskDetail,
  version: number,
  open: (where: ArtifactWhere, artifact: Pick<Artifact, "file">, section?: string) => void,
  theme?: "light" | "dark",
): TaskArtifactState {
  const list = useQuery(
    () => Promise.resolve().then(() => api.taskArtifacts(task.id, false)),
    [task.id, version],
  )
  const seen = useSeenArtifacts()
  const where: ArtifactWhere = useMemo(() => ({ scope: "task", id: task.id }), [task.id])
  const own = list.data?.task ?? []
  const groups: ArtifactGroup[] = [
    { key: "task", label: "This task", where, artifacts: own, first: 8 },
  ]
  const identity = `${task.id}:${task.me.email}:${task.me.name}`
  const cache = useMemo(() => previewCache(api, identity), [api, identity])
  const host: ArtifactHostValue = {
    artifacts: own,
    identity,
    cache,
    theme,
    version,
    load: (file) =>
      cache.load(file, () =>
        api.artifactPage(
          parseArtifactReference(file)?.scope === "project"
            ? { scope: "project", id: task.project }
            : where,
          file,
        ),
      ),
    open: (file, section) => {
      if (parseArtifactReference(file)?.scope === "project") {
        open({ scope: "project", id: task.project }, { file }, section)
        return
      }
      const artifact = own.find(
        (d) => d.file === file || d.pages?.some((page) => page.file === file),
      )
      if (artifact !== undefined) {
        if (section) open(where, { file }, section)
        else open(where, artifact)
      }
    },
  }
  return {
    readOnly: task.archived || task.stage === "shipped" || task.stage === "abandoned",
    list,
    where,
    groups,
    fresh: anyNew(seen, groups),
    count: own.length,
    host,
    api,
    task,
    open,
  }
}

/** The Artifacts tab of a task. */
/** Whether the task is past its Plan, where artifacts are drawn. */
export function planningOver(task: { stage: string }): boolean {
  if (task.stage === "abandoned") return true
  const step = flowStepOf(task.stage)
  return step === "implement" || step === "verify"
}

export function TaskArtifactsTab({
  state,
  current,
  onOpen,
  compact = true,
  planned = false,
  afterDrafts,
}: {
  state: TaskArtifactState
  current: { where: ArtifactWhere; file: string } | null
  onOpen: (where: ArtifactWhere, artifact: Artifact) => void
  compact?: boolean
  /** Planning is over (the Plan is approved): a task with no artifact will not get one now. */
  planned?: boolean
  afterDrafts?: ReactNode
}) {
  if (state.list.data === null && state.list.loading)
    return (
      <>
        <p className="muted">Loading artifacts…</p>
        {afterDrafts}
      </>
    )
  if (state.list.error !== null)
    return (
      <>
        <div role="alert">
          <p>Could not read artifacts. {state.list.error.message}</p>
          <button type="button" className="q-btn quiet sm" onClick={state.list.reload}>
            Try again
          </button>
        </div>
        {afterDrafts}
      </>
    )
  if (compact)
    return (
      <TaskFilesArtifacts
        state={state}
        current={current}
        onOpen={onOpen}
        planned={planned}
        afterDrafts={afterDrafts}
      />
    )
  return (
    <ArtifactsTab
      groups={state.groups}
      current={current}
      onOpen={onOpen}
      foot={<>Ask your agent to draw one: “mock up the settings page”.</>}
    />
  )
}

export function TaskArtifactView({
  api,
  task,
  state,
  file,
  version,
  back,
  status,
  rail,
  fullScreen,
  onFullScreen,
  menu,
  compact,
  onMark,
  reload,
  surface,
  cost,
  topBar,
  onArtifactContext,
  section,
}: {
  api: Api
  task: TaskDetail
  state: TaskArtifactState
  /** DOCS can mount the shared Now/top-bar seams on a full-size artifact. */
  surface?: TaskSurfaceProps
  cost?: TaskCost | null
  topBar?: HTMLElement | null
  file: string
  section?: string
  version: number
  back: { label: string; onClick: () => void }
  status: ReactNode
  rail: { open: boolean; onToggle: () => void; what?: string }
  fullScreen: boolean
  onFullScreen: (on: boolean) => void
  menu: { compact: boolean; onOpen: () => void } | null
  compact: boolean
  /** A mark on the artifact: the quick field opens there; absent when the task is read-only. */
  onMark?: (mark: ArtifactPageMark, title: string) => void
  reload: () => void
  onArtifactContext?: (address: ArtifactFeedbackAddress, title: string) => void
}) {
  useTurnData(task, api, version)
  const artifact = state.list.data?.task.find((d) => d.file === file) ?? null
  // Delete and rename can remove the draft from its list before navigation unmounts this viewer.
  const listed = useRef<{ task: string; file: string } | null>(null)
  if (artifact !== null) listed.current = { task: task.id, file }
  const removed =
    artifact === null && listed.current?.task === task.id && listed.current.file === file
  const loadBoard = useCallback(
    (name: string) => api.artifactPage({ scope: "task", id: task.id }, name),
    [api, task.id],
  )
  const updated = artifact?.updated ?? 0
  const html = useQuery(
    () => (removed ? Promise.resolve(null) : api.artifactPage(state.where, file)),
    // The page is read again when the artifact changed, not on every file event.
    [task.id, file, updated, artifact?.revision, artifact === null ? version : 0, removed],
  )
  // Looking at it is seeing it: the New dot goes, and an update while it is open is seen at once.
  useEffect(() => {
    if (artifact !== null) markSeen(state.where, artifact)
  }, [artifact, state.where])
  const title =
    artifact?.title ??
    file
      .replace(/^.*\//, "")
      .replace(/\.html$/, "")
      .replaceAll("-", " ")
  const [selectedPage, setSelectedPage] = useState<string | null>(null)
  const selectedFile = artifact?.pages?.some((page) => page.file === selectedPage)
    ? (selectedPage as string)
    : file
  useLayoutEffect(() => {
    onArtifactContext?.({ scope: "task", id: task.id, file: selectedFile }, title)
  }, [onArtifactContext, task.id, selectedFile, title])
  // What the draft builds on, found in its owner project: a chip in the header opens it in the
  // Library (whose viewer offers the way back here); the ⋯ menu also saves the draft to the Library.
  const lasting = useTaskLasting(api, task.project)
  const menus = useArtifactMenus({
    api,
    task,
    where: state.where,
    drafts: state.list.data?.task ?? [],
    lasting,
    readOnly: state.readOnly,
    current: file,
    onOpen: state.open ?? (() => undefined),
    reload: state.list.reload,
  })
  const line =
    artifact !== null
      ? draftLine(
          artifact,
          lasting.artifacts,
          task.id,
          lasting.query.data !== null
            ? { projects: lasting.query.data.projects, project: task.project }
            : undefined,
        )
      : null
  // An archived base opens as it is; a deleted one opens on its viewer's Restore; a missing one is
  // only named.
  const base =
    line?.base !== undefined && line.owner !== null
      ? { artifact: line.base, owner: line.owner }
      : null
  const deletedBase = line?.state === "deleted"
  const openBase = () => {
    if (base !== null) menus.openInLibrary(base.owner, base.artifact, artifact?.draftOn?.page)
  }
  // The bar says what the draft builds on once: a draft named like its base does not say the name again.
  const pagesOfBase = line === null ? "" : line.pages.join(", ")
  const sameName = line !== null && line.title.trim().toLowerCase() === title.trim().toLowerCase()
  const relation =
    line === null ? null : (
      <span className="dg-rel" data-testid="draft-base">
        <span
          className="dg-kind"
          title="A working artifact of this task. It stays in this task's Files until you save it to the Library or Review folds it in."
        >
          Draft
        </span>
        {base !== null ? (
          <button
            type="button"
            className="dg-on"
            title={
              deletedBase
                ? `${line.title} was deleted from the Library. Open it to restore it`
                : `Draft on ${line.title}${pagesOfBase !== "" ? ` › ${pagesOfBase}` : ""}. Open it in the Library`
            }
            onClick={openBase}
          >
            <LayersIcon size={13} aria-hidden="true" />
            <span className="truncate">
              {deletedBase
                ? sameName
                  ? "the Library copy was deleted"
                  : `${line.title} was deleted`
                : sameName
                  ? `on ${pagesOfBase !== "" ? pagesOfBase : "the Library copy"}`
                  : `on ${line.title}${pagesOfBase !== "" ? ` › ${pagesOfBase}` : ""}`}
              {line.state === "archived" ? " (archived)" : ""}
            </span>
          </button>
        ) : (
          <span className="dg-on off">
            {sameName ? "not in the Library" : `${line.title} is not in the Library`}
          </span>
        )}
      </span>
    )
  const moreItems =
    artifact !== null && (base !== null || !state.readOnly) ? (
      <>
        {base !== null ? (
          <DropdownMenuItem onClick={openBase}>
            <ShapesIcon aria-hidden="true" />
            {deletedBase
              ? `Restore ${base.artifact.title}…`
              : `Open ${base.artifact.title} in the Library`}
          </DropdownMenuItem>
        ) : null}
        {!state.readOnly ? (
          <DropdownMenuItem onClick={() => menus.keep(artifact)}>
            <PinIcon aria-hidden="true" />
            Save to library…
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
      </>
    ) : undefined
  // Hydrating Now must not move the canvas to a new parent and discard its comment draft.
  const planWorkspace = PLAN_TURN_READY && surface !== undefined && task.stage === "plan"
  const agentStatus = surface ? <AgentChip task={task} api={api} onCopy={surface.onCopy} /> : status
  const page = (
    <ArtifactPage
      section={section}
      manager={{
        api,
        where: state.where,
        file,
        readOnly: state.readOnly,
        onChanged: (next, deleted) => {
          reload()
          state.list.reload()
          if (deleted) back.onClick()
          else if (next !== file) surface?.onOpen(next)
        },
      }}
      collection={{
        artifacts: state.list.data?.task ?? [],
        load: loadBoard,
        onOpen: (next) => surface?.onOpen(next.file),
      }}
      loadPage={loadBoard}
      onPageChange={setSelectedPage}
      title={title}
      readOnly={state.readOnly}
      artifact={artifact}
      html={html.data}
      error={html.error !== null && html.data === null ? html.error.message : null}
      back={surface ? { ...back, labelled: true } : back}
      relation={relation}
      status={surface ? undefined : status}
      {...(onMark && !state.readOnly ? { onMark: (mark) => onMark(mark, title) } : {})}
      onOpenBrowser={(location) =>
        void api
          .artifactOpen(state.where, location.file ?? selectedFile, "browser", {
            viewer: true,
            section: location.section,
          })
          .catch((cause: Error) => toast.error(cause.message))
      }
      rail={surface ? undefined : rail}
      fullScreen={fullScreen}
      onFullScreen={onFullScreen}
      menu={surface ? null : menu}
      compact={compact}
      moreItems={moreItems}
    />
  )
  const main = (content: ReactNode) => (
    <main className="@container ir-artifact-workspace flex min-h-0 min-w-0 flex-col">
      {content}
      {menus.node}
    </main>
  )
  if (!surface) return main(page)
  // The artifact opens under the shell's own header, as a step page does: the title, the agent, the
  // right sidebar's button in its place and the task's tools. The bar below it holds the viewer's.
  // The header spans the grid its caller lays out; the artifact is its main.
  const shell = planWorkspace ? { ...surface, view: fileOf(task, "plan") } : surface
  return (
    <>
      <TaskTopBar {...shell} cost={cost} actions track={false}>
        <div className="q-head" data-testid="task-head" hidden={compact}>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {menu ? (
              <TaskListToggle
                look="plain"
                className="q-btn sm quiet order-first shrink-0"
                iconSize={16}
                onOpen={menu.onOpen}
              />
            ) : null}
            <h1 className="q-title" title={task.title}>
              <span className="truncate">{task.title}</span>
            </h1>
          </div>
          <div className="q-tools">
            {compact ? null : (
              <>
                {agentStatus}
                <SidebarButton shown={rail.open} onOpen={rail.onToggle} />
              </>
            )}
          </div>
        </div>
        {compact && topBar
          ? createPortal(
              <span className="ir-pinned-status flex flex-none items-center gap-2">
                {agentStatus}
                <SidebarButton shown={rail.open} onOpen={rail.onToggle} />
              </span>,
              topBar,
            )
          : null}
      </TaskTopBar>
      {main(page)}
    </>
  )
}
