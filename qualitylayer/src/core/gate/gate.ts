// A gate is a file. open() validates first and writes gate.json; wait() is a
// bounded watch in short slices; record() is the single writer of decisions
// (the chat's `gate decide` and the App's button both end here); settle()
// applies a decision exactly once, through `wait`, a verb (`build start`, `ship`) or the App; `next`
// only reads it. Two targets: the Plan (01-plan.md, before any code) and `final`.

import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { agentSession, detectAgent } from "../agents/detect.ts"
import { recordAttestation } from "../attestations.ts"
import type { CrossReviewPoint } from "../config.ts"
import { confirmQuestionOf } from "../confirm-ask.ts"
import { patchFrontmatter } from "../docs/frontmatter.ts"
import { grantAtApproval } from "../docs/grant.ts"
import { NAMES } from "../docs/names.ts"
import { validateDoc } from "../docs/validate.ts"
import { leftWords, soFarWords, timeLeft } from "../estimate.ts"
import { outsideBuild, planningRun } from "../handoff/outside.ts"
import { runningNow } from "../helpers.ts"
import {
  answerLabel,
  changeCount,
  type DecidedItem,
  type FormalRequestChanges,
  flattenItems,
  openCount,
  targetOf,
} from "../items.ts"
import { WorkflowStateBusy } from "../lock-busy.ts"
import { type OpenItem, openItemsOf } from "../open-items.ts"
import { refreshPages } from "../pages/refresh.ts"
import { resolveRepo } from "../paths.ts"
import { FRESH_COMMENTS_THEN, takePlanningComments } from "../planning-comments.ts"
import { ANNOTATION_RECORD_BYTES, jsonBytes } from "../records/contract.ts"
import { readOptionalRecordBytes, writeRecordText } from "../records/files.ts"
import { missingCheckError, missingFromPlan } from "../required-lines.ts"
import {
  couldNotRunLead,
  crossReviewStep,
  handleOf,
  lockReason,
  PLAN_REVIEW_HANDOFF,
  planReviewWork,
  pointFor,
  type ReviewHandle,
  readRun,
  reviewerOf,
  startReview,
  unanimousKeptLine,
} from "../review/cross.ts"
import {
  type PlanReviewCoverage,
  planReviewCoverage,
  planReviewCoverageNote,
} from "../review/plan-input.ts"
import { fixesBuilt } from "../review/triage.ts"
import { hasReviewCandidate, selectedReviewCandidate } from "../review-candidate.ts"
import { listRuns } from "../run/registry.ts"
import { applyOverrides } from "../scaling.ts"
import {
  clearShipRecord,
  readShipRecord,
  type ShipChoice,
  writeShipRecord,
} from "../ship/choice.ts"
import {
  type ClosingPass,
  closeTask,
  closingReadyPath,
  passedCommit,
  publishClosingRecord,
  shipStatePath,
} from "../ship/closing-record.ts"
import { pullRequestPossible } from "../ship/pull-request.ts"
import { isAdopted, ORIGINAL_CHANGED, originalIntact } from "../task/adoption.ts"
import { currentTaskRecordOwner } from "../task/answer-migration.ts"
import { isArchived } from "../task/archive.ts"
import { matchesChatQuestion, TERMINAL_YOUR_TURN, terminalTaskFor } from "../task/chat-questions.ts"
import { settleProfile } from "../task/intake-profile.ts"
import { taskItems } from "../task/items.ts"
import { advance } from "../task/machine.ts"
import { consumePickedCall } from "../task/picked-calls.ts"
import { approvalAsked, chatApproval } from "../task/prompts.ts"
import { answerQuestion, openQuestion, requestMore } from "../task/question.ts"
import { batchReceipts, readBatch } from "../task/question-batch.ts"
import type { SessionProof } from "../task/session-proof.ts"
import { approvesInAgent } from "../task/sides.ts"
import { verifyModeOf } from "../task/stages.ts"
import {
  appendEvent,
  isTerminal,
  listTasks,
  loadTask,
  patchReadme,
  readEvents,
  readmeFrontmatter,
  type Task,
  touchSession,
} from "../task/store.ts"
import { readVerifyMode } from "../task/verify-mode.ts"
import { asComment, takenSince, takeTeam } from "../team/comments.ts"
import { passStanding, readAssignment, verificationContextRevision } from "../verification.ts"
import { type WaitEvent, waitFor } from "../wait.ts"
import { writeBaseline } from "./baseline.ts"
import {
  addAnswers,
  addComment,
  type Comment,
  deliver,
  delivered,
  putItemAnswer,
  REVIEW_QUESTIONS_THEN,
  readComments,
  resolveComments,
  takeImmediate,
  takeReviewQuestions,
} from "./comments.ts"
import { writeDecided } from "./decided.ts"
import { lockPath } from "./lock.ts"
import { snapshotPlan } from "./plan-diff.ts"
import {
  approvalFields,
  buildRevision,
  documentRevision,
  gateRevision,
  reviewTargets,
} from "./revision.ts"

/** One wait call blocks at most this long: under every agent's command timeout. */
export const SLICE_MS = 100_000
/** After this, waiting stops and the decision is picked up by the next `qualitylayer`. */
export const TOTAL_CAP_MS = 30 * 60_000
/** While a helper runs, a foreground wait returns this often with a status line; tests shorten it. */
export const STATUS_MS = 60_000

/** How long one wait blocks; a test that waits for it to run out shortens it. */
export function sliceMs(ctx: Ctx): number {
  const override = Number(ctx.env.get("QUALITYLAYER_GATE_SLICE_MS"))
  return Number.isFinite(override) && override > 0 ? override : SLICE_MS
}

function statusIntervalMs(ctx: Ctx): number {
  const override = Number(ctx.env.get("QUALITYLAYER_STATUS_INTERVAL_MS"))
  return Number.isFinite(override) && override > 0 ? override : STATUS_MS
}

const statusPath = (task: Pick<Task, "runtimeDir">) => join(task.runtimeDir, "gate-status.json")

/**
 * The one line for the user while something runs beside the open gate, or null when nothing does
 * or when it is the line the last wait already handed over.
 */
async function statusLine(ctx: Ctx, task: Task, now: number): Promise<string | null> {
  const running = await runningNow(ctx, task)
  if (running.length === 0) return null
  const parts: string[] = []
  const helpers = running.filter((r) => r.kind === "helper")
  const rows = [
    ...running
      .filter((r) => r.kind === "review")
      .map((r) => ({ name: r.label ?? "Review", row: r })),
    ...(helpers[0] !== undefined
      ? [{ name: helpers.length === 1 ? "A helper" : `${helpers.length} helpers`, row: helpers[0] }]
      : []),
  ]
  for (const { name, row } of rows) {
    if (row.started === null) {
      parts.push(`${name} still running`)
      continue
    }
    const elapsed = now - row.started
    parts.push(
      `${name} still running, ${soFarWords(elapsed)}, ${leftWords(timeLeft(row.typical, elapsed))}`,
    )
  }
  let last: string | null = null
  try {
    const file = JSON.parse(await ctx.fs.readFile(statusPath(task))) as { line?: string }
    last = file.line ?? null
  } catch {
    // nothing handed over yet
  }
  const line = `${parts.join(". ")}.`
  if (line === last) return null
  await ctx.fs.atomicWrite(statusPath(task), `${JSON.stringify({ line, at: now })}\n`)
  return line
}

export const FINAL = "final"

/** The id prefix of an item only the person can confirm; the point follows it (`done:8`). */
const CONFIRM_ITEM = "verify:confirm:"

/** What the prompt hook tells the agent when it recorded the person's typed approval; the skill names it. */
export const CHAT_APPROVAL = "QualityLayer recorded your approval of"

const isDocument = (target: string) => target !== FINAL

export type GateFile = {
  id?: string
  revision?: string
  /** The evidence shown for this owned-code/approved-scope revision, independent of check results. */
  finalReview?: { schema: 1; code?: string; basis?: string }
  target: string
  opened: number
  decision: "pending" | "approved" | "changes"
  decided?: number
  /** Who decided: chat, cockpit, or policy (the stage is set not to stop). */
  by?: string
  /** The actual question/action receipt, when a question card or chat picker decided it. */
  origin?: GateDecisionOrigin
  requestChanges?: FormalRequestChanges
  settled?: boolean
  /** Opened while this review ran: Approve stays locked until the agent opens the gate again. */
  waitsFor?: CrossReviewPoint
  /** Gate revision captured when a completed review actually matched the Plan documents. */
  reviewed?: { revision: string; run: number }
  planReviewCoverage?: PlanReviewCoverage
  /** The agent session that opened it (null for an agent that names none): only a message typed in it approves by chat. */
  session?: string | null
  /** Recorded by the agent at the person's request (`--asked`): the words they typed. */
  asked?: string
  /** When the App first served this final gate open, so that Approve was on a page; chat approvals count after it. */
  shown?: number
  /**
   * Every id this task's final Review had before a refresh gave it a new one, oldest first: an
   * approval from a page that still shows one of them is an approval of this Review. All are kept
   * (one short id per opening): a page the person has open can show any of them.
   */
  earlier?: string[]
  /**
   * The commit the checkout was on when this Review opened, and the same for each earlier id where
   * it is known. A record of what each page showed; no approval, closing or push reads them.
   */
  head?: string
  earlierHeads?: Record<string, string>
  /** When each earlier id's opening opened, where known: what a picker shown for it is judged against. */
  earlierOpened?: Record<string, number>
  /** Approved outside: the reviewer, the pull or merge request and the Plan revision it covered. */
  outside?: OutsideApproval
  /** The earlier id the approving page showed, when it was not this gate's own: the Review the person had on screen. */
  approvedOn?: string
  /** The commit the Review on the approving page showed, where known. A record; `approvedHead` is what the approval covers. */
  shownHead?: string
  /**
   * The step the task was in when the person approved, when it had left Review for a recheck: the
   * approval stands on the Review they saw and closes the task from that step.
   */
  approvedDuring?: string
  /** The commit the checkout was on when the person approved the final Review: what the approval covers. */
  approvedHead?: string
  /**
   * How the person chose to ship with an approval saved during a recheck (`approvedDuring`): part
   * of their approval, kept here for the record; applying the approval makes it the ship record.
   */
  ship?: ShipChoice
}

const gateKey = (gate: GateFile): string => gate.id ?? String(gate.opened)

/** The Review ids a gate answers to: its own and every earlier one. */
const answersTo = (gate: GateFile, id: string): boolean =>
  id === gateKey(gate) || (gate.earlier ?? []).includes(id)

/**
 * Whether a review question is this gate's own. It names the gate's id, or none. The approval
 * question of the final Review (it names no item) is also this Review's when it names an earlier
 * id of it: it was put to the person on an earlier opening of the same Review, and their Approve
 * on it counts as the header button's does. An item question stays with the opening it was asked on.
 */
export const questionIsOf = (
  gate: Pick<GateFile, "id" | "opened" | "target" | "earlier">,
  question: { gateId?: string; item?: string },
): boolean =>
  question.gateId === undefined ||
  question.gateId === (gate.id ?? String(gate.opened)) ||
  (gate.target === FINAL &&
    question.item === undefined &&
    (gate.earlier ?? []).includes(question.gateId))

export type GateDecisionOrigin = {
  kind: "question"
  id: string
  number: number
  receipt: string
  action: string
}

export type GateOutcome =
  | {
      decision: "pending"
      again: true
      /** While a helper runs: the one line for the user, and that the gate is still open. */
      status?: string
      gate?: "open"
      then?: string
    }
  | {
      decision: "approved"
      next: string
      /** The answers and comments the person sent along with the approval, each with its item and kind. */
      notes?: Comment[]
      /** What to do with them; present with `notes`. */
      then?: string
      /** The Plan's approval in a task: how the approved Plan is changed from now on. */
      afterApproval?: string
    }
  | {
      decision: "changes"
      comments: Comment[]
      requestChanges?: FormalRequestChanges
      then: string
    }
  | { decision: "review-ready"; file: string; then: string }
  /** A planning gate is still open, and the person commented: answer, then wait again. */
  | { decision: "comments"; comments: Comment[]; then: string }
  | { decision: "timeout"; resume: string }

function gatePath(task: Pick<Task, "runtimeDir">): string {
  return join(task.runtimeDir, "gate.json")
}

export async function readGate(ctx: Ctx, task: Pick<Task, "runtimeDir">): Promise<GateFile | null> {
  const owner = await currentTaskRecordOwner(ctx, task)
  if (owner) {
    const bytes = await readOptionalRecordBytes(ctx, owner, "gate.json", ANNOTATION_RECORD_BYTES)
    return bytes
      ? (JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)) as GateFile)
      : null
  }
  const path = gatePath(task)
  if (!(await ctx.fs.exists(path))) return null
  try {
    return JSON.parse(await ctx.fs.readFile(path)) as GateFile
  } catch {
    return null
  }
}

async function writeGate(ctx: Ctx, task: Task, gate: GateFile): Promise<void> {
  const owner = await currentTaskRecordOwner(ctx, task)
  if (owner) return writeRecordText(ctx, owner, "gate.json", jsonBytes(gate))
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(gatePath(task), `${JSON.stringify(gate, null, 2)}\n`)
}

