import type { MemoryApi, MemoryProject, MemoryRecordView } from "../../memory-contracts.ts"
import {
  buildMemoryActivity,
  demoRepository,
  importPilotFiles,
  matchesMemoryQuery,
} from "./memory-ops.ts"
import { pageOf, previewOf, seedDemoProjects, seedDemoRecords } from "./memory-seed.ts"

const PARTIAL_PROJECT_ISSUES = [
  { id: "pay", name: "acme/payments", reason: "root-unavailable" as const },
  { id: "web", name: "acme/web", reason: "registration-failed" as const },
]

function isSharedRecord(projects: readonly MemoryProject[], record: MemoryRecordView): boolean {
  if (record.visibility !== "project") return false
  return (
    record.source === "repository" ||
    projects.find((item) => item.id === record.project)?.sharing === true
  )
}

function togglePinRecord(
  records: MemoryRecordView[],
  record: MemoryRecordView,
  pinned: boolean,
): void {
  if (pinned && record.state !== "active")
    throw new Error("A retired lesson cannot be pinned. Restore it first.")
  const count = records.filter((other) => other.project === record.project && other.pinned).length
  if (pinned && !record.pinned && count >= 5)
    throw new Error("5 lessons are pinned in this project. Unpin one to pin this.")
  record.pinned = pinned
}

function applyRetire(record: MemoryRecordView, active: boolean): MemoryRecordView {
  record.state = active ? "active" : "retired"
  if (!active) record.pinned = false
  record.revision += 1
  if (active) delete record.retired
  else record.retired = { reason: "", by: "you", at: Date.now() }
  return structuredClone(record)
}

function applyConfirm(record: MemoryRecordView, reason: string | undefined): MemoryRecordView {
  record.checked = { commit: "0".repeat(40), at: Date.now(), ...(reason ? { reason } : {}) }
  record.sources = { state: "unchanged" }
  return structuredClone(record)
}

function findInList<T extends { id: string }>(items: readonly T[], id: string, label: string): T {
  const found = items.find((item) => item.id === id)
  if (!found) throw new Error(`This ${label} is not in the demonstration.`)
  return found
}

/** Illustrative local data for source UI checks; each browser gets independent state. */
export function createDemoMemory(onChange: () => void = () => {}): MemoryApi {
  const params = typeof location === "undefined" ? null : new URLSearchParams(location.search)
  const mode = params?.get("memoryState") ?? "ready"
  const story = params?.has("story") ?? false
  let enabled = mode !== "paused"
  let sessions = true
  let unavailable = mode === "unavailable"
  const projects = seedDemoProjects(story)
  const records = seedDemoRecords(mode, story)

  const projectById = (id: string) => findInList(projects, id, "project")
  const recordById = (id: string) => findInList(records, id, "memory")
  const sharedOf = (record: MemoryRecordView) => isSharedRecord(projects, record)
  const withShared = (record: MemoryRecordView) => ({ ...record, shared: sharedOf(record) })

  return {
    repository: demoRepository(records, projectById, recordById, onChange),
    overview: async (project) => {
      const scoped = records.filter((record) => !project || record.project === project)
      const issue = unavailable
        ? "Memory is temporarily unavailable. Your coding task can continue."
        : undefined
      unavailable = false
      return {
        enabled,
        sessions,
        total: scoped.length,
        shared: scoped.filter(sharedOf).length,
        imported: scoped.filter((record) => record.source === "pilot").length,
        projects: projects.length,
        sharedProjects: {
          shared: projects.filter((item) => item.sharing).length,
          total: projects.length,
        },
        recent: scoped.slice(0, 3).map(previewOf),
        available: !issue,
        issue,
        ...(mode === "partial" ? { projectIssues: PARTIAL_PROJECT_ISSUES } : {}),
      }
    },
    settings: async (patch) => {
      enabled = patch.enabled ?? enabled
      sessions = patch.sessions ?? sessions
      onChange()
      return { enabled, sessions }
    },
    projects: async (query) => {
      const words = query?.query?.toLowerCase()
      const matches = projects
        .filter((project) => !words || project.name.toLowerCase().includes(words))
        .map((project) => ({
          ...project,
          count: records.filter((record) => record.project === project.id).length,
        }))
      return pageOf(matches, query?.cursor, query?.limit)
    },
    sharing: async (id, sharing) => {
      const project = projectById(id)
      project.sharing = sharing
      onChange()
      return { ...project, count: records.filter((record) => record.project === id).length }
    },
    list: async (query) => {
      const matches = records.filter((record) => matchesMemoryQuery(record, query))
      return pageOf(
        matches.map((record) => ({ ...previewOf(record), shared: sharedOf(record) })),
        query?.cursor,
        query?.limit,
      )
    },
    read: async (id) => structuredClone(withShared(recordById(id))),
    pin: async (id, pinned) => {
      const record = recordById(id)
      togglePinRecord(records, record, pinned)
      onChange()
      return structuredClone(withShared(record))
    },
    pinned: async (project) =>
      records
        .filter(
          (record) => record.project === project && record.pinned && record.state === "active",
        )
        .map(previewOf),
    activity: async () => buildMemoryActivity(records),
    retire: async (id, active) => {
      const next = applyRetire(recordById(id), active)
      onChange()
      return next
    },
    confirm: async (id, reason) => {
      const next = applyConfirm(recordById(id), reason)
      onChange()
      return next
    },
    importPilot: async (input) => {
      projectById(input.project)
      return importPilotFiles(records, input, onChange)
    },
  }
}
