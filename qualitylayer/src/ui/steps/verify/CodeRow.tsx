// The code review section (Workflow model, Verify): viewed progress bar, secondary Review the code
// button (Approve stays the sole primary CTA), and the deterministic ordered Change Stack of slices
// jumping straight into ReviewWorkspace scoped to that slice.

import { CheckIcon, ChevronDownIcon, FileDiffIcon } from "lucide-react"
import { useState } from "react"
import { isGeneratedPath } from "../../../core/review/generated.ts"
import type { WalkFile, WalkSlice, Walkthrough } from "../../../core/review/walkthrough.ts"
import type { Query } from "../../hooks.ts"
import { openReviewWorkspace, useCodeSummary } from "../../review-workspace/open.ts"
import { compactDmLabel, stripInlineCode } from "../../step-page/graph-edges.tsx"
import { rowsOf } from "../../timeline/Walkthrough.tsx"

const SHOW_SLICES = 6

const stampOf = (f: WalkFile) => f.stamp ?? `${f.additions}-${f.deletions}`

function readViewedMarks(taskId: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(`ql:review-viewed:${taskId}`) ?? "{}") as Record<
      string,
      string
    >
  } catch {
    return {}
  }
}

function nonLinearDeps(slice: WalkSlice, index: number): number[] {
  const deps = slice.dependsOn ?? []
  if (deps.length === 0) return []
  if (deps.length === 1 && index > 0 && deps[0] === slice.n - 1 && !slice.dependsReason) return []
  return deps
}

function generatedCountOf(walk: Walkthrough | null): number {
  if (walk === null) return 0
  return new Set(
    rowsOf(walk).flatMap((entry) =>
      entry.files.filter((file) => isGeneratedPath(file.path)).map((file) => file.path),
    ),
  ).size
}

function SliceMeta({ slice, readable }: { slice: WalkSlice; readable: readonly WalkFile[] }) {
  if (readable.length === 0) {
    const count = slice.tasks.length
    return (
      <span className="rvw-stack-meta">
        <span>{count === 1 ? "1 task" : `${count} tasks`}</span>
      </span>
    )
  }
  const add = slice.additions ?? 0
  const del = slice.deletions ?? 0
  return (
    <span className="rvw-stack-meta">
      <span>{readable.length === 1 ? "1 file" : `${readable.length} files`}</span>
      {add > 0 ? <span className="plus">+{add}</span> : null}
      {del > 0 ? <span className="minus">−{del}</span> : null}
    </span>
  )
}

function ChangeStackRow({
  taskId,
  slice,
  index,
  isFileViewed,
}: {
  taskId: string
  slice: WalkSlice
  index: number
  isFileViewed: (file: WalkFile) => boolean
}) {
  const readable = slice.files.filter((f) => !isGeneratedPath(f.path))
  const done = readable.length > 0 && readable.every(isFileViewed)
  const deps = nonLinearDeps(slice, index)
  const dm = slice.points?.length ? compactDmLabel(slice.points) : null
  return (
    <li>
      <button
        type="button"
        className={`rvw-stack-row${done ? " viewed" : ""}`}
        data-testid={`review-stack-slice-${slice.n}`}
        onClick={() =>
          openReviewWorkspace(taskId, {
            slice: slice.n,
            file: readable[0]?.path ?? null,
          })
        }
      >
        <span className={`rvw-stack-num${done ? " done" : ""}`} aria-hidden="true">
          {done ? <CheckIcon className="size-3" strokeWidth={2.5} /> : slice.n}
        </span>
        <span className="sr-only">
          Slice {slice.n}
          {done ? ", viewed" : ""}:{" "}
        </span>
        <span className="rvw-stack-body">
          <span className="rvw-stack-title">
            <b>{slice.title}</b>
            {deps.length > 0 ? (
              <span className="rvw-chip">Depends on {deps.map((n) => `S${n}`).join(", ")}</span>
            ) : null}
            {dm ? (
              <span className="rvw-chip pass" title={dm.title}>
                {dm.label}
              </span>
            ) : null}
          </span>
          {slice.summary !== "" ? (
            <span className="rvw-stack-sum">{stripInlineCode(slice.summary)}</span>
          ) : null}
        </span>
        <SliceMeta slice={slice} readable={readable} />
      </button>
    </li>
  )
}

