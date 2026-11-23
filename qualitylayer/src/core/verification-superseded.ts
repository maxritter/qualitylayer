// Unread records with obsolete inputs or an unusable owned context are kept verbatim in records/.
// A malformed record of current inputs stays with its judge for correction. Counted rounds stay.
import { join } from "node:path"
import type { Ctx } from "../ctx.ts"
import { type Iteration, readBuildRecord, verifyLogPath } from "./docs/build-log.ts"
import { RECORDS_DIR } from "./docs/names.ts"
import { buildRevision } from "./gate/revision.ts"
import { appendEvent, type Task } from "./task/store.ts"
import { type Assignment, readAssignment, verificationContextRevision } from "./verification.ts"

const ITERATION_HEADING = /^### Iteration (\d+)/i

type JudgedInputs = Pick<Assignment, "id" | "iteration" | "revision" | "context"> & {
  head: string
}

function hasValidJudgedMetadata(record: Partial<JudgedInputs>): boolean {
  const validHead = typeof record.head === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(record.head)
  const validRevision =
    typeof record.revision === "string" && /^[a-f0-9]{64}$/.test(record.revision)
  const validContext = typeof record.context === "string" && /^[a-f0-9]{64}:/.test(record.context)
  return validHead && validRevision && validContext
}

function matchingInputs(value: unknown, id: string, iteration: number): JudgedInputs | null {
  if (value === null || typeof value !== "object") return null
  const record = value as Partial<JudgedInputs>
  if (record.id !== id || record.iteration !== iteration) return null
  return hasValidJudgedMetadata(record) ? (record as JudgedInputs) : null
}

/** Split parts must share one exact assignment; incomplete legacy metadata proves no supersession. */
async function judgedInput(
  ctx: Ctx,
  task: Task,
  iteration: Iteration,
): Promise<JudgedInputs | null> {
  const current = await readAssignment(ctx, task)
  const parts = iteration.parts ?? [iteration]
  const id = parts[0]?.assignment
  if (
    typeof id !== "string" ||
    !/^[A-Za-z0-9-]+$/.test(id) ||
    parts.some((part) => part.assignment !== id)
  )
    return null
  let value: unknown = current
  if (current?.id !== id) {
    try {
      value = JSON.parse(
        await ctx.fs.readFile(join(task.runtimeDir, "judgements", `${id}.json`)),
      ) as unknown
    } catch {
      return null
    }
  }
  const matched = matchingInputs(value, id, iteration.n)
  if (
    matched === null ||
    parts.some((part) => part.revision !== undefined && part.revision !== matched.revision)
  )
    return null
  return matched
}

/**
 * Cut the block that opens at `line` (1-based) out of `lines`: up to the next heading of its level or
 * above. It must be the heading of iteration `n`: a line that moved under an earlier cut is not cut.
 */
