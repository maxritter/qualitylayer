// The Artifacts place's side of the server: every project's lasting artifacts, its personal artifacts
// ("On this computer") and the drafts of its open tasks; a lasting artifact's history; Keep as a lasting
// artifact; and the fold of a task's draft into one at Review. The files and the git work are in
// `core/artifact/lasting*.ts`; this joins them to projects, tasks and pictures.
//
// Resource budget: nothing here polls or watches. A listing reads `artifact.json`, a folder's file
// stamps, page heads (kept by file stamp) and, for the history, HEAD from `.git` (the log is kept
// while HEAD stands). The tasks' live state is read only for projects that have drafts.

export {
  artifactsOverview,
  lastingArtifactHistory,
  lastingArtifactOf,
} from "./artifact-library-listing.ts"
export {
  draftOnOfTask,
  foldPreviewOfTask,
  foldTaskDraft,
  keepLasting,
  manageLasting,
} from "./artifact-library-mutations.ts"
