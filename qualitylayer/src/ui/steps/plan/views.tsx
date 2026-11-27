// The Plan page's parts, apart from the page that assembles them (Workflow model: Plan): the header's
// gist, the view of each section the page draws itself, and the group of folds, Technical and the file
// row it ends with. Page.tsx reads the task and hands each of these what it needs.

import {
  BadgeCheckIcon,
  BugIcon,
  ChevronDownIcon,
  FlagIcon,
  ImageIcon,
  type LucideIcon,
  NetworkIcon,
  ShieldCheckIcon,
  TargetIcon,
  TerminalIcon,
  WorkflowIcon,
} from "lucide-react"
import { type ReactNode, useId, useState } from "react"
import type { DocSection } from "../../api.ts"
import { InlineMarkdown } from "../../reader/DocReader.tsx"
import { type Fact, FactRow } from "../../step-page/bands/FactRow.tsx"
import { Fold } from "../../step-page/bands/Fold.tsx"
import { FoldedGroup } from "../../step-page/bands/FoldedGroup.tsx"
import type { GistProps } from "../../step-page/bands/Gist.tsx"
import { DocMarkdown } from "../../step-page/DocMarkdown.tsx"
import { FileRow } from "../../step-page/kit/FileRow.tsx"
import { readWholeFile } from "../../step-page/kit/read-file.ts"
import type { StepLive } from "../../step-page/live.ts"
import type { SectionCtx, SectionRenderer } from "../../step-page/StepPage.tsx"
import { bodyOf } from "../../step-page/sections.ts"
import type { ItemCard, Mode, StepState } from "../../step-page/state.ts"
import { PlanRequired } from "../required/parts.tsx"
import { ApproachPart, approachOf, KeyRows, keyRowsOf } from "./Approach.tsx"
import { AcceptanceList, DiagramTabs, InterfaceTabs, PlanPart, RunMark } from "./Pictures.tsx"
import {
  acceptanceOf,
  diagramsOf,
  type interfaceOf,
  type PlanIndicator,
  planIndicators,
  reproductionOf,
  sizeFact,
  sizeOf,
  summaryBullets,
} from "./plan-model.ts"
import { ScopeColumns } from "./Scope.tsx"
import { scopeOf } from "./scope-model.ts"
import {
  BELOW,
  DecidedWithYou,
  DetailsToggle,
  MadeForYou,
  Prerequisites,
  Reviews,
  TechnicalFold,
  TechnicalPart,
} from "./Technical.tsx"

type Where = { state: StepState; mode: Mode; live: StepLive | undefined }
type Required = Parameters<typeof PlanRequired>[0]["view"]

/** The Success measure: the number that says it worked, one line under the Summary's bullets. */
function MeasureLine({ text }: { text: string }) {
  return (
    <p className="pl-measure" data-testid="success-measure" title="Success measure">
      <TargetIcon className="size-3.5" aria-hidden="true" />
      <span className="sr-only">Success measure: </span>
      <span>
        <InlineMarkdown text={text} />
      </span>
    </p>
  )
}

function PlanIndicators({ size, indicators }: { size: Fact | null; indicators: PlanIndicator[] }) {
  const [selected, setSelected] = useState<PlanIndicator["kind"] | null>(null)
  const detailId = useId()
  const active = indicators.find((item) => item.kind === selected)
  return (
    <div className="pl-indicators">
      <FactRow facts={size ? [size] : []} />
      {indicators.map((item) => {
        const Icon = item.kind === "Risk" ? ShieldCheckIcon : NetworkIcon
        return (
          <button
            type="button"
            key={item.kind}
            className="pl-indicator"
            aria-expanded={item.kind === selected}
            aria-controls={detailId}
            id={detailId + item.kind}
            onClick={() => setSelected(item.kind === selected ? null : item.kind)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setSelected(null)
            }}
          >
            <Icon size={14} aria-hidden="true" />
            {item.kind}
            <strong>{item.value}</strong>
            <ChevronDownIcon size={12} aria-hidden="true" />
          </button>
        )
      })}
      <section
        id={detailId}
        hidden={!active}
        className="pl-indicator-detail"
        aria-labelledby={active ? detailId + active.kind : undefined}
      >
        {active && (
          <>
            <InlineMarkdown text={active.evidence} />{" "}
            <button
              type="button"
              className="q-link"
              onClick={(event) => {
                const section = event.currentTarget
                  .closest(".sp-page")
                  ?.querySelector<HTMLElement>(
                    `[data-testid="step-part"][aria-label="${active.section}"] h2`,
                  )
                section?.focus({ preventScroll: true })
                section?.scrollIntoView({ block: "center" })
              }}
            >
              {active.kind === "Risk" ? "See acceptance test" : "See approach"} ↓
            </button>
          </>
        )}
      </section>
    </div>
  )
}

