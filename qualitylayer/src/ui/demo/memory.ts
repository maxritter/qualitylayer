import {
  ANSWER_TAG,
  type MemoryApi,
  type MemoryPage,
  type MemoryPreview,
  type MemoryProject,
  type MemoryRecordView,
  PERSONAL_PROJECT,
} from "../../memory-contracts.ts"

const NAMES = [
  ["pay", "acme/payments"],
  ["web", "acme/web"],
  ["cli", "tools/cli"],
  ["platform", "acme/platform"],
] as const
const LESSONS = [
  [
    "Keep payment retries idempotent",
    "Reuse the payment attempt key when a request is retried. A fresh key can capture the payment twice.",
  ],
  [
    "Bound the database lock timeout",
    "Keep a short lock timeout during migrations and retry the migration after busy transactions finish.",
  ],
  [
    "Preserve audit filters in the address",
    "Store the actor and date range in the URL so copied links show the same audit entries.",
  ],
  [
    "Back off webhook delivery",
    "Retry temporary webhook failures with bounded backoff and keep the original event identifier.",
  ],
  [
    "Validate configuration before saving",
    "Show invalid configuration values beside the field and retain the last saved configuration.",
  ],
  [
    "Keep browser previews isolated",
    "Serve shared previews in a sandboxed frame and disable navigation and executable content.",
  ],
  [
    "Handle a cancelled export",
    "Release temporary export files when the request is cancelled, including failures before the response starts.",
  ],
  [
    "Check phone layouts with long names",
    "Use realistic long project and task names when checking narrow layouts and keyboard focus.",
  ],
] as const

/** Where each lesson came from, in LESSONS order: the task that taught it, its check and its file. */
const EVIDENCE = [
  ["2026-09-03-payment-retries", "tests/payments/retry.test.ts", "services/payments/src/retry.ts"],
  ["2026-09-08-migration-locks", "tests/db/migrate-lock.test.ts", "db/migrate.ts"],
  [
    "2026-09-15-audit-filters",
    "tests/admin/audit-filters.test.ts",
    "apps/admin/src/audit/filters.ts",
  ],
  [
    "2026-09-22-webhook-retries",
    "tests/webhooks/backoff.test.ts",
    "services/webhooks/src/deliver.ts",
  ],
  [
    "2026-09-29-config-validation",
    "tests/settings/config.test.ts",
    "apps/web/src/settings/config.ts",
  ],
  [
    "2026-10-02-preview-sandbox",
    "tests/previews/sandbox.test.ts",
    "apps/web/src/previews/frame.ts",
  ],
  ["2026-10-06-export-cancel", "tests/exports/cancel.test.ts", "services/exports/src/stream.ts"],
  [
    "2026-10-09-phone-layouts",
    "tests/web/narrow-layout.test.ts",
    "apps/web/src/layout/sidebar.tsx",
  ],
] as const

/**
 * The story's Memory (`?story`): the example company's three projects, and the lesson its billing task
 * just taught first, with the earlier lessons each once.
 */
const STORY_NAMES = [
  ["platform", "acme/platform"],
  ["pay", "acme/payments"],
  ["web", "website"],
] as const
const STORY_LESSONS = [
  [
    "Key each meter event by its request id",
    "A retry keeps the request id, so a meter event keyed by it counts the request once. A fresh id per attempt bills a retry twice.",
  ],
  ...LESSONS,
] as const
const STORY_EVIDENCE = [
  ["2026-10-26-usage-billing", "tests/gateway/meter.test.ts", "services/gateway/src/meter.ts"],
  ...EVIDENCE,
] as const

function pageOf<T>(items: T[], cursor?: string, limit = 20): MemoryPage<T> {
  const offset = Math.max(0, Number(cursor) || 0)
  const size = Math.max(1, Math.min(20, limit))
  return {
    items: structuredClone(items.slice(offset, offset + size)),
    total: items.length,
    next: offset + size < items.length ? String(offset + size) : null,
  }
}

function previewOf(record: MemoryRecordView): MemoryPreview {
  const { content, ...metadata } = record
  return { ...metadata, preview: content.slice(0, 180), pinned: record.pinned === true }
}

