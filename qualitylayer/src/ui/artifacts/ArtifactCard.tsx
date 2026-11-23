// The Library's gallery layout: one card per artifact, with a picture of its first page (a striped
// placeholder until there is one), its name, where it lives and when it last changed. The card's whole
// face opens the artifact (the title button stretches over it); the star and the row menu sit on its corner.

import { AppWindowIcon, GitBranchIcon, MonitorIcon, UsersIcon } from "lucide-react"
import { useState } from "react"
import { type LastingArtifact, lastingDoc } from "../../core/artifact/format.ts"
import type { Api } from "../api.ts"
import { agoPhrase, type Route } from "../hooks.ts"
import { FavoriteButton } from "./FavoriteButton.tsx"
import { rowFavoriteKey } from "./favorites.ts"
import { LibraryActions, type LibraryProject } from "./LibraryActions.tsx"
import { conflictPages, type LibraryRow, lastingTime, stepWord } from "./model.ts"
import { thumbSrc } from "./thumb-src.ts"

type LastingRow = Extract<LibraryRow, { kind: "lasting" }>

/** One task changing an artifact: its chip opens that task's draft; two tasks on one page say so. */
export function Changing({ row, go }: { row: LastingRow; go: (route: Route) => void }) {
  const { changing } = row.artifact
  if (changing.length === 0) return null
  const clash = conflictPages(row.artifact)
  const first = changing[0]
  if (first === undefined) return null
  // One chip for the one fact: the tasks changing this artifact. The branch mark and the task's name (or
  // the count); amber only when it waits on the person: a clash to settle, or a task that needs them.
  const waits = clash.length > 0 || changing.some((c) => c.task.state === "you")
  const many = clash.length > 0 || changing.length > 1
  const words =
    clash.length > 0
      ? `${changing.length} tasks change ${clash[0]}`
      : many
        ? `${changing.length} tasks changing it`
        : first.task.title
  return (
    <button
      type="button"
      className="lib-chg"
      data-tone={waits ? "you" : undefined}
      title={
        many
          ? `${words}: ${changing.map((c) => `${c.task.title} › ${c.pages.join(", ")}`).join("; ")}`
          : `${first.task.title} · ${stepWord(first.task.step)} · opens its draft ${first.draft}`
      }
      onClick={() => go({ view: "task", id: first.task.id, doc: first.file })}
    >
      <GitBranchIcon aria-hidden="true" className="size-3" />
      <span>{words}</span>
    </button>
  )
}

// ---------------------------------------------------------------- the card

/** The first page's picture; the placeholder when there is none or it cannot be read. */
function Picture({ src, thumb }: { src: string | null; thumb: string | null }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (src === null || thumb === null || failed === thumb)
    return (
      <span className="ds-th ph" aria-hidden="true">
        <AppWindowIcon />
      </span>
    )
  return (
    <span className="ds-th" aria-hidden="true">
      <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(thumb)} />
    </span>
  )
}

const lastingPicture = (artifact: LastingArtifact, owner: string) => {
  const first = artifact.pages[0]
  const thumb = first?.thumb ?? artifact.thumb
  const file = first?.file ?? lastingDoc(artifact.name, artifact.entry)
  return {
    thumb,
    src: thumb === null ? null : thumbSrc({ scope: "project", id: owner }, file, thumb),
  }
}

export type ArtifactCardProps = {
  row: LibraryRow
  /** Where it lives, as the project's name reads. */
  projectLabel: string
  /** The row's project only lists it; it lives in `projectLabel`. */
  listed?: boolean
  /** The project this card is listed in, so the menu can stop showing it there. */
  listedIn?: string
  /** The card is in Favorites, not in its project's group: it names its project, which no header does. */
  favorite?: boolean
  /** Which list the card is in, for the way back (focus returns to the title). */
  location: string
  archivedView: boolean
  /** It was renamed during this search and stays listed until the search changes. */
  kept: boolean
  now: number
  api: Api
  choices: LibraryProject[]
  reload: () => void
  go: (route: Route) => void
  open: (row: LibraryRow) => void
  onRenamed: () => void
}

