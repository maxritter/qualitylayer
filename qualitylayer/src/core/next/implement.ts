import { join } from "node:path"
import { type Ctx, ok, type Result } from "../../ctx.ts"
import { detectAgent } from "../agents/detect.ts"
import { implementLogPath, readBuildRecord } from "../docs/build-log.ts"
import { agentFileOf } from "../docs/names.ts"
import { allTasks, type Outline, progress } from "../docs/outline.ts"
import { validateDoc } from "../docs/validate.ts"
import { recordCheckout } from "../git/branch.ts"
import {
  readBuildStart,
  recordBuildStart,
  stagedBaseline,
  withStagedBaseline,
} from "../git/build-start.ts"
import { finishPlannerForOutsideBuild } from "../handoff/outside.ts"
import { implementPrompt } from "../handoff/prompt.ts"
import { humanNeedBlockedTasks } from "../open-items.ts"
import { sessionKey } from "../task/binding.ts"
import { chatQuestions } from "../task/chat-questions.ts"
import { advance } from "../task/machine.ts"
import { advanceWithTaskCommit } from "../task/precommit.ts"
import type { Question } from "../task/question.ts"
import { countLeftRound, ensureBuildLog, ensureVerifyLog } from "../task/reconcile.ts"
import { approvesInAgent } from "../task/sides.ts"
import {
  appendEvent,
  patchReadme,
  readEvents,
  readmeFrontmatter,
  setCheckout,
  type Task,
  touchSession,
} from "../task/store.ts"
import { plannedSizeOf, taskFlow } from "../task-flow.ts"
import { noteBuildLead, readBuildLead } from "./build-lead.ts"
import { gapsResolved } from "./implement-gaps.ts"
import { implementPayload } from "./implement-payload.ts"
import { type Missing, refused } from "./refusal.ts"
import { at, base, flowFields, type NextPayload } from "./shared.ts"
import { unprovenSteps } from "./steps.ts"

export {
  committedAreas,
  notesOf,
  otherWork,
} from "./implement-gaps.ts"
export { fixReply, implementPayload } from "./implement-payload.ts"

const handoffMarker = (task: Task) => join(task.runtimeDir, "handoff.json")

/**
 * Once the Plan is approved, a marker says where its folder is, for any checkout to find and copy
 * it from. Written when the build starts, before its cards exist; no Git write is needed.
 */
export async function recordHandoff(ctx: Ctx, task: Task): Promise<void> {
  if (await ctx.fs.exists(handoffMarker(task))) return
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.writeFile(
    handoffMarker(task),
    `${JSON.stringify({ shown: ctx.clock.now(), planDir: task.dir }, null, 2)}\n`,
  )
}

/**
 * Once the Plan is approved and its build starts: where the build starts (base and branch)
 * is recorded once. The person decides whether to commit the workflow documents.
 */
export async function recordApproval(ctx: Ctx, task: Task): Promise<Result<true>> {
  let marker: { shown?: number; committed?: boolean; recorded?: boolean } = {}
  try {
    marker = JSON.parse(await ctx.fs.readFile(handoffMarker(task)))
  } catch {
    // no marker yet: this writes it
  }
  if (marker.recorded === true || marker.committed === true) return ok(true)
  const frontmatter = await readmeFrontmatter(ctx, task)
  if (typeof frontmatter.base !== "string")
    await patchReadme(ctx, task, await recordCheckout(ctx, task))
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.writeFile(
    handoffMarker(task),
    `${JSON.stringify({ shown: marker.shown ?? ctx.clock.now(), planDir: task.dir, recorded: true }, null, 2)}\n`,
  )
  return ok(true)
}

/**
 * A terminal task's way to build, asked in the agent's own picker: the three choices of every
 * surface. The clean start is first and recommended; the Plan is written for a session with no memory
 * of the planning talk, so a compacted conversation loses nothing.
 */
export const BUILD_ROUTE: Question = {
  id: "build-route",
  question: "How do you want to build?",
  choices: [
    {
      label: "Build here, from the Plan",
      detail:
        "Run your agent's compact command, then say \"build here\". The Plan's files carry everything.",
    },
    {
      label: "Keep this conversation",
      detail:
        "This session cuts the cards and builds; every build call reads the planning talk again.",
    },
    {
      label: "Another session or agent",
      detail: "Paste the prompt into a fresh session or another agent.",
    },
  ],
  recommended: 0,
  why: "The build reads the saved Plan, so it does not need the planning conversation.",
  number: 1,
  asked: 0,
}

/**
 * Whether the build-choice question QualityLayer handed out with the approval still stands: the
 * implement stop was shown to a task that approves in its agent, and no build has started.
 */
