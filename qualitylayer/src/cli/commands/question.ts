// question ask '<json>' · question show '<json>' · question link <id> --points 1,3 · question more <id> --file <json> · question show <batch-id> · question progress "<line>" · question answered
// "<choice>": `ask` saves the question, returning native inputs in Terminal mode or waiting for
// the App; `show` only shows it; `progress` is a line of what the
// agent does for Tell me more; `answered` records an answer the person gave in the agent's own
// chat. Thin parsing over core/task/question.

import { join, resolve } from "node:path"
import { detectAgent, sessionIdentity } from "../../core/agents/detect.ts"
import { fillNames } from "../../core/docs/names.ts"
import { isAutonomousBuildStage } from "../../core/flow.ts"
import { foreignBuildLead } from "../../core/handoff/outside.ts"
import { refused } from "../../core/next/refusal.ts"
import { exitQuestion, exitQuestionNow, readVerifyExit } from "../../core/next/verify-exit.ts"
import { projectRuntimeDir, resolveBoundRepo, resolveRepo } from "../../core/paths.ts"
import { chatQuestions, TERMINAL_YOUR_TURN } from "../../core/task/chat-questions.ts"
import { ASK_REFUSAL, answerAsked, FRONT_DUE, heldIn } from "../../core/task/prompts.ts"
import {
  type AskReply,
  agentSession,
  answerQuestion,
  answerSingleMore,
  askQuestion,
  cancelQuestion,
  longFactsWarning,
  markFront,
  markStopped,
  moreProgress,
  openQuestion,
  type Question,
  replyOf,
  reviewedTask,
  showQuestion,
  takeMeanwhile,
  waitForAnswer,
} from "../../core/task/question.ts"
import { answerFromApp, homeQuestionDir } from "../../core/task/question-app.ts"
import {
  answerBatch,
  answerBatchInChat,
  answerMore,
  askBatch,
  batchEcho,
  cancelBatch,
  clarificationInstructions,
  linkPoints,
  parsePoints,
  pendingClarifications,
  pickedBatchAnswer,
  pointsProblem,
  readBatch,
  replyBatch,
  showBatch,
} from "../../core/task/question-batch.ts"
import { userMessages } from "../../core/task/session-proof.ts"
import { askedInAgent } from "../../core/task/sides.ts"
import type { VerifyMode } from "../../core/task/stages.ts"
import { appendEvent, registerProject, type Task } from "../../core/task/store.ts"
import { requiresChoice, typedAnswer, typedChoiceRefusal } from "../../core/task/typed-choice.ts"
import { readVerifyMode } from "../../core/task/verify-mode.ts"
import { pollWaitAnswers } from "../../core/wait.ts"
import { type Ctx, err, ok, type Result } from "../../ctx.ts"
import { cockpitUrl, ensureCockpit } from "../../server/lock.ts"
import { appLinkOpensHere } from "../../server/machines/served.ts"
import { needsYou } from "../browser.ts"
import { taskCockpitUrl } from "./cockpit.ts"
import { parseArgs, requireTask } from "./shared.ts"

const USAGE_TEXT =
  'usage: qualitylayer question ask \'<json: {"id":"q7","question","choices":[{"label","kind","words":true,"facts":["at most 3"],"diagram":"mermaid, at most 4 KB","evidence":[{"label","href"}],"artifact":"artifacts/<name>.html, the screen this choice leads to"}],"artifact":"artifacts/<name>.html[#section], the screen the question is about","recommended","grade":1|2|3,"why":"one line, grade 1","ahead":"questions still to come","about":{"doc":"{plan_doc}","section":"Done means","quote":"the words asked about"} or {"item":"plan:decision:…"},"settles":["plan:asked:1"],"gate":"{plan_doc}","item":"plan:decision:1","found":{"text","evidence"}}>\' [--wait-seconds 1..510] · question ask --batch \'<json: {"id":"b1","title":"Scope and what done means","ahead":"Probably the only batch","questions":[…questions as above, "late":true for a Plan Your call, "finding":"a finding of agents/{plan_doc} › Findings" on grade 3]}>\' (or --batch --file <json file, - for stdin>) · question show \'<json>\' · question progress "<line>" · question answered "<what the person said in this chat>"' +
  " · Give each batch question 2 to 6 choices. Each choice allows up to 3 facts, each at most 200 characters. Use detail for a choice description. With multi:true, recommended accepts an array of zero-based indices or labels."
const OWNER_REQUESTS =
  " · Verify question ask may bind a single ownerRequest { kind: budget | evidence, need: T-number, since: current need opened or reopened timestamp, amountCents: positive USD cents for budget only }. Use a choice’s confirm label for a consequential non-gate decision."

/** The usage line with the task's file names. */
const usage = () =>
  `${fillNames(USAGE_TEXT)}${OWNER_REQUESTS} · answered "<person's answer>" [--id <question-id>] · cancel (--id <question-id> | --batch <batch-id>) [--home]`

/** Never answer for the person: said with every reply of `ask`. */
const NEVER = "Never answer for the person, and never ask this question in your own chat or picker."
const TERMINAL_NEVER =
  "Never answer for the person. Only their verified picker result or latest chat message counts."

