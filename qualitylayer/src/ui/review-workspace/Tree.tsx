// The Review workspace's tree: the change's files slice by slice, each with its mark, the folder it is in,
// its name and its counts. Files with a finding that needs the person come first. A filter narrows the
// list by words in a path.

import { cn } from "cn"
import { CheckCheckIcon, CheckIcon, RotateCcwIcon, SearchIcon } from "lucide-react"
import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from "react"
import type { WalkFile } from "../../core/review/walkthrough.ts"
import { splitPath } from "../files/changes-card.ts"
import { FileIcon } from "../kit/marks/index.ts"
import type { rowsOf } from "../timeline/Walkthrough.tsx"

/** The room beside the name a folder needs to be worth showing: about five characters and the slash. */
const MIN_FOLDER_PX = 44

const TREE_MIN_PX = 288
const TREE_MAX_PX = 420
/** What a row holds besides the name: the check, the mark, the counts, the gaps and the scroll bar. */
const ROW_CHROME_PX = 170
/** The advance of one character of the tree's 12 px mono face. */
const MONO_PX = 7.2

/**
 * The width of the tree: its usual 288 px, wider when the longest file name needs it so that every name
 * is shown whole, up to a limit; a window too narrow for any tree hides it (workspace.css).
 */
export function treeWidth(paths: Iterable<string>): number {
  let longest = 0
  for (const path of paths) longest = Math.max(longest, splitPath(path).name.length)
  const needed = Math.ceil(ROW_CHROME_PX + longest * MONO_PX)
  return Math.min(TREE_MAX_PX, Math.max(TREE_MIN_PX, needed))
}

/**
 * Whether the row has room for its folder once the name is whole. The name never shrinks, so the room
 * is what the row leaves after the mark, the name and the gaps; it is read again when the row resizes.
 */
function useRoomForFolder(box: RefObject<HTMLElement | null>): boolean {
  const [room, setRoom] = useState(true)
  useLayoutEffect(() => {
    const row = box.current
    if (row === null || typeof ResizeObserver === "undefined") return
    const measure = () => {
      // A row that is not drawn (a window too narrow for the tree) has no room to measure yet.
      if (row.clientWidth === 0) return
      const [mark, , base] = Array.from(row.children) as HTMLElement[]
      const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0
      const free =
        row.clientWidth - (mark?.offsetWidth ?? 0) - (base?.offsetWidth ?? 0) - 2 * gap - 1
      setRoom(free >= MIN_FOLDER_PX)
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(row)
    return () => watch.disconnect()
  }, [box])
  return room
}

/**
 * A file in the tree: its mark, the folder it is in and its name; the whole path is the tooltip. The
 * name stays whole; the folder shortens with an ellipsis and goes when the row has no room for it.
 */
function TreeName({ path }: { path: string }) {
  const { dir, name } = splitPath(path)
  const parent = dir.split("/").slice(-2, -1)[0] ?? ""
  const box = useRef<HTMLSpanElement>(null)
  const room = useRoomForFolder(box)
  return (
    <span ref={box} className="rw-nm">
      <FileIcon path={path} size={13} />
      <span className="rw-dir" hidden={parent === "" || !room}>
        {parent}/
      </span>
      <span className="rw-base">{name}</span>
    </span>
  )
}

function ViewedBox({ on }: { on: boolean }) {
  return (
    <span className={cn("rw-vb", on && "on")} aria-hidden="true">
      {on ? <CheckIcon className="size-2.5" strokeWidth={3} /> : null}
    </span>
  )
}

type Row = {
  current: string | null
  isViewed: (file: WalkFile) => boolean
  onGo: (path: string) => void
  onViewed?: (files: readonly WalkFile[], on: boolean) => void
}

function ProgressBox({
  files,
  isViewed,
  onViewed,
  label,
}: Pick<Row, "isViewed" | "onViewed"> & { files: readonly WalkFile[]; label: string }) {
  const checked = files.length > 0 && files.every(isViewed)
  const some = files.some(isViewed)
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      ref={(node) => {
        if (node) node.indeterminate = some && !checked
      }}
      onChange={(event) => onViewed?.(files, event.target.checked)}
    />
  )
}

