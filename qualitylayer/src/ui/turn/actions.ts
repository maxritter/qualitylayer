import { useCallback, useEffect } from "react"
import { toast } from "sonner"
import type { Item, ItemAnswer } from "../../core/items.ts"
import type { AnsweredQuestion, Question } from "../../core/task/question.ts"
import { askedInAgent } from "../../core/task/sides.ts"
import type { BatchAnswer, DeliveryReceipt, TurnSnapshot } from "../../interaction/contracts.ts"
import { type Api, interactionApi, api as liveApi, type TaskDetail } from "../api.ts"
import { jumpToItem } from "../jump.ts"
import { acknowledgeTurn } from "./acknowledge.ts"
import { answerBody } from "./answer-body.ts"
import { optimisticTurn, publishServerTurn, turnFor, useTurnSnapshot } from "./projection.ts"
import {
  applyOptimisticAnswer,
  buildAnsweredEntry,
  replaceItemAnswer,
} from "./turn-action-helpers.ts"

let readSequence = 0
const latestRead = new Map<string, number>()

export async function refreshTurn(id: string) {
  const sequence = ++readSequence
  const snapshot = await interactionApi.task(id)
  if (sequence >= (latestRead.get(id) ?? 0)) {
    latestRead.set(id, sequence)
    publishServerTurn(id, snapshot.turn)
  }
  return snapshot.turn
}

export function useTurnData(task: TaskDetail, api: Api, version: number) {
  const turn = useTurnSnapshot(task.id)
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the server event generation
  useEffect(() => {
    if (api === liveApi) void refreshTurn(task.id).catch(() => {})
  }, [task.id, api, version])
  return turn
}

export async function mutateTurn<T>(
  id: string,
  action: string,
  body: unknown,
  update: (turn: TurnSnapshot) => TurnSnapshot,
  request?: () => Promise<T>,
): Promise<T> {
  const rollback = optimisticTurn(id, update)
  latestRead.set(id, ++readSequence)
  try {
    const result = request
      ? await request()
      : await interactionApi.taskRoute<T>(id, "turn", action, {
          method: "POST",
          body: JSON.stringify(body),
        })
    latestRead.set(id, ++readSequence)
    acknowledgeTurn(id, result)
    rollback()
    void refreshTurn(id).catch(() => {})
    return result
  } catch (error) {
    rollback()
    throw error
  }
}

type AnswerRouteResult = { answer?: AnsweredQuestion; receipt?: DeliveryReceipt }

function sendBatchAnswer(
  task: Pick<TaskDetail, "id" | "answers" | "approvals">,
  reload: () => void,
  answer: BatchAnswer,
  files: File[],
) {
  const post = () =>
    interactionApi.taskRoute<AnswerRouteResult>(task.id, "turn", "answer", {
      method: "POST",
      body: answerBody(answer, files),
    })
  const q = turnFor(task.id)?.questions.find((row) => row.id === answer.id)
  if (!q) {
    if (!answer.revision) return Promise.resolve(false)
    return mutateTurn<AnswerRouteResult>(task.id, "answer", answer, (was) => was, post).then(
      (result) => {
        reload()
        return result.answer !== undefined
      },
    )
  }
  const at = Date.now()
  const entry = buildAnsweredEntry(q, answer, at)
  const skipOptimistic =
    files.length > 0 || askedInAgent({ answers: task.answers, approvals: task.approvals }, [q])
  return mutateTurn<AnswerRouteResult>(
    task.id,
    "answer",
    answer,
    (was) => applyOptimisticAnswer({ was, q, answer, entry, at, skipOptimistic }),
    post,
  ).then((result) => {
    reload()
    const saved = result.answer
    if (saved) {
      toast("Answer sent", {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: () => {
            void reopenQuestion(task.id, answer.batch, saved, false).then(reload, (error) =>
              toast.error(error.message),
            )
          },
        },
      })
    }
    return true
  })
}

export function useBatchActions(task: TaskDetail, reload: () => void) {
  return useCallback(
    (answer: BatchAnswer, files: File[] = []) =>
      sendBatchAnswer(
        { id: task.id, answers: task.answers, approvals: task.approvals },
        reload,
        answer,
        files,
      ),
    [task.id, task.answers, task.approvals, reload],
  )
}

/**
 * Cancel on a Tell me more request of a batch member. The request stays open in the turn until the
 * server has saved the cancel (the card shows it pending meanwhile), then the card goes back to
 * plain waiting from the server's own answer. A refusal leaves the request as it was and says why;
 * the result is whether the server saved the cancel.
 */
export async function cancelBatchMore(taskId: string, batch: string, id: string) {
  try {
    await mutateTurn<{ question?: Question }>(
      taskId,
      "cancel-more",
      { batch, id },
      (was) => was,
      async () => {
        const result = await interactionApi.taskRoute<{ question?: Question }>(
          taskId,
          "turn",
          "cancel-more",
          { method: "POST", body: JSON.stringify({ batch, id }) },
        )
        // acknowledgeTurn reads the saved member from `more`.
        return result.question ? { ...result, more: result.question } : result
      },
    )
    return true
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not cancel the request")
    return false
  }
}

export async function reopenQuestion(
  id: string,
  batch: string,
  answer: AnsweredQuestion,
  change: boolean,
) {
  // A reopened member needs the original full choices. Refresh it from the guarded route.
  const result = await interactionApi.taskRoute<{ batch: NonNullable<TurnSnapshot["batch"]> }>(
    id,
    "turn",
    change ? "change" : "undo",
    { method: "POST", body: JSON.stringify({ batch, id: answer.id, answerAt: answer.at }) },
  )
  acknowledgeTurn(id, result)
  void refreshTurn(id).catch(() => {})
  if (answer.id) jumpToItem(`question:${answer.id}`)
}

function sendItemAnswer(
  taskId: string,
  reload: () => void,
  item: Item,
  answer: ItemAnswer | null,
  files: File[],
) {
  return mutateTurn(
    taskId,
    "item",
    { item: item.id, answer, seen: item.digest },
    (was) =>
      files.length ? was : { ...was, items: replaceItemAnswer(was.items, item.id, answer) },
    () =>
      interactionApi.taskRoute(taskId, "turn", "item", {
        method: "POST",
        body: answerBody({ item: item.id, answer, seen: item.digest }, files),
      }),
  ).then(
    () => {
      reload()
      if (answer) {
        toast("Answer sent", {
          duration: 5000,
          action: {
            label: "Undo",
            onClick: () => {
              void mutateTurn(
                taskId,
                "item",
                { item: item.id, answer: null, seen: item.digest },
                (was) => ({ ...was, items: was.items }),
              ).then(reload, (error) => toast.error(error.message))
            },
          },
        })
      }
      return true
    },
    () => false,
  )
}

export function useItemAnswers(task: TaskDetail, reload: () => void) {
  return useCallback(
    (item: Item, answer: ItemAnswer | null, files: File[] = []) =>
      sendItemAnswer(task.id, reload, item, answer, files),
    [task.id, reload],
  )
}
