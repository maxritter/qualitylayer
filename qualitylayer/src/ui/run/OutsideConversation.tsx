import { useCallback, useContext, useEffect, useState } from "react"
import type { NativeAgent } from "../../core/agents/ids.ts"
import type { ConversationSnapshot } from "../../core/conversation/types.ts"
import { Conversation } from "../agent-window/conversation/Conversation.tsx"
import type { NativeAnswer } from "../agent-window/conversation/Question.tsx"
import { useTerminalLayout } from "../agent-window/layout.tsx"
import type { TaskDetail } from "../api.ts"
import { OutsideConversationInterestContext } from "../hooks.ts"
import type { RunWindow } from "../run-context.tsx"

export type OutsideQuestionStatus = { session: string | null; pending: boolean }

const pendingQuestion = (question: ConversationSnapshot["question"]) =>
  question != null && question.availability !== "expired"

/** The native record stays read-only; only Claude's waiting hook accepts a picker answer. */
export function OutsideConversation({
  task,
  lead,
  name,
  onQuestion,
}: {
  task: TaskDetail
  lead: NonNullable<TaskDetail["outside"]> & { agent: NativeAgent }
  name: string
  onQuestion?(status: OutsideQuestionStatus): void
}) {
  const layout = useTerminalLayout()
  const stream = useContext(OutsideConversationInterestContext)
  const visible = layout === null || (layout.panel === "terminal" && layout.sidebarRect !== null)
  const register = stream?.register
  useEffect(() => {
    if (!visible || !lead.sessionId) return
    return register?.({ task: task.id, session: lead.sessionId })
  }, [visible, register, task.id, lead.sessionId])
  const [record, setRecord] = useState<{
    run: RunWindow
    question: ConversationSnapshot["question"]
  }>()
  const [terminalNote, setTerminalNote] = useState(false)
  const load = useCallback(
    async (after?: string) => {
      const query = after ? `?after=${encodeURIComponent(after)}` : ""
      const response = await fetch(
        `/api/agent-sessions/outside/${encodeURIComponent(task.id)}${query}`,
      )
      if (!response.ok)
        throw new Error("The outside conversation could not be read. Reopen this task to retry.")
      const body = (await response.json()) as { run: RunWindow; snapshot: ConversationSnapshot }
      setRecord({ run: body.run, question: body.snapshot.question })
      onQuestion?.({ session: lead.sessionId, pending: pendingQuestion(body.snapshot.question) })
      return body.snapshot
    },
    [task.id, lead.sessionId, onQuestion],
  )
  const answer = async (value: NativeAnswer) => {
    const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/picker`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...value, session: lead.sessionId }),
    })
    const result = await response.json()
    if (!response.ok || !result.ok)
      throw new Error(
        result.error?.message ?? "The answer could not be sent. Your choices are kept.",
      )
    setRecord((before) => (before ? { ...before, question: null } : before))
    onQuestion?.({ session: lead.sessionId, pending: false })
    return { status: "submitted" as const }
  }
  const run =
    record?.run ??
    ({
      id: `outside:${task.id}:${lead.sessionId}`,
      generation: 1,
      agent: lead.agent,
      purpose: { kind: "task", task: task.id },
      task: task.id,
      cwd: lead.folder,
      status: "running",
      startedAt: new Date(lead.since).toISOString(),
      updatedAt: "",
      idempotencyKey: "",
      startPhase: "ready",
      title: task.title,
      resumeLine: "",
    } satisfies RunWindow)
  const canAnswer =
    record?.question?.agent === "claude-code" && record.question.answerable && !task.archived
  return (
    <section className="q-outside-conversation" aria-label="Outside Chat conversation">
      {lead.agent === "codex" && pendingQuestion(record?.question ?? null) ? (
        <p className="q-outside-lead-line">Answer in Codex</p>
      ) : null}
      {terminalNote ? (
        <p role="status">
          Answer in {name}, outside the App. This outside session receives typed messages there.
        </p>
      ) : null}
      <Conversation
        outside
        run={run}
        agentName={name}
        load={load}
        on={visible}
        active
        started
        waiting={false}
        readOnly={!canAnswer}
        viewer={{
          type: "viewer-state",
          generation: 1,
          canType: canAnswer === true,
          canTakeControl: false,
          controller: false,
          canStop: false,
          canResize: false,
        }}
        busy={false}
        canInterrupt={false}
        canResume={false}
        send={() => false}
        onInterrupt={() => false}
        onTakeControl={() => {}}
        onResume={() => {}}
        onShowTerminal={() => setTerminalNote(true)}
        task={task.id}
        answerQuestion={canAnswer ? answer : undefined}
      />
    </section>
  )
}
