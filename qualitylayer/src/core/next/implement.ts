import { createHash } from "node:crypto"
import { isAbsolute, join } from "node:path"
import { phaseText } from "#workflow"
import { type Ctx, ok, type Result } from "../../ctx.ts"
import { detectAgent } from "../agents/detect.ts"
import { changedAreas, type Gap } from "../briefs.ts"
import { contextOf } from "../build-package.ts"
import { readCheckRecords } from "../checks.ts"
import {
  type BuildLog,
  type Verdict as BuildVerdict,
  implementAgentsPath,
  implementLogPath,
  lastIteration,
  readBuildRecord,
  sectionText,
} from "../docs/build-log.ts"
import { sliceCommands, taskCommands } from "../docs/commands.ts"
import { agentFileOf, folderDoc } from "../docs/names.ts"
import { allTasks, evidenceIn, type Outline, progress } from "../docs/outline.ts"
import { proofOfPlan } from "../docs/proof-of-plan.ts"
import { agentsTemplateFor } from "../docs/schema.ts"
import { validateDoc } from "../docs/validate.ts"
import { startFixRound } from "../gate/fix-rounds.ts"
import { recordCheckout } from "../git/branch.ts"
import {
  readBuildStart,
  recordBuildStart,
  stagedBaseline,
  withStagedBaseline,
} from "../git/build-start.ts"
import { otherTasksOnly } from "../git/session-edits.ts"
import { taskCommitDiff } from "../git/task-diff.ts"
import { finishPlannerForOutsideBuild } from "../handoff/outside.ts"
import { implementPrompt } from "../handoff/prompt.ts"
import { environmentBlocked } from "../judge-environment.ts"
import { neededTasks, openNeeds, readNeeds } from "../need/need.ts"
import { humanNeedBlockedTasks } from "../open-items.ts"
import { resolveRepo } from "../paths.ts"
import { readRun, reviewFile } from "../review/cross.ts"
import { sessionKey } from "../task/binding.ts"
import { chatQuestions } from "../task/chat-questions.ts"
import { openedChecks, reviewFindings } from "../task/items.ts"
import { advance } from "../task/machine.ts"
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
import { cardOf } from "../task-card.ts"
import { plannedSizeOf, type TaskFlow, taskFlow } from "../task-flow.ts"
import { fixCommittedSinceFailedRound } from "../verification.ts"
import { noteBuildLead, readBuildLead } from "./build-lead.ts"
import { type Missing, refused } from "./refusal.ts"
import { artifactToolsField, at, base, flowFields, type NextPayload } from "./shared.ts"
import { unprovenSteps } from "./steps.ts"

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

type Verdict = Pick<BuildVerdict, "verdict" | "kind" | "subject" | "text">

/** What a passing judge noted without failing it: for the user at the final approval. */
export function notesOf(log: BuildLog): Verdict[] {
  const iteration = lastIteration(log)
  if (iteration === null || iteration.result !== "pass") return []
  return iteration.verdicts
    .filter((v) => v.verdict === "NOTE")
    .map(({ verdict, kind, subject, text }) => ({ verdict, kind, subject, text }))
}

/** A verdict's point as a gap names it: `done 1`, `dod T2`, `outline T4`. */
const pointOf = (v: Pick<Verdict, "kind" | "subject">) => `${v.kind} ${v.subject}`.trim()

export function gapsOf(log: BuildLog): Verdict[] {
  const iteration = lastIteration(log)
  if (iteration === null || iteration.result !== "fail") return []
  return iteration.verdicts
    .filter((v) => v.verdict === "FAIL" || v.verdict === "MISSING")
    .map(({ verdict, kind, subject, text }) => ({ verdict, kind, subject, text }))
}

/**
 * The findings of the other agent's review of the change that carry no `Answer: Taken`, `Kept` or
 * `Ask` line yet: gaps of the fix, with the file and line the finding names. A review that has not
 * finished, or that did not complete, has none to hand out; a hand-written file counts as done.
 */
