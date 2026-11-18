import {
  CheckIcon,
  ChevronDownIcon,
  FoldVerticalIcon,
  GitBranchIcon,
  HourglassIcon,
  LockIcon,
  MessagesSquareIcon,
  SquarePlusIcon,
  SquareTerminalIcon,
} from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { agentIdOf } from "../../core/interaction-shell/status.ts"
import { flattenItems, type Item } from "../../core/items.ts"
import { agentName } from "../../core/live/liveness.ts"
import type { Question } from "../../core/task/question.ts"
import type { TaskDetail } from "../api.ts"
import type { TaskSurfaceProps } from "../interaction/props.ts"
import { jumpToItem } from "../jump.ts"
import { useMainShortcut } from "../kit/StepLine.tsx"
import { WhoMark } from "../kit/WhoMark.tsx"
import { approvalLockReason, pendingGate } from "../model.ts"
import { approvesOutside } from "../outside.ts"
import { jumpId } from "../step-page/state.ts"
import { GetApproval } from "./GetApproval.tsx"
import { OutsideBar } from "./OutsideBar.tsx"
import { useTurnSnapshot } from "./projection.ts"

/** Old Plan approval transport is represented by the header action, not another question card. */
export function isPlanApprovalQuestion(task: TaskDetail, question: Question) {
  return (
    task.stage === "plan" &&
    question.gate !== "final" &&
    question.gate === task.gate?.target &&
    question.item === undefined &&
    pendingGate(task) !== null &&
    (question.gateId === undefined ||
      question.gateId === (task.gate?.id ?? String(task.gate?.opened)))
  )
}
export function isFinalApprovalQuestion(task: TaskDetail, question: Question) {
  return (
    task.gate?.target === "final" &&
    question.gate === "final" &&
    question.item === undefined &&
    (question.gateId === undefined ||
      question.gateId === (task.gate.id ?? String(task.gate.opened)))
  )
}
export function humanPlanItems(items: Item[]) {
  return flattenItems(items).filter(
    (item) =>
      item.step === "plan" &&
      !item.children &&
      !item.uncounted &&
      item.kind !== "question" &&
      item.kind !== "done" &&
      item.kind !== "note" &&
      item.kind !== "asked",
  )
}
export function humanQuestions(task: TaskDetail, questions: Question[] = []) {
  const all = new Map(questions.map((question) => [question.id, question]))
  if (task.question) all.set(task.question.id, task.question)
  return [...all.values()].filter((question) => !isPlanApprovalQuestion(task, question))
}

/** Scroll the Your call into view and give it focus. */
function jumpToCall(id: string): void {
  const el = document.getElementById(jumpId(id))
  if (el === null) {
    jumpToItem(id)
    return
  }
  for (let parent = el?.parentElement; parent; parent = parent.parentElement)
    if (parent instanceof HTMLDetailsElement) parent.open = true
  el?.scrollIntoView?.({ block: "center", behavior: "smooth" })
  el?.focus?.({ preventScroll: true })
}

