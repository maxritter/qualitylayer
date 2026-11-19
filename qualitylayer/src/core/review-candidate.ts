import { createHash, randomUUID } from "node:crypto"
import { realpath } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import { folderDoc } from "./docs/names.ts"
import { readGate } from "./gate/gate.ts"
import { lockPath as gateLock } from "./gate/lock.ts"
import { approvalCurrent, gateRevision } from "./gate/revision.ts"
import { sliceCommits } from "./git/build-start.ts"
import { judgeInputs, RecordedHistoryRewritten } from "./git/judge-inputs.ts"
import { worktrees } from "./git/repo.ts"
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
  /** The choice also binds tracked/index and untracked content, even before the judge starts. */
  work: string
}
export type ReviewCandidateState = {
  eligible: boolean
  repository: string
  prior?: { head: string; branch?: string; commits: number; slices: number; stale?: number }
  choices: ReviewCandidateChoice[]
  version: string
  selected?: ReviewCandidateChoice & { selectedAt: number; state: "pending" | "assigned" | "stale" }
}
const full = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const stamp = (task: Task) => join(task.runtimeDir, "review-candidate.json")
export const hasReviewCandidate = (ctx: Ctx, task: Task) => ctx.fs.exists(stamp(task))
export const withReviewCandidateLock = <T>(ctx: Ctx, task: Task, run: () => Promise<T>) =>
  ctx.fs.withLock(join(task.runtimeDir, "review-candidate.lock"), run)
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const physical = async (path: string | null) => (path ? realpath(path).catch(() => null) : null)
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
async function git(ctx: Ctx, root: string, args: string[]) {
  const result = await ctx.git.run(root, args, { fresh: true })
  if (result.code !== 0) throw new Error("The candidate worktree could not be read.")
  return result.stdout
}
async function checkoutHead(ctx: Ctx, root: string) {
  const data = await git(ctx, root, ["show", "-s", "--format=%H%x00%s", "HEAD"])
  const [head, subject] = data.trimEnd().split("\0")
  if (!head || !full.test(head)) throw new Error("This worktree has no reviewable commit.")
  return { head, subject: subject?.slice(0, 300) ?? "" }
}
async function workHead(ctx: Ctx, root: string) {
  const status = await git(ctx, root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    ".",
    ":(exclude)docs/plans/**",
  ])
  // An explicit commit selection may never silently include an unfinished or untracked code edit.
  // Task records are local evidence and live beside the work; they do not change the chosen commit.
  if (status.length > 0)
    throw new Error("Commit or put aside uncommitted changes in this worktree before choosing it.")
  return hash("committed-candidate")
}
async function read(ctx: Ctx, task: Task): Promise<Selection | null> {
  const path = stamp(task)
  if (!(await ctx.fs.exists(path))) return null
  const owner = await currentTaskRecordOwner(ctx, task)
  const shape = await ctx.fs.lstat?.(path)
  if (shape && shape.kind !== "file") throw new Error("The review candidate receipt is invalid.")
  const bytes = owner
    ? await readOptionalRecordBytes(ctx, owner, "review-candidate.json", 8192)
    : await ctx.fs.readRegularFile?.(path, 8192)
  if (owner && !bytes) return null
  const raw = bytes
    ? new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    : await ctx.fs.readFile(path)
  if (Buffer.byteLength(raw) > 8192) throw new Error("The review candidate receipt is too large.")
  const row: Selection = JSON.parse(raw)
  if (
    !row ||
    row.repo !== task.repoId ||
    typeof row.id !== "string" ||
    !/^[a-f0-9-]{36}$/.test(row.id) ||
    !Number.isFinite(row.selectedAt) ||
    !row.choice ||
    typeof row.choice.checkout !== "string" ||
    !isAbsolute(row.choice.checkout) ||
    (row.choice.branch !== null && typeof row.choice.branch !== "string") ||
    typeof row.choice.shared !== "boolean" ||
    typeof row.choice.subject !== "string" ||
    !full.test(row.choice.head) ||
    typeof row.common !== "string" ||
    typeof row.work !== "string" ||
    typeof row.plan !== "string"
  )
    throw new Error("The review candidate receipt does not match this task.")
  return row
}

