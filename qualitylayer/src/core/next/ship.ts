// After the final approval: the ship step (the approved description, the pull request the person
// chose), and, while the pull request is open, the author's triage of what GitHub says. Also the
// "show me" view and the copy of a task folder into the checkout that builds it.

import { cp } from "node:fs/promises"
import { dirname, isAbsolute, join } from "node:path"
import { phaseText } from "#workflow"
import { type Ctx, ok, type Result } from "../../ctx.ts"
import { contextOf } from "../build-package.ts"
import { checksReadyForReview } from "../checks.ts"
import { projectChecks } from "../docs/commands.ts"
import { agentFileOf, IDENTITY_FILE } from "../docs/names.ts"
import { showMeName } from "../docs/visuals.ts"
import { buildBase } from "../git/base.ts"
import { currentBranch } from "../git/repo.ts"
import { projectRuntimeDir, type RepoRef, taskDir } from "../paths.ts"
import { readReview, sayInReview } from "../review/threads.ts"
import { awaitsFix, openThreads } from "../review/triage.ts"
import { readShipRecord } from "../ship/choice.ts"
import { shipStatePath } from "../ship/closing-record.ts"
import { landingView } from "../ship/landing.ts"
import { pullRequestBodyFile } from "../ship/pr-body.ts"
import { commitsAhead, followPullRequest, type PullRequestRecord } from "../ship/pr-life.ts"
import { commandsFor, storedUrl } from "../ship/pull-request.ts"
import { isArchived } from "../task/archive.ts"
import {
  appendEvent,
  isCurrentLayout,
  loadTask,
  planDetailsText,
  type Task,
} from "../task/store.ts"
import { codeDiff } from "../verification.ts"
import { refused } from "./refusal.ts"
import { base, type NextPayload } from "./shared.ts"

export async function showMePayload(
  ctx: Ctx,
  task: Task | null,
  topic: string,
): Promise<NextPayload> {
  const name = showMeName(topic)
  const page =
    task !== null
      ? {
          page: join(task.dir, "artifacts", `${name}.html`),
          create: `qualitylayer artifact new ${name} --purpose ${JSON.stringify(`Show me: ${topic}`)}`,
          show: `qualitylayer artifact show ${name}`,
        }
      : {}
  if (task !== null) await appendEvent(ctx, task, { event: "show_me", topic })
  return {
    ...(task !== null ? { task: task.slug, stage: task.stage } : {}),
    phase: "show-me",
    topic,
    instructions: phaseText("show-me"),
    ...page,
    done: true,
  }
}

/** Shipped tasks whose ship step was not announced yet, newest first. */
export async function waitingShips(
  ctx: Ctx,
  repo: RepoRef,
): Promise<
  { slug: string; tasksDir: string; statePath: string; state: { announced?: boolean } }[]
> {
  const tasksDir = join(projectRuntimeDir(ctx, repo.id), "tasks")
  if (!(await ctx.fs.exists(tasksDir))) return []
  const waiting = []
  for (const slug of (await ctx.fs.readdir(tasksDir)).sort().reverse()) {
    const statePath = shipStatePath({ runtimeDir: join(tasksDir, slug) })
    if (!(await ctx.fs.exists(statePath))) continue
    const state = JSON.parse(await ctx.fs.readFile(statePath)) as { announced?: boolean }
    if (state.announced !== true) waiting.push({ slug, tasksDir, statePath, state })
  }
  return waiting
}

/** How long a ship step that nothing settled is handed out again to a repeated `ship`. */
const SHIP_REPEAT_MS = 15 * 60_000

/**
 * Shipped tasks whose ship step was announced a moment ago and is not settled: no pull request is
 * open and the person's choice at the approval is not recorded. A `ship` that repeats (the first
 * reply was cut off in the agent's output) gets the step again instead of the triage.
 */
async function unsettledShips(
  ctx: Ctx,
  repo: RepoRef,
): Promise<{ slug: string; tasksDir: string }[]> {
  const tasksDir = join(projectRuntimeDir(ctx, repo.id), "tasks")
  if (!(await ctx.fs.exists(tasksDir))) return []
  const found = []
  for (const slug of (await ctx.fs.readdir(tasksDir)).sort().reverse()) {
    const statePath = shipStatePath({ runtimeDir: join(tasksDir, slug) })
    if (!(await ctx.fs.exists(statePath))) continue
    const state = JSON.parse(await ctx.fs.readFile(statePath)) as {
      announced?: boolean
      announcedAt?: number
    }
    if (state.announced !== true || typeof state.announcedAt !== "number") continue
    if (ctx.clock.now() - state.announcedAt >= SHIP_REPEAT_MS) continue
    const shipped = await loadTask(ctx, repo, slug)
    if (shipped === null) continue
    if ((await readShipRecord(ctx, shipped)) !== null || (await storedUrl(ctx, shipped)) !== null)
      continue
    found.push({ slug, tasksDir })
  }
  return found
}

