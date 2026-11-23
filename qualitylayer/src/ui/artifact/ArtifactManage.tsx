import { useEffect, useState } from "react"
import type {
  ArtifactHistory,
  ArtifactMutation,
  ArtifactSource,
} from "../../core/artifact/workspace.ts"
import type { Api, ArtifactWhere } from "../api.ts"
import { ArtifactProvenance, Recorder } from "../artifacts/ArtifactProvenance.tsx"
import "./manage.css"

export type ArtifactManager = {
  api: Api
  where: ArtifactWhere
  file: string
  readOnly: boolean
  onChanged: (file: string, deleted?: boolean) => void
  onOpenTask?: (id: string) => void
}

async function fetchProvenance(
  api: Api,
  where: ArtifactWhere,
  file: string,
): Promise<ArtifactHistory> {
  if (api.artifactProvenance) return api.artifactProvenance(where, file)
  return { revisions: (await api.artifactHistory?.(where, file)) ?? [] }
}

function DetailsTab({
  provenance,
  error,
  onOpenTask,
  title,
  setTitle,
  purpose,
  setPurpose,
  name,
  setName,
  busy,
  readOnly,
  expected,
  confirmDelete,
  setConfirmDelete,
  onChange,
}: {
  provenance: ArtifactHistory | null
  error: string | null
  onOpenTask?: (id: string) => void
  title: string
  setTitle: (v: string) => void
  purpose: string
  setPurpose: (v: string) => void
  name: string
  setName: (v: string) => void
  busy: boolean
  readOnly: boolean
  expected: string
  confirmDelete: boolean
  setConfirmDelete: (v: boolean) => void
  onChange: (mutation: ArtifactMutation) => void
}) {
  return (
    <>
      {error ? null : (
        <dl className="ds-facts">
          <ArtifactProvenance
            history={provenance}
            loading={!provenance && !error}
            onOpenTask={onOpenTask}
          />
        </dl>
      )}
      <label>
        Title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={300}
          readOnly={readOnly}
        />
      </label>
      <label>
        Purpose
        <textarea
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          maxLength={2000}
          readOnly={readOnly}
        />
      </label>
      <button
        type="button"
        className="q-btn sm"
        disabled={busy || readOnly}
        onClick={() => onChange({ action: "metadata", expected, title, purpose })}
        aria-label="Save artifact details"
      >
        Save details
      </button>
      {readOnly ? (
        <p>This task's artifacts are read-only.</p>
      ) : (
        <>
          <label>
            New artifact name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="welcome-alternative"
            />
          </label>
          <div className="dm-actions">
            <button
              type="button"
              className="q-btn quiet sm"
              disabled={busy || !name.trim()}
              onClick={() => onChange({ action: "copy", name, expected })}
            >
              Duplicate
            </button>
            <button
              type="button"
              className="q-btn quiet sm"
              disabled={busy || !name.trim()}
              onClick={() => onChange({ action: "rename", name, expected })}
            >
              Rename
            </button>
          </div>
          {confirmDelete ? (
            <fieldset aria-label="Delete this artifact">
              <p>Remove this artboard? Its source stays in version history for recovery.</p>
              <button
                type="button"
                className="q-btn q-delete-confirm sm"
                disabled={busy}
                onClick={() => onChange({ action: "delete", expected })}
              >
                Delete
              </button>
              <button
                type="button"
                className="q-btn quiet sm"
                onClick={() => setConfirmDelete(false)}
              >
                Keep artifact
              </button>
            </fieldset>
          ) : (
            <button type="button" className="q-btn quiet sm" onClick={() => setConfirmDelete(true)}>
              Delete…
            </button>
          )}
        </>
      )}
    </>
  )
}

function SourceTab({
  source,
  html,
  setHtml,
  busy,
  readOnly,
  expected,
  onChange,
}: {
  source: ArtifactSource
  html: string
  setHtml: (v: string) => void
  busy: boolean
  readOnly: boolean
  expected: string
  onChange: (mutation: ArtifactMutation) => void
}) {
  return (
    <>
      <label>
        HTML source
        <textarea
          className="dm-source"
          spellCheck={false}
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          readOnly={readOnly}
        />
      </label>
      <button
        type="button"
        className="q-btn sm"
        disabled={busy || readOnly || html === source.html}
        onClick={() => onChange({ action: "write", html, expected })}
        aria-label="Save artifact source"
      >
        Save source
      </button>
      <p>The preview runs in QL's sandbox. Shared copies disable scripts.</p>
    </>
  )
}

