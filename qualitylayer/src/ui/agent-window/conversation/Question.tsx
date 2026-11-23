import { SquareTerminalIcon } from "lucide-react"
import { useId } from "react"
import type { PickerResult } from "../../../core/conversation/codex-picker.ts"
import type { ConversationQuestion } from "../../../core/conversation/types.ts"
import { QuestionChoices, QuestionStatusNotices } from "./QuestionParts.tsx"
import {
  answerText,
  type NativeAnswer,
  type NativeAnswerUpload,
  type QuestionComposer,
} from "./question-helpers.ts"
import { useQuestionController } from "./use-question-controller.ts"
import "./question.css"

export type { NativeAnswer, NativeAnswerUpload }

export function Question({
  question,
  answer,
  send,
  onTerminal,
  readOnly = false,
  onDone,
  composer,
}: {
  question: ConversationQuestion
  answer?: (answer: NativeAnswer, upload?: NativeAnswerUpload) => Promise<PickerResult>
  send(text: string): boolean
  onTerminal(): void
  readOnly?: boolean
  onDone?(): void
  composer: QuestionComposer
}) {
  const id = useId()
  const ctrl = useQuestionController({ question, answer, readOnly, onDone, composer })
  const q = ctrl.q
  if (!q) return null
  const availability = readOnly ? "read-only" : question.availability
  const words = (all = ctrl.picks) => answerText(question, all)
  const sendAsMessage = () => {
    const own = composer.text.trim()
    const merged = own ? { ...ctrl.picks, [q.id]: { own } } : ctrl.picks
    if (send(words(merged))) {
      composer.change("")
      ctrl.complete()
    } else ctrl.setProblem("Could not send the message. Your answer is kept; try again.")
  }
  return (
    <section
      className="cv-native-question"
      aria-label={`${question.agent === "codex" ? "Codex" : "Claude Code"} asks`}
    >
      <header>
        <b>{q.header}</b>
        <span className="cv-native-head-end">
          {ctrl.at + 1} of {question.questions.length}
          <button
            type="button"
            className="q-btn quiet icon sm"
            aria-label="Answer in the terminal"
            title="Answer in the terminal"
            onClick={onTerminal}
          >
            <SquareTerminalIcon size={14} aria-hidden="true" />
          </button>
        </span>
      </header>
      <p id={id}>{q.question}</p>
      <QuestionChoices
        q={q}
        id={id}
        selected={ctrl.selected}
        locked={ctrl.locked}
        choose={ctrl.choose}
      />
      <QuestionStatusNotices
        question={question}
        problem={ctrl.problem}
        busy={ctrl.busy}
        availability={availability}
        hasAnswer={Boolean(answer)}
        expired={ctrl.expired}
        status={ctrl.status}
        readOnly={readOnly}
        canSendMessage={Boolean(composer.text.trim() || words())}
        onSendAsMessage={sendAsMessage}
      />
    </section>
  )
}
