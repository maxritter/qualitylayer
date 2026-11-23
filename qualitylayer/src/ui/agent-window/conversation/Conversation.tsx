// The Conversation view of an agent's window: the same session the terminal shows, read from the
// agent's own record and drawn as messages, thinking, tool calls, task files, state and usage. The
// terminal stays the engine; messages typed here go into it as a person would type them.
import { useRef, useState } from "react"
import type { ConversationWorker } from "../../../core/conversation/types.ts"
import { addAwaiting, dismissAwaiting } from "./awaiting.ts"
import { ChildConversation, WorkerTray } from "./ChildConversation.tsx"
import { Composer } from "./Composer.tsx"
import { ConversationLogBody, DeliveryNotice } from "./ConversationBody.tsx"
import { ConversationTurnObserver } from "./conversation-state.ts"
import type { ConversationProps } from "./conversation-types.ts"
import { SessionFooter } from "./Footer.tsx"
import { footerStatus } from "./footer-values.ts"
import { TaskList } from "./TaskList.tsx"
import { useConversationView, wrapAnswerQuestion } from "./use-conversation-view.ts"
import "./conversation.css"

export { emptyMessageDraft, type MessageDraft } from "./context-draft.ts"
export type { ConversationProps }
export { ConversationTurnObserver }

function SelectedWorkerOverlay({
  selectedChild,
  runKey,
  workers,
  run,
  on,
  output,
  loadWorker,
  waiting,
  working,
  onBack,
}: {
  selectedChild: ConversationWorker | undefined
  runKey: string
  workers: readonly ConversationWorker[]
  run: ConversationProps["run"]
  on: boolean
  output: ConversationProps["output"]
  loadWorker: ConversationProps["loadWorker"]
  waiting: boolean
  working: boolean
  onBack(message: boolean): void
}) {
  if (!selectedChild) return null
  const worker = workers.find((item) => item.id === selectedChild.id) ?? selectedChild
  const load = loadWorker ? (after?: string) => loadWorker(selectedChild.id, after) : undefined
  return (
    <ChildConversation
      key={`${runKey}:${selectedChild.id}`}
      worker={worker}
      run={run}
      on={on}
      output={output}
      load={load}
      running={workers.some((item) => item.id === selectedChild.id)}
      mainWaiting={waiting}
      mainWorking={working}
      onBack={onBack}
    />
  )
}

function ConversationFooter({
  props,
  view,
  usageOpen,
  onUsageOpen,
}: {
  props: ConversationProps
  view: ReturnType<typeof useConversationView>
  usageOpen: boolean
  onUsageOpen(open: boolean): void
}) {
  const { run, agentName, on, active, readOnly, task } = props
  const onViewChanges =
    task && view.actions.viewChanges ? () => view.actions.viewChanges?.(task) : undefined
  const editable =
    props.canConfigure === true && !readOnly && (!active || props.viewer?.canType === true)
  return (
    <SessionFooter
      run={run}
      model={view.settings.model}
      effort={view.settings.effort}
      unknown={view.settings.unknown}
      agentName={agentName}
      editable={editable}
      busy={props.busy}
      apply={props.applySettings ?? (async () => false)}
      on={on}
      turn={view.ended}
      loadLimits={props.loadLimits}
      loadUsage={props.loadUsage}
      changes={view.sessionTotal}
      onViewChanges={onViewChanges}
      openRequest={props.openSettings}
      onOpenHandled={props.onSettingsOpened}
      status={footerStatus({
        word: view.state.word,
        who: view.state.who,
        readOnly,
        working: view.working,
        failing: view.failing,
      })}
      usage={view.loaded && !view.loaded.hasMore ? view.loaded.usage : undefined}
      usageOpen={usageOpen}
      onUsageOpen={onUsageOpen}
      span={view.span}
    />
  )
}

export function Conversation(props: ConversationProps) {
  const { run, agentName, on, active, onShowTerminal, task } = props
  const view = useConversationView(props)
  const [usageOpen, setUsageOpen] = useState(false)
  const mainScroll = useRef(0)
  const container = useRef<HTMLDivElement>(null)
  const openWorker = (worker: ConversationWorker) => {
    mainScroll.current = view.log.current?.scrollTop ?? 0
    view.follow.current = false
    view.childState.select(worker)
  }
  const backToMain = (message: boolean) => {
    view.childState.clear()
    requestAnimationFrame(() => {
      if (view.log.current) view.log.current.scrollTop = mainScroll.current
      const selector = message ? "textarea" : ".cv-worker-row"
      container.current?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true })
    })
  }
  const selectedChild = view.childState.selectedChild
  return (
    <div className="cv" ref={container} id="conversation-view" data-state={view.state.word}>
      <div
        className={`cv-main${selectedChild ? " cv-main-covered" : ""}`}
        aria-hidden={selectedChild ? true : undefined}
        inert={selectedChild ? true : undefined}
      >
        <ConversationLogBody
          loading={view.loading}
          unavailable={view.unavailable}
          run={run}
          agentName={agentName}
          opens={view.opens}
          log={view.log}
          follow={view.follow}
          blocks={view.blocks}
          ctx={{
            agentName,
            agent: run.agent,
            cwd: run.cwd,
            task,
            onShowTerminal,
            onOpenTaskFile: props.onOpenTaskFile,
            showMore: view.showMore,
            hidden: view.hidden,
          }}
          live={view.live}
          asking={view.asking}
          answers={view.answers}
          changes={view.changes}
          loaded={view.loaded}
          catchupLimited={view.catchupLimited}
          failing={view.failing}
          earlier={view.earlier}
          active={active}
          answer={props.answer}
          showTerminalAsk={view.showTerminalAsk}
          refresh={view.refresh}
          onAnswered={view.answered}
          onShowTerminal={onShowTerminal}
        />
        <WorkerTray
          workers={view.workers}
          incomplete={view.incomplete}
          now={view.now}
          onSelect={openWorker}
          onShowTerminal={onShowTerminal}
        />
        {view.showQuestion ? null : <TaskList checklist={view.loaded?.checklist} />}
        {view.waits
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
          waiting={view.waiting}
          answerQuestion={wrapAnswerQuestion(props.answerQuestion, view.refresh)}
          nativeQuestion={view.showQuestion ? (view.nativeQuestion ?? undefined) : undefined}
          onQuestionDone={() => {
            if (view.nativeQuestion) view.dismissQuestion(view.nativeQuestion.id)
            view.refresh()
          }}
          on={on && selectedChild === undefined}
          onShowUsage={() => (view.loaded?.usage ? setUsageOpen(true) : onShowTerminal())}
          working={view.working}
          recordLoaded={view.loaded !== undefined}
          activity={view.activity}
          pending={view.waits.filter((item) => !item.unconfirmed)}
          onSent={(text, transmitted) => {
            // The agent saves the message in its record: read it as soon as it can be there.
            view.refresh()
            addAwaiting(
              run,
              text,
              new Set(
                view.events.filter((event) => event.kind === "user").map((event) => event.id),
              ),
              Date.now(),
              transmitted,
            )
          }}
        />
        <ConversationFooter
          props={props}
          view={view}
          usageOpen={usageOpen}
          onUsageOpen={setUsageOpen}
        />
      </div>
      <SelectedWorkerOverlay
        selectedChild={selectedChild}
        runKey={view.runKey}
        workers={view.workers}
        run={run}
        on={on}
        output={props.output}
        loadWorker={props.loadWorker}
        waiting={view.waiting}
        working={view.working}
        onBack={backToMain}
      />
    </div>
  )
}
