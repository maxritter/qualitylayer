// The Artifacts place is the Library: every project's reusable artifacts, grouped by project in the
// sidebar's order, folded when there are many. Library and Archived are its two views. Search reads
// names, folders, what an artifact shows, its pages and its project; a project filter and a sort sit
// beside it. Rows are one line, a preview opens on demand, and each project shows 8 rows, then 25
// more at a time. A task's working drafts stay in that task's Files; a row only says which task is
// changing the artifact and opens that draft. Folds, search, filter, sort, rows shown, the open
// preview and the scroll position survive opening an artifact and coming back. Archived ends with a
// folded Recently deleted, where a deleted artifact opens on its Restore or is restored at once.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { type ArtifactsOverview, lastingDoc } from "../../core/artifact/format.ts"
import type { Config } from "../../core/config-values.ts"
import type { ProjectLooks } from "../../core/project-look.ts"
import type {
  Api,
  KeepResult,
  NewArtifactRequest,
  Project,
  SubagentModels,
  TaskSummary,
} from "../api.ts"
import type { ArtifactFeedbackApi } from "../artifact/feedback-api.ts"
import { type Query, type Route, useNow } from "../hooks.ts"
import { LoadingState } from "../kit/LoadingState.tsx"
import { useOptionalRuns } from "../run-context.tsx"
import { FavoriteFeedback } from "./FavoriteButton.tsx"
import { favoriteRows, rowFavoriteKey, useArtifactFavorites } from "./favorites.ts"
import type { LibraryProject } from "./LibraryActions.tsx"
import { RecentlyDeleted } from "./LibraryDeleted.tsx"
import {
  LibraryEmptyState,
  LibraryFavoritesSection,
  LibraryGroupSection,
} from "./LibraryGroupSection.tsx"
import { LibraryHeader } from "./LibraryHeader.tsx"
import {
  getKeptLibraryState,
  type LibraryState,
  restoreLibraryFocus,
  saveLibraryScroll,
  useLibraryState,
} from "./library-state.ts"
import {
  type DeletedRow,
  deletedRows,
  LIBRARY_FIRST,
  LIBRARY_MORE,
  type LibraryGroup,
  type LibraryRow,
  libraryCounts,
  libraryGroups,
} from "./model.ts"
import { NewArtifactDialog } from "./NewArtifactDialog.tsx"

export { resetLibraryState } from "./library-state.ts"

type Props = {
  api: Api
  overview: Query<ArtifactsOverview | null>
  projects: Project[]
  tasks: TaskSummary[]
  looks: ProjectLooks
  go: (route: Route) => void
  config?: Config
  installed?: readonly SubagentModels[] | null
  contextApi?: Pick<ArtifactFeedbackApi, "context">
}

function useLibraryDerived(
  data: ArtifactsOverview | null,
  projects: Project[],
  tasks: TaskSummary[],
  looks: ProjectLooks,
  state: LibraryState,
) {
  const query = state.query.trim()
  const groups = useMemo(
    () =>
      data === null
        ? []
        : libraryGroups({
            overview: data,
            projects,
            tasks,
            looks,
            view: state.view,
            query,
            project: state.project,
            sort: state.sort,
            keep: new Set(state.pinned),
          }),
    [data, projects, tasks, looks, state.view, query, state.project, state.sort, state.pinned],
  )
  const counts = useMemo(
    () => (data === null ? { library: 0, archived: 0 } : libraryCounts(data, looks)),
    [data, looks],
  )
  const deleted = useMemo(
    () =>
      data === null || state.view !== "archived"
        ? []
        : deletedRows({ overview: data, projects, tasks, looks, query, project: state.project }),
    [data, projects, tasks, looks, state.view, query, state.project],
  )
  const choices: LibraryProject[] = useMemo(
    () =>
      data === null
        ? []
        : libraryGroups({
            overview: data,
            projects,
            tasks,
            looks,
            view: "library",
            query: "",
            project: "",
            sort: "changed",
          }).map((g) => ({ id: g.facts.id, label: g.facts.label })),
    [data, projects, tasks, looks],
  )
  return { query, groups, counts, deleted, choices }
}

const folderApiFor = (api: Api) =>
  api.projectFolder && api.chooseProjectFolder
    ? {
        projectFolder: api.projectFolder,
        chooseProjectFolder: api.chooseProjectFolder,
        pickProjectFolder: api.pickProjectFolder,
      }
    : undefined

