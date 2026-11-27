// The task rail (App Model task-rail.html, issue #231): the task list collapsed to 52 px. It keeps the expand
// toggle, Home and Artifacts with their counts, one tile per task that needs you and then per running task
// (the open task always shows), and at the foot one usage ring and Settings. A tile is the project's colour with
// the task's initials and the row's own status mark; hover or focus names the task and says where it is.

import { cn } from "cn"
import {
  CompassIcon,
  HouseIcon,
  LaptopIcon,
  PanelLeftIcon,
  ServerIcon,
  SettingsIcon,
  ShapesIcon,
} from "lucide-react"
import type { ReactElement } from "react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { TaskSummary } from "../api.ts"
import type { Route } from "../hooks.ts"
import { appShortcut, CHORD, type Chord } from "../kit/command-keys.ts"
import {
  chosenName,
  requestMenu,
  type SwitchView,
  THIS,
  useSwitcherShown,
  waitingElsewhere,
} from "../machines/MachineSwitch.tsx"
import { useOptionalRuns } from "../run-context.tsx"
import { ProjectTile } from "./ProjectTile.tsx"
import type { ProjectFacts, RowGroup } from "./project-model.ts"
import { rowLook } from "./row-look.ts"
import { rowStage } from "./row-words.ts"
import { markClass } from "./TaskRow.tsx"
import { UsageFoot } from "./UsageFoot.tsx"
import "./task-rail.css"

/** A task's two initials, from the first two words that start with a letter. */
export function taskInitials(title: string): string {
  return title
    .split(/\s+/)
    .filter((word) => /^\p{L}/u.test(word))
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("")
}

