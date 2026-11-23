// `?scale=large`: the demo with the amounts of data a busy person has, to check that no screen
// clips, overlaps, loses its scroll or pushes its main action away when the lists get long. The
// address fixes it, nothing is stored, and without `?scale=large` the API is returned as it is.
// Demo only.
//
// The wrapper does not touch `api.ts`: it replaces the calls that return lists (projects, tasks,
// the library, the settings lists) and, for the demo task (`demo`), the
// calls that return its documents and records, by cloning the demo's own records and multiplying
// their list fields. The records keep the shapes the App reads; no field is invented.

import type { Api } from "../api.ts"
import type { WalkthroughApi } from "../timeline/walkthrough-api.ts"
import { largeArtifacts } from "./scale-artifacts.ts"
import { LARGE, largeAsked } from "./scale-counts.ts"
import { largeDemoTask } from "./scale-demo-task.ts"
import { largeSettings } from "./scale-settings.ts"
import { LARGE_PROJECTS, type LargeTasks, largeTasks } from "./scale-tasks.ts"
import { DEMO_TASK_ID } from "./task/index.ts"

type ScaledApi = Api & Pick<WalkthroughApi, "walkthrough">

function buildScaledTasks(
  api: Api,
  world: LargeTasks,
  large: ReturnType<typeof largeDemoTask>,
): Pick<Api, "projects" | "tasks" | "task" | "doc" | "sections"> {
  return {
    projects: async () => structuredClone(LARGE_PROJECTS),
    tasks: async () => {
      const own = await api.tasks()
      return [...own.map((task) => large.summary(task)), ...world.summaries()]
    },
    task: async (id, signal) => world.detail(id) ?? large.task(await api.task(id, signal)),
    doc: async (id, name, signal) =>
      world.doc(id, name) ?? large.doc(id, name, () => api.doc(id, name, signal)),
    sections: async (id, name) =>
      world.sections(id, name) ?? large.sections(id, name, () => api.sections(id, name)),
  }
}

function lendTaskCalls(scaled: ScaledApi, world: LargeTasks): Api {
  const lend = <A extends unknown[], R>(call: ((id: string, ...rest: A) => R) | undefined) =>
    call === undefined
      ? undefined
      : (id: string, ...rest: A): R => call(world.has(id) ? DEMO_TASK_ID : id, ...rest)
  return {
    ...scaled,
    ...(scaled.artifact && { artifact: lend(scaled.artifact) }),
    ...(scaled.evidence && { evidence: lend(scaled.evidence) }),
    ...(scaled.record && { record: lend(scaled.record) }),
    ...(scaled.cost && { cost: lend(scaled.cost) }),
    ...(scaled.taskArtifacts && { taskArtifacts: lend(scaled.taskArtifacts) }),
    ...(scaled.taskRecords && { taskRecords: lend(scaled.taskRecords) }),
    ...(scaled.changes && { changes: lend(scaled.changes) }),
    ...(scaled.fileDiff && { fileDiff: lend(scaled.fileDiff) }),
    ...(scaled.walkthrough && { walkthrough: lend(scaled.walkthrough) }),
  } as Api
}

/**
 * The API with the large data of `?scale=large`; the API itself when the address does not ask for it.
 * Calls it does not list go to the demo's own API, so every other part of the demo works as before.
 */
export function withLargeData(api: Api, search: string): Api {
  if (!largeAsked(search)) return api
  const now = Date.now()
  const world = largeTasks(now)
  const large = largeDemoTask(api)
  const scaled: ScaledApi = {
    ...api,
    ...buildScaledTasks(api, world, large),
    ...large.calls(),
    ...largeSettings(api, world, now),
    ...largeArtifacts(api, now),
  }
  return lendTaskCalls(scaled, world)
}

export { LARGE, largeAsked }
