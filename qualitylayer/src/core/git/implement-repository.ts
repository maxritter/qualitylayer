import { realpath } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { sectionText } from "../docs/build-log.ts"
import { folderDoc } from "../docs/names.ts"
import { proseLines } from "../docs/rules/types.ts"
import { type RepoRef, repoIdFrom } from "../paths.ts"
import { reconcile } from "../task/reconcile.ts"
import type { Task } from "../task/store.ts"
import { existingSliceCommit } from "./slice-commit.ts"

async function approvedRepositories(ctx: Ctx, task: Task): Promise<(string | undefined)[]> {
  const plan = await ctx.fs.readFile(join(task.dir, folderDoc("plan")))
  const scope = proseLines(sectionText(plan, "Scope").replace(/<!--[\s\S]*?(?:-->|$)/g, ""))
    .map(({ text }) => text)
    .join("\n")
  const inScope = scope.split(/^### In scope[ \t]*$/m)[1]?.split(/^### /m)[0] ?? ""
  return [...inScope.matchAll(/^ {0,3}- \*\*Repository:\*\* `([^`\r\n]+)`[ \t]*$/gm)].map(
    (entry) => entry[1],
  )
}

async function resolveExtraCheckout(ctx: Ctx, task: Task, root: string): Promise<Result<RepoRef>> {
  const refused = (message: string) => err({ code: "bad_args" as const, message })
  const canonical = await realpath(root).catch(() => null)
  if (canonical === null || canonical !== root)
    return refused(`${root} is not the exact local path of a checkout root.`)
  const [top, commonDir] = await Promise.all([ctx.git.topLevel(root), ctx.git.commonDir(root)])
  if (top !== root || commonDir === null) return refused(`${root} is not a Git working tree root.`)
  const id = repoIdFrom(commonDir)
  if (id === task.repoId) return refused("Use the task’s primary checkout without --repo.")
  return ok({ root, commonDir, id })
}

/** The exact additional local checkout the person's approved Scope authorizes. */
export async function implementRepository(
  ctx: Ctx,
  task: Task,
  path: string,
): Promise<Result<RepoRef>> {
  const refused = (message: string) => err({ code: "bad_args", message })
  if (task.stage !== "implement")
    return refused("A second repository can be used while the task is in Implement.")
  if (!isAbsolute(path))
    return refused("--repo needs the absolute path of the additional checkout root.")
  const admitted = await reconcile(ctx, task)
  if (!admitted.ok) return admitted
  const root = resolve(path)
  if (!(await approvedRepositories(ctx, task)).includes(root))
    return refused(`${root} is not named as a Repository in the approved Plan’s Scope.`)
  return resolveExtraCheckout(ctx, task, root)
}

export type ExternalSlice = {
  slice: number
  repository: string
  repoId: string
  commit: string
  subject: string
  files: string[]
}

const receiptPath = (task: Pick<Task, "runtimeDir">, slice: number) =>
  join(task.runtimeDir, "external-slices", `${slice}.json`)

export async function externalSlice(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  slice: number,
): Promise<ExternalSlice | null> {
  const path = receiptPath(task, slice)
  if (!(await ctx.fs.exists(path))) return null
  return JSON.parse(await ctx.fs.readFile(path)) as ExternalSlice
}

export async function externalSlices(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<ExternalSlice[]> {
  const dir = join(task.runtimeDir, "external-slices")
  if (!(await ctx.fs.exists(dir))) return []
  const numbers = (await ctx.fs.readdir(dir))
    .filter((name) => /^\d+\.json$/.test(name))
    .map((name) => Number(name.slice(0, -5)))
    .sort((a, b) => a - b)
  return (
    await Promise.all(numbers.map((slice) => externalSlice(ctx, task, slice).catch(() => null)))
  ).filter((receipt) => receipt !== null)
}

/** Record a manual commit without changing either checkout or the primary release ledger. */
export async function registerExternalSlice(
  ctx: Ctx,
  task: Task,
  input: { slice: number; files: string[]; path: string; hash: string },
): Promise<Result<ExternalSlice>> {
  const { slice, files, path, hash } = input
  await ctx.fs.mkdir(join(task.runtimeDir, "external-slices"))
  await ctx.fs.assertSafeDirectory?.(join(task.runtimeDir, "external-slices"))
  return ctx.fs.withLock(join(task.runtimeDir, "external-slices.lock"), async () => {
    const repo = await implementRepository(ctx, task, path)
    if (!repo.ok) return repo
    const found = await existingSliceCommit(repo.data.root, hash, files, true)
    if (!found.ok) return found
    const previous = await externalSlice(ctx, task, slice)
    if (previous && (previous.repository !== repo.data.root || previous.repoId !== repo.data.id))
      return err({
        code: "bad_args",
        message: `Slice ${slice} already has a receipt in ${previous.repository}.`,
      })
    if (previous?.commit === found.data.commit) return ok(previous)
    if (previous) {
      const ancestry = await ctx.git.run(repo.data.root, [
        "merge-base",
        "--is-ancestor",
        previous.commit,
        "HEAD",
      ])
      if (ancestry.code !== 1)
        return err({
          code: "bad_args",
          message: `Slice ${slice} already records ${previous.commit.slice(0, 9)} on this checkout’s history.`,
        })
    }
    const receipt = { slice, repository: repo.data.root, repoId: repo.data.id, ...found.data }
    await ctx.fs.atomicWrite(receiptPath(task, slice), `${JSON.stringify(receipt)}\n`, {
      followSymlink: false,
    })
    return ok(receipt)
  })
}
