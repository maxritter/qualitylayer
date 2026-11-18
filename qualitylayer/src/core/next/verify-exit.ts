// How Verify ends when it cannot go on by itself. Every such exit is the same: the task stays in
// Verify (the person's review opens only when every point passes), what lies outside the task goes
// to the agents' file as follow-ups, and one question for what lies inside it goes to the person
// with the agents' recommendation. The person's answer acts through an authority that already exists:
//
//   Change what Done means   `plan amend --by user` (the amendment is visible, and resets the rounds)
//   One more fix round       `verify fix` (recorded as asked by the person, raises the cap by one)
//   Keep it red              `verify keep-red` (only when red project checks are all that is open)
//   Stop the task            `task abandon`
//
// No answer turns a failing point into a pass: only a judgement that passes does. The exit is a
// record in the task's runtime folder (`verify-exit.json`); it ends with one of those three.

import { join } from "node:path"
import { type Ctx, ok, type Result } from "../../ctx.ts"
import { agentFileOf } from "../docs/names.ts"
import { buildRevision } from "../gate/revision.ts"
import { openNeeds, readNeeds } from "../need/need.ts"
import { type OpenItem, openItemsOf } from "../open-items.ts"
import { newFailures, projectRedState } from "../red-checks.ts"
import {
  type AnsweredQuestion,
  answeredQuestions,
  cancelQuestion,
  openQuestion,
} from "../task/question.ts"
import { readBatch } from "../task/question-batch.ts"
import { fixRoundsOf } from "../task/stages.ts"
import { appendEvent, readEvents, type Task } from "../task/store.ts"
import { typedChoice } from "../task/typed-choice.ts"
import { exitCauseGone } from "../task/verify-mode.ts"
import { fixCommittedSinceFailedRound, readAssignment } from "../verification.ts"
import { refused } from "./refusal.ts"
import { base, type NextPayload } from "./shared.ts"

export type ExitReason =
  | "fix_cap"
  | "environment"
  | "check_budget"
  | "person_needed"
  | "release_wait"
  | "red_base"

/** The three answers, as the question words them. The labels are how an answer is recognised. */
export const EXIT_AMEND = "Change what Done means"
export const EXIT_ROUND = "One more fix round"
export const EXIT_STOP = "Stop the task"
/** Offered when a red project check is open: the person's own authority to review the change with it red. */
export const EXIT_KEEP = "Keep it red and review it"

const SAYS: Record<ExitReason, string> = {
  fix_cap: "This earlier Verify exit still has open findings.",
  environment: "What still fails is blocked by the environment, not by the code.",
  check_budget: "A project check ran out of its time budget, so it proves nothing yet.",
  person_needed: "Something only the person can do is still open.",
  release_wait: "The release these checks need cannot be redeployed from here.",
  red_base:
    "A project check is red here and on the base too, but its failing tests cannot be matched by name, so only the person can say whether this task broke it.",
}

/** What a Keep answer covers. */
export type KeepFacts = { revision: string; checks: { command: string; fresh: string[] }[] }

export type VerifyExit = {
  schema: 1
  /** The question's id, unique to this exit. */
  id: string
  reason: ExitReason
  at: number
  iteration: number
  /** How many events the task had when the exit was written: only later ones answer it. */
  seen: number
  rounds: { done: number; allowed?: number }
  /** Whether a fix round has anything to fix: the last judgement failed. */
  fixable: boolean
  /**
   * Set when red project checks are the only open points, so the person may choose to keep them red:
   * the revision and the checks (with the tests that are new) that a Keep answer covers. A change to
   * any of it makes the answer a new decision.
   */
  red?: KeepFacts
  /** The needs that were open when an environment exit was written: done, they lift it. */
  needs?: string[]
  /** The first open points; `total` counts them all. */
  items: Pick<OpenItem, "id" | "source" | "text">[]
  total: number
}

const SHOWN = 12
const pathOf = (task: Pick<Task, "runtimeDir">) => join(task.runtimeDir, "verify-exit.json")

export async function readVerifyExit(
  ctx: Ctx,
  task: Pick<Task, "runtimeDir">,
): Promise<VerifyExit | null> {
  try {
    const value = JSON.parse(await ctx.fs.readFile(pathOf(task))) as VerifyExit
    return value.schema === 1 && typeof value.id === "string" && Array.isArray(value.items)
      ? value
      : null
  } catch {
    return null
  }
}

