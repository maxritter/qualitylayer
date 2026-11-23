import { CircleAlertIcon, PaperclipIcon } from "lucide-react"
import { type RefObject, useRef, useState } from "react"
import { ATTACHMENT_ACCEPT, pickProblem } from "../../core/interaction-docs/attachment-rules.ts"
import { Attachments, usePendingFiles } from "../docs/Attachments.tsx"
import { ReportThis } from "../ReportThis.tsx"
import "./question-composer.css"

function ComposerError({
  problem,
  error,
  testId,
}: {
  problem: string | null
  error?: string | null
  testId?: string
}) {
  if (!problem && !error) return null
  return (
    <p className="ir-draft-error" role="alert" data-testid={testId ? `${testId}-error` : undefined}>
      <CircleAlertIcon aria-hidden="true" />
      <span>{problem || error}</span>
      {/* A refused send is reported from the line the person is looking at, not from a second toast. */}
      {!problem && error ? <ReportThis error={error} className="ml-auto" /> : null}
    </p>
  )
}

function ComposerActions({
  input,
  locked,
  busy,
  ready,
  sendWord,
  testId,
  onPickFiles,
  onCancel,
}: {
  input: RefObject<HTMLInputElement | null>
  locked: boolean
  busy: boolean
  ready: boolean
  sendWord: string
  testId?: string
  onPickFiles: (files: FileList | null) => void
  onCancel?: () => void
}) {
  return (
    <div className="question-composer-actions">
      <input
        ref={input}
        type="file"
        className="sr-only"
        multiple
        accept={ATTACHMENT_ACCEPT}
        tabIndex={-1}
        aria-label="Attach files to your answer"
        disabled={locked}
        onChange={(event) => {
          onPickFiles(event.target.files)
          event.target.value = ""
        }}
      />
      <button
        type="button"
        className="q-btn sm"
        disabled={locked}
        onClick={() => input.current?.click()}
      >
        <PaperclipIcon size={14} aria-hidden="true" /> Attach files
      </button>
      <span className="question-composer-hint">Paste or drop images, PDFs or logs</span>
      <button
        type="submit"
        className={`q-btn sm question-composer-send${ready ? " primary" : ""}`}
        aria-label={sendWord}
        disabled={!ready}
        data-testid={testId ? `${testId}-send` : undefined}
      >
        {busy ? "Sending…" : sendWord} {ready ? <kbd>↵</kbd> : null}
      </button>
      {onCancel ? (
        <button type="button" className="q-link" disabled={locked} onClick={onCancel}>
          Cancel
        </button>
      ) : null}
    </div>
  )
}

function handleComposerKeyDown(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
  ready: boolean,
  submit: () => void,
) {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
  event.preventDefault()
  event.stopPropagation()
  if (!event.repeat && ready) submit()
}

function addPickedFiles(
  locked: boolean,
  files: readonly File[],
  picked: FileList | readonly File[] | null,
  onFiles: (files: File[]) => void,
  setProblem: (problem: string | null) => void,
) {
  if (locked || !picked?.length) return
  const next = [...files, ...Array.from(picked)]
  const why = pickProblem(next)
  setProblem(why?.replace("to a comment", "to an answer") ?? null)
  if (!why) onFiles(next)
}

function ComposerTextarea({
  id,
  field,
  words,
  placeholder,
  locked,
  testId,
  ready,
  onWords,
  onPasteFiles,
  submit,
}: {
  id: string
  field?: RefObject<HTMLTextAreaElement | null>
  words: string
  placeholder: string
  locked: boolean
  testId?: string
  ready: boolean
  onWords: (words: string) => void
  onPasteFiles: (files: FileList) => void
  submit: () => void
}) {
  return (
    <textarea
      id={id}
      ref={field}
      rows={1}
      value={words}
      maxLength={4000}
      placeholder={placeholder}
      disabled={locked}
      data-testid={testId ? `${testId}-own` : undefined}
      onChange={(event) => onWords(event.target.value)}
      onPaste={(event) => {
        if (event.clipboardData.files.length) {
          event.preventDefault()
          onPasteFiles(event.clipboardData.files)
        }
      }}
      onKeyDown={(event) => handleComposerKeyDown(event, ready, submit)}
    />
  )
}

/** The person's words and files stay in the question draft until the server accepts the answer. */
export function QuestionComposer({
  id,
  words,
  files,
  onWords,
  onFiles,
  submit,
  field,
  error,
  busy = false,
  disabled = false,
  placeholder = "Or write your own answer…",
  sendLabel = "Send",
  testId,
  label,
  showLabel = label !== undefined,
  onCancel,
}: {
  id: string
  words: string
  files: readonly File[]
  onWords: (words: string) => void
  onFiles: (files: File[]) => void
  submit: () => void
  field?: RefObject<HTMLTextAreaElement | null>
  error?: string | null
  busy?: boolean
  disabled?: boolean
  placeholder?: string
  sendLabel?: string
  testId?: string
  label?: string
  /** Draw the label above the field; otherwise it is read out only and the placeholder says it. */
  showLabel?: boolean
  onCancel?: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const pending = usePendingFiles(files)
  const locked = busy || disabled
  const add = (picked: FileList | readonly File[] | null) =>
    addPickedFiles(locked, files, picked, onFiles, setProblem)
  const sendWord = error ? "Try again" : sendLabel
  const ready = !locked && (!!words.trim() || files.length > 0)
  const removeHandler = locked
    ? {}
    : {
        onRemove: (index: number) => {
          onFiles(files.filter((_, i) => i !== index))
          setProblem(null)
        },
      }
  return (
    <form
      className="question-composer"
      data-dragging={dragging || undefined}
      aria-label="Write your answer"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) submit()
      }}
      onDragOver={(event) => {
        if (!locked && event.dataTransfer.types.includes("Files")) {
          event.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setDragging(false)
        add(event.dataTransfer.files)
      }}
    >
      <label className={showLabel ? undefined : "sr-only"} htmlFor={id}>
        {label ?? "Your own answer"}
      </label>
      <ComposerTextarea
        id={id}
        field={field}
        words={words}
        placeholder={placeholder}
        locked={locked}
        testId={testId}
        ready={ready}
        onWords={onWords}
        onPasteFiles={add}
        submit={submit}
      />
      <Attachments files={pending} {...removeHandler} />
      <ComposerError problem={problem} error={error} testId={testId} />
      <ComposerActions
        input={input}
        locked={locked}
        busy={busy}
        ready={ready}
        sendWord={sendWord}
        testId={testId}
        onPickFiles={add}
        onCancel={onCancel}
      />
    </form>
  )
}
