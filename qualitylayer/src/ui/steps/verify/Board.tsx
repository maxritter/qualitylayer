// The Checks board (Workflow model, Verify: `.board`): the four stages planned from the start, each
// with its checks, who runs them and what they found, filling in as they finish. A stage still ahead
// is one quiet row with its condition. The Project checks disclosure keeps its recorded results and
// checkout together. Acceptance verdicts and approval use their own records.

import { BotIcon, CheckIcon, TriangleAlertIcon } from "lucide-react"
import type { VerifyActivity } from "../../../core/verify-activity.ts"
import { WhoMark } from "../../kit/WhoMark.tsx"
import { TitleWithState } from "../../step-page/kit/StateMark.tsx"
import { CheckEvidence } from "./CheckEvidence.tsx"
import type { BoardCheck, BoardStage, StageState } from "./progress.ts"

const STAGE_WORDS: Record<StageState, string> = {
  done: "done",
  running: "in work",
  waiting: "waiting",
  fail: "failed",
  skipped: "not run here",
}

function Mark({ state }: { state: BoardCheck["state"] }) {
  if (state === "done")
    return (
      <span className="vb-tm done" role="img" aria-label="done">
        <CheckIcon className="size-3" aria-hidden="true" />
      </span>
    )
  if (state === "running")
    return (
      <span className="vb-tm" role="img" aria-label="in work">
        <WhoMark who="agent" running />
      </span>
    )
  if (state === "fail")
    return (
      <span className="vb-tm fail" role="img" aria-label="failed">
        <TriangleAlertIcon className="size-3" aria-hidden="true" />
      </span>
    )
  return <span className="vb-tm" role="img" aria-label="waiting" />
}

type ProjectReceipt = VerifyActivity["projectChecks"]

function Check({
  check,
  stageRunning,
  receipt,
}: {
  check: BoardCheck
  stageRunning: boolean
  receipt: ProjectReceipt
}) {
  const inWork = check.state === "running"
  return (
    <li id={`vb-lane-${check.lane}`} data-testid="board-check" data-state={check.state}>
      <div className="vb-row">
        <Mark state={check.state} />
        <span className="vb-ln">
          <b>{check.name}</b>
          <span className="vb-who">{check.who}</span>
        </span>
        {check.result !== "" ? <span className="vb-lr">{check.result}</span> : null}
      </div>
      {check.lane === "checks" && receipt ? <CheckEvidence receipt={receipt} /> : null}
      {inWork && stageRunning && check.activity ? (
        <p className="vb-now" role="status">
          <BotIcon className="size-3.5" aria-hidden="true" />
          <span>
            <b>In work</b> · {check.activity}
          </span>
        </p>
      ) : null}
    </li>
  )
}

function Stage({ stage, receipt }: { stage: BoardStage; receipt: ProjectReceipt }) {
  // A stage ahead, or one that was not needed, says its condition (`not needed`) on its row.
  const ahead =
    (stage.state === "waiting" || stage.state === "skipped") && stage.checks.length === 0
  const checked = stage.segments.filter((segment) => segment === "d").length
  const failed = stage.segments.filter((segment) => segment === "f").length
  return (
    <div
      className={`vb-stage${stage.state === "waiting" ? " wait" : ""}${stage.state === "running" ? " live" : ""}`}
      data-testid="board-stage"
      data-state={stage.state}
    >
      <div className="vb-head" id={stage.n === 3 ? "vb-lane-fix" : undefined}>
        <span className="sp-no">
          <span className="sr-only">Stage </span>
          {stage.n}
        </span>
        <span className="vb-title">
          <TitleWithState
            state={
              stage.state === "running"
                ? "work"
                : stage.state === "skipped" || stage.state === "waiting"
                  ? "todo"
                  : stage.state
            }
            word={STAGE_WORDS[stage.state]}
          >
            {stage.name}
          </TitleWithState>
          {stage.who !== undefined ? <span className="vb-who">{stage.who}</span> : null}
        </span>
        {stage.segments.length > 1 ? (
          <span
            className="vb-segs"
            role="img"
            aria-label={`${checked} of ${stage.segments.length} checks done${failed ? `, ${failed} failed` : ""}`}
          >
            {stage.segments.map((segment, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: one mark per check, in order
              <i key={index} className={segment} />
            ))}
          </span>
        ) : ahead && stage.condition !== undefined ? (
          <span className="vb-cond">{stage.condition}</span>
        ) : null}
      </div>
      {stage.checks.length > 0 ? (
        <ul className="vb-checks">
          {stage.checks.map((check) => (
            <Check
              key={check.lane}
              check={check}
              stageRunning={stage.state === "running"}
              receipt={receipt}
            />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function VerifyBoard({
  stages,
  receipt,
}: {
  stages: readonly BoardStage[]
  receipt?: ProjectReceipt
}) {
  return (
    <div className="vb" data-testid="verify-board">
      {stages.map((stage) => (
        <Stage key={stage.n} stage={stage} receipt={receipt} />
      ))}
    </div>
  )
}
