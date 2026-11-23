import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { AnswerKind, Item, ItemAnswer } from "../../core/items.ts"
import { ItemMedia } from "../ItemMedia.tsx"
import type { TaskSurfaceProps } from "../interaction/props.ts"
import { Disclosure } from "../kit/Fold.tsx"
import { pendingGate, personVerify } from "../model.ts"
import { approvesOutside } from "../outside.ts"
import { InlineMarkdown } from "../reader/DocReader.tsx"
import { clearDraft, draftFor, useQuestionDraft, writeDraft } from "../turn/drafts.ts"
import { ItemNote, StepItemButtons } from "./StepItemParts.tsx"
import { submitStepItemAnswer } from "./step-item-submit.ts"

/** The judge's own words behind a finding's headline, folded until asked for. */
export function FindingDetails({ text }: { text: string }) {
  return (
    <Disclosure className="ir-step-details" head="Details · the judge's words">
      {text.split(/\n{2,}/).map((part) => (
        <p key={part}>
          <InlineMarkdown text={part} />
        </p>
      ))}
    </Disclosure>
  )
}

/**
 * What the judges noted and nothing waits on: one line each under the decisions, its mark beside it
 * and the judge's words behind it. The fold says how many and that none needs an answer.
 */
export function FoundWhileChecking({ items }: { items: Item[] }) {
  if (items.length === 0) return null
  return (
    <Disclosure
      className="ir-step-notes"
      data-testid="found-while-checking"
      head={
        <>
          <b>Found while checking</b>
          <span>
            {items.length} {items.length === 1 ? "note" : "notes"} · none needs an answer
          </span>
        </>
      }
    >
      <ul>
        {items.map((item) => (
          <li key={item.id} data-item-id={item.id}>
            <Disclosure
              head={
                <>
                  <span className="ir-step-note-what">
                    <InlineMarkdown text={item.what} />
                  </span>
                  {item.tag !== undefined ? <span className="ir-step-tag">{item.tag}</span> : null}
                </>
              }
            >
              {(item.details ?? item.why ?? "").split(/\n{2,}/).map((part) => (
                <p key={part}>
                  <InlineMarkdown text={part} />
                </p>
              ))}
            </Disclosure>
          </li>
        ))}
      </ul>
    </Disclosure>
  )
}

function initialChosen(
  draftKind: AnswerKind | null | undefined,
  initialAnswer: ItemAnswer | undefined,
): AnswerKind | null {
  if (draftKind !== undefined) return draftKind
  return initialAnswer?.note ? initialAnswer.kind : null
}

function StepItemHeader({ item, props }: { item: Item; props: TaskSurfaceProps }) {
  return (
    <>
      <div className="ir-step-kind">{item.kindLabel}</div>
      <h3>
        <InlineMarkdown text={item.what} />
        {item.tag !== undefined ? <span className="ir-step-tag">{item.tag}</span> : null}
      </h3>
      {item.why !== undefined ? (
        <p>
          <InlineMarkdown text={item.why} />
        </p>
      ) : null}
      {item.details !== undefined && item.details !== "" ? (
        <FindingDetails text={item.details} />
      ) : null}
      {item.media !== undefined ? (
        <ItemMedia
          media={item.media}
          theme={props.theme}
          loadArtifact={props.live.loadArtifact}
          loadEvidence={props.live.loadEvidence}
        />
      ) : null}
    </>
  )
}

function isOutsideItem(item: Item, task: TaskSurfaceProps["task"]): boolean {
  const finalConfirmation =
    item.kind === "confirm" && personVerify(task) && pendingGate(task) === "final"
  return approvesOutside(task) && !finalConfirmation
}

function useStepItemState(
  item: Item,
  props: TaskSurfaceProps,
  initialAnswer: ItemAnswer | undefined,
  onAnswered: ((answer: ItemAnswer) => void) | undefined,
) {
  const key = `item:${props.task.id}:${item.id}`
  const draft = useQuestionDraft(key)
  const chosen = initialChosen(draft.answerKind, initialAnswer)
  const note = draft.writing ? draft.words : (initialAnswer?.note ?? "")
  const files = draft.files
  const setChosen = (next: AnswerKind | null) =>
    writeDraft(key, { answerKind: next, words: note, writing: true })
  const setNote = (words: string) => writeDraft(key, { words, writing: true })
  const setFiles = (next: File[]) => writeDraft(key, { files: next, words: note, writing: true })
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const send = async (kind: AnswerKind) => {
    if (busy) return
    const attempt = draftFor(key)
    setBusy(true)
    setError(null)
    try {
      const answer = await submitStepItemAnswer({ props, item, kind, note, files })
      clearDraft(key, attempt)
      setSent(true)
      onAnswered?.(answer)
      props.reload()
    } catch (cause) {
      setSent(false)
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }
  return { chosen, note, files, sent, error, busy, setChosen, setNote, setFiles, send }
}

export function StepItem({
  item,
  props,
  onAnswered,
  initialAnswer,
  onCancelEdit,
}: {
  item: Item
  props: TaskSurfaceProps
  onAnswered?: (answer: ItemAnswer) => void
  initialAnswer?: ItemAnswer
  onCancelEdit?: () => void
}) {
  // A Plan decision or a confirmation is answered where approvals are.
  const outside = isOutsideItem(item, props.task)
  const { chosen, note, files, sent, error, busy, setChosen, setNote, setFiles, send } =
    useStepItemState(item, props, initialAnswer, onAnswered)
  const noteInput = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (chosen !== null) noteInput.current?.focus()
  }, [chosen])

  if (sent) {
    return (
      <p className="ir-step-receipt" role="status">
        {busy ? "Sending…" : "Saved for the agent."}
      </p>
    )
  }
  const showError = error !== null && (chosen === null || item.kind === "confirm")
  return (
    <div className="ir-step-item" data-item-id={item.id} tabIndex={-1}>
      <StepItemHeader item={item} props={props} />
      <StepItemButtons
        item={item}
        outside={outside}
        busy={busy}
        onOpenNote={setChosen}
        onSend={(kind) => void send(kind)}
      />
      {chosen !== null && !outside ? (
        <ItemNote
          id={`item-note-${item.id}`}
          chosen={chosen}
          confirm={item.kind === "confirm"}
          busy={busy}
          note={note}
          files={files}
          error={error}
          field={noteInput}
          onNote={setNote}
          onFiles={setFiles}
          send={() => void send(chosen)}
          cancel={() => {
            setChosen(null)
            onCancelEdit?.()
          }}
        />
      ) : null}
      {showError ? <p role="alert">{error}</p> : null}
    </div>
  )
}
