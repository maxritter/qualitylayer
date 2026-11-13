// One step's page: its document drawn as a briefing in five bands, in this order, a band with nothing
// in it left out (the rules are docs/artifacts/step-pages.md; the picture is the App Model's step
// pages). StepPage(document, state, mode): live in the App, snapshot on the share link (no owner
// controls, no artifacts: a still picture instead), plain as GitHub reads the file.
//
//   1 Your move   the person's cards only            props: yourMove
//   2 The gist    title, meta, summary, facts        props: gist  (merged over what the Summary gives)
//   3 The core    the lead sections, file order      props: sections, parts
//   4 Folded      each lead-folded section a Fold    props: sections, foldGroups
//   5 More        links into the Reader              props: more
//
// Pass `cut` (the document cut into sections, `StepPageProps.sections`) and the bands are drawn from
// it: a `lead` section is the core, a `lead-folded` one a fold, a `detail` one the Reader's. Without
// `cut` (the sections are still loading, or the page is a bare document) the document is drawn
// whole, in order, as one core. A section the schema marks `product_words: "headings"` draws each
// `###` takeaway as a row that opens to its text.
//
// What a step customises comes in through props, so a step folder edits nothing in step-page/:
//
//   <StepPage document state mode live cut={sections}
//     yourMove={<BatchCard … />}              // only the person's cards; drawn here once
//     gist={{ title: "Plan: count each request once", meta: metaLine("ready to approve", "09:41",
//            "feedback answered within a minute"), facts: [{ value: 11, label: "slices" }] }}
//     parts={{ decide: null, slices: MySlices }}   // marker name → part; null draws nothing
//     sections={{ "Done means": ({ draw }) => <MyRows />, Problem: () => null }}
//     foldGroups={{ "Decided while building": ({ doc }) => bySlice(doc) }}
//     more={<MoreInDocument … />} />
//
// `partFor` stays the default table of parts by step and marker name. A section renderer receives the
// section, its document (markers found again), `draw()` (the generic drawing of the section) and the
// page's state; it returns the section's core rows or fold body, `null` to draw nothing, or a
// `SectionDraw` to also set a fold's count, takeaway, line count and groups, or `{ quiet: "words" }`
// when the section is one quiet line ("no second opinion: light task") that is neither a fold nor a heading.

import {
  BanIcon,
  BookOpenIcon,
  BotIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  CodeIcon,
  FileTextIcon,
  FlagIcon,
  ListIcon,
  type LucideIcon,
  MapPinIcon,
  MonitorIcon,
  PlusIcon,
  RocketIcon,
  ScaleIcon,
  ServerIcon,
  TargetIcon,
  UserCheckIcon,
} from "lucide-react"
import { passageSection, selectedContextPassage } from "../reader/selected-passage.ts"
import { ReasonRows } from "../steps/plan/BoundaryParts.tsx"
import { reasonRowsOf } from "../steps/plan/plan-model.ts"

/** The mark of a section the page draws itself: its own where the step names one, the file mark otherwise. */
const SECTION_ICONS: Record<string, LucideIcon> = {
  Problem: CircleAlertIcon,
  Summary: ListIcon,
  "Decided with you": UserCheckIcon,
  "Decisions made for you": BotIcon,
  Assumptions: CircleHelpIcon,
  "Not doing": BanIcon,
  "Success measure": TargetIcon,
  "First release": FlagIcon,
  "What the user sees": MonitorIcon,
  Launch: RocketIcon,
  "Worth it when": ScaleIcon,
  Reference: BookOpenIcon,
  "Added while building": PlusIcon,
  "Rollout and operations": ServerIcon,
  "Context pointers": MapPinIcon,
  "First look at the code": CodeIcon,
  Untraced: CircleDashedIcon,
}
const sectionIcon = (title: string): LucideIcon => SECTION_ICONS[title] ?? FileTextIcon

