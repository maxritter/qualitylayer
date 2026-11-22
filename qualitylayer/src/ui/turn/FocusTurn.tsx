import { toast } from "sonner"
import type { AnsweredQuestion } from "../../core/task/question.ts"
import { FocusQuestion, type QuestionActions, useFocus } from "../FocusQuestion.tsx"
import type { TaskSurfaceProps } from "../interaction/props.ts"

export function FocusTurn(props: TaskSurfaceProps & { presentation?: string | undefined }) {
  const focus = useFocus(props.task, props.view)
  if (focus === null || focus.kind === "approved") return null
  const asking = focus.kind === "asking" ? focus : null
  // `inline`: the question card shows a refusal on its own line (and keeps the answer), so no toast says it twice.
  const safely = async (work: () => Promise<unknown>, propagate = false, inline = propagate) => {
    try {
      await work()
      props.reload()
      return true
    } catch (error) {
      if (!inline)
        toast.error(error instanceof Error ? error.message : "Could not save your answer")
      if (propagate) throw error
      return false
    }
  }
  const actions: QuestionActions = {
    answer: async (answer, files) => {
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
        const saved = result.answered
        return saved &&
          typeof saved === "object" &&
          "choice" in saved &&
          typeof saved.choice === "string" &&
          "at" in saved &&
          typeof saved.at === "number"
          ? (saved as AnsweredQuestion)
          : true
      } catch (error) {
        props.reload()
        throw error
      }
    },
    answerRest: (members) =>
      safely(
        async () => {
          for (const member of members)
            await props.api.answerQuestion(props.task.id, { id: member.id, choice: member.choice })
        },
        false,
        true,
      ),
    ...(props.api.focusQuestion !== undefined
      ? {
          focus: (id: string) =>
            safely(() => props.api.focusQuestion?.(props.task.id, id) ?? Promise.resolve()),
        }
      : {}),
    cancel: () => safely(() => props.api.cancelMore(props.task.id)),
    change: (number, answer) =>
      safely(() => props.api.changeAnswer(props.task.id, { number, ...answer })),
  }
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
