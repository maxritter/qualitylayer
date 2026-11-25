// One step's page: its document drawn as a briefing in five bands, in this order, a band with nothing
// in it left out (the rules are docs/artifacts/step-pages.md; the picture is the App Model's step
// pages). StepPage(document, state, mode): live in the App, snapshot on the share link (no owner
// controls, no artifacts: a still picture instead), plain as GitHub reads the file.

import type { LucideIcon } from "lucide-react"
import { Fragment, type ReactNode, useMemo, useRef, useState } from "react"
import type { DocSections } from "../api.ts"
import { usePlanNow } from "../docs/context.ts"
import { parseRoute } from "../hooks.ts"
import { BuildAutonomyContext } from "../interaction/build-autonomy.ts"
import { OutsideContext } from "../outside.ts"
import { useStepSupporting } from "../steps/context.ts"
import { StepQuiet } from "../steps/StepQuiet.tsx"
import { Bands } from "./bands/Bands.tsx"
import type { FoldGroup } from "./bands/Fold.tsx"
import { foldGroupOf } from "./bands/FoldedGroup.tsx"
import type { GistProps } from "./bands/Gist.tsx"
import { SummaryPart } from "./bands/SummaryPart.tsx"
import { YourMove } from "./bands/YourMove.tsx"
import { DocMarkdown } from "./DocMarkdown.tsx"
import type { StepDocument } from "./document.ts"
import { jumpTo } from "./jump.ts"
import type { StepLive } from "./live.ts"
import { OriginalRequest } from "./OriginalRequest.tsx"
import { type Drawer, RecordDrawer } from "./RecordDrawer.tsx"
import { bandsOfSections, sectionId } from "./sections.ts"
import { plainMarkdown } from "./segments.ts"
import type { Mode, StepState } from "./state.ts"
import { type DrawEnv, drawStepDocument } from "./step-page-draw.tsx"
import { buildStepGist, hasSummaryContent } from "./step-page-gist.tsx"
import { usePlanShortcut, useSelectionMark } from "./step-page-hooks.ts"
import {
  renderCoreSection,
  renderFoldedSection,
  type SectionRenderEnv,
} from "./step-page-sections.tsx"
import {
  type PartMap,
  rendersMarkdown,
  type SectionCtx,
  type SectionRenderer,
  sectionDocument,
} from "./step-page-segments.ts"

export { jumpTo, type SectionCtx, type SectionRenderer, useSelectionMark }

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
  /** Optional notice or comparison band rendered immediately below the header and above Summary. */
  beforeCore?: ReactNode
  /** Band 5: the working sections' strip. */
  more?: ReactNode
  parts?: PartMap | undefined
  sections?: Record<string, SectionRenderer> | undefined
  /** A fold's grouping past about twelve lines, by section title. */
  foldGroups?: Record<string, (ctx: SectionCtx) => FoldGroup[] | undefined> | undefined
}

function PreparingPlanView({
  request,
  working,
  activity,
  taskId,
  yourMove,
  supporting,
}: {
  request: string
  working: boolean | undefined
  activity: string | undefined
  taskId: string | undefined
  yourMove: ReactNode
  supporting: ReactNode
}) {
  const quiet = (
    <StepQuiet step="plan" kind={working ? "writing" : "draft"} activity={activity} back={null} />
  )
  return (
    <div data-testid="plan-preparing" data-step="plan">
      <YourMove>{yourMove}</YourMove>
      {supporting}
      {request === "" ? (
        quiet
      ) : (
        <div className="sp-page sp-plan-preparing">
          <div className="sp-doc">
            {quiet}
            <OriginalRequest key={taskId} request={request} />
          </div>
        </div>
      )}
    </div>
  )
}

