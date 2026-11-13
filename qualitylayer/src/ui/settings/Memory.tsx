import {
  BookCheckIcon,
  BrainIcon,
  ChevronRightIcon,
  GitBranchIcon,
  HistoryIcon,
  ImportIcon,
  LayersIcon,
  type LucideIcon,
  MonitorIcon,
  PinIcon,
  PlayIcon,
  SearchIcon,
  UserRoundIcon,
} from "lucide-react"
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  ANSWER_TAG,
  type MemoryApi,
  type MemoryImportResult,
  type MemoryOverview,
  type MemoryPage,
  type MemoryPreview,
  type MemoryProject,
  type MemoryQuery,
  type MemoryRecordView,
  type MemoryRetired,
  type MemoryRetiredBy,
  type MemorySettings,
  type MemorySource,
  PERSONAL_PROJECT,
} from "../../memory-contracts.ts"
import { useEventCount } from "../hooks.ts"
import { ModelPick } from "../ModelPick.tsx"
import { useProjectLooks } from "../sidebar/look-context.tsx"
import { ProjectTile } from "../sidebar/ProjectTile.tsx"
import { projectFacts } from "../sidebar/project-model.ts"
import { pilotFile } from "./memory-import/files.ts"
import { PilotMigration } from "./memory-import/PilotMigration.tsx"
import { SettingRow, SettingsGroup, SettingsMore } from "./Rows.tsx"

/** The projects dialog pages by this many projects. */
const PAGE_SIZE = 20
/** A search or a filter pages the saved lessons by this many. */
const LESSONS_PAGE = 10
const RECENT_SIZE = 4
/** What the person's own lessons are called wherever a project is named (App Model: settings-memory). */
const YOURS = "Yours · every project"
/** The most lessons one project pins; the service refuses a sixth. */
const MAX_PINS = 5
/** What a link to a retired or missing lesson shows in place of its dialog. */
const NO_LONGER_SAVED = "This lesson is no longer saved"
function useCursorHistory(revision: number) {
  const [seen, setSeen] = useState(revision)
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  if (seen !== revision) {
    setSeen(revision)
    setCursors([undefined])
  }
  return [cursors, setCursors] as const
}
const SOURCES: { id: MemorySource | "all"; name: string }[] = [
  { id: "all", name: "All sources" },
  { id: "task", name: "QualityLayer tasks" },
  { id: "session", name: "From a session" },
  { id: "repository", name: "From repository" },
  { id: "pilot", name: "Imported from Pilot" },
  { id: "manual", name: "Private notes" },
]
/** The list shows active lessons newest first; retired ones only under Retired (App Model: settings-memory). */
type LessonState = "active" | "changed" | "retired"
const sourceName = (source: MemorySource) =>
  SOURCES.find((item) => item.id === source)?.name ?? source
/**
 * Where a lesson lives (App Model: settings-memory): in Git for the team once its repository shares,
 * a private one that never leaves this computer, or its project's, kept here until the repository shares.
 * A lesson about the person applies in every project, and their own answer in a task stays on this computer.
 */
type Scoped = Pick<MemoryPreview, "shared" | "visibility" | "project" | "tags">
const isAnswer = (memory: Pick<Scoped, "visibility" | "tags">) =>
  memory.visibility === "private" && memory.tags.includes(ANSWER_TAG)
function scopeOf(memory: Scoped): {
  label: string
  Icon: LucideIcon
} {
  if (memory.project === PERSONAL_PROJECT) return { label: YOURS, Icon: UserRoundIcon }
  if (isAnswer(memory)) return { label: "Your answer · this computer only", Icon: MonitorIcon }
  if (memory.shared === true) return { label: "Shared in Git", Icon: GitBranchIcon }
  if (memory.visibility === "private") return { label: "This computer only", Icon: MonitorIcon }
  return { label: "This project", Icon: BookCheckIcon }
}

/** Who retired a lesson, as its row says it (App Model: settings-memory). */
const retiredLabel = (by: MemoryRetiredBy | undefined) =>
  by === "qualitylayer" ? "Retired by itself" : by === "review" ? "Retired at Verify" : "Retired"
/** Why it was retired, as its dialog says it. */
const retiredLine = (retired: MemoryRetired) =>
  retired.by === "qualitylayer"
    ? `retired by itself: ${retired.reason}`
    : `${retired.by === "review" ? "retired at Verify" : "retired"}${retired.reason ? `: ${retired.reason}` : ""}`
/** The decision a lesson rests on: its last line, `Rests on: …`, when it has one. */
const restsOn = (content: string) => {
  const tail = content.trimEnd()
  const from = tail.lastIndexOf("\nRests on: ")
  if (from < 0) return null
  const reason = tail.slice(from + "\nRests on: ".length)
  return reason && !reason.includes("\n") ? reason.trim() : null
}
/** An answer's body is the decision alone: its title already is the question. */
const DECIDED = "Decided with you:"
const decision = (content: string) => {
  const from = content.indexOf(DECIDED)
  return from < 0 ? content : content.slice(from)
}
const day = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
const shortCommit = (commit: string) => commit.slice(0, 7)

const message = (error: unknown) =>
  error instanceof Error ? error.message : "The request did not finish. Try again."
