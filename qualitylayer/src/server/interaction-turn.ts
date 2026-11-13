import { join } from "node:path"
import { answerKind, putItemAnswer, readComments } from "../core/gate/comments.ts"
import { readGate } from "../core/gate/gate.ts"
import { flattenItems } from "../core/items.ts"
import { projectRuntimeDir } from "../core/paths.ts"
import { token } from "../core/records/contract.ts"
import { continueAnsweredBatch } from "../core/run/answer-continuation.ts"
import { currentTaskRecordOwner } from "../core/task/answer-migration.ts"
import { taskItems } from "../core/task/items.ts"
import { applyPointAgreements, pointAgreements } from "../core/task/point-confirmations.ts"
import { answeredQuestions, openQuestion } from "../core/task/question.ts"
import { appAnswerOf, homeQuestionDir } from "../core/task/question-app.ts"
import {
  answerBatch,
  askBatch,
  batchReceipts,
  cancelBatchMore,
  readBatch,
  undoBatch,
} from "../core/task/question-batch.ts"
import type { Task } from "../core/task/store.ts"
import { type Ctx, err, ok, type Result } from "../ctx.ts"
import type { DeliveryReceipt, TurnSnapshot } from "../interaction/contracts.ts"
import { listProjects, locate, type TaskDetail } from "./api.ts"
import type { InteractionRoute } from "./interaction-route.ts"
import { answerFileResponse, readAnswerRequest } from "./question-files.ts"

export const turnCapabilities = { batches: true }
const response = (result: Result<unknown>) =>
  Response.json(result.ok ? { ok: true, ...(result.data as object) } : result, {
    status: result.ok ? 200 : result.error.code === "no_task" ? 404 : 400,
    headers: { "cache-control": "no-store" },
  })
const bad = (message: string) => err({ code: "bad_args", message })

