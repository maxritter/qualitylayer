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

export function ArtifactManage({
  manager,
  onClose,
}: {
  manager: ArtifactManager
  onClose: () => void
}) {
  const { api, where, file, readOnly, onChanged } = manager
  const scope = where.scope
  const owner = where.id
  const [source, setSource] = useState<ArtifactSource | null>(null)
  const [provenance, setProvenance] = useState<ArtifactHistory | null>(null)
  const history = provenance?.revisions ?? []
  const [tab, setTab] = useState<"details" | "source" | "history">("details")
  const [title, setTitle] = useState("")
  const [purpose, setPurpose] = useState("")
  const [name, setName] = useState("")
  const [html, setHtml] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [reload, setReload] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the reload counter is an explicit user retry
  useEffect(() => {
    let active = true
    const address = { scope, id: owner }
    const readHistory = api.artifactProvenance
      ? api.artifactProvenance(address, file)
      : api.artifactHistory?.(address, file).then((revisions) => ({ revisions }))
    Promise.all([api.artifactSource?.(address, file), readHistory])
      .then(([read, revisions]) => {
        if (!active || !read) return
        setSource(read)
        setHtml(read.html)
        setTitle(read.meta.title)
        setPurpose(read.meta.purpose)
        setProvenance(revisions ?? { revisions: [] })
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
      const changed = await api.artifactMutate(where, file, mutation)
      onChanged(changed.file, changed.deleted)
      if (changed.deleted || changed.file !== file) {
        onClose()
        return
      }
      const read = await api.artifactSource?.(where, file)
      if (read) {
        setSource(read)
        setHtml(read.html)
        setTitle(read.meta.title)
        setPurpose(read.meta.purpose)
      }
      setProvenance(
        api.artifactProvenance
          ? await api.artifactProvenance(where, file)
          : { revisions: (await api.artifactHistory?.(where, file)) ?? [] },
      )
      setNotice("Artifact saved")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the artifact")
    } finally {
      setBusy(false)
    }
  }
  const expected = source?.revision ?? "0"
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
            {value === "details" ? "Details" : value === "source" ? "Source" : "History"}
          </button>
        ))}
      </fieldset>
      {error ? (
        <div role="alert">
          <p>
            {error} Your edits are kept here. Reload replaces them with the saved artifact; copy any
            changes you want to keep first.
          </p>
          <button
            type="button"
            className="q-btn quiet sm"
            onClick={() => {
              setError(null)
              setReload((n) => n + 1)
            }}
          >
            Reload saved artifact
          </button>
        </div>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {source === null && !error ? <p role="status">Reading artifact…</p> : null}
      {source && tab === "details" ? (
        <>
          {error ? null : (
            <dl className="ds-facts">
              <ArtifactProvenance
                history={provenance}
                loading={!provenance && !error}
                onOpenTask={manager.onOpenTask}
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
            onClick={() => void change({ action: "metadata", expected, title, purpose })}
            aria-label="Save artifact details"
          >
            Save details
          </button>
          {!readOnly ? (
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
                  onClick={() => void change({ action: "copy", name, expected })}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="q-btn quiet sm"
                  disabled={busy || !name.trim()}
                  onClick={() => void change({ action: "rename", name, expected })}
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
                    onClick={() => void change({ action: "delete", expected })}
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
                <button
                  type="button"
                  className="q-btn quiet sm"
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete…
                </button>
              )}
            </>
          ) : (
            <p>This task's artifacts are read-only.</p>
          )}
        </>
      ) : null}
      {source && tab === "source" ? (
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
            onClick={() => void change({ action: "write", html, expected })}
            aria-label="Save artifact source"
          >
            Save source
          </button>
          <p>The preview runs in QL's sandbox. Shared copies disable scripts.</p>
        </>
      ) : null}
      {tab === "history" ? (
        <>
          {history.length ? (
            <ol className="dm-history">
              {history.map((revision) => (
                <li key={revision.id}>
                  <b>{revision.title}</b>
                  <small>
                    {new Date(revision.at).toLocaleString()} · {revision.action}
                  </small>
                  <Recorder recordedBy={revision.recordedBy} onOpenTask={manager.onOpenTask} />
                  <button
                    type="button"
                    className="q-btn quiet sm"
                    disabled={busy || readOnly || revision.revision === source?.revision}
                    onClick={() => void change({ action: "restore", expected, id: revision.id })}
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
            The newest 60 revisions per task or project are kept. Your current artifact is saved
            before restoration.
          </p>
        </>
      ) : null}
    </aside>
  )
}