/** A task that shipped but whose PR description has not been handed to the agent yet. */
export async function pendingShip(
  ctx: Ctx,
  repo: RepoRef,
  selected?: string,
): Promise<NextPayload | null> {
  for (const { slug, tasksDir, statePath, state } of await waitingShips(ctx, repo)) {
    if (selected !== undefined && selected !== slug) continue
    await ctx.fs.writeFile(
      statePath,
      `${JSON.stringify({ ...state, announced: true, announcedAt: ctx.clock.now() }, null, 2)}\n`,
    )
    return shipPayload(ctx, repo, slug, tasksDir)
  }
  // Only a `ship` that names or resolves the shipped task repeats the step; a bare one finds none.
  if (selected === undefined) return null
  for (const { slug, tasksDir } of await unsettledShips(ctx, repo)) {
    if (selected !== slug) continue
    return shipPayload(ctx, repo, slug, tasksDir)
  }
  return null
}

async function shipPayload(
  ctx: Ctx,
  repo: RepoRef,
  slug: string,
  tasksDir: string,
): Promise<NextPayload> {
  const shipped = await loadTask(ctx, repo, slug)
  const descriptionFile =
    shipped !== null
      ? await pullRequestBodyFile(ctx, shipped)
      : join(tasksDir, slug, "pr-description.md")
  const description = (await ctx.fs.exists(descriptionFile))
    ? await ctx.fs.readFile(descriptionFile)
    : ""
  const since = shipped !== null ? await buildBase(ctx, shipped) : null
  return {
    task: slug,
    phase: "ship",
    done: true,
    instructions: phaseText("ship"),
    description,
    description_file: descriptionFile,
    ...(since !== null ? { diff: codeDiff(`${since}..HEAD`) } : {}),
    ...(shipped !== null ? await shipChoiceFields(ctx, shipped) : {}),
  }
}

/** How long the ship step waits for the App to finish opening the pull request it was asked for. */
const PULL_REQUEST_WAIT_MS = 45_000

const PULL_REQUEST_POLL_MS = 250

/**
 * What the person chose at the final approval in the App: the pull request is open (its address) or
 * could not be opened (the reason and the commands to run by hand), they chose Approve only, or they
 * push it themselves. The App writes the choice before it records the approval and opens the pull
 * request after, so a ship step that arrives first waits for the outcome instead of offering it.
 */
async function shipChoiceFields(ctx: Ctx, task: Task): Promise<Record<string, unknown>> {
  let record = await readShipRecord(ctx, task)
  const until = ctx.clock.now() + PULL_REQUEST_WAIT_MS
  while (record?.state === "opening" && ctx.clock.now() < until) {
    await ctx.clock.sleep(PULL_REQUEST_POLL_MS)
    record = await readShipRecord(ctx, task)
  }
  const url = (await storedUrl(ctx, task)) ?? record?.url ?? null
  if (
    record?.choice === "pull-request" &&
    url === null &&
    (record.state === "failed" || record.state === "opening")
  ) {
    const branch = await currentBranch(ctx, task.repoRoot)
    return {
      ship_choice: record.choice,
      pull_request_error:
        record.state === "failed"
          ? (record.error ?? "The pull request could not be opened.")
          : "Opening the pull request did not finish.",
      ...(branch !== null ? { pull_request_commands: await commandsFor(ctx, task, branch) } : {}),
    }
  }
  return {
    ...(record !== null ? { ship_choice: record.choice } : {}),
    ...(url !== null ? { pull_request: url } : {}),
  }
}

/**
 * The build starts in a checkout that lacks the Plan: copy the task's folder from the checkout that
 * planned it. Branches are the user's: nothing is merged or switched to bring the Plan here.
 */
