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
import { type ReactNode, useState } from "react"
import { toast } from "sonner"
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
import { DeleteArtifactDialog, RenameArtifactDialog } from "./ArtifactDialogs.tsx"
import { CompareDialog, type CompareSides } from "./CompareArtifacts.tsx"
import { KeepDialog } from "./KeepDialog.tsx"
import { type DraftLine, draftedOn, draftLine, type TaskLasting } from "./task-lasting.ts"
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

function compareSidesOf(args: {
  api: Api
  task: TaskDetail
  draft: Artifact
  artifact: LastingArtifact
  owner: string
}): CompareSides {
  const { api, task, draft, artifact, owner } = args
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

function buildDraftMenuItems(args: {
  draft: Artifact
  task: TaskDetail
  where: ArtifactWhere
  drafts: readonly Artifact[]
  lasting: TaskLasting
  readOnly: boolean
  line: DraftLine | null
  onOpen: (where: ArtifactWhere, artifact: Artifact) => void
  openInLibrary: (owner: string, artifact: LastingArtifact, page?: string) => void
  onKeep: (draft: Artifact) => void
  onAddPage: (draft: Artifact, artifact: LastingArtifact) => void
  onCompare: (draft: Artifact, artifact: LastingArtifact, owner: string) => void
  onRename: (draft: Artifact) => void
  onDelete: (draft: Artifact) => void
}): PointItem[] {
  const {
    draft,
    task,
    where,
    drafts,
    lasting,
    readOnly,
    line,
    onOpen,
    openInLibrary,
    onKeep,
    onAddPage,
    onCompare,
    onRename,
    onDelete,
  } = args
  const on = draft.draftOn
  const found =
    line?.base !== undefined && line.owner !== null
      ? { artifact: line.base, owner: line.owner, deleted: line.state === "deleted" }
      : undefined
  const named = draftedOn([...drafts])
  const targets =
    on !== undefined
      ? []
      : lasting.artifacts.filter((each) => named.size === 0 || named.has(each.name))
  const items: PointItem[] = [
    { label: "Open", icon: <EyeIcon aria-hidden="true" />, onSelect: () => onOpen(where, draft) },
  ]
  if (found !== undefined) {
    items.push({
      label: found.deleted
        ? `Restore ${found.artifact.title}…`
        : `Open ${found.artifact.title} in the Library`,
      icon: <ShapesIcon aria-hidden="true" />,
      onSelect: () => openInLibrary(found.owner, found.artifact, on?.page),
    })
  }
  if (!readOnly) {
    items.push("separator", {
      label: "Save to library…",
      icon: <PinIcon aria-hidden="true" />,
      onSelect: () => onKeep(draft),
    })
    for (const target of targets) {
      items.push({
        label: `Add as a page of ${target.title}…`,
        icon: <FileIcon aria-hidden="true" />,
        onSelect: () => onAddPage(draft, target),
      })
    }
  }
  if (found !== undefined && !found.deleted) {
    items.push({
      label: `Compare with ${found.artifact.title}`,
      icon: <ColumnsIcon aria-hidden="true" />,
      onSelect: () => onCompare(draft, found.artifact, found.owner),
    })
  }
  items.push("separator")
  const canEditSingle = !readOnly && draft.pages === undefined
  if (canEditSingle) {
    items.push({
      label: "Rename…",
      icon: <PencilIcon aria-hidden="true" />,
      onSelect: () => onRename(draft),
    })
  }
  items.push({
    label: "Copy path",
    icon: <CopyIcon aria-hidden="true" />,
    onSelect: () => copyText(`${trimEndCharacters(task.dir, "\\/")}/${draft.file}`),
  })
  if (canEditSingle) {
    items.push("separator", {
      label: "Delete…",
      icon: <Trash2Icon aria-hidden="true" />,
      danger: true,
      onSelect: () => onDelete(draft),
    })
  }
  return items
}

function buildLastingMenuItems(args: {
  artifact: LastingArtifact
  owner: string
  readOnly: boolean
  openInLibrary: (owner: string, artifact: LastingArtifact) => void
  onDraftFrom: (artifact: LastingArtifact, owner: string) => void
}): PointItem[] {
  const { artifact, owner, readOnly, openInLibrary, onDraftFrom } = args
  const items: PointItem[] = [
    {
      label: "Open",
      icon: <EyeIcon aria-hidden="true" />,
      onSelect: () => openInLibrary(owner, artifact),
    },
  ]
  if (!readOnly && artifact.archivedAt === undefined && artifact.deletedAt === undefined) {
    items.push({
      label: "Draft on it in this task",
      icon: <ArrowUpRightIcon aria-hidden="true" />,
      onSelect: () => onDraftFrom(artifact, owner),
    })
  }
  if (artifact.claudeDesign !== undefined) {
    const link = artifact.claudeDesign
    items.push({
      label: "Open in Claude Design",
      icon: <ExternalLinkIcon aria-hidden="true" />,
      onSelect: () => void window.open(link, "_blank", "noopener,noreferrer"),
    })
  }
  return items
}

function notifyKept(result: KeepResult, notShown: string[], projectName: string) {
  toast.success(
    result.where === "repository"
      ? `Saved to the ${projectName} Library as ${result.path}. Every task of ${projectName} can draft on it.`
      : `Saved only on this computer in ${result.path}.`,
  )
  if (notShown.length > 0)
    toast.error(`It could not be listed under ${notShown.join(", ")}. Try again from that project.`)
}

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
  api: Api | undefined
  task: TaskDetail | undefined
  where: ArtifactWhere
  drafts: Artifact[]
  lasting: TaskLasting
  readOnly: boolean
  current: string | null
  onOpen: (where: ArtifactWhere, artifact: Artifact) => void
  reload: () => void
}): {
  enabled: boolean
  draftMenu: (event: Pointer, draft: Artifact) => void
  lastingMenu: (event: Pointer, artifact: LastingArtifact, owner?: string) => void
  openInLibrary: (owner: string, artifact: LastingArtifact, page?: string) => void
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
  const draftMenu = (event: Pointer, draft: Artifact) =>
    open(
      event,
      buildDraftMenuItems({
        draft,
        task,
        where,
        drafts,
        lasting,
        readOnly,
        line: baseOf(draft),
        onOpen,
        openInLibrary,
        onKeep: setKeeping,
        onAddPage: (d, artifact) => setAdding({ draft: d, artifact }),
        onCompare: (d, artifact, owner) =>
          setComparing(compareSidesOf({ api, task, draft: d, artifact, owner })),
        onRename: setRenaming,
        onDelete: setDeleting,
      }),
    )
  const lastingMenu = (event: Pointer, artifact: LastingArtifact, owner = task.project) =>
    open(
      event,
      buildLastingMenuItems({
        artifact,
        owner,
        readOnly,
        openInLibrary,
        onDraftFrom: (a, o) => void draftFrom(a, o),
      }),
    )

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
          onKept={(result, notShown, projectName) => {
            notifyKept(result, notShown, projectName)
            refresh()
          }}
        />
        <AddPageDialog
          api={api}
          task={task}
          draft={adding?.draft ?? null}
          artifact={adding?.artifact ?? null}
          onClose={() => setAdding(null)}
          onAdded={(_: DraftedOn, artifact: LastingArtifact) => {
            toast.success(`Added. It folds into ${artifact.title} at Verify.`)
            refresh()
          }}
        />
        <CompareDialog sides={comparing} onClose={() => setComparing(null)} />
        <RenameArtifactDialog
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
        <DeleteArtifactDialog
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