export async function buildRouteOpen(ctx: Ctx, task: Task): Promise<boolean> {
  if (task.stage !== "implement" || !approvesInAgent(task)) return false
  if ((await readBuildStart(ctx, task)) !== null) return false
  return (await readEvents(ctx, task)).some((e) => e.event === "implement_stop_shown")
}

/**
 * The Plan's approval was applied: honour its recorded choice, or let the person choose.
 * Every build is still taken explicitly with `build start`.
 */
export async function implementStop(
  ctx: Ctx,
  task: Task,
  chosen?: { compact?: boolean },
): Promise<NextPayload> {
  const flow = await taskFlow(ctx, task)
  const agent = detectAgent(ctx.env)
  const outline = flow.plan
  // Before the build session writes the cards, the Plan's Size line says how big the build is.
  const planText =
    outline === null && (await ctx.fs.exists(at(task, "plan")))
      ? await ctx.fs.readFile(at(task, "plan"))
      : ""
  const planned = outline === null ? plannedSizeOf(planText) : null
  const stop = implementPrompt(
    task,
    agent,
    flow.line,
    outline !== null
      ? { slices: outline.slices.length, tasks: allTasks(outline).length }
      : { slices: planned?.slices ?? 0, tasks: planned?.tasks ?? 0, planned: true },
  )
  const build = `qualitylayer build start --task ${task.slug}`
  if (chosen !== undefined && chosen.compact !== true)
    return base(task, {
      next: build,
      prompt: stop.prompt,
      ...flowFields(flow),
      message: `Plan approved · ${task.slug}. The person chose Keep this conversation; this session builds it next.`,
      instructions: `Continue here with \`${build}\`.`,
    })
  await touchSession(ctx, task, agent, "waiting")
  await appendEvent(ctx, task, { event: "implement_stop_shown" })
  // The person chose Compact first in the App: this session builds, after its conversation is compacted.
  if (chosen?.compact === true)
    return base(task, {
      stop: "implement",
      prompt: stop.prompt,
      ...flowFields(flow),
      message: `Plan approved · ${task.slug}. To build here, from the Plan, run your agent's compact command, then say "build here".`,
      instructions: `Show \`message\` and end your turn. When the person says "build here", run \`${build}\`.`,
    })
  // The build choice belongs to the approval: it is asked where the person approved.
  const terminal = approvesInAgent(task)
  return base(task, {
    stop: "implement",
    prompt: stop.prompt,
    advice: stop.advice,
    ...flowFields(flow),
    message: stop.message,
    // A terminal task asks the same three choices in the agent's own picker.
    ...(terminal ? { chat_questions: await chatQuestions(ctx, [BUILD_ROUTE]) } : {}),
    // The person chooses where the build runs: planning ends here.
    instructions: terminal
      ? `Planning is complete. Ask \`chat_questions\` in your native picker. Build here, from the Plan: tell the person to run their agent's compact command, then say "build here", and end your turn; when they say it, run \`${build}\`. Keep this conversation: run \`${build}\`. Another session or agent: show \`message\` and end your turn.`
      : `Planning is complete and the person chooses where the build runs: show \`message\` and end your turn. If they ask you to build here, run \`${build}\`.`,
  })
}

/**
 * `build start`: this session takes the approved Plan's build. It leads the build from now on, the
 * task lives in this checkout, and the build files are written the first time; the reply is the
 * Implement payload (its text, the cards' template or the next card). Repeated by the lead it is
 * the same payload, `already`.
 */
export async function buildStart(ctx: Ctx, task: Task): Promise<Result<NextPayload>> {
  const recorded = await recordApproval(ctx, task)
  if (!recorded.ok) return recorded
  await recordHandoff(ctx, task)
  const before = await readBuildLead(ctx, task)
  const mine = before !== null && before.session === sessionKey(ctx.env)
  const started = await ctx.fs.exists(implementLogPath(task))
  const agent = detectAgent(ctx.env)
  // Admission succeeds before a new build owner is published.
  await touchSession(ctx, task, agent)
  await noteBuildLead(ctx, task)
  // The build started outside the App: the App's planner finishes (handoff/outside.ts).
  await finishPlannerForOutsideBuild(ctx, task)
  await setCheckout(ctx, task, task.repoRoot)
  if (!started) {
    await ensureBuildLog(ctx, task)
    await appendEvent(ctx, task, { event: "implement_started", agent })
  }
  const flow = await taskFlow(ctx, task)
  const log = await readBuildRecord(ctx, task)
  // What the checkout holds as the build starts; a large staged baseline is committed first. The
  // cards are written after this, by the build: until then no card names a file.
  const cards = flow.plan === null ? [] : allTasks(flow.plan)
  const start = started
    ? null
    : await recordBuildStart(
        ctx,
        task,
        cards.length > 0 ? cards.flatMap((card) => card.files) : undefined,
      )
  const staged =
    start === null
      ? null
      : stagedBaseline(
          start,
          flow.plan ?? { slices: [], proofOrder: [], proofOrderUnread: [], malformed: [] },
        )
  const payload = withStagedBaseline(await implementPayload(ctx, task, flow, log), staged)
  return ok({
    ...payload,
    ...(started && mine ? { already: true } : {}),
    ...(before !== null && !mine && before.session !== null ? { took_over: true } : {}),
  })
}

