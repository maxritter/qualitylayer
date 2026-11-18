// Verify as the person's review (Workflow model: verify.html): the person comes back to review the code,
// look, try and ship. Everything is finished, so the page opens with Why in one line (a section like the
// others), the code review, the Diagrams as tabs, the Interface (built, or as designed) and Done means as it ran.
// What turns up while they review goes straight to a fix round, and the header shows it rechecking.
// After the approval the Landing and pull request cards stand first, unchanged.

import {
  BadgeCheckIcon,
  CheckIcon,
  CodeIcon,
  ImageIcon,
  LightbulbIcon,
  WorkflowIcon,
} from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef } from "react"
import { inReview } from "../../model.ts"
import { InlineMarkdown } from "../../reader/DocReader.tsx"
import { draftsOf } from "../../review-workspace/line-drafts.ts"
import { publishCodeSummary, useWorkspaceShown } from "../../review-workspace/open.ts"
import { readableFiles, viewedCount } from "../../review-workspace/ReviewWorkspace.tsx"
import { finalApproved } from "../../shell/lines.ts"
import { Bands } from "../../step-page/bands/Bands.tsx"
import type { Fact } from "../../step-page/bands/FactRow.tsx"
import { metaLine } from "../../step-page/bands/Gist.tsx"
import { SummaryPart } from "../../step-page/bands/SummaryPart.tsx"
import { CommentBlock } from "../../step-page/DocMarkdown.tsx"
import { FileRow } from "../../step-page/kit/FileRow.tsx"
import { readWholeFile } from "../../step-page/kit/read-file.ts"
import { TICKS_UP_TO } from "../../step-page/proof.ts"
import { useSelectionMark } from "../../step-page/StepPage.tsx"
import { StepTools } from "../../step-page/StepTools.tsx"
import { STEP_TITLES } from "../../step-page/titles.ts"
import { PullRequestTurn } from "../../turn/PullRequestTurn.tsx"
import { PageSection } from "../PageSection.tsx"
import type { StepPageProps } from "../page-props.ts"
import { RunKindMark } from "../plan/Pictures.tsx"
import { runKindsOf } from "../plan/plan-model.ts"
import { recheckLine } from "./approval-line.ts"
import { CodeRow } from "./CodeRow.tsx"
import { LandingCard } from "./LandingCard.tsx"
import { PullRequestCard } from "./PullRequestCard.tsx"
import { checkedWords } from "./progress.ts"
import { ReviewFolds } from "./ReviewFolds.tsx"
import { reviewRecord } from "./record.ts"
import { AcceptanceTabs, ChangedTabs, ScreenTabs } from "./Sections.tsx"
import { useWalkthrough } from "./use-walkthrough.ts"

export function ReviewStepPage(props: StepPageProps) {
  const live = props.mode === "live" && props.api !== undefined && inReview(props.task)
  const life = live && props.task.stage === "shipped" ? props.task.pullRequest : undefined
  // The header always comes first (Max, 10 November 2026): the pull request and landing cards
  // stand under it, above Why and Code, before and after the merge.
  const after = (
    <>
      {life !== undefined && props.api !== undefined ? (
        <div className="pr-top" data-testid="pull-request-top">
          <PullRequestTurn task={props.task} api={props.api} reload={props.reload} />
          <PullRequestCard life={life} />
        </div>
      ) : null}
      {live && props.api !== undefined ? (
        <LandingCard task={props.task} api={props.api} reload={props.reload ?? (() => {})} />
      ) : null}
    </>
  )
  return <ReviewPage {...props} afterHeader={after} />
}

const short = (revision: string): string => revision.slice(0, 7)

