// A temporary home with real git repositories registered as projects, for the lasting artifacts' tests:
// each repository has one commit, identity and hooks set locally (the developer's own git settings,
// signing and hooks never apply), and a way to make tasks, write artifact files and commit them.

import { appendFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { type RepoRef, resolveRepo } from "../../src/core/paths.ts"
import { createTask, type Task } from "../../src/core/task/store.ts"
import { type Ctx, realCtx } from "../../src/ctx.ts"
import { devKeyPair, injectTrial } from "./licence.ts"

export type World = {
  root: string
  home: string
  /** A context for the repository at `dir`; the same home for every one. */
  ctxAt(dir: string): Ctx
  /** Make a repository `name` under the root with one commit, and register it as a project. */
  repo(name: string): Promise<Repo>
  cleanup(): Promise<void>
}

export type Repo = {
  dir: string
  ctx: Ctx
  ref: RepoRef
  git(...args: string[]): Promise<string>
  /** Write files (paths from the repository's root), creating folders. */
  write(files: Record<string, string>): Promise<void>
  /** Stage everything and commit it. */
  commit(message: string): Promise<string>
  task(words: string): Promise<Task>
}

const roots: string[] = []
let workingCaptureTime = 0

/** Receipt tests use real Git with a logical clock. The native-hook E2E keeps the wall-clock cap. */
export function withWorkingCaptureClock(ctx: Ctx): Ctx {
  // Git's subprocess deadline uses wall time. Reserve fixture headroom once, then advance logical time.
  workingCaptureTime = Math.max(workingCaptureTime, Date.now() + 60_000)
  return { ...ctx, clock: { ...ctx.clock, now: () => ++workingCaptureTime } }
}

export function denyArtifactFixtureHttp(ctx: Ctx): void {
  ctx.http.fetch = async () => {
    throw new Error("Artifact fixture HTTP is disabled; use its local signed trial")
  }
}

export async function world(options: { offlineTrial?: boolean } = {}): Promise<World> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ql-lasting-")))
  roots.push(root)
  const home = join(root, "home", ".qualitylayer")
  const globals = globalThis as { QUALITYLAYER_DEV_PUBKEY?: string }
  const hadPublicKey = Object.hasOwn(globals, "QUALITYLAYER_DEV_PUBKEY")
  const previousPublicKey = globals.QUALITYLAYER_DEV_PUBKEY
  if (options.offlineTrial) {
    await injectTrial(join(root, "home"))
    globals.QUALITYLAYER_DEV_PUBKEY = (await devKeyPair()).publicKey
  }
  const env = (dir: string) => ({
    HOME: join(root, "home"),
    QUALITYLAYER_HOME: home,
    PATH: process.env.PATH ?? "",
    QUALITYLAYER_CHROME: "none",
    cwd: dir,
  })
  const ctxAt = (dir: string) => {
    const { cwd, ...vars } = env(dir)
    const ctx = realCtx({ cwd, env: vars })
    if (options.offlineTrial) denyArtifactFixtureHttp(ctx)
    return ctx
  }
  return {
    root,
    home,
    ctxAt,
    async repo(name) {
      const dir = join(root, name)
      await mkdir(dir, { recursive: true })
      const ctx = ctxAt(dir)
      const git = async (...args: string[]) => {
        const run = await ctx.git.run(dir, args)
        if (run.code !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr || run.stdout}`)
        return run.stdout
      }
      await git("init", "-q", "-b", "main")
      const hooks = join(root, `${name}-hooks`)
      await mkdir(hooks)
      await appendFile(
        join(dir, ".git", "config"),
        `\n[user]\n\temail = test@example.com\n\tname = Test\n[commit]\n\tgpgsign = false\n[core]\n\thooksPath = ${JSON.stringify(hooks)}\n`,
      )
      const write = async (files: Record<string, string>) => {
        for (const [path, text] of Object.entries(files)) {
          await mkdir(dirname(join(dir, path)), { recursive: true })
          await writeFile(join(dir, path), text)
        }
      }
      const commit = async (message: string) => {
        await git("add", "-A")
        await git("commit", "-q", "-m", message)
        return (await git("rev-parse", "HEAD")).trim()
      }
      await write({ "README.md": `# ${name}\n` })
      await commit("initial")
      const ref = await resolveRepo(ctx)
      if (!ref.ok) throw new Error("no repository")
      return {
        dir,
        ctx,
        ref: ref.data,
        git,
        write,
        commit,
        task: (words) => createTask(ctx, ref.data, words),
      }
    },
    async cleanup() {
      try {
        await rm(root, { recursive: true, force: true })
      } finally {
        if (options.offlineTrial) {
          if (hadPublicKey) globals.QUALITYLAYER_DEV_PUBKEY = previousPublicKey
          else delete globals.QUALITYLAYER_DEV_PUBKEY
        }
      }
    },
  }
}

/** A complete HTML page with a title and a description. */
export const page = (title: string, body = "", head = ""): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="About ${title}">${head}</head><body>${body || `<h1>${title}</h1>`}</body></html>\n`

/** A lasting artifact's `artifact.json`. */
export const config = (extra: Record<string, unknown> = {}): string =>
  `${JSON.stringify({ v: 1, title: "App Model", purpose: "Every screen.", ...extra }, null, 2)}\n`
