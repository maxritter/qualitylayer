import type { Ctx } from "../../ctx.ts"
import { lineTotal } from "../review/line-counts.ts"
import type { ChangeHistory, WalkFile, Walkthrough } from "../review/walkthrough.ts"
import { readSession, type Task } from "../task/store.ts"
import { readBuildStart } from "./build-start.ts"
import type { Changes } from "./changes.ts"
import { ownEdits } from "./session-edits.ts"
import type { VerifyRange } from "./verify-range.ts"
import { nativeCoverage, type SourceReads } from "./workflow-coverage.ts"
import { type PageRequest, type WorkflowPage, workflowPage } from "./workflow-pages.ts"
import {
  candidateParts,
  committedParts,
  type OwnedPart,
  patchCounts,
  readCommittedPart,
} from "./workflow-parts.ts"
import { currentWorkingText, workingPath } from "./working-capture.ts"
import { WORKING_CLOSED_KEEP_MS, WORKING_VIEW_DIFFS_MAX } from "./working-limits.ts"
import { forgetWorkingPatches, rememberWorkingPatch, workingPatch } from "./working-patch-cache.ts"
import {
  digest,
  expireWorkingRecords,
  readWorkingLedger,
  type WorkingOperation,
  type WorkingRecord,
  workingObjectPath,
  workingSource,
  workingTaskKey,
} from "./working-records.ts"

export type WorkflowProjection = {
  history?: ChangeHistory
  candidate?: true
  tracked?: boolean
  files: WalkFile[]
  parts: Map<string, OwnedPart>
  commits: string[]
  pending: { path: string; reason: string }[]
  workingFiles: string[]
  localOnlyFiles: string[]
  page?: WorkflowPage
}
const BYTE_BUDGET = 4 * 1024 * 1024
type Budget = { left: number }
const quote = (path: string) => JSON.stringify(path)

function renamePatch(patch: string, op: WorkingOperation): string {
  const old = quote(`a/${op.from ?? op.path}`),
    next = quote(`b/${op.path}`)
  if (!patch && op.from)
    return `diff --git ${old} ${next}\nsimilarity index 100%\nrename from ${op.from}\nrename to ${op.path}\n`
  let header = true
  const changed = patch
    .split("\n")
    .map((line) => {
      if (line.startsWith("@@")) header = false
      if (!header) return line
      if (/^(?:new file mode|deleted file mode|old mode|new mode) /.test(line)) return undefined
      if (line.startsWith("index ")) return line.replace(/ \d{6}$/, "")
      if (line.startsWith("diff --git ")) return `diff --git ${old} ${next}`
      if (line.startsWith("--- ")) return `--- ${op.before === null ? "/dev/null" : old}`
      if (line.startsWith("+++ ")) return `+++ ${op.after === null ? "/dev/null" : next}`
      return line
    })
    .filter((line) => line !== undefined)
    .join("\n")
  if (!changed.includes("\n--- ") && (op.before === null || op.after === null))
    return `${changed.trimEnd()}\n--- ${op.before === null ? "/dev/null" : old}\n+++ ${op.after === null ? "/dev/null" : next}\n`
  return changed
}

async function savedPart(
  ctx: Ctx,
  task: Task,
  id: string,
  op: WorkingOperation,
  budget: Budget,
): Promise<OwnedPart> {
  for (const hash of [op.before, op.after]) {
    if (hash === null) continue
    if (budget.left < 0) throw new Error("Saved source reading limit reached")
    const text = await workingSource(ctx, hash, budget.left)
    budget.left -= Buffer.byteLength(text)
    if (budget.left < 0) throw new Error("Saved source reading limit reached")
  }
  const metadata = sourceMetadata(task, id, op)
  const cached = workingPatch(metadata.view.stamp)
  if (cached)
    return {
      patch: cached.patch,
      before: metadata.before,
      after: metadata.after,
      view: { ...metadata.view, additions: cached.additions, deletions: cached.deletions },
    }
  const raw = await ctx.git.run(
    task.repoRoot,
    [
      "diff",
      "--no-index",
      "--no-ext-diff",
      "--no-textconv",
      "--",
      op.before === null ? "/dev/null" : workingObjectPath(ctx, op.before),
      op.after === null ? "/dev/null" : workingObjectPath(ctx, op.after),
    ],
    { maxOutputBytes: BYTE_BUDGET },
  )
  if (![0, 1].includes(raw.code)) throw new Error("Saved patch is unavailable")
  const patch = renamePatch(raw.stdout, op)
  const { view, before, after } = metadata
  const counts = patchCounts(patch)
  rememberWorkingPatch(task, view.stamp, patch, counts)
  return {
    view: { ...view, ...counts, label: "Latest edit" },
    patch,
    before,
    after,
  }
}

