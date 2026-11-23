import { type RefObject, useEffect, useRef, useState } from "react"
import { FLOW_STEPS } from "../../core/flow.ts"
import type { LiveSignals } from "../../core/live/liveness.ts"
import type { AnsweredQuestion, Question } from "../../core/task/question.ts"
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
import { BatchReceipt } from "./BatchReceipt.tsx"
import { BatchStrip } from "./BatchStrip.tsx"
import { ChoiceList } from "./ChoiceList.tsx"
import { DocumentRow } from "./DocumentRow.tsx"
import { useQuestionDraft, writeDraft } from "./drafts.ts"
import {
  EarlierWording,
  goneOf,
  MorePick,
  moreOpen,
  reveal,
  useMoreUpdates,
} from "./MoreRequest.tsx"
import { batchMembers } from "./members.ts"
import {
  BatchChoiceActions,
  BatchHelpRow,
  BatchJumpAnchors,
  BatchMoreBanner,
  BatchQuestionMeta,
  BatchQuestionScreens,
} from "./QuestionBatchParts.tsx"
import { QuestionComposer } from "./QuestionComposer.tsx"
import { QuestionScreen } from "./QuestionScreen.tsx"
import { useBatchMoreState } from "./question-batch-actions.ts"
import {
  buildBatchKeyHandler,
  matchingConfirmedIndex,
  useBatchDispatch,
  useBatchPicks,
  useBatchWindowKeys,
} from "./use-question-batch.ts"
import "./question-batch.css"

function settleOpener(
  question: Question,
  planDoc: string | undefined,
  onOpenAt?: (doc: string, heading?: string) => void,
  onOpenDoc?: (file: string) => void,
) {
  const aboutDoc = question.about?.doc ?? planDoc
  if (aboutDoc === undefined || (onOpenAt === undefined && onOpenDoc === undefined)) {
    return undefined
  }
  const aboutSection =
    question.about?.section ?? (question.about?.doc === undefined ? "Done means" : undefined)
  return () => {
    if (onOpenAt) onOpenAt(aboutDoc, aboutSection)
    else onOpenDoc?.(aboutDoc)
  }
}

function liveWordsOf(agent: string, requestOpen: boolean, gone: boolean): string {
  if (requestOpen) return `${agent} is looking into it`
  return gone ? `${agent} stopped waiting` : `${agent} waits`
}

function cancelQuestionMore({
  id,
  batchId,
  moreState,
  onCancelMore,
}: {
  id: string
  batchId: string
  moreState: ReturnType<typeof useBatchMoreState>
  onCancelMore?: (batch: string, id: string) => unknown
}) {
  if (moreState.cancelling.has(id)) return
  moreState.setCancelling((was) => new Set(was).add(id))
  void Promise.resolve(onCancelMore?.(batchId, id))
    .catch(() => false)
    .then((saved) => {
      if (saved !== false) moreState.forgetAsked(id)
      moreState.setCancelling((was) => {
        const next = new Set(was)
        next.delete(id)
        return next
      })
    })
}