async function openFindings(ctx: Ctx, task: Task): Promise<Gap[]> {
  const run = await readRun(ctx, task, "verify")
  if (run !== null && run.state !== "done") return []
  const file = reviewFile(task, "verify")
  if (!(await ctx.fs.exists(file))) return []
  return reviewFindings(await ctx.fs.readFile(file))
    .filter((f) => f.stance === undefined)
    .map((f) => {
      const text = [f.what, f.detail].filter((part) => part !== "").join(" ")
      // A path starts only at the start of its run, so the run is scanned once.
      const place = text.match(/(?<![\w@./-])([\w@./-]+\.\w+):(\d+)/)
      return {
        source: "second opinion",
        subject: place !== null ? `${place[1]}:${place[2]}` : "",
        text,
      }
    })
}

/** A slice whose last `check slice` failed after every box was ticked. */
type FailedCheck = { slice: number; gaps: Gap[] }

/** The slices whose last recorded `check slice` failed after every box was ticked. */
async function failedSliceChecks(ctx: Ctx, task: Task, outline: Outline): Promise<FailedCheck[]> {
  const records = await readCheckRecords(ctx, task)
  const opened = await openedChecks(ctx, task)
  const failed: FailedCheck[] = []
  for (const slice of outline.slices) {
    if (slice.tasks.length === 0 || slice.tasks.some((t) => !t.checked)) continue
    // Only a command the Plan names now counts: one an amendment removed or rewrote holds nothing.
    const current = new Set([...sliceCommands(slice), ...slice.tasks.flatMap(taskCommands)])
    const latest = new Map(
      records
        .filter((r) => r.scope === `slice ${slice.n}` && current.has(r.command))
        .map((r) => [r.command, r]),
    )
    const failing = [...latest.values()].filter(
      (r) => r.ran && r.exit !== 0 && r.at > (opened.get(slice.n) ?? 0),
    )
    if (failing.length > 0)
      failed.push({
        slice: slice.n,
        gaps: failing.map((record) => ({
          source: "check",
          subject: `slice ${slice.n}`,
          text: `\`${record.command}\` exited ${record.exit ?? "at the time limit"}; its output is under checks/ in the task's runtime folder`,
        })),
      })
  }
  return failed
}

/**
 * Another build's files on the same branch: files only other tasks' sessions edited, which this
 * task's reviews (Security, the independent review, the fix round, the pull request) leave out.
 */
export async function otherWork(ctx: Ctx, task: Task): Promise<string[]> {
  const repo = await resolveRepo(ctx)
  return repo.ok ? otherTasksOnly(ctx, repo.data, task.slug) : []
}

/** The areas the build's commits changed since `since`, other tasks' files and the plan folders left out. */
export async function committedAreas(
  ctx: Ctx,
  task: Task,
  since: string,
  leaveOut: readonly string[],
): Promise<string[]> {
  const owned = await taskCommitDiff(ctx, task)
  if (owned) return changedAreas(owned.files)
  const run = await ctx.git.run(task.repoRoot, [
    "diff",
    "--name-only",
    "-z",
    `${since}..HEAD`,
    "--",
    ".",
    ":(exclude)docs/plans/**",
    ...leaveOut.map((path) => `:(exclude)${path}`),
  ])
  return run.code === 0 ? changedAreas(run.stdout.split(/[\0\n]/).filter(Boolean)) : []
}

/**
 * What a run that saw a gap fail leaves for its fix: the evidence files its line cites, whole paths.
 * A run that ran the program (`ran`) is always marked, one that only read a document only when it cites files.
 */
function observedBy(task: Task, text: string, ran: boolean): Pick<Gap, "observed"> {
  const evidence = evidenceIn(text).map((path) => join(task.dir, path))
  return ran || evidence.length > 0 ? { observed: { evidence } } : {}
}

/**
 * What the build session does next: the next card whole (the session builds the cards itself), the
 * gaps a failed check or judge round left for it to fix, the recorded needs, and what holds the move
 * to Verify. Nothing here waits for a helper: the session fixes, commits and moves on.
 */
