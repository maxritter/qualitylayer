// helper result <helper-id> [--file <path>]: the report a helper returned is kept under the task
// at once (records/research-<id>.md), so a compaction of the agent's context cannot lose it.

import { join, resolve } from "node:path"
import { artifactOfCheck, artifactReviewFile } from "../../core/artifact-check.ts"
import { REVIEWS_DIR } from "../../core/docs/names.ts"
import { saveHelperResult } from "../../core/helpers.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { parseArgs, requireTask } from "./shared.ts"

const USAGE =
  "usage: qualitylayer helper result <helper-id> [--file <path>]   (without --file the report is read from standard input)"

async function readReport(
  ctx: Ctx,
  fileFlag: string | true | undefined,
  stdin: () => Promise<string>,
): Promise<Result<string>> {
  try {
    const report =
      typeof fileFlag === "string"
        ? await ctx.fs.readFile(resolve(ctx.env.cwd(), fileFlag))
        : await stdin()
    return ok(report)
  } catch {
    return err({ code: "bad_args", message: "the report could not be read" })
  }
}

async function formatHelperResult(
  ctx: Ctx,
  task: Awaited<ReturnType<typeof requireTask>> extends Result<infer T> ? T : never,
  id: string,
  report: string,
  saved: Awaited<ReturnType<typeof saveHelperResult>> extends Result<infer T> ? T : never,
): Promise<Result<unknown>> {
  // An artifact check's report is that artifact's review, where `plan draft` reads it.
  const artifact = await artifactOfCheck(ctx, task, id)
  if (artifact === null) {
    return ok({
      ...saved,
      then: `Read ${saved.file} when you fold this helper's answers into the research document; it stays on disk if your context is compacted.`,
    })
  }
  const review = artifactReviewFile(artifact)
  await ctx.fs.mkdir(join(task.dir, REVIEWS_DIR))
  await ctx.fs.atomicWrite(join(task.dir, review), report)
  return ok({
    ...saved,
    file: review,
    then: `This is the check of artifact ${artifact}: its report is filed as ${review}. Fix the findings you take, and under each finding write \`Answer: Taken · <what you changed>\` or \`Answer: Kept · <why it stays>\`.`,
  })
}

export async function helperCmd(
  ctx: Ctx,
  args: string[],
  stdin: () => Promise<string> = readStdin,
): Promise<Result<unknown>> {
  const [sub, ...rest] = args
  const { positional, flags } = parseArgs(rest, ["file"])
  const id = positional[0]
  if (sub !== "result" || id === undefined || positional.length !== 1 || flags.file === true)
    return err({ code: "bad_args", message: USAGE })
  const task = await requireTask(ctx)
  if (!task.ok) return task
  const report = await readReport(ctx, flags.file, stdin)
  if (!report.ok) return report
  const saved = await saveHelperResult(ctx, task.data, id, report.data)
  if (!saved.ok) return saved
  return formatHelperResult(ctx, task.data, id, report.data, saved.data)
}

async function readStdin(): Promise<string> {
  return process.stdin.isTTY ? "" : await Bun.stdin.text()
}