export { lockPath }

/** The review this decision answered was replaced by a newer one. */
function replaced(target: string): Result<never> {
  return err({
    code: "validation_failed",
    message: "This review was replaced by a newer one; decide on the current review.",
    errors: [
      {
        line: 1,
        rule: "review-replaced",
        message: "The decision refers to a review that is no longer open",
        fix_hint: gateOpenCommand(target),
        severity: "error",
      },
    ],
  })
}

/**
 * Expire an obsolete review through the same serialized writer as decisions. A final gate whose
 * decision is recorded is not obsolete: it stays for `settle` to apply.
 */
export async function invalidateGate(ctx: Ctx, task: Task): Promise<void> {
  await ctx.fs.withLock(lockPath(task), () => invalidateGateUnlocked(ctx, task))
}

async function invalidateGateUnlocked(ctx: Ctx, task: Task): Promise<void> {
  const gate = await readGate(ctx, task)
  if (gate?.target === FINAL && gate.decision !== "pending" && !gate.settled) return
  if (gate && !gate.settled) await writeGate(ctx, task, { ...gate, settled: true })
  await patchReadme(ctx, task, { gate: null })
}

/**
 * Where the person's review stands, read live under the caller's lock: `review` while Verify's pass
 * stands and the page is theirs (mode `yours`), `recheck` while the agents check again (Verify in any
 * other mode, or a follow-up at Implement), otherwise the stage itself.
 */
async function reviewPhase(ctx: Ctx, task: Task): Promise<"review" | "recheck" | string> {
  const stage = String((await readmeFrontmatter(ctx, task)).stage)
  if (stage === "implement") return "recheck"
  if (stage !== "verify") return stage
  return verifyModeOf(await readEvents(ctx, task), false) === "yours" ? "review" : "recheck"
}

/**
 * Whether the person's approval lands during a recheck: Verify rechecks by its record, or the
 * task's own sessions changed the code since the pass (`readVerifyMode`), so the approval claims
 * no pass.
 */
async function approvalPhase(ctx: Ctx, task: Task): Promise<"review" | "recheck" | string> {
  const phase = await reviewPhase(ctx, task)
  if (phase !== "review") return phase
  return (await readVerifyMode(ctx, { ...task, stage: "verify" })) === "rechecking"
    ? "recheck"
    : phase
}

/**
 * The person's review is checked again: their comment, a moved base or the agent's recheck. The
 * look for the person's approval and the reopening are one step under the lock approvals are saved
 * under: an approval is found here and stands (null, nothing reopens), or it is saved on the review
 * the person saw (`record`). The task stays in Verify; the record says it reopened.
 */
export async function reopenVerify(ctx: Ctx, task: Task): Promise<Result<Task> | null> {
  return ctx.fs.withLock(lockPath(task), async () => {
    const gate = await readGate(ctx, task)
    if (gate?.target === FINAL && gate.decision === "approved" && !gate.settled) return null
    // Already rechecking: nothing to reopen (null means only "an approval is saved").
    if ((await reviewPhase(ctx, task)) !== "review") return ok(task)
    // The final gate stays open: the person's approval during the recheck saves (Max, 10 Nov).
    await appendEvent(ctx, task, { event: "verify_reopened", from: "verify", to: "verify" })
    return ok(task)
  })
}

/** The gate target (the Plan's file, or "final") a gate may be opened on at the task's stage. */
export function expectedTarget(task: Task): string | null {
  if (task.stage === "verify") return FINAL
  if (task.stage === "plan") return PLAN_TARGET
  return null
}

/** The Plan gate's target is the Plan's file. */
const PLAN_TARGET = NAMES.plan

/** The command that opens a gate: its target is a word (`plan`, `final`), not the Plan's file name. */
export const gateOpenCommand = (target: string): string =>
  `qualitylayer gate open ${target === PLAN_TARGET ? "plan" : target}`

export const ONE_GATE = `This flow has one gate: \`${gateOpenCommand(PLAN_TARGET)}\``

export type OpenResult = {
  gateId: string
  wait: "qualitylayer wait"
  target: string
  opened: number
  message: string
  then: string
  /** The same wait, held until the decision: for an agent that waits in the background. */
  wait_background?: string
  /** The other agent's review of this document, started with the gate. */
  reviews?: ReviewHandle[]
  /** The questions the agent asks the person in its picker to decide the gate in the chat. */
  chat_review: ChatQuestion[]
  /** Ready input for the next confirmation batch; approval follows only after confirmations settle. */
  question_batch?: { id: string; title: string; questions: ChatQuestion[]; small?: string }
  approval_question?: ChatQuestion
  confirmations_remaining?: number
  your_turn?: string
}

/** One question of a gate's chat review: asked after `question show` with its `gate` and `item`. */
export type ChatQuestion = {
  /** The question's id in a `question ask --batch`: each entry passes through as it is. */
  id: string
  gate: string
  /** The open review the answer is recorded on. */
  gateId: string
  /** The Done means points it confirms; none for a decision or the approval. */
  points: number[]
  /** The decision it is about; none for the approval question that ends the review. */
  item?: string
  question: string
  lead?: string
  /** `words`: the choice asks what should change, so the App's card moves to the field (Change…). */
  choices: { label: string; detail?: string; words?: true }[]
}

const AGREE = "Agree"
const CHANGE = "Change"
/** A Your call's two options, labelled as the App's card labels them. */
const CALL_LETTERS = ["A", "B"] as const
const APPROVE = "Approve"
/** The final approval's ship choices, as the Review card's Approve menu names them. */
export const APPROVE_PULL_REQUEST = "Approve and open a pull request"
export const APPROVE_ONLY = "Approve only"
const REQUEST_CHANGES = "Request changes"

const CONFIRMED = "Confirmed"
const NOT_YET = "Not yet"

/**
 * What a point only the person can confirm asks in the chat: one short question in the second
 * person, the judge's own or built from the line it wrote (or the Plan's). The point's title alone
 * ("A session on Fable 5.1 is priced like the other Claude models") left a person asking what the
 * question was; the judge's paragraph about it is the lead, never the question.
 */
function confirmQuestion(item: { kind: string; what: string; ask?: string }): string | null {
  return item.kind !== "confirm" ? null : confirmQuestionOf(item.ask ?? "", item.what)
}

/** The lead under a chat question: its context, without the words the question already says. */
function leadOf(item: { why?: string; ask?: string }): string {
  const why = item.why ?? ""
  const said = (item.ask ?? "").trim()
  return said !== "" && why.startsWith(said) ? why.slice(said.length).trim() : why
}

/**
 * One question per engineering decision still open on the gate and per point only the person can
 * confirm, then the approval question.
 */
