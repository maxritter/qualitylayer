import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import type { DocEntry } from "../../server/api.ts"
import { hasChecksRecord, materializeChecksRecord } from "../check-receipts.ts"
import { CHECKS_RECORD, NAMES, RESEARCH_DIR } from "../docs/names.ts"
import {
  MEMORY_ACTIVITY_RECORD,
  memoryActivityText,
  readMemoryActivity,
} from "../memory-activity.ts"
import { pullRequestBody } from "../ship/pr-body.ts"
import { currentTaskRecordOwner } from "../task/answer-migration.ts"
import type { Task } from "../task/store.ts"

type Holder = Pick<Task, "dir" | "repoRoot" | "earlier"> &
  Partial<Pick<Task, "repoId" | "slug" | "runtimeDir">>
const guarded = (ctx: Ctx, task: Holder) =>
  ctx.fs.forPublication?.(task.repoRoot, task.dir) ?? ctx.fs
/** A research helper's report as it wrote it (`research/r1.md`). Arbitrary files are not records. */
const RESEARCH_REPORT = new RegExp(`^${RESEARCH_DIR}/[A-Za-z0-9][\\w-]{0,80}\\.md$`)
/** A recorded terminal output of the acceptance test (core/review/screens.ts names it). */
const OUTPUT_RECORD = /^(?:records\/output-[0-9a-f]{8,64}|evidence\/[A-Za-z0-9][\w.-]{0,120})\.txt$/
/** A task's pull request body: the one file of its records/ the Reader opens. */
export const PULL_REQUEST_BODY_RECORD = "records/pull-request-body.md"

export async function readRecord(ctx: Ctx, task: Holder, path: string): Promise<string> {
  if (path === CHECKS_RECORD && task.runtimeDir) {
    const markdown = await materializeChecksRecord(ctx, { ...task, runtimeDir: task.runtimeDir })
    if (markdown !== null) return markdown.slice(0, 200000)
  }
  if (path === MEMORY_ACTIVITY_RECORD && task.repoId && task.slug) {
    return memoryActivityText(await readMemoryActivity(ctx, task.repoId, task.slug))
  }
  if (path === PULL_REQUEST_BODY_RECORD) {
    // The file `gh` was handed once the pull request was opened; before that, the body as it will be
    // sent, cut from the Verify file the same way (core/ship/pr-body.ts).
    const fs = guarded(ctx, task)
    const sent = join(task.dir, PULL_REQUEST_BODY_RECORD)
    if (await fs.exists(sent)) return (await fs.readFile(sent)).slice(0, 200000)
    return pullRequestBody(await fs.readFile(join(task.dir, NAMES.verify))).slice(0, 200000)
  }
  if (!RESEARCH_REPORT.test(path) && !OUTPUT_RECORD.test(path))
    throw new Error("Only this task's registered text records can be read.")
  return (await guarded(ctx, task).readFile(join(task.dir, path))).slice(0, 200000)
}
export async function recordIndex(ctx: Ctx, task: Holder): Promise<DocEntry[]> {
  const fs = guarded(ctx, task)
  const rows: DocEntry[] = []
  if (task.runtimeDir && (await hasChecksRecord(ctx, { ...task, runtimeDir: task.runtimeDir }))) {
    rows.push({
      name: CHECKS_RECORD,
      label: "Checks",
      exists: true,
      status: "record",
      approved: false,
    })
  }
  if (
    task.runtimeDir &&
    (await currentTaskRecordOwner(ctx, { ...task, runtimeDir: task.runtimeDir }))
  ) {
    rows.push({
      name: "annotations-v1",
      label: "Annotation history",
      exists: true,
      status: "record",
      approved: false,
      runtimeRecord: { id: "annotations-v1", scope: "task" },
    })
  }
  if (task.repoId && task.slug) {
    // Always listed: a task that used no lesson yet opens a record that says so.
    rows.push({
      name: MEMORY_ACTIVITY_RECORD,
      label: "Memory",
      exists: true,
      status: "record",
      approved: false,
    })
  }
  // Only the helpers' own files: a link (the folder or a report) is never followed.
  let reports: string[] = []
  try {
    const dir = join(task.dir, RESEARCH_DIR)
    const kind = ctx.fs.lstat === undefined ? "directory" : (await ctx.fs.lstat(dir))?.kind
    if (kind === "directory")
      reports = (await fs.entries(dir))
        .filter((entry) => entry.kind === "file")
        .map((entry) => entry.name)
        .sort()
  } catch {
    /* No helper reported yet. */
  }
  for (const report of reports) {
    const name = `${RESEARCH_DIR}/${report}`
    if (!RESEARCH_REPORT.test(name)) continue
    rows.push({
      name,
      label: `Research ${report.replace(/\.md$/, "")}`,
      exists: true,
      status: "record",
      approved: false,
    })
  }
  return rows
}
