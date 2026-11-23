import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type {
  MemoryApi,
  MemoryOverview,
  MemoryPage,
  MemoryPreview,
  MemoryProject,
  MemorySource,
} from "../../memory-contracts.ts"
import { useEventCount } from "../hooks.ts"
import { MemoryBrowser } from "./MemoryBrowser.tsx"
import { type MemoryDialogKind, MemoryDialogs } from "./MemoryDialogs.tsx"
import {
  MemoryImportSection,
  MemorySettingsSection,
  MemorySharingSection,
  runSaveMemorySettings,
  subscribeMemoryList,
  subscribeMemoryOverview,
} from "./MemorySections.tsx"
import { type LessonState, MemoryFailure, useCursorHistory } from "./memory-shared.tsx"

function restoreMemoryFocus(
  focus: HTMLElement | null,
  focusRecord: string | null,
  rows: Map<string, HTMLButtonElement>,
  search: HTMLInputElement | null,
) {
  const current = focus?.isConnected ? focus : focusRecord ? rows.get(focusRecord) : null
  ;(current ?? search)?.focus()
}

export function MemoryTab({
  api,
  initialMemoryProject,
  initialMemoryLesson,
}: {
  api?: MemoryApi
  initialMemoryProject?: { id: string; name: string }
  initialMemoryLesson?: string
}) {
  const memoryRevision = useEventCount("memory")
  const [overview, setOverview] = useState<MemoryOverview | null>(null)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState("")
  const [query, setQuery] = useState("")
  const [project, setProject] = useState<{ id: string; name: string } | null>(
    initialMemoryProject ?? null,
  )
  const [source, setSource] = useState<MemorySource | "all">("all")
  const [lessonState, setLessonState] = useState<LessonState>("active")
  const [changedCount, setChangedCount] = useState<number | null>(null)
  const [cursors, setCursors] = useCursorHistory(memoryRevision)
  const [page, setPage] = useState<MemoryPage<MemoryPreview> | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [reload, setReload] = useState(0)
  const [dialog, setDialog] = useState<MemoryDialogKind>(null)
  const [detailId, setDetailId] = useState("")
  const [importProject, setImportProject] = useState<MemoryProject | null>(null)
  const focus = useRef<HTMLElement | null>(null)
  const [pendingFocus, setPendingFocus] = useState(false)
  const focusRecord = useRef<string | null>(null)
  const rows = useRef(new Map<string, HTMLButtonElement>())
  const search = useRef<HTMLInputElement | null>(null)
  const readScope = useRef<{ api: MemoryApi; key: string } | null>(null)
  const cursor = cursors.at(-1)
  const initialProjectId = initialMemoryProject?.id
  const initialProjectName = initialMemoryProject?.name

  useLayoutEffect(() => {
    if (!pendingFocus || dialog !== null || loading) return
    restoreMemoryFocus(focus.current, focusRecord.current, rows.current, search.current)
    setPendingFocus(false)
  }, [pendingFocus, dialog, loading])

  useEffect(() => {
    setProject(
      initialProjectId
        ? { id: initialProjectId, name: initialProjectName ?? initialProjectId }
        : null,
    )
    setCursors([undefined])
  }, [initialProjectId, initialProjectName, setCursors])

  useEffect(() => {
    if (!initialMemoryLesson) return
    setDetailId(initialMemoryLesson)
    setDialog("detail")
  }, [initialMemoryLesson])

  // biome-ignore lint/correctness/useExhaustiveDependencies: memory events and explicit retries refresh settings
  useEffect(
    () => subscribeMemoryOverview(api, setOverview, setOverviewError),
    [api, reload, memoryRevision],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: memory events and explicit retries reread the current bounded page
  useEffect(
    () =>
      subscribeMemoryList({
        api,
        query,
        projectId: project?.id,
        source,
        lessonState,
        cursor,
        readScope,
        setLoading,
        setListError,
        setPage,
        setChangedCount,
      }),
    [api, query, project?.id, source, lessonState, cursor, reload, memoryRevision],
  )

  const refresh = () => setReload((value) => value + 1)
  const open = (next: MemoryDialogKind, element: HTMLElement, record?: string) => {
    focus.current = element
    focusRecord.current = record ?? null
    setDialog(next)
  }
  const clear = () => {
    setDraft("")
    setQuery("")
    setProject(null)
    setSource("all")
    setLessonState("active")
    setCursors([undefined])
  }
  const filtered = Boolean(query || project || source !== "all" || lessonState !== "active")
  const gone = (overview?.projectIssues ?? []).filter(
    (item) => item.reason === "root-unavailable",
  ).length

  if (!api)
    return (
      <div className="q-memory">
        <MemoryFailure error="Memory is unavailable in this App connection. Your coding tasks can continue." />
      </div>
    )

  return (
    <div className="q-sgs q-memory" data-testid="memory-settings">
      <MemorySettingsSection
        overview={overview}
        overviewError={overviewError}
        saving={saving}
        onSave={(patch) =>
          void runSaveMemorySettings({ api, patch, setSaving, setOverviewError, setOverview })
        }
        onRefresh={refresh}
      />
      <MemorySharingSection
        api={api}
        overview={overview}
        refresh={refresh}
        onManageProjects={(el) => open("projects", el)}
      />
      <MemoryBrowser
        overview={overview}
        draft={draft}
        project={project}
        source={source}
        lessonState={lessonState}
        changedCount={changedCount}
        filtered={filtered}
        loading={loading}
        page={page}
        listError={listError}
        hasPrevious={cursors.length > 1}
        searchRef={search}
        rowsRef={rows}
        onDraft={setDraft}
        onSubmitSearch={() => {
          setQuery(draft.trim())
          setCursors([undefined])
        }}
        onOpenFilter={(el) => open("filter", el)}
        onOpenProjects={(el) => open("projects", el)}
        onSource={(value) => {
          setSource(value)
          setCursors([undefined])
        }}
        onLessonState={(value) => {
          setLessonState(value)
          setCursors([undefined])
        }}
        onClear={clear}
        onRefresh={refresh}
        onRetryList={() => {
          setCursors([undefined])
          refresh()
        }}
        onOpenDetail={(id, el) => {
          setDetailId(id)
          open("detail", el, id)
        }}
        onNextPage={(next) => setCursors((current) => [...current, next])}
        onPreviousPage={() => setCursors((current) => current.slice(0, -1))}
      />
      <MemoryImportSection
        hasRepository={Boolean(api.repository)}
        onOpenImport={(el) => open("import", el)}
      />
      <MemoryDialogs
        dialog={dialog}
        api={api}
        overview={overview}
        gone={gone}
        detailId={detailId}
        importProject={importProject}
        onImportProject={setImportProject}
        refresh={refresh}
        onSelectProject={(picked) => {
          setProject(picked)
          setCursors([undefined])
          setDialog(null)
        }}
        onViewImported={() => {
          setSource("pilot")
          setProject(null)
          setDraft("")
          setQuery("")
          setLessonState("active")
          setCursors([undefined])
          refresh()
          setDialog(null)
        }}
        onClose={() => setDialog(null)}
        onFinalFocus={() => setPendingFocus(true)}
      />
    </div>
  )
}
