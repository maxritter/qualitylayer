// comments.json: reviewer annotations that have not been handled yet. The
// Cockpit writes drafts here as the reviewer types; a `changes` decision
// marks them delivered; the agent applies each as an edit instruction and
// removes it with `comments resolve`.

export { deliver, delivered, markPicked, take } from "./comment-delivery.ts"
export { addComment, putDrafts } from "./comment-drafts.ts"
export { addAnswers, putItemAnswer, takeImmediate } from "./comment-items.ts"
export {
  addArtifactComment,
  addBuildComment,
  artifactComments,
  commentPlaces,
  moveCommentDocs,
  resolveArtifactComment,
} from "./comment-places.ts"
export { resolveComments } from "./comment-resolve.ts"
export {
  answerKind,
  BUILD_DOC,
  BUILD_KINDS,
  type BuildAnchor,
  buildAnchor,
  COMMENT_PLACEMENT_THEN,
  type Comment,
  type CommentInput,
  type DiffAnchor,
  diffAnchor,
  helperDoc,
  helperOpen,
  isArtifactDoc,
  openDocComment,
  openReviewQuestion,
  REVIEW_QUESTIONS_THEN,
  readComments,
  reviewAsk,
} from "./comment-types.ts"
export {
  askAgain,
  claimForHelper,
  markPullRequestNotes,
  markTold,
  requestHelperNow,
  settleHelperQuestions,
  takeFresh,
  takeReviewQuestions,
} from "./comment-workers.ts"
