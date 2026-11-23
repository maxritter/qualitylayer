// The two programs QualityLayer's source-control features use: `git` and the GitHub CLI `gh`. What
// Settings › Git and editor shows of them: whether each is there, its version, and for `gh` who it is
// signed in as (without it, pull requests are not opened or followed). A read starts at most three
// short programs and is kept for five minutes; "Check again" reads afresh.

import type { Ctx } from "../ctx.ts"
import { run } from "./ship/pull-request.ts"

export type GitStatus = { available: boolean; version: string | null }
export type GhStatus = {
  available: boolean
  version: string | null
  signedIn: boolean
  /** The account `gh` is signed in as; null when it is not or `gh` does not say. */
  account: string | null
}
export type ToolsStatus = { checkedAt: number; git: GitStatus; gh: GhStatus }

/** A read is kept this long before the next page asks afresh. */
export const TOOLS_CACHE_MS = 5 * 60_000

const kept = new Map<string, ToolsStatus>()

const VERSION = /\b(\d+\.\d+(?:\.\d+)?)\b/

async function versionOf(ctx: Ctx, program: string): Promise<string | null | undefined> {
  const out = await run(ctx, ctx.env.cwd(), [program, "--version"]).catch(() => null)
  if (out === null || out.code !== 0) return undefined
  return VERSION.exec(out.stdout.split("\n")[0] ?? "")?.[1] ?? null
}

/** `gh auth status` says "Logged in to github.com account NAME" (older: "as NAME"), on either stream. */
export function accountOf(text: string): string | null {
  return /Logged in to \S+ (?:account|as) (\S+)/.exec(text)?.[1] ?? null
}

async function readGh(ctx: Ctx): Promise<GhStatus> {
  const version = await versionOf(ctx, "gh")
  if (version === undefined)
    return { available: false, version: null, signedIn: false, account: null }
  const auth = await run(ctx, ctx.env.cwd(), [
    "gh",
    "auth",
    "status",
    "--hostname",
    "github.com",
  ]).catch(() => null)
  const signedIn = auth !== null && auth.code === 0
  return {
    available: true,
    version,
    signedIn,
    account: signedIn ? accountOf(`${auth.stdout}\n${auth.stderr}`) : null,
  }
}

async function readGit(ctx: Ctx): Promise<GitStatus> {
  const version = await versionOf(ctx, "git")
  return { available: version !== undefined, version: version ?? null }
}

/** The reads running, one per home: callers that ask while one runs share its answer. */
const reading = new Map<string, Promise<ToolsStatus>>()

/**
 * Git and `gh` as they stand now; the last read of this home when it is under five minutes old,
 * unless `fresh`. Concurrent callers of one home share one read, however many pages ask.
 */
export async function readTools(ctx: Ctx, fresh = false): Promise<ToolsStatus> {
  const known = kept.get(ctx.home)
  if (!fresh && known !== undefined && ctx.clock.now() - known.checkedAt < TOOLS_CACHE_MS)
    return known
  const running = reading.get(ctx.home)
  if (running !== undefined) return running
  const read = (async () => {
    const [git, gh] = await Promise.all([readGit(ctx), readGh(ctx)])
    const status = { checkedAt: ctx.clock.now(), git, gh }
    kept.set(ctx.home, status)
    return status
  })().finally(() => reading.delete(ctx.home))
  reading.set(ctx.home, read)
  return read
}
