// New chat's "Or resume a session": `GET /api/agent-history/sessions?path=<folder>` lists the sessions an
// agent already has in a project folder (read from the agents' own records, never written), and
// `POST /api/agent-history/resume` makes one of them a Chat task the App then resumes through the run
// start's `resumeNative`. Sessions that already are a QualityLayer task are left out. Like the folder
// routes it names folders and prompts on this computer, so it needs the App or a browser it opened.

import { existsSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import {
  findFolderSession,
  type HistorySession,
  listFolderSessions,
} from "../core/agents/history-sessions.ts"
import { type RepoRef, resolveRepo } from "../core/paths.ts"
import { listRuns } from "../core/run/registry.ts"
import { boundSlug, keyOf } from "../core/task/binding.ts"
import { startTask } from "../core/task/startup.ts"
import type { Ctx } from "../ctx.ts"
import { type GuardConfig, hasKeyHeader, sessionAuthority } from "./guard.ts"

const SESSIONS_PATH = "/api/agent-history/sessions"
const RESUME_PATH = "/api/agent-history/resume"

const reply = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } })
const refuse = (message: string, status: number) =>
  reply({ ok: false, error: { code: "agent_history", message } }, status)

/** The checkout's repository, resolved as if the command ran in `folder`; null for no repository. */
async function repoOf(ctx: Ctx, folder: string): Promise<RepoRef | null> {
  const repo = await resolveRepo({ ...ctx, env: { ...ctx.env, cwd: () => folder } })
  return repo.ok ? repo.data : null
}

/** The task a session already belongs to: a run of ours resumed it, or a QualityLayer command bound it. */
function taskOf(
  ctx: Ctx,
  repo: RepoRef | null,
  agent: string,
  id: string,
): { task: string; cwd?: string } | null {
  const run = listRuns(ctx.home).find(
    (one) => one.nativeSession === id && one.agent === agent && one.task !== undefined,
  )
  if (run?.task) return { task: run.task, cwd: run.cwd }
  const slug = repo ? boundSlug(ctx, repo.id, keyOf(id)) : null
  return repo && slug ? { task: `${repo.id}~${slug}` } : null
}

function isRepoSession(ctx: Ctx, repo: RepoRef | null, key: string): boolean {
  if (repo === null) return false
  if (boundSlug(ctx, repo.id, key) !== null) return true
  return existsSync(join(ctx.home, "projects", repo.id, "sessions", `${key}.startup.json`))
}

/**
 * Whether a session is QualityLayer's own work, so it is no outside session to resume: a run of ours
 * has it, a QualityLayer command bound it to a task (the binding goes when the task finishes), a
 * startup journal of the project names it, or the cost record noted it for a task.
 */
function ownSession(ctx: Ctx, repo: RepoRef | null): (id: string, agent: string) => boolean {
  const runs = new Set(
    listRuns(ctx.home).flatMap((run) => (run.nativeSession ? [run.nativeSession] : [])),
  )
  return (id, agent) => {
    if (runs.has(id)) return true
    const key = keyOf(id)
    if (isRepoSession(ctx, repo, key)) return true
    return existsSync(join(ctx.home, "cost-sessions", `${agent}-${key}.ndjson`))
  }
}

const STRIPPED_ENV =
  /^(CLAUDE_CODE_SESSION_ID|CLAUDECODE|CODEX_THREAD_ID|CODEX_SESSION_ID|PI_SESSION_ID|OPENCODE_SESSION_ID|QUALITYLAYER_TASK)$/

function historyStartupCtx(ctx: Ctx, agent: string, id: string, cwd: string): Ctx {
  return {
    ...ctx,
    env: {
      cwd: () => cwd,
      get: (name) => {
        if (name === "QUALITYLAYER_SESSION") return `history:${agent}:${id}`
        if (name === "QUALITYLAYER_AGENT") return agent
        return STRIPPED_ENV.test(name) ? undefined : ctx.env.get(name)
      },
    },
  }
}

async function handleListSessions(ctx: Ctx, url: URL): Promise<Response> {
  const path = url.searchParams.get("path") ?? ""
  if (!isAbsolute(path) || path.includes("\0")) return refuse("Name the project's folder.", 400)
  const repo = await repoOf(ctx, path)
  const found = await listFolderSessions(ctx, path, { exclude: ownSession(ctx, repo) })
  return reply({ ok: true, ...found })
}

type ResumeInput = { path: string; agent: "claude-code" | "codex"; id: string }

async function parseResumeInput(request: Request): Promise<ResumeInput | Response> {
  let body: { path?: unknown; agent?: unknown; id?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return refuse("Send the session as JSON.", 400)
  }
  const { path, agent, id } = body
  const validTypes =
    typeof path === "string" &&
    isAbsolute(path) &&
    typeof agent === "string" &&
    typeof id === "string"
  if (!validTypes) return refuse("Name the folder, the agent and the session.", 400)
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || (agent !== "claude-code" && agent !== "codex"))
    return refuse("That session cannot be resumed here.", 400)
  return { path, agent, id }
}

async function handleResumeSession(ctx: Ctx, request: Request): Promise<Response> {
  const parsed = await parseResumeInput(request)
  if (parsed instanceof Response) return parsed
  const { path, agent, id } = parsed
  const repo = await repoOf(ctx, path)
  // Read again from the agent's record: nothing a client sends names the folder or the title.
  // A session that already is a task opens that task; any other QualityLayer session is not offered.
  const existing = taskOf(ctx, repo, agent, id)
  if (existing !== null) {
    return reply({
      ok: true,
      task: existing.task,
      created: false,
      agent,
      id,
      cwd: existing.cwd ?? path,
    })
  }
  const session: HistorySession | null = await findFolderSession(ctx, path, agent, id, {
    exclude: ownSession(ctx, repo),
  })
  if (session === null || repo === null)
    return refuse("That session is not in this folder's history.", 404)
  // One startup journal per session: a repeated start finds the task it made.
  const started = await startTask(
    historyStartupCtx(ctx, agent, id, session.cwd),
    repo,
    session.title,
    {
      type: "chat",
      answers: "app",
    },
  )
  if (!started.ok) return refuse(started.error.message, 400)
  const { task } = started.data
  return reply({
    ok: true,
    task: `${task.repoId}~${task.slug}`,
    created: started.data.created,
    agent,
    id,
    cwd: session.cwd,
  })
}

/** The answer to the history routes, or null for any other request. */
export async function agentHistoryRoute(
  ctx: Ctx,
  guard: GuardConfig,
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== SESSIONS_PATH && url.pathname !== RESUME_PATH) return null
  const list = url.pathname === SESSIONS_PATH
  if (request.method !== (list ? "GET" : "POST"))
    return new Response(`Use ${list ? "GET" : "POST"} for this route.`, { status: 405 })
  if (!hasKeyHeader(request, guard) && sessionAuthority(request, guard)?.keyPaired !== true)
    return new Response("Agent history requires the App or a browser it opened.", { status: 403 })
  return list ? handleListSessions(ctx, url) : handleResumeSession(ctx, request)
}