function CodeNotice({ taskId, view }: { taskId: string; view: Query<Walkthrough | null> }) {
  if (view.data === null) {
    return (
      <p role={view.error ? "alert" : "status"}>
        {view.error
          ? `The change could not be read. ${view.error.message} `
          : view.loading
            ? "Reading the change…"
            : "File count is not available."}
        {view.error ? (
          <button type="button" className="q-link" onClick={view.reload}>
            Try again
          </button>
        ) : null}
      </p>
    )
  }
  if (!view.data.counted) {
    return (
      <p>
        File count is not available.{" "}
        <button type="button" className="q-link" onClick={() => openReviewWorkspace(taskId)}>
          Review the code
        </button>
      </p>
    )
  }
  return null
}

function CodeSummaryBar({
  taskId,
  summary,
  generated,
}: {
  taskId: string
  summary: NonNullable<ReturnType<typeof useCodeSummary>>
  generated: number
}) {
  const commentLabel =
    summary.comments > 0
      ? ` · ${summary.comments === 1 ? "1 comment" : `${summary.comments} comments`}`
      : ""
  const progressPct =
    summary.files > 0 ? `${Math.min(100, (summary.read / summary.files) * 100)}%` : "0%"
  return (
    <div className="review-code-entry" data-testid="review-code-row">
      <FileDiffIcon className="review-code-icon" aria-hidden="true" />
      <b>
        {summary.read} of {summary.files} viewed{commentLabel}
      </b>
      <div
        className="review-code-progress"
        role="progressbar"
        aria-label="Code files viewed"
        aria-valuemin={0}
        aria-valuemax={summary.files}
        aria-valuenow={summary.read}
      >
        <span style={{ width: progressPct }} />
      </div>
      {generated > 0 ? <span className="review-code-generated">+{generated} generated</span> : null}
      <button type="button" className="q-btn" onClick={() => openReviewWorkspace(taskId)}>
        Review the code
      </button>
    </div>
  )
}

export function CodeRow({ taskId, view }: { taskId: string; view: Query<Walkthrough | null> }) {
  const summary = useCodeSummary(taskId)
  const [expanded, setExpanded] = useState(false)
  const walk = view.data
  const viewedMarks = walk !== null ? readViewedMarks(taskId) : {}
  const isFileViewed = (file: WalkFile) =>
    viewedMarks[file.path] !== undefined && viewedMarks[file.path] === stampOf(file)
  const generated = generatedCountOf(walk)
  const slices = walk !== null && walk.counted ? walk.slices : []
  const shownSlices =
    expanded || slices.length <= SHOW_SLICES ? slices : slices.slice(0, SHOW_SLICES)

  return (
    <section className="review-final-code" aria-label="Code review">
      {summary !== null ? (
        <CodeSummaryBar taskId={taskId} summary={summary} generated={generated} />
      ) : null}
      {shownSlices.length > 0 ? (
        <ol className="rvw-stack" aria-label="Change stack" data-testid="review-change-stack">
          {shownSlices.map((slice, index) => (
            <ChangeStackRow
              key={slice.n}
              taskId={taskId}
              slice={slice}
              index={index}
              isFileViewed={isFileViewed}
            />
          ))}
        </ol>
      ) : null}
      {slices.length > SHOW_SLICES ? (
        <button
          type="button"
          className="q-link rvw-stack-more"
          onClick={() => setExpanded((open) => !open)}
        >
          <ChevronDownIcon
            className={`size-3.5${expanded ? " rotate-180" : ""}`}
            aria-hidden="true"
          />
          {expanded ? "Show fewer slices" : `Show all ${slices.length} slices`}
        </button>
      ) : null}
      <CodeNotice taskId={taskId} view={view} />
    </section>
  )
}
