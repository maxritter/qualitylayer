// `qualitylayer check`: the CLI runs the commands the Plan approved and records
// their exit codes, so a check is the CLI's record, not the agent's claim.

export { readCheckRecords, recordsPath } from "./check-receipts.ts"
export { commandsFor, startCheck } from "./checks-commands.ts"
export { checkKey } from "./checks-keys.ts"
export { notRunReason } from "./checks-messages.ts"
export { runCheck } from "./checks-run.ts"
export {
  CHECK_LOCK_WAIT_MS,
  CHECK_TIMEOUT_MS,
  type CheckRecord,
  type CheckReply,
  type CheckResult,
  type CheckScope,
  type CommandRunner,
  checkProcessOptions,
  checkTimeoutMs,
  latestRuns,
  lockPath,
  type Ran,
  RED_CHECK_MOVES,
  shellRunner,
} from "./checks-runner.ts"
export {
  allChecksPassed,
  checksGap,
  checksRanSinceAsked,
  checksReadyForReview,
  noteChecksAsked,
  verifiedTasks,
} from "./checks-status.ts"
