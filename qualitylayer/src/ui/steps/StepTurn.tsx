import { useState } from "react"
import { flattenItems, type Item, type ItemAnswer } from "../../core/items.ts"
import { FocusQuestion } from "../FocusQuestion.tsx"
import type { TaskSurfaceProps } from "../interaction/props.ts"
import { Disclosure } from "../kit/Fold.tsx"
import { agentInfo, autonomous as agentsWork, fileOf, pendingGate, viewedStep } from "../model.ts"
import { runsOutside } from "../outside.ts"
import { CodeRow } from "../review-workspace/CodeRow.tsx"
import { StepActions } from "../StepActions.tsx"
import { NeedCard } from "../status/NeedCard.tsx"
import { isFinalApprovalQuestion } from "../turn/ApproveCard.tsx"
import { OutsideBar } from "../turn/OutsideBar.tsx"
import { TurnLabel } from "../turn/TurnLabel.tsx"
import { FoundWhileChecking, StepItem } from "./StepItem.tsx"
import { StepReceipts } from "./StepReceipts.tsx"
import { StepsAgentTurn } from "./StepsAgentTurn.tsx"
import { ReviewDecisionQueue } from "./verify/DecisionQueue.tsx"
import "./steps.css"

export const STEPS_TURN_READY = true

type SavedAnswerMap = Record<string, { digest: string | undefined; answer: ItemAnswer }>

const isActionableItem = (item: Item): boolean => {
  if (item.state === "settled" || item.state === "sent") return false
  if (item.state === "chosen" && item.updated !== true) return false
  return item.uncounted !== true && item.kind !== "question"
}

const isItemBlocking = (item: Item, answers: Record<string, ItemAnswer>): boolean => {
  if (!item.blocking) return false
  return item.kind === "confirm"
    ? answers[item.id]?.kind !== "confirm"
    : answers[item.id] === undefined
}

const showsAgentTurn = (
  task: TaskSurfaceProps["task"],
  autonomous: boolean,
  waiting: boolean,
): boolean => {
  if (autonomous || !waiting || task.archived) return true
  return task.stage === "shipped" || task.stage === "abandoned"
}

function mergedAnswers(
  stepItems: readonly Item[],
  saved: SavedAnswerMap,
): Record<string, ItemAnswer> {
  const entries: [string, ItemAnswer][] = []
  for (const item of stepItems) {
    if (item.answer !== undefined && item.state !== "settled") entries.push([item.id, item.answer])
  }
  for (const item of stepItems) {
    const local = saved[item.id]
    if (local && local.digest === item.digest) entries.push([item.id, local.answer])
  }
  return Object.fromEntries(entries)
}

const taskTitleFor = (task: TaskSurfaceProps["task"], id: string): string | null =>
  task.slices.flatMap((slice) => slice.tasks).find((entry) => entry.id === id)?.title ?? null

const stepWithApproveDisabled = (
  step: TaskSurfaceProps["step"],
  disabled: boolean,
): TaskSurfaceProps["step"] =>
  disabled && step.primary?.kind === "approve"
    ? { ...step, primary: { ...step.primary, disabled: true } }
    : step

function FinalGateTurn({
  props,
  stepItems,
  answers,
  notes,
  needs,
  outside,
  blocked,
  onSaveAnswer,
}: {
  props: TaskSurfaceProps
  stepItems: readonly Item[]
  answers: Record<string, ItemAnswer>
  notes: readonly Item[]
  needs: NonNullable<NonNullable<TaskSurfaceProps["task"]["live"]>["needs"]>
  outside: boolean
  blocked: boolean
  onSaveAnswer: (item: Item, answer: ItemAnswer) => void
}) {
  const { task, live } = props
  const approvalStep = {
    ...props.step,
    secondary: { kind: "comment" as const, label: "Give feedback" },
  }
  const queue = stepItems.filter(
    (item) =>
      item.uncounted !== true && !["question", "done", "asked", "handback"].includes(item.kind),
  )
  return (
    <>
      {outside ? (
        <OutsideBar
          testId="review-approval-outside"
          label="Agent location"
          words={`${agentInfo(task.outside?.agent ?? task.session?.agent).name} stays outside the App. You can approve or give feedback here without moving the agent.`}
        />
      ) : null}
      <ReviewDecisionQueue
        key={`${task.id}:${task.gate?.id ?? "final"}`}
        items={queue}
        props={props}
        onAnswered={onSaveAnswer}
      >
        {(itemsReady) => (
          <StepActions
            step={stepWithApproveDisabled(approvalStep, blocked || !itemsReady)}
            busy={live.busy}
            items={[...stepItems]}
            answers={answers}
            onApprove={() => live.decide("approved")}
            onChanges={() => live.decide("changes")}
            onComment={() => props.onSidebar("comments")}
            onOpen={props.onOpen}
            onCopy={props.onCopy}
            {...(task.review?.approve
              ? {
                  ship: {
                    choices: task.review.approve,
                    ready: !blocked && itemsReady,
                    onShip: live.ship,
                  },
                }
              : {})}
          />
        )}
      </ReviewDecisionQueue>
      {notes.length ? <FoundWhileChecking items={[...notes]} /> : null}
      {needs.length ? (
        <Disclosure
          className="review-support"
          head={
            <>
              <b>Needs from the build</b>
              <span>{needs.length} unresolved</span>
            </>
          }
        >
          {needs.map((need) => (
            <NeedCard
              key={need.for}
              need={need}
              agent={agentInfo(task.session?.agent).name}
              taskTitle={taskTitleFor(task, need.for)}
              last={false}
              compact
              review
              onSet={(note) => live.setNeed(need.for, note)}
            />
          ))}
        </Disclosure>
      ) : null}
      <button
        type="button"
        className="q-link ir-step-doc"
        onClick={() => props.onOpenDoc(fileOf(task, "verify"))}
      >
        Read the pull request description
      </button>
      <Disclosure
        className="review-support"
        head={
          <>
            <b>Your saved answers</b>
            <span>Confirmations and feedback kept for the agent</span>
          </>
        }
      >
        <StepReceipts task={task} />
      </Disclosure>
    </>
  )
}

