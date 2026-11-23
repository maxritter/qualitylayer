// Home lists this person's task decisions and running agent sessions.
import { useEffect, useRef, useState } from "react"
import type { MemoryOverview } from "../memory-contracts.ts"
import type { Api, HomeQuestion, TaskSummary } from "./api.ts"
import { AllClear, UnfinishedRequest } from "./home/QuietParts.tsx"
import { HomeHeader, NeedsYouSection, RunningSection } from "./home-parts.tsx"
import {
  buildHomeRunningEntries,
  collectHomeManagedRuns,
  isTaskAtWork,
  managedRepresentatives,
} from "./home-runs.ts"
import { Shipped, ShippedLately } from "./home-shipped.tsx"
import { type Route, useEventCount } from "./hooks.ts"
import { endedChat, type Need } from "./model.ts"
import { runAttention } from "./run-attention.ts"
import { useOptionalRuns } from "./run-context.tsx"
import { runTaskId } from "./runs-api.ts"
import { QueueRow, SHOW_FIRST, SHOW_MORE } from "./shell/HomeQueue.tsx"
import { historyAt as closedAt } from "./shell/lines.ts"
import "./shell/home.css"

type Props = {
  api: Api
  tasks: TaskSummary[]
  project: string
  agent: string
  need: Need
  onNeed: (need: Need) => void
  go: (route: Route) => void
  onCopy: (text: string, note: string) => void
  reload: () => void
  now?: number
  homeQuestions?: HomeQuestion[]
  onReloadQuestions?: () => void
  /** Opens New task under the pressed button (All clear's New task). */
  onNewTask?: (button: HTMLElement) => void
  /** What was typed into New task and left there; Continue reopens the card, Discard clears it. */
  unfinished?: { request: string; project?: string } | null
  onContinueUnfinished?: (button: HTMLElement) => void
  onDiscardUnfinished?: () => void
}

function useHomeMemories(memoryApi: Api["memory"], project: string): MemoryOverview | null {
  const [memories, setMemories] = useState<MemoryOverview | null>(null)
  const memoryScope = useRef({ api: memoryApi, project })
  const memoryVersion = useEventCount("memory")
  // biome-ignore lint/correctness/useExhaustiveDependencies: memoryVersion invalidates this read on a paced catalog event.
  useEffect(() => {
    let current = true
    if (memoryScope.current.api !== memoryApi || memoryScope.current.project !== project) {
      setMemories(null)
      memoryScope.current = { api: memoryApi, project }
    }
    if (memoryApi) {
      void memoryApi
        .overview(project || undefined)
        .then((value) => {
          if (current) setMemories(value)
        })
        .catch(() => {})
    }
    return () => {
      current = false
    }
  }, [memoryApi, project, memoryVersion])
  return memories
}

function buildUnfinishedRow(
  unfiltered: boolean,
  unfinished: Props["unfinished"],
  onContinue: Props["onContinueUnfinished"],
  onDiscard: Props["onDiscardUnfinished"],
) {
  const draft = unfiltered && unfinished?.request.trim() ? unfinished : null
  if (!draft || !onContinue || !onDiscard) return null
  return (
    <UnfinishedRequest
      request={draft.request.trim()}
      project={draft.project}
      onContinue={onContinue}
      onDiscard={onDiscard}
    />
  )
}

export function Home({
  api,
  tasks,
  project,
  agent,
  need,
  go,
  reload,
  now = Date.now(),
  onNeed,
  onNewTask,
  unfinished = null,
  onContinueUnfinished,
  onDiscardUnfinished,
}: Props) {
  const memories = useHomeMemories(api.memory, project)
  const [shownYou, setShownYou] = useState(SHOW_FIRST)
  const [shownRunning, setShownRunning] = useState(SHOW_FIRST)
  const windows = useOptionalRuns()
  const managed = collectHomeManagedRuns(windows?.runs, tasks, agent, project)
  const { shell: groups, items } = runAttention({ tasks, project, agent, now }, windows?.runs ?? [])
  const attentionIds = new Set(items.map((item) => item.own.task.id))
  const running = groups.running.filter(
    (task) => !attentionIds.has(task.id) && !endedChat(task, now),
  )
  const listedIds = new Set([...attentionIds, ...running.map((task) => task.id)])
  const extraRuns = managedRepresentatives(
    managed.filter((run) => !!runTaskId(run) && !listedIds.has(runTaskId(run) ?? "")),
  )
  const runningCount = running.length + extraRuns.length
  const working = running.filter((task) => isTaskAtWork(task, managed, now)).length
  const runningNodes = buildHomeRunningEntries({ running, extraRuns, managed, tasks, now }).map(
    (entry) => (
      <QueueRow
        key={entry.key}
        row={entry.row}
        onOpen={() => {
          if (entry.selectRunId) windows?.select(entry.selectRunId)
          if (entry.taskId) go({ view: "task", id: entry.taskId, doc: null })
        }}
      />
    ),
  )
  const unfiltered = need === ""
  const allClear = unfiltered && items.length === 0 && runningCount === 0
  const unfinishedRow = buildUnfinishedRow(
    unfiltered,
    unfinished,
    onContinueUnfinished,
    onDiscardUnfinished,
  )
  const shippedLately = [...groups.shipped]
    .filter((t) => t.earlier !== true)
    .sort((a, b) => closedAt(b) - closedAt(a))
    .slice(0, 3)

  return (
    <div
      className="@container hf-home min-h-0 flex-1 overflow-auto"
      data-testid="home"
      data-scroll-root
    >
      <HomeHeader
        need={need}
        memories={memories}
        project={project}
        tasks={tasks}
        shippedCount={groups.shipped.length}
        archivedCount={groups.archived.length}
        go={go}
      />
      <div className="hf-grid">
        <div className="hf-main" data-testid="home-main-column">
          {allClear ? (
            <div className="hq-top">
              <AllClear onNewTask={unfinishedRow ? undefined : onNewTask} />
              {unfinishedRow}
            </div>
          ) : (
            <>
              {need === "" || need === "you" ? (
                <NeedsYouSection
                  items={items}
                  shown={shownYou}
                  working={working}
                  runningCount={runningCount}
                  now={now}
                  go={go}
                  onMore={() => setShownYou((n) => n + SHOW_MORE)}
                />
              ) : null}
              {need === "" || need === "running" ? (
                <RunningSection
                  working={working}
                  runningCount={runningCount}
                  shown={shownRunning}
                  nodes={runningNodes}
                  onMore={() => setShownRunning((n) => n + SHOW_MORE)}
                />
              ) : null}
              {unfinishedRow}
            </>
          )}
          {unfiltered ? (
            <ShippedLately
              shipped={shippedLately}
              now={now}
              go={go}
              onAll={() => onNeed("shipped")}
            />
          ) : null}
          {need === "shipped" ? (
            <Shipped
              api={api}
              shipped={[...groups.shipped].sort((a, b) => closedAt(b) - closedAt(a))}
              archived={[...groups.archived].sort((a, b) => closedAt(b) - closedAt(a))}
              now={now}
              go={go}
              reload={reload}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
