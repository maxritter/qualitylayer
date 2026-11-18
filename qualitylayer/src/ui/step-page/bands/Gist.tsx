// Band two: the gist. The step's title as a takeaway for this task, one meta line, the Summary in at
// most two sentences, and one row of at most two counts and the task in work.
//
// The meta line has one grammar on every step: `<the document's state> · <when> · <what it needs
// from you>`, for example "written by the build session from the approved Plan · 09:41 · nothing to
// approve". It describes the document. The agent's own state lives in the header's chip and is
// never repeated here. `metaLine` joins the parts and leaves out the ones a step has none of.

import { ClockIcon, LockIcon } from "lucide-react"
import { isValidElement, type ReactNode } from "react"
import { FLOW_STEPS } from "../../../core/flow.ts"
import { StepGlyph } from "../../shell/StepTrack.tsx"
import { type Fact, FactRow, hasFacts, type NowChip } from "./FactRow.tsx"

export type GistProps = {
  /** A takeaway for this task, not the step's name. Leave out when the task's own header says it. */
  title?: ReactNode
  /** A secondary action beside the title; omitted without changing other step headers. */
  actions?: ReactNode
  /** `metaLine(state, when, needs)`. */
  meta?: string | undefined
  /** How long the page takes to read ("4 min"): a clock chip after the meta line, the sentence in its tooltip. */
  read?: string | undefined
  /** The As of line of a closed task or a share link. */
  asOf?: ReactNode
  /** At most two sentences; a part QualityLayer draws (the Plan's summary) may stand here. */
  summary?: ReactNode
  bullets?: readonly ReactNode[] | undefined
  /** One line under the Summary's words where the page draws the Summary as a section (the Plan's Success measure). */
  summaryAfter?: ReactNode
  /** At most two; see `FactRow`. */
  facts?: readonly Fact[] | undefined
  factsView?: ReactNode
  /** The task the agent is working on; left out when nothing runs. */
  now?: NowChip | undefined
  /**
   * A step that orders its own top (the Plan: the Oracle, the facts, the reach and checks, then the
   * summary) passes it here, and the summary, bullets and facts above are not drawn.
   */
  body?: ReactNode
  /** The Plan's Step checks line follows the body: the lines the task keeps. Left out without any. */
  required?: ReactNode
}

export const metaLine = (
  state: string | undefined,
  when: string | undefined,
  needs: string | undefined,
): string =>
  [state, when, needs]
    .filter((part): part is string => part !== undefined && part.trim() !== "")
    .join(" · ")

/** Whether the gist has anything to draw; a band with nothing in it is left out. */
export const hasGist = (gist: GistProps | undefined): gist is GistProps =>
  (gist !== undefined &&
    [gist.title, gist.actions, gist.meta, gist.asOf, gist.summary, gist.body].some(
      (part) => part !== undefined && part !== null && part !== "" && part !== false,
    )) ||
  (gist !== undefined && hasFacts(gist.facts, gist.now)) ||
  (gist?.bullets?.length ?? 0) > 0

function GistHeading({ title, actions }: Pick<GistProps, "title" | "actions">) {
  // A step page's title leads with the step's own mark, as the step track draws it.
  // The title is the step's name as text or as its inline Markdown (`<InlineMarkdown text="Plan" />`).
  const words =
    typeof title === "string"
      ? title
      : isValidElement<{ text?: unknown }>(title) && typeof title.props.text === "string"
        ? title.props.text
        : undefined
  const step = FLOW_STEPS.find((entry) => entry.label === words)?.id
  const heading =
    title !== undefined && title !== null && title !== "" ? (
      <h1>
        {step !== undefined ? <StepGlyph step={step} className="bd-title-icon" /> : null}
        {title}
      </h1>
    ) : null
  return actions ? (
    <div className="bd-gist-title-row">
      {heading}
      <div className="bd-gist-actions">{actions}</div>
    </div>
  ) : (
    heading
  )
}

export function Gist({
  title,
  actions,
  meta,
  read,
  asOf,
  summary,
  bullets,
  facts,
  factsView,
  now,
  body,
  required,
}: GistProps) {
  return (
    <header className="bd-gist" data-testid="step-gist">
      <GistHeading title={title} actions={actions} />
      {meta !== undefined && meta !== "" ? (
        <div className="bd-metarow">
          <p className="bd-meta" data-testid="step-meta">
            {meta}
          </p>
          {read !== undefined ? (
            <span className="bd-read" data-testid="step-read" title={`About ${read} to read`}>
              <ClockIcon aria-hidden="true" />
              {read}
            </span>
          ) : null}
        </div>
      ) : null}
      {asOf !== undefined && asOf !== null ? <div className="bd-asof">{asOf}</div> : null}
      {/* The facts stand above the summary, as every step page of the Workflow model draws them. */}
      {body === undefined ? (factsView ?? <FactRow facts={facts} now={now} />) : null}
      {body !== undefined && body !== null ? body : null}
      {body === undefined &&
      ((summary !== undefined && summary !== null && summary !== "") ||
        (bullets !== undefined && bullets.length > 0)) ? (
        <div className="bd-sum" data-testid="step-summary">
          <div className="bd-sumb">
            {summary}
            {bullets !== undefined && bullets.length > 0 ? (
              <ul className="bd-bul">
                {bullets.map((bullet, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the bullets are a fixed list in document order
                  <li key={index}>{bullet}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
      {required !== undefined && required !== null ? (
        <p className="bd-oracle" data-testid="plan-required">
          <b>Step checks</b> {required}
        </p>
      ) : null}
    </header>
  )
}

/** The As of line of a read-only page. */
export function AsOf({ children }: { children: ReactNode }) {
  return (
    <span className="bd-snap" data-testid="as-of">
      <LockIcon className="size-3" aria-hidden="true" />
      {children}
    </span>
  )
}
