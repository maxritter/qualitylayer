import { useSyncExternalStore } from "react"
import type { Api, TaskSummary } from "./api.ts"
import type { RunWindow } from "./run-context.tsx"

type Disposition = "archived" | "deleted" | "restored"
export type TaskDispositionTarget = {
  created: number
  runs: readonly Pick<RunWindow, "id" | "generation">[]
}
type Snapshot = ReadonlyMap<string, Disposition>
const taskKey = (id: string, created: number) => JSON.stringify(["task", id, created])
const runKey = (id: string, generation: number) => JSON.stringify(["run", id, generation])
const EMPTY: Snapshot = new Map()
export type TaskDispositionStore = {
  snapshot(): Snapshot
  subscribe(listener: () => void): () => void
}
const scopes = new WeakMap<
  Api,
  {
    api: Api
    store: TaskDispositionStore
    publish(id: string, state: Disposition, target?: TaskDispositionTarget): void
  }
>()
const originals = new WeakMap<Api, Api>()
export const originalTaskApi = (api: Api): Api => originals.get(api) ?? api

type DispositionPublish = (id: string, state: Disposition, target?: TaskDispositionTarget) => void

function createDispositionStore(): { store: TaskDispositionStore; publish: DispositionPublish } {
  let snapshot: Snapshot = EMPTY
  const listeners = new Set<() => void>()
  const publish: DispositionPublish = (id, state, target) => {
    const next = new Map(snapshot)
    next.delete(id)
    const keys = target
      ? [...target.runs.map((run) => runKey(run.id, run.generation)), taskKey(id, target.created)]
      : [id]
    for (const key of keys) {
      next.delete(key)
      next.set(key, state)
    }
    while (next.size > 256) next.delete(next.keys().next().value as string)
    snapshot = next
    for (const listener of listeners) listener()
  }
  const store: TaskDispositionStore = {
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return { store, publish }
}

function wrapDispositionApi(original: Api, publish: DispositionPublish): Api {
  return new Proxy(original, {
    get(target, key, receiver) {
      if (key === "archive") {
        return async (id: string, archived: boolean) => {
          const result = await target.archive(id, archived)
          publish(id, archived ? "archived" : "restored", result.disposition)
          return result
        }
      }
      if (key === "deleteTask") {
        return async (id: string) => {
          const result = await target.deleteTask(id)
          publish(id, "deleted", result.disposition)
          return result
        }
      }
      return Reflect.get(target, key, receiver)
    },
  })
}

/** Successful local mutations outrank older reads, but never a new task that reuses the same ID. */
export function taskDispositionScope(source: Api, preserveIdentity = false) {
  const original = originalTaskApi(source)
  const known = scopes.get(original)
  if (known) return preserveIdentity ? { ...known, api: original } : known
  const { store, publish } = createDispositionStore()
  const api = wrapDispositionApi(original, publish)
  const scope = { api, store, publish }
  originals.set(api, original)
  scopes.set(original, scope)
  return preserveIdentity ? { ...scope, api: original } : scope
}

/** The real HTTP adapter publishes after success without changing its identity. */
export function noticeTaskDisposition(
  api: Api,
  id: string,
  state: Disposition,
  target?: TaskDispositionTarget,
): void {
  taskDispositionScope(api, true).publish(id, state, target)
}

export function useTaskDispositions(store?: TaskDispositionStore): Snapshot {
  return useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    store?.snapshot ?? (() => EMPTY),
  )
}

export function dispositionTasks<T extends Pick<TaskSummary, "id" | "archived" | "created">>(
  tasks: readonly T[],
  snapshot: Snapshot,
): T[] {
  return tasks.flatMap((task) => {
    const state = snapshot.get(taskKey(task.id, task.created)) ?? snapshot.get(task.id)
    return state === "deleted"
      ? []
      : [state === undefined ? task : { ...task, archived: state === "archived" }]
  })
}

export function dispositionRuns(runs: readonly RunWindow[], snapshot: Snapshot): RunWindow[] {
  return runs.map((run) => {
    const id =
      run.task ??
      (run.purpose.kind === "task"
        ? run.purpose.task
        : run.purpose.kind === "terminal" && run.purpose.context?.kind === "task"
          ? run.purpose.context.task
          : undefined)
    const state =
      snapshot.get(runKey(run.id, run.generation)) ?? (id ? snapshot.get(id) : undefined)
    return state === undefined
      ? run
      : {
          ...run,
          taskLifecycle: {
            stage: state === "deleted" ? "deleted" : (run.taskLifecycle?.stage ?? ""),
            archived: state !== "restored",
          },
        }
  })
}