const count = (value: number, noun: string) =>
  `${value.toLocaleString()} ${value === 1 ? noun : noun === "memory" ? "memories" : `${noun}s`}`
/**
 * The projects the person can do something about here. One whose folder is gone from this computer
 * is not among them: nothing in Settings brings a folder back (Max, 10 November 2026).
 */
const toCheck = (
  overview: { projectIssues?: { id: string; name: string; reason: string }[] } | null | undefined,
) => (overview?.projectIssues ?? []).filter((project) => project.reason !== "root-unavailable")

/** A saved lesson as one line of the list: its scope mark, its title, where it lives in words, a mark when pinned, a chevron. */
function MemoryRow({
  memory,
  rows,
  onOpen,
}: {
  memory: MemoryPreview
  rows: Map<string, HTMLButtonElement>
  onOpen: (element: HTMLElement) => void
}) {
  const retired = memory.state === "retired"
  const { label, Icon } = scopeOf(memory)
  return (
    <button
      type="button"
      className="q-memory-item"
      data-memory-id={memory.id}
      ref={(node) => {
        if (node) rows.set(memory.id, node)
        else rows.delete(memory.id)
      }}
      title={label}
      onClick={(event) => onOpen(event.currentTarget)}
    >
      <Icon className="q-memory-scope-i" aria-hidden="true" />
      <span className="q-memory-item-title" data-retired={retired}>
        {memory.title}
      </span>
      {retired ? (
        <span className="q-memory-item-retired">{retiredLabel(memory.retired?.by)}</span>
      ) : null}
      {!retired && memory.sources?.state === "changed" ? (
        <span className="q-memory-item-changed" title="Its files changed since it was checked">
          <HistoryIcon aria-hidden="true" />
          <span className="q-memory-item-changed-long">Sources changed</span>
          <span className="q-memory-item-changed-short" aria-hidden="true">
            Changed
          </span>
        </span>
      ) : null}
      {/* The scope is the leading icon; its words stay for a screen reader and the tooltip. */}
      <span className="q-memory-item-meta sr-only">{label}</span>
      {memory.pinned ? <PinIcon className="q-memory-item-pin" aria-label="Pinned" /> : null}
      <ChevronRightIcon className="q-memory-item-chev" aria-hidden="true" />
    </button>
  )
}

function Failure({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="q-memory-failure" role="alert">
      <span>{error}</span>
      {retry ? (
        <Button type="button" variant="outline" onClick={retry}>
          Retry
        </Button>
      ) : null}
    </div>
  )
}

function Pages({
  next,
  previous,
  busy,
  total,
  onNext,
  onPrevious,
}: {
  next: boolean
  previous: boolean
  busy: boolean
  total: number
  onNext: () => void
  onPrevious: () => void
}) {
  return (
    <nav className="q-memory-pages" aria-label="Results pages">
      <span>{count(total, "result")}</span>
      <Button type="button" variant="outline" disabled={!previous || busy} onClick={onPrevious}>
        Previous
      </Button>
      <Button type="button" variant="outline" disabled={!next || busy} onClick={onNext}>
        Next
      </Button>
    </nav>
  )
}

/**
 * Choose a project (`choose`), or manage which projects share their lessons through Git. The person's
 * own lessons are never a project here: choosing has its own button for them, and managing shows them
 * first with no switch, because they never share.
 */
