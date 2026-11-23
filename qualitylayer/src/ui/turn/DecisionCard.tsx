// The Plan's decisions, one at a time: the same card every question uses (layout "A" of the question
// redesign). Your turn and where this decision sits ("Plan · decision 2 of 3, then Approve the Plan"),
// the title, the reason, what it is, the media, then one column of rows: Agree (the recommendation) and
// Change…, or a Your call's two options. A words row moves focus to the own-answer field; the field's
// Enter sends it. No frame.

import { ListChecksIcon } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { FLOW_STEPS } from "../../core/flow.ts"
import { answerLabel, type Item, type ItemAnswer } from "../../core/items.ts"
import type { QuestionChoice } from "../../core/task/question.ts"
import type { TaskSurfaceProps } from "../interaction/props.ts"
import { agentInfo } from "../model.ts"
import { InlineMarkdown } from "../reader/DocReader.tsx"
import { ChoiceList } from "./ChoiceList.tsx"
import {
  DecisionFoot,
  DecisionHeader,
  DecisionMedia,
  deliverDecisionAnswer,
  handleDecisionKeyDown,
} from "./DecisionCardParts.tsx"
import { useQuestionDraft, writeDraft } from "./drafts.ts"
import { goneOf } from "./MoreRequest.tsx"
import { QuestionComposer } from "./QuestionComposer.tsx"
import "./question-batch.css"
import "./question-focus.css"

const CALL_LETTERS = ["A", "B"] as const
/** The answers that ask for words: the row moves focus to the field. */
const WORDS = ["change", "fix", "reply", "add-review"]
/** The answers that go with what the Plan says: the recommendation. */
const GO_AHEAD = ["agree", "keep", "confirm"]

function buildDecisionMeta(item: Item, index: number, total: number) {
  const call = item.call
  const many = total > 1
  const kindWord = item.kind === "mockup" ? "artifact" : "decision"
  const stepLabel = FLOW_STEPS.find((step) => step.id === item.step)?.label ?? "Plan"
  const place = many
    ? `${kindWord} ${index + 1} of ${total}`
    : call !== undefined
      ? "your call"
      : kindWord
  const context = `${stepLabel} · ${place}${item.step === "plan" ? ", then Approve the Plan" : ""}`
  const kinds = item.answers.options
  const choices: QuestionChoice[] =
    call !== undefined
      ? call.options.map((label) => ({ label }))
      : kinds.map((kind) => ({
          label: answerLabel(kind, item.family, item.answers.labels),
          ...(WORDS.includes(kind) ? { words: true as const } : {}),
        }))
  const recommended =
    call !== undefined
      ? [call.recommended]
      : kinds[0] !== undefined && GO_AHEAD.includes(kinds[0])
        ? [0]
        : []
  return { call, many, stepLabel, context, kinds, choices, recommended }
}

function composerCopy(editing: ItemAnswer["kind"] | null) {
  if (editing === "reply") return { label: "Reply to this feedback", sendLabel: "Send reply" }
  if (editing) return { label: "What should change?", sendLabel: "Send change" }
  return { label: "Your own answer", sendLabel: "Send" }
}

function DecisionIntro({
  item,
  stepLabel,
  who,
  stopped,
}: {
  item: Item
  stepLabel: string
  who: string
  stopped: boolean
}) {
  return (
    <>
      <h2>
        <InlineMarkdown text={item.what} />
      </h2>
      {item.changedFrom ? (
        <p className="qbc-why">
          Previously: <InlineMarkdown text={item.changedFrom} />
        </p>
      ) : null}
      {item.why ? (
        <p className="qbc-why">
          <InlineMarkdown text={item.why} />
        </p>
      ) : null}
      <div className="qbc-meta">
        <span className="qbc-settles">
          <ListChecksIcon aria-hidden="true" />
          <span>{item.step === "plan" ? "In the Plan" : `In ${stepLabel}`}</span>
          <span>{item.kindLabel}</span>
        </span>
        <span className={stopped ? "qbc-live off" : "qbc-live"}>
          <i aria-hidden="true" />
          {stopped ? `${who} stopped waiting` : `${who} waits`}
        </span>
      </div>
    </>
  )
}

function useDecisionSubmission({
  draftKey,
  item,
  note,
  files,
  busy,
  onAnswer,
}: {
  draftKey: string
  item: Item
  note: string
  files: File[]
  busy: boolean
  onAnswer: (item: Item, answer: ItemAnswer, files?: File[]) => boolean | Promise<boolean>
}) {
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const locked = busy || sending
  const deliver = async (kind: ItemAnswer["kind"], words = note.trim()) => {
    if (locked) return
    setSending(true)
    setProblem(null)
    const err = await deliverDecisionAnswer({ draftKey, item, kind, words, files, onAnswer })
    if (err !== null) setProblem(err)
    setSending(false)
  }
  return { locked, problem, deliver }
}

