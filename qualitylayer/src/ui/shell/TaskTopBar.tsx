import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CoinsIcon,
  FolderOpenIcon,
  Trash2Icon,
} from "lucide-react"
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { TaskCost } from "../../core/cost/labels.ts"
import { type FlowStepId, flowStepOf } from "../../core/flow.ts"
import { flattenItems } from "../../core/items.ts"
import type { TurnSnapshot } from "../../interaction/contracts.ts"
import { CostTable } from "../CostPanel.tsx"
import { setDocumentFullSize, setDocumentRecord } from "../docs/mode.ts"
import { useQuery, useViewportWidth } from "../hooks.ts"
import type { TaskSurfaceProps } from "../interaction/props.ts"
import { offersHostActions } from "../machines/framed.ts"
import {
  autonomous,
  pendingGate,
  personVerify,
  type StageTab,
  stepView,
  viewedStep,
} from "../model.ts"
import { ProjectOrigin, useProjectFacts } from "../sidebar/look-context.tsx"
import { LandingActions, landingActionsShow } from "../steps/verify/LandingActions.tsx"
import { ReviewApproval } from "../steps/verify/ReviewApproval.tsx"
import { ApproveCard, humanPlanItems, isPlanApprovalQuestion } from "../turn/ApproveCard.tsx"
import { foldingTurn, useTurnSnapshot } from "../turn/projection.ts"
import { ShellApiContext } from "./context.ts"
import { finalApproved } from "./lines.ts"
import { StepTrack } from "./StepTrack.tsx"
import { type MenuPanel, showTaskFolder, TaskMoreMenu } from "./TaskMoreMenu.tsx"
import { FOLD, useActionFold } from "./useActionFold.ts"

/** The widest window whose top bar is the shell's one row (shell.css, 480 px). */
export const PHONE_BAR = 480