async function checkBuildDoneReady(
  ctx: Ctx,
  task: Task,
  defer: string | null,
): Promise<
  Result<{
    outline: Outline
    open: ReturnType<typeof allTasks>
    unproven: Awaited<ReturnType<typeof unprovenSteps>>
  }>
> {
  const cardsFile = agentFileOf("implement")
  const outline = (await taskFlow(ctx, task)).plan
  if (outline === null || allTasks(outline).length === 0)
    return refused(`No task cards are written in ${cardsFile} yet.`, [
      {
        what: `the task cards under *Task cards* in ${cardsFile}`,
        move: "write them from `cards_template` (qualitylayer brief implement), then qualitylayer build done",
      },
    ])
  const report = await validateDoc(ctx, task.dir, cardsFile, { runtimeDir: task.runtimeDir })
  const invalid: Missing[] = report.ok
    ? report.data.errors
        .filter((e) => e.severity === "error")
        .map((e) => ({
          what: `${cardsFile} line ${e.line} [${e.rule}] ${e.message}`,
          move: e.fix_hint,
        }))
    : [{ what: report.error.message, move: `correct ${cardsFile}, then qualitylayer build done` }]
  if (invalid.length > 0) return refused(`The task cards in ${cardsFile} do not validate.`, invalid)
  const waiting = new Set((await humanNeedBlockedTasks(ctx, task)).map((id) => id.toUpperCase()))
  const open = allTasks(outline).filter((c) => !c.checked && !waiting.has(c.id.toUpperCase()))
  const unproven = await unprovenSteps(ctx, task)
  if (defer === null && open.length + unproven.length > 0)
    return refused(
      `The build is not ready for Verify: ${open.length} card(s) open, ${unproven.length} Done means step(s) never ran green.`,
      [
        ...open.map((card) => ({
          what: `${card.id} is not ticked`,
          move: `qualitylayer check task ${card.id}, then tick it in ${cardsFile}`,
        })),
        ...unproven.map((step) => ({
          what: `${step.id} never ran green on the built tree`,
          move: `qualitylayer check step ${step.id} -- <program> <args…>`,
        })),
        {
          what: "or take what is open to Verify, with the reason",
          move: 'qualitylayer build done --defer "<why>"',
        },
      ],
    )
  return ok({ outline, open, unproven })
}

/**
 * `build done [--defer "<why>"]`: the build is ready, Implement → Verify. Refused while the cards do
 * not validate, and, without `--defer`, while a card is open or a Done means step never ran green on
 * the built tree; each with the move that settles it. With `--defer` what is open goes to Verify,
 * named with the reason.
 */
export async function buildDone(
  ctx: Ctx,
  task: Task,
  defer: string | null,
  pairedCommitReview = false,
): Promise<Result<NextPayload>> {
  const ready = await checkBuildDoneReady(ctx, task, defer)
  if (!ready.ok) return ready
  const { outline, open, unproven } = ready.data
  const { total, checked } = progress(outline)
  const advanced = await advanceWithTaskCommit(
    ctx,
    task,
    outline,
    pairedCommitReview,
    async (current) => {
      const log = await readBuildRecord(ctx, current)
      // A failed round the session fixed without a verb counting it is counted before it leaves.
      const building =
        checked === total && !gapsResolved(log, outline, current)
          ? await countLeftRound(ctx, current)
          : current
      return advance(
        ctx,
        building,
        checked === total && unproven.length === 0 ? "tasks_complete" : "work_deferred",
      )
    },
  )
  if (!advanced.ok) return advanced
  if (defer !== null && open.length + unproven.length > 0)
    await appendEvent(ctx, advanced.data, {
      event: "build_deferred",
      why: defer,
      cards: open.map((card) => card.id),
      steps: unproven.map((step) => step.id),
    })
  // The security review records in the Verify file: it exists before it is handed out.
  await ensureVerifyLog(ctx, advanced.data)
  return ok(
    base(advanced.data, {
      phase: "verify",
      stage: "verify",
      message:
        "The build is in Verify: the checks, then a fresh reviewer that never wrote the code.",
      then: "qualitylayer brief verify",
    }),
  )
}