/** What `question ask` says in Implement and Verify's checks: the App holds the question and the build goes on. */
export const BUILD_ASKED =
  "The App shows the question. Go on with everything that does not depend on the answer; do not wait for it and do not end your turn on it. The answer comes with a later reply: as answered_meanwhile in the reply of a later QualityLayer command, or sooner with `qualitylayer question poll`."

/** The same question sent a second time in the build: it is open already, one card, asked once. */
export const BUILD_ALREADY_ASKED =
  "This question is already open in the App and is asked once: nothing was asked again. Do not send it again. Go on with everything that does not depend on the answer; with nothing left that does not, end your turn. The answer comes with a later reply: as answered_meanwhile in the reply of a later QualityLayer command, or sooner with `qualitylayer question poll`."

/** The same for a batch asked in the build. */
const buildBatchAsked = (batch: string) =>
  `The App shows the questions. Go on with everything that does not depend on an answer; do not wait for them and do not end your turn on them. The answers come with a later reply: as answered_meanwhile in the reply of a later QualityLayer command, or sooner with \`qualitylayer question poll --batch ${batch}\`.`

function parsed(raw: string): Result<unknown> {
  try {
    return ok(JSON.parse(raw) as unknown)
  } catch {
    return err({
      code: "bad_args",
      message: `the question is not valid JSON. For a batch file, use qualitylayer question ask --batch --file <path>. ${usage()}`,
    })
  }
}