const turnHeading = (gate: boolean, itemCount: number): string => {
  if (!gate) return "What waits for you"
  if (itemCount === 0) return "Everything is settled"
  return `${itemCount} ${itemCount === 1 ? "thing" : "things"}, then approve`
}

export function StepTurn(props: TaskSurfaceProps) {
  const { task, live } = props
  const [reviewAnswers, saveReviewAnswer] = useState<SavedAnswerMap>({})
  const outside = runsOutside(task)
  const step = viewedStep(props.view)
  const autonomous = agentsWork(task) || step === "implement"
  const stepItems = flattenItems(task.items ?? []).filter(
    (item) =>
      (item.step === step || (step === "verify" && item.step === "implement")) &&
      item.children === undefined,
  )
  const answers = mergedAnswers(stepItems, reviewAnswers)
  const items = stepItems.filter(isActionableItem)
  // The judges' notes wait for nobody: folded under the decisions, counted nowhere.
  const notes = stepItems.filter(
    (item) => item.kind === "found" && item.uncounted === true && item.state === "open",
  )
  const needs = (task.live?.needs ?? []).filter((need) => need.state !== "resolved")
  const question =
    task.question && !isFinalApprovalQuestion(task, task.question) ? task.question : null
  const gate = pendingGate(task) === "final" && step === "verify"
  // At the final gate only an item that blocks locks Approve: the approval API settles the others
  // with it ("Approving accepts what is still open.").
  const blocked = gate && items.some((item) => isItemBlocking(item, answers))
  const waiting = items.length > 0 || question !== null || needs.length > 0 || gate

  if (showsAgentTurn(task, autonomous, waiting)) return <StepsAgentTurn {...props} />
  if (gate && question === null) {
    return (
      <FinalGateTurn
        props={props}
        stepItems={stepItems}
        answers={answers}
        notes={notes}
        needs={needs}
        outside={outside}
        blocked={blocked}
        onSaveAnswer={(item, answer) =>
          saveReviewAnswer((old) => ({ ...old, [item.id]: { digest: item.digest, answer } }))
        }
      />
    )
  }
  const agent = agentInfo(task.session?.agent)
  return (
    <section
      className="ir-step-turn"
      data-testid="steps-turn"
      id="your-turn"
      aria-label="Your turn"
      tabIndex={-1}
    >
      <TurnLabel />
      <header>
        <h2>{turnHeading(gate, items.length)}</h2>
        <p>
          {gate && !blocked
            ? "Each answer is kept for the agent. Approving accepts what is still open."
            : "Each answer is kept for the agent. Your approval comes after the items are settled."}
        </p>
      </header>
      {gate ? (
        <div className="ir-step-code" data-testid="review-turn-code">
          <CodeRow taskId={task.id} />
        </div>
      ) : null}
      {question !== null ? (
        <FocusQuestion
          task={task}
          doc={props.view}
          theme={props.theme}
          focus={{ kind: "asking", question, answered: task.answeredQuestions ?? [] }}
          onOpenDoc={props.onOpenDoc}
          actions={live.question}
        />
      ) : null}
      {items.map((item) => (
        <StepItem key={item.id} item={item} props={props} />
      ))}
      <FoundWhileChecking items={notes} />
      {needs.map((need) => (
        <NeedCard
          key={need.for}
          need={need}
          agent={agent.name}
          taskTitle={taskTitleFor(task, need.for)}
          last={false}
          compact
          review={step === "verify"}
          onSet={(note) => live.setNeed(need.for, note)}
        />
      ))}
      <footer>
        <StepActions
          step={stepWithApproveDisabled(props.step, blocked)}
          busy={live.busy}
          items={stepItems}
          answers={answers}
          onApprove={() => live.decide("approved")}
          onChanges={() => live.decide("changes")}
          onComment={() => props.onSidebar("comments")}
          onOpen={props.onOpen}
          onCopy={props.onCopy}
          {...(gate && task.review?.approve !== undefined
            ? {
                ship: {
                  choices: task.review.approve,
                  ready: !blocked,
                  onShip: live.ship,
                },
              }
            : {})}
        />
      </footer>
      <button
        type="button"
        className="q-link ir-step-doc"
        onClick={() => props.onOpenDoc(fileOf(task, step === "verify" ? "verify" : "implement"))}
      >
        Read the step's document
      </button>
      <StepReceipts task={task} />
    </section>
  )
}
