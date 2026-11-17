// The menus of the artifacts in a task's Files tab, defined once: a draft's (the "…" button and a
// right-click) and a lasting artifact's. Each opens at the pointer through the App's point menu and owns
// the dialogs its choices ask for (Keep, Add as a page, Compare, Rename, Delete).

import {
  ArrowUpRightIcon,
  ColumnsIcon,
  CopyIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileIcon,
  PencilIcon,
  PinIcon,
  ShapesIcon,
  Trash2Icon,
} from "lucide-react"
import { type ReactNode, useId, useState } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { Artifact } from "../../core/artifact/format.ts"
import { trimEndCharacters } from "../../core/text-boundaries.ts"
import type {
  Api,
  ArtifactWhere,
  DraftedOn,
  KeepResult,
  LastingArtifact,
  TaskDetail,
} from "../api.ts"
import { noteOrigin } from "../artifacts/origin.ts"
import { copyText, type PointItem, usePointMenu } from "../kit/PointMenu.tsx"
import { AddPageDialog } from "./AddPageDialog.tsx"
import { CompareDialog, type CompareSides } from "./CompareArtifacts.tsx"
import { KeepDialog } from "./KeepDialog.tsx"
import { draftedOn, draftLine, type TaskLasting } from "./task-lasting.ts"
import "./task-lasting.css"

type Pointer = Parameters<ReturnType<typeof usePointMenu>["open"]>[0]