/** The single Plan action bar. Feedback remains a draft until the guarded decision is saved. */
export function ApproveCard({
  items,
  busy,
  surface,
}: {
  items: Item[]
  busy: boolean
  surface: TaskSurfaceProps
}) {
  const turn = useTurnSnapshot(surface.task.id)
  const actionable = humanPlanItems(items)
  const open = actionable.filter((item) => item.state === "open")
  const changes = flattenItems(items).filter(
    (item) =>
      item.step === "plan" &&
      item.state === "chosen" &&
      (item.answer?.kind === "change" || item.answer?.kind === "fix"),
  ).length
  const questions = humanQuestions(surface.task, turn?.questions)
  const outside = approvesOutside(surface.task)
  const locked = surface.task.gate?.locked
  // Not ready to approve: something is left to answer, or the gate is not the person's to decide.
  const notReady =
    surface.task.original?.intact === false ||
    open.length > 0 ||
    questions.length > 0 ||
    pendingGate(surface.task) === null ||
    !!locked ||
    surface.task.gate?.settled === true
  const disabled = busy || surface.live.busy || notReady
  // A task's Plan asks only its Your calls: the link names them and scrolls to the first.
  const calls = open.filter((item) => item.call !== undefined)
  // One amber chip says the calls that are left; the Your turn chip beside the tabs stays out of its way.
  const callsLeft = calls.length > 0 && calls.length === open.length && questions.length === 0
  const reason = open.length
    ? open.length +
      " " +
      (open.length === 1 ? "choice still needs" : "choices still need") +
      " your answer."
    : questions.length
      ? "Answer the open question before approving."
      : approvalLockReason(surface.task)
  const review = surface.task.helpers.find((helper) => helper.id === "review-plan")
  const reviewPending =
    !!locked && review !== undefined && open.length === 0 && questions.length === 0
  const reviewLabel =
    review?.state === "running"
      ? "Reviewing Plan"
      : review?.state === "done"
        ? "Updating Plan"
        : "Review paused"
  const explanation = locked
    ? review?.state === "running"
      ? `${locked} Approve becomes available when the review finishes and its findings are addressed.`
      : review?.state === "done"
        ? `${locked} Approve becomes available when the planner addresses the review findings.`
        : locked
    : (reason ??
      (busy || surface.live.busy
        ? "Saving your decision."
        : "The Plan is not ready for approval yet."))
  // Approve and build here (12.9): the Review step's split button. Approve and build here approves at
  // once; Choose where to build opens Start the build, whose own button approves. Each says what it
  // does; the menu acts, it does not pick a mode. While the planner finishes its turn after the
  // approval, the button says so and the arrow still offers another way to build.
  const buildHere = surface.buildHere
  const here = buildHere?.available === true
  const waiting = buildHere?.waiting
  // A planner waiting in the person's terminal: its session leads; once it stopped, another session does.
  const terminal = buildHere?.route === "terminal"
  const approveLabel = changes
    ? "Send changes"
    : terminal
      ? here
        ? terminalLabel(buildHere)
        : ANOTHER
      : waiting
        ? "Waiting for turn"
        : here
          ? "Approve and build here"
          : buildHere
            ? "Choose where to build"
            : "Approve Plan"
  // What should change in the Plan is said by marking it: the quick field sends it to the planner.
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: another task clears this one's error
  useEffect(() => {
    setError(null)
  }, [surface.task.id])
  const decide = async (
    decision: "approved" | "changes",
    remark?: string,
    // A terminal planner's button does the first way to build: the compact command, then "build here".
    route: "here" | "compact" | "choose" = here ? (terminal ? "compact" : "here") : "choose",
  ) => {
    setSaving(true)
    setError(null)
    try {
      let saved: boolean | undefined
      if (decision === "approved" && route !== "choose" && here && surface.buildHere)
        saved = await surface.buildHere.start(
          remark,
          route === "compact" ? { compact: true } : undefined,
        )
      else if (surface.onPlanDecision) saved = await surface.onPlanDecision(decision, remark)
      else if (remark === undefined) {
        await surface.live.decide(decision)
        saved = true
      } else {
        await surface.api.gate(surface.task.id, decision, remark, surface.task.gate?.id)
        surface.reload()
        saved = true
      }
      if (saved === false) setError("Could not send your decision. Your draft is kept; try again.")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send your decision. Try again.")
    } finally {
      setSaving(false)
    }
  }
  useMainShortcut({
    label: approveLabel,
    disabled: disabled || saving,
    onClick: () => void decide(changes ? "changes" : "approved"),
  })
  return (
    <>
      {outside ? (
        <OutsideBar
          testId="plan-outside-context"
          label="Agent location"
          words={
            // A terminal planner (approved design, 4 November 2026): where it is, in a few words.
            terminal
              ? here
                ? "Waiting in your own agent"
                : "Stopped in your own agent"
              : `${agentName(surface.task.outside?.agent ?? agentIdOf(surface.task))} stays outside the App. You can approve here, or mark what should change, without moving the agent.`
          }
        />
      ) : null}
      <fieldset
        className={`ir-plan-approval${outside ? " ir-plan-approval-owner-outside" : ""}`}
        data-testid="plan-review-actions"
        aria-label="Plan review actions"
      >
        {error ? <span role="alert">{error}</span> : null}
        {callsLeft ? (
          <button
            type="button"
            className="ir-call-chip"
            data-testid="calls-left"
            title="Go to the first call"
            onClick={() => jumpToCall(calls[0]?.id ?? "")}
          >
            <WhoMark who="you" />
            {calls.length === 1 ? "1 call left" : `${calls.length} calls left`}
          </button>
        ) : null}
        {callsLeft && reason ? (
          <span id={"plan-approval-reason-" + surface.task.id} hidden>
            {reason}
          </span>
        ) : null}
        <GetApproval
          key={surface.task.id}
          task={surface.task.id}
          detail={surface.task}
          readPlan={() =>
            surface.api.doc(surface.task.id, "01-plan.md").then((value) => value.markdown)
          }
          disabled={disabled || saving}
          onSettled={surface.reload}
        />
        <span className="ir-plan-approve-group">
          {reviewPending ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  className="ir-plan-review-status"
                  aria-label={`Plan status: ${reviewLabel}`}
                  type="button"
                >
                  <WhoMark who="agent" running={review?.state === "running"} />
                  <span role="status">{reviewLabel}</span>
                </TooltipTrigger>
                <TooltipContent>{explanation} No action needed.</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : waiting ? (
            <span className="ir-plan-lock" role="status" data-testid="build-here-waiting">
              {waiting}
            </span>
          ) : !callsLeft && reason ? (
            <span
              className="ir-plan-lock"
              id={`plan-approval-reason-${surface.task.id}`}
              title={locked || undefined}
            >
              {reason}
            </span>
          ) : null}
          {!reviewPending ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <fieldset
                      className={`ir-plan-approve-target${buildHere && !changes ? " review-approval-split" : ""}`}
                      tabIndex={disabled || saving ? 0 : undefined}
                      aria-label={
                        disabled || saving ? "Why Approve Plan is unavailable" : undefined
                      }
                    />
                  }
                >
                  <Button
                    variant={disabled || saving ? "outline" : "default"}
                    disabled={disabled || saving}
                    aria-describedby={
                      reason ? "plan-approval-reason-" + surface.task.id : undefined
                    }
                    onClick={() => {
                      if (!disabled && !saving) void decide(changes ? "changes" : "approved")
                    }}
                  >
                    {waiting && !terminal ? (
                      <HourglassIcon size={14} aria-hidden="true" />
                    ) : notReady ? (
                      <LockIcon size={14} aria-hidden="true" />
                    ) : terminal ? (
                      here ? (
                        <SquareTerminalIcon size={14} aria-hidden="true" />
                      ) : (
                        <SquarePlusIcon size={14} aria-hidden="true" />
                      )
                    ) : (
                      <CheckIcon size={14} aria-hidden="true" />
                    )}
                    {approveLabel}
                  </Button>
                  {buildHere && !changes && terminal ? (
                    <TerminalWaysToBuild
                      disabled={disabled || saving}
                      buildHere={buildHere}
                      onBuild={(compact) =>
                        void decide("approved", undefined, compact ? "compact" : "here")
                      }
                      onChoose={() => void decide("approved", undefined, "choose")}
                    />
                  ) : buildHere && !changes ? (
                    <PlanApprovalOptions
                      disabled={(disabled && !waiting) || saving}
                      buildHere={buildHere}
                      onChoose={() => void decide("approved", undefined, "choose")}
                    />
                  ) : null}
                </TooltipTrigger>
                {disabled || saving ? (
                  <TooltipContent>{waiting ?? explanation}</TooltipContent>
                ) : null}
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </span>
      </fieldset>
    </>
  )
}