function sourceMetadata(task: Task, id: string, op: WorkingOperation): OwnedPart {
  const stamp = digest(JSON.stringify([workingTaskKey(task), id, op]))
  return {
    view: {
      id: stamp,
      stamp,
      path: op.path,
      ...(op.from ? { from: op.from } : {}),
      status: op.before === null ? "A" : op.after === null ? "D" : op.from ? "R" : "M",
      additions: null,
      deletions: null,
      kind: "working",
      label: "Saved edit",
    },
    patch: "",
    before: op.before === null ? null : { kind: "working", hash: op.before },
    after: op.after === null ? null : { kind: "working", hash: op.after },
    unavailable: true,
    native: { id, operation: op },
  }
}

function localPart(
  task: Task,
  record: WorkingRecord,
  op: WorkingOperation,
  pending: Map<string, string>,
): OwnedPart | null {
  if (!workingPath(task.repoRoot, task.repoRoot, op.path)) return null
  if (record.state !== "verified") {
    pending.set(
      op.path,
      record.state === "ambiguous"
        ? "Overlapping edits could not be separated."
        : "A completed native edit is unavailable.",
    )
    return record.verified ? { ...sourceMetadata(task, record.id, op), head: record.head } : null
  }
  const part = { ...sourceMetadata(task, record.id, op), head: record.head }
  delete part.unavailable
  return part
}

async function materialize(
  ctx: Ctx,
  task: Task,
  candidates: OwnedPart[],
  parts: Map<string, OwnedPart>,
  pending: Map<string, string>,
): Promise<OwnedPart[]> {
  if (candidates.length > WORKING_VIEW_DIFFS_MAX)
    throw new Error("Saved working history exceeds this view’s process limit")
  const budget = { left: BYTE_BUDGET },
    active: OwnedPart[] = []
  for (const part of candidates) {
    if (!part.native) continue
    try {
      const read = await savedPart(ctx, task, part.native.id, part.native.operation, budget)
      read.head = part.head
      read.view.kind = part.view.kind
      read.view.label = part.view.label
      parts.set(read.view.stamp, read)
      active.push(read)
    } catch {
      pending.set(part.view.path, "Saved source is unavailable or exceeds the reading limit.")
    }
  }
  return active
}

async function addUnattributed(
  ctx: Ctx,
  task: Task,
  working: OwnedPart[],
  parts: Map<string, OwnedPart>,
  pending: Map<string, string>,
) {
  const own = await ownEdits(ctx, { id: task.repoId, root: task.repoRoot }, task.slug)
  for (const path of own)
    if (
      workingPath(task.repoRoot, task.repoRoot, path) &&
      !working.some((part) => part.view.path === path)
    )
      pending.set(path, "Working changes have no exact saved edit.")
  const baseline = await readBuildStart(ctx, task)
  for (const path of Object.keys(baseline?.state ?? {}).slice(0, 200))
    if (
      workingPath(task.repoRoot, task.repoRoot, path) &&
      !parts.values().some((part) => part.view.path === path) &&
      !pending.has(path)
    )
      pending.set(path, "Present before this build; not attributed to this workflow.")
  const session = await readSession(ctx, task)
  if (session && ["cursor", "grok", "antigravity"].includes(session.agent))
    pending.set(
      "Agent",
      "Working change tracking is unavailable for this agent. Registered commits remain readable.",
    )
}

