import { flattenItems, type Item, type ItemAnswer, openCount } from "../core/items.ts"
import type { AnsweredQuestion } from "../core/task/question.ts"
import type { TaskDetail, TaskSummary } from "./api.ts"

function itemAnswerPatch(item: Item, answer: ItemAnswer | undefined): Partial<Item> {
  if (answer !== undefined) {
    return {
      state: "chosen",
      answer,
      ...(answer.at !== item.answer?.at ? { updated: false } : {}),
    }
  }
  return item.state === "chosen" ? { state: "open", answer: undefined } : {}
}

function applyItemAnswers(
  items: readonly Item[],
  answers: Readonly<Record<string, ItemAnswer>>,
): Item[] {
  return items.map((item) => {
    const children =
      item.children !== undefined ? applyItemAnswers(item.children, answers) : undefined
    return {
      ...item,
      ...(children !== undefined ? { children } : {}),
      ...itemAnswerPatch(item, answers[item.id]),
    }
  })
}

/** Native item picks drive the same immediate counts as question answers, while drafts save. */
export function itemPreview(
  task: TaskDetail,
  answers: Readonly<Record<string, ItemAnswer>>,
  countLeaves = false,
): TaskDetail {
  const items = applyItemAnswers(task.items ?? [], answers)
  const counted = countLeaves ? flattenItems(items).filter((i) => !i.children) : items
  const openItems = openCount(counted)
  return { ...task, items, openItems, ...(openItems === 0 ? { needs: [] } : {}) }
}

/** An answer updates every surface together until the matching server record arrives. */
export function questionPreview<
  T extends TaskSummary & Partial<Pick<TaskDetail, "question" | "answeredQuestions" | "items">>,
>(task: T, answer: AnsweredQuestion | undefined): T {
  if (answer === undefined) return task
  const current = task.question
  if (current != null && current.id !== answer.id) return task
  if (
    current === undefined &&
    task.live?.question != null &&
    task.live.question.number !== answer.number
  )
    return task
  const items = task.items?.filter((i) => i.kind !== "question")
  const wasOpen = current != null || task.live?.question?.number === answer.number
  const recorded = task.answeredQuestions?.find((q) => q.id === answer.id) ?? answer
  return {
    ...task,
    question: null,
    ...(items !== undefined ? { items } : {}),
    answeredQuestions: [
      ...(task.answeredQuestions ?? []).filter((q) => q.id !== answer.id),
      recorded,
    ],
    openItems:
      items !== undefined
        ? openCount(items)
        : Math.max(0, (task.openItems ?? 0) - (wasOpen ? 1 : 0)),
    ...(task.live != null ? { live: { ...task.live, question: null } } : {}),
  }
}
