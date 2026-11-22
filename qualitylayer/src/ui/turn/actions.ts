import { useCallback, useEffect } from "react"
import { toast } from "sonner"
import type { Item, ItemAnswer } from "../../core/items.ts"
import type { AnsweredQuestion, Question } from "../../core/task/question.ts"
import { askedInAgent } from "../../core/task/sides.ts"
import type { BatchAnswer, DeliveryReceipt, TurnSnapshot } from "../../interaction/contracts.ts"
import { recommendedIndices, recommendedLabel } from "../../interaction/question-recommendations.ts"
import { type Api, interactionApi, api as liveApi, type TaskDetail } from "../api.ts"
import { jumpToItem } from "../jump.ts"
import { acknowledgeTurn } from "./acknowledge.ts"
import { answerBody } from "./answer-body.ts"
import { optimisticTurn, publishServerTurn, turnFor, useTurnSnapshot } from "./projection.ts"

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
export function useBatchActions(task: TaskDetail, reload: () => void) {
  return useCallback(
    (answer: BatchAnswer, files: File[] = []) => {
      const post = () =>
        interactionApi.taskRoute<{ answer?: AnsweredQuestion; receipt?: DeliveryReceipt }>(
          task.id,
          "turn",
          "answer",
          {
            method: "POST",
            body: answerBody(answer, files),
          },
        )
      const turn = turnFor(task.id)
      const q = turn?.questions.find((q) => q.id === answer.id)
      if (!q) {
        if (!answer.revision) return Promise.resolve(false)
        return mutateTurn<{ answer?: AnsweredQuestion; receipt?: DeliveryReceipt }>(
          task.id,
          "answer",
          answer,
          (was) => was,
          post,
        ).then((result) => {
          reload()
          return result.answer !== undefined
        })
      }
      const at = Date.now()
      const entry: AnsweredQuestion = {
        id: q.id,
        question: q.question,
        number: q.number,
        choice:
          "choices" in answer
            ? answer.choices.map((i) => q.choices[i]?.label ?? "").join(" + ")
            : "choice" in answer
              ? (q.choices[answer.choice]?.label ?? "")
              : "text" in answer
                ? answer.text
                : recommendedLabel(q),
        ...("choices" in answer || ("unsure" in answer && q.multi && q.recommendedChoices)
          ? {
              picked: "choices" in answer ? answer.choices : recommendedIndices(q),
              pickedLabels: ("choices" in answer ? answer.choices : recommendedIndices(q)).map(
                (i) => q.choices[i]?.label ?? "",
              ),
            }
          : {}),
        at,
        via: "app",
        delivered: false,
        ...(q.multi === true && q.gate === undefined ? { multi: true as const } : {}),
        ...(q.agent ? { agent: q.agent } : {}),
        ...(q.about ? { about: q.about } : {}),
        ...("unsure" in answer ? { kind: "unsure" } : {}),
      }
      return mutateTurn<{ answer?: AnsweredQuestion; receipt?: DeliveryReceipt }>(
        task.id,
        "answer",
        answer,
        (was) =>
          files.length || askedInAgent({ answers: task.answers, approvals: task.approvals }, [q])
            ? was
            : "more" in answer
              ? {
                  ...was,
                  questions: was.questions.map((it) =>
                    it.id === q.id ? { ...it, more: { request: answer.more.request, at } } : it,
                  ),
                }
              : {
                  ...was,
                  questions: was.questions.filter((it) => it.id !== q.id),
                  answered: [...was.answered.filter((a) => a.id !== entry.id), entry],
                },
        post,
      ).then(
        (result) => {
          reload()
          if (!result.answer) return true
          const saved = result.answer
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
          return true
        },
        // A refusal rejects: the card shows it on its own line and keeps the answer, with no second toast.
      )
    },
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
export function useItemAnswers(task: TaskDetail, reload: () => void) {
  return useCallback(
    (item: Item, answer: ItemAnswer | null, files: File[] = []) => {
      const map = (items: Item[]): Item[] =>
        items.map((it) =>
          it.id === item.id
            ? { ...it, state: answer ? "sent" : "open", answer: answer ?? undefined }
            : { ...it, ...(it.children ? { children: map(it.children) } : {}) },
        )
      return mutateTurn(
        task.id,
        "item",
        { item: item.id, answer, seen: item.digest },
        (was) =>
          files.length
            ? was
            : {
                ...was,
                items: map(was.items),
              },
        () =>
          interactionApi.taskRoute(task.id, "turn", "item", {
            method: "POST",
            body: answerBody({ item: item.id, answer, seen: item.digest }, files),
          }),
      ).then(
        () => {
          reload()
          if (answer)
            toast("Answer sent", {
              duration: 5000,
              action: {
                label: "Undo",
                onClick: () => {
                  void mutateTurn(
                    task.id,
                    "item",
                    { item: item.id, answer: null, seen: item.digest },
                    (was) => ({ ...was, items: was.items }),
                  ).then(reload, (error) => toast.error(error.message))
                },
              },
            })
          return true
        },
        // The Your call card shows the failure inline (DecisionCard): no second toast.
        () => false,
      )
    },
    [task.id, reload],
  )
}