export function TaskActions({
  task,
  api,
  onCopy,
  reload,
  onDeleted,
  cost: knownCost,
  version,
  controls = true,
  host,
  onArchive,
  onOpenAgent,
  utilities,
  directUtilities,
}: Pick<
  TaskSurfaceProps,
  "task" | "api" | "onCopy" | "reload" | "planning" | "onDeleted" | "version" | "onOpenAgent"
> & {
  cost?: TaskCost | null
  controls?: boolean
  host?: HTMLElement | null
  onArchive?: () => void | Promise<void>
  /**
   * A surface's own icon utilities (a Chat's View changes), drawn first in the utilities group and
   * folded with it at FOLD.utilities; the surface offers the same commands in its More menu then.
   */
  utilities?: ReactNode
  directUtilities?: ReactNode
}) {
  type Panel = MenuPanel
  const focusTrigger = useRef<HTMLElement | null>(null)
  const focusLabel = useRef<string | null>(null)
  const actionButtons = useRef<HTMLDivElement | null>(null)
  const [opened, setOpened] = useState<{ task: string; panel: Panel } | null>(null)
  const panel = opened?.task === task.id ? opened.panel : null
  const setPanel = useCallback(
    (next: Panel | null, opener?: HTMLElement) => {
      if (next !== null) {
        // The button that was pressed: a click does not focus a button in every browser, so the
        // page's focus can be elsewhere.
        focusTrigger.current =
          opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
        focusLabel.current =
          focusTrigger.current?.dataset.testid ??
          focusTrigger.current?.getAttribute("aria-label") ??
          null
      }
      setOpened(next === null ? null : { task: task.id, panel: next })
    },
    [task.id],
  )
  const [busy, setBusy] = useState(false)
  const menuTrigger = useRef<HTMLButtonElement | null>(null)
  const returnToMenu = useRef(false)
  // Cost waits in More when the header needs room for its title.
  const viewport = useViewportWidth()
  const phone = viewport <= PHONE_BAR
  const foldLevel = useActionFold(host, phone, actionButtons)
  const fold = foldLevel >= FOLD.utilities
  const contextFolded = foldLevel >= FOLD.actions
  const lifecycleFolded = foldLevel >= FOLD.lifecycle
  const changesOverflow = false
  useEffect(() => {
    focusTrigger.current = null
    focusLabel.current = null
    returnToMenu.current = false
    setPanel(null)
  }, [setPanel])
  const costRead = useQuery(
    () => (knownCost !== undefined || panel !== "cost" ? Promise.resolve(null) : api.cost(task.id)),
    [task.id, knownCost !== undefined, version, panel],
  )
  // The page may already own this read; use it when the person opens the cost panel.
  const cost = knownCost === undefined ? costRead : { ...costRead, data: knownCost, error: null }
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
      reload()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not finish. Try again.")
    } finally {
      setBusy(false)
    }
  }
  const openFromMenu = (next: Panel) => {
    returnToMenu.current = true
    setPanel(next)
  }
  const archive = () =>
    onArchive
      ? onArchive()
      : run(async () => {
          await api.archive(task.id, !task.archived)
          if (!task.archived) onDeleted?.()
        })
  const controlButtons = controls ? (
    <div
      ref={actionButtons}
      className="ir-task-actions flex flex-wrap items-center justify-end gap-2"
      data-testid="task-header-actions"
      data-fold={foldLevel}
    >
      {phone ? null : <span className="ir-task-group-divider" aria-hidden="true" />}
      {/* One order on every header: labelled actions, icon utilities, More, Archive and Delete. */}
      {contextFolded ? null : (
        <button
          type="button"
          className="q-btn quiet sm ir-task-icon"
          title="Open task cost details"
          aria-label="Cost"
          aria-haspopup="dialog"
          aria-expanded={panel === "cost"}
          onClick={(event) => setPanel("cost", event.currentTarget)}
        >
          <CoinsIcon size={16} aria-hidden="true" />
          <span className="ir-task-tool-label">Cost</span>
        </button>
      )}
      {directUtilities}
      {phone || fold ? null : (
        <>
          {contextFolded ? null : <span className="ir-task-sep" aria-hidden="true" />}
          {utilities}
          {offersHostActions() ? (
            <button
              type="button"
              className="q-btn quiet sm ir-task-icon"
              aria-label="Show task folder"
              title="Show task folder"
              onClick={() => void showTaskFolder(api, task.id)}
            >
              <FolderOpenIcon size={16} aria-hidden="true" />
            </button>
          ) : null}
        </>
      )}
      <TaskMoreMenu
        task={task}
        api={api}
        busy={busy}
        phone={phone}
        changesOverflow={changesOverflow}
        fold={fold}
        lifecycleFolded={lifecycleFolded}
        contextFolded={contextFolded}
        triggerRef={menuTrigger}
        onCopy={onCopy}
        onPanel={openFromMenu}
        onArchive={() => void archive()}
        onAgent={onOpenAgent}
      />
      {phone || lifecycleFolded ? null : <span className="ir-task-sep" aria-hidden="true" />}
      {phone || lifecycleFolded ? null : (
        <button
          type="button"
          className="q-btn quiet sm ir-task-icon ir-task-archive"
          aria-label={task.archived ? "Restore" : "Archive"}
          title={task.archived ? "Restore" : "Archive"}
          disabled={busy}
          onClick={() => void archive()}
        >
          {task.archived ? (
            <ArchiveRestoreIcon size={16} aria-hidden="true" />
          ) : (
            <ArchiveIcon size={16} aria-hidden="true" />
          )}
        </button>
      )}
      {phone || lifecycleFolded ? null : (
        <span className="ir-task-delete">
          <button
            type="button"
            className="q-btn quiet sm ir-task-icon"
            aria-label="Delete…"
            title="Delete…"
            disabled={busy}
            onClick={(event) => setPanel("delete", event.currentTarget)}
          >
            <Trash2Icon size={16} aria-hidden="true" />
          </button>
        </span>
      )}
    </div>
  ) : null
  return (
    <>
      {host ? createPortal(controlButtons, host) : controlButtons}
      <Dialog
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open) setPanel(null)
        }}
      >
        <DialogContent
          // The dialog's one action takes the first focus; the others open on their first control.
          finalFocus={() => {
            let target: HTMLElement | null | undefined
            if (returnToMenu.current) {
              returnToMenu.current = false
              target = menuTrigger.current
            } else if (focusTrigger.current?.isConnected) {
              target = focusTrigger.current
            } else if (focusLabel.current !== null) {
              target = Array.from(
                actionButtons.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
              ).find(
                (button) =>
                  button.dataset.testid === focusLabel.current ||
                  button.getAttribute("aria-label") === focusLabel.current,
              )
            }
            focusTrigger.current = null
            focusLabel.current = null
            // The opener folded into More while the dialog was open: More is where it went.
            return target ?? menuTrigger.current ?? true
          }}
          className={
            panel === "cost"
              ? "ir-cost-dialog max-h-[calc(100dvh-2rem)] overflow-y-auto"
              : undefined
          }
        >
          <DialogHeader>
            <DialogTitle>{panel === "cost" ? "What it cost" : "Delete this task?"}</DialogTitle>
          </DialogHeader>
          {panel === "cost" ? (
            cost.error ? (
              <p role="alert">
                Could not read the cost.{" "}
                <button type="button" className="q-link" onClick={cost.reload}>
                  Try again
                </button>
              </p>
            ) : cost.data ? (
              <CostTable
                cost={cost.data}
                live={
                  task.archived || task.stage === "shipped"
                    ? undefined
                    : (flowStepOf(task.stage) ?? undefined)
                }
              />
            ) : (
              <p>Reading the transcripts…</p>
            )
          ) : null}
          {panel === "delete" ? (
            <>
              <p>The task's documents and local records will be deleted.</p>
              <div className="flex justify-end gap-2">
                <button type="button" className="q-btn quiet" onClick={() => setPanel(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="q-btn"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (!task.archived) await api.archive(task.id, true)
                      await api.deleteTask(task.id)
                      setPanel(null)
                      onDeleted?.()
                    })
                  }
                >
                  Delete for good
                </button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

export function attentionCount(
  task: TaskSurfaceProps["task"],
  view: string,
  turn: TurnSnapshot | null,
): number {
  if (
    task.archived ||
    task.stage === "shipped" ||
    task.stage === "abandoned" ||
    // The final approval is saved: nothing of the task's steps is the person's turn any more.
    finalApproved(task) ||
    (viewedStep(view) === "verify" && personVerify(task))
  )
    return 0
  if (autonomous(task))
    return task.action === "implement" && viewedStep(view) === flowStepOf(task.stage) ? 1 : 0
  const items = turn
    ? turn.questions.filter((q) => !isPlanApprovalQuestion(task, q)).length
      ? turn.questions.filter((q) => !isPlanApprovalQuestion(task, q)).length
      : foldingTurn(turn)
        ? 0
        : flattenItems(turn.items).filter(
            (item) =>
              !item.children &&
              !item.uncounted &&
              item.kind !== "question" &&
              item.state === "open",
          ).length
    : (task.openItems ?? 0)
  const needs =
    viewedStep(view) === flowStepOf(task.stage)
      ? (task.live?.needs.filter((need) => need.state === "open").length ?? 0)
      : 0
  return Math.max(
    items + needs,
    pendingGate(task) !== null && !(task.stage === "plan" && task.gate?.locked) ? 1 : 0,
  )
}

type OwnerBarProps = TaskSurfaceProps & {
  cost?: TaskCost | null
  actions?: boolean
  /** False while a task's artifact is open: the artifact's own bar stands under the header, with no step track. */
  track?: boolean
  mode?: "owner"
}

/** A teammate's task in the same header: the title, the owner's chip and tools, the three steps. */
type TeammateBarProps = {
  mode: "teammate"
  title: string
  /** The steps with the owner's progress; the gate row and the task menu stay out. */
  tabs: StageTab[]
  /** The step in view. */
  step: FlowStepId | null
  onOpen: (key: string) => void
  /** Whether the person approves at Plan and Verify on this task's layout (a task). */
  approves: boolean
  /** The owner chip, the follow switch and the verdict buttons. */
  children: ReactNode
}

function TeammateTopBar({ title, tabs, step, onOpen, approves, children }: TeammateBarProps) {
  return (
    <div
      className="ir-topbar"
      data-testid="teammate-topbar"
      data-unified="true"
      data-gate-row="false"
      data-mode="teammate"
    >
      <div className="q-head" data-testid="task-head">
        <div className="min-w-0">
          <h1 className="q-title" title={title}>
            <span className="truncate">{title}</span>
          </h1>
        </div>
        <div className="q-tools">{children}</div>
      </div>
      <div className="ir-workflow-row">
        <StepTrack tabs={tabs} step={step} onOpen={onOpen} approves={approves} progress />
      </div>
    </div>
  )
}

export function TaskTopBar(props: OwnerBarProps | TeammateBarProps) {
  return props.mode === "teammate" ? <TeammateTopBar {...props} /> : <OwnTaskTopBar {...props} />
}

function OwnTaskTopBar(props: OwnerBarProps) {
  const root = useRef<HTMLDivElement | null>(null)
  const [header, setHeader] = useState<HTMLElement | null>(null)
  const [decisionHost, setDecisionHost] = useState<HTMLElement | null>(null)
  // Where the task comes from stands before the title, in the title's column.
  const [originHost, setOriginHost] = useState<HTMLElement | null>(null)
  // The three steps stand right after the title (Max, 11 November 2026); where the header gives way to
  // the shell's one-row bar, they stay in the strip under it.
  const [stepsHost, setStepsHost] = useState<HTMLElement | null>(null)
  const project = useProjectFacts(props.task)
  const turn = useTurnSnapshot(props.task.id)
  const step = viewedStep(props.view)
  const openCount = attentionCount(props.task, props.view, turn)
  const planApproval =
    step === "plan" &&
    props.task.stage === "plan" &&
    pendingGate(props.task) !== null &&
    !props.task.archived
  const reviewApproval =
    step === "verify" &&
    personVerify(props.task) &&
    pendingGate(props.task) === "final" &&
    !props.task.archived
  const openPlanItems = humanPlanItems(turn?.items ?? props.task.items ?? []).filter(
    (item) => item.state === "open",
  )
  const planChoices =
    openPlanItems.length +
    (turn?.questions ?? (props.task.question ? [props.task.question] : [])).filter(
      (q) => !isPlanApprovalQuestion(props.task, q),
    ).length
  // When only Plan calls are left, the approval's one amber chip says so: no second Your turn chip.
  const callsChip =
    planApproval &&
    openPlanItems.length > 0 &&
    openPlanItems.length === planChoices &&
    openPlanItems.every((item) => item.call !== undefined)
  const showGateRow =
    step === flowStepOf(props.task.stage) &&
    !props.task.archived &&
    props.task.stage !== "shipped" &&
    props.task.stage !== "abandoned" &&
    (openCount > 0 || pendingGate(props.task) !== null)
  useLayoutEffect(() => {
    const head = root.current?.querySelector<HTMLElement>('[data-testid="task-head"]')
    setHeader(
      head?.hidden
        ? (document
            .getElementById("top-bar-tools")
            ?.querySelector<HTMLElement>(".ir-pinned-status") ??
            document.getElementById("top-bar-tools"))
        : (head?.querySelector<HTMLElement>(".q-tools") ?? head ?? null),
    )
    const column =
      head && !head.hidden ? head.querySelector<HTMLElement>(".q-title")?.parentElement : null
    if (column) {
      let host = Array.from(column.children).find((el) => el.hasAttribute("data-origin-host"))
      if (host === undefined) {
        host = document.createElement("span")
        host.setAttribute("data-origin-host", "true")
        column.prepend(host)
      }
      column.setAttribute("data-origin", "true")
      setOriginHost(host as HTMLElement)
      const title = column.querySelector<HTMLElement>(":scope > .q-title")
      let steps = Array.from(column.children).find((el) => el.hasAttribute("data-steps-host"))
      if (props.track === false) {
        steps?.remove()
        setStepsHost(null)
      } else if (title) {
        if (steps === undefined) {
          steps = document.createElement("span")
          steps.setAttribute("data-steps-host", "true")
        }
        if (title.nextElementSibling !== steps) title.after(steps)
        setStepsHost(steps as HTMLElement)
      } else setStepsHost(null)
    } else {
      setOriginHost(null)
      setStepsHost(null)
    }
  })
  useLayoutEffect(() => {
    if (!header) {
      setDecisionHost(null)
      return
    }
    const node = document.createElement("span")
    node.className = "ir-header-decisions"
    header.append(node)
    setDecisionHost(node)
    return () => node.remove()
  }, [header])
  const placeDecision = (element: ReactNode) =>
    decisionHost ? createPortal(element, decisionHost) : element
  return (
    <ShellApiContext.Provider value={props.api}>
      <div
        ref={root}
        className="ir-topbar"
        data-testid="interaction-topbar"
        data-unified="true"
        data-gate-row={showGateRow}
      >
        {props.children}
        <div className="ir-workflow-row">
          {props.track === false ? null : stepsHost !== null ? (
            createPortal(
              <StepTrack
                tabs={props.tabs}
                step={step}
                onOpen={props.onOpen}
                approves
                starting={props.task.action === "implement"}
                look="header"
              />,
              stepsHost,
            )
          ) : (
            <StepTrack
              tabs={props.tabs}
              step={step}
              onOpen={props.onOpen}
              approves
              starting={props.task.action === "implement"}
            />
          )}
          {showGateRow
            ? placeDecision(
                <div
                  className="ir-task-gate-row"
                  id={`task-gate-track-${props.task.id}`}
                  data-testid="task-gate-row"
                >
                  {!reviewApproval &&
                  !callsChip &&
                  openCount > 0 &&
                  (!planApproval || planChoices > 0) ? (
                    <button
                      type="button"
                      className="ir-turn-pill"
                      disabled={openCount === 0}
                      onClick={(event) => {
                        if (props.onRevealTurn) {
                          props.onRevealTurn(event.currentTarget)
                          return
                        }
                        setDocumentFullSize(false)
                        setDocumentRecord(null)
                        const current = flowStepOf(props.task.stage)
                        if (current !== null) props.onOpen(stepView(props.task, current))
                      }}
                    >
                      {openCount ? `Your turn · ${openCount}` : "Nothing needs you"}
                    </button>
                  ) : null}
                  {planApproval ? (
                    <ApproveCard
                      items={turn?.items ?? props.task.items ?? []}
                      busy={props.live.busy}
                      surface={props}
                    />
                  ) : null}
                  {reviewApproval ? (
                    <ReviewApproval key={props.task.gate?.id} surface={props} />
                  ) : null}
                </div>,
              )
            : null}
        </div>
        {landingActionsShow(props.task) ? placeDecision(<LandingActions surface={props} />) : null}
        {originHost !== null ? createPortal(<ProjectOrigin project={project} />, originHost) : null}
        {props.actions === false ? null : <TaskActions {...props} host={header} />}
      </div>
    </ShellApiContext.Provider>
  )
}