function ProjectManager({
  api,
  choose,
  changed,
  shared,
  onDone,
  filters,
}: {
  api: MemoryApi
  choose?: (project: MemoryProject) => void
  changed: () => void
  /** How many projects share, as the overview counts them; the list counts them itself when it has them all. */
  shared?: MemoryOverview["sharedProjects"]
  /** Managing ends with one Done button. */
  onDone?: () => void
  /** Choosing a lesson filter also offers every project, and the person's own lessons. */
  filters?: { all: () => void; yours: () => void; total: number | undefined }
}) {
  const memoryRevision = useEventCount("memory")
  const looks = useProjectLooks()
  // Choosing a project for an import has no row for the person's own lessons; managing and choosing a filter do.
  const hasYours = !choose || filters !== undefined
  const [yours, setYours] = useState<number | null>(null)
  const [draft, setDraft] = useState("")
  const [query, setQuery] = useState("")
  const [cursors, setCursors] = useCursorHistory(memoryRevision)
  const [page, setPage] = useState<MemoryPage<MemoryProject> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [consent, setConsent] = useState<MemoryProject | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [showEmpty, setShowEmpty] = useState(false)
  const cursor = cursors.at(-1)
  const readScope = useRef<{ api: MemoryApi; key: string } | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: memory events and explicit retries reread the current bounded page
  useEffect(() => {
    let live = true
    setBusy(true)
    setError(null)
    const key = JSON.stringify([query, cursor])
    if (readScope.current?.api !== api || readScope.current.key !== key) setPage(null)
    readScope.current = { api, key }
    api
      .projects({ query: query || undefined, cursor, limit: PAGE_SIZE })
      .then((result) => {
        if (live) setPage(result)
      })
      .catch((reason) => {
        if (live) {
          setPage(null)
          setError(message(reason))
        }
      })
      .finally(() => {
        if (live) setBusy(false)
      })
    return () => {
      live = false
    }
  }, [api, query, cursor, reload, memoryRevision])
  // The person's own lessons are counted by themselves: their project can sit on any page of the list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a memory event rereads the count
  useEffect(() => {
    if (!hasYours) return
    let live = true
    api
      .list({ project: PERSONAL_PROJECT, limit: 1 })
      .then((result) => {
        if (live) setYours(result.total)
      })
      // Their project is made when the first lesson is saved; until then there are none.
      .catch(() => {
        if (live) setYours(0)
      })
    return () => {
      live = false
    }
  }, [api, hasYours, memoryRevision])
  const share = async (project: MemoryProject, enabled: boolean) => {
    setSaving(project.id)
    setError(null)
    try {
      const updated = await api.sharing(project.id, enabled)
      setPage((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => (item.id === updated.id ? updated : item)),
            }
          : current,
      )
      setConsent(null)
      changed()
    } catch (reason) {
      setError(message(reason))
    } finally {
      setSaving(null)
    }
  }
  if (consent)
    return (
      <div className="q-memory-consent">
        <h3>Share lessons in {consent.name}?</h3>
        <p>
          Every project lesson goes to Git after the privacy filter, in your next normal commit.
          Anyone who can read this repository can read its shared lessons. Public repositories make
          them public.
        </p>
        <p>Your private notes and imported Pilot memories stay on this computer.</p>
        {error ? <Failure error={error} /> : null}
        <div className="q-memory-actions">
          <Button
            type="button"
            variant="outline"
            disabled={saving !== null}
            autoFocus
            onClick={() => {
              setConsent(null)
              setError(null)
            }}
          >
            Keep private
          </Button>
          <Button
            type="button"
            disabled={saving !== null}
            onClick={() => void share(consent, true)}
          >
            {saving ? "Enabling…" : "Enable sharing"}
          </Button>
        </div>
      </div>
    )
  const everyListed = page?.items.filter((project) => project.id !== PERSONAL_PROJECT) ?? []
  // Projects with no lessons are folded behind one line, except where one is chosen to import into.
  const foldEmpty = !choose || filters !== undefined
  const unused = foldEmpty ? everyListed.filter((project) => project.count === 0).length : 0
  const items = unused > 0 && !showEmpty ? everyListed.filter((p) => p.count > 0) : everyListed
  const noProjects = query
    ? "No projects match this search."
    : "Projects appear here after a QualityLayer task uses them."
  // "N of M shared": counted from the list when it holds every project, else as the overview counts them.
  const everyProject = page !== null && !query && page.next === null && cursors.length === 1
  const counted = everyProject
    ? {
        shared: everyListed.filter((project) => project.sharing).length,
        total: everyListed.length,
      }
    : shared
  const sharedEnd = counted
    ? `${counted.shared} of ${counted.total} sharing through Git`
    : undefined
  return (
    <div className="q-memory-manager">
      <form
        className="q-memory-search"
        onSubmit={(event) => {
          event.preventDefault()
          setQuery(draft.trim())
          setCursors([undefined])
        }}
      >
        <div className="q-memory-find">
          <SearchIcon size={14} aria-hidden="true" />
          <Input
            type="search"
            className="pl-8"
            aria-label="Search projects"
            placeholder="Search projects"
            value={draft}
            maxLength={256}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
      </form>
      {error ? (
        <Failure
          error={error}
          retry={() => {
            setCursors([undefined])
            setReload((value) => value + 1)
          }}
        />
      ) : null}
      <div aria-busy={busy}>
        {busy && !page ? (
          <p role="status" className="q-memory-note">
            Loading projects…
          </p>
        ) : page ? (
          // One group of rows, as Settings draws them: the person's own lessons and, when choosing, every
          // project first, then each project with its tile. Managing ends each row in a switch, choosing in Select.
          <SettingsGroup title="Projects" end={choose ? undefined : sharedEnd}>
            {query || !hasYours ? null : (
              <>
                {filters ? (
                  <SettingRow
                    icon={<LayersIcon className="size-[15px]" />}
                    label="All projects"
                    hint={filters.total === undefined ? undefined : count(filters.total, "lesson")}
                  >
                    <Button type="button" variant="outline" onClick={filters.all}>
                      Select<span className="sr-only"> All projects</span>
                    </Button>
                  </SettingRow>
                ) : null}
                <SettingRow
                  icon={<UserRoundIcon className="size-[15px]" />}
                  label={YOURS}
                  hint={`${yours === null ? "Lessons" : count(yours, "lesson")} · every repository`}
                  stay={!choose}
                >
                  {filters ? (
                    <Button type="button" variant="outline" onClick={filters.yours}>
                      Select<span className="sr-only"> {YOURS}</span>
                    </Button>
                  ) : choose ? null : (
                    <span className="q-memory-never">Never shared</span>
                  )}
                </SettingRow>
              </>
            )}
            {items.map((project) => {
              const facts = projectFacts({ id: project.id, name: project.name }, looks)
              return (
                <SettingRow
                  key={project.id}
                  label={
                    <>
                      <ProjectTile
                        letters={facts.letters}
                        color={facts.color}
                        size="row"
                        className="q-memory-tile"
                      />
                      {project.name}
                    </>
                  }
                  hint={`${count(project.count, "lesson")}${project.sharing ? " · Shared in Git" : ""}${
                    !project.git ? " · No Git repository" : ""
                  }`}
                  stay={!choose}
                >
                  {choose ? (
                    <Button type="button" variant="outline" onClick={() => choose(project)}>
                      Select<span className="sr-only"> {project.name}</span>
                    </Button>
                  ) : (
                    <Switch
                      aria-label={`Share project lessons for ${project.name}`}
                      checked={project.sharing}
                      disabled={!project.git || saving !== null}
                      onCheckedChange={(enabled) => {
                        if (enabled) {
                          setError(null)
                          setConsent(project)
                        } else void share(project, false)
                      }}
                    />
                  )}
                </SettingRow>
              )
            })}
            {unused > 0 ? (
              <div className="q-sr stay q-memory-unused" data-testid="memory-unused-projects">
                <span className="q-sr-l">
                  {showEmpty
                    ? `${unused} ${unused === 1 ? "project has" : "projects have"} no lessons`
                    : `${unused} ${unused === 1 ? "project has" : "projects have"} no lessons yet`}
                </span>
                <button type="button" className="q-link" onClick={() => setShowEmpty(!showEmpty)}>
                  {showEmpty ? "Hide" : "Show"}
                </button>
              </div>
            ) : null}
            {items.length === 0 ? <p className="q-memory-note">{noProjects}</p> : null}
          </SettingsGroup>
        ) : null}
      </div>
      {page ? (
        <Pages
          next={page.next !== null}
          previous={cursors.length > 1}
          busy={busy}
          total={page.total}
          onNext={() => {
            if (page.next) setCursors((current) => [...current, page.next ?? undefined])
          }}
          onPrevious={() => setCursors((current) => current.slice(0, -1))}
        />
      ) : null}
      {onDone ? (
        <div className="q-memory-actions">
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function MemoryDetail({ api, id, changed }: { api: MemoryApi; id: string; changed: () => void }) {
  const [record, setRecord] = useState<MemoryRecordView | null>(null)
  // The project's other pinned lessons: five are the most a project holds.
  const [others, setOthers] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const title = useRef<HTMLHeadingElement | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload retries a failed full read
  useEffect(() => {
    let live = true
    setRecord(null)
    setOthers(null)
    setError(null)
    api
      .read(id)
      .then(async (result) => {
        const pins = await api.pinned(result.project).catch(() => null)
        if (!live) return
        setRecord(result)
        setOthers(pins ? pins.filter((lesson) => lesson.id !== id).length : null)
      })
      .catch((reason) => {
        if (live) setError(/not found/i.test(message(reason)) ? NO_LONGER_SAVED : message(reason))
      })
    return () => {
      live = false
    }
  }, [api, id, reload])
  const active = async (enabled: boolean) => {
    setBusy(true)
    setError(null)
    try {
      // Retiring a lesson unpins it.
      const updated = await api.retire(id, enabled)
      setRecord((before) => ({ ...updated, pinned: false, shared: before?.shared }))
      changed()
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(false)
    }
  }
  const pin = async (pinned: boolean) => {
    setBusy(true)
    setError(null)
    try {
      setRecord(await api.pin(id, pinned))
      changed()
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(false)
    }
  }
  // Still true: the person knows the lesson holds; its check point moves to the current commit.
  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const updated = await api.confirm(id)
      setRecord((before) => ({
        ...updated,
        pinned: before?.pinned,
        shared: before?.shared,
        sources: { state: "unchanged" },
      }))
      // Still true leaves with its group; focus stays in the dialog, on its title.
      title.current?.focus()
      changed()
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(false)
    }
  }
  const pinned = record?.pinned === true
  const full = !pinned && others !== null && others >= MAX_PINS
  const rests = record ? restsOn(record.content) : null
  // A lesson about the person has no project, task, files or commit to check: it applies everywhere.
  const personal = record?.project === PERSONAL_PROJECT
  const answer = record !== null && isAnswer(record)
  const sources = record?.state === "active" && !personal ? record.sources : undefined
  return (
    <>
      <DialogTitle ref={title} tabIndex={-1} className="outline-none">
        {record?.title ?? "Memory details"}
      </DialogTitle>
      <DialogDescription>
        {record
          ? `${sourceName(record.source)} · ${scopeOf(record).label}${
              record.state === "retired" && record.retired
                ? ` · ${retiredLine(record.retired)}`
                : ""
            }`
          : "Read the saved lesson and its source."}
      </DialogDescription>
      {error ? (
        <Failure
          error={error}
          retry={
            !record && error !== NO_LONGER_SAVED ? () => setReload((value) => value + 1) : undefined
          }
        />
      ) : null}
      {record ? (
        <>
          <p className="q-memory-content">{answer ? decision(record.content) : record.content}</p>
          {answer ? (
            <p className="q-memory-aside">
              Your answer in a task. It stays on this computer. Agents find it when they search; it
              isn't offered at the start of a session.
            </p>
          ) : null}
          {personal ? (
            <p className="q-memory-aside">
              In every repository, never in Git · saved {day(record.createdAt)}
            </p>
          ) : (
            <dl className="q-memory-provenance">
              <dt>Project</dt>
              <dd>{record.project}</dd>
              {record.author ? (
                <>
                  <dt>Author</dt>
                  <dd>{record.author}</dd>
                </>
              ) : null}
              {record.sourceAt ? (
                <>
                  <dt>Original date</dt>
                  <dd>{record.sourceAt}</dd>
                </>
              ) : null}
              {record.evidence ? (
                <>
                  <dt>Task</dt>
                  <dd>{record.evidence.task}</dd>
                  <dt>Checks</dt>
                  <dd>
                    {record.evidence.checks.length
                      ? record.evidence.checks.join(", ")
                      : "No recorded checks"}
                  </dd>
                  {record.evidence.commit ? (
                    <>
                      <dt>Commit</dt>
                      <dd>{record.evidence.commit}</dd>
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  <dt>Evidence</dt>
                  <dd>Historical lesson; check against the current project.</dd>
                </>
              )}
              <dt>Rests on</dt>
              <dd>{rests ?? "No decision named"}</dd>
              <dt>Files</dt>
              <dd className="q-memory-files">
                {record.files.length
                  ? record.files.map((file) => <code key={file}>{file}</code>)
                  : "None recorded, so changes to its files cannot be tracked"}
              </dd>
              {/* With no commit the lesson says when it was saved, not when it was checked. */}
              {record.checked ? (
                <>
                  <dt>Checked at</dt>
                  <dd>
                    {shortCommit(record.checked.commit)} · {day(record.checked.at)}
                  </dd>
                </>
              ) : (
                <>
                  <dt>Saved</dt>
                  <dd>{day(record.createdAt)}</dd>
                </>
              )}
              {sources?.state === "unchecked" && sources.reason ? (
                <>
                  <dt>Sources</dt>
                  <dd>Not checked: {sources.reason}</dd>
                </>
              ) : null}
            </dl>
          )}
          {sources?.state === "changed" ? (
            <SettingsGroup title="Since it was checked">
              <SettingRow
                label={`${count(sources.commits ?? 1, "commit")} changed its files`}
                hint={`${
                  sources.latest
                    ? `Latest: ${sources.latest.subject} · ${day(sources.latest.at)}. `
                    : ""
                }The next task that changes these files rewrites, retires or confirms it at Verify. If no task checks it within 90 days, it retires itself. Nothing for you to do; Still true is there if you already know.`}
              >
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void confirm()}
                >
                  Still true
                </Button>
              </SettingRow>
            </SettingsGroup>
          ) : null}
          <SettingsGroup title="In your sessions">
            {record.state === "active" && !answer ? (
              <SettingRow
                icon={<PinIcon className="size-[15px]" />}
                label="Pin to every session"
                hint={
                  full
                    ? personal
                      ? `${MAX_PINS} of yours are pinned. Unpin one first.`
                      : `${MAX_PINS} are pinned here. Unpin one first.`
                    : `First in every session. Up to ${MAX_PINS} ${personal ? "of yours" : "per project"}.`
                }
                stay
              >
                <Switch
                  aria-label="Pin to every session"
                  checked={pinned}
                  disabled={busy || full}
                  onCheckedChange={(next) => void pin(next)}
                />
              </SettingRow>
            ) : null}
            <SettingRow
              icon={<BookCheckIcon className="size-[15px]" />}
              label="Use in future tasks"
              hint="Offered when it matches a task."
              stay
            >
              <Switch
                aria-label="Use in future tasks"
                checked={record.state === "active"}
                disabled={busy}
                onCheckedChange={(enabled) => void active(enabled)}
              />
            </SettingRow>
          </SettingsGroup>
        </>
      ) : !error ? (
        <p role="status">Loading memory…</p>
      ) : null}
    </>
  )
}

function PilotImport({
  api,
  project,
  onProject,
  completed,
}: {
  api: MemoryApi
  project: MemoryProject | null
  onProject: (project: MemoryProject) => void
  completed: () => void
}) {
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MemoryImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const fileId = useId()
  const importFiles = async () => {
    if (!project || !files.length || busy) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      if (files.length > 100 || files.reduce((sum, file) => sum + file.size, 0) > 2 * 1024 * 1024)
        throw new Error("Choose up to 100 files, at most 2 MB in total.")
      if (files.some((file) => !/\.(jsonl|md)$/i.test(file.name)))
        throw new Error("Choose Pilot .jsonl or .md memory files.")
      const input = await Promise.all(files.map(pilotFile))
      setResult(await api.importPilot({ project: project.id, files: input }))
      completed()
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(false)
    }
  }
  if (choosing)
    return (
      <>
        <DialogTitle>Choose import project</DialogTitle>
        <DialogDescription>Search the project these Pilot files belong to.</DialogDescription>
        <ProjectManager
          api={api}
          changed={completed}
          choose={(picked) => {
            onProject(picked)
            setChoosing(false)
            setResult(null)
          }}
        />
        <Button type="button" variant="outline" onClick={() => setChoosing(false)}>
          Back to import
        </Button>
      </>
    )
  return (
    <>
      <DialogTitle>Import from Pilot Shell</DialogTitle>
      <DialogDescription>
        Select Pilot memory files for one project. Imported lessons stay private and need checking
        before they can be shared.
      </DialogDescription>
      <Button type="button" variant="outline" disabled={busy} onClick={() => setChoosing(true)}>
        {project ? `Project: ${project.name}` : "Choose project"}
      </Button>
      <label className="q-memory-file" htmlFor={fileId}>
        Memory files
        <Input
          id={fileId}
          type="file"
          accept=".jsonl,.md"
          multiple
          disabled={busy}
          onChange={(event) => {
            setFiles(Array.from(event.target.files ?? []))
            setResult(null)
            setError(null)
          }}
        />
      </label>
      {error ? <Failure error={error} /> : null}
      {result ? (
        <div role="status" className="q-memory-receipt">
          <p>
            {result.imported} imported · {result.updated} updated · {result.skipped} skipped
          </p>
          {result.issues.length ? (
            <ul>
              {[...new Set(result.issues)].map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="q-memory-actions">
        <Button
          type="button"
          disabled={!project || !files.length || busy}
          onClick={() => void importFiles()}
        >
          {busy ? "Importing…" : "Import memories"}
        </Button>
      </div>
    </>
  )
}

export function MemoryTab({
  api,
  initialMemoryProject,
  initialMemoryLesson,
}: {
  api?: MemoryApi
  initialMemoryProject?: { id: string; name: string }
  /** A lesson to open as a dialog, from a link in a task's Memory record. */
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
  // Lessons whose files changed since they were checked, and how many there are for these filters.
  const [lessonState, setLessonState] = useState<LessonState>("active")
  const [changedCount, setChangedCount] = useState<number | null>(null)
  const [cursors, setCursors] = useCursorHistory(memoryRevision)
  const [page, setPage] = useState<MemoryPage<MemoryPreview> | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [reload, setReload] = useState(0)
  const [dialog, setDialog] = useState<"projects" | "filter" | "detail" | "import" | null>(null)
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
    const current = focus.current?.isConnected
      ? focus.current
      : focusRecord.current
        ? rows.current.get(focusRecord.current)
        : null
    ;(current ?? search.current)?.focus()
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
  useEffect(() => {
    if (!api) return
    let live = true
    setOverviewError(null)
    api
      .overview()
      .then((result) => {
        if (live) setOverview(result)
      })
      .catch((reason) => {
        if (live) setOverviewError(message(reason))
      })
    return () => {
      live = false
    }
  }, [api, reload, memoryRevision])
  // biome-ignore lint/correctness/useExhaustiveDependencies: memory events and explicit retries reread the current bounded page
  useEffect(() => {
    if (!api) return
    let live = true
    setLoading(true)
    setListError(null)
    const key = JSON.stringify([query, project?.id, source, lessonState, cursor])
    if (readScope.current?.api !== api || readScope.current.key !== key) setPage(null)
    readScope.current = { api, key }
    const filter: MemoryQuery = {
      query: query || undefined,
      project: project?.id,
      source,
      cursor,
      // The four newest, or a search or a filter in pages (App Model: settings-memory).
      limit:
        query || project || source !== "all" || lessonState !== "active"
          ? LESSONS_PAGE
          : RECENT_SIZE,
      // Active lessons, newest first, unless the person asks for the retired ones.
      state: lessonState === "retired" ? ("retired" as const) : ("active" as const),
      ...(lessonState === "changed" ? { sources: "changed" as const } : {}),
    }
    api
      .list(filter)
      .then((result) => {
        if (!live) return
        setPage(result)
        // A list says how many of its lessons' files changed; a ranked search keeps the last count.
        if (result.changed !== undefined) setChangedCount(result.changed)
      })
      .catch((reason) => {
        if (live) {
          setPage(null)
          setListError(message(reason))
        }
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [api, query, project?.id, source, lessonState, cursor, reload, memoryRevision])
  const refresh = () => setReload((value) => value + 1)
  const open = (next: typeof dialog, element: HTMLElement, record?: string) => {
    focus.current = element
    focusRecord.current = record ?? null
    setDialog(next)
  }
  const save = async (patch: Partial<MemorySettings>) => {
    if (!api) return
    setSaving(true)
    setOverviewError(null)
    try {
      const settings = await api.settings(patch)
      setOverview((current) =>
        current ? { ...current, enabled: settings.enabled, sessions: settings.sessions } : current,
      )
    } catch (reason) {
      setOverviewError(message(reason))
    } finally {
      setSaving(false)
    }
  }
  const clear = () => {
    setDraft("")
    setQuery("")
    setProject(null)
    setSource("all")
    setLessonState("active")
    setCursors([undefined])
  }
  const filtered = query || project || source !== "all" || lessonState !== "active"
  // Projects whose folder was deleted are not an error: the project filter says how many, quietly.
  const gone = (overview?.projectIssues ?? []).filter(
    (item) => item.reason === "root-unavailable",
  ).length
  if (!api)
    return (
      <div className="q-memory">
        <Failure error="Memory is unavailable in this App connection. Your coding tasks can continue." />
      </div>
    )
  return (
    <div className="q-sgs q-memory" data-testid="memory-settings">
      <SettingsGroup title="Local memory" end={overview?.enabled ? "All recommended" : undefined}>
        <SettingRow
          icon={<BrainIcon className="size-[15px]" />}
          label="Remember useful lessons"
          hint="Agents save what they learn in tasks and sessions."
          stay
        >
          <Switch
            aria-label="Remember useful lessons"
            checked={overview?.enabled ?? true}
            disabled={!overview || saving}
            onCheckedChange={(enabled) => void save({ enabled })}
          />
        </SettingRow>
        <SettingRow
          icon={<PlayIcon className="size-[15px]" />}
          label="Lessons in every session"
          hint="Agents start with relevant lessons, yours included."
          stay
        >
          <Switch
            aria-label="Lessons in every session"
            checked={overview?.sessions ?? true}
            disabled={!overview || saving}
            onCheckedChange={(sessions) => void save({ sessions })}
          />
        </SettingRow>
        {overviewError ? (
          <Failure error={overviewError} retry={refresh} />
        ) : !overview ? (
          <p className="q-memory-note" role="status">
            Loading memory settings…
          </p>
        ) : null}
        {overview && !overview.enabled ? (
          <p role="status" className="q-memory-note">
            Paused. QualityLayer stops saving and using lessons. Your stored memories stay here.
          </p>
        ) : null}
      </SettingsGroup>
      <SettingsGroup
        title="Share project lessons"
        end={
          overview
            ? overview.sharedProjects
              ? `${overview.sharedProjects.shared} of ${overview.sharedProjects.total} projects sharing through Git`
              : count(overview.projects, "project")
            : undefined
        }
      >
        <SettingRow
          icon={<GitBranchIcon className="size-[15px]" />}
          label="Share through Git"
          hint="A shared project's lessons go into your next commit. Lessons about you and your answers stay here."
        >
          <Button
            type="button"
            variant="outline"
            onClick={(event) => open("projects", event.currentTarget)}
          >
            Manage projects
          </Button>
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup
        title="Saved memories"
        end={
          overview
            ? `${overview.total.toLocaleString()} saved · ${overview.shared.toLocaleString()} shared through Git${overview.imported > 0 ? ` · ${overview.imported.toLocaleString()} from Pilot` : ""}`
            : undefined
        }
      >
        <div className="q-memory-browser">
          <div className="q-memory-tools">
            <form
              className="q-memory-search"
              onSubmit={(event) => {
                event.preventDefault()
                setQuery(draft.trim())
                setCursors([undefined])
              }}
            >
              <div className="q-memory-find">
                <SearchIcon size={14} aria-hidden="true" />
                <Input
                  ref={search}
                  type="search"
                  className="pl-8"
                  aria-label="Search saved memories"
                  placeholder="Search lessons"
                  value={draft}
                  maxLength={256}
                  onChange={(event) => setDraft(event.target.value)}
                />
              </div>
            </form>
            <div className="q-memory-filters">
              <Button
                type="button"
                variant="outline"
                aria-label={`Memory project: ${project?.name ?? "All projects"}`}
                onClick={(event) => open("filter", event.currentTarget)}
              >
                {project?.name ?? "All projects"}
              </Button>
              <ModelPick
                label="Memory source"
                look="setting"
                value={source}
                options={SOURCES}
                onChange={(value) => {
                  setSource(value as MemorySource | "all")
                  setCursors([undefined])
                }}
              />
              {overview?.total || lessonState !== "active" ? (
                <ModelPick
                  label="Lesson state"
                  look="setting"
                  value={lessonState}
                  options={[
                    { id: "active", name: "Active lessons" },
                    {
                      id: "changed",
                      name: `Sources changed${changedCount === null ? "" : ` · ${changedCount}`}`,
                    },
                    { id: "retired", name: "Retired" },
                  ]}
                  onChange={(value) => {
                    setLessonState(value === "changed" || value === "retired" ? value : "active")
                    setCursors([undefined])
                  }}
                />
              ) : null}
              {filtered ? (
                <Button type="button" variant="ghost" onClick={clear}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          </div>
          {overview?.available && toCheck(overview).length ? (
            <div className="q-memory-notice" role="status">
              <span>
                {count(toCheck(overview).length, "project")} need
                {toCheck(overview).length === 1 ? "s" : ""} attention. Saved lessons are still
                available.
              </span>
              <Button
                type="button"
                variant="outline"
                onClick={(event) => open("projects", event.currentTarget)}
              >
                View projects
              </Button>
            </div>
          ) : overview && (overview.issue || !overview.available) ? (
            <Failure
              error={
                overview.issue ??
                "Memory is temporarily unavailable. Your task can continue; retry to load saved lessons."
              }
              retry={refresh}
            />
          ) : null}
          {listError ? (
            <Failure
              error={listError}
              retry={() => {
                setCursors([undefined])
                refresh()
              }}
            />
          ) : null}
          <div className="q-memory-list" aria-busy={loading}>
            {loading && !page ? (
              <p role="status" className="q-memory-note">
                Loading saved memories…
              </p>
            ) : page?.items.length && !listError ? (
              page.items.map((memory) => (
                <MemoryRow
                  key={memory.id}
                  memory={memory}
                  rows={rows.current}
                  onOpen={(element) => {
                    setDetailId(memory.id)
                    open("detail", element, memory.id)
                  }}
                />
              ))
            ) : page && !listError ? (
              <div className="q-memory-empty">
                <h3>
                  {lessonState === "changed"
                    ? "No lesson marked changed"
                    : lessonState === "retired"
                      ? "No retired lessons"
                      : filtered
                        ? "No memories match these filters"
                        : "No saved memories yet"}
                </h3>
                <p>
                  {lessonState === "changed"
                    ? "No lesson matching these filters has files that changed since it was checked. A lesson with no files recorded, or one Git could not check, is never marked."
                    : lessonState === "retired"
                      ? "A lesson you or QualityLayer retire shows here, and can be restored."
                      : filtered
                        ? "Try a file name or a few words from the decision."
                        : "Useful lessons from QualityLayer tasks will appear here. You can also import Pilot Shell memories."}
                </p>
                {filtered ? (
                  <Button type="button" variant="outline" onClick={clear}>
                    Clear filters
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          {page && filtered ? (
            <Pages
              next={page.next !== null}
              previous={cursors.length > 1}
              busy={loading}
              total={page.total}
              onNext={() => {
                if (page.next) setCursors((current) => [...current, page.next ?? undefined])
              }}
              onPrevious={() => setCursors((current) => current.slice(0, -1))}
            />
          ) : page && !listError && page.items.length ? (
            <p className="q-memory-note">Search to find more.</p>
          ) : null}
        </div>
      </SettingsGroup>
      <SettingsGroup title="Import">
        <SettingRow
          label="Memories from Pilot Shell"
          icon={<ImportIcon className="size-[15px]" />}
          hint="Import saved knowledge from a Pilot folder, database, backup or exported files. Imported lessons stay private."
        >
          <Button
            type="button"
            variant="outline"
            onClick={(event) => open("import", event.currentTarget)}
          >
            Import from Pilot Shell
          </Button>
        </SettingRow>
        <SettingsMore summary="Where memories go">
          <p className="q-sg-foot">
            Lessons stay on this computer until you enable repository sharing; lessons about you and
            your answers in tasks always stay here. Shared lessons are included in your normal
            commit and reach teammates after you push. Each person's lessons sit in{" "}
            <code>docs/memories/&lt;yours&gt;/</code> with a LESSONS.md that QualityLayer rewrites
            and never reads back. Anyone with access to the repository can read them. You choose
            sharing per repository, and your choices apply only on this computer.
          </p>
          <p className="q-sg-foot">
            Recalled lessons become part of the agent’s task context and can reach its usual model
            provider. Your Claude Code and Codex memory settings stay as you configured them.
          </p>
        </SettingsMore>
      </SettingsGroup>
      <Dialog
        open={dialog !== null}
        onOpenChange={(value) => {
          if (!value) setDialog(null)
        }}
      >
        <DialogContent
          className={
            dialog === "import" && api.pilotMigration
              ? "q-memory-dialog q-pilot-dialog flex flex-col overflow-hidden sm:max-w-[720px]"
              : "q-memory-dialog sm:max-w-[600px]"
          }
          finalFocus={() => {
            setPendingFocus(true)
            return false
          }}
        >
          {dialog === "projects" || dialog === "filter" ? (
            <>
              <DialogTitle>
                {dialog === "projects" ? "Manage projects" : "Choose project"}
              </DialogTitle>
              <DialogDescription>
                {dialog === "projects"
                  ? "Share a project's lessons through Git. Your choices apply only on this computer."
                  : "Search for a project on this computer."}
              </DialogDescription>
              {dialog === "projects" && toCheck(overview).length ? (
                <section className="q-memory-project-issues" aria-label="Projects to check">
                  <h3>Projects to check</h3>
                  <ul>
                    {toCheck(overview).map((project) => (
                      <li key={project.id}>
                        <strong>{project.name}</strong>
                        <p>Could not check this project. Open it and try again.</p>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <ProjectManager
                api={api}
                changed={refresh}
                shared={overview?.sharedProjects}
                onDone={dialog === "projects" ? () => setDialog(null) : undefined}
                filters={
                  dialog === "filter"
                    ? {
                        all: () => {
                          setProject(null)
                          setCursors([undefined])
                          setDialog(null)
                        },
                        yours: () => {
                          setProject({ id: PERSONAL_PROJECT, name: YOURS })
                          setCursors([undefined])
                          setDialog(null)
                        },
                        total: overview?.total,
                      }
                    : undefined
                }
                choose={
                  dialog === "projects"
                    ? undefined
                    : (picked) => {
                        setProject(picked)
                        setCursors([undefined])
                        setDialog(null)
                      }
                }
              />
              {dialog === "filter" && gone > 0 ? (
                <p className="q-memory-note q-memory-gone" role="status">
                  {gone === 1 ? "1 project's folder is gone" : `${gone} projects' folders are gone`}
                </p>
              ) : null}
            </>
          ) : null}
          {dialog === "detail" ? (
            <MemoryDetail key={detailId} api={api} id={detailId} changed={refresh} />
          ) : null}
          {dialog === "import" && api.pilotMigration ? (
            <PilotMigration
              api={api.pilotMigration}
              completed={refresh}
              close={() => setDialog(null)}
              viewImported={() => {
                setSource("pilot")
                setProject(null)
                setDraft("")
                setQuery("")
                setLessonState("active")
                setCursors([undefined])
                refresh()
                setDialog(null)
              }}
              projectPicker={(choose) => (
                <ProjectManager api={api} changed={refresh} choose={choose} />
              )}
            />
          ) : dialog === "import" ? (
            <PilotImport
              api={api}
              project={importProject}
              onProject={setImportProject}
              completed={refresh}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
