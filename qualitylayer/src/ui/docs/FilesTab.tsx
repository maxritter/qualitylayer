import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileCodeIcon,
  FileTextIcon,
  FolderIcon,
  ImageIcon,
  LockIcon,
} from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { agentFileOf, CHECKS_RECORD, NAMES, type TaskFile } from "../../core/docs/names.ts"
import { FLOW_STEPS, flowStepOf } from "../../core/flow.ts"
import { type Api, api as liveApi, type TaskDetail } from "../api.ts"
import { planningOver } from "../artifact/TaskArtifact.tsx"
import { DocPathChip, fullPathOf, viewFile } from "../DocPathChip.tsx"
import { TaskChanges } from "../files/ChangesCard.tsx"
import { useEventCount, useQuery } from "../hooks.ts"
import { type Who, WhoMark } from "../kit/WhoMark.tsx"
import { offersHostActions } from "../machines/framed.ts"
import { agentInfo, isEarlier, stepView } from "../model.ts"
import { attentionCount } from "../shell/TaskTopBar.tsx"
import { FileActions } from "../sidebar/FileActions.tsx"
import { useTurnSnapshot } from "../turn/projection.ts"
import { type DocumentState, documentStates, writtenCount } from "./document-states.ts"
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

/** The Plan's agents' file, listed in the Files tab beside the Plan. */
const PLAN_AGENTS = agentFileOf("plan")

/** The mark in front of a document's step: who has the file, or that it is not there yet. */
const DOCUMENT_MARK: Record<DocumentState, Who> = {
  "not yet": "todo",
  "started early": "agent",
  "being written": "agent",
  "your turn": "you",
  stopped: "stop",
  done: "done",
}

