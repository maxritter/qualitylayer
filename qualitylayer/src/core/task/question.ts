// Questions retain stable ids across App waits, native Terminal pickers and Tell me more.
// App asks wait here; Terminal asks return the picker input without starting a wait.

export { agentSession } from "../agents/detect.ts"
export { questionsAhead } from "./question-ahead.ts"
export { answerQuestion } from "./question-answer.ts"
export { askQuestion } from "./question-ask.ts"
export { findingProblem, h3Titles, reviewedTask } from "./question-gate-scope.ts"
export { changeAnswer, reopenAnswer, takeMeanwhile } from "./question-history.ts"
export { answerSingleMore, cancelMore, moreProgress, requestMore } from "./question-more.ts"
export { matchOptions, parseQuestion, picksProblem } from "./question-parse.ts"
export { foundOf, longFactsWarning } from "./question-parse-choices.ts"
export {
  answeredQuestions,
  cancelQuestion,
  markFront,
  markStopped,
  openQuestion,
  readHeartbeat,
  showQuestion,
  withQuestionLock,
  writeAnswered,
} from "./question-store.ts"
export {
  type AnswerChange,
  type AnsweredQuestion,
  ASK_SLICE_MS,
  type AskReply,
  evidenceAsAsked,
  HEARTBEAT_MS,
  type Heartbeat,
  type Meanwhile,
  type MoreRequest,
  projectedQuestion,
  type Question,
  type QuestionAbout,
  type QuestionChoice,
  questionRevision,
  replyOf,
} from "./question-types.ts"
export { waitForAnswer } from "./question-wait.ts"
