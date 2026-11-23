// What a person reads below the board: the decisions the agents made while building (one flat row each,
// its kind and whether it changes what was approved on the right) and the limits the build could not
// remove, both flat sections under their rule. A change to what was approved is asked as a question when
// it comes up; its answer reads here as "you agreed". Nothing here waits for the person.

import { CheckIcon, MessageCircleQuestionMarkIcon } from "lucide-react"
import { InlineMarkdown } from "../../reader/DocReader.tsx"
import { LeadBullets } from "../../step-page/kit/LeadBullets.tsx"
import { NumberedRows } from "../../step-page/kit/NumberedRows.tsx"
import type { StepLive } from "../../step-page/live.ts"
import { type DecisionRow, decisionRowOf, type LimitRow, limitsOf } from "./changes-model.ts"

export { type DecisionRow, decisionRowOf, type LimitRow, limitsOf }

/**
 * Decided while building as numbered rows that open: the headline, a quiet tag at the right (the kind,
 * and whether what you approved changes), and the rest of the note, what it replaced and Ask why inside.
 */
export function DecisionRows({
  rows,
  live,
}: {
  rows: readonly DecisionRow[]
  live: StepLive | undefined
}) {
  return (
    <NumberedRows
      testId="decisions"
      shown={Number.POSITIVE_INFINITY}
      rows={rows.map((row, index) => {
        const expands = row.detail !== "" || row.replaced.length > 0
        return {
          key: row.id,
          n: index + 1,
          title: <InlineMarkdown text={row.headline} />,
          tag: (
            <span className="dsc-tag ib-tags">
              <span className="ib-kind">{row.kind}</span>
              <span className={`ib-ok ${row.approved.tone}`}>
                {row.approved.tone !== "changes" ? (
                  <CheckIcon className="size-3.5" aria-hidden="true" />
                ) : null}
                {row.approved.words}
              </span>
            </span>
          ),
          ...(expands
            ? {
                body: (
                  <div className="ib-more" data-testid="decision-detail">
                    <div>
                      {row.detail !== "" ? (
                        <p>
                          <InlineMarkdown text={row.detail} />
                        </p>
                      ) : null}
                      {row.replaced.map((earlier) => (
                        <p key={earlier} className="ib-replaced">
                          Replaced · <InlineMarkdown text={earlier} />
                        </p>
                      ))}
                    </div>
                    {live?.askAbout !== undefined ? (
                      <button
                        type="button"
                        className="sp-ask"
                        aria-label="Ask why"
                        title="Ask why"
                        onClick={(event) => live.askAbout?.(row.headline, event.currentTarget)}
                      >
                        <MessageCircleQuestionMarkIcon aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                ),
              }
            : {}),
        }
      })}
    />
  )
}

/** Known limits in the Summary's bullet form: the card as the bold lead, `**T12.** the limit`. */
export function LimitRows({ rows }: { rows: readonly LimitRow[] }) {
  return (
    <LeadBullets
      testId="limits"
      items={rows.map((row) => ({
        key: row.id,
        ...(row.card !== null ? { lead: row.card } : {}),
        text: row.text,
      }))}
    />
  )
}
