// The ungated utility commands: find, tasks, doctor, card, show, guide.

import { dirname } from "node:path"
import { isDevBuild, PHASES, phaseText } from "#workflow"
import { AGENT_NAMES } from "../../core/agents/ids.ts"
import { taskCost } from "../../core/cost/index.ts"
import type { TaskCost } from "../../core/cost/labels.ts"
import { taskTokenWarning } from "../../core/cost/token-warning.ts"
import { type Entry, parseDuration, scan } from "../../core/find/scan.ts"
import { launcherProblemText, readLauncherProblem } from "../../core/install/launcher-problem.ts"
import { type QuestionPicker, questionPickers } from "../../core/install/question-pickers.ts"
import { renderSkill } from "../../core/install/skills.ts"
import { showTopic } from "../../core/next.ts"
import { type RepoRef, resolveRepo } from "../../core/paths.ts"
import { checkoutLeaseStatus } from "../../core/run/lease.ts"
import { doctor, inspectInstalledMod } from "../../core/task/reconcile.ts"
import { isTerminal, listTasks, loadTask, type Task } from "../../core/task/store.ts"
import { taskCard } from "../../core/task-card.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { parseArgs, requireTask } from "./shared.ts"

export async function findCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const query = args.join(" ").trim()
  if (query === "") return err({ code: "bad_args", message: 'usage: qualitylayer find "<text>"' })
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return repo
  return ok({ results: await scan(ctx, repo.data, { query }) })
}

/** `tasks --cost` reads for at most this long, then reports the rest as pending. */
export const COST_BUDGET_MS = 20_000
const COST_PERIOD_MS = 30 * 86_400_000

/** A task's numbers as a script reads them: active time, all tokens, and usd where it can be priced. */
export type CostFigures = {
  usd: number | null
  active_ms: number
  tokens: number
  /** The App's token warning, while the task is at work and its tokens run well above the usual. */
  token_warning?: string
}

export type CostRow = Entry & { cost: CostFigures | null }

async function readEntryCost(
  ctx: Ctx,
  repo: RepoRef,
  entry: Entry,
  read: (ctx: Ctx, task: Task) => Promise<TaskCost>,
): Promise<CostFigures | null> {
  // `path` is `<checkout>/docs/plans/<slug>`: the task is read from the checkout that holds it.
  const task = await loadTask(
    ctx,
    { root: dirname(dirname(dirname(entry.path))), id: repo.id },
    entry.task,
  )
  if (task === null) return null
  try {
    const { total } = await read(ctx, task)
    // A model without a price makes the figure unknown, as the App's shipped summary does.
    const unpriced = total.usd === null || (total.unpriced ?? []).some((row) => row.tokens > 0)
    const cost: CostFigures = {
      usd: unpriced ? null : total.usd,
      active_ms: total.ms,
      tokens: total.all,
    }
    // The App's one quiet warning, for a task still at work.
    const warning = await taskTokenWarning(ctx, task, { total }).catch(() => null)
    if (warning !== null) cost.token_warning = warning.text
    return cost
  } catch {
    // records that cannot be read leave this task without a cost; the others go on
    return null
  }
}

/**
 * Each task of `entries` (newest first) with its cost. `taskCost` has no deadline of its own, so
 * the command keeps the bound: the clock is read before each task, and once `budgetMs` is spent the
 * tasks not reached come back with `cost: null` and are counted as pending. What was read is kept in
 * the cost ledger, so asking again goes faster. A v11 plan or a task that cannot be read has no
 * records to read: its cost is null and it is not pending.
 */
export async function costRows(
  ctx: Ctx,
  repo: RepoRef,
  entries: Entry[],
  options: { budgetMs?: number; read?: (ctx: Ctx, task: Task) => Promise<TaskCost> } = {},
): Promise<{ tasks: CostRow[]; complete: boolean; pending: number }> {
  const budgetMs = options.budgetMs ?? COST_BUDGET_MS
  const read = options.read ?? taskCost
  const start = ctx.clock.now()
  const tasks: CostRow[] = []
  let pending = 0
  let spent = false
  for (const entry of entries) {
    if (entry.flow !== "current") {
      tasks.push({ ...entry, cost: null })
      continue
    }
    spent = spent || ctx.clock.now() - start >= budgetMs
    if (spent) {
      pending++
      tasks.push({ ...entry, cost: null })
      continue
    }
    tasks.push({ ...entry, cost: await readEntryCost(ctx, repo, entry, read) })
  }
  return { tasks, complete: pending === 0, pending }
}