/** Files with a finding that needs the person, above every group. */
function LookFirst({
  rows,
  files,
  current,
  isViewed,
  onGo,
}: Row & { rows: readonly [string, number][]; files: ReadonlyMap<string, WalkFile> }) {
  return (
    <div className="rw-group">
      <div className="rw-gh look">
        <span>Look first</span>
        <span className="rw-n">{rows.reduce((n, [, count]) => n + count, 0)}</span>
      </div>
      {rows.map(([path, count]) => {
        const file = files.get(path)
        const viewed = file !== undefined && isViewed(file)
        return (
          <button
            key={`look:${path}`}
            type="button"
            className={cn("rw-row", path === current && "on", viewed && "viewed")}
            title={`${path}: ${count === 1 ? "a finding needs you" : `${count} findings need you`}`}
            onClick={() => onGo(path)}
          >
            <ViewedBox on={viewed} />
            <TreeName path={path} />
            <span className="rw-ct">
              <span className="rw-cdot need">{count}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function FileRow({
  file,
  notes,
  unread,
  current,
  isViewed,
  onGo,
  onViewed,
}: Row & { file: WalkFile; notes: number; unread: boolean }) {
  return (
    <div
      className={cn("rw-row", file.path === current && "on", isViewed(file) && "viewed")}
      data-path={file.path}
    >
      <ProgressBox
        files={[file]}
        isViewed={isViewed}
        onViewed={onViewed}
        label={`Mark ${file.path} viewed`}
      />
      <button
        type="button"
        className="rw-file-go"
        aria-current={file.path === current ? "true" : undefined}
        onClick={() => onGo(file.path)}
        title={file.path}
      >
        <TreeName path={file.path} />
        <span className="rw-ct">
          {notes > 0 ? <span className="rw-cdot">{notes}</span> : null}
          {unread ? <span className="rw-bad">unavailable</span> : null}
          {file.additions !== null ? <span className="plus">+{file.additions}</span> : null}
          {file.deletions !== null && file.deletions > 0 ? (
            <span className="minus">−{file.deletions}</span>
          ) : null}
        </span>
      </button>
    </div>
  )
}

const groupName = (group: ReturnType<typeof rowsOf>[number]) =>
  group.n !== null ? `Slice ${group.n} · ${group.title}` : group.title

/** What the tree folds until asked: how many there are, whether they are drawn, and the switch. */
export type Fold = { count: number; shown: boolean; toggle: () => void }

const plural = (n: number, one: string) => (n === 1 ? `1 ${one}` : `${n} ${one}s`)

/** The tree's last words: the generated files and the task's documents it does not list until asked. */
function Folds({ generated, documents }: { generated: Fold; documents: Fold }) {
  if (generated.count === 0 && documents.count === 0) return null
  return (
    <div className="rw-tf2">
      {generated.count > 0 ? (
        <span>
          {plural(generated.count, "generated file")} {generated.shown ? "shown" : "folded"} ·{" "}
          <button
            type="button"
            className="rw-lnk"
            aria-label={`${generated.shown ? "Hide" : "Show"} generated files`}
            onClick={generated.toggle}
          >
            {generated.shown ? "Hide" : "Show"}
          </button>
        </span>
      ) : null}
      {documents.count > 0 ? (
        <span>
          The task's documents are {documents.shown ? "shown" : "not shown"} ·{" "}
          <button
            type="button"
            className="rw-lnk"
            aria-label={`${documents.shown ? "Hide" : "Show"} documents`}
            onClick={documents.toggle}
          >
            {documents.shown ? "Hide" : "Show"}
          </button>
        </span>
      ) : null}
    </div>
  )
}

export type TreeProps = {
  groups: ReturnType<typeof rowsOf>
  /** Files with findings that need the person, with how many each has. */
  lookFirst: readonly [string, number][]
  files: ReadonlyMap<string, WalkFile>
  /** How many comments each file holds. */
  comments: ReadonlyMap<string, number>
  unreadable: readonly string[]
  /** The generated files and the task's documents, folded until the person asks. */
  folds?: { generated: Fold; documents: Fold }
  details?: ReactNode
  /** When scoped to one slice, highlights its group header and offers clearing back to all slices. */
  activeSlice?: number | null
  onSelectSlice?: (slice: number | null) => void
} & Row

export function Tree({
  groups,
  lookFirst,
  files,
  comments,
  unreadable,
  folds,
  details,
  activeSlice,
  onSelectSlice,
  ...row
}: TreeProps) {
  const [filter, setFilter] = useState("")
  const words = filter.trim().toLowerCase()
  const matches = (path: string) => words === "" || path.toLowerCase().includes(words)
  const look = lookFirst.filter(([path]) => matches(path))
  const scoped = [...files.values()].filter((file) => matches(file.path))
  return (
    <nav
      className="rw-tree"
      aria-label="Changed files"
      onKeyDown={(event) => {
        if (
          !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) ||
          !(event.target instanceof Element) ||
          !event.target.matches(".rw-file-go")
        )
          return
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(".rw-file-go")]
        const at = buttons.indexOf(event.target as HTMLButtonElement)
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : Math.max(0, Math.min(buttons.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))
        event.preventDefault()
        buttons[next]?.click()
        buttons[next]?.focus()
      }}
    >
      {files.size > 0 ? (
        <label className="rw-filter">
          <SearchIcon className="size-3.5" aria-hidden="true" />
          <input
            type="search"
            placeholder="Filter files"
            aria-label="Filter files"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
      ) : null}
      <fieldset
        className="rw-bulk"
        aria-label={words ? "Filtered file progress" : "All file progress"}
      >
        <button
          type="button"
          className="rw-lnk"
          aria-label={`Mark ${words ? "filtered" : "all"} files viewed`}
          title={`Mark ${words ? "filtered" : "all"} files viewed`}
          disabled={scoped.length === 0 || scoped.every(row.isViewed)}
          onClick={() => row.onViewed?.(scoped, true)}
        >
          <CheckCheckIcon size={13} aria-hidden="true" />
          All viewed
        </button>
        <button
          type="button"
          className="rw-lnk"
          aria-label={`Mark ${words ? "filtered" : "all"} files unviewed`}
          title={`Mark ${words ? "filtered" : "all"} files unviewed`}
          disabled={!scoped.some(row.isViewed)}
          onClick={() => row.onViewed?.(scoped, false)}
        >
          <RotateCcwIcon size={13} aria-hidden="true" />
          Clear
        </button>
      </fieldset>
      {activeSlice !== null && activeSlice !== undefined && onSelectSlice ? (
        <div className="rw-slice-scope" data-testid="review-slice-scope">
          <span>Scoped to Slice {activeSlice}</span>
          <button type="button" className="rw-lnk" onClick={() => onSelectSlice(null)}>
            All slices
          </button>
        </div>
      ) : null}
      {look.length > 0 ? <LookFirst rows={look} files={files} {...row} /> : null}
      {groups.map((group) => {
        const shown = group.files.filter((file) => matches(file.path))
        const scopedSlice = group.n !== null && activeSlice === group.n
        return shown.length === 0 ? null : (
          <div key={group.key} className={cn("rw-group", scopedSlice && "scoped")}>
            <div className="rw-gh">
              <ProgressBox
                files={shown}
                isViewed={row.isViewed}
                onViewed={row.onViewed}
                label={`Mark ${groupName(group)} viewed`}
              />
              {group.n !== null && onSelectSlice ? (
                <button
                  type="button"
                  className={cn("rw-gh-btn", scopedSlice && "on")}
                  title={`${groupName(group)} — click to scope this slice`}
                  aria-pressed={scopedSlice}
                  onClick={() => onSelectSlice(scopedSlice ? null : group.n)}
                >
                  {groupName(group)}
                </button>
              ) : (
                <span title={groupName(group)}>{groupName(group)}</span>
              )}
              <span className="rw-n">
                {shown.filter(row.isViewed).length} of {shown.length}
              </span>
            </div>
            {shown.map((file) => (
              <FileRow
                key={file.path}
                file={file}
                notes={comments.get(file.path) ?? 0}
                unread={unreadable.includes(file.path)}
                {...row}
              />
            ))}
          </div>
        )
      })}
      {words !== "" && ![...files.keys()].some(matches) ? (
        <p className="rw-none">No changed file matches “{filter}”.</p>
      ) : null}
      {folds !== undefined ? <Folds {...folds} /> : null}
      {details}
    </nav>
  )
}