function resolvePrefaceNode(
  doc: StepDocument,
  cut: DocSections | null | undefined,
  drawEnv: DrawEnv,
): ReactNode {
  const preface = cut?.preamble.replace(/^# .*\n?/m, "").trim() ?? ""
  if (preface === "" || !rendersMarkdown(preface)) return null
  return drawStepDocument(sectionDocument(doc, preface), drawEnv, {
    first: false,
    keyPrefix: "preface:",
  })
}

function SummaryBand({
  icon,
  summary,
  bullets,
  after,
}: {
  icon: LucideIcon | undefined
  summary: ReactNode
  bullets: readonly ReactNode[] | undefined
  after: ReactNode
}) {
  if (icon === undefined) return null
  return (
    <div key="Summary" className="bd-sec" id={sectionId("Summary")} data-section="Summary">
      <SummaryPart title="Summary" icon={icon} summary={summary} bullets={bullets}>
        {after}
      </SummaryPart>
    </div>
  )
}

function StepPageBands({
  doc,
  cut,
  bands,
  drawEnv,
  sectionEnv,
  yourMove,
  gistShown,
  beforeCore,
  summarySection,
  more,
}: {
  doc: StepDocument
  cut: DocSections | null | undefined
  bands: ReturnType<typeof bandsOfSections> | null
  drawEnv: DrawEnv
  sectionEnv: SectionRenderEnv
  yourMove: ReactNode
  gistShown: GistProps
  beforeCore: ReactNode
  summarySection: ReactNode
  more: ReactNode
}) {
  if (bands === null) {
    return (
      <Bands
        yourMove={yourMove}
        gist={gistShown}
        core={drawStepDocument(
          sectionDocument(doc, doc.markdown.replace(/^\s*# [^\n]*(?:\r?\n|$)/, "")),
          drawEnv,
          { first: true },
        )}
        more={more}
      />
    )
  }
  const preface = resolvePrefaceNode(doc, cut, drawEnv)
  return (
    <Bands
      yourMove={yourMove}
      gist={gistShown}
      core={[
        beforeCore ? <Fragment key="before-core">{beforeCore}</Fragment> : null,
        preface ? <Fragment key="preface">{preface}</Fragment> : null,
        summarySection ? <Fragment key="summary-section">{summarySection}</Fragment> : null,
        ...bands.core.map((section) => renderCoreSection(sectionEnv, section)),
      ]}
      folds={foldGroupOf(bands.folded.map((section) => renderFoldedSection(sectionEnv, section)))}
      more={more}
    />
  )
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
  beforeCore,
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

  if (mode === "live" && state.preparing) {
    return (
      <PreparingPlanView
        request={state.preparing.request}
        working={state.working}
        activity={state.activity}
        taskId={taskId}
        yourMove={yourMove}
        supporting={supporting}
      />
    )
  }

  // A document that exists but holds nothing yet is still being written, as a missing one is.
  if (mode !== "plain" && doc.markdown.trim() === "") {
    return (
      <>
        <YourMove>{yourMove}</YourMove>
        {supporting}
        <StepQuiet
          step={doc.step}
          kind={state.working ? "writing" : "draft"}
          activity={state.activity}
          back={null}
        />
      </>
    )
  }

  if (mode === "plain") {
    return (
      <div className="sp-page" data-testid="step-page" data-mode="plain">
        <div className="sp-doc">
          <DocMarkdown markdown={plain} state={state} first live={undefined} bare />
        </div>
      </div>
    )
  }

  const route = parseRoute(window.location.hash)
  const task = taskId ?? (route.view === "task" ? route.id : undefined)
  const drawEnv: DrawEnv = {
    step: doc.step,
    state,
    mode,
    acts,
    commentActs,
    parts,
    planInNow: doc.step === "plan" && mode === "live" && ownedByNow,
    show,
  }
  const sectionEnv: SectionRenderEnv = { doc, drawEnv, task, sectionViews, groupsOf }
  const autonomous =
    mode === "live" &&
    (doc.step === "implement" || (doc.step === "verify" && state.review === undefined))
  const bands = cut !== undefined && cut !== null ? bandsOfSections(cut) : null
  const wholeGist = buildStepGist({ env: sectionEnv, cut, bands, gist })
  const { summary: summaryWords, bullets: summaryBullets, summaryAfter, ...gistRest } = wholeGist
  const summaryDrawn =
    summaryIcon !== undefined && bands !== null && hasSummaryContent(summaryWords, summaryBullets)
  const gistShown = summaryDrawn ? gistRest : wholeGist
  const summarySection = summaryDrawn ? (
    <SummaryBand
      icon={summaryIcon}
      summary={summaryWords}
      bullets={summaryBullets}
      after={summaryAfter}
    />
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
          <StepPageBands
            doc={doc}
            cut={cut}
            bands={bands}
            drawEnv={drawEnv}
            sectionEnv={sectionEnv}
            yourMove={yourMove}
            gistShown={gistShown}
            beforeCore={beforeCore}
            summarySection={summarySection}
            more={more}
          />
          {acts !== undefined ? (
            <RecordDrawer drawer={drawer} live={acts} onClose={() => setDrawer(null)} />
          ) : null}
        </div>
      </OutsideContext>
    </BuildAutonomyContext>
  )
}
