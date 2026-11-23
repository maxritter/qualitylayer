// The designed state for opening something: an artifact (its page frame and side rail), the Artifacts list,
// Home's first read and the sidebar's project list. App Model: artifact-loading, artifacts-loading,
// home-loading. The frame around it is the App's own; only the content waits, as an outline of its shape
// under one status line. After five seconds the line says it is still opening and for how long.

import { type ReactNode, useEffect, useState } from "react"
import { WhoMark } from "./WhoMark.tsx"
import "./loading-state.css"

/** Whole seconds since `startedAt`, once a second; 0 while `on` is false. */
function useElapsed(on: boolean, startedAt: number): number {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!on) return
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [on, startedAt])
  return on ? elapsed : 0
}

export const SLOW_AFTER_SECONDS = 5

const bar = (width: string) => <span className={`q-ld-bar q-ld-w${width}`} />

/** Two project groups of rows, the shape of the Artifacts list. */
function ListOutline() {
  return (
    <div className="q-ld-list q-ld-out q-ld-sheen" aria-hidden="true">
      {[0, 1].map((group) => (
        <div className="q-ld-group" key={group}>
          <div className="q-ld-head">
            <span className="q-ld-dot" />
            {bar("40")}
          </div>
          <div className="q-ld-rows">
            {["70", "55", "80"].map((width) => (
              <div className="q-ld-row" key={width}>
                <span className="q-ld-thumb" />
                {bar(width)}
                <span className="q-ld-pill" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** A step page's outline: a title, a few lines, a card of rows and a block, never invented content. */
function PageOutline() {
  return (
    <div className="q-ld-doc q-ld-out q-ld-sheen" aria-hidden="true">
      <span className="q-ld-bar q-ld-h1" />
      <span className="q-ld-bar q-ld-meta" />
      {bar("90")}
      {bar("80")}
      {bar("60")}
      <div className="q-ld-rows">
        {["70", "60", "80"].map((width) => (
          <div className="q-ld-row q-ld-row-dot" key={width}>
            <span className="q-ld-dot" />
            {bar(width)}
            <span className="q-ld-pill" />
          </div>
        ))}
      </div>
      <div className="q-ld-block" />
      {bar("90")}
      {bar("40")}
    </div>
  )
}

function FrameOutline() {
  return (
    <div className="q-ld-frame q-ld-out q-ld-sheen" aria-hidden="true">
      <div className="q-ld-wf">
        <i className="side" />
        <i className="top" />
        <div className="main">
          <i className="w7" />
          <i className="w5" />
          <i className="big" />
          <i />
          <i className="w7" />
        </div>
      </div>
    </div>
  )
}

export type LoadingStateProps = {
  kind: "artifact" | "library" | "task"
  /** What is happening, in the person's words: "Opening the artifact", "Drawing Usage", "Opening Artifacts". */
  what: string
  /** The read failed: the card says why and offers a retry. */
  error?: Error | null
  /** The card's title; each kind has its own. */
  failedTitle?: string
  onRetry?: () => void
  /** The way out while it is slow or failed. */
  back?: { label: string; onClick: () => void }
  /** Under the status line once it is slow: what the person can do meanwhile. */
  slowNote?: ReactNode
}

function LoadingOutline({ kind }: { kind: LoadingStateProps["kind"] }) {
  if (kind === "artifact") return <FrameOutline />
  return kind === "task" ? <PageOutline /> : <ListOutline />
}

function LoadingFailure({
  kind,
  error,
  failedTitle,
  onRetry,
  back,
}: {
  kind: LoadingStateProps["kind"]
  error: Error
  failedTitle?: string | undefined
  onRetry?: (() => void) | undefined
  back?: LoadingStateProps["back"]
}) {
  return (
    <div className="q-ld-over">
      <section className="q-ld-fail" role="alert">
        <h2>
          <span className="q-ld-mark" aria-hidden="true" />
          {failedTitle ?? "This didn't open"}
        </h2>
        <p>{error.message}</p>
        <div className="q-ld-act">
          {onRetry ? (
            <button type="button" className="q-btn primary" onClick={onRetry}>
              {kind === "artifact" ? "Reload" : "Try again"}
            </button>
          ) : null}
          {back ? (
            <button type="button" className="q-btn quiet" onClick={back.onClick}>
              {back.label}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  )
}

export function LoadingState({
  kind,
  what,
  error = null,
  failedTitle,
  onRetry,
  back,
  slowNote,
}: LoadingStateProps) {
  const [startedAt, setStartedAt] = useState(Date.now)
  const failed = error !== null
  const elapsed = useElapsed(!failed, startedAt)
  const slow = !failed && elapsed >= SLOW_AFTER_SECONDS
  const words = slow ? `Still ${what.charAt(0).toLowerCase()}${what.slice(1)}` : what
  const floating = kind === "artifact"
  const retry = onRetry
    ? () => {
        setStartedAt(Date.now())
        onRetry()
      }
    : undefined
  return (
    <div
      className={`q-ld q-ld-${kind}`}
      data-state={failed ? "failed" : slow ? "slow" : "opening"}
      data-testid="loading-state"
      aria-busy={!failed}
    >
      {failed ? null : (
        <p className={floating ? "q-ld-float" : "q-ld-status"} role="status">
          <span className="q-ld-spin" aria-hidden="true" />
          <b>{words}</b>
          {slow ? <span className="q-ld-time">· {elapsed} s</span> : null}
          {slow && floating && back ? (
            <button type="button" className="q-link" onClick={back.onClick}>
              {back.label}
            </button>
          ) : null}
        </p>
      )}
      {slow && !floating && slowNote ? <p className="q-ld-sub">{slowNote}</p> : null}
      <LoadingOutline kind={kind} />
      {failed ? (
        <LoadingFailure
          kind={kind}
          error={error}
          failedTitle={failedTitle}
          onRetry={retry}
          back={back}
        />
      ) : null}
    </div>
  )
}

/** The right sidebar's body while an artifact opens: its tabs are real, its body waits. */
export function LoadingRail() {
  return (
    <div className="q-ld-rail q-ld-out q-ld-sheen" aria-hidden="true" data-testid="loading-rail">
      <div className="q-ld-term">
        {["60", "80", "40", "70"].map((width) => (
          <span className={`q-ld-bar q-ld-w${width}`} key={width} />
        ))}
      </div>
      {bar("60")}
      {bar("40")}
    </div>
  )
}

/** Home on its first read: both sections keep their names and wait as outlines; no count and no sentence says "nothing" yet. */
export function HomeLoading() {
  // The Running mark is the neutral one: no agent is known to work before the list has arrived.
  const sections: { id: string; title: string; who: "you" | "todo"; rows: string[] }[] = [
    { id: "needs-you", title: "Needs you", who: "you", rows: ["70", "55"] },
    { id: "running", title: "Running", who: "todo", rows: ["60", "80", "45"] },
  ]
  return (
    <div
      className="@container hf-home min-h-0 flex-1 overflow-auto q-ld-home"
      aria-busy="true"
      data-testid="home-loading"
    >
      <header className="hf-heading">
        <h1>Home</h1>
      </header>
      <p className="sr-only" role="status">
        Opening Home
      </p>
      <div className="hf-grid">
        <div className="hf-main">
          {sections.map((section) => (
            <section
              key={section.id}
              className="hf-section hf-job"
              aria-labelledby={`q-ld-${section.id}`}
            >
              <header className="hf-section-header">
                <h2 id={`q-ld-${section.id}`}>
                  <WhoMark who={section.who} />
                  {section.title}
                </h2>
              </header>
              <div className="q-ld-rows q-ld-out q-ld-sheen" aria-hidden="true">
                {section.rows.map((width) => (
                  <div className="q-ld-row" key={width}>
                    <span className="q-ld-dot" />
                    {bar(width)}
                    <span className="q-ld-pill" />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

/** The sidebar's project list on the first read, so "No projects yet" is never said before the list is known. */
export function NavLoading() {
  return (
    <div className="q-ld-nav q-ld-out q-ld-sheen" aria-hidden="true" data-testid="nav-loading">
      {["60", "45", "70"].map((width) => (
        <div key={width}>
          <div className="q-ld-nav-row">
            <span className="q-ld-tile" />
            {bar(width)}
          </div>
          {width === "60" ? (
            <div className="q-ld-nav-sub">
              {bar("70")}
              {bar("60")}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/** A few lines of a sidebar section that is still being read. */
export function LoadingLines({ label }: { label: string }) {
  return (
    <div
      className="q-ld-lines q-ld-out q-ld-sheen"
      role="status"
      aria-label={label}
      aria-busy="true"
    >
      {["80", "60", "70"].map((width) => (
        <span className={`q-ld-bar q-ld-w${width}`} key={width} />
      ))}
    </div>
  )
}
