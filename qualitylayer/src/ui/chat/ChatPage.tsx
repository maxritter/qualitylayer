import { ArchiveIcon } from "lucide-react"
import { useContext, useEffect, useState } from "react"
import { parseArtifactReference } from "../../core/artifact/reference.ts"
import { ConversationActionsContext } from "../agent-window/conversation/actions.ts"
import { taskDocumentOf } from "../agent-window/conversation/model.ts"
import { RunDock, type TaskAgentControls } from "../agent-window/Dock.tsx"
import { useTerminalLayout } from "../agent-window/layout.tsx"
import type { Api, TaskDetail } from "../api.ts"
import { ReviewWorkspaceHost } from "../review-workspace/Host.tsx"
import type { AgentLaunchValue } from "../run/AgentLaunchFields.tsx"
import type { AgentTabTerminal } from "../run/AgentTab.tsx"
import { taskAgentEmpty } from "../run/OutsideLead.tsx"
import { TaskAgentLaunch } from "../run/TaskAgentLaunch.tsx"
import { useOptionalRuns, type WorkflowController } from "../run-context.tsx"
import { ChatHeader } from "./ChatHeader.tsx"
import { ArchiveConfirmDialog, ChatDocumentDialog, ChatPromoteDialog } from "./ChatPageDialogs.tsx"
import { useChatArchive } from "./use-chat-archive.ts"
import { useChatDocument, useChatLaunchConfig, usePendingChatArchive } from "./use-chat-page.ts"
import "./chat.css"

function openConversationFile({
  id,
  path,
  task,
  api,
  openDocument,
  onError,
  fallback,
}: {
  id: string
  path: string
  task: TaskDetail
  api: Api
  openDocument: (id: string, name: string) => Promise<void>
  onError: (message: string) => void
  fallback?: (id: string, path: string) => void
}) {
  const name = taskDocumentOf(path, id)
  if (name) {
    void openDocument(id, name)
    return
  }
  const ref = path.includes("/") ? parseArtifactReference(path) : null
  if (!ref) {
    fallback?.(id, path)
    return
  }
  const scopeId = ref.scope === "task" ? task.id : task.project
  void api
    .artifactOpen({ scope: ref.scope, id: scopeId }, ref.file, "browser", {
      viewer: true,
      section: ref.section,
    })
    .catch((error) =>
      onError(error instanceof Error ? error.message : "Could not open this artifact. Try again."),
    )
}

export function ChatPage({
  task,
  api,
  reload,
  theme = "light",
  onCopy,
  menu,
  onHandoffFlight,
  version = 0,
  onDeleted,
  archiveRequest,
  onArchiveRequested,
  plainTerminal,
  plainTerminalShown = false,
}: {
  task: TaskDetail
  api: Api
  reload(): void
  theme?: string
  onCopy(text: string, note: string): void
  menu?: { compact: boolean; onOpen(): void } | null
  onHandoffFlight?(active: boolean): void
  version?: number
  onDeleted?(): void
  archiveRequest?: number
  onArchiveRequested?(request: number): void
  plainTerminal?: AgentTabTerminal
  plainTerminalShown?: boolean
}) {
  const layout = useTerminalLayout()
  const runs = useOptionalRuns()
  const actions = useContext(ConversationActionsContext)
  const [problem, setProblem] = useState<string>()
  const [sessionControls, setSessionControls] = useState<TaskAgentControls>()
  const [promote, setPromote] = useState(false)
  const [workflowController, setWorkflowController] = useState<WorkflowController>()
  const [choice, setChoice] = useState<AgentLaunchValue>()
  const [outside, setOutside] = useState(false)
  const { config, installed } = useChatLaunchConfig(api, runs !== null, setProblem)
  const { document, openDocument, closeDocument } = useChatDocument(api, task.id)
  useEffect(() => {
    layout?.setPanel("terminal")
  }, [layout?.setPanel])
  const archive = useChatArchive({
    task,
    api,
    runs: runs?.runs ?? [],
    controls: sessionControls,
    reload,
  })
  usePendingChatArchive({
    archiveRequest,
    onArchiveRequested,
    archive,
    runs,
    task,
    sessionControls,
  })
  const shownProblem = archive.problem ?? problem
  return (
    <section
      className="q-chat-page"
      aria-label="Chat"
      data-testid="chat-page"
      data-compact={menu?.compact ? true : undefined}
    >
      <ChatHeader
        task={task}
        api={api}
        reload={reload}
        onCopy={onCopy}
        version={version}
        onDeleted={onDeleted}
        onArchive={archive.request}
        onConvert={() => setPromote(true)}
        menu={menu}
        sessionControls={sessionControls}
        plainTerminal={plainTerminal}
        plainTerminalShown={plainTerminalShown}
      />
      {shownProblem && !archive.confirm ? (
        <p className="q-chat-problem" role="alert">
          {shownProblem}
        </p>
      ) : null}
      {task.archived ? (
        <div className="q-chat-lifecycle" role="status">
          <ArchiveIcon size={14} aria-hidden="true" />
          <span>{archive.live ? "Archived · session still running" : "Archived"}</span>
          <button
            type="button"
            className="q-link"
            disabled={archive.busy}
            onClick={() => void archive.request()}
          >
            Restore task
          </button>
        </div>
      ) : null}
      <div className="q-chat-body" ref={layout?.sidebarBody}>
        {!runs ? (
          <div className="q-chat-empty">
            <h2>No App session connected</h2>
            <p>Start or reconnect the App agent to continue.</p>
          </div>
        ) : null}
      </div>
      <ConversationActionsContext
        value={{
          ...actions,
          openFile: (id, path) =>
            openConversationFile({
              id,
              path,
              task,
              api,
              openDocument,
              onError: setProblem,
              fallback: actions.openFile,
            }),
        }}
      >
        {!plainTerminalShown ? (
          <RunDock
            currentTask={task.id}
            onWorkflowController={setWorkflowController}
            onTaskControls={setSessionControls}
            taskAgent
            agentReadOnly={task.archived || task.stage === "abandoned"}
            followOutside={task.outside !== undefined}
            agentView="conversation"
            taskTitles={{ [task.id]: task.title }}
            onOpenTaskFile={(id, name) => void openDocument(id, name)}
            agentEmpty={taskAgentEmpty(
              task,
              <div className="q-chat-empty">
                <h2>No App session connected</h2>
                <p>
                  Start the agent to continue this conversation. Its work and previous messages are
                  kept.
                </p>
                <TaskAgentLaunch
                  task={task}
                  config={config}
                  installed={installed}
                  value={choice}
                  onChange={setChoice}
                  onCopy={onCopy}
                  outside={outside}
                  onOutside={setOutside}
                />
              </div>,
            )}
          />
        ) : null}
      </ConversationActionsContext>
      <ReviewWorkspaceHost task={task} api={api} live={undefined} reload={reload} />
      <ArchiveConfirmDialog
        open={archive.confirm}
        busy={archive.busy}
        problem={archive.problem}
        onClose={(open) => archive.close(open)}
        onAccept={archive.accept}
      />
      <ChatPromoteDialog
        open={promote}
        task={task}
        api={api}
        runs={runs}
        workflowController={workflowController}
        onHandoffFlight={onHandoffFlight}
        onClose={() => setPromote(false)}
        onPromoted={() => {
          setPromote(false)
          reload()
        }}
      />
      <ChatDocumentDialog
        document={document}
        task={task}
        api={api}
        theme={theme}
        onClose={closeDocument}
      />
    </section>
  )
}
