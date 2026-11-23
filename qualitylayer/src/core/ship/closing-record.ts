// Shipping writes a closing record into the README frontmatter, so nothing of
// value stays outside the repository. After this the runtime folder for the
// task can be deleted.

import { join } from "node:path"
import { type Ctx, ok, type Result } from "../../ctx.ts"
import { cardsPath, readCards } from "../docs/outline-files.ts"
import { verifyTemplate } from "../docs/schema.ts"
import { buildBase } from "../git/base.ts"
import { changes } from "../git/changes.ts"
import { currentBranch } from "../git/repo.ts"
import { appendEvent, patchReadme, type Task } from "../task/store.ts"
import {
  type ClosingPass,
  closingReadyPath,
  commitsAfter,
  descriptionPath,
  nameJudgedCommit,
  passOf,
} from "./closing-pass.ts"
import { recordApproval } from "./landing.ts"
import { markUnknown, updateRecord } from "./landing-record.ts"
import { pullRequestBodyFile } from "./pr-body.ts"

export {
  type ClosedPass,
  type ClosingPass,
  closingReadyPath,
  descriptionPath,
  passedCommit,
  readClosedPass,
} from "./closing-pass.ts"

export type ClosingRecord = {
  status: "verified" | "approved"
  shipped: string
  branch: string | null
  commits: string[]
  iterations: number
  touched: string[]
  slices: number
}

/** Collapse changed files to the folders a later reader would search for. */
export function touchedFrom(paths: string[]): string[] {
  const touched = new Set<string>()
  for (const path of paths) {
    if (path.startsWith("docs/plans/")) continue
    const parts = path.split("/")
    touched.add(parts.length <= 2 ? path : `${parts.slice(0, 2).join("/")}/`)
  }
  return [...touched].sort().slice(0, 12)
}

export function shipStatePath(task: Pick<Task, "runtimeDir">): string {
  return join(task.runtimeDir, "ship.json")
}

export async function publishClosingRecord(ctx: Ctx, task: Task): Promise<void> {
  if (await ctx.fs.exists(shipStatePath(task))) return
  const ready = JSON.parse(await ctx.fs.readFile(closingReadyPath(task))) as {
    closing: ClosingRecord
  }
  await ctx.fs.atomicWrite(
    shipStatePath(task),
    `${JSON.stringify({ slug: task.slug, shipped: ctx.clock.now(), announced: false, closing: ready.closing })}\n`,
  )
  await appendEvent(ctx, task, {
    event: "task_shipped",
    iterations: task.iterations,
    slices: ready.closing.slices,
  })
}

/** Heads the generated draft until the agent has rewritten it from the diff. */
export const DRAFT_MARKER =
  "<!-- draft: rewrite this description from the diff, then delete this line -->"

/** Write the draft for the final gate, unless a description is there already. */
export async function ensureDraftDescription(ctx: Ctx, task: Task): Promise<string> {
  const path = descriptionPath(task)
  if (await ctx.fs.exists(path)) return ctx.fs.readFile(path)
  // Its markers QualityLayer fills (core/pages/refresh.ts); its Why the agent writes.
  const text = verifyTemplate(task, task.title)
  await ctx.fs.writeFile(path, text)
  return text
}

/** The landing record could not be written: the task stays landing, its approved head unknown. */
async function landingRecordFailed(ctx: Ctx, task: Task, cause: unknown): Promise<void> {
  // Instead of reading as a task from before the record existed.
  await markUnknown(ctx, task).catch(() => undefined)
  await appendEvent(ctx, task, {
    event: "landing_record_failed",
    reason: cause instanceof Error ? cause.message : String(cause),
  }).catch(() => undefined)
}

/** Set the landing record's approved head to the head the person approved on, when it differs. */
async function bindApprovedHead(ctx: Ctx, task: Task, head: string | undefined): Promise<void> {
  if (head === undefined || head === "") return
  await updateRecord(ctx, task, (fresh) =>
    fresh === null || fresh.approvedHead === head ? null : { ...fresh, approvedHead: head },
  )
}

