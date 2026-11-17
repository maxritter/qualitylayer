import { shellStatus } from "../../core/interaction-shell/status.ts"
import { agentName } from "../../core/live/liveness.ts"
import type { TaskSurfaceProps } from "../interaction/props.ts"

/** Only actionable recovery belongs in the body; activity, check progress included, lives in the header. */
export function AgentTurn({
  task,
  onOpenAgent,
}: Pick<TaskSurfaceProps, "task" | "onCopy" | "view" | "onOpenAgent">) {
  const status = shellStatus(task)
  if (status.state !== "stopped") return null
  const slice = task.slices.find((row) => row.n === task.live?.progress?.slice?.n)
  // One status line with the stop mark the agent chip uses; the Agent sidebar owns Continue and
  // the terminal prompt. With that sidebar closed the line carries one quiet link that opens it.
  const incomplete =
    (task.pages?.find((page) => page.step === "implement")?.problems.length ?? 0) > 0
  const done = slice && !incomplete ? slice.tasks.filter((row) => row.checked).length : null
  const where = slice ? ` in slice ${slice.n}` : ""
  return (
    <section
      className="ir-agent-turn ir-agent-stopped ir-agent-line"
      data-testid="interaction-agent-turn"
    >
      <i className="ir-agent-stop" aria-hidden="true" />
      <h2>{`${agentName(status.agent)} stopped${where}`}</h2>
      <span className="ir-agent-line-sub">
        {done !== null && slice ? `${done} of ${slice.tasks.length} tasks done · ` : ""}
        work kept
      </span>
      {onOpenAgent ? (
        <button
          type="button"
          className="q-btn sm quiet ir-agent-continue"
          data-testid="agent-continue"
          onClick={onOpenAgent}
        >
          Continue
        </button>
      ) : null}
    </section>
  )
}