function BatchCardHeader({
  batch,
  turn,
  taskId,
  question,
  members,
  presented,
  onFocusQuestion,
  onChangeAnswer,
  onChangeMember,
}: {
  batch: Batch
  turn: TurnSnapshot
  taskId: string
  question: Question
  members: ReturnType<typeof batchMembers>
  presented: unknown
  onFocusQuestion: (id: string) => void
  onChangeAnswer?: (batch: string, answer: AnsweredQuestion) => unknown
  onChangeMember: (id: string) => void
}) {
  const rest = turn.questions.filter((q) => q.id !== question.id)
  const lastAnswer = turn.answered
    .filter((a) => batch.links.some((l) => l.questionId === a.id))
    .at(-1)
  return (
    <>
      <BatchJumpAnchors rest={rest} onSelect={onFocusQuestion} />
      {lastAnswer ? (
        <BatchReceipt
          answer={lastAnswer}
          number={members.find((m) => m.id === (lastAnswer.id ?? ""))?.number ?? 0}
          turn={turn}
          taskId={taskId}
          onChange={
            lastAnswer.id !== undefined && onChangeAnswer !== undefined
              ? () => onChangeMember(lastAnswer.id as string)
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
          onFocus={onFocusQuestion}
          onChange={onChangeAnswer ? onChangeMember : undefined}
        />
      </header>
    </>
  )
}

function QuestionBatchIntro({
  question,
  title,
  update,
  pointWords,
  openSettles,
  showLive,
  requestOpen,
  liveWords,
  artifactTask,
  onOpenDoc,
}: {
  question: Question
  title: RefObject<HTMLHeadingElement | null>
  update: ReturnType<typeof useMoreUpdates>["updates"][string] | undefined
  pointWords: string
  openSettles: (() => void) | undefined
  showLive: boolean
  requestOpen: boolean
  liveWords: string
  artifactTask?: ArtifactPreviewProps["task"]
  onOpenDoc?: (file: string) => void
}) {
  return (
    <>
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
      <BatchQuestionMeta
        pointWords={pointWords}
        openSettles={openSettles}
        showLive={showLive}
        requestOpen={requestOpen}
        liveWords={liveWords}
      />
      <BatchQuestionScreens question={question} artifactTask={artifactTask} onOpenDoc={onOpenDoc} />
      {question.found ? (
        <div className={update ? "qbc-found ir-fresh" : "qbc-found"}>
          <b>What the agent found</b>
          <InlineMarkdown text={question.found.text} />
        </div>
      ) : null}
    </>
  )
}

function QuestionBatchActionsSection({
  question,
  theme,
  artifactTask,
  onOpenDoc,
  confirmedIndex,
  confirm,
  isMulti,
  picked,
  toggle,
  draftKey,
  draft,
  field,
  trigger,
  requestOpen,
  choosingOpen,
  ahead,
  dispatch,
  sendPicks,
  askMore,
  closeMore,
  openMore,
}: {
  question: Question
  theme: string
  artifactTask?: ArtifactPreviewProps["task"]
  onOpenDoc?: (file: string) => void
  confirmedIndex: number | undefined
  confirm: string | undefined
  isMulti: boolean
  picked: number[]
  toggle: (index: number) => void
  draftKey: string
  draft: ReturnType<typeof useQuestionDraft>
  field: RefObject<HTMLTextAreaElement | null>
  trigger: RefObject<HTMLButtonElement | null>
  requestOpen: boolean
  choosingOpen: boolean
  ahead: string | undefined
  dispatch: ReturnType<typeof useBatchDispatch>
  sendPicks: () => void
  askMore: (request: string) => void
  closeMore: () => void
  openMore: () => void
}) {
  const isBusy = dispatch.busy === question.id
  return (
    <>
      <ChoiceList
        key={question.id}
        choices={question.choices}
        recommended={recommendedIndices(question)}
        grade={(question.grade ?? 1) as 1 | 2 | 3}
        theme={theme}
        idPrefix={`batch-${question.id}`}
        onChoose={dispatch.choose}
        chosen={confirmedIndex}
        multi={isMulti ? { on: picked, toggle } : undefined}
        disabled={isBusy || dispatch.allBusy}
        screen={(reference) => (
          <QuestionScreen reference={reference} task={artifactTask} onOpen={onOpenDoc} />
        )}
        testId="batch-choice"
        listTestId="batch-choices"
      />
      <BatchChoiceActions
        confirm={confirm}
        confirmedIndex={confirmedIndex}
        isMulti={isMulti}
        pickedCount={picked.length}
        totalChoices={question.choices.length}
        busy={isBusy}
        onConfirm={(index) => dispatch.answer({ choice: index })}
        onSendPicks={sendPicks}
      />
      <QuestionComposer
        id={`batch-words-${question.id}`}
        words={draft.words}
        files={draft.files}
        field={field}
        onWords={(words) => writeDraft(draftKey, { words, error: null })}
        onFiles={(files) => writeDraft(draftKey, { files, error: null })}
        error={draft.error}
        busy={isBusy}
        sendLabel={draft.error ? "Send again" : "Send"}
        submit={() => dispatch.answer({ text: draft.words.trim() || "See attached files." })}
      />
      <BatchHelpRow
        trigger={trigger}
        disabled={dispatch.allBusy || dispatch.busy !== null}
        requestOpen={requestOpen}
        choosingOpen={choosingOpen}
        hasAllRecommended={dispatch.everyRecommendation.length > 1}
        ahead={ahead}
        onToggleMore={() => (choosingOpen ? closeMore() : openMore())}
        onTakeAll={() => void dispatch.takeAllRecommendations()}
      />
      {choosingOpen ? <MorePick onSend={askMore} onCancel={closeMore} busy={isBusy} /> : null}
    </>
  )
}

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
  onOpenAt?: (doc: string, heading?: string) => void
  onChangeAnswer?: (batch: string, answer: AnsweredQuestion) => unknown
  onReadDocument?: () => void
  documentName?: string
  planDoc?: string
  live?: LiveSignals | null
  resume?: string
  onCancelMore?: (batch: string, id: string) => unknown
  terminalPreferred?: boolean
}) {
  const batch = turn.batch as Batch
  const [selected, select] = useState<string | null>(null)
  const card = useRef<HTMLElement | null>(null)
  const field = useRef<HTMLTextAreaElement | null>(null)
  const title = useRef<HTMLHeadingElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const moreState = useBatchMoreState(turn.questions)
  const { updates, dismiss } = useMoreUpdates(turn.questions)
  const waiting = turn.questions.some((q) => moreOpen(q.more ?? moreState.asked[q.id]))
  const now = useNow(waiting)
  const shortcut = useRef<((event: globalThis.KeyboardEvent) => void) | null>(null)
  shortcut.current = null
  useBatchWindowKeys(card, title, shortcut)

  const question = turn.questions.find((q) => q.id === selected) ?? turn.questions[0]
  const draftKey = `${taskId}:${batch.id}:${question?.id ?? ""}`
  const draft = useQuestionDraft(draftKey)
  const { picked, toggle, clearPick } = useBatchPicks(question?.id)
  const dispatch = useBatchDispatch({
    turn,
    batch,
    taskId,
    question,
    draftKey,
    send,
    select,
    clearPick,
    onChangeAnswer,
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: a restored draft belongs to this question's own field
  useEffect(() => {
    if (draft.writing) field.current?.focus()
  }, [draftKey, draft.writing])

  const update = question ? updates[question.id] : undefined
  const updateAt = update?.at
  // biome-ignore lint/correctness/useExhaustiveDependencies: the update is the trigger
  useEffect(() => {
    if (updateAt === undefined) return
    title.current?.focus({ preventScroll: true })
    reveal(card.current?.querySelector(".qbc-question"))
  }, [updateAt, question?.id])

  if (!question) return null

  const focusQuestion = (id: string) => {
    select(id)
    title.current?.focus({ preventScroll: true })
  }
  const agent = agentInfo(batch.agent ?? undefined).name
  const members = batchMembers(turn)
  const more = question.more ?? moreState.asked[question.id]
  const requestOpen = moreOpen(more)
  const gone = goneOf(live, now)
  const isMulti = question.multi === true && question.gate === undefined
  const confirmedIndex = matchingConfirmedIndex(dispatch.confirmation, question)
  const confirm =
    confirmedIndex === undefined ? undefined : question.choices[confirmedIndex]?.confirm
  const askMore = (request: string) => {
    const id = question.id
    moreState.setAsked((was) => ({ ...was, [id]: { request, at: Date.now() } }))
    moreState.setChoosing(null)
    dispatch.answer({ more: { request } }, { failed: () => moreState.forgetAsked(id) })
  }
  const closeMore = () => {
    moreState.setChoosing(null)
    trigger.current?.focus({ preventScroll: true })
  }
  const sendPicks = () => {
    if (picked.length > 0) dispatch.answer({ choices: picked })
  }
  const next = (direction: number) => {
    const at = turn.questions.findIndex((q) => q.id === question.id)
    const targetId =
      turn.questions[Math.max(0, Math.min(turn.questions.length - 1, at + direction))]?.id ?? null
    select(targetId)
    title.current?.focus({ preventScroll: true })
  }
  const onKey = buildBatchKeyHandler({
    question,
    card,
    moreState,
    isMulti,
    requestOpen,
    hasMultipleRecommendations: dispatch.everyRecommendation.length > 1,
    draftKey,
    isBlocked: dispatch.isBlocked,
    closeMore,
    askMore,
    toggle,
    choose: dispatch.choose,
    sendPicks,
    next,
    takeAllRecommendations: () => void dispatch.takeAllRecommendations(),
    answer: dispatch.answer,
  })
  shortcut.current = onKey

  const points = turn.links.find((l) => l.questionId === question.id)?.points ?? []
  const pointWords = points.length ? `Done means ${points.join(", ")}` : "your request"
  const stepLabel = FLOW_STEPS.find((step) => step.id === batch.step)?.label ?? "Plan"
  const left = turn.questions.length

  return (
    <>
      <section
        className="qbc"
        aria-label="Your turn"
        data-testid="question-batch"
        data-item-id={`question:${question.id}`}
        ref={card}
        tabIndex={-1}
        onKeyDown={onKey}
      >
        <BatchCardHeader
          batch={batch}
          turn={turn}
          taskId={taskId}
          question={question}
          members={members}
          presented={turn.nativeQuestions?.[question.id]}
          onFocusQuestion={focusQuestion}
          onChangeAnswer={onChangeAnswer}
          onChangeMember={dispatch.changeMember}
        />
        <div className="qbc-question" data-testid="batch-question" data-question-id={question.id}>
          <BatchMoreBanner
            requestOpen={requestOpen}
            more={more}
            agent={agent}
            now={now}
            gone={gone}
            resume={resume}
            cancelling={moreState.cancelling.has(question.id)}
            update={update}
            onCancel={() =>
              cancelQuestionMore({ id: question.id, batchId: batch.id, moreState, onCancelMore })
            }
            onDismiss={() => dismiss(question.id)}
          />
          <QuestionBatchIntro
            question={question}
            title={title}
            update={update}
            pointWords={pointWords}
            openSettles={settleOpener(question, planDoc, onOpenAt, onOpenDoc)}
            showLive={!terminalPreferred || requestOpen || gone !== null}
            requestOpen={requestOpen}
            liveWords={liveWordsOf(agent, requestOpen, gone !== null)}
            artifactTask={artifactTask}
            onOpenDoc={onOpenDoc}
          />
          <QuestionBatchActionsSection
            question={question}
            theme={theme}
            artifactTask={artifactTask}
            onOpenDoc={onOpenDoc}
            confirmedIndex={confirmedIndex}
            confirm={confirm}
            isMulti={isMulti}
            picked={picked}
            toggle={toggle}
            draftKey={draftKey}
            draft={draft}
            field={field}
            trigger={trigger}
            requestOpen={requestOpen}
            choosingOpen={moreState.choosing === question.id}
            ahead={batch.ahead}
            dispatch={dispatch}
            sendPicks={sendPicks}
            askMore={askMore}
            closeMore={closeMore}
            openMore={() => moreState.setChoosing(question.id)}
          />
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