function pickCallOption(
  call: Item["call"],
  pickIndex: number,
  note: string,
  deliver: (kind: ItemAnswer["kind"], words?: string) => Promise<void>,
) {
  if (call === undefined || call.options[pickIndex] === undefined) return
  const suffix = note.trim() ? ` · ${note.trim()}` : ""
  void deliver(
    pickIndex === call.recommended ? "agree" : "change",
    CALL_LETTERS[pickIndex] + suffix,
  )
}

export function DecisionCard({
  item,
  index,
  total,
  busy = false,
  onAnswer,
  onPrevious,
  onNext,
  surface,
  foot,
}: {
  item: Item
  index: number
  total: number
  busy?: boolean
  onAnswer: (item: Item, answer: ItemAnswer, files?: File[]) => boolean | Promise<boolean>
  onPrevious: () => void
  onNext: () => void
  surface: TaskSurfaceProps
  /** What stands in the helpers row, on the card's own measure (the way into the whole document). */
  foot?: ReactNode
}) {
  const key = `item:${surface.task.id}:${item.id}`
  const draft = useQuestionDraft(key)
  const editing = draft.answerKind ?? null
  const note = draft.words
  const files = draft.files
  const field = useRef<HTMLTextAreaElement>(null)
  const setEditing = (answerKind: ItemAnswer["kind"] | null) =>
    writeDraft(key, { answerKind, writing: true })
  const ownKind = editing ?? (item.answers.options.includes("change") ? "change" : "reply")
  const { locked, problem, deliver } = useDecisionSubmission({
    draftKey: key,
    item,
    note,
    files,
    busy,
    onAnswer,
  })

  useEffect(() => {
    if (editing) field.current?.focus()
  }, [editing])

  const choose = (kind: ItemAnswer["kind"]) => {
    if (WORDS.includes(kind)) setEditing(kind)
    else void deliver(kind)
  }

  const meta = buildDecisionMeta(item, index, total)
  const pick = (pickIndex: number) => pickCallOption(meta.call, pickIndex, note, deliver)
  const who = agentInfo(surface.task.session?.agent).name
  const stopped = goneOf(surface.task.live?.signals ?? null, Date.now()) !== null
  const composer = composerCopy(editing)
  const hasCall = meta.call !== undefined
  const editingProps = editing ? { placeholder: "", onCancel: () => setEditing(null) } : {}

  return (
    <section
      className="qbc fq-decision"
      aria-label="Your turn"
      tabIndex={-1}
      data-testid="decision-card"
      data-item-id={item.id}
      onKeyDown={(event) =>
        handleDecisionKeyDown({
          event,
          locked,
          hasCall,
          options: item.answers.options,
          onPrevious,
          onNext,
          onPick: pick,
          onChoose: choose,
        })
      }
    >
      <DecisionHeader
        context={meta.context}
        many={meta.many}
        index={index}
        total={total}
        locked={locked}
        onPrevious={onPrevious}
        onNext={onNext}
      />
      <div className="qbc-question">
        <DecisionIntro item={item} stepLabel={meta.stepLabel} who={who} stopped={stopped} />
        <DecisionMedia item={item} surface={surface} />
        <ChoiceList
          choices={meta.choices}
          recommended={meta.recommended}
          grade={1}
          theme={surface.theme}
          idPrefix={`decision-${item.id}`}
          onChoose={(n) => (hasCall ? pick(n) : choose(meta.kinds[n] ?? "agree"))}
          disabled={locked}
          markdown={hasCall}
          label={hasCall ? "Your call" : "Choices"}
          testId={hasCall ? "focus-choice" : "decision-choice"}
        />
        <QuestionComposer
          id={`decision-note-${item.id}`}
          label={composer.label}
          showLabel={editing !== null}
          words={note}
          files={files}
          field={field}
          onWords={(words) => writeDraft(key, { words, writing: true })}
          onFiles={(nextFiles) => writeDraft(key, { files: nextFiles, writing: true })}
          busy={locked}
          error={problem}
          submit={() => void deliver(ownKind)}
          sendLabel={composer.sendLabel}
          {...editingProps}
        />
        <DecisionFoot foot={foot} hasCall={hasCall} />
      </div>
    </section>
  )
}