function ReviewPage(props: StepPageProps & { afterHeader: ReactNode }) {
  const { task, document: doc, sections, api, state, mode } = props
  const live = state.closed || mode !== "live" ? undefined : props.live
  const root = useRef<HTMLDivElement | null>(null)
  // Selected words open the quick field here as on the other step pages.
  useSelectionMark(root, live)
  const stamp = JSON.stringify([doc.markdown, task.gate?.revision])
  const view = useWalkthrough(mode === "live" ? api : undefined, task.id, stamp)
  const walk = view.data
  const workspace = useWorkspaceShown(task.id)
  const drafts = draftsOf(task).length
  useEffect(() => {
    if (workspace || mode !== "live") return
    publishCodeSummary(
      walk === null || !walk.counted
        ? null
        : {
            taskId: task.id,
            files: readableFiles(walk),
            read: viewedCount(task.id, walk),
            comments: drafts,
          },
    )
  }, [walk, task.id, drafts, workspace, mode])
  useEffect(() => (mode === "live" ? () => publishCodeSummary(null) : undefined), [mode])

  const record = useMemo(() => reviewRecord(sections, walk?.why.sentence), [sections, walk?.why])
  const points = walk?.points ?? []
  const passed = points.filter(
    (point) => point.status === "passed" || point.status === "confirmed by you",
  ).length
  // The Plan lists its Acceptance test by Done means point: the header says so, the test is grouped by point.
  const byPoint = walk?.acceptance.points !== undefined
  const merged = task.stage === "shipped" && task.pullRequest?.state === "merged"
  // From the moment the approval is saved: the header says Approved and nothing offers Approve again.
  const approved = finalApproved(task)
  // An approval the agents had not finished checking says what they had checked, and no more.
  const recheck = approved ? recheckLine(task.closing?.pass) : null
  const checked = task.reviewEvidence
  // What turned up while reviewing goes to a fix round: the header says it is being rechecked.
  const fixing = !approved && (task.reviewFix !== undefined || checked?.current === false)
  const writing = state.review?.ship.phase === "writing"
  const branch = walk?.ship.branch ?? task.branch
  const base = walk?.ship.base
  const where =
    branch !== null && branch !== undefined
      ? `branch ${branch}${base ? `, to ${base}` : ""}`
      : undefined
  const meta = approved
    ? // The mark beside the title says Approved: the line keeps the header's facts.
      (recheck ??
      metaLine(merged ? "in main" : undefined, branch ? `branch ${branch}` : undefined, undefined))
    : fixing
      ? metaLine("rechecking", where, "changed since the review")
      : writing
        ? metaLine("being written", where, "Approve opens when the review is ready")
        : metaLine("ready for your review", checkedWords(task.events) ?? undefined, where)
  const facts: Fact[] = []
  if (points.length > 0)
    facts.push(
      fixing && checked?.checkedCode
        ? {
            value: `${passed} of ${points.length}`,
            label: `passed at ${short(checked.checkedCode)}`,
          }
        : byPoint
          ? {
              // The Plan lists its test by Done means point: the same words and ticks as Verify.
              value: `${passed} of ${points.length}`,
              label: "Done means proven",
              ...(points.length <= TICKS_UP_TO
                ? {
                    ticks: points.map((point) =>
                      point.status === "passed" || point.status === "confirmed by you"
                        ? ("done" as const)
                        : ("todo" as const),
                    ),
                  }
                : { bar: { done: passed, total: points.length } }),
            }
          : {
              value: `${passed} of ${points.length}`,
              label: "points pass",
              bar: { done: passed, total: points.length },
            },
    )
  if (!fixing && walk !== null && walk.totals.commits > 0)
    facts.push({
      value: walk.totals.commits,
      label: walk.totals.commits === 1 ? "commit" : "commits",
    })
  const gist = {
    title: STEP_TITLES.verify,
    actions: (
      <>
        {approved ? (
          <span className="bd-read rvw-approved" data-testid="review-approved">
            <CheckIcon aria-hidden="true" />
            Approved
          </span>
        ) : null}
        <StepTools doc={doc} cut={sections} live={live} />
      </>
    ),
    meta,
    facts,
    ...(fixing
      ? {
          now: {
            id: "Fixing",
            label: task.reviewFix === "judge" ? "the recheck runs" : "what turned up",
          },
        }
      : {}),
  }
  const screens = walk?.screens ?? []
  const acceptance = walk?.acceptance
  // One run can mix scripted steps and real sessions: the heading never names one mode for both.
  const runKinds = acceptance ? runKindsOf(acceptance) : null
  const loadEvidence = live?.loadEvidence
  const walked = walk !== null
  const shown = {
    // Once merged the code stays in the pull request: no row to open it.
    code: mode === "live" && !merged && (walked || view.error !== null),
    changed: record.diagrams.length > 0,
    screens: screens.length > 0,
    acceptance: (acceptance?.steps.length ?? 0) > 0,
  }

  return (
    <div className="sp-page review-final" data-testid="step-page" data-step="verify" ref={root}>
      <Bands
        gist={gist}
        core={
          <>
            {props.afterHeader}
            {record.why !== "" ? (
              <SummaryPart
                title="Why"
                icon={LightbulbIcon}
                summary={
                  <CommentBlock raw={record.why} live={live}>
                    <p>
                      <InlineMarkdown text={record.why} />
                    </p>
                  </CommentBlock>
                }
              />
            ) : null}
            {shown.code ? (
              <PageSection title="Code" icon={<CodeIcon className="size-3.5" aria-hidden="true" />}>
                <CodeRow taskId={task.id} view={view} />
              </PageSection>
            ) : null}
            {shown.changed ? (
              <PageSection
                title="Diagrams"
                icon={<WorkflowIcon className="size-3.5" aria-hidden="true" />}
              >
                <ChangedTabs diagrams={record.diagrams} state={state} mode={mode} live={live} />
              </PageSection>
            ) : null}
            {shown.screens ? (
              <PageSection
                title="Interface"
                icon={<ImageIcon className="size-3.5" aria-hidden="true" />}
              >
                <ScreenTabs
                  screens={screens}
                  loadEvidence={loadEvidence}
                  onOpen={live?.openArtifact}
                />
              </PageSection>
            ) : null}
            {shown.acceptance && acceptance ? (
              <PageSection
                title="Done means"
                icon={<BadgeCheckIcon className="size-3.5" aria-hidden="true" />}
                action={
                  <RunKindMark
                    lead="proven in a"
                    kind={runKinds?.kind ?? null}
                    other={runKinds?.other}
                  />
                }
              >
                <AcceptanceTabs
                  acceptance={acceptance}
                  pointsProven={points.length > 0 && passed === points.length}
                  bug={task.type === "bugfix"}
                  loadEvidence={loadEvidence}
                  api={api}
                  taskId={task.id}
                />
              </PageSection>
            ) : null}
          </>
        }
        folds={<ReviewFolds {...props} />}
        more={
          <FileRow
            file={doc.file}
            text="the pull request description, as GitHub gets it"
            label="Read the record"
            onRead={() => {
              readWholeFile(task.id, doc.file)
            }}
          />
        }
      />
    </div>
  )
}
