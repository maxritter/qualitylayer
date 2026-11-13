// The browser side of the localhost API. A browser is signed in by a session cookie (set through a
// pairing link, see server/sessions.ts) and sends it with every call; the page never holds a key.

import type { AgentHealth } from "../core/agents/health-types.ts"
import type { FoundProject } from "../core/agents/history.ts"
import type { NativeAgent } from "../core/agents/ids.ts"
import type { SubagentModels } from "../core/agents/subagent-model.ts"
import type {
  Artifact,
  ArtifactAnchor,
  ArtifactHistoryList,
  ArtifactsOverview,
  DraftOn,
  FoldPreview,
  FoldResult,
  KeepResult,
  LastingLookup,
} from "../core/artifact/format.ts"
import type { LibraryMutation, LibraryResult } from "../core/artifact/library-manage.ts"
import type {
  ArtifactHistory,
  ArtifactMutation,
  ArtifactRevision,
  ArtifactSource,
} from "../core/artifact/workspace.ts"
import type { Config, Editor } from "../core/config-values.ts"
import type { TaskCost } from "../core/cost/index.ts"
import type { Usage, UsagePeriod } from "../core/cost/usage.ts"
import type { Delivery } from "../core/feedback/outbox.ts"
import type {
  PublicDelivery,
  PublicReviewView,
  PublicSystem,
} from "../core/feedback/public-contract.ts"
import type { Diagnostics } from "../core/feedback/words.ts"
import type { BuildAnchor, Comment } from "../core/gate/comments.ts"
import type { StartRecord } from "../core/handoff/start-values.ts"
import type { RepairReport } from "../core/install/install.ts"
import type { IntegrationHealth } from "../core/install/integration.ts"
import type { AnswerKind } from "../core/items.ts"
import type { Need } from "../core/need/need.ts"
import type { ArtifactAnnotationStatus, ArtifactRecordRef } from "../core/records/contract.ts"
import type { ReviewFileSource, SourceRequest } from "../core/review/file-source.ts"
import type { AnotherRun, LineFinding } from "../core/review/findings.ts"
import type { PullRequestView } from "../core/review/summary.ts"
import type { ReviewAction } from "../core/review/threads.ts"
import type { SessionsView, StopOutcome } from "../core/run/sessions-view.ts"
import type { ServerPortView } from "../core/server-port.ts"
import type { LandingState } from "../core/ship/landing.ts"
import type { LandingDiff } from "../core/ship/landing-diff.ts"
import type { PullRequestLife } from "../core/ship/pr-life.ts"
import type { AnswerChange } from "../core/task/question.ts"
import type { Intake } from "../core/task-flow.ts"
import type { ToolsStatus } from "../core/tools-status.ts"
import type { Release } from "../core/update/notes.ts"
import type { UpdateInfo } from "../core/update/state.ts"
import type { Viewing } from "../core/viewing.ts"
import type { ValidationError } from "../ctx.ts"
import type { HomeFacts } from "../interaction/contracts.ts"
import type { MemoryApi, MemoryPreview } from "../memory-contracts.ts"
import type {
  TaskChanges as Changes,
  DocEntry,
  Evidence,
  HomeQuestion,
  ImplementOption,
  Project,
  TaskDetail,
  TaskSummary,
} from "../server/api.ts"
import type { TaskArtifacts } from "../server/artifacts.ts"
import type { AutomationsReply, AutomationView, DeliveryView } from "../server/automations.ts"
import type { DocSections } from "../server/doc-sections-split.ts"
import type { FeedbackWho } from "../server/feedback.ts"
import type { ProjectFolder } from "../server/projects.ts"
import type { SetupFinishResult, SetupState } from "../server/setup.ts"
import type { AgentHistoryApi } from "./agent-history-api.ts"
import { type Machine, readMachines } from "./machines/machines-api.ts"
import { type DiffPage, type DiffReadOptions, readDiffPages } from "./review-workspace/read-diff.ts"
import { noticeTaskDisposition, type TaskDispositionTarget } from "./task-disposition.ts"
import { answerBody } from "./turn/answer-body.ts"

/** What recording a decision answered: `sent` answers and comments went to the agent; `turned` when an approval became changes. */
export type GateResult = {
  target: string
  decision: string
  sent?: number
  turned?: true
  /** The final approval with "Approve and open a pull request": the pull request, or why it was not opened. */
  pr?: PullRequestView
  prError?: string
  /** The comments on lines left open at the approval, posted to the pull request as notes. */
  prNotes?: { posted: number; error?: string }
}

/** The licence as the CLI reports it, with the running version. */
export type {
  Artifact,
  ArtifactAnchor,
  Changes,
  Comment,
  Config,
  Delivery,
  Diagnostics,
  Evidence,
  FeedbackWho,
  HomeQuestion,
  ImplementOption,
  Project,
  Release,
  SetupState,
  SubagentModels,
  TaskArtifacts,
  TaskCost,
  TaskDetail,
  TaskSummary,
  UpdateInfo,
  ValidationError,
}

/** What the QualityLayer home holds on disk, with where it is; `partial` when the walk stopped at its budget. */
export type DiskUse = { bytes: number; partial: boolean; path: string }

export type Licence = {
  state?: string
  tier?: string | null
  email?: string
  /** What the person is called: the name they set, else the licence's email. */
  name?: string
  daysLeft?: number | null
  /** The key this computer holds, masked by the server: never whole. Absent for a trial. */
  key?: string | null
  /** How a paid plan renews, when qualitylayer.dev said: how often and the next date (epoch ms). */
  renews?: { every: "month" | "year"; at: number | null } | null
  portal?: string
  buy?: string
  version?: string
}

export type { DocSection, DocSections } from "../server/doc-sections-split.ts"

export type DocPayload = {
  name: string
  markdown: string
  validation: { valid: boolean; errors: ValidationError[] }
}

