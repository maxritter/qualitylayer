// Every question QualityLayer asks is asked and answered here, in a card above the page: the
// agent runs `qualitylayer question ask`, which waits until the person answers in this card. The
// card is layout "A" of the question redesign, the same as a batch: no frame, one header line (Your
// turn and where the question sits), the title, the reason, one meta line (what it settles, and
// whether the agent waits), then one column of choices (turn/ChoiceList.tsx). The context is graded
// by how hard it is to decide (1 one line of why, 2 facts per choice, 3 a small diagram per choice
// with its facts and evidence); a grade 2 or 3 choice folds its details. Under the choices: the own
// answer, then Tell me more. An answer goes out at once: the card folds into one receipt line with
// Change, and a quiet line holds the place of the next question while the agent writes it. The card
// says plainly when the agent looks something up, stopped waiting or was interrupted, and an answer
// given then is kept. The Plan review is the same card: each decision (Agree or Change…), then
// "Approve the Plan?".

import {
  CheckIcon,
  ChevronsRightIcon,
  CircleCheckIcon,
  ListChecksIcon,
  MessageCircleQuestionMarkIcon,
  TerminalIcon,
  UnplugIcon,
} from "lucide-react"
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { FLOW_STEPS, flowStepOf } from "../core/flow.ts"
import { flattenItems } from "../core/items.ts"
import { type LiveSignals, livenessOf } from "../core/live/liveness.ts"
import type {
  AnsweredQuestion,
  Heartbeat,
  MoreRequest,
  QuestionAbout,
  QuestionChoice,
} from "../core/task/question.ts"
import { questionsAhead } from "../core/task/question-ahead.ts"
import { askedInAgent } from "../core/task/sides.ts"
import { recommendedIndices, recommendedLabel } from "../interaction/question-recommendations.ts"
import { findPlace } from "./AnsweredMarkers.ts"
import type { TaskDetail } from "./api.ts"
import type { ArtifactPreviewProps } from "./artifact/ArtifactPreview.tsx"
import { useNow } from "./hooks.ts"
import { WhoMark } from "./kit/WhoMark.tsx"
import { agentInfo, fileOf, resumeCommand, viewedStep } from "./model.ts"
import { gentleNow } from "./motion.ts"
import { InlineMarkdown } from "./reader/DocReader.tsx"
import { Hint } from "./sidebar/Hint.tsx"
import { AnswerFiles } from "./turn/AnswerFiles.tsx"
import { ReceiptLine } from "./turn/BatchReceipt.tsx"
import { BatchStrip, savedNote } from "./turn/BatchStrip.tsx"
import { ChoiceList } from "./turn/ChoiceList.tsx"
import { ContinueCommand } from "./turn/ContinueCommand.tsx"
import { DocumentRow } from "./turn/DocumentRow.tsx"
import { clearDraft, draftFor, useQuestionDraft, writeDraft } from "./turn/drafts.ts"
import {
  EarlierWording,
  EXPLAIN_REQUEST,
  type Gone,
  MorePick,
  MoreStatus,
  moreOpen,
  PLAIN_REQUEST,
  reveal,
  UpdatedBar,
  useMoreUpdates,
} from "./turn/MoreRequest.tsx"
import { stripAnswered } from "./turn/members.ts"
import { QuestionComposer } from "./turn/QuestionComposer.tsx"
import { QuestionScreen, questionScreens } from "./turn/QuestionScreen.tsx"
import "./turn/question-batch.css"
import "./turn/question-focus.css"

type Asked = NonNullable<TaskDetail["question"]>

/** How long the receipt of an answer keeps the next question's place, waiting for the agent. */
export const ANSWERED_STAYS_MS = 20_000
/** A heartbeat older than this, or one that stopped waiting longer ago, means nobody waits. */
const WAIT_STALE_MS = 60_000
/** A re-run of `ask` follows the last at once: a heartbeat that just stopped waiting is still waiting. */
const RERUN_GRACE_MS = 15_000

/** What the card shows: the question that waits, or the answer given a moment ago. */
export type Focus =
  | { kind: "asking"; question: Asked; answered: AnsweredQuestion[] }
  | { kind: "answered"; last: AnsweredQuestion; answered: AnsweredQuestion[] }
  | { kind: "approved"; at: number; by?: string; asked?: string; answered: AnsweredQuestion[] }

/**
 * The Plan was approved and the build has not begun: the card hands over to Implement Start, and
 * says so when the agent recorded the approval at the person's request.
 */
function approvedPlan(task: TaskDetail): Extract<Focus, { kind: "approved" }> | null {
  const gate = task.gate
  if (gate == null || gate.target !== fileOf(task, "plan") || gate.decision !== "approved")
    return null
  if (task.stage !== "implement" || (task.progress?.checked ?? 0) > 0) return null
  return {
    kind: "approved",
    at: gate.decided ?? gate.opened,
    ...(gate.by !== undefined ? { by: gate.by } : {}),
    ...(gate.asked !== undefined ? { asked: gate.asked } : {}),
    answered: task.answeredQuestions ?? [],
  }
}

/** Recorded questions use the same card on the current step and the planning readers. */
function onQuestionPage(task: TaskDetail, view: string): boolean {
  const step = viewedStep(view)
  return (
    (step !== null && step === flowStepOf(task.stage)) ||
    view === fileOf(task, "plan") ||
    view === "verify"
  )
}

/**
 * The focus of the pages that ask: the open question, or the answer that just closed one. An App
 * answer the agent has not taken yet stays (it is kept for the agent); anywhere else, null.
 */
export function useFocus(task: TaskDetail, view: string): Focus | null {
  const answered = task.answeredQuestions ?? []
  const last = answered.at(-1)
  const onPage = onQuestionPage(task, view)
  const fresh = task.question == null && last !== undefined && onPage
  const now = useNow(fresh)
  if (!onPage) return null
  if (task.question != null) return { kind: "asking", question: task.question, answered }
  if (view === fileOf(task, "plan")) {
    const approved = approvedPlan(task)
    if (approved !== null) return approved
  }
  // A batch all answered is done: its page takes over at once.
  if (last === undefined || stripAnswered(task)) return null
  if (now - last.at < ANSWERED_STAYS_MS || keptFor(last, task.questionWait, now))
    return { kind: "answered", last, answered }
  return null
}