function demoRepository(
  records: readonly MemoryRecordView[],
  projectById: (id: string) => MemoryProject,
  recordById: (id: string) => MemoryRecordView,
  onChange: () => void,
): MemoryApi["repository"] {
  const available = (project: string) =>
    records.filter(
      (record) =>
        record.project === project && record.visibility === "project" && record.source !== "pilot",
    )
  const restored = new Set<string>()
  const conflicts = new Map<string, MemoryRecordView>()
  const totals = (project?: string) => {
    const pending = [...conflicts.values()].filter(
      (record) => !project || record.project === project,
    )
    const first = pending[0]
    return {
      total: pending.length,
      ...(first
        ? { next: { project: first.project, name: projectById(first.project).name, id: first.id } }
        : {}),
    }
  }
  return {
    preview: async (project, operation) => ({
      count:
        operation === "export" ? available(project).length : Math.min(2, available(project).length),
    }),
    export: async (project) => ({
      written: projectById(project).sharing ? available(project).length : 0,
      imported: 0,
      skipped: 0,
      conflicts: 0,
      issues: [],
    }),
    restore: async (project) => {
      const first = available(project)[0]
      if (!first || restored.has(project))
        return { written: 0, imported: 0, skipped: first ? 1 : 0, conflicts: 0, issues: [] }
      restored.add(project)
      conflicts.set(first.id, {
        ...first,
        revision: first.revision + 1,
        content: `${first.content} Check the change with a repository test.`,
      })
      onChange()
      return { written: 0, imported: 0, skipped: 0, conflicts: 1, issues: [] }
    },
    conflicts: async (project) => totals(project),
    compare: async (_project, id) => {
      const repository = conflicts.get(id)
      if (!repository) throw new Error("This lesson has no retained conflict.")
      return {
        local: structuredClone(recordById(id)),
        candidates: [{ fingerprint: "a".repeat(64), version: structuredClone(repository) }],
      }
    },
    reconcile: async (_project, id, input) => {
      const local = recordById(id)
      const variant = conflicts.get(id)
      if (!variant || input.revision !== local.revision)
        throw new Error("Refresh the lesson versions.")
      if (input.candidate !== "local") local.content = variant.content
      local.revision = variant.revision + 1
      conflicts.delete(id)
      onChange()
      return { revision: local.revision }
    },
  }
}

