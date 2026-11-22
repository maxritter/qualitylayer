import {
  ChevronsRightIcon,
  CircleCheckIcon,
  ListChecksIcon,
  MessageCircleQuestionMarkIcon,
} from "lucide-react"
import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import { FLOW_STEPS } from "../../core/flow.ts"
import type { LiveSignals } from "../../core/live/liveness.ts"
import type { AnsweredQuestion, MoreRequest, Question } from "../../core/task/question.ts"
import type {
  QuestionBatch as Batch,
  BatchAnswer,
  TurnSnapshot,
} from "../../interaction/contracts.ts"
import { recommendedIndices } from "../../interaction/question-recommendations.ts"
import type { ArtifactPreviewProps } from "../artifact/ArtifactPreview.tsx"
import { useNow } from "../hooks.ts"
import { agentInfo } from "../model.ts"
import { InlineMarkdown } from "../reader/DocReader.tsx"
import { Hint } from "../sidebar/Hint.tsx"
import { BatchReceipt } from "./BatchReceipt.tsx"
import { BatchStrip, savedNote } from "./BatchStrip.tsx"
import { ChoiceList, focusChoice } from "./ChoiceList.tsx"
import { DocumentRow } from "./DocumentRow.tsx"
import { clearDraft, draftFor, useQuestionDraft, writeDraft } from "./drafts.ts"
import {
  EarlierWording,
  EXPLAIN_REQUEST,
  goneOf,
  MorePick,
  MoreStatus,
  moreOpen,
  PLAIN_REQUEST,
  reveal,
  UpdatedBar,
  useMoreUpdates,
} from "./MoreRequest.tsx"
import { batchMembers } from "./members.ts"
import { QuestionComposer } from "./QuestionComposer.tsx"
import { QuestionScreen, questionScreens } from "./QuestionScreen.tsx"
import "./question-batch.css"

const sendError = (cause?: unknown): string =>
  cause instanceof Error ? cause.message : "Could not send. Your words are kept; try again."

