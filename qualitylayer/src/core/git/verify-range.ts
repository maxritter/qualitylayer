import { join } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { projectRuntimeDir } from "../paths.ts"
import { shellQuote } from "../shell.ts"
import { readmeFrontmatter, type Task } from "../task/store.ts"
import { effectiveBase } from "./base.ts"
import { mapBounded } from "./bounded.ts"
import { sliceCommits } from "./build-start.ts"
import { commitId } from "./review-worktrees.ts"

export type VerifyRange = { base: string; head: string; commits: string[] }
export const verifyPaths = [".", ":(exclude)docs/plans/**"]

async function hasForeignCommit(ctx: Ctx, task: Task, commits: string[]): Promise<boolean> {
  const dir = join(projectRuntimeDir(ctx, task.repoId), "tasks")
  if (!(await ctx.fs.exists(dir))) return false
  const names = await ctx.fs.readdir(dir).catch(() => null)
  if (!names || names.length > 512) return true
  const others = names.filter((name) => name !== task.slug)
  const receipts = await mapBounded(others, (name) =>
    sliceCommits(ctx, { runtimeDir: join(dir, name) }),
  )
  const prefixes = new Map<number, Set<string>>()
  function matchesCommit(sha: string): boolean {
    if (!/^[a-f0-9]{7,64}$/.test(sha)) return false
    let atLength = prefixes.get(sha.length)
    if (!atLength) {
      atLength = new Set(commits.map((commit) => commit.slice(0, sha.length)))
      prefixes.set(sha.length, atLength)
    }
    return atLength.has(sha)
  }
  return receipts.some((rows) => rows.length > 512 || rows.some(matchesCommit))
}

async function resolveVerifyBase(ctx: Ctx, task: Task, head: string): Promise<string | null> {
  const fm = await readmeFrontmatter(ctx, task)
  if (typeof fm.base !== "string" || !/^[a-f0-9]{7,64}$/.test(fm.base)) return null
  const base = await effectiveBase(ctx, task.repoRoot, fm, head)
  if (!base || !commitId.test(base)) return null
  const ancestor = await ctx.git.run(task.repoRoot, ["merge-base", "--is-ancestor", base, head])
  return ancestor.code === 0 ? base : null
}

async function listVerifyCommits(
  ctx: Ctx,
  repoRoot: string,
  base: string,
  head: string,
): Promise<string[] | null> {
  const list = await ctx.git.run(repoRoot, ["rev-list", "--reverse", `${base}..${head}`], {
    maxOutputBytes: 256 * 1024,
  })
  if (list.code !== 0) return null
  const commits = list.stdout.split("\n").filter(Boolean)
  return commits.every((sha) => commitId.test(sha)) ? commits : null
}

/** The source assigned to a whole-tree judge, with immutable endpoints and no working edits. */
export async function verifyRange(
  ctx: Ctx,
  task: Task,
  head: string | undefined,
  explicitlySelected = false,
): Promise<VerifyRange | null> {
  if (!head || !commitId.test(head)) return null
  const base = await resolveVerifyBase(ctx, task, head)
  if (!base) return null
  const commits = await listVerifyCommits(ctx, task.repoRoot, base, head)
  if (!commits) return null
  if (!explicitlySelected && (await hasForeignCommit(ctx, task, commits))) return null
  return { base, head, commits }
}

export function verifyDiffArgs(range: Pick<VerifyRange, "base" | "head">, files?: string[]) {
  const paths = files?.map((file) => `:(literal)${file}`) ?? verifyPaths
  return [
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--textconv",
    "--no-renames",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    range.base,
    range.head,
    "--",
    ...paths,
  ]
}

export const verifyDiffCommand = (range: VerifyRange) =>
  `git ${verifyDiffArgs(range).map(shellQuote).join(" ")}`

export async function verifyChangedPaths(ctx: Ctx, task: Task, range: VerifyRange) {
  const listed = await ctx.git.run(
    task.repoRoot,
    ["diff", "--no-renames", "--name-only", "-z", range.base, range.head, "--", ...verifyPaths],
    { maxOutputBytes: 1024 * 1024 },
  )
  if (listed.code !== 0) throw new Error("The reviewed commit's files could not be read.")
  return listed.stdout.split("\0").filter(Boolean)
}
