// A comment on the running build: on a slice, a task, a checkpoint, a picture or a line of the diff.
// It is sent at once and says where it stands: sent, picked up by the build after the task it had
// just reported, then answered with what changed. The build reads comments with `comments take`
// after each task and answers each with `comments resolve --answer`.

import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react"
import type { BuildAnchor, Comment } from "../../core/gate/comments.ts"
import { ago } from "../hooks.ts"
import { WhoMark } from "../kit/WhoMark.tsx"
import { initialsOf } from "../model.ts"

/** A comment on a build item, as the task lists it. */
export type BuildComment = Comment & { build: BuildAnchor }

type Feedback = {
  comments: BuildComment[]
  /** Who is saying it: the person's own name. */
  me: string
  send: (anchor: BuildAnchor, remark: string) => Promise<void>
}

const FeedbackContext = createContext<
  (Feedback & { composing: string | null; compose: (key: string | null) => void }) | null
>(null)

/** Gives every item below it a comment button; without a provider the items carry none. */
export function FeedbackProvider({
  feedback,
  children,
}: {
  feedback: Feedback | null
  children: ReactNode
}) {
  const [composing, compose] = useState<string | null>(null)
  return (
    <FeedbackContext.Provider
      value={feedback === null ? null : { ...feedback, composing, compose }}
    >
      {children}
    </FeedbackContext.Provider>
  )
}

/** The item a comment is on: same kind and id, and for a diff line the same text or else the same line. */
function matches(c: BuildComment, anchor: BuildAnchor): boolean {
  if (c.build.kind !== anchor.kind || c.build.id !== anchor.id) return false
  if (anchor.kind !== "diff") return true
  if (c.build.quote !== undefined && anchor.quote !== undefined)
    return c.build.quote === anchor.quote
  return c.build.line === anchor.line
}

const keyOf = (a: BuildAnchor) => `${a.kind}:${a.id}:${a.line ?? ""}`

export const stateOf = (c: BuildComment): "answered" | "picked up" | "sent" =>
  c.answer !== undefined ? "answered" : c.delivered === true ? "picked up" : "sent"

const FIXED_PLACES: Partial<Record<BuildAnchor["kind"], string>> = {
  picture: "a picture",
  run: "a running task",
  deviation: "a choice the build made",
}

/** Where a comment was made, in a few words: "T7", "slice 3", "checkpoint 2". */
export function placeOf(anchor: BuildAnchor): string {
  const fixed = FIXED_PLACES[anchor.kind]
  if (fixed !== undefined) return fixed
  if (anchor.kind === "slice") return `slice ${anchor.id}`
  if (anchor.kind === "diff") return anchor.id.split("/").pop() ?? anchor.id
  return anchor.id
}

/** The words under a comment: sent, picked up after the task the build had reported, answered. */
export function standing(c: BuildComment): string {
  const state = stateOf(c)
  const after = c.pickedAfter !== undefined ? ` after ${c.pickedAfter}` : ""
  if (state === "sent") return "Sent · the build reads it after its next task"
  return state === "answered"
    ? `Picked up by the build${after} · answered`
    : `Picked up by the build${after}`
}

function commentWho(state: ReturnType<typeof stateOf>): "todo" | "done" | "agent" {
  if (state === "sent") return "todo"
  return state === "answered" ? "done" : "agent"
}

function ThreadComposer({
  anchorKey,
  label,
  textRef,
  error,
  onSend,
  onCancel,
}: {
  anchorKey: string
  label: string
  textRef: React.RefObject<HTMLTextAreaElement | null>
  error: string | null
  onSend: () => void
  onCancel: () => void
}) {
  return (
    <div className="q-says-compose">
      <label className="sr-only" htmlFor={`fb-${anchorKey}`}>
        Give feedback on {label}
      </label>
      <textarea
        id={`fb-${anchorKey}`}
        ref={textRef}
        rows={3}
        className="q-hint"
        placeholder="What should change? The build reads it after its current task."
      />
      {error !== null ? (
        <p role="alert" className="q-dim m-0 text-[13px]">
          {error}
        </p>
      ) : null}
      <div className="row">
        <button type="button" className="q-btn sm" onClick={onSend}>
          Send to the build
        </button>
        <button type="button" className="q-btn quiet sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function ThreadComment({ comment, initials }: { comment: BuildComment; initials: string }) {
  const state = stateOf(comment)
  const elapsed = ago(comment.created)
  return (
    <div className="q-says" id={`bv-cm-${comment.id}`} data-testid="build-comment">
      <div className="who">
        <span className="q-av">{initials}</span>
        You, on {placeOf(comment.build)} · {elapsed}
        {elapsed === "just now" ? "" : " ago"}
      </div>
      <p>{comment.remark}</p>
      <div className="who gap" data-testid="build-comment-state" data-state={state}>
        <WhoMark who={commentWho(state)} />
        {standing(comment)}
      </div>
      {comment.answer !== undefined ? <p>{comment.answer}</p> : null}
    </div>
  )
}

/** Under an item: the composer when it is open, then each comment with where it stands. */
export function Thread({
  anchor,
  label,
  className = "",
}: {
  anchor: BuildAnchor
  label: string
  className?: string
}) {
  const feedback = useContext(FeedbackContext)
  const text = useRef<HTMLTextAreaElement>(null)
  const [error, setError] = useState<string | null>(null)
  const key = keyOf(anchor)
  const composing = feedback !== null && feedback.composing === key
  useEffect(() => {
    if (composing) text.current?.focus()
  }, [composing])
  if (feedback === null) return null
  const notes = feedback.comments.filter((c) => matches(c, anchor))
  if (!composing && notes.length === 0) return null
  const send = async () => {
    const remark = text.current?.value.trim() ?? ""
    if (remark === "") {
      setError("Write what should change first")
      return
    }
    setError(null)
    try {
      await feedback.send(anchor, remark)
      feedback.compose(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const initials = initialsOf(feedback.me)
  return (
    <div className={`grid gap-0 ${className}`} data-testid="thread">
      {composing ? (
        <ThreadComposer
          anchorKey={key}
          label={label}
          textRef={text}
          error={error}
          onSend={() => void send()}
          onCancel={() => feedback.compose(null)}
        />
      ) : null}
      {notes.map((c) => (
        <ThreadComment key={c.id} comment={c} initials={initials} />
      ))}
    </div>
  )
}