/** An App answer the agent has not taken, while no `ask` waits: kept until the task continues. */
function keptFor(last: AnsweredQuestion, beat: Heartbeat | null | undefined, now: number) {
  return last.via === "app" && last.delivered === false && !waits(beat, last.id, now)
}

/** Whether an `ask` waits for question `id` now, by its heartbeat. */
function waits(beat: Heartbeat | null | undefined, id: string | undefined, now: number): boolean {
  if (beat == null || (id !== undefined && beat.id !== id)) return false
  if (beat.waiting) return now - beat.at < WAIT_STALE_MS
  return now - beat.at < RERUN_GRACE_MS
}

/** "about 4 to come", "last questions", or nothing when the agent gave no estimate. */
function aheadWords(question: { number: number; ahead?: number; of?: number }): string {
  const ahead = questionsAhead(question)
  return ahead === undefined ? "" : ahead === 0 ? "last questions" : `about ${ahead} to come`
}

/**
 * Where the question card is: a ref for it, whether the page is scrolled past it, and the way back.
 * Out of view only once it has gone above the top; a card below the fold is still ahead.
 */
export function useQuestionCard(): {
  ref: (el: HTMLElement | null) => void
  past: boolean
  back: () => void
} {
  const [card, setCard] = useState<HTMLElement | null>(null)
  const [past, setPast] = useState(false)
  useEffect(() => {
    if (card === null || typeof IntersectionObserver === "undefined") {
      setPast(false)
      return
    }
    const root = card.closest("[data-scroll-root]")
    const watch = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1)
        if (entry === undefined) return
        const top = entry.rootBounds?.top ?? 0
        setPast(!entry.isIntersecting && entry.boundingClientRect.bottom <= top)
      },
      root !== null ? { root } : {},
    )
    watch.observe(card)
    return () => watch.disconnect()
  }, [card])
  const back = useCallback(() => {
    if (card === null) return
    card.scrollIntoView?.({ block: "start", behavior: gentleNow() ? "auto" : "smooth" })
    card.focus({ preventScroll: true })
  }, [card])
  return { ref: setCard, past, back }
}

// ---------------------------------------------------------------- answering

/**
 * What the person answers in the card: a choice (its index in the question's `choices`), their own
 * words, a request for more context (with what they typed, if anything), or that they are not sure.
 */
type QuestionAnswer =
  | { choice: number }
  | { choices: number[] }
  | { text: string }
  | { more: true; request?: string }
  | { unsure: true }

/** A corrected answer: one choice, or on a several-answer question its whole set (with own words as one more pick), or words. */
export type ChangedAnswer =
  | { choice: number }
  | { choices: number[]; text?: string }
  | { text: string }

/** What the card sends. Each resolves true when the App took it. */
export type QuestionActions = {
  answer: (answer: QuestionAnswer, files?: File[]) => Promise<boolean | AnsweredQuestion>
  /** Cancel on Tell me more. */
  cancel: () => Promise<boolean>
  /** Change on a receipt: the corrected answer to question `number`. */
  change: (number: number, answer: ChangedAnswer) => Promise<boolean>
  /** A batch: bring another open member into the card (the strip's numbers); absent: they are marks. */
  focus?: (id: string) => Promise<boolean>
  /** A batch: every open member takes its recommendation, one after the other. */
  answerRest?: (members: { id: string; choice: number; choices?: number[] }[]) => Promise<boolean>
}

// ---------------------------------------------------------------- the card's parts

type Open = (doc: string, heading?: string) => void

type Ordered = { choice: QuestionChoice; index: number; recommended: boolean }

/** The choices as the card offers them: the recommended one first, each with its index in `choices`. */
function ordered(
  question: Pick<Asked, "choices" | "recommended" | "recommendedChoices" | "multi">,
  inOrder = false,
): Ordered[] {
  const all = question.choices.map((choice, index) => ({
    choice,
    index,
    recommended: recommendedIndices(question).includes(index),
  }))
  // A batch keeps the agent's order, so its numbers match the keys on every card of the batch.
  if (inOrder) return all
  return [...all.filter((c) => c.recommended), ...all.filter((c) => !c.recommended)]
}

/** The words of the link to what a question settles: its section and the words asked about, or the Plan item. */
function settlesWords(task: TaskDetail, about: QuestionAbout | undefined, item?: string) {
  const itemId = about?.item ?? item
  if (itemId !== undefined) {
    const found = flattenItems(task.items ?? []).find((i) => i.id === itemId)
    if (found !== undefined) return `${found.kindLabel.split(" · ")[0]} · ${found.what}`
  }
  if (about?.section === undefined) return null
  return about.quote !== undefined ? `${about.section} · ${about.quote}` : about.section
}

/** "decision 2 of 3, then Approve the Plan?": the review's questions are known, so they are counted. */
function reviewCount(task: TaskDetail, question: Asked): string {
  const approval = question.gate === "final" ? "Approve the change?" : "Approve the Plan?"
  if (question.item === undefined) return "last question"
  const asked = flattenItems(task.items ?? []).filter(
    (i) =>
      (i.kind === "decision" || i.kind === "confirm") &&
      i.step === (question.gate === "final" ? "verify" : "plan"),
  )
  const at = asked.findIndex((i) => i.id === question.item)
  const word = asked[at]?.kind === "confirm" ? "check" : "decision"
  return at >= 0 ? `${word} ${at + 1} of ${asked.length}, then ${approval}` : `then ${approval}`
}

/** A time of day as the card says it: 14:52. */
const hhmm = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })

// ---------------------------------------------------------------- the card