async function staleCount(
  ctx: Ctx,
  root: string,
  receipts: readonly string[],
): Promise<number | undefined> {
  if (receipts.length === 0) return 0
  if (receipts.length > 512 || receipts.some((sha) => !/^[a-f0-9]{7,64}$/.test(sha)))
    return undefined
  const head = await ctx.git.run(root, ["rev-parse", "--verify", "HEAD"])
  if (head.code !== 0 || !full.test(head.stdout.trim())) return undefined
  // One ancestry-only query on the normal path. Enumerate stale receipts only for recovery.
  const count = await ctx.git.run(root, [
    "merge-base",
    "--independent",
    head.stdout.trim(),
    ...receipts,
  ])
  if (count.code !== 0) return undefined
  if (count.stdout.trim() === head.stdout.trim()) return 0
  let stale = 0
  for (const receipt of new Set(receipts)) {
    const result = await ctx.git.run(root, [
      "merge-base",
      "--is-ancestor",
      receipt,
      head.stdout.trim(),
    ])
    if (result.code !== 0 && result.code !== 1) return undefined
    if (result.code === 1) stale++
  }
  return stale
}
async function choicesFor(ctx: Ctx, task: Task, common: string, branch: string | undefined) {
  const roots = await worktrees(ctx, task.repoRoot)
  return (
    await Promise.all(
      roots.slice(0, 32).map(async ({ path, branch: named }) => {
        const checkout = await physical(path)
        if (!checkout) return null
        try {
          const [base, sharedRepo, found, current] = await Promise.all([
            physical(await ctx.git.topLevel(checkout)),
            physical(await ctx.git.commonDir(checkout)),
            checkoutHead(ctx, checkout),
            git(ctx, checkout, ["branch", "--show-current"]),
          ])
          if (base !== checkout || sharedRepo !== common || (current.trim() || null) !== named)
            return null
          await workHead(ctx, checkout)
          return { checkout, branch: named, ...found, shared: named === null || named !== branch }
        } catch {
          return null
        }
      }),
    )
  ).filter((choice): choice is ReviewCandidateChoice => choice !== null)
}