export type FindResult = {
  id: string
  task: string
  title: string
  projectName: string
  status: string
  match?: string
  readonly: boolean
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly url?: string,
    readonly detail?: unknown,
  ) {
    super(message)
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    ...(!init?.method || init.method === "GET"
      ? { signal: init?.signal ?? AbortSignal.timeout(15_000) }
      : {}),
    // A form sets its own content type, with the boundary.
    headers:
      init?.body instanceof FormData
        ? { ...init.headers }
        : { "content-type": "application/json", ...init?.headers },
  })
  const text = await response.text()
  let payload: Record<string, unknown> = {}
  try {
    payload = JSON.parse(text) as Record<string, unknown>
  } catch {
    payload = { ok: false, error: { code: "http", message: text || response.statusText } }
  }
  if (!response.ok || payload.ok !== true) {
    const error = (payload.error ?? {}) as { code?: string; message?: string; url?: string }
    throw new ApiError(
      error.message ?? "The App did not accept that. Try again.",
      response.status,
      error.code ?? "http",
      error.url,
      path.includes("/interaction/docs/") || path.endsWith("/public-link") ? error : undefined,
    )
  }
  return payload as T
}

const enc = encodeURIComponent

const annotationBase = (project: string, file: string) =>
  `/api/projects/${enc(project)}/artifacts/${enc(file)}/records/annotations-v1`

async function annotationStatus(path: string, method: "GET" | "POST") {
  const response = await fetch(path, { method, signal: AbortSignal.timeout(15_000) })
  const value = (await response.json()) as ArtifactAnnotationStatus
  if (
    (response.ok || response.status === 409) &&
    ["absent", "preserved", "ready"].includes(value.state) &&
    Array.isArray(value.snapshots) &&
    (response.status !== 409 || value.state === "preserved")
  )
    return value
  throw new ApiError("Annotation history could not be read. Try again.", response.status, "history")
}

/** Where an artifact belongs: a task, or a project for an artifact outside any task. */
export type ArtifactWhere = { scope: "task" | "project"; id: string }

/** What Keep as a lasting artifact sends: the artifact's name, what it shows, where it lives and what to keep. */
export type KeepRequest = {
  name: string
  title: string
  purpose: string
  where: "repository" | "mac"
  /** A Claude Design link (https), stored with an artifact kept in the repository. */
  claudeDesign?: string
  pages?: string[]
  /** A task's draft, or an artifact only on this computer. */
  from: { task: string; draft: string } | { personal: string }
}

/** What New artifact sends: the artifact's name (lower-case, dashes), its title and what it shows. */
export type NewArtifactRequest = { name: string; title: string; purpose: string; checkout?: string }

/** What Fold in sends: the draft, the pages to fold in, and whether to go on over a blocking conflict. */
export type FoldRequest = {
  draft: string
  pages: string[]
  force?: boolean
}

/**
 * What Draft on sends: the lasting artifact, one of its pages (absent: all of them), and the name the
 * copy takes (`as`). With `draft` instead of `as`, nothing is copied: the task's draft of that name is
 * recorded as a draft on the artifact, and `page` is the name it takes there.
 */
export type DraftOnRequest = {
  artifact: string
  project?: string
  page?: string
  as?: string
  draft?: string
}

/** The draft that was made: its name, its entry page's file, what it drafts on and the files copied. */
export type DraftedOn = {
  draft: string
  file: string
  draftOn: DraftOn
  copied: string[]
}

export type {
  ArtifactHistoryList,
  ArtifactsOverview,
  BrokenArtifact,
  DraftOn,
  FoldPreview,
  FoldResult,
  KeepResult,
  LastingArtifact,
  LastingLookup,
  ProjectArtifacts,
} from "../core/artifact/format.ts"

const artifactBase = (where: ArtifactWhere) =>
  `/api/${where.scope === "task" ? "tasks" : "projects"}/${enc(where.id)}/artifacts`

/** The address of an artifact's thumbnail; the key changes with each version of its file. */
export const artifactThumbUrl = (where: ArtifactWhere, file: string, key: string): string =>
  `${artifactBase(where)}/${enc(file)}/thumb?k=${enc(key)}`

async function readFileDiff(
  id: string,
  path: string,
  options: DiffReadOptions = {},
): Promise<string> {
  return readDiffPages(({ after, revision }, signal) => {
    const query = new URLSearchParams({
      path,
      ...(after ? { after } : {}),
      ...(revision ? { revision } : {}),
    })
    return call<DiffPage>(`/api/tasks/${enc(id)}/changes/file?${query}`, { signal })
  }, options)
}

export type { AutomationsReply, AutomationView, DeliveryView }

/** What the form of Settings › Automations sends: where, which events and projects, and a URL's signing secret. */
export type AutomationDraft = {
  kind: "url" | "command"
  target: string
  events: "all" | string[]
  /** Project ids, or "all". */
  projects: "all" | string[]
  /** A URL's secret, made in the form so it can be shown before Save; the server makes one when absent. */
  secret?: string
}

/** What a change sends: any of the draft's parts, and on or off. */
export type AutomationPatch = Partial<Omit<AutomationDraft, "secret">> & { on?: boolean }

/** What a test send answers: the result is what came back, never a failed call. */
export type AutomationTest = {
  event: string
  delivery: string
  result: string
  delivered: boolean
  output?: string
}

/** Settings › Automations: the same changes `qualitylayer automations` makes. */
export type AutomationsApi = {
  list: () => Promise<AutomationsReply>
  /** The newest tries (10), of one automation or all. */
  deliveries: (automation?: string) => Promise<DeliveryView[]>
  add: (draft: AutomationDraft) => Promise<AutomationView>
  change: (id: string, patch: AutomationPatch) => Promise<AutomationView>
  remove: (id: string) => Promise<void>
  /** Send the sample event to a saved automation. */
  test: (id: string) => Promise<AutomationTest>
  /** Send the sample event to a target the form has not saved yet. */
  testDraft: (
    draft: Pick<AutomationDraft, "kind" | "target" | "secret"> &
      Partial<Pick<AutomationDraft, "projects">>,
  ) => Promise<AutomationTest>
  /** A URL's signing secret, whole. */
  secret: (id: string) => Promise<string>
}