export async function implementPayload(
  ctx: Ctx,
  task: Task,
  flow: TaskFlow,
  log: BuildLog,
): Promise<NextPayload> {
  const outline = flow.plan
  if (outline === null || allTasks(outline).length === 0) return cardsFirst(ctx, task, flow)
  const { total, checked } = progress(outline)
  // A task that waits for a need (a key, a login only the person can give) is left for Verify; the
  // build goes on with every task that does not wait for one.
  const needs = await readNeeds(ctx, task)
  const needed = neededTasks(needs)
  const next = allTasks(outline).find((t) => !t.checked && !needed.has(t.id.toUpperCase())) ?? null
  const environment = gapsOf(log).filter(environmentBlocked)
  const failedChecks = await failedSliceChecks(ctx, task, outline)
  const gaps = await buildGaps(ctx, task, log, failedChecks)
  const uncommitted = await uncommittedCardFiles(ctx, task, outline)
  const open = openNeeds(needs)
  // Gaps and the next open card come together: the session sees all its work and picks the order.
  const card = next !== null ? await cardOf(ctx, task, next) : null
  const slice =
    card !== null && next !== null
      ? outline.slices.find((s) => s.tasks.some((t) => t.id === next.id))
      : undefined
  const patterns = slice !== undefined ? await patternsOf(ctx, task) : {}
  return base(task, {
    phase: "implement",
    instructions: phaseText(task.type === "bugfix" ? "implement-bugfix" : "implement"),
    progress: { total, checked },
    next_task:
      card !== null && next !== null
        ? { id: next.id, title: next.title, line: next.line, owner: next.owner }
        : null,
    ...(card !== null
      ? {
          task_card: card.card,
          contract: card.contract,
          ...(card.unresolved.length > 0 ? { contract_unresolved: card.unresolved } : {}),
          ...(card.pages.length > 0 ? { artifact_pages: card.pages } : {}),
        }
      : {}),
    ...patterns,
    ...(gaps.length > 0 ? { gaps } : {}),
    ...(uncommitted.length > 0 ? { uncommitted } : {}),
    ...(environment.length > 0
      ? {
          unverified_environment: environment.map((verdict) => ({
            subject: pointOf(verdict),
            text: verdict.text,
          })),
        }
      : {}),
    ...(open.length > 0
      ? {
          needs_open: open.map((n) => ({ for: n.for, what: n.what, state: n.state })),
          deferred_until: "verify",
        }
      : {}),
    ...(task.ui ? await artifactToolsField(ctx, task) : {}),
    ...flowFields(flow),
    iteration: task.iterations + 1,
    record_in: implementAgentsPath(task),
    context: await contextOf(ctx, "coordinator", task),
  })
}

/**
 * A fix round in Verify: the gaps the failed judgement (or a red check) left, the needs, the next
 * open card. The task stays in Verify (mode `fixing`); the build session fixes, commits with
 * `commit fix`, and a fresh reviewer rechecks what failed and the lines the fix changed.
 */
export async function fixReply(
  ctx: Ctx,
  task: Task,
  flow: TaskFlow,
  log: BuildLog,
): Promise<NextPayload> {
  await startFixRound(ctx, task)
  const {
    instructions: _implementText,
    cards_template: _cards,
    ...build
  } = await implementPayload(ctx, task, flow, log)
  return {
    ...build,
    phase: "verify",
    mode: "fixing",
    message:
      "The judgement failed: fix the gaps test first, commit with qualitylayer commit fix, then qualitylayer verify recheck.",
    then: "qualitylayer verify recheck",
  }
}

/**
 * The build before its cards: Implement's text and the template of *Task cards* in
 * `agents/02-implement.md`, which the build session cuts from the approved Plan first.
 */
async function cardsFirst(ctx: Ctx, task: Task, flow: TaskFlow): Promise<NextPayload> {
  // Proof order asks for one line per Done means step of the approved Plan.
  const plan = join(task.dir, folderDoc("plan"))
  const proof = (await ctx.fs.exists(plan)) ? proofOfPlan(await ctx.fs.readFile(plan)) : undefined
  const template = agentsTemplateFor(
    folderDoc("implement"),
    { ...task, ...(proof !== undefined ? { proof } : {}) },
    `${task.title} · the build`,
  )
  return base(task, {
    phase: "implement",
    instructions: phaseText(task.type === "bugfix" ? "implement-bugfix" : "implement"),
    progress: { total: 0, checked: 0 },
    next_task: null,
    cards_in: implementAgentsPath(task),
    ...(template !== undefined ? { cards_template: template } : {}),
    ...(task.ui ? await artifactToolsField(ctx, task) : {}),
    ...flowFields(flow),
    record_in: implementAgentsPath(task),
    context: await contextOf(ctx, "coordinator", task),
  })
}

