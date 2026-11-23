// The selected file's path menu in Files, with the file and task-folder actions.
// The shared helpers resolve a view's registered file and its path.

import {
  ChevronDownIcon,
  CopyIcon,
  FileCodeIcon,
  FileTextIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { TaskFile } from "../core/docs/names.ts"
import { trimEndCharacters } from "../core/text-boundaries.ts"
import type { Api, TaskDetail } from "./api.ts"
import { api as liveApi } from "./api.ts"
import { setDocumentRecord, useDocumentRecord } from "./docs/mode.ts"
import { showFileInFolderLabel } from "./file-action-labels.ts"
import { useQuery } from "./hooks.ts"
import { offersHostActions } from "./machines/framed.ts"
import { viewedStep } from "./model.ts"

/** The file a view shows: a document by its name, a step's own page by the step's file. */
export function viewFile(detail: Pick<TaskDetail, "files">, view: string): TaskFile | undefined {
  const named = detail.files.find((file) => file.name === view)
  if (named !== undefined) return named
  const step = viewedStep(view)
  return step === null ? undefined : detail.files.find((file) => file.role === step)
}

/** The path on disk of a file in the task folder, spelt with the separator the folder's path uses. */
export function fullPathOf(detail: Pick<TaskDetail, "dir">, name: string): string {
  const sep = detail.dir.includes("\\") && !detail.dir.includes("/") ? "\\" : "/"
  return `${trimEndCharacters(detail.dir, "\\/")}${sep}${name}`
}

function loadTaskRecords(
  open: boolean,
  onOpen: ((view: string) => void) | undefined,
  api: Pick<Api, "openFile" | "taskRecords">,
  taskId: string,
) {
  if (!open || !onOpen || !api.taskRecords) return Promise.resolve([])
  if (api !== liveApi && api.taskRecords === liveApi.taskRecords) return Promise.resolve([])
  return api.taskRecords(taskId)
}

function HostFileActions({
  reading,
  file,
  onStart,
}: {
  reading: string | null
  file: TaskFile | undefined
  onStart: (target: string, how: "open" | "reveal" | "folder", done: string) => void
}) {
  const target = reading ?? file?.name ?? ""
  const openDisabled = reading ? !/\.(md|txt)$/.test(reading) : !file?.exists
  const revealDisabled = reading === null && !file?.exists
  return (
    <>
      <DropdownMenuItem
        disabled={openDisabled}
        onClick={() => onStart(target, "open", `Opened ${target}`)}
      >
        <FileCodeIcon aria-hidden="true" />
        Open file
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={revealDisabled}
        onClick={() => onStart(target, "reveal", `Showed ${target} in its folder`)}
      >
        <FolderOpenIcon aria-hidden="true" />
        {showFileInFolderLabel()}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  )
}

function MoreAgentRecordsSub({
  records,
  onSelect,
}: {
  records: { name: string }[]
  onSelect: (path: string) => void
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <FileTextIcon aria-hidden="true" />
        More agent records
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className="w-[330px] max-w-[calc(100vw-32px)] max-sm:w-(--anchor-width) max-sm:data-[side=right]:-translate-x-full max-sm:data-[side=left]:translate-x-full"
        data-testid="agent-records-menu"
      >
        {records.map((entry) => (
          <DropdownMenuItem key={entry.name} onClick={() => onSelect(entry.name)}>
            <FileTextIcon aria-hidden="true" />
            <span className="truncate" title={entry.name}>
              {entry.name}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

async function runHostFileAction(
  api: Pick<Api, "openFile">,
  taskId: string,
  target: string,
  how: "open" | "reveal" | "folder",
  done: string,
): Promise<void> {
  try {
    await api.openFile(taskId, target, how)
    toast.success(done)
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : String(cause))
  }
}

function DocPathMenuContent({
  full,
  host,
  reading,
  file,
  slug,
  otherRecords,
  onCopy,
  onStart,
  onSelectRecord,
  onDiff,
}: {
  full: string | null
  host: boolean
  reading: string | null
  file: TaskFile | undefined
  slug: string
  otherRecords: { name: string }[] | null
  onCopy: (text: string, note: string) => void
  onStart: (target: string, how: "open" | "reveal" | "folder", done: string) => void
  onSelectRecord: (path: string) => void
  onDiff?: () => void
}) {
  return (
    <DropdownMenuContent
      align="start"
      className="dg-chipmenu w-[330px] max-w-[calc(100vw-32px)]"
      data-testid="file-chip-menu"
    >
      {full !== null ? (
        <>
          <div className="p" data-testid="doc-full-path">
            {full}
          </div>
          <DropdownMenuItem onClick={() => onCopy(full, "Copied the path")}>
            <CopyIcon aria-hidden="true" />
            Copy path
          </DropdownMenuItem>
        </>
      ) : null}
      {host && (file !== undefined || reading !== null) ? (
        <HostFileActions reading={reading} file={file} onStart={onStart} />
      ) : null}
      {host ? (
        <DropdownMenuItem onClick={() => onStart(".", "folder", "Opened the task folder")}>
          <FolderOpenIcon aria-hidden="true" />
          Open the task folder
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onClick={() => onCopy(slug, "Copied the task's name")}>
        <CopyIcon aria-hidden="true" />
        Copy the task's name
        <span className="k">for QualityLayer</span>
      </DropdownMenuItem>
      {otherRecords !== null && otherRecords.length > 0 ? (
        <MoreAgentRecordsSub records={otherRecords} onSelect={onSelectRecord} />
      ) : null}
      {onDiff ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDiff}>What the agent changed in the Plan</DropdownMenuItem>
        </>
      ) : null}
    </DropdownMenuContent>
  )
}

/**
 * A file's menu: the full path, Copy
 * path, Open in editor, Reveal in Finder, Open the task folder and Copy the task's name (what
 * `/ql implement` takes). It looks like what it is: a chevron, a pointer, hover and pressed states.
 */
export function DocPathChip({
  detail,
  view,
  agent,
  api,
  onCopy,
  onDiff,
  onOpen,
  compact = false,
}: {
  detail: Pick<TaskDetail, "id" | "dir" | "slug" | "files" | "showMe">
  view: string
  /** The agent working on the task; null when no session has it. */
  agent: string | null
  api: Pick<Api, "openFile" | "taskRecords">
  onCopy: (text: string, note: string) => void
  onDiff?: () => void
  onOpen?: (view: string) => void
  /** The selected Files row owns the same path menu without a second file heading. */
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const records = useQuery(
    () => loadTaskRecords(open, onOpen, api, detail.id),
    [open, api, detail.id, Boolean(onOpen)],
  )
  const file = viewFile(detail, view)
  const record = useDocumentRecord()
  const reading = record?.taskId === detail.id ? record.path : null
  const page = file === undefined ? detail.showMe.find((p) => p.name === view) : undefined
  const name = reading ?? file?.name ?? page?.title
  if (name === undefined) return null
  const otherRecords = onOpen
    ? (records.data ?? []).filter((entry) => !detail.files.some((item) => item.name === entry.name))
    : null
  const by = reading ? "read only" : agent !== null ? `by ${agent}` : ""
  const full = reading
    ? `${detail.dir}/${reading}`
    : file !== undefined
      ? fullPathOf(detail, file.name)
      : null
  const openRecord = (path: string) => {
    onOpen?.(view)
    setDocumentRecord({ taskId: detail.id, path })
  }
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={compact ? "ir-file-menu" : "q-chip q-filechip"}
            data-testid="doc-file-chip"
            title="The file: its path, copy, open or show it"
            aria-label={compact ? `File actions for ${name}` : undefined}
          />
        }
      >
        {compact ? (
          <MoreHorizontalIcon size={14} aria-hidden="true" />
        ) : (
          <>
            <FileTextIcon className="size-3 flex-none" aria-hidden="true" />
            <span className="nm">{name}</span>
            {by !== "" ? <span className="by">· {by}</span> : null}
            <ChevronDownIcon className="chev" aria-hidden="true" />
          </>
        )}
      </DropdownMenuTrigger>
      <DocPathMenuContent
        full={full}
        host={offersHostActions()}
        reading={reading}
        file={file}
        slug={detail.slug}
        otherRecords={otherRecords}
        onCopy={onCopy}
        onStart={(target, how, done) => void runHostFileAction(api, detail.id, target, how, done)}
        onSelectRecord={openRecord}
        onDiff={onDiff}
      />
    </DropdownMenu>
  )
}