/** Illustrative local data for source UI checks; each browser gets independent state. */
export function createDemoMemory(onChange: () => void = () => {}): MemoryApi {
  const mode =
    typeof location === "undefined"
      ? "ready"
      : (new URLSearchParams(location.search).get("memoryState") ?? "ready")
  let enabled = mode !== "paused"
  let sessions = true
  let unavailable = mode === "unavailable"
  const story = typeof location !== "undefined" && new URLSearchParams(location.search).has("story")
  const names: readonly (readonly [string, string])[] = story ? STORY_NAMES : NAMES
  const lessons: readonly (readonly [string, string])[] = story ? STORY_LESSONS : LESSONS
  const evidenceOf: readonly (readonly [string, string, string])[] = story
    ? STORY_EVIDENCE
    : EVIDENCE
  // The full demo checks a long project list; the story's day has its own three.
  const projects: MemoryProject[] = Array.from(
    { length: story ? names.length : 64 },
    (_, index) => {
      const named = names[index]
      const id = named?.[0] ?? `service-${String(index + 1).padStart(2, "0")}`
      return {
        id,
        name: named?.[1] ?? `acme/service-${String(index + 1).padStart(2, "0")}`,
        root: `/demo/${id}`,
        sharing: false,
        count: 0,
        git: true,
      }
    },
  )
  const records: MemoryRecordView[] =
    mode === "empty"
      ? []
      : Array.from({ length: story ? lessons.length : 28 }, (_, index) => {
          const lesson = lessons[index % lessons.length] as readonly [string, string]
          const [task, check, file] = evidenceOf[index % evidenceOf.length] as readonly [
            string,
            string,
            string,
          ]
          const source =
            !story && (index === 1 || index === 3)
              ? "pilot"
              : index === 6
                ? "manual"
                : index === 4
                  ? "session"
                  : index % 7 === 0
                    ? "repository"
                    : "task"
          return {
            schema: 1,
            id: `demo-lesson-${index + 1}`,
            project: names[index % names.length]?.[0] ?? "pay",
            origin: "demo-device",
            revision: 1,
            kind: index % 3 === 0 ? "bugfix" : "pattern",
            title: index < lessons.length ? lesson[0] : `${lesson[0]} (${index + 1})`,
            content: lesson[1],
            tags: story ? [] : ["sample"],
            files: index % 2 === 0 ? [file] : [],
            source,
            author: source === "pilot" ? "Demo author" : undefined,
            sourceAt: source === "pilot" ? "2026-09-12" : undefined,
            evidence:
              source === "task" || source === "repository"
                ? {
                    task,
                    commit: null,
                    checks: [check],
                    recordedAt: 1791446400000,
                  }
                : null,
            // Lessons of tasks and of the repository belong to their project; what came from a session, a note or Pilot stays private.
            visibility: source === "repository" || source === "task" ? "project" : "private",
            state: index === 5 ? "retired" : "active",
            // `?memoryState=pinned`: five of acme/payments' lessons are pinned, the most a project holds.
            pinned: mode === "pinned" ? index % 4 === 0 && index < 20 : index === 0,
            createdAt: 1791446400000,
            updatedAt: 1791446400000,
          }
        })
  // The newest lessons: two about the person, their own answer in a task, and one QualityLayer retired itself.
  if (mode !== "empty" && !story) {
    const own = (id: string, patch: Partial<MemoryRecordView>): MemoryRecordView => ({
      schema: 1,
      id,
      project: "platform",
      origin: "demo-device",
      revision: 1,
      kind: "preference",
      title: "",
      content: "",
      tags: [],
      files: [],
      source: "session",
      evidence: null,
      visibility: "private",
      state: "active",
      pinned: false,
      createdAt: 1792000000000,
      updatedAt: 1792000000000,
      ...patch,
    })
    records.push(
      own("demo-yours-1", {
        project: PERSONAL_PROJECT,
        title: "Lead every segmented option with an icon",
        content:
          "Put an icon before every label in a segmented control, because text-only segments read as plain buttons.",
      }),
      own("demo-yours-2", {
        project: PERSONAL_PROJECT,
        title: "Answer in plain words",
        content: "Say what changed in plain words first; keep file names and jargon for later.",
      }),
      own("demo-answer-1", {
        title: "Should the export include archived invoices?",
        content:
          "Should the export include archived invoices? Decided with you: no, only open and paid ones.",
        kind: "decision",
        source: "task",
        tags: [ANSWER_TAG],
        evidence: {
          task: "activity-report-export",
          commit: null,
          checks: [],
          recordedAt: 1792000000000,
        },
      }),
      own("demo-retired-1", {
        title: "Read exchange rates once per invoice",
        content:
          "Read the exchange rate once when the invoice opens, because rates read per line made one invoice add up two ways.",
        kind: "pattern",
        source: "task",
        visibility: "project",
        files: ["services/invoicing/src/currency.ts"],
        evidence: {
          task: "customer-currency",
          commit: null,
          checks: ["tests/invoicing/currency.test.ts"],
          recordedAt: 1791446400000,
        },
        state: "retired",
        retired: {
          reason:
            "its files changed in 6 commits since it was last checked on 14 July, and no task checked it again within 90 days",
          by: "qualitylayer",
          at: 1792000000000,
        },
      }),
    )
  }
  const projectById = (id: string) => {
    const project = projects.find((item) => item.id === id)
    if (!project) throw new Error("This project is not in the demonstration.")
    return project
  }
  const recordById = (id: string) => {
    const record = records.find((item) => item.id === id)
    if (!record) throw new Error("This memory is not in the demonstration.")
    return record
  }
  /** Project-visible, and its repository shares or it came from the repository. */
  const sharedOf = (record: MemoryRecordView) =>
    record.visibility === "project" &&
    (record.source === "repository" || projects.find((item) => item.id === record.project)?.sharing)
  const withShared = (record: MemoryRecordView) => ({
    ...record,
    shared: sharedOf(record) === true,
  })
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
        ...(mode === "partial"
          ? {
              projectIssues: [
                { id: "pay", name: "acme/payments", reason: "root-unavailable" as const },
                { id: "web", name: "acme/web", reason: "registration-failed" as const },
              ],
            }
          : {}),
      }
    },
    settings: async (patch) => {
      enabled = patch.enabled ?? enabled
      sessions = patch.sessions ?? sessions
      onChange()
      return { enabled, sessions }
    },
    projects: async (query) => {
      const matches = projects
        .filter(
          (project) =>
            !query?.query || project.name.toLowerCase().includes(query.query.toLowerCase()),
        )
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
      const words = query?.query?.toLowerCase() ?? ""
      const matches = records.filter(
        (record) =>
          (!query?.project || record.project === query.project) &&
          (!query?.state || record.state === query.state) &&
          (!query?.source || query.source === "all" || query.source === record.source) &&
          (!query?.scope || query.scope === "all" || query.scope === record.visibility) &&
          (!words ||
            `${record.title} ${record.content} ${record.files.join(" ")}`
              .toLowerCase()
              .includes(words)),
      )
      return pageOf(
        matches.map((record) => ({ ...previewOf(record), shared: sharedOf(record) === true })),
        query?.cursor,
        query?.limit,
      )
    },
    read: async (id) => structuredClone(withShared(recordById(id))),
    pin: async (id, pinned) => {
      const record = recordById(id)
      if (pinned && record.state !== "active")
        throw new Error("A retired lesson cannot be pinned. Restore it first.")
      if (
        pinned &&
        !record.pinned &&
        records.filter((other) => other.project === record.project && other.pinned).length >= 5
      )
        throw new Error("5 lessons are pinned in this project. Unpin one to pin this.")
      record.pinned = pinned
      onChange()
      return structuredClone(withShared(record))
    },
    pinned: async (project) =>
      records
        .filter(
          (record) => record.project === project && record.pinned && record.state === "active",
        )
        .map(previewOf),
    activity: async () => {
      // A task that used lessons in Plan and Verify; the retired one has no title left to show.
      const lesson = (index: number) => {
        const record = records[index]
        return {
          id: record?.id ?? `demo-lesson-${index + 1}`,
          title: record?.state === "active" ? record.title : null,
          ...(record?.project === PERSONAL_PROJECT ? { personal: true as const } : {}),
        }
      }
      // The first lesson about the person follows the 28 project lessons.
      const yours = records.findIndex((record) => record.project === PERSONAL_PROJECT)
      return {
        reads: yours < 0 ? 5 : 6,
        saves: 2,
        lastAt: 1791446400000,
        steps: {
          plan: {
            used: [lesson(0), lesson(1), lesson(5), ...(yours < 0 ? [] : [lesson(yours)])],
            saved: [],
          },
          verify: { used: [lesson(2), lesson(3)], saved: [lesson(4), lesson(6)] },
        },
      }
    },
    retire: async (id, active) => {
      const record = recordById(id)
      record.state = active ? "active" : "retired"
      if (!active) record.pinned = false
      record.revision += 1
      if (active) delete record.retired
      else record.retired = { reason: "", by: "you", at: Date.now() }
      onChange()
      return structuredClone(record)
    },
    confirm: async (id, reason) => {
      const record = recordById(id)
      record.checked = { commit: "0".repeat(40), at: Date.now(), ...(reason ? { reason } : {}) }
      record.sources = { state: "unchanged" }
      onChange()
      return structuredClone(record)
    },
    importPilot: async (input) => {
      projectById(input.project)
      if (
        input.files.length > 100 ||
        input.files.reduce((sum, file) => sum + new TextEncoder().encode(file.content).length, 0) >
          2 * 1024 * 1024
      )
        throw new Error("Choose up to 100 files, at most 2 MB in total.")
      const prior = records.filter(
        (record) => record.source === "pilot" && record.project === input.project,
      )
      const result = { imported: 0, updated: 0, skipped: 0, issues: [] as string[] }
      for (const file of input.files) {
        if (prior.some((record) => record.sourceId === file.name)) {
          result.skipped += 1
          continue
        }
        if (!/\.(jsonl|md)$/i.test(file.name) || !file.content.trim()) {
          result.skipped += 1
          result.issues.push(`${file.name}: choose a nonempty Pilot .jsonl or .md memory file.`)
          continue
        }
        const title = file.name.replace(/\.(jsonl|md)$/i, "")
        records.unshift({
          schema: 1,
          id: `demo-import-${records.length + 1}`,
          project: input.project,
          origin: "demo-import",
          revision: 1,
          kind: "discovery",
          title,
          content: file.content.slice(0, 16000),
          tags: ["sample-import"],
          files: [],
          source: "pilot",
          sourceId: file.name,
          evidence: null,
          visibility: "private",
          state: "active",
          createdAt: 1791446400000,
          updatedAt: 1791446400000,
        })
        result.imported += 1
      }
      result.issues.push(
        "Demonstration import only. Real Pilot imports validate record schemas, provenance and project boundaries.",
      )
      onChange()
      return result
    },
  }
}