import { marked, type Token } from "marked"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { docBlocks, markerKey } from "../../core/docs/markers.ts"
import { FLOW_STEPS } from "../../core/flow.ts"
import type { DocSection, DocSections } from "../api.ts"
import { usePlanNow } from "../docs/context.ts"
import { parseRoute } from "../hooks.ts"
import { BuildAutonomyContext } from "../interaction/build-autonomy.ts"
import { OutsideContext } from "../outside.ts"
import { InlineMarkdown } from "../reader/DocReader.tsx"
import { useStepSupporting } from "../steps/context.ts"
import { ReviewedBy } from "../steps/plan/parts.tsx"
import { withoutCallLines } from "../steps/plan/plan-model.ts"
import { StepQuiet } from "../steps/StepQuiet.tsx"
import { Bands } from "./bands/Bands.tsx"
import { Fold, type FoldGroup, Part, Quiet } from "./bands/Fold.tsx"
import { foldGroupOf } from "./bands/FoldedGroup.tsx"
import type { GistProps } from "./bands/Gist.tsx"
import { AsOf } from "./bands/Gist.tsx"
import { SummaryPart } from "./bands/SummaryPart.tsx"
import { YourMove } from "./bands/YourMove.tsx"
import { CommentBlock, DocMarkdown, hasWrittenMarkdown } from "./DocMarkdown.tsx"
import type { StepDocument } from "./document.ts"
import { jumpTo } from "./jump.ts"
import { LeadFold } from "./LeadFold.tsx"
import type { StepLive } from "./live.ts"
import { OriginalRequest } from "./OriginalRequest.tsx"
import { ApprovePlan, Artifact, Decide, type PartProps } from "./PlanningParts.tsx"
import { type Drawer, RecordDrawer } from "./RecordDrawer.tsx"
import { StepTools } from "./StepTools.tsx"
import {
  bandsOfSections,
  foldFacts,
  lineCount,
  quietLine,
  sectionId,
  summaryOf,
} from "./sections.ts"
import { plainMarkdown, type Segment, segmentsOf } from "./segments.ts"
import type { Mode, StepState } from "./state.ts"
import { stepTitleOf } from "./titles.ts"

export { jumpTo }

/** A part QualityLayer draws over a `ql:` marker. */
export type PartComponent = (p: PartProps) => ReactNode

/**
 * Draws a part inside one component that stays mounted. A page hands its parts in as functions it
 * makes while it renders, so each draw is a new function; as an element type each would remount the
 * part and lose what it holds (an opened lane row, an opened slice). Called from here, the part's
 * state lives in this host, which the segment's key keeps.
 */
function PartHost({ part, ...props }: PartProps & { part: PartComponent }) {
  return part(props)
}

/** The parts a page draws by marker name; `null` draws nothing (the card stands elsewhere). */
export type PartMap = Record<string, PartComponent | null>

/** What a section renderer can set beyond its body when the section is a fold. */
export type SectionDraw = {
  body: ReactNode
  title?: string
  /** The mark before a fold's title. */
  icon?: LucideIcon
  count?: ReactNode
  takeaway?: string
  /** How many lines the body has, for the grouping that starts past about twelve. */
  lines?: number
  groups?: FoldGroup[]
  open?: boolean
}

export type SectionCtx = {
  section: DocSection
  /** The section as a document: its markers found again. */
  doc: StepDocument
  /** The generic drawing of the section: Markdown in order, a live part over each marker. */
  draw: () => ReactNode
  state: StepState
  mode: Mode
  live: StepLive | undefined
  /** Open a record in the page's drawer (live mode only). */
  show: (drawer: Drawer) => void
}

/** A section that reduces to one quiet line ("no second opinion: light task"): never a fold or a bare heading. */
export type QuietDraw = { quiet: string }

/** A section's own drawing: its rows, a `SectionDraw`, a `QuietDraw`, or `null` for nothing. */
export type SectionRenderer = (ctx: SectionCtx) => ReactNode | SectionDraw | QuietDraw

const isObjectDraw = (value: unknown, key: string): boolean =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  key in value &&
  !("$$typeof" in value)

const isSectionDraw = (value: unknown): value is SectionDraw => isObjectDraw(value, "body")

const isQuietDraw = (value: unknown): value is QuietDraw => isObjectDraw(value, "quiet")

type Props = {
  document: StepDocument
  state: StepState
  mode: Mode
  /** What the page can do; only in live mode. */
  live?: StepLive
  /** The document cut into sections; the bands are drawn from it. Null or absent: drawn whole. */
  cut?: DocSections | null | undefined
  /** The task the page belongs to, for the Reader links; read from the route when absent. */
  taskId?: string | undefined
  /** Band 1: the person's cards, drawn here once. */
  yourMove?: ReactNode
  /** Band 2: set over the gist the Summary gives (the Summary's two sentences and counts). */
  gist?: GistProps | undefined
  /**
   * Draw the Summary as the core's first section, led by this mark (the Plan), instead of in the
   * header beside a label. The counts its first line carries stay in the header.
   */
  summaryIcon?: LucideIcon | undefined
  /** Band 5: the working sections' strip. */
  more?: ReactNode
  parts?: PartMap | undefined
  sections?: Record<string, SectionRenderer> | undefined
  /** A fold's grouping past about twelve lines, by section title. */
  foldGroups?: Record<string, (ctx: SectionCtx) => FoldGroup[] | undefined> | undefined
}