function groupFiles(parts: OwnedPart[], history?: ChangeHistory): WalkFile[] {
  const files = new Map<string, WalkFile>()
  for (const part of parts) {
    const { view } = part
    let file = files.get(view.path)
    if (view.from && files.has(view.from)) {
      file = files.get(view.from)
      files.delete(view.from)
    }
    file ??= {
      path: view.path,
      status: view.status,
      additions: 0,
      deletions: 0,
      tasks: [],
      parts: [],
    }
    file.path = view.path
    file.status = view.status
    if (view.from) file.from ??= view.from
    file.additions =
      file.additions === null || view.additions === null ? null : file.additions + view.additions
    file.deletions =
      file.deletions === null || view.deletions === null ? null : file.deletions + view.deletions
    file.parts!.push(view)
    files.set(view.path, file)
  }
  for (const file of files.values()) {
    const stamps = file.parts!.map((part) => part.stamp)
    file.stamp = digest(JSON.stringify(history === undefined ? stamps : [history, ...stamps]))
  }
  return [...files.values()]
}

async function markCurrent(ctx: Ctx, task: Task, files: WalkFile[], parts: Map<string, OwnedPart>) {
  let left = BYTE_BUDGET
  for (const file of files) {
    const last = file.parts?.findLast((part) => part.kind === "working")
    if (!last) continue
    if (left <= 0) {
      file.current = "unavailable"
      continue
    }
    try {
      const text = await currentWorkingText(ctx, task, file.path, Math.min(left, 1024 * 1024))
      left -= Buffer.byteLength(text ?? "")
      if ((text === null ? null : digest(text)) !== (parts.get(last.stamp)?.after?.hash ?? null))
        file.current = "changed"
    } catch {
      left = Math.max(0, left - 1024 * 1024)
      file.current = "unavailable"
    }
  }
}