async function chatReview(ctx: Ctx, task: Task, target: string): Promise<ChatQuestion[]> {
  const open = await readGate(ctx, task)
  const gateId = open?.id ?? String(open?.opened ?? "")
  const items =
    target === FINAL
      ? []
      : flattenItems(await taskItems(ctx, task, open)).filter(
          (item) =>
            (item.kind === "decision" || item.kind === "confirm") &&
            targetOf(item.step) === target &&
            openCount([item]) > 0,
        )
  const asked = items.map((item) => ({
    id: `review-${item.id}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
    gate: target,
    gateId,
    points: [] as number[],
    item: item.id,
    question: confirmQuestion(item) ?? item.what,
    ...(item.why !== undefined && leadOf(item) !== "" ? { lead: leadOf(item) } : {}),
    choices:
      item.kind === "confirm"
        ? [{ label: CONFIRMED }, { label: NOT_YET }]
        : item.call !== undefined
          ? // A Your call offers its own options; the pick records the letter, as the App's card does.
            item.call.options.map((option, index) => ({
              label: `${CALL_LETTERS[index]}: ${option}`,
            }))
          : [{ label: AGREE }, { label: CHANGE, words: true as const }],
  }))
  // In the agent, the Plan's open Your calls come first: approval waits for their answers.
  if (approvesInAgent(task) && target === PLAN_TARGET)
    return [
      ...asked,
      {
        id: "review-approve-plan",
        gate: target,
        gateId,
        points: [],
        question: "Approve the Plan?",
        choices: [
          { label: "Approve Plan" },
          { label: "Give feedback" },
          { label: "Show the Plan" },
        ],
      },
    ]
  return [
    ...asked,
    ...(target === FINAL
      ? [
          {
            id: "review-approve-checked",
            gate: target,
            gateId,
            points: [] as number[],
            question: "Approve the change?",
            lead: "Approval accepts the reviewed change.",
            // Asked in the App's card, so there is no "review in the App first" any more. Where the
            // pull request can open, the card offers it as the Review card's Approve menu does.
            choices: [
              { label: APPROVE, detail: "Nothing is pushed" },
              ...((await pullRequestPossible(ctx, task))
                ? [
                    {
                      label: APPROVE_PULL_REQUEST,
                      detail: `Pushes ${task.branch ?? "the branch"} and opens it on GitHub`,
                    },
                  ]
                : []),
              { label: REQUEST_CHANGES, words: true as const },
            ],
          },
        ]
      : []),
  ]
}

/** The final review's questions for the agent's chat, when the task's approvals happen there. */
export async function finalChatReview(
  ctx: Ctx,
  task: Task,
): Promise<{ your_turn: string; chat_review: ChatQuestion[] } | null> {
  if (!approvesInAgent(task)) return null
  return { your_turn: TERMINAL_YOUR_TURN, chat_review: await chatReview(ctx, task, FINAL) }
}

/** Open a gate. Validates first; refuses with validation_failed. Every gate waits for the user. */
export async function open(ctx: Ctx, task: Task, target: string): Promise<Result<OpenResult>> {
  return ctx.fs.withLock(lockPath(task), () => openUnlocked(ctx, task, target))
}

/** Recover an existing review for the owner without requiring its original agent to reopen it. */
export async function ensureFinalReview(ctx: Ctx, task: Task): Promise<GateFile | null> {
  if (task.stage !== "verify" || (await isArchived(ctx, task))) return readGate(ctx, task)
  try {
    return await ctx.fs.withLock(lockPath(task), () => ensureFinalReviewUnlocked(ctx, task), {
      waitMs: READ_WAIT_MS,
    })
  } catch (cause) {
    // The task page reads this while a decision is applied under the same lock, and applying the final
    // approval (the closing record, git) holds it for as long as that takes: tens of seconds on a loaded
    // Windows runner, where every poll of the page waited out the lock and answered 500 "task_unreadable".
    // The gate as stored is what a read shows until the decision is in.
    if (!(cause instanceof WorkflowStateBusy)) throw cause
    return readGate(ctx, task)
  }
}

/** How long a read of the task waits for the gate lock before it shows the gate as stored. */
const READ_WAIT_MS = 3_000

async function ensureFinalReviewUnlocked(ctx: Ctx, task: Task): Promise<GateFile | null> {
  const stored = await readGate(ctx, task)
  // The phase as it is now, under the lock: a reader that loaded the task while the review was the
  // person's opens none once the agents check again (its gate stays as it was closed, for an approval
  // from the page that still shows it), nor over a task that shipped.
  const live = await reviewPhase(ctx, task)
  if (stored?.target === FINAL && stored.settled && live === "shipped") return stored
  if (live !== "review") return stored
  // A judge handed out after the pass and not ruled yet: Verify rechecks; the shown review stays.
  const handed = await readAssignment(ctx, task)
  if (handed !== null && handed.result !== "pass") return stored
  const previous = stored?.target === FINAL && !stored.settled ? stored : null
  // A recorded decision stays the gate until `settle` applies it: a read never replaces it.
  if (previous?.decision === "changes") return previous
  if (previous?.decision === "approved" && previous.finalReview?.code && previous.finalReview.basis)
    return previous
  let reading = ctx
  let revision = await gateRevision(reading, task, FINAL)
  if (previous?.finalReview && previous.revision !== revision) {
    reading = freshFinalContext(ctx)
    revision = await gateRevision(reading, task, FINAL)
  }
  const sameReview = previous?.finalReview && previous.revision === revision
  if (sameReview && previous.finalReview?.code && previous.finalReview.basis) return previous
  // An approval saved on other code than now stands as saved; only a pending Review is refreshed.
  if (previous?.decision === "approved" && !sameReview) return previous
  const code = await buildRevision(reading, task)
  const basis = await verificationContextRevision(reading, task)
  if (sameReview) {
    const migrated: GateFile = { ...previous, finalReview: { schema: 1, code, basis } }
    await writeGate(ctx, task, migrated)
    return migrated
  }
  if (revision !== (await gateRevision(reading, task, FINAL)))
    throw new Error("The owned change moved while Review was read. Refresh Review.")
  const changed = previous?.finalReview !== undefined && previous.revision !== revision
  const retired = stored?.target === FINAL && stored.settled ? stored : null
  if (retired?.decision === "approved") await retireFinalReviewUnlocked(ctx, task, retired)
  // The Review keeps every id its earlier openings had, a retired one's too, and the opening time
  // that named a Review written before reviews had ids: a page that still shows one approves this
  // Review.
  const before = previous ?? retired
  const id = changed ? randomUUID() : (previous?.id ?? randomUUID())
  const earlier = before
    ? [...new Set([...(before.earlier ?? []), gateKey(before)])].filter((known) => known !== id)
    : []
  // For the record: the commit each opening showed. Nothing decides on it; the approval covers the
  // code at the person's click (`approvedHead`).
  const head = !changed && previous?.head !== undefined ? previous.head : await headNow(ctx, task)
  const earlierHeads = {
    ...before?.earlierHeads,
    ...(before?.head !== undefined && gateKey(before) !== id
      ? { [gateKey(before)]: before.head }
      : {}),
  }
  // When each earlier opening opened: a picker shown for it is judged against that time, not
  // against this opening's (`identityOpenedAt`).
  const earlierOpened = {
    ...before?.earlierOpened,
    ...(before !== null && gateKey(before) !== id ? { [gateKey(before)]: before.opened } : {}),
  }
  const gate: GateFile = {
    id,
    revision,
    finalReview: { schema: 1, code, basis },
    target: FINAL,
    opened: changed ? ctx.clock.now() : (previous?.opened ?? ctx.clock.now()),
    decision: "pending",
    session: previous?.session ?? (await finalBuildSession(ctx, task)),
    ...(earlier.length > 0 ? { earlier } : {}),
    ...(head !== null ? { head } : {}),
    ...(Object.keys(earlierHeads).length > 0 ? { earlierHeads } : {}),
    ...(Object.keys(earlierOpened).length > 0 ? { earlierOpened } : {}),
  }
  await writeGate(ctx, task, gate)
  // The task log says once per opening that the Review waits for approval. It is a record of its own,
  // not `gate_opened`: readers of that name (the activity words of a task built outside the App) stay as they were.
  // `round` is the judged round the person reviews (the automation `task.verified` carries it).
  if (!previous || changed)
    await appendEvent(ctx, task, { event: "verify_ready", round: Math.max(task.iterations, 1) })
  await patchReadme(ctx, task, {
    gate: FINAL,
    ...(retired?.decision === "approved" ? { status: "verify" } : {}),
  })
  return gate
}

/** Preserve obsolete final authority before clearing its closing receipts; caller owns gate.lock. */
async function retireFinalReviewUnlocked(ctx: Ctx, task: Task, retired: GateFile): Promise<void> {
  const key = retired.id ?? String(retired.opened)
  const archived = (await readEvents(ctx, task)).some(
    (event) => event.event === "gate_superseded" && event.gate === key,
  )
  if (!archived) {
    const receipt = async (path: string) => {
      if (!(await ctx.fs.exists(path))) return null
      const text = await ctx.fs.readFile(path)
      try {
        return JSON.parse(text) as unknown
      } catch {
        return { unparsed: text }
      }
    }
    const [closing, shipped, pending] = await Promise.all([
      receipt(closingReadyPath(task)),
      receipt(shipStatePath(task)),
      receipt(join(task.runtimeDir, "closing-pending")),
    ])
    await appendEvent(ctx, task, {
      event: "gate_superseded",
      target: FINAL,
      gate: key,
      approvedReview: retired,
      ...(closing !== null ? { closingRecord: closing } : {}),
      ...(shipped !== null ? { shippingRecord: shipped } : {}),
      ...(pending !== null ? { pendingClosingRecord: pending } : {}),
    })
  }
  await ctx.fs.remove(closingReadyPath(task))
  await ctx.fs.remove(shipStatePath(task))
  const pending = join(task.runtimeDir, "closing-pending")
  if (
    (await reviewPhase(ctx, task)) !== "review" &&
    (await ctx.fs.exists(pending)) &&
    (await ctx.fs.readFile(pending)).trim() === retired.id
  )
    await ctx.fs.remove(pending)
}

async function finalBuildSession(ctx: Ctx, task: Task): Promise<string | null> {
  const current = agentSession(ctx.env)
  if (current) return current
  const outside = await outsideBuild(ctx, task)
  if (outside?.sessionId) return outside.sessionId
  const id = `${task.repoId}~${task.slug}`
  return (
    listRuns(ctx.home)
      .filter(
        (run) =>
          !planningRun(run) &&
          (run.taskRuntimeDir === task.runtimeDir ||
            run.task === id ||
            (run.purpose.kind === "task" && [task.slug, id].includes(run.purpose.task))),
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]?.nativeSession ?? null
  )
}

async function openUnlocked(ctx: Ctx, task: Task, target: string): Promise<Result<OpenResult>> {
  if (target !== FINAL && target !== PLAN_TARGET)
    return err({ code: "bad_args", message: ONE_GATE })
  // An agent that never ran `task set profile=…` gets the intake decision now, before the Plan's
  // approval stamp covers the front matter.
  if (target === PLAN_TARGET && task.stage === "plan") await settleProfile(ctx, task)
  if (target === FINAL && task.stage === "verify") {
    if ((await reviewPhase(ctx, task)) !== "review")
      return err({
        code: "bad_args",
        message:
          "The final gate opens when Verify's checks pass: the agents are still checking. Run `qualitylayer next` to see the moves.",
      })
    const gate = await ensureFinalReviewUnlocked(ctx, task)
    // The agents started checking again since this command loaded the task.
    if (gate === null || gate.settled === true)
      return err({
        code: "bad_args",
        message: "no gate can be opened: Verify is checking the change again",
      })
    if (gate.decision === "approved")
      return err({
        code: "bad_args",
        message:
          "The approval is already recorded; do not approve again. Run `qualitylayer ship` to complete it.",
      })
    return ok({
      gateId: gate.id ?? String(gate.opened),
      target: FINAL,
      opened: gate.opened,
      wait: "qualitylayer wait",
      message: "Review the change, give feedback or approve once.",
      your_turn: "Ready for code review and approval",
      then: "qualitylayer wait",
      chat_review: await chatReview(ctx, task, FINAL),
    })
  }
  const expected = expectedTarget(task)
  if (expected === null) {
    return err({ code: "bad_args", message: `no gate can be opened at stage "${task.stage}"` })
  }
  if (target !== expected) {
    return err({
      code: "bad_args",
      message:
        target === PLAN_TARGET || expected === PLAN_TARGET
          ? `${ONE_GATE}, opened in Plan; this task is at stage "${task.stage}"`
          : `at stage "${task.stage}" the gate opens on ${expected}, not ${target}`,
    })
  }

  // An adopted task's Plan maps the person's original: the gate does not open on a changed original.
  if (target === PLAN_TARGET && isAdopted(task) && !(await originalIntact(ctx, task)))
    return err({ code: "validation_failed", message: ORIGINAL_CHANGED, errors: [] })
  if (isDocument(target))
    for (const document of reviewTargets(target, task)) {
      const report = await validateDoc(ctx, task.dir, document, { runtimeDir: task.runtimeDir })
      if (!report.ok) return report
      if (!report.data.valid) {
        const errors = report.data.errors
        const count = errors.filter((e) => e.severity === "error").length
        return err({
          code: "validation_failed",
          message: `${target} has ${count} validation error(s); fix them and open the gate again`,
          errors,
        })
      }
    }

  // A required Project check the Plan does not name: the same check as plan draft's.
  if (target === PLAN_TARGET) {
    const missing = await missingFromPlan(ctx, task)
    if (missing.length > 0)
      return err({
        code: "validation_failed",
        message: `${target} does not name ${missing.length === 1 ? "a Project check" : `${missing.length} Project checks`} the instructions require; fix it and open the gate again`,
        errors: missing.map(missingCheckError),
      })
  }

  const targets = reviewTargets(target, task)
  const currentRecords = await currentTaskRecordOwner(ctx, task)
  const previousAnnotations = currentRecords ? [] : await delivered(ctx, task)
  const plainAgreements = previousAnnotations.filter(
    (comment) =>
      target === PLAN_TARGET &&
      targets.includes(comment.doc) &&
      comment.item !== undefined &&
      comment.kind === "agree" &&
      comment.remark.trim() === "" &&
      comment.answer === undefined &&
      comment.resolved === undefined,
  )
  if (plainAgreements.length)
    await resolveComments(
      ctx,
      task,
      plainAgreements.map((comment) => comment.id),
      "Kept as agreed.",
    )
  // An answered comment is done with: its reply stays on the item for the person to read.
  const pending = (currentRecords ? [] : await delivered(ctx, task)).filter(
    (c) => targets.includes(c.doc) && c.answer === undefined && c.resolved === undefined,
  )
  if (pending.length > 0) {
    return err({
      code: "bad_args",
      message:
        `${pending.length} review comment(s) on ${target} are still unresolved: ` +
        `${pending.map((c) => c.id).join(", ")}. Apply each, then run ` +
        `\`qualitylayer comments resolve <id…>\` (or \`all\`) and open the gate again.`,
    })
  }

  // The other agent's review starts now, beside the user's reading. The gate opens at
  // once; Approve waits until the review has ended and the agent opens the gate again.
  const point = pointFor(target)
  const step = point !== null ? await crossReviewStep(ctx, task, point) : null
  const review = step !== null ? await startReview(ctx, task, step) : null
  const plannerWork = target === PLAN_TARGET ? await planReviewWork(ctx, task) : null

  const now = ctx.clock.now()
  // Opened again, it is a new gate: a decision made on the older one is refused. A gate that still
  // waits stays one moment for the user, so it keeps the time it first opened.
  const standing = await readGate(ctx, task)
  const revision = await gateRevision(ctx, task, target)
  const waitsFor =
    plannerWork !== null && plannerWork.pending.length > 0
      ? ("plan" as const)
      : review !== null && review.state === "running"
        ? review.point
        : undefined
  // A gate that still waits, on the same revision and for the same work, is the same gate: opening
  // it again only to read its questions keeps the id those questions are answered against.
  const keptId =
    standing !== null &&
    standing.decision === "pending" &&
    standing.settled !== true &&
    standing.target === target &&
    standing.revision === revision &&
    standing.waitsFor === waitsFor
      ? standing.id
      : null
  const identity = {
    id: keptId ?? randomUUID(),
    revision,
  }
  const opened = keptId && standing !== null ? standing.opened : now
  const settledRun = review ?? (point !== null ? await readRun(ctx, task, point) : null)
  const coverage =
    target === PLAN_TARGET ? await planReviewCoverage(ctx, task, settledRun) : undefined
  const reviewed =
    settledRun === null || waitsFor !== undefined
      ? undefined
      : standing?.target === target &&
          standing.planReviewCoverage !== undefined &&
          standing.reviewed?.run === settledRun.started
        ? standing.reviewed
        : coverage === "current"
          ? { revision, run: settledRun.started }
          : undefined
  const shownCoverage =
    coverage === "current" && reviewed !== undefined && reviewed.revision !== revision
      ? "earlier"
      : coverage

  await writeGate(ctx, task, {
    ...identity,
    target,
    opened,
    decision: "pending",
    session: agentSession(ctx.env),
    ...(reviewed !== undefined ? { reviewed } : {}),
    ...(shownCoverage !== undefined ? { planReviewCoverage: shownCoverage } : {}),
    ...(review !== null && review.state === "running" ? { waitsFor: review.point } : {}),
    ...(plannerWork !== null && plannerWork.pending.length > 0
      ? { waitsFor: "plan" as const }
      : {}),
  })
  await patchReadme(ctx, task, { gate: task.stage })
  if (isDocument(target)) {
    const docPath = join(task.dir, target)
    await ctx.fs.writeFile(
      docPath,
      patchFrontmatter(await ctx.fs.readFile(docPath), { status: "review" }),
    )
  }
  await touchSession(ctx, task, detectAgent(ctx.env), "waiting")
  await appendEvent(ctx, task, { event: "gate_opened", target })
  const chat = await chatReview(ctx, task, target)
  const confirmations = chat.filter((question) => question.item !== undefined)
  const batch = confirmations.slice(0, 6)
  // A late answer the planner has not folded yet: the person waits on the planner, whose move it is.
  const folding =
    target === PLAN_TARGET && waitsFor === undefined ? await lateAnswerMove(ctx, task) : null
  const findingQuestion =
    plannerWork !== null && plannerWork.pending.length > 0
      ? await planReviewQuestionMove(ctx, task)
      : null
  return ok({
    gateId: identity.id,
    wait: "qualitylayer wait",
    // What stands, in a line: how to present the gate and ask its questions is the step's text.
    message:
      couldNotRunLead(review) +
      planReviewCoverageNote(shownCoverage) +
      (folding?.message ??
        findingQuestion?.message ??
        (approvesInAgent(task)
          ? `${TERMINAL_YOUR_TURN} Read the ${target === FINAL ? "change" : "Plan"} with qualitylayer read ${target === FINAL ? NAMES.verify : NAMES.plan} --lead.`
          : review?.state === "running"
            ? `${reviewerOf(review)} is reviewing ${target === FINAL ? "the change" : "the Plan"}; Approve unlocks once its findings are answered and the gate is opened again.`
            : plannerWork !== null && plannerWork.pending.length > 0
              ? `${reviewerOf(plannerWork.run)}'s review needs planner work in ${plannerWork.file}.${unanimousKeptLine(plannerWork.unanimousKept)}`
              : `${gateSubject(target)} is ready for the person in the App.`)),
    target,
    opened,
    ...(review !== null ? { reviews: [handleOf(task, review)] } : {}),
    chat_review: chat,
    ...(target === FINAL && !approvesInAgent(task)
      ? {
          ...(batch.length
            ? {
                question_batch: {
                  id: `review-${identity.id}`,
                  title: "Review the finished change",
                  questions: batch,
                  ...(batch.length < 3
                    ? { small: "These are the only remaining confirmations for this change." }
                    : {}),
                },
              }
            : {}),
          ...(chat.find((question) => question.item === undefined)
            ? { approval_question: chat.find((question) => question.item === undefined) }
            : {}),
          ...(confirmations.length > batch.length
            ? { confirmations_remaining: confirmations.length - batch.length }
            : {}),
        }
      : {}),
    ...(approvesInAgent(task)
      ? {
          your_turn: `${TERMINAL_YOUR_TURN} Read the ${target === FINAL ? "change" : "Plan"} with qualitylayer read ${target === FINAL ? NAMES.verify : NAMES.plan} --lead.`,
        }
      : {}),
    then: folding?.then ?? findingQuestion?.then ?? "qualitylayer wait --for approval",
    wait_background: "qualitylayer wait --for approval --until-decided",
  })
}

