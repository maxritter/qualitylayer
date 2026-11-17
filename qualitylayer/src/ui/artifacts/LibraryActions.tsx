// A Library artifact's management, the same on its row and in its viewer: Rename, Duplicate, Copy or
// show in another project, Archive or Restore, Delete. Each change goes through the guarded library
// route with the artifact's manager revision; a refusal (a stale revision, a taken name, an open draft)
// shows in the dialog and keeps what was typed. Archive and Delete are recoverable metadata: the
// artifact's folder and any source it points at stay where they are. Nothing moves between projects.

import { cn } from "cn"
import {
  ArchiveIcon,
  CopyIcon,
  EllipsisIcon,
  EyeOffIcon,
  FolderInputIcon,
  LinkIcon,
  PencilIcon,
  RotateCcwIcon,
  ShapesIcon,
  Trash2Icon,
} from "lucide-react"
import { type ReactNode, useId, useState } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { type LastingArtifact, lastingDoc } from "../../core/artifact/format.ts"
import type { Api } from "../api.ts"
import type { Route } from "../hooks.ts"
import { useViewportWidth } from "../hooks.ts"
import { InfoHint } from "../kit/InfoHint.tsx"
import { ModelPick } from "../ModelPick.tsx"
import { Segmented } from "../Segmented.tsx"
import { FOLD, useActionFold } from "../shell/useActionFold.ts"
import { Hint } from "../sidebar/Hint.tsx"
import { artifactSlug } from "./NewArtifactDialog.tsx"

export type LibraryProject = { id: string; label: string }

type Props = {
  api: Api
  artifact: LastingArtifact
  /** The project the artifact lives in (its identity is `<owner>:<name>`). */
  owner: string
  projects: LibraryProject[]
  /** Read the overview again after a change, or to clear a stale revision. */
  reload: () => void
  go: (route: Route) => void
  /** In the artifact's own header: a labelled button instead of the row's "⋯". */
  inViewer?: boolean
  /** Renamed: told before the Library is read again, so a search can keep the row in view. */
  onRenamed?: () => void
  onDeleteStart?: () => void
  onDeleteFailed?: () => void
  /** The project this row is only listed in (another project owns it): offers Stop showing there. */
  listedIn?: string
  children?: ReactNode
}

type Open = "rename" | "duplicate" | "copy" | "delete" | null

const labelOf = (projects: LibraryProject[], id: string) =>
  projects.find((p) => p.id === id)?.label ?? id

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

function ToolbarAction({
  label,
  Icon,
  disabled,
  destructive,
  onClick,
}: {
  label: string
  Icon: typeof ArchiveIcon
  disabled: boolean
  destructive?: boolean
  onClick: () => void
}) {
  return (
    <Hint label={label}>
      <button
        type="button"
        className={cn("q-btn quiet sm lib-toolbar-action", destructive && "danger")}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
      >
        <Icon size={15} aria-hidden="true" />
      </button>
    </Hint>
  )
}

