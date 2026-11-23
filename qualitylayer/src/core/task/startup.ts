// One startup journal per real session. It reserves a task before writing its Plan file, so an
// exact retry of the same request continues that task instead of starting a second one.
import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { detectAgent } from "../agents/detect.ts"
import { readConfig } from "../config.ts"
import type { Answers } from "../config-values.ts"
import { projectRuntimeDir, type RepoRef } from "../paths.ts"
import { placeFor } from "./answers.ts"
import { sessionKey } from "./binding.ts"
import { askPlace } from "./question-app.ts"
import {
  createTask,
  loadTask,
  readmeFrontmatter,
  reserveTaskSlug,
  type Task,
  type TaskType,
  taskTitle,
  touchSession,
} from "./store.ts"

type Startup = {
  owner: string
  repoId: string
  root: string
  slug: string
  words: string
  title: string
  type: TaskType
  answers?: Answers
  complete: boolean
}
const validSlug = (slug: unknown): slug is string =>
  typeof slug === "string" && /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
const bad = (message: string) => err({ code: "bad_args", message })

const TASK_TYPES = new Set<string>(["feature", "bugfix", "chat"])
const ANSWER_PLACES = new Set<string>(["app", "terminal"])

function validRecord(value: Startup, key: string, repo: RepoRef): boolean {
  if (!value || value.owner !== key || value.repoId !== repo.id || value.root !== repo.root)
    return false
  if (!validSlug(value.slug) || typeof value.words !== "string" || typeof value.title !== "string")
    return false
  if (!TASK_TYPES.has(value.type) || typeof value.complete !== "boolean") return false
  return value.answers === undefined || ANSWER_PLACES.has(value.answers)
}

async function startScriptTask(
  ctx: Ctx,
  repo: RepoRef,
  params: { request: string; title: string; type: TaskType; answers?: Answers },
): Promise<Result<{ task: Task; created: boolean }>> {
  // Whatever session the script runs in neither owns the task nor is asked about it, and an
  // identical call is a second task. No session is attached to answer in a terminal, so the task
  // asks in the App, on a server with no screen too, unless the person chose a place themselves.
  const config = await readConfig(ctx)
  const place =
    params.answers !== undefined || config.answerPlaceChosen
      ? placeFor(config, ctx.env, params.answers, undefined, "unknown")
      : { answers: "app" as const, approvals: "app" as const }
  const task = await createTask(ctx, repo, params.request, {
    title: params.title,
    type: params.type,
    answers: place.answers,
    approvals: place.approvals,
  })
  return ok({ task, created: true })
}

async function readStartupJournal(
  ctx: Ctx,
  journal: string,
  key: string,
  repo: RepoRef,
): Promise<Result<Startup | null>> {
  if (!(await ctx.fs.exists(journal))) return ok(null)
  let previous: Startup
  try {
    previous = JSON.parse(await ctx.fs.readFile(journal)) as Startup
  } catch {
    return bad("startup journal is unreadable; no task was overwritten")
  }
  return validRecord(previous, key, repo)
    ? ok(previous)
    : bad("startup journal has an invalid task or owner; no task was overwritten")
}

async function shouldRetryStartup(
  ctx: Ctx,
  repo: RepoRef,
  params: {
    project: string
    key: string
    previous: Startup | null
    request: string
    type: TaskType
  },
): Promise<boolean> {
  const { previous, request, type, project, key } = params
  if (!previous || previous.words !== request || previous.type !== type) return false
  if (!previous.complete) return true
  const candidate = await loadTask(ctx, repo, previous.slug)
  if (candidate?.type !== type) return false
  if (candidate.stage !== "plan" && candidate.stage !== "chat") return false
  const binding = await ctx.fs
    .readFile(join(project, "sessions", `${key}.json`))
    .then((text) => JSON.parse(text) as { slug?: string })
    .catch(() => null)
  return binding?.slug === previous.slug
}

async function startLockedSessionTask(
  ctx: Ctx,
  repo: RepoRef,
  params: {
    key: string
    project: string
    journal: string
    request: string
    title: string
    type: TaskType
    answers?: Answers
    origin: { origin?: "existing-plan" }
    finish: (task: Task, created: boolean) => Promise<Result<{ task: Task; created: boolean }>>
  },
): Promise<Result<{ task: Task; created: boolean }>> {
  const loaded = await readStartupJournal(ctx, params.journal, params.key, repo)
  if (!loaded.ok) return loaded
  const previous = loaded.data
  const retry = await shouldRetryStartup(ctx, repo, {
    project: params.project,
    key: params.key,
    previous,
    request: params.request,
    type: params.type,
  })
  const record: Startup =
    retry && previous
      ? previous
      : {
          owner: params.key,
          repoId: repo.id,
          root: repo.root,
          slug: await reserveTaskSlug(ctx, repo, params.title),
          words: params.request,
          title: params.title,
          type: params.type,
          answers: params.answers,
          complete: false,
        }
  await ctx.fs.mkdir(join(params.project, "sessions"))
  await ctx.fs.atomicWrite(params.journal, `${JSON.stringify(record, null, 2)}\n`)
  const existed = await loadTask(ctx, repo, record.slug)
  const task = await createTask(ctx, repo, record.words, {
    title: record.title,
    type: record.type,
    answers: record.answers,
    reservation: { slug: record.slug, owner: params.key },
    ...params.origin,
  })
  const fm = await readmeFrontmatter(ctx, task)
  if (fm.startup_owner !== params.key)
    return err({ code: "not_owner", message: "reserved task belongs to another session" })
  await touchSession(ctx, task, detectAgent(ctx.env))
  record.complete = true
  await ctx.fs.atomicWrite(params.journal, `${JSON.stringify(record, null, 2)}\n`)
  return params.finish(task, existed === null)
}

/** New requests and exact startup retries share canonical creation. No session: no retry claim. */
export async function startTask(
  ctx: Ctx,
  repo: RepoRef,
  words: string,
  options: {
    title?: string
    type?: TaskType
    answers?: Answers
    origin?: "existing-plan"
    /** A start by script (`task start`): no agent session takes the task, so it waits on Home. */
    script?: true
  } = {},
): Promise<Result<{ task: Task; created: boolean }>> {
  const key = sessionKey(ctx.env)
  const type = options.type ?? "feature"
  const request = words.trim()
  const title = taskTitle(request, options.title)
  const origin = options.origin ? { origin: options.origin } : {}
  if (options.script)
    return startScriptTask(ctx, repo, { request, title, type, answers: options.answers })
  // With nothing chosen, a workflow task started in an agent first asks where to answer from now on.
  const ask = type !== "chat" && placeFor(await readConfig(ctx), ctx.env, options.answers).ask
  const finish = async (task: Task, created: boolean) => {
    if (ask && created) await askPlace(ctx, task, detectAgent(ctx.env))
    return ok({ task, created })
  }
  if (!key) {
    const task = await createTask(ctx, repo, request, {
      title,
      type,
      answers: options.answers,
      ...origin,
    })
    await touchSession(ctx, task, detectAgent(ctx.env))
    return finish(task, true)
  }
  const project = projectRuntimeDir(ctx, repo.id)
  const journal = join(project, "sessions", `${key}.startup.json`)
  try {
    return await ctx.fs.withLock(join(project, "startup.lock"), () =>
      startLockedSessionTask(ctx, repo, {
        key,
        project,
        journal,
        request,
        title,
        type,
        answers: options.answers,
        origin,
        finish,
      }),
    )
  } catch (cause) {
    return bad(cause instanceof Error ? cause.message : String(cause))
  }
}