/** The header: the meta line, the size chip, the Summary's bullets, Required and the Success measure. */
export function planGist(
  meta: string,
  sectionOf: (title: string) => DocSection | undefined,
  required: Required | undefined,
): GistProps {
  const summary = sectionOf("Summary")
  const measure = bodyOf(sectionOf("Success measure")?.markdown ?? "")
    .replace(/\s+/g, " ")
    .trim()
  const fact = sizeFact(sizeOf(summary?.markdown ?? ""))
  const signals = planIndicators(
    summary?.markdown ?? "",
    bodyOf(sectionOf("Done means")?.markdown ?? ""),
    bodyOf(sectionOf("Approach")?.markdown ?? ""),
  )
  const bullets = summary !== undefined ? summaryBullets(summary.markdown) : []
  return {
    meta,
    // The size chip stands in the header; the Summary is the page's first section (summaryIcon).
    facts: fact !== null ? [fact] : [],
    ...(signals.length ? { factsView: <PlanIndicators size={fact} indicators={signals} /> } : {}),
    bullets: bullets.map((bullet) => <InlineMarkdown key={bullet} text={bullet} />),
    ...(required !== undefined && required.lines.length > 0
      ? { required: <PlanRequired view={required} /> }
      : {}),
    // The Success measure is one line under the Summary (Workflow model: Plan, Optional parts).
    ...(measure !== "" ? { summaryAfter: <MeasureLine text={measure} /> } : {}),
  }
}

/** The Plan's own parts and their icons, as the Workflow model draws them. */
const PARTS: Record<string, LucideIcon> = {
  Diagrams: WorkflowIcon,
  // A bug's Plan (Workflow model: bugfix.html): what breaks, and why it does.
  "What breaks": BugIcon,
  Why: WorkflowIcon,
  Interface: ImageIcon,
  "Done means": BadgeCheckIcon,
}

export type ViewsInput = {
  taskId: string
  bug: boolean
  sectionOf: (title: string) => DocSection | undefined
  where: Where
  /** Comments on the page's words, while the task is live and open. */
  commenting: StepLive | undefined
  interfaceItems: ReturnType<typeof interfaceOf>
  /** The quiet row that says how the task runs, before Done means while the choice is real. */
  intakeRow: ReactNode
}

/** A known part whose text has another shape still stands as that part, with its icon: never as bare text. */
function asPart(ctx: SectionCtx, node: ReactNode, commenting: StepLive | undefined): ReactNode {
  if (node !== null) return node
  const own = PARTS[ctx.section.title]
  if (own === undefined) return ctx.draw()
  return (
    <PlanPart title={ctx.section.title} icon={own}>
      <div className="pl-plain">
        <DocMarkdown
          markdown={bodyOf(ctx.section.markdown)}
          state={ctx.state}
          first={false}
          live={commenting}
          bare
        />
      </div>
    </PlanPart>
  )
}

/** First release as a closed fold, beside Scope; nothing when the Plan has none. */
function FirstReleaseFold({ input }: { input: ViewsInput }) {
  const section = input.sectionOf("First release")
  if (section === undefined || bodyOf(section.markdown) === "") return null
  return (
    <div className="pl-beside" data-testid="first-release">
      <FoldedGroup>
        <TechnicalFold section={section} icon={FlagIcon} taskId={input.taskId} {...input.where} />
      </FoldedGroup>
    </div>
  )
}

function diagramsView(ctx: SectionCtx, input: ViewsInput): ReactNode {
  const items = diagramsOf(ctx.section.markdown)
  const node =
    items.length === 0 ? null : (
      <PlanPart title="Diagrams" icon={WorkflowIcon}>
        <DiagramTabs items={items} {...input.where} />
      </PlanPart>
    )
  return asPart(ctx, node, input.commenting)
}

function interfaceView(ctx: SectionCtx, input: ViewsInput): ReactNode {
  const node =
    input.interfaceItems.length === 0 ? null : (
      <PlanPart title="Interface" icon={ImageIcon}>
        <InterfaceTabs items={input.interfaceItems} {...input.where} />
      </PlanPart>
    )
  return asPart(ctx, node, input.commenting)
}

function doneMeansView(ctx: SectionCtx, input: ViewsInput): ReactNode {
  const view = acceptanceOf(ctx.section.markdown, input.interfaceItems)
  const node =
    view.points.length === 0 ? null : (
      <PlanPart
        title="Done means"
        icon={BadgeCheckIcon}
        action={
          <span className="pl-part-acts">
            <RunMark runs={view.runs} />
            <DetailsToggle />
          </span>
        }
      >
        <AcceptanceList view={view} bug={input.bug} />
      </PlanPart>
    )
  return (
    <>
      {input.intakeRow}
      {asPart(ctx, node, input.commenting)}
    </>
  )
}

function whatBreaksView(ctx: SectionCtx, input: ViewsInput): ReactNode {
  const rows = keyRowsOf(ctx.section.markdown)
  const node =
    rows === null ? null : (
      <PlanPart title="What breaks" icon={BugIcon}>
        <KeyRows rows={rows} />
      </PlanPart>
    )
  return asPart(ctx, node, input.commenting)
}