/** The part a marker stands for on its step; null for one the page does not know (its fallback shows). */
export function partFor(step: StepDocument["step"], name: string): PartComponent | null {
  switch (`${step}:${name}`) {
    case "plan:artifact":
      return Artifact
    case "plan:decide":
      return Decide
    // A task's Plan: who reviewed it (the Plan page draws the rest of its sections itself).
    case "plan:reviews":
      return ReviewedBy
    case "plan:approve":
      return ApprovePlan
    default:
      return null
  }
}

/** ⌘↵ and Ctrl+Enter approve the Plan from anywhere on its page, unless a field or dialog has the key. */
function usePlanShortcut(state: StepState, mode: Mode, live: StepLive | undefined) {
  const latest = useRef({ state, live })
  latest.current = { state, live }
  useEffect(() => {
    if (mode !== "live") return
    const on = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.defaultPrevented)
        return
      const el = event.target as HTMLElement | null
      if (
        el !== null &&
        (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
      )
        return
      if (
        document.querySelector(
          '[role="dialog"][data-open], [data-slot="select-positioner"][data-open]',
        ) !== null
      )
        return
      const { state: s, live: acts } = latest.current
      const approve = s.plan?.approve
      if (
        acts === undefined ||
        s.outside === true ||
        approve?.phase !== "open" ||
        approve.locked !== null ||
        acts.busy
      )
        return
      event.preventDefault()
      acts.decide(approve.main.kind === "changes" ? "changes" : "approved")
    }
    window.addEventListener("keydown", on)
    return () => window.removeEventListener("keydown", on)
  }, [mode])
}

/** A selection in the page is a mark, as in the reader: the quick field opens under it. */
export function useSelectionMark(
  root: React.RefObject<HTMLElement | null>,
  live: StepLive | undefined,
) {
  const mark = live?.mark
  const source = live?.markSource
  useEffect(() => {
    if (mark === undefined || source === undefined) return
    const up = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Shift") return
      const picked = window.getSelection()
      const text = picked?.toString().replace(/\s+/g, " ").trim() ?? ""
      if (picked === null || picked.rangeCount === 0 || text.length < 3) return
      const range = picked.getRangeAt(0)
      if (root.current?.contains(range.commonAncestorContainer) !== true) return
      // Words outside a quotable block (a gist line, a card) are still a mark: their section is the
      // heading above them.
      const node = range.commonAncestorContainer
      const element = node instanceof Element ? node : node.parentElement
      const section = element ? passageSection(element) : undefined
      const passage = selectedContextPassage(picked) ?? {
        quote: text,
        before: "",
        after: "",
        ...(section ? { section } : {}),
      }
      const boxes = Array.from(range.getClientRects())
        .filter((box) => box.width > 1)
        .map((box) => ({ x: box.left, y: box.top, width: box.width, height: box.height }))
      if (boxes.length) mark({ passage, source, boxes })
    }
    document.addEventListener("mouseup", up)
    document.addEventListener("keyup", up)
    return () => {
      document.removeEventListener("mouseup", up)
      document.removeEventListener("keyup", up)
    }
  }, [mark, source, root])
}

const asOf = (at: number) =>
  new Date(at).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })

/** A section's text as a document of its own: its markers and blocks found again. */
function sectionDocument(document: StepDocument, markdown: string): StepDocument {
  const { markers, blocks } = docBlocks(markdown)
  return {
    ...document,
    markdown,
    markers: markers.map((m) => ({ ...m, key: markerKey(m), edited: false })),
    blocks,
  }
}

/** The title of the document's `# ` line, unless it repeats the task's own (the header says that). */
function titleOf(preamble: string): string | null {
  const found = /^# (.+)$/m.exec(preamble)?.[1]?.trim()
  if (found === undefined) return null
  return found
}