function Tip({ label, children }: { label: React.ReactNode; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function Tile({
  task,
  group,
  open,
  project,
  interaction,
  now,
  go,
}: {
  task: TaskSummary
  group: RowGroup
  open: boolean
  project: Pick<ProjectFacts, "letters" | "color" | "label">
  interaction: boolean
  now: number
  go: (route: Route) => void
}) {
  const windows = useOptionalRuns()
  const look = rowLook({ task, group, interaction, now, runs: windows?.runs ?? [] })
  const stage = rowStage(task)
  // The second line: where it is, in the row's words, and its project.
  const where = [
    stage.toLowerCase() === look.sub.toLowerCase() ? "" : stage,
    look.sub,
    project.label,
  ]
    .filter((part) => part !== "")
    .join(" · ")
  return (
    <Tip
      label={
        <span className="q-rail-tip">
          <b>{task.title}</b>
          <small>{where}</small>
        </span>
      }
    >
      <button
        type="button"
        className="q-rail-task"
        aria-current={open ? "page" : undefined}
        aria-label={`${task.title}. ${where}`}
        onClick={() => {
          if (look.build) windows?.select(look.build.id)
          go({ view: "task", id: task.id, doc: null })
        }}
        data-testid="rail-task"
        data-title={task.title}
        data-group={group}
        data-state={look.state}
      >
        <ProjectTile letters={taskInitials(task.title) || project.letters} color={project.color} />
        <span className="q-rail-mark">
          <i className={cn("q-m", markClass(look))} data-who={look.mark} aria-hidden="true" />
        </span>
      </button>
    </Tip>
  )
}

/** A place of the rail: its icon, its count when something waits there, the place's name as the tooltip. */
function Place({
  label,
  icon,
  current,
  count,
  onClick,
  testId,
  chord,
}: {
  label: string
  icon: ReactElement
  current: boolean
  count: number
  onClick: () => void
  testId: string
  chord: Chord
}) {
  const waiting = count > 0
  return (
    <Tip label={appShortcut(waiting ? `${label} · ${count}` : label, chord)}>
      <button
        type="button"
        className="q-rail-ib"
        aria-label={waiting ? `${label}, ${count} waiting` : label}
        aria-current={current ? "page" : undefined}
        onClick={onClick}
        data-testid={testId}
      >
        {icon}
        {waiting ? <span className="q-rail-count">{count > 9 ? "9+" : count}</span> : null}
      </button>
    </Tip>
  )
}

/** One group of tiles (Open now, Your turn, Running); an empty group draws nothing. */
function TileGroup({
  label,
  tasks,
  kind,
  openId,
  projectOf,
  interaction,
  now,
  go,
}: {
  label: string
  tasks: readonly TaskSummary[]
  kind: RowGroup
  openId: string | null
  projectOf: (task: TaskSummary) => Pick<ProjectFacts, "letters" | "color" | "label">
  interaction: boolean
  now: number
  go: (route: Route) => void
}) {
  if (tasks.length === 0) return null
  return (
    <ul className="q-rail-group" aria-label={label}>
      {tasks.map((task) => (
        <li key={task.id}>
          <Tile
            task={task}
            group={kind}
            open={task.id === openId}
            project={projectOf(task)}
            interaction={interaction}
            now={now}
            go={go}
          />
        </li>
      ))}
    </ul>
  )
}

/** Settings; a dot and About when an update is ready. */
function SettingsButton({
  route,
  go,
  updateReady,
}: {
  route: Route
  go: (route: Route) => void
  updateReady: boolean
}) {
  return (
    <Tip label={appShortcut(updateReady ? "Settings · update ready" : "Settings", CHORD.settings)}>
      <button
        type="button"
        className="q-rail-ib"
        aria-label={updateReady ? "Settings, update ready" : "Settings"}
        aria-current={route.view === "settings" ? "page" : undefined}
        onClick={() => go(updateReady ? { view: "settings", tab: "about" } : { view: "settings" })}
        data-testid="rail-settings"
      >
        <SettingsIcon className="size-4" aria-hidden="true" />
        {updateReady ? <i className="q-rail-dot" aria-hidden="true" /> : null}
      </button>
    </Tip>
  )
}

/**
 * With a machine added: one tile for the switcher, the chosen machine's icon and the count of what waits
 * elsewhere. It opens the sidebar with the switcher's menu; the tile's name is the chosen machine's.
 */
function MachineTile({ view, onExpand }: { view: SwitchView; onExpand: () => void }) {
  useSwitcherShown()
  const name = chosenName(view)
  const others = waitingElsewhere(view)
  const label = `Machines · ${name}`
  const Icon = view.chosen === THIS ? LaptopIcon : ServerIcon
  return (
    <>
      <div className="q-rail-sep" />
      <Tip label={label}>
        <button
          type="button"
          className="q-rail-ib"
          aria-label={others > 0 ? `${label}, ${others} waiting on other machines` : label}
          aria-haspopup="menu"
          aria-expanded={false}
          onClick={() => {
            requestMenu()
            onExpand()
          }}
          data-testid="rail-machines"
        >
          <Icon className="size-4" aria-hidden="true" />
          {others > 0 ? <span className="q-rail-count">{others > 9 ? "9+" : others}</span> : null}
        </button>
      </Tip>
    </>
  )
}

export function TaskRail({
  you,
  running,
  open,
  route,
  go,
  now,
  interaction,
  projectOf,
  homeWaiting,
  onHome,
  onProduct,
  onArtifacts,
  onExpand,
  machines = null,
  updateReady,
}: {
  you: readonly TaskSummary[]
  running: readonly TaskSummary[]
  /** The task on screen, when it is in neither group: it still shows, first. */
  open: TaskSummary | null
  route: Route
  go: (route: Route) => void
  now: number
  interaction: boolean
  projectOf: (task: TaskSummary) => Pick<ProjectFacts, "letters" | "color" | "label">
  homeWaiting: number
  onHome: () => void
  onProduct?: () => void
  onArtifacts: () => void
  onExpand: () => void
  /** The switcher's list; null while no machine is added, and then the rail has no tile for it. */
  machines?: SwitchView | null
  updateReady: boolean
}) {
  const openId = route.view === "task" ? route.id : null
  const group = (label: string, tasks: readonly TaskSummary[], kind: RowGroup) => (
    <TileGroup
      label={label}
      tasks={tasks}
      kind={kind}
      openId={openId}
      projectOf={projectOf}
      interaction={interaction}
      now={now}
      go={go}
    />
  )
  return (
    <TooltipProvider delay={250}>
      <aside className="q-rail" aria-label="Tasks" data-testid="task-rail">
        <Tip label={appShortcut("Expand the task list", CHORD.taskList)}>
          <button
            type="button"
            className="q-rail-ib"
            aria-label="Expand the task list"
            aria-expanded={false}
            onClick={onExpand}
            data-testid="rail-expand"
          >
            <PanelLeftIcon className="size-4" aria-hidden="true" />
          </button>
        </Tip>
        {machines !== null ? <MachineTile view={machines} onExpand={onExpand} /> : null}
        <div className="q-rail-sep" />
        <nav className="q-rail-places" aria-label="Places">
          <Place
            label="Home"
            icon={<HouseIcon className="size-4" aria-hidden="true" />}
            current={route.view === "home"}
            count={homeWaiting}
            onClick={onHome}
            testId="rail-home"
            chord={CHORD.home}
          />
          {onProduct ? (
            <Tip label="Product">
              <button
                type="button"
                className="q-rail-ib"
                aria-label="Product"
                aria-current={route.view === "product" ? "page" : undefined}
                onClick={onProduct}
                data-testid="rail-product"
              >
                <CompassIcon className="size-4" aria-hidden="true" />
              </button>
            </Tip>
          ) : null}
          <Place
            label="Artifacts"
            icon={<ShapesIcon className="size-4" aria-hidden="true" />}
            current={route.view === "artifacts" || route.view === "artifact"}
            count={0}
            onClick={onArtifacts}
            testId="rail-artifacts"
            chord={CHORD.artifacts}
          />
        </nav>
        <div className="q-rail-sep" />
        <div className="q-rail-tiles">
          {group("Open now", open === null ? [] : [open], "running")}
          {group("Your turn", you, "you")}
          {you.length > 0 && running.length > 0 ? <div className="q-rail-sep thin" /> : null}
          {group("Running", running, "running")}
        </div>
        <div className="q-rail-foot">
          <UsageFoot go={go} now={now} rail />
          <SettingsButton route={route} go={go} updateReady={updateReady} />
        </div>
      </aside>
    </TooltipProvider>
  )
}
