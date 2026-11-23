import { createHash } from "node:crypto"
import { join } from "node:path"
import { type Ctx, ok, type Result } from "../../ctx.ts"
import { type FiledHelper, type Helper, withBriefFiles } from "../briefs.ts"
import { flowStepOf } from "../flow.ts"
import { readComments } from "../gate/comments.ts"
import { readGate } from "../gate/gate.ts"
import { rememberHelperOffers } from "../helpers.ts"
import { instructionsBlock } from "../instructions.ts"
import { type RepoRef, resolveRepo } from "../paths.ts"
import { MIGRATION_FILE } from "../records/contract.ts"
import { requiredReply } from "../required-lines.ts"
import { checkGeneratedBrief, writeGeneratedBrief } from "../run/bind.ts"
import type { Meanwhile } from "../task/question.ts"
import {
  clarificationInstructions,
  pendingClarifications,
  pollBatch,
  readBatch,
} from "../task/question-batch.ts"
import { loadTask, type Task } from "../task/store.ts"
import { agentActionable } from "../team/comments.ts"
import { updateNotice } from "../update/notice.ts"
import { fillTexts, markedFor, reportingTo } from "./reply-texts.ts"
import type { NextPayload } from "./shared.ts"

/** The task a reply is about, loaded once for every step of the reply below. */
type About = { ctx: Ctx; repo: RepoRef | null; task: Task | null }

/** A newer QualityLayer the App's shell found, told once per version with when to upgrade. */
async function withUpdateNotice({ ctx, task }: About, payload: NextPayload): Promise<NextPayload> {
  if (task === null || payload.done === true) return payload
  const found = await updateNotice(ctx, task)
  if (found === null) return payload
  return {
    ...payload,
    update_available: found.notice,
    ...(typeof payload.instructions === "string"
      ? { instructions: `${payload.instructions}\n\n${found.text}` }
      : {}),
  }
}

async function withAppAnswers({ ctx, task }: About, payload: NextPayload): Promise<NextPayload> {
  if (task === null) return payload
  const gate = await readGate(ctx, task)
  if (gate?.decision === "pending" && gate.settled !== true) return payload
  const decisionRecord =
    gate?.decision === "changes" && gate.requestChanges
      ? { requestChanges: gate.requestChanges }
      : {}
  const waiting = (await readComments(ctx, task)).filter(
    (c) => c.kind !== undefined && agentActionable(c),
  ).length
  return { ...payload, ...decisionRecord, ...(waiting > 0 ? { app_answers: waiting } : {}) }
}

/** Each helper of a reply with its final brief written to a file, named by `brief_file`. */
async function withFiles({ ctx, task }: About, payload: NextPayload): Promise<NextPayload> {
  if (task === null) return payload
  if (typeof payload.helper !== "object" && !Array.isArray(payload.helpers)) return payload
  const mapped: NextPayload = { ...payload }
  const fileOf = async (helper: Helper | FiledHelper) => {
    if ("brief" in helper && typeof helper.brief === "string")
      return (await withBriefFiles(ctx, task, [helper]))[0]
    if (typeof helper.brief_file === "string") {
      await checkGeneratedBrief(ctx, helper.brief_file)
      const body = await ctx.fs.readFile(helper.brief_file)
      const marked = await markedFor(
        ctx,
        reportingTo(ctx.home, {
          instructions: body,
        }),
      )
      await writeGeneratedBrief(ctx, helper.brief_file, String(marked.instructions))
    }
    return helper
  }
  if (typeof mapped.helper === "object" && mapped.helper !== null) {
    mapped.helper = await fileOf(mapped.helper as Helper | FiledHelper)
  }
  if (Array.isArray(mapped.helpers)) {
    mapped.helpers = await Promise.all((mapped.helpers as (Helper | FiledHelper)[]).map(fileOf))
  }
  await rememberHelperOffers(ctx, task, [
    ...(mapped.helper ? [mapped.helper as FiledHelper] : []),
    ...(Array.isArray(mapped.helpers) ? (mapped.helpers as FiledHelper[]) : []),
  ])
  return mapped
}

/** Every text in a reply (instructions, templates, briefs, steps) names the task's files. */
function withFileNames(_about: About, payload: NextPayload): NextPayload {
  return fillTexts(payload) as NextPayload
}

/** Over this many characters of JSON a reply hands its step's text over as a file. */
export const INLINE_REPLY_LIMIT = 8_000

/**
 * The step's text with the person's and the team's instructions for the step. A reply too long for
 * the agent's tool output leaves the text in a file the reply names.
 */
/**
 * A step's text as the agent gets it: the task's required lines first (what the person's and the
 * team's instructions require here), then the text, then the person's own block for the step. A
 * reply of a step's sub-phase belongs to the task's own step.
 */
