import { useCallback } from "react"
import { parseArtifactReference } from "../../core/artifact/reference.ts"
import type { Api, TaskDetail } from "../api.ts"
import type { viewFile } from "../DocPathChip.tsx"
import { useQuery } from "../hooks.ts"
import type { stepDocumentOrPending } from "../step-page/document.ts"

type TaskData = {
  api: Pick<Api, "doc" | "sections" | "cost" | "artifactPage" | "evidence">
  task: TaskDetail
  view: string
  isDoc: boolean
  fileInView: ReturnType<typeof viewFile>
  stepDoc: ReturnType<typeof stepDocumentOrPending> | null
  fileReader: boolean
  version: number
  slow: number
}

/** Keeps document reads on file events and cost reads on the slower activity clock. */
export function useTaskData({
  api,
  task,
  view,
  isDoc,
  fileInView,
  stepDoc,
  fileReader,
  version,
  slow,
}: TaskData) {
  const content = useQuery(
    () =>
      isDoc && fileInView?.exists !== false && stepDoc === null
        ? api.doc(task.id, view)
        : Promise.resolve(null),
    [task.id, view, version, fileReader, fileInView?.exists],
  )
  // A task's document cut into sections: the step page and the Reader are two renderings of
  // this one response, the Reader dimming and tagging the `detail` ones.
  const sectionsFile = fileReader ? view : (stepDoc?.file ?? null)
  const sectionsExist = task.docs.some((doc) => doc.name === sectionsFile && doc.exists)
  const sections = useQuery(
    () =>
      sectionsFile !== null && sectionsExist
        ? api.sections(task.id, sectionsFile).catch(() => null)
        : Promise.resolve(null),
    [task.id, sectionsFile, sectionsExist, version],
  )
  // What the task cost so far, from the transcripts on this machine; a failure shows no figures.
  const cost = useQuery(
    () =>
      Promise.resolve()
        .then(() => api.cost(task.id))
        .catch(() => null),
    [task.id, slow],
  )
  // File events refresh embedded content too; ArtifactFrame keeps an unchanged frame.
  // biome-ignore lint/correctness/useExhaustiveDependencies: version invalidates file content
  const loadArtifact = useCallback(
    (name: string) => {
      const reference = parseArtifactReference(name) ?? parseArtifactReference(`artifacts/${name}`)
      if (!reference) return Promise.reject(new Error("The design reference could not be read."))
      return api.artifactPage(
        reference.scope === "project"
          ? { scope: "project", id: task.project }
          : { scope: "task", id: task.id },
        reference.file,
      )
    },
    [api, task.id, task.project, version],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: version invalidates file content
  const loadEvidence = useCallback(
    (name: string) => api.evidence(task.id, name),
    [api, task.id, version],
  )
  return { content, sections, cost, loadArtifact, loadEvidence }
}
