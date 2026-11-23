import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react"
import type { PickerRequest, PickerResult } from "../core/conversation/codex-picker.ts"
import type { CommandCatalog } from "../core/conversation/commands/types.ts"
import type {
  ApprovalDecision,
  ConversationEvent,
  ConversationPage,
  ConversationSnapshot,
} from "../core/conversation/types.ts"
import type { Usage, UsagePeriod } from "../core/cost/usage.ts"
import type { Attachment } from "../core/interaction-docs/attachments.ts"
import type { AgentLimits } from "../core/limits/index.ts"
import type { ControlRequest, RunRecord, StartRequest } from "../core/run/contracts.ts"
import type { ViewerState } from "../core/run/protocol.ts"
import type { TurnChanges } from "../core/run/turn-snapshots.ts"
import type { NativeAnswerUpload } from "./agent-window/conversation/Question.tsx"
import type { TerminalOptions, TerminalView } from "./agent-window/view.ts"
import {
  closedTerminals,
  HANDOVER_KEY,
  keepClosed,
  useRunActions,
  useRunHandovers,
} from "./run-context-helpers.ts"
import { useRunNotifications } from "./run-context-notices.ts"
import { preferredBuildRun, type RunSupport } from "./runs-api.ts"
import {
  dispositionRuns,
  type TaskDispositionStore,
  useTaskDispositions,
} from "./task-disposition.ts"

export type RunWindow = RunRecord & {
  taskLifecycle?: { stage: string; archived: boolean }
  title: string
  resumeLine: string
  viewer?: ViewerState
  canConfigure?: boolean
  /** Why the model, effort and permissions cannot be changed from the App now; absent when they can. */
  settingsLocked?: string
  canResume?: boolean
  canStart?: boolean
  canRestart?: boolean
  canChangePermission?: boolean
  canFresh?: boolean
  pendingFresh?: boolean
  acceptedStopSequence?: number
  firstPromptAt?: string
  attention?: "waiting" | "attention" | "clear"
  truncated?: boolean
  requestSent?: boolean
  request?: string
  facts?: string
  settingsOpen?: boolean
}
export type RunStart = StartRequest
export type RunAction = ControlRequest["action"]
export type RunControlRequest = ControlRequest
export type WorkflowController = {
  run: string
  generation: number
  nativeSession: string
  proof: string
}
export interface RunAdapter {
  list(): Promise<RunWindow[]>
  start(request: RunStart, files?: readonly File[]): Promise<RunWindow>
  control(id: string, request: RunControlRequest): Promise<RunWindow | undefined>
  handoffWorkflow?(
    run: RunWindow,
    type: "feature" | "bugfix",
    proof: string,
    retry?: boolean,
    /** Start at the Plan from the Chat's saved plan instead of drafting it from the request. */
    fromSavedPlan?: boolean,
  ): Promise<{ handoff: "sent" | "already_sent" | "pending" | "uncertain" }>
  attach(run: RunWindow, options: TerminalOptions): TerminalView
  /** The session read from the agent's own record, after `after`; undefined when it cannot be read. */
  conversation?(
    run: RunWindow,
    after?: string,
    pickerProof?: string,
  ): Promise<ConversationSnapshot | undefined>
  /** The turns before the event `before`; undefined when the server no longer has them. */
  conversationEarlier?(run: RunWindow, before: string): Promise<ConversationPage | undefined>
  /** One event whole, when the session's read shortened it; undefined when the server no longer has it. */
  conversationEvent?(run: RunWindow, id: string): Promise<ConversationEvent | undefined>
  /** What the turns of the run changed in its worktree; undefined when the server cannot say. */
  turnChanges?(run: RunWindow): Promise<readonly TurnChanges[] | undefined>
  /**
   * Every agent's plan limits as it reports them; undefined when the server cannot say. Without `refresh`
   * the last reading answers and no agent is run; `refresh` is the person's explicit ask.
   */
  limits?(refresh?: boolean): Promise<readonly AgentLimits[] | undefined>
  /** What the agents used in a period, with the period before; undefined when the server cannot say. Reads when asked. */
  usage?(period: UsagePeriod): Promise<Usage | undefined>
  /** Reads only a linked child record; never grants child input authority. */
  conversationWorker?(
    run: RunWindow,
    worker: string,
    after?: string,
  ): Promise<ConversationSnapshot | undefined>
  commandCatalog?(run: RunWindow, refresh?: boolean): Promise<CommandCatalog>
  /** The Conversation view is no longer open on the session; best effort, never throws. */
  conversationClosed?(run: RunWindow): Promise<void>
  /** The person's answer to a permission the agent asks for; rejects with a plain message on failure. */
  answerApproval?(run: RunWindow, approval: string, answer: ApprovalDecision): Promise<void>
  answerPicker?(
    run: RunWindow,
    answer: PickerRequest | { callId: string; answers: Record<string, string[]> },
    proof: string,
    upload?: NativeAnswerUpload,
  ): Promise<PickerResult>
  /** Saves the selected files; sending their paths remains the controlling terminal's action. */
  attachFiles?(run: RunWindow, draft: string, files: readonly File[]): Promise<Attachment[]>
  subscribe?(changed: () => void): () => void
  support?(): RunSupport | undefined
}
type RunContextValue = {
  loaded: boolean
  runs: RunWindow[]
  openRuns: RunWindow[]
  selected: RunWindow | undefined
  select(id: string): void
  close(id: string): void
  refresh(): Promise<void>
  start(request: RunStart, files?: readonly File[]): Promise<RunWindow>
  control(id: string, request: RunControlRequest): Promise<RunWindow | undefined>
  adapter: RunAdapter
  error: string | undefined
  support: RunSupport | undefined
}
const RunContext = createContext<RunContextValue | null>(null)