function gateSubject(target: string): string {
  return target === FINAL ? "The build" : target
}

export type Recorded = {
  target: string
  decision: string
  /** How many answers and comments went to the agent with this decision. */
  sent?: number
  /** The App's approval was recorded as changes: an unsent answer asks for one. */
  turned?: true
}

/**
 * Save a decision and nothing more: the first half of `record`. Single writer of gate.json
 * decisions. Every route a person decides by goes through `record`; this is exported for what
 * comes after a save that was cut off before it was applied (`settle` takes it up).
 */
export async function saveDecision(
  ctx: Ctx,
  task: Task,
  decision: "approved" | "changes",
  options: RecordOptions = {},
): Promise<Result<Recorded>> {
  return ctx.fs.withLock(lockPath(task), () => recordUnlocked(ctx, task, decision, options))
}

/**
 * Record a decision. The person's approval of the final Review closes the task at once, here, so
 * no route can differ: the App's button and question card, the agent's picker, their words in the
 * chat, their own terminal, in Review or during a recheck. It waits for no agent. A closing that
 * cannot run now is taken up by the next move (`settle` again); the approval is saved either way.
 */
export async function record(
  ctx: Ctx,
  task: Task,
  decision: "approved" | "changes",
  options: RecordOptions = {},
): Promise<Result<Recorded>> {
  const recorded = await saveDecision(ctx, task, decision, options)
  if (recorded.ok && recorded.data.decision === "approved" && recorded.data.target === FINAL) {
    const saved = await readGate(ctx, task)
    if (saved?.target === FINAL && saved.decision === "approved" && !saved.settled)
      await settle(ctx, task, saved, { app: options.by === "cockpit" }).catch(() => undefined)
  }
  return recorded
}

export type RecordOptions = {
  remark?: string
  by?: string
  /** The decision carries the answers the person left unsent, as an approval from the App does. */
  carryAnswers?: boolean
  gateId?: string
  /** The final owned-code/scope revision displayed by the App. */
  revision?: string
  origin?: GateDecisionOrigin
  /** The agent recorded it at the person's request: their words, as their last prompt holds them. */
  asked?: string
  /** The final approval's ship choice, for an approval saved during a recheck: it is kept with it. */
  ship?: ShipChoice
  /** The Plan was approved outside (a reviewed pull or merge request) by this named approver, for this revision. */
  outside?: OutsideApproval
}

/** An approving review outside QualityLayer: where, who, and the Plan revision it covers. */
export type OutsideApproval = {
  via: "github"
  url: string
  login: string
  name?: string
  revision: string
}

/** The covered items and the answers still drafts at an open gate. */
async function unsentAnswers(ctx: Ctx, task: Task, gate: GateFile, fromApp: boolean) {
  const targets = reviewTargets(gate.target, task)
  const covered = await coveredItems(ctx, task, gate, fromApp)
  // An answer to an item that no longer exists (its words changed, so its id did) counts for nothing.
  const unsent = (await readComments(ctx, task)).filter(
    (c) =>
      c.delivered !== true &&
      (c.authorityDigest === undefined ||
        (c.item !== undefined && covered?.[c.item]?.digest === c.authorityDigest)) &&
      targets.includes(c.doc) &&
      c.build === undefined &&
      (c.kind === undefined || c.item === undefined || covered === null || c.item in covered),
  )
  return { covered, unsent }
}

/** Whether an approval sent from the App now would be recorded as changes: an unsent answer asks for one. */
export async function approvalWouldAskChanges(ctx: Ctx, task: Task): Promise<boolean> {
  const gate = await readGate(ctx, task)
  if (gate === null || gate.settled === true || gate.decision !== "pending") return false
  if (gate.target === FINAL) return false
  const { unsent } = await unsentAnswers(ctx, task, gate, true)
  return changeCount(unsent.flatMap((c) => (c.kind !== undefined ? [{ kind: c.kind }] : []))) > 0
}

/** An approval that names a gate this task's final Review never had. */
const NOT_THIS_REVIEW =
  "That approval was sent from a page that does not show this task's Review. Reload the Verify page and approve there."
const PLAN_INVALID = "The Plan no longer validates. Fix it and reopen its gate before approving."
const PLAN_CHANGED = "The Plan changed after approval. Reopen its gate to review the current Plan."

async function validatedPlanRevision(ctx: Ctx, task: Task): Promise<string | null> {
  const revision = await gateRevision(ctx, task, PLAN_TARGET)
  if (isAdopted(task) && !(await originalIntact(ctx, task))) return null
  for (const document of reviewTargets(PLAN_TARGET, task)) {
    const report = await validateDoc(ctx, task.dir, document, { runtimeDir: task.runtimeDir })
    if (!report.ok || !report.data.valid) return null
  }
  return revision === (await gateRevision(ctx, task, PLAN_TARGET)) ? revision : null
}

/**
 * A late Plan answer the planner has not folded in yet: its batch, question, number and answer time,
 * and whether the planner has read it (`question reply` accepts only an answer it was handed).
 */
type Unfolded = { batch: string; id: string; number: number; at: number; read: boolean }

/**
 * Approve waits while the planner folds a late answer into the Plan: from the person's answer to a
 * `late` batch member until the agent's `question reply` for that answer (its receipt then reads
 * acted), so the person never approves a Plan text that is about to change.
 */
async function unfoldedLateAnswers(ctx: Ctx, task: Task): Promise<Unfolded[]> {
  let stored: unknown
  try {
    stored = JSON.parse(await ctx.fs.readFile(join(task.runtimeDir, "question-batches.json")))
  } catch {
    return []
  }
  if (!Array.isArray(stored)) return []
  type Member = { id?: unknown; late?: unknown; number?: unknown }
  type Stored = { id?: unknown; questions?: Member[]; cancelled?: Record<string, unknown> }
  // A receipt is `<batch>:<question>:<answered at>`; each late, standing member by its prefix.
  const late = new Map<string, { batch: string; id: string; number: number }>()
  for (const batch of stored as Stored[])
    for (const q of Array.isArray(batch?.questions) ? batch.questions : [])
      if (q?.late === true && typeof q.id === "string" && batch.cancelled?.[q.id] === undefined)
        late.set(`${String(batch.id)}:${q.id}:`, {
          batch: String(batch.id),
          id: q.id,
          number: Number(q.number),
        })
  if (late.size === 0) return []
  const unfolded = new Map<string, Unfolded>()
  for (const receipt of await batchReceipts(ctx, task)) {
    if (receipt.state === "acted") continue
    const cut = receipt.id.lastIndexOf(":") + 1
    const member = late.get(receipt.id.slice(0, cut))
    if (member !== undefined)
      unfolded.set(member.id, {
        ...member,
        at: Number(receipt.id.slice(cut)),
        read: receipt.state === "picked-up",
      })
  }
  return [...unfolded.values()].sort((a, b) => a.number - b.number)
}

const questionsNamed = (answers: Unfolded[]) =>
  answers.length === 1
    ? `question ${answers[0]?.number}`
    : `questions ${answers
        .slice(0, -1)
        .map((a) => a.number)
        .join(", ")} and ${answers.at(-1)?.number}`

/** The command that records what the planner did with an answer, as the batch replies name it. */
export const questionReplyCommand = (id: string, answerAt: number) =>
  `qualitylayer question reply ${id} --text "<what you did>" --answer-at ${answerAt}`

/** Why the person cannot approve the Plan yet because a late answer waits to be folded; null when none. */
export async function lateAnswerLock(ctx: Ctx, task: Task): Promise<string | null> {
  const answers = await unfoldedLateAnswers(ctx, task)
  if (answers.length === 0) return null
  return `Approve waits until the planner has folded your answer to ${questionsNamed(answers)}.`
}

/** When the person sent the latest late answer the planner has not folded in yet; null when none waits. */
export async function lateAnswerAt(ctx: Ctx, task: Task): Promise<number | null> {
  const answers = await unfoldedLateAnswers(ctx, task)
  return answers.length === 0 ? null : Math.max(...answers.map((a) => a.at))
}

/** The command that hands the planner a batch's saved answers, as the answer notice names it. */
const batchPollCommand = (batch: string) => `qualitylayer question poll --batch ${batch} --json`

/** An open question already linked to the Plan review, for the agent's next move. */
export async function planReviewQuestionMove(
  ctx: Ctx,
  task: Task,
): Promise<{ message: string; then: string } | null> {
  const batch = await readBatch(ctx, task)
  const single = await openQuestion(ctx, task)
  for (const question of [...(batch?.questions ?? []), single]) {
    const finding = question?.settles?.find((item) => /^plan:finding:\d+$/.test(item))
    if (question && finding)
      return {
        message: `Plan review finding ${finding.slice("plan:finding:".length)} waits for the answer to question ${question.id}.`,
        then: "qualitylayer wait --for answer",
      }
  }
  return null
}

/**
 * The planner's side of that lock: the person waits on it, not the other way round. The sentence
 * for its reply and the `then` it can run now: reading each batch with an answer it has not read,
 * first, then recording each fold it can record; null when no late answer waits.
 */
export async function lateAnswerMove(
  ctx: Ctx,
  task: Task,
): Promise<{ message: string; then: string } | null> {
  const answers = await unfoldedLateAnswers(ctx, task)
  if (answers.length === 0) return null
  const one = answers.length === 1
  const unread = answers.filter((a) => !a.read)
  const reads = [...new Set(unread.map((a) => batchPollCommand(a.batch)))]
  const replies = answers.filter((a) => a.read).map((a) => questionReplyCommand(a.id, a.at))
  return {
    message:
      `The person's ${one ? "answer" : "answers"} to ${questionsNamed(answers)} ${one ? "is" : "are"} saved; Approve stays locked until you fold ${one ? "it" : "them"} into the Plan. ` +
      (unread.length > 0
        ? `Read ${unread.length === 1 ? "the new answer" : "the new answers"} with \`then\` first, fold ${unread.length === 1 ? "it" : "each"} in, and record what you did with \`qualitylayer question reply <id> --text "<what you did>" --answer-at <receipt.saved>\`, also when the Plan does not change.`
        : "Record each with `then`, also when the Plan does not change."),
    then: [...reads, ...replies].join("; "),
  }
}

/** Fresh action validation; do not run all document rules on every App status poll. */
export async function planApprovalLock(
  ctx: Ctx,
  task: Task,
  gate: GateFile,
): Promise<string | null> {
  if (gate.target !== PLAN_TARGET || gate.settled === true) return null
  const revision = await validatedPlanRevision(ctx, task)
  if (revision === null) return PLAN_INVALID
  if (gate.decision !== "approved") return null
  return gate.revision === revision ||
    (gate.revision !== undefined &&
      gate.revision === (await gateRevision(ctx, task, PLAN_TARGET, true)))
    ? null
    : PLAN_CHANGED
}