/** One authoritative inventory for Files, the global entry and workflow Code Review. */
export async function workflowChanges(
  ctx: Ctx,
  task: Task,
  options: {
    metadata?: boolean
    browse?: boolean
    page?: PageRequest
    current?: boolean
    /** Committed sources an earlier pass of this same request read; set by a page's own recheck. */
    reads?: SourceReads
    range?: VerifyRange
  } = {},
): Promise<WorkflowProjection> {
  if (options.range) return candidateChanges(ctx, task, options.range, options.page)
  const reads: SourceReads = options.reads ?? new Map()
  const committed = await committedParts(ctx, task, {
    metadata: options.metadata || options.page !== undefined,
    browse: options.browse === true,
  })
  const history = committed.historical
    ? "registered"
    : committed.commits.length === 0 && committed.unavailableCommits?.length
      ? "unavailable"
      : undefined
  const parts = new Map(committed.parts.map((part) => [part.view.stamp, part]))
  const pending = new Map<string, string>()
  for (const sha of committed.historical ? [] : (committed.staleCommits ?? []))
    pending.set(
      `Commit ${sha.slice(0, 12)}`,
      "Historical receipt no longer on this branch; only current registered commits are shown. Re-register exclusive slice replacements; retain shared receipts and use qualitylayer verify judge for a proven rewrite's fresh full-working-tree review. Earlier verification is retained.",
    )
  for (const sha of committed.unavailableCommits ?? [])
    pending.set(`Commit ${sha.slice(0, 12)}`, "This registered patch is unavailable.")
  const working: OwnedPart[] = []
  if (!history && !options.metadata && !options.page) await expireWorkingRecords(ctx)
  const records = history
    ? []
    : (await readWorkingLedger(ctx)).records
        .filter((row) => row.task === workingTaskKey(task))
        .sort((a, b) => a.at - b.at)
  for (const record of records)
    for (const op of record.operations) {
      const expired =
        record.closed !== undefined && ctx.clock.now() - record.closed >= WORKING_CLOSED_KEEP_MS
      const part = localPart(
        task,
        expired ? { ...record, state: "unavailable" } : record,
        op,
        pending,
      )
      if (!part) continue
      working.push(part)
      if (!part.unavailable) parts.set(part.view.stamp, part)
    }
  if (!history) {
    forgetWorkingPatches(
      task,
      new Set(working.filter((part) => !part.unavailable).map((part) => part.view.stamp)),
    )
    await addUnattributed(ctx, task, working, parts, pending)
  }
  const relation = await nativeCoverage(ctx, task, committed.parts, working, {
    left: BYTE_BUDGET,
    reads,
  })
  for (const stamp of relation.withheld) {
    const part = parts.get(stamp)
    if (part)
      pending.set(
        part.view.path,
        "Some commit changes could not be attributed from the saved edits.",
      )
    parts.delete(stamp)
  }
  for (const part of working) {
    const commit = relation.associated.get(part.view.stamp)
    if (commit && !part.unavailable) {
      part.view.kind = "commit"
      part.view.label = commit.slice(0, 8)
    }
  }
  const remaining = working.filter(
    (part) => !part.unavailable && !relation.covered.has(part.view.stamp),
  )
  const native =
    options.metadata || options.page || remaining.length > WORKING_VIEW_DIFFS_MAX
      ? remaining
      : await materialize(ctx, task, remaining, parts, pending)
  const active = [
    ...committed.parts.filter((part) => !relation.withheld.has(part.view.stamp)),
    ...native,
  ]
  const files = groupFiles(active, history)
  if (options.current !== false) await markCurrent(ctx, task, files, parts)
  const requested = options.page
    ? files.find((file) => file.path === options.page?.path)
    : undefined
  if (options.page && !requested)
    throw new Error("This path is not part of this workflow’s change.")
  const page =
    options.page && requested
      ? await workflowPage(ctx, requested, parts, options.page, async (part, budget) => {
          if (!part.native) return readCommittedPart(ctx, task, part)
          const read = await savedPart(ctx, task, part.native.id, part.native.operation, budget)
          read.view.kind = part.view.kind
          read.view.label = part.view.label
          return read
        })
      : undefined
  if (page && options.page) {
    const current = await workflowChanges(ctx, task, {
      metadata: true,
      current: false,
      browse: options.browse === true,
      reads,
    })
    if (current.files.find((file) => file.path === options.page?.path)?.stamp !== page.revision)
      throw new Error("The file revision changed while reading. Refresh Review.")
  }
  return {
    ...(history ? { history } : {}),
    files,
    tracked: committed.recorded || records.length > 0,
    parts,
    commits: committed.commits,
    ...(page ? { page } : {}),
    pending: [...pending].slice(0, 200).map(([path, reason]) => ({ path, reason })),
    workingFiles: files
      .filter((file) => file.parts?.some((part) => part.kind === "working"))
      .map((file) => file.path),
    localOnlyFiles: files
      .filter((file) =>
        file.parts?.some((part) => {
          const source = parts.get(part.stamp)
          return source?.before?.kind === "working" || source?.after?.kind === "working"
        }),
      )
      .map((file) => file.path),
  }
}

async function candidateChanges(
  ctx: Ctx,
  task: Task,
  range: VerifyRange,
  request?: PageRequest,
): Promise<WorkflowProjection> {
  const original = await candidateParts(ctx, task, range)
  const files = groupFiles(original)
  const parts = new Map(original.map((part) => [part.view.stamp, part]))
  const file = request ? files.find((file) => file.path === request.path) : undefined
  if (request && !file) throw new Error("This path is not part of the reviewed commit.")
  const page =
    request && file
      ? await workflowPage(ctx, file, parts, request, (part) => readCommittedPart(ctx, task, part))
      : undefined
  return {
    candidate: true,
    files,
    parts,
    commits: range.commits,
    pending: [],
    workingFiles: [],
    localOnlyFiles: [],
    ...(page ? { page } : {}),
  }
}

export function workflowPatch(projection: WorkflowProjection, path: string): string | null {
  const file = projection.files.find((file) => file.path === path)
  return file
    ? (file.parts ?? []).map((part) => projection.parts.get(part.stamp)?.patch ?? "").join("\n")
    : null
}

