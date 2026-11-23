import { type Ctx, err, ok } from "../../ctx.ts"
import { recordAttestation } from "../attestations.ts"
import { putItemAnswer } from "../gate/comments.ts"
import { readGate } from "../gate/gate.ts"
import { lockPath } from "../gate/lock.ts"
import { flattenItems } from "../items.ts"
import { inPersonReview } from "../review/in-review.ts"
import { isArchived } from "../task/archive.ts"
import { taskItems } from "../task/items.ts"
import type { Task } from "../task/store.ts"

function gateMismatch(gate: Awaited<ReturnType<typeof readGate>>, gateId: unknown): boolean {
  if (gate?.target !== "final") return false
  return gate.decision === "pending" && !gate.settled && gate.id !== gateId
}

function parseConfirmInput(input: Record<string, unknown>) {
  const kind = input.kind
  if (kind !== "confirm" && kind !== "record")
    return err({ code: "bad_args", message: "Choose I confirm or Answer in words." })
  if (typeof input.note !== "string" || input.note.length > 4000)
    return err({
      code: "bad_args",
      message: "A confirmation note must be at most 4000 characters.",
    })
  const note = input.note.trim()
  if (kind === "record" && note === "")
    return err({ code: "bad_args", message: "Tell the agent what to record." })
  return ok<{ kind: "confirm" | "record"; note: string }>({ kind, note })
}

function confirmationReceipt(comment: Awaited<ReturnType<typeof putItemAnswer>>) {
  if (comment === null) return null
  return {
    id: comment.id,
    kind: "agreement" as const,
    state: "saved" as const,
    saved: comment.created,
    pickedUp: null,
    acted: null,
    reply: null,
  }
}

export async function confirmPoint(ctx: Ctx, task: Task, input: Record<string, unknown>) {
  return ctx.fs.withLock(lockPath(task), async () => {
    if (await isArchived(ctx, task))
      return err({ code: "bad_args", message: "Restore this task before answering." })
    const gate = await readGate(ctx, task)
    if (!(await inPersonReview(ctx, task)) || gateMismatch(gate, input.gateId))
      return err({
        code: "no_gate",
        message: "This review changed. Read the current review before confirming.",
      })
    const item = flattenItems(await taskItems(ctx, task, gate)).find(
      (entry) => entry.id === input.item,
    )
    if (item?.kind !== "confirm" || item.digest !== input.seen)
      return err({
        code: "bad_args",
        message: "This point changed. Read its current wording before confirming.",
      })
    const parsed = parseConfirmInput(input)
    if (!parsed.ok) return parsed
    const text = parsed.data.note || `I confirm: ${item.what}`
    if (parsed.data.kind === "confirm") {
      const attested = await recordAttestation(ctx, task, {
        item: item.id.replace(/^verify:confirm:/, ""),
        text,
        by: "you",
      })
      if (!attested.ok) return attested
    }
    const comment = await putItemAnswer(ctx, task, item, {
      kind: parsed.data.kind,
      note: text,
      at: ctx.clock.now(),
    })
    const saved = flattenItems(await taskItems(ctx, task, gate)).find(
      (entry) => entry.id === item.id,
    )
    return ok({
      item: saved ?? item,
      receipt: confirmationReceipt(comment),
    })
  })
}
