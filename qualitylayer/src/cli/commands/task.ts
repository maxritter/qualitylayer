// comments resolve <id…|all> · comments list · comments take · task start "<request>" ·
// task handback "<reason>" · task abandon · task set type=… ui=… title=… · task override +security …

import { join } from "node:path"
import { detectAgent } from "../../core/agents/detect.ts"
import { isNativeAgent, NATIVE_AGENTS } from "../../core/agents/ids.ts"
import { readConfig } from "../../core/config.ts"
import { folderDoc } from "../../core/docs/names.ts"
import {
  COMMENT_PLACEMENT_THEN,
  commentPlaces,
  readComments,
  resolveComments,
  take,
  takeFresh,
} from "../../core/gate/comments.ts"
import { readGate } from "../../core/gate/gate.ts"
import { buildLine } from "../../core/helpers.ts"
import {
  keepLink,
  type LinkedRequest,
  linkedRequest,
  taskFromLink,
} from "../../core/integrations/start.ts"
import { attachmentHint } from "../../core/interaction-docs/attachments.ts"
import { refused } from "../../core/next/refusal.ts"
import { taskAbandon, taskHandback, taskStart } from "../../core/next.ts"
import { projectRuntimeDir, resolveBoundRepo } from "../../core/paths.ts"
import {
  type ExtraPlanner,
  PLANNERS_USAGE,
  parsePlanners,
  plannerSpec,
  writePlanners,
} from "../../core/review/planners.ts"
import { withManagedRunNext } from "../../core/run/bind.ts"
import { withPlanPresentation } from "../../core/run/presentation.ts"
import { applyOverrides } from "../../core/scaling.ts"
import type { OriginalSource } from "../../core/task/adoption.ts"
import { sessionKey } from "../../core/task/binding.ts"
import {
  appendEvent,
  isTerminal,
  listTasks,
  patchReadme,
  readmePath,
  type Task,
  type TaskType,
  taskTitle,
} from "../../core/task/store.ts"
import { agentActionable, asComment, takeTeam } from "../../core/team/comments.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { putArchived } from "../../server/api.ts"
import { ensureCockpit } from "../../server/lock.ts"
import { stdinBytes, withTaskExtras } from "./next.ts"
import { parseArgs, requireTask } from "./shared.ts"

export async function commentsCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const [sub, ...rest] = args
  const { positional: ids, flags } = parseArgs(rest, ["answer"])
  const task = await requireTask(ctx)
  if (!task.ok) return task
  if (sub === "list" || sub === undefined) {
    return ok({
      comments: (await readComments(ctx, task.data)).filter((c) => agentActionable(c, "resolve")),
    })
  }
  if (sub === "take") {
    // Gate-owned answers wait for the decision. Sent Review document notes and team feedback
    // have their own delivery and must not be hidden by an automatically reopened final gate.
    const gate = await readGate(ctx, task.data)
    const gateOpen = gate !== null && gate.decision === "pending" && gate.settled !== true
    const team = (await takeTeam(ctx, task.data)).map(asComment)
    if (gateOpen) {
      const comments =
        gate.target === "final"
          ? [...(await takeFresh(ctx, task.data, [folderDoc("verify"), "final"])), ...team]
          : team
      return ok({
        comments: await commentPlaces(ctx, task.data, comments),
        ...attachmentHint(comments),
        message:
          gate.target === "final"
            ? "Sent comments on the Verify document are included here; draft item answers wait for the decision."
            : 'New review feedback arrives with the Plan decision (qualitylayer wait --for approval). If an earlier comment blocks reopening the Plan, run qualitylayer comments list, then qualitylayer comments resolve <id> --answer "<what you did>".',
        ...(comments.length > 0
          ? {
              then: `${COMMENT_PLACEMENT_THEN} Apply each comment like feedback in the chat, then run: qualitylayer comments resolve all`,
            }
          : {}),
      })
    }
    const comments = await commentPlaces(ctx, task.data, [
      ...(await take(ctx, task.data, (await buildLine(ctx, task.data))?.task ?? undefined)),
      ...team,
    ])
    // A comment on a build item is answered, one line each, so the Cockpit can show what became of it.
    const onBuild = comments.some((c) => "build" in c && c.build !== undefined)
    return ok({
      comments,
      ...attachmentHint(comments),
      ...(comments.length > 0
        ? {
            then:
              COMMENT_PLACEMENT_THEN +
              " " +
              (onBuild
                ? 'apply each comment like feedback in the chat, test first, then answer each: qualitylayer comments resolve <id> --answer "<one line on what changed>". ' +
                  'A comment with kind "ask-why" asks you to explain a choice you made on your own: answer it with the reason in one line, and change the code only when the reason does not hold.'
                : "apply each comment like feedback in the chat, then run: qualitylayer comments resolve all"),
          }
        : {}),
    })
  }
  if (sub === "resolve") {
    if (ids.length === 0) {
      return err({
        code: "bad_args",
        message:
          'usage: qualitylayer comments resolve <id…> | all [--answer "<one line>"] [--changed]',
      })
    }
    const result = await resolveComments(
      ctx,
      task.data,
      ids,
      typeof flags.answer === "string" ? flags.answer : undefined,
      flags.changed === true,
    )
    return ok(result)
  }
  return err({
    code: "bad_args",
    message: "usage: qualitylayer comments list | take | resolve <id…>",
  })
}

