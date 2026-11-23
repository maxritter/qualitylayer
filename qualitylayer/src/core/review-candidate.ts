import { createHash, randomUUID } from "node:crypto"
import { isAbsolute, join } from "node:path"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import { folderDoc } from "./docs/names.ts"
import { readGate } from "./gate/gate.ts"
import { lockPath as gateLock } from "./gate/lock.ts"
import { approvalCurrent, gateRevision } from "./gate/revision.ts"
import { sliceCommits } from "./git/build-start.ts"
import { judgeInputs, RecordedHistoryRewritten } from "./git/judge-inputs.ts"
import {
  choicesFor,
  commitId,
  physical,
  readReviewWorktree,
  requireCleanReviewWorktree,
  staleCount,
} from "./git/review-worktrees.ts"
import { readOptionalRecordBytes, writeRecordText } from "./records/files.ts"
import { currentTaskRecordOwner } from "./task/answer-migration.ts"
import { isArchived } from "./task/archive.ts"
import { readmeFrontmatter, type Task } from "./task/store.ts"

export type ReviewCandidateChoice = {
  checkout: string
  branch: string | null
  head: string
  subject: string
  shared: boolean
}
export type ReviewCandidateInput = {
  version: string
  checkout: string
  branch: string | null
  head: string
  acknowledgeShared: boolean
}
type Selection = {
  id: string
  choice: ReviewCandidateChoice
  selectedAt: number
  plan: string
  repo: string
  common: string
}
export type ReviewCandidateState = {
  eligible: boolean
  repository: string
  prior?: { head: string; branch?: string; commits: number; slices: number; stale?: number }
  choices: ReviewCandidateChoice[]
  version: string
  selected?: ReviewCandidateChoice & { selectedAt: number; state: "pending" | "assigned" | "stale" }
}
const stamp = (task: Task) => join(task.runtimeDir, "review-candidate.json")
export const hasReviewCandidate = (ctx: Ctx, task: Task) => ctx.fs.exists(stamp(task))
export const withReviewCandidateLock = <T>(ctx: Ctx, task: Task, run: () => Promise<T>) =>
  ctx.fs.withLock(join(task.runtimeDir, "review-candidate.lock"), run)
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
function equal(
  choice: ReviewCandidateChoice,
  input: Pick<ReviewCandidateInput, "checkout" | "branch" | "head">,
) {
  return (
    choice.checkout === input.checkout &&
    choice.branch === input.branch &&
    choice.head === input.head
  )
}
function validChoiceShape(choice: Partial<ReviewCandidateChoice> | undefined): boolean {
  if (!choice) return false
  const validPath =
    typeof choice.checkout === "string" &&
    isAbsolute(choice.checkout) &&
    (choice.branch === null || typeof choice.branch === "string")
  const validMeta =
    typeof choice.shared === "boolean" &&
    typeof choice.subject === "string" &&
    typeof choice.head === "string" &&
    commitId.test(choice.head)
  return validPath && validMeta
}

function validReceipt(row: Selection): boolean {
  const validId = typeof row.id === "string" && /^[a-f0-9-]{36}$/.test(row.id)
  const validScope =
    Number.isFinite(row.selectedAt) &&
    typeof row.common === "string" &&
    typeof row.plan === "string"
  return validChoiceShape(row.choice) && validId && validScope
}

async function read(ctx: Ctx, task: Task): Promise<Selection | null> {
  const path = stamp(task)
  if (!(await ctx.fs.exists(path))) return null
  const shape = await ctx.fs.lstat?.(path)
  if (shape && shape.kind !== "file") throw new Error("The review candidate receipt is invalid.")
  const owner = await currentTaskRecordOwner(ctx, task)
  const bytes = owner
    ? await readOptionalRecordBytes(ctx, owner, "review-candidate.json", 8192)
    : await ctx.fs.readRegularFile?.(path, 8192)
  if (owner && !bytes) return null
  const raw = bytes
    ? new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    : await ctx.fs.readFile(path)
  if (Buffer.byteLength(raw) > 8192) throw new Error("The review candidate receipt is too large.")
  const row = JSON.parse(raw) as Selection | null
  if (row?.repo !== task.repoId || !validReceipt(row))
    throw new Error("The review candidate receipt does not match this task.")
  return row
}

