import { type ReactNode, useCallback, useEffect, useMemo } from "react"
import {
  type Artifact,
  type LastingArtifact,
  lastingDoc,
  type TaskMark,
} from "../../core/artifact/format.ts"
import type { ArtifactWhere } from "../api.ts"
import { markSeen } from "../artifact/seen.ts"
import { useQuery } from "../hooks.ts"
import { knownProjects, type ProjectFacts, projectFacts } from "../sidebar/project-model.ts"
import type { ArtifactRouteProps } from "./ArtifactRoute.tsx"
import { TaskMarkDot } from "./TaskMark.tsx"

export type LastingViewerProps = ArtifactRouteProps & { name: string; page: string }

function libraryPage(entry: LastingArtifact | undefined, file: string): Artifact | null {
  if (!entry) return null
  return {
    file,
    name: entry.name,
    scope: "project",
    title: entry.title,
    purpose: entry.purpose,
    changed: null,
    updated: entry.updated,
    revision: entry.revision,
    sections: [],
    width: null,
    thumb: entry.thumb,
    comments: 0,
    pages: entry.pages,
  }
}

function pageMarks(entry: LastingArtifact | undefined) {
  const marks: Record<string, ReactNode> = {}
  const urgency: TaskMark["state"][] = ["you", "stop", "work", "quiet"]
  for (const page of entry?.pages ?? []) {
    const states = (entry?.changing ?? [])
      .filter((change) => change.pages.includes(page.page))
      .map((change) => change.task.state)
    const state = urgency.find((value) => states.includes(value))
    if (state) marks[page.page] = <TaskMarkDot state={state} />
  }
  return marks
}

export function useLastingArtifact(props: LastingViewerProps) {
  const { api, route, name, overview } = props
  const where: ArtifactWhere = useMemo(
    () => ({ scope: "project", id: route.project }),
    [route.project],
  )
  const lookup = useQuery(
    () => api.lastingArtifact(route.project, name, false),
    [api, route.project, name, props.version],
  )
  const owner = overview.data?.projects.find((value) => value.id === route.project)
  const listed = overview.data
    ? owner?.lasting.find((value) => value.name === name)
    : lookup.data?.artifact
  const entry = listed && !("broken" in listed) ? listed : undefined
  const known = knownProjects(props.projects, props.tasks)
  const factsOf = (id: string): ProjectFacts =>
    projectFacts(known.find((value) => value.id === id) ?? { id, name: id }, props.looks)
  const projectName = owner?.name ?? lookup.data?.project.name ?? route.project
  const facts = projectFacts(
    known.find((value) => value.id === route.project) ?? { id: route.project, name: projectName },
    props.looks,
  )
  const choices = (overview.data?.projects ?? [])
    .filter((value) => props.looks.projects[value.id]?.hidden !== true)
    .map((value) => ({ id: value.id, label: factsOf(value.id).label }))
  const entryFile = entry?.pages[0]?.file ?? lastingDoc(name, "index.html")
  const unavailable = !entry || entry.deletedAt !== undefined
  const isDesign = entry?.kind === "design"
  const page = useQuery(
    () => (unavailable || isDesign ? Promise.resolve(null) : api.artifactPage(where, entryFile)),
    [api, where, entryFile, entry?.updated, entry?.revision, unavailable, isDesign],
  )
  const history = useQuery(
    () => (unavailable ? Promise.resolve(null) : api.lastingHistory(route.project, name)),
    [api, route.project, name, props.version, unavailable],
  )
  const loadPage = useCallback((file: string) => api.artifactPage(where, file), [api, where])
  useEffect(() => {
    if (entry) markSeen(where, { file: entryFile, updated: entry.updated })
  }, [entry, where, entryFile])
  return {
    where,
    lookup,
    owner,
    entry,
    facts,
    factsOf,
    choices,
    unavailable,
    page,
    history,
    loadPage,
    artifact: libraryPage(entry, entryFile),
    marks: pageMarks(entry),
  }
}
