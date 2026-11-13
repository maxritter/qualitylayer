/**
 * The catalog project that holds the lessons about the person. It has no repository: its folder is
 * `<home>/memory/personal`, it is never a Git project, and nothing in it is published or exported.
 */
export const PERSONAL_PROJECT = "personal"
export const PERSONAL_NAME = "Yours"
/** What a refused confirm of a personal lesson says: there is no commit to check it against. */
export const PERSONAL_NO_CONFIRM =
  "A lesson about the person has no commit to check it against. Retire it when they say otherwise, or save the new preference with replaces."
/** The tag on a lesson saved from the person's own answer to a task question. */
export const ANSWER_TAG = "answer"

export type MemoryKind =
  | "decision"
  | "architecture"
  | "bugfix"
  | "pattern"
  | "discovery"
  | "preference"
/** `session`: saved by an agent working outside a task; `manual` lessons are from before that existed. */
export type MemorySource = "task" | "session" | "pilot" | "repository" | "manual"
export type MemoryState = "active" | "retired"

export type MemoryEvidence = {
  task: string
  commit: string | null
  checks: string[]
  recordedAt: number
}

export type MemoryRecord = {
  schema: 1
  id: string
  project: string
  origin: string
  revision: number
  kind: MemoryKind
  title: string
  content: string
  tags: string[]
  files: string[]
  source: MemorySource
  /** Native session attribution has a `native:<agent>:<id>` sourceId and stays out of Git publications. */
  sourceId?: string
  author?: string
  sourceAt?: string
  evidence: MemoryEvidence | null
  visibility: "private" | "project"
  state: MemoryState
  createdAt: number
  updatedAt: number
  /** Portable content digests of accepted ancestors; clone-local mapping is excluded. */
  ancestry?: string[]
  /** Original source location when a repository lesson is accepted into this catalog. */
  provenance?: { project: string; source: MemorySource }
  replaces?: string
  retirement?: MemoryRetired & { replacedBy?: string }
}

/** The commit a lesson was last read against the code at, kept on this computer only. */
export type MemoryChecked = { commit: string; at: number; reason?: string }
/** Who retired a lesson: QualityLayer itself, an agent at Review or elsewhere, or the person. */
export type MemoryRetiredBy = "qualitylayer" | "review" | "agent" | "you"
/** Why a lesson was retired, kept on this computer only; a restore clears it. */
export type MemoryRetired = { reason: string; by: MemoryRetiredBy; at: number }
/**
 * Whether a later commit touched a lesson's files since its check point. Computed, never stored:
 * `none` has no files recorded, `gone` has none of them left, `unchecked` could not be read.
 */
export type MemorySourcesState = "changed" | "unchanged" | "gone" | "none" | "unchecked"
export type MemorySources = {
  state: MemorySourcesState
  commits?: number
  latest?: { commit: string; at: number; subject: string }
  /** The oldest commit since the check point that touched a file; a stale lesson retires by its age. */
  first?: { at: number }
  reason?: string
}
/** The catalog's local facts beside a lesson; never part of the lesson record or its shared file. */
export type MemoryLocal = {
  checked?: MemoryChecked
  retired?: MemoryRetired
  sources?: MemorySources
}

/** `pinned` is the catalog's local flag, never part of the lesson record; the service always sets it. */
export type MemoryRecordView = MemoryRecord & MemoryLocal & { pinned?: boolean; shared?: boolean }
/**
 * `shared` is set by the service: the lesson may leave this computer (project-visible) and its
 * repository's sharing is on, or it came from the repository. `visibility` alone only says it may.
 */
export type MemoryPreview = Omit<MemoryRecord, "content"> &
  MemoryLocal & {
    preview: string
    pinned?: boolean
    shared?: boolean
  }
/** `changed`: on a lesson list, how many active lessons of these filters have changed sources. */
export type MemoryPage<T> = { items: T[]; total: number; next: string | null; changed?: number }
export type MemoryQuery = {
  query?: string
  project?: string
  source?: MemorySource | "all"
  scope?: "private" | "project" | "all"
  /** Only active lessons whose files changed since they were checked. */
  sources?: "changed"
  /** Only lessons in this state; a list without it holds both (the Settings page asks for `active`). */
  state?: MemoryState
  cursor?: string
  limit?: number
}
export type MemoryProject = {
  id: string
  name: string
  root: string
  sharing: boolean
  count: number
  git: boolean
}
/** `sessions` switches the lesson block in every session; a missing value reads as on. */
export type MemorySettings = { enabled: boolean; sessions?: boolean }
/**
 * The lessons one step of a task used (search and read hits) and saved, oldest first, at most 20
 * each. Review also keeps what it did to the project's lessons, at most 10 each: the lessons it
 * replaced (`revised`), retired and confirmed.
 */
export type MemoryStepActivity = {
  used: string[]
  saved: string[]
  revised?: string[]
  retired?: string[]
  confirmed?: string[]
}
/** The lists Review keeps of the project's lessons it kept true. */
export type MemoryKeptList = "revised" | "retired" | "confirmed"
/** `steps` is keyed by step name; a file from before steps reads with none. */
export type MemoryTaskActivity = {
  reads: number
  saves: number
  lastAt: number
  issue?: string
  steps?: Record<string, MemoryStepActivity>
}
/**
 * A lesson of a step's list with its title; `title` is null when the lesson is no longer saved. A
 * retired lesson keeps its title and says why; a confirmed one says why it still holds.
 */
