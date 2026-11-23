// One assignment/receipt contract for the judge. A judgement counts once it is recorded: later edits to
// the code, the Plan or the evidence do not void it. Phase dispatch stays in next.ts; this module never
// writes a task's stage.

export { evidenceFolder } from "./gate/revision.ts"
export {
  acceptMovedVerification,
  evidenceExists,
  judgedHeadWarning,
  lostEvidence,
  lostEvidenceWarnings,
  stampVerification,
  verificationErrors,
} from "./verification-errors.ts"
export { noteOwnChange } from "./verification-loose.ts"
export { prepareJudgeAdmission, prepareVerification } from "./verification-prepare.ts"
export {
  checkedWithoutIndependentJudge,
  codeCommittedSinceJudged,
  finishVerification,
  fixCommittedSinceFailedRound,
  readAssignment,
  recordWithoutIndependentJudge,
  staleInputs,
  verificationContextRevision,
} from "./verification-receipt.ts"
export { assignmentCurrent, passStanding, verificationCurrent } from "./verification-standing.ts"
export {
  type Assignment,
  codeDiff,
  codeDiffCode,
  REVIEWER_TEST_PATHS,
  REVIEWER_TEST_SPECS,
} from "./verification-types.ts"
