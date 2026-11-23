import type { Ctx } from "../../ctx.ts"
import type { ChangeHistory, WalkFile } from "../review/walkthrough.ts"
import type { Task } from "../task/store.ts"
import type { VerifyRange } from "./verify-range.ts"
import { nativeCoverage, type SourceReads } from "./workflow-coverage.ts"
import { type PageRequest, type WorkflowPage, workflowPage } from "./workflow-pages.ts"
import {
  candidateParts,
  committedParts,
  type OwnedPart,
  readCommittedPart,
} from "./workflow-parts.ts"
import {
  localPart,
  materializeWorkingParts,
  savedPart,
  WORKFLOW_BYTE_BUDGET,
} from "./workflow-saved.ts"
import { addUnattributed, markCurrent } from "./workflow-unattributed.ts"
import { groupFiles } from "./workflow-view.ts"
import { WORKING_CLOSED_KEEP_MS, WORKING_VIEW_DIFFS_MAX } from "./working-limits.ts"
import { forgetWorkingPatches } from "./working-patch-cache.ts"
import { expireWorkingRecords, readWorkingLedger, workingTaskKey } from "./working-records.ts"

export {
  ownedPartOf,
  scopeWalkthrough,
  workflowChangesView,
  workflowPatch,
} from "./workflow-view.ts"

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

type WorkflowOptions = {
  metadata?: boolean
  browse?: boolean
  page?: PageRequest
  current?: boolean
  /** Committed sources an earlier pass of this same request read; set by a page's own recheck. */
  reads?: SourceReads
  range?: VerifyRange
}

function recordCommitWarnings(
  committed: Awaited<ReturnType<typeof committedParts>>,
  pending: Map<string, string>,
) {
  for (const sha of committed.historical ? [] : (committed.staleCommits ?? []))
    pending.set(
      `Commit ${sha.slice(0, 12)}`,
      "Historical receipt no longer on this branch; only current registered commits are shown. Re-register exclusive slice replacements; retain shared receipts and use qualitylayer verify judge for a proven rewrite's fresh full-working-tree review. Earlier verification is retained.",
    )
  for (const sha of committed.unavailableCommits ?? [])
    pending.set(`Commit ${sha.slice(0, 12)}`, "This registered patch is unavailable.")
}

async function collectWorkingParts(
  ctx: Ctx,
  task: Task,
  options: WorkflowOptions,
  state: { history?: ChangeHistory; parts: Map<string, OwnedPart>; pending: Map<string, string> },
) {
  if (state.history) return { working: [] as OwnedPart[], recordCount: 0 }
  if (!options.metadata && !options.page) await expireWorkingRecords(ctx)
  const records = (await readWorkingLedger(ctx)).records
    .filter((row) => row.task === workingTaskKey(task))
    .sort((a, b) => a.at - b.at)
  const working: OwnedPart[] = []
  for (const record of records) {
    const expired =
      record.closed !== undefined && ctx.clock.now() - record.closed >= WORKING_CLOSED_KEEP_MS
    const effective = expired ? { ...record, state: "unavailable" as const } : record
    for (const op of record.operations) {
      const part = localPart(task, effective, op, state.pending)
      if (!part) continue
      working.push(part)
      if (!part.unavailable) state.parts.set(part.view.stamp, part)
    }
  }
  forgetWorkingPatches(
    task,
    new Set(working.filter((part) => !part.unavailable).map((part) => part.view.stamp)),
  )
  await addUnattributed(ctx, task, working, state.parts, state.pending)
  return { working, recordCount: records.length }
}

function applyCoverageRelation(
  relation: Awaited<ReturnType<typeof nativeCoverage>>,
  working: OwnedPart[],
  parts: Map<string, OwnedPart>,
  pending: Map<string, string>,
) {
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
}

async function readRequestedPage(
  ctx: Ctx,
  task: Task,
  state: {
    files: WalkFile[]
    parts: Map<string, OwnedPart>
    options: WorkflowOptions
    reads: SourceReads
  },
): Promise<WorkflowPage | undefined> {
  const { files, parts, options, reads } = state
  if (!options.page) return undefined
  const requested = files.find((file) => file.path === options.page?.path)
  if (!requested) throw new Error("This path is not part of this workflow’s change.")
  const page = await workflowPage(ctx, requested, parts, options.page, async (part, budget) => {
    if (!part.native) return readCommittedPart(ctx, task, part)
    const read = await savedPart(ctx, task, part.native.id, part.native.operation, budget)
    read.view.kind = part.view.kind
    read.view.label = part.view.label
    return read
  })
  const current = await workflowChanges(ctx, task, {
    metadata: true,
    current: false,
    browse: options.browse === true,
    reads,
  })
  if (current.files.find((file) => file.path === options.page?.path)?.stamp !== page.revision)
    throw new Error("The file revision changed while reading. Refresh Review.")
  return page
}

/** One authoritative inventory for Files, the global entry and workflow Code Review. */
export async function workflowChanges(
  ctx: Ctx,
  task: Task,
  options: WorkflowOptions = {},
): Promise<WorkflowProjection> {
  if (options.range) return candidateChanges(ctx, task, options.range, options.page)
  const reads: SourceReads = options.reads ?? new Map()
  const committed = await committedParts(ctx, task, {
    metadata: options.metadata || options.page !== undefined,
    browse: options.browse === true,
  })
  const history: ChangeHistory | undefined = committed.historical
    ? "registered"
    : committed.commits.length === 0 && committed.unavailableCommits?.length
      ? "unavailable"
      : undefined
  const parts = new Map(committed.parts.map((part) => [part.view.stamp, part]))
  const pending = new Map<string, string>()
  recordCommitWarnings(committed, pending)
  const { working, recordCount } = await collectWorkingParts(ctx, task, options, {
    history,
    parts,
    pending,
  })
  const relation = await nativeCoverage(ctx, task, committed.parts, working, {
    left: WORKFLOW_BYTE_BUDGET,
    reads,
  })
  applyCoverageRelation(relation, working, parts, pending)
  const remaining = working.filter(
    (part) => !part.unavailable && !relation.covered.has(part.view.stamp),
  )
  const native =
    options.metadata || options.page || remaining.length > WORKING_VIEW_DIFFS_MAX
      ? remaining
      : await materializeWorkingParts(ctx, task, remaining, parts, pending)
  const files = groupFiles(
    [...committed.parts.filter((part) => !relation.withheld.has(part.view.stamp)), ...native],
    history,
  )
  if (options.current !== false) await markCurrent(ctx, task, files, parts)
  const page = await readRequestedPage(ctx, task, { files, parts, options, reads })
  return {
    ...(history ? { history } : {}),
    files,
    tracked: committed.recorded || recordCount > 0,
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