function cutBlock(lines: string[], line: number, n: number): string | null {
  const start = line - 1
  const heading = ITERATION_HEADING.exec((lines[start] ?? "").trimEnd())
  if (heading === null || Number(heading[1]) !== n) return null
  let end = start + 1
  while (end < lines.length && !/^#{1,3}\s/.test(lines[end] ?? "")) end++
  const block = lines.slice(start, end).join("\n").trim()
  lines.splice(start, end - start)
  return block
}

/**
 * Set aside unread records only when their assigned input/context is provably obsolete.
 * HEAD is audit metadata: unrelated commits do not make a current malformed record disposable.
 */
export async function setAsideStaleUnread(ctx: Ctx, task: Task): Promise<number[]> {
  const unread = (await readBuildRecord(ctx, task)).verification.filter(
    (iteration) => iteration.n > task.iterations,
  )
  if (unread.length === 0) return []
  const rev = await ctx.git.run(task.repoRoot, ["rev-parse", "HEAD"])
  if (rev.code !== 0) return []
  const head = rev.stdout.trim()
  let revision: string
  let context: string
  try {
    revision = await buildRevision(ctx, task)
    context = await verificationContextRevision(ctx, task)
  } catch {
    return []
  }
  const stale: { iteration: Iteration; judged: string }[] = []
  for (const iteration of unread) {
    const receipt = await judgedInput(ctx, task, iteration)
    if (receipt === null) continue
    const obsolete = receipt.revision !== revision || receipt.context !== context
    if (obsolete) stale.push({ iteration, judged: receipt.head })
  }
  if (stale.length === 0) return []
  return archiveBlocks(
    ctx,
    task,
    stale.map(({ iteration, judged }) => ({
      iteration,
      name: `it${iteration.n}-superseded-${judged.slice(0, 12)}`,
      title: "superseded",
      why: (date, blocks) =>
        `Set aside by \`next\` on ${date}: the judges ruled on commit \`${judged}\`, HEAD is \`${head}\`, ` +
        `and the record did not validate, so it never counted. It says nothing about the build now. ` +
        `Its block, verbatim:\n\n\`\`\`\`markdown\n${blocks}\n\`\`\`\`\n`,
      event: { event: "verification_superseded", iteration: iteration.n, judged, head },
    })),
  )
}

type Archived = {
  iteration: Iteration
  /** The file's name in records/, without `.md`. */
  name: string
  title: string
  why: (date: string, blocks: string) => string
  event: Record<string, unknown>
}

/** Cut each iteration's blocks out of the Verify record into records/, verbatim, with the reason. */
async function archiveBlocks(ctx: Ctx, task: Task, entries: Archived[]): Promise<number[]> {
  const path = verifyLogPath(task)
  const lines = (await ctx.fs.readFile(path)).split(/\r?\n/)
  const folder = join(task.dir, RECORDS_DIR)
  await ctx.fs.mkdir(folder)
  const date = new Date(ctx.clock.now()).toISOString().slice(0, 10)
  const done: number[] = []
  // Every block of every entry from the bottom of the file up, so a cut never moves the lines the
  // parse found for a block above it (cutting entry by entry cut the wrong block).
  const cuts = entries
    .flatMap(({ iteration }, entry) =>
      (iteration.parts ?? [iteration]).map((part) => ({ entry, line: part.line, n: iteration.n })),
    )
    .toSorted((a, b) => b.line - a.line)
  const cutOut: string[][] = entries.map(() => [])
  for (const { entry, line, n } of cuts) {
    const block = cutBlock(lines, line, n)
    if (block !== null) cutOut[entry]?.unshift(block)
  }
  for (const [entry, { iteration, name, title, why, event }] of entries.entries()) {
    const blocks = cutOut[entry] ?? []
    if (blocks.length === 0) continue
    let file = `${name}.md`
    for (let again = 2; await ctx.fs.exists(join(folder, file)); again++)
      file = `${name}-${again}.md`
    await ctx.fs.writeFile(
      join(folder, file),
      `# Iteration ${iteration.n} · ${title}\n\n${why(date, blocks.join("\n\n"))}`,
    )
    await appendEvent(ctx, task, { ...event, record: file })
    done.push(iteration.n)
  }
  if (done.length > 0) await ctx.fs.writeFile(path, lines.join("\n").replace(/\n{3,}/g, "\n\n"))
  return done
}

async function replacedAssignmentId(
  ctx: Ctx,
  task: Task,
  currentId: string,
  iteration: Iteration,
): Promise<string | null> {
  const parts = iteration.parts ?? [iteration]
  const id = parts[0]?.assignment
  if (typeof id !== "string" || id === currentId || !/^[A-Za-z0-9-]+$/.test(id)) return null
  if (parts.some((part) => part.assignment !== id)) return null
  const recorded = await ctx.fs.exists(join(task.runtimeDir, "judgements", `${id}.json`))
  return recorded ? id : null
}

/**
 * Set aside unread blocks that name an assignment a later one replaced. A replaced judge's block
 * can never be read (the current assignment's is the one that counts), and left in the record it
 * hides the current judge's valid block when it is written last. Only an assignment QualityLayer
 * handed out is known as replaced; a block that names none stays with its judge for correction.
 */
export async function setAsideReplaced(ctx: Ctx, task: Task): Promise<number[]> {
  const current = await readAssignment(ctx, task)
  if (current === null) return []
  const unread = (await readBuildRecord(ctx, task)).verification.filter(
    (iteration) => iteration.n > task.iterations,
  )
  const replaced: { iteration: Iteration; id: string }[] = []
  for (const iteration of unread) {
    const id = await replacedAssignmentId(ctx, task, current.id, iteration)
    if (id !== null) replaced.push({ iteration, id })
  }
  if (replaced.length === 0) return []
  return archiveBlocks(
    ctx,
    task,
    replaced.map(({ iteration, id }) => ({
      iteration,
      name: `it${iteration.n}-replaced-${id.slice(0, 12)}`,
      title: "replaced",
      why: (date, blocks) =>
        `Set aside by \`next\` on ${date}: the block names assignment \`${id}\`, which a later assignment ` +
        `(\`${current.id}\`) replaced, so it never counted. The current assignment's block is the one read. ` +
        `Its block, verbatim:\n\n\`\`\`\`markdown\n${blocks}\n\`\`\`\`\n`,
      event: { event: "verification_replaced", iteration: iteration.n, assignment: id },
    })),
  )
}