function openRowRoute(row: LibraryRow, go: (route: Route) => void) {
  if (row.kind === "lasting") {
    go({
      view: "artifact",
      project: row.owner,
      file: row.artifact.pages[0]?.file ?? lastingDoc(row.artifact.name, row.artifact.entry),
    })
  } else if (row.kind === "personal") {
    go({ view: "artifact", project: row.owner, file: row.artifact.file })
  }
}

function useLibraryFolds(
  state: LibraryState,
  set: (patch: Partial<LibraryState>) => void,
  groups: LibraryGroup[],
  query: string,
  libraryCount: number,
) {
  const nonEmpty = groups.filter((g) => g.total > 0)
  const many = libraryCount > 24
  const isFolded = (g: LibraryGroup) =>
    query !== ""
      ? state.searchFolded[g.facts.id] === true
      : (state.folded?.[g.facts.id] ?? (many && nonEmpty[0]?.facts.id !== g.facts.id))
  const toggle = (g: LibraryGroup) => {
    if (query !== "") {
      set({ searchFolded: { ...state.searchFolded, [g.facts.id]: !isFolded(g) } })
      return
    }
    const base = Object.fromEntries(nonEmpty.map((x) => [x.facts.id, isFolded(x)]))
    set({ folded: { ...base, [g.facts.id]: !isFolded(g) } })
  }
  const shownKey = (g: LibraryGroup) => `${query !== "" ? "q:" : ""}${state.view}:${g.facts.id}`
  const shown = (g: LibraryGroup) => state.shown[shownKey(g)] ?? LIBRARY_FIRST
  const showMore = (g: LibraryGroup) =>
    set({ shown: { ...state.shown, [shownKey(g)]: shown(g) + LIBRARY_MORE } })
  const setQuery = (next: string) =>
    set({
      query: next,
      pinned: [],
      deletedShown: LIBRARY_FIRST,
      searchFolded: {},
      shown: Object.fromEntries(Object.entries(state.shown).filter(([k]) => !k.startsWith("q:"))),
    })
  return { isFolded, toggle, shown, showMore, setQuery }
}

function LibraryContent({
  data,
  overview,
  groups,
  showEmpty,
  query,
  state,
  set,
  now,
  api,
  choices,
  go,
  open,
  isFolded,
  shown,
  toggle,
  showMore,
  setQuery,
  setMaking,
}: {
  data: ArtifactsOverview | null
  overview: Query<ArtifactsOverview | null>
  groups: LibraryGroup[]
  showEmpty: boolean
  query: string
  state: LibraryState
  set: (patch: Partial<LibraryState>) => void
  now: number
  api: Api
  choices: LibraryProject[]
  go: (route: Route) => void
  open: (row: LibraryRow, location: string) => void
  isFolded: (g: LibraryGroup) => boolean
  shown: (g: LibraryGroup) => number
  toggle: (g: LibraryGroup) => void
  showMore: (g: LibraryGroup) => void
  setQuery: (next: string) => void
  setMaking: (project: string) => void
}) {
  if (data === null)
    return (
      <LoadingState
        kind="library"
        what="Opening Artifacts"
        error={overview.error}
        failedTitle="The Artifacts list didn't open"
        onRetry={overview.reload}
        back={{ label: "Home", onClick: () => go({ view: "home" }) }}
        slowNote={
          <>
            A large library takes a moment. You can keep working:{" "}
            <button type="button" className="q-link" onClick={() => go({ view: "home" })}>
              Home
            </button>
          </>
        }
      />
    )
  if (showEmpty)
    return <LibraryEmptyState query={query} view={state.view} onClearQuery={() => setQuery("")} />
  return (
    <>
      {groups.map((g) => (
        <LibraryGroupSection
          key={g.facts.id}
          group={g}
          folded={isFolded(g)}
          limit={shown(g)}
          query={query}
          state={state}
          set={set}
          now={now}
          api={api}
          choices={choices}
          reload={overview.reload}
          go={go}
          open={open}
          onToggle={() => toggle(g)}
          onShowMore={() => showMore(g)}
          onNew={() => setMaking(g.facts.id)}
        />
      ))}
    </>
  )
}

