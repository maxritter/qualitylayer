import { cp, mkdir, realpath } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import type { Ctx } from "../../ctx.ts"
import { runDir } from "./registry.ts"
import {
  copyApprovedTaskToWorktree,
  directories,
  entry,
  gitIdentity,
  inside,
  regularBytes,
} from "./worktree-copy.ts"
import { worktreeName, worktreePlan } from "./worktree-plan.ts"

export { copyApprovedTaskToWorktree }
export type WorktreeChoices = { branch?: string; worktreePath?: string }
const RECEIPT_BYTES = 4096

async function canonicalMissing(path: string): Promise<string> {
  const missing: string[] = []
  let at = resolve(path)
  while (!(await entry(at))) {
    missing.unshift(basename(at))
    at = dirname(at)
  }
  return join(await realpath(at), ...missing)
}

const gitCryptKeys = (commonDir: string) => join(commonDir, "git-crypt", "keys")
async function hasGitCryptKeys(commonDir: string): Promise<boolean> {
  return (await entry(gitCryptKeys(commonDir)))?.isDirectory() === true
}

/** Whether the checkout's repository holds git-crypt keys, so a new worktree needs them copied in. */
export async function usesGitCrypt(ctx: Ctx, checkout: string): Promise<boolean> {
  try {
    return await hasGitCryptKeys((await gitIdentity(ctx, checkout)).commonDir)
  } catch {
    return false
  }
}

type WorktreeSpec = {
  ctx: Ctx
  checkout: string
  run: string
  request: string
  choices: WorktreeChoices
  create: boolean
}

type ResolvedWorktreeTarget = {
  source: Awaited<ReturnType<typeof gitIdentity>>
  branch: string
  cwd: string
  receiptPath: string
  wanted: { version: number; run: string; branch: string; commonDir: string; cwd: string }
  encoded: string
}

async function resolveWorktreeTarget(spec: WorktreeSpec): Promise<ResolvedWorktreeTarget> {
  const { ctx, checkout, run, request, choices } = spec
  const receiptPath = join(runDir(await canonicalMissing(ctx.home), run), "workspace.json")
  const source = await gitIdentity(ctx, checkout)
  const name = `${worktreeName(request)}-${run.slice(0, 8)}`
  const branch = choices.branch ?? `ql/${name}`
  const checked = await ctx.git.run(checkout, ["check-ref-format", "--branch", branch])
  if (checked.code !== 0 || checked.stdout.trim() !== branch)
    throw new Error("Choose a valid literal Git branch name")
  if (
    choices.worktreePath !== undefined &&
    (!isAbsolute(choices.worktreePath) || choices.worktreePath.includes("\0"))
  )
    throw new Error("The worktree path must be absolute")
  const requested = resolve(choices.worktreePath ?? worktreePlan(source.cwd, name, "").folder)
  await directories(dirname(requested))
  const found = await entry(requested)
  if (found && (!found.isDirectory() || found.isSymbolicLink()))
    throw new Error("The requested worktree path is already held by another checkout")
  const cwd = await canonicalMissing(requested)
  if (cwd === source.commonDir || inside(source.commonDir, cwd))
    throw new Error("A worktree cannot be created inside Git metadata")
  await directories(dirname(receiptPath))
  const wanted = { version: 1, run, branch, commonDir: source.commonDir, cwd }
  const encoded = JSON.stringify(wanted)
  if (Buffer.byteLength(encoded) > RECEIPT_BYTES)
    throw new Error("Workspace identity exceeds its metadata limit")
  return { source, branch, cwd, receiptPath, wanted, encoded }
}

async function verifyExistingWorktree(
  ctx: Ctx,
  target: ResolvedWorktreeTarget,
  receipt: Record<string, unknown> | null,
): Promise<{ cwd: string; branch: string }> {
  if (!receipt || Object.entries(target.wanted).some(([key, value]) => receipt[key] !== value))
    throw new Error(
      "The requested worktree path is already held without this run's ownership receipt",
    )
  const actual = await gitIdentity(ctx, target.cwd)
  if (
    actual.commonDir !== target.source.commonDir ||
    actual.cwd !== target.cwd ||
    actual.branch !== target.branch
  )
    throw new Error("The requested worktree no longer matches its recorded Git identity")
  return { cwd: target.cwd, branch: target.branch }
}

