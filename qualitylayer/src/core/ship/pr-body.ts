// The pull request's body in a task: everything of 03-verify.md above *Ship*, exported as written
// (Why, Code, Diagrams, Interface, Done means, Checks, Changed from the Plan). The people's file is the pull
// request description: the prose goes out as it stands, and the pictures stay local unless they are
// published, so the Screens and Acceptance test sections name them. *Ship* stays in the file: it is
// for the person approving, not for the pull request's reader.

import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { RECORDS_DIR } from "../docs/names.ts"
import { proseLines } from "../docs/rules/types.ts"
import { forReaders } from "../integrations/for-readers.ts"
import type { Task } from "../task/store.ts"
import { descriptionPath } from "./closing-record.ts"

/** The headings after which the Verify file is no longer the pull request's body. */
const AFTER_BODY: ReadonlySet<string> = new Set(["Ship"])

/** The body of a task's Verify file: everything between its title and the first section that stays out. */
export function pullRequestBody(review: string): string {
  const lines = review.replace(/\r\n?/g, "\n").split("\n")
  const prose = new Set(proseLines(review).map((l) => l.line))
  let start = 0
  let end = lines.length
  let titled = false
  for (const [index, line] of lines.entries()) {
    if (!prose.has(index + 1)) continue
    if (!titled && /^# /.test(line)) {
      titled = true
      start = index + 1
      continue
    }
    if (line.startsWith("## ") && AFTER_BODY.has(line.slice(3).trimEnd())) {
      end = index
      break
    }
  }
  // As the request's readers see it: no front matter and no section that is only its heading.
  return `${forReaders(lines.slice(start, end).join("\n")).text.trim()}\n`
}

/** Where a task's pull request body is written for `gh --body-file`. */
export const bodyFilePath = (task: Pick<Task, "dir">): string =>
  join(task.dir, RECORDS_DIR, "pull-request-body.md")

/** Write the body beside the records, unless it is there as it is. */
export async function writeBodyFile(
  ctx: Ctx,
  task: Pick<Task, "dir">,
  body: string,
): Promise<void> {
  const file = bodyFilePath(task)
  await ctx.fs.mkdir(join(task.dir, RECORDS_DIR))
  if (!(await ctx.fs.exists(file)) || (await ctx.fs.readFile(file)) !== body)
    await ctx.fs.writeFile(file, body)
}

/**
 * The file `gh pr create --body-file` reads: in a task the exported body, written beside the
 * records; in any other layout the description itself.
 */
export async function pullRequestBodyFile(ctx: Ctx, task: Task): Promise<string> {
  const path = descriptionPath(task)
  if (!(await ctx.fs.exists(path))) return path
  const file = bodyFilePath(task)
  await writeBodyFile(ctx, task, pullRequestBody(await ctx.fs.readFile(path)))
  return file
}