export type FilesArtifactContent = ReactNode | ((afterDrafts: ReactNode) => ReactNode)

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
  api?: Pick<Api, "openFile" | "taskArtifacts" | "taskRecords"> &
    Partial<Pick<Api, "changes" | "config" | "putConfig" | "openIn">>
  onCopy?: (text: string, note: string) => void
  artifacts?: FilesArtifactContent
  version?: number
}) {
  const selected = viewFile(task, view)
  const record = useDocumentRecord()
  const recordFocus = useRecordFocus()
  const pane = useRef<HTMLDivElement | null>(null)
  const recordPath = record?.taskId === task.id ? record.path : null
  const selectedName = recordPath ?? selected?.name
  const [allArtifacts, setAllArtifacts] = useState(false)
  const turn = useTurnSnapshot(task.id)
  // The three files are one step list: the person is needed in the step it is at when something
  // there is open.
  const nowStep = flowStepOf(task.stage)
  // A task of an earlier workflow has no steps: its files are listed as they are, and open as plain files.
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
  const focusReady =
    recordFocus !== null &&
    (task.files.some((file) => file.exists && file.name === recordFocus.path) ||
      records.data?.some((entry) => entry.exists && entry.name === recordFocus.path) === true)
  useEffect(() => {
    const host = pane.current
    if (
      recordFocus?.taskId !== task.id ||
      !focusReady ||
      !host ||
      host.closest("[inert]") ||
      host.getBoundingClientRect().width === 0
    )
      return
    const link = [...host.querySelectorAll<HTMLButtonElement>("button[data-record-path]")].find(
      (button) => button.dataset.recordPath === recordFocus.path,
    )
    if (!link) return
    const group = link.closest("details")
    if (group) group.open = true
    link.focus()
    setRecordFocus(null)
  }, [recordFocus, focusReady, task.id])
  const artifactEvents = useEventCount("artifacts")
  const artifacts = useQuery(
    () =>
      artifactList === undefined && api?.taskArtifacts
        ? api.taskArtifacts(task.id, false)
        : Promise.resolve(null),
    [task.id, api, version, artifactEvents, artifactList === undefined],
  )
  const all = artifacts.data?.task ?? []
  const shown = allArtifacts || all.length <= 6 ? all : all.slice(0, 5)
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
  const selectedPath = (target: string) => {
    if (!selectedName || full === null) return null
    return (
      <div className="ir-file-path" data-testid="selected-file-path">
        <code title={full}>{selectedName}</code>
        {api && onCopy ? (
          <div className="rs-acts">
            <FileActions
              detail={task}
              file={selectedFile ?? { name: selectedName, exists: true }}
              api={api}
              onCopy={onCopy}
              openable={/\.(md|txt)$/i.test(selectedName)}
            />
            <DocPathChip
              detail={task}
              view={target}
              agent={task.session ? agentInfo(task.session.agent).name : null}
              api={api}
              onCopy={onCopy}
              onOpen={onOpen}
              compact
            />
          </div>
        ) : null}
      </div>
    )
  }
  const supporting = (
    <FilesSupport
      task={task}
      view={view}
      onOpen={onOpen}
      recordPath={recordPath}
      {...(api !== undefined ? { api } : {})}
    />
  )
  /** One document's row: its mark, step and file, or a quiet row while it is not written. */
  const documentRow = (
    step: (typeof documents)[number]["step"],
    label: string,
    file: (typeof documents)[number]["file"],
    state: (typeof documents)[number]["state"],
  ) => {
    const mark = <WhoMark who={DOCUMENT_MARK[state]} running={state === "being written"} />
    if (file === undefined || !file.exists)
      return (
        <li key={step}>
          <div
            className="ir-doc-step off"
            data-testid="document-row"
            data-step={step}
            data-state={state}
            aria-disabled="true"
          >
            {mark}
            <span className="ir-doc-step-l">
              <b className="ir-doc-step-t">{label}</b>
            </span>
            <small className="ir-doc-step-k">{state}</small>
          </div>
        </li>
      )
    const active = selectedName === file.name && recordPath === null
    return (
      <li
        key={step}
        data-file={file.name}
        className="ir-doc-entry"
        data-selected={active || undefined}
        data-state={state}
        data-testid={active ? "selected-file-path" : undefined}
      >
        <button
          type="button"
          className="ir-doc-step"
          data-testid="document-row"
          data-step={step}
          data-state={state}
          aria-current={active ? "page" : undefined}
          aria-label={`${label} ${file.name}`}
          title={fullPathOf(task, file.name)}
          onClick={() => openFile(file)}
        >
          {mark}
          <span className="ir-doc-step-l">
            <b className="ir-doc-step-t">{label}</b>
            <span>{file.name}</span>
          </span>
        </button>
        {active && api && onCopy ? (
          <FileActions detail={task} file={file} api={api} onCopy={onCopy} compact />
        ) : null}
        {/* The filled mark says done; a state word appears only while the file runs, waits or stopped. */}
        {state === "done" ? null : <small className="ir-doc-step-k">{state}</small>}
      </li>
    )
  }
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
      <div className="ir-files-groups" data-testid="documents">
        <h3>
          <span>Documents</span>
          <span>
            {earlierDocs !== null
              ? `${earlierDocs.length}`
              : `${writtenCount(documents)} of ${documents.length}`}
          </span>
        </h3>
        <ol className="ir-docs-steps">
          {(earlierDocs ?? []).map((doc) => {
            const active = selectedName === doc.name && recordPath === null
            return (
              <li
                key={doc.name}
                data-file={doc.name}
                className="ir-doc-entry"
                data-selected={active || undefined}
              >
                <button
                  type="button"
                  className="ir-doc-step"
                  data-testid="document-row"
                  aria-current={active ? "page" : undefined}
                  aria-label={`${doc.label} ${doc.name}`}
                  title={fullPathOf(task, doc.name)}
                  onClick={() => {
                    setDocumentRecord(null)
                    onOpen(doc.name)
                    setDocumentFullSize(true)
                  }}
                >
                  <span className="ir-doc-step-l">
                    <b className="ir-doc-step-t">{doc.label}</b>
                    <span>{doc.name}</span>
                  </span>
                </button>
              </li>
            )
          })}
          {(earlierDocs !== null ? [] : documents).flatMap(({ step, file, state }) => {
            const label = FLOW_STEPS.find((s) => s.id === step)?.label ?? step
            // A task started from the person's plan: its original follows the Plan that maps it,
            // read-only, opening in the Reader.
            const row = documentRow(step, label, file, state)
            return step === "plan" && task.original
              ? [
                  row,
                  <li key="original" className="ir-doc-entry" data-file={task.original.file}>
                    <button
                      type="button"
                      className="ir-doc-step"
                      data-testid="original-row"
                      aria-current={selectedName === task.original.file ? "page" : undefined}
                      aria-label={`Original plan ${task.original.file}, read-only`}
                      title={`${fullPathOf(task, task.original.file)} · kept exactly as given`}
                      onClick={() => onOpen(task.original?.file ?? "")}
                    >
                      <LockIcon size={12} aria-hidden="true" />
                      <span className="ir-doc-step-l">
                        <b className="ir-doc-step-t">Original plan</b>
                        <span>{task.original.file}</span>
                      </span>
                    </button>
                    <small className="ir-doc-step-k">
                      {task.original.intact ? "read-only" : "changed"}
                    </small>
                  </li>,
                ]
              : [row]
          })}
        </ol>
        {task.support ? (
          // A two-file Plan's supporting files: written for the build, never a step, folded here.
          <details className="ir-files-support" data-testid="build-context">
            <summary>
              <ChevronRightIcon size={13} aria-hidden="true" className="ir-files-support-chev" />
              <span>Build context</span>
              <small>
                {task.support.assets.length > 0
                  ? `notes · ${task.support.assets.length} ${task.support.assets.length === 1 ? "picture" : "pictures"}`
                  : "for agents"}
              </small>
            </summary>
            <ol className="ir-docs-steps">
              <li className="ir-doc-entry" data-file={PLAN_AGENTS}>
                {task.support.context === "written" ? (
                  <button
                    type="button"
                    className="ir-doc-step"
                    data-testid="support-row"
                    aria-current={selectedName === PLAN_AGENTS ? "page" : undefined}
                    aria-label={`Plan context ${PLAN_AGENTS}, read-only`}
                    title={`${fullPathOf(task, PLAN_AGENTS)} · notes for the build; the Plan is the agreement`}
                    onClick={() => onOpen(PLAN_AGENTS)}
                  >
                    <FileCodeIcon size={12} aria-hidden="true" />
                    <span className="ir-doc-step-l">
                      <b className="ir-doc-step-t">Plan context</b>
                      <span>{PLAN_AGENTS}</span>
                    </span>
                  </button>
                ) : (
                  <div
                    className="ir-doc-step off"
                    data-testid="support-row"
                    aria-disabled="true"
                    title="The planner writes it before the Plan is ready to approve"
                  >
                    <FileCodeIcon size={12} aria-hidden="true" />
                    <span className="ir-doc-step-l">
                      <b className="ir-doc-step-t">Plan context</b>
                      <span>{PLAN_AGENTS}</span>
                    </span>
                    <small className="ir-doc-step-k">not written yet</small>
                  </div>
                )}
              </li>
              {(offersHostActions() ? task.support.assets : []).map((file) => (
                <li key={file} className="ir-doc-entry" data-file={file}>
                  <button
                    type="button"
                    className="ir-doc-step"
                    data-testid="support-picture"
                    aria-label={`Show the Plan's picture ${file} in its folder`}
                    title={`${fullPathOf(task, file)} · linked from ${NAMES.plan}`}
                    onClick={() => void api?.openFile(task.id, file, "reveal")}
                  >
                    <ImageIcon size={12} aria-hidden="true" />
                    <span className="ir-doc-step-l">
                      <b className="ir-doc-step-t">Plan picture</b>
                      <span>{file}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>
      {typeof artifactList === "function"
        ? artifactList(supporting)
        : (artifactList ?? (
            <section>
              <h3>
                <span>Artifacts</span>
                <span>{all.length ? all.length : planningOver(task) ? "none" : "none yet"}</span>
              </h3>
              {shown.map((artifact) => (
                <button
                  type="button"
                  className="ir-file-row"
                  key={artifact.file}
                  title={`${artifact.title} · ${artifact.file}`}
                  aria-current={view === artifact.file ? "page" : undefined}
                  onClick={() => {
                    setDocumentRecord(null)
                    onOpen(artifact.file)
                  }}
                >
                  <ImageIcon size={13} aria-hidden="true" />
                  <span>
                    {artifact.pages !== undefined
                      ? artifact.name
                      : artifact.file.replace(/^.*\//, "").replace(/\.html$/, "")}
                  </span>
                  <small>
                    {artifact.comments
                      ? `${artifact.comments} ${artifact.comments === 1 ? "comment" : "comments"}`
                      : ""}
                  </small>
                </button>
              ))}
              {shown.length < all.length ? (
                <button type="button" className="ir-file-row" onClick={() => setAllArtifacts(true)}>
                  <ChevronDownIcon size={13} aria-hidden="true" />
                  <span>{all.length - shown.length} more</span>
                </button>
              ) : null}
              {all.length === 0 ? (
                <p className="ir-doc-note">
                  {planningOver(task)
                    ? "No question or decision in planning needed one."
                    : "drawn while planning, when a question or decision needs one"}
                </p>
              ) : null}
            </section>
          ))}
      {typeof artifactList === "function" ? null : supporting}
      <FilesRecords
        task={task}
        {...(api !== undefined ? { api } : {})}
        {...(records.data?.some((entry) => entry.name === CHECKS_RECORD)
          ? {
              checks: {
                selected: recordPath === CHECKS_RECORD,
                open: () => {
                  onOpen(view)
                  setDocumentRecord({ taskId: task.id, path: CHECKS_RECORD })
                },
              },
            }
          : {})}
      />
      <FilesFeedbackHistory task={task} />
      {/* A file with no row here (a record opened from a link): its path under its own heading. */}
      {!selectedDocument && selectedName && full ? (
        <section aria-label="Open file" data-testid="open-file">
          <h3>
            <span>Open file</span>
          </h3>
          {selectedPath(view)}
        </section>
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
