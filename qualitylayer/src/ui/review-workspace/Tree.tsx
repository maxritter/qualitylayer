// The Review workspace's tree: the change's files slice by slice, each with its mark, the folder it is in,
// its name and its counts. Files with a finding that needs the person come first. A filter narrows the
// list by words in a path.

import { CheckCheckIcon, RotateCcwIcon, SearchIcon } from "lucide-react"
import { type ReactNode, useState } from "react"
import type { WalkFile } from "../../core/review/walkthrough.ts"
import { splitPath } from "../files/changes-card.ts"
import type { rowsOf } from "../timeline/Walkthrough.tsx"
import {
  type Fold,
  handleTreeKeyDown,
  LookFirst,
  TreeFolds,
  TreeGroup,
  type TreeRowCallbacks,
} from "./TreeRows.tsx"

export type { Fold } from "./TreeRows.tsx"

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
} & TreeRowCallbacks

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
  const scopeLabel = words ? "filtered" : "all"

  return (
    <nav className="rw-tree" aria-label="Changed files" onKeyDown={handleTreeKeyDown}>
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
          aria-label={`Mark ${scopeLabel} files viewed`}
          title={`Mark ${scopeLabel} files viewed`}
          disabled={scoped.length === 0 || scoped.every(row.isViewed)}
          onClick={() => row.onViewed?.(scoped, true)}
        >
          <CheckCheckIcon size={13} aria-hidden="true" />
          All viewed
        </button>
        <button
          type="button"
          className="rw-lnk"
          aria-label={`Mark ${scopeLabel} files unviewed`}
          title={`Mark ${scopeLabel} files unviewed`}
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
      {groups.map((group) => (
        <TreeGroup
          key={group.key}
          group={group}
          shown={group.files.filter((file) => matches(file.path))}
          activeSlice={activeSlice}
          comments={comments}
          unreadable={unreadable}
          onSelectSlice={onSelectSlice}
          row={row}
        />
      ))}
      {words !== "" && ![...files.keys()].some(matches) ? (
        <p className="rw-none">No changed file matches “{filter}”.</p>
      ) : null}
      {folds !== undefined ? <TreeFolds {...folds} /> : null}
      {details}
    </nav>
  )
}
