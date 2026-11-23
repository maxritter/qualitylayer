import type { ReadingMode } from "./ReadingControls.tsx"

function Unavailable({
  title = "This file version could not be read",
  reason,
  retry,
  diff,
  retryAll,
}: {
  title?: string
  reason: string
  retry: () => void
  diff?: () => void
  retryAll?: () => void
}) {
  return (
    <div role="alert" className="rw-note">
      <h2>{title}</h2>
      <p>{reason}</p>
      <p>Your Viewed marks and comments are kept.</p>
      <button type="button" className="rw-btn" onClick={retry}>
        Try again
      </button>
      {diff ? (
        <button type="button" className="rw-btn quiet" onClick={diff}>
          Read the diff
        </button>
      ) : null}
      {retryAll ? (
        <button type="button" className="rw-btn" onClick={retryAll}>
          Retry failed files
        </button>
      ) : null}
    </div>
  )
}

function FileModeStatus({
  source,
  onDiff,
}: {
  source: { ready: boolean; error: string | undefined; retry: () => void }
  onDiff: () => void
}) {
  if (source.error) return <Unavailable reason={source.error} retry={source.retry} diff={onDiff} />
  if (!source.ready)
    return (
      <p role="status" className="rw-note">
        Reading the exact file revision…
      </p>
    )
  return null
}

function DiffModeStatus({
  state,
  current,
  count,
  loaded,
  errors,
  retry,
}: {
  state: "loading" | "ready" | "failed"
  current: string | null
  count: number
  loaded: number
  errors: ReadonlyMap<string, string>
  retry: (paths: readonly string[]) => void
}) {
  const reason = current === null ? undefined : errors.get(current)
  if (reason !== undefined && current !== null)
    return (
      <Unavailable
        title={errors.size === count && loaded === 0 ? "The diffs could not be read" : undefined}
        reason={`${current}: ${reason}`}
        retry={() => retry([current])}
        {...(errors.size > 1 ? { retryAll: () => retry([...errors.keys()]) } : {})}
      />
    )
  if (state === "loading" || loaded === 0)
    return (
      <p role="status" className="rw-note">
        Reading {count === 1 ? "the file" : `${count} files`}…
      </p>
    )
  return null
}

export function ReadStatus({
  missing,
  empty,
  state,
  mode,
  source,
  current,
  count,
  loaded,
  errors,
  retry,
  onDiff,
}: {
  missing: string | null
  empty: boolean
  state: "loading" | "ready" | "failed"
  mode: ReadingMode
  source: { ready: boolean; error: string | undefined; retry: () => void }
  current: string | null
  count: number
  loaded: number
  errors: ReadonlyMap<string, string>
  retry: (paths: readonly string[]) => void
  onDiff: () => void
}) {
  if (missing !== null)
    return (
      <>
        {empty ? (
          <p role="status" className="rw-note" data-testid="review-empty">
            No changes against the base yet.
          </p>
        ) : null}
        <p role="status" className="rw-note rw-note-changed" data-testid="review-missing">
          {missing} is not part of this change.
        </p>
      </>
    )
  if (state === "failed")
    return (
      <p role="alert" className="rw-note">
        The diff viewer could not be loaded. Close the workspace and read the files on the Review
        page, or inspect them with Git in the task checkout.
      </p>
    )
  if (empty)
    return (
      <p role="status" className="rw-note" data-testid="review-empty">
        No changes against the base yet.
      </p>
    )
  if (mode === "file") return <FileModeStatus source={source} onDiff={onDiff} />
  return (
    <DiffModeStatus
      state={state}
      current={current}
      count={count}
      loaded={loaded}
      errors={errors}
      retry={retry}
    />
  )
}
