// comments resolve <id…|all> · comments list · comments take · task start "<request>" ·
// task handback "<reason>" · task abandon · task set type=… ui=… title=… · task override +security …

import { folderDoc } from "../../core/docs/names.ts"
import { taskAbandon, taskHandback } from "../../core/next.ts"
import { resolveBoundRepo } from "../../core/paths.ts"
import { applyOverrides } from "../../core/scaling.ts"
import {
  appendEvent,
  isTerminal,
  listTasks,
  patchReadme,
  readmePath,
  taskTitle,
} from "../../core/task/store.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { putArchived } from "../../server/api.ts"
import { parseArgs, requireTask } from "./shared.ts"
import { commentsCmd } from "./task-comments.ts"
import { startTaskCmd } from "./task-start.ts"

export { commentsCmd }

const TASK_USAGE =
  'usage: qualitylayer task start "<request>" [--type feature|bug|chat] [--title <words>] [--from <ticket link> | --from-plan <file|->] [--plan [--agent <id>]] · task handback "<reason>" --prompt "<prompt>" · task abandon · task set answers=app|terminal approvals=app|terminal type=feature|bugfix ui=true|false profile=small|full title=<short name> · task override <+name|-name>… · task archive|restore <task>'

/** `task handback "<reason>" --prompt "<prompt>"`: close the Plan task and keep the plain prompt. */
async function handbackCmd(ctx: Ctx, words: string[]): Promise<Result<unknown>> {
  const { positional, flags } = parseArgs(words, ["prompt", "title"])
  if (flags.prompt === true || flags.title === true)
    return err({
      code: "bad_args",
      message: 'usage: qualitylayer task handback "<reason>" --prompt "<prompt>"',
    })
  return taskHandback(ctx, positional.join(" ").trim(), {
    ...(typeof flags.prompt === "string" ? { prompt: flags.prompt } : {}),
    ...(typeof flags.title === "string" ? { title: flags.title } : {}),
  })
}

async function lifecycleCmd(ctx: Ctx, action: "archive" | "restore", names: string[]) {
  if (names.length !== 1 || !names[0]?.trim())
    return err({ code: "bad_args", message: `usage: qualitylayer task ${action} <task>` })
  const repo = await resolveBoundRepo(ctx)
  if (!repo.ok) return repo
  const task = (await listTasks(ctx, repo.data)).find(
    (task) => task.slug === names[0] || `${task.repoId}~${task.slug}` === names[0],
  )
  if (!task)
    return err({ code: "no_task", message: `No task named ${names[0]} in this repository.` })
  const archived = action === "archive"
  const result = await putArchived(ctx, `${task.repoId}~${task.slug}`, { archived })
  if (!result.ok) return result
  return ok({
    task: task.slug,
    stage: task.stage,
    archived,
    message: archived
      ? "Task archived. Its stage, documents, approvals and evidence are kept. Restore it before continuing."
      : "Task restored. No agent was started.",
    then: archived
      ? `qualitylayer task restore ${task.slug}`
      : `qualitylayer status --json --task ${task.slug}`,
  })
}

/** `task override +security -second-opinion`: the user's words, recorded as switches of the scaling rules. */
async function overrideCmd(ctx: Ctx, words: string[]): Promise<Result<unknown>> {
  const task = await requireTask(ctx)
  if (!task.ok) return task
  if (isTerminal(task.data.stage)) {
    return err({ code: "bad_args", message: `${task.data.slug} is ${task.data.stage}` })
  }
  const applied = applyOverrides(task.data.overrides, words)
  if (!applied.ok) return applied
  await patchReadme(ctx, task.data, { overrides: applied.data })
  await appendEvent(ctx, task.data, { event: "task_overridden", overrides: applied.data })
  return ok({ task: task.data.slug, overrides: applied.data })
}

const ENUM_SETTERS: Record<string, readonly string[]> = {
  type: ["feature", "bugfix"],
  profile: ["small", "full"],
  answers: ["app", "terminal"],
  approvals: ["app", "terminal"],
}

function parseSetPairs(pairs: string[]): Result<Record<string, string | boolean>> {
  const patch: Record<string, string | boolean> = {}
  for (const pair of pairs) {
    const split = pair.indexOf("=")
    const key = split === -1 ? pair : pair.slice(0, split)
    const value = split === -1 ? "" : pair.slice(split + 1)
    if (ENUM_SETTERS[key]?.includes(value)) patch[key] = value
    else if (key === "ui" && (value === "true" || value === "false")) patch.ui = value === "true"
    else if (key === "title" && value.trim() !== "") patch.title = taskTitle("", value)
    else
      return err({
        code: "bad_args",
        message: `cannot set "${pair}"; use answers=app|terminal, approvals=app|terminal, type=feature|bugfix, ui=true|false, profile=small|full or title=<short name>`,
      })
  }
  return ok(patch)
}

async function setTaskCmd(ctx: Ctx, pairs: string[]): Promise<Result<unknown>> {
  const task = await requireTask(ctx)
  if (!task.ok) return task
  // A task is classified while it is planned; once the Plan is approved, its kind is part of what
  // the user approved.
  const stage = task.data.stage
  if (task.data.type === "chat" && pairs.some((pair) => !/^(answers|approvals|title)=/.test(pair)))
    return err({ code: "bad_args", message: "this is a Chat; Convert to task first" })
  if (
    stage !== "chat" &&
    stage !== "plan" &&
    pairs.some((pair) => !/^(answers|approvals)=/.test(pair))
  ) {
    return err({
      code: "bad_args",
      message:
        "the task's type, ui flag, profile and title are set in the Plan, before it is approved",
    })
  }
  const parsed = parseSetPairs(pairs)
  if (!parsed.ok) return parsed
  const patch = parsed.data
  await patchReadme(ctx, task.data, patch, "task_set")
  // The document's heading is the title the App shows above it.
  if (typeof patch.title === "string") {
    const path = readmePath(task.data)
    const text = await ctx.fs.readFile(path)
    await ctx.fs.writeFile(path, text.replace(/^# .*$/m, `# ${patch.title}`))
  }
  await appendEvent(ctx, task.data, { event: "task_classified", ...patch })
  // The document was rewritten under the agent that read it; its next whole-file Write would fail.
  return ok({
    task: task.data.slug,
    ...patch,
    document: readmePath(task.data),
    note: `${folderDoc("plan")} was rewritten: read it again before you edit or write it.`,
  })
}

const TASK_SUBS: Record<string, (ctx: Ctx, pairs: string[]) => Promise<Result<unknown>>> = {
  start: (ctx, pairs) => startTaskCmd(ctx, pairs),
  handback: handbackCmd,
  abandon: async (ctx, pairs) =>
    pairs.length > 0
      ? err({ code: "bad_args", message: "usage: qualitylayer task abandon" })
      : taskAbandon(ctx),
  archive: (ctx, pairs) => lifecycleCmd(ctx, "archive", pairs),
  restore: (ctx, pairs) => lifecycleCmd(ctx, "restore", pairs),
  override: overrideCmd,
}

export async function taskCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const [sub, ...pairs] = args
  const handler = sub === undefined ? undefined : TASK_SUBS[sub]
  if (handler) return handler(ctx, pairs)
  if (sub === "set" && pairs.length > 0) return setTaskCmd(ctx, pairs)
  return err({ code: "bad_args", message: TASK_USAGE })
}