function whyView(ctx: SectionCtx, input: ViewsInput): ReactNode {
  const split = input.bug ? reproductionOf(bodyOf(ctx.section.markdown)) : null
  if (split === null) return asPart(ctx, null, input.commenting)

  return (
    <PlanPart title="Why" icon={WorkflowIcon}>
      <div className="pl-plain">
        <DocMarkdown
          markdown={split.diagnosis}
          state={ctx.state}
          first={false}
          live={input.commenting}
          bare
        />
        <FoldedGroup>
          <Fold
            id="bd-sec-reproduction"
            title="Reproduction"
            sectionTitle="Why"
            icon={TerminalIcon}
            testId="plan-reproduction"
          >
            <DocMarkdown
              markdown={split.reproduction}
              state={ctx.state}
              first={false}
              live={input.commenting}
              bare
            />
          </Fold>
        </FoldedGroup>
      </div>
    </PlanPart>
  )
}

function scopeView(ctx: SectionCtx, input: ViewsInput): ReactNode {
  const scope = scopeOf(ctx.section.markdown)
  const columns =
    scope.inScope.length + scope.outOfScope.length === 0 ? (
      ctx.draw()
    ) : (
      <ScopeColumns
        title="Scope"
        scope={scope}
        raw={ctx.section.markdown}
        live={input.commenting}
      />
    )
  return (
    <>
      {columns}
      <FirstReleaseFold input={input} />
    </>
  )
}

function approachView(ctx: SectionCtx, input: ViewsInput): ReactNode {
  return (
    <ApproachPart blocks={approachOf(ctx.doc.markdown)} state={ctx.state} live={input.commenting} />
  )
}

const VISUAL_FIRST_TITLES = ["Interface", "Diagrams"] as const

/** Keep Summary (and optional Success measure) at the top, then surface Interface and Diagrams first. */
export function prioritizePlanSections<T extends { title: string }>(sections: readonly T[]): T[] {
  const visuals = VISUAL_FIRST_TITLES.flatMap((title) =>
    sections.filter((section) => section.title === title),
  )
  if (visuals.length === 0) return [...sections]
  const visualSet = new Set<string>(VISUAL_FIRST_TITLES)
  const rest = sections.filter((section) => !visualSet.has(section.title))
  const out: T[] = []
  let inserted = false
  for (const section of rest) {
    out.push(section)
    if (!inserted && (section.title === "Summary" || section.title === "Success measure")) {
      const next = rest[rest.indexOf(section) + 1]
      if (next?.title !== "Success measure") {
        out.push(...visuals)
        inserted = true
      }
    }
  }
  return inserted ? out : [...visuals, ...out]
}

/** The view of each section the Plan page draws itself; the others are the document's own drawing. */
export function planViews(input: ViewsInput): Record<string, SectionRenderer> {
  return {
    // The Summary stands in the header.
    Summary: () => null,
    Diagrams: (ctx) => diagramsView(ctx, input),
    Interface: (ctx) => interfaceView(ctx, input),
    "Done means": (ctx) => doneMeansView(ctx, input),
    "What breaks": (ctx) => whatBreaksView(ctx, input),
    Why: (ctx) => whyView(ctx, input),
    Approach: (ctx) => approachView(ctx, input),
    Scope: (ctx) => scopeView(ctx, input),
    // One line under the Summary; a fold beside Scope (or on its own without one).
    "Success measure": () => null,
    "First release": () =>
      input.sectionOf("Scope") === undefined ? <FirstReleaseFold input={input} /> : null,
    // The folds below the core are drawn after it, in the model's order.
    ...Object.fromEntries(BELOW.map((title): [string, SectionRenderer] => [title, () => null])),
  }
}

/**
 * What the page ends with: one group of folds (Decided with you, Decisions made for you,
 * Prerequisites, Reviews), the Technical part and the file row that opens the whole file.
 */
export function PlanBelow({
  sections,
  sectionOf,
  taskId,
  file,
  reopen,
  reviewsOpen,
  where,
}: {
  sections: readonly DocSection[]
  sectionOf: (title: string) => DocSection | undefined
  taskId: string
  file: string
  reopen: ((card: ItemCard) => void) | undefined
  reviewsOpen: boolean
  where: Where
}) {
  const decided = sectionOf("Decided with you")
  const madeForYou = sectionOf("Decisions made for you")
  const prerequisites = sectionOf("Prerequisites")
  const reviews = sectionOf("Reviews")
  return (
    <div className="pl-below" data-testid="plan-below">
      <FoldedGroup>
        {decided !== undefined ? (
          <DecidedWithYou section={decided} state={where.state} reopen={reopen} />
        ) : null}
        {madeForYou !== undefined ? (
          <MadeForYou section={madeForYou} taskId={taskId} active={where.mode === "live"} />
        ) : null}
        {prerequisites !== undefined ? (
          <Prerequisites section={prerequisites} taskId={taskId} {...where} />
        ) : null}
        {reviews !== undefined ? <Reviews section={reviews} open={reviewsOpen} /> : null}
      </FoldedGroup>
      <TechnicalPart sections={sections} taskId={taskId} {...where} />
      <FileRow
        file={file}
        text="the whole file, as Copy gives it"
        label="Read the Plan"
        onRead={() => {
          readWholeFile(taskId, file)
        }}
      />
    </div>
  )
}