/** What a Keep answer would cover now: the revision and the red project checks, new failures named. */
async function currentFacts(ctx: Ctx, task: Task): Promise<KeepFacts | null> {
  const { red, excused } = await projectRedState(ctx, task)
  if (red.length === 0) return null
  return {
    revision: await buildRevision(ctx, task),
    checks: red
      .map((r) => ({
        command: r.command,
        fresh: [...newFailures(excused, r)].sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => a.command.localeCompare(b.command)),
  }
}

/** Whether the person's Keep still covers what is red: the same code and the same failures. */
async function keepHolds(ctx: Ctx, task: Task, exit: VerifyExit): Promise<boolean> {
  const now = await currentFacts(ctx, task)
  return exit.red !== undefined && now !== null && JSON.stringify(now) === JSON.stringify(exit.red)
}

type ExitAnswer = Pick<AnsweredQuestion, "choice" | "words" | "via" | "kind">
/** The exit choice an answer picked (`label`), the person's words for a change, or null: unresolved. */
type ExitPick = { label: string; words?: string } | null

/** The amend choice's number or label in front of the person's words: "1, Done means only the API". */
const AMEND_THEN_WORDS = /^\s*(?:1|change what done means)\s*[.):,;\-–—]?\s+(\S[\s\S]*)$/i

/**
 * Which exit choice the person picked. A picked label is that choice. Typed words are read against
 * the choices offered (numbers, labels, the beginning of one, as other questions read them); words
 * naming a choice this exit does not offer, or two, decide nothing. Words naming none are a change of
 * Done means only where the person typed them into the App's change field, or put the amend choice's
 * number or label in front of them; otherwise (chat) they decide nothing.
 */
function exitPick(exit: VerifyExit, answer: ExitAnswer): ExitPick {
  if (answer.words !== true) return { label: answer.choice }
  const said = answer.choice
  const offered = exitQuestion(exit).choices as { label: string; words?: true }[]
  const found = typedChoice(said, offered)
  if (found.kind === "choice") return { label: offered[found.index]?.label ?? "" }
  if (found.kind === "ambiguous") return null
  const every = [EXIT_AMEND, EXIT_ROUND, EXIT_KEEP, EXIT_STOP].map((label) => ({
    label,
    ...(label === EXIT_AMEND ? { words: true as const } : {}),
  }))
  if (typedChoice(said, every).kind !== "none") return null
  const prefixed = AMEND_THEN_WORDS.exec(said)?.[1]?.trim()
  if (prefixed) return { label: EXIT_AMEND, words: prefixed }
  return answer.via === "app" ? { label: EXIT_AMEND, words: said.trim() } : null
}

const pickOf = (exit: VerifyExit, answer: ExitAnswer | undefined): ExitPick | undefined =>
  answer === undefined ? undefined : exitPick(exit, answer)

/** Not-sure is the agent's recommendation, so it can never be the person's Keep. */
const explicitKeep = (exit: VerifyExit, answer: ExitAnswer | undefined) =>
  answer !== undefined && pickOf(exit, answer)?.label === EXIT_KEEP && answer.kind !== "unsure"

/**
 * The exit still waiting for its answer, or null. An amendment by the person or a round they asked
 * after it ends it; so does a cause that is gone (the need done, the release waiting no more, a
 * timed-out check that has passed since, an environment the checks show working again). When an exit
 * ends, the question that was asked for it ends with it.
 */
export async function pendingExit(ctx: Ctx, task: Task): Promise<VerifyExit | null> {
  const found = await readVerifyExit(ctx, task)
  if (found === null) return null
  const events = await readEvents(ctx, task)
  const answered = events
    .slice(found.seen)
    .some((e) => e.event === "fix_round_asked" || (e.event === "plan_amended" && e.by === "user"))
  const gone = await exitCauseGone(ctx, task, found)
  // A Keep answered for code that has changed since is spent: the red check is a new decision.
  const keepAnswer = (await answeredQuestions(ctx, task)).findLast((a) => a.id === found.id)
  const spent = explicitKeep(found, keepAnswer) && !(await keepHolds(ctx, task, found))
  if (task.stage === "verify" && !answered && !gone && !spent) return found
  await ctx.fs.remove(pathOf(task))
  await cancelQuestion(ctx, task, found.id, { lifted: true })
  return null
}

/** The question the person answers: three choices, or two when no fix round has anything to fix. */
export function exitQuestion(exit: VerifyExit): Record<string, unknown> {
  const choices = [
    {
      label: EXIT_AMEND,
      detail: "Say in your words what finished means now. The checks run again against it.",
      words: true,
    },
    ...(exit.fixable
      ? [
          {
            label: EXIT_ROUND,
            detail: "The agents fix what is open once more, then it is checked again.",
          },
        ]
      : []),
    ...(exit.red !== undefined
      ? [
          {
            label: EXIT_KEEP,
            detail:
              "Your review opens with the red check shown red and your choice beside it. Nothing else changes.",
          },
        ]
      : []),
    { label: EXIT_STOP, detail: "End the task here. Its files stay." },
  ]
  return {
    id: exit.id,
    question: `${SAYS[exit.reason]} How should Verify go on?`,
    choices,
    // The agents' recommendation: set to the index of the choice they would take.
    recommended: 0,
    grade: 1,
    why: `${exit.total} ${exit.total === 1 ? "point is" : "points are"} open after ${exit.rounds.done} fix ${exit.rounds.done === 1 ? "round" : "rounds"}.`,
  }
}

/**
 * A fix the build committed after the judgement that failed last, which no judge has read. Only
 * for an exit a fix round can serve, with a failed round whose commit is on record.
 */
async function fixUnjudged(ctx: Ctx, task: Task, exit: VerifyExit): Promise<boolean> {
  if (!exit.fixable) return false
  try {
    const receipt = await readAssignment(ctx, task)
    if (receipt?.result !== "fail") return false
    if ((receipt.source?.commit ?? receipt.head) === undefined) return false
    return await fixCommittedSinceFailedRound(ctx, task)
  } catch {
    return false
  }
}

/**
 * The exit question as it stands now. Its recommendation follows the facts: with a fix committed
 * after the last judgement that no judge has read, changing what Done means is not the
 * recommendation (the fix may already meet it): one more fix round is, a fresh judge on the fixed
 * code, and `why` says so. Otherwise the question is as `exitQuestion` gives it. The agent may
 * still send its own `recommended` and `why` with `question ask`.
 */
export async function exitQuestionNow(
  ctx: Ctx,
  task: Task,
  exit: VerifyExit,
): Promise<Record<string, unknown>> {
  const own = exitQuestion(exit)
  const round = (own.choices as { label: string }[]).findIndex((c) => c.label === EXIT_ROUND)
  if (round < 0 || !(await fixUnjudged(ctx, task, exit))) return own
  const rounds = exit.rounds.done
  return {
    ...own,
    recommended: round,
    why: `A fix registered after the last judgement has not been judged. ${exit.total} ${exit.total === 1 ? "point was" : "points were"} open at that judgement, after ${rounds} fix ${rounds === 1 ? "round" : "rounds"}.`,
  }
}

/**
 * Ends Verify here: records the exit (once for the same cause) and says what to do. The task stays
 * at Verify; nothing opens the person's review.
 */
export async function openExit(
  ctx: Ctx,
  task: Task,
  reason: Exclude<ExitReason, "fix_cap">,
  options: { fixable: boolean },
): Promise<NextPayload> {
  const known = await pendingExit(ctx, task)
  if (known !== null && known.reason === reason && known.iteration === task.iterations)
    return exitReply(ctx, task, known)
  const events = await readEvents(ctx, task)
  const all = await openItemsOf(ctx, task)
  const rounds = fixRoundsOf(events)
  // Keep is offered only when red project checks are all that is open, and only for checks it can
  // cover (the project checks); another open point would keep the person's review closed after it.
  const keepable = all.length > 0 && all.every((i) => i.source === "check" && i.scope === "all")
  const covered = keepable ? await currentFacts(ctx, task) : null
  // An item Keep cannot cover (a check QualityLayer did not run) keeps the offer away.
  const facts = covered !== null && covered.checks.length === all.length ? covered : null
  const nth = events.filter((e) => e.event === "verify_exit").length + 1
  const record: VerifyExit = {
    schema: 1,
    id: `verify-exit-${task.iterations}-${nth}`,
    reason,
    at: ctx.clock.now(),
    iteration: task.iterations,
    seen: events.length + 1,
    rounds: { done: rounds.done },
    fixable: options.fixable,
    ...(facts === null ? {} : { red: facts }),
    ...(reason === "environment"
      ? { needs: openNeeds(await readNeeds(ctx, task)).map((need) => need.for) }
      : {}),
    items: all.slice(0, SHOWN).map(({ id, source, text }) => ({ id, source, text })),
    total: all.length,
  }
  await appendEvent(ctx, task, {
    event: "verify_exit",
    reason,
    iteration: task.iterations,
    open: all.length,
  })
  await ctx.fs.mkdir(task.runtimeDir)
  await ctx.fs.atomicWrite(pathOf(task), `${JSON.stringify(record)}\n`)
  return exitReply(ctx, task, record)
}

/** The reply while an exit waits: the question to ask, or what the answer calls for. */
export async function exitReply(
  ctx: Ctx,
  task: Task,
  exit: VerifyExit,
  note = "",
): Promise<NextPayload> {
  const answer = (await answeredQuestions(ctx, task)).findLast((a) => a.id === exit.id)
  const pick = pickOf(exit, answer)
  // The exit is asked again under a new id, so only a clear answer of the person's own counts.
  const renew = async (why: string) => {
    const root = exit.id.replace(/-r\d+$/, "")
    const again = Number(/-r(\d+)$/.exec(exit.id)?.[1] ?? 0) + 1
    const renewed = { ...exit, id: `${root}-r${again}` }
    await ctx.fs.atomicWrite(pathOf(task), `${JSON.stringify(renewed)}\n`)
    return exitReply(ctx, task, renewed, why)
  }
  // Not sure picked the recommendation, which was Keep: that is the agent's pick, not the person's.
  if (pick?.label === EXIT_KEEP && answer?.kind === "unsure")
    return renew(
      "The person answered Not sure, which cannot keep a red check red: only they can choose Keep. Ask the question again as given. ",
    )
  // The amend choice with no words asks to change nothing in particular (Not sure stores the
  // recommended number, so an amend recommendation lands here too): only their words amend.
  if (pick?.label === EXIT_AMEND && pick.words === undefined)
    return renew(
      `${answer?.kind === "unsure" ? "The person answered Not sure, and the recommendation is to change what Done means" : "The person chose to change what Done means"} but gave no words, so nothing is decided and Done means stays as approved. Ask them what should change, in their language: in the chat they answer 1 followed by their words (the App's text field needs no number); their words become the amendment. `,
    )
  // Words that name no choice decide nothing: Done means stays as approved.
  if (answer !== undefined && pick === null)
    return renew(
      `The person's answer ("${answer.choice.trim().slice(0, 120)}") names none of the choices, so nothing is decided and Done means stays as approved. Ask the question again, in the person's language, with the choices by number; to change what Done means they answer its number followed by their words. `,
    )
  const shared = {
    phase: "verify",
    exit: {
      reason: exit.reason,
      says: SAYS[exit.reason],
      rounds: exit.rounds,
      open: exit.items,
      open_total: exit.total,
    },
    agents_document: join(task.dir, agentFileOf("verify")),
  }
  // The question is with the person already: nothing to ask again, and a move the agent can take.
  const waiting = pick ? null : await openExitQuestion(ctx, task, exit.id)
  if (!pick && waiting !== null) {
    const since = new Date(waiting.asked).toISOString()
    return base(task, {
      ...shared,
      asked: {
        id: waiting.id,
        number: waiting.number,
        since,
        recommended: waiting.choices[waiting.recommended]?.label ?? null,
        ...(waiting.why !== undefined ? { why: waiting.why } : {}),
      },
      instructions: `${note}${SAYS[exit.reason]} The question is with the person since ${since}: it is asked once, so do not send it again. Go on with what does not depend on the answer (a follow-up for what lies outside the task, under *Fix rounds* in the agents' file). With nothing left that does not, \`qualitylayer wait --for answer\` hears their answer.`,
      then: "qualitylayer wait --for answer",
    })
  }
  if (!pick)
    return base(task, {
      ...shared,
      question: await exitQuestionNow(ctx, task, exit),
      instructions: `${note}${SAYS[exit.reason]} Verify ends here: follow "How Verify ends" in the Verify text (follow-ups for what lies outside the task, the one \`question\` for what lies inside it).`,
      then: "qualitylayer question ask '<question as JSON>'",
    })
  // Not sure answers with the recommended choice, which is what `choice` holds.
  const chosen = pick.label
  const then =
    chosen === EXIT_ROUND
      ? "qualitylayer verify fix"
      : chosen === EXIT_STOP
        ? "qualitylayer task abandon"
        : chosen === EXIT_KEEP
          ? "qualitylayer verify keep-red"
          : 'qualitylayer plan amend --by user --note "<their words>"'
  return base(task, {
    ...shared,
    // Only a change of Done means carries the person's words; a choice named by words is that choice.
    answer: { choice: chosen, ...(pick.words !== undefined ? { words: pick.words } : {}) },
    instructions:
      chosen === EXIT_ROUND
        ? "The person asked for one more fix round: run it."
        : chosen === EXIT_STOP
          ? "The person chose to stop the task: run it."
          : chosen === EXIT_KEEP
            ? "The person chose to keep the red check red and review it: run it."
            : "The person changed what finished means: write their words into the Plan's Done means and amend, then run `qualitylayer verify judge`. A point passes only when a judgement passes it; no answer marks one.",
    then,
  })
}

export async function openExitQuestion(ctx: Ctx, task: Task, id: string) {
  const open = await openQuestion(ctx, task)
  return open?.id === id
    ? open
    : ((await readBatch(ctx, task))?.questions.find((q) => q.id === id) ?? null)
}

async function missingExitAnswer(ctx: Ctx, task: Task, id: string): Promise<Result<never>> {
  return (await openExitQuestion(ctx, task, id))
    ? refused(`The person has not answered the exit question (id ${id}) yet.`, [
        { what: "their answer", move: "qualitylayer wait --for answer" },
      ])
    : refused(`Verify's exit question (id ${id}) has not been asked.`, [
        { what: "the exit question to ask", move: "qualitylayer brief verify" },
      ])
}

/**
 * `verify fix` on an exit: the person's answer asks for one more fix round. It is recorded with
 * their answer and raises the cap by one; the task stays in Verify, in its fix round.
 */
export async function takeAskedRound(ctx: Ctx, task: Task): Promise<Result<Task>> {
  const exit = await pendingExit(ctx, task)
  if (exit === null)
    return refused("No Verify exit waits for an answer, so there is no round to take.", [
      { what: "Verify going on", move: "qualitylayer verify judge" },
    ])
  const answer = (await answeredQuestions(ctx, task)).findLast((a) => a.id === exit.id)
  if (answer === undefined) return missingExitAnswer(ctx, task, exit.id)
  if (exitPick(exit, answer)?.label !== EXIT_ROUND)
    return refused(`The person answered "${answer.choice}", not "${EXIT_ROUND}".`, [
      { what: "act on their answer", move: answerMove(exitPick(exit, answer)?.label) },
    ])
  if (!exit.fixable)
    return refused("The last judgement passed: there is nothing for a fix round to fix.", [
      { what: "the person's answer, acted on", move: answerMove(exitPick(exit, answer)?.label) },
    ])
  await appendEvent(ctx, task, {
    event: "fix_round_asked",
    by: "user",
    exit: exit.id,
    answer: { id: answer.id, choice: EXIT_ROUND, at: answer.at, via: answer.via ?? null },
  })
  await ctx.fs.remove(pathOf(task))
  return ok(task)
}

/** The verb that acts on an exit answer, by the choice the person picked. */
function answerMove(label: string | undefined): string {
  return label === EXIT_ROUND
    ? "qualitylayer verify fix"
    : label === EXIT_STOP
      ? "qualitylayer task abandon"
      : label === EXIT_KEEP
        ? "qualitylayer verify keep-red"
        : 'qualitylayer plan amend --by user --note "<their words>"'
}

/**
 * `verify keep-red`: the person's answer keeps the red project checks red and opens their review. It is their
 * authority, so it must be theirs: an explicit Keep (Not sure picks the agent's recommendation and
 * never counts), given for the code and the failures that are red now. Both are recorded with their
 * answer; a later change to the code, or a check that goes red again or differently, is a new
 * decision. Their review shows the check red with their choice.
 */
export async function takeKeptRed(ctx: Ctx, task: Task): Promise<Result<Task>> {
  const exit = await pendingExit(ctx, task)
  if (exit === null)
    return refused(
      "No Verify exit waits for a Keep answer: it was answered for code that has changed since, or it ended.",
      [{ what: "Verify going on", move: "qualitylayer verify judge" }],
    )
  const answer = (await answeredQuestions(ctx, task)).findLast((a) => a.id === exit.id)
  if (answer === undefined) return missingExitAnswer(ctx, task, exit.id)
  if (!explicitKeep(exit, answer))
    return refused(
      answer.kind === "unsure"
        ? "The person answered Not sure, which cannot keep a red check red: only they can choose Keep."
        : `The person answered "${answer.choice}", not "${EXIT_KEEP}".`,
      [
        answer.kind === "unsure"
          ? { what: "the question asked again", move: "qualitylayer verify judge" }
          : { what: "act on their answer", move: answerMove(exitPick(exit, answer)?.label) },
      ],
    )
  if (exit.red === undefined || !(await keepHolds(ctx, task, exit))) {
    await ctx.fs.remove(pathOf(task))
    return refused(
      "The red checks or the code changed since the person chose Keep, so that answer is spent: what is red now is a new decision.",
      [{ what: "the new decision", move: "qualitylayer verify judge" }],
    )
  }
  await appendEvent(ctx, task, {
    event: "check_kept_red",
    by: "user",
    exit: exit.id,
    revision: exit.red.revision,
    commands: exit.red.checks.map((check) => check.command),
    answer: { id: answer.id, choice: EXIT_KEEP, at: answer.at, via: answer.via ?? null },
  })
  await ctx.fs.remove(pathOf(task))
  return ok(task)
}
