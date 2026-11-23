// The sidebar's list grouped by project: a header per project (a fold toggle with its tile and name,
// and what a folded project keeps in view), its open tasks under it in attention order, one fold row
// for what shipped or was archived, and at the bottom the projects the person hid. The header's + and
// ⋯ show on hover; ⋯ and a right-click open the project's menu, Rename turns the header into a field,
// a header drags onto another project to reorder, and the list takes the keys: ↑/↓ through headers and
// rows, ←/→ fold and unfold, ⌥↑/⌥↓ move the focused project.

import { cn } from "cn"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { LookPatch, ProjectColor } from "../../core/project-look.ts"
import type { TaskSummary } from "../api.ts"
import type { Route } from "../hooks.ts"
import type { RunWindow } from "../run-context.tsx"
import {
  EmptyProjectsCard,
  HiddenProjectsList,
  ProjectGroupBody,
  ProjectHeader,
  RenameRow,
  type RowRenderOptions,
} from "./ProjectListParts.tsx"
import { type MenuProject, useProjectMenu } from "./ProjectMenu.tsx"
import {
  copyFolderPath,
  handleProjectListKeyDown,
  strayRunsOf,
  toggleOf,
} from "./project-list-keys.ts"
import { droppedOrder, movedOrder, type ProjectGroup, type ProjectView } from "./project-model.ts"
import { RunRow } from "./TaskRow.tsx"

type Props = {
  view: ProjectView
  /** Every project in the person's order, hidden ones too: a move keeps them where they stand. */
  order?: string[]
  /** All tasks, to place an agent window under the project of its task. */
  tasks: TaskSummary[]
  route: Route
  go: (route: Route) => void
  now: number
  interaction?: boolean
  onTaskMenu?: (task: TaskSummary, event: React.MouseEvent) => void
  onToggleFold: (projectId: string) => void
  onToggleDone: (projectId: string) => void
  /** Agent windows the App started; a window with a task stands under that task's project. */
  runs: RunWindow[]
  onOpenRun: (run: RunWindow) => void
  /** Whether the Running list is on show (a filter for another list hides the windows). */
  showRuns: boolean
  /** A change of one project's color, name or hidden flag. Absent: no menu, no rename. */
  onLook?: (projectId: string, patch: LookPatch) => void
  /** The new order of all projects. Absent: no drag, no move. */
  onOrder?: (ids: string[]) => void
  /** Show the project's folder in the file manager. Absent: no "Open in Finder". */
  onReveal?: (projectId: string) => void
  onNewTaskIn?: (projectId: string, anchor: HTMLElement) => void
  /** Replaces the list's own project menu (⋯ and right-click). */
  onProjectMenu?: (projectId: string, event: React.MouseEvent) => void
  /** The first-run card's one button. */
  onAddProject?: (anchor: HTMLElement) => void
  /** "Show all" beside the quiet note. */
  onShowAll: () => void
  /** One-line rows: no second line, the step word at the end. */
  oneLine?: boolean
  /** Detailed rows: the age and a third line with the branch, the pull request and the agent. */
  detailed?: boolean
  /** The tasks that changed since the viewer looked. */
  unread?: ReadonlySet<string>
}

function dropLineClass(
  drag: string | null,
  dropOn: string | null,
  groupId: string,
  shown: readonly string[],
): string | null {
  if (drag === null || dropOn !== groupId || drag === groupId) return null
  return shown.indexOf(drag) < shown.indexOf(groupId) ? "drop-after" : "drop-before"
}