type ReadableRow = Exclude<LibraryRow, { kind: "broken" }>

const rowPicture = (row: ReadableRow) => {
  if (row.kind === "lasting") return lastingPicture(row.artifact, row.owner)
  const { thumb, file } = row.artifact
  return {
    thumb,
    src: thumb === null ? null : thumbSrc({ scope: "project", id: row.owner }, file, thumb),
  }
}

const rowEdited = (row: ReadableRow, archivedView: boolean, now: number) => {
  if (row.kind !== "lasting") return `Edited ${agoPhrase(row.artifact.updated, now)}`
  if (archivedView && row.artifact.archivedAt !== undefined)
    return `Archived ${agoPhrase(row.artifact.archivedAt, now)}`
  return `Edited ${agoPhrase(lastingTime(row.artifact), now)}`
}

function CardStatus({ row, go }: { row: ReadableRow; go: (route: Route) => void }) {
  if (row.kind === "personal")
    return (
      <span className="lib-card-meta">
        <MonitorIcon aria-hidden="true" className="size-3 flex-none" />
        <span className="lib-card-when">only on this computer</span>
      </span>
    )
  if (row.artifact.changing.length > 0 && row.artifact.archivedAt === undefined)
    return (
      <span className="lib-card-meta lib-card-chg">
        <Changing row={row} go={go} />
      </span>
    )
  if (row.alsoIn.length > 0 && row.own)
    return (
      <span className="lib-card-meta">
        <UsersIcon aria-hidden="true" className="size-3 flex-none" />
        <span className="lib-card-when">also in {row.alsoIn.map((p) => p.label).join(", ")}</span>
      </span>
    )
  return null
}

function CardWhere({
  listed,
  favorite,
  projectLabel,
}: {
  listed?: boolean
  favorite?: boolean
  projectLabel: string
}) {
  if (!listed && !favorite) return null
  return (
    <>
      <span className="lib-card-where" title={projectLabel}>
        {listed ? `from ${projectLabel}` : projectLabel}
      </span>
      <span aria-hidden="true">·</span>
    </>
  )
}

export function ArtifactCard(props: ArtifactCardProps) {
  const { row, now, location } = props
  if (row.kind === "broken")
    return (
      <li className="lib-card lib-card-broken" data-testid="broken-artifact">
        <div className="lib-card-b">
          <b className="lib-card-name">{row.artifact.name}</b>
          <span className="lib-card-meta">It cannot be read: {row.artifact.reason}</span>
        </div>
      </li>
    )

  const title = row.artifact.title
  const picture = rowPicture(row)
  const edited = rowEdited(row, props.archivedView, now)
  const listedIn =
    row.kind === "lasting" && !row.own && !props.favorite && props.listedIn !== undefined
      ? { listedIn: props.listedIn }
      : {}

  return (
    <li className="lib-card" data-testid="library-card" data-library-location={location}>
      <Picture src={picture.src} thumb={picture.thumb} />
      <div className="lib-card-b">
        <button
          type="button"
          className="lib-title lib-card-title"
          data-lib={row.key}
          title={title}
          onClick={() => props.open(row)}
        >
          {title}
        </button>
        <span className="lib-card-meta">
          <CardWhere
            listed={props.listed}
            favorite={props.favorite}
            projectLabel={props.projectLabel}
          />
          <span className="lib-card-when">{edited}</span>
        </span>
        <CardStatus row={row} go={props.go} />
        {props.kept ? (
          <span className="lib-kept" data-testid="library-row-kept">
            Renamed: it no longer matches your search, and stays here until you change it.
          </span>
        ) : null}
      </div>
      <span className="lib-card-acts">
        <FavoriteButton id={rowFavoriteKey(row)} title={title} />
        {row.kind === "lasting" ? (
          <LibraryActions
            api={props.api}
            artifact={row.artifact}
            owner={row.owner}
            projects={props.choices}
            reload={props.reload}
            go={props.go}
            {...listedIn}
            onRenamed={props.onRenamed}
          />
        ) : null}
      </span>
    </li>
  )
}
