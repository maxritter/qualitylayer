// The rows inside the Plan's Technical folds that are not prose: Data and interfaces as one row per
// item, the decisions made for you and the assumptions as `a · b` rows, and the Prerequisites table.
// Each draws from the text the document holds; none invents a word.

import { ChevronsUpDownIcon } from "lucide-react"
import { marked, type Tokens } from "marked"
import { type ReactNode, useState } from "react"
import { InlineMarkdown } from "../../reader/DocReader.tsx"
import { Chip } from "../../step-page/bands/Chip.tsx"
import { CommentBlock } from "../../step-page/DocMarkdown.tsx"
import { LeadBullets } from "../../step-page/kit/LeadBullets.tsx"
import { NumberedRows, ROWS_SHOWN } from "../../step-page/kit/NumberedRows.tsx"
import { SupportingRecords } from "../supporting-evidence.tsx"
import type { DataRow, ReasonRow } from "./plan-model.ts"

/** "Show all N" under a list that shows its first rows (eight unless told); one hidden row is shown instead. */
export function useShown<T>(
  rows: readonly T[],
  first: number = ROWS_SHOWN,
): { rows: readonly T[]; more: ReactNode } {
  const [all, setAll] = useState(false)
  const hidden = rows.length - first
  if (all || hidden <= 1) return { rows, more: null }
  return {
    rows: rows.slice(0, first),
    more: (
      <div className="dsc-more" style={{ paddingLeft: 0 }}>
        <button
          type="button"
          className="q-btn quiet xs"
          data-testid="show-all"
          onClick={() => setAll(true)}
        >
          <ChevronsUpDownIcon className="size-3" aria-hidden="true" />
          Show all {rows.length}
        </button>
      </div>
    ),
  }
}

/** Data and interfaces as one row per item: its name, where it lives on a line of its own, one plain sentence. */
export function DataRows({ rows }: { rows: readonly DataRow[] }) {
  const shown = useShown(rows)
  return (
    <div className="pl-data" data-testid="plan-data">
      <ul>
        {shown.rows.map((row) => (
          <li key={`${row.name}:${row.where}`}>
            <span className="nm">{row.name}</span>
            {row.where !== "" || row.fresh ? (
              <span className="wh">
                {[
                  row.where !== "" ? `in ${row.where.replace(/`/g, "")}` : "",
                  row.fresh ? "new" : "",
                ]
                  .filter((part) => part !== "")
                  .join(" · ")}
              </span>
            ) : null}
            {row.sentence !== "" ? (
              <p>
                <InlineMarkdown text={row.sentence} />
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {shown.more}
    </div>
  )
}

/**
 * A decision and its reason in the Summary's bullet form: "**Decision.** reason". A row without a reason
 * is one plain bullet, and `lead={false}` (Not doing) draws every row plain. An unconfirmed assumption
 * says so beside its words, and a row may cite records it rests on.
 */
export function ReasonRows({
  rows,
  taskId,
  active,
  lead = true,
}: {
  rows: readonly ReasonRow[]
  taskId: string
  active: boolean
  lead?: boolean
}) {
  const seen = new Map<string, number>()
  return (
    <LeadBullets
      testId="plan-reasons"
      items={rows.map((row) => {
        const at = seen.get(row.a) ?? 0
        seen.set(row.a, at + 1)
        const led = lead && row.b !== ""
        return {
          key: `${row.a}:${at}`,
          ...(led ? { lead: row.a } : {}),
          text: led ? row.b : row.b === "" ? row.a : `${row.a} — ${row.b}`,
          ...(row.note !== null ? { trailing: <Chip kind="unsure" label={row.note} /> } : {}),
          below: (
            <SupportingRecords markdown={`${row.a} ${row.b}`} taskId={taskId} active={active} />
          ),
        }
      })}
    />
  )
}

const isPrerequisiteHeaders = (names: readonly string[]): boolean => {
  if (names.length !== 4 || names[0] !== "#") return false
  const hasSubject = ["prerequisite", "what"].includes(names[1] ?? "")
  return hasSubject && names[2] === "met by" && names[3] === "status"
}

/** The Prerequisites table (`#`, Prerequisite, Met by, Status), or null for any other shape. */
export function prerequisiteTable(markdown: string): Tokens.Table | null {
  const table = marked
    .lexer(markdown.replace(/^## .*\n?/, "").replace(/<!--[\s\S]*?-->/g, ""))
    .find((token) => token.type === "table") as Tokens.Table | undefined
  if (table === undefined || table.rows.length === 0) return null
  const names = table.header.map((cell) => cell.text.trim().toLowerCase())
  return isPrerequisiteHeaders(names) ? table : null
}

/** The Prerequisites table as numbered rows: the code, what is needed and whether it is met; who or when opens. */
export function PrerequisiteRows({
  markdown,
  taskId,
  active,
  commentLive,
}: {
  markdown: string
  taskId: string
  active: boolean
  commentLive: Parameters<typeof CommentBlock>[0]["live"]
}) {
  const table = prerequisiteTable(markdown)
  if (table === null) return null
  const seen = new Map<string, number>()
  return (
    <NumberedRows
      testId="plan-prerequisites"
      shown={Number.POSITIVE_INFINITY}
      rows={table.rows.map((row) => {
        const [id, what, by, status] = row.map((cell) => cell.text)
        const label = (status ?? "").split(" · ")[0] ?? status ?? ""
        const met = /^(?:met|granted|approved|complete|ready)\b/i.test(label)
        const key = `${id}:${what}`
        const at = seen.get(key) ?? 0
        seen.set(key, at + 1)
        const raw = `| ${row.map((cell) => cell.text).join(" | ")} |`
        return {
          key: `${key}:${at}`,
          n: id,
          title: <InlineMarkdown text={what ?? ""} />,
          wrap: (line: ReactNode) => (
            <CommentBlock raw={raw} live={commentLive}>
              {line}
            </CommentBlock>
          ),
          tag: <Chip kind={met ? "note" : "unsure"} label={label} />,
          body: (
            <>
              <span className="dsc-how">
                <InlineMarkdown text={by ?? ""} />
              </span>
              <SupportingRecords
                markdown={row.map((cell) => cell.text).join(" ")}
                taskId={taskId}
                active={active}
              />
            </>
          ),
        }
      })}
    />
  )
}
