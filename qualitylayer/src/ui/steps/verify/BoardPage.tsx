// Verify as a status page (Workflow model: verify.html). The agents check and fix on their own, so the
// page shows a person, at a glance, what is happening: the rounds and points in the header, the four
// stages planned from the start as a board, a Code row into the changed files, and the pictures the
// verdicts cite. It asks nothing: a fix that needs the person comes as a question, and the working
// detail is the agents' file.

import { ClipboardCheckIcon, CodeIcon, ImageIcon } from "lucide-react"
import { useMemo, useRef } from "react"
import { useNow } from "../../hooks.ts"
import { Bands } from "../../step-page/bands/Bands.tsx"
import { YourMove } from "../../step-page/bands/YourMove.tsx"
import { FileRow } from "../../step-page/kit/FileRow.tsx"
import { readWholeFile } from "../../step-page/kit/read-file.ts"
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
import { verifyBoardHeader, verifyBoardStages } from "./board-view.ts"
import { CodeAccess } from "./CodeAccess.tsx"
import { picturesOf, VerifyPictures } from "./Pictures.tsx"
import { verifyView } from "./progress.ts"
import { ReviewCandidate } from "./ReviewCandidate.tsx"
import { useRecordedScreens } from "./use-recorded-screens.ts"

export function VerifyBoardPage(props: StepPageProps) {
  const { task, document: incomingDocument, sections: incomingSections, state, mode, live } = props
  const supporting = useStepSupporting()
  const root = useRef<HTMLDivElement | null>(null)
  useSelectionMark(root, state.closed || mode !== "live" ? undefined : live)
  const verifying = mode === "live" && task.stage === "verify"
  const now = useNow(verifying, 30_000)
  const incomingView = useMemo(
    () => verifyView(task, task.verifyLanes ?? [], state.verify?.proof.rows ?? [], now),
    [task, state.verify?.proof.rows, now],
  )
  const checkedAt = task.verifyActivity?.projectChecks?.at
  const observedCheck =
    checkedAt !== undefined && incomingView.started !== null && checkedAt >= incomingView.started
  const ready =
    verificationReady(task) ||
    observedCheck ||
    (state.verify?.proof.rows.some((row) => row.state !== "waiting") ?? false)
  const whole = (task.pages?.find((page) => page.step === "verify")?.problems.length ?? 0) === 0
  const steady = useSteadyStep(
    `${task.id}:verify`,
    { document: incomingDocument, view: incomingView },
    incomingSections,
    ready && whole,
  )
  const { document } = steady.doc
  const sections = steady.sections
  const view = { ...steady.doc.view, phase: incomingView.phase, now: incomingView.now }
  const stages = verifyBoardStages(view, mode !== "live" || stepIsWorking(task, state.at))
  const runs = useRecordedScreens(props)
  const gist = {
    title: STEP_TITLES.verify,
    actions: <StepTools doc={document} cut={sections} live={mode === "live" ? live : undefined} />,
    ...verifyBoardHeader(view),
  }

  const candidate =
    verifying && props.api?.reviewCandidates && props.api.selectReviewCandidate ? (
      <ReviewCandidate
        key={`${task.id}:${task.verifyActivity?.judgeRefusal?.at ?? ""}:${task.verifyActivity?.projectChecks?.checkout?.head ?? ""}`}
        id={task.id}
        reviewCandidates={props.api.reviewCandidates}
        selectReviewCandidate={props.api.selectReviewCandidate}
        reload={props.reload}
      />
    ) : null

  if (!ready && !steady.held && mode !== "plain")
    return (
      <>
        <YourMove>{supporting}</YourMove>
        {candidate}
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
              {candidate}
              <VerifyBoard stages={stages} receipt={task.verifyActivity?.projectChecks} />
            </PageSection>
            {mode === "live" ? (
              <PageSection title="Code" icon={<CodeIcon className="size-3.5" aria-hidden="true" />}>
                <CodeAccess
                  taskId={task.id}
                  checkout={task.verifyActivity?.projectChecks?.checkout}
                  changedCount={task.changedFiles?.length}
                />
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
