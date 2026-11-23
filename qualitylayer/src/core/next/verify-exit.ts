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
import { openNeeds, readNeeds } from "../need/need.ts"
import { openItemsOf } from "../open-items.ts"
import { answeredQuestions } from "../task/question.ts"
import { fixRoundsOf } from "../task/stages.ts"
import { appendEvent, readEvents, type Task } from "../task/store.ts"
import { refused } from "./refusal.ts"
import { base, type NextPayload } from "./shared.ts"
import {
  answerMove,
  currentFacts,
  EXIT_AMEND,
  EXIT_KEEP,
  EXIT_ROUND,
  EXIT_STOP,
  type ExitAnswer,
  type ExitPick,
  type ExitReason,
  exitPath,
  exitPick,
  exitQuestionNow,
  explicitKeep,
  keepHolds,
  openExitQuestion,
  pendingExit,
  pickOf,
  SAYS,
  type VerifyExit,
} from "./verify-exit-state.ts"

export {
  EXIT_AMEND,
  EXIT_KEEP,
  EXIT_ROUND,
  EXIT_STOP,
  type ExitReason,
  exitQuestion,
  exitQuestionNow,
  type KeepFacts,
  openExitQuestion,
  pendingExit,
  readVerifyExit,
  type VerifyExit,
} from "./verify-exit-state.ts"

const SHOWN = 12

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
  await ctx.fs.atomicWrite(exitPath(task), `${JSON.stringify(record)}\n`)
  return exitReply(ctx, task, record)
}

function renewalReason(answer: ExitAnswer | undefined, pick: ExitPick | undefined): string | null {
  // Not sure picked the recommendation, which was Keep: that is the agent's pick, not the person's.
  if (pick?.label === EXIT_KEEP && answer?.kind === "unsure")
    return "The person answered Not sure, which cannot keep a red check red: only they can choose Keep. Ask the question again as given. "
  // The amend choice with no words asks to change nothing in particular (Not sure stores the
  // recommended number, so an amend recommendation lands here too): only their words amend.
  if (pick?.label === EXIT_AMEND && pick.words === undefined)
    return `${answer?.kind === "unsure" ? "The person answered Not sure, and the recommendation is to change what Done means" : "The person chose to change what Done means"} but gave no words, so nothing is decided and Done means stays as approved. Ask them what should change, in their language: in the chat they answer 1 followed by their words (the App's text field needs no number); their words become the amendment. `
  // Words that name no choice decide nothing: Done means stays as approved.
  if (answer !== undefined && pick === null)
    return `The person's answer ("${answer.choice.trim().slice(0, 120)}") names none of the choices, so nothing is decided and Done means stays as approved. Ask the question again, in the person's language, with the choices by number; to change what Done means they answer its number followed by their words. `
  return null
}

const ANSWER_INSTRUCTIONS: Record<string, string> = {
  [EXIT_ROUND]: "The person asked for one more fix round: run it.",
  [EXIT_STOP]: "The person chose to stop the task: run it.",
  [EXIT_KEEP]: "The person chose to keep the red check red and review it: run it.",
}

const DEFAULT_AMEND_INSTRUCTIONS =
  "The person changed what finished means: write their words into the Plan's Done means and amend, then run `qualitylayer verify judge`. A point passes only when a judgement passes it; no answer marks one."

/** The reply while an exit waits: the question to ask, or what the answer calls for. */
export async function exitReply(
  ctx: Ctx,
  task: Task,
  exit: VerifyExit,
  note = "",
): Promise<NextPayload> {
  const answer = (await answeredQuestions(ctx, task)).findLast((a) => a.id === exit.id)
  const pick = pickOf(exit, answer)
  const renewWhy = renewalReason(answer, pick)
  if (renewWhy !== null) {
    // The exit is asked again under a new id, so only a clear answer of the person's own counts.
    const root = exit.id.replace(/-r\d+$/, "")
    const again = Number(/-r(\d+)$/.exec(exit.id)?.[1] ?? 0) + 1
    const renewed = { ...exit, id: `${root}-r${again}` }
    await ctx.fs.atomicWrite(exitPath(task), `${JSON.stringify(renewed)}\n`)
    return exitReply(ctx, task, renewed, renewWhy)
  }
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
  if (!pick) {
    // The question is with the person already: nothing to ask again, and a move the agent can take.
    const waiting = await openExitQuestion(ctx, task, exit.id)
    if (waiting !== null) {
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
    return base(task, {
      ...shared,
      question: await exitQuestionNow(ctx, task, exit),
      instructions: `${note}${SAYS[exit.reason]} Verify ends here: follow "When it does not pass" in the Verify text (follow-ups for what lies outside the task, the one \`question\` for what lies inside it).`,
      then: "qualitylayer question ask '<question as JSON>'",
    })
  }
  // Not sure answers with the recommended choice, which is what `choice` holds.
  const chosen = pick.label
  return base(task, {
    ...shared,
    // Only a change of Done means carries the person's words; a choice named by words is that choice.
    answer: { choice: chosen, ...(pick.words !== undefined ? { words: pick.words } : {}) },
    instructions: ANSWER_INSTRUCTIONS[chosen] ?? DEFAULT_AMEND_INSTRUCTIONS,
    then: answerMove(chosen),
  })
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
  await ctx.fs.remove(exitPath(task))
  return ok(task)
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
    await ctx.fs.remove(exitPath(task))
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
  await ctx.fs.remove(exitPath(task))
  return ok(task)
}
