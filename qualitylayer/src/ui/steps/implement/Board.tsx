// Implement opens every populated slice, including the group of completed slices.

import { ChevronRightIcon, FileDiffIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { Disclosure } from "../../kit/Fold.tsx"
import { WhoMark } from "../../kit/WhoMark.tsx"
import { InlineMarkdown } from "../../reader/DocReader.tsx"
import { openReviewWorkspace } from "../../review-workspace/open.ts"
import { TitleWithState } from "../../step-page/kit/StateMark.tsx"
import { TaskCards } from "../../step-page/RecordDrawer.tsx"
import type { BoardSlice } from "../../step-page/state.ts"

const FOLD_DONE_PAST = 5

function Segments({ slice }: { slice: BoardSlice }) {
  const done = slice.segs.filter((g) => g === "d").length
  return (
    <span
      className={`ib-segs${slice.status === "wait" ? " idle" : ""}`}
      role="img"
      aria-label={`${done} of ${slice.tasks} tasks done${slice.status === "done" ? ", slice done" : ""}`}
    >
      {slice.segs.map((g, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: one segment per task, in order
        <i key={i} className={g} />
      ))}
    </span>
  )
}

function nonLinearDeps(slice: BoardSlice): number[] {
  const deps = slice.dependsOn ?? []
  if (deps.length === 0) return []
  if (deps.length === 1 && deps[0] === slice.n - 1 && !slice.dependsReason) return []
  return deps
}

function SliceRow({
  slice,
  open,
  onToggle,
  taskId,
}: {
  slice: BoardSlice
  open: boolean
  onToggle: () => void
  taskId?: string
}) {
  const expandable = slice.cards !== undefined && slice.cards.length > 0
  const state = slice.status === "done" ? "done" : slice.status === "run" ? "work" : "todo"
  const deps = nonLinearDeps(slice)
  const canDiff = taskId !== undefined && slice.status === "done"
  const done = slice.status === "done"
  const head = (
    <>
      <span
        className={done ? "sp-no ib-done-no" : "sp-no"}
        title={done ? `Slice ${slice.n} done` : undefined}
      >
        <span className="sr-only">Slice </span>
        {slice.n}
      </span>
      <span className="ib-title">
        {done ? (
          <InlineMarkdown text={slice.title} />
        ) : (
          <TitleWithState state={state}>
            <InlineMarkdown text={slice.title} />
          </TitleWithState>
        )}
        {deps.length > 0 ? (
          <span className="ib-dep-chip" title={slice.dependsReason ?? undefined}>
            Depends on {deps.map((n) => `S${n}`).join(", ")}
          </span>
        ) : null}
        {slice.filesChanged ? (
          <span className="ib-files-n">
            {slice.filesChanged === 1 ? "1 file" : `${slice.filesChanged} files`}
          </span>
        ) : null}
      </span>
      <Segments slice={slice} />
      {expandable ? (
        <ChevronRightIcon className={`ib-chev size-3.5${open ? " open" : ""}`} aria-hidden="true" />
      ) : (
        <span />
      )}
    </>
  )
  return (
    <div
      id={`ib-slice-${slice.n}`}
      className="ib-slice"
      data-testid="slice"
      data-status={slice.status}
      data-open={open}
    >
      <div className="ib-head-wrap">
        {expandable ? (
          <button
            type="button"
            className="ib-head"
            aria-expanded={open}
            aria-label={`Slice ${slice.n}: ${slice.title}`}
            onClick={onToggle}
          >
            {head}
          </button>
        ) : (
          <div className="ib-head plain">{head}</div>
        )}
        {canDiff ? (
          <button
            type="button"
            className="q-btn xs ib-diff-btn"
            data-testid={`implement-view-diff-${slice.n}`}
            onClick={() => openReviewWorkspace(taskId, { slice: slice.n })}
          >
            <FileDiffIcon className="size-3" aria-hidden="true" />
            View diff
          </button>
        ) : null}
      </div>
      {open && expandable ? (
        <div className="ib-tasks" data-testid="slice-open">
          <TaskCards
            cards={slice.cards ?? []}
            initial={(slice.cards ?? []).filter((c) => c.state === "building").map((c) => c.id)}
          />
        </div>
      ) : null}
    </div>
  )
}

export function Board({
  slices,
  taskId,
  focusSlice,
}: {
  slices: readonly BoardSlice[]
  taskId?: string
  focusSlice?: { n: number; seq: number } | null
}) {
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({})
  useEffect(() => {
    if (!focusSlice) return
    setCollapsed((old) => ({ ...old, [focusSlice.n]: false }))
    document
      .getElementById(`ib-slice-${focusSlice.n}`)
      ?.scrollIntoView?.({ behavior: "smooth", block: "nearest" })
  }, [focusSlice])
  const done = slices.filter((s) => s.status === "done")
  const folded = done.length > FOLD_DONE_PAST ? done : []
  const shown = slices.filter((s) => !folded.includes(s))
  const row = (slice: BoardSlice) => (
    <SliceRow
      key={slice.n}
      slice={slice}
      taskId={taskId}
      open={Boolean(slice.cards?.length) && !collapsed[slice.n]}
      onToggle={() => setCollapsed((old) => ({ ...old, [slice.n]: !old[slice.n] }))}
    />
  )
  return (
    <div className="ib-board" data-testid="board">
      {folded.length > 0 ? (
        <Disclosure
          className="sp-done-fold ib-slice"
          data-testid="done-slices"
          open
          chevronClassName="bd-chev size-3.5"
          head={
            <>
              <WhoMark who="done" />
              <b>{folded.length} slices done</b>
              <span className="sp-done-n">{folded.reduce((sum, s) => sum + s.tasks, 0)} tasks</span>
            </>
          }
        >
          {folded.map(row)}
        </Disclosure>
      ) : null}
      {shown.map(row)}
    </div>
  )
}
