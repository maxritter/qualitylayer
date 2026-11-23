// What changes lasting artifacts: a draft copied from one (`draftOnArtifact`), a draft or a personal
// artifact kept as one (`keepArtifact`), and a task's pages folded into one at Review (`foldPreview`,
// `foldArtifact`), and a task's draft on a shared artifact (create, pull, save as the next version).
// Plain node file access like `lasting.ts`: copies never follow a link, skip dot-files,
// and respect the artifact caps. The fold commits exactly the paths it wrote, through the private-index
// commit QualityLayer's slice commits use, so no one else's staged or unstaged work goes with it.

export { copyLastingToProject, draftOnArtifact } from "./lasting-draft.ts"
export {
  bad,
  failure,
  keepAllFiles,
  LASTING_KEEP_ALL,
  listFiles,
  safeRel,
  type WriteTask,
} from "./lasting-files.ts"
export { keepArtifact } from "./lasting-keep.ts"
export { type Draft, parseOnPages, readDraft } from "./lasting-read-draft.ts"