async function reuseExistingClosing(ctx: Ctx, task: Task): Promise<ClosingRecord | null> {
  if (!(await ctx.fs.exists(closingReadyPath(task)))) return null
  const previous = JSON.parse(await ctx.fs.readFile(closingReadyPath(task))) as {
    closing?: ClosingRecord
    pass?: ClosingPass
  }
  if (!previous.closing) return null
  // A close taken up again: the Verify file may have been refreshed in between.
  if (previous.pass?.stands === false) {
    await nameJudgedCommit(ctx, task, previous.pass)
    await pullRequestBodyFile(ctx, task)
  }
  return previous.closing
}

export async function closeTask(
  ctx: Ctx,
  task: Task,
  options: {
    authority?: (candidate: string) => Promise<Result<true>>
    /** Whether the judge's pass covers the code being approved, read before the task moved on. */
    pass?: ClosingPass
    /** The same reading, taken again once the record is written; without it the task's own records are read. */
    passNow?: () => Promise<ClosingPass>
    /**
     * The commit the checkout was on when the person approved: what the approval covers. Without
     * it the head at this write is taken (an approval applied where it was given).
     */
    approvedHead?: string
  } = {},
): Promise<Result<ClosingRecord>> {
  const existing = await reuseExistingClosing(ctx, task)
  if (existing !== null) return ok(existing)
  const authorized = await options.authority?.(task.repoRoot)
  if (authorized && !authorized.ok) return authorized
  const diff = await changes(ctx, task.repoRoot, await buildBase(ctx, task))

  let slices = 0
  if (await ctx.fs.exists(cardsPath(task.dir)))
    slices = (await readCards(ctx, task.dir)).slices.length

  // `verified` says the judge passed the code that is approved. An approval of code that moved since
  // closes the task all the same, as `approved`.
  let pass = options.pass ?? (await passOf(ctx, task))
  const record: ClosingRecord = {
    status: pass.stands ? "verified" : "approved",
    shipped: new Date(ctx.clock.now()).toISOString().slice(0, 10),
    branch: await currentBranch(ctx, task.repoRoot),
    commits: diff.commits.map((c) => c.sha),
    iterations: task.iterations,
    touched: touchedFrom(diff.files.map((f) => f.path)),
    slices,
  }
  await patchReadme(ctx, task, { ...record, gate: null })

  // The description was written before the final gate; only a task that
  // reached it without one gets the generated text.
  if (!(await ctx.fs.exists(descriptionPath(task)))) {
    await ctx.fs.mkdir(task.runtimeDir)
    await ctx.fs.writeFile(descriptionPath(task), verifyTemplate(task, task.title))
  }
  if (!pass.stands) await nameJudgedCommit(ctx, task, pass)
  // The description and closing record stay on disk; committing them is the person's choice.
  await pullRequestBodyFile(ctx, task)

  // What the approval covers, for the landing state after it. Bookkeeping: it never fails the close,
  // but a failure is kept in the task's events, since without the record the task reads as closed.
  await recordApproval(ctx, task, record.branch)
    // The approval was given on an earlier head than the one this write finds (it was applied
    // later): the landing record keeps the head at the click, so what was committed after it is
    // listed as a change since the approval and never counts as approved.
    .then(() => bindApprovedHead(ctx, task, options.approvedHead))
    .catch((cause: unknown) => landingRecordFailed(ctx, task, cause))

  // `verified` was read before these writes. The pass is read once more at the write that the
  // shipped record is made from: code that moved in between closes as `approved`, with its commit named.
  if (pass.stands) {
    const now = await (options.passNow ?? (() => passOf(ctx, task)))().catch(
      (): ClosingPass => ({ stands: false, commit: null, code: true }),
    )
    if (!now.stands) {
      pass = now
      record.status = "approved"
      await patchReadme(ctx, task, { status: record.status })
      await nameJudgedCommit(ctx, task, now)
      await pullRequestBodyFile(ctx, task)
    }
  }

  await ctx.fs.atomicWrite(
    closingReadyPath(task),
    `${JSON.stringify({
      closing: record,
      ...(pass.stands
        ? {}
        : {
            // Counted once, here: the header reads how many commits the passes did not cover.
            pass: {
              ...pass,
              after: await commitsAfter(ctx, task, pass.commit, options.approvedHead),
            },
          }),
    })}\n`,
  )
  return ok(record)
}