async function recordUnlocked(
  ctx: Ctx,
  task: Task,
  decision: "approved" | "changes",
  options: RecordOptions,
): Promise<Result<Recorded>> {
  let gate = await readGate(ctx, task)
  if (gate?.target === FINAL && decision === "approved" && (await hasReviewCandidate(ctx, task))) {
    const selected = await selectedReviewCandidate(ctx, task).catch(() => null)
    const assigned = await readAssignment(ctx, task)
    if (
      !selected ||
      assigned?.recovery !== selected.id ||
      assigned.result !== "pass" ||
      gate.finalReview?.code !== assigned.revision ||
      (options.gateId !== undefined && options.gateId !== gate.id) ||
      (options.revision !== undefined && options.revision !== gate.revision)
    )
      return err({
        code: "no_gate",
        message: "Open the finished review of the selected candidate before approving.",
      })
    task = { ...task, repoRoot: selected.choice.checkout }
  }
  if (
    gate?.target === FINAL &&
    gate.decision === "approved" &&
    decision === "approved" &&
    options.gateId === gate.id &&
    (options.revision === undefined || options.revision === gate.revision)
  )
    return ok({ target: FINAL, decision: "approved" })
  // The Review the person has on screen was sent back for a recheck (`next` at Review) before they
  // approved: their approval of it saves all the same. The App's page names one of this Review's
  // ids; words typed in the chat or at their terminal name none, and with nothing else open they
  // are for this Review too (the same person's approval, by another route).
  if (
    gate?.target === FINAL &&
    gate.settled === true &&
    gate.decision === "pending" &&
    decision === "approved" &&
    (options.gateId === undefined || answersTo(gate, options.gateId))
  ) {
    const closed = gate
    const stage = String((await readmeFrontmatter(ctx, task)).stage)
    const phase = await reviewPhase(ctx, task)
    if (phase === "recheck") return approveDuringRecheck(ctx, task, closed, stage, options)
    // The review is the person's again with nothing open: it opens again and takes the approval below.
    if (phase === "review")
      gate =
        (await ensureFinalReviewUnlocked(ctx, { ...task, stage: "verify" }).catch(() => null)) ??
        closed
  }
  // The final gate stays open while Verify rechecks (`verify_reopened`): the person's approval of
  // it saves on the review they saw and says the recheck had not finished.
  if (
    gate?.target === FINAL &&
    gate.settled !== true &&
    gate.decision === "pending" &&
    decision === "approved" &&
    (options.gateId === undefined || answersTo(gate, options.gateId))
  ) {
    const stage = String((await readmeFrontmatter(ctx, task)).stage)
    if ((await approvalPhase(ctx, task)) === "recheck")
      return approveDuringRecheck(ctx, task, gate, stage, options)
  }
  if (gate === null || gate.settled === true) {
    return err({ code: "no_gate", message: "nothing is open for approval on this task" })
  }
  // The approval of the Review is the person's to give and always saves (Max, 10 November 2026):
  // an earlier opening of the same review, code that moved since the judge ruled or a recheck
  // under way never refuse it. Every approval that reaches here is the person's: the App's button,
  // their typed words or pick as the agent's hook read them, or their own terminal. An agent's
  // command cannot approve (`gate decide` refuses it before this). The page says what was checked.
  const personsFinal = decision === "approved" && gate.target === FINAL
  // "An earlier opening of the same review" is an id this Review had. Another gate's id (the Plan's,
  // another task's, an unknown one) is no approval of this Review; an approval that names no gate
  // (typed in the chat) is for the one that is open.
  if (personsFinal && options.gateId !== undefined && !answersTo(gate, options.gateId))
    return err({ code: "no_gate", message: NOT_THIS_REVIEW })
  if (personsFinal && gate.decision === "approved") return ok({ target: FINAL, decision })
  if (
    !personsFinal &&
    options.gateId !== undefined &&
    options.gateId !== (gate.id ?? String(gate.opened))
  )
    return err({
      code: "no_gate",
      message: "that review is no longer open; use its current gate id",
    })
  const targets = reviewTargets(gate.target, task)
  const fromApp = options.by === "cockpit" || options.carryAnswers === true
  if (personsFinal && gate.decision === "pending" && !gate.finalReview)
    return err({ code: "review_pending", message: "The Review is still being written." })
  // The App collects answers and its main button sends them all: an approval from a tab that does
  // not know of an unsent answer asking for a change is recorded as changes, never over it. A
  // decision made in the agent's window (by chat) leaves unsent answers where they are, as comments.
  // What this decision covers, while the answers are still drafts: decided.json keeps it, so the
  // next revision is read against it (changed since your review).
  const { covered, unsent } = await unsentAnswers(ctx, task, gate, fromApp)
  // An Extra review the person added (Security review, Second opinion) is switched on with the
  // decision, as `task override +security` would: the checks of the task then include it.
  if (fromApp && gate.target !== FINAL && gate.decision === "pending") {
    const added = unsent
      .filter((c) => c.kind === "add-review")
      .map((c) => (c.remark === "second opinion" ? "+second-opinion" : "+security"))
    if (added.length > 0) {
      const overridden = applyOverrides(task.overrides, [...new Set(added)])
      if (overridden.ok) await patchReadme(ctx, task, { overrides: overridden.data })
    }
  }
  // I confirm on an item only the person can settle: what they confirmed is kept as theirs, outside
  // the build log. Answer in words goes to the agent instead, who records it.
  if (fromApp && gate.target !== FINAL && gate.decision === "pending") {
    for (const c of unsent) {
      if (c.kind !== "confirm" || c.item === undefined || !c.item.startsWith(CONFIRM_ITEM)) continue
      if (c.seen !== undefined && c.seen !== covered?.[c.item]?.digest) continue
      await recordAttestation(ctx, task, {
        item: c.item.slice(CONFIRM_ITEM.length),
        text: c.remark.trim() !== "" ? c.remark : "Confirmed in the App",
        by: "you",
      })
    }
  }
  let turned = false
  if (decision === "approved" && gate.target !== FINAL && fromApp && gate.decision === "pending") {
    const asking = changeCount(
      unsent.flatMap((c) => (c.kind !== undefined ? [{ kind: c.kind }] : [])),
    )
    if (asking > 0) {
      decision = "changes"
      turned = true
    }
  }
  let approvedRevision: string | undefined
  if (decision === "approved" && gate.target === PLAN_TARGET && gate.decision === "pending") {
    const revision = await validatedPlanRevision(ctx, task)
    if (revision === null) return err({ code: "review_pending", message: PLAN_INVALID })
    approvedRevision = revision
    // An approval given outside names the Plan revision it saw: a Plan changed since is not approved by it.
    if (options.outside !== undefined && options.outside.revision !== revision)
      return err({
        code: "review_pending",
        message: `${options.outside.name ?? options.outside.login} approved an earlier revision of the Plan; it changed since. Send the current Plan again (qualitylayer gate open plan --via ${options.outside.via}).`,
      })
  }
  // An approval of the change given outside names the commit it saw: code that moved since is not approved by it.
  if (
    decision === "approved" &&
    gate.target === FINAL &&
    gate.decision === "pending" &&
    options.outside !== undefined
  ) {
    const head = await headNow(ctx, task)
    if (head !== null && head !== options.outside.revision)
      return err({
        code: "review_pending",
        message: `${options.outside.name ?? options.outside.login} approved ${options.outside.revision.slice(0, 7)}; the change moved since (${head.slice(0, 7)}). Send it again (qualitylayer gate open final --via ${options.outside.via}).`,
      })
  }
  // A click from a tab that still shows an earlier opening of this review answers the open one.
  if (
    decision === "approved" &&
    gate.target !== FINAL &&
    gate.waitsFor !== undefined &&
    gate.decision === "pending"
  ) {
    // Opened while the other agent's review ran: Approve waits for it and for the agent's re-check.
    const run = await readRun(ctx, task, gate.waitsFor)
    return err({
      code: "review_pending",
      message:
        run !== null
          ? lockReason(run, ctx.clock.now())
          : "Approve unlocks when the second opinion is in",
    })
  }
  if (decision === "approved" && gate.target === PLAN_TARGET && gate.decision === "pending") {
    const work = await planReviewWork(ctx, task)
    if (work && work.pending.length > 0)
      return err({
        code: "review_pending",
        message: "The planning agent must process the completed review before Plan approval.",
      })
    const question = await openQuestion(ctx, task)
    // The gate's own final approval question is the decision being recorded.
    // Every other unanswered choice remains owned by the person.
    const finalQuestion = question?.gate === gate.target && question.item === undefined
    const batch = await readBatch(ctx, task)
    if (
      (question !== null && !finalQuestion) ||
      batch?.questions.some((q) => q.id !== question?.id || !finalQuestion)
    )
      return err({
        code: "review_pending",
        message: "Answer the open Plan questions before approving.",
      })
    const folding = await lateAnswerLock(ctx, task)
    if (folding !== null) return err({ code: "review_pending", message: folding })
    const required = flattenItems(await taskItems(ctx, task, gate)).filter(
      (item) =>
        item.step === "plan" &&
        (item.kind === "decision" ||
          item.kind === "mockup" ||
          (item.kind === "finding" && item.blocking)) &&
        !item.uncounted &&
        openCount([item]) > 0,
    )
    if (required.length)
      return err({
        code: "review_pending",
        message: "Answer the required Plan decisions before approving.",
      })
  }
  // The first recorded decision stays immutable. Settlement separately checks its approved inputs;
  // a stale tab or second click cannot replace it with a change request.
  if (gate.decision !== "pending") {
    return err({
      code: "no_gate",
      message: `this was already decided (${gate.decision}, by ${gate.by ?? "chat"})`,
    })
  }
  let handed: number | undefined
  if (decision === "changes") {
    // Every answer and comment of the targets goes to the agent, each with its item and kind.
    handed = unsent.length
    for (const target of targets) await deliver(ctx, task, target)
    // The team's comments on these documents go to the agent with the owner's decision.
    handed += (await takeTeam(ctx, task, targets)).length
  } else if (fromApp && unsent.length > 0) {
    // An approval from the App carries the unsent answers and comments as notes.
    for (const target of targets) await deliver(ctx, task, target)
    handed = unsent.length
  }
  if (
    decision === "approved" &&
    gate.target === FINAL &&
    (await readShipRecord(ctx, task)) === null
  )
    await writeShipRecord(ctx, task, { choice: "only" })
  const decidedAt = ctx.clock.now()
  const requestChanges: FormalRequestChanges | undefined =
    decision === "changes" && options.remark?.trim()
      ? {
          text: options.remark.trim(),
          at: decidedAt,
          by: options.by ?? "chat",
          ...(gate.id !== undefined ? { gate: gate.id } : {}),
          ...(gate.revision !== undefined ? { revision: gate.revision } : {}),
          ...(options.origin !== undefined ? { origin: options.origin } : {}),
        }
      : undefined
  if (
    approvedRevision !== undefined &&
    approvedRevision !== (await gateRevision(ctx, task, PLAN_TARGET))
  )
    return err({ code: "review_pending", message: PLAN_INVALID })
  await writeGate(ctx, task, {
    ...gate,
    ...(approvedRevision !== undefined ? { revision: approvedRevision } : {}),
    decision,
    decided: decidedAt,
    ...(requestChanges ? { requestChanges } : {}),
    by: options.by ?? "chat",
    ...(options.origin !== undefined ? { origin: options.origin } : {}),
    ...(options.asked !== undefined ? { asked: options.asked } : {}),
    ...(options.outside !== undefined ? { outside: options.outside } : {}),
    ...approvedOnOf(gate, decision, options),
    ...(await approvedHeadOf(ctx, task, gate, decision)),
  })
  // The Plan as the person saw it, so the next revision can show what changed.
  if (decision === "changes" && gate.target === PLAN_TARGET) await snapshotPlan(ctx, task)
  if (covered !== null || requestChanges) {
    await writeDecided(ctx, task, {
      ...(gate.id !== undefined ? { gate: gate.id } : {}),
      ...((approvedRevision ?? gate.revision) !== undefined
        ? { revision: approvedRevision ?? gate.revision }
        : {}),
      target: gate.target,
      at: decidedAt,
      by: options.by ?? "chat",
      decision,
      items: covered ?? {},
      ...(requestChanges ? { requestChanges } : {}),
    })
  }
  await appendEvent(ctx, task, {
    event: "gate_decided",
    target: gate.target,
    decision,
    by: options.by ?? "chat",
    ...(options.origin !== undefined ? { origin: options.origin } : {}),
    // The status line counts how many of these the agent has worked through.
    ...(handed !== undefined ? { comments: handed } : {}),
  })
  // A Plan approved in QualityLayer while its pull request waited on GitHub: the request is done.
  if (decision === "approved" && gate.target === PLAN_TARGET && options.outside === undefined)
    await import("../integrations/approval.ts")
      .then((outside) => outside.closeAfterApproval(ctx, task))
      .catch(() => undefined)
  return ok({
    target: gate.target,
    decision,
    ...(handed !== undefined && handed > 0 ? { sent: handed } : {}),
    ...(turned ? { turned: true as const } : {}),
  })
}

/** Which earlier opening the approving page showed, when it was not the gate's own. */
function approvedOnOf(
  gate: GateFile,
  decision: "approved" | "changes",
  options: RecordOptions,
): Pick<GateFile, "approvedOn" | "shownHead"> {
  if (decision !== "approved" || gate.target !== FINAL) return {}
  const named = options.gateId
  const earlier = named !== undefined && named !== gateKey(gate)
  // For the record only: the commit the Review on their page showed, where it is known.
  const shown = earlier ? gate.earlierHeads?.[named] : gate.head
  return {
    ...(earlier ? { approvedOn: named } : {}),
    ...(shown !== undefined ? { shownHead: shown } : {}),
  }
}

/**
 * The commit the checkout is on when the person approves the final Review: what their approval
 * covers. The closing record binds the approval to it, whenever the approval is applied; a commit
 * made after it is a change since the approval.
 */