export async function adoptPlan(
  ctx: Ctx,
  repo: RepoRef,
  requested: string | null,
): Promise<Result<boolean>> {
  const tasksDir = join(projectRuntimeDir(ctx, repo.id), "tasks")
  const slugs = (await ctx.fs.exists(tasksDir)) ? await ctx.fs.readdir(tasksDir) : []
  const candidates: { slug: string; from: string; into: string }[] = []
  for (const slug of requested === null
    ? slugs.sort()
    : slugs.filter((name) => name === requested)) {
    const marker = join(tasksDir, slug, "handoff.json")
    if (!(await ctx.fs.exists(marker))) continue
    if (await ctx.fs.exists(join(tasksDir, slug, "ship.json"))) continue
    const here = taskDir(repo.root, slug)
    if (await ctx.fs.exists(here)) continue
    let planDir: unknown = null
    try {
      planDir = (JSON.parse(await ctx.fs.readFile(marker)) as { planDir?: unknown }).planDir
    } catch {
      // an unreadable marker has no plan to copy
    }
    if (typeof planDir !== "string" || !isAbsolute(planDir) || planDir === here) continue
    const checkout = dirname(dirname(dirname(planDir)))
    if (taskDir(checkout, slug) !== planDir || !(await ctx.fs.exists(join(planDir, IDENTITY_FILE))))
      continue
    if ((await ctx.git.commonDir(checkout)) !== repo.commonDir) continue
    const task = await loadTask(ctx, { ...repo, root: checkout }, slug)
    if (task === null || !isCurrentLayout(task) || (await isArchived(ctx, task))) continue
    candidates.push({ slug, from: planDir, into: here })
  }
  if (candidates.length > 1)
    return refused(
      `${candidates.length} Plan handoffs are available in this repository. Name the task to build.`,
      candidates.map(({ slug }) => ({
        what: slug,
        move: `qualitylayer build start --task ${slug}`,
      })),
    )
  const [only] = candidates
  if (only === undefined) {
    if (requested === null) return ok(false)
    return refused(`No Plan handoff for ${requested} can be copied into this checkout.`, [
      {
        what: "the approved Plan in its planning checkout",
        move: "open the task in the App and choose a new worktree for the build",
      },
    ])
  }
  await cp(only.from, only.into, { recursive: true, force: false, errorOnExist: true })
  return ok(true)
}

// ------------------------------------------------------------- the pull request's triage

/** A check of the pull request that fails: its name, where GitHub shows it, and the command that reads its log. */
type FailingCheck = { name: string; url: string; log_command: string }

function failingChecksOf(record: PullRequestRecord): FailingCheck[] {
  return record.checks
    .filter((c) => c.result === "failed")
    .map((c) => {
      const url = /^https?:\/\//.test(c.detail) ? c.detail : ""
      const run = /\/actions\/runs\/(\d+)/.exec(url)?.[1]
      return {
        name: c.name,
        url,
        log_command:
          run !== undefined
            ? `gh run view ${run} --log-failed`
            : `gh pr checks ${record.number ?? record.url}`,
      }
    })
}

/**
 * A shipped task with open threads goes to the author's triage before anything else: one thread at
 * a time, nothing changed before they decide. Threads they agreed to fix are fixed once, rechecked,
 * and pushed by the person.
 */
async function triageStep(
  ctx: Ctx,
  task: Task,
  shipped: { failing: FailingCheck[]; committed: boolean },
): Promise<NextPayload | null> {
  const threads = (await readReview(ctx, task)).threads
  // The team's threads and the pull request's unresolved code comments.
  const undecided = (await openThreads(ctx, task)).filter((t) => t.needs_triage)
  const command = `qualitylayer review threads --task ${task.slug} --json`
  if (undecided.length > 0)
    return base(task, {
      phase: "review-triage",
      instructions: phaseText("review-triage"),
      open_threads: undecided.length,
      threads_command: command,
      then: command,
      ...(shipped.failing.length > 0 ? { failing_checks: shipped.failing } : {}),
    })
  const fixes = threads.filter(awaitsFix)
  // A shipped task's checks were passed long ago: what asks for a fix now is GitHub's word, and the
  // fix is made once, after which it is rechecked and pushed by the person.
  if ((fixes.length === 0 && shipped.failing.length === 0) || shipped.committed) return null
  return base(task, {
    phase: "review-fix",
    instructions: [
      "The author pushes the fix in the App and answers the reviewers: push nothing and reply to no one.",
      phaseText("review-triage") ?? "",
    ]
      .filter((p) => p !== "")
      .join("\n\n"),
    fixes: [
      ...fixes.map((t) => ({
        thread: t.id,
        decision: t.decision?.kind,
        note: t.decision?.note,
        said: t.messages.map((m) => `${m.by}: ${m.text}`),
      })),
      ...shipped.failing.map((c) => ({ check: c.name, url: c.url, log_command: c.log_command })),
    ],
    context: await contextOf(ctx, "review", task),
    then: `qualitylayer verify recheck --task ${task.slug}`,
  })
}

/**
 * The fixes the author agreed to are made and rechecked: their threads are settled here, and the
 * team's reviewers who asked for changes are asked to look again. Nothing is posted to GitHub.
 */
