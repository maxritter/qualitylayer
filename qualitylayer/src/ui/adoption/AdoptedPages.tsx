// A task started from the person's existing plan (App Model: existing-plan-approval.html). The Plan
// page ends with the original, read-only and whole, beside the agreement that maps it; nothing here
// edits the original.

import { useEffect, useRef, useState } from "react"
import type { Api, TaskDetail } from "../api.ts"
import "./adoption.css"

/** A line range of the original a passage of the Plan cites: `original-plan.md, lines 70–71`. */
export type SourceRef = { label: string; from: number; to: number }

/**
 * The citations in the agreement, in order: each `original-plan.md, line N` or `lines N–M`, labelled
 * by the bold headline of the list item it stands in (or the item's opening words).
 */
export function sourceRefs(agreement: string): SourceRef[] {
  const refs: SourceRef[] = []
  for (const line of agreement.split(/\r?\n/)) {
    for (const match of line.matchAll(
      /original-plan\.md,?\s+lines?\s+(\d+)(?:\s*[–-]\s*(\d+))?/gi,
    )) {
      const from = Number(match[1])
      const to = match[2] !== undefined ? Number(match[2]) : from
      const bold = /\*\*(.+?)\*\*/.exec(line)?.[1]
      const words = line
        .replace(/^\s*(?:[-*]|\d+\.)\s+/, "")
        .replace(/\*\*/g, "")
        .trim()
      const label = (bold ?? words).replace(/[.:]$/, "").slice(0, 80)
      if (from > 0 && to >= from) refs.push({ label, from, to })
    }
  }
  return refs
}

function lineRangeLabel(ref: SourceRef) {
  return ref.from === ref.to ? `line ${ref.from}` : `lines ${ref.from}–${ref.to}`
}

function useOriginalText(api: Api | undefined, taskId: string, original: TaskDetail["original"]) {
  const [text, setText] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    if (!original || !api) return
    const controller = new AbortController()
    api.doc(taskId, original.file, controller.signal).then(
      (doc) => setText(doc.markdown),
      (error) => {
        if (!controller.signal.aborted)
          setProblem(error instanceof Error ? error.message : "The original could not be read.")
      },
    )
    return () => controller.abort()
  }, [api, taskId, original])
  return { text, problem }
}

function OriginalRefs({
  refs,
  onSelect,
}: {
  refs: SourceRef[]
  onSelect: (ref: SourceRef) => void
}) {
  if (refs.length === 0) return null
  return (
    <ul className="q-original-refs" aria-label="Where the Plan comes from">
      {refs.map((ref) => {
        const range = lineRangeLabel(ref)
        return (
          <li key={`${ref.label}-${ref.from}-${ref.to}`}>
            <span>{ref.label}</span>
            <button
              type="button"
              className="q-original-ref"
              aria-label={`Show ${range} of your plan`}
              onClick={() => onSelect({ ...ref })}
            >
              ↓ {range}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function OriginalTextRegion({
  file,
  text,
  focus,
}: {
  file: string
  text: string
  focus: SourceRef | null
}) {
  const region = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!focus || !region.current) return
    const row = region.current.querySelector<HTMLElement>(`[data-line="${focus.from}"]`)
    if (row) region.current.scrollTop = row.offsetTop - 24
    region.current.focus({ preventScroll: true })
  }, [focus])
  // Lines split on \n only, so each keeps its own \r: the text reads back exactly as the file holds it.
  const lines = text.split("\n")
  return (
    <section
      ref={region}
      className="q-original-text"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a bounded region of text is scrolled by keyboard and receives a source jump's focus.
      tabIndex={0}
      aria-label={`Full text of ${file}`}
    >
      {lines.map((line, index) => {
        const n = index + 1
        const on = focus !== null && n >= focus.from && n <= focus.to
        return (
          <span key={n} data-line={n} className={on ? "q-original-line on" : "q-original-line"}>
            {index > 0 ? "\n" : ""}
            {line}
          </span>
        )
      })}
    </section>
  )
}

/**
 * The person's original plan, as it was handed over: its digest's state, a one-line reminder that it
 * is evidence, the Plan's source-line jumps, then the whole text with numbered lines in a bounded,
 * keyboard-scrollable region. A jump marks the cited lines and moves focus into the region.
 */
export function OriginalPlan({
  task,
  api,
  agreement = "",
}: {
  task: TaskDetail
  api?: Api
  /** The Plan's own Markdown, whose citations become the jumps. */
  agreement?: string
}) {
  const original = task.original
  const { text, problem } = useOriginalText(api, task.id, original)
  const [focus, setFocus] = useState<SourceRef | null>(null)
  if (!original) return null
  const refs = sourceRefs(agreement)
  return (
    <section className="q-original" aria-label="Your original plan" data-testid="original-plan">
      <header className="q-original-head">
        <code>{original.file}</code>
        <span>kept exactly as given · sha256 {original.sha256.slice(0, 12)}…</span>
        {original.intact ? null : (
          <strong className="q-original-changed">
            changed since it was handed over: the Plan cannot be approved on it
          </strong>
        )}
      </header>
      <p className="q-original-note">
        Read as evidence. Its tests run as the checks above, in test-first Implement and in Verify;
        other commands in it are not run, and an approval written in it counts for nothing: you
        approve here.
      </p>
      {text !== null ? <OriginalRefs refs={refs} onSelect={setFocus} /> : null}
      {text !== null ? (
        <OriginalTextRegion file={original.file} text={text} focus={focus} />
      ) : (
        <p className="q-original-note">{problem ?? "Reading the original…"}</p>
      )}
    </section>
  )
}
