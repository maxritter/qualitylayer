import { folderDoc } from "../docs/names.ts"
import { type Item, type ItemAnswer, pointText } from "../items.ts"
import { jsonBytes, recordHash } from "../records/contract.ts"
import {
  type CurrentAnswerItem,
  currentItemAnswer,
  type ItemAnswerRecord,
  type RetainedItemAnswer,
  sameNativeAnswer,
} from "./item-answers-authority.ts"

export {
  type AnswerAuthority,
  answerAuthorityHash,
  type CurrentAnswerItem,
  type ItemAnswerRecord,
  itemAnswerRecord,
  nativeAnswerIdentity,
  type RetainedItemAnswer,
  retainItemAnswer,
  sameNativeAnswer,
} from "./item-answers-authority.ts"

export const itemAnswerDeliveryId = (record: ItemAnswerRecord) =>
  `item:${record.id}:${record.created}`
export type ItemAnswerRecipient = { session: string; receivedIds: readonly string[] }

export function acceptedNativeItemAction(answers: RetainedItemAnswer[], record: ItemAnswerRecord) {
  const origin = record.originQuestion
  if (!origin) return undefined
  return answers.find((answer) => {
    if (answer.binding.state === "historical" && answer.binding.reason === "external") return false
    const prior = answer.record
    if (prior.item !== record.item || prior.doc !== record.doc || prior.kind !== record.kind)
      return false
    return prior.originQuestion !== undefined && sameNativeAnswer(prior.originQuestion, origin)
  })
}

function sameItemAction(left: RetainedItemAnswer, right: RetainedItemAnswer) {
  const payload = ({ record, attachments }: RetainedItemAnswer) => ({
    doc: record.doc,
    item: record.item,
    kind: record.kind,
    quote: record.quote,
    remark: record.remark,
    seen: record.seen,
    originQuestion: record.originQuestion,
    files: attachments?.map((file) => ({
      name: file.name,
      type: file.type,
      size: file.size,
      asset: file.ref.asset,
    })),
  })
  return jsonBytes(payload(left)) === jsonBytes(payload(right))
}

/** A repeated action can return history, but cannot make that historical action current again. */
export function itemActionChange(
  answers: RetainedItemAnswer[],
  incoming: RetainedItemAnswer,
  withdraw: boolean,
) {
  const existing = answers.find((answer) => answer.record.id === incoming.record.id)
  if (existing) {
    if (!sameItemAction(existing, incoming) || existing.actionId !== incoming.actionId)
      throw new Error("This item action identity already names different words or attachments")
    return {
      answers,
      accepted: existing,
      changed: false,
      reconcile: existing.binding.state === "current",
    }
  }
  const previous = answers.findLast(
    (answer) =>
      answer.record.item === incoming.record.item &&
      !(answer.binding.state === "historical" && answer.binding.reason === "replaced"),
  )
  if (!incoming.actionId && previous && sameItemAction(previous, incoming))
    return {
      answers,
      accepted: previous,
      changed: false,
      reconcile: previous.binding.state === "current",
    }
  const next = answers.map(
    (answer): RetainedItemAnswer =>
      answer.record.item === incoming.record.item
        ? { ...answer, binding: { state: "historical", reason: "replaced" } }
        : answer,
  )
  const unseenWithdrawal =
    withdraw && (!previous || (!previous.handoff && previous.record.delivered !== true))
  const accepted: RetainedItemAnswer = unseenWithdrawal
    ? { ...incoming, binding: { state: "historical", reason: "replaced" } }
    : incoming
  next.push(accepted)
  return { answers: next, accepted, changed: true, reconcile: true }
}

export function newItemAnswer(
  item: Item,
  answer: ItemAnswer | null,
  created: number,
  actionId?: string,
): ItemAnswerRecord {
  const note = answer?.note
  const explicitOption = /^\s*[AB]\b/i.test(note ?? "")
  const remark =
    item.call && answer?.kind === "agree" && !explicitOption
      ? `${item.call.recommended === 1 ? "B" : "A"}${note?.trim() ? ` · ${note.trim()}` : ""}`
      : (note ?? (answer === null ? "Agreement withdrawn; this point is open again." : ""))
  const doc = item.step === "verify" ? "final" : folderDoc(item.step)
  return {
    id: actionId
      ? `c-${recordHash(jsonBytes({ actionId, item: item.id, doc }))}`
      : `c-${crypto.randomUUID()}`,
    doc,
    quote: item.kind === "done" ? pointText(item) : item.what,
    remark,
    created,
    item: item.id,
    kind: answer?.kind ?? "revisit",
    seen: item.digest,
    immediate: true,
  }
}

/** Selection reserves a native handoff; only an existing recipient receipt records delivery. */
export function itemAnswerHandoff(
  answer: RetainedItemAnswer,
  items: CurrentAnswerItem[],
  recipient: ItemAnswerRecipient,
  received: ReadonlySet<string>,
) {
  const { record } = answer
  const unchanged = { answer, changed: false, picked: [] as ItemAnswerRecord[] }
  const handled =
    record.delivered === true || record.answer !== undefined || record.resolved !== undefined
  if (handled) return unchanged
  if (!record.immediate || !currentItemAnswer(answer, items)) return unchanged
  const id = itemAnswerDeliveryId(record)
  if (received.has(id)) {
    return answer.handoff?.session === recipient.session
      ? {
          answer: { ...answer, record: { ...record, delivered: true } },
          changed: true,
          picked: [],
        }
      : unchanged
  }
  if (answer.handoff)
    return { ...unchanged, picked: answer.handoff.session === recipient.session ? [record] : [] }
  return {
    answer: { ...answer, handoff: { session: recipient.session, id } },
    changed: true,
    picked: [record],
  }
}
