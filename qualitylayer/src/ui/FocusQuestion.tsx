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

import { Asking } from "./focus-question-asking.tsx"
import {
  type FocusQuestionProps,
  type QuestionActions,
  useFocus,
  useQuestionCard,
} from "./focus-question-model.ts"
import { Answered, Approved, ChangeCard } from "./focus-question-receipts.tsx"
import "./turn/question-batch.css"
import "./turn/question-focus.css"

export { ChangeCard, type QuestionActions, useFocus, useQuestionCard }

export function FocusQuestion(props: FocusQuestionProps) {
  const { focus } = props
  if (focus.kind === "approved") return <Approved {...props} focus={focus} />
  if (focus.kind === "answered") return <Answered {...props} last={focus.last} />
  return <Asking {...props} question={focus.question} />
}