function HistoryTab({
  history,
  currentRevision,
  busy,
  readOnly,
  expected,
  onOpenTask,
  onChange,
}: {
  history: ArtifactHistory["revisions"]
  currentRevision: string | undefined
  busy: boolean
  readOnly: boolean
  expected: string
  onOpenTask?: (id: string) => void
  onChange: (mutation: ArtifactMutation) => void
}) {
  return (
    <>
      {history.length ? (
        <ol className="dm-history">
          {history.map((revision) => (
            <li key={revision.id}>
              <b>{revision.title}</b>
              <small>
                {new Date(revision.at).toLocaleString()} · {revision.action}
              </small>
              <Recorder recordedBy={revision.recordedBy} onOpenTask={onOpenTask} />
              <button
                type="button"
                className="q-btn quiet sm"
                disabled={busy || readOnly || revision.revision === currentRevision}
                onClick={() => onChange({ action: "restore", expected, id: revision.id })}
              >
                Restore revision
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p>No saved revisions yet. Your next edit will keep this source.</p>
      )}
      <p>
        The newest 60 revisions per task or project are kept. Your current artifact is saved before
        restoration.
      </p>
    </>
  )
}

const TAB_LABELS = { details: "Details", source: "Source", history: "History" } as const

function ManageStatusBanners({
  error,
  notice,
  loading,
  onReload,
}: {
  error: string | null
  notice: string
  loading: boolean
  onReload: () => void
}) {
  return (
    <>
      {error ? (
        <div role="alert">
          <p>
            {error} Your edits are kept here. Reload replaces them with the saved artifact; copy any
            changes you want to keep first.
          </p>
          <button type="button" className="q-btn quiet sm" onClick={onReload}>
            Reload saved artifact
          </button>
        </div>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {loading ? <p role="status">Reading artifact…</p> : null}
    </>
  )
}

async function applyArtifactMutation(args: {
  manager: ArtifactManager
  mutation: ArtifactMutation
  onClose: () => void
  applySource: (read: ArtifactSource) => void
  setProvenance: (next: ArtifactHistory | null) => void
  setNotice: (next: string) => void
}) {
  const { manager, mutation, onClose, applySource, setProvenance, setNotice } = args
  const { api, where, file, onChanged } = manager
  if (!api.artifactMutate) return
  const changed = await api.artifactMutate(where, file, mutation)
  onChanged(changed.file, changed.deleted)
  if (changed.deleted || changed.file !== file) {
    onClose()
    return
  }
  const read = await api.artifactSource?.(where, file)
  if (read) applySource(read)
  setProvenance(await fetchProvenance(api, where, file))
  setNotice("Artifact saved")
}

function useArtifactManageData(manager: ArtifactManager, onClose: () => void) {
  const { api, where, file, readOnly } = manager
  const { scope, id: owner } = where
  const [source, setSource] = useState<ArtifactSource | null>(null)
  const [provenance, setProvenance] = useState<ArtifactHistory | null>(null)
  const [title, setTitle] = useState("")
  const [purpose, setPurpose] = useState("")
  const [html, setHtml] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState("")
  const [reload, setReload] = useState(0)

  const applySource = (read: ArtifactSource) => {
    setSource(read)
    setHtml(read.html)
    setTitle(read.meta.title)
    setPurpose(read.meta.purpose)
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: the reload counter is an explicit user retry
  useEffect(() => {
    let active = true
    const address = { scope, id: owner }
    Promise.all([api.artifactSource?.(address, file), fetchProvenance(api, address, file)])
      .then(([read, revisions]) => {
        if (!active || !read) return
        applySource(read)
        setProvenance(revisions)
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message)
      })
    return () => {
      active = false
    }
  }, [api, scope, owner, file, reload])

  const change = async (mutation: ArtifactMutation) => {
    if (!api.artifactMutate || busy || readOnly) return
    setBusy(true)
    setError(null)
    setNotice("")
    try {
      await applyArtifactMutation({
        manager,
        mutation,
        onClose,
        applySource,
        setProvenance,
        setNotice,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the artifact")
    } finally {
      setBusy(false)
    }
  }

  return {
    source,
    provenance,
    title,
    setTitle,
    purpose,
    setPurpose,
    html,
    setHtml,
    busy,
    error,
    setError,
    notice,
    reload: () => {
      setError(null)
      setReload((n) => n + 1)
    },
    change,
  }
}

export function ArtifactManage({
  manager,
  onClose,
}: {
  manager: ArtifactManager
  onClose: () => void
}) {
  const [tab, setTab] = useState<"details" | "source" | "history">("details")
  const [name, setName] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const data = useArtifactManageData(manager, onClose)
  const expected = data.source?.revision ?? "0"
  const onChange = (m: ArtifactMutation) => void data.change(m)

  return (
    <aside className="dm-panel" aria-label="Manage artifact" data-testid="artifact-manager">
      <div className="dm-head">
        <h2>Artifact details</h2>
        <button type="button" className="q-btn quiet sm" onClick={onClose}>
          Close
        </button>
      </div>
      <fieldset className="dm-tabs" aria-label="Artifact details view">
        {(["details", "source", "history"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className="q-btn quiet sm"
            aria-pressed={tab === value}
            aria-label={`Show artifact ${value}`}
            onClick={() => setTab(value)}
          >
            {TAB_LABELS[value]}
          </button>
        ))}
      </fieldset>
      <ManageStatusBanners
        error={data.error}
        notice={data.notice}
        loading={data.source === null && !data.error}
        onReload={data.reload}
      />
      {data.source && tab === "details" ? (
        <DetailsTab
          provenance={data.provenance}
          error={data.error}
          onOpenTask={manager.onOpenTask}
          title={data.title}
          setTitle={data.setTitle}
          purpose={data.purpose}
          setPurpose={data.setPurpose}
          name={name}
          setName={setName}
          busy={data.busy}
          readOnly={manager.readOnly}
          expected={expected}
          confirmDelete={confirmDelete}
          setConfirmDelete={setConfirmDelete}
          onChange={onChange}
        />
      ) : null}
      {data.source && tab === "source" ? (
        <SourceTab
          source={data.source}
          html={data.html}
          setHtml={data.setHtml}
          busy={data.busy}
          readOnly={manager.readOnly}
          expected={expected}
          onChange={onChange}
        />
      ) : null}
      {tab === "history" ? (
        <HistoryTab
          history={data.provenance?.revisions ?? []}
          currentRevision={data.source?.revision}
          busy={data.busy}
          readOnly={manager.readOnly}
          expected={expected}
          onOpenTask={manager.onOpenTask}
          onChange={onChange}
        />
      ) : null}
    </aside>
  )
}
