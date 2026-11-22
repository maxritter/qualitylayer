import { toast } from "sonner"
import { FLOW_STEPS, flowStepOf } from "../../core/flow.ts"
import { askedInAgent } from "../../core/task/sides.ts"
import { type Api, api as liveApi } from "../api.ts"
import { setDocumentFullSize, setDocumentReturn } from "../docs/mode.ts"
import { PLAN_TURN_READY } from "../docs/PlanTurn.tsx"
import type { TaskSurfaceProps } from "../interaction/props.ts"
import {
  autonomous,
  defaultDoc,
  fileOf,
  resumeCommand,
  stepPhase,
  stepView,
  viewedStep,
} from "../model.ts"
import { AgentTurn } from "../shell/AgentTurn.tsx"
import { StepQuiet } from "../steps/StepQuiet.tsx"
import { StepsAgentTurn } from "../steps/StepsAgentTurn.tsx"
import { STEPS_TURN_READY, StepTurn } from "../steps/StepTurn.tsx"
import { isFinalApprovalQuestion, isPlanApprovalQuestion } from "./ApproveCard.tsx"
import { cancelBatchMore, reopenQuestion, useBatchActions, useTurnData } from "./actions.ts"
import { FocusTurn } from "./FocusTurn.tsx"
import { GateTrack } from "./GateTrack.tsx"
import { HandedBack } from "./HandedBack.tsx"
import { foldingTurn } from "./projection.ts"
import { QuestionBatch } from "./QuestionBatch.tsx"

export function turnLayoutFor(view: string, api: Api = liveApi, _taskId?: string): boolean {
  if (api !== liveApi && api.currentTurnLayout !== true) return false
  const step = viewedStep(view)
  if (step === "plan") return PLAN_TURN_READY
  if (step === "implement" || step === "verify")
    // These controls come from TaskDetail; waiting for the first turn snapshot remounts
    // the need card and discards any note the person already typed.
    return STEPS_TURN_READY
  return false
}
export function YourTurn(props: TaskSurfaceProps) {
  return <CurrentTurn {...props} />
}

function CurrentTurn(props: TaskSurfaceProps) {
  const turn = useTurnData(props.task, props.api, props.version + (props.activity ?? 0))
  const send = useBatchActions(props.task, props.reload)
  const future = stepPhase(props.task, props.view) === "future"
  if (!future && !turnLayoutFor(props.view, props.api, props.task.id)) return null
  // The page holds only the waiting card: the Reader is one click away, and the "Your turn" pill (or
  // the phone's tab) brings the card back.
  const readDocument = () => {
    setDocumentReturn({ taskId: props.task.id, view: props.view })
    setDocumentFullSize(true)
  }
  const handback = props.task.items?.find((i) => i.kind === "handback")
  if (handback) {
    // A hand-back may have no Plan document: the card stands alone.
    const plan = fileOf(props.task, "plan")
    const written = props.task.files.some((file) => file.name === plan && file.exists)
    return (
      <HandedBack
        item={handback}
        task={props.task}
        onCopy={props.onCopy}
        media={null}
        file={plan}
        onRead={written ? readDocument : undefined}
      />
    )
  }
  if (props.task.archived || props.task.stage === "shipped" || props.task.stage === "abandoned")
    return <AgentTurn {...props} />
  const step = viewedStep(props.view)
  if (future) {
    const currentStep = flowStepOf(props.task.stage)
    const current =
      FLOW_STEPS.find((row) => row.id === flowStepOf(props.task.stage))?.label ?? props.task.stage
    return (
      <StepQuiet
        step={step ?? "verify"}
        kind="future"
        testId="future-step"
        line={
          step === "plan"
            ? `We’re still in ${current}. The Plan will appear here once the open questions are settled.`
            : step === "implement"
              ? `The task is still in ${current}. Build work appears here after you approve the Plan.`
              : "The built change will be checked here after implementation, then you review it and ship."
        }
        back={{
          label: current,
          open: () =>
            props.onOpen(currentStep ? stepView(props.task, currentStep) : defaultDoc(props.task)),
        }}
      />
    )
  }
  const receipt = props.task.answeredQuestions?.at(-1)
  if (
    props.task.question == null &&
    !turn?.questions.length &&
    receipt?.revision &&
    (receipt.delivered === false || Date.now() - receipt.at < 20_000) &&
    step === flowStepOf(props.task.stage)
  )
    return <FocusTurn {...props} />
  if (
    autonomous(props.task) &&
    (step !== flowStepOf(props.task.stage) ||
      (props.task.question == null && (turn?.questions.length ?? 0) === 0))
  )
    return <StepsAgentTurn {...props} />
  const questions =
    turn?.questions.filter(
      (q) => !isPlanApprovalQuestion(props.task, q) && !isFinalApprovalQuestion(props.task, q),
    ) ?? []
  const batched =
    turn?.batch && questions.some((q) => turn.batch?.links.some((link) => link.questionId === q.id))
  const single =
    props.task.question &&
    !isPlanApprovalQuestion(props.task, props.task.question) &&
    !isFinalApprovalQuestion(props.task, props.task.question)
      ? props.task.question
      : null
  if (batched && turn)
    return (
      <QuestionBatch
        turn={{ ...turn, questions }}
        terminalPreferred={askedInAgent(props.task, questions)}
        send={send}
        theme={props.theme}
        taskId={props.task.id}
        artifactTask={{ id: props.task.id, api: props.api }}
        onOpenDoc={props.onOpen}
        onOpenAt={props.onOpenDoc}
        planDoc={fileOf(props.task, "plan")}
        documentName={fileOf(props.task, "plan")}
        live={props.task.live?.signals ?? null}
        resume={resumeCommand(props.task)}
        onCancelMore={(batch, id) => cancelBatchMore(props.task.id, batch, id)}
        onReadDocument={readDocument}
        onChangeAnswer={(batch, answer) =>
          reopenQuestion(props.task.id, batch, answer, true).then(props.reload, (error) =>
            toast.error(error instanceof Error ? error.message : "Could not reopen the answer"),
          )
        }
      />
    )
  if (single !== null) {
    const presented = turn?.nativeQuestions?.[single.id]
    return (
      <FocusTurn {...props} presentation={typeof presented === "string" ? presented : undefined} />
    )
  }
  if (step === "plan") {
    if (turn && foldingTurn(turn))
      return (
        <div data-testid="turn-folding" data-open-items={props.task.openItems}>
          <AgentTurn {...props} />
        </div>
      )
    return <GateTrack {...props} />
  }
  if (step === "implement" || step === "verify") return <StepTurn {...props} />
  return <AgentTurn {...props} />
}
