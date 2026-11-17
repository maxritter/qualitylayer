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
  const save = async (task: TaskSummary) => {
    const next = title.replace(/\s+/g, " ").trim()
    if (rename === undefined || next === "") return
    if (next === task.title) return setRenaming(null)
    setBusy(true)
    try {
      await rename(task.id, next)
      toast.success("Renamed")
      setRenaming(null)
      reload()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const archive = async (task: TaskSummary) => {
    if (task.type === "chat" && !task.archived && onChatArchive) {
      onChatArchive(task)
      return
    }
    try {
      await api.archive(task.id, !task.archived)
      toast.success(task.archived ? "Restored" : "Archived. It waits under Archived.")
      if (!task.archived && route.view === "task" && route.id === task.id) go({ view: "home" })
      reload()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const remove = async (task: TaskSummary) => {
    setBusy(true)
    try {
      if (!task.archived) await api.archive(task.id, true)
      const done = await api.deleteTask(task.id)
      toast.success(done.plan !== null ? `Deleted, with ${done.plan}` : "Deleted")
      setDeleting(null)
      if (route.view === "task" && route.id === task.id) go({ view: "home" })
      reload()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const onTaskMenu = (task: TaskSummary, event: React.MouseEvent) =>
    open(event, [
      {
        label: "Open",
        icon: <ArrowUpRightIcon aria-hidden="true" />,
        onSelect: () => go({ view: "task", id: task.id, doc: null }),
      },
      ...(rename === undefined
        ? []
        : [
            {
              label: "Rename…",
              icon: <PencilIcon aria-hidden="true" />,
              onSelect: () => {
                setTitle(task.title)
                setRenaming(task)
              },
            },
          ]),
      {
        label: task.archived ? "Restore" : "Archive",
        icon: task.archived ? (
          <ArchiveRestoreIcon aria-hidden="true" />
        ) : (
          <ArchiveIcon aria-hidden="true" />
        ),
        onSelect: () => void archive(task),
      },
      "separator",
      {
        label: "Delete…",
        icon: <Trash2Icon aria-hidden="true" />,
        danger: true,
        onSelect: () => setDeleting(task),
      },
    ])
  const node = (
    <>
      {menu}
      <Dialog
        open={renaming !== null}
        onOpenChange={(next) => (next ? undefined : setRenaming(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename this task</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              if (renaming) void save(renaming)
            }}
          >
            <label className="grid gap-1.5 text-sm" htmlFor="rename-task-title">
              Name
              <input
                id="rename-task-title"
                className="q-input"
                value={title}
                autoComplete="off"
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <p className="m-0 text-xs text-muted-foreground">
              Only the name changes. The task keeps its folder, branch and links.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="q-btn quiet" onClick={() => setRenaming(null)}>
                Cancel
              </button>
              <button type="submit" className="q-btn" disabled={busy || title.trim() === ""}>
                Save
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deleting !== null}
        onOpenChange={(next) => (next ? undefined : setDeleting(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this task?</DialogTitle>
          </DialogHeader>
          <p>{deleting?.title}: its documents and local records will be deleted.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="q-btn quiet" onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="q-btn q-delete-confirm"
              disabled={busy}
              onClick={() => deleting && void remove(deleting)}
            >
              Delete
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
  return { onTaskMenu, node }
}
