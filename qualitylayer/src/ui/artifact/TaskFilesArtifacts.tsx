// The Artifacts groups of a task's Files tab. "Artifacts" lists the task's drafts, each saying what it
// drafts on ("Draft on App Model › Sidebar, Home"), that its base was archived, deleted or is not in
// the Library, or that it is new; "Library · <project>" lists the active artifacts every task of the
// project builds on, then the ones it shows from other projects (each opening in its owner), with a
// link to all of them. Both have a "…" button and a right-click menu (`ArtifactMenus`).

import { ChevronDownIcon } from "lucide-react"
import { type ReactNode, useState } from "react"
import type { Artifact } from "../../core/artifact/format.ts"
import type { ArtifactWhere } from "../api.ts"
import { useArtifactMenus } from "./ArtifactMenus.tsx"
import type { TaskArtifactState } from "./TaskArtifact.tsx"
import { DraftArtifactRow, LastingArtifactsSection } from "./TaskFilesRows.tsx"
import { draftedOn, draftLine, useTaskLasting } from "./task-lasting.ts"
import "./task-lasting.css"

const FIRST = 5

function LastingPanel({
  task,
  lasting,
  lastingShown,
  named,
  menus,
  onShowAll,
}: {
  task: TaskArtifactState["task"]
  lasting: ReturnType<typeof useTaskLasting>
  lastingShown: ReturnType<typeof useTaskLasting>["artifacts"]
  named: ReadonlySet<string>
  menus: ReturnType<typeof useArtifactMenus>
  onShowAll: () => void
}) {
  if (lasting.project !== null && task !== undefined) {
    return (
      <LastingArtifactsSection
        task={task}
        lasting={lasting}
        lastingShown={lastingShown}
        named={named}
        menus={menus}
        onShowAll={onShowAll}
      />
    )
  }
  if (lasting.query.error !== null) {
    return (
      <p className="ir-doc-note" role="status">
        Could not read the lasting artifacts.{" "}
        <button type="button" className="q-link" onClick={lasting.reload}>
          Try again
        </button>
      </p>
    )
  }
  return null
}

function isSameArtifactTarget(
  current: { where: ArtifactWhere; file: string } | null,
  where: ArtifactWhere,
  file: string,
): boolean {
  return (
    current?.file === file && current.where.scope === where.scope && current.where.id === where.id
  )
}

export function TaskFilesArtifacts({
  state,
  current,
  onOpen,
  planned,
  afterDrafts,
}: {
  state: TaskArtifactState
  current: { where: ArtifactWhere; file: string } | null
  onOpen: (where: ArtifactWhere, artifact: Artifact) => void
  /** Planning is over (the Plan is approved): a task with no artifact will not get one now. */
  planned: boolean
  afterDrafts?: ReactNode
}) {
  const [all, setAll] = useState(false)
  const [allLasting, setAllLasting] = useState(false)
  const task = state.task
  const lasting = useTaskLasting(state.api, task?.project)
  const own = state.groups.flatMap((group) => group.artifacts)
  const artifacts = state.groups.flatMap((group) =>
    group.artifacts.map((artifact) => ({ where: group.where, artifact })),
  )
  const menus = useArtifactMenus({
    api: state.api,
    task,
    where: state.where,
    drafts: own,
    lasting,
    readOnly: state.readOnly,
    current: current?.file ?? null,
    onOpen,
    reload: state.list.reload,
  })
  const shown = all || artifacts.length <= 6 ? artifacts : artifacts.slice(0, FIRST)
  const named = draftedOn(own)
  const lines = state.api !== undefined && task !== undefined
  const listed = lasting.artifacts
  const lastingShown = allLasting || listed.length <= 6 ? listed : listed.slice(0, FIRST)
  const countLabel = artifacts.length ? artifacts.length : planned ? "none" : "none yet"
  const projectsCtx =
    task !== undefined && lasting.query.data !== null
      ? { projects: lasting.query.data.projects, project: task.project }
      : undefined

  return (
    <>
      <section className="ir-compact-artifacts" data-testid="artifacts-tab" aria-label="Artifacts">
        <h3>
          <span>Artifacts</span>
          <span>{countLabel}</span>
        </h3>
        {shown.map(({ where, artifact }) => (
          <DraftArtifactRow
            key={`${where.scope}:${where.id}:${artifact.file}`}
            where={where}
            artifact={artifact}
            line={
              lines && task !== undefined ? draftLine(artifact, listed, task.id, projectsCtx) : null
            }
            lines={lines}
            isCurrent={isSameArtifactTarget(current, where, artifact.file)}
            menus={menus}
            onOpen={onOpen}
          />
        ))}
        {shown.length < artifacts.length ? (
          <button type="button" className="ir-file-row" onClick={() => setAll(true)}>
            <ChevronDownIcon size={13} aria-hidden="true" />
            <span>{artifacts.length - shown.length} more</span>
          </button>
        ) : null}
        {artifacts.length === 0 ? (
          <p className="ir-doc-note" data-testid="artifacts-empty">
            {planned
              ? "No question or decision in planning needed one."
              : "drawn while planning, when a question or decision needs one"}
          </p>
        ) : null}
      </section>
      {afterDrafts}
      <LastingPanel
        task={task}
        lasting={lasting}
        lastingShown={lastingShown}
        named={named}
        menus={menus}
        onShowAll={() => setAllLasting(true)}
      />
      {menus.node}
    </>
  )
}
