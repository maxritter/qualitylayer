import type { ReactNode } from "react"
import { lastingDocOf } from "../../core/artifact/format.ts"
import type { ArtifactFidelity } from "../../core/config-values.ts"
import type { ProjectLooks } from "../../core/project-look.ts"
import type { Api, Project, TaskSummary } from "../api.ts"
import { type Route, useQuery } from "../hooks.ts"
import type { StoredWidth } from "../Resizer.tsx"
import { useOptionalRuns } from "../run-context.tsx"
import { buildRunForTask } from "../runs-api.ts"
import { artifactViewing, ViewingProvider } from "../viewing.tsx"
import { LastingArtifactView } from "./LastingArtifactView.tsx"
import { originOf } from "./origin.ts"
import { PersonalArtifactView } from "./PersonalArtifactView.tsx"
import type { ArtifactsOverviewQuery } from "./useArtifacts.ts"

export type ArtifactRouteProps = {
  api: Api
  route: Extract<Route, { view: "artifact" }>
  overview: ArtifactsOverviewQuery
  projects: Project[]
  tasks: TaskSummary[]
  looks: ProjectLooks
  version: number
  defaultFidelity?: ArtifactFidelity
  go: (route: Route) => void
  width: number
  compact: boolean
  railSize: StoredWidth
  resizing: boolean
  onResizing: (dragging: boolean) => void
  fullScreen: boolean
  onFullScreen: (on: boolean) => void
  menu: { compact: boolean; onOpen: () => void } | null
  artifactAgent?: (context: {
    address: { scope: "project" | "task"; id: string; file: string }
    title: string
  }) => ReactNode
  artifactAgentName?: string
  artifactAgentId?: string | null
  artifactAgentRunning?: boolean
}

export function ArtifactRoute(props: ArtifactRouteProps) {
  const lasting = lastingDocOf(props.route.file)
  const from = originOf(props.route.project, props.route.file)
  const task = from?.hash.split("/")[2]
  const taskId = task ? decodeURIComponent(task) : null
  const owner = useQuery(
    () => (taskId ? props.api.task(taskId) : Promise.resolve(null)),
    [props.api, taskId],
  )
  const windows = useOptionalRuns()
  const eligible =
    !!owner.data?.viewingEligible ||
    (taskId !== null && (windows?.runs.some((run) => buildRunForTask(run, taskId)) ?? false))
  const content = lasting ? (
    <LastingArtifactView {...props} name={lasting.name} page={lasting.page} />
  ) : (
    <PersonalArtifactView {...props} />
  )
  return taskId ? (
    <ViewingProvider
      api={props.api}
      task={taskId}
      location={artifactViewing(props.route.file)}
      eligible={eligible}
    >
      {content}
    </ViewingProvider>
  ) : (
    content
  )
}
