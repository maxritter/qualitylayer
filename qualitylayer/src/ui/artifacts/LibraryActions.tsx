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
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import { toast } from "sonner"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { LastingArtifact } from "../../core/artifact/format.ts"
import type { Api } from "../api.ts"
import type { Route } from "../hooks.ts"
import { useViewportWidth } from "../hooks.ts"
import { FOLD, useActionFold } from "../shell/useActionFold.ts"
import { Hint } from "../sidebar/Hint.tsx"
import { CopyDialog } from "./LibraryCopyDialog.tsx"
import { DeleteDialog, libraryErrorMessage, RenameDialog } from "./LibraryDialogs.tsx"

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

function LibraryMenuItems({
  deleted,
  archived,
  stale,
  busy,
  directTools,
  directLifecycle,
  onOpen,
  onFlip,
}: {
  deleted: boolean
  archived: boolean
  stale: boolean
  busy: boolean
  directTools: boolean
  directLifecycle: boolean
  onOpen: (next: Open) => void
  onFlip: (action: "archive" | "restore") => void
}) {
  if (deleted) {
    return (
      <DropdownMenuItem disabled={stale || busy} onClick={() => onFlip("restore")}>
        <RotateCcwIcon aria-hidden="true" />
        Restore to the Library
      </DropdownMenuItem>
    )
  }
  return (
    <>
      {!directTools ? (
        <>
          <DropdownMenuItem disabled={stale} onClick={() => onOpen("rename")}>
            <PencilIcon aria-hidden="true" />
            Rename…
          </DropdownMenuItem>
          <DropdownMenuItem disabled={stale} onClick={() => onOpen("duplicate")}>
            <CopyIcon aria-hidden="true" />
            Duplicate…
          </DropdownMenuItem>
          <DropdownMenuItem disabled={stale} onClick={() => onOpen("copy")}>
            <FolderInputIcon aria-hidden="true" />
            Copy or show in another project…
          </DropdownMenuItem>
        </>
      ) : null}
      {!directLifecycle ? (
        <>
          <DropdownMenuSeparator />
          {archived ? (
            <DropdownMenuItem disabled={stale || busy} onClick={() => onFlip("restore")}>
              <RotateCcwIcon aria-hidden="true" />
              Restore to the Library
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={stale || busy} onClick={() => onFlip("archive")}>
              <ArchiveIcon aria-hidden="true" />
              Archive
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" disabled={stale} onClick={() => onOpen("delete")}>
            <Trash2Icon aria-hidden="true" />
            Delete…
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  )
}

function LibraryActiveDialog({
  open,
  api,
  artifact,
  owner,
  ownerLabel,
  projects,
  reload,
  go,
  onRenamed,
  onDeleteStart,
  onDeleteFailed,
  onFlipArchive,
  onClose,
}: {
  open: Open
  api: Api
  artifact: LastingArtifact
  owner: string
  ownerLabel: string
  projects: LibraryProject[]
  reload: () => void
  go: (route: Route) => void
  onRenamed?: () => void
  onDeleteStart?: () => void
  onDeleteFailed?: () => void
  onFlipArchive: () => void
  onClose: () => void
}) {
  if (open === "rename")
    return (
      <RenameDialog
        api={api}
        artifact={artifact}
        owner={owner}
        reload={reload}
        onRenamed={onRenamed}
        onClose={onClose}
      />
    )
  if (open === "duplicate" || open === "copy")
    return (
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
        onClose={onClose}
      />
    )
  if (open === "delete")
    return (
      <DeleteDialog
        api={api}
        artifact={artifact}
        owner={owner}
        ownerLabel={ownerLabel}
        reload={reload}
        onDeleteStart={onDeleteStart}
        onDeleteFailed={onDeleteFailed}
        onArchive={() => {
          onClose()
          onFlipArchive()
        }}
        onClose={onClose}
      />
    )
  return null
}

async function runFlipAction(params: {
  api: Api
  artifact: LastingArtifact
  owner: string
  ownerLabel: string
  action: "archive" | "restore"
  revision: string
  reload: () => void
  onUndo: (nextRevision: string) => void
}): Promise<void> {
  const { api, artifact, owner, ownerLabel, action, revision, reload, onUndo } = params
  const confirmInUse = action === "archive" && artifact.changing.length > 0
  const done = await api.manageLibraryArtifact(owner, artifact.name, {
    action,
    expected: revision,
    ...(confirmInUse ? { confirmInUse: true } : {}),
  })
  reload()
  const message =
    action === "archive"
      ? `Archived “${artifact.title}”. It's hidden from the Library; tasks that use it still open it.`
      : `Restored “${artifact.title}” to the ${ownerLabel} Library.`
  toast.success(message, {
    action: { label: "Undo", onClick: () => onUndo(done.revision) },
  })
}

function useLibraryMutations(props: {
  api: Api
  artifact: LastingArtifact
  owner: string
  ownerLabel: string
  projects: LibraryProject[]
  listedIn?: string
  reload: () => void
}) {
  const [busy, setBusy] = useState(false)
  const expected = props.artifact.managerRevision

  const flip = async (action: "archive" | "restore", revision = expected) => {
    if (revision === undefined || busy) return
    setBusy(true)
    try {
      await runFlipAction({
        api: props.api,
        artifact: props.artifact,
        owner: props.owner,
        ownerLabel: props.ownerLabel,
        action,
        revision,
        reload: props.reload,
        onUndo: (nextRevision) =>
          void flip(action === "archive" ? "restore" : "archive", nextRevision),
      })
    } catch (cause) {
      toast.error(libraryErrorMessage(cause))
      props.reload()
    } finally {
      setBusy(false)
    }
  }

  const stopShowing = async () => {
    if (props.listedIn === undefined || busy) return
    const targetProject = props.listedIn
    const ref = `${props.owner}:${props.artifact.name}`
    const where = labelOf(props.projects, targetProject)
    setBusy(true)
    try {
      await props.api.stopShowingArtifact(targetProject, ref)
      props.reload()
      toast.success(
        `“${props.artifact.title}” no longer shows in ${where}. It stays in ${props.ownerLabel}.`,
        {
          action: {
            label: "Undo",
            onClick: () =>
              void props.api
                .alsoShowArtifact(targetProject, ref)
                .then(props.reload)
                .catch((cause: unknown) => toast.error(libraryErrorMessage(cause))),
          },
        },
      )
    } catch (cause) {
      toast.error(libraryErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return { busy, flip, stopShowing }
}

function DirectToolbarTools({ stale, onOpen }: { stale: boolean; onOpen: (next: Open) => void }) {
  return (
    <span className="lib-toolbar-tools">
      <ToolbarAction
        label="Rename"
        Icon={PencilIcon}
        disabled={stale}
        onClick={() => onOpen("rename")}
      />
      <ToolbarAction
        label="Duplicate"
        Icon={CopyIcon}
        disabled={stale}
        onClick={() => onOpen("duplicate")}
      />
      <ToolbarAction
        label="Copy or show in another project"
        Icon={FolderInputIcon}
        disabled={stale}
        onClick={() => onOpen("copy")}
      />
    </span>
  )
}

function DirectToolbarLifecycle({
  archived,
  stale,
  busy,
  onFlip,
  onDelete,
}: {
  archived: boolean
  stale: boolean
  busy: boolean
  onFlip: () => void
  onDelete: () => void
}) {
  return (
    <span className="lib-toolbar-lifecycle">
      <ToolbarAction
        label={archived ? "Restore" : "Archive"}
        Icon={archived ? RotateCcwIcon : ArchiveIcon}
        disabled={stale || busy}
        onClick={onFlip}
      />
      <ToolbarAction
        label="Delete"
        Icon={Trash2Icon}
        disabled={stale}
        destructive
        onClick={onDelete}
      />
    </span>
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
  const [viewerHost, setViewerHost] = useState<HTMLElement | null>(null)
  const phone = useViewportWidth() <= 480
  const fold = useActionFold(inViewer ? viewerHost : null, phone)
  const archived = artifact.archivedAt !== undefined
  const deleted = artifact.deletedAt !== undefined
  const ownerLabel = labelOf(projects, owner)
  const { busy, flip, stopShowing } = useLibraryMutations({
    api,
    artifact,
    owner,
    ownerLabel,
    projects,
    listedIn,
    reload,
  })

  const stale = artifact.managerRevision === undefined
  const direct = inViewer === true && !deleted && !phone
  const directTools = direct && fold < FOLD.utilities
  const directLifecycle = direct && fold < FOLD.lifecycle
  const triggerLabel = inViewer ? "Artifact actions" : `Actions for ${artifact.title}`
  return (
    <>
      <span
        ref={inViewer ? setViewerHost : undefined}
        className={inViewer ? "lib-toolbar-actions" : undefined}
      >
        {directTools ? <DirectToolbarTools stale={stale} onOpen={setOpen} /> : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className={cn(inViewer ? "q-btn sm" : "lib-more")}
                aria-label={triggerLabel}
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
            <LibraryMenuItems
              deleted={deleted}
              archived={archived}
              stale={stale}
              busy={busy}
              directTools={directTools}
              directLifecycle={directLifecycle}
              onOpen={setOpen}
              onFlip={(action) => void flip(action)}
            />
            {stale ? (
              <p className="lib-menu-note">
                This App can't manage it yet: read the Library again, or update QualityLayer.
              </p>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        {directLifecycle ? (
          <DirectToolbarLifecycle
            archived={archived}
            stale={stale}
            busy={busy}
            onFlip={() => void flip(archived ? "restore" : "archive")}
            onDelete={() => setOpen("delete")}
          />
        ) : null}
      </span>
      <LibraryActiveDialog
        open={open}
        api={api}
        artifact={artifact}
        owner={owner}
        ownerLabel={ownerLabel}
        projects={projects}
        reload={reload}
        go={go}
        onRenamed={onRenamed}
        onDeleteStart={onDeleteStart}
        onDeleteFailed={onDeleteFailed}
        onFlipArchive={() => void flip("archive")}
        onClose={() => setOpen(null)}
      />
    </>
  )
}