async function itemActionId(ctx: Ctx, task: Task, body: Record<string, unknown>) {
  if (body.actionId !== undefined && !token(body.actionId))
    return bad("Invalid saved action identity")
  if ((await currentTaskRecordOwner(ctx, task)) && body.actionId === undefined)
    return bad("Refresh this page before answering.")
  return ok(body.actionId as string | undefined)
}
async function actionableItems(
  ctx: Ctx,
  host: { runtimeDir: string },
  items: TurnSnapshot["items"],
): Promise<TurnSnapshot["items"]> {
  const enable = (items: TurnSnapshot["items"]): TurnSnapshot["items"] =>
    items.map((item) => ({
      ...item,
      ...(!item.children && item.kind === "decided"
        ? {
            answers: {
              ...item.answers,
              options: ["keep", "change"] as typeof item.answers.options,
            },
          }
        : {}),
      ...(item.children
        ? { children: enable(item.children) }
        : item.kind === "done"
          ? { answers: { ...item.answers, options: ["agree", "change"] } }
          : {}),
    }))
  return applyPointAgreements(
    enable(items),
    await pointAgreements(ctx, host, await readComments(ctx, host)),
  )
}
async function commentReceipts(ctx: Ctx, host: { runtimeDir: string }): Promise<DeliveryReceipt[]> {
  return (await readComments(ctx, host))
    .filter((c) => c.immediate)
    .map((c) => ({
      id: c.id,
      kind: "agreement",
      state: c.answer !== undefined ? "acted" : c.pickedAt !== undefined ? "picked-up" : "saved",
      saved: c.created,
      pickedUp: c.pickedAt ?? null,
      acted: c.answered ?? null,
      reply: c.answer ?? null,
    }))
}
async function snapshot(
  ctx: Ctx,
  host: { runtimeDir: string },
  items: TurnSnapshot["items"],
): Promise<TurnSnapshot> {
  const batch = await readBatch(ctx, host)
  const singleton = await openQuestion(ctx, host)
  items = await actionableItems(ctx, host, items)
  return {
    batch,
    questions: [
      ...(batch?.questions ?? []),
      ...(singleton && !batch?.questions.some((q) => q.id === singleton.id) ? [singleton] : []),
    ],
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
    ? snapshot(ctx, found.data.task, task.items ?? [])
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
export const turnRoute: InteractionRoute = async (ctx, id, path, request) => {
  if (path[0] !== "turn") return null
  const home = id === null && path[1] === "home" && path[2]
  const action = home ? (path[3] ?? "snapshot") : path[1]
  let host: Pick<Task, "runtimeDir" | "stage"> | null = null
  const found = id ? await locate(ctx, id) : null
  if (found && !found.ok) return response(found)
  if (found?.ok) host = found.data.task
  if (home) {
    const project = (await listProjects(ctx)).find((p) => p.id === path[2])
    if (!project) return response(bad("no such project"))
    host = {
      runtimeDir: homeQuestionDir(projectRuntimeDir(ctx, project.id)),
      stage: "plan",
    }
  }
  if (!host) return response(bad("a turn belongs to a task or project"))
  if (request.method === "GET" && action === "attachment")
    return answerFileResponse(ctx, host, await answeredQuestions(ctx, host), request)
  if (request.method === "GET" && action === "snapshot")
    return response(ok({ turn: await snapshot(ctx, host, []) }))
  if (request.method === "GET" && action === "receipts")
    return response(
      ok({
        receipts: [...(await batchReceipts(ctx, host)), ...(await commentReceipts(ctx, host))],
      }),
    )
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 })
  if (await ctx.fs.exists(join(host.runtimeDir, "archived.json")))
    return response(bad("Restore this archived task before answering."))
  const parsed = await readAnswerRequest(request)
  if (!parsed.ok) return response(parsed)
  const { body, files } = parsed.data
  if (files.length && action !== "answer" && action !== "item")
    return response(bad("Attach files when sending an answer."))
  if (action === "batch") {
    const batch = await askBatch(ctx, host, body)
    return response(batch.ok ? ok({ batch: batch.data }) : batch)
  }
  if (action === "answer") {
    const answer = appAnswerOf(body)
    if (
      !answer ||
      typeof body.batch !== "string" ||
      ["choice", "choices", "text", "unsure", "more"].filter((key) => body[key] !== undefined)
        .length !== 1
    )
      return response(bad("expected {batch, id, choice | choices | text | unsure | more}"))
    const answered = await answerBatch(ctx, host, { ...answer, batch: body.batch }, { files })
    if (answered.ok && "answer" in answered.data && answered.data.answer.id && found?.ok)
      await continueAnsweredBatch(ctx, found.data.task, answered.data.answer.id)
    return response(answered)
  }
  if (action === "cancel-more") {
    if (typeof body.batch !== "string" || typeof body.id !== "string")
      return response(bad("expected {batch,id}"))
    const cancelled = await cancelBatchMore(ctx, host, { batch: body.batch, id: body.id })
    return response(cancelled.ok ? ok({ question: cancelled.data }) : cancelled)
  }
  if (action === "undo" || action === "change") {
    if (
      typeof body.batch !== "string" ||
      typeof body.id !== "string" ||
      typeof body.answerAt !== "number"
    )
      return response(bad("expected {batch,id,answerAt}"))
    if (action === "change" && found?.ok && found.data.task.stage !== "plan")
      return response(bad("this answer is part of the approved Plan now"))
    const batch = await undoBatch(
      ctx,
      host,
      { batch: body.batch, id: body.id, answerAt: body.answerAt },
      action === "change",
    )
    return response(batch.ok ? ok({ batch: batch.data }) : batch)
  }
  if (action === "item" && found?.ok) {
    const task = found.data.task
    const actionId = await itemActionId(ctx, task, body)
    if (!actionId.ok) return response(actionId)
    const item = flattenItems(
      await actionableItems(ctx, task, await taskItems(ctx, task, await readGate(ctx, task))),
    ).find((i) => i.id === body.item)
    if (!item || item.digest !== body.seen)
      return response(bad("This point changed. Read its current wording before answering."))
    if (item.kind === "question" || item.kind === "handback" || item.kind === "confirm")
      return response(bad("use this item's own guarded action"))
    const value = body.answer as Record<string, unknown> | null
    const kind = value && answerKind(value.kind)
    if (
      value !== null &&
      (!kind || (!item.answers.options.includes(kind) && item.answers.link !== kind))
    )
      return response(bad("this item has no such answer"))
    const note = typeof value?.note === "string" ? value.note.trim() : ""
    if (note.length > 4000) return response(bad("shorten your note to 4000 characters"))
    if (files.length && value === null) return response(bad("Attach files when sending an answer."))
    const comment = await putItemAnswer(
      ctx,
      task,
      item,
      value === null
        ? null
        : {
            kind: kind as NonNullable<typeof kind>,
            at: ctx.clock.now(),
            ...(note ? { note } : {}),
          },
      { files, actionId: actionId.data },
    )
    const next = flattenItems(
      await actionableItems(ctx, task, await taskItems(ctx, task, await readGate(ctx, task))),
    ).find((i) => i.id === item.id)
    return response(
      ok({
        item: next ?? item,
        receipt: comment
          ? (await commentReceipts(ctx, task)).find((r) => r.id === comment.id)
          : null,
      }),
    )
  }
  if (action === "items" && found?.ok) {
    const task = found.data.task
    const actionId = await itemActionId(ctx, task, body)
    if (!actionId.ok) return response(actionId)
    if (
      !Array.isArray(body.items) ||
      body.items.length === 0 ||
      body.items.length > 500 ||
      !body.items.every(
        (value) =>
          value &&
          typeof value === "object" &&
          typeof value.item === "string" &&
          typeof value.seen === "string",
      ) ||
      !body.answer ||
      typeof body.answer !== "object" ||
      (body.answer as Record<string, unknown>).kind !== "agree"
    )
      return response(bad("expected {items:[{item,seen}],answer:{kind:'agree'}}"))
    const requested = body.items as { item: string; seen: string }[]
    if (new Set(requested.map((value) => value.item)).size !== requested.length)
      return response(bad("a point must appear only once"))
    return ctx.fs.withLock(join(task.runtimeDir, "comments.lock"), async () => {
      const items = flattenItems(
        await actionableItems(ctx, task, await taskItems(ctx, task, await readGate(ctx, task))),
      )
      const stale = requested
        .filter((value) => {
          const item = items.find((item) => item.id === value.item)
          return (
            !item ||
            item.digest !== value.seen ||
            item.kind !== "done" ||
            !!item.children ||
            !item.answers.options.includes("agree")
          )
        })
        .map((value) => value.item)
      if (stale.length)
        return Response.json(
          {
            ok: false,
            error: {
              code: "bad_args",
              message: `These points changed: ${stale.join(", ")}. Read their current wording before agreeing.`,
              stale,
            },
          },
          { status: 400 },
        )
      for (const value of requested) {
        const item = items.find((item) => item.id === value.item)
        if (
          item &&
          item.state === "open" &&
          item.answer?.kind !== "change" &&
          item.answer?.kind !== "fix"
        )
          await putItemAnswer(
            ctx,
            task,
            item,
            { kind: "agree", at: ctx.clock.now() },
            { held: true, actionId: actionId.data },
          )
      }
      return response(
        ok({
          items: await actionableItems(
            ctx,
            task,
            await taskItems(ctx, task, await readGate(ctx, task)),
          ),
        }),
      )
    })
  }
  return new Response("not found", { status: 404 })
}
