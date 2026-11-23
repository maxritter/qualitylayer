// More holds the task actions that do not fit the header. Delete keeps its existing confirmation.

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CoinsIcon,
  CopyIcon,
  FileDiffIcon,
  FolderOpenIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  Trash2Icon,
} from "lucide-react"
import type { ReactNode, RefObject } from "react"
import { toast } from "sonner"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Api, TaskDetail } from "../api.ts"
import { offersHostActions } from "../machines/framed.ts"
import { openReviewWorkspace, useCodeSummary } from "../review-workspace/open.ts"

/** The panels the header opens over the page; the menu names the ones it can start. */
export type MenuPanel = "cost" | "delete"

export const showTaskFolder = (api: Pick<Api, "openFile">, task: string) =>
  api
    .openFile(task, ".", "folder")
    .then(() => toast.success("Showed the task folder"))
    .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))

function MenuAction({
  icon,
  disabled,
  destructive,
  onPick,
  children,
}: {
  icon: ReactNode
  disabled?: boolean
  destructive?: boolean
  onPick: () => void
  children: ReactNode
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      variant={destructive === true ? "destructive" : "default"}
      onClick={onPick}
    >
      {icon}
      {children}
    </DropdownMenuItem>
  )
}

function LifecycleMenuSection({
  archived,
  busy,
  phone,
  onArchive,
  onDelete,
}: {
  archived: boolean
  busy: boolean
  phone: boolean
  onArchive: () => void
  onDelete: () => void
}) {
  return (
    <>
      {phone ? <DropdownMenuSeparator /> : null}
      <MenuAction
        icon={
          archived ? <ArchiveRestoreIcon aria-hidden="true" /> : <ArchiveIcon aria-hidden="true" />
        }
        disabled={busy}
        onPick={onArchive}
      >
        {archived ? "Restore" : "Archive"}
      </MenuAction>
      <DropdownMenuSeparator />
      <MenuAction icon={<Trash2Icon aria-hidden="true" />} destructive onPick={onDelete}>
        Delete…
      </MenuAction>
    </>
  )
}

export function TaskMoreMenu({
  task,
  api,
  busy,
  phone,
  changesOverflow = false,
  fold = false,
  lifecycleFolded = fold,
  contextFolded = phone,
  triggerRef,
  onCopy,
  onPanel,
  onArchive,
  onAgent,
}: {
  task: Pick<TaskDetail, "id" | "branch" | "stage" | "archived">
  api: Pick<Api, "openFile">
  busy: boolean
  /** A narrow bar keeps Cost in the menu. */
  phone: boolean
  changesOverflow?: boolean
  /** A compact desktop bar: Copy branch name, Show task folder, Archive and Delete wait here. */
  fold?: boolean
  /** Archive and Delete stay direct after secondary tools fold, until their own space runs out. */
  lifecycleFolded?: boolean
  contextFolded?: boolean
  triggerRef: RefObject<HTMLButtonElement | null>
  onCopy: (text: string, note: string) => void
  onPanel: (panel: MenuPanel) => void
  onArchive: () => void
  onAgent?: (() => void) | undefined
}) {
  const { branch } = task
  const known = useCodeSummary(task.id)
  if (!phone && !changesOverflow && !fold) return null
  const full = phone || fold
  const filesSuffix = known && known.files > 0 ? ` · ${known.files} files` : ""
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            ref={triggerRef}
            className="q-btn quiet sm"
            data-testid="task-more"
            aria-label="More"
            title="More"
          />
        }
      >
        <MoreHorizontalIcon size={16} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-48 whitespace-nowrap">
        {phone && onAgent ? (
          <MenuAction icon={<MessageSquareIcon aria-hidden="true" />} onPick={onAgent}>
            Agent
          </MenuAction>
        ) : null}
        {phone || changesOverflow ? (
          <MenuAction
            icon={<FileDiffIcon aria-hidden="true" />}
            onPick={() => openReviewWorkspace(task.id, null)}
          >
            View changes{filesSuffix}
          </MenuAction>
        ) : null}
        {full && branch ? (
          <MenuAction
            icon={<CopyIcon aria-hidden="true" />}
            onPick={() => onCopy(branch, "Copied the branch name")}
          >
            Copy branch name
          </MenuAction>
        ) : null}
        {full && offersHostActions() ? (
          <MenuAction
            icon={<FolderOpenIcon aria-hidden="true" />}
            onPick={() => void showTaskFolder(api, task.id)}
          >
            Show task folder
          </MenuAction>
        ) : null}
        {phone ? <DropdownMenuSeparator /> : null}
        {contextFolded ? (
          <MenuAction icon={<CoinsIcon aria-hidden="true" />} onPick={() => onPanel("cost")}>
            What it cost
          </MenuAction>
        ) : null}
        {phone || lifecycleFolded ? (
          <LifecycleMenuSection
            archived={Boolean(task.archived)}
            busy={busy}
            phone={phone}
            onArchive={onArchive}
            onDelete={() => onPanel("delete")}
          />
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