async function approvedHeadOf(
  ctx: Ctx,
  task: Task,
  gate: GateFile,
  decision: "approved" | "changes",
): Promise<Pick<GateFile, "approvedHead">> {
  if (decision !== "approved" || gate.target !== FINAL) return {}
  const head = await headNow(ctx, task)
  return head !== null ? { approvedHead: head } : {}
}

/** The commit the checkout is on now; null when git cannot say. */
async function headNow(ctx: Ctx, task: Pick<Task, "repoRoot">): Promise<string | null> {
  try {
    const head = await ctx.git.run(task.repoRoot, ["rev-parse", "HEAD"], { fresh: true })
    const sha = head.code === 0 ? head.stdout.trim() : ""
    return sha !== "" ? sha : null
  } catch {
    return null
  }
}

/**
 * The final review that was reopened for a recheck, while the agents check again: no gate is open
 * then, and the person's approval is still for this review.
 */
export async function recheckedReview(ctx: Ctx, task: Task): Promise<GateFile | null> {
  const gate = await readGate(ctx, task)
  if (gate?.target !== FINAL || gate.settled !== true || gate.decision !== "pending") return null
  return (await reviewPhase(ctx, task)) === "recheck" ? gate : null
}

/**
 * The opening time a native pick is judged against: the pick's call must have been made after the
 * Review it was shown for opened. That is the gate's own opening, or, for the approval question
 * asked on an earlier opening of the same Review (`questionIsOf`), that earlier opening's: a
 * picker already on the person's screen when the Review refreshed is not refused for being older
 * than the refresh. Where the earlier opening's time was not kept (a gate file from before it
 * was), a legacy id is its own opening time; otherwise nothing is added and the question's own
 * time still bounds the pick (`openedAt`).
 */
function identityOpenedAt(
  gate: GateFile,
  question: { gateId?: string },
): { gateOpenedAt?: number } {
  const named = question.gateId
  if (named === undefined || named === gateKey(gate)) return { gateOpenedAt: gate.opened }
  const kept = gate.earlierOpened?.[named]
  if (typeof kept === "number" && Number.isFinite(kept)) return { gateOpenedAt: kept }
  return /^\d{10,16}$/.test(named) ? { gateOpenedAt: Number(named) } : {}
}

/**
 * The gate a review question's answer goes to: the open one, or, for the approval question itself
 * (it names no item), the final Review `next` sent back for a recheck. The question was put to the
 * person while that Review was open, so their Approve on it is their approval of it, on the App's
 * card and in the agent's picker as on the header button. The caller still checks that the
 * question is this gate's own (its target, id and session).
 */
export async function answerableGate(
  ctx: Ctx,
  task: Task,
  question: { item?: string } | null,
): Promise<GateFile | null> {
  const open = await openGate(ctx, task)
  if (open !== null || question === null || question.item !== undefined) return open
  return recheckedReview(ctx, task)
}

/**
 * Save the person's approval of a Review that `next` sent back for a recheck. It stays on that
 * Review (its id, revision and code as the person saw them) and says which step the task was in;
 * `settle` closes the task with it from that step, with no agent needed (the App's Approve applies
 * it at once).
 */
async function approveDuringRecheck(
  ctx: Ctx,
  task: Task,
  gate: GateFile,
  stage: string,
  options: RecordOptions,
): Promise<Result<Recorded>> {
  const { settled: _invalidated, ...review } = gate
  const by = options.by ?? "chat"
  await writeGate(ctx, task, {
    ...review,
    decision: "approved",
    decided: ctx.clock.now(),
    by,
    approvedDuring: stage,
    ...(options.ship !== undefined ? { ship: options.ship } : {}),
    ...(options.origin !== undefined ? { origin: options.origin } : {}),
    ...(options.asked !== undefined ? { asked: options.asked } : {}),
    ...approvedOnOf(gate, "approved", options),
    ...(await approvedHeadOf(ctx, task, gate, "approved")),
  })
  await appendEvent(ctx, task, {
    event: "gate_decided",
    target: FINAL,
    decision: "approved",
    by,
    during: stage,
    ...(options.origin !== undefined ? { origin: options.origin } : {}),
  })
  return ok({ target: FINAL, decision: "approved" })
}

/** What the final approval and the agent's next move both read, from one place. */
export type ReviewStanding = {
  /** The counted pass covers the code, the Plan and the deviations as they are, and no agreed fix is waiting for a fresh look. */
  passStands: boolean
  /** Nothing moved and nothing is left open: the person may approve. */
  settled: boolean
  /**
   * Review goes back to Verify: the pass no longer stands, or something an agent can settle is
   * open. False while only the person can settle what is open (a question, a need).
   */
  recheck: boolean
  /** What is open now. */
  open: OpenItem[]
  /** What moved and what is open, in words, for the refusal and the reply. */
  why: string
  /** The pass does not stand because the task's code moved since the judge ruled (not the Plan alone). */
  codeMoved: boolean
}

const OPEN_SHOWN = 3

/**
 * Whether Review stands, and if not, what holds it. Verify's "the pass stands" (next/verify.ts),
 * Review's `next` (next.ts) and the final approval (`record`) all ask this one function, so a task
 * is never sent to Review that Review would send back, or the other way round.
 */
export async function reviewStanding(ctx: Ctx, task: Task): Promise<ReviewStanding> {
  const pass = await passStanding(ctx, task)
  // Agreed fixes committed since the author decided are a fresh look at changed code.
  const fixes = pass.stands && (await fixesBuilt(ctx, task))
  const open = await openItemsOf(ctx, task)
  const people = open.some((item) => item.source === "need" || item.source === "question")
  const passStands = pass.stands && !fixes
  const settled = passStands && open.length === 0
  const moved = pass.stands
    ? fixes
      ? ["The fixes the author agreed to are committed"]
      : []
    : pass.moved
  const listed = open
    .slice(0, OPEN_SHOWN)
    .map((item) => item.text)
    .join("; ")
  const still =
    open.length === 0
      ? []
      : [
          `Still open: ${listed}${open.length > OPEN_SHOWN ? ` and ${open.length - OPEN_SHOWN} more` : ""}`,
        ]
  return {
    passStands,
    settled,
    recheck: !passStands || (!settled && !people),
    open,
    why: [...moved, ...still].join(". "),
    codeMoved: fixes || (!pass.stands && pass.moved.some((words) => /^The code\b/.test(words))),
  }
}

/**
 * What the closing record says of the judge's pass when the approval is applied: it covers the
 * approved code, or it was given on an earlier commit. The approval closes the task either way; a
 * pass that cannot be read now is not claimed, and neither is one whose recheck was `unfinished`
 * when the person approved (the task was back in Verify or Implement).
 */
async function passAtClosing(ctx: Ctx, task: Task, unfinished = false): Promise<ClosingPass> {
  try {
    const standing = await reviewStanding(freshFinalContext(ctx), task)
    if (standing.passStands && !unfinished) return { stands: true }
    // The commit of the last judgement that passed, not of a judge handed out since.
    return { stands: false, commit: await passedCommit(ctx, task), code: standing.codeMoved }
  } catch {
    return { stands: false, commit: null, code: true }
  }
}

/** The passing review covers the code and scope as they are, and nothing is left open. */
export async function reviewSettled(ctx: Ctx, task: Task): Promise<boolean> {
  return (await reviewStanding(ctx, task)).settled
}

function freshFinalContext(ctx: Ctx): Ctx {
  return {
    ...ctx,
    git: {
      commitPaths: (cwd, paths, message, authority) =>
        ctx.git.commitPaths(cwd, paths, message, authority),
      commonDir: (cwd) => ctx.git.commonDir(cwd),
      topLevel: (cwd) => ctx.git.topLevel(cwd),
      run: (cwd, args, options) => ctx.git.run(cwd, args, { ...options, fresh: true }),
    },
  }
}

/**
 * Every item the gate covers, flat, with the answer this decision gives it; null when they cannot
 * be read. A decision made outside the App delivers no answer: one picked and never sent is not
 * an answer to this decision, so it is recorded as none.
 */
async function coveredItems(
  ctx: Ctx,
  task: Task,
  gate: GateFile,
  fromApp: boolean,
): Promise<Record<string, DecidedItem> | null> {
  try {
    const covered: Record<string, DecidedItem> = {}
    for (const item of flattenItems(await taskItems(ctx, task, gate))) {
      if (targetOf(item.step) !== gate.target) continue
      const unsentPick = item.state === "chosen"
      covered[item.id] = {
        answer: unsentPick && !fromApp ? null : (item.answer?.kind ?? null),
        digest: item.digest ?? "",
      }
    }
    return covered
  } catch {
    return null
  }
}

/** `approve`, `approved` or `/ql approve` alone on the first line, whatever its case and trailing punctuation. */
export function isApproval(prompt: string): boolean {
  return chatApproval(prompt)
}

/**
 * A person typed an approval in an agent's chat (the agent's prompt hook passes it on): it counts
 * for the one open gate of the repository at the hook's directory that this very session opened,
 * and for nothing else. Returns what the person is told, or null when nothing was recorded.
 */
export async function recordChatApproval(
  ctx: Ctx,
  input: { session: string; prompt: string },
): Promise<string | null> {
  if (input.session === "" || !isApproval(input.prompt)) return null
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return null
  const mine: { task: Task; gate: GateFile }[] = []
  for (const task of await listTasks(ctx, repo.data)) {
    if (isTerminal(task.stage) || (await isArchived(ctx, task))) continue
    // With nothing open, the Review this session's `next` sent back for a recheck is the one meant.
    const gate = (await openGate(ctx, task)) ?? (await recheckedReview(ctx, task))
    if (gate?.session === input.session) mine.push({ task, gate })
  }
  const [only] = mine
  if (only === undefined || mine.length > 1) return null
  if (
    approvesInAgent(only.task) &&
    (await terminalTaskFor(ctx, input.session))?.runtimeDir !== only.task.runtimeDir
  )
    return null
  if (
    !(await approvalAsked(
      ctx,
      only.task,
      input.session,
      input.prompt,
      await approvalFloor(ctx, only.task, only.gate),
    ))
  )
    return null
  const recorded = await record(ctx, only.task, "approved", { by: "chat", asked: input.prompt })
  if (!recorded.ok) return null
  return `${CHAT_APPROVAL} ${only.gate.target === FINAL ? "the final review" : only.gate.target}.`
}

/** What the person picked in the agent's question tool, as the agent's hook read it from the tool's response. */
export type PickedAnswer = {
  session: string
  /** The text of the question the person answered. */
  question: string
  /** The label they chose, or the words they typed instead of one. */
  answer: string
  /** What they wrote beside the choice, when the picker takes notes. */
  notes?: string
  proof?: SessionProof
}

/** Two words are the same when only their case and the space around them differ. */
export const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * The person answered a question of a gate's chat review (the agent's hook passes the pick on). It
 * counts only for the open gate this very session opened, and only for the question the agent
 * showed for it: on a decision it is the person's answer to that item, and on the approval question
 * it is the decision itself, recorded as the person's (`by: chat`). Nothing the agent runs can
 * reach this: the pick comes from the hook of the tool that asked the person.
 * Returns whether a pick was recorded.
 */
export async function recordPickedAnswer(ctx: Ctx, input: PickedAnswer): Promise<boolean> {
  const pick = input.answer.trim()
  if (input.session === "" || pick === "") return false
  if (
    input.proof &&
    !input.proof.answers.some(
      (answer) =>
        answer.question === input.question &&
        answer.answer === input.answer &&
        answer.notes === input.notes,
    )
  )
    return false
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return false
  const mine: {
    task: Task
    gate: GateFile
    item: string | undefined
    question: { id: string; number: number }
  }[] = []
  for (const task of await listTasks(ctx, repo.data)) {
    if (isTerminal(task.stage) || (await isArchived(ctx, task))) continue
    const asked = await openQuestion(ctx, task)
    const gate = await answerableGate(ctx, task, asked)
    if (gate?.session !== input.session) continue
    if (
      asked?.gate === gate.target &&
      asked.session === input.session &&
      questionIsOf(gate, asked) &&
      (approvesInAgent(task) && input.proof
        ? await matchesChatQuestion(ctx, asked, input.question, input.proof.agent)
        : same(asked.question, input.question))
    ) {
      mine.push({ task, gate, item: asked.item, question: { id: asked.id, number: asked.number } })
    }
  }
  const [only] = mine
  if (only === undefined || mine.length > 1) return false
  const { task, gate, item, question } = only
  {
    if (!input.proof) return false
    if (
      approvesInAgent(task) &&
      (await terminalTaskFor(ctx, input.session))?.runtimeDir !== task.runtimeDir
    )
      return false
    const proof = input.proof
    return consumePickedCall(ctx, task, proof, {
      target: async () => {
        const asked = await openQuestion(ctx, task)
        const current = await answerableGate(ctx, task, asked)
        if (
          !current ||
          !asked ||
          current.id !== gate.id ||
          asked.id !== question.id ||
          asked.gate !== current.target ||
          asked.session !== input.session ||
          !questionIsOf(current, asked) ||
          !(await matchesChatQuestion(ctx, asked, input.question, proof.agent))
        )
          return null
        return {
          id: asked.id,
          question: input.question,
          session: input.session,
          openedAt: Math.max(asked.asked, asked.found?.at ?? 0),
          ...identityOpenedAt(current, asked),
        }
      },
      apply: async () => {
        const asked = await openQuestion(ctx, task)
        if (!asked) return false
        if (/^(?:tell me )?more$/i.test(pick))
          return (await requestMore(ctx, task, asked.id, input.notes ?? "", asked)).ok
        const receipt = randomUUID()
        const applied = await applyGatePick(ctx, task, gate, {
          item,
          pick: pick.replace(/ \(Recommended\)$/, ""),
          notes: input.notes,
          by: "chat",
          choices: asked.choices.map((c) => c.label),
          question: { ...question, receipt },
          ...(asked.gateId !== undefined ? { gateId: asked.gateId } : {}),
        })
        if (!applied.ok || applied.data === "refused") return false
        if (
          gate.target === PLAN_TARGET &&
          (same(pick, "Give feedback") || same(pick, "Show the Plan"))
        )
          return true
        return answerClosed(ctx, task, pick, receipt)
      },
    })
  }
}