type Props = {
  task: TaskDetail
  focus: Focus
  /** The Plan document the card sits on. */
  doc: string
  nativePresentation?: string | undefined
  theme: string
  /** The card's element, for the way back to it. */
  cardRef?: (el: HTMLElement | null) => void
  /** Open another document of the task, at a heading. */
  onOpenDoc: Open
  /** Answer the question here. Absent (a teammate's view, a demo): the choices are inert. */
  actions?: QuestionActions
  /** The one short fact of the review that waits ("Codex read the Plan"), for the card's footer. */
  fact?: string
  /** The command that continues after the agent stopped; the task's own resume command when absent. */
  continueCommand?: string
  artifactTask?: ArtifactPreviewProps["task"]
  onOpenArtifact?: (file: string) => void
  /** The page holds only this card while it waits: open the step's document in the Reader. */
  onReadDocument?: () => void
  /** The step document's file name, drawn in the one row that stands for it while the card waits. */
  documentName?: string
}

export function FocusQuestion(props: Props) {
  const { focus } = props
  if (focus.kind === "approved") return <Approved {...props} focus={focus} />
  if (focus.kind === "answered") return <Answered {...props} last={focus.last} />
  return <Asking {...props} question={focus.question} />
}

/** The agent's name, as the card says it: "Claude Code", "Codex", or "Your agent". */
const agentName = (task: TaskDetail, agent: string | undefined) =>
  agentInfo(agent ?? task.session?.agent).name

type Phase =
  | { kind: "waiting" }
  | { kind: "looking"; request: string; since: number; lines: string[] }
  | { kind: "ended"; at: number }
  | { kind: "interrupted"; at: number }

/** Where the agent is with this question: waiting, looking into Tell me more, gone, interrupted. */
function phaseOf(
  question: Asked,
  beat: Heartbeat | null | undefined,
  now: number,
  signals: LiveSignals | null,
): Phase {
  // A server restart has no bearing on an agent's lifetime. Use the persisted process, hooks
  // and ask heartbeat before interpreting a stale or previous question's UI heartbeat.
  const life = signals !== null ? livenessOf(signals, now) : null
  if (life?.state === "stopped")
    return { kind: life.why === "interrupted" ? "interrupted" : "ended", at: life.at }
  const more = question.more
  if (more !== undefined && more.cancelled === undefined && more.taken !== undefined)
    return { kind: "looking", request: more.request, since: more.taken, lines: more.lines ?? [] }
  // Interrupted, unless an `ask` waits again since (a re-run clears the mark as it starts).
  const again = beat?.waiting === true && beat.at > (question.stopped?.at ?? 0)
  if (question.stopped !== undefined && !(again && waits(beat, question.id, now)))
    return { kind: "interrupted", at: question.stopped.at }
  if (life?.state === "working" || life?.state === "quiet") return { kind: "waiting" }
  // No `ask` ever beat for this task (a question only shown): nothing says the agent is gone.
  if (beat == null) return { kind: "waiting" }
  if (!waits(beat, question.id, now) && !(more !== undefined && more.cancelled === undefined))
    return { kind: "ended", at: beat?.at ?? question.asked }
  return { kind: "waiting" }
}

