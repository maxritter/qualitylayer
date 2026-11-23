// The demo task of `?scale=large` (scale.ts), at every App Model moment: a Plan of 30 slices
// and 120 tasks, 25 Done means points, 40 decisions, 8 questions in a batch, a change of 120
// files, a Verify with long finding lists, and a pull request with 20 checks.

import type { DocSections } from "../../server/doc-sections-split.ts"
import type { Api, TaskDetail, TaskSummary } from "../api.ts"
import type { WalkthroughApi } from "../timeline/walkthrough-api.ts"
import { LARGE } from "./scale-counts.ts"
import { scaleDocument } from "./scale-demo-documents.ts"
import { growBatch, growChecklist, growItems, grown, growParts } from "./scale-demo-fields.ts"
import {
  growSlices,
  LARGE_RECORDS,
  ORIGIN,
  scaleArtifacts,
  scaleChanges,
  scaleWalkthrough,
  times,
} from "./scale-demo-slices.ts"
import { DEMO_TASK_ID, taskSections } from "./task/index.ts"
import { stepPage } from "./task/page.ts"

export { growBatch, growItems, scaleDocument, scaleWalkthrough }

/** The pull request: 20 checks, as many as a big change draws. */
export function growPullRequest(task: TaskDetail): void {
  const pr = task.pullRequest
  if (pr === undefined) return
  const threads = pr.threads
  const checks = grown(pr.checks, LARGE.checks, (check, k) => ({
    ...structuredClone(check),
    name: `${check.name.replace(/ · .*$/, "")} · shard ${k}`,
    result: check.result === "failed" && k % 3 !== 0 ? "passed" : check.result,
    ...(check.result === "failed" && k % 3 !== 0 ? { summary: undefined } : {}),
  }))
  const failing = checks.filter((check) => check.result === "failed").length
  task.pullRequest = {
    ...pr,
    threads,
    checks,
    ...(pr.waiting === undefined
      ? {}
      : {
          waiting: {
            ...pr.waiting,
            threads: threads.length,
            threadIds: threads.map((t) => t.id),
            failing,
          },
        }),
  }
}

function growRecords(task: TaskDetail): void {
  if (task.records !== undefined)
    task.records = times(
      40,
      (at) => `${at % 2 === 0 ? "it" : "checks"}-${Math.floor(at / 2) + 1}-run-${at + 1}.txt`,
    )
  if (task.evidence.length > 0)
    task.evidence = times(
      30,
      (at) => `cp-${Math.floor(at / 3) + 1}-run-${(at % 3) + 1}-retries.png`,
    )
}

function growPages(task: TaskDetail): void {
  if (task.pages === undefined) return
  task.pages = task.pages.map((page) =>
    page.exists ? stepPage(page.step, scaleDocument(page.name, page.body)) : page,
  )
}

/** The demo task with the lists of the large demo. */
export function scaleDemoTask(task: TaskDetail): TaskDetail {
  const copy = structuredClone(task)
  growSlices(copy)
  growItems(copy)
  growBatch(copy)
  growParts(copy)
  growChecklist(copy)
  growPullRequest(copy)
  growRecords(copy)
  growPages(copy)
  return copy
}

function buildScaledTaskCalls(
  api: Api,
  baseWalk: WalkthroughApi["walkthrough"] | undefined,
): Partial<Api> & Pick<WalkthroughApi, "walkthrough"> {
  return {
    ...(baseWalk === undefined
      ? {}
      : {
          walkthrough: async (id: string) => {
            const walk = await baseWalk(id)
            return id === DEMO_TASK_ID ? scaleWalkthrough(walk) : walk
          },
        }),
    changes: async (id, options) => {
      const base = await api.changes(id, options)
      if (id !== DEMO_TASK_ID || baseWalk === undefined) return base
      return scaleChanges(base, scaleWalkthrough(await baseWalk(id)))
    },
    fileDiff: async (id, path, options) => {
      const origin = ORIGIN.get(path)
      const diff = await api.fileDiff(id, origin ?? path, options)
      return origin === undefined ? diff : diff.replaceAll(origin, path)
    },
    taskRecords: async (id) => (id === DEMO_TASK_ID ? structuredClone(LARGE_RECORDS) : []),
    taskArtifacts: async (id) =>
      id === DEMO_TASK_ID ? scaleArtifacts(api.taskArtifacts(id)) : api.taskArtifacts(id),
  }
}

export function largeDemoTask(api: Api) {
  const baseWalk = (api as WalkthroughApi).walkthrough
  return {
    summary: <T extends TaskSummary>(task: T): T =>
      task.id === DEMO_TASK_ID
        ? (scaleDemoTask(task as unknown as TaskDetail) as unknown as T)
        : task,
    task: (task: TaskDetail): TaskDetail => (task.id === DEMO_TASK_ID ? scaleDemoTask(task) : task),
    doc: async (
      id: string,
      name: string,
      fallback: () => ReturnType<Api["doc"]>,
    ): ReturnType<Api["doc"]> => {
      const found = await fallback()
      return id === DEMO_TASK_ID
        ? { ...found, markdown: scaleDocument(name, found.markdown) }
        : found
    },
    sections: async (
      id: string,
      name: string,
      fallback: () => Promise<DocSections>,
    ): Promise<DocSections> => {
      if (id !== DEMO_TASK_ID) return fallback()
      const seen = await api.doc(id, name)
      return taskSections(name, scaleDocument(name, seen.markdown)) ?? (await fallback())
    },
    calls: () => buildScaledTaskCalls(api, baseWalk),
  }
}