async function settleShippedFixes(ctx: Ctx, task: Task): Promise<void> {
  const state = await readReview(ctx, task)
  const due = state.threads.filter(awaitsFix)
  for (const thread of due) await sayInReview(ctx, task, { t: "resolve", thread: thread.id })
  if (due.length === 0) return
  for (const reviewer of state.reviewers)
    if (reviewer.role === "team" && reviewer.state === "changes")
      await sayInReview(ctx, task, { t: "rereview", to: reviewer.email ?? reviewer.name })
}

/** What an agent on an approved task without an open pull request does now: it lands, or it landed. */
async function handedOver(ctx: Ctx, task: Task): Promise<string> {
  const landing = await landingView(ctx, task)
  if (landing === null || landing.state === "landed")
    return "The change has landed: the task is closed. Answer the person's questions; new work is a follow-up task they start with Start a follow-up."
  const where =
    landing.branch !== null && landing.base !== null ? ` (${landing.branch} → ${landing.base})` : ""
  return (
    `Approved; the change has not landed yet${where}. The conversation continues: do what the person asks ` +
    "(a merge, a push, a deploy, end-to-end tests, watching CI) on their words and your own permission prompts, never on your own. " +
    `A tweak they ask for: commit it with \`QUALITYLAYER_TASK=${task.slug} qualitylayer commit fix\`, never plain git, so their review shows it for their approval; rerun the checks it affects and name them; ` +
    "they approve it in the App header (Approve change), never say it is approved. New scope is a follow-up task. " +
    `A real problem in the approved scope: untick the card it belongs to in ${agentFileOf("implement")} (or add one) and run ` +
    `\`qualitylayer plan amend --task ${task.slug} --by agent --note "<what was found>"\`: the task reopens and is built and verified again. ` +
    "The task lands by itself when the merge is seen in Git, or when the person clicks Mark as merged."
  )
}

/**
 * A shipped task after its ship step: while its pull request is open, what GitHub says goes to the
 * author's triage (a thread, a failing check), then to one fix, then to a recheck of the project's
 * checks on the fixed code, and then it stops: the author pushes the fix in the App (or the agent
 * does, when they asked for it in the chat). Without a pull request it says whether the change has
 * landed. A merge or a close ends it.
 */
export async function shippedPayload(ctx: Ctx, task: Task): Promise<NextPayload> {
  const closed = { task: task.slug, done: true }
  const record = await followPullRequest(ctx, task)
  // No `gh`, or no pull request: QualityLayer's part ended at the approval, and the person's own
  // route takes the change on.
  if (record === null) return { ...closed, message: await handedOver(ctx, task) }
  const link = { pull_request: record.url }
  if (record.state === "merged")
    return {
      ...closed,
      ...link,
      merged: true,
      message: `The pull request is merged into ${record.base}: the task is closed.`,
    }
  if (record.state === "closed")
    return {
      ...closed,
      ...link,
      closed: true,
      message: `The pull request was closed without a merge. ${await handedOver(ctx, task)}`,
    }
  const failing = failingChecksOf(record)
  const ahead = await commitsAhead(ctx, task, record.head)
  const reviewing = await triageStep(ctx, task, { failing, committed: ahead > 0 })
  if (reviewing !== null) return { ...reviewing, ...link }
  if (ahead === 0)
    return { ...closed, ...link, message: "The pull request is open and nothing waits on you." }
  // A fix is committed: the project's checks run again on the new code before the author pushes it.
  const details = await planDetailsText(ctx, task)
  const checked =
    details === null ||
    projectChecks(details).length === 0 ||
    (await checksReadyForReview(ctx, task))
  if (!checked) {
    const files = await ctx.git.run(task.repoRoot, ["diff", "--name-only", `${record.head}..HEAD`])
    return base(task, {
      phase: "review-recheck",
      ...link,
      message:
        "The fix is committed; no project check is recorded on it yet. The author pushes it.",
      changed_files: files.code === 0 ? files.stdout.split("\n").filter(Boolean) : [],
      check_command: `qualitylayer check all --task ${task.slug}`,
      then: `qualitylayer verify recheck --task ${task.slug}`,
    })
  }
  await settleShippedFixes(ctx, task)
  return base(task, {
    phase: "review-fix",
    ...link,
    stop: "push the fix in the App",
    message: `The fix is committed and checked: ${ahead} ${ahead === 1 ? "commit" : "commits"} on ${task.branch ?? "the branch"} wait for the push. The author pushes it in the App with *Push the fix*.`,
    instructions:
      "The author pushes, replies and merges: tell them in one line that *Push the fix* waits on this task's page in the App, and end your turn. If they already asked you in the chat to push it, push the task's branch instead and say so.",
  })
}
