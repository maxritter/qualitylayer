import { toast } from "sonner"
import type { AnsweredQuestion } from "../../core/task/question.ts"
import { FocusQuestion, type QuestionActions, useFocus } from "../FocusQuestion.tsx"
import type { TaskSurfaceProps } from "../interaction/props.ts"

function isAnsweredQuestion(saved: unknown): saved is AnsweredQuestion {
  if (!saved || typeof saved !== "object") return false
  const record = saved as Record<string, unknown>
  return typeof record.choice === "string" && typeof record.at === "number"
}

async function runSafely(
  reload: () => void,
  work: () => Promise<unknown>,
  propagate = false,
  inline = propagate,
): Promise<boolean> {
  try {
    await work()
    reload()
    return true
  } catch (error) {
    if (!inline) {
      toast.error(error instanceof Error ? error.message : "Could not save your answer")
    }
    if (propagate) throw error
    return false
  }
}

async function sendFocusAnswer(
  props: TaskSurfaceProps,
  asking: Extract<NonNullable<ReturnType<typeof useFocus>>, { kind: "asking" }> | null,
  answer: Parameters<QuestionActions["answer"]>[0],
  files: Parameters<QuestionActions["answer"]>[1],
) {
  try {
    const result = await props.api.answerQuestion(
      props.task.id,
      {
        id: asking?.question.id ?? "",
        ...(asking?.question.revision ? { revision: asking.question.revision } : {}),
        ...("more" in answer ? { more: { request: answer.request ?? "" } } : answer),
      },
      files,
    )
    props.reload()
    return isAnsweredQuestion(result.answered) ? result.answered : true
  } catch (error) {
    props.reload()
    throw error
  }
}

function buildFocusActions(
  props: TaskSurfaceProps,
  asking: Extract<NonNullable<ReturnType<typeof useFocus>>, { kind: "asking" }> | null,
): QuestionActions {
  const safely = (work: () => Promise<unknown>, propagate = false, inline = propagate) =>
    runSafely(props.reload, work, propagate, inline)
  const focusFn = props.api.focusQuestion
  return {
    answer: (answer, files) => sendFocusAnswer(props, asking, answer, files),
    answerRest: (members) =>
      safely(
        async () => {
          for (const member of members) {
            await props.api.answerQuestion(props.task.id, { id: member.id, choice: member.choice })
          }
        },
        false,
        true,
      ),
    ...(focusFn !== undefined
      ? { focus: (id: string) => safely(() => focusFn(props.task.id, id)) }
      : {}),
    cancel: () => safely(() => props.api.cancelMore(props.task.id)),
    change: (number, answer) =>
      safely(() => props.api.changeAnswer(props.task.id, { number, ...answer })),
  }
}

export function FocusTurn(props: TaskSurfaceProps & { presentation?: string | undefined }) {
  const focus = useFocus(props.task, props.view)
  if (focus === null || focus.kind === "approved") return null
  const asking = focus.kind === "asking" ? focus : null
  const actions = buildFocusActions(props, asking)
  return (
    <FocusQuestion
      task={props.task}
      focus={focus}
      doc={props.view}
      theme={props.theme}
      onOpenDoc={props.onOpenDoc}
      actions={actions}
      artifactTask={{ id: props.task.id, api: props.api }}
      onOpenArtifact={props.onOpen}
      nativePresentation={props.presentation}
    />
  )
}