export function ArtifactsPage({
  api,
  overview,
  projects,
  tasks,
  looks,
  go,
  config,
  installed,
  contextApi,
}: Props) {
  const runs = useOptionalRuns()
  const [state, set] = useLibraryState()
  const savedFavorites = useArtifactFavorites()
  const [making, setMaking] = useState<string | null>(null)
  const body = useRef<HTMLDivElement | null>(null)
  const now = useNow(true, 60_000)
  const data = overview.data
  const { query, groups, counts, deleted, choices } = useLibraryDerived(
    data,
    projects,
    tasks,
    looks,
    state,
  )
  const favorites = useMemo(
    () => favoriteRows(savedFavorites.ids, groups),
    [savedFavorites.ids, groups],
  )
  const { isFolded, toggle, shown, showMore, setQuery } = useLibraryFolds(
    state,
    set,
    groups,
    query,
    counts.library,
  )

  useLayoutEffect(() => {
    const saved = getKeptLibraryState()
    if (body.current && saved.scroll > 0) body.current.scrollTop = saved.scroll
  }, [])
  const focusDone = useRef(false)
  useEffect(() => {
    if (focusDone.current || data === null) return
    focusDone.current = true
    restoreLibraryFocus(body.current)
  }, [data])

  const open = (row: LibraryRow, location: string) => {
    set({ focus: row.key, focusArea: location, scroll: body.current?.scrollTop ?? 0 })
    openRowRoute(row, go)
  }
  const openDeleted = (row: DeletedRow) => {
    set({ focus: `deleted:${row.key}`, scroll: body.current?.scrollTop ?? 0 })
    go({
      view: "artifact",
      project: row.owner,
      file: row.artifact.pages[0]?.file ?? lastingDoc(row.artifact.name, row.artifact.entry),
    })
  }
  const create = async (project: string, request: NewArtifactRequest): Promise<KeepResult> => {
    const made = await api.newArtifact(project, request)
    overview.reload()
    return made
  }
  const openCreated = (project: string, made: KeepResult) => {
    setMaking(null)
    go({ view: "artifact", project, file: lastingDoc(made.name, "index.html") })
  }
  const resultCount = new Set(
    groups.flatMap((group) =>
      group.rows.map((row) => (row.kind === "broken" ? row.key : rowFavoriteKey(row))),
    ),
  ).size
  const showEmpty = groups.length === 0 && !(query !== "" && deleted.length > 0)
  const showFavorites = data !== null && state.view === "library" && favorites.length > 0

  return (
    <main className="ds-page lib" data-testid="artifacts-page" aria-label="Artifacts">
      <LibraryHeader
        hasData={data !== null}
        resultCount={resultCount}
        query={query}
        state={state}
        set={set}
        setQuery={setQuery}
        choices={choices}
        onNew={() => setMaking(state.project)}
      />
      <div
        className="ds-body lib-body"
        data-scroll-root
        ref={body}
        onScroll={(e) => saveLibraryScroll(e.currentTarget.scrollTop)}
      >
        <FavoriteFeedback />
        {showFavorites ? (
          <LibraryFavoritesSection
            favorites={favorites}
            state={state}
            set={set}
            now={now}
            api={api}
            choices={choices}
            reload={overview.reload}
            go={go}
            open={open}
          />
        ) : null}
        <LibraryContent
          data={data}
          overview={overview}
          groups={groups}
          showEmpty={showEmpty}
          query={query}
          state={state}
          set={set}
          now={now}
          api={api}
          choices={choices}
          go={go}
          open={open}
          isFolded={isFolded}
          shown={shown}
          toggle={toggle}
          showMore={showMore}
          setQuery={setQuery}
          setMaking={setMaking}
        />
        {deleted.length > 0 ? (
          <RecentlyDeleted
            rows={deleted}
            open={state.deletedOpen || query !== ""}
            onToggle={() => set({ deletedOpen: !(state.deletedOpen || query !== "") })}
            shown={state.deletedShown}
            onMore={() => set({ deletedShown: state.deletedShown + LIBRARY_MORE })}
            now={now}
            api={api}
            reload={overview.reload}
            onOpen={openDeleted}
          />
        ) : null}
      </div>
      {making !== null ? (
        <NewArtifactDialog
          projects={projects}
          initialProject={making}
          config={config}
          installed={installed}
          contextApi={contextApi}
          folderApi={folderApiFor(api)}
          canChoose={runs?.support?.canConfigure === true}
          onCreate={create}
          onOpen={openCreated}
          onClose={() => setMaking(null)}
        />
      ) : null}
    </main>
  )
}
