// Add as a page of a lasting artifact: the task's draft is recorded as a draft on it, so it folds in at
// Review as a new page. A one-page draft takes the page name asked for; a folder's pages keep theirs.

import { ArrowRightIcon, FileIcon, GitMergeIcon, ShapesIcon, TriangleAlertIcon } from "lucide-react"
import { useId, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { Artifact } from "../../core/artifact/format.ts"
import type { Api, DraftedOn, LastingArtifact } from "../api.ts"
import { slugOf } from "./task-lasting.ts"
import "./task-lasting.css"

export function AddPageDialog({
  api,
  task,
  draft,
  artifact,
  onClose,
  onAdded,
}: {
  api: Pick<Api, "draftOnArtifact">
  task: { id: string }
  draft: Artifact | null
  artifact: LastingArtifact | null
  onClose: () => void
  onAdded: (result: DraftedOn, artifact: LastingArtifact) => void
}) {
  return (
    <Dialog
      open={draft !== null && artifact !== null}
      onOpenChange={(next) => (next ? undefined : onClose())}
    >
      {draft !== null && artifact !== null ? (
        <AddPageForm
          key={`${draft.file}:${artifact.name}`}
          api={api}
          task={task}
          draft={draft}
          artifact={artifact}
          onClose={onClose}
          onAdded={onAdded}
        />
      ) : null}
    </Dialog>
  )
}

function AddPageFlow({
  draftName,
  artifactTitle,
  gained,
}: {
  draftName: string
  artifactTitle: string
  gained: readonly string[]
}) {
  const gainedNames = gained.map((each) => each.replace(/\.html$/, ""))
  const gainedWord = `+ ${gained.length} ${gained.length === 1 ? "page" : "pages"}`
  return (
    <div className="ap-flow" data-testid="add-page-flow">
      <span className="ap-node ap-from" title={draftName}>
        <FileIcon aria-hidden="true" size={14} />
        <code>{draftName}</code>
      </span>
      <ArrowRightIcon aria-hidden="true" size={14} className="ap-arrow" />
      <span className="ap-node ap-to" title={artifactTitle}>
        <ShapesIcon aria-hidden="true" size={14} />
        <b>{artifactTitle}</b>
        <small title={gained.join(", ")}>
          {gainedWord}
          {gained.length <= 3 ? ` (${gainedNames.join(", ")})` : ""}
        </small>
      </span>
    </div>
  )
}

function AddPageNotices({
  collisions,
  artifactTitle,
  problem,
}: {
  collisions: readonly string[]
  artifactTitle: string
  problem: string | null
}) {
  return (
    <>
      {collisions.length > 0 ? (
        <p className="ap-warn" role="status">
          <TriangleAlertIcon aria-hidden="true" size={14} />
          {collisions.join(", ")} already {collisions.length === 1 ? "exists" : "exist"} in{" "}
          {artifactTitle}: it is replaced.
        </p>
      ) : null}
      <p className="ap-fold">
        <GitMergeIcon aria-hidden="true" size={14} />
        Folds in when this task ships
      </p>
      {problem !== null ? (
        <p className="kd-bad" role="alert">
          {problem}
        </p>
      ) : null}
    </>
  )
}

function AddPageForm({
  api,
  task,
  draft,
  artifact,
  onClose,
  onAdded,
}: {
  api: Pick<Api, "draftOnArtifact">
  task: { id: string }
  draft: Artifact
  artifact: LastingArtifact
  onClose: () => void
  onAdded: (result: DraftedOn, artifact: LastingArtifact) => void
}) {
  const single = draft.pages === undefined
  const [page, setPage] = useState(slugOf(draft.title || draft.name) || draft.name)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const pageId = useId()
  const file = page.endsWith(".html") ? page : `${page}.html`
  const gained = single ? [file] : (draft.pages?.map((each) => each.page) ?? [])
  const collisions = gained.filter((each) => artifact.pages.some((have) => have.page === each))
  const disabled = busy || (single && page.trim() === "")

  const submit = async () => {
    if (disabled) return
    setBusy(true)
    setProblem(null)
    try {
      const result = await api.draftOnArtifact(task.id, {
        draft: draft.name,
        artifact: artifact.name,
        ...(single ? { page: file } : {}),
      })
      onAdded(result, artifact)
      onClose()
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "The page could not be added.")
      setBusy(false)
    }
  }

  return (
    <DialogContent className="kd sm:max-w-[520px]" data-testid="add-page-dialog">
      <DialogHeader>
        <DialogTitle className="kd-title">
          <FileIcon aria-hidden="true" size={16} />
          Add as a page of {artifact.title}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {draft.name} folds into {artifact.title} when this task ships.
        </DialogDescription>
      </DialogHeader>
      <form
        className="kd-form"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <AddPageFlow draftName={draft.name} artifactTitle={artifact.title} gained={gained} />
        {single ? (
          <label className="kd-field" htmlFor={pageId}>
            Page name
            <input
              id={pageId}
              className="kd-input"
              value={page}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setPage(event.target.value)}
            />
          </label>
        ) : null}
        <AddPageNotices collisions={collisions} artifactTitle={artifact.title} problem={problem} />
        <div className="kd-actions">
          <button type="button" className="q-btn quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="q-btn primary" disabled={disabled}>
            Add as a page
          </button>
        </div>
      </form>
    </DialogContent>
  )
}