/**
 * The person's answer to one question of a gate's review, wherever they gave it (the App's card,
 * or the agent's picker): on a decision it is their answer to that item, on a confirmation their
 * attestation, and on the approval question the gate's decision. `refused` when the answer does
 * not fit the question (words instead of Confirmed); an error when the gate refuses the decision.
 */
export async function applyGatePick(
  ctx: Ctx,
  task: Task,
  gate: GateFile,
  input: {
    item: string | undefined
    pick: string
    notes?: string
    by: string
    question?: { id: string; number: number; receipt: string }
    /** The Review id the question was asked on, when it names one (an earlier id of this Review). */
    gateId?: string
    /** The labels of the choices of the question being answered, when there is one. */
    choices?: readonly string[]
  },
): Promise<Result<"recorded" | "refused">> {
  const { item, pick } = input
  if (approvesInAgent(task) && gate.target === PLAN_TARGET && item === undefined) {
    if (same(pick, "Give feedback") || same(pick, "Show the Plan")) return ok("recorded")
    if (!same(pick, "Approve Plan")) return ok("refused")
    const recorded = await record(ctx, task, "approved", {
      by: input.by,
      gateId: gate.id ?? String(gate.opened),
      carryAnswers: true,
      ...(input.question
        ? { origin: { kind: "question" as const, ...input.question, action: pick } }
        : {}),
    })
    return recorded.ok ? ok("recorded") : recorded
  }
  if (item !== undefined) {
    const found = flattenItems(await taskItems(ctx, task, gate)).find(
      (i) =>
        i.id === item && (i.kind === "decision" || i.kind === "confirm" || i.kind === "mockup"),
    )
    if (found === undefined || targetOf(found.step) !== gate.target) return ok("refused")
    if (found.kind === "confirm") {
      // Only the label confirms. Words typed instead are not taken for a confirmation either: they
      // reach the agent as the person's note on the point, as "Answer in words" does.
      if (same(pick, NOT_YET)) return ok("recorded")
      if (!item.startsWith(CONFIRM_ITEM)) return ok("refused")
      if (!same(pick, CONFIRMED)) {
        await putItemAnswer(ctx, task, found, { kind: "record", note: pick, at: ctx.clock.now() })
        return ok("recorded")
      }
      const attested = await recordAttestation(ctx, task, {
        item: item.slice(CONFIRM_ITEM.length),
        text: input.notes?.trim() || `Confirmed in the ${input.by === "chat" ? "chat" : "App"}`,
        by: "you",
      })
      if (!attested.ok) return ok("refused")
    } else {
      // A Your call's option is recorded as the App's card records it: the recommended one agrees,
      // the other asks for the change, each with its letter.
      const letter = /^\s*([AB])\s*:/i.exec(pick)?.[1]?.toUpperCase()
      const option = found.call && letter ? CALL_LETTERS.indexOf(letter as "A" | "B") : -1
      // Words typed instead of Agree or Change are a comment on the decision: it is not agreed to.
      const agreed =
        option >= 0
          ? option === found.call?.recommended
          : same(pick, AGREE) ||
            same(pick, answerLabel("agree", found.family, found.answers.labels))
      const kind = agreed ? "agree" : "change"
      const words =
        option >= 0
          ? `${letter}${input.notes?.trim() ? ` · ${input.notes.trim()}` : ""}`
          : agreed || same(pick, CHANGE)
            ? (input.notes ?? "")
            : pick
      // An agreement is given at once; a change waits for the approval, which then becomes changes.
      await addAnswers(ctx, task, [
        {
          doc: gate.target,
          item,
          kind,
          remark: words,
          delivered: kind === "agree",
          seen: found.digest,
          ...(input.question ? { originQuestion: { ...input.question, pick } } : {}),
        },
      ])
    }
  } else if (
    // A question that offers no approval choice is a question about the Plan, not the gate's own:
    // its answer is kept as the person's answer and decides nothing.
    gate.target === FINAL ||
    input.choices === undefined ||
    input.choices.some((label) =>
      [APPROVE, APPROVE_PULL_REQUEST, APPROVE_ONLY, REQUEST_CHANGES].some((own) =>
        same(label, own),
      ),
    )
  ) {
    const withPullRequest = same(pick, APPROVE_PULL_REQUEST)
    const only = same(pick, APPROVE_ONLY) || same(pick, APPROVE)
    const approved = same(pick, APPROVE) || withPullRequest || only
    // Request changes with no words is still a decision; the agent is told to ask what to change.
    const words = same(pick, REQUEST_CHANGES)
      ? (input.notes ??
        "The user chose Request changes without saying what to change: ask them, then revise.")
      : pick
    // The ship choice is on disk before the approval, as the Review card's menu writes it. Picked
    // in the App, the App's server opens the pull request at once (`opening`); picked in the chat,
    // the agent's ship step opens it without asking again.
    const shipping =
      (withPullRequest || only) &&
      gate.target === FINAL &&
      !(await approvalWouldAskChanges(ctx, task))
    if (shipping) {
      await writeShipRecord(
        ctx,
        task,
        only
          ? { choice: "only" }
          : input.by === "cockpit"
            ? { choice: "pull-request", state: "opening" }
            : { choice: "pull-request" },
      )
    }
    const recorded = await record(ctx, task, approved ? "approved" : "changes", {
      by: input.by,
      // An approval names the opening its question was asked on, so the record says which Review
      // the person had before them; a change request is for the open one.
      gateId: (approved ? input.gateId : undefined) ?? gate.id ?? String(gate.opened),
      revision: gate.revision,
      ...(input.question
        ? { origin: { kind: "question" as const, ...input.question, action: pick } }
        : {}),
      carryAnswers: true,
      // Kept with an approval saved during a recheck, as the header button's choice is.
      ...(approved && gate.target === FINAL && (withPullRequest || only)
        ? { ship: withPullRequest ? ("pull-request" as const) : ("only" as const) }
        : {}),
      ...(approved ? {} : { remark: words }),
    })
    if (shipping && (!recorded.ok || recorded.data.decision !== "approved"))
      await clearShipRecord(ctx, task)
    if (!recorded.ok) return recorded
  }
  return ok("recorded")
}

/** The pick is dealt with: the question the App shows is closed. */
async function answerClosed(
  ctx: Ctx,
  task: Task,
  pick: string,
  originReceipt?: string,
): Promise<boolean> {
  await answerQuestion(ctx, task, pick, {
    via: "chat",
    ...(originReceipt ? { originReceipt } : {}),
  })
  return true
}

/** What a comment with an `item` is: the person's answer to one thing they were shown. */
const ITEM_NOTE =
  "A comment with an `item` and a `kind` is the user's answer to that one item; its `quote` names the item and its `remark` is what they wrote."

/** After an approval that carried answers. */
const NOTES_THEN = `The user approved and sent these notes along: answer each with \`qualitylayer comments resolve <id> --answer "<one line>"\`, then run \`qualitylayer next\`. ${ITEM_NOTE}`

/** The Plan is approved: any later edit of it goes through `plan amend` so what changed is on record. */
export const PLAN_APPROVED_RULE = `The Plan is approved. Every edit to it from now on goes through \`qualitylayer plan amend --by agent --note "<what changed, and why>"\`; leave that call's block exactly as it is.`

/**
 * Apply a recorded decision exactly once and return the outcome. Whoever comes first applies it:
 * the agent's `wait`, a verb such as `build start` or `ship`, or the App's *Approve and open a pull request* (`app`), which needs
 * the closing record written before it pushes. The App is no agent session, so it leaves the
 * session's state alone. Concurrent callers wait for the same closing transaction.
 */
export async function settle(
  ctx: Ctx,
  task: Task,
  gate: GateFile,
  options: { app?: boolean } = {},
): Promise<Result<GateOutcome>> {
  let shipping = task
  const settled = await ctx.fs.withLock(
    lockPath(task),
    async () => {
      const current = await readGate(ctx, task)
      if (current === null || current.id !== gate.id) return replaced(gate.target)
      const saved = await loadTask(ctx, { root: task.repoRoot, id: task.repoId }, task.slug)
      if (saved === null)
        return err({ code: "no_gate", message: "The task is no longer available" })
      if (
        current.target === FINAL &&
        current.decision === "approved" &&
        (await hasReviewCandidate(ctx, saved))
      ) {
        const selected = await selectedReviewCandidate(ctx, saved).catch(() => null)
        if (!selected || current.approvedHead !== selected.choice.head)
          return err({
            code: "no_gate",
            message: "The approved candidate moved. Its approval remains in the record.",
          })
        shipping = { ...saved, repoRoot: selected.choice.checkout }
      } else shipping = saved
      return settleUnlocked(ctx, shipping, current, options.app === true)
    },
    { waitMs: SETTLE_WAIT_MS },
  )
  // The approval chose a pull request: whoever applied it opens it, by the one opener every route
  // uses (`wait`, `next` and a typed approval as the App). The App opens it itself after this call,
  // through the same opener, for its reply carries the result.
  if (settled.ok && gate.target === FINAL && options.app !== true) {
    const { openChosenPullRequest } = await import("../../server/api.ts")
    await openChosenPullRequest(ctx, shipping).catch(() => null)
  }
  return settled
}

/** How long applying a decision waits for another process that is applying it already. */
const SETTLE_WAIT_MS = 180_000

/**
 * The final approval was applied and the agent has not run its ship step yet (the task's ship
 * state is not announced). The App's *Approve and open a pull request* applies it itself, so the
 * pull request uses the approved description; the agent's wait still tells the agent of it then.
 */
export async function finalApprovalUnheard(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
  gate: GateFile | null,
): Promise<boolean> {
  if (gate?.target !== FINAL || gate.decision !== "approved" || gate.settled !== true) return false
  try {
    const state = JSON.parse(await ctx.fs.readFile(shipStatePath(task))) as { announced?: unknown }
    return state.announced !== true
  } catch {
    return false
  }
}

/** Who approved, as the row of Prerequisites says it: "in the App", "in chat", or the name. */
const approvedBy = (by: string | undefined) =>
  by === undefined || by === "chat" ? "in chat" : by === "cockpit" ? "in the App" : `by ${by}`

/** Write `granted` into the waiting P1 row of the Plan's documents, before their approval is bound. */
async function grantBuildPermission(ctx: Ctx, task: Task, gate: GateFile): Promise<void> {
  for (const target of reviewTargets(gate.target, task)) {
    const docPath = join(task.dir, target)
    if (!(await ctx.fs.exists(docPath))) continue
    const text = await ctx.fs.readFile(docPath)
    const granted = grantAtApproval(text, {
      by: approvedBy(gate.by),
      at: gate.decided ?? ctx.clock.now(),
    })
    if (granted !== text) await ctx.fs.writeFile(docPath, granted)
  }
}

/**
 * The person's words with Request changes become a comment on the document they decided on, once:
 * the agent takes, applies and answers it like any other (a picker's "Other", a typed reply).
 */
async function requestAsComment(ctx: Ctx, task: Task, gate: GateFile): Promise<void> {
  const text = gate.requestChanges?.text.trim()
  if (!text) return
  const doc = reviewTargets(gate.target, task)[0] ?? gate.target
  const known = await readComments(ctx, task)
  if (known.some((c) => c.doc === doc && c.remark.trim() === text && c.resolved === undefined))
    return
  await addComment(ctx, task, { doc, remark: text })
  await deliver(ctx, task, doc)
}

