// The review's sections (Workflow model, Verify): the Diagrams as tabs, the Interface as the Plan's
// Interface draws it (one picture a tab, what was built or the design you approved), and Done means
// as it ran, a numbered row per step that opens to its picture or output. Each tab
// leads with an icon; a result says how it was obtained.

import {
  BlocksIcon,
  BookOpenIcon,
  BugIcon,
  CheckIcon,
  CircleCheckIcon,
  HammerIcon,
  HomeIcon,
  ListOrderedIcon,
  type LucideIcon,
  MonitorIcon,
  PencilRulerIcon,
  SettingsIcon,
  WorkflowIcon,
} from "lucide-react"
import { type ReactNode, useContext, useState } from "react"
import { createPortal } from "react-dom"
import { beforeAfterParts, boldParts } from "../../../core/docs/prose-parts.ts"
import type { AcceptanceAsRun, AcceptanceRow } from "../../../core/review/screen-evidence.ts"
import type { WalkScreen } from "../../../core/review/screen-pairs.ts"
import type { Api } from "../../api.ts"
import { PreviewActions } from "../../artifact/PreviewControls.tsx"
import { useQuery } from "../../hooks.ts"
import { useActionSlot } from "../../kit/action-slot.ts"
import { InlineMarkdown } from "../../reader/DocReader.tsx"
import { Segmented } from "../../Segmented.tsx"
import { DocMarkdown } from "../../step-page/DocMarkdown.tsx"
import { FigureBelow, GalleryTabs } from "../../step-page/kit/GalleryTabs.tsx"
import { NumberedRows } from "../../step-page/kit/NumberedRows.tsx"
import { type Picture, PictureViewer } from "../../step-page/kit/PictureViewer.tsx"
import type { StepLive } from "../../step-page/live.ts"
import type { Mode, StepState } from "../../step-page/state.ts"
import {
  artifactReferenceForScreen,
  BuiltScreen,
  DesignedScreen,
  leadScreens,
  ScreenImage,
} from "../../timeline/Walkthrough.tsx"
import { BLANK, type LoadEvidence, useEvidenceSources } from "../evidence-pictures.ts"
import type { ChangedDiagram } from "./record.ts"

type Where = { state: StepState; mode: Mode; live: StepLive | undefined }

const icon = (Icon: LucideIcon) => <Icon className="size-[13px]" aria-hidden="true" />

const DIAGRAM_ICONS: Record<ChangedDiagram["kind"], LucideIcon> = {
  sequence: ListOrderedIcon,
  flow: WorkflowIcon,
  state: BlocksIcon,
}

const Caption = ({ children, hidden }: { children: ReactNode; hidden?: boolean }) =>
  children === "" || hidden === true ? null : <p className="rvw-cap">{children}</p>

/** Up to three diagrams in tabs, each in the App's diagram view with its one sentence. */
export function ChangedTabs({
  diagrams,
  state,
  live,
}: { diagrams: readonly ChangedDiagram[] } & Where) {
  if (diagrams.length === 0) return null
  return (
    <GalleryTabs
      label="Diagrams"
      tabs={diagrams.map((item) => ({
        id: item.id,
        icon: icon(DIAGRAM_ICONS[item.kind]),
        label: item.title,
        panel: (
          <>
            <DocMarkdown
              markdown={`\`\`\`mermaid\n${item.code}\n\`\`\``}
              state={state}
              first={false}
              live={live}
            />
            <Caption>
              <InlineMarkdown text={item.caption} />
            </Caption>
          </>
        ),
      }))}
    />
  )
}

