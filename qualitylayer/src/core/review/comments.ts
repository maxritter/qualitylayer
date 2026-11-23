// The team's review threads on a change as comments, the one shape the Comments panel lists: what
// each person said, with the thread it belongs to and where that stands. They come from the review
// log (threads.ts); nothing here is written back.

import type { Comment } from "../gate/comments.ts"
import type { ReviewAnchor, ReviewState } from "./threads.ts"

/** What a thread is about, in the words of the screen it points at. */
export function anchorWords(anchor: ReviewAnchor): string {
  switch (anchor.kind) {
    case "doneMeans":
      return `Done ${anchor.id}`
    case "picture":
    case "check":
      return anchor.id
    case "plan":
      return `Plan · ${anchor.quote ?? anchor.id}`
    case "diff":
      return anchor.line !== undefined ? `${anchor.id} · line ${anchor.line}` : anchor.id
    case "pr":
      return `Pull request · ${anchor.id}`
  }
}

export function reviewComments(review: Pick<ReviewState, "threads">): Comment[] {
  return review.threads.flatMap((thread) => {
    // A thread on a line of the change sits on that line in the Review workspace.
    const { anchor } = thread
    const line =
      anchor.kind === "diff" && anchor.line !== undefined
        ? { anchor: { file: anchor.id, side: anchor.side ?? ("new" as const), line: anchor.line } }
        : {}
    return thread.messages.map<Comment>((m) => ({
      id: `review:${thread.id}:${m.id}`,
      doc: "final",
      quote: anchorWords(thread.anchor),
      remark: m.text,
      created: m.at,
      delivered: true,
      author: m.by,
      ...(m.src === "me"
        ? {}
        : { source: m.src === "link" ? ("link" as const) : ("team" as const) }),
      thread: { id: thread.id, state: thread.state },
      ...line,
    }))
  })
}