/** An outer renamed file owns each historical path; an opaque stamp alone grants nothing. */
export function ownedPartOf(
  projection: WorkflowProjection,
  path: string,
  stamp: string,
): OwnedPart | null {
  const file = projection.files.find((file) => file.path === path)
  const part = projection.parts.get(stamp)
  if (!file || !part || part.unavailable) return null
  if (file.parts?.some((row) => row.stamp === stamp)) return part
  if (part.before?.kind !== "working" && part.after?.kind !== "working") return null
  const paths = new Set([
    file.path,
    file.from,
    ...(file.parts ?? []).flatMap((row) => [row.path, row.from]),
  ])
  return paths.has(part.view.path) || (part.view.from && paths.has(part.view.from)) ? part : null
}

export function workflowChangesView(
  projection: WorkflowProjection,
): Omit<Changes, "files"> & { files: WalkFile[] } {
  return {
    changeScope: {
      ...(projection.history ? { history: projection.history } : {}),
      pending: projection.pending,
      workingFiles: projection.workingFiles,
      localOnlyFiles: projection.localOnlyFiles,
    },
    base: null,
    head: null,
    files: projection.files,
    commits: projection.commits.map((sha) => ({
      sha,
      subject: "",
      files: projection.files
        .filter((file) =>
          file.parts?.some(
            (part) =>
              part.kind === "commit" &&
              (projection.parts.get(part.stamp)?.commit === sha || part.label === sha.slice(0, 8)),
          ),
        )
        .map((file) => file.path),
    })),
    uncommitted: projection.workingFiles,
    diff: "",
    revision: digest(JSON.stringify(projection.files.map((file) => file.stamp))),
  }
}

/** Keep build evidence and approvals intact; replace only the App's file inventory and totals. */
export function scopeWalkthrough(view: Walkthrough, projection: WorkflowProjection): Walkthrough {
  if (projection.candidate) {
    return {
      ...view,
      counted: true,
      slices: [],
      fixes: [],
      decided: projection.files,
      planDecisions: [],
      changeScope: { candidate: true, pending: [], workingFiles: [] },
      totals: {
        ...view.totals,
        commits: projection.commits.length,
        files: projection.files.length,
        additions: null,
        deletions: null,
      },
    }
  }
  const left = new Map(projection.files.map((file) => [file.path, file]))
  const ownPaths = new Set(left.keys())
  const replace = (files: WalkFile[]) =>
    projection.history
      ? []
      : files.flatMap((old) => {
          const own = left.get(old.path)
          if (!own || !own.parts?.some((part) => part.kind === "commit")) return []
          left.delete(old.path)
          return [
            { ...own, tasks: own.parts?.some((part) => part.kind === "commit") ? old.tasks : [] },
          ]
        })
  const slices = view.slices.map((slice) => {
    const files = replace(slice.files)
    return {
      ...slice,
      files,
      additions: lineTotal(files, "additions"),
      deletions: lineTotal(files, "deletions"),
    }
  })
  const fixes = replace(view.fixes),
    decided = replace(view.decided)
  decided.push(...left.values())
  return {
    ...view,
    ...(view.risk
      ? {
          risk: {
            ...view.risk,
            outside: view.risk.outside.filter((path) => ownPaths.has(path)),
            dependencies: view.risk.dependencies.filter((path) => ownPaths.has(path)),
          },
        }
      : {}),
    counted: true,
    slices,
    fixes,
    decided,
    documents: [],
    notDoing: { plan: view.notDoing.plan, otherFiles: [], otherCommits: [] },
    changeScope: {
      ...(projection.history ? { history: projection.history } : {}),
      pending: projection.pending,
      workingFiles: projection.workingFiles,
      localOnlyFiles: projection.localOnlyFiles,
    },
    totals: {
      ...view.totals,
      commits: projection.commits.length,
      files: projection.files.length,
      additions: lineTotal(projection.files, "additions"),
      deletions: lineTotal(projection.files, "deletions"),
    },
  }
}
