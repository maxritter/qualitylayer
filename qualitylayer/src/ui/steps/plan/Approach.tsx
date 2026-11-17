// The Plan's Approach uses optional labelled lines and native disclosures for explicit lead bullets.
// Plain bullets and other prose retain their full text.

import { SplitIcon } from "lucide-react"
import { isLineText, skipWhitespace } from "../../../core/text-boundaries.ts"
import { Disclosure } from "../../kit/Fold.tsx"
import { InlineMarkdown } from "../../reader/DocReader.tsx"
import { bodyOf } from "../../step-page/sections.ts"
import { useShown } from "./BoundaryParts.tsx"
import { PlanPart } from "./Pictures.tsx"
import { DetailsToggle } from "./Technical.tsx"

export type ApproachView = {
  labels: { label: string; text: string }[]
  bullets: string[]
}

const LABEL = /^\*\*(Chosen|Gives|Costs):\*\*/

function approachTail(line: string, at: number, requiredSpace: boolean): string | null {
  const start = skipWhitespace(line, at)
  if (requiredSpace && start === at) return null
  const text = line.slice(start)
  return text !== "" && isLineText(text) ? text : null
}

/** The Approach's labelled lines and bullets, or null when a line has another shape. */
export function approachOf(markdown: string): ApproachView | null {
  const view: ApproachView = { labels: [], bullets: [] }
  for (const raw of bodyOf(markdown).split(/\r?\n/)) {
    const line = raw.trim()
    if (line === "") continue
    const label = LABEL.exec(line)
    const labelled = label === null ? null : approachTail(line, label[0].length, false)
    const bullet = /^[-*]/.test(line) ? approachTail(line, 1, true) : null
    if (label !== null && labelled !== null && view.bullets.length === 0)
      view.labels.push({ label: label[1] as string, text: labelled })
    else if (bullet !== null) view.bullets.push(bullet)
    else return null
  }
  return view.labels.length === 0 && view.bullets.length === 0 ? null : view
}

/**
 * A bug's What breaks: its two-column table as label and sentence rows (When, Today, Expected …), the
 * empty header row left out. Null when the section is not such a table.
 */
export function keyRowsOf(markdown: string): { label: string; text: string }[] | null {
  const rows: { label: string; text: string }[] = []
  for (const raw of bodyOf(markdown).split(/\r?\n/)) {
    const line = raw.trim()
    if (line === "") continue
    if (!line.startsWith("|")) return null
    const cells = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim())
    if (cells.every((cell) => /^:?-*:?$/.test(cell))) continue
    if (cells.length !== 2) return null
    rows.push({ label: cells[0] as string, text: cells[1] as string })
  }
  return rows.length === 0 ? null : rows
}

/** Label and sentence rows in one bordered table, the labels quiet (Workflow model: bug Plan, What breaks). */
export function KeyRows({ rows }: { rows: readonly { label: string; text: string }[] }) {
  return (
    <dl className="pl-keyrows" data-testid="plan-key-rows">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>
            <InlineMarkdown text={row.text} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** The bullets the Approach shows before "Show all N". */
const SHOWN = 5

function labelledBullet(text: string): { lead: string; detail: string } | null {
  if (!text.startsWith("**") || !isLineText(text)) return null
  const closing = /\*\*(?=[ \t])/g
  closing.lastIndex = 3
  const end = closing.exec(text)?.index
  if (end === undefined) return null
  let start = end + 3
  while (start < text.length - 1 && (text[start] === " " || text[start] === "\t")) start++
  if (start === text.length) return null
  return { lead: text.slice(2, end), detail: text.slice(start) }
}

export function ApproachPart({ view }: { view: ApproachView }) {
  const shown = useShown(view.bullets, SHOWN)
  const count = view.bullets.length
  const occurrences = new Map<string, number>()
  const rows = shown.rows.map((text) => {
    const occurrence = (occurrences.get(text) ?? 0) + 1
    occurrences.set(text, occurrence)
    return { key: `${text}\0${occurrence}`, text, named: labelledBullet(text) }
  })
  return (
    <PlanPart
      title="Approach"
      icon={SplitIcon}
      action={
        <>
          {count > 0 ? <span className="q-disc-n">{count}</span> : null}
          {rows.some((row) => row.named !== null) ? <DetailsToggle /> : null}
        </>
      }
    >
      {view.labels.length === 0 ? null : (
        <dl className={count > 0 ? "pl-appr" : "pl-appr alone"} data-testid="plan-approach-labels">
          {view.labels.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>
                <InlineMarkdown text={row.text} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {count > 0 ? (
        <>
          <div className="bd-sumb" data-testid="plan-approach-bullets">
            <ul className="bd-bul">
              {rows.map(({ key, text, named }) => (
                <li key={key} className={named === null ? undefined : "pl-approach-lead"}>
                  {named === null ? (
                    <InlineMarkdown text={text} />
                  ) : (
                    <Disclosure
                      className="pl-approach-fold"
                      head={
                        <b>
                          <InlineMarkdown text={named.lead} />
                        </b>
                      }
                    >
                      <p>
                        <InlineMarkdown text={named.detail} />
                      </p>
                    </Disclosure>
                  )}
                </li>
              ))}
            </ul>
          </div>
          {shown.more}
        </>
      ) : null}
    </PlanPart>
  )
}
