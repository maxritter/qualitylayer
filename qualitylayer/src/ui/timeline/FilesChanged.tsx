// Shared line-comment anchors and drafts for the review workspace.

export type Anchor = { file: string; side: "old" | "new"; line: number; stamp?: string }
/** What a comment on a line asks for (core/gate/comments.ts): a question, a change or exact lines. */
export type Ask = "question" | "change" | "replace"
export type LineDraft = {
  id?: string
  quote: string
  remark: string
  anchor?: Anchor
  ask?: Ask
  replace?: string
}

export const lineKey = (a: Anchor) =>
  a.stamp
    ? JSON.stringify([a.file, a.stamp, a.side, a.line])
    : `${a.file}:${a.side === "old" ? "L" : "R"}${a.line}`