export async function stepTextAsServed(
  ctx: Ctx,
  task: Task,
  phase: string,
  text: string,
): Promise<string> {
  const step = flowStepOf(phase)
  const block = step === null ? null : await instructionsBlock(ctx, step)
  const owning = step ?? flowStepOf(task.stage)
  const required = owning === null ? null : await requiredReply(ctx, task, owning)
  let out = text
  if (block !== null) out = `${out}\n\n${block}`.trim()
  if (required !== null) out = `${required}\n\n${out}`.trim()
  return out
}

async function withStepText({ ctx, task }: About, payload: NextPayload): Promise<NextPayload> {
  if (task === null || typeof payload.phase !== "string") return payload
  // A step text already served to this session points at the file holding it (`onceText`).
  if (payload.instructions_once === true) {
    const { instructions_once: _, ...rest } = payload
    return rest
  }
  const out = { ...payload }
  const full = await stepTextAsServed(ctx, task, payload.phase, String(out.instructions ?? ""))
  if (full !== "" || out.instructions !== undefined) out.instructions = full
  // A reply with no step text (a refused record's) stays as it is: an empty file is no text to read.
  if (
    typeof out.instructions !== "string" ||
    out.instructions.trim() === "" ||
    JSON.stringify(out).length <= INLINE_REPLY_LIMIT
  )
    return out
  const digest = createHash("sha256").update(out.instructions).digest("hex").slice(0, 24)
  const briefDir = ctx.managedBriefsDir ?? join(task.runtimeDir, "briefs")
  const file = join(briefDir, `phase-${digest}.md`)
  await ctx.fs.mkdir(briefDir)
  await checkGeneratedBrief(ctx, file)
  const marked = await markedFor(
    ctx,
    reportingTo(ctx.home, {
      instructions: out.instructions,
    }),
  )
  await writeGeneratedBrief(ctx, file, String(marked.instructions))
  out.instructions = `**Read \`${file}\` in full now:** it is this step's text, too long to show in this reply.`
  out.instructions_ref = file
  return out
}

/**
 * A reply as it leaves: what the person said meanwhile (comments, App answers), the step's text with
 * the task's file names, helper briefs as files, and every text marked for the licence. `task`
 * extras are left out for a reply that is not about a task's step (a teammate's ask).
 */
export async function served(
  ctx: Ctx,
  payload: NextPayload,
  extras = true,
): Promise<Result<NextPayload>> {
  const repo = await resolveRepo(ctx)
  const task =
    repo.ok && typeof payload.task === "string"
      ? await loadTask(ctx, repo.data, payload.task)
      : null
  const about: About = { ctx, repo: repo.ok ? repo.data : null, task }
  let reply = payload
  if (extras)
    for (const step of [withAppAnswers, withUpdateNotice]) reply = await step(about, reply)
  const named = await withStepText(about, withFileNames(about, reply))
  const final = await markedFor(ctx, reportingTo(ctx.home, named))
  const marked = await withFiles(about, final)
  const meanwhile = await meanwhileFor(about)
  const clarification = (meanwhile as Record<string, unknown>).clarification_then
  return ok({
    ...marked,
    ...meanwhile,
    ...(typeof clarification === "string"
      ? { instructions: clarification, then: clarification }
      : {}),
  })
}

/** The App answers the agent has not heard yet, for the task the reply is about. */
async function meanwhileFor({ ctx, task }: About): Promise<Meanwhile> {
  if (task === null) return {}
  try {
    const batch = await readBatch(ctx, task)
    const taken = await pollBatch(ctx, task)
    const clarifications = await pendingClarifications(ctx, task)
    if (clarifications.length)
      return {
        ...taken,
        more_requests: clarifications,
        clarification_then: clarificationInstructions(clarifications),
        meanwhile_then: clarificationInstructions(clarifications),
      } as Meanwhile
    // News is an answer just delivered; an answer taken earlier stays news until the agent replied to it.
    const news =
      taken.answered_meanwhile !== undefined ||
      taken.changed_answers !== undefined ||
      taken.item_answers.length > 0 ||
      taken.receipts.some((receipt) => receipt.state !== "acted")
    if (!batch && !news) return {}
    return {
      ...taken,
      ...(news
        ? {
            // QualityLayer writes *Decided with you* from the answers itself.
            meanwhile_then:
              "The person answered in the App meanwhile: apply each answer to your work; QualityLayer records it in *Decided with you*.",
          }
        : {}),
    } as Meanwhile
  } catch (cause) {
    if (await ctx.fs.exists(join(task.runtimeDir, MIGRATION_FILE))) throw cause
    return {}
  }
}
