// The step's actions, where its status line used to be. The status lives in one place, the pill
// in the header, so this row holds only what the person can do on the step: Approve (with the
// final review's menu of ways to ship), Request changes, the Plan's diff, taking Verify's build as
// it stands, Open Review; the one short fact beside them ("Codex read the Plan"); what teammates
// advised; and a decision made in the agent's window. A step with none of these draws nothing.

import { ArrowLeftIcon, CheckIcon, CircleDashedIcon } from "lucide-react"
import { type DecidedElsewhere, type Item, type ItemAnswer, mainAction } from "../core/items.ts"
import type { ApproveChoices } from "../core/review/summary.ts"
import { useNow } from "./hooks.ts"
import { type StepAction, StepButtons, type StepMain } from "./kit/StepLine.tsx"
import { WhoMark } from "./kit/WhoMark.tsx"
import { initialsOf, type NextAction, type NextStep, type RunningRow, runView } from "./model.ts"

/**
 * A review the decision waits for, beside the locked Approve: its clock and estimate while it
 * runs, since when it is quiet, or that it is done. The pill says the step waits for you; this
 * says why Approve is not ready yet.
 */
function RunCard({ run, now }: { run: RunningRow; now: number }) {
  const view = runView(run, now)
  return (
    <li
      className="flex min-w-0 items-start gap-2.5 rounded-md border border-line bg-surface-2 px-3 py-2"
      data-testid="helper-run"
      data-state={view.state}
    >
      {view.state === "running" ? (
        <span className="mt-1" data-testid="run-spinner">
          <WhoMark who="agent" running label="running" />
        </span>
      ) : view.state === "done" ? (
        <CheckIcon className="mt-0.5 size-3.5 flex-none text-muted-foreground" aria-label="done" />
      ) : (
        <CircleDashedIcon
          className="mt-0.5 size-3.5 flex-none text-muted-foreground"
          aria-label="quiet"
        />
      )}
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
          <b className="font-semibold">{run.label}</b>
          {view.state === "running" && view.clock !== null ? (
            <span className="font-mono text-[12px] text-muted-foreground">
              running {view.clock}
            </span>
          ) : null}
          {view.state === "done" ? (
            <span className="font-mono text-[12px] text-muted-foreground">
              done{view.clock !== null ? ` ${view.clock}` : ""}
            </span>
          ) : null}
          {view.state === "quiet" ? (
            <span className="text-[12.5px] text-muted-foreground">quiet since {view.since}</span>
          ) : null}
          {view.state === "running" && view.left !== null ? (
            <span className="text-[12.5px] text-foreground" data-testid="helper-left">
              {view.left}
            </span>
          ) : null}
        </span>
        {view.state !== "done" && run.line !== null && run.line !== "" ? (
          <span
            className="truncate font-mono text-[12px] text-muted-foreground"
            title={run.line}
            data-testid="helper-line"
          >
            {run.line}
          </span>
        ) : null}
      </div>
    </li>
  )
}

type Props = {
  backToPlan?: () => void
  step: NextStep
  busy: boolean
  /** What needs you in this step, and the answers picked and not sent: the main button follows them. */
  items?: readonly Item[]
  answers?: Readonly<Record<string, ItemAnswer>>
  onApprove: () => void
  /** Send the decision as changes: the answers that ask for one travel as the saved drafts. */
  onChanges: () => void
  onOpen: (view: string) => void
  /** Open the Comments panel to write a comment. */
  onComment?: () => void
  /** The gate was decided in the agent's window while answers were unsent: where, when, how many. */
  elsewhere?: DecidedElsewhere
  /** Show what the agent changed in the Plan since the last review. */
  onDiff?: () => void
  /** The final review's Approve: one button with a menu of the ways to ship. QualityLayer never merges. */
  ship?: {
    choices: ApproveChoices
    /** Every item is settled: the button names what it does. */
    ready: boolean
    onShip: (choice: "pull-request" | "only" | "commands") => void
  }
  onCopy: (text: string, note: string) => void
}

/** "13:27" in the person's own clock. */
const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })

