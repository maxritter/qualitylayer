// Path derivation: repo id from the git common dir, task folders in the
// repository, runtime folders under ~/.qualitylayer. Keying by the common dir
// means every worktree of a repository shares one runtime state.

import { createHash } from "node:crypto"
import { basename, dirname, join } from "node:path"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import { sessionKey } from "./task/binding.ts"

export type RepoRef = {
  /** Working tree top level of the current checkout. */
  root: string
  /** Stable id shared by all worktrees of this repository. */
  id: string
  commonDir: string
}

export function repoIdFrom(commonDir: string): string {
  const hash = createHash("sha256").update(commonDir).digest("hex").slice(0, 12)
  const name = basename(commonDir) === ".git" ? basename(dirname(commonDir)) : basename(commonDir)
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "repo"
  return `${slug}-${hash}`
}

export async function resolveRepo(ctx: Ctx): Promise<Result<RepoRef>> {
  const cwd = ctx.env.cwd()
  const [root, commonDir] = await Promise.all([ctx.git.topLevel(cwd), ctx.git.commonDir(cwd)])
  if (root === null || commonDir === null) {
    return err({
      code: "not_a_repo",
      message: `${cwd} is not inside a git repository. Run this command from the Git checkout you are working on.`,
    })
  }
  return ok({ root, id: repoIdFrom(commonDir), commonDir })
}

async function latestBoundProjectId(
  ctx: Ctx,
  projects: string,
  key: string,
): Promise<string | null> {
  if (!(await ctx.fs.exists(projects))) return null
  let best: { id: string; at: number } | null = null
  for (const id of await ctx.fs.readdir(projects)) {
    try {
      const binding = JSON.parse(
        await ctx.fs.readFile(join(projects, id, "sessions", `${key}.json`)),
      ) as { at?: unknown }
      const at = typeof binding.at === "number" ? binding.at : 0
      if (best === null || at > best.at) best = { id, at }
    } catch {
      /* this project has no binding for the session */
    }
  }
  return best?.id ?? null
}

async function readExistingProjectRef(
  ctx: Ctx,
  projects: string,
  id: string,
): Promise<RepoRef | null> {
  try {
    const project = JSON.parse(await ctx.fs.readFile(join(projects, id, "project.json"))) as {
      commonDir?: unknown
      paths?: unknown
    }
    if (typeof project.commonDir !== "string" || !Array.isArray(project.paths)) return null
    for (const root of project.paths) {
      if (typeof root === "string" && (await ctx.fs.exists(root))) {
        return { root, id, commonDir: project.commonDir }
      }
    }
  } catch {
    /* an unreadable project note falls through */
  }
  return null
}

/**
 * The repository a command is about: the checkout it runs in or, run from outside any repository
 * (a scratch folder), the repository of the task this session is bound to.
 */
export async function resolveBoundRepo(ctx: Ctx): Promise<Result<RepoRef>> {
  const here = await resolveRepo(ctx)
  if (here.ok) return here
  const key = sessionKey(ctx.env)
  if (key === null) return here
  const projects = join(ctx.home, "projects")
  const bestId = await latestBoundProjectId(ctx, projects, key)
  if (bestId === null) return here
  const bound = await readExistingProjectRef(ctx, projects, bestId)
  return bound === null ? here : ok(bound)
}

export function plansDir(repoRoot: string): string {
  return join(repoRoot, "docs", "plans")
}

export function taskDir(repoRoot: string, slug: string): string {
  return join(plansDir(repoRoot), slug)
}

export function projectRuntimeDir(ctx: Ctx, repoId: string): string {
  return join(ctx.home, "projects", repoId)
}

export function taskRuntimeDir(ctx: Ctx, repoId: string, slug: string): string {
  return join(projectRuntimeDir(ctx, repoId), "tasks", slug)
}

/** The automations of this computer: one owner-only file (it holds the signing secrets). */
export function automationsFile(ctx: Ctx): string {
  return join(ctx.home, "automations.json")
}

/** The queue and the delivery log of the automations. */
export function automationsDir(ctx: Ctx): string {
  return join(ctx.home, "automations")
}