/** "approve-menu" → "Approve menu": the screen's name as a tab. */
const nameOf = (key: string): string => {
  // A screen named by its artifact page ("settings/automations.html#automations-list") is called
  // by its section, or by the page when it names none: never by the path.
  const section = key.includes("#") ? key.slice(key.lastIndexOf("#") + 1) : ""
  const page = (key.split("#")[0] ?? key).split("/").filter(Boolean).pop() ?? key
  const named = section !== "" ? section : page.replace(/\.[a-z0-9]+$/i, "")
  const words = named.replace(/[-_]+/g, " ").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The tab's icon by what the screen is, as the Plan's Interface picks it. */
const screenIcon = (name: string): LucideIcon => {
  if (/setting/i.test(name)) return SettingsIcon
  if (/first|start|home/i.test(name)) return HomeIcon
  if (/guide|doc|readme/i.test(name)) return BookOpenIcon
  return MonitorIcon
}

type Side = "built" | "designed"

const SIDES: { id: Side; label: string; icon: ReactNode }[] = [
  { id: "designed", label: "Designed", icon: <PencilRulerIcon aria-hidden="true" /> },
  { id: "built", label: "Built", icon: <HammerIcon aria-hidden="true" /> },
]

/**
 * One screen: one picture at full width. With a built picture, a Designed / Built switch stands in
 * the tab row (Built first) before Open in card; without one the design stands alone, with nothing
 * under it. Under a built picture, one muted line only when the independent review
 * recorded a verdict or the capture needs a refresh. Size, theme, capture method and run stay in the
 * record.
 */
function ScreenPanel({
  screen,
  name,
  loadEvidence,
  onOpen,
}: {
  screen: WalkScreen
  name: string
  loadEvidence: LoadEvidence | undefined
  onOpen: ((artifact: string) => void) | undefined
}) {
  const slot = useActionSlot()
  // The caption stands under the figure card, as a diagram's does (Workflow model: Verify).
  const below = useContext(FigureBelow)
  const underCard = (node: ReactNode) => (below === null ? node : createPortal(node, below))
  const [side, setSide] = useState<Side>("built")
  const hasBuilt =
    screen.outcome === "captured" &&
    (Boolean(screen.built) || (Boolean(screen.file) && loadEvidence !== undefined))
  const built = hasBuilt && side === "built"
  const verdict = screen.verdict.trim() === "No comparison recorded." ? "" : screen.verdict.trim()
  const refresh = screen.stale ? `needs refresh · ${screen.staleReason ?? "the build changed"}` : ""
  // The design is an artifact the live page can open (a shared copy holds a still, and no host).
  const reference = artifactReferenceForScreen(screen.key)
  const open =
    onOpen !== undefined && !screen.image && screen.artifact?.kind === "html" && reference !== null
      ? () => onOpen(reference)
      : undefined
  // The row's end: the switch, and beside a built picture the way to the design's artifact (the
  // design's own preview card brings its Open in card itself).
  const actions = hasBuilt ? (
    <>
      <span className="rvw-side" data-testid="screen-side">
        <Segmented
          value={side}
          options={SIDES}
          onChange={setSide}
          label={`${name}: picture`}
          size="sm"
        />
      </span>
      {built && open !== undefined ? <PreviewActions name={name} meta={[]} onCard={open} /> : null}
    </>
  ) : null
  return (
    <div className="rvw-shot" data-testid="screen-compare" data-side={built ? "built" : "designed"}>
      {actions === null
        ? null
        : slot === null
          ? actions
          : slot.shown && slot.element !== null
            ? createPortal(actions, slot.element)
            : null}
      {!built ? (
        <DesignedScreen
          screen={screen}
          title={hasBuilt ? `Designed ${name}` : name}
          {...(open !== undefined ? { onOpen: open } : {})}
        />
      ) : screen.built ? (
        <ScreenImage src={screen.built} title={`Built ${name}`} />
      ) : loadEvidence ? (
        <BuiltScreen
          key={screen.file}
          screen={screen}
          load={loadEvidence}
          title={`Built ${name}`}
        />
      ) : null}
      {built && (verdict !== "" || refresh !== "")
        ? underCard(
            <p className="pl-cap" data-testid="screen-verdict">
              {refresh}
              {refresh !== "" && verdict !== "" ? " · " : null}
              {verdict !== "" ? <InlineMarkdown text={verdict} /> : null}
            </p>,
          )
        : null}
    </div>
  )
}

/**
 * Screens as the Plan's Interface draws them: one tab per screen led by its icon, the row ending in
 * the shown screen's actions. Every recorded size and theme keeps its own tab; each surface's
 * preferred capture stands first.
 */
export function ScreenTabs({
  screens,
  loadEvidence,
  onOpen,
}: {
  screens: readonly WalkScreen[]
  loadEvidence: LoadEvidence | undefined
  /** Open a designed artifact in the App, where the page can (the live Review). */
  onOpen?: ((artifact: string) => void) | undefined
}) {
  const leads = leadScreens(screens, loadEvidence)
  if (leads.length === 0) return null
  const captures = leads.flatMap(({ key, lead }) => [
    lead,
    ...screens.filter((screen) => screen.key === key && screen !== lead),
  ])
  return (
    <GalleryTabs
      named
      label="Interface"
      tabs={captures.map((lead) => {
        const name = nameOf(lead.key)
        return {
          id: encodeURIComponent(
            `${lead.key}:${lead.width}:${lead.height ?? ""}:${lead.theme}:${lead.run ?? ""}:${lead.file ?? ""}`,
          ),
          icon: icon(screenIcon(name)),
          label:
            screens.filter((screen) => screen.key === lead.key).length > 1
              ? `${name} · ${lead.width} · ${lead.theme}`
              : name,
          panel: (
            <ScreenPanel screen={lead} name={name} loadEvidence={loadEvidence} onOpen={onOpen} />
          ),
        }
      })}
    />
  )
}

// ---------------------------------------------------------------- the Acceptance test

/** The step's label and what it says: `**Plan ready.** The planner waits…`. */
export function stepLabel(text: string): { label: string; rest: string } {
  const bold = boldParts(text)
  if (bold === null)
    return { label: (text.split(/[.:]\s/)[0] ?? text).replace(/[`*_]/g, ""), rest: text }
  return { label: bold.label.replace(/[`*_]/g, "").replace(/[.:]$/, ""), rest: bold.rest.trim() }
}

/** A bug's step, `Before the fix <what shows the bug>; after the fix <what shows it gone>`, in its two halves. */
export function beforeAfter(text: string): { before: string; after: string } | null {
  const both = beforeAfterParts(text)
  return both === null
    ? null
    : {
        before: both.before.trim().replace(/\.$/, ""),
        after: both.after.trim().replace(/\.$/, ""),
      }
}

/** A recorded output: terminal text read from the task's records. */
function Output({ file, api, taskId }: { file: string; api: Api | undefined; taskId: string }) {
  const text = useQuery(
    () => (api === undefined ? Promise.resolve("") : api.record(taskId, file)),
    [api, taskId, file],
  )
  if (text.data === null || text.data === undefined)
    return (
      <p className="rvw-none">
        {text.error ? "The output could not be read." : "Reading the output…"}
      </p>
    )
  return (
    <pre className="rvw-term" data-testid="acceptance-output">
      {text.data}
    </pre>
  )
}

type Slot = {
  id: string
  /** The row's number when it is not its place in the list: a Done means point's own (the Plan's) number. */
  n?: number
  label: string
  icon: LucideIcon
  captions: string[]
  steps: AcceptanceRow[]
  /** The steps list under the evidence: a Done means point's rows, action then what passes. */
  stepList?: true
  /** A bug's point: each step shows its output before the fix and after it, inside the step. */
  bugSteps?: true
}

/**
 * The rows: a Done means point each (with its steps) when the Plan lists its test by point, else a
 * step each, or for a bug the test before the fix and after it.
 */
function slotsOf(acceptance: AcceptanceAsRun, bug: boolean): Slot[] {
  // A Plan whose points could not be read lists its steps: the rows never go missing under the heading.
  if (acceptance.points !== undefined && acceptance.points.length > 0)
    return acceptance.points.map((point) => ({
      id: `p${point.n}`,
      n: point.n,
      label: point.text,
      icon: CircleCheckIcon,
      captions: [],
      steps: point.steps,
      stepList: true as const,
      ...(bug && point.steps.some((step) => step.before !== undefined)
        ? { bugSteps: true as const }
        : {}),
    }))
  if (!bug)
    return acceptance.steps.map((step) => {
      const { label, rest } = stepLabel(step.text)
      return { id: step.id, label, icon: CircleCheckIcon, captions: [rest], steps: [step] }
    })
  const pairs = acceptance.steps.map((step) => {
    const { rest } = stepLabel(step.text)
    return { step, halves: beforeAfter(rest) }
  })
  // One line per step: its name, then what the bug shows before the fix or after it.
  const lines = (pick: "before" | "after") =>
    pairs.map(
      ({ step, halves }) =>
        `**${stepLabel(step.text).label}.** ${halves?.[pick] ?? stepLabel(step.text).rest}`,
    )
  return [
    {
      id: "before",
      label: "Before the fix",
      icon: BugIcon,
      captions: lines("before"),
      steps:
        acceptance.before?.steps ?? acceptance.steps.map((step) => ({ ...step, evidence: [] })),
    },
    {
      id: "after",
      label: "After the fix",
      icon: CircleCheckIcon,
      captions: lines("after"),
      steps: acceptance.steps,
    },
  ]
}

/** The Plan's acceptance test as it ran, a numbered row per step with its picture or terminal output. */
export function AcceptanceTabs({
  acceptance,
  pointsProven,
  bug,
  loadEvidence,
  api,
  taskId,
}: {
  acceptance: AcceptanceAsRun
  pointsProven: boolean
  bug: boolean
  loadEvidence: LoadEvidence | undefined
  api: Api | undefined
  taskId: string
}) {
  const slots = slotsOf(acceptance, bug)
  // What the baseline run recorded for a step (a bug's output before the fix).
  const beforeOf = (id: string) =>
    acceptance.before?.steps.find((step) => step.id === id)?.evidence ?? []
  const files = [
    ...new Set(
      slots.flatMap((slot) =>
        slot.steps.flatMap((step) =>
          [...(slot.bugSteps ? beforeOf(step.id) : []), ...step.evidence]
            .filter((item) => item.kind === "picture")
            .map((item) => item.file),
        ),
      ),
    ),
  ]
  const sources = useEvidenceSources(files, loadEvidence)
  if (slots.length === 0) return null
  const mode = acceptance.mode
  const passed = mode !== null || acceptance.judged === true
  // A step that proves two Done means points shows under each, marked with its id.
  const shared = new Set(
    (acceptance.points ?? [])
      .flatMap((point) => point.steps.map((step) => step.id))
      .filter((id, at, all) => all.indexOf(id) !== at),
  )
  const picturesOf = (slot: Slot): Picture[] =>
    slot.steps.flatMap((step) => {
      const draw = (items: AcceptanceRow["evidence"], before: boolean): Picture[] =>
        items
          .filter((item) => item.kind === "picture")
          .map((item) => ({
            src: sources.get(item.file) ?? BLANK,
            caption:
              step.action !== undefined
                ? `${step.id} · ${step.action.replace(/[`*_]/g, "")}`
                : stepLabel(step.text).label,
            run: (before ? acceptance.before?.run : acceptance.run) ?? "run",
            runLabel: before ? "Before the fix" : "The run that passed",
            mode: (before ? acceptance.before?.mode : mode) ?? "scripted",
            step: step.id,
          }))
      return slot.bugSteps
        ? [...draw(beforeOf(step.id), true), ...draw(step.evidence, false)]
        : draw(step.evidence, bug && slot.id === "before")
    })
  return (
    <>
      <NumberedRows
        testId="acceptance-rows"
        rows={slots.map((slot, index) => {
          const pictures = picturesOf(slot)
          // A bug's point shows each output inside the step it belongs to.
          const outputs = slot.bugSteps
            ? []
            : slot.steps.flatMap((step) => step.evidence.filter((e) => e.kind === "output"))
          const outputsOf = (items: AcceptanceRow["evidence"]) =>
            items
              .filter((e) => e.kind === "output")
              .map((item) => <Output key={item.file} file={item.file} api={api} taskId={taskId} />)
          return {
            key: slot.id,
            n: slot.n ?? index + 1,
            title: slot.stepList ? <InlineMarkdown text={slot.label} /> : slot.label,
            // The row says at a glance that it passed; a bug's "before the fix" row shows the bug.
            ...(passed && slot.id !== "before"
              ? {
                  tag: (
                    // A green check per passed row (Max, 10 November 2026): a grey icon said nothing.
                    // Plain, as the Workflow model draws it: the row's number already frames it.
                    <span className="dsc-tag rvw-pass" role="img" aria-label="Passed">
                      <CheckIcon
                        className="size-4"
                        aria-hidden="true"
                        style={{ color: "var(--ql-pass)" }}
                      />
                    </span>
                  ),
                }
              : {}),
            body: (
              <>
                {pictures.length > 0 ? (
                  <PictureViewer
                    pictures={pictures}
                    show={pictures.map((_, index) => index)}
                    large
                  />
                ) : null}
                {outputs.map((item) => (
                  <Output key={item.file} file={item.file} api={api} taskId={taskId} />
                ))}
                {slot.stepList ? (
                  <ol className="pl-ssteps rvw-ssteps" data-testid="point-steps">
                    {slot.steps.map((step) => (
                      <li key={step.id} className={slot.bugSteps ? "pl-bugstep" : undefined}>
                        <span className="ac">
                          <InlineMarkdown text={step.action ?? step.text} />
                          {shared.has(step.id) ? " " : null}
                          {shared.has(step.id) ? (
                            <span
                              className="pl-shared"
                              title="This step proves more than one point"
                            >
                              {step.id} · shared
                            </span>
                          ) : null}
                        </span>{" "}
                        {slot.bugSteps ? (
                          <>
                            <span className="bf" data-testid="step-before">
                              <b>Before the fix</b> <InlineMarkdown text={step.before ?? ""} />
                            </span>
                            {outputsOf(beforeOf(step.id))}
                            <span className="af" data-testid="step-after">
                              <b>After the fix</b> <InlineMarkdown text={step.expected ?? ""} />
                            </span>
                            {outputsOf(step.evidence)}
                          </>
                        ) : step.expected !== undefined && step.expected !== "" ? (
                          <span className="ex">
                            <InlineMarkdown text={step.expected} />
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : null}
                {slot.captions
                  .filter((caption) => caption !== "")
                  .map((caption) => (
                    <Caption key={caption}>
                      <InlineMarkdown text={caption} />
                    </Caption>
                  ))}
              </>
            ),
          }
        })}
      />
      {passed || pointsProven ? null : (
        <p className="rvw-how" data-testid="acceptance-how">
          No run has passed yet.
        </p>
      )}
    </>
  )
}