function ProjectSection({
  group,
  shown,
  drag,
  dropOn,
  draggable,
  renaming,
  limit,
  rowOptions,
  onToggleFold,
  onToggleDone,
  onNewTaskIn,
  onProjectMenu,
  onRenameDone,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onRevealMore,
}: {
  group: ProjectGroup
  shown: readonly string[]
  drag: string | null
  dropOn: string | null
  draggable: boolean
  renaming: boolean
  limit: number | undefined
  rowOptions: RowRenderOptions
  onToggleFold: () => void
  onToggleDone: (projectId: string) => void
  onNewTaskIn?: Props["onNewTaskIn"]
  onProjectMenu?: Props["onProjectMenu"]
  onRenameDone: (label: string | null | undefined) => void
  onDragStart: (event: React.DragEvent) => void
  onDragOver: (event: React.DragEvent) => void
  onDragEnd: () => void
  onDrop: (event: React.DragEvent) => void
  onRevealMore: (nextLimit: number) => void
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the group is where a dragged header lands; the keys do the same moves
    <section
      className={cn(
        "pj",
        !group.folded && "open",
        group.quiet && "quiet",
        drag === group.id && "dragging",
        dropLineClass(drag, dropOn, group.id, shown),
      )}
      data-testid="project-group"
      data-project={group.id}
      onDragOver={drag === null ? undefined : onDragOver}
      onDrop={drag === null ? undefined : onDrop}
    >
      {renaming ? (
        <RenameRow group={group} onDone={onRenameDone} />
      ) : (
        <ProjectHeader
          group={group}
          onToggle={onToggleFold}
          onNewTaskIn={onNewTaskIn}
          onProjectMenu={onProjectMenu}
          draggable={draggable}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      )}
      <ProjectGroupBody
        group={group}
        limit={limit}
        onRevealMore={onRevealMore}
        onNewTaskIn={onNewTaskIn}
        onToggleDone={onToggleDone}
        rowOptions={rowOptions}
      />
    </section>
  )
}

function startProjectDrag(event: React.DragEvent, id: string): void {
  try {
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", id)
  } catch {
    // a drag without a data transfer still reorders: the list knows what is dragged
  }
}

function useProjectListMenu(args: {
  props: Props
  root: React.RefObject<HTMLDivElement | null>
  move: (id: string, step: -1 | 1) => void
  setRenaming: (id: string | null) => void
}) {
  const { props, root, move, setRenaming } = args
  const { view, onLook } = props
  const menuProjects: MenuProject[] = view.groups.map((g, i) => ({
    id: g.id,
    label: g.label,
    letters: g.letters,
    color: g.color,
    folder: g.folder,
    first: i === 0,
    last: i === view.groups.length - 1,
  }))
  return useProjectMenu({
    projects: menuProjects,
    focusHeader: (id) => toggleOf(root.current, id)?.focus(),
    actions: {
      newTask:
        props.onNewTaskIn === undefined
          ? undefined
          : (id) => {
              const anchor = toggleOf(root.current, id)
              if (anchor !== null) props.onNewTaskIn?.(id, anchor)
            },
      rename: (id) => setRenaming(id),
      color: (id, color: ProjectColor) => onLook?.(id, { color }),
      move,
      foldOthers: (id) => {
        for (const g of view.groups) if (g.folded !== (g.id !== id)) props.onToggleFold(g.id)
      },
      reveal: props.onReveal,
      copyPath: (id) => copyFolderPath(view.groups, id),
      hide: (id) => {
        const label = view.groups.find((g) => g.id === id)?.label ?? ""
        onLook?.(id, { hidden: true })
        toast.success(`${label} is hidden. Hidden projects at the bottom bring it back.`)
      },
    },
  })
}

function useProjectDrag(args: {
  full: string[]
  shown: string[]
  onOrder?: (ids: string[]) => void
  refocus: React.RefObject<string | null>
}) {
  const { full, shown, onOrder, refocus } = args
  const [drag, setDrag] = useState<string | null>(null)
  const [dropOn, setDropOn] = useState<string | null>(null)
  const clear = () => {
    setDrag(null)
    setDropOn(null)
  }
  const start = (event: React.DragEvent, id: string) => {
    startProjectDrag(event, id)
    setDrag(id)
    setDropOn(null)
  }
  const over = (event: React.DragEvent, id: string) => {
    if (drag === id) return
    event.preventDefault()
    if (dropOn !== id) setDropOn(id)
  }
  const drop = (event: React.DragEvent, targetId: string) => {
    event.preventDefault()
    if (drag === null) return
    const next = droppedOrder(full, shown, drag, targetId)
    const id = drag
    clear()
    if (next !== null && onOrder !== undefined) {
      refocus.current = id
      onOrder(next)
    }
  }
  return { drag, dropOn, start, over, drop, clear }
}

