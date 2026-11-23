import type { Item } from "../../core/items.ts"
import type { AnsweredQuestion, Question } from "../../core/task/question.ts"
import type { DeliveryReceipt, QuestionBatch } from "../../interaction/contracts.ts"
import { publishTurn, storedTurn } from "./projection.ts"

type TurnAckReply = {
  answer?: AnsweredQuestion
  more?: Question
  item?: Item
  receipt?: DeliveryReceipt | null
  batch?: QuestionBatch
}

function replaceItemInTree(items: Item[], replacement: Item): Item[] {
  return items.map((item) =>
    item.id === replacement.id
      ? replacement
      : {
          ...item,
          ...(item.children ? { children: replaceItemInTree(item.children, replacement) } : {}),
        },
  )
}

function nextQuestions(base: Question[], reply: TurnAckReply): Question[] {
  if (reply.batch) return reply.batch.questions
  if (reply.answer) return base.filter((q) => q.id !== reply.answer?.id)
  if (reply.more) return base.map((q) => (q.id === reply.more?.id ? (reply.more as Question) : q))
  return base
}

function nextAnswered(base: AnsweredQuestion[], reply: TurnAckReply): AnsweredQuestion[] {
  if (reply.answer) return [...base.filter((a) => a.id !== reply.answer?.id), reply.answer]
  if (reply.batch) {
    const reopenedIds = new Set(reply.batch.questions.map((q) => q.id))
    return base.filter((a) => !a.id || !reopenedIds.has(a.id))
  }
  return base
}

// A write's canonical response is proof of saving even when the next read loses its connection.
export function acknowledgeTurn(id: string, result: unknown) {
  const base = storedTurn(id)
  if (!base || !result || typeof result !== "object") return
  const reply = result as TurnAckReply
  const questions = nextQuestions(base.questions, reply)
  publishTurn(id, {
    ...base,
    batch: reply.batch ?? (base.batch ? { ...base.batch, questions } : null),
    questions,
    answered: nextAnswered(base.answered, reply),
    items: reply.item ? replaceItemInTree(base.items, reply.item) : base.items,
    receipts: reply.receipt
      ? [...base.receipts.filter((r) => r.id !== reply.receipt?.id), reply.receipt]
      : base.receipts,
  })
}
