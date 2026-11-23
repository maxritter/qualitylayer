import { toast } from "sonner"
import type { AnsweredQuestion } from "../../core/task/question.ts"
import { recommendedLabel } from "../../interaction/question-recommendations.ts"
import type { Api, TaskDetail } from "../api.ts"
import type { QuestionActions } from "../FocusQuestion.tsx"
import { questionError } from "./errors.ts"

type QuestionDelivery = {
  api: Pick<Api, "answerQuestion" | "focusQuestion" | "cancelMore" | "changeAnswer">
  task: TaskDetail
  reload: () => void
  onQuestionAnswer?: (id: string, answer: AnsweredQuestion | null) => void
}

type AnswerInput = Parameters<QuestionActions["answer"]>[0]
type OpenQuestion = NonNullable<TaskDetail["question"]>

function optimisticChoiceLabel(open: OpenQuestion, answer: AnswerInput) {
  if ("choices" in answer)
    return answer.choices.map((i) => open.choices[i]?.label ?? "").join(" + ")
  if ("choice" in answer) return open.choices[answer.choice]?.label ?? ""
  if ("text" in answer) return answer.text
  return recommendedLabel(open) ?? ""
}

function buildOptimisticAnswer(open: OpenQuestion, answer: AnswerInput): AnsweredQuestion {
  return {
    id: open.id,
    number: open.number,
    question: open.question,
    choice: optimisticChoiceLabel(open, answer),
    at: Date.now(),
    via: "app",
    delivered: false,
    ...(open.agent !== undefined ? { agent: open.agent } : {}),
    ...(open.about !== undefined ? { about: open.about } : {}),
  }
}

function buildAnswerPayload(openId: string, answer: AnswerInput) {
  let body: Record<string, unknown>
  if ("choices" in answer) body = { choices: answer.choices }
  else if ("choice" in answer) body = { choice: answer.choice }
  else if ("text" in answer) body = { text: answer.text }
  else if ("more" in answer) body = { more: { request: answer.request ?? "" } }
  else body = { unsure: true as const }
  return { id: openId, ...body } as Parameters<Api["answerQuestion"]>[1]
}

async function runToastAction(
  work: () => Promise<void>,
  onSuccess?: () => void,
  onError?: () => void,
) {
  try {
    await work()
    onSuccess?.()
    return true
  } catch (cause) {
    toast.error(questionError(cause))
    onError?.()
    return false
  }
}

async function submitOpenAnswer(
  delivery: QuestionDelivery,
  answer: AnswerInput,
  files: Parameters<QuestionActions["answer"]>[1],
) {
  const { api, task, reload, onQuestionAnswer } = delivery
  const open = task.question
  if (open == null) return false
  if (!("more" in answer) && !files?.length) {
    onQuestionAnswer?.(task.id, buildOptimisticAnswer(open, answer))
  }
  try {
    await api.answerQuestion(task.id, buildAnswerPayload(open.id, answer), files)
    reload()
    return true
  } catch (cause) {
    onQuestionAnswer?.(task.id, null)
    // The card shows the failure inline and keeps the answer; no second message here.
    reload()
    throw cause
  }
}

export function questionActionsFor(delivery: QuestionDelivery): QuestionActions {
  const { api, task, reload } = delivery
  const focus = api.focusQuestion
  /** The question card's answers, sent at once: a refusal is said where the person looks. */
  return {
    answer: (answer, files) => submitOpenAnswer(delivery, answer, files),
    answerRest: (members) =>
      runToastAction(
        async () => {
          for (const member of members) {
            const payload = member.choices ? { choices: member.choices } : { choice: member.choice }
            await api.answerQuestion(task.id, { id: member.id, ...payload })
          }
          reload()
        },
        undefined,
        reload,
      ),
    ...(focus !== undefined
      ? {
          focus: (id: string) =>
            runToastAction(async () => {
              await focus(task.id, id)
              reload()
            }),
        }
      : {}),
    cancel: () =>
      runToastAction(async () => {
        await api.cancelMore(task.id)
        reload()
      }),
    change: (number, answer) =>
      runToastAction(
        async () => {
          await api.changeAnswer(task.id, { number, ...answer })
          reload()
        },
        () => toast.success("Changed. The agent hears of it with its next step"),
      ),
  }
}
