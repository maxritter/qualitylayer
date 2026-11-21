import { CopyIcon } from "lucide-react"
import { agentName } from "../../../core/live/liveness.ts"
import { stagePrompt } from "../../../core/run/launch-spec.ts"
import type { TaskDetail } from "../../api.ts"
import type { ClipboardCopy } from "../../clipboard.ts"
import { Disclosure } from "../../kit/Fold.tsx"

export function ApprovedOutside({
  task,
  onRead,
  onCopy,
}: {
  task: TaskDetail
  onRead: () => void
  onCopy: ClipboardCopy
}) {
  const agent = agentName(task.start?.agent ?? null)
  const approvedAt = task.gate?.decided
  const approved =
    approvedAt === undefined
      ? "Plan approved"
      : `Plan approved ${new Date(approvedAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })}`
  const compact = task.start?.compact === true
  const compactLine = `Compact in ${agent}, then say “build here”.`
  const plan = task.implementStart
  const size = [
    plan && plan.slices > 0 ? `${plan.slices} ${plan.slices === 1 ? "slice" : "slices"}` : "",
    plan && plan.tasks > 0 ? `${plan.tasks} ${plan.tasks === 1 ? "task" : "tasks"}` : "",
  ]
    .filter(Boolean)
    .join(", ")
  const prompt =
    plan?.agents.find((choice) => choice.agent === "other")?.prompt ??
    stagePrompt("other", task.slug, "implement", task.answers)
  return (
    <section className="q-body max-w-[680px] text-[14px]" data-testid="implement-builds-next">
      <header className="grid gap-1.5">
        <h1 className="m-0 text-[22px] font-semibold leading-tight tracking-[-0.02em]">
          Ready to build
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-muted-foreground">
            {approved}
            {size !== "" ? ` · ${size}` : ""}
          </span>
          <button type="button" className="text-left underline underline-offset-4" onClick={onRead}>
            Read the Plan
          </button>
        </div>
      </header>
      <div className="grid gap-1">
        <h2 className="m-0 text-[15px] font-semibold">
          {compact ? "Compact, then build" : `Building next in ${agent}`}
        </h2>
        <p className="m-0">{compact ? compactLine : "The same conversation will build it."}</p>
      </div>
      <Disclosure
        head="Other ways to build"
        className="w-full border-t border-line pt-3"
        summaryProps={{ className: "w-fit font-medium" }}
      >
        <div className="grid gap-4 pt-3">
          <div className="grid gap-1">
            <h2 className="m-0 text-[15px] font-semibold">
              {compact ? "Build without compacting" : "Compact first"}
            </h2>
            <p className="m-0">{compact ? `Say “build here” in ${agent}.` : compactLine}</p>
          </div>
          <div className="grid min-w-0 gap-1">
            <h2 className="m-0 text-[15px] font-semibold">Another session or agent</h2>
            <p className="m-0">
              {compact
                ? "Paste this prompt in the other session."
                : `If ${agent} has started building, stop it before starting another session.`}
            </p>
            <div className="mt-1 flex flex-wrap items-start justify-between gap-2 rounded-md border border-line bg-sunken p-2.5 max-sm:flex-col">
              <code className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                {prompt}
              </code>
              <button
                type="button"
                className="q-btn sm shrink-0"
                onClick={() => onCopy(prompt, "Build prompt copied")}
              >
                <CopyIcon size={14} aria-hidden="true" /> Copy
              </button>
            </div>
          </div>
        </div>
      </Disclosure>
    </section>
  )
}
