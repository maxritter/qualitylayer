// A gate is a file. open() validates first and writes gate.json; wait() is a
// bounded watch in short slices; record() is the single writer of decisions
// (the chat's `gate decide` and the App's button both end here); settle()
// applies a decision exactly once, through `wait`, a verb (`build start`, `ship`) or the App; `next`
// only reads it. Two targets: the Plan (01-plan.md, before any code) and `final`.

export { applyGatePick } from "./gate-apply-pick.ts"
export { finalChatReview } from "./gate-chat.ts"
export { ensureFinalReview } from "./gate-final-review.ts"
export {
  lateAnswerAt,
  lateAnswerLock,
  planReviewQuestionMove,
} from "./gate-late.ts"
export { open } from "./gate-open.ts"
export {
  answerableGate,
  approvalFloor,
  finalApprovalUnheard,
  invalidateGate,
  markGateShown,
  recheckedReview,
  reopenVerify,
} from "./gate-phase.ts"
export { recordChatApproval, recordPickedAnswer } from "./gate-picks.ts"
export { record, saveDecision } from "./gate-record.ts"
export { settle } from "./gate-settle.ts"
export { approvalWouldAskChanges, reviewSettled, reviewStanding } from "./gate-standing.ts"
export {
  CHAT_APPROVAL,
  type ChatQuestion,
  FINAL,
  type GateFile,
  type GateOutcome,
  isApproval,
  NOT_SHOWN_YET,
  ONE_GATE,
  openGate,
  pendingDecision,
  questionIsOf,
  type ReviewStanding,
  readGate,
} from "./gate-types.ts"
export { SLICE_MS, STATUS_MS, TOTAL_CAP_MS, wait } from "./gate-wait.ts"
export { lockPath } from "./lock.ts"
