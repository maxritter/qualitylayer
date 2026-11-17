// The recorded checks of the Implement page: rows of the latest run of each command, grouped by the
// slice they ran for with the red ones first. The page's Checks fold carries the count and the red
// count in its summary line (`41 recorded · 2 red`); this draws what opens under it. `ChecksFold` is
// the same rows behind a fold of their own, for a document drawn whole. The document keeps every
// recorded line; this is only how the page reads them.

import { CopyIcon } from "lucide-react"
import type { RequiredSource } from "../../core/required-parse.ts"
import { Fold } from "../kit/Fold.tsx"
import { WhoMark } from "../kit/WhoMark.tsx"
import { InlineMarkdown } from "../reader/DocReader.tsx"
import { SourceLabel } from "../steps/required/parts.tsx"
import { Limited } from "./bands/Fold.tsx"
import {
  type CheckRow,
  type ChecksModel,
  checksBySlice,
  checksSummary,
  formatSecs,
  redFirst,
} from "./checks.ts"
import type { StepLive } from "./live.ts"

const MARKS = {
  passed: { who: "done", label: "Passed" },
  failed: { who: "stop", label: "Failed" },
  "not-run": { who: "todo", label: "Not run" },
} as const

/** The row's words that say more than a pass: why it failed, that it was reused, or ran again. */
function notes(row: CheckRow): string[] {
  const out: string[] = []
  if (row.state === "failed" || row.state === "not-run") out.push(row.status)
  else if (row.reused) out.push("reused")
  if (row.runs > 1) out.push(`ran ${row.runs}×`)
  return out
}

function Row({
  row,
  live,
  source,
}: {
  row: CheckRow
  live: StepLive | undefined
  source?: RequiredSource | undefined
}) {
  const mark = MARKS[row.state]
  const more = notes(row)
  const tree = row.rev.split(" (")[0] ?? row.rev
  const displayRevision = /^[0-9a-f]{13,}$/i.test(row.rev) ? row.rev.slice(0, 8) : tree
  const revisionLabel = tree === row.rev ? `Revision ${row.rev}` : row.rev
  const title = [
    row.command,
    row.runs > 1
      ? `Ran ${row.runs} times; this is the latest${row.failedBefore ? ", after an earlier run failed" : ""}`
      : null,
    revisionLabel,
  ]
    .filter((line) => line !== null)
    .join("\n")
  return (
    <li className="ck-row" data-state={row.state} data-testid="check-row">
      <WhoMark who={mark.who} label={mark.label} />
      <code className="ck-cmd" title={title}>
        {row.command}
      </code>
      <span className="ck-meta">
        {source !== undefined ? <SourceLabel source={source} /> : null}
        {more.map((word, index) => (
          <span
            key={word}
            className={index === 0 && row.state !== "passed" ? "ck-bad" : "ck-word"}
            title={index === 0 && row.state !== "passed" ? word : undefined}
          >
            {word}
          </span>
        ))}
        {row.secs !== null ? <span className="ck-secs">{formatSecs(row.secs)}</span> : null}
        <span className="ck-rev" title={revisionLabel}>
          {displayRevision === row.rev ? (
            row.rev
          ) : (
            <>
              <span aria-hidden="true">{displayRevision}</span>
              <span className="sr-only">{revisionLabel}</span>
            </>
          )}
        </span>
      </span>
      {live !== undefined ? (
        <button
          type="button"
          className="ck-copy"
          aria-label={`Copy command: ${row.command}`}
          title="Copy the command"
          onClick={() => live.copy(row.command, "Copied the command")}
        >
          <CopyIcon className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </li>
  )
}

const rowKey = (row: CheckRow, index: number) => `${index}\n${row.command}`

/** The rows of one group, as the fold draws them under its own group heading. */
export function CheckRowList({
  rows,
  live,
}: {
  rows: readonly CheckRow[]
  live: StepLive | undefined
}) {
  return (
    <ul className="ck-rows" data-testid="check-group">
      <Limited
        as="li"
        rows={rows.map((row, index) => <Row key={rowKey(row, index)} row={row} live={live} />)}
      />
    </ul>
  )
}

/**
 * The rows under the fold. With `sliceOf` they are grouped by slice, a slice with a red check
 * first and the red rows first within it; without it, by the task or slice label the CLI wrote.
 */
export function ChecksRows({
  checks,
  live,
  sliceOf,
  sources,
}: {
  checks: ChecksModel
  live: StepLive | undefined
  sliceOf?: ((label: string) => number | null) | undefined
  /** The commands a required `run:` line names, with whose line it is (Verify's Project checks lane). */
  sources?: ReadonlyMap<string, RequiredSource> | undefined
}) {
  const groups =
    sliceOf !== undefined
      ? checksBySlice(checks, sliceOf).map((group) => ({
          key: group.slice === null ? "whole" : `slice-${group.slice}`,
          label: group.slice === null ? "Whole change" : `Slice ${group.slice}`,
          rows: group.rows,
        }))
      : checks.groups.map((group) => ({
          key: group.label,
          label: group.label,
          rows: redFirst(group.rows),
        }))
  return (
    <>
      <ul className="ck-groups">
        {groups.map((group) => (
          <li key={group.key} className="ck-group" data-testid="check-group">
            <span className="ck-label">{group.label}</span>
            <ul className="ck-rows">
              <Limited
                as="li"
                rows={group.rows.map((row, index) => (
                  <Row
                    key={rowKey(row, index)}
                    row={row}
                    live={live}
                    source={sources?.get(row.command)}
                  />
                ))}
              />
            </ul>
          </li>
        ))}
      </ul>
      {checks.other.length > 0 ? (
        <ul className="ck-other">
          {checks.other.map((line) => (
            <li key={line}>
              <InlineMarkdown text={line} />
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}

/** The checks behind a fold of their own, for a document drawn whole. */
export function ChecksFold({ checks, live }: { checks: ChecksModel; live: StepLive | undefined }) {
  const summary = checksSummary(checks)
  return (
    <div className="ck" data-testid="checks-fold">
      <Fold
        name="Checks"
        count={summary.count}
        line={summary.line}
        {...(summary.tone === "danger" ? { tone: "danger" as const } : {})}
      >
        <ChecksRows checks={checks} live={live} />
      </Fold>
    </div>
  )
}
