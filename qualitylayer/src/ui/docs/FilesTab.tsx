import { FileTextIcon, FolderIcon } from "lucide-react"
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react"
import { CHECKS_RECORD, type TaskFile } from "../../core/docs/names.ts"
import { flowStepOf } from "../../core/flow.ts"
import { type Api, api as liveApi, type TaskDetail } from "../api.ts"
import { fullPathOf, viewFile } from "../DocPathChip.tsx"
import { TaskChanges } from "../files/ChangesCard.tsx"
import { useEventCount, useQuery } from "../hooks.ts"
import { isEarlier, stepView } from "../model.ts"
import { attentionCount } from "../shell/TaskTopBar.tsx"
import { useTurnSnapshot } from "../turn/projection.ts"
import { documentStates } from "./document-states.ts"
import {
  FilesArtifactsSection,
  FilesDocumentsSection,
  type FilesTabApi,
  SelectedFilePath,
} from "./FilesTabSections.tsx"
import { FilesFeedbackHistory } from "./files/FeedbackHistory.tsx"
import { FilesRecords } from "./files/Records.tsx"
import { FilesReviews } from "./files/Reviews.tsx"
import {
  setDocumentFullSize,
  setDocumentRecord,
  setRecordFocus,
  useDocumentRecord,
  useRecordFocus,
} from "./mode.ts"
import "./docs.css"

export type FilesArtifactContent = ReactNode | ((afterDrafts: ReactNode) => ReactNode)

function isHostVisible(host: HTMLDivElement | null): host is HTMLDivElement {
  return host !== null && !host.closest("[inert]") && host.getBoundingClientRect().width > 0
}

function useRecordFocusEffect(
  pane: RefObject<HTMLDivElement | null>,
  task: TaskDetail,
  records: readonly TaskDetail["docs"][number][] | null,
) {
  const recordFocus = useRecordFocus()
  const focusReady =
    recordFocus !== null &&
    (task.files.some((file) => file.exists && file.name === recordFocus.path) ||
      records?.some((entry) => entry.exists && entry.name === recordFocus.path) === true)
  useEffect(() => {
    const host = pane.current
    if (recordFocus?.taskId !== task.id || !focusReady || !isHostVisible(host)) return
    const link = [...host.querySelectorAll<HTMLButtonElement>("button[data-record-path]")].find(
      (button) => button.dataset.recordPath === recordFocus.path,
    )
    if (!link) return
    const group = link.closest("details")
    if (group) group.open = true
    link.focus()
    setRecordFocus(null)
  }, [pane, recordFocus, focusReady, task.id])
}

