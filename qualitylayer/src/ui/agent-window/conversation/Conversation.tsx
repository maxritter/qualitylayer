// The Conversation view of an agent's window: the same session the terminal shows, read from the
// agent's own record and drawn as messages, thinking, tool calls, task files, state and usage. The
// terminal stays the engine; messages typed here go into it as a person would type them.
import { ArrowUpIcon, PaperclipIcon, PauseIcon, SquareTerminalIcon, XIcon } from "lucide-react"
import { type KeyboardEvent, useContext, useEffect, useId, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { isNativeAgent } from "../../../core/agents/ids.ts"
import type { PickerResult } from "../../../core/conversation/codex-picker.ts"
import type { CommandCatalog } from "../../../core/conversation/commands/types.ts"
import type {
  ApprovalDecision,
  ConversationQuestion,
  ConversationSnapshot,
  ConversationWorker,
  PendingApproval,
} from "../../../core/conversation/types.ts"
import type { Usage, UsagePeriod } from "../../../core/cost/usage.ts"
import { pickProblem } from "../../../core/interaction-docs/attachment-rules.ts"
import type { Attachment } from "../../../core/interaction-docs/attachments.ts"
import type { AgentLimits } from "../../../core/limits/index.ts"
import type { RunSettings } from "../../../core/run/contracts.ts"
import type { ViewerState } from "../../../core/run/protocol.ts"
import { holdsAntigravityStartup } from "../../../core/run/startup-prompt.ts"
import type { TurnChanges } from "../../../core/run/turn-snapshots.ts"
import { writeClipboardText } from "../../clipboard.ts"
import { Attachments, usePendingFiles } from "../../docs/Attachments.tsx"
import { useNow } from "../../hooks.ts"
import { Disclosure } from "../../kit/Fold.tsx"
import { WhoMark } from "../../kit/WhoMark.tsx"
import type { RunWindow } from "../../run-context.tsx"
import type { TaskTurnEnd } from "../task-controls.ts"
import { nativeImageAttachment } from "../terminal-images.ts"
import { Approval, answerLine } from "./Approval.tsx"
import { ConversationActionsContext } from "./actions.ts"
import {
  addAwaiting,
  dismissAwaiting,
  expireAwaiting,
  type Pending,
  settleAwaiting,
  useAwaiting,
} from "./awaiting.ts"
import { ChildConversation, WorkerTray } from "./ChildConversation.tsx"
import { CommandMenu } from "./CommandMenu.tsx"
import { type CommandOption, commandOptions, commandQuery } from "./command-options.ts"
import { type ComposerActivity, composerActivity, currentTool } from "./composer-activity.ts"
import { useMessageDelivery } from "./delivery.ts"
import { EarlierButton, useEarlier } from "./Earlier.tsx"
import { SessionFooter } from "./Footer.tsx"
import { placeChanges } from "./fold.ts"
import { sessionChanges } from "./footer-usage.ts"
import { footerStatus, steadySettings } from "./footer-values.ts"
import { LogView } from "./LogView.tsx"
import { useLatestOnTurn } from "./latest-on-turn.ts"
import { buildBlocks, type Loaded, RECORD_NAME, sessionSpan } from "./model.ts"
import { type NativeAnswer, type NativeAnswerUpload, Question } from "./Question.tsx"
import { type Held, heldLabel, nativeSteering, queueInterrupt, restoreHeld } from "./queue.ts"
import { OpensContext, useOpens } from "./Say.tsx"
import { TaskList } from "./TaskList.tsx"
import { useCommandCatalog } from "./useCommandCatalog.ts"
import {
  type ConversationMore,
  OUTPUT_READ_MS,
  type Pulse,
  useConversation,
  useMore,
} from "./useConversation.ts"
import { useTurnChanges } from "./useTurnChanges.ts"
import "./conversation.css"
import {
  holdForResume,
  markSent,
  type QuickAskResult,
  takeHeldForResume,
  useQuickAskReceiver,
} from "../../quick-ask/deliver.ts"
import { deliveryWords } from "../../quick-ask/terminal.ts"
import { ContextDraftAttachment } from "./ContextDraftAttachment.tsx"
import { useComposerDraft } from "./composer-draft.ts"
import type { ContextDraftTarget } from "./context-draft.ts"
import {
  emptyMessageDraft,
  type MessageDraft,
  nativeAnswerOwner,
  removeDraftContext,
  serializeMessageDraft,
} from "./context-draft.ts"
import { contextMatchesOwner } from "./context-draft-store.ts"
import { retainDrafts } from "./draft-handoff.ts"

/** Just after an answer, the agent's window may still say it waits; the terminal card holds back. */
const SETTLE_MS = 3_000
/** Answered requests that stay as quiet lines at the end of the log. */
const ANSWERS_KEPT = 3

export { emptyMessageDraft, type MessageDraft } from "./context-draft.ts"

export type ConversationProps = {
  /** Outside hooks cannot accept a message after their pending picker ends. */
  outside?: boolean
  run: RunWindow
  /** The agent's name as the window labels it. */
  agentName: string
  load?: (after?: string) => Promise<ConversationSnapshot | undefined>
  loadWorker?: (worker: string, after?: string) => Promise<ConversationSnapshot | undefined>
  /** Reads what a read leaves out: older turns, and a shortened output whole. */
  more?: ConversationMore
  /** What the session's turns changed in the worktree; absent when the server cannot say. */
  loadChanges?: () => Promise<readonly TurnChanges[] | undefined>
  /** The window's menu asked for the session sheet to open; `onSettingsOpened` spends the request. */
  openSettings?: boolean
  onSettingsOpened?(): void
  /** The agents' plan limits; absent when the server cannot say. */
  loadLimits?: () => Promise<readonly AgentLimits[] | undefined>
  /** Reads what the agents used in a period: how this session's agent is billed comes from it. */
  loadUsage?: (period: UsagePeriod) => Promise<Usage | undefined>
  /** The attached terminal printed something: the record may have moved. */
  output?: Pulse
  /** The view is no longer open on the session (closed, switched to the terminal, off screen). */
  onClosed?(): void
  /** Sends the person's answer to a permission; rejects with a plain message when it did not go. */
  answer?(approval: PendingApproval, decision: ApprovalDecision): Promise<void>
  /** The view is on screen: only then is the record read. */
  on: boolean
  /** The session is running (not stopped or failed). */
  active: boolean
  /** The agent has had its first prompt. */
  started: boolean
  waiting: boolean
  readOnly: boolean
  viewer: ViewerState | undefined
  /** A control action is in flight. */
  busy: boolean
  canInterrupt: boolean
  showInterruptControl?: boolean
  onTurnEnd?(end: TaskTurnEnd): void
  interruptPending?: boolean
  canResume: boolean
  /** Types the message into the agent's window; false when it could not go. */
  send(text: string): boolean
  /** Pastes image paths into the agent's input; true once the agent drew each one. */
  pasteImages?(paths: readonly string[]): Promise<boolean>
  draft?: MessageDraft
  onDraft?(draft: MessageDraft): void
  contextTarget?: ContextDraftTarget
  /** Native answers have their own identity and never replace an incoming ordinary message. */
  onQuestionDraft?(draft: MessageDraft): void
  queued?: readonly Held[]
  onQueued?(items: readonly Held[], draft?: MessageDraft, kept?: readonly MessageDraft[]): boolean
  attachFiles?(draft: string, files: readonly File[]): Promise<Attachment[]>
  canConfigure?: boolean
  applySettings?(settings: Partial<RunSettings>, confirmBypass?: boolean): Promise<boolean>
  loadCommands?(refresh?: boolean): Promise<CommandCatalog>
  command?(action: "compact" | "fresh"): Promise<boolean>
  supportsCommands?: readonly ("compact" | "fresh")[]
  keptDrafts?: readonly MessageDraft[]
  draftLimit?: boolean
  onUseKeptDraft?(): void
  /** Interrupts the agent; false when it did not go through (nothing is sent after it). */
  onInterrupt(): Promise<boolean | undefined> | boolean | undefined
  onTakeControl(): void
  onResume(): void
  onShowTerminal(): void
  onOpenTaskFile?(task: string, name: string): void
  task?: string
  answerQuestion?(answer: NativeAnswer, upload?: NativeAnswerUpload): Promise<PickerResult>
}

/** The state word of the strip and the mark before it. */
function stateOf(
  props: Pick<ConversationProps, "active" | "waiting" | "started" | "readOnly" | "run">,
  loaded: Loaded | undefined,
  unavailable: boolean,
  working: boolean,
): { word: string; who: "todo" | "agent" | "you" | "stop" } {
  if (!props.active) return { word: "Stopped", who: "stop" }
  if (props.waiting || props.run.terminalPrompt) return { word: "Waiting for you", who: "you" }
  // Its own start-up question (trust this folder) waits in the terminal: not "Connecting".
  if (props.run.startupPrompt !== undefined)
    return { word: "Waiting for you in its terminal", who: "you" }
  if (!props.started || (!loaded && !unavailable)) return { word: "Connecting", who: "todo" }
  if (loaded?.hasMore) return { word: "Loading conversation", who: "todo" }
  if (working) return { word: "Working", who: "agent" }
  return { word: "Ready", who: "todo" }
}

function useObservedTurnEnd(
  run: Pick<RunWindow, "id" | "generation" | "nativeSession">,
  loaded: Loaded | undefined,
  report: ConversationProps["onTurnEnd"],
) {
  const end = useMemo(
    () => loaded?.events.findLast((event) => event.kind === "turn-end"),
    [loaded?.events],
  )
  useEffect(() => {
    if (!end || loaded?.hasMore) return
    report?.({
      run: run.id,
      generation: run.generation,
      nativeSession: run.nativeSession,
      id: end.id,
      at: end.at,
    })
  }, [run.id, run.generation, run.nativeSession, end, loaded?.hasMore, report])
}

function useInterruptCatchup(
  refresh: () => void,
  on: boolean,
  pending: boolean,
  output: Pulse | undefined,
) {
  useEffect(() => {
    if (!on || !pending || !output) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = output.subscribe(() => {
      clearTimeout(timer)
      if (document.visibilityState === "hidden") return
      timer = setTimeout(refresh, OUTPUT_READ_MS)
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [refresh, on, pending, output])
}

export function ConversationTurnObserver(
  props: Pick<ConversationProps, "run" | "load" | "on" | "output" | "onClosed" | "onTurnEnd">,
) {
  const { loaded, refresh } = useConversation(props.load, props.on, props.output, props.onClosed)
  useInterruptCatchup(refresh, props.on, true, props.output)
  useObservedTurnEnd(props.run, loaded, props.onTurnEnd)
  return null
}

export function Conversation(props: ConversationProps) {
  const { run, agentName, on, active, readOnly, onShowTerminal } = props
  const { loaded, unavailable, failing, catchupLimited, refresh, update } = useConversation(
    props.load,
    on,
    props.output,
    props.onClosed,
  )
  const { loadEarlier, showMore } = useMore(props.more, loaded, update)
  useInterruptCatchup(refresh, on, props.interruptPending === true, props.output)
  useObservedTurnEnd(run, loaded, props.onTurnEnd)
  const events = loaded?.events ?? []
  const [retainedQuestion, retainQuestion] = useState<ConversationQuestion | null>(null)
  const [dismissedQuestion, dismissQuestion] = useState<string>()
  useEffect(() => {
    if (loaded?.question) retainQuestion(loaded.question)
    else if (loaded)
      retainQuestion((before) =>
        before
          ? {
              ...before,
              answerable: false,
              availability: loaded.hasMore ? "catching-up" : "expired",
            }
          : null,
      )
  }, [loaded])
  const nativeQuestion = props.outside ? loaded?.question : (loaded?.question ?? retainedQuestion)
  const showQuestion = nativeQuestion && nativeQuestion.id !== dismissedQuestion
  const workers = active ? (loaded?.workers ?? []) : []
  const incomplete = active && loaded?.workersIncomplete === true
  const [usageOpen, setUsageOpen] = useState(false)
  const [child, setChild] = useState<ConversationWorker>()
  const childRun = useRef("")
  const selectedChild = childRun.current === `${run.id}:${run.generation}` ? child : undefined
  const mainScroll = useRef(0)
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (childRun.current !== `${run.id}:${run.generation}`) setChild(undefined)
  }, [run.id, run.generation])

  // Permissions the agent asks for, and the quiet lines of the ones this view answered.
  const [answers, setAnswers] = useState<{ id: string; text: string; at: number }[]>([])
  const asking = (loaded?.approvals ?? []).filter(
    (approval) => !answers.some((done) => done.id === approval.id),
  )
  const waiting = props.waiting || run.terminalPrompt === "permission" || asking.length > 0
  const working =
    active &&
    !waiting &&
    !run.terminalPrompt &&
    (loaded?.state === "working" || workers.length > 0 || incomplete)
  const answered = (approval: PendingApproval, decision: ApprovalDecision) => {
    setAnswers((list) =>
      [...list, { id: approval.id, text: answerLine(decision), at: Date.now() }].slice(
        -ANSWERS_KEPT,
      ),
    )
    // The agent goes on, so its record moves: read it now.
    refresh()
  }

  // Messages typed into the agent's window wait here until the record shows them; they belong to the run,
  // so a switch to Terminal and back lists them again.
  const waits = useAwaiting(run)
  // A sent message that never shows up ends its wait.
  const waitStarted = Date.parse(run.waitSince ?? run.intent?.waitSince ?? "")
  const now = useNow(
    on &&
      (working ||
        (waiting && active && Number.isFinite(waitStarted)) ||
        workers.length > 0 ||
        incomplete ||
        waits.some((item) => !item.unconfirmed) ||
        (waiting && answers.length > 0)),
  )
  const settling = answers.some((done) => now - done.at < SETTLE_MS)
  useEffect(() => expireAwaiting(run, now), [run, now])

  const blocks = useMemo(() => buildBlocks(events, working), [events, working])
  // What each turn changed: read on opening and again whenever the host records a turn.
  const ended = useMemo(() => events.findLast((event) => event.kind === "turn-end")?.id, [events])
  const turnChanges = useTurnChanges(props.loadChanges, on && loaded !== undefined)
  const changes = useMemo(() => placeChanges(blocks, turnChanges), [blocks, turnChanges])
  const sessionTotal = useMemo(() => sessionChanges(turnChanges), [turnChanges])
  // A turn still going, or waiting for the person, keeps its work open.
  const live = working || waiting || asking.length > 0
  const actions = useContext(ConversationActionsContext)
  const task = props.task
  const background = task ? actions.backgroundWork?.(task) : undefined
  const opens = useOpens({
    ...(task && actions.openFile ? { file: (path: string) => actions.openFile?.(task, path) } : {}),
    ...(task && actions.openCommit
      ? { commit: (sha: string) => actions.openCommit?.(task, sha) }
      : {}),
    ...(task && actions.viewChanges ? { changes: () => actions.viewChanges?.(task) } : {}),
  })
  const state = stateOf({ ...props, waiting }, loaded, unavailable, working)
  // The composer's status: the same derived states as above, waiting (the permission dialog included) first.
  const activity = composerActivity({
    active,
    readOnly,
    waiting,
    permission: run.terminalPrompt === "permission" || asking.length > 0,
    helpers: Math.max(workers.length, background?.count ?? 0),
    startup: run.startupPrompt !== undefined,
    started: props.started,
    loaded: loaded !== undefined,
    unavailable,
    loading: loaded?.hasMore === true,
    failing,
    working,
    tool: working ? currentTool(events) : undefined,
  })
  const span = sessionSpan(events, loaded?.earlier)
  // While a long record is still being read, or a setting is briefly unverified, the footer keeps
  // the last model and effort it knew for this session (also across a switch to the Terminal),
  // instead of "unavailable".
  const settings = steadySettings(
    `${run.id}:${run.generation}`,
    {
      unknown: loaded?.hasMore ? ["model", "effort"] : (loaded?.usage?.settingsUnknown ?? []),
      model: loaded?.usage?.model ?? run.settings?.model,
      effort: loaded?.hasMore ? undefined : loaded?.usage?.effort,
    },
    loaded !== undefined && loaded.hasMore !== true,
  )
  const settingsUnknown = settings.unknown
  const model = settings.model

  // The log's scroll element and whether new output follows its end: LogView keeps both, and a panel that
  // opens over the log holds the place.
  const log = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  // Your turn starts (a gate opens, an approval is asked, the agent waits): the log moves to its latest
  // message, unless the person scrolled it a moment ago.
  const yourTurn =
    !readOnly &&
    ((task !== undefined && actions.awaitingYou?.(task) === true) ||
      (waiting && active) ||
      asking.length > 0)
  useLatestOnTurn(log, follow, yourTurn ? (ended ?? "your-turn") : "")

  // ── Messages the person sent from here wait as chips until the record shows them.
  useEffect(() => settleAwaiting(run, events), [run, events])
  const earlier = useEarlier({ loaded, loadEarlier })
  // The window lists these subagents on its own, so the log leaves their calls out.
  const hidden = useMemo(() => new Set(workers.map((worker) => worker.callId)), [workers])
  const ctx = {
    agentName,
    agent: run.agent,
    cwd: run.cwd,
    task: props.task,
    onShowTerminal,
    onOpenTaskFile: props.onOpenTaskFile,
    showMore,
    hidden,
  }
  const metadata = (
    <SessionFooter
      run={run}
      model={model}
      effort={settings.effort}
      unknown={settingsUnknown}
      agentName={agentName}
      editable={
        props.canConfigure === true && !readOnly && (!active || props.viewer?.canType === true)
      }
      busy={props.busy}
      apply={props.applySettings ?? (async () => false)}
      on={on}
      turn={ended}
      loadLimits={props.loadLimits}
      loadUsage={props.loadUsage}
      changes={sessionTotal}
      onViewChanges={task && actions.viewChanges ? () => actions.viewChanges?.(task) : undefined}
      openRequest={props.openSettings}
      onOpenHandled={props.onSettingsOpened}
      status={footerStatus({
        word: state.word,
        who: state.who,
        readOnly,
        working,
        failing,
      })}
      usage={loaded && !loaded.hasMore ? loaded.usage : undefined}
      usageOpen={usageOpen}
      onUsageOpen={setUsageOpen}
      span={span}
    />
  )
  const openWorker = (worker: ConversationWorker) => {
    mainScroll.current = log.current?.scrollTop ?? 0
    follow.current = false
    childRun.current = `${run.id}:${run.generation}`
    setChild(worker)
  }
  const backToMain = (message: boolean) => {
    setChild(undefined)
    requestAnimationFrame(() => {
      if (log.current) log.current.scrollTop = mainScroll.current
      if (message)
        container.current
          ?.querySelector<HTMLTextAreaElement>("textarea")
          ?.focus({ preventScroll: true })
      else
        container.current
          ?.querySelector<HTMLButtonElement>(".cv-worker-row")
          ?.focus({ preventScroll: true })
    })
  }
  const loading = !unavailable && (!loaded || (loaded.source === "none" && events.length === 0))
  return (
    <div className="cv" ref={container} id="conversation-view" data-state={state.word}>
      <div
        className={`cv-main${selectedChild ? " cv-main-covered" : ""}`}
        aria-hidden={selectedChild ? true : undefined}
        inert={selectedChild ? true : undefined}
      >
        {loading ? (
          <div className="cv-loading" role="status">
            <span className="agent-loading-mark q-run-loading-mark" aria-hidden="true" />
            <div>
              <b>Reading {agentName}’s conversation</b>
              <p>Messages appear as {agentName} saves them.</p>
            </div>
          </div>
        ) : unavailable ? (
          <div className="cv-loading" role="status">
            <div>
              <b>This session’s conversation can’t be read here</b>
              <p>
                {agentName}’s {run.agent === "other" ? "record" : RECORD_NAME[run.agent]} wasn’t
                found.{" "}
                <button type="button" className="q-link" onClick={onShowTerminal}>
                  Show in terminal
                </button>
              </p>
            </div>
          </div>
        ) : (
          <OpensContext.Provider value={opens}>
            <LogView
              scroll={log}
              follow={follow}
              label={`${agentName} conversation`}
              blocks={blocks}
              ctx={ctx}
              live={live}
              asking={asking.length > 0}
              changes={changes}
              head={
                <>
                  {loaded?.hasMore ? (
                    <p className="cv-note" role="status">
                      {catchupLimited ? (
                        <>
                          More conversation history is available.{" "}
                          <button type="button" className="q-link" onClick={refresh}>
                            Continue loading
                          </button>
                        </>
                      ) : (
                        "Loading conversation history…"
                      )}
                    </p>
                  ) : null}
                  {failing ? (
                    <p className="cv-note" role="status">
                      The conversation couldn’t be refreshed. Trying again.
                    </p>
                  ) : null}
                  {earlier.count > 0 ? (
                    <EarlierButton
                      count={earlier.count}
                      failed={earlier.failed}
                      onShow={earlier.show}
                    />
                  ) : loaded?.truncated ? (
                    <p className="cv-note">
                      Earlier messages aren’t shown here. {agentName} still has them.
                    </p>
                  ) : null}
                </>
              }
              empty={<p className="cv-note">Nothing has been said in this session yet.</p>}
              foot={
                <>
                  {active && props.answer
                    ? asking.map((approval) => (
                        <Approval
                          key={approval.id}
                          approval={approval}
                          agentName={agentName}
                          answer={props.answer as NonNullable<typeof props.answer>}
                          onAnswered={answered}
                        />
                      ))
                    : null}
                  {answers.map((done) => (
                    <p className="cv-note" key={done.id}>
                      {done.text}
                    </p>
                  ))}
                  {/* A wait without a request to answer here (the agent’s own question) goes to its window. */}
                  {waiting && active && asking.length === 0 && !settling && !showQuestion ? (
                    <section
                      className="cv-ask"
                      aria-label={`${agentName} is waiting for your answer`}
                    >
                      <div className="cv-ask-tag">
                        <WhoMark who="you" />
                        {agentName} is waiting for your answer
                      </div>
                      <div className="cv-ask-actions">
                        <button type="button" className="q-btn primary sm" onClick={onShowTerminal}>
                          <SquareTerminalIcon size={13} aria-hidden="true" />
                          Answer in the terminal
                        </button>
                        <span>{agentName} shows this choice in its own window.</span>
                      </div>
                    </section>
                  ) : null}
                </>
              }
            />
          </OpensContext.Provider>
        )}
        <WorkerTray
          workers={workers}
          incomplete={incomplete}
          now={now}
          onSelect={openWorker}
          onShowTerminal={onShowTerminal}
        />
        {showQuestion ? null : <TaskList checklist={loaded?.checklist} />}
        {waits
          .filter((item) => item.unconfirmed)
          .map((item) => (
            <DeliveryNotice
              key={item.key}
              text={item.text}
              onTerminal={onShowTerminal}
              onDismiss={() => dismissAwaiting(run, item.key)}
            />
          ))}
        <Composer
          {...props}
          waiting={waiting}
          answerQuestion={
            props.answerQuestion
              ? async (answer, upload) => {
                  const result = await (upload
                    ? props.answerQuestion?.(answer, upload)
                    : props.answerQuestion?.(answer))
                  refresh()
                  return (
                    result ?? {
                      status: "refused",
                      message: "This answer destination is no longer available.",
                    }
                  )
                }
              : undefined
          }
          nativeQuestion={showQuestion ? nativeQuestion : undefined}
          onQuestionDone={() => {
            if (nativeQuestion) dismissQuestion(nativeQuestion.id)
            refresh()
          }}
          on={on && selectedChild === undefined}
          onShowUsage={() => (loaded?.usage ? setUsageOpen(true) : onShowTerminal())}
          working={working}
          recordLoaded={loaded !== undefined}
          activity={activity}
          pending={waits.filter((item) => !item.unconfirmed)}
          onSent={(text, transmitted) => {
            // The agent saves the message in its record: read it as soon as it can be there.
            refresh()
            addAwaiting(
              run,
              text,
              new Set(events.filter((event) => event.kind === "user").map((event) => event.id)),
              Date.now(),
              transmitted,
            )
          }}
        />
        {metadata}
      </div>
      {selectedChild ? (
        <ChildConversation
          key={`${run.id}:${run.generation}:${selectedChild.id}`}
          worker={workers.find((worker) => worker.id === selectedChild.id) ?? selectedChild}
          run={run}
          on={on}
          output={props.output}
          load={
            props.loadWorker
              ? (after) => props.loadWorker?.(selectedChild.id, after) ?? Promise.resolve(undefined)
              : undefined
          }
          running={workers.some((worker) => worker.id === selectedChild.id)}
          mainWaiting={waiting}
          mainWorking={working}
          onBack={backToMain}
        />
      ) : null}
    </div>
  )
}

function DeliveryNotice({
  text,
  onTerminal,
  onDismiss,
}: {
  text: string
  onTerminal: () => void
  onDismiss: () => void
}) {
  async function copyText() {
    if (await writeClipboardText(text)) toast.success("Message copied")
    else toast.error("Select the message text to copy it.")
  }
  return (
    <section className="cv-delivery-notice" aria-label="Message delivery">
      <div className="cv-delivery-heading">
        <strong role="status">Delivery unconfirmed</strong>
        <button
          type="button"
          className="cv-queue-x"
          aria-label="Dismiss delivery notice"
          onClick={onDismiss}
        >
          <XIcon size={14} />
        </button>
      </div>
      <p>{text}</p>
      <div className="cv-delivery-actions">
        <button type="button" className="q-link" onClick={onTerminal}>
          Open Terminal
        </button>
        <button type="button" className="q-link" onClick={() => void copyText()}>
          Copy text
        </button>
      </div>
    </section>
  )
}

function Composer({
  run,
  on,
  loadCommands,
  command,
  supportsCommands,
  keptDrafts,
  draftLimit,
  onUseKeptDraft,
  onShowTerminal,
  onShowUsage,
  agentName,
  active,
  readOnly,
  waiting,
  working,
  recordLoaded,
  activity,
  viewer,
  busy,
  canInterrupt,
  showInterruptControl = true,
  canResume,
  pending,
  send,
  pasteImages,
  draft: retained,
  onDraft,
  contextTarget,
  onQuestionDraft,
  queued,
  onQueued,
  attachFiles,
  onSent,
  onInterrupt,
  onTakeControl,
  onResume,
  task,
  nativeQuestion,
  answerQuestion,
  onQuestionDone,
}: ConversationProps & {
  working: boolean
  recordLoaded: boolean
  activity?: ComposerActivity | undefined
  pending: readonly Pending[]
  onSent(text: string, transmitted: string): void
  onShowUsage?(): void
  nativeQuestion?: ConversationQuestion
  onQuestionDone?(): void
}) {
  const holdOrdinary = !nativeQuestion && active && (run.terminalPrompt === "permission" || waiting)
  const [localPrevious, setLocalPrevious] = useState<readonly MessageDraft[]>([])
  const previous = keptDrafts ?? localPrevious
  const { draft, change, blankAnswer } = useComposerDraft({
    retained,
    kept: previous,
    question: nativeQuestion?.id,
    onDraft,
    onQuestionDraft,
    permission: holdOrdinary,
    nativeOwner: nativeAnswerOwner(run),
  })
  const { text, files } = draft
  const contextReady = contextMatchesOwner(draft.context, contextTarget, run)
  const deliveryOwner = useRef({ target: contextTarget, run })
  deliveryOwner.current = { target: contextTarget, run }
  const previousMessages = previous.filter((item) => !item.nativeQuestionId)
  const [uploading, setUploading] = useState(false)
  const sending = useRef(false)
  const picker = useRef<HTMLInputElement>(null)
  const pendingFiles = usePendingFiles(files)
  const [problem, setProblem] = useState<string>()
  const [queueFailed, setQueueFailed] = useState(false)
  const field = useId()
  const nativeSubmit = useRef<(() => void) | null>(null)
  const [nativeReady, setNativeReady] = useState(false)
  const [nativeSending, setNativeSending] = useState(false)
  const going = working
  // While a question or a review waits on the person, what they type answers it: it goes to the
  // agent at once (which takes it in at its next step), never into the queue behind a turn that
  // only ends when the answer arrives.
  const actions = useContext(ConversationActionsContext)
  const answering =
    nativeQuestion !== undefined || (task !== undefined && actions.awaitingYou?.(task) === true)
  // A task from before the three steps opens as files only: its ended session offers no way to continue it.
  const earlierTask = task !== undefined && actions.earlier?.(task) === true
  const delivery = useMessageDelivery()
  const queueing = going && !answering && (delivery === "queue" || !nativeSteering(run.agent))
  // Messages sent while the agent works wait here: they go out when its turn ends, at once after an
  // interrupt, or back into the composer.
  const [localHeld, setHeld] = useState<readonly Held[]>([])
  const held = queued ?? localHeld
  const hasHeldContext =
    Boolean(retained?.context) ||
    previous.some((item) => item.context) ||
    held.some((item) => item.context)
  const heldRef = useRef(held)
  heldRef.current = held
  const updateHeld = (
    next: (list: readonly Held[]) => readonly Held[],
    nextDraft?: MessageDraft,
    kept: readonly MessageDraft[] = [],
  ): boolean => {
    const items = next(heldRef.current)
    if (onQueued && !onQueued(items, nextDraft, kept)) return false
    if (!onQueued) {
      const previous = [...localPrevious, ...kept]
      if (
        !retainDrafts(run.id, {
          current: nextDraft ?? draft,
          previous,
          queue: { generation: run.generation, nativeSession: run.nativeSession, items },
        })
      )
        return false
      setHeld(items)
      setLocalPrevious(previous)
      if (nextDraft) change(nextDraft)
    }
    heldRef.current = items
    return true
  }
  const latest = useRef({ draft, change, blankAnswer })
  latest.current = { draft, change, blankAnswer }
  const sendable = queueInterrupt(run.agent, agentName, canInterrupt)
  const interruptible = sendable.ok
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  // What a person types now would answer the agent's question, so it waits for the terminal.
  const asking = active && (run.terminalPrompt === "permission" || (waiting && !nativeQuestion))
  const setup = active && holdsAntigravityStartup(run.agent, run.startupPrompt)
  const messageBlocked = useRef(false)
  messageBlocked.current = Boolean(nativeQuestion || asking || setup)
  const showMessageInterrupt =
    !messageBlocked.current && showInterruptControl && going && interruptible
  const locked = setup || asking || viewer?.canType !== true || uploading || busy
  const [commandClosed, closeCommands] = useState(false)
  const [commandSelected, selectCommand] = useState(0)
  const [commandConfirm, confirmCommand] = useState<"compact" | "fresh">()
  const [commandBusy, setCommandBusy] = useState(false)
  const [commandNotice, setCommandNotice] = useState<string>()
  const commandSending = useRef(false)
  const [selectedSkill, selectSkill] = useState<string>()
  const commandKey = `${run.id}:${run.generation}`
  const inputLocked = locked || commandBusy || nativeSending
  const focusedChat = useRef(false)
  useEffect(() => {
    if (
      !focusedChat.current &&
      on &&
      !inputLocked &&
      run.purpose.kind === "new-task" &&
      run.purpose.type === "chat"
    ) {
      document.getElementById(field)?.focus({ preventScroll: true })
      focusedChat.current = true
    }
  }, [on, inputLocked, run.purpose, field])
  const menuOpen =
    !nativeQuestion &&
    on &&
    active &&
    !readOnly &&
    !inputLocked &&
    isNativeAgent(run.agent) &&
    !commandClosed &&
    !commandConfirm &&
    commandQuery(text, isNativeAgent(run.agent) ? run.agent : undefined)
  const discovered = useCommandCatalog(menuOpen, commandKey, loadCommands)
  const entries = isNativeAgent(run.agent)
    ? commandOptions(run.agent, text, discovered.catalog, !working).map((entry) =>
        (entry.action === "compact" || entry.action === "fresh") &&
        (!command || !(supportsCommands ?? []).includes(entry.action))
          ? { ...entry, disabled: "Use Terminal for this session’s native commands." }
          : entry,
      )
    : []
  const menuId = `${field}-commands`
  const chooseCommand = (entry: CommandOption) => {
    if (entry.disabled || commandSending.current) return
    closeCommands(true)
    if (entry.action === "skill") {
      selectSkill(entry.token)
      change({ ...draft, text: `${entry.token} ` })
    } else if (entry.action === "terminal") onShowTerminal()
    else if (entry.action === "usage") onShowUsage?.()
    else confirmCommand(entry.action)
  }
  const executeCommand = async (action = commandConfirm, recover = false) => {
    if (
      !action ||
      !command ||
      !(supportsCommands ?? []).includes(action) ||
      commandSending.current ||
      busy ||
      working ||
      readOnly ||
      (recover ? !viewer?.controller || !viewer.canTakeControl : locked)
    )
      return
    commandSending.current = true
    setCommandBusy(true)
    try {
      if (!(await command(action)))
        throw new Error("The agent did not accept this action. Your draft is kept.")
      setCommandNotice(
        action === "fresh"
          ? "Fresh conversation started. Previous conversation kept."
          : "Compaction requested. Waiting for the agent’s confirmation.",
      )
      confirmCommand(undefined)
    } catch (cause) {
      setProblem(
        cause instanceof Error ? cause.message : "Could not run the action. Your draft is kept.",
      )
    } finally {
      commandSending.current = false
      setCommandBusy(false)
    }
  }
  const add = (picked: FileList | readonly File[] | null) => {
    if (locked || !picked?.length || !attachFiles) return
    const next = [...files, ...Array.from(picked)]
    const why = pickProblem(next, { allowAnyType: true })?.replace("to a comment", "to a message")
    setProblem(why ?? undefined)
    if (!why)
      change({
        ...draft,
        files: next,
        id: crypto.randomUUID(),
        nativeQuestionId: nativeQuestion?.id,
      })
  }
  // Attaches the files and types the message into the agent's window; throws a plain message when it
  // did not go.
  const deliver = async (item: MessageDraft) => {
    if (messageBlocked.current) return false
    const matches = () =>
      contextMatchesOwner(item.context, deliveryOwner.current.target, deliveryOwner.current.run)
    if (!matches()) return false
    const attached = item.files.length ? await attachFiles?.(item.id, item.files) : []
    if (!mounted.current) return false
    if (item.files.length && !attached?.length)
      throw new Error("Could not attach these files. Your draft is kept.")
    const images = attached?.filter(nativeImageAttachment) ?? []
    const message = serializeMessageDraft(item).trim() || "Please review the attached files."
    const words = deliveryWords(item, attached ?? [])
    // The agent reads a pasted image asynchronously: the words and Enter follow only once it drew
    // each image, or they would go without it and the image would join the next message.
    const pasted = !images.length || (await pasteImages?.(images.map((file) => file.path))) === true
    if (!mounted.current || messageBlocked.current || !matches()) return false
    if (!pasted || !send(words))
      throw new Error(`${agentName} didn’t get the message. Your draft is kept; try again.`)
    onSent(message, words)
    return true
  }
  const queueFailure = (cause: unknown) => {
    setQueueFailed(true)
    setProblem(
      cause instanceof Error
        ? cause.message.replace(
            /Your draft is kept(; try again)?\./,
            "Your message stays queued. Remove it to edit or try again.",
          )
        : "Could not send your message. It stays queued; remove it to edit or try again.",
    )
  }
  // The turn ended: the held messages go out in the order they were written.
  const release = async () => {
    sending.current = true
    setUploading(true)
    try {
      while (heldRef.current.length > 0) {
        const [item] = heldRef.current
        if (!item) break
        try {
          if (!(await deliver(item))) break
          if (!updateHeld((list) => list.filter((entry) => entry.id !== item.id))) break
        } catch (cause) {
          if (!mounted.current) break
          queueFailure(cause)
          break
        }
      }
    } finally {
      sending.current = false
      setUploading(false)
    }
  }
  const interruptAndSend = async (item: Held) => {
    if (sending.current || locked || !interruptible || messageBlocked.current) return
    sending.current = true
    try {
      // The interrupt goes first; only an interrupt that went through lets the words follow it.
      if ((await onInterrupt()) === false || !mounted.current) return
      setUploading(true)
      try {
        if (await deliver(item)) updateHeld((list) => list.filter((entry) => entry.id !== item.id))
      } catch (cause) {
        if (!mounted.current) return
        queueFailure(cause)
      }
    } finally {
      sending.current = false
      setUploading(false)
    }
  }
  const removeHeld = (item: Held) => {
    const restored = restoreHeld(draft, [item])
    if (
      !updateHeld(
        (list) => list.filter((entry) => entry.key !== item.key),
        restored.current,
        restored.previous,
      )
    )
      return
    setProblem(undefined)
    setQueueFailed(false)
  }
  const mayRelease =
    !nativeQuestion &&
    recordLoaded &&
    active &&
    (!working || answering) &&
    !readOnly &&
    !locked &&
    !commandBusy &&
    !queueFailed
  const switchLocalDraft = () => {
    const next = localPrevious.find((item) => !item.nativeQuestionId)
    if (!next) return
    const previous = [...localPrevious.filter((item) => item !== next), draft]
    if (
      !retainDrafts(run.id, {
        current: next,
        previous,
        queue: {
          generation: run.generation,
          nativeSession: run.nativeSession,
          items: heldRef.current,
        },
      })
    )
      return
    setLocalPrevious(previous)
    change(next)
  }
  const switchDraft = onUseKeptDraft ?? (keptDrafts === undefined ? switchLocalDraft : undefined)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the release reads the latest props; only the turn's end and a new held message start it.
  useEffect(() => {
    if (mayRelease && held.length > 0 && !sending.current) void release()
  }, [mayRelease, held])
  // A quick message from where the person marked: sent as if typed here, or queued behind the turn,
  // a question or a resume; it never touches the person's own draft.
  const hold = (item: MessageDraft): boolean => {
    const key = (heldRef.current.at(-1)?.key ?? 0) + 1
    return updateHeld((list) => [...list, { ...item, key }])
  }
  const receiveQuickAsk = async (item: MessageDraft): Promise<QuickAskResult> => {
    if (!active) {
      if (!canResume || earlierTask || task === undefined)
        return {
          status: "failed",
          reason: `${agentName} stopped. Continue the task, then send again.`,
        }
      // The planner (or builder) wakes by being sent the message: the session resumes and takes it.
      holdForResume(task, item)
      onResume()
      return { status: "queued", where: "conversation" }
    }
    if (viewer?.canType !== true)
      return {
        status: "failed",
        reason: "Another window controls this session. Take control, then send.",
      }
    if (queueing || messageBlocked.current || sending.current || uploading || busy) {
      if (!hold(item))
        return {
          status: "failed",
          reason: "The draft limit is full. Send or remove a draft first.",
        }
      return { status: "queued", where: "conversation" }
    }
    sending.current = true
    setUploading(true)
    try {
      if (!(await deliver(item)))
        return { status: "failed", reason: `${agentName} didn’t get the message. Try again.` }
      markSent(item.text)
      return { status: "delivered", where: "conversation" }
    } finally {
      sending.current = false
      setUploading(false)
    }
  }
  useQuickAskReceiver(task, !readOnly && recordLoaded, receiveQuickAsk, "conversation", on)
  // A message that waited while the session resumed joins the queue of the resumed window.
  // biome-ignore lint/correctness/useExhaustiveDependencies: taken once when the resumed session is ready
  useEffect(() => {
    if (task === undefined || !active || readOnly || !recordLoaded) return
    for (const item of takeHeldForResume(task)) hold(item)
  }, [task, active, readOnly, recordLoaded])
  if (readOnly) return null
  if (!active) {
    const freshPending = run.fresh?.generation === run.generation && run.fresh.state !== "started"
    return (
      <div className="cv-ended">
        {freshPending ? (
          <>
            <b>The fresh conversation is not ready</b>
            <p>
              The previous agent stopped safely. Its conversation, your draft and attachments are
              kept.
            </p>
            <Disclosure head="Kept draft">
              <p>{text || "No message text"}</p>
              {files.length ? <p>{files.map((file) => file.name).join(" · ")}</p> : null}
            </Disclosure>
            {problem ? <p role="alert">{problem}</p> : null}
            <p>Choose one way to continue. Nothing restarts automatically.</p>
            <button
              type="button"
              className="q-btn sm"
              disabled={busy || commandBusy || !canResume}
              onClick={onResume}
            >
              Resume previous
            </button>{" "}
            {viewer?.controller ? (
              <button
                type="button"
                className="q-btn primary sm"
                disabled={busy || commandBusy || !run.canFresh || !command}
                onClick={() => void executeCommand("fresh", true)}
              >
                {commandBusy ? "Starting fresh…" : "Retry fresh"}
              </button>
            ) : viewer?.canTakeControl ? (
              <button type="button" className="q-btn sm" disabled={busy} onClick={onTakeControl}>
                Take control to retry fresh
              </button>
            ) : (
              <button type="button" className="q-link" onClick={onShowTerminal}>
                Reconnect in Terminal
              </button>
            )}
          </>
        ) : (
          <>
            <p>{agentName} stopped. The conversation and the work so far are kept.</p>
            {canResume && !earlierTask ? (
              <button type="button" className="q-btn primary sm" disabled={busy} onClick={onResume}>
                Continue this task
              </button>
            ) : null}
          </>
        )}
      </div>
    )
  }
  const submit = async () => {
    if (nativeQuestion) {
      nativeSubmit.current?.()
      return
    }
    if (
      locked ||
      sending.current ||
      commandSending.current ||
      (!text.trim() && files.length === 0 && !draft.context)
    )
      return
    const nativeToken = text.trim().split(/\s/)[0] ?? ""
    if (["/compact", "/clear", "/new"].includes(nativeToken) && selectedSkill !== nativeToken) {
      const action = nativeToken === "/compact" ? "compact" : "fresh"
      const option = isNativeAgent(run.agent)
        ? commandOptions(run.agent, nativeToken, discovered.catalog, !working).find(
            (entry) => entry.action === action,
          )
        : undefined
      if (
        !command ||
        !option ||
        option.disabled ||
        !(supportsCommands ?? []).includes(action) ||
        text.trim() !== nativeToken
      ) {
        closeCommands(true)
        onShowTerminal()
        return
      }
      confirmCommand(action)
      closeCommands(true)
      return
    }
    if (
      nativeToken.startsWith("/") &&
      !discovered.catalog?.skills.some((skill) => skill.invocation === nativeToken)
    ) {
      closeCommands(true)
      onShowTerminal()
      return
    }
    if (queueing) {
      // The agent is busy: the message waits here until its turn ends or the person sends it now.
      const key = (heldRef.current.at(-1)?.key ?? 0) + 1
      if (!updateHeld((list) => [...list, { ...draft, key }], emptyMessageDraft())) return
      setProblem(undefined)
      return
    }
    sending.current = true
    setUploading(true)
    try {
      if (!(await deliver(draft))) return
      setProblem(undefined)
      change(emptyMessageDraft())
    } catch (cause) {
      setProblem(
        cause instanceof Error ? cause.message : "Could not send your message. Your draft is kept.",
      )
    } finally {
      sending.current = false
      setUploading(false)
    }
  }
  const key = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.nativeEvent.isComposing
    )
      return
    if (menuOpen) {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        closeCommands(true)
        return
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        selectCommand(
          (value) =>
            (value + (event.key === "ArrowDown" ? 1 : -1) + entries.length) %
            Math.max(1, entries.length),
        )
        return
      }
      if (
        (event.key === "Enter" || event.key === "Tab") &&
        !event.shiftKey &&
        entries[commandSelected]
      ) {
        event.preventDefault()
        if (!event.repeat) chooseCommand(entries[commandSelected])
        return
      }
    }

    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (!event.repeat) void submit()
    } else if (event.key === "Escape" && going && interruptible) {
      event.preventDefault()
      event.stopPropagation()
      void onInterrupt()
    }
  }
  return (
    <div className="cv-compose">
      {nativeQuestion ? (
        <Question
          key={`${nativeAnswerOwner(run)}:${nativeQuestion.id}`}
          question={nativeQuestion}
          answer={answerQuestion}
          send={send}
          readOnly={readOnly || viewer?.canType !== true}
          onTerminal={onShowTerminal}
          onDone={onQuestionDone}
          composer={{
            text,
            change: (value) => change((before) => ({ ...before, text: value })),
            choices: draft.nativeChoices,
            changeChoices: (choices, clearText) =>
              change((before) => ({
                ...before,
                nativeChoices: choices,
                ...(clearText ? { text: "" } : {}),
              })),
            ready: setNativeReady,
            submit: nativeSubmit,
            files,
            draftId: draft.id,
            nativeQuestionId: draft.nativeQuestionId,
            busy: setNativeSending,
            accepted: (id) => {
              const current = latest.current
              if (current.draft.id === id) current.change(current.blankAnswer)
            },
          }}
        />
      ) : null}
      {nativeQuestion || asking ? (
        hasHeldContext ? (
          <p className="cv-context-held" role="status">
            Context kept while you answer.
          </p>
        ) : null
      ) : null}
      {!nativeQuestion && !asking && (pending.length > 0 || held.length > 0) ? (
        <ul className="cv-queue" aria-label="Messages waiting to appear">
          {pending.map((item) => (
            <li key={`sent-${item.key}`}>
              <span className="cv-queue-tag">Awaiting agent</span>
              <span className="cv-queue-text">{item.text}</span>
            </li>
          ))}
          {held.map((item) => (
            <li key={`held-${item.key}`} data-held="true">
              <span className="cv-queue-tag">Queued</span>
              <span className="cv-queue-text">{heldLabel(item)}</span>
              {sendable.ok ? (
                <button
                  type="button"
                  className="q-link"
                  disabled={locked}
                  onClick={() => void interruptAndSend(item)}
                >
                  Interrupt and send
                </button>
              ) : (
                <span className="cv-queue-after" title={sendable.why}>
                  Sent after this turn
                </span>
              )}
              <button
                type="button"
                className="cv-queue-x"
                aria-label="Remove from queue"
                title="Remove from queue · keeps the words in the composer"
                disabled={locked}
                onClick={() => removeHeld(item)}
              >
                <XIcon size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {draftLimit ? (
        <p className="cv-problem" role="status">
          The draft limit is full. Your latest edit wasn’t added; existing text and files are kept.
          Send or remove another draft, then try again.
        </p>
      ) : null}
      {!nativeQuestion && !asking && previousMessages.length && switchDraft ? (
        <p className="cv-note">
          {previousMessages.length} previous draft{previousMessages.length === 1 ? "" : "s"} also
          kept.{" "}
          <button type="button" className="q-link" onClick={switchDraft}>
            Switch drafts
          </button>
        </p>
      ) : null}
      {commandNotice ? (
        <p className="cv-note" role="status">
          {commandNotice}
        </p>
      ) : null}
      {commandConfirm ? (
        <section
          className="cv-command-confirm"
          aria-label={
            commandConfirm === "fresh" ? "Start fresh conversation" : "Compact conversation"
          }
        >
          <b>
            {commandConfirm === "fresh"
              ? "Start a fresh conversation?"
              : "Compact this conversation?"}
          </b>
          <p>
            {commandConfirm === "fresh"
              ? "A new agent conversation continues this task from its current step. The previous conversation stays available. Your draft and attachments move only after the new session is verified; if it fails, they stay here."
              : "The agent summarizes older messages. Its saved history stays available; compaction can use agent tokens."}
          </p>
          <div>
            <button
              type="button"
              className="q-btn sm"
              disabled={commandBusy}
              onClick={() => confirmCommand(undefined)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="q-btn primary sm"
              disabled={commandBusy || locked || working}
              onClick={() => void executeCommand()}
            >
              {commandConfirm === "fresh" ? "Start fresh" : "Compact"}
            </button>
          </div>
        </section>
      ) : null}
      {problem ? (
        <p className="cv-problem" role="alert">
          {problem}
        </p>
      ) : null}
      {!contextReady && !nativeQuestion && !asking ? (
        <p className="cv-problem" role="alert">
          This context belongs to another workspace. Remove it or reopen its task before sending.
        </p>
      ) : null}
      <form
        className="cv-input"
        onDragOver={(event) => {
          if (!locked && attachFiles && event.dataTransfer.types.includes("Files"))
            event.preventDefault()
        }}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          add(event.dataTransfer.files)
        }}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {!nativeQuestion && !asking && draft.context ? (
          <ContextDraftAttachment
            context={draft.context}
            onRemove={() => {
              change(removeDraftContext(draft))
              document.getElementById(field)?.focus()
            }}
          />
        ) : null}
        {menuOpen && isNativeAgent(run.agent) ? (
          <CommandMenu
            id={menuId}
            agentName={agentName}
            agent={run.agent}
            text={text}
            catalog={discovered.catalog}
            entries={entries}
            selected={commandSelected}
            loading={discovered.loading}
            error={discovered.error}
            onSelect={chooseCommand}
            onRefresh={discovered.refresh}
            onTerminal={onShowTerminal}
          />
        ) : null}
        <Attachments
          files={pendingFiles}
          {...(!locked
            ? {
                onRemove: (index: number) => {
                  change({
                    ...draft,
                    files: files.filter((_, i) => i !== index),
                    id: crypto.randomUUID(),
                  })
                  setProblem(undefined)
                },
              }
            : {})}
        />
        <label className="cv-sr" htmlFor={field}>
          Message {agentName}
        </label>
        <textarea
          id={field}
          rows={1}
          value={text}
          disabled={inputLocked}
          placeholder={`Message ${agentName}`}
          aria-autocomplete={menuOpen ? "list" : "none"}
          aria-controls={menuOpen ? menuId : undefined}
          aria-activedescendant={
            menuOpen && entries[commandSelected] ? `${menuId}-${commandSelected}` : undefined
          }
          onChange={(event) => {
            closeCommands(false)
            selectCommand(0)
            if (selectedSkill && !event.target.value.startsWith(selectedSkill))
              selectSkill(undefined)
            change({ ...draft, text: event.target.value })
          }}
          onPaste={(event) => {
            if (event.clipboardData.files.length) {
              event.preventDefault()
              add(event.clipboardData.files)
            }
          }}
          onKeyDown={key}
        />
        <div className="cv-input-actions">
          <input
            ref={picker}
            className="cv-sr"
            type="file"
            multiple
            aria-label="Attach files to your message"
            tabIndex={-1}
            disabled={inputLocked || !attachFiles}
            onChange={(event) => {
              add(event.target.files)
              event.target.value = ""
            }}
          />
          <button
            type="button"
            className="cv-attach"
            aria-label="Attach files"
            title="Attach files"
            disabled={inputLocked || !attachFiles}
            onClick={() => picker.current?.click()}
          >
            <PaperclipIcon size={14} aria-hidden="true" />
          </button>
          {activity ? (
            <span
              className={`cv-activity ${activity.kind}`}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              aria-label={activity.label}
              title={activity.label}
              data-testid="composer-activity"
              data-activity={activity.kind}
            >
              <WhoMark
                who={
                  activity.kind === "working"
                    ? "agent"
                    : activity.kind === "waiting"
                      ? "you"
                      : activity.kind === "ready"
                        ? "quiet"
                        : "todo"
                }
                running={activity.kind === "working"}
              />
              <span className="cv-activity-text">{activity.text}</span>
            </span>
          ) : (
            <span className="cv-activity-gap" />
          )}
          {viewer?.canTakeControl && !viewer.canType ? (
            <button
              type="button"
              className="q-btn sm"
              disabled={busy}
              onClick={onTakeControl}
              title="Moves typing control from the other window to this one"
            >
              Take control
            </button>
          ) : null}
          <span className="cv-send-actions">
            {showMessageInterrupt ? (
              <button
                type="button"
                className="q-btn quiet sm"
                disabled={busy}
                onClick={onInterrupt}
                title="Interrupt · Esc"
              >
                <PauseIcon size={13} aria-hidden="true" />
                Interrupt
                <kbd>Esc</kbd>
              </button>
            ) : null}
            <button
              type="submit"
              className="q-btn primary sm"
              disabled={
                nativeQuestion
                  ? !nativeReady
                  : inputLocked ||
                    !contextReady ||
                    (!text.trim() && !files.length && !draft.context)
              }
            >
              <ArrowUpIcon size={13} aria-hidden="true" />
              {nativeQuestion ? "Submit" : uploading ? "Sending…" : "Send"}
            </button>
          </span>
        </div>
      </form>
      {queueing && text.trim() ? (
        <p className="cv-queue-hint">
          {delivery === "queue"
            ? "Sent after the current turn."
            : "This agent receives messages after its current turn."}
        </p>
      ) : null}
    </div>
  )
}