export function StepActions({
  step,
  busy,
  items,
  answers = {},
  onApprove,
  onChanges,
  onOpen,
  onComment,
  elsewhere,
  onDiff,
  ship,
  onCopy,
  backToPlan,
}: Props) {
  const asked = items !== undefined && items.length > 0 ? mainAction(items, answers) : null
  const act = (a: NextAction): StepAction => ({
    label: a.label,
    disabled: busy || ((a.kind === "changes" || a.kind === "approve") && a.disabled === true),
    title:
      a.kind === "comment"
        ? "Write what should change: press + beside a passage, select text, or add a general remark"
        : a.kind === "approve"
          ? a.title
          : undefined,
    onClick: () => {
      if (a.kind === "approve") onApprove()
      else if (a.kind === "changes") onChanges()
      else if (a.kind === "comment") onComment?.()
      else if (a.kind === "diff") onDiff?.()
      else if (a.kind === "open") onOpen(a.view)
      else if (a.kind === "copy") onCopy(a.text, a.note)
    },
  })

  // A shipped task is put away from the header's Archive: no second button for it here.
  const primary = step.primary?.kind === "archive" ? null : step.primary
  const secondaryAction = step.secondary?.kind === "archive" ? null : step.secondary
  let main: StepMain | undefined = primary !== null ? act(primary) : undefined
  // "Send N changes" is itself the request for changes: a second "Request changes…" beside it adds nothing.
  const sendsChanges = primary?.kind === "approve" && asked?.kind === "changes"
  const secondary: StepAction | null =
    secondaryAction !== null &&
    !(sendsChanges && (secondaryAction.kind === "comment" || secondaryAction.kind === "changes"))
      ? act(secondaryAction)
      : null
  // An answer that asks for a change turns Approve into Send N changes. That is a decision of its
  // own: Approve may be locked (a required answer is still to come), Send N changes is not.
  if (main !== undefined && primary?.kind === "approve" && asked?.kind === "changes") {
    main = {
      ...main,
      label: asked.label,
      disabled: busy,
      title:
        "Sends your answers to the agent. It changes what you asked and shows it to you again.",
      onClick: () => onChanges(),
    }
  }
  // The final approval is a menu: open the pull request, approve only, or copy the commands.
  if (
    ship !== undefined &&
    main !== undefined &&
    primary?.kind === "approve" &&
    asked?.kind !== "changes"
  ) {
    const { choices } = ship
    const branch = choices.branch ?? "the branch"
    main = {
      ...main,
      label: "Approve",
      opensMenu: false,
      keyOpensMenu: false,
      title: "Approves the change. The chat stays open for merge, deploy and tweaks",
      onClick: () => ship.onShip("only"),
      menu: [
        {
          label: "Approve",
          hint: "The change is right. The chat stays open for merge, deploy and tweaks.",
          disabled: main.disabled === true,
          onSelect: () => ship.onShip("only"),
        },
        {
          label: "Approve and open a pull request",
          hint: choices.pullRequest.ok
            ? `Pushes ${branch} and opens the pull request with the summary and the evidence. The agent watches CI. Needs gh.`
            : (choices.pullRequest.reason ?? "gh is not installed here"),
          disabled: !choices.pullRequest.ok || main.disabled === true,
          onSelect: () => ship.onShip("pull-request"),
        },
        {
          label: "Copy the git commands",
          disabled: main.disabled === true,
          hint: "Push the branch and open the pull request by hand",
          separate: true,
          // Approves without opening anything, and puts the commands where you can paste them.
          onSelect: () => {
            onCopy(choices.text, "Copied the git commands")
            ship.onShip("commands")
          },
        },
      ],
    }
  }
  const advice = step.advice ?? []
  // The reviews a decision waits for: the reason Approve is not ready yet. Any other work at
  // run is the pill's panel's.
  const runs = primary?.kind === "approve" ? (step.runs ?? []) : []
  const now = useNow(runs.length > 0)
  const hasButtons = main !== undefined || secondary !== null || backToPlan !== undefined
  // The Plan's gate keeps its one short fact beside Approve: what came back, who Approve waits for.
  // Anything else the old line said is the pill's now.
  const note =
    primary?.kind === "approve" &&
    step.title.startsWith("Waits for your approval") &&
    step.text !== step.fact
      ? step.text
      : ""
  if (!hasButtons && elsewhere === undefined && advice.length === 0) return null
  return (
    <div className="q-body pb-0" data-testid="step-actions">
      {hasButtons ? (
        <div className="q-acts">
          {backToPlan ? (
            <button
              type="button"
              className="mr-auto inline-flex items-center gap-2 rounded px-2 py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline"
              onClick={backToPlan}
            >
              <ArrowLeftIcon aria-hidden="true" className="size-4" />
              Back to Plan
            </button>
          ) : note !== "" ? (
            <span className="note" data-testid="step-note">
              {note}
            </span>
          ) : step.fact !== undefined ? (
            <span className="fact" data-testid="step-fact">
              <WhoMark who="check" />
              {step.fact}
            </span>
          ) : (
            <span className="mr-auto" />
          )}
          <StepButtons main={main} secondary={secondary} />
        </div>
      ) : null}
      {runs.length > 0 ? (
        <ul className="m-0 mt-2 grid list-none gap-1.5 p-0" data-testid="helper-runs">
          {runs.map((run) => (
            <RunCard key={run.key} run={run} now={now} />
          ))}
        </ul>
      ) : null}
      {elsewhere !== undefined || advice.length > 0 ? (
        <div className="q-acts-notes">
          {elsewhere !== undefined ? (
            <p className="m-0" data-testid="decided-elsewhere">
              {elsewhere.by === "policy"
                ? `Approved automatically in ${elsewhere.where} at ${clock(elsewhere.at)}.`
                : elsewhere.decision === "changes"
                  ? `You sent changes in ${elsewhere.where} at ${clock(elsewhere.at)}.`
                  : `You approved in ${elsewhere.where} at ${clock(elsewhere.at)}.`}{" "}
              {elsewhere.drafts === 0
                ? ""
                : elsewhere.drafts === 1
                  ? "Your unsent answer is kept as feedback."
                  : `Your ${elsewhere.drafts} unsent answers are kept as feedback.`}
            </p>
          ) : null}
          {advice.length > 0 ? (
            <ul className="m-0 grid list-none gap-1 p-0" data-testid="advice">
              {advice.map((line) => (
                <li
                  key={line.who}
                  className="flex items-center gap-2 text-[12.5px]"
                  data-testid="advice-line"
                >
                  <span className="grid size-5 flex-none place-items-center rounded-full border border-strong text-[9px] font-semibold text-muted-foreground">
                    {initialsOf(line.who)}
                  </span>
                  <span>{line.text}</span>
                  <span className="text-muted-foreground">· {line.when}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
