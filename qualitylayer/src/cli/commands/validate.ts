// `qualitylayer validate <doc> --json` — the same check gate open runs,
// available on its own so an agent can iterate before opening a gate.

import { readBuildRecord } from "../../core/docs/build-log.ts"
import { LOGS } from "../../core/docs/names.ts"
import { validateDoc } from "../../core/docs/validate.ts"
import { verifyRecordErrors } from "../../core/next/verify.ts"
import { resolveRepo } from "../../core/paths.ts"
import { resolveTask } from "../../core/task/store.ts"
import { lostEvidenceWarnings } from "../../core/verification.ts"
import { type Ctx, err, type Result } from "../../ctx.ts"

type ValidationData = Awaited<ReturnType<typeof validateDoc>> extends Result<infer T> ? T : never
type ResolvedTask = NonNullable<Awaited<ReturnType<typeof resolveTask>>>

async function enrichVerifyReport(
  ctx: Ctx,
  task: ResolvedTask,
  data: ValidationData,
): Promise<ValidationData> {
  // The Verify record is held to exactly what `next` refuses it for (`verifyRecordErrors`: every
  // recorded verdict, each unread round's cited files, the unread round's assignment, shares and
  // proof), so a judge that validates its record is not refused when `next` reads it. Only a round
  // `next` has not counted yet is held to its files; a counted one that cites a file that is gone
  // gets a warning, the one `next` shows too.
  let next = data
  const record = await readBuildRecord(ctx, task)
  const known = new Set(next.errors.map((e) => `${e.line}\0${e.rule}\0${e.message}`))
  const more = (await verifyRecordErrors(ctx, task)).filter(
    (e) => !known.has(`${e.line}\0${e.rule}\0${e.message}`),
  )
  if (more.length > 0) {
    next = {
      ...next,
      valid: next.valid && !more.some((e) => e.severity === "error"),
      errors: [...next.errors, ...more],
    }
  }
  const gone = await lostEvidenceWarnings(ctx, task, record.verification)
  if (gone.length > 0) next = { ...next, errors: [...next.errors, ...gone] }
  return next
}

function toValidationResult(data: ValidationData): Result<unknown> {
  if (!data.valid) {
    // Only the errors refuse a document; the warnings ride along without counting.
    const count = data.errors.filter((e) => e.severity === "error").length
    return err({
      code: "validation_failed",
      message: `${data.doc} has ${count} validation error${count === 1 ? "" : "s"}`,
      errors: data.errors,
    })
  }
  return { ok: true, data: { doc: data.doc, valid: true, errors: data.errors } }
}

export async function validateCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const doc = args[0]
  if (doc === undefined) {
    return err({ code: "bad_args", message: "usage: qualitylayer validate <document>" })
  }
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return repo
  const task = await resolveTask(ctx, repo.data)
  if (task === null) {
    return err({ code: "no_task", message: "no open task in this repository" })
  }
  const report = await validateDoc(ctx, task.dir, doc, { runtimeDir: task.runtimeDir })
  if (!report.ok) return report
  const data =
    report.data.doc === LOGS.verify ? await enrichVerifyReport(ctx, task, report.data) : report.data
  return toValidationResult(data)
}