async function createWorktreeWithReceipt(
  ctx: Ctx,
  checkout: string,
  target: ResolvedWorktreeTarget,
): Promise<{ cwd: string; branch: string }> {
  const { source, branch, cwd, receiptPath, encoded } = target
  const held = await ctx.git.run(checkout, [
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${branch}`,
  ])
  if (held.code !== 1)
    throw new Error(
      "The requested branch already exists or Git could not verify it; choose a new branch",
    )
  await mkdir(dirname(cwd), { recursive: true })
  await directories(dirname(cwd))
  // A git-crypt repository cannot check out its encrypted files until the new worktree's own git
  // directory holds the keys, so the checkout waits for them.
  const keys = gitCryptKeys(source.commonDir)
  const locked = await hasGitCryptKeys(source.commonDir)
  const made = await ctx.git.run(checkout, [
    "worktree",
    "add",
    ...(locked ? ["--no-checkout"] : []),
    "-b",
    branch,
    "--",
    cwd,
    "HEAD",
  ])
  if (made.code !== 0)
    throw new Error(`Could not create the requested worktree: ${made.stderr.trim()}`)
  await directories(cwd)
  if (locked) await unlockWorktree(ctx, checkout, cwd, branch, keys)
  const actual = await gitIdentity(ctx, cwd)
  if (actual.commonDir !== source.commonDir || actual.cwd !== cwd || actual.branch !== branch)
    throw new Error("The new worktree does not match the requested Git identity")
  try {
    await ctx.fs.mkdir(dirname(receiptPath), { mode: 0o700 })
    await directories(dirname(receiptPath))
    await ctx.fs.atomicWrite(receiptPath, encoded)
  } catch (cause) {
    throw new Error(
      `The worktree was created at ${cwd} on ${branch}, but its ownership receipt could not be confirmed. The worktree was kept. ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  return { cwd, branch }
}

/** Every native agent uses the same explicit Git worktree creation, without an agent-specific flag. */
async function worktree(spec: WorktreeSpec): Promise<{ cwd: string; branch: string }> {
  const target = await resolveWorktreeTarget(spec)
  const receipt = (await entry(target.receiptPath))
    ? (JSON.parse(
        (await regularBytes(target.receiptPath, RECEIPT_BYTES)).toString("utf8"),
      ) as Record<string, unknown>)
    : null
  const exists = await entry(target.cwd)
  if (exists) {
    if (!exists.isDirectory() || exists.isSymbolicLink())
      throw new Error("The requested worktree path is already held by another checkout")
    return verifyExistingWorktree(spec.ctx, target, receipt)
  }
  if (receipt) throw new Error("The recorded worktree is missing or these start choices changed")
  if (!spec.create) throw new Error("This run has no verified kept worktree")
  return createWorktreeWithReceipt(spec.ctx, spec.checkout, target)
}

/** Copy the keys into the worktree's git directory, then check it out; a failure removes what was made. */
async function unlockWorktree(
  ctx: Ctx,
  checkout: string,
  cwd: string,
  branch: string,
  keys: string,
): Promise<void> {
  let problem: string | null = null
  try {
    const gitDir = await ctx.git.run(cwd, ["rev-parse", "--absolute-git-dir"])
    if (gitDir.code !== 0) problem = gitDir.stderr.trim()
    else {
      await cp(keys, join(gitDir.stdout.trim(), "git-crypt", "keys"), { recursive: true })
      const out = await ctx.git.run(cwd, ["checkout", "--force", "HEAD"])
      if (out.code !== 0) problem = out.stderr.trim()
    }
  } catch (cause) {
    problem = cause instanceof Error ? cause.message : String(cause)
  }
  if (problem === null) return
  await ctx.git.run(checkout, ["worktree", "remove", "--force", "--", cwd])
  await ctx.git.run(checkout, ["branch", "-D", "--", branch])
  throw new Error(
    `Could not unlock the new worktree with the repository's git-crypt keys: ${problem}`,
  )
}

export function nativeWorktree(
  ctx: Ctx,
  checkout: string,
  run: string,
  request: string,
  choices: WorktreeChoices = {},
) {
  return worktree({ ctx, checkout, run, request, choices, create: true })
}

/** Receipt/Git identity validation only: this path never creates a branch, folder or receipt. */
export function validateNativeWorktree(
  ctx: Ctx,
  checkout: string,
  run: string,
  branch: string,
  cwd: string,
) {
  return worktree({
    ctx,
    checkout,
    run,
    request: "",
    choices: { branch, worktreePath: cwd },
    create: false,
  })
}
