// Review feedback follows the stored comment: sent, picked up, or answered. Opening a new gate
// provides no evidence that a requested fix was made or checked.

import type { Ctx } from "../../ctx.ts"
import { type Comment, readComments } from "../gate/comments.ts"
import type { GateFile } from "../gate/gate.ts"
import { ANSWER_LABEL, asksForChange } from "../items.ts"
import { readEvents, type Task } from "../task/store.ts"

export type ChangeNote = {
  id: string
  /** The item it answers, when it answers one. */
  item?: string
  /** "Fix it", or "Your comment". */
  label: string
  /** The words of the item, or of the comment. */
  what: string
  /** `checked`: the fix is in and the agents checked it; Review is back with the person. */
  state: "sent" | "picked" | "done" | "checked"
  /** The commit the agent named when it wrote back. */
  commit?: string
  /** The agent's own words about it. */
  reply?: string
}

export type ChangesRequested = {
  /** When the changes were sent. */
  at: number
  notes: ChangeNote[]
}

const COMMIT = /\b[0-9a-f]{7,12}\b/

function isRequestedChangeComment(c: Comment, before: number, at: number): boolean {
  const isLocalFinal = c.doc === "final" && c.delivered === true && c.build === undefined
  const inWindow = c.source === undefined && c.created > before && c.created <= at + 5_000
  return isLocalFinal && inWindow && (c.kind === undefined || asksForChange(c.kind))
}

function toChangeNote(c: Comment): ChangeNote {
  const said = c.answer ?? ""
  const commit = said.match(COMMIT)?.[0]
  const state = c.answer !== undefined ? "done" : c.pickedAt !== undefined ? "picked" : "sent"
  return {
    id: c.id,
    ...(c.item !== undefined ? { item: c.item } : {}),
    label: c.kind !== undefined ? ANSWER_LABEL[c.kind] : "Your comment",
    what: c.quote.trim() !== "" ? c.quote : c.remark,
    state,
    ...(commit !== undefined ? { commit } : {}),
    ...(said !== "" ? { reply: said } : {}),
  }
}

/**
 * What the person asked for on the last final review. Null when they asked for nothing.
 */
export async function changesRequested(
  ctx: Ctx,
  task: Task,
  _gate: GateFile | null,
  comments?: Comment[],
): Promise<ChangesRequested | null> {
  if (task.stage !== "verify") return null
  const decisions = (await readEvents(ctx, task)).filter(
    (e) => e.event === "gate_decided" && e.target === "final" && typeof e.ts === "number",
  )
  const last = decisions.at(-1)
  if (last === undefined || last.decision !== "changes") return null
  const at = last.ts as number
  const before = decisions.length > 1 ? (decisions[decisions.length - 2]?.ts as number) : 0
  const all = comments ?? (await readComments(ctx, task))
  const notes = all.filter((c) => isRequestedChangeComment(c, before, at)).map(toChangeNote)
  return notes.length > 0 ? { at, notes } : null
}