export function LibraryActions({
  api,
  artifact,
  owner,
  projects,
  reload,
  go,
  inViewer,
  onRenamed,
  onDeleteStart,
  onDeleteFailed,
  listedIn,
  children,
}: Props) {
  const [open, setOpen] = useState<Open>(null)
  const [busy, setBusy] = useState(false)
  const [viewerHost, setViewerHost] = useState<HTMLElement | null>(null)
  const phone = useViewportWidth() <= 480
  const fold = useActionFold(inViewer ? viewerHost : null, phone)
  const expected = artifact.managerRevision
  const archived = artifact.archivedAt !== undefined
  const deleted = artifact.deletedAt !== undefined
  const ownerLabel = labelOf(projects, owner)

  /** Archive or Restore at once: both are undone by the other, from the toast. */
  const flip = async (action: "archive" | "restore", revision = expected) => {
    if (revision === undefined || busy) return
    setBusy(true)
    try {
      const done = await api.manageLibraryArtifact(owner, artifact.name, {
        action,
        expected: revision,
        ...(action === "archive" && artifact.changing.length > 0 ? { confirmInUse: true } : {}),
      })
      reload()
      toast.success(
        action === "archive"
          ? `Archived “${artifact.title}”. It's hidden from the Library; tasks that use it still open it.`
          : `Restored “${artifact.title}” to the ${ownerLabel} Library.`,
        {
          action: {
            label: "Undo",
            onClick: () => void flip(action === "archive" ? "restore" : "archive", done.revision),
          },
        },
      )
    } catch (cause) {
      toast.error(messageOf(cause))
      reload()
    } finally {
      setBusy(false)
    }
  }

  /** Only the listing in `listedIn` goes; the owner keeps the artifact. Undo lists it again. */
  const stopShowing = async () => {
    if (listedIn === undefined || busy) return
    const ref = `${owner}:${artifact.name}`
    const where = labelOf(projects, listedIn)
    setBusy(true)
    try {
      await api.stopShowingArtifact(listedIn, ref)
      reload()
      toast.success(`“${artifact.title}” no longer shows in ${where}. It stays in ${ownerLabel}.`, {
        action: {
          label: "Undo",
          onClick: () =>
            void api
              .alsoShowArtifact(listedIn, ref)
              .then(reload)
              .catch((cause: unknown) => toast.error(messageOf(cause))),
        },
      })
    } catch (cause) {
      toast.error(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const stale = expected === undefined
  const direct = inViewer === true && !deleted && !phone
  const directTools = direct && fold < FOLD.utilities
  const directLifecycle = direct && fold < FOLD.lifecycle
  return (
    <>
      <span
        ref={inViewer ? setViewerHost : undefined}
        className={inViewer ? "lib-toolbar-actions" : undefined}
      >
        {directTools ? (
          <span className="lib-toolbar-tools">
            <ToolbarAction
              label="Rename"
              Icon={PencilIcon}
              disabled={stale}
              onClick={() => setOpen("rename")}
            />
            <ToolbarAction
              label="Duplicate"
              Icon={CopyIcon}
              disabled={stale}
              onClick={() => setOpen("duplicate")}
            />
            <ToolbarAction
              label="Copy or show in another project"
              Icon={FolderInputIcon}
              disabled={stale}
              onClick={() => setOpen("copy")}
            />
          </span>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className={cn(inViewer ? "q-btn sm" : "lib-more")}
                aria-label={inViewer ? "Artifact actions" : `Actions for ${artifact.title}`}
                data-testid={inViewer ? "artifact-actions" : "library-row-actions"}
                title={inViewer ? "Artifact actions" : undefined}
              />
            }
          >
            <EllipsisIcon aria-hidden="true" className="size-[14px]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[250px]">
            {children}
            {listedIn !== undefined ? (
              <>
                <DropdownMenuItem disabled={busy} onClick={() => void stopShowing()}>
                  <EyeOffIcon aria-hidden="true" />
                  Stop showing in {labelOf(projects, listedIn)}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            {deleted ? (
              <DropdownMenuItem disabled={stale || busy} onClick={() => void flip("restore")}>
                <RotateCcwIcon aria-hidden="true" />
                Restore to the Library
              </DropdownMenuItem>
            ) : (
              <>
                {!directTools ? (
                  <>
                    <DropdownMenuItem disabled={stale} onClick={() => setOpen("rename")}>
                      <PencilIcon aria-hidden="true" />
                      Rename…
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={stale} onClick={() => setOpen("duplicate")}>
                      <CopyIcon aria-hidden="true" />
                      Duplicate…
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={stale} onClick={() => setOpen("copy")}>
                      <FolderInputIcon aria-hidden="true" />
                      Copy or show in another project…
                    </DropdownMenuItem>
                  </>
                ) : null}
                {!directLifecycle ? (
                  <>
                    <DropdownMenuSeparator />
                    {archived ? (
                      <DropdownMenuItem
                        disabled={stale || busy}
                        onClick={() => void flip("restore")}
                      >
                        <RotateCcwIcon aria-hidden="true" />
                        Restore to the Library
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        disabled={stale || busy}
                        onClick={() => void flip("archive")}
                      >
                        <ArchiveIcon aria-hidden="true" />
                        Archive
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={stale}
                      onClick={() => setOpen("delete")}
                    >
                      <Trash2Icon aria-hidden="true" />
                      Delete…
                    </DropdownMenuItem>
                  </>
                ) : null}
              </>
            )}
            {stale ? (
              <p className="lib-menu-note">
                This App can't manage it yet: read the Library again, or update QualityLayer.
              </p>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        {directLifecycle ? (
          <span className="lib-toolbar-lifecycle">
            <ToolbarAction
              label={archived ? "Restore" : "Archive"}
              Icon={archived ? RotateCcwIcon : ArchiveIcon}
              disabled={stale || busy}
              onClick={() => void flip(archived ? "restore" : "archive")}
            />
            <ToolbarAction
              label="Delete"
              Icon={Trash2Icon}
              disabled={stale}
              destructive
              onClick={() => setOpen("delete")}
            />
          </span>
        ) : null}
      </span>
      {open === "rename" ? (
        <RenameDialog
          api={api}
          artifact={artifact}
          owner={owner}
          reload={reload}
          onRenamed={onRenamed}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open === "duplicate" || open === "copy" ? (
        <CopyDialog
          api={api}
          artifact={artifact}
          owner={owner}
          projects={projects}
          initialTarget={
            open === "duplicate" ? owner : (projects.find((p) => p.id !== owner)?.id ?? owner)
          }
          reload={reload}
          go={go}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open === "delete" ? (
        <DeleteDialog
          api={api}
          artifact={artifact}
          owner={owner}
          ownerLabel={ownerLabel}
          reload={reload}
          onDeleteStart={onDeleteStart}
          onDeleteFailed={onDeleteFailed}
          onArchive={() => {
            setOpen(null)
            void flip("archive")
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  )
}

/** What every dialog shares: a problem line that keeps the input, and a way to read the artifact again. */
function Problem({
  id,
  problem,
  reload,
}: {
  id: string
  problem: string | null
  reload: () => void
}) {
  return (
    <p id={id} role="alert" className="ds-problem">
      {problem}
      {problem !== null ? (
        <>
          {" "}
          <button type="button" className="q-link" onClick={reload}>
            Read it again
          </button>
        </>
      ) : null}
    </p>
  )
}

function RenameDialog({
  api,
  artifact,
  owner,
  reload,
  onRenamed,
  onClose,
}: {
  api: Api
  artifact: LastingArtifact
  owner: string
  reload: () => void
  onRenamed?: () => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(artifact.title)
  const [purpose, setPurpose] = useState(artifact.purpose)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const ids = { title: useId(), purpose: useId(), problem: useId() }
  const changed = title.trim() !== artifact.title || purpose.trim() !== artifact.purpose
  const ready = title.trim() !== "" && changed && !busy && artifact.managerRevision !== undefined
  const submit = async () => {
    if (!ready || artifact.managerRevision === undefined) return
    setBusy(true)
    setProblem(null)
    try {
      await api.manageLibraryArtifact(owner, artifact.name, {
        action: "rename",
        expected: artifact.managerRevision,
        title: title.trim(),
        purpose: purpose.trim(),
      })
      onRenamed?.()
      reload()
      toast.success(`Renamed to “${title.trim()}”`)
      onClose()
    } catch (cause) {
      setProblem(messageOf(cause))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(next) => (next || busy ? undefined : onClose())}>
      <DialogContent className="ds-new" data-testid="library-rename">
        <DialogHeader>
          <DialogTitle>Rename “{artifact.title}”</DialogTitle>
          <DialogDescription>Links and history are preserved.</DialogDescription>
        </DialogHeader>
        <form
          className="ds-new-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <label className="ds-field" htmlFor={ids.title}>
            Name
            <input
              id={ids.title}
              type="text"
              value={title}
              maxLength={120}
              autoComplete="off"
              autoFocus
              aria-describedby={ids.problem}
              aria-invalid={problem !== null || title.trim() === ""}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="ds-field" htmlFor={ids.purpose}>
            What it shows
            <input
              id={ids.purpose}
              type="text"
              value={purpose}
              maxLength={600}
              autoComplete="off"
              onChange={(e) => setPurpose(e.target.value)}
            />
          </label>
          <Problem id={ids.problem} problem={problem} reload={reload} />
          <DialogFooter>
            <button type="button" className="q-btn" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="q-btn primary" disabled={!ready} aria-busy={busy}>
              {busy ? "Renaming…" : problem !== null ? "Try again" : "Rename"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CopyDialog({
  api,
  artifact,
  owner,
  projects,
  initialTarget,
  reload,
  go,
  onClose,
}: {
  api: Api
  artifact: LastingArtifact
  owner: string
  projects: LibraryProject[]
  initialTarget: string
  reload: () => void
  go: (route: Route) => void
  onClose: () => void
}) {
  const [target, setTarget] = useState(initialTarget)
  const [kind, setKind] = useState<"copy" | "also">("copy")
  const [title, setTitle] = useState(
    initialTarget === owner ? `${artifact.title} copy` : artifact.title,
  )
  const [purpose, setPurpose] = useState(artifact.purpose)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const ids = { target: useId(), title: useId(), purpose: useId(), problem: useId() }
  const same = target === owner
  const listed = artifact.alsoIn.includes(target)
  const mode = same ? "copy" : kind
  const slug = artifactSlug(title)
  const ready =
    !busy &&
    artifact.managerRevision !== undefined &&
    (mode === "also" ? !listed : slug !== "" && title.trim() !== "")
  const ownerLabel = labelOf(projects, owner)
  const targetLabel = labelOf(projects, target)
  const pick = (next: string) => {
    setTarget(next)
    setProblem(null)
    if (next === owner && title === artifact.title) setTitle(`${artifact.title} copy`)
    if (next !== owner && title === `${artifact.title} copy`) setTitle(artifact.title)
  }
  const submit = async () => {
    if (!ready || artifact.managerRevision === undefined) return
    setBusy(true)
    setProblem(null)
    try {
      if (mode === "also") {
        await api.alsoShowArtifact(target, `${owner}:${artifact.name}`)
        reload()
        toast.success(
          `“${artifact.title}” now also shows in ${targetLabel}. It opens the ${ownerLabel} artifact; nothing was copied.`,
        )
      } else {
        const done = await api.manageLibraryArtifact(owner, artifact.name, {
          action: "copy",
          expected: artifact.managerRevision,
          project: target,
          name: slug,
          title: title.trim(),
          purpose: purpose.trim(),
        })
        reload()
        toast.success(
          same
            ? `Duplicated as “${title.trim()}”. The original is unchanged.`
            : `Copied to ${targetLabel} as “${title.trim()}”. The original is unchanged.`,
          {
            action: {
              label: "Open",
              onClick: () =>
                go({
                  view: "artifact",
                  project: target,
                  file: lastingDoc(done.name, artifact.entry),
                }),
            },
          },
        )
      }
      onClose()
    } catch (cause) {
      setProblem(messageOf(cause))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(next) => (next || busy ? undefined : onClose())}>
      <DialogContent className="ds-new" data-testid="library-copy">
        <DialogHeader>
          <div className="lib-title-row">
            <DialogTitle>
              {initialTarget === owner && same
                ? `Duplicate “${artifact.title}”`
                : `Copy or show “${artifact.title}” elsewhere`}
            </DialogTitle>
            {initialTarget === owner && same ? null : (
              <InfoHint
                text={`Moving isn't offered: its history and the tasks that draft on it belong to ${ownerLabel}. To move it, copy it, then archive the original.`}
              />
            )}
          </div>
        </DialogHeader>
        <form
          className="ds-new-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="ds-field">
            Project
            <ModelPick
              look="row"
              label="Project"
              value={target}
              onChange={pick}
              options={projects.map((p) => ({
                id: p.id,
                name: p.label,
                icon: <ShapesIcon />,
                ...(p.id === owner ? { note: "where it lives" } : {}),
              }))}
            />
          </div>
          {same ? null : (
            <div className="ds-field lib-kind">
              How
              <Segmented
                label="How"
                value={mode}
                onChange={setKind}
                options={[
                  { id: "copy", label: "Copy", icon: <CopyIcon /> },
                  { id: "also", label: "Also show", icon: <LinkIcon /> },
                ]}
              />
              <span className="ds-hint" data-testid="library-copy-line">
                {mode === "copy"
                  ? `In ${targetLabel}: a separate artifact with its own history from today.`
                  : listed
                    ? `It already shows in ${targetLabel}.`
                    : `In ${targetLabel}: one artifact listed in both. Opening it there opens the ${ownerLabel} artifact.`}
              </span>
            </div>
          )}
          {mode === "copy" ? (
            <>
              <label className="ds-field" htmlFor={ids.title}>
                Name of the copy
                <input
                  id={ids.title}
                  type="text"
                  value={title}
                  maxLength={120}
                  autoComplete="off"
                  autoFocus
                  title={`${targetLabel} › .qualitylayer/artifacts/${slug || "<name>"}/`}
                  aria-describedby={ids.problem}
                  aria-invalid={problem !== null}
                  onChange={(e) => {
                    setTitle(e.target.value)
                    setProblem(null)
                  }}
                />
              </label>
              <label className="ds-field" htmlFor={ids.purpose}>
                What it shows
                <input
                  id={ids.purpose}
                  type="text"
                  value={purpose}
                  maxLength={600}
                  autoComplete="off"
                  onChange={(e) => setPurpose(e.target.value)}
                />
              </label>
            </>
          ) : null}
          <Problem id={ids.problem} problem={problem} reload={reload} />
          <DialogFooter>
            <button type="button" className="q-btn" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="q-btn primary" disabled={!ready} aria-busy={busy}>
              {busy
                ? "Working…"
                : problem !== null
                  ? "Try again"
                  : mode === "also"
                    ? "Show it there"
                    : same
                      ? "Duplicate"
                      : "Copy"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteDialog({
  api,
  artifact,
  owner,
  ownerLabel,
  reload,
  onArchive,
  onClose,
  onDeleteStart,
  onDeleteFailed,
}: {
  api: Api
  artifact: LastingArtifact
  owner: string
  ownerLabel: string
  reload: () => void
  onArchive: () => void
  onClose: () => void
  onDeleteStart?: () => void
  onDeleteFailed?: () => void
}) {
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const ids = { problem: useId() }
  const inUse = artifact.changing
  const ready = !busy && artifact.managerRevision !== undefined && (inUse.length === 0 || sure)
  const submit = async () => {
    if (!ready || artifact.managerRevision === undefined) return
    setBusy(true)
    setProblem(null)
    try {
      onDeleteStart?.()
      const done = await api.manageLibraryArtifact(owner, artifact.name, {
        action: "delete",
        expected: artifact.managerRevision,
        ...(inUse.length > 0 ? { confirmInUse: true } : {}),
      })
      reload()
      toast.success(`Deleted “${artifact.title}” from ${ownerLabel}.`, {
        action: {
          label: "Undo",
          onClick: () =>
            void api
              .manageLibraryArtifact(owner, artifact.name, {
                action: "restore",
                expected: done.revision,
              })
              .then(reload)
              .catch((cause) => toast.error(messageOf(cause))),
        },
      })
      onClose()
    } catch (cause) {
      onDeleteFailed?.()
      setProblem(messageOf(cause))
      setBusy(false)
    }
  }
  const tasks = [...new Set(inUse.map((c) => c.task.title))]
  return (
    <Dialog open onOpenChange={(next) => (next || busy ? undefined : onClose())}>
      <DialogContent className="ds-new" data-testid="library-delete">
        <DialogHeader>
          <DialogTitle>Delete “{artifact.title}”?</DialogTitle>
          <DialogDescription>
            It leaves the Library and every project that lists it. Its folder{" "}
            <code>{artifact.folder}</code>, its pages, comments and history are kept, so Restore
            brings it back as it was. No files are removed.
          </DialogDescription>
        </DialogHeader>
        {inUse.length > 0 ? (
          <div className="lib-inuse" role="note">
            <p>
              <b>{tasks.join(" and ")}</b> {tasks.length > 1 ? "draft" : "drafts"} on it. Each draft
              stays in its task; until you restore it, its base shows as deleted.
            </p>
            <label className="lib-check">
              <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
              Delete it anyway
            </label>
          </div>
        ) : null}
        <Problem id={ids.problem} problem={problem} reload={reload} />
        <DialogFooter>
          <button type="button" className="q-btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          {artifact.archivedAt === undefined ? (
            <button type="button" className="q-btn" disabled={busy} onClick={onArchive}>
              Archive instead
            </button>
          ) : null}
          <button
            type="button"
            className="q-btn danger q-delete-confirm"
            disabled={!ready}
            aria-busy={busy}
            aria-describedby={ids.problem}
            onClick={() => void submit()}
          >
            {busy ? "Deleting…" : problem !== null ? "Try deleting again" : "Delete"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