/**
 * The gaps the build session fixes now: a failed judge round's (until a fix is committed since the
 * round, when the next round judges it), a recorded slice check that still fails, and the second
 * opinion's open findings beside a failed round. Points only the person settles and environment
 * blockers are no code gaps: they reach the person's review at Verify.
 */
async function buildGaps(
  ctx: Ctx,
  task: Task,
  log: BuildLog,
  failedChecks: FailedCheck[],
): Promise<Gap[]> {
  const fixed = await fixCommittedSinceFailedRound(ctx, task)
  // A card that waits only for the person cannot be fixed by the session: its gap goes to the person's review.
  const waiting = new Set((await humanNeedBlockedTasks(ctx, task)).map((id) => id.toUpperCase()))
  const judged = fixed
    ? []
    : gapsOf(log).filter(
        (g) =>
          !environmentBlocked(g) && !(g.kind === "dod" && waiting.has(g.subject.toUpperCase())),
      )
  return [
    ...judged.map((g) => ({
      source: `judge ${g.verdict}`,
      subject: `${g.kind} ${g.subject}`.trim(),
      text: g.text,
      ...observedBy(task, g.text, ["scenario", "acceptance"].includes(g.kind)),
    })),
    ...failedChecks.flatMap((f) => f.gaps),
    ...(judged.length > 0 ? await openFindings(ctx, task) : []),
  ]
}

/** The cards' files that hold uncommitted changes: the build is committed before Verify judges it. */
async function uncommittedCardFiles(ctx: Ctx, task: Task, outline: Outline): Promise<string[]> {
  // Only paths in the repository: a planned file outside it (`/etc/…`, `~/…`) has nothing to commit.
  const files = [...new Set(allTasks(outline).flatMap((card) => card.files))].filter(
    (file) => !file.endsWith("/") && !isAbsolute(file) && !file.startsWith("~"),
  )
  if (files.length === 0) return []
  const status = await ctx.git.run(task.repoRoot, ["status", "--porcelain", "-z", "--", ...files])
  if (status.code !== 0) return []
  return status.stdout
    .split("\0")
    .filter((row) => row.length > 3)
    .map((row) => row.slice(3))
}

/**
 * After a failed iteration the boxes are still checked; the build is done
 * again once a newer pass exists or the agent re-ran `next` after fixing.
 */
export function gapsResolved(
  log: BuildLog,
  outline: Outline,
  task: Task,
  deferred?: ReadonlySet<string>,
): boolean {
  const iteration = lastIteration(log)
  if (iteration === null || iteration.result !== "fail") return true
  // The failed iteration has been counted; the gaps were fixed and the build asks to verify again.
  return (
    iteration.n <= task.iterations &&
    allTasks(outline).every((t) => t.checked || deferred?.has(t.id) === true)
  )
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
): Promise<Result<NextPayload>> {
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
  const log = await readBuildRecord(ctx, task)
  const { total, checked } = progress(outline)
  // A failed round the session fixed without a verb counting it is counted before it leaves.
  const building =
    checked === total && !gapsResolved(log, outline, task) ? await countLeftRound(ctx, task) : task
  const advanced = await advance(
    ctx,
    building,
    checked === total && unproven.length === 0 ? "tasks_complete" : "work_deferred",
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

/** The marker that holds which *Code to imitate* the build session was handed last. */
const PATTERNS_SENT = "patterns-sent"

/**
 * The patterns a card follows: the *Code to imitate* of the Plan's agents' file. The build session
 * is handed them once, and again when they changed; a later reply names the file that holds them.
 */
async function patternsOf(ctx: Ctx, task: Task): Promise<NextPayload> {
  const path = join(task.dir, agentFileOf("plan"))
  const patterns = (await ctx.fs.exists(path))
    ? sectionText(await ctx.fs.readFile(path), "Code to imitate")
    : ""
  if (patterns === "") return {}
  const marker = join(task.runtimeDir, PATTERNS_SENT)
  const digest = createHash("sha256").update(patterns).digest("hex")
  if ((await ctx.fs.exists(marker)) && (await ctx.fs.readFile(marker)).trim() === digest)
    return { patterns_in: path }
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.writeFile(marker, `${digest}\n`)
  return { patterns }
}