/** A millisecond override from the environment (tests), or the default. */
function msOf(ctx: Ctx, name: string, fallback: number | undefined): number | undefined {
  const value = Number(ctx.env.get(name))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/** What the agent does with each outcome; `shipped`: the decided review shipped the task. */
function thenOf(
  reply: AskReply,
  gate: string | undefined,
  approval: boolean,
  shipped: boolean,
): string {
  switch (reply.status) {
    case "decided":
      return shipped
        ? `The person already decided this review in the App (${reply.decision}) and the task is shipped; nothing was asked. Run \`qualitylayer next\`.`
        : `The person already decided this review in the App (${reply.decision}); nothing waits on this question. The gate's reply says what comes next: wait for the \`wait\` you started, or run \`qualitylayer wait --for approval\` now.`
    case "answered":
      if (gate !== undefined)
        return approval
          ? "The App recorded the decision on the gate. Wait for it as the gate's reply says (`wait_background` in the background, or `gate wait`)."
          : "The App recorded it on the gate. Ask the next question of `chat_review` the same way."
      return "QualityLayer recorded the answer in *Decided with you*. Use it to update the agent's details, then ask the next question, or go on when there is none. Never edit the document's managed markers."
    case "unsure":
      return `The person is not sure: QualityLayer recorded \`Not known · assumed ${reply.recommended}\` in *Decided with you*. Use that assumption in the agent's details, then go on. Never edit the document's managed markers.`
    case "more":
      return (
        "The person asked for more (`request`; empty: what would help them decide). The card stays " +
        "answerable. Look into it now; say what you are doing in a line or two with " +
        '`qualitylayer question progress "<line>"`. Then run `question ask` again with the same ' +
        'id, the question one grade higher, and `"found": {"text": "<the answer to what they ' +
        'asked>", "evidence": [{"label", "href"}]}`. An answer they give meanwhile wins.'
      )
    case "cancelled":
      return "The question is no longer open (it was answered elsewhere or replaced). Run `qualitylayer next`."
    case "waiting":
      return "No answer yet; the question remains in the App and an answer is kept. Run qualitylayer wait now; never end your turn while this is open. Keep working on independent tasks."
  }
}

/** The gate a single question's JSON names (a review question), or undefined. */
type Review = { gate: string; gateId?: string }

function reviewOf(raw: string): Review | undefined {
  try {
    const given = JSON.parse(raw) as { gate?: unknown; gateId?: unknown } | null
    if (typeof given?.gate !== "string" || given.gate === "") return undefined
    return {
      gate: given.gate,
      ...(typeof given.gateId === "string" && given.gateId !== "" ? { gateId: given.gateId } : {}),
    }
  } catch {
    return undefined
  }
}

/** A task, or the App's home page of this repository (no slug). */
type Host = Pick<Task, "runtimeDir" | "stage" | "repoId"> & {
  /** Verify's mode while the task is in Verify: whether the person or the agents have it. */
  verifyMode?: VerifyMode | null
  answers?: Task["answers"]
  approvals?: Task["approvals"]
  slug?: string
  dir?: string
}

/** How a question asked in the agent's chat is handed over: the person is waited for, or the build goes on. */
type ChatAsk = "waits" | "build" | "build-again"

/**
 * What `question ask` says in Implement and Verify's checks when the answers are given in the
 * agent's chat: the question is shown once and the build goes on. The build's guard lets exactly
 * these picker calls through (`buildRefuses` in hook.ts).
 */
export const BUILD_ASKED_IN_CHAT =
  "Go on with everything that does not depend on the answer. Then say your_turn and pass chat_questions.calls unchanged to the named picker once, or show the numbered choices when no picker tool is named. If you only see a summary, read the full question ask reply with --json. If the picker cannot open or closes without an answer, show chat_questions.fallback.calls as numbered choices once. When the person answers in this chat, record their words with qualitylayer question answered --id <question-id>. Never choose for the person."

/** The same question asked a second time in the build: it is open already, and asked once. */
export const BUILD_ALREADY_IN_CHAT =
  "This question is already open. Go on with everything that does not depend on the answer. If you have yet to show it, say your_turn and pass chat_questions.calls unchanged from the full reply to the named picker, or show the numbered choices when no picker tool is named. Use --json to read the full reply. When the person answers in this chat, record their words with qualitylayer question answered --id <question-id>. Never choose for the person."

const DEFAULT_CHAT_THEN: Record<ChatAsk, string> = {
  waits:
    "Say your_turn, then ask each native picker call exactly as given. If the native picker is unavailable or closes with no answer (an empty result is never an answer), display chat_questions.fallback.calls as numbered choices. With numbered choices, end your turn and record the person's next answer with qualitylayer question answered --id <question-id>. Never choose for the person.",
  build: BUILD_ASKED_IN_CHAT,
  "build-again": BUILD_ALREADY_IN_CHAT,
}

function appAnswerPickup(slug: string | undefined): string {
  const task = slug ? ` --task ${slug}` : ""
  return `If the person answered in the App, run \`qualitylayer question poll${task} --json\` and match the question ID in \`answered_meanwhile\`. Poll picks up all unread answers for the task once. Use the saved answer without asking for it again.`
}

function isStandaloneImplementQuestion(task: Host, id: string | undefined): boolean {
  return task.stage === "implement" && task.answers === "terminal" && !/^need-T\d+-/.test(id ?? "")
}

function closedQuestionMessage(task: Host, id: string | undefined, batchMember: boolean): string {
  const closed = id
    ? "that question id is not open; nothing changed"
    : "no question is open; nothing changed"
  if (isStandaloneImplementQuestion(task, id) && !batchMember)
    return `${closed}. ${appAnswerPickup(task.slug)}`
  return `${closed}. Run qualitylayer question poll for batch receipts. For a single question, repeat the same qualitylayer question ask to read its saved answer.`
}

function standaloneQuestionCopy(
  task: Host,
  question: Question,
  how: ChatAsk,
): Record<ChatAsk, string> {
  if (
    !isStandaloneImplementQuestion(task, question.id) ||
    question.gate !== undefined ||
    question.item !== undefined
  )
    return DEFAULT_CHAT_THEN
  return { ...DEFAULT_CHAT_THEN, [how]: `${DEFAULT_CHAT_THEN[how]} ${appAnswerPickup(task.slug)}` }
}

async function terminalQuestions(
  ctx: Ctx,
  questions: Question[],
  how: ChatAsk = "waits",
  CHAT_THEN = DEFAULT_CHAT_THEN,
) {
  return {
    your_turn: TERMINAL_YOUR_TURN,
    chat_questions: await chatQuestions(ctx, questions),
    then: CHAT_THEN[how],
    never:
      "Never answer for the person. Only their verified picker result or latest chat message counts.",
  }
}

/**
 * How these questions are handed to the agent's chat: in the build it goes on (see `askWaits`);
 * `again` is a question that was open in this chat before this call.
 */
function chatAsk(task: Host, questions: readonly unknown[], again = false): ChatAsk {
  if (askWaits(task) || questions.length === 0) return "waits"
  return again ? "build-again" : "build"
}

/** The App's home page, starting the server when autostart allows it. Never fails the command. */
async function homeUrl(ctx: Ctx): Promise<string | undefined> {
  try {
    const lock = await ensureCockpit(ctx, { explicit: false })
    return lock !== null && appLinkOpensHere(ctx.home) ? cockpitUrl(lock) : undefined
  } catch {
    return undefined
  }
}

const questionUrl = (ctx: Ctx, task: Host) =>
  task.slug !== undefined ? taskCockpitUrl(ctx, task.slug) : homeUrl(ctx)

/**
 * The question a Verify exit asks is QualityLayer's own: its words and choices (Keep among them) are
 * what the exit built, so an agent cannot reword the person's options. The agent's recommendation
 * and its line of evidence stay.
 */
export async function asExitQuestion(ctx: Ctx, task: Host, input: unknown): Promise<unknown> {
  const given = input as { id?: unknown; recommended?: unknown; why?: unknown } | null
  if (typeof given?.id !== "string" || task.slug === undefined) return input
  const exit = await readVerifyExit(ctx, task)
  if (exit === null || exit.id !== given.id) return input
  // The exit's own recommendation follows the facts (a fix no judge has read); the agent's stands over it.
  // A host with a slug and a Verify exit is a task.
  const own = "dir" in task ? await exitQuestionNow(ctx, task as Task, exit) : exitQuestion(exit)
  return {
    ...own,
    ...(typeof given.recommended === "number" ? { recommended: given.recommended } : {}),
    ...(typeof given.why === "string" && given.why.trim() !== "" ? { why: given.why } : {}),
  }
}

/** `question show <id>` for the open question that is no batch's: the stored card, null for another id. */
async function readOpenQuestion(
  ctx: Ctx,
  task: Host,
  id: string,
): Promise<Record<string, unknown> | null> {
  const batched = (await readBatch(ctx, task))?.questions.some((q) => q.id === id) === true
  const open = batched ? null : await openQuestion(ctx, task)
  if (open === null || open.id !== id) return null
  return {
    status: "open",
    id: open.id,
    number: open.number,
    question: open.question,
    choices: open.choices,
    recommended: open.recommended,
    recommended_choice: open.choices[open.recommended]?.label ?? null,
    ...(open.why !== undefined ? { why: open.why } : {}),
    since: new Date(open.asked).toISOString(),
  }
}

/**
 * Whether `question ask` waits for the answer. In Plan it does, and in Verify once it turns to the
 * person. In Implement and Verify's checks no question holds the build, a need's and Verify's exit question included: each is asked
 * once and the answer comes with a later reply.
 */
export const askWaits = (task: Pick<Host, "stage" | "verifyMode">) =>
  !isAutonomousBuildStage(task.stage, task.verifyMode ?? undefined)

/** A task as a question's host, with Verify's mode read once. */
const hostFor = async (ctx: Ctx, task: Task): Promise<Host & Task> => ({
  ...task,
  verifyMode: await readVerifyMode(ctx, task),
})

async function ask(ctx: Ctx, task: Host, raw: string, seconds?: number): Promise<Result<unknown>> {
  const input = parsed(raw)
  if (!input.ok) return input
  const replied = await askParsed(ctx, task, input, seconds)
  // A fact over its limit was trimmed rather than refused: the reply says so once.
  const warning = longFactsWarning(input.data)
  return warning !== null && replied.ok && typeof replied.data === "object"
    ? ok({ ...replied.data, warnings: [warning] })
    : replied
}

async function askParsed(
  ctx: Ctx,
  task: Host,
  input: { data: unknown },
  seconds?: number,
): Promise<Result<unknown>> {
  const agent = detectAgent(ctx.env)
  const asked = await askQuestion(ctx, task, await asExitQuestion(ctx, task, input.data), { agent })
  if (!asked.ok) return asked
  const { question } = asked.data
  if (askedInAgent(task, [question])) {
    if (asked.data.answered)
      return ok({
        ...replyOf(asked.data.answered, question.choices),
        ...(await takeMeanwhile(ctx, task)),
      })
    if (asked.data.decided !== undefined && question.gate)
      return ok({
        status: "decided",
        id: question.id,
        gate: question.gate,
        decision: asked.data.decided,
      })
    if (asked.data.fresh)
      await appendEvent(ctx, task, {
        event: "question_asked",
        id: question.id,
        number: question.number,
        front: false,
        ...(question.gate !== undefined ? { gate: question.gate } : {}),
        ...(question.item !== undefined ? { item: question.item } : {}),
      })
    const how = chatAsk(task, [question], !asked.data.fresh && !asked.data.replaced)
    return ok({
      status: "asked_in_chat",
      id: question.id,
      number: question.number,
      question: question.question,
      ...(await terminalQuestions(
        ctx,
        [question],
        how,
        standaloneQuestionCopy(task, question, how),
      )),
    })
  }
  const app = await questionUrl(ctx, task)
  const approval = question.gate !== undefined && question.item === undefined
  // In the build nothing holds the agent: it hears the answer with a later reply.
  const goesOn = !askWaits(task)
  const answer = (reply: AskReply) =>
    takeMeanwhile(ctx, task).then((meanwhile) =>
      ok({
        ...reply,
        ...((reply.status === "waiting" && !goesOn) || reply.status === "more"
          ? { wait: "qualitylayer wait" }
          : {}),
        ...meanwhile,
        ...(app !== undefined ? { app, cockpit: app } : {}),
        then:
          reply.status === "waiting" && goesOn
            ? BUILD_ASKED
            : thenOf(reply, question.gate, approval, task.stage === "shipped"),
        never: NEVER,
      }),
    )
  // Answered while no `ask` waited: the answer stands, nothing waits.
  if (asked.data.answered !== null) return answer(replyOf(asked.data.answered, question.choices))
  // The review was decided before the agent asked about it: nothing was asked, nothing waits.
  if (asked.data.decided !== undefined && question.gate !== undefined)
    return answer({
      status: "decided",
      id: question.id,
      gate: question.gate,
      decision: asked.data.decided,
    })
  // A new question: the first after /ql brings the App to the front; every later one notifies.
  {
    const repo = projectRuntimeDir(ctx, task.repoId)
    const due = join(repo, FRONT_DUE)
    const first =
      (await ctx.fs.exists(due)) ||
      (asked.data.fresh && question.number === 1 && question.front !== true)
    if (first) {
      await ctx.fs.remove(due).catch(() => {})
      await markFront(ctx, task, question.id)
      const cockpit = app
      if (cockpit !== undefined)
        await needsYou(ctx, cockpit, {
          title: `Question ${question.number} for you`,
          body: question.question,
        })
    }
    if (asked.data.fresh)
      await appendEvent(ctx, task, {
        event: "question_asked",
        id: question.id,
        number: question.number,
        front: first,
        ...(question.gate !== undefined ? { gate: question.gate } : {}),
        ...(question.item !== undefined ? { item: question.item } : {}),
      })
  }
  // The build goes on: the card is recorded, and an explicit --wait-seconds is the agent's own wait.
  if (goesOn && seconds === undefined) {
    // The same question sent again is open already: one card, and the reply says so.
    const already = !asked.data.fresh && !asked.data.replaced
    return takeMeanwhile(ctx, task).then((meanwhile) =>
      ok({
        status: "asked",
        id: question.id,
        number: question.number,
        ...(already ? { already: true, since: new Date(question.asked).toISOString() } : {}),
        ...meanwhile,
        ...(app !== undefined ? { app, cockpit: app } : {}),
        then: already ? BUILD_ALREADY_ASKED : BUILD_ASKED,
        never: NEVER,
      }),
    )
  }
  // Esc, Ctrl-C or a killed shell: the card says it stopped waiting, and an answer is kept.
  const stop = (code: number) => () => {
    void markStopped(ctx, task, question.id).finally(() => process.exit(code))
  }
  const onInt = stop(130)
  const onTerm = stop(143)
  process.once("SIGINT", onInt)
  process.once("SIGTERM", onTerm)
  try {
    const reply = await waitForAnswer(ctx, task, question, {
      sliceMs:
        seconds !== undefined ? seconds * 1000 : msOf(ctx, "QUALITYLAYER_ASK_SLICE_MS", undefined),
      beatMs: msOf(ctx, "QUALITYLAYER_ASK_BEAT_MS", undefined),
    })
    return answer(reply)
  } finally {
    process.off("SIGINT", onInt)
    process.off("SIGTERM", onTerm)
  }
}

/**
 * Where the question is asked: on the task's page, or on the App's home page when there is no task
 * selected or the question is about no task of this repository (`--home`, an ask to answer).
 */
async function hostOf(ctx: Ctx, home: boolean, review?: Review): Promise<Result<Host>> {
  if (!home) {
    const task = await requireTask(ctx)
    // A review question asks about a task's gate, which the home page has none of: it is asked on
    // that task, even once the person's decision shipped it.
    if (review !== undefined && (task.ok || task.error.code === "no_task")) {
      const repo = await resolveBoundRepo(ctx)
      if (!repo.ok) return repo
      const reviewed = await reviewedTask(ctx, repo.data, review, task.ok ? task.data : null)
      if (reviewed !== null) return ok(await hostFor(ctx, reviewed))
      return err({
        code: "no_task",
        message: `no task has the review "${review.gate}" open: a review question is asked on its task`,
      })
    }
    if (task.ok) return ok(await hostFor(ctx, task.data))
    if (task.error.code !== "no_task") return task
  }
  const repo = await resolveRepo(ctx)
  if (!repo.ok) return repo
  await registerProject(ctx, repo.data)
  return ok({
    runtimeDir: homeQuestionDir(projectRuntimeDir(ctx, repo.data.id)),
    stage: "plan",
    repoId: repo.data.id,
  })
}

/** `--points 1,3` checked against the task's Done means; null when the flag is not given. */
async function pointsFlag(
  ctx: Ctx,
  task: Host,
  flag: string | true | undefined,
): Promise<Result<number[] | null>> {
  if (flag === undefined) return ok(null)
  const points = parsePoints(flag === true ? "" : flag)
  if (!points.ok) return points
  if (task.dir === undefined)
    return err({ code: "bad_args", message: "points belong to a task's Done means: name a task" })
  const problem = await pointsProblem(ctx, { dir: task.dir }, points.data)
  return problem ? err({ code: "bad_args", message: problem }) : points
}

const withDir = (task: Host): Host & { dir: string } => ({ ...task, dir: task.dir ?? "" })

export async function questionCmd(ctx: Ctx, args: string[]): Promise<Result<unknown>> {
  const [sub, ...rest] = args
  if (
    sub !== "show" &&
    sub !== "answered" &&
    sub !== "ask" &&
    sub !== "progress" &&
    sub !== "poll" &&
    sub !== "cancel" &&
    sub !== "link" &&
    sub !== "more" &&
    sub !== "reply"
  )
    return err({ code: "bad_args", message: usage() })
  const { positional, flags } = parseArgs(rest, [
    "wait-seconds",
    "batch-file",
    "text",
    "answer-at",
    "id",
    "points",
    "file",
    ...(sub === "poll" || sub === "cancel" ? ["batch"] : []),
  ])
  if (flags.id !== undefined && typeof flags.id !== "string")
    return err({ code: "bad_args", message: "--id needs the exact question id" })
  if (flags.home === true && (sub === "ask" || sub === "show"))
    return err({
      code: "bad_args",
      message:
        "new intake questions belong to a task's Plan; start the task, then ask there. Legacy Home questions remain available through poll, answered and cancel.",
    })
  const raw = positional.join(" ").trim()
  const single =
    (sub === "ask" || sub === "show") &&
    flags.batch === undefined &&
    flags["batch-file"] === undefined
  const task = await hostOf(ctx, flags.home === true, single ? reviewOf(raw) : undefined)
  if (!task.ok) return task
  if (sub === "cancel") {
    const id = typeof flags.id === "string" ? flags.id : undefined
    const batch = typeof flags.batch === "string" ? flags.batch : undefined
    if (!id && !batch)
      return err({
        code: "bad_args",
        message: "usage: question cancel --id <question-id> | --batch <batch-id> [--home]",
      })
    if (batch || (id && (await readBatch(ctx, task.data))?.questions.some((q) => q.id === id)))
      return cancelBatch(ctx, task.data, { batch, id })
    return cancelQuestion(ctx, task.data, id as string)
  }
  if (sub === "poll") {
    const batch = typeof flags.batch === "string" ? flags.batch : undefined
    const polled = batch ? await readBatch(ctx, task.data, batch) : await readBatch(ctx, task.data)
    const never = askedInAgent(task.data, polled?.questions ?? []) ? TERMINAL_NEVER : NEVER
    if (batch) {
      const named = polled
      if (!named) return err({ code: "bad_args", message: "unknown batch id" })
      if (named.session && named.session !== agentSession(ctx.env))
        return err({
          code: "bad_args",
          message: "Only the native session that asked this batch may poll its answers.",
        })
    }
    const taken = await pollWaitAnswers(ctx, task.data, batch)
    const clarifications = (await pendingClarifications(ctx, task.data)).filter(
      (request) => batch === undefined || request.batch === batch,
    )
    if (clarifications.length)
      return ok({
        ...taken,
        more_requests: clarifications,
        then: clarificationInstructions(clarifications),
        never,
      })
    return ok({
      ...taken,
      ...((await readBatch(ctx, task.data))?.questions.length ? { wait: "qualitylayer wait" } : {}),
      then: "Fold each answer into its linked Done means points before dependent work. Record what you did with `qualitylayer question reply <id> --text <reply>`. Keep working on independent tasks.",
      never,
    })
  }
  if (sub === "reply") {
    if (typeof flags.text !== "string")
      return err({
        code: "bad_args",
        message: "usage: qualitylayer question reply <id> --text <what you changed>",
      })
    const at = flags["answer-at"] === undefined ? undefined : Number(flags["answer-at"])
    if (at !== undefined && (!Number.isSafeInteger(at) || at <= 0))
      return err({
        code: "bad_args",
        message: "--answer-at needs the saved timestamp from the receipt",
      })
    const linked = await pointsFlag(ctx, task.data, flags.points)
    if (!linked.ok) return linked
    const result = await replyBatch(ctx, task.data, raw, flags.text, at)
    if (!result.ok) return result
    if (linked.data !== null) {
      const set = await linkPoints(ctx, withDir(task.data), raw, linked.data)
      if (!set.ok) return set
    }
    return ok({ receipts: result.data, ...(linked.data !== null ? { points: linked.data } : {}) })
  }
  if (sub === "more") {
    if (raw === "" || typeof flags.file !== "string")
      return err({
        code: "bad_args",
        message:
          'usage: qualitylayer question more <question-id> --file <json: {"found": {"text", "evidence"}, "question"?, "choices"?: [{"label"?, "facts"?, "evidence"?, "diagram"?}], "grade"?, "why"?}>',
      })
    let patch: unknown
    try {
      patch = JSON.parse(await ctx.fs.readFile(resolve(ctx.env.cwd(), flags.file)))
    } catch {
      return err({
        code: "bad_args",
        message: `${flags.file} could not be read as JSON; give the path of the file you wrote`,
      })
    }
    const single = await openQuestion(ctx, task.data)
    if (
      askedInAgent(task.data, single ? [single] : []) &&
      !(await readBatch(ctx, task.data))?.questions.some((q) => q.id === raw)
    ) {
      const answered = await answerSingleMore(ctx, task.data, raw, patch)
      return answered.ok
        ? ok({
            ...answered.data,
            ...(await terminalQuestions(
              ctx,
              [answered.data.question],
              chatAsk(task.data, [answered.data.question]),
            )),
          })
        : answered
    }
    const answered = await answerMore(ctx, task.data, raw, patch)
    if (answered.ok && askedInAgent(task.data, [answered.data.question]))
      return ok({
        ...answered.data,
        ...(await terminalQuestions(
          ctx,
          [answered.data.question],
          chatAsk(task.data, [answered.data.question]),
        )),
      })
    return answered.ok
      ? ok({
          ...answered.data,
          then: `The request is answered and the App shows the new wording.${answered.data.ignored ? ` Passed over, the stored question keeps them: ${answered.data.ignored.join(", ")}.` : ""} Wait again for the rest of the batch: qualitylayer wait --until-event --batch ${answered.data.batch}.`,
          never: NEVER,
        })
      : answered
  }
  if (sub === "link") {
    if (raw === "" || flags.points === undefined)
      return err({
        code: "bad_args",
        message: "usage: qualitylayer question link <question-id> --points 1,3 (or --points none)",
      })
    const linked = await pointsFlag(ctx, task.data, flags.points)
    if (!linked.ok) return linked
    return linkPoints(ctx, withDir(task.data), raw, linked.data ?? [])
  }
  if (sub === "ask" && (flags.batch === true || flags["batch-file"] !== undefined)) {
    let source = raw
    // `--file <json>` (and its older name `--batch-file`) reads the batch from a file; `-` reads stdin.
    const fileFlag = flags.file ?? flags["batch-file"]
    if (fileFlag !== undefined) {
      if (typeof fileFlag !== "string")
        return err({ code: "bad_args", message: "--file needs a file path, or - for stdin" })
      try {
        source = fileFlag === "-" ? await Bun.stdin.text() : await ctx.fs.readFile(fileFlag)
      } catch {
        return err({ code: "bad_args", message: "the batch file could not be read" })
      }
    }
    const input = parsed(source)
    if (!input.ok) return input
    const named = (input.data as { id?: unknown } | null)?.id
    // The same batch sent a second time is open already: the build's reply says so.
    const standing =
      typeof named === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(named)
        ? await readBatch(ctx, task.data, named)
        : null
    const result = await askBatch(ctx, task.data, input.data, { agent: detectAgent(ctx.env) })
    if (result.ok && askedInAgent(task.data, result.data.questions))
      return ok({
        batch: batchEcho(result.data),
        ...(await terminalQuestions(
          ctx,
          result.data.questions,
          chatAsk(
            task.data,
            result.data.questions,
            standing !== null &&
              result.data.questions.every((q) => standing.questions.some((s) => s.id === q.id)),
          ),
        )),
      })
    const building = !askWaits(task.data)
    return result.ok
      ? ok({
          // `then` leads, so the line to say comes before the echoed batch.
          then: building
            ? buildBatchAsked(result.data.id)
            : `Questions are open in the App. Say "🔔 Your turn: open the QualityLayer App." once, now: never again for the answers that follow. Keep working on what does not depend on an answer. Wait once for the whole batch: run \`qualitylayer wait --until-event --batch ${result.data.id}\` in the background (or \`qualitylayer wait\` in the foreground and repeat while pending); it returns when the batch is complete, or after a short quiet period with the answers so far, so one wake-up carries every answer. Fold the answers, then run \`qualitylayer question reply <id> --text "<what you did>"\` for each; never end your turn while this is open.`,
          batch: batchEcho(result.data),
          ...(result.data.warnings?.length ? { warnings: result.data.warnings } : {}),
          ...(result.data.kept?.length
            ? {
                kept: `The answers already given are kept as they were: ${result.data.kept.map((k) => `${k.id} (${k.answer})`).join(", ")}.`,
              }
            : {}),
          ...(building ? {} : { wait: "qualitylayer wait" }),
          never: NEVER,
        })
      : result
  }
  if (sub === "ask") {
    if (flags["wait-seconds"] !== undefined && typeof flags["wait-seconds"] !== "string")
      return err({ code: "bad_args", message: "--wait-seconds needs an integer from 1 to 510" })
    const seconds = flags["wait-seconds"] === undefined ? undefined : Number(flags["wait-seconds"])
    if (seconds !== undefined && (!Number.isInteger(seconds) || seconds < 1 || seconds > 510))
      return err({ code: "bad_args", message: "--wait-seconds must be an integer from 1 to 510" })
    return ask(ctx, task.data, raw, seconds)
  }
  if (sub === "show" && /^[A-Za-z0-9_-]{1,120}$/.test(raw)) {
    // The one open question by its id, as it is stored: what the person sees recommended, and why.
    const open = await readOpenQuestion(ctx, task.data, raw)
    if (open !== null) return ok(open)
    const shown = await showBatch(ctx, task.data, raw)
    return shown.ok
      ? ok({
          ...shown.data,
          then: "`batch` is what `question ask --batch` takes: change what you need and send it again; the answers in `answers` are kept. To answer one Tell me more request, use `question more <id> --file <json>` instead.",
        })
      : shown
  }
  if (sub === "show") {
    const input = parsed(raw)
    if (!input.ok) return input
    const replaced = await openQuestion(ctx, task.data)
    const shown = await showQuestion(
      ctx,
      task.data,
      await asExitQuestion(ctx, task.data, input.data),
      {
        agent: detectAgent(ctx.env),
      },
    )
    if (!shown.ok) return shown
    const note = replaced
      ? {
          replaced: `This replaced the open question ${replaced.id}, which is no longer shown; its answer, if any, was not recorded.`,
        }
      : {}
    if (askedInAgent(task.data, [shown.data])) {
      const open = await openQuestion(ctx, task.data)
      const mine = open ? [open] : []
      return ok({
        ...shown.data,
        ...note,
        ...(await terminalQuestions(ctx, mine, chatAsk(task.data, mine))),
      })
    }
    const app = await questionUrl(ctx, task.data)
    return ok({
      ...shown.data,
      ...note,
      wait: "qualitylayer wait",
      ...(app !== undefined ? { app, cockpit: app } : {}),
      instructions:
        "The App shows the question. Run qualitylayer wait now; never end your turn while this is open. " +
        "qualitylayer question ask with the same JSON remains available and returns the question's answer.",
    })
  }
  if (sub === "progress") {
    if (raw === "") return err({ code: "bad_args", message: usage() })
    return ok({ recorded: await moreProgress(ctx, task.data, raw) })
  }
  // The person answered in the agent's own chat (after an interrupted wait): their words are kept.
  const id = typeof flags.id === "string" ? flags.id : undefined
  const batch = id ? await readBatch(ctx, task.data) : null
  // Once another session leads the build, a question of the build is its to answer: a planner whose
  // build was handed off keeps only the questions it asked itself.
  if ("repoRoot" in task.data && task.data.slug !== undefined) {
    const foreign = await foreignBuildLead(ctx, task.data as Task)
    if (foreign !== null) {
      const asked = id
        ? (batch?.questions.find((q) => q.id === id) ?? (await openQuestion(ctx, task.data)))
        : await openQuestion(ctx, task.data)
      const mine = [agentSession(ctx.env), sessionIdentity(ctx.env)?.id]
      if (!asked?.session || !mine.includes(asked.session))
        return err({ code: "not_owner", message: foreign.message })
    }
  }
  const pending = id
    ? (batch?.questions.find((q) => q.id === id) ?? (await openQuestion(ctx, task.data)))
    : await openQuestion(ctx, task.data)
  if (!pending || (id && pending.id !== id)) {
    const exit = task.data.stage === "verify" ? await readVerifyExit(ctx, task.data) : null
    if (exit && (id === undefined || exit.id === id))
      return refused(`Verify's exit question (id ${exit.id}) has not been asked.`, [
        { what: "the exit question to ask", move: "qualitylayer brief verify" },
      ])
    return err({
      code: "bad_args",
      message: closedQuestionMessage(
        task.data,
        id,
        batch?.questions.some((q) => q.id === id) ?? false,
      ),
    })
  }
  if (askedInAgent(task.data, [pending])) {
    const open = pending
    const session = sessionIdentity(ctx.env)
    const messages = session
      ? ((await userMessages(ctx, { agent: session.agent, session: session.id })) ?? [])
      : []
    // An older batch another chat asked says nothing about a question that is not one of its own.
    const member = batch?.questions.some((q) => q.id === open.id) ? batch : null
    const unproven = typedAnswerProblem({ session, messages, open, batch: member, raw })
    if (unproven !== null)
      return err({
        code: "bad_args",
        message: `Quote the person's words exactly as they typed them in this chat since the question was asked (any of their messages since then counts), or ask them to answer in the App; nothing changed (${unproven})`,
      })
    // A review, hold or prerequisite question settles something only through one of its choices:
    // words that fit none, or two, change nothing and the agent is told the options.
    const typed = typedAnswer(raw, open.choices)
    if (
      typed.kind !== "choice" &&
      requiresChoice(open) &&
      !/^(?:(?:tell me )?more|not sure|unsure)$/i.test(raw.trim())
    )
      return err({
        code: "bad_args",
        message: typedChoiceRefusal(raw, open.choices, typed, open.gate),
      })
    let answer = pickedBatchAnswer(
      open,
      batch?.id ?? "",
      { question: open.question, answer: raw },
      "typed",
    )
    // A number, "the first one" or "Confirmed" with words beside it is that choice; the words are its note.
    const own = typedAnswer(raw, open.choices, {
      recommended: open.recommended,
      own: !requiresChoice(open),
    })
    const note = "text" in answer && own.kind === "choice" ? own.note : undefined
    if (note !== undefined && own.kind === "choice")
      answer = { batch: batch?.id ?? "", id: open.id, choice: own.index }
    const { batch: _batch, ...singleAnswer } = answer
    const options = {
      via: "chat" as const,
      expected: open,
      ...(note !== undefined ? { note } : {}),
    }
    const saved = batch?.questions.some((q) => q.id === open.id)
      ? await answerBatch(ctx, task.data, answer, options)
      : await answerFromApp(ctx, task.data, singleAnswer, options)
    return saved.ok
      ? ok({ ...saved.data, recorded: true, ...(await takeMeanwhile(ctx, task.data)) })
      : saved
  }
  const current = pending
  const session = agentSession(ctx.env)
  if (
    (current.session && current.session !== session) ||
    !(await answerAsked(ctx, task.data, session, raw, current.asked))
  )
    return err({ code: "bad_args", message: ASK_REFUSAL })
  if (
    id &&
    !batch?.questions.some((q) => q.id === id) &&
    (await openQuestion(ctx, task.data))?.id !== id
  )
    return err({ code: "bad_args", message: closedQuestionMessage(task.data, id, false) })
  const closed =
    id && batch?.questions.some((q) => q.id === id)
      ? await answerBatchInChat(ctx, task.data, id, raw)
      : await answerQuestion(ctx, task.data, raw, { via: "chat" })
  if (!closed.ok) return closed
  const { entry: _entry, ...said } = closed.data
  return ok({
    ...said,
    instructions: closed.data.closed
      ? "QualityLayer recorded the answer in Decided with you. Update the agent's details; never edit the document's managed markers."
      : "No question was open; nothing changed.",
  })
}

/**
 * Which condition kept words from counting as the person's typed answer, or null when none did.
 * The words are in a message of the person's since the question was asked, any of them, so answers
 * typed back to back, or several in one message, each count. A gate's question takes them only as
 * a clause the person typed themselves (see heldIn): "do not approve" never approves.
 */
export function typedAnswerProblem(input: {
  session: { agent: string; id: string } | null
  messages: ({ recordedAt: number; prompt: string } | null)[]
  open: { asked: number; found?: { at: number }; session?: string | null; gate?: string }
  batch: { session?: string | null } | null
  raw: string
}): string | null {
  const { session, messages, open, batch, raw } = input
  if (!session) return "this command cannot tell which chat it runs in"
  const since = Math.max(open.asked, open.found?.at ?? 0)
  const said = messages.flatMap((m) => (m !== null && m.recordedAt > since ? [m.prompt] : []))
  if (said.length === 0)
    return `the ${session.agent} record of chat ${session.id} has no message from the person since the question was asked at ${since}`
  if (!said.some((prompt) => heldIn(prompt, raw, open.gate !== undefined)))
    return `no message since the question holds "${raw.trim().slice(0, 80)}"; the latest is "${(said.at(-1) ?? "").trim().slice(0, 80)}"`
  if (open.session && open.session !== session.id)
    return `the question is bound to chat ${open.session}, this is chat ${session.id}`
  if (batch && batch.session !== session.id)
    return `the batch is bound to chat ${batch.session ?? "none"}, this is chat ${session.id}`
  return null
}
