import type { ReactNode } from "react"
import type { AgentView } from "../../core/config-values.ts"
import { useViewportWidth } from "../hooks.ts"
import { type RunWindow, useOptionalRuns, type WorkflowController } from "../run-context.tsx"
import type { ContextDraftTarget } from "./conversation/context-draft.ts"
import { type AgentEmptyContent, DockRuns } from "./DockRuns.tsx"
import { TerminalLayoutProvider, useTerminalLayout } from "./layout.tsx"
import type { TaskAgentControls } from "./task-controls.ts"
import "./dock.css"

export type { TaskAgentControls } from "./task-controls.ts"

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