export async function tasksCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const { flags } = parseArgs(args, ["status", "since"])
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return repo
  const withCost = flags.cost === true
  let sinceMs: number | undefined = withCost ? COST_PERIOD_MS : undefined
  if (typeof flags.since === "string") {
    const parsed = parseDuration(flags.since)
    if (parsed === null)
      return err({ code: "bad_args", message: "--since takes a duration like 12h, 30d or 2w" })
    sinceMs = parsed
  }
  const status = typeof flags.status === "string" ? flags.status : undefined
  const entries = await scan(ctx, repo.data, { status, sinceMs })
  if (!withCost) return ok({ tasks: entries })
  // The bound can be set from the environment (tests and the acceptance run use 0).
  const given = ctx.env.get("QUALITYLAYER_COST_BUDGET_MS")
  const budgetMs = given === undefined || given.trim() === "" ? Number.NaN : Number(given)
  return ok(
    await costRows(
      ctx,
      repo.data,
      entries,
      Number.isFinite(budgetMs) && budgetMs >= 0 ? { budgetMs } : {},
    ),
  )
}

/** One line per installed agent: `Codex: question picker off (default_mode_request_user_input = false in …)`. */
function questionPickerLine({ agent, state, reason }: QuestionPicker): string {
  const text =
    state === "ready"
      ? "question picker ready"
      : state === "off"
        ? `question picker off (${reason})`
        : "questions are numbered choices"
  return `${AGENT_NAMES[agent]}: ${text}`
}

export async function doctorCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const mod = await inspectInstalledMod(ctx)
  if (mod !== null)
    return err({
      code: "state_mismatch",
      message: mod,
      stored: "installed mod",
      found: "hooks/register.tsx differs from the shipped hook",
      fix: "qualitylayer install --refresh",
    })
  const repair = args.includes("--repair") || args.includes("--yes")
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return repo
  const open = (await listTasks(ctx, repo.data)).filter((t) => !isTerminal(t.stage))
  const reports = []
  for (const task of open) reports.push(await doctor(ctx, task, repair))
  const { holders, issues: leases } = await checkoutLeaseStatus(ctx, repo.data.root, repair)
  // A hook that could not reach the App stayed silent; this is where the person learns of it.
  const launcher = await readLauncherProblem(ctx)
  const pickers = await questionPickers(ctx)
  return ok({
    consistent: reports.every((r) => r.consistent) && leases.length === 0,
    reports,
    leases,
    checkout_holders: holders,
    launcher,
    question_pickers: pickers,
    message: [
      reports.length === 0
        ? "no open task in this repository"
        : reports.map((r) => r.message).join("\n"),
      ...holders.map((holder) => holder.message),
      ...pickers.map(questionPickerLine),
      ...(launcher !== null ? [launcherProblemText(launcher)] : []),
    ].join("\n"),
  })
}

/** `card T<n>`: one task card and the contract sections it names, read-only. */
export async function cardCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const id = args[0]
  if (id === undefined || !/^T\d+$/i.test(id)) {
    return err({ code: "bad_args", message: "usage: qualitylayer card T<n>" })
  }
  const task = await requireTask(ctx)
  if (!task.ok) return task
  const card = await taskCard(ctx, task.data, id)
  if (!card.ok) return card
  const { card: text, contract, unresolved, pages } = card.data
  return ok({
    task: card.data.id,
    card: text,
    contract,
    ...(unresolved.length > 0 ? { unresolved } : {}),
    ...(pages.length > 0 ? { artifact_pages: pages } : {}),
  })
}

/**
 * `guide`: the skill's rules as plain text, for a session the user started
 * with a goal that names QualityLayer. The user's own prompt is the opt-in, so
 * the agent needs no skill it may not load itself.
 */
export function guideText(): string {
  const script = process.argv[1] ?? ""
  const binary = script.endsWith(".ts") ? `bun run ${script}` : process.execPath
  const body = renderSkill(binary).replace(/^---\n[\s\S]*?\n---\n/, "")
  return (
    "QualityLayer's rules for this session, the same the ql-workflow skill carries. The user asked " +
    "for this work in their own prompt; follow these rules for it.\n" +
    body
  )
}

/**
 * `show <topic>`: a text on demand. A development build prints a phase by its name; any other topic
 * is the "show me" view, a page drawn for the person about it, at any stage, without moving the task.
 */
export async function showCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const topic = args.join(" ").trim()
  if (topic === "")
    return err({
      code: "bad_args",
      message: `usage: qualitylayer show <topic>${isDevBuild ? ` | show <${PHASES.join(" | ")}>` : ""}`,
    })
  const text = isDevBuild && args.length === 1 ? phaseText(topic) : undefined
  if (text !== undefined) return ok({ phase: topic, instructions: text })
  return showTopic(ctx, topic)
}