export function QuestionBatch({
  turn,
  send,
  theme,
  taskId = "local",
  artifactTask,
  onOpenDoc,
  onOpenAt,
  onChangeAnswer,
  onReadDocument,
  documentName,
  planDoc,
  live,
  resume,
  onCancelMore,
  terminalPreferred = false,
}: {
  turn: TurnSnapshot
  send: (answer: BatchAnswer, files?: File[]) => boolean | Promise<boolean>
  theme: string
  taskId?: string
  artifactTask?: ArtifactPreviewProps["task"]
  onOpenDoc?: (file: string) => void
  /** Open a document at a heading: the Settles link opens the Done means point. */
  onOpenAt?: (doc: string, heading?: string) => void
  /** Change on an answered member of the strip: reopens it. */
  onChangeAnswer?: (batch: string, answer: AnsweredQuestion) => unknown
  /** The page shows only this card while it waits: open the step's document in the Reader. */
  onReadDocument?: () => void
  /** The step document's file name, drawn in the one row that stands for it while the batch waits. */
  documentName?: string
  /** The Plan file: where "Done means N" leads when the question names no document of its own. */
  planDoc?: string
  /** The agent's live signals: a request waits, not for seconds, when its session has stopped. */
  live?: LiveSignals | null
  /** The command that continues the task, shown beside a stopped agent's waiting request. */
  resume?: string
  /** Cancel on a Tell me more request of a member of this batch. */
  onCancelMore?: (batch: string, id: string) => unknown
  terminalPreferred?: boolean
}) {
  const batch = turn.batch as Batch
  const [selected, select] = useState<string | null>(null)
  const card = useRef<HTMLElement | null>(null)
  const field = useRef<HTMLTextAreaElement | null>(null)
  const title = useRef<HTMLHeadingElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  // Tell me more: the question whose small choice is open; a request sent and not yet in the turn;
  // the toggles of a multi-select question.
  const [choosing, setChoosing] = useState<string | null>(null)
  const [asked, setAsked] = useState<Record<string, MoreRequest>>({})
  const [picks, setPicks] = useState<Record<string, number[]>>({})
  const [cancelling, setCancelling] = useState<ReadonlySet<string>>(new Set())
  const forgetAsked = (id: string) =>
    setAsked((was) => {
      const { [id]: _gone, ...rest } = was
      return rest
    })
  // The server has the request (or its answer): the one drawn here at once is no longer needed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run when the turn changes
  useEffect(() => {
    setAsked((was) => {
      const next = { ...was }
      for (const [id, one] of Object.entries(was)) {
        const q = turn.questions.find((it) => it.id === id)
        if (q === undefined || q.more !== undefined || (q.found && q.found.at >= one.at))
          delete next[id]
      }
      return Object.keys(next).length === Object.keys(was).length ? was : next
    })
  })
  const { updates, dismiss } = useMoreUpdates(turn.questions)
  const waiting = turn.questions.some((q) => moreOpen(q.more ?? asked[q.id]))
  const now = useNow(waiting)
  const shortcut = useRef<((event: globalThis.KeyboardEvent) => void) | null>(null)
  shortcut.current = null
  const pending = useRef(new Set<string>())
  const [busy, setBusy] = useState<string | null>(null)
  const [allBusy, setAllBusy] = useState(false)
  const sendingAll = useRef(false)
  useEffect(() => {
    const enter = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || card.current?.contains(event.target as Node)) return
      const active = document.activeElement as HTMLElement | null
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      if (
        active?.isContentEditable ||
        active?.closest(
          'input, textarea, select, a, summary, [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="menuitem"]',
        )
      )
        return
      const navigation = active?.matches('[role="tab"], .q-tab, #rs-tab-files, #rs-tab-comments')
      if (active?.closest('button, [role="button"]') && !navigation) return
      if (
        event.key === "ArrowDown" &&
        document.activeElement === document.body &&
        !event.defaultPrevented
      ) {
        event.preventDefault()
        if (!focusChoice(card.current)) title.current?.focus()
      } else if (/^[1-9mra]$/i.test(event.key)) {
        shortcut.current?.(event)
      }
    }
    window.addEventListener("keydown", enter)
    return () => window.removeEventListener("keydown", enter)
  }, [])
  const question = turn.questions.find((q) => q.id === selected) ?? turn.questions[0]
  const draftKey = `${taskId}:${batch.id}:${question?.id ?? ""}`
  const draft = useQuestionDraft(draftKey)
  const [confirmation, setConfirmation] = useState<{ question: Question; index: number } | null>(
    null,
  )
  const { words, writing } = draft
  // biome-ignore lint/correctness/useExhaustiveDependencies: a restored draft belongs to this question's own field
  useEffect(() => {
    if (writing) field.current?.focus()
  }, [draftKey, writing])
  const setWords = (words: string) => writeDraft(draftKey, { words, error: null })
  const setWriting = (writing: boolean) => writeDraft(draftKey, { writing, error: null })
  const agent = agentInfo(batch.agent ?? undefined).name
  // The agent answered a request on this question: its top in view, the heading read out.
  const update = question ? updates[question.id] : undefined
  const updateAt = update?.at
  // biome-ignore lint/correctness/useExhaustiveDependencies: the update is the trigger
  useEffect(() => {
    if (updateAt === undefined) return
    title.current?.focus({ preventScroll: true })
    reveal(card.current?.querySelector(".qbc-question"))
  }, [updateAt, question?.id])
  // The strip: every member in the batch's order, the answered ones with what was picked.
  const members = batchMembers(turn)
  const placeOf = (id: string) => members.find((m) => m.id === id)?.number ?? 0
  // Change reopens the member, a several-answer one too: its card offers every choice again.
  const changeMember = (id: string) => {
    const given = turn.answered.findLast((a) => a.id === id)
    if (given === undefined || onChangeAnswer === undefined) return
    select(id)
    void onChangeAnswer(batch.id, given)
  }
  // The last answer was given: the batch is done, and the step's page takes over at once.
  if (!question) return null
  const more = question.more ?? asked[question.id]
  const requestOpen = moreOpen(more)
  const presented = turn.nativeQuestions?.[question.id]
  const gone = goneOf(live, now)
  const isMulti = question.multi === true && question.gate === undefined
  const picked = picks[question.id] ?? []
  const confirmedIndex =
    confirmation?.question.id === question.id &&
    confirmation.question.asked === question.asked &&
    confirmation.question.question === question.question &&
    confirmation.question.found?.at === question.found?.at
      ? confirmation.index
      : undefined
  const confirm =
    confirmedIndex === undefined ? undefined : question.choices[confirmedIndex]?.confirm
  const toggle = (index: number) =>
    setPicks((was) => {
      const have = was[question.id] ?? []
      const next = have.includes(index) ? have.filter((i) => i !== index) : [...have, index]
      return { ...was, [question.id]: next.sort((a, b) => a - b) }
    })
  const rest = turn.questions.filter((q) => q.id !== question.id)
  const lastAnswer = turn.answered
    .filter((a) => batch.links.some((l) => l.questionId === a.id))
    .at(-1)
  const points = (q: Question) => turn.links.find((l) => l.questionId === q.id)?.points ?? []
  const pointWords = (q: Question) =>
    points(q).length ? `Done means ${points(q).join(", ")}` : "your request"
  const answer = (
    value: Omit<BatchAnswer, "id" | "batch" | "revision">,
    after?: { failed?: () => void },
  ) => {
    if (sendingAll.current || pending.current.has(question.id)) return
    pending.current.add(question.id)
    setBusy(question.id)
    const submitted = draftFor(draftKey)
    const finish = (saved: boolean, cause?: unknown) => {
      pending.current.delete(question.id)
      setBusy(null)
      if (saved && "choices" in value)
        setPicks((was) => {
          const { [question.id]: _sent, ...rest } = was
          return rest
        })
      if (!saved) after?.failed?.()
      saved
        ? !("more" in value) && clearDraft(draftKey, submitted)
        : writeDraft(draftKey, { error: sendError(cause) })
    }
    try {
      const payload = {
        ...value,
        id: question.id,
        batch: batch.id,
        ...(question.revision ? { revision: question.revision } : {}),
      } as BatchAnswer
      const files = "more" in value ? [] : submitted.files
      const result = files.length ? send(payload, files) : send(payload)
      if (typeof result === "boolean") finish(result)
      else
        void result.then(
          (saved) => finish(saved),
          (cause) => finish(false, cause),
        )
    } catch (cause) {
      finish(false, cause)
    }
  }
  const choose = (index: number) => {
    if (question.choices[index]?.words) {
      setWriting(true)
      return
    }
    if (question.choices[index]?.confirm) {
      setConfirmation({ question, index })
      return
    }
    setConfirmation(null)
    answer({ choice: index })
  }
  // Tell me more: the request is drawn at once as sent; a refusal takes it back.
  const askMore = (request: string) => {
    const id = question.id
    setAsked((was) => ({ ...was, [id]: { request, at: Date.now() } }))
    setChoosing(null)
    answer({ more: { request } }, { failed: () => forgetAsked(id) })
  }
  const closeMore = () => {
    setChoosing(null)
    trigger.current?.focus({ preventScroll: true })
  }
  // Cancel is pending until the server has saved it: the panel stays (and says so), and a refusal
  // leaves it as it was.
  const cancelMore = () => {
    const id = question.id
    if (cancelling.has(id)) return
    setCancelling((was) => new Set(was).add(id))
    void Promise.resolve(onCancelMore?.(batch.id, id))
      .catch(() => false)
      .then((saved) => {
        if (saved !== false) forgetAsked(id)
        setCancelling((was) => {
          const next = new Set(was)
          next.delete(id)
          return next
        })
      })
  }
  const sendPicks = () => {
    if (picked.length > 0) answer({ choices: picked })
  }
  // Every open question takes its recommendation, one after the other; a review question has none to take.
  const everyRecommendation = turn.questions.filter(
    (q) => !q.gate && !q.choices.some((c) => c.confirm),
  )
  const takeAllRecommendations = async () => {
    if (sendingAll.current || pending.current.size || everyRecommendation.length < 2) return
    sendingAll.current = true
    setAllBusy(true)
    try {
      for (const q of everyRecommendation) {
        const value =
          q.multi && q.recommendedChoices
            ? { choices: recommendedIndices(q) }
            : q.choices[q.recommended]?.words
              ? { unsure: true }
              : { choice: q.recommended }
        const key = `${taskId}:${batch.id}:${q.id}`
        const submitted = draftFor(key)
        const payload = {
          ...value,
          id: q.id,
          batch: batch.id,
          ...(q.revision ? { revision: q.revision } : {}),
        } as BatchAnswer
        const failed = (cause?: unknown) => {
          writeDraft(key, { error: sendError(cause) })
          select(q.id)
        }
        try {
          const saved = await (submitted.files.length
            ? send(payload, submitted.files)
            : send(payload))
          if (!saved) {
            failed()
            break
          }
          clearDraft(key, submitted)
        } catch (cause) {
          failed(cause)
          break
        }
      }
    } finally {
      sendingAll.current = false
      setAllBusy(false)
    }
  }
  const next = (direction: number) => {
    const at = turn.questions.findIndex((q) => q.id === question.id)
    select(
      turn.questions[Math.max(0, Math.min(turn.questions.length - 1, at + direction))]?.id ?? null,
    )
    title.current?.focus({ preventScroll: true })
  }
  const key = (event: KeyboardEvent<HTMLElement> | globalThis.KeyboardEvent) => {
    if (event.defaultPrevented || sendingAll.current || pending.current.size) return
    const target = event.target as HTMLElement
    if (event.key === "Tab" && target === card.current && !event.shiftKey) {
      event.preventDefault()
      setWriting(true)
      return
    }
    // A toggle of a multi-select question keeps the card's keys; any other field keeps its own.
    const toggleBox = target.tagName === "INPUT" && (target as HTMLInputElement).type === "checkbox"
    if (
      (!toggleBox && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) ||
      ["A", "SUMMARY"].includes(target.tagName) ||
      target.isContentEditable ||
      target.closest('[contenteditable]:not([contenteditable="false"])') ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey
    )
      return
    if (
      event.repeat ||
      ("nativeEvent" in event ? event.nativeEvent.isComposing : event.isComposing)
    )
      return
    // The small choice is open: 1 and 2 pick inside it, Esc closes it, nothing else answers.
    if (choosing === question.id) {
      if (event.key === "Escape") {
        event.preventDefault()
        closeMore()
      } else if (event.key === "1" || event.key === "2") {
        event.preventDefault()
        askMore(event.key === "1" ? PLAIN_REQUEST : EXPLAIN_REQUEST)
      }
      return
    }
    if (/^[1-9]$/.test(event.key) && question.choices[Number(event.key) - 1]) {
      event.preventDefault()
      const index = Number(event.key) - 1
      isMulti && !question.choices[index]?.words ? toggle(index) : choose(index)
    }
    if (event.key === "Enter" && target.tagName !== "BUTTON") {
      event.preventDefault()
      isMulti ? sendPicks() : choose(question.recommended)
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      next(event.key === "ArrowDown" ? 1 : -1)
    }
    if (event.key.toLowerCase() === "a" && !toggleBox && everyRecommendation.length > 1) {
      event.preventDefault()
      void takeAllRecommendations()
    }
    if (event.key.toLowerCase() === "m" && !requestOpen) {
      event.preventDefault()
      setChoosing(question.id)
    }
    if (event.key.toLowerCase() === "r") {
      event.preventDefault()
      if (isMulti && question.recommendedChoices) answer({ choices: recommendedIndices(question) })
      else choose(question.recommended)
    }
  }
  shortcut.current = key
  const stepLabel = FLOW_STEPS.find((step) => step.id === batch.step)?.label ?? "Plan"
  // What the answer settles: the document the agent named, else the Done means points in the Plan.
  const aboutDoc = question.about?.doc ?? planDoc
  const aboutSection =
    question.about?.section ?? (question.about?.doc === undefined ? "Done means" : undefined)
  const openSettles =
    aboutDoc !== undefined && (onOpenAt !== undefined || onOpenDoc !== undefined)
      ? () => {
          if (onOpenAt) onOpenAt(aboutDoc, aboutSection)
          else onOpenDoc?.(aboutDoc)
        }
      : undefined
  const left = turn.questions.length
  const liveWords = requestOpen
    ? `${agent} is looking into it`
    : gone !== null
      ? `${agent} stopped waiting`
      : `${agent} waits`
  const choiceList = (
    <ChoiceList
      key={question.id}
      choices={question.choices}
      recommended={recommendedIndices(question)}
      grade={(question.grade ?? 1) as 1 | 2 | 3}
      theme={theme}
      idPrefix={`batch-${question.id}`}
      onChoose={choose}
      chosen={confirmedIndex}
      multi={isMulti ? { on: picked, toggle } : undefined}
      disabled={busy === question.id || allBusy}
      screen={(reference) => (
        <QuestionScreen reference={reference} task={artifactTask} onOpen={onOpenDoc} />
      )}
      testId="batch-choice"
      listTestId="batch-choices"
    />
  )
  return (
    <>
      <section
        className="qbc"
        aria-label="Your turn"
        data-testid="question-batch"
        data-item-id={`question:${question.id}`}
        ref={card}
        tabIndex={-1}
        onKeyDown={key}
      >
        {rest.map((q) => (
          <button
            type="button"
            aria-label={`Jump to question ${q.number}`}
            key={q.id}
            className="sr-only"
            tabIndex={-1}
            data-item-id={`question:${q.id}`}
            onFocus={() => {
              select(q.id)
              title.current?.focus({ preventScroll: true })
            }}
          />
        ))}
        {lastAnswer ? (
          <BatchReceipt
            answer={lastAnswer}
            number={placeOf(lastAnswer.id ?? "")}
            turn={turn}
            taskId={taskId}
            onChange={
              lastAnswer.id !== undefined && onChangeAnswer !== undefined
                ? () => changeMember(lastAnswer.id as string)
                : undefined
            }
          />
        ) : null}
        <header className="qbc-top">
          <span className="qbc-yt">
            <i aria-hidden="true" />
            Your turn
          </span>
          {typeof presented === "string" ? (
            <span className="qbc-native-presentation">Shown in {agentInfo(presented).name}</span>
          ) : null}
          <BatchStrip
            title={batch.title}
            members={members}
            currentId={question.id}
            onFocus={(id) => {
              select(id)
              title.current?.focus({ preventScroll: true })
            }}
            onChange={onChangeAnswer ? changeMember : undefined}
          />
        </header>
        <div className="qbc-question" data-testid="batch-question" data-question-id={question.id}>
          {requestOpen && more ? (
            <MoreStatus
              more={more}
              agent={agent}
              now={now}
              gone={gone}
              resume={resume}
              onCancel={cancelMore}
              cancelling={cancelling.has(question.id)}
              testId="batch-more-status"
            />
          ) : update ? (
            <UpdatedBar
              update={update}
              onDismiss={() => dismiss(question.id)}
              testId="batch-more-status"
            />
          ) : null}
          <h3 ref={title} tabIndex={-1}>
            {update?.reworded ? (
              <span className="ir-changed">{question.question}</span>
            ) : (
              question.question
            )}
          </h3>
          {question.earlier?.length ? <EarlierWording earlier={question.earlier} /> : null}
          {question.why ? (
            <p className="qbc-why">
              <InlineMarkdown text={question.why} />
            </p>
          ) : null}
          <div className="qbc-meta">
            <span className="qbc-settles" data-testid="batch-settles">
              <ListChecksIcon aria-hidden="true" />
              <span>Settles</span>
              {openSettles ? (
                <button type="button" className="q-link" onClick={openSettles}>
                  {pointWords(question)}
                </button>
              ) : (
                <span>{pointWords(question)}</span>
              )}
            </span>
            {terminalPreferred && !requestOpen && gone === null ? null : (
              <span className={requestOpen ? "qbc-live busy" : "qbc-live"} data-testid="batch-live">
                <i aria-hidden="true" />
                {liveWords}
              </span>
            )}
          </div>
          {questionScreens(question).map((reference) => (
            <QuestionScreen
              key={reference}
              reference={reference}
              task={artifactTask}
              onOpen={onOpenDoc}
            />
          ))}
          {question.found ? (
            <div className={update ? "qbc-found ir-fresh" : "qbc-found"}>
              <b>What the agent found</b>
              <InlineMarkdown text={question.found.text} />
            </div>
          ) : null}
          {choiceList}
          {confirm && confirmedIndex !== undefined ? (
            <div className="qbc-multi">
              <button
                type="button"
                className="q-btn primary sm"
                disabled={busy === question.id}
                onClick={() => answer({ choice: confirmedIndex })}
              >
                {confirm}
              </button>
            </div>
          ) : null}
          {isMulti ? (
            <div className="qbc-multi">
              <span data-testid="batch-multi-count">
                Pick one or more
                {picked.length > 0 ? ` · ${picked.length} of ${question.choices.length} on` : ""}
              </span>
              <button
                type="button"
                className="q-btn primary sm"
                data-testid="batch-multi-send"
                disabled={picked.length === 0 || busy === question.id}
                onClick={sendPicks}
              >
                {picked.length === 0
                  ? "Pick at least one"
                  : `Send ${picked.length} ${picked.length === 1 ? "choice" : "choices"}`}
              </button>
            </div>
          ) : null}
          <QuestionComposer
            id={`batch-words-${question.id}`}
            words={words}
            files={draft.files}
            field={field}
            onWords={setWords}
            onFiles={(files) => writeDraft(draftKey, { files, error: null })}
            error={draft.error}
            busy={busy === question.id}
            sendLabel={draft.error ? "Send again" : "Send"}
            submit={() => answer({ text: words.trim() || "See attached files." })}
          />
          <div className="qbc-help">
            <button
              type="button"
              className="q-btn sm"
              ref={trigger}
              aria-keyshortcuts="M"
              disabled={allBusy || busy !== null || requestOpen}
              aria-expanded={choosing === question.id}
              onClick={() => (choosing === question.id ? closeMore() : setChoosing(question.id))}
            >
              <MessageCircleQuestionMarkIcon aria-hidden="true" />
              Tell me more
            </button>
            {everyRecommendation.length > 1 ? (
              <button
                type="button"
                className="q-btn sm"
                data-testid="batch-use-all"
                disabled={allBusy || busy !== null}
                aria-keyshortcuts="A"
                title="Each open question takes its recommendation"
                onClick={() => void takeAllRecommendations()}
              >
                <ChevronsRightIcon aria-hidden="true" />
                Use all recommended
              </button>
            ) : null}
            <Hint label={savedNote(batch.ahead)} side="top">
              <button
                type="button"
                className="qbc-saved"
                data-testid="batch-saved"
                aria-label={`Saved. ${savedNote(batch.ahead)}`}
              >
                <CircleCheckIcon aria-hidden="true" />
                Saved
              </button>
            </Hint>
          </div>
          {choosing === question.id ? (
            <MorePick onSend={askMore} onCancel={closeMore} busy={busy === question.id} />
          ) : null}
        </div>
      </section>
      {onReadDocument ? (
        <DocumentRow
          file={documentName}
          status={`Draft · ${left} ${left === 1 ? "question" : "questions"} open`}
          read={`Read ${stepLabel}`}
          onRead={onReadDocument}
        />
      ) : null}
    </>
  )
}
