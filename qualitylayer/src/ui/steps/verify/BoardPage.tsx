// Verify as a status page (Workflow model: verify.html). The agents check and fix on their own, so the
// page shows a person, at a glance, what is happening: the rounds and points in the header, the four
// stages planned from the start as a board, a Code row into the changed files, and the pictures the
// verdicts cite. It asks nothing: a fix that needs the person comes as a question, and the working
// detail is the agents' file.

import { ClipboardCheckIcon, CodeIcon, ImageIcon } from "lucide-react"
import { useMemo, useRef } from "react"
import type { VerificationRun } from "../../../core/review/screen-evidence.ts"
import { useNow, useQuery } from "../../hooks.ts"
import { Bands } from "../../step-page/bands/Bands.tsx"
import type { Fact } from "../../step-page/bands/FactRow.tsx"
import { metaLine } from "../../step-page/bands/Gist.tsx"
import { YourMove } from "../../step-page/bands/YourMove.tsx"
import { FileRow } from "../../step-page/kit/FileRow.tsx"
import { readWholeFile } from "../../step-page/kit/read-file.ts"
import { TICKS_UP_TO } from "../../step-page/proof.ts"
import { useSelectionMark } from "../../step-page/StepPage.tsx"
import { StepTools } from "../../step-page/StepTools.tsx"
import { useSteadyStep } from "../../step-page/steady.ts"
import { STEP_TITLES } from "../../step-page/titles.ts"
import { useStepSupporting } from "../context.ts"
import { PageSection } from "../PageSection.tsx"
import type { StepPageProps } from "../page-props.ts"
import { stepIsWorking, verificationReady } from "../readiness.ts"
import { StepQuiet } from "../StepQuiet.tsx"
import { VerifyBoard } from "./Board.tsx"
import { CodeAccess } from "./CodeAccess.tsx"
import { picturesOf, VerifyPictures } from "./Pictures.tsx"
import { spanWords, verifyView, whenWords } from "./progress.ts"
import { loadVerificationScreens } from "./screens-api.ts"

const clip = (text: string, at = 56) =>
  text.length <= at ? text : `${text.slice(0, at - 1).trimEnd()}…`

export function VerifyBoardPage(props: StepPageProps) {
  const {
    task,
    document: incomingDocument,
    sections: incomingSections,
    state,
    mode,
    live,
    api,
  } = props
  const supporting = useStepSupporting()
  const root = useRef<HTMLDivElement | null>(null)
  useSelectionMark(root, state.closed || mode !== "live" ? undefined : live)
  const verifying = mode === "live" && task.stage === "verify"
  const now = useNow(verifying, 30_000)
  const incomingView = useMemo(
    () => verifyView(task, task.verifyLanes ?? [], state.verify?.proof.rows ?? [], now),
    [task, state.verify?.proof.rows, now],
  )
  const ready =
    verificationReady(task) ||
    (state.verify?.proof.rows.some((row) => row.state !== "waiting") ?? false)
  const steady = useSteadyStep(
    `${task.id}:verify`,
    { document: incomingDocument, view: incomingView },
    incomingSections,
    ready,
  )
  const { document } = steady.doc
  const sections = steady.sections
  const view = { ...steady.doc.view, phase: incomingView.phase, now: incomingView.now }
  const stages =
    mode !== "live" || stepIsWorking(task, state.at)
      ? view.stages
      : view.stages.map((stage) => ({
          ...stage,
          state: stage.state === "running" ? ("waiting" as const) : stage.state,
          checks: stage.checks.map((check) =>
            check.state === "running" ? { ...check, state: "waiting" as const } : check,
          ),
          segments: stage.segments.map((segment) => (segment === "w" ? ("" as const) : segment)),
        }))
  const evidenceVersion = (task.evidence ?? [])
    .filter((file) => /(?:^|\/)screen-[a-f0-9]{24}\.png$/.test(file))
    .join("\n")
  const recorded = useQuery(
    (signal) =>
      api === undefined || mode !== "live"
        ? Promise.resolve(null)
        : loadVerificationScreens(api, task.id, signal),
    [api, task.id, mode, evidenceVersion],
  )
  const runs: readonly VerificationRun[] = recorded.data?.runs ?? []

  const { phase, points } = view
  const meta =
    phase === "verified"
      ? metaLine(
          view.started !== null && view.ended !== null
            ? `verified ${whenWords(view.started)} to ${whenWords(view.ended)}`
            : "verified",
          view.started !== null && view.ended !== null
            ? spanWords(view.ended - view.started)
            : undefined,
          undefined,
        )
      : phase === "decision"
        ? "fix rounds done · one decision for you, then your review"
        : metaLine(
            view.started !== null ? `started ${whenWords(view.started)}` : undefined,
            view.elapsed !== null ? `${view.elapsed} so far` : undefined,
            undefined,
          )
  // A Plan that lists its Acceptance test by Done means point: the count is the points proven, one tick
  // each (a bar past 24, where the ticks would wrap); a Plan with numbered steps counts judged points.
  const byPoint = view.byPoint
  const counted = byPoint || phase !== "checking" ? points.passed : points.judged
  const facts: Fact[] =
    phase === "decision" || points.total === 0
      ? []
      : [
          {
            value: `${counted} of ${points.total}`,
            label: byPoint
              ? "Done means proven"
              : phase === "checking"
                ? "points judged"
                : "points pass",
            ...(byPoint && view.ticks.length <= TICKS_UP_TO
              ? { ticks: view.ticks }
              : { bar: { done: counted, total: points.total } }),
            ...(view.roundWords !== "" ? { sub: view.roundWords } : {}),
          },
        ]
  const gist = {
    title: STEP_TITLES.verify,
    actions: <StepTools doc={document} cut={sections} live={mode === "live" ? live : undefined} />,
    meta,
    facts,
    ...(view.now !== null && phase !== "decision" && phase !== "verified"
      ? {
          now: {
            id: view.now.stage,
            label: clip(view.now.line),
            target: `vb-lane-${view.now.lane}`,
          },
        }
      : {}),
  }

  if (!ready && !steady.held && mode !== "plain")
    return (
      <>
        <YourMove>{supporting}</YourMove>
        <StepQuiet step="verify" kind={stepIsWorking(task) ? "writing" : "draft"} back={null} />
      </>
    )

  return (
    <div
      className="sp-page sp-enter"
      data-testid="step-page"
      data-step="verify"
      data-mode={mode}
      ref={root}
    >
      <Bands
        gist={gist}
        core={
          <>
            <PageSection
              title="Checks"
              icon={<ClipboardCheckIcon className="size-3.5" aria-hidden="true" />}
            >
              <VerifyBoard stages={stages} />
            </PageSection>
            {mode === "live" ? (
              <PageSection title="Code" icon={<CodeIcon className="size-3.5" aria-hidden="true" />}>
                <CodeAccess taskId={task.id} />
              </PageSection>
            ) : null}
            {picturesOf(runs, new Map()).files.length > 0 ? (
              <PageSection
                title="Pictures"
                icon={<ImageIcon className="size-3.5" aria-hidden="true" />}
              >
                <VerifyPictures runs={runs} loadEvidence={live?.loadEvidence} />
              </PageSection>
            ) : null}
          </>
        }
        // The file is written when the checks end; until then there is nothing to read.
        more={
          document.markdown === "" ? undefined : (
            <FileRow
              file={document.file}
              text="what was checked, as Copy gives it"
              label="Read the record"
              onRead={() => {
                readWholeFile(task.id, document.file)
              }}
            />
          )
        }
      />
    </div>
  )
}