export const api = {
  get memory(): MemoryApi {
    return memoryApi
  },
  get automations(): AutomationsApi {
    return automationsApi
  },
  projects: () => call<{ projects: Project[] }>("/api/projects").then((r) => r.projects),
  pickProjectFolder: (path?: string, signal?: AbortSignal) =>
    call<import("../server/projects.ts").FolderPick>("/api/projects/folders/pick", {
      method: "POST",
      body: JSON.stringify({ path }),
      signal,
    }),
  projectFolder: (path?: string) =>
    call<ProjectFolder>(`/api/projects/folders${path ? `?path=${enc(path)}` : ""}`),
  projectFolders: () =>
    call<import("../server/projects.ts").KnownProjectFolders>("/api/projects/folders/known"),
  chooseProjectFolder: (path: string, initialize = false) =>
    call<{ project: Project; path: string }>("/api/projects/folders", {
      method: "POST",
      body: JSON.stringify({ path, initialize }),
    }),
  /** The repositories the person's coding agents worked in lately, for Setup's "Your projects". */
  foundProjects: () =>
    call<{ projects: FoundProject[] }>("/api/projects/folders/found").then((r) => r.projects),
  tasks: () => call<{ tasks: TaskSummary[] }>("/api/tasks").then((r) => r.tasks),
  task: (id: string, signal?: AbortSignal) =>
    call<{ task: TaskDetail }>(`/api/tasks/${enc(id)}`, { signal }).then((r) => r.task),
  doc: (id: string, name: string, signal?: AbortSignal) =>
    call<DocPayload>(`/api/tasks/${enc(id)}/doc/${enc(name)}`, { signal }),
  chatPromotion: (id: string) =>
    call<{ allowed: boolean; running: string[] }>(`/api/tasks/${enc(id)}/chat/promote`),
  promoteChat: (id: string, type: "feature" | "bugfix", fromSavedPlan = false) =>
    call<{ task: unknown; then: string }>(`/api/tasks/${enc(id)}/chat/promote`, {
      method: "POST",
      body: JSON.stringify({ type, ...(fromSavedPlan ? { fromSavedPlan } : {}) }),
    }),
  /** The same document cut into sections, each with where the step page and the Reader show it. */
  sections: (id: string, name: string) =>
    call<{ sections: DocSections }>(`/api/tasks/${enc(id)}/sections/${enc(name)}`).then(
      (r) => r.sections,
    ),
  /** Guarded text records of this task; registered files also remain in TaskDetail.files. */
  taskRecords: (id: string): Promise<DocEntry[]> =>
    interactionApi
      .taskRoute<{ documents: DocEntry[] }>(id, "docs", "files")
      .then(({ documents }) => documents),
  /** One guarded text record of this task, read-only. */
  record: (id: string, path: string): Promise<string> =>
    interactionApi
      .taskRoute<{ text: string }>(id, "docs", `record?path=${encodeURIComponent(path)}`)
      .then((r) => r.text),
  artifact: (id: string, name: string) =>
    call<{ html: string }>(`/api/tasks/${enc(id)}/artifact/${enc(name)}`).then((r) => r.html),
  /** A task's own artifacts; project-wide artifacts use the separate project endpoint. */
  taskArtifacts: (id: string, thumbnails = true) =>
    call<TaskArtifacts & { ok: true }>(
      `/api/tasks/${enc(id)}/artifacts${thumbnails ? "" : "?thumbnails=0"}`,
    ).then(({ task, projectId, projectName }) => ({ task, projectId, projectName })),
  /** Home's Artifacts tab: a project's artifacts and the comments on them. */
  projectArtifacts: (id: string, thumbnails = true) =>
    call<{ artifacts: Artifact[]; comments: Comment[] }>(
      `/api/projects/${enc(id)}/artifacts${thumbnails ? "" : "?thumbnails=0"}`,
    ).then(({ artifacts, comments }) => ({ artifacts, comments })),
  /** One artifact's page for the sandboxed frame, with the App's bridge in it. */
  artifactPage: (where: ArtifactWhere, file: string) =>
    call<{ html: string }>(`${artifactBase(where)}/${enc(file)}`).then((r) => r.html),
  artifactContext: (where: ArtifactWhere, file: string) =>
    call<{ revision: string; prompt?: string; folder?: string }>(
      `${artifactBase(where)}/${enc(file)}/agent-context`,
    ),
  artifactAnnotationStatus: (project: string, file: string) =>
    annotationStatus(`${annotationBase(project, file)}/status`, "GET"),
  upgradeArtifactAnnotations: (project: string, file: string) =>
    annotationStatus(`${annotationBase(project, file)}/upgrade`, "POST"),
  artifactAnnotationUrl: (project: string, file: string, ref: ArtifactRecordRef) =>
    `${annotationBase(project, file)}/snapshots/${enc(ref.snapshot)}/${enc(ref.entry)}${ref.asset === undefined ? "" : `/assets/${enc(ref.asset)}`}`,
  artifactSource: (where: ArtifactWhere, file: string) =>
    call<ArtifactSource>(`${artifactBase(where)}/${enc(file)}/source`),
  artifactHistory: (where: ArtifactWhere, file: string) =>
    call<{ revisions: ArtifactRevision[] }>(`${artifactBase(where)}/${enc(file)}/history`).then(
      (r) => r.revisions,
    ),
  artifactProvenance: (where: ArtifactWhere, file: string) =>
    call<ArtifactHistory>(`${artifactBase(where)}/${enc(file)}/history`),
  artifactMutate: (where: ArtifactWhere, file: string, change: ArtifactMutation) =>
    call<{ file: string; revision: string; deleted?: true }>(
      `${artifactBase(where)}/${enc(file)}/workspace`,
      { method: "POST", body: JSON.stringify(change) },
    ),
  /** A comment on a spot of an artifact, or on the whole page; it reaches the agent at once. */
  artifactComment: (where: ArtifactWhere, file: string, remark: string, spot?: ArtifactAnchor) =>
    call<{ comment: Comment }>(`${artifactBase(where)}/${enc(file)}/comments`, {
      method: "POST",
      body: JSON.stringify({ remark, ...(spot !== undefined ? { spot } : {}) }),
    }).then((r) => r.comment),
  artifactResolve: (where: ArtifactWhere, file: string, comment: string) =>
    call<Record<string, never>>(`${artifactBase(where)}/${enc(file)}/resolve`, {
      method: "POST",
      body: JSON.stringify({ id: comment }),
    }).then(() => undefined),
  /** Open in browser, or show the file in its folder. */
  artifactOpen: (
    where: ArtifactWhere,
    file: string,
    how: "browser" | "reveal",
    options?: { viewer?: boolean; section?: string },
  ) =>
    call<Record<string, never>>(`${artifactBase(where)}/${enc(file)}/open`, {
      method: "POST",
      body: JSON.stringify({ how, ...options }),
    }).then(() => undefined),
  /**
   * The Artifacts place: every project's lasting artifacts, its personal artifacts ("On this computer") and
   * the drafts of its open tasks. A lasting artifact opens through the project artifact routes, by the
   * file of one of its pages (`LastingPage.file`).
   */
  artifactsOverview: (thumbnails = true) =>
    call<ArtifactsOverview & { ok: true }>(
      `/api/artifacts${thumbnails ? "" : "?thumbnails=0"}`,
    ).then(({ projects }): ArtifactsOverview => ({ projects })),
  /** One lasting artifact as the Artifacts place lists it, read on its own: an artifact opens without the whole overview. */
  lastingArtifact: (project: string, name: string, thumbnails = true) =>
    call<LastingLookup & { ok: true }>(
      `/api/projects/${enc(project)}/artifacts/${enc(name)}/lasting${thumbnails ? "" : "?thumbnails=0"}`,
    ).then(({ project: owner, artifact }) => ({ project: owner, artifact })),
  /** A lasting artifact's commits, newest first; a commit a task made names the task. */
  lastingHistory: (project: string, name: string) =>
    call<ArtifactHistoryList & { ok: true }>(
      `/api/projects/${enc(project)}/artifacts/${enc(name)}/history`,
    ).then(({ entries, truncated }) => ({ entries, truncated })),
  manageLibraryArtifact: (project: string, name: string, request: LibraryMutation) =>
    call<LibraryResult & { ok: true }>(
      `/api/projects/${enc(project)}/artifacts/${enc(name)}/manage`,
      { method: "POST", body: JSON.stringify(request) },
    ).then(({ ok: _ok, ...result }) => result),
  /** Keep a task's draft or a personal artifact as a lasting artifact, in the repository or on this computer. */
  keepArtifact: (project: string, request: KeepRequest) =>
    call<KeepResult & { ok: true }>(`/api/projects/${enc(project)}/artifacts/keep`, {
      method: "POST",
      body: JSON.stringify(request),
    }).then(({ name, where, path, files }): KeepResult => ({ name, where, path, files })),
  /** New artifact: a lasting artifact in the repository with one blank page. */
  newArtifact: (project: string, request: NewArtifactRequest) =>
    call<KeepResult & { ok: true }>(`/api/projects/${enc(project)}/artifacts/new`, {
      method: "POST",
      body: JSON.stringify(request),
    }).then(({ name, where, path, files }): KeepResult => ({ name, where, path, files })),
  /** What folding a task's draft into its lasting artifact would write, and what is in the way. */
  foldPreview: (task: string, draft: string) =>
    call<{ preview: FoldPreview }>(
      `/api/tasks/${enc(task)}/artifacts/fold?draft=${enc(draft)}`,
    ).then((r) => r.preview),
  /** Fold the chosen pages in; a blocking conflict answers `folded: false` with the preview unless `force`. */
  foldArtifact: (task: string, request: FoldRequest) =>
    call<FoldResult & { ok: true }>(`/api/tasks/${enc(task)}/artifacts/fold`, {
      method: "POST",
      body: JSON.stringify(request),
    }).then(({ ok: _ok, ...result }): FoldResult => result),
  /** List a lasting artifact (`<project id>:<name>`) under another project too; per machine, kept with the project look. */
  alsoShowArtifact: async (project: string, ref: string) => {
    const looks = await call<{ projects?: Record<string, { artifacts?: string[] }> }>(
      "/api/projects/look",
    )
    const current = looks.projects?.[project]?.artifacts ?? []
    if (current.includes(ref)) return
    await call<Record<string, never>>(`/api/projects/look/${enc(project)}`, {
      method: "PUT",
      body: JSON.stringify({ artifacts: [...current, ref] }),
    })
  },
  stopShowingArtifact: async (project: string, ref: string) => {
    const looks = await call<{ projects?: Record<string, { artifacts?: string[] }> }>(
      "/api/projects/look",
    )
    const current = looks.projects?.[project]?.artifacts ?? []
    if (!current.includes(ref)) return
    await call<Record<string, never>>(`/api/projects/look/${enc(project)}`, {
      method: "PUT",
      body: JSON.stringify({ artifacts: current.filter((entry) => entry !== ref) }),
    })
  },
  /** Draft on a lasting artifact of the task's project: a copy in the task that remembers its source. */
  draftOnArtifact: (task: string, request: DraftOnRequest) =>
    call<DraftedOn & { ok: true }>(`/api/tasks/${enc(task)}/artifacts/draft-on`, {
      method: "POST",
      body: JSON.stringify(request),
    }).then(({ draft, file, draftOn, copied }): DraftedOn => ({ draft, file, draftOn, copied })),
  evidence: (id: string, name: string) =>
    call<{ evidence: Evidence }>(`/api/tasks/${enc(id)}/evidence/${enc(name)}`).then(
      (r) => r.evidence,
    ),
  cost: (id: string) => call<{ cost: TaskCost }>(`/api/tasks/${enc(id)}/cost`).then((r) => r.cost),
  homeFacts: (scope: { project: string; agent: string; timezone: string }) =>
    call<{ facts: HomeFacts }>(`/api/interaction/shell/home?${new URLSearchParams(scope)}`).then(
      (r) => r.facts,
    ),
  changes: (id: string, options: { preview?: boolean; signal?: AbortSignal } = {}) =>
    call<{ changes: Changes }>(
      `/api/tasks/${enc(id)}/changes${options.preview === false ? "?preview=0" : ""}`,
      { signal: options.signal },
    ).then((r) => r.changes),
  fileDiff: readFileDiff,
  reviewFileSource: (id: string, request: SourceRequest) =>
    call<ReviewFileSource>(`/api/tasks/${enc(id)}/changes/source?${new URLSearchParams(request)}`),
  clearTaskChanges: (id: string) =>
    call<{ cleared: true }>(`/api/tasks/${enc(id)}/changes`, { method: "DELETE" }),
  putComments: (
    id: string,
    doc: string,
    comments: {
      id?: string
      quote: string
      remark: string
      /** A final-gate comment on one line of the diff. */
      anchor?: { file: string; side: "old" | "new"; line: number; stamp?: string }
      /** The item this is about; with `kind`, the answer given to it. */
      item?: string
      kind?: AnswerKind
      /** The item's digest as the page showed it. */
      seen?: string
      /** Where on the item's diagram a comment is pinned. */
      pin?: string
      /** On a line of the diff: a question, a change, or exact replacement lines. */
      ask?: "question" | "change" | "replace"
      replace?: string
    }[],
  ) =>
    call<{ comments: Comment[] }>(`/api/tasks/${enc(id)}/comments`, {
      method: "PUT",
      body: JSON.stringify({ doc, comments }),
    }).then((r) => r.comments),
  /** What the person did with a finding on a line: their change request, or not a problem (a lesson). */
  finding: (
    id: string,
    findingId: string,
    body: { kind: "adopted" | "dismissed"; reason?: string },
  ) =>
    call<{ findings: LineFinding[] }>(`/api/tasks/${enc(id)}/findings/${enc(findingId)}`, {
      method: "POST",
      body: JSON.stringify(body),
    }).then((r) => r.findings),
  /** Ask another reviewer: one file, or the whole change when `file` is null. */
  anotherReview: (id: string, file: string | null) =>
    call<{ run: Omit<AnotherRun, "findings" | "pid"> }>(`/api/tasks/${enc(id)}/another-review`, {
      method: "POST",
      body: JSON.stringify(file !== null ? { file } : {}),
    }).then((r) => r.run),
  /** A question on a line that ended without an answer goes round once more. */
  askAgain: (id: string, commentId: string) =>
    call<{ comments: Comment[] }>(`/api/tasks/${enc(id)}/comments/${enc(commentId)}/ask-again`, {
      method: "POST",
    }).then((r) => r.comments),
  /** Feedback on an item of the Build tab; the build session hears it with its next `comments take`. */
  buildComment: (id: string, anchor: BuildAnchor, remark: string) =>
    call<{ comment: Comment }>(`/api/tasks/${enc(id)}/comments/build`, {
      method: "POST",
      body: JSON.stringify({ ...anchor, remark }),
    }).then((r) => r.comment),
  /** Say something in the Review: a thread, a reply, resolving it, asking a reviewer again. */
  review: (id: string, action: ReviewAction) =>
    call<{ review: unknown }>(`/api/tasks/${enc(id)}/review`, {
      method: "POST",
      body: JSON.stringify(action),
    }),
  gate: (
    id: string,
    decision: "approved" | "changes",
    remark?: string,
    gateId?: string,
    /** The final approval's choice: open the pull request, approve only, or the git commands to run yourself. Never a merge. */
    ship?: "pull-request" | "only" | "commands",
    options?: { revision?: string },
  ) =>
    call<GateResult>(`/api/tasks/${enc(id)}/gate`, {
      method: "POST",
      body: JSON.stringify({
        decision,
        remark,
        gateId,
        ...(options?.revision !== undefined ? { revision: options.revision } : {}),
        ...(ship !== undefined ? { ship } : {}),
      }),
    }),
  /**
   * Answer an item of the running build at once: Fine or Ask why on a choice it made, Add or Skip it on
   * an addition to the Plan, how to go on after a stop (`note` is the hint, or the change to the Plan).
   */
  answerItem: (
    id: string,
    body: { item: string; kind: AnswerKind; note?: string; gateId?: string },
  ) =>
    call<{ answered: AnswerKind }>(`/api/tasks/${enc(id)}/items/answer`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** Answer the question card: a choice (its index), own words, Tell me more, or Not sure. Sent at once. */
  answerQuestion: (
    id: string,
    body:
      | { id: string; choice: number }
      | { id: string; choices: number[] }
      | { id: string; text: string }
      | { id: string; more: { request: string } }
      | { id: string; unsure: true },
    files: readonly File[] = [],
  ) =>
    call<{ answered?: unknown; more?: unknown }>(`/api/tasks/${enc(id)}/question/answer`, {
      method: "POST",
      body: answerBody(body, files),
    }),
  /** The questions asked on the home page: a taskless Home or team ask. */
  homeQuestions: () =>
    call<{ questions: HomeQuestion[] }>("/api/home-questions").then((r) => r.questions),
  /** Answer, cancel or change the home page's question of a project. */
  homeQuestion: (project: string, action: "answer" | "cancel" | "change", body: unknown) =>
    call<{ answered?: unknown }>(`/api/projects/${enc(project)}/question/${action}`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  /** Cancel on Tell me more. */
  cancelMore: (id: string) =>
    call<{ question: unknown }>(`/api/tasks/${enc(id)}/question/cancel`, { method: "POST" }),
  /** Change on a receipt: correct the answer to question `number`; `choices` is a several-answer question's whole set. */
  changeAnswer: (id: string, body: AnswerChange) =>
    call<{ answered: unknown }>(`/api/tasks/${enc(id)}/question/change`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** "Done, it's set" for a need of the build, with an optional note that is never a key. */
  needSet: (id: string, need: string, note: string) =>
    call<{ need: Need }>(`/api/tasks/${enc(id)}/needs/${enc(need)}/set`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }).then((r) => r.need),
  /** *Push the fix*: the commits made after the pull request was pushed go to its branch, on the person's click. */
  pushFix: (id: string) =>
    call<{ pushed: true; branch: string; pullRequest: PullRequestLife | null }>(
      `/api/tasks/${enc(id)}/push`,
      { method: "POST" },
    ),
  /** *Leave them for now*: what waits on the pull request stops asking until something new comes. */
  leavePullRequest: (id: string) =>
    call<{ left: true; pullRequest: PullRequestLife | null }>(
      `/api/tasks/${enc(id)}/pull-request/leave`,
      { method: "POST" },
    ),
  /** *Mark as merged*: the person says an approved task's change landed, for a merge git cannot show. */
  markMerged: (id: string, scope?: string) =>
    call<{ landing: LandingState }>(`/api/tasks/${enc(id)}/landing/merged`, {
      method: "POST",
      body: JSON.stringify({ scope }),
    }).then((r) => r.landing),
  /** What changed since the approval, from git: the files and the patch the person looks at before *Approve change*. */
  landingDiff: (id: string) =>
    call<LandingDiff & { from: string; to: string }>(`/api/tasks/${enc(id)}/landing/diff`),
  /** *Approve change*: the person approves the branch head `sha`, made after the approval. */
  approveChange: (id: string, sha: string, scope?: string) =>
    call<{ landing: LandingState }>(`/api/tasks/${enc(id)}/landing/approve-change`, {
      method: "POST",
      body: JSON.stringify({ sha, scope }),
    }).then((r) => r.landing),
  /** The start the person copied: the build's workers run at its effort. */
  /** Build in that session: approve the Plan and choose the planner waiting in the person's terminal. */
  buildHere: (
    id: string,
    body: { gateId?: string; agent?: string | null; compact?: boolean; remark?: string },
  ) =>
    call<GateResult>(`/api/tasks/${enc(id)}/build-here`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  start: (id: string, choice: Omit<StartRecord, "at">) =>
    call<{ start: StartRecord }>(`/api/tasks/${enc(id)}/start`, {
      method: "POST",
      body: JSON.stringify(choice),
    }).then((r) => r.start),
  archive: (id: string, archived: boolean) => {
    return call<{ archived: boolean; disposition?: TaskDispositionTarget }>(
      `/api/tasks/${enc(id)}/archive`,
      {
        method: "PUT",
        body: JSON.stringify({ archived }),
      },
    ).then((result) => {
      noticeTaskDisposition(api, id, archived ? "archived" : "restored", result.disposition)
      return result
    })
  },
  /** How the task runs, before the Plan is approved: the one choice, Small change or Full workflow. */
  putProfile: (id: string, profile: "small" | "full") =>
    call<{ intake: Intake | null }>(`/api/tasks/${enc(id)}/profile`, {
      method: "PUT",
      body: JSON.stringify({ profile }),
    }),
  viewing: (id: string, location: Viewing | { clear: true }, closing = false) => {
    const path = `/api/tasks/${enc(id)}/viewing`
    if (
      closing &&
      navigator.sendBeacon?.(
        path,
        new Blob([JSON.stringify(location)], { type: "application/json" }),
      )
    )
      return Promise.resolve()
    return call<unknown>(path, {
      method: "POST",
      body: JSON.stringify(location),
      ...(closing ? { keepalive: true } : {}),
    })
  },
  /** Open a file of the task in the person's editor, or show it in their file manager. */
  openFile: (id: string, file: string, how: "open" | "reveal" | "folder") =>
    call<Record<string, never>>(`/api/tasks/${enc(id)}/open`, {
      method: "POST",
      body: JSON.stringify({ file, how }),
    }).then(() => undefined),
  /** Open a file or folder of the task's checkout (`.` is the checkout) in one of the places Settings lists. */
  openIn: (id: string, editor: Editor, file: string) =>
    call<Record<string, never>>(`/api/tasks/${enc(id)}/open`, {
      method: "POST",
      body: JSON.stringify({ how: "editor", editor, file }),
    }).then(() => undefined),
  deleteTask: (id: string) => {
    return call<{ plan: string | null; disposition?: TaskDispositionTarget }>(
      `/api/tasks/${enc(id)}`,
      { method: "DELETE" },
    ).then((result) => {
      noticeTaskDisposition(api, id, "deleted", result.disposition)
      return result
    })
  },
  find: (q: string) =>
    call<{ results: FindResult[] }>(`/api/find?q=${enc(q)}`).then((r) => r.results),
  config: () => call<{ config: Config }>("/api/config").then((r) => r.config),
  putConfig: (patch: unknown) =>
    call<{ config: Config }>("/api/config", { method: "PUT", body: JSON.stringify(patch) }).then(
      (r) => r.config,
    ),
  licence: () => call<{ licence: Licence }>("/api/licence").then((r) => r.licence),
  /** Keep this browser's session for 30 days instead of until it closes. */
  rememberBrowser: () =>
    call<Record<string, never>>("/api/session", {
      method: "POST",
      body: JSON.stringify({ remember: true }),
    }).then(() => undefined),
  subagents: () => call<{ agents: SubagentModels[] }>("/api/subagents").then((r) => r.agents),
  agentHealth: () => call<{ agents: AgentHealth[] }>("/api/agents").then((r) => r.agents),
  checkAgents: () =>
    call<{ agents: AgentHealth[] }>("/api/agents/check", { method: "POST", body: "{}" }).then(
      (r) => r.agents,
    ),
  /** Waits for the sign-ins a check started, then gives every agent's row again. */
  agentSignIns: () => call<{ agents: AgentHealth[] }>("/api/agents/sign-in").then((r) => r.agents),
  /** Whether QualityLayer's skills, commands and turn-end hooks are in place for each agent. */
  agentIntegration: () =>
    call<{ integration: IntegrationHealth[] }>("/api/agents/integration").then(
      (r) => r.integration,
    ),
  /** Put QualityLayer's part of one agent back; what the person changed stays as it is. */
  repairAgent: (agent: NativeAgent) =>
    call<RepairReport>("/api/agents/repair", { method: "POST", body: JSON.stringify({ agent }) }),
  /** git and the GitHub CLI: whether each is there, its version, and who `gh` is signed in as. Kept five minutes. */
  tools: () => call<{ tools: ToolsStatus }>("/api/tools").then((r) => r.tools),
  /** Read git and `gh` afresh. */
  checkTools: () =>
    call<{ tools: ToolsStatus }>("/api/tools/check", { method: "POST", body: "{}" }).then(
      (r) => r.tools,
    ),
  /** What the agents used in a period (7 days, 30 days, this month) with the period before it. Reads when asked. */
  usage: (period: UsagePeriod) => call<Usage>(`/api/usage?period=${period}`),
  /** The agents running on this computer with the memory of each one's processes. Reads when asked. */
  agentSessions: () => call<SessionsView>("/api/agent-sessions"),
  /** The machines this computer's server reaches over ssh. A demo adapter has none and leaves this out. */
  machines: (signal?: AbortSignal) => readMachines(signal),
  /** Stop every idle agent; each outcome says whether it stopped and, if not, why. */
  stopIdle: () =>
    call<{ stopped: StopOutcome[] }>("/api/agent-sessions/stop-idle", {
      method: "POST",
      body: "{}",
    }).then((r) => r.stopped),
  /** What the QualityLayer home holds: measured when asked, never on a timer. */
  diskUse: () => call<DiskUse & { ok: true }>("/api/disk-use"),
  /** Show the QualityLayer home in the system's file manager. */
  revealHome: () =>
    call<Record<string, never>>("/api/disk-use/reveal", { method: "POST" }).then(() => undefined),
  /** The port the server listens on and the one it wanted: read when Settings › About opens, never on a timer. */
  serverPort: () =>
    call<ServerPortView & { ok: true }>("/api/server").then(({ ok: _ok, ...view }) => view),
  /** Start the server again on the setting's port; where it is now. The page that asked may lose its server. */
  restartServer: () =>
    call<{ ok: true; port: number; url: string; wanted: number }>("/api/server/restart", {
      method: "POST",
      body: "{}",
    }).then(({ port, url, wanted }) => ({ port, url, wanted })),
  /** The App's update as the desktop shell wrote it; nothing newer known without the shell. */
  update: () => call<UpdateInfo & { ok: true }>("/api/update"),
  /** Restart and update (`install`), Check now (`check`), Cancel the update (`cancel`) or Later: the shell reads the request. */
  updateAction: (action: "install" | "check" | "cancel" | "later") =>
    call<{ requested: string }>(`/api/update/${action}`, { method: "POST", body: "{}" }),
  /** Published GitHub release notes, with a local offline copy. */
  releases: () => call<{ releases: Release[] }>("/api/update/releases").then((r) => r.releases),
  /** Who a feedback report would be from: the licence, or a trial that asks for a name and e-mail. */
  feedbackWho: () => call<{ who: FeedbackWho }>("/api/feedback").then((r) => r.who),
  /** The diagnostics exactly as they would be sent, for "Show what is sent". */
  feedbackPreview: (body: { page?: string; errors?: { count: number; kinds: string[] } }) =>
    call<{ diagnostics: Diagnostics }>("/api/feedback/diagnostics", {
      method: "POST",
      body: JSON.stringify(body),
    }).then((r) => r.diagnostics),
  /** Send a report: the multipart form the sheet builds (`report` as JSON, `image` files). */
  sendFeedback: (form: FormData) => call<Delivery>("/api/feedback", { method: "POST", body: form }),
  publicFeedbackSystem: () =>
    call<{ system: PublicSystem }>("/api/feedback/public/system").then((r) => r.system),
  publicFeedbackPreview: (form: FormData) =>
    call<PublicReviewView>("/api/feedback/public/preview", { method: "POST", body: form }),
  publicFeedbackSubmit: (id: string, digest: string) =>
    call<PublicDelivery>("/api/feedback/public/submit", {
      method: "POST",
      body: JSON.stringify({ id, digest, confirmed: true }),
    }),
  publicFeedbackCancel: (id: string) =>
    call<{ stopped: true }>("/api/feedback/public/cancel", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  publicFeedbackStatus: (id: string) =>
    call<{ delivery: PublicDelivery | null }>(`/api/feedback/public/status/${enc(id)}`).then(
      (r) => r.delivery,
    ),
  /** Your own instructions and when the file changed (0 with no file). The route answers plain JSON, outside the `ok` envelope. */
  instructions: async (): Promise<InstructionsText> => {
    const response = await fetch("/api/instructions", { cache: "no-store" })
    if (!response.ok) throw new Error("The App could not read your instructions. Try again.")
    return (await response.json()) as InstructionsText
  },
  /** Save them against the `updated` the editor opened with; a file changed since answers with the current one. */
  putInstructions: async (text: string, base: number): Promise<InstructionsOutcome> => {
    const response = await fetch("/api/instructions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, base }),
    })
    if (response.status === 409) return { conflict: await api.instructions() }
    if (!response.ok) {
      const said = await response.text()
      throw new Error(
        response.status === 403
          ? "Only the App and browsers it opened may change your instructions."
          : said.includes("characters")
            ? "The text is over 12,000 characters."
            : "The App did not accept that. Try again.",
      )
    }
    return { saved: (await response.json()) as InstructionsText }
  },
}

/** A workflow instructions text with the `updated` (ms) of the file it came from. */
export type InstructionsText = { text: string; updated: number }
/** What a save answers: it went through, or the text changed elsewhere meanwhile and this is the current one. */
export type InstructionsOutcome = { saved: InstructionsText } | { conflict: InstructionsText }

export type Api = Omit<
  typeof api,
  | "memory"
  | "automations"
  | "projectFolder"
  | "projectFolders"
  | "pickProjectFolder"
  | "chooseProjectFolder"
  | "foundProjects"
  | "taskRecords"
  | "artifactSource"
  | "artifactAnnotationStatus"
  | "artifactContext"
  | "upgradeArtifactAnnotations"
  | "artifactAnnotationUrl"
  | "artifactHistory"
  | "artifactProvenance"
  | "artifactMutate"
  | "viewing"
  | "agentHealth"
  | "checkAgents"
  | "agentSignIns"
  | "agentIntegration"
  | "repairAgent"
  | "usage"
  | "agentSessions"
  | "machines"
  | "stopIdle"
  | "diskUse"
  | "revealHome"
  | "serverPort"
  | "restartServer"
  | "tools"
  | "checkTools"
> & {
  /** A source demo adapter that implements the current task-turn controls. */
  currentTurnLayout?: true
  /** A source demo's batch lets the person jump to another open member from the strip. */
  focusQuestion?: (id: string, question: string) => Promise<void>
  agentHealth?: typeof api.agentHealth
  checkAgents?: typeof api.checkAgents
  agentSignIns?: typeof api.agentSignIns
  agentIntegration?: typeof api.agentIntegration
  repairAgent?: typeof api.repairAgent
  usage?: typeof api.usage
  tools?: typeof api.tools
  checkTools?: typeof api.checkTools
  agentSessions?: typeof api.agentSessions
  machines?: typeof api.machines
  /** Where a machine's page is served: the demo's own page in another world; absent, this computer's port. */
  machinePage?: (machine: Machine) => string
  stopIdle?: typeof api.stopIdle
  diskUse?: typeof api.diskUse
  revealHome?: typeof api.revealHome
  serverPort?: typeof api.serverPort
  restartServer?: typeof api.restartServer
  memory?: MemoryApi
  /** Settings › Automations; absent in an App that does not have the page's routes. */
  automations?: AutomationsApi
  /** New chat's resume list; absent, the card reads this computer's agent history over HTTP. */
  agentHistory?: AgentHistoryApi
  viewing?: typeof api.viewing
  projectFolder?: typeof api.projectFolder
  projectFolders?: typeof api.projectFolders
  pickProjectFolder?: typeof api.pickProjectFolder
  chooseProjectFolder?: typeof api.chooseProjectFolder
  foundProjects?: typeof api.foundProjects
  taskRecords?: typeof api.taskRecords
  artifactSource?: typeof api.artifactSource
  artifactAnnotationStatus?: typeof api.artifactAnnotationStatus
  artifactContext?: typeof api.artifactContext
  upgradeArtifactAnnotations?: typeof api.upgradeArtifactAnnotations
  artifactAnnotationUrl?: typeof api.artifactAnnotationUrl
  artifactHistory?: typeof api.artifactHistory
  artifactProvenance?: typeof api.artifactProvenance
  artifactMutate?: typeof api.artifactMutate
}

const automationsApi: AutomationsApi = {
  list: () => call<AutomationsReply & { ok: true }>("/api/automations"),
  deliveries: (automation) =>
    call<{ deliveries: DeliveryView[] }>(
      `/api/automations/deliveries${automation === undefined ? "" : `?automation=${enc(automation)}`}`,
    ).then((r) => r.deliveries),
  add: (draft) =>
    call<{ automation: AutomationView }>("/api/automations", {
      method: "POST",
      body: JSON.stringify(draft),
    }).then((r) => r.automation),
  change: (id, patch) =>
    call<{ automation: AutomationView }>(`/api/automations/${enc(id)}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }).then((r) => r.automation),
  remove: (id) =>
    call<{ removed: string }>(`/api/automations/${enc(id)}`, { method: "DELETE" }).then(
      () => undefined,
    ),
  test: (id) => call<AutomationTest>(`/api/automations/${enc(id)}/test`, { method: "POST" }),
  testDraft: (draft) =>
    call<AutomationTest>("/api/automations/test", { method: "POST", body: JSON.stringify(draft) }),
  secret: (id) =>
    call<{ secret: string }>(`/api/automations/${enc(id)}/secret`).then((r) => r.secret),
}

function memoryParams(input: object): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== "") query.set(key, String(value))
  }
  return query.size > 0 ? `?${query}` : ""
}

export const memoryApi: MemoryApi = {
  pilotMigration: {
    scan: (input, signal) =>
      call("/api/memory/import/pilot/scan", {
        method: "POST",
        body: JSON.stringify(input),
        signal,
      }),
    records: (scan, group, offset) =>
      call("/api/memory/import/pilot/records", {
        method: "POST",
        body: JSON.stringify({ scan, group, offset }),
      }),
    review: (input) =>
      call("/api/memory/import/pilot/review", { method: "POST", body: JSON.stringify(input) }),
    apply: (input, signal) =>
      call("/api/memory/import/pilot/apply", {
        method: "POST",
        body: JSON.stringify(input),
        signal,
      }),
    cancel: (scan) =>
      call("/api/memory/import/pilot/cancel", { method: "POST", body: JSON.stringify({ scan }) }),
  },
  activity: (project, task) =>
    call(`/api/memory/projects/${enc(project)}/tasks/${enc(task)}/activity`),
  overview: (project) => call(`/api/memory/overview${memoryParams({ project })}`),
  settings: (patch) => call("/api/memory/settings", { method: "PUT", body: JSON.stringify(patch) }),
  projects: (query = {}) => call(`/api/memory/projects${memoryParams(query)}`),
  sharing: (project, enabled) =>
    call(`/api/memory/projects/${enc(project)}/sharing`, {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),
  list: (query = {}) => call(`/api/memory/records${memoryParams(query)}`),
  read: (id) => call(`/api/memory/records/${enc(id)}`),
  retire: (id, active) =>
    call(`/api/memory/records/${enc(id)}`, {
      method: "PUT",
      body: JSON.stringify({ active }),
    }),
  confirm: (id, reason) =>
    call(`/api/memory/records/${enc(id)}/confirm`, {
      method: "PUT",
      body: JSON.stringify(reason === undefined ? {} : { reason }),
    }),
  pin: (id, pinned) =>
    call(`/api/memory/records/${enc(id)}/pin`, {
      method: "PUT",
      body: JSON.stringify({ pinned }),
    }),
  pinned: async (project) =>
    (await call<{ items: MemoryPreview[] }>(`/api/memory/projects/${enc(project)}/pinned`)).items,
  importPilot: (input) =>
    call("/api/memory/import/pilot", { method: "POST", body: JSON.stringify(input) }),
}

/** Additive build API. Kept separate so demo and test implementations of Api remain valid. */
export const interactionApi = {
  turnHome: <T>(project: string, action = "", init?: RequestInit) =>
    call<T>(`/api/interaction/turn/home/${enc(project)}${action ? `/${action}` : ""}`, init),
  task: (id: string) =>
    call<{ interaction: import("../interaction/contracts.ts").InteractionSnapshot }>(
      `/api/tasks/${enc(id)}/interaction`,
    ).then((r) => r.interaction),
  taskRoute: <T>(
    id: string,
    lane: "turn" | "shell" | "docs" | "steps",
    action: string,
    init?: RequestInit,
  ) => call<T>(`/api/tasks/${enc(id)}/interaction/${lane}/${action}`, init),
  shell: <T>(action: string, init?: RequestInit) =>
    call<T>(`/api/interaction/shell/${action}`, init),
}

/** First-start setup. Apart from `Api`, which the website's demo implements: the demo has no setup. */
export const setupApi = {
  state: () => call<{ setup: SetupState }>("/api/setup").then((r) => r.setup),
  /** A key goes through the same activation as `qualitylayer licence activate`; no key starts a trial. */
  licence: (key: string) =>
    call<Record<string, unknown>>("/api/setup/licence", {
      method: "POST",
      body: JSON.stringify({ key }),
    }).then(() => undefined),
  /** Install, calling `onStep` with each step as the server starts it. */
  finish: async (onStep: (step: string) => void): Promise<SetupFinishResult> => {
    let steps: EventSource | null = null
    if (typeof EventSource !== "undefined") {
      const opened = new EventSource("/api/setup/events")
      // The stream's first event says it is listening: only then does the install start.
      await new Promise<void>((resolve) => {
        opened.onmessage = (event: MessageEvent) => {
          try {
            const seen = JSON.parse(String(event.data)) as { type?: string; step?: string }
            if (seen.type === "step" && seen.step !== undefined) onStep(seen.step)
          } catch {
            // an event the page cannot read is only a step it does not show
          }
          resolve()
        }
        opened.onerror = () => resolve()
      })
      steps = opened
    }
    try {
      const result = await call<SetupFinishResult>("/api/setup", { method: "POST", body: "{}" })
      return { codexHooks: result.codexHooks }
    } finally {
      steps?.close()
    }
  },
}

export type SetupApi = Omit<typeof setupApi, "finish"> & {
  finish: (onStep: (step: string) => void) => Promise<SetupFinishResult> | Promise<void>
}
