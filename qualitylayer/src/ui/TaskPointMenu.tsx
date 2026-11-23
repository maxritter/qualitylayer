// A right-click on a task in the sidebar: open it, rename it, archive or restore it, delete it. Rename
// and Delete ask first, as the task menu in the header does.

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowUpRightIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { Api, TaskSummary } from "./api.ts"
import type { Route } from "./hooks.ts"
import { usePointMenu } from "./kit/PointMenu.tsx"

function RenameTaskDialog({
  task,
  title,
  busy,
  onTitle,
  onClose,
  onSave,
}: {
  task: TaskSummary | null
  title: string
  busy: boolean
  onTitle: (next: string) => void
  onClose: () => void
  onSave: (task: TaskSummary) => void
}) {
  return (
    <Dialog open={task !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename this task</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (task) onSave(task)
          }}
        >
          <label className="grid gap-1.5 text-sm" htmlFor="rename-task-title">
            Name
            <input
              id="rename-task-title"
              className="q-input"
              value={title}
              autoComplete="off"
              onChange={(event) => onTitle(event.target.value)}
            />
          </label>
          <p className="m-0 text-xs text-muted-foreground">
            Only the name changes. The task keeps its folder, branch and links.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="q-btn quiet" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="q-btn" disabled={busy || title.trim() === ""}>
              Save
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteTaskDialog({
  task,
  busy,
  onClose,
  onDelete,
}: {
  task: TaskSummary | null
  busy: boolean
  onClose: () => void
  onDelete: (task: TaskSummary) => void
}) {
  return (
    <Dialog open={task !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this task?</DialogTitle>
        </DialogHeader>
        <p>{task?.title}: its documents and local records will be deleted.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="q-btn quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="q-btn q-delete-confirm"
            disabled={busy}
            onClick={() => task && onDelete(task)}
          >
            Delete
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function buildTaskMenuItems({
  task,
  hasRename,
  onOpen,
  onRename,
  onArchive,
  onDelete,
}: {
  task: TaskSummary
  hasRename: boolean
  onOpen: () => void
  onRename: () => void
  onArchive: () => void
  onDelete: () => void
}) {
  return [
    {
      label: "Open",
      icon: <ArrowUpRightIcon aria-hidden="true" />,
      onSelect: onOpen,
    },
    ...(hasRename
      ? [
          {
            label: "Rename…",
            icon: <PencilIcon aria-hidden="true" />,
            onSelect: onRename,
          },
        ]
      : []),
    {
      label: task.archived ? "Restore" : "Archive",
      icon: task.archived ? (
        <ArchiveRestoreIcon aria-hidden="true" />
      ) : (
        <ArchiveIcon aria-hidden="true" />
      ),
      onSelect: onArchive,
    },
    "separator" as const,
    {
      label: "Delete…",
      icon: <Trash2Icon aria-hidden="true" />,
      danger: true,
      onSelect: onDelete,
    },
  ]
}

async function runRenameTask(opts: {
  task: TaskSummary
  title: string
  rename: ((id: string, title: string) => Promise<void>) | undefined
  setBusy: (busy: boolean) => void
  onDone: () => void
  reload: () => void
}): Promise<void> {
  const next = opts.title.replace(/\s+/g, " ").trim()
  if (opts.rename === undefined || next === "") return
  if (next === opts.task.title) {
    opts.onDone()
    return
  }
  opts.setBusy(true)
  try {
    await opts.rename(opts.task.id, next)
    toast.success("Renamed")
    opts.onDone()
    opts.reload()
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : String(cause))
  } finally {
    opts.setBusy(false)
  }
}

async function runArchiveTask(opts: {
  task: TaskSummary
  api: Pick<Api, "archive">
  onChatArchive?: (task: TaskSummary) => void
  leaveIfActive: (id: string) => void
  reload: () => void
}): Promise<void> {
  if (opts.task.type === "chat" && !opts.task.archived && opts.onChatArchive) {
    opts.onChatArchive(opts.task)
    return
  }
  try {
    await opts.api.archive(opts.task.id, !opts.task.archived)
    toast.success(opts.task.archived ? "Restored" : "Archived. It waits under Archived.")
    if (!opts.task.archived) opts.leaveIfActive(opts.task.id)
    opts.reload()
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : String(cause))
  }
}

async function runDeleteTask(opts: {
  task: TaskSummary
  api: Pick<Api, "archive" | "deleteTask">
  setBusy: (busy: boolean) => void
  onDone: () => void
  leaveIfActive: (id: string) => void
  reload: () => void
}): Promise<void> {
  opts.setBusy(true)
  try {
    if (!opts.task.archived) await opts.api.archive(opts.task.id, true)
    const done = await opts.api.deleteTask(opts.task.id)
    toast.success(done.plan !== null ? `Deleted, with ${done.plan}` : "Deleted")
    opts.onDone()
    opts.leaveIfActive(opts.task.id)
    opts.reload()
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : String(cause))
  } finally {
    opts.setBusy(false)
  }
}

export function useTaskPointMenu({
  api,
  rename,
  route,
  go,
  reload,
  onChatArchive,
}: {
  api: Pick<Api, "archive" | "deleteTask">
  /** Change a task's title (never its folder). Absent: no Rename item. */
  rename?: (id: string, title: string) => Promise<void>
  route: Route
  go: (route: Route) => void
  reload: () => void
  onChatArchive?: (task: TaskSummary) => void
}) {
  const { open, menu } = usePointMenu()
  const [deleting, setDeleting] = useState<TaskSummary | null>(null)
  const [renaming, setRenaming] = useState<TaskSummary | null>(null)
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const leaveIfActive = (id: string) => {
    if (route.view === "task" && route.id === id) go({ view: "home" })
  }
  const onTaskMenu = (task: TaskSummary, event: React.MouseEvent) =>
    open(
      event,
      buildTaskMenuItems({
        task,
        hasRename: rename !== undefined,
        onOpen: () => go({ view: "task", id: task.id, doc: null }),
        onRename: () => {
          setTitle(task.title)
          setRenaming(task)
        },
        onArchive: () => void runArchiveTask({ task, api, onChatArchive, leaveIfActive, reload }),
        onDelete: () => setDeleting(task),
      }),
    )
  const node = (
    <>
      {menu}
      <RenameTaskDialog
        task={renaming}
        title={title}
        busy={busy}
        onTitle={setTitle}
        onClose={() => setRenaming(null)}
        onSave={(task) =>
          void runRenameTask({
            task,
            title,
            rename,
            setBusy,
            onDone: () => setRenaming(null),
            reload,
          })
        }
      />
      <DeleteTaskDialog
        task={deleting}
        busy={busy}
        onClose={() => setDeleting(null)}
        onDelete={(task) =>
          void runDeleteTask({
            task,
            api,
            setBusy,
            onDone: () => setDeleting(null),
            leaveIfActive,
            reload,
          })
        }
      />
    </>
  )
  return { onTaskMenu, node }
}