async function settleUnlocked(
  ctx: Ctx,
  task: Task,
  gate: GateFile,
  app = false,
): Promise<Result<GateOutcome>> {
  if (gate.decision === "pending") {
    return err({ code: "no_gate", message: "the gate has no decision to settle" })
  }
  // A saved approval of the final Review always closes the task, from whatever step it is in and
  // whatever moved since: nothing here retires it or asks for another (Max, 10 November 2026).
  if (gate.settled !== true) {
    if (gate.decision === "approved") {
      const locked = await planApprovalLock(ctx, task, gate)
      if (locked !== null) return err({ code: "review_pending", message: locked })
      // The Plan's approval is the one writer of P1, the permission to run the agreed build.
      if (gate.target === PLAN_TARGET) await grantBuildPermission(ctx, task, gate)
      if (isDocument(gate.target))
        for (const target of reviewTargets(gate.target, task)) {
          const docPath = join(task.dir, target)
          const revision = await documentRevision(ctx, task, target)
          const markdown = await ctx.fs.readFile(docPath)
          await ctx.fs.writeFile(
            docPath,
            patchFrontmatter(markdown, {
              status: "approved",
              approved: true,
              review_digest: revision,
              ...(await approvalFields(ctx, task, target)),
            }),
          )
        }
      // The approved Plan holds what the user decided: remember it.
      if (gate.target === PLAN_TARGET) await writeBaseline(ctx, task)
      // The pull request's body is Verify's document as it stands when the approval is applied. Its
      // generated sections follow the branch while the review is the person's, so they are written
      // now: a commit another session made since the last refresh is named under *Deliberately not
      // changed*, as the page shows it, and not left out.
      // Read before the task moves on: whether the judge's pass covers the code being approved.
      // An approval that closes a task during a recheck closes one whose recheck did not finish: no
      // pass is claimed for it, whatever the earlier round's record still says.
      const unfinished =
        gate.approvedDuring !== undefined || (await approvalPhase(ctx, task)) !== "review"
      const pass = gate.target === FINAL ? await passAtClosing(ctx, task, unfinished) : undefined
      if (gate.target === FINAL) {
        // An approval saved during a recheck brings its ship choice: it becomes the ship record
        // now, as the click writes it in Review. A pull request is `opening` until whoever applied
        // the approval has opened it. Without a choice the task closes and nothing is pushed.
        const chosen = gate.ship
        const shipping = await readShipRecord(ctx, task)
        if (chosen !== undefined && (shipping?.choice !== chosen || shipping.state === undefined))
          await writeShipRecord(ctx, task, {
            choice: chosen,
            ...(chosen === "pull-request" ? { state: "opening" as const } : {}),
          })
        else if (shipping === null) await writeShipRecord(ctx, task, { choice: "only" })
        // Verify's document is written as the review the person approved, also during a recheck.
        await refreshPages(ctx, { ...task, stage: "verify" }, { review: true })
        await ctx.fs.atomicWrite(join(task.runtimeDir, "closing-pending"), `${gate.id}\n`)
      }
      const advanced = await advance(
        ctx,
        task,
        "gate_approved",
        gate.target === FINAL
          ? {
              effect: (updated) =>
                closeTask(ctx, updated, {
                  // Read again once the record is written: `verified` is claimed only for code
                  // that did not move while the pages were refreshed and the record was made.
                  ...(pass !== undefined
                    ? { pass, passNow: () => passAtClosing(ctx, task, unfinished) }
                    : {}),
                  // What the approval covers is the head at the person's click, not at this write.
                  ...(gate.approvedHead !== undefined ? { approvedHead: gate.approvedHead } : {}),
                }),
            }
          : {},
      )
      if (!advanced.ok) return advanced
      await patchReadme(ctx, advanced.data, { gate: null })
      if (gate.target === FINAL) {
        try {
          await publishClosingRecord(ctx, advanced.data)
        } catch (cause) {
          return err({
            code: "bad_args",
            message: `The approved closing record is ready but publication failed: ${String(cause)}. Run qualitylayer ship to retry without asking for approval again.`,
          })
        }
      }
    } else {
      await patchReadme(ctx, task, { gate: null })
      if (isDocument(gate.target)) {
        const docPath = join(task.dir, gate.target)
        await ctx.fs.writeFile(
          docPath,
          patchFrontmatter(await ctx.fs.readFile(docPath), { status: "draft" }),
        )
      }
      await requestAsComment(ctx, task, gate)
    }
    await writeGate(ctx, task, { ...gate, settled: true })
    if (gate.target === FINAL) await ctx.fs.remove(join(task.runtimeDir, "closing-pending"))
    if (!app) await touchSession(ctx, task, detectAgent(ctx.env), "busy")
    await appendEvent(ctx, task, {
      event: "gate_settled",
      target: gate.target,
      decision: gate.decision,
    })
  }
  const targets = reviewTargets(gate.target, task)
  // Answered ones were handled in an earlier round; their reply stays on the item.
  const owner = await currentTaskRecordOwner(ctx, task)
  const open = (owner ? await takeImmediate(ctx, task) : await delivered(ctx, task)).filter(
    (c) => targets.includes(c.doc) && c.answer === undefined && c.resolved === undefined,
  )
  if (gate.decision === "approved") {
    // Comments on lines of the change left open at the final approval are notes for the pull
    // request (ship/pr-notes.ts), not work for the agent: the approval stands as it is.
    const notes = gate.target === FINAL ? open.filter((c) => c.anchor === undefined) : open
    return ok({
      decision: "approved",
      next: "qualitylayer next",
      ...(gate.target === PLAN_TARGET ? { afterApproval: PLAN_APPROVED_RULE } : {}),
      ...(notes.length > 0
        ? {
            notes,
            then: NOTES_THEN,
          }
        : {}),
    })
  }
  return ok({
    decision: "changes",
    ...(gate.requestChanges ? { requestChanges: gate.requestChanges } : {}),
    comments: [...open, ...(await takenSince(ctx, task, targets, gate.opened)).map(asComment)],
    then:
      gate.target === FINAL
        ? `Apply each comment, commit, answer each with \`qualitylayer comments resolve <id> --answer "<one line on what changed>"\`, then run \`qualitylayer next\`. ${ITEM_NOTE}`
        : `Apply every comment, answer each with \`qualitylayer comments resolve <id> --answer "<one line on what changed>"\`, then run \`${gateOpenCommand(gate.target)}\`. ${ITEM_NOTE}`,
  })
}

/**
 * Wait for a decision: blocks up to one slice, returns `pending` with
 * `again: true` when the slice ends, `timeout` after the total cap.
 */
/**
 * Block for the reviewer's decision. By default in slices (`pending` with
 * `again`), so a foreground wait keeps the agent's turn short; `untilDecided`
 * holds until the decision or the total cap, for an agent that waits in the
 * background and is woken when the command ends.
 */
export async function wait(
  ctx: Ctx,
  task: Task,
  options: {
    untilDecided?: boolean
    /** The Plan sent for approval outside: asked each round while the Plan's gate is open. */
    outside?: () => Promise<GateOutcome | null>
  } = {},
): Promise<Result<GateOutcome>> {
  const first = await readGate(ctx, task)
  // The App applied the final approval as it opened the pull request: the agent hears it all the same.
  if (first !== null && (await finalApprovalUnheard(ctx, task, first)))
    return settle(ctx, task, first)
  if (first === null || first.settled === true)
    return err({ code: "no_gate", message: "nothing is open for approval on this task" })
  const sliceStart = ctx.clock.now()
  const interval = statusIntervalMs(ctx)
  let statusDue = sliceStart + interval
  const result = await waitFor<
    Result<GateOutcome> | Extract<WaitEvent, { event: "removed" | "archived" }>
  >(ctx, task, {
    seconds: TOTAL_CAP_MS / 1000,
    kinds: ["gate"],
    pending: () => ok({ decision: "timeout", resume: "qualitylayer" }),
    poll: async () => {
      // An approval or comments on the pull or merge request the Plan went to (its own pace).
      const opened = await readGate(ctx, task)
      if (
        options.outside !== undefined &&
        (opened?.target === PLAN_TARGET || opened?.target === FINAL) &&
        opened.decision === "pending" &&
        opened.settled !== true
      ) {
        const outcome = await options.outside()
        if (outcome !== null) return ok(outcome)
      }
      const gate = await readGate(ctx, task)
      if (gate === null) {
        return err({ code: "no_gate", message: "the gate disappeared while waiting" })
      }
      if (gate.settled === true && gate.decision === "pending") {
        return err({
          code: "no_gate",
          message: "the approval expired while waiting; run qualitylayer next",
        })
      }
      if (gate.decision !== "pending") return settle(ctx, task, gate)
      if (gate.target === PLAN_TARGET && gate.waitsFor === "plan") {
        const work = await planReviewWork(ctx, task)
        if (work !== null)
          return ok({
            decision: "review-ready",
            file: work.file,
            then: `${PLAN_REVIEW_HANDOFF} Run qualitylayer next for the planner handoff.`,
          })
      }
      // No decision can come while a late answer waits to be folded: the move is the planner's.
      if (gate.target === PLAN_TARGET && gate.waitsFor === undefined) {
        const folding = await lateAnswerMove(ctx, task)
        if (folding !== null)
          return ok({
            decision: "pending",
            again: true,
            gate: "open",
            status: folding.message,
            then: folding.then,
          })
      }
      // A question on a line of the change wakes the final review's wait at once: the agent answers
      // it beside the line while the person still reads. A change waits for the decision.
      if (gate.target === FINAL) {
        const asked = await takeReviewQuestions(ctx, task)
        if (asked.length > 0)
          return ok({
            decision: "comments",
            comments: asked,
            then: `${REVIEW_QUESTIONS_THEN} Then run \`qualitylayer wait --for approval\` again.`,
          })
      }
      // A comment on the Plan wakes the planner's wait at once, not with the decision.
      if (gate.target !== FINAL) {
        const fresh = await takePlanningComments(ctx, task)
        if (fresh.length > 0)
          return ok({
            decision: "comments",
            comments: fresh,
            then: `${FRESH_COMMENTS_THEN} Then run \`qualitylayer wait --for approval\` again.`,
          })
      }
      const now = ctx.clock.now()
      // The cap counts this wait, not `gate.opened`: a reopened gate keeps its first opening time
      // (it says how long the reviewer has been waited on) and must still be waited for.
      if (now - sliceStart >= TOTAL_CAP_MS) {
        await appendEvent(ctx, task, { event: "gate_timeout", target: gate.target })
        return ok({ decision: "timeout", resume: "qualitylayer" })
      }
      // Foreground waits report helper progress. Background waits return only actionable work,
      // the person's decision or the final timeout, rather than waking the agent every minute.
      if (options.untilDecided !== true && now >= statusDue) {
        statusDue = now + interval
        const status = await statusLine(ctx, task, now)
        if (status !== null) {
          return ok({
            decision: "pending",
            again: true,
            status,
            gate: "open",
            then: "The gate is still open. Wait with `qualitylayer wait --for approval --until-decided` in your harness's background execution; report meaningful changes when needed. Do not approve for the person.",
          })
        }
      }
      if (options.untilDecided !== true && now - sliceStart >= sliceMs(ctx)) {
        return ok({ decision: "pending", again: true })
      }
      return null
    },
  })
  return "event" in result ? err({ code: "bad_args", message: result.then }) : result
}

/** A decided-but-unsettled gate (e.g. decided after a timeout), for `next` to apply. */
export async function pendingDecision(ctx: Ctx, task: Task): Promise<GateFile | null> {
  const gate = await readGate(ctx, task)
  if (gate === null || gate.settled === true || gate.decision === "pending") return null
  return gate
}

/** The currently open, undecided gate, if any. */
/**
 * The App served the open final gate to a page: Approve is on a screen from now on. Once per gate.
 * Never throws; the page that asked goes on whatever this finds.
 */
export async function markGateShown(ctx: Ctx, task: Task): Promise<void> {
  try {
    const seen = await readGate(ctx, task)
    if (seen === null || seen.target !== FINAL || seen.shown !== undefined) return
    await ctx.fs.withLock(lockPath(task), async () => {
      const gate = await readGate(ctx, task)
      if (gate === null || gate.target !== FINAL || gate.shown !== undefined) return
      if (gate.decision !== "pending" || gate.settled === true) return
      await writeGate(ctx, task, { ...gate, shown: ctx.clock.now() })
    })
  } catch {
    // A page never fails on this.
  }
}

/**
 * Where an approval typed in chat must come after to count. A gate counts from when it opened; the
 * final gate of a task answered in the App, while the App runs, from when the App showed it: a
 * message typed before Approve is on a page approves what nobody could read yet (the page says
 * "Approve opens when the review is ready"). Infinity until it was shown. A task answered in the
 * agent's own terminal, or with no App running, has no page to wait for.
 */
export async function approvalFloor(ctx: Ctx, task: Task, gate: GateFile): Promise<number> {
  if (gate.target !== FINAL || approvesInAgent(task)) return gate.opened
  if (gate.shown !== undefined) return Math.max(gate.opened, gate.shown)
  const { liveLock } = await import("../../server/lock.ts")
  return (await liveLock(ctx)) === null ? gate.opened : Number.POSITIVE_INFINITY
}

/** What the person is told when their typed approval came before the App showed the final gate. */
export const NOT_SHOWN_YET =
  "The review is not on your screen yet. Wait until the App shows Approve on the Verify page, then approve there or say approve again."

export async function openGate(ctx: Ctx, task: Pick<Task, "runtimeDir">): Promise<GateFile | null> {
  const gate = await readGate(ctx, task)
  if (gate === null || gate.settled === true || gate.decision !== "pending") return null
  return gate
}
