/**
 * Server-side data for the Cockpit SPA: lists projects and tasks, reads task details and
 * documents, records review decisions, saves comments, handles shipping and questions.
 */

export {
  clearTaskChanges,
  taskChanges,
  taskFileDiff,
  taskPlanRevisions,
  taskReviewFileSource,
  taskWalkthrough,
} from "./api-changes.ts"
export { postBuildComment, putComments } from "./api-comments.ts"
export {
  postNeedSet,
  postViewing,
  refreshTaskPages,
  taskCostOf,
  taskDetail,
  warmTasks,
} from "./api-detail.ts"
export {
  artifactContent,
  chatPromotionState,
  docContent,
  evidenceContent,
  openTaskFile,
  postChatPromote,
} from "./api-docs.ts"
export { postGate, putArchived, putProfile, removeTask } from "./api-gates.ts"
export {
  findAll,
  getConfig,
  listProjects,
  locate,
  putConfig,
  registeredProjects,
  shippedTasks,
  shippedWithOpenPullRequest,
} from "./api-projects.ts"
export {
  homeQuestions,
  postHomeQuestion,
  postQuestionAnswer,
  postQuestionCancel,
  postQuestionChange,
  postTaskPicker,
} from "./api-questions.ts"
export {
  postAnotherReview,
  postAskAgain,
  postFinding,
  postReview,
} from "./api-review.ts"
export {
  getLandingDiff,
  openChosenPullRequest,
  postApproveChange,
  postLeavePullRequest,
  postMarkMerged,
  postPush,
} from "./api-ship.ts"
export { postBuildHere, postStart } from "./api-start.ts"
export { anyOpenGate, listAllTasks, taskSummary } from "./api-summary.ts"
export { postBranch, postTask, taskBranch } from "./api-task-ops.ts"
export type {
  DocEntry,
  Evidence,
  HomeQuestion,
  ImplementOption,
  LiveReport,
  Project,
  TaskChanges,
  TaskDetail,
  TaskSummary,
} from "./api-types.ts"