async function hasRecordedAuthority(ctx: Ctx, task: Task): Promise<boolean> {
  try {
    return (await judgeInputs(ctx, task)) !== null
  } catch (cause) {
    // A same-branch rewrite already supports the ordinary full-tree judge.
    return cause instanceof RecordedHistoryRewritten
  }
}

async function canOffer(ctx: Ctx, task: Task): Promise<boolean> {
  if (
    task.stage !== "verify" ||
    task.earlier ||
    task.type === "chat" ||
    (await isArchived(ctx, task))
  )
    return false
  const gate = await readGate(ctx, task)
  return gate?.target !== "final" || gate.decision !== "approved"
}

async function visibleSelection(
  ctx: Ctx,
  task: Task,
  selected: Selection,
  choices: ReviewCandidateChoice[],
  scope: { common: string; plan: string },
): Promise<NonNullable<ReviewCandidateState["selected"]>> {
  const choice = { ...selected.choice, selectedAt: selected.selectedAt }
  const matchesScope = selected.common === scope.common && selected.plan === scope.plan
  if (!matchesScope || !choices.some((candidate) => equal(candidate, choice)))
    return { ...choice, state: "stale" }
  const assignment = await ctx.fs
    .readFile(join(task.runtimeDir, "verification.json"))
    .then((raw) => JSON.parse(raw))
    .catch(() => null)
  return { ...choice, state: assignment?.recovery === selected.id ? "assigned" : "pending" }
}

async function buildPriorSummary(
  ctx: Ctx,
  task: Task,
  details: {
    recorded: readonly string[]
    branch: string | undefined
    visible: ReviewCandidateState["selected"]
    stale: number | undefined
  },
): Promise<ReviewCandidateState["prior"]> {
  const { recorded, branch, visible, stale } = details
  const priorHead = recorded.at(-1)
  if (!priorHead) return undefined
  const anotherWorktree = visible && visible.state !== "stale" && visible.checkout !== task.repoRoot
  const staleReceipts = anotherWorktree ? await staleCount(ctx, visible.checkout, recorded) : stale
  return {
    head: priorHead,
    branch,
    commits: new Set(recorded).size,
    slices: recorded.length,
    stale: staleReceipts,
  }
}

async function snapshot(ctx: Ctx, task: Task) {
  const repository = task.repoRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? task.repoId
  const state: ReviewCandidateState = { eligible: false, repository, choices: [], version: "" }
  const unavailable = { state, common: null, plan: null }
  if (!(await canOffer(ctx, task))) return unavailable
  const recorded = await sliceCommits(ctx, task)
  const selected = await read(ctx, task)
  const stale = await staleCount(ctx, task.repoRoot, recorded)
  if (!selected && (!stale || (await hasRecordedAuthority(ctx, task)))) return unavailable
  const fm = await readmeFrontmatter(ctx, task)
  const approved =
    typeof fm.review_basis !== "string" || (await approvalCurrent(ctx, task, folderDoc("plan")))
  const branch = typeof fm.branch === "string" ? fm.branch : task.branch
  const plan = await gateRevision(ctx, task, folderDoc("plan"))
  const common = await physical(await ctx.git.commonDir(task.repoRoot))
  if (!common) return { state, common, plan }
  const choices = approved ? await choicesFor(ctx, task, common, branch) : []
  const visible = selected
    ? await visibleSelection(ctx, task, selected, choices, { common, plan })
    : undefined
  const prior = await buildPriorSummary(ctx, task, { recorded, branch, visible, stale })
  return {
    state: {
      eligible: choices.length > 0,
      repository,
      prior,
      choices,
      version: hash({ repo: task.repoId, common, plan, prior, choices, selected: visible }),
      selected: visible,
    },
    common,
    plan,
  }
}