const TASK_USAGE =
  'usage: qualitylayer task start "<request>" [--type feature|bug|chat] [--title <words>] [--from <ticket link> | --from-plan <file|->] [--plan [--agent <id>]] · task handback "<reason>" --prompt "<prompt>" · task abandon · task set answers=app|terminal approvals=app|terminal type=feature|bugfix ui=true|false profile=small|full title=<short name> · task override <+name|-name>… · task archive|restore <task>'

const START_USAGE =
  'usage: qualitylayer task start "<request>" [--type feature|bug|chat] [--title <words>] [--terminal | --app] [--from <ticket link> | --from-plan <file|->] [--plan [--agent <id>]] [--planners <agent:model[:effort]>[,<agent:model[:effort]>]]'

type Planning = { planning: "started"; run: string } | { planning: "waiting"; reason: string }

/**
 * Ask the local server to start planning for the task, as the App does for a task that waits: the
 * person's planning defaults (agent, model, effort) unless `agent` names another agent. The server
 * takes the CLI's key as the start authority for this one call. A server that cannot be started, or
 * that refuses, leaves the task as it is and gives the reason.
 */
async function startPlanning(
  ctx: Ctx,
  task: Pick<Task, "repoId" | "slug" | "repoRoot">,
  agent: string | undefined,
): Promise<Planning> {
  const waiting = (reason: string): Planning => ({ planning: "waiting", reason })
  const config = await readConfig(ctx)
  const chosen = agent ?? config.planning.defaults.agent
  if (!isNativeAgent(chosen))
    return waiting(
      "your planning default is another agent, which only the App starts; pass --agent <id> to choose one",
    )
  const lock = await ensureCockpit(ctx, { explicit: false })
  if (lock === null)
    return waiting(
      ctx.env.get("QUALITYLAYER_NO_COCKPIT") === "1"
        ? "the local server is not running, and QUALITYLAYER_NO_COCKPIT stops it from starting here"
        : "the local server is not running and could not be started",
    )
  const id = `${task.repoId}~${task.slug}`
  const defaults = config.planning.defaults[chosen]
  try {
    const response = await ctx.http.fetch(`http://127.0.0.1:${lock.port}/api/agent-runs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-qualitylayer-token": lock.token },
      body: JSON.stringify({
        agent: chosen,
        purpose: { kind: "task", task: id, phase: "planning" },
        cwd: task.repoRoot,
        works: "checkout",
        mode: "plain",
        settings: {
          answers: "app",
          ...(chosen === "pi" ? {} : { model: defaults.model, effort: defaults.effort }),
        },
        idempotencyKey: `task-start:${id}`,
      }),
      signal: AbortSignal.timeout(60_000),
    })
    const body = (await response.json().catch(() => ({}))) as { id?: unknown; error?: unknown }
    if (!response.ok)
      return waiting(
        typeof body.error === "string"
          ? body.error
          : `the local server answered ${response.status}`,
      )
    return { planning: "started", run: typeof body.id === "string" ? body.id : "" }
  } catch (cause) {
    return waiting(
      `the local server did not answer: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
}

/**
 * `task start "<request>"`: a task at Plan. An agent's session gets the Plan's brief and owns the
 * task; a script (no agent session, or `--plan`) gets the task's names and it waits on Home, where
 * `--plan` also asks the local server to start the planning agent. `--from-plan <file|->` starts it
 * from the person's own plan, kept as given.
 */
async function startCmd(
  ctx: Ctx,
  words: string[],
  readStdin: () => Promise<Uint8Array> = stdinBytes,
): Promise<Result<unknown>> {
  const { positional, flags } = parseArgs(words, [
    "type",
    "title",
    "agent",
    "from-plan",
    "from",
    "planners",
  ])
  const said = positional.join(" ").trim()
  const fromPlan = flags["from-plan"]
  const from = flags.from
  if (from === true || (from !== undefined && fromPlan !== undefined))
    return err({
      code: "bad_args",
      message: `--from takes one ticket link, and a task starts from a link or from a plan, not both. ${START_USAGE}`,
    })
  if (
    fromPlan === true ||
    (fromPlan === undefined && said === "" && from === undefined) ||
    (fromPlan !== undefined && said !== "")
  )
    return err({
      code: "bad_args",
      message:
        fromPlan === undefined
          ? START_USAGE
          : `--from-plan takes the plan only: put your words in the plan, or name the task with --title. ${START_USAGE}`,
    })
  const chosenType: TaskType | null =
    flags.type === undefined || flags.type === "feature"
      ? "feature"
      : flags.type === "bug" || flags.type === "bugfix"
        ? "bugfix"
        : flags.type === "chat"
          ? "chat"
          : null
  if (chosenType === null)
    return err({ code: "bad_args", message: `--type is feature, bug or chat. ${START_USAGE}` })
  if (chosenType === "chat" && fromPlan !== undefined)
    return err({
      code: "bad_args",
      message: `A Chat starts from the person's words, not from a plan: drop --from-plan or --type chat. ${START_USAGE}`,
    })
  if (flags.title === true || (typeof flags.title === "string" && flags.title.trim() === ""))
    return err({ code: "bad_args", message: `--title takes the words. ${START_USAGE}` })
  if (
    (flags.terminal === true && flags.app === true) ||
    Object.keys(flags).some((name) => /^(terminal|app)=/.test(name))
  )
    return err({ code: "bad_args", message: `choose --terminal or --app. ${START_USAGE}` })
  // Up to two extra planners for a feature task, each an agent on a chosen model and effort (Max, 11 November 2026).
  let planners: ExtraPlanner[] = []
  if (flags.planners !== undefined) {
    const read = typeof flags.planners === "string" ? parsePlanners(flags.planners) : PLANNERS_USAGE
    if (typeof read === "string")
      return err({ code: "bad_args", message: `${read}. ${START_USAGE}` })
    if (chosenType !== "feature")
      return err({
        code: "bad_args",
        message: `Extra planners are for feature tasks, not a ${chosenType === "bugfix" ? "bug fix" : "Chat"}: drop --planners or --type. ${START_USAGE}`,
      })
    planners = read
  }
  const plannersReply = planners.length > 0 ? { planners: planners.map(plannerSpec) } : {}
  const plan = flags.plan === true
  const agent = typeof flags.agent === "string" ? flags.agent : undefined
  if (flags.agent !== undefined && (!plan || !isNativeAgent(agent)))
    return err({
      code: "bad_args",
      message: `--agent <id> names one of ${NATIVE_AGENTS.join(", ")} and goes with --plan. ${START_USAGE}`,
    })
  let source: OriginalSource | undefined
  if (typeof fromPlan === "string")
    try {
      source =
        fromPlan === "-"
          ? { kind: "pasted", bytes: await readStdin() }
          : { kind: "file", path: fromPlan }
    } catch (cause) {
      return err({
        code: "bad_args",
        message:
          cause instanceof Error
            ? cause.message
            : "The original plan could not be read from stdin.",
      })
    }
  // No agent session names itself: a script starts the task, and it waits on Home.
  const script = plan || (sessionKey(ctx.env) === null && detectAgent(ctx.env) === "unknown")
  // From a ticket link: its title and quoted text become the request, and the task keeps the link.
  let linked: LinkedRequest | undefined
  if (typeof from === "string") {
    const read = await linkedRequest(ctx, from, said, {
      ...(flags.type !== undefined ? { type: chosenType } : {}),
      ...(typeof flags.title === "string" ? { title: flags.title } : {}),
    })
    if (!read.ok) return read
    linked = read.data
    if (script) {
      // One link, one task: a script that starts it again gets the task it already started.
      const repo = await resolveBoundRepo(ctx)
      const existing = repo.ok ? await taskFromLink(ctx, repo.data, linked.from) : null
      if (existing !== null)
        return ok({
          task: existing.slug,
          id: `${existing.repoId}~${existing.slug}`,
          title: existing.title,
          step: existing.stage,
          from: linked.from,
          already: true,
          message: `${existing.slug} already started from this link; nothing new was started.`,
          then: `qualitylayer status --json --task ${existing.slug}`,
        })
    }
  }
  const request = linked?.request ?? said
  const type = linked?.type ?? chosenType
  const title = typeof flags.title === "string" ? flags.title : linked?.title
  const linkReply = linked
    ? {
        from: linked.from,
        ...(linked.ticket ? { ticket: linked.ticket } : {}),
        ...(linked.unread ? { unread: linked.unread } : {}),
      }
    : {}
  const options = {
    type,
    ...(title !== undefined ? { title } : {}),
    ...(flags.terminal === true
      ? { answers: "terminal" as const }
      : flags.app === true
        ? { answers: "app" as const }
        : {}),
    ...(source !== undefined ? { fromPlan: source } : { script }),
  }
  if (!script || source !== undefined)
    return withManagedRunNext(ctx, [], async (bound) => {
      // A run bound to a task refuses a new request before any folder is written.
      if (source === undefined) {
        const refusal = await boundRunRefusal(bound, request)
        if (refusal !== null) return refusal
      }
      const started = await withTaskExtras(bound, await taskStart(bound, request, options))
      if (!started.ok) return started
      if (linked !== undefined || planners.length > 0) {
        const named = await requireTaskNamed(bound, String(started.data.task ?? ""))
        if (named !== null && linked !== undefined) await keepLink(bound, named, linked.from)
        if (named !== null && planners.length > 0) await writePlanners(bound, named, planners)
      }
      return ok({ ...withPlanPresentation(bound, started.data), ...linkReply, ...plannersReply })
    })
  const started = await taskStart(ctx, request, options)
  if (!started.ok) return started
  // The task exists either way; planning starts only when asked for and the server takes it.
  const named = await requireTaskNamed(ctx, String(started.data.task))
  if (named !== null && linked !== undefined) await keepLink(ctx, named, linked.from)
  if (named !== null && planners.length > 0) await writePlanners(ctx, named, planners)
  return ok({
    ...started.data,
    ...linkReply,
    ...plannersReply,
    ...(plan && named !== null ? await startPlanning(ctx, named, agent) : { planning: "waiting" }),
  })
}

/**
 * In a run already bound to a task, a `task start` with other words than the ones that started it
 * is refused, with the moves that go on. The same words again are a retry: it continues the task.
 */
async function boundRunRefusal(bound: Ctx, request: string): Promise<Result<never> | null> {
  const slug = bound.env.get("QUALITYLAYER_TASK")
  if (bound.managedRunPurpose === undefined || slug === undefined || slug === "") return null
  const repo = await resolveBoundRepo(bound)
  if (!repo.ok) return null
  const task = (await listTasks(bound, repo.data)).find((t) => t.slug === slug)
  if (task === undefined) return null
  const key = sessionKey(bound.env)
  const started =
    key === null
      ? null
      : await bound.fs
          .readFile(join(projectRuntimeDir(bound, repo.data.id), "sessions", `${key}.startup.json`))
          .then((text) => JSON.parse(text) as { slug?: unknown; words?: unknown })
          .catch(() => null)
  if (started?.slug === task.slug && started.words === request.trim()) return null
  return refused(
    `This run is bound to ${task.slug}; nothing was started. A new request starts in a new run.`,
    [
      { what: `${task.slug} continued`, move: "qualitylayer next" },
      { what: "a new task", move: "start a new task from the App's Home" },
    ],
  )
}

/** The task a script just started, by its slug. */
async function requireTaskNamed(ctx: Ctx, slug: string): Promise<Task | null> {
  const found = await requireTask({
    ...ctx,
    env: {
      cwd: ctx.env.cwd,
      get: (name) => (name === "QUALITYLAYER_TASK" ? slug : ctx.env.get(name)),
    },
  })
  return found.ok ? found.data : null
}

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

export async function taskCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const [sub, ...pairs] = args
  if (sub === "start") return startCmd(ctx, pairs)
  if (sub === "handback") return handbackCmd(ctx, pairs)
  if (sub === "abandon") {
    if (pairs.length > 0)
      return err({ code: "bad_args", message: "usage: qualitylayer task abandon" })
    return taskAbandon(ctx)
  }
  if (sub === "archive" || sub === "restore") return lifecycleCmd(ctx, sub, pairs)
  if (sub === "override") return overrideCmd(ctx, pairs)
  if (sub !== "set" || pairs.length === 0) {
    return err({ code: "bad_args", message: TASK_USAGE })
  }
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
  const patch: Record<string, string | boolean> = {}
  for (const pair of pairs) {
    const split = pair.indexOf("=")
    const key = split === -1 ? pair : pair.slice(0, split)
    const value = split === -1 ? "" : pair.slice(split + 1)
    if (key === "type" && (value === "feature" || value === "bugfix")) patch.type = value
    else if (key === "ui" && (value === "true" || value === "false")) patch.ui = value === "true"
    else if (key === "profile" && (value === "small" || value === "full")) patch.profile = value
    else if (key === "title" && value.trim() !== "") patch.title = taskTitle("", value)
    else if (key === "answers" && (value === "app" || value === "terminal")) patch.answers = value
    else if (key === "approvals" && (value === "app" || value === "terminal"))
      patch.approvals = value
    else
      return err({
        code: "bad_args",
        message: `cannot set "${pair}"; use answers=app|terminal, approvals=app|terminal, type=feature|bugfix, ui=true|false, profile=small|full or title=<short name>`,
      })
  }
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
