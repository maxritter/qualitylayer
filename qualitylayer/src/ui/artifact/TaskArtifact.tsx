// A task's artifacts in its page: which view is an artifact, the Files tab's groups, the Plan's previews
// (ArtifactHost) and the artifact open full size, where a mark opens the quick field. Kept apart from
// TaskView, which only places them.

import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import { type Artifact, isArtifactDoc } from "../../core/artifact/format.ts"
import { parseArtifactReference } from "../../core/artifact/reference.ts"
import type { TaskCost } from "../../core/cost/labels.ts"
import { flowStepOf } from "../../core/flow.ts"
import type { Api, ArtifactWhere, TaskArtifacts, TaskDetail } from "../api.ts"
import { PLAN_TURN_READY } from "../docs/PlanTurn.tsx"
import { type Query, useQuery } from "../hooks.ts"
import type { TaskSurfaceProps } from "../interaction/props.ts"
import { AgentChip } from "../shell/AgentChip.tsx"
import { useTurnData } from "../turn/actions.ts"
import { useArtifactMenus } from "./ArtifactMenus.tsx"
import { ArtifactPage, type ArtifactPageMark } from "./ArtifactPage.tsx"
import type { ArtifactHostValue } from "./ArtifactPreview.tsx"
import { type ArtifactGroup, ArtifactsTab, anyNew } from "./ArtifactsTab.tsx"
import type { ArtifactFeedbackAddress } from "./feedback-api.ts"
import { previewCache } from "./preview-cache.ts"
import { markSeen, useSeenArtifacts } from "./seen.ts"
import {
  DraftRelationBadge,
  defaultArtifactTitle,
  galleryThumbnails,
  openArtifactInBrowser,
  resolveDraftBase,
  TaskArtifactMoreItems,
  TaskArtifactTopBar,
} from "./TaskArtifactHeader.tsx"
import { TaskFilesArtifacts } from "./TaskFilesArtifacts.tsx"
import { useTaskLasting } from "./task-lasting.ts"

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
  fresh: boolean
  count: number
  host: ArtifactHostValue
  api?: Api
  task?: TaskDetail
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
    galleryThumbnails: async () =>
      galleryThumbnails((await api.taskArtifacts(task.id)).task, where),
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

function useTaskArtifactPageData(args: {
  api: Api
  task: TaskDetail
  state: TaskArtifactState
  file: string
  version: number
  onArtifactContext?: (address: ArtifactFeedbackAddress, title: string) => void
}) {
  const { api, task, state, file, version, onArtifactContext } = args
  const artifact = state.list.data?.task.find((d) => d.file === file) ?? null
  const listed = useRef<{ task: string; file: string } | null>(null)
  if (artifact !== null) listed.current = { task: task.id, file }
  const removed =
    artifact === null && listed.current?.task === task.id && listed.current.file === file
  const html = useQuery(
    () => (removed ? Promise.resolve(null) : api.artifactPage(state.where, file)),
    [
      task.id,
      file,
      artifact?.updated ?? 0,
      artifact?.revision,
      artifact === null ? version : 0,
      removed,
    ],
  )
  useEffect(() => {
    if (artifact !== null) markSeen(state.where, artifact)
  }, [artifact, state.where])
  const title = defaultArtifactTitle(artifact, file)
  const [selectedPage, setSelectedPage] = useState<string | null>(null)
  const selectedFile = artifact?.pages?.some((page) => page.file === selectedPage)
    ? (selectedPage as string)
    : file
  useLayoutEffect(() => {
    onArtifactContext?.({ scope: "task", id: task.id, file: selectedFile }, title)
  }, [onArtifactContext, task.id, selectedFile, title])
  return { artifact, html, title, selectedFile, setSelectedPage }
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
  onMark?: (mark: ArtifactPageMark, title: string) => void
  reload: () => void
  onArtifactContext?: (address: ArtifactFeedbackAddress, title: string) => void
}) {
  useTurnData(task, api, version)
  const { artifact, html, title, selectedFile, setSelectedPage } = useTaskArtifactPageData({
    api,
    task,
    state,
    file,
    version,
    onArtifactContext,
  })
  const loadBoard = useCallback(
    (name: string) => api.artifactPage({ scope: "task", id: task.id }, name),
    [api, task.id],
  )
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
  const { line, base } = resolveDraftBase(artifact, lasting, task)
  const openBase = () => {
    if (base !== null) menus.openInLibrary(base.owner, base.artifact, artifact?.draftOn?.page)
  }
  const main = (
    <main className="@container ir-artifact-workspace flex min-h-0 min-w-0 flex-col">
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
        relation={
          <DraftRelationBadge line={line} title={title} base={base} onOpenBase={openBase} />
        }
        status={surface ? undefined : status}
        {...(onMark && !state.readOnly ? { onMark: (mark) => onMark(mark, title) } : {})}
        onOpenBrowser={(location) =>
          openArtifactInBrowser(api, state.where, selectedFile, location, (msg) => toast.error(msg))
        }
        rail={surface ? undefined : rail}
        fullScreen={fullScreen}
        onFullScreen={onFullScreen}
        menu={surface ? null : menu}
        compact={compact}
        moreItems={TaskArtifactMoreItems({
          artifact,
          base,
          deletedBase: line?.state === "deleted",
          readOnly: state.readOnly,
          onOpenBase: openBase,
          onKeep: menus.keep,
        })}
      />
      {menus.node}
    </main>
  )
  if (!surface) return main
  return (
    <>
      <TaskArtifactTopBar
        surface={surface}
        task={task}
        planWorkspace={PLAN_TURN_READY && task.stage === "plan"}
        cost={cost}
        compact={compact}
        menu={menu}
        agentStatus={<AgentChip task={task} api={api} onCopy={surface.onCopy} />}
        rail={rail}
        topBar={topBar}
      />
      {main}
    </>
  )
}