export type MemoryStepLesson = {
  id: string
  title: string | null
  retired?: true
  reason?: string
  /** A lesson about the person: it applies in every project, and the record says so. */
  personal?: true
}
export type MemoryTaskActivityView = Omit<MemoryTaskActivity, "steps"> & {
  steps: Record<
    string,
    { used: MemoryStepLesson[]; saved: MemoryStepLesson[] } & Partial<
      Record<MemoryKeptList, MemoryStepLesson[]>
    >
  >
}
export type MemoryOverview = {
  enabled: boolean
  /** The session switch; the service always sets it. */
  sessions?: boolean
  total: number
  shared: number
  imported: number
  projects: number
  /**
   * How many of the person's projects share their lessons through Git, out of those projects, without
   * the person's own lessons (`personal`), which never share. The service sets it; a missing value
   * leaves the App to count the projects it has read.
   */
  sharedProjects?: { shared: number; total: number }
  recent: MemoryPreview[]
  available: boolean
  issue?: string
  /** Registered project folders that could not be checked; saved lessons remain in the catalog. */
  projectIssues?: {
    id: string
    name: string
    reason: "root-unavailable" | "registration-failed"
  }[]
}
export type MemoryImportResult = {
  imported: number
  updated: number
  skipped: number
  issues: string[]
}
export type MemoryExchangeResult = {
  written: number
  imported: number
  skipped: number
  conflicts: number
  issues: string[]
  /** Set once when lessons moved from the old `.qualitylayer/memories/` folder. */
  migrated?: string
}
export type MemoryConflict = { fingerprint: string; record: MemoryRecord }
export type MemoryStoreInput = {
  /** Update an explicitly restored identity, refusing a changed local revision. */
  id?: string
  expectedRevision?: number
  project: string
  title: string
  content: string
  kind?: MemoryKind
  tags?: string[]
  files?: string[]
  task?: string
  /**
   * Names the source a task's lesson was captured from. With `task`, the lesson's id comes from the
   * key, never from its title, so saving it again updates it and two tasks keep their own.
   */
  key?: string
  /** A task lesson saved without publication evidence, whatever its task's checks say. */
  unverified?: true
  /** An older lesson of the same project that this one retires and unpins in the same save. */
  replaces?: string
  /** Who the replaced lesson's retirement names; an agent's by default. */
  retiredBy?: MemoryRetiredBy
  /** Stays on this computer whatever the privacy filter says: the person's own answers, never published. */
  local?: true
}
export type MemoryEngineHit = { id: string; preview: string }

/** Text in, one unit-length vector per text out; the built-in one lives in `memory-embed`. */
export interface MemoryEmbedder {
  embed(texts: string[]): Promise<Float32Array[]>
  close(): void
}
/** `full`: every lesson had a vector; `partial`: some still lacked one; `off`: words only. */
export type MemorySemantic = "full" | "partial" | "off"
/** What a managing search narrows by; an agent's search takes none of it. */
export type MemorySearchOptions = {
  source?: MemorySource
  scope?: "private" | "project"
  /** Retired lessons match too, so a person can find one to restore it. */
  includeRetired?: boolean
}
export type MemorySearchResult = {
  lessons: MemoryPreview[]
  semantic: MemorySemantic
  /** Why meaning was not used, when the embedder failed. */
  issue?: string
}
export type MemoryReindexResult = { embedded: number; issue?: string }

/** The native engine is an index behind the application-owned record and scope contract. */
export interface MemoryEngine {
  upsert(project: string, record: MemoryRecord): Promise<void>
  search(project: string, query: string, limit: number): Promise<MemoryEngineHit[]>
  /** mem_pin or mem_unpin on the lesson's mapped observation; an unmapped lesson is not indexed yet. */
  pin(project: string, id: string, pinned: boolean): Promise<void>
  /** The lessons saved around one, oldest first, through mem_timeline; unmapped entries are dropped. */
  neighbours(project: string, id: string, around: number): Promise<string[]>
  remove(project: string, id: string): Promise<void>
  close(): Promise<void>
}

export interface MemoryApi {
  pilotMigration?: import("./pilot-memory-contracts.ts").PilotMigrationApi
  activity?(project: string, task: string): Promise<MemoryTaskActivityView>
  overview(project?: string): Promise<MemoryOverview>
  /** Changes the settings named in `patch`; an empty patch reads them. */
  settings(patch: Partial<MemorySettings>): Promise<MemorySettings>
  projects(query?: {
    query?: string
    cursor?: string
    limit?: number
  }): Promise<MemoryPage<MemoryProject>>
  sharing(project: string, enabled: boolean): Promise<MemoryProject>
  list(query?: MemoryQuery): Promise<MemoryPage<MemoryPreview>>
  read(id: string): Promise<MemoryRecordView>
  /** Retires or restores; a retirement keeps `why` (the person's has an empty reason by default). */
  retire(
    id: string,
    active: boolean,
    why?: { reason: string; by: MemoryRetiredBy },
  ): Promise<MemoryRecordView>
  /** Records that the lesson still holds at HEAD: its check point moves there. */
  confirm(id: string, reason?: string): Promise<MemoryRecordView>
  /** Pins or unpins an active lesson; at most five per project, and the sixth is refused with a reason. */
  pin(id: string, pinned: boolean): Promise<MemoryRecordView>
  /** The project's pinned active lessons, newest first. */
  pinned(project: string): Promise<MemoryPreview[]>
  importPilot(input: {
    project: string
    files: { name: string; content: string }[]
  }): Promise<MemoryImportResult>
}