async function snapshot(ctx: Ctx, task: Task) {
  const repository = task.repoRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? task.repoId
  const state: ReviewCandidateState = { eligible: false, repository, choices: [], version: "" }
  if (
    task.stage !== "verify" ||
    task.earlier ||
    task.type === "chat" ||
    (await isArchived(ctx, task))
  )
    return { state, common: null, plan: null }
  const gate = await readGate(ctx, task)
  if (gate?.target === "final" && gate.decision === "approved")
    return { state, common: null, plan: null }
  const recorded = await sliceCommits(ctx, task)
  const selected = await read(ctx, task)
  const stale = await staleCount(ctx, task.repoRoot, recorded)
  if (!stale && !selected) return { state, common: null, plan: null }
  if (!selected) {
    try {
      if (await judgeInputs(ctx, task)) return { state, common: null, plan: null }
    } catch (cause) {
      // The existing same-branch proof remains the ordinary recovery. The person only chooses
      // when the recorded lineage cannot already justify a fresh review.
      if (cause instanceof RecordedHistoryRewritten) return { state, common: null, plan: null }
    }
  }
  const fm = await readmeFrontmatter(ctx, task)
  const approved =
    typeof fm.review_basis !== "string" || (await approvalCurrent(ctx, task, folderDoc("plan")))
  const branch = typeof fm.branch === "string" ? fm.branch : task.branch
  const plan = await gateRevision(ctx, task, folderDoc("plan"))
  const common = await physical(await ctx.git.commonDir(task.repoRoot))
  if (!common) return { state, common, plan }
  const choices = approved ? await choicesFor(ctx, task, common, branch) : []
  const priorHead = recorded.at(-1)
  const assignment = selected
    ? await ctx.fs
        .readFile(join(task.runtimeDir, "verification.json"))
        .then((raw) => JSON.parse(raw))
        .catch(() => null)
    : null
  let visible: ReviewCandidateState["selected"]
  let staleReceipts = stale
  if (selected) {
    const stands =
      selected.common === common &&
      selected.plan === plan &&
      choices.some((choice) => equal(choice, selected.choice))
    if (stands && selected.choice.checkout !== task.repoRoot) {
      staleReceipts = await staleCount(ctx, selected.choice.checkout, recorded)
    }
    visible = {
      ...selected.choice,
      selectedAt: selected.selectedAt,
      state: !stands ? "stale" : assignment?.recovery === selected.id ? "assigned" : "pending",
    }
  }
  const prior = priorHead
    ? {
        head: priorHead,
        branch,
        commits: new Set(recorded).size,
        slices: recorded.length,
        stale: staleReceipts,
      }
    : undefined
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

export function isReviewCandidateInput(input: unknown): input is ReviewCandidateInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false
  const { version, checkout, branch, head, acknowledgeShared } = input as Record<string, unknown>
  return (
    typeof version === "string" &&
    /^[a-f0-9]{64}$/.test(version) &&
    typeof checkout === "string" &&
    checkout.length <= 4096 &&
    isAbsolute(checkout) &&
    (branch === null ||
      (typeof branch === "string" && branch.length > 0 && branch.length <= 256)) &&
    typeof head === "string" &&
    full.test(head) &&
    typeof acknowledgeShared === "boolean"
  )
}

export async function selectReviewCandidate(
  ctx: Ctx,
  task: Task,
  input: unknown,
): Promise<Result<ReviewCandidateState>> {
  const stale = () =>
    err({
      code: "bad_args",
      message: "The review choices changed. Open the candidate chooser again.",
    })
  if (!isReviewCandidateInput(input)) return stale()
  try {
    return await withReviewCandidateLock(ctx, task, () =>
      ctx.fs.withLock(gateLock(task), async () => {
        await ctx.fs.assertSafeDirectory?.(task.runtimeDir)
        const { state, common, plan } = await snapshot(ctx, task)
        const choice = state.choices.find((choice) => equal(choice, input))
        if (!state.eligible || !choice || !common || !plan || input.version !== state.version)
          return stale()
        if (choice.shared && !input.acknowledgeShared)
          return err({
            code: "bad_args",
            message: "Confirm reviewing the other changes in this shared checkout.",
          })
        const work = await workHead(ctx, choice.checkout)
        const reread = await snapshot(ctx, task)
        if (reread.state.version !== state.version || reread.plan !== plan) return stale()
        const row: Selection = {
          id: randomUUID(),
          choice,
          selectedAt: ctx.clock.now(),
          plan,
          repo: task.repoId,
          common,
          work,
        }
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
        return ok(await readReviewCandidates(ctx, task))
      }),
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
  const { checkout, branch, head } = selected.choice
  const [current, currentBranch, common, top, plan, work] = await Promise.all([
    checkoutHead(ctx, checkout),
    git(ctx, checkout, ["branch", "--show-current"]),
    physical(await ctx.git.commonDir(checkout)),
    physical(await ctx.git.topLevel(checkout)),
    gateRevision(ctx, task, folderDoc("plan")),
    workHead(ctx, checkout),
  ])
  if (
    top !== checkout ||
    common !== selected.common ||
    current.head !== head ||
    (currentBranch.trim() || null) !== branch ||
    selected.plan !== plan ||
    selected.work !== work
  )
    throw new Error(
      "The review commit, checkout or Plan changed. Choose the current candidate again.",
    )
  return selected
}