export function FilesTab({
  task,
  view,
  onOpen,
  api,
  onCopy,
  artifacts: artifactList,
  version = 0,
}: {
  task: TaskDetail
  view: string
  onOpen: (view: string) => void
  /** The branch card needs the change, the editor setting and Open in; a stub without them has no card. */
  api?: FilesTabApi
  onCopy?: (text: string, note: string) => void
  artifacts?: FilesArtifactContent
  version?: number
}) {
  const selected = viewFile(task, view)
  const record = useDocumentRecord()
  const pane = useRef<HTMLDivElement | null>(null)
  const recordPath = record?.taskId === task.id ? record.path : null
  const selectedName = recordPath ?? selected?.name
  const [allArtifacts, setAllArtifacts] = useState(false)
  const turn = useTurnSnapshot(task.id)
  const nowStep = flowStepOf(task.stage)
  const earlierDocs = isEarlier(task) ? task.docs.filter((doc) => doc.exists) : null
  const documents = documentStates(
    task,
    nowStep !== null && attentionCount(task, stepView(task, nowStep), turn) > 0,
  )
  const records = useQuery(
    () =>
      api?.taskRecords && (api === liveApi || api.taskRecords !== liveApi.taskRecords)
        ? api.taskRecords(task.id)
        : Promise.resolve([]),
    [task.id, api, version],
  )
  useRecordFocusEffect(pane, task, records.data)
  const artifactEvents = useEventCount("artifacts")
  const artifacts = useQuery(
    () =>
      artifactList === undefined && api?.taskArtifacts
        ? api.taskArtifacts(task.id, false)
        : Promise.resolve(null),
    [task.id, api, version, artifactEvents, artifactList === undefined],
  )
  const openFile = (file: TaskFile) => {
    setDocumentRecord(null)
    onOpen(file.name)
    setDocumentFullSize(true)
  }
  const selectedFile =
    task.files.find((file) => file.name === selectedName) ??
    records.data?.find((file) => file.name === selectedName)
  const full = selectedName ? fullPathOf(task, selectedName) : null
  const selectedDocument = documents.some(
    ({ file }) => file?.exists && file.name === selectedName && recordPath === null,
  )
  const supporting = (
    <FilesSupport
      task={task}
      view={view}
      onOpen={onOpen}
      recordPath={recordPath}
      {...(api !== undefined ? { api } : {})}
    />
  )
  const hasChecks = records.data?.some((entry) => entry.name === CHECKS_RECORD)
  const checksProp = hasChecks
    ? {
        checks: {
          selected: recordPath === CHECKS_RECORD,
          open: () => {
            onOpen(view)
            setDocumentRecord({ taskId: task.id, path: CHECKS_RECORD })
          },
        },
      }
    : {}
  return (
    <div ref={pane} className="ir-files" data-testid="files-tab">
      <div className="ir-files-name">
        <FolderIcon size={14} aria-hidden="true" />
        <code title={task.dir}>{task.slug}</code>
        {onCopy ? (
          <button
            type="button"
            className="q-link"
            onClick={() => onCopy(task.dir, "Copied the task folder path")}
          >
            Copy path
          </button>
        ) : null}
      </div>
      <TaskChanges task={task} api={api} version={version} />
      <FilesDocumentsSection
        task={task}
        earlierDocs={earlierDocs}
        documents={documents}
        selectedName={selectedName}
        recordPath={recordPath}
        api={api}
        onCopy={onCopy}
        onOpen={onOpen}
        onOpenFile={openFile}
      />
      {typeof artifactList === "function"
        ? artifactList(supporting)
        : (artifactList ?? (
            <FilesArtifactsSection
              task={task}
              view={view}
              all={artifacts.data?.task ?? []}
              allArtifacts={allArtifacts}
              onShowAll={() => setAllArtifacts(true)}
              onOpen={onOpen}
            />
          ))}
      {typeof artifactList === "function" ? null : supporting}
      <FilesRecords task={task} {...(api !== undefined ? { api } : {})} {...checksProp} />
      <FilesFeedbackHistory task={task} />
      {/* A file with no row here (a record opened from a link): its path under its own heading. */}
      {!selectedDocument && selectedName && full ? (
        <SelectedFilePath
          task={task}
          view={view}
          selectedName={selectedName}
          selectedFile={selectedFile}
          full={full}
          api={api}
          onCopy={onCopy}
          onOpen={onOpen}
        />
      ) : null}
    </div>
  )
}

function FilesSupport({
  task,
  view,
  onOpen,
  api,
  recordPath,
}: {
  task: TaskDetail
  view: string
  onOpen: (view: string) => void
  api?: Pick<Api, "openFile" | "taskArtifacts" | "taskRecords">
  recordPath: string | null
}) {
  return (
    <>
      <FilesReviews
        task={task}
        view={view}
        onOpen={onOpen}
        {...(api !== undefined ? { api } : {})}
      />
      <section aria-label="Task memory" data-testid="files-memory">
        <h3>
          <span>Memory</span>
        </h3>
        <button
          type="button"
          className="ir-file-row"
          title="memory-activity.md · the lessons this task used and saved, by step"
          aria-current={recordPath === "memory-activity.md" ? "page" : undefined}
          onClick={() => {
            onOpen(view)
            setDocumentRecord({ taskId: task.id, path: "memory-activity.md" })
          }}
        >
          <FileTextIcon size={13} aria-hidden="true" />
          <span>Memory</span>
          <small>by step</small>
        </button>
      </section>
    </>
  )
}
