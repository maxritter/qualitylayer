import { join } from "node:path"
import { flattenItems } from "../core/items.ts"
import { projectRuntimeDir } from "../core/paths.ts"
import { answeredQuestions, openQuestion, projectedQuestion } from "../core/task/question.ts"
import { homeQuestionDir } from "../core/task/question-app.ts"
import { batchReceipts, readBatch } from "../core/task/question-batch.ts"
import { nativeQuestionPresentation } from "../core/task/question-presentation.ts"
import type { Task } from "../core/task/store.ts"
import { type Ctx, ok } from "../ctx.ts"
import type { TurnSnapshot } from "../interaction/contracts.ts"
import { listProjects, locate, type TaskDetail } from "./api.ts"
import type { InteractionRoute } from "./interaction-route.ts"
import {
  handleBatchPostAction,
  type TurnHost,
  turnBad,
  turnResponse,
} from "./interaction-turn-batch.ts"
import {
  actionableItems,
  commentReceipts,
  handleTurnItemPost,
  handleTurnItemsAgreePost,
} from "./interaction-turn-items.ts"
import { answerFileResponse, readAnswerRequest } from "./question-files.ts"

export const turnCapabilities = { batches: true }

async function snapshot(
  ctx: Ctx,
  host: { runtimeDir: string },
  items: TurnSnapshot["items"],
  task?: Task,
): Promise<TurnSnapshot> {
  const batch = await readBatch(ctx, host)
  const singleton = await openQuestion(ctx, host)
  items = await actionableItems(ctx, host, items)
  const questions = [
    ...(batch?.questions ?? []),
    ...(singleton && !batch?.questions.some((q) => q.id === singleton.id) ? [singleton] : []),
  ]
  return {
    batch,
    questions: questions.map(projectedQuestion),
    ...(task && questions.length
      ? { nativeQuestions: await nativeQuestionPresentation(ctx, task, questions) }
      : {}),
    answered: (await answeredQuestions(ctx, host)).filter((a) => !a.reopened),
    links: batch?.links ?? [],
    items,
    agreements: flattenItems(items)
      .filter((i) => i.kind === "done" && !i.children)
      .map((i) => ({
        item: i.id,
        point: Number(i.id.split(":").at(-1)),
        text: i.what,
        hash: i.digest ?? i.what,
        agreedText: i.answer?.kind === "agree" ? i.what : (i.changedFrom ?? null),
        agreedHash: i.answer?.kind === "agree" ? (i.digest ?? i.what) : null,
        at: i.answer?.at ?? null,
        state: i.changedFrom ? "changed" : i.answer?.kind === "agree" ? "agreed" : "open",
      })),
    receipts: [...(await batchReceipts(ctx, host)), ...(await commentReceipts(ctx, host))],
  }
}

export async function turnSnapshot(task: TaskDetail, ctx: Ctx): Promise<TurnSnapshot> {
  const found = await locate(ctx, task.id)
  return found.ok
    ? snapshot(ctx, found.data.task, task.items ?? [], found.data.task)
    : {
        batch: null,
        questions: task.question ? [task.question] : [],
        answered: task.answeredQuestions ?? [],
        links: [],
        items: task.items ?? [],
        agreements: [],
        receipts: [],
      }
}

async function resolveTurnHost(
  ctx: Ctx,
  id: string | null,
  path: string[],
): Promise<
  | { ok: true; host: TurnHost; task?: Task; action: string | undefined }
  | { ok: false; response: Response }
> {
  const home = id === null && path[1] === "home" && path[2]
  const action = home ? (path[3] ?? "snapshot") : path[1]
  if (id) {
    const found = await locate(ctx, id)
    if (!found.ok) return { ok: false, response: turnResponse(found) }
    return { ok: true, host: found.data.task, task: found.data.task, action }
  }
  if (home) {
    const project = (await listProjects(ctx)).find((p) => p.id === path[2])
    if (!project) return { ok: false, response: turnResponse(turnBad("no such project")) }
    return {
      ok: true,
      host: { runtimeDir: homeQuestionDir(projectRuntimeDir(ctx, project.id)), stage: "plan" },
      action,
    }
  }
  return { ok: false, response: turnResponse(turnBad("a turn belongs to a task or project")) }
}

async function handleTurnGet(
  ctx: Ctx,
  host: TurnHost,
  task: Task | undefined,
  action: string | undefined,
  request: Request,
): Promise<Response | null> {
  if (request.method !== "GET") return null
  if (action === "attachment")
    return answerFileResponse(ctx, host, await answeredQuestions(ctx, host), request)
  if (action === "snapshot") return turnResponse(ok({ turn: await snapshot(ctx, host, [], task) }))
  if (action === "receipts") {
    return turnResponse(
      ok({
        receipts: [...(await batchReceipts(ctx, host)), ...(await commentReceipts(ctx, host))],
      }),
    )
  }
  return null
}

async function dispatchTurnPostAction(
  ctx: Ctx,
  host: TurnHost,
  task: Task | undefined,
  action: string | undefined,
  input: {
    body: Record<string, unknown>
    files: import("../core/interaction-docs/attachments.ts").Incoming[]
  },
): Promise<Response> {
  const batchReply = await handleBatchPostAction(ctx, host, task, action, input)
  if (batchReply) return batchReply
  if (action === "item" && task) return handleTurnItemPost(ctx, task, input.body, input.files)
  if (action === "items" && task) return handleTurnItemsAgreePost(ctx, task, input.body)
  return new Response("not found", { status: 404 })
}

async function handleTurnPost(
  ctx: Ctx,
  host: TurnHost,
  task: Task | undefined,
  action: string | undefined,
  request: Request,
): Promise<Response> {
  if (await ctx.fs.exists(join(host.runtimeDir, "archived.json")))
    return turnResponse(turnBad("Restore this archived task before answering."))
  const parsed = await readAnswerRequest(request)
  if (!parsed.ok) return turnResponse(parsed)
  if (parsed.data.files.length && action !== "answer" && action !== "item")
    return turnResponse(turnBad("Attach files when sending an answer."))
  return dispatchTurnPostAction(ctx, host, task, action, parsed.data)
}

export const turnRoute: InteractionRoute = async (ctx, id, path, request) => {
  if (path[0] !== "turn") return null
  const resolved = await resolveTurnHost(ctx, id, path)
  if (!resolved.ok) return resolved.response
  const { host, task, action } = resolved
  const getReply = await handleTurnGet(ctx, host, task, action, request)
  if (getReply) return getReply
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 })
  return handleTurnPost(ctx, host, task, action, request)
}
