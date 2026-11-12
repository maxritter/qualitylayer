// Stable API for session receipts, shell evidence, commit windows and task-owned journals.

export { noteCommitStart, settleCommits } from "./session-edits/commit-window.ts"
export {
  foreignEdits,
  foreignLooseEdits,
  matchingForeignEdits,
} from "./session-edits/foreign-edits.ts"
export {
  editsKeptSince,
  otherTasksOnly,
  ownEdits,
  ownEditTimes,
  ownRecordSpan,
  recordEdits,
  recordedBytes,
  recordShellEdits,
} from "./session-edits/records.ts"
export { editedPaths, shellCommits, shellPatchedPaths } from "./session-edits/shell.ts"
export type { OwnChange, OwnChanges } from "./session-edits/task-changes.ts"
export {
  clearOwnChanges,
  keepOwnChanges,
  keepRestored,
  keptOwnChanges,
  noteToolHook,
  toolHooksSeen,
} from "./session-edits/task-changes.ts"