/** A page of a lasting artifact as an artifact object, for `onOpen`, which only reads its file. */
export function lastingAsArtifact(artifact: LastingArtifact, page?: string): Artifact {
  const entry = artifact.pages.find((each) => each.page === page) ?? artifact.pages[0]
  return {
    file: entry?.file ?? `${artifact.folder}/${artifact.entry}`,
    name: artifact.name,
    scope: "project",
    title: artifact.title,
    purpose: artifact.purpose,
    changed: null,
    updated: artifact.updated,
    sections: [],
    width: null,
    thumb: null,
    comments: 0,
  }
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/

export function useArtifactMenus({
  api,
  task,
  where,
  drafts,
  lasting,
  readOnly,
  current,
  onOpen,
  reload,
}: {
  /** Without the App's API or the task (a bare list), the menus are off: no "…" button, no right-click. */
  api: Api | undefined
  task: TaskDetail | undefined
  where: ArtifactWhere
  drafts: Artifact[]
  lasting: TaskLasting
  readOnly: boolean
  /** The artifact open now, so a rename or a delete of it can move the page on. */
  current: string | null
  onOpen: (where: ArtifactWhere, artifact: Artifact) => void
  reload: () => void
}): {
  enabled: boolean
  draftMenu: (event: Pointer, draft: Artifact) => void
  /** `owner`: the project the artifact belongs to, for one this project shows from another. */
  lastingMenu: (event: Pointer, artifact: LastingArtifact, owner?: string) => void
  /** Open a Library artifact in its owner's viewer, remembering this task for the way back. */
  openInLibrary: (owner: string, artifact: LastingArtifact, page?: string) => void
  /** Ask to save a draft to the Library (the Save to library dialog). */
  keep: (draft: Artifact) => void
  node: ReactNode
} {
  const { open, menu } = usePointMenu()
  const [keeping, setKeeping] = useState<Artifact | null>(null)
  const [adding, setAdding] = useState<{ draft: Artifact; artifact: LastingArtifact } | null>(null)
  const [comparing, setComparing] = useState<CompareSides | null>(null)
  const [renaming, setRenaming] = useState<Artifact | null>(null)
  const [deleting, setDeleting] = useState<Artifact | null>(null)
  if (api === undefined || task === undefined)
    return {
      enabled: false,
      draftMenu: () => undefined,
      lastingMenu: () => undefined,
      openInLibrary: (owner, artifact, page) =>
        onOpen({ scope: "project", id: owner }, lastingAsArtifact(artifact, page)),
      keep: () => undefined,
      node: null,
    }

  const refresh = () => {
    reload()
    lasting.reload()
  }
  const sidesOf = (draft: Artifact, artifact: LastingArtifact, owner: string): CompareSides => {
    const on = draft.draftOn
    const pages =
      draft.pages !== undefined
        ? draft.pages
            .filter((each) => on?.page === undefined || each.page === on.page)
            .map(({ page, title, file }) => ({ page, title, file }))
        : [{ page: on?.page ?? `${draft.name}.html`, title: draft.title, file: draft.file }]
    return {
      api,
      task,
      project: owner,
      artifact: {
        name: artifact.name,
        title: artifact.title,
        pages: artifact.pages.map(({ page, title, file }) => ({ page, title, file })),
      },
      draft: { name: draft.name, title: draft.title, pages },
      ...(on?.page !== undefined ? { page: on.page } : {}),
    }
  }

  // A Library artifact opens in its owner project's viewer, which offers the way back to this task.
  const openInLibrary = (owner: string, artifact: LastingArtifact, page?: string) => {
    noteOrigin(task.title, owner, artifact.name)
    onOpen({ scope: "project", id: owner }, lastingAsArtifact(artifact, page))
  }
  const baseOf = (draft: Artifact) =>
    draftLine(
      draft,
      lasting.artifacts,
      task.id,
      lasting.query.data !== null
        ? { projects: lasting.query.data.projects, project: task.project }
        : undefined,
    )

  const draftFrom = async (artifact: LastingArtifact, owner: string) => {
    try {
      const made = await api.draftOnArtifact(task.id, {
        artifact: artifact.name,
        // An artifact shown from another project keeps its owner: the draft names it.
        ...(owner !== task.project ? { project: owner } : {}),
      })
      toast.success(`Drafting on ${artifact.title}: ${made.file}`)
      refresh()
      onOpen(where, {
        ...lastingAsArtifact(artifact),
        file: made.file,
        name: made.draft,
        scope: "task",
        draftOn: made.draftOn,
      })
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const draftMenu = (event: Pointer, draft: Artifact) => {
    const on = draft.draftOn
    // The base is found in its owner project. An archived one opens and compares as it is; a deleted
    // one opens on its viewer's Restore, never compared; a missing one offers neither.
    const line = baseOf(draft)
    const found =
      line?.base !== undefined && line.owner !== null
        ? { artifact: line.base, owner: line.owner, deleted: line.state === "deleted" }
        : undefined
    const onto = found !== undefined && !found.deleted ? found : undefined
    // A new draft can become a page of an artifact the task already drafts on, else of any lasting one.
    const named = draftedOn(drafts)
    const targets =
      on !== undefined
        ? []
        : lasting.artifacts.filter((each) => named.size === 0 || named.has(each.name))
    const items: PointItem[] = [
      {
        label: "Open",
        icon: <EyeIcon aria-hidden="true" />,
        onSelect: () => onOpen(where, draft),
      },
    ]
    if (found !== undefined)
      items.push({
        label: found.deleted
          ? `Restore ${found.artifact.title}…`
          : `Open ${found.artifact.title} in the Library`,
        icon: <ShapesIcon aria-hidden="true" />,
        onSelect: () => openInLibrary(found.owner, found.artifact, on?.page),
      })
    if (!readOnly) {
      items.push("separator", {
        label: "Save to library…",
        icon: <PinIcon aria-hidden="true" />,
        onSelect: () => setKeeping(draft),
      })
      for (const target of targets)
        items.push({
          label: `Add as a page of ${target.title}…`,
          icon: <FileIcon aria-hidden="true" />,
          onSelect: () => setAdding({ draft, artifact: target }),
        })
    }
    if (onto !== undefined)
      items.push({
        label: `Compare with ${onto.artifact.title}`,
        icon: <ColumnsIcon aria-hidden="true" />,
        onSelect: () => setComparing(sidesOf(draft, onto.artifact, onto.owner)),
      })
    items.push("separator")
    // A page can be renamed or deleted in place; a folder's pages are managed on the artifact itself.
    if (!readOnly && draft.pages === undefined)
      items.push({
        label: "Rename…",
        icon: <PencilIcon aria-hidden="true" />,
        onSelect: () => setRenaming(draft),
      })
    items.push({
      label: "Copy path",
      icon: <CopyIcon aria-hidden="true" />,
      onSelect: () => copyText(`${trimEndCharacters(task.dir, "\\/")}/${draft.file}`),
    })
    if (!readOnly && draft.pages === undefined)
      items.push("separator", {
        label: "Delete…",
        icon: <Trash2Icon aria-hidden="true" />,
        danger: true,
        onSelect: () => setDeleting(draft),
      })
    open(event, items)
  }

  const lastingMenu = (event: Pointer, artifact: LastingArtifact, owner = task.project) => {
    const items: PointItem[] = [
      {
        label: "Open",
        icon: <EyeIcon aria-hidden="true" />,
        onSelect: () => openInLibrary(owner, artifact),
      },
    ]
    // An archived or deleted artifact takes no new draft until it is restored.
    if (!readOnly && artifact.archivedAt === undefined && artifact.deletedAt === undefined)
      items.push({
        label: "Draft on it in this task",
        icon: <ArrowUpRightIcon aria-hidden="true" />,
        onSelect: () => void draftFrom(artifact, owner),
      })
    if (artifact.claudeDesign !== undefined) {
      const link = artifact.claudeDesign
      items.push({
        label: "Open in Claude Design",
        icon: <ExternalLinkIcon aria-hidden="true" />,
        onSelect: () => void window.open(link, "_blank", "noopener,noreferrer"),
      })
    }
    open(event, items)
  }

  const kept = (result: KeepResult, notShown: string[], projectName: string) => {
    toast.success(
      result.where === "repository"
        ? `Saved to the ${projectName} Library as ${result.path}. Every task of ${projectName} can draft on it.`
        : `Saved only on this computer in ${result.path}.`,
    )
    if (notShown.length > 0)
      toast.error(
        `It could not be listed under ${notShown.join(", ")}. Try again from that project.`,
      )
    refresh()
  }
  const added = (_: DraftedOn, artifact: LastingArtifact) => {
    toast.success(`Added. It folds into ${artifact.title} at Verify.`)
    refresh()
  }

  return {
    enabled: true,
    draftMenu,
    lastingMenu,
    openInLibrary,
    keep: (draft: Artifact) => setKeeping(draft),
    node: (
      <>
        {menu}
        <KeepDialog
          api={api}
          task={task}
          draft={keeping}
          base={keeping !== null ? baseOf(keeping) : null}
          projects={lasting.query.data?.projects ?? []}
          onClose={() => setKeeping(null)}
          onKept={kept}
        />
        <AddPageDialog
          api={api}
          task={task}
          draft={adding?.draft ?? null}
          artifact={adding?.artifact ?? null}
          onClose={() => setAdding(null)}
          onAdded={added}
        />
        <CompareDialog sides={comparing} onClose={() => setComparing(null)} />
        <RenameDialog
          api={api}
          where={where}
          draft={renaming}
          onClose={() => setRenaming(null)}
          onDone={(next) => {
            toast.success("Renamed")
            if (renaming !== null && current === renaming.file)
              onOpen(where, {
                ...renaming,
                file: next,
                name: next.replace(/^.*\//, "").replace(/\.html$/, ""),
              })
            reload()
          }}
        />
        <DeleteDialog
          api={api}
          where={where}
          draft={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => {
            toast.success("Deleted")
            reload()
          }}
        />
      </>
    ),
  }
}

function RenameDialog({
  api,
  where,
  draft,
  onClose,
  onDone,
}: {
  api: Api
  where: ArtifactWhere
  draft: Artifact | null
  onClose: () => void
  onDone: (file: string) => void
}) {
  return (
    <Dialog open={draft !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      {draft !== null ? (
        <RenameForm
          key={draft.file}
          api={api}
          where={where}
          draft={draft}
          onClose={onClose}
          onDone={onDone}
        />
      ) : null}
    </Dialog>
  )
}

function RenameForm({
  api,
  where,
  draft,
  onClose,
  onDone,
}: {
  api: Api
  where: ArtifactWhere
  draft: Artifact
  onClose: () => void
  onDone: (file: string) => void
}) {
  const [name, setName] = useState(draft.name)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const id = useId()
  const valid = SLUG.test(name) && name.length <= 100
  const save = async () => {
    if (busy || !valid) return
    if (name === draft.name) return onClose()
    setBusy(true)
    setProblem(null)
    try {
      if (api.artifactSource === undefined || api.artifactMutate === undefined)
        throw new Error("This App cannot rename artifacts.")
      const source = await api.artifactSource(where, draft.file)
      const changed = await api.artifactMutate(where, draft.file, {
        action: "rename",
        name,
        expected: source.revision,
      })
      onDone(changed.file)
      onClose()
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "The artifact could not be renamed.")
      setBusy(false)
    }
  }
  return (
    <DialogContent className="kd sm:max-w-[420px]" data-testid="rename-artifact">
      <DialogHeader>
        <DialogTitle>Rename this artifact</DialogTitle>
        <DialogDescription>
          Lower-case letters, digits and dashes. Its feedback names the file, so an artifact with
          feedback keeps its name.
        </DialogDescription>
      </DialogHeader>
      <form
        className="kd-form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <label className="kd-field" htmlFor={id}>
          Name
          <input
            id={id}
            className="kd-input"
            value={name}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {problem !== null ? (
          <p className="kd-bad" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="kd-actions">
          <button type="button" className="q-btn quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="q-btn primary" disabled={busy || !valid}>
            Rename
          </button>
        </div>
      </form>
    </DialogContent>
  )
}

function DeleteDialog({
  api,
  where,
  draft,
  onClose,
  onDone,
}: {
  api: Api
  where: ArtifactWhere
  draft: Artifact | null
  onClose: () => void
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const remove = async () => {
    if (draft === null || busy) return
    setBusy(true)
    setProblem(null)
    try {
      if (api.artifactSource === undefined || api.artifactMutate === undefined)
        throw new Error("This App cannot delete artifacts.")
      const source = await api.artifactSource(where, draft.file)
      await api.artifactMutate(where, draft.file, { action: "delete", expected: source.revision })
      onDone()
      onClose()
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "The artifact could not be deleted.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={draft !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="kd sm:max-w-[420px]" data-testid="delete-artifact">
        <DialogHeader>
          <DialogTitle>Delete this artifact?</DialogTitle>
          <DialogDescription>
            {draft?.title}: its page is deleted from this task. Its history keeps earlier versions.
          </DialogDescription>
        </DialogHeader>
        {problem !== null ? (
          <p className="kd-bad" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="kd-actions">
          <button type="button" className="q-btn quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="q-btn q-delete-confirm"
            disabled={busy}
            onClick={() => void remove()}
          >
            Delete
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