export function RunProvider({
  adapter,
  children,
  taskDispositions,
}: {
  adapter: RunAdapter
  children: ReactNode
  taskDispositions?: TaskDispositionStore
}) {
  const [storedRuns, setRuns] = useState<RunWindow[]>([])
  const [loaded, setLoaded] = useState(false)
  const dispositions = useTaskDispositions(taskDispositions)
  const runs = useMemo(() => dispositionRuns(storedRuns, dispositions), [storedRuns, dispositions])
  const [selectedId, select] = useState<string>()
  const [closed, setClosed] = useState(closedTerminals)
  const [savedHandovers] = useState(() => closedTerminals(HANDOVER_KEY))
  const handedOver = useRef(savedHandovers)
  const openRuns = runs.filter((run) => !closed.has(`${run.id}:${run.generation}`))
  const open = useCallback((id: string) => {
    setClosed((before) => {
      const next = new Set([...before].filter((key) => !key.startsWith(`${id}:`)))
      return next.size === before.size ? before : keepClosed(next)
    })
    select(id)
  }, [])
  const [error, setError] = useState<string>()
  const [support, setSupport] = useState<RunSupport>()
  const { refresh, start, control } = useRunActions({
    adapter,
    setRuns,
    setLoaded,
    setSupport,
    setError,
    open,
  })
  useRunHandovers(runs, closed, handedOver, setClosed, select)
  useRunNotifications(runs, closed, select, setRuns)
  const close = useCallback(
    (id: string) => {
      const run = runs.find((item) => item.id === id)
      if (!run) return
      setClosed((before) => keepClosed(new Set([...before, `${run.id}:${run.generation}`])))
      const remaining = openRuns.filter((item) => item.id !== id)
      select((before) =>
        before && before !== id ? before : (preferredBuildRun(remaining) ?? remaining.at(-1))?.id,
      )
    },
    [runs, openRuns],
  )
  const value = useMemo(
    () => ({
      loaded,
      runs,
      openRuns,
      selected:
        openRuns.find((run) => run.id === selectedId) ??
        preferredBuildRun(openRuns) ??
        openRuns.at(-1),
      select: open,
      close,
      refresh,
      start,
      control,
      adapter,
      error,
      support,
    }),
    [
      loaded,
      runs,
      openRuns,
      selectedId,
      open,
      close,
      refresh,
      start,
      control,
      adapter,
      error,
      support,
    ],
  )
  return <RunContext.Provider value={value}>{children}</RunContext.Provider>
}
export function useRuns() {
  const context = useContext(RunContext)
  if (!context) throw new Error("useRuns needs RunProvider")
  return context
}
export function useOptionalRuns() {
  return useContext(RunContext)
}
