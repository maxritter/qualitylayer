// One task of the sidebar's list: its mark, its name and under it the live status in five words
// (frame 10f): what the agent does, what waits for you, or how it stopped, from the same status the
// header's pill says. A detailed row (the default) adds when the task last changed with an unread
// dot, and a third line with the branch, the pull request and its checks, and the agent's mark. Under
// a project it is indented to the project's tile; under status grouping it ends with the project's tile.

import { cn } from "cn"
import { useEffect, useState } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { flowStepOf } from "../../core/flow.ts"
import type { TaskSummary } from "../api.ts"
import type { RowTone } from "../home-rows.ts"
import type { Route } from "../hooks.ts"
import { stepLabel } from "../model.ts"
import { type RunWindow, useOptionalRuns } from "../run-context.tsx"
import { runStatusText } from "../runs-api.ts"
import { hasLiveCard, LiveCard } from "./LiveCard.tsx"
import { ProjectTile } from "./ProjectTile.tsx"
import type { ProjectFacts, RowGroup } from "./project-model.ts"
import { RowMeta, type RowStrip } from "./RowMeta.tsx"
import { hasMeta, type RowFacts, rowFacts } from "./row-facts.ts"
import { type RowLook, type RowMark, rowLook } from "./row-look.ts"
import { compactStatus, rowDescription, rowStage } from "./row-words.ts"

const STRIP_TONE: Record<RowMark, RowTone> = {
  you: "you",
  agent: "work",
  quiet: "quiet",
  stop: "stop",
  err: "stop",
  done: "done",
  open: "wait",
}

/** The third line's step mark: where the task is in the three steps, and whose move it is. A chat, an archived
 *  task, one handed back and one of an earlier workflow have no step, so they keep their word. */
function stripOf(task: TaskSummary, look: RowLook): RowStrip | undefined {
  if (task.archived || task.handedBack !== undefined || task.earlier === true) return undefined
  if (task.type === "chat" && task.stage !== "shipped") return undefined
  if (task.stage === "shipped") return { step: null, tone: "done", label: "Shipped" }
  const step = flowStepOf(task.stage)
  return step === null ? undefined : { step, tone: STRIP_TONE[look.mark], label: stepLabel(step) }
}

/** The row's mark for each state the status gives it: the same marks the pill and the tabs use. */
const ROW_MARK: Record<RowMark, string> = {
  you: "q-m-you",
  agent: "q-m-agent",
  quiet: "q-m-quiet",
  stop: "q-m-halt",
  err: "q-m-err",
  done: "q-m-done",
  open: "q-m-todo",
}

/** The row's own mark: a process that ended while working is red, the others are the status' marks. */
export const markClass = (look: RowLook) =>
  look.session?.state === "stopped-early" ? "q-m-stop" : ROW_MARK[look.mark]

function Live({ look }: { look: RowLook }) {
  return look.live === null ? null : (
    <i
      className={cn("q-m ir-row-live", ROW_MARK[look.live])}
      data-running={look.live === "agent" ? "true" : undefined}
      aria-hidden="true"
    />
  )
}

function Age({ facts, unread, look }: { facts: RowFacts; unread: boolean; look: RowLook }) {
  return (
    <span className="age" data-testid="task-item-age">
      <Live look={look} />
      {unread ? (
        <i
          className="unread"
          role="img"
          aria-label="Changed since you looked"
          title="Changed since you looked"
          data-testid="task-item-unread"
        />
      ) : null}
      <span className="age-text">{facts.age}</span>
    </span>
  )
}

/** The project's tile, then the step word (one line) or the status line under the name. */
function Under({
  task,
  look,
  oneLine,
  detailed,
  project,
  age,
}: {
  task: TaskSummary
  look: RowLook
  oneLine: boolean
  detailed: boolean
  project: Pick<ProjectFacts, "letters" | "color" | "label"> | undefined
  /** The age, for the narrowest sidebar, which moves it from the title's line to the end of this one. */
  age: string
}) {
  // Under a project the step word ends a one-line row; under status grouping the tile does.
  const stage = rowStage(task)
  const status = detailed ? look.sub : compactStatus(look)
  const showStage =
    !detailed && look.session === null && stage.toLowerCase() !== status.toLowerCase()
  return (
    <>
      {project !== undefined ? (
        <ProjectTile
          letters={project.letters}
          color={project.color}
          size="row"
          label={project.label}
          className="pj-row-tile"
        />
      ) : null}
      {oneLine ? (
        <span className="end" data-testid="task-item-end">
          <Live look={look} />
          <span data-testid="task-item-stage">{stage}</span>
        </span>
      ) : null}
      {oneLine ? null : (
        <span
          className={cn("sub", task.archived ? undefined : look.tone)}
          data-testid="task-item-sub"
          data-age={detailed ? age : undefined}
        >
          {showStage ? (
            <>
              <span className="row-stage" data-testid="task-item-stage">
                {stage}
              </span>
              <span aria-hidden="true"> · </span>
            </>
          ) : null}
          <span className="row-status">{status}</span>
        </span>
      )}
    </>
  )
}