/** "40 s", "3 min": how long something has run. */
const since = (from: number, now: number) => {
  const s = Math.max(0, Math.round((now - from) / 1000))
  return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`
}

function Asking({
  task,
  question,
  doc,
  theme,
  cardRef,
  onOpenDoc,
  actions,
  fact,
  continueCommand,
  artifactTask,
  onOpenArtifact,
  onReadDocument,
  documentName,
  nativePresentation,
}: Props & { question: Asked }) {
  const now = useNow(true)
  const resume = continueCommand ?? resumeCommand(task)
  const grade = question.grade ?? 1
  const review = question.gate !== undefined
  const who = agentName(task, question.agent)
  const terminalPreferred = askedInAgent(task, [question])
  const phase = phaseOf(question, task.questionWait, now, task.live?.signals ?? null)
  const live = actions !== undefined
  const draftKey = `${task.id}:question:${question.id}`
  const draft = useQuestionDraft(draftKey)
  const text = draft.words
  const setText = (words: string) => writeDraft(draftKey, { words, error: null })
  const [busy, setBusy] = useState(false)
  // A member of the batch whose answer is being changed from the strip.
  const [changing, setChanging] = useState<AnsweredQuestion | null>(null)
  const sending = useRef(false)
  const sendingAll = useRef(false)
  const batch = task.batch?.members.some((m) => m.id === question.id) ? (task.batch ?? null) : null
  // The choice just sent, drawn as sent until the page reloads with the answer.
  const [sent, setSent] = useState<{
    id: string
    label: string
    index?: number
    revision?: string
    answer?: AnsweredQuestion
  } | null>(null)
  const field = useRef<HTMLTextAreaElement | null>(null)
  const self = useRef<HTMLElement | null>(null)
  const heading = useRef<HTMLHeadingElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  // After a key answered the question before, the card that answered is gone and focus fell to the page:
  // the next question's card takes it, so the next key answers that one.
  const answeredCount = task.answeredQuestions?.length ?? 0
  const seenAnswers = useRef(answeredCount)
  const wantsFocus = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when an answer lands, the receipt clears or the question changes
  useEffect(() => {
    if (answeredCount > seenAnswers.current) wantsFocus.current = true
    seenAnswers.current = answeredCount
    if (!wantsFocus.current || sent !== null || self.current === null) return
    wantsFocus.current = false
    if (
      batch !== null &&
      (document.activeElement === document.body || document.activeElement === null)
    )
      heading.current?.focus({ preventScroll: true })
  }, [answeredCount, sent, question.id])
  // Tell me more: the small choice is open; the request just sent, drawn until the page has it.
  const [choosing, setChoosing] = useState(false)
  const [asked, setAsked] = useState<MoreRequest | null>(null)
  // The toggles of a multi-select question.
  const [picks, setPicks] = useState<number[]>([])
  const [confirmation, setConfirmation] = useState<{ revision: string; index: number } | null>(null)
  const revision =
    question.revision ?? `${question.id}:${question.asked}:${question.found?.at ?? ""}`
  const confirmed = confirmation?.revision === revision ? confirmation.index : undefined
  const confirm = confirmed === undefined ? undefined : question.choices[confirmed]?.confirm
  const budget = question.ownerRequest?.kind === "budget"
  const { updates, dismiss } = useMoreUpdates([question])
  const update = updates[question.id]
  const updateAt = update?.at
  // A new question starts clean.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the question changes
  useEffect(() => {
    setSent(null)
    setChoosing(false)
    setAsked(null)
    setPicks([])
  }, [question.id])
  // The server has the request, or its answer: the one drawn at once is no longer needed.
  useEffect(() => {
    if (asked !== null && (question.more !== undefined || (question.found?.at ?? 0) >= asked.at))
      setAsked(null)
  })
  // The agent answered the request: the title is read out and the top of the card brought into view.
  useEffect(() => {
    if (updateAt === undefined) return
    heading.current?.focus({ preventScroll: true })
    reveal(self.current)
  }, [updateAt])

  const send = async (answer: QuestionAnswer, label?: string, index?: number) => {
    if (actions === undefined || sending.current || sendingAll.current) return false
    sending.current = true
    setBusy(true)
    const submitted = draftFor(draftKey)
    if (question.revision === undefined && label !== undefined && submitted.files.length === 0)
      setSent({ id: question.id, label, ...(index !== undefined ? { index } : {}) })
    try {
      const files = "more" in answer ? [] : submitted.files
      const took = await (files.length ? actions.answer(answer, files) : actions.answer(answer))
      if (!took) throw new Error("The answer was refused. Your words are kept.")
      if (label !== undefined)
        setSent({
          id: question.id,
          ...(question.revision ? { revision: question.revision } : {}),
          label: typeof took === "object" ? took.choice : label,
          ...(index !== undefined ? { index } : {}),
          ...(typeof took === "object" ? { answer: took } : {}),
        })
      if (!("more" in answer)) clearDraft(draftKey, submitted)
      return true
    } catch (cause) {
      setSent(null)
      writeDraft(draftKey, {
        error:
          cause instanceof Error ? cause.message : "Couldn't send. Your answer and files are kept.",
      })
      return false
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const pick = (item: Ordered) => {
    // Change… and Request changes… ask for words: the field takes over.
    if (item.choice.words === true) {
      field.current?.focus()
      return
    }
    if (item.choice.confirm) {
      setConfirmation({ revision, index: item.index })
      return
    }
    setConfirmation(null)
    void send({ choice: item.index }, item.choice.label, item.index)
  }
  /** A row or its Choose this button: the index is the choice's place in `question.choices`. */
  const choose = (index: number) => {
    const item = choices.find((c) => c.index === index)
    if (item !== undefined) pick(item)
  }
  const ownAnswer = () => {
    if (budget) return
    const words = text.trim()
    if (words !== "" || draft.files.length)
      void send({ text: words || "See attached files." }, words || "See attached files.")
  }
  const choices = ordered(question, batch !== null)
  const recommended = choices.find((c) => c.recommended) ?? choices[0]
  const looking = phase.kind === "looking"
  const running = phase.kind === "waiting" || looking
  const more = question.more ?? asked ?? undefined
  const requestOpen = moreOpen(more)
  const canMore = live && running && !requestOpen && !budget
  // The agent has stopped: a request waits for the next session, not for seconds.
  const gone: Gone | null =
    requestOpen && (phase.kind === "ended" || phase.kind === "interrupted")
      ? { at: phase.at, interrupted: phase.kind === "interrupted" }
      : null
  const isMulti = question.multi === true && !review
  const toggle = (index: number) =>
    setPicks((was) =>
      (was.includes(index) ? was.filter((i) => i !== index) : [...was, index]).sort(
        (a, b) => a - b,
      ),
    )
  const sendPicks = () => {
    if (picks.length > 0)
      void send({ choices: picks }, picks.map((i) => question.choices[i]?.label ?? "").join(" + "))
  }
  const askMore = async (request: string) => {
    setAsked({ request, at: Date.now() })
    setChoosing(false)
    if (!(await send({ more: true, request }))) setAsked(null)
  }
  const closeMore = () => {
    setChoosing(false)
    trigger.current?.focus({ preventScroll: true })
  }

  const openMembers = batch?.members.filter((m) => m.answer === undefined) ?? []
  const takeRecommendation = () => {
    if (budget) return
    if (question.multi && question.recommendedChoices)
      void send({ choices: recommendedIndices(question) }, recommendedLabel(question))
    else if (recommended !== undefined) pick(recommended)
  }
  const takeAllRecommendations = async () => {
    if (sendingAll.current || sending.current || openMembers.length < 2 || !actions?.answerRest)
      return
    sendingAll.current = true
    setBusy(true)
    try {
      if (
        !(await actions.answerRest(
          openMembers.map((m) => ({
            id: m.id,
            choice: m.recommended,
            ...(m.multi && m.recommendedChoices ? { choices: recommendedIndices(m) } : {}),
          })),
        ))
      )
        throw new Error("The answers were refused. Your words are kept.")
    } catch (cause) {
      writeDraft(draftKey, {
        error:
          cause instanceof Error ? cause.message : "Couldn't send. Your answer and files are kept.",
      })
    } finally {
      sendingAll.current = false
      setBusy(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (
      !live ||
      event.defaultPrevented ||
      sending.current ||
      sendingAll.current ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.repeat ||
      event.nativeEvent.isComposing
    )
      return
    const target = event.target as HTMLElement
    if (target.closest('select, a, summary, [contenteditable]:not([contenteditable="false"])'))
      return
    const toggleBox = target.tagName === "INPUT" && (target as HTMLInputElement).type === "checkbox"
    const typing = !toggleBox && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")
    if (typing) {
      if (event.key === "Escape") {
        event.preventDefault()
        target.blur()
        heading.current?.focus({ preventScroll: true })
      } else if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing &&
        target.tagName === "TEXTAREA"
      ) {
        event.preventDefault()
        ownAnswer()
      }
      return
    }
    if (event.shiftKey) return
    const key = event.key
    // The small choice is open: 1 and 2 pick inside it, Esc closes it, nothing else answers.
    if (choosing) {
      if (key === "Escape") {
        event.preventDefault()
        closeMore()
      } else if (key === "1" || key === "2") {
        event.preventDefault()
        void askMore(key === "1" ? PLAIN_REQUEST : EXPLAIN_REQUEST)
      }
      return
    }
    if (/^[1-9]$/.test(key)) {
      const item = choices[Number(key) - 1]
      if (item !== undefined) {
        event.preventDefault()
        isMulti && item.choice.words !== true ? toggle(item.index) : pick(item)
      }
    } else if (key === "Enter" && target.tagName !== "BUTTON" && isMulti) {
      event.preventDefault()
      sendPicks()
    } else if (
      key === "Enter" &&
      (target === self.current || target === heading.current) &&
      recommended !== undefined
    ) {
      event.preventDefault()
      pick(recommended)
    } else if (key === "t" || key === "T") {
      event.preventDefault()
      field.current?.focus()
    } else if ((key === "r" || key === "R") && recommended !== undefined) {
      event.preventDefault()
      takeRecommendation()
    } else if ((key === "m" || key === "M") && canMore) {
      event.preventDefault()
      setChoosing(true)
    } else if (
      key.toLowerCase() === "a" &&
      !toggleBox &&
      !review &&
      openMembers.length > 1 &&
      actions?.answerRest
    ) {
      event.preventDefault()
      void takeAllRecommendations()
    } else if ((key === "n" || key === "N") && !review) {
      event.preventDefault()
      if (!budget) void send({ unsure: true }, recommendedLabel(question))
    }
  }

  if (changing !== null && actions !== undefined)
    return (
      <div className="q-body pb-0" data-testid="focus-page">
        <ChangeCard last={changing} who={who} actions={actions} onDone={() => setChanging(null)} />
      </div>
    )
  // Sent: the card is the receipt of the click, until the page has the answer.
  if (sent !== null && sent.id === question.id && sent.revision === question.revision)
    return (
      <SentReceipt
        number={question.number}
        who={who}
        chosen={sent.label}
        {...(sent.answer ? { answer: sent.answer } : {})}
        {...(cardRef !== undefined ? { cardRef } : {})}
      />
    )

  const about = question.about
  const settles = settlesWords(task, about, question.item)
  const where = about?.doc ?? doc
  const pageStep = ["checkpoint", "implement", "verify"].includes(where) ? viewedStep(where) : null
  const docWord =
    where === fileOf(task, "plan")
      ? "the Plan"
      : (FLOW_STEPS.find((step) => step.id === pageStep)?.label ?? where)
  const goTo = () => {
    const sourcePending = () =>
      toast.info("This source is not ready yet. You can answer this question here.")
    if (about?.doc !== undefined && about.doc !== doc) {
      const source = pageStep === null ? about.doc : fileOf(task, pageStep)
      if (!task.docs.some((entry) => entry.name === source && entry.exists)) {
        sourcePending()
        return
      }
      onOpenDoc(about.doc, about.section)
      return
    }
    const target =
      about !== undefined
        ? findPlace(document.querySelector('[data-testid="task-scroll"]') ?? document.body, about)
        : question.item !== undefined
          ? document.querySelector(`[data-item-id="${CSS.escape(question.item)}"]`)
          : null
    if (target === null) {
      sourcePending()
      return
    }
    target.scrollIntoView?.({ block: "center", behavior: "smooth" })
  }
  // A batch says where the question is in the strip; its estimate is the batch's own line.
  const counted =
    batch !== null
      ? ""
      : review
        ? reviewCount(task, question)
        : [`question ${question.number}`, aheadWords(question)].filter((w) => w !== "").join(" · ")
  const settlesWord = review ? `In ${docWord}` : grade >= 2 ? `Changes in ${docWord}` : "Settles"
  const changeMember = (id: string) => {
    const given = (task.answeredQuestions ?? []).findLast((a) => a.id === id)
    if (given !== undefined && actions !== undefined) setChanging(given)
  }
  const whoLine =
    phase.kind === "looking"
      ? `${who} is looking into it`
      : phase.kind === "interrupted"
        ? "Interrupted"
        : phase.kind === "ended"
          ? `${who} stopped waiting`
          : `${who} waits`
  const wordsChoice = question.choices.find((c) => c.words === true)
  const approval = review && question.item === undefined
  const placeholder =
    wordsChoice === undefined
      ? "Or write your own answer…"
      : approval
        ? question.gate === "final"
          ? "What should change before it ships?"
          : "What should change before the build?"
        : "What should change? Typing here makes it a change"
  const sendWord = draft.error
    ? "Try again"
    : wordsChoice === undefined
      ? "Send"
      : approval
        ? "Send"
        : "Send change"
  const found = question.found
  // Before "Approve the Plan?": the review's decisions answered so far, in one line.
  const decided = approval
    ? (task.answeredQuestions ?? []).filter(
        (a) => a.gate === question.gate && a.at >= (task.gate?.opened ?? 0),
      )
    : []
  const changes = decided.filter((a) => a.choice !== "Agree" && a.choice !== "Confirmed").length
  const open = batch !== null ? openMembers.length : 1
  // A batch: the answer given last is one receipt line above the next question.
  const lastInBatch =
    batch === null
      ? undefined
      : (task.answeredQuestions ?? [])
          .filter((a) => a.id !== undefined && batch.members.some((m) => m.id === a.id))
          .at(-1)
  const stepLabel = FLOW_STEPS.find((step) => step.id === viewedStep(doc))?.label
  // A batch card has the heading level of the batch card the real page draws (QuestionBatch).
  const Title = batch !== null ? "h3" : "h2"
  return (
    <div className="q-body pb-0 fq-page" data-testid="focus-page">
      <section
        id="sp-question"
        className="qbc fq-card"
        data-testid="focus-card"
        data-grade={grade}
        data-phase={phase.kind}
        aria-label={`Question ${question.number}: ${question.question}`}
        tabIndex={-1}
        ref={(el) => {
          self.current = el
          cardRef?.(el)
        }}
        onKeyDown={onKeyDown}
      >
        {decided.length > 0 ? (
          <ReceiptLine
            lineTestId="focus-decided"
            label={decided.length === 1 ? "Decision 1" : `Decisions 1 to ${decided.length}`}
            chosen={
              changes === 0
                ? "agreed"
                : changes === decided.length
                  ? `${changes} to change`
                  : `${changes} to change, the rest agreed`
            }
          />
        ) : null}
        {lastInBatch !== undefined ? (
          <ReceiptLine
            testId="focus-receipt"
            label={`Question ${batch?.members.find((m) => m.id === lastInBatch.id)?.number ?? lastInBatch.number} sent`}
            title={lastInBatch.choice}
            chosen={lastInBatch.choice}
            state={lastInBatch.delivered === true ? `picked up by ${who}` : undefined}
            action={
              live ? (
                <button
                  type="button"
                  className="q-link"
                  onClick={() => changeMember(lastInBatch.id ?? "")}
                >
                  Change
                </button>
              ) : undefined
            }
          >
            <AnswerFiles taskId={task.id} answer={lastInBatch} />
          </ReceiptLine>
        ) : null}
        <header className="qbc-top">
          {nativePresentation ? (
            <span className="qbc-native-presentation">
              Shown in {agentInfo(nativePresentation).name}
            </span>
          ) : null}
          <span className="qbc-yt">
            <i aria-hidden="true" />
            Your turn
          </span>
          {batch !== null ? (
            <BatchStrip
              title={batch.title}
              members={batch.members}
              currentId={question.id}
              onFocus={
                live && actions?.focus !== undefined ? (id) => void actions.focus?.(id) : undefined
              }
              onChange={live ? changeMember : undefined}
            />
          ) : (
            <span className="bq-t" data-testid="focus-count">
              {counted}
            </span>
          )}
        </header>
        <div className="qbc-question" data-question-id={question.id}>
          {requestOpen && more ? (
            <MoreStatus
              more={more}
              agent={who}
              now={now}
              gone={gone}
              onCancel={live ? () => void actions?.cancel() : undefined}
              testId="focus-looking"
              progressId="focus-progress"
            />
          ) : update ? (
            <UpdatedBar
              update={update}
              onDismiss={() => dismiss(question.id)}
              testId="focus-looking"
            />
          ) : null}
          <Title ref={heading} tabIndex={-1}>
            {update?.reworded ? (
              <span className="ir-changed">
                <InlineMarkdown text={question.question} />
              </span>
            ) : (
              <InlineMarkdown text={question.question} />
            )}
          </Title>
          {question.earlier?.length ? <EarlierWording earlier={question.earlier} /> : null}
          {question.why !== undefined ? (
            <p className="qbc-why" data-testid="focus-why">
              <InlineMarkdown text={question.why} />
            </p>
          ) : null}
          <div className="qbc-meta">
            {settles !== null ? (
              <span className="qbc-settles" data-testid="focus-settles">
                <ListChecksIcon aria-hidden="true" />
                <span>{settlesWord}</span>
                <button type="button" className="q-link" onClick={goTo} title={settles}>
                  {settles}
                </button>
              </span>
            ) : null}
            {terminalPreferred && phase.kind === "waiting" ? null : (
              <span
                className={looking ? "qbc-live busy" : running ? "qbc-live" : "qbc-live off"}
                data-testid="focus-waiting"
              >
                <i aria-hidden="true" />
                {whoLine}
              </span>
            )}
          </div>
          {questionScreens(question).map((reference) => (
            <QuestionScreen
              key={reference}
              reference={reference}
              task={artifactTask}
              onOpen={onOpenArtifact ?? onOpenDoc}
            />
          ))}
          {phase.kind === "ended" ? (
            <div className="fq-stop" data-testid="focus-ended">
              <div className="h">
                <UnplugIcon aria-hidden="true" />
                {who}'s session ended at {hhmm(phase.at)}
              </div>
              <p>
                {terminalPreferred ? (
                  "You can still answer here. The answer stays with this task."
                ) : (
                  <>
                    You can still answer. Your answer is kept, and {who} reads it first when you
                    continue the task in any session:
                  </>
                )}
              </p>
              <ContinueCommand command={resume} />
            </div>
          ) : null}
          {phase.kind === "interrupted" ? (
            <div className="fq-stop" data-testid="focus-interrupted">
              <div className="h">
                <UnplugIcon aria-hidden="true" />
                You stopped {who} while it waited
              </div>
              <p>
                {terminalPreferred ? (
                  "You can still answer here. The answer stays with this task."
                ) : (
                  <>
                    Answer here. {who} takes it with your next message in its window, whatever you
                    type.
                  </>
                )}
              </p>
            </div>
          ) : null}
          {found !== undefined ? (
            <div className={update ? "qbc-found ir-fresh" : "qbc-found"} data-testid="focus-found">
              <div className="h">
                <b>Found for you</b>
                <span>{found.asked}</span>
                {now - found.at < 60_000 ? <span className="fq-tag">just now</span> : null}
              </div>
              <p>
                <InlineMarkdown text={found.text} />
              </p>
            </div>
          ) : null}
          <ChoiceList
            key={question.id}
            choices={question.choices}
            recommended={budget ? [] : recommendedIndices(question)}
            grade={grade}
            theme={theme}
            idPrefix={`focus-${question.id}`}
            chosen={confirmed}
            onChoose={choose}
            multi={isMulti ? { on: picks, toggle } : undefined}
            disabled={!live || busy}
            inOrder={batch !== null}
            screen={(reference) => (
              <QuestionScreen
                reference={reference}
                task={artifactTask}
                onOpen={onOpenArtifact ?? onOpenDoc}
              />
            )}
            testId="focus-choice"
            listTestId="focus-choices"
          />
          {confirm && confirmed !== undefined ? (
            <div className="qbc-multi">
              <button
                type="button"
                className="q-btn primary sm"
                disabled={!live || busy}
                onClick={() => {
                  const selected = question.choices[confirmed]
                  if (selected !== undefined)
                    void send({ choice: confirmed }, selected.label, confirmed)
                }}
              >
                {confirm}
              </button>
            </div>
          ) : null}
          {isMulti ? (
            <div className="qbc-multi">
              <span data-testid="focus-multi-count">
                Pick one or more
                {picks.length > 0 ? ` · ${picks.length} of ${question.choices.length} on` : ""}
              </span>
              <button
                type="button"
                className="q-btn primary sm"
                data-testid="focus-multi-send"
                disabled={picks.length === 0 || !live || busy}
                onClick={sendPicks}
              >
                {picks.length === 0
                  ? "Pick at least one"
                  : `Send ${picks.length} ${picks.length === 1 ? "choice" : "choices"}`}
              </button>
            </div>
          ) : null}
          {budget ? null : (
            <QuestionComposer
              id={`own-${question.id}`}
              words={text}
              files={draft.files}
              field={field}
              placeholder={placeholder}
              disabled={!live}
              busy={busy}
              error={draft.error}
              sendLabel={sendWord}
              testId="focus"
              onWords={setText}
              onFiles={(files) => writeDraft(draftKey, { files, error: null })}
              submit={ownAnswer}
            />
          )}
          <div className="qbc-help">
            <button
              type="button"
              className="q-btn sm"
              disabled={!canMore || busy}
              aria-keyshortcuts="M"
              aria-expanded={choosing}
              data-testid="focus-more"
              ref={trigger}
              title={!running ? "Needs a running agent" : undefined}
              onClick={() => (choosing ? closeMore() : setChoosing(true))}
            >
              <MessageCircleQuestionMarkIcon aria-hidden="true" />
              {requestOpen && more ? `Asked · ${since(more.at, now)}` : "Tell me more"}
            </button>
            {!running ? <span className="qbc-dim">Needs a running agent</span> : null}
            {review && fact !== undefined ? (
              <span className="fq-chk" data-testid="focus-fact">
                <WhoMark who="check" />
                {fact}
              </span>
            ) : null}
            {batch !== null && openMembers.length > 1 && actions?.answerRest !== undefined ? (
              <button
                type="button"
                className="q-btn sm"
                disabled={busy}
                data-testid="focus-use-all"
                aria-keyshortcuts="A"
                title="Each open question takes its recommendation"
                onClick={() => void takeAllRecommendations()}
              >
                <ChevronsRightIcon aria-hidden="true" />
                Use all recommended
              </button>
            ) : null}
            {batch !== null && !review ? (
              <Hint label={savedNote(batch.ahead)} side="top">
                <button
                  type="button"
                  className="qbc-saved"
                  data-testid="focus-saved"
                  aria-label={`Saved. ${savedNote(batch.ahead)}`}
                >
                  <CircleCheckIcon aria-hidden="true" />
                  Saved
                </button>
              </Hint>
            ) : null}
          </div>
          {choosing ? (
            <MorePick
              onSend={(request) => void askMore(request)}
              onCancel={closeMore}
              busy={busy}
            />
          ) : null}
        </div>
      </section>
      {onReadDocument !== undefined ? (
        <DocumentRow
          file={documentName}
          status={`Draft · ${open} ${open === 1 ? "question" : "questions"} open`}
          read={`Read ${stepLabel ?? "the document"}`}
          onRead={onReadDocument}
          testId="focus-doc"
          readTestId="focus-read-document"
        />
      ) : null}
    </div>
  )
}

/** The moment after the click: one receipt line, Change to correct it, and the next question's place. */
function SentReceipt({
  number,
  who,
  chosen,
  cardRef,
  onChange,
  next,
  pickedUp = false,
  answer,
  taskId,
}: {
  number: number
  who: string
  chosen: string
  cardRef?: (el: HTMLElement | null) => void
  onChange?: () => void
  next?: string
  pickedUp?: boolean
  answer?: AnsweredQuestion
  taskId?: string
}) {
  return (
    <div className="q-body pb-0 fq-page" data-testid="focus-page">
      <ReceiptLine
        lineTestId="focus-answered"
        chosenTestId="focus-chosen"
        {...(cardRef !== undefined ? { lineRef: cardRef } : {})}
        label={
          answer?.via === "chat"
            ? `Already answered in ${who}`
            : answer?.revision
              ? "Answer saved"
              : `Question ${number} sent`
        }
        title={chosen}
        chosen={chosen}
        state={
          answer?.via === "app" && !pickedUp
            ? `Delivery to ${who} is unconfirmed.`
            : pickedUp
              ? `picked up by ${who}`
              : undefined
        }
        action={
          onChange !== undefined ? (
            <button type="button" className="q-link" onClick={onChange}>
              Change
            </button>
          ) : undefined
        }
      >
        {answer ? <AnswerFiles taskId={taskId} answer={answer} /> : null}
      </ReceiptLine>
      {next !== undefined ? (
        <p className="fq-next" data-testid="focus-next">
          <span className="fq-spin" aria-hidden="true" />
          {next}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Change on a receipt: the same choices again, and the field. A one-answer question sends the new
 * choice at once; a several-answer one shows every current pick checked and Save sends the whole set.
 */
export function ChangeCard({
  last,
  who,
  actions,
  onDone,
}: {
  last: AnsweredQuestion
  who: string
  actions: QuestionActions
  onDone: () => void
}) {
  const [text, setText] = useState("")
  const labels = last.choices ?? []
  const several = last.multi === true
  const was = last.picked ?? []
  const [picks, setPicks] = useState<number[]>(was)
  const [busy, setBusy] = useState(false)
  const send = async (answer: ChangedAnswer) => {
    setBusy(true)
    try {
      if (await actions.change(last.number, answer)) onDone()
    } finally {
      setBusy(false)
    }
  }
  const toggle = (index: number) =>
    setPicks((now) =>
      (now.includes(index) ? now.filter((i) => i !== index) : [...now, index]).sort(
        (a, b) => a - b,
      ),
    )
  const own = text.trim()
  const chosen = labels.indexOf(last.choice)
  const edited =
    own !== "" || picks.length !== was.length || picks.some((index) => !was.includes(index))
  return (
    <section
      className="qbc fq-card"
      data-testid="focus-change"
      aria-label={`Change question ${last.number}`}
    >
      <header className="qbc-top">
        <span className="qbc-yt">
          <i aria-hidden="true" />
          Your turn
        </span>
        <span className="bq-t">
          Question {last.number} · change your answer · {who} hears of it next
        </span>
      </header>
      <div className="qbc-question">
        <h2>
          <InlineMarkdown text={last.question} />
        </h2>
        <ChoiceList
          choices={labels.map((label) => ({ label }))}
          recommended={[]}
          grade={1}
          theme="light"
          idPrefix={`change-${last.number}`}
          disabled={busy}
          {...(several
            ? { multi: { on: picks, toggle } }
            : {
                chosen: chosen >= 0 ? chosen : undefined,
                onChoose: (index: number) => void send({ choice: index }),
              })}
          testId="focus-change-choice"
        />
        <div className="fq-own">
          <textarea
            rows={1}
            value={text}
            placeholder={several ? "Add one in your own words…" : "Or write your own answer…"}
            aria-label={several ? "Add your own answer" : "Your own answer"}
            onChange={(event) => setText(event.target.value)}
          />
          {several ? null : (
            <button
              type="button"
              className={own !== "" ? "q-btn primary" : "q-btn"}
              disabled={own === "" || busy}
              onClick={() => void send({ text: own })}
            >
              Answer
            </button>
          )}
        </div>
        <div className="qbc-help">
          {several ? (
            <button
              type="button"
              className="q-btn primary sm"
              data-testid="focus-change-save"
              disabled={!edited || (picks.length === 0 && own === "") || busy}
              onClick={() => void send({ choices: picks, ...(own !== "" ? { text: own } : {}) })}
            >
              Save
            </button>
          ) : null}
          <button type="button" className="q-link" onClick={onDone}>
            Keep my answer
          </button>
        </div>
      </div>
    </section>
  )
}

/** The Plan approved: the hand-over to Implement Start, where the build session is started (8b). */
function Approved({
  task,
  focus,
  onOpenDoc,
}: Props & { focus: Extract<Focus, { kind: "approved" }> }) {
  const who = agentName(task, undefined)
  return (
    <div className="q-body pb-0 fq-page" data-testid="focus-page">
      <ReceiptLine
        lineTestId="focus-approved"
        label={`Plan approved · ${hhmm(focus.at)}`}
        action={
          <button type="button" className="q-link" onClick={() => onOpenDoc("implement")}>
            Open Implement Start
          </button>
        }
      />
      {focus.asked !== undefined ? (
        <p className="qbc-why" data-testid="focus-asked">
          Approved by {who} at your request: “{focus.asked}”
        </p>
      ) : null}
      <p className="qbc-why">
        The build runs in a new session you start yourself. Implement Start has the command to copy,
        with the agent, model and effort you pick there.
      </p>
    </div>
  )
}

/** The answer that closed a question: sent, kept for the agent, or given in the agent's chat. */
function Answered({
  task,
  last,
  cardRef,
  actions,
  continueCommand,
}: Props & { last: AnsweredQuestion }) {
  const now = useNow(true)
  const who = agentName(task, last.agent)
  const [changing, setChanging] = useState<AnsweredQuestion | null>(null)
  const canChange = actions !== undefined && last.gate === undefined
  const change = canChange ? () => setChanging(last) : undefined
  if (changing !== null && actions !== undefined)
    return (
      <div className="q-body pb-0 fq-page" data-testid="focus-page">
        <ChangeCard last={changing} who={who} actions={actions} onDone={() => setChanging(null)} />
      </div>
    )
  const kept = keptFor(last, task.questionWait, now)
  if (kept)
    return (
      <div className="q-body pb-0 fq-page" data-testid="focus-page">
        <section
          className="qbc fq-card"
          data-testid="focus-kept"
          aria-label={`Question ${last.number}`}
        >
          <header className="qbc-top">
            <span className="qbc-yt off">
              <CheckIcon aria-hidden="true" />
              Kept
            </span>
            <span className="bq-t">question {last.number}</span>
          </header>
          <div className="qbc-question">
            <h2>
              <InlineMarkdown text={last.question} />
            </h2>
            <p className="fq-kept" data-testid="focus-chosen">
              <CheckIcon aria-hidden="true" />
              <span>{last.choice}</span>
            </p>
            <p className="qbc-why">
              {last.revision && task.answers === "terminal" ? (
                `Delivery to ${who} is unconfirmed.`
              ) : (
                <>Kept for {who}. It reads it when the task continues.</>
              )}
            </p>
            <AnswerFiles taskId={task.id} answer={last} />
            <ContinueCommand command={continueCommand ?? resumeCommand(task)} />
          </div>
        </section>
      </div>
    )
  // App answers stay quiet from the first click, including after the server refresh.
  if (last.via === "app")
    return (
      <SentReceipt
        number={last.number}
        taskId={task.id}
        answer={last}
        who={who}
        chosen={last.choice}
        pickedUp={last.delivered === true}
        {...(last.ahead !== 0 && now - last.at < ANSWERED_STAYS_MS
          ? { next: `Next question · ${who} is writing it` }
          : {})}
        {...(cardRef !== undefined ? { cardRef } : {})}
        {...(change !== undefined ? { onChange: change } : {})}
      />
    )
  const inChat = last.via === "chat"
  const more = last.ahead !== 0 && now - last.at < ANSWERED_STAYS_MS
  return (
    <div className="q-body pb-0 fq-page" data-testid="focus-page">
      <ReceiptLine
        icon={inChat ? <TerminalIcon aria-hidden="true" /> : undefined}
        lineTestId="focus-answered"
        chosenTestId="focus-chosen"
        label={inChat ? `Question ${last.number} · answered in ${who}` : `Question ${last.number}`}
        chosen={
          inChat
            ? `“${last.choice}”`
            : last.kind === "unsure"
              ? `Not sure · ${last.choice}`
              : last.choice
        }
        action={
          change !== undefined ? (
            <button type="button" className="q-link" onClick={change}>
              Change
            </button>
          ) : undefined
        }
      >
        <AnswerFiles taskId={task.id} answer={last} />
      </ReceiptLine>
      {more ? (
        <p className="fq-next" data-testid="focus-next">
          <span className="fq-spin" aria-hidden="true" />
          Next question · {who} is writing it
        </p>
      ) : null}
    </div>
  )
}