export function StepPage({
  document: doc,
  state,
  mode,
  live,
  cut,
  taskId,
  yourMove,
  gist,
  summaryIcon,
  more,
  parts,
  sections: sectionViews,
  foldGroups: groupsOf,
}: Props) {
  const ownedByNow = usePlanNow()
  const supporting = useStepSupporting()
  const acts = mode === "live" ? live : undefined
  const commentActs = state.closed ? undefined : acts
  const [drawer, setDrawer] = useState<Drawer | null>(null)
  const root = useRef<HTMLDivElement | null>(null)
  usePlanShortcut(state, mode, acts)
  useSelectionMark(root, commentActs)
  const show = (next: Drawer) => (mode === "live" ? setDrawer(next) : undefined)
  const plain = useMemo(() => plainMarkdown(doc), [doc])

  if (mode === "live" && state.preparing)
    return (
      <div data-testid="plan-preparing" data-step="plan">
        <YourMove>{yourMove}</YourMove>
        {supporting}
        <StepQuiet step="plan" kind={state.working ? "writing" : "draft"} back={null} />
        <div className="sp-doc">
          <OriginalRequest key={taskId} request={state.preparing.request} />
        </div>
      </div>
    )

  // A document that exists but holds nothing yet is still being written, as a missing one is.
  if (mode !== "plain" && doc.markdown.trim() === "")
    return (
      <>
        <YourMove>{yourMove}</YourMove>
        {supporting}
        <StepQuiet step={doc.step} kind={state.working ? "writing" : "draft"} back={null} />
      </>
    )

  if (mode === "plain") {
    return (
      <div className="sp-page" data-testid="step-page" data-mode="plain">
        <div className="sp-doc">
          <DocMarkdown markdown={plain} state={state} first live={undefined} bare />
        </div>
      </div>
    )
  }

  const planInNow = doc.step === "plan" && mode === "live" && ownedByNow
  const partOf = (name: string): PartComponent | null =>
    parts !== undefined && name in parts ? (parts[name] ?? null) : partFor(doc.step, name)
  // A part draws nothing when its words are drawn elsewhere (the Now column, the header) or empty.
  const draws = (marker: StepDocument["markers"][number]): boolean => {
    if (planInNow && marker.name === "approve") return false
    if (parts !== undefined && marker.name in parts) return parts[marker.name] !== null
    return partOf(marker.name) !== null || rendersMarkdown(marker.fallback)
  }

  /** A document drawn in order: its Markdown as written, a live part over each marker. */
  function drawDocument(
    document: StepDocument,
    options: { first: boolean; hide?: readonly string[]; keyPrefix?: string },
  ): ReactNode {
    const segments = segmentsOf(document)
    const hiddenHeadings = new Set([
      ...emptySections(segments, draws, document.step !== "plan"),
      ...(options.hide ?? []),
    ])
    const prefix = options.keyPrefix ?? ""
    const drawSegment = (segment: Segment, index: number): ReactNode => {
      const key = `${prefix}${segment.key}`
      if (segment.kind === "text")
        return (
          <DocMarkdown
            key={key}
            markdown={
              document.step === "plan"
                ? segment.markdown.replace(/<!--\s*fill:[\s\S]*?-->/g, "")
                : segment.markdown
            }
            state={state}
            first={options.first && index === 0}
            live={acts}
            hiddenHeadings={hiddenHeadings}
          />
        )
      const Part = partOf(segment.marker.name)
      if (planInNow && segment.marker.name === "approve") return null
      if (
        parts !== undefined &&
        segment.marker.name in parts &&
        parts[segment.marker.name] === null
      )
        return null
      if (Part === null)
        return (
          <DocMarkdown
            key={key}
            markdown={segment.marker.fallback}
            state={state}
            first={false}
            live={acts}
          />
        )
      return (
        <div
          key={key}
          className="sp-part"
          data-part={segment.marker.name}
          data-testid={`part-${segment.marker.name}`}
        >
          <CommentBlock
            raw={segment.marker.fallback}
            live={
              segment.marker.name === "approve" ||
              (segment.marker.name === "decide" &&
                state.plan?.decisions[segment.marker.args[0] ?? ""]?.documentary)
                ? undefined
                : commentActs
            }
          >
            <PartHost
              part={Part}
              marker={segment.marker}
              state={state}
              mode={mode}
              live={acts}
              show={show}
            />
          </CommentBlock>
        </div>
      )
    }
    return foldGroups(segments).map((group) => {
      if (group.kind === "fold")
        return (
          <LeadFold
            key={`${prefix}${group.key}`}
            whole={group.whole}
            diagram={group.segments.some(
              (s) => s.kind === "text" && /^\s{0,3}(`{3,}|~{3,})\s*mermaid/m.test(s.markdown),
            )}
          >
            {group.segments.map((segment) => drawSegment(segment, -1))}
          </LeadFold>
        )
      return drawSegment(group.segment, group.index)
    })
  }

  const ctxOf = (section: DocSection, hide: boolean): SectionCtx => {
    // The lines that only describe a Your call (its options and recommendation) are the call's to draw.
    const sectionDoc = sectionDocument(
      doc,
      doc.step === "plan" ? withoutCallLines(section.markdown) : section.markdown,
    )
    return {
      section,
      doc: sectionDoc,
      draw: () =>
        drawDocument(sectionDoc, {
          first: false,
          keyPrefix: `${sectionId(section.title)}:`,
          ...(hide ? { hide: [section.title] } : {}),
        }),
      state,
      mode,
      live: acts,
      show,
    }
  }

  const route = parseRoute(window.location.hash)
  const task = taskId ?? (route.view === "task" ? route.id : undefined)

  /** One lead section of the core. */
  function coreSection(section: DocSection): ReactNode {
    const wrap = (body: ReactNode) => (
      <div
        key={section.title}
        className="bd-sec"
        id={sectionId(section.title)}
        data-section={section.title}
      >
        {body}
      </div>
    )
    const ctx = ctxOf(section, false)
    const namedPoints = section.title === "Done means" && (state.decided?.points.length ?? 0) > 0
    if (
      doc.step === "plan" &&
      !namedPoints &&
      !hasWrittenMarkdown(ctx.doc.markdown) &&
      !ctx.doc.markers.some(draws)
    )
      return null
    const custom = sectionViews?.[section.title]
    if (custom !== undefined) {
      const made = custom(ctx)
      if (made === null || made === undefined) return null
      if (isQuietDraw(made))
        return (
          <Quiet key={section.title} title={section.title} icon={sectionIcon(section.title)}>
            {made.quiet}.
          </Quiet>
        )
      return wrap(isSectionDraw(made) ? made.body : made)
    }
    const quiet = quietLine(section.markdown)
    if (quiet !== null)
      return (
        <Quiet key={section.title} title={section.title} icon={sectionIcon(section.title)}>
          {quiet}.
        </Quiet>
      )
    // A section with nothing to draw (no words, no part that draws) leaves no bare heading.
    if (emptyOf(ctx.doc, section.title)) return null
    // A lead section with no drawing of its own stands as a part with its mark, never as a bare heading.
    return wrap(
      <Part
        id={`${sectionId(section.title)}-h`}
        title={section.title}
        icon={sectionIcon(section.title)}
      >
        {ctxOf(section, true).draw()}
      </Part>,
    )
  }

  function emptyOf(document: StepDocument, title: string): boolean {
    return emptySections(segmentsOf(document), draws, document.step !== "plan").includes(title)
  }

  /** One lead-folded section: a Fold with its heading, count and takeaway, or a quiet line, or nothing. */
  function foldedSection(section: DocSection): ReactNode {
    const ctx = ctxOf(section, true)
    const custom = sectionViews?.[section.title]
    const made = custom !== undefined ? custom(ctx) : undefined
    if (custom !== undefined && (made === null || made === undefined)) return null
    if (isQuietDraw(made))
      return (
        <Quiet key={section.title} title={section.title} icon={sectionIcon(section.title)}>
          {made.quiet}.
        </Quiet>
      )
    const quiet = quietLine(section.markdown)
    if (custom === undefined && quiet !== null)
      return (
        <Quiet key={section.title} title={section.title} icon={sectionIcon(section.title)}>
          {quiet}.
        </Quiet>
      )
    if (custom === undefined && emptyOf(ctx.doc, section.title)) return null
    const facts = foldFacts(section.markdown)
    const draw = isSectionDraw(made) ? made : undefined
    const body =
      made !== undefined ? (
        isSectionDraw(made) ? (
          made.body
        ) : (
          made
        )
      ) : section.title === "Decisions made for you" && reasonRowsOf(section.markdown) !== null ? (
        <ReasonRows
          rows={reasonRowsOf(section.markdown) ?? []}
          taskId={task ?? ""}
          active={mode === "live"}
        />
      ) : (
        ctx.draw()
      )
    return (
      <Fold
        key={section.title}
        id={sectionId(section.title)}
        title={draw?.title ?? section.title}
        icon={draw?.icon ?? sectionIcon(section.title)}
        sectionTitle={section.title}
        count={draw?.count ?? state.headings[section.title]?.count ?? facts.count ?? undefined}
        // The decision folds read like Decided with you: a title and a count, no gist line.
        takeaway={
          section.title === "Decisions made for you"
            ? undefined
            : (draw?.takeaway ?? facts.takeaway)
        }
        lines={draw?.lines ?? lineCount(section.markdown)}
        groups={draw?.groups ?? groupsOf?.[section.title]?.(ctx)}
        open={draw?.open}
      >
        {body}
      </Fold>
    )
  }

  // The agents work on their own on Implement, and on Verify until it turns to the person.
  const autonomous =
    mode === "live" &&
    (doc.step === "implement" || (doc.step === "verify" && state.review === undefined))
  const cutDrawn = cut !== undefined && cut !== null
  const bands = cutDrawn ? bandsOfSections(cut) : null
  // What stands between the title and the first section (Review's links line) is read before the core.
  const preface = cut?.preamble.replace(/^# .*\n?/m, "").trim() ?? ""
  const prefaceNode =
    preface !== "" && rendersMarkdown(preface)
      ? drawDocument(sectionDocument(doc, preface), { first: false, keyPrefix: "preface:" })
      : null

  /** The gist the Summary gives: the title, its two sentences and the counts its first line carries. */
  function gistOf(): GistProps | undefined {
    // Copy and Sections stand beside the title on every step.
    const actions = <StepTools doc={doc} cut={cut} live={acts} />
    if (cut === undefined || cut === null || bands === null)
      return {
        actions,
        title: (
          <InlineMarkdown
            text={
              stepTitleOf(doc.step) ??
              titleOf(doc.markdown) ??
              FLOW_STEPS.find((step) => step.id === doc.step)?.label ??
              state.title
            }
          />
        ),
        ...(mode === "snapshot" ? { asOf: <AsOf>As of {asOf(state.at)}</AsOf> } : {}),
        ...gist,
      }
    const summary = bands.summary
    const title =
      stepTitleOf(doc.step) ??
      titleOf(cut.preamble) ??
      FLOW_STEPS.find((step) => step.id === doc.step)?.label ??
      state.title
    const summaryCtx = summary !== null ? ctxOf(summary, true) : null
    const custom = summary !== null ? sectionViews?.Summary : undefined
    const asked = custom !== undefined && summaryCtx !== null ? custom(summaryCtx) : undefined
    const made = isSectionDraw(asked) ? asked.body : isQuietDraw(asked) ? null : asked
    const hasPart = summaryCtx?.doc.markers.some((m) => partOf(m.name) !== null) === true
    const words = summary !== null ? summaryOf(summary.markdown) : null
    const drawn: ReactNode =
      custom !== undefined ? (
        made
      ) : summaryCtx !== null && hasPart ? (
        summaryCtx.draw()
      ) : words !== null && words.sentences !== "" ? (
        <CommentBlock raw={summary?.markdown ?? ""} live={commentActs}>
          <p>
            <InlineMarkdown text={words.sentences} />
          </p>
        </CommentBlock>
      ) : undefined
    const base: GistProps = {
      actions,
      ...(title !== null ? { title: <InlineMarkdown text={title} /> } : {}),
      ...(mode === "snapshot" ? { asOf: <AsOf>As of {asOf(state.at)}</AsOf> } : {}),
      ...(drawn !== undefined && drawn !== null ? { summary: drawn } : {}),
      ...(words !== null && words.bullets.length > 0 && !hasPart && made === undefined
        ? { bullets: words.bullets.map((b) => <InlineMarkdown key={b} text={b} />) }
        : {}),
      ...(words !== null && words.facts.length > 0 ? { facts: words.facts } : {}),
      ...(state.needs.entries.length > 0
        ? {
            meta: `${state.needs.entries.length} ${state.needs.entries.length === 1 ? "thing needs" : "things need"} you`,
          }
        : {}),
    }
    return { ...base, ...gist }
  }

  // With a `summaryIcon` the Summary's words leave the header and stand as the core's first section.
  const wholeGist = gistOf()
  const {
    summary: summaryWords,
    bullets: summaryBullets,
    summaryAfter,
    ...gistRest
  } = wholeGist ?? {}
  // Only a page drawn from its sections moves the Summary out of the header; a document still loading keeps it there.
  const summaryDrawn =
    summaryIcon !== undefined &&
    bands !== null &&
    ((summaryWords !== undefined && summaryWords !== null && summaryWords !== "") ||
      (summaryBullets?.length ?? 0) > 0)
  const gistShown = summaryDrawn ? gistRest : wholeGist
  const summarySection =
    summaryDrawn && summaryIcon !== undefined ? (
      <div key="Summary" className="bd-sec" id={sectionId("Summary")} data-section="Summary">
        <SummaryPart
          title="Summary"
          icon={summaryIcon}
          summary={summaryWords}
          bullets={summaryBullets}
        >
          {summaryAfter}
        </SummaryPart>
      </div>
    ) : null

  return (
    <BuildAutonomyContext value={autonomous}>
      <OutsideContext value={state.outside === true}>
        <div
          className="sp-page sp-enter"
          ref={root}
          data-testid="step-page"
          data-mode={mode}
          data-step={doc.step}
        >
          {cutDrawn && bands !== null ? (
            <Bands
              yourMove={yourMove}
              gist={gistShown}
              core={[prefaceNode, summarySection, ...bands.core.map(coreSection)]}
              folds={foldGroupOf(bands.folded.map(foldedSection))}
              more={more}
            />
          ) : (
            <Bands
              yourMove={yourMove}
              gist={gistShown}
              core={drawDocument(
                sectionDocument(doc, doc.markdown.replace(/^\s*# [^\n]*(?:\r?\n|$)/, "")),
                { first: true },
              )}
              more={more}
            />
          )}
          {acts !== undefined ? (
            <RecordDrawer drawer={drawer} live={acts} onClose={() => setDrawer(null)} />
          ) : null}
        </div>
      </OutsideContext>
    </BuildAutonomyContext>
  )
}

/** Whether a token draws anything on the page: a template's `fill` note does, any other comment does not. */
function drawsToken(token: Token, includeFill = true): boolean {
  if (token.type === "space") return false
  if (token.type === "html" && /^<!--[\s\S]*-->$/.test(token.raw.trim()))
    return includeFill && /^<!--\s*fill:/.test(token.raw.trim())
  return true
}

const rendersMarkdown = (markdown: string): boolean =>
  marked.lexer(markdown).some((token) => drawsToken(token))

/**
 * The second-level headings whose section draws nothing on the page: no words under them and no
 * part that draws something. The page leaves such a heading out rather than draw it bare.
 */
function emptySections(
  segments: Segment[],
  draws: (marker: StepDocument["markers"][number]) => boolean,
  includeFill = true,
): string[] {
  const empty: string[] = []
  let open: string | null = null
  let filled = false
  const close = () => {
    if (open !== null && !filled) empty.push(open)
    open = null
  }
  for (const segment of segments) {
    if (segment.kind === "part") {
      if (segment.marker.name !== "fold" && draws(segment.marker)) filled = true
      continue
    }
    for (const token of marked.lexer(segment.markdown)) {
      if (token.type === "heading" && token.depth <= 2) {
        close()
        if (token.depth === 2) {
          open = token.text
          filled = false
        }
        continue
      }
      if (open !== null && token.type !== "heading" && drawsToken(token, includeFill)) filled = true
    }
  }
  close()
  return empty
}

type FoldGroupOf =
  | { kind: "one"; segment: Segment; index: number }
  | { kind: "fold"; key: string; whole: boolean; segments: Segment[] }

/** The page's segments with each `ql:fold` … `ql:fold end` run gathered into one fold. */
function foldGroups(segments: Segment[]): FoldGroupOf[] {
  const out: FoldGroupOf[] = []
  let open: Extract<FoldGroupOf, { kind: "fold" }> | null = null
  segments.forEach((segment, index) => {
    if (segment.kind === "part" && segment.marker.name === "fold") {
      if (segment.marker.args[0] === "end") open = null
      else {
        open = {
          kind: "fold",
          key: segment.key,
          whole: segment.marker.args[0] === "whole",
          segments: [],
        }
        out.push(open)
      }
      return
    }
    if (open !== null) open.segments.push(segment)
    else out.push({ kind: "one", segment, index })
  })
  return out
}
