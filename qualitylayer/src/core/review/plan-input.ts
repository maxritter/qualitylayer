import { createHash, randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { parseDoc } from "../docs/frontmatter.ts"
import { withoutMarkerText } from "../docs/markers.ts"
import { agentFileOf, folderDoc } from "../docs/names.ts"
import type { Task } from "../task/store.ts"

const planFile = folderDoc("plan")
const agentsFile = agentFileOf("plan")

async function planDocuments(ctx: Ctx, task: Task) {
  const documents = new Map<string, string>()
  for (const name of [planFile, agentsFile]) {
    const path = join(task.dir, name)
    if (await ctx.fs.exists(path)) documents.set(name, await ctx.fs.readFile(path))
  }
  return documents
}

// The Plan's generated sections and task metadata can change simply because the gate opens.
function digestOf(documents: ReadonlyMap<string, string>): string {
  const plan = documents.get(planFile)
  return createHash("sha256")
    .update(
      JSON.stringify([
        plan === undefined ? null : withoutMarkerText(parseDoc(plan).body),
        documents.get(agentsFile) ?? null,
      ]),
    )
    .digest("hex")
}

export async function planReviewDigest(ctx: Ctx, task: Task): Promise<string> {
  return digestOf(await planDocuments(ctx, task))
}

export type PlanReviewInput = {
  digest: string
  files: ReadonlyMap<string, string>
  close(): Promise<void>
}

export type PlanReviewCoverage = "current" | "earlier" | "unknown"

export const planReviewCoverageNote = (coverage: PlanReviewCoverage | undefined): string =>
  coverage === "earlier"
    ? "The second opinion reviewed an earlier Plan. "
    : coverage === "unknown"
      ? "The second opinion has no saved Plan revision. "
      : ""

/** Give every seat and retry the same Plan files even when the planner keeps editing. */
export async function capturePlanReviewInput(ctx: Ctx, task: Task): Promise<PlanReviewInput> {
  const documents = await planDocuments(ctx, task)
  const directory = join(task.runtimeDir, `plan-review-${randomUUID()}`)
  const close = () => ctx.fs.remove(directory)
  const files = new Map<string, string>()
  try {
    for (const [name, content] of documents) {
      const file = join(directory, name)
      await ctx.fs.mkdir(dirname(file), { mode: 0o700 })
      await ctx.fs.writeFile(file, content, { mode: 0o400, exclusive: true })
      files.set(join(task.dir, name), file)
    }
    return { digest: digestOf(documents), files, close }
  } catch (cause) {
    await close()
    throw cause
  }
}

export async function planReviewCoverage(
  ctx: Ctx,
  task: Task,
  run: { state: string; planInput?: string } | null,
): Promise<PlanReviewCoverage | undefined> {
  if (run?.state !== "done") return undefined
  if (run.planInput === undefined) return "unknown"
  return (await planReviewDigest(ctx, task)) === run.planInput ? "current" : "earlier"
}
