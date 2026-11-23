// The Artifacts place without a screen: one group per project in the sidebar's order, what Show and Find
// leave in it, and the words under an artifact and a draft.

import type {
  Artifact,
  ArtifactsOverview,
  BrokenArtifact,
  DraftEntry,
  LastingArtifact,
  ProjectArtifacts,
} from "../../core/artifact/format.ts"
import type { ProjectLooks } from "../../core/project-look.ts"
import type { Project, TaskSummary } from "../api.ts"
import { matchesQuery, type ProjectFacts, projectFacts } from "../sidebar/project-model.ts"
import { countsLine } from "./model-helpers.ts"
import { visibleProjectEntries } from "./model-rows.ts"

export { type DeletedRow, deletedRows, libraryCounts } from "./model-deleted.ts"
export {
  changingByTask,
  changingLine,
  countsLine,
  draftBase,
  lastChangeLine,
  pagesWord,
  stepWord,
} from "./model-helpers.ts"
export {
  LIBRARY_FIRST,
  LIBRARY_MORE,
  LIBRARY_SORTS,
  type LibraryGroup,
  type LibraryRow,
  type LibrarySort,
  type LibraryView,
  libraryGroups,
} from "./model-library.ts"
export { conflictPages, lastingTime } from "./model-rows.ts"

export type Show = "all" | "lasting" | "drafts"

/** A lasting artifact in a project's group. */
export type LastingItem = {
  artifact: LastingArtifact
  /** The project the artifact lives in. */
  owner: string
  /** False when another project lists it under its own. */
  own: boolean
  /** The other projects it is also in: the ones that list it, or (listed here) the one it lives in. */
  alsoIn: ProjectFacts[]
}

export type ArtifactGroup = {
  facts: ProjectFacts
  lasting: LastingItem[]
  broken: BrokenArtifact[]
  drafts: DraftEntry[]
  /** Artifacts only on this computer. */
  personal: Artifact[]
  /** "3 lasting · 3 drafts", of everything the project holds. */
  counts: string
  /** Nothing at all to list (before Show and Find). */
  empty: boolean
}

type Input = {
  overview: ArtifactsOverview
  projects: Project[]
  tasks: TaskSummary[]
  looks: ProjectLooks
  show: Show
  query: string
}

function collectProjectItems(
  projectId: string,
  data: ProjectArtifacts,
  factsOf: (id: string) => ProjectFacts,
): { lasting: LastingItem[]; broken: BrokenArtifact[] } {
  const lasting: LastingItem[] = []
  const broken: BrokenArtifact[] = []
  for (const entry of data.lasting) {
    if ("broken" in entry) broken.push(entry)
    else
      lasting.push({
        artifact: entry,
        owner: projectId,
        own: true,
        alsoIn: entry.alsoIn.map(factsOf),
      })
  }
  for (const other of data.also) {
    lasting.push({
      artifact: other.artifact,
      owner: other.project,
      own: false,
      alsoIn: [factsOf(other.project)],
    })
  }
  return { lasting, broken }
}

function buildArtifactGroup(params: {
  ref: { id: string; name: string }
  data: ProjectArtifacts
  facts: ProjectFacts
  factsOf: (id: string) => ProjectFacts
  show: Show
  query: string
}): ArtifactGroup | null {
  const { ref, data, facts, factsOf, show, query } = params
  const { lasting, broken } = collectProjectItems(ref.id, data, factsOf)
  const empty = lasting.length + data.drafts.length + data.personal.length + broken.length === 0
  const projectHit = query !== "" && matchesQuery(`${facts.label} ${ref.name}`, query)
  const keep = (text: string) => query === "" || projectHit || matchesQuery(text, query)
  const group: ArtifactGroup = {
    facts,
    lasting:
      show === "drafts"
        ? []
        : lasting.filter((l) => keep(`${l.artifact.title} ${l.artifact.name}`)),
    broken: show === "drafts" ? [] : broken.filter((b) => keep(b.name)),
    drafts:
      show === "lasting"
        ? []
        : data.drafts.filter((d) => keep(`${d.title} ${d.name} ${d.task.title}`)),
    personal: show === "drafts" ? [] : data.personal.filter((d) => keep(`${d.title} ${d.name}`)),
    counts: countsLine(lasting.length, data.drafts.length),
    empty,
  }
  const shown =
    group.lasting.length + group.broken.length + group.drafts.length + group.personal.length
  if (show === "drafts" && group.drafts.length === 0) return null
  if (query !== "" && shown === 0 && !projectHit) return null
  return group
}

export function artifactGroups(input: Input): ArtifactGroup[] {
  const query = input.query.trim()
  const groups: ArtifactGroup[] = []
  for (const { ref, data, facts, byId } of visibleProjectEntries(input)) {
    const factsOf = (id: string) =>
      projectFacts({ id, name: byId.get(id)?.name ?? id }, input.looks)
    const group = buildArtifactGroup({ ref, data, facts, factsOf, show: input.show, query })
    if (group !== null) groups.push(group)
  }
  return groups
}
