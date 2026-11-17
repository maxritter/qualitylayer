// Which task each agent session works on, so sessions can run side by side in
// one checkout or across worktrees. The agent's own session id is the key
// (Claude Code and Codex hand it to every command they run, and Claude Code's
// status line payload carries the same id); an agent without one falls back to
// its terminal pane. The binding is a note under the project's runtime folder,
// not task state: a session that has none falls back to the branch.

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Ctx, Env } from "../../ctx.ts"
import { detectAgent, sessionIdentity } from "../agents/detect.ts"
import { closeWorkingRecords } from "../git/working-records.ts"
import {
  assignBinding,
  bindingIndexPath,
  bindingTargetOf,
  readBindingJson,
  retireBindingIndex,
  workflowBindingOf,
  workflowBindingPath,
} from "./binding-index.ts"

/** Older Codex and manually supplied session ids, after the current native identity. */
const NATIVE = ["CODEX_SESSION_ID", "QUALITYLAYER_SESSION"]
/** Any other agent: the terminal pane it runs in stands in for the session. */
const PANES = [
  "TMUX_PANE",
  "WEZTERM_PANE",
  "KITTY_WINDOW_ID",
  "ITERM_SESSION_ID",
  "TERM_SESSION_ID",
  "WT_SESSION",
]
/** A binding nobody refreshed for this long no longer holds its task against other sessions. */
export const CLAIM_MS = 12 * 60 * 60_000

/** Calls that explicitly take responsibility for the workflow step. Passive tooling is excluded. */
export const WORKFLOW_OWNER_COMMANDS = new Set([
  "next",
  "gate",
  "question",
  "need",
  "plan",
  "review",
  "comments",
])

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16)

/** The key of a session id as the agent reports it; the same whether it came from env or a payload. */
export function keyOf(sessionId: string): string {
  return hash(sessionId)
}

/** This process's session, or null when neither the agent nor the terminal names one. */
export function sessionKey(env: Pick<Env, "get">): string | null {
  const native = sessionIdentity(env)
  if (native) return keyOf(native.id)
  for (const name of detectAgent(env) === "unknown" ? NATIVE : ["QUALITYLAYER_SESSION"]) {
    const value = env.get(name)?.trim()
    if (value) return keyOf(value)
  }
  for (const name of PANES) {
    const value = env.get(name)?.trim()
    if (value) return keyOf(`${name}:${value}`)
  }
  return null
}

type Binding = { slug: string; at: number; source?: "workflow" }

function sessionsDir(ctx: Pick<Ctx, "home">, repoId: string): string {
  return join(ctx.home, "projects", repoId, "sessions")
}

/** Record that this session works on `slug`. A no-op without a session key. */
export async function bindSession(ctx: Ctx, task: { repoId: string; slug: string }): Promise<void> {
  const key = sessionKey(ctx.env)
  if (key === null) return
  await assignBinding(ctx, key, task)
}

/**
 * A session whose agent hides its id from the commands it runs (Copilot names it only in its hook
 * payloads) is bound under its terminal pane. Its hooks, run in that same pane, give it its own id
 * too, so the hook payload's session finds the task. Never replaces a binding the id already has.
 */
export async function adoptPaneBinding(ctx: Ctx, repoId: string, sessionId: string): Promise<void> {
  const own = keyOf(sessionId)
  const pane = sessionKey(ctx.env)
  if (pane === null || pane === own) return
  const existing = workflowBindingOf(
    await readBindingJson(ctx, workflowBindingPath(ctx, { repoId }, own)),
  )
  if (existing) return
  const indexed = bindingTargetOf(await readBindingJson(ctx, bindingIndexPath(ctx, own)))
  if (indexed) {
    const binding = workflowBindingOf(
      await readBindingJson(ctx, workflowBindingPath(ctx, indexed, own)),
    )
    if (binding?.slug === indexed.slug && binding.at === indexed.at) return
  }
  const paneBinding = workflowBindingOf(
    await readBindingJson(ctx, workflowBindingPath(ctx, { repoId }, pane)),
  )
  if (paneBinding === null) return
  const slug = paneBinding.slug
  await assignBinding(ctx, own, { repoId, slug })
}

/** A task that leaves active work releases every session, without disturbing other tasks. */
export async function clearTaskBindings(
  ctx: Ctx,
  task: { repoId: string; slug: string },
): Promise<void> {
  await closeWorkingRecords(ctx, task).catch(() => {})
  const dir = sessionsDir(ctx, task.repoId)
  if (!(await ctx.fs.exists(dir))) return
  for (const name of await ctx.fs.readdir(dir)) {
    // Startup journals also carry a slug. They are durable history, not
    // session bindings to release.
    if (!/^[a-f0-9]{16}\.json$/.test(name)) continue
    const path = join(dir, name)
    let slug: unknown
    try {
      slug = JSON.parse(await ctx.fs.readFile(path)).slug
    } catch {
      // A torn note does not identify this task.
      continue
    }
    if (slug === task.slug) {
      await ctx.fs.remove(path)
      await retireBindingIndex(ctx, name.slice(0, -5), task)
    }
  }
}

/** The task a session is bound to, read synchronously for the status line. */
export function boundSlug(ctx: Pick<Ctx, "home">, repoId: string, key: string): string | null {
  try {
    const binding = JSON.parse(
      readFileSync(join(sessionsDir(ctx, repoId), `${key}.json`), "utf8"),
    ) as Binding
    if (typeof binding.slug !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(binding.slug))
      return null
    return binding.source === "workflow" ? binding.slug : null
  } catch {
    return null
  }
}

/** Tasks another session worked on recently: a fresh session leaves them to it. */
export async function claimedByOthers(
  ctx: Ctx,
  repoId: string,
  key: string | null,
): Promise<Set<string>> {
  const dir = sessionsDir(ctx, repoId)
  const claimed = new Set<string>()
  if (!(await ctx.fs.exists(dir))) return claimed
  const now = ctx.clock.now()
  for (const name of await ctx.fs.readdir(dir)) {
    if (!name.endsWith(".json") || name === `${key}.json`) continue
    try {
      const binding = JSON.parse(await ctx.fs.readFile(join(dir, name))) as Binding
      if (binding.source === "workflow" && now - binding.at < CLAIM_MS) claimed.add(binding.slug)
    } catch {
      // a torn note is no claim
    }
  }
  return claimed
}