export function ProjectList(props: Props) {
  const { view, tasks, route, go, now, interaction, onTaskMenu, onLook, onOrder } = props
  const [hiddenOpen, setHiddenOpen] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<Record<string, number>>({})
  const refocus = useRef<string | null>(null)
  useEffect(() => {
    const id = refocus.current
    if (id === null || renaming !== null) return
    refocus.current = null
    toggleOf(root.current, id)?.focus()
  })

  const shown = view.groups.map((g) => g.id)
  const full = props.order ?? shown
  const move = (id: string, step: -1 | 1) => {
    if (onOrder === undefined) return
    const next = movedOrder(full, shown, id, step)
    if (next === null) return
    refocus.current = id
    onOrder(next)
  }
  const menu = useProjectListMenu({ props, root, move, setRenaming })
  const dnd = useProjectDrag({ full, shown, onOrder, refocus })
  const onProjectMenu = props.onProjectMenu ?? (onLook !== undefined ? menu.open : undefined)
  const strays = strayRunsOf(props.runs, tasks, props.showRuns)
  const rowOptions: RowRenderOptions = {
    route,
    go,
    now,
    interaction,
    onTaskMenu,
    oneLine: props.oneLine,
    detailed: props.detailed,
    unread: props.unread,
  }
  const draggable = onOrder !== undefined && view.groups.length > 1
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the list's keys (↑ ↓ ← → ⌥↑ ⌥↓) act on the buttons inside it
    <div
      ref={root}
      className="pj-list"
      data-testid="project-list"
      onKeyDown={(event) =>
        handleProjectListKeyDown({
          event,
          list: root.current,
          groups: view.groups,
          onMove: move,
          onToggleFold: props.onToggleFold,
        })
      }
    >
      {strays.map((run) => (
        <RunRow key={run.id} run={run} onOpen={props.onOpenRun} oneLine={props.oneLine} />
      ))}
      {view.empty ? <EmptyProjectsCard onAddProject={props.onAddProject} /> : null}
      {view.groups.map((group) => (
        <ProjectSection
          key={group.id}
          group={group}
          shown={shown}
          drag={dnd.drag}
          dropOn={dnd.dropOn}
          draggable={draggable}
          renaming={renaming === group.id}
          limit={revealed[group.id]}
          rowOptions={rowOptions}
          onToggleFold={() => props.onToggleFold(group.id)}
          onToggleDone={props.onToggleDone}
          onNewTaskIn={props.onNewTaskIn}
          onProjectMenu={onProjectMenu}
          onRenameDone={(label) => {
            refocus.current = group.id
            setRenaming(null)
            if (label !== undefined) onLook?.(group.id, { label })
          }}
          onDragStart={(event) => dnd.start(event, group.id)}
          onDragOver={(event) => dnd.over(event, group.id)}
          onDragEnd={dnd.clear}
          onDrop={(event) => dnd.drop(event, group.id)}
          onRevealMore={(nextLimit) => setRevealed((was) => ({ ...was, [group.id]: nextLimit }))}
        />
      ))}
      {view.quietNote !== null ? (
        <p className="pj-quiet-note" data-testid="project-quiet-note">
          {view.quietNote}{" "}
          <button type="button" className="q-link" onClick={props.onShowAll}>
            Show all
          </button>
        </p>
      ) : null}
      <HiddenProjectsList
        hidden={view.hidden}
        open={hiddenOpen}
        onToggle={() => setHiddenOpen((was) => !was)}
        onLook={onLook}
      />
      {onLook !== undefined ? menu.node : null}
    </div>
  )
}
