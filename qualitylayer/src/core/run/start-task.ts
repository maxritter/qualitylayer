import type { Ctx } from "../../ctx.ts"
import { type RepoRef, resolveRepo } from "../paths.ts"
import { adoptExistingPlan, PASTED_PLAN_FILE } from "../task/adoption.ts"
import { startTask } from "../task/startup.ts"
import { loadTask, type Task } from "../task/store.ts"
import type { RunRecord } from "./contracts.ts"
import { refreshRunLeases } from "./lease.ts"

const nativeIdentity = new Set([
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDECODE",
  "CODEX_THREAD_ID",
  "CODEX_SESSION_ID",
  "PI_SESSION_ID",
  "OPENCODE_SESSION_ID",
  "QUALITYLAYER_TASK",
])

function startupContext(ctx: Ctx, run: RunRecord, cwd: string): Ctx {
  return {
    ...ctx,
    env: {
      cwd: () => cwd,
      get: (name) => {
        if (name === "QUALITYLAYER_SESSION") return `app-run:${run.id}`
        if (name === "QUALITYLAYER_AGENT") return run.agent
        return nativeIdentity.has(name) ? undefined : ctx.env.get(name)
      },
    },
  }
}

async function loadExistingPlanningTask(
  startup: Ctx,
  repo: RepoRef,
  run: RunRecord,
): Promise<Task> {
  const slug = (run.task ?? "").split("~").at(-1) ?? ""
  const found = await loadTask(startup, repo, slug)
  if (!found || run.task !== `${repo.id}~${found.slug}` || found.runtimeDir !== run.taskRuntimeDir)
    throw new Error("This run's allocated task does not belong to its recorded checkout")
  return found
}

async function createPlanningTask(
  startup: Ctx,
  repo: RepoRef,
  run: RunRecord & { purpose: Extract<RunRecord["purpose"], { kind: "new-task" }> },
): Promise<Task> {
  const fromPlan = run.purpose.fromPlan
  const original =
    fromPlan === undefined ? undefined : run.launchFiles?.find((file) => file.name === fromPlan)
  if (fromPlan !== undefined && original === undefined)
    throw new Error("The plan this task starts from is not among the launch's files")
  // A task from the person's own plan is adopted (its original kept as given, the Plan next);
  // any other new task starts at Discuss through the same startup journal.
  const created =
    original !== undefined
      ? await adoptExistingPlan(
          startup,
          repo,
          original.name === PASTED_PLAN_FILE
            ? {
                kind: "pasted",
                bytes: startup.fs.readBytes
                  ? await startup.fs.readBytes(original.path)
                  : new TextEncoder().encode(await startup.fs.readFile(original.path)),
              }
            : { kind: "file", path: original.path },
          {
            title: run.purpose.title,
            type: run.purpose.type === "bugfix" ? "bugfix" : "feature",
            answers: run.settings?.answers,
          },
        )
      : await startTask(startup, repo, run.purpose.request, {
          title: run.purpose.title,
          type: run.purpose.type,
          answers: run.settings?.answers,
        })
  if (!created.ok) throw new Error(created.error.message)
  return created.data.task
}

/** The server reserves through the same retry journal as CLI intake, owned by this run. */
export async function allocatePlanningTask(ctx: Ctx, run: RunRecord, cwd: string): Promise<Task> {
  if (run.purpose.kind !== "new-task") throw new Error("Only a new planning run allocates a task")
  const startup = startupContext(ctx, run, cwd)
  const repo = await resolveRepo(startup)
  if (!repo.ok) throw new Error(repo.error.message)
  if (run.task) return loadExistingPlanningTask(startup, repo.data, run)
  const task = await createPlanningTask(
    startup,
    repo.data,
    run as RunRecord & { purpose: Extract<RunRecord["purpose"], { kind: "new-task" }> },
  )
  await refreshRunLeases(ctx, run, {
    task: `${task.repoId}~${task.slug}`,
    taskRuntimeDir: task.runtimeDir,
  })
  return task
}