export function TaskRow({
  task,
  group,
  route,
  go,
  now,
  interaction = false,
  onMenu,
  project,
  nested = false,
  oneLine = false,
  detailed = false,
  unread = false,
}: {
  task: TaskSummary
  group: RowGroup
  route: Route
  go: (route: Route) => void
  now: number
  interaction?: boolean
  onMenu?: (task: TaskSummary, event: React.MouseEvent) => void
  /** Status grouping: the task's project, as a tile at the end of the row. */
  project?: Pick<ProjectFacts, "letters" | "color" | "label">
  /** Under a project's header: indented to the header's tile. */
  nested?: boolean
  /** One line: the mark, the title and the step word (the date once shipped); no second line. */
  oneLine?: boolean
  /** Detailed: the age with its unread dot, and the third line (branch, pull request, agent). */
  detailed?: boolean
  /** The task changed since the viewer looked. */
  unread?: boolean
}) {
  const windows = useOptionalRuns()
  // A turn end holds 2 s before Your turn shows: the row draws once more when the hold ends.
  const [held, setHeld] = useState<number | null>(null)
  const at = held !== null && held > now ? held : now
  const look = rowLook({ task, group, interaction, now: at, runs: windows?.runs ?? [] })
  const recheck = look.session?.recheckAt ?? null
  useEffect(() => {
    if (recheck === null) return
    const timer = setTimeout(() => setHeld(recheck), Math.max(0, recheck - Date.now()))
    return () => clearTimeout(timer)
  }, [recheck])
  const { build } = look
  const isOpen = route.view === "task" && route.id === task.id
  const facts = rowFacts(task, now)
  const description = rowDescription(task, look, facts.age, unread)
  const stage = rowStage(task)
  const strip = stripOf(task, look)
  // Without a strip the step is a word, kept unless the status line already says it.
  const bare = strip === undefined && stage.toLowerCase() !== look.sub.toLowerCase()
  const session = look.session
  const card = detailed && !oneLine && session !== null && hasLiveCard(session)
  const hasLineContent = [card, strip !== undefined, hasMeta(facts), bare].some(Boolean)
  const showRowMeta = detailed && !oneLine && hasLineContent
  const rowButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn(
              "q-sitem two",
              oneLine && "one",
              detailed && !oneLine && "detail",
              isOpen && "on",
              nested && "pj-row",
              project !== undefined && "has-tile",
              group === "shipped" && "past",
            )}
            aria-current={isOpen ? "page" : undefined}
            aria-label={description}
            onClick={() => {
              if (build) windows?.select(build.id)
              go({ view: "task", id: task.id, doc: null })
            }}
            onContextMenu={onMenu ? (event) => onMenu(task, event) : undefined}
            data-nav="1"
            data-testid="task-item"
            data-group={group}
            data-state={look.state}
            data-live={session?.state}
          >
            <i
              className={cn("q-m", markClass(look))}
              data-who={look.mark}
              data-running={look.mark === "agent" ? "true" : undefined}
              aria-hidden="true"
            />
            <span className="title">{task.title}</span>
            {oneLine ? null : <Age facts={facts} unread={unread} look={look} />}
            <Under
              task={task}
              look={look}
              oneLine={oneLine}
              detailed={detailed}
              project={project}
              age={facts.age}
            />
            {/* A live row's toggle rides on this line, so it exists even when there is nothing else to show. */}
            {showRowMeta ? (
              <RowMeta
                facts={facts}
                stage={strip === undefined && bare ? stage : undefined}
                strip={strip}
              />
            ) : null}
          </button>
        }
      />
      <TooltipContent side="right">{description}</TooltipContent>
    </Tooltip>
  )
  return card && session !== null ? <LiveCard row={session}>{rowButton}</LiveCard> : rowButton
}

/** An agent window the App started: it stands where its task does, with the window's own words. */
export function RunRow({
  run,
  onOpen,
  nested = false,
  oneLine = false,
}: {
  run: RunWindow
  onOpen: (run: RunWindow) => void
  nested?: boolean
  oneLine?: boolean
}) {
  return (
    <button
      type="button"
      className={cn("q-sitem two", oneLine && "one", nested && "pj-row")}
      title={oneLine ? `${run.title} · ${runStatusText(run)}` : undefined}
      data-testid="managed-run-item"
      data-nav="1"
      data-state={run.status}
      onClick={() => onOpen(run)}
    >
      <i
        className={run.status === "failed" ? "q-m q-m-stop" : "q-m q-m-agent"}
        aria-hidden="true"
      />
      <span className="title">{run.title}</span>
      {oneLine ? null : <span className="sub">{runStatusText(run)}</span>}
    </button>
  )
}