export async function readReviewCandidates(ctx: Ctx, task: Task): Promise<ReviewCandidateState> {
  return (await snapshot(ctx, task)).state
}

function isValidBranchInput(branch: unknown): boolean {
  return (
    branch === null || (typeof branch === "string" && branch.length > 0 && branch.length <= 256)
  )
}

export function isReviewCandidateInput(input: unknown): input is ReviewCandidateInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false
  const { version, checkout, branch, head, acknowledgeShared } = input as Record<string, unknown>
  const validVersion = typeof version === "string" && /^[a-f0-9]{64}$/.test(version)
  const validCheckout =
    typeof checkout === "string" && checkout.length <= 4096 && isAbsolute(checkout)
  const validHead = typeof head === "string" && commitId.test(head)
  if (!validVersion || !validCheckout || !validHead) return false
  return isValidBranchInput(branch) && typeof acknowledgeShared === "boolean"
}

async function recordSelection(ctx: Ctx, task: Task, row: Selection) {
  const history = join(task.runtimeDir, "review-candidates")
  await ctx.fs.mkdir(history)
  const receipt = `${JSON.stringify(row)}\n`
  const owner = await currentTaskRecordOwner(ctx, task)
  if (owner) {
    await writeRecordText(ctx, owner, `review-candidates/${row.id}.json`, receipt)
    await writeRecordText(ctx, owner, "review-candidate.json", receipt)
  } else {
    await ctx.fs.atomicWrite(join(history, `${row.id}.json`), receipt, { mode: 0o600 })
    await ctx.fs.atomicWrite(stamp(task), receipt, { mode: 0o600 })
  }
}

const staleChoiceError = () =>
  err({
    code: "bad_args",
    message: "The review choices changed. Open the candidate chooser again.",
  })

async function commitCandidateSelection(
  ctx: Ctx,
  task: Task,
  input: ReviewCandidateInput,
): Promise<Result<ReviewCandidateState>> {
  await ctx.fs.assertSafeDirectory?.(task.runtimeDir)
  const { state, common, plan } = await snapshot(ctx, task)
  const choice = state.choices.find((candidate) => equal(candidate, input))
  if (!common || !plan || input.version !== state.version || !choice) return staleChoiceError()
  if (choice.shared && !input.acknowledgeShared) {
    return err({
      code: "bad_args",
      message: "Confirm reviewing the other changes in this shared checkout.",
    })
  }
  await requireCleanReviewWorktree(ctx, choice.checkout)
  const reread = await snapshot(ctx, task)
  if (reread.state.version !== state.version || reread.plan !== plan) return staleChoiceError()
  await recordSelection(ctx, task, {
    id: randomUUID(),
    choice,
    selectedAt: ctx.clock.now(),
    plan,
    repo: task.repoId,
    common,
  })
  return ok(await readReviewCandidates(ctx, task))
}

export async function selectReviewCandidate(
  ctx: Ctx,
  task: Task,
  input: unknown,
): Promise<Result<ReviewCandidateState>> {
  if (!isReviewCandidateInput(input)) return staleChoiceError()
  try {
    return await withReviewCandidateLock(ctx, task, () =>
      ctx.fs.withLock(gateLock(task), () => commitCandidateSelection(ctx, task, input)),
    )
  } catch (cause) {
    return err({
      code: "bad_args",
      message:
        cause instanceof Error ? cause.message : "The review candidate could not be selected.",
    })
  }
}

export async function selectedReviewCandidate(ctx: Ctx, task: Task): Promise<Selection | null> {
  const selected = await read(ctx, task)
  if (!selected) return null
  const { checkout } = selected.choice
  const [current, plan] = await Promise.all([
    readReviewWorktree(ctx, checkout),
    gateRevision(ctx, task, folderDoc("plan")),
    requireCleanReviewWorktree(ctx, checkout),
  ])
  if (
    current.common !== selected.common ||
    plan !== selected.plan ||
    !equal(selected.choice, current)
  )
    throw new Error(
      "The review commit, checkout or Plan changed. Choose the current candidate again.",
    )
  return selected
}
