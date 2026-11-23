// The Plan's Approach uses optional labelled lines and native disclosures for explicit lead bullets.
// Plain bullets and other prose retain their full text.

import { SplitIcon } from "lucide-react"
import { Fragment } from "react"
import { Disclosure } from "../../kit/Fold.tsx"
import { InlineMarkdown } from "../../reader/DocReader.tsx"
import { CommentBlock, DocMarkdown } from "../../step-page/DocMarkdown.tsx"
import type { StepLive } from "../../step-page/live.ts"
import type { StepState } from "../../step-page/state.ts"
import {
  type ApproachBlock,
  type ApproachBullet,
  type ApproachLabel,
  approachOf,
  keyRowsOf,
} from "./approach-parse.ts"
import { useShown } from "./BoundaryParts.tsx"
import { PlanPart } from "./Pictures.tsx"
import { DetailsToggle } from "./Technical.tsx"

export { approachOf, keyRowsOf }

/** Label and sentence rows in one bordered table, the labels quiet (Workflow model: bug Plan, What breaks). */
export function KeyRows({ rows }: { rows: readonly { label: string; text: string }[] }) {
  return (
    <dl className="pl-keyrows" data-testid="plan-key-rows">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>
            <InlineMarkdown text={row.label} />
          </dt>
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

function ApproachLabels({
  rows,
  followedByBullets,
  live,
}: {
  rows: readonly ApproachLabel[]
  followedByBullets: boolean
  live: StepLive | undefined
}) {
  return (
    <dl
      className={followedByBullets ? "pl-appr" : "pl-appr alone"}
      data-testid="plan-approach-labels"
    >
      {rows.map(({ key, label, text, raw }) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>
            <CommentBlock raw={raw} live={live}>
              <InlineMarkdown text={text} />
            </CommentBlock>
          </dd>
        </div>
      ))}
    </dl>
  )
}

function ApproachBullets({
  rows,
  live,
}: {
  rows: readonly ApproachBullet[]
  live: StepLive | undefined
}) {
  return (
    <div className="bd-sumb" data-testid="plan-approach-bullets">
      <ul className="bd-bul">
        {rows.map(({ key, text, raw, lead }) => (
          <li key={key} className={lead === null ? undefined : "pl-approach-lead"}>
            <CommentBlock raw={raw} live={live}>
              {lead === null ? (
                <InlineMarkdown text={text} />
              ) : (
                <Disclosure
                  className="pl-approach-fold"
                  head={
                    <b>
                      <InlineMarkdown text={lead.lead} />
                    </b>
                  }
                >
                  <p>
                    <InlineMarkdown text={lead.detail} />
                  </p>
                </Disclosure>
              )}
            </CommentBlock>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ApproachPart({
  blocks,
  state,
  live,
}: {
  blocks: readonly ApproachBlock[]
  state: StepState
  live: StepLive | undefined
}) {
  const bullets = blocks.flatMap((block) => (block.kind === "bullets" ? block.rows : []))
  const { rows, more } = useShown(bullets, SHOWN)
  const shown = new Set(rows)
  const last = rows.at(-1)
  return (
    <PlanPart
      title="Approach"
      icon={SplitIcon}
      action={
        <>
          {bullets.length > 0 ? <span className="q-disc-n">{bullets.length}</span> : null}
          {rows.some((row) => row.lead !== null) ? <DetailsToggle /> : null}
        </>
      }
    >
      {blocks.map((block, index) => {
        if (block.kind === "markdown")
          return (
            <DocMarkdown
              key={block.key}
              markdown={block.raw}
              state={state}
              first={false}
              live={live}
              bare
            />
          )
        if (block.kind === "labels")
          return (
            <ApproachLabels
              key={block.key}
              rows={block.rows}
              followedByBullets={blocks[index + 1]?.kind === "bullets"}
              live={live}
            />
          )
        const visible = block.rows.filter((row) => shown.has(row))
        if (visible.length === 0) return null
        return (
          <Fragment key={block.key}>
            <ApproachBullets rows={visible} live={live} />
            {visible.at(-1) === last ? more : null}
          </Fragment>
        )
      })}
    </PlanPart>
  )
}
