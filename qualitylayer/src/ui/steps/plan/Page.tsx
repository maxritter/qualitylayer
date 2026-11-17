// The Plan step's page of a task: the decided design the person approves before any code. It draws
// what a person can see or act on first (Workflow model: Plan): the header with one size chip and the
// Summary as bullets, Done means as numbered rows that open to the steps that prove each point, Scope
// as two columns, the Diagrams and the Interface as tabs, and every other section as the document
// writes it (Problem, Approach, Rollout ...); then one group of folds (Decided with you, Decisions made
// for you, Prerequisites, Reviews), the Technical part of closed folds for engineers and the file row
// that opens the whole file in the Reader. A bug's Done means shows each step's Before the fix and
// After the fix. While a Your call is open the question layout takes the page; the approval stays in
// the shared header. The parts themselves are in views.tsx.

import { ListIcon } from "lucide-react"
import type { TaskDetail } from "../../api.ts"
import { approvesOutside } from "../../outside.ts"
import { metaLine } from "../../step-page/bands/Gist.tsx"
import { StepPage } from "../../step-page/StepPage.tsx"
import { bodyOf } from "../../step-page/sections.ts"
import type { ItemCard } from "../../step-page/state.ts"
import type { StepPageProps } from "../page-props.ts"
import { IntakeRow } from "../small-change-parts.tsx"
import { interfaceOf, planMeta, reviewMeta, reviewOf } from "./plan-model.ts"
import { PlanBelow, planGist, planViews } from "./views.tsx"

/** The header's meta line: bug fix, where the Plan stands (or a handback), the review. */
function planMetaLine(
  task: TaskDetail,
  state: StepPageProps["state"],
  reviews: string | undefined,
): string {
  const approve = state.plan?.approve
  const review = task.helpers.find((helper) => helper.id === "review-plan")
  const callsLeft = Object.values(state.plan?.asking ?? {}).filter(
    (card) => card.state === "open",
  ).length
  const where =
    task.handedBack !== undefined
      ? "handed back without a Plan"
      : planMeta({
          phase: approve?.phase ?? "writing",
          locked: approve?.locked ?? null,
          folding: approve?.folding,
          reviewState: review?.state,
          callsLeft,
          decision: approve?.decided?.decision,
          at: approve?.decided?.at,
          outside: approvesOutside(task),
          approvedBy: task.gate?.by === "outside" ? task.gate.outside : undefined,
        })
  const reviewView = reviews !== undefined ? reviewOf(bodyOf(reviews)) : null
  return metaLine(
    task.type === "bugfix" ? "bug fix" : undefined,
    where,
    task.gate?.reviewInputUnknown === true
      ? undefined
      : (reviewMeta(reviewView, task.gate?.reviewedBefore === true) ?? undefined),
  )
}

export function PlanStepPage({
  task,
  document,
  sections,
  state,
  mode,
  live,
  api,
  reload,
}: StepPageProps) {
  // The page's order is the file's: the schema writes the sections in the order the page draws them.
  const all = sections?.sections ?? []
  const sectionOf = (title: string) => all.find((s) => s.title === title)
  const acts = mode === "live" ? live : undefined
  const approve = state.plan?.approve
  const where = { state, mode, live: acts }
  const open = mode === "live" && !state.closed

  const gist = planGist(
    planMetaLine(task, state, sectionOf("Reviews")?.markdown),
    sectionOf,
    task.required,
  )

  // The one quiet row that says how the task runs stands before Done means, while the choice is real.
  const intakeRow =
    open && task.intake != null && task.handedBack === undefined ? (
      <IntakeRow
        key={`${task.intake.pick}:${task.intake.chosen}`}
        intake={task.intake}
        taskId={task.id}
        api={api}
        reload={reload}
      />
    ) : null

  const views = planViews({
    taskId: task.id,
    bug: task.type === "bugfix",
    sectionOf,
    where,
    commenting: open ? live : undefined,
    interfaceItems: interfaceOf(
      sectionOf("Interface")?.markdown ?? "",
      (name) => state.plan?.artifacts[name]?.title,
    ),
    intakeRow,
  })

  // An answered Plan call reopens as the question layout asks it again (Undo), while the Plan is open.
  const reopen =
    acts !== undefined && !approvesOutside(task) && approve?.phase === "open"
      ? (card: ItemCard) => acts.answer(card.id, null)
      : undefined
  const reviewsOpen =
    task.helpers.find((helper) => helper.id === "review-plan")?.state === "running" ||
    (approve?.locked ?? null) !== null

  return (
    <StepPage
      document={document}
      cut={sections}
      taskId={task.id}
      state={state}
      mode={mode}
      live={live}
      gist={gist}
      summaryIcon={ListIcon}
      sections={sections === null ? undefined : views}
      more={
        sections === null ? null : (
          <PlanBelow
            sections={all}
            sectionOf={sectionOf}
            taskId={task.id}
            file={document.file}
            reopen={reopen}
            reviewsOpen={reviewsOpen}
            where={where}
          />
        )
      }
    />
  )
}