const ANOTHER = "Another session or agent…"
// "In my own agent" (Max, 11 November 2026): the planner may run in a terminal, an IDE or an agent app.
const terminalLabel = (buildHere: NonNullable<TaskSurfaceProps["buildHere"]>) =>
  buildHere.lead ? `Build in ${buildHere.lead} · your agent` : "Build in your own agent"

/**
 * The arrow beside the Plan's approval for a planner in the person's terminal: the three ways to
 * build, the same on every surface. Its two terminal ways are disabled, with the reason, once that
 * planner no longer waits.
 */
function TerminalWaysToBuild({
  disabled,
  buildHere,
  onBuild,
  onChoose,
}: {
  disabled: boolean
  buildHere: NonNullable<TaskSurfaceProps["buildHere"]>
  onBuild: (compact: boolean) => void
  onChoose: () => void
}) {
  const free = buildHere.available
  const gone = `${(buildHere.reason ?? "Not available").replace(/\.$/, "")}`
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button disabled={disabled} aria-label="Ways to build" />}>
        <ChevronDownIcon size={14} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        collisionPadding={8}
        className="review-approval-menu min-w-72"
      >
        <DropdownMenuItem disabled={!free} onClick={() => onBuild(true)}>
          <FoldVerticalIcon size={14} aria-hidden="true" />
          <span className="review-approval-copy">
            Build here, from the Plan
            <small>
              {free ? "/compact, then “build here”; the Plan’s files carry everything" : gone}
            </small>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!free} onClick={() => onBuild(false)}>
          <SquareTerminalIcon size={14} aria-hidden="true" />
          <span className="review-approval-copy">
            Keep this conversation
            <small>{free ? "Every build call reads the planning talk again" : gone}</small>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onChoose}>
          <SquarePlusIcon size={14} aria-hidden="true" />
          <span className="review-approval-copy">
            {ANOTHER}
            <small>Any agent or model · prompt to paste</small>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The arrow beside the Plan's approval: the other way to build. With Build here available it opens
 * Start the build; without it, it says why the planning session cannot build.
 */
function PlanApprovalOptions({
  disabled,
  buildHere,
  onChoose,
}: {
  disabled: boolean
  buildHere: NonNullable<TaskSurfaceProps["buildHere"]>
  onChoose: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button disabled={disabled} aria-label="Other ways to build" />}>
        <ChevronDownIcon size={14} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        collisionPadding={8}
        className="review-approval-menu min-w-72"
      >
        {buildHere.available ? (
          <DropdownMenuItem onClick={onChoose}>
            <GitBranchIcon size={14} aria-hidden="true" />
            <span className="review-approval-copy">
              Choose where to build
              <small>
                Opens Start the build: another agent or model, a fresh session or your own agent.
                You approve there.
              </small>
            </span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <MessagesSquareIcon size={14} aria-hidden="true" />
            <span className="review-approval-copy">
              Approve and build here
              <small>{`${(buildHere.reason ?? "Not available").replace(/\.$/, "")}.`}</small>
            </span>
          </DropdownMenuItem>
        )}
        {buildHere.available && buildHere.lead ? (
          <p className="max-w-72 px-2 pt-1 pb-1.5 text-xs text-muted-foreground" role="note">
            Build here continues {buildHere.lead} with its history and settings.
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
