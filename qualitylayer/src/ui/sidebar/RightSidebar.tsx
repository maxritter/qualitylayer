// The right sidebar: Conversation, Terminal and Files. A task's session draws its Conversation and
// Terminal tabs into the slot here; Files lists the task's documents, artifacts, records and its
// earlier feedback, read-only. A task page closes it with the header's toggle (Esc and ] do too), so
// the sidebar draws no second button; as a sheet, which covers the header, and on Home, which has no
// toggle while it is open, it keeps a button of its own. Closed, nothing of it stays on the right.

import { type RefObject, useEffect, useRef } from "react"
import { useTerminalLayout } from "../agent-window/layout.tsx"
import { TerminalResizer } from "../agent-window/TerminalResizer.tsx"
import { type FilesArtifactContent, FilesTab } from "../docs/FilesTab.tsx"
import type { TaskSurfaceProps } from "../interaction/props.ts"
import { RightSidebarHeader } from "./RightSidebarHeader.tsx"

export type SidebarTab = "files" | "artifacts"

/** The sidebar takes the focus each time the person opens it, unless a dialog open over the page holds it. */
function useTakeFocus(side: RefObject<HTMLElement | null>, focusKey: number) {
  useEffect(() => {
    const aside = side.current
    if (focusKey === 0 || aside === null || aside.contains(document.activeElement)) return
    const dialog = document.activeElement?.closest('[role="dialog"]')
    if (dialog && !dialog.contains(aside)) return
    aside.focus({ preventScroll: true })
  }, [side, focusKey])
}

function RightSidebarNotice({ notice, onClose }: { notice: string | null; onClose: () => void }) {
  if (notice === null) return null
  return (
    <div className="rs-auto" role="status" data-testid="auto-open-notice">
      <span>{notice}</span>
      <button type="button" className="q-link" onClick={onClose}>
        Close
      </button>
      <span className="rs-kbd" aria-hidden="true">
        Esc
      </span>
    </div>
  )
}

function RightSidebarFiles({
  surface,
  artifacts,
  sheet,
  onClose,
}: {
  surface?: TaskSurfaceProps
  artifacts: FilesArtifactContent
  sheet: boolean
  onClose: () => void
}) {
  if (surface !== undefined) {
    return (
      <FilesTab
        task={surface.task}
        view={surface.view}
        onOpen={(view) => {
          if (sheet) onClose()
          surface.onOpen(view)
        }}
        api={surface.api}
        onCopy={surface.onCopy}
        artifacts={artifacts}
        version={surface.version}
      />
    )
  }
  return <>{typeof artifacts === "function" ? artifacts(null) : artifacts}</>
}

export function RightSidebar({
  open,
  tab,
  onTab,
  artifacts,
  artifactCount,
  artifactsNew = false,
  filesFirst = false,
  notice = null,
  onClose,
  focusKey,
  sheet = false,
  headerToggle = false,
  surface,
}: {
  /** DOCS can render Files and document navigation without changing TaskView. */
  surface?: TaskSurfaceProps
  /** Shown; hidden, it cannot be reached by keyboard. */
  open: boolean
  tab: SidebarTab
  onTab: (tab: SidebarTab) => void
  /** The Artifacts tab's content. */
  artifacts: FilesArtifactContent
  /** How many artifacts the Artifacts tab lists. */
  artifactCount: number
  /** An artifact changed since this viewer looked: a dot instead of the count. */
  artifactsNew?: boolean
  /** Put Files first on the left (when working outside the QualityLayer App). */
  filesFirst?: boolean
  /** A line under the tabs when it opened by itself; null otherwise. */
  notice?: string | null
  onClose: () => void
  /** Changes each time the person opens it: the sidebar takes the focus then, never when it opened by itself. */
  focusKey: number
  /** Drawn as a sheet over the page (a narrow window): its button is a cross. */
  sheet?: boolean
  /** The page's header has the toggle that closes it: no second button here (a sheet keeps its cross). */
  headerToggle?: boolean
}) {
  const side = useRef<HTMLElement | null>(null)
  const terminalLayout = useTerminalLayout()
  const shared = terminalLayout?.rightActive === true
  const taskAgent = terminalLayout?.taskAgent !== undefined
  useTakeFocus(side, focusKey)
  const shown: "files" | "terminal" =
    shared && terminalLayout.panel === "terminal" ? "terminal" : "files"
  useEffect(() => {
    if (!shared && tab !== "artifacts") terminalLayout?.rememberSidebar(tab)
  }, [shared, tab, terminalLayout?.rememberSidebar])
  const chooseFiles = () => {
    if (shared) terminalLayout.setPanel("files")
    onTab("files")
  }
  const label = taskAgent
    ? "Conversation, Terminal and Files"
    : shared
      ? "Files and Terminal"
      : "Files"
  const showResizer = shared && (!taskAgent || open) && Boolean(terminalLayout.sidebarTabId)
  return (
    <>
      {showResizer ? <TerminalResizer sidebar onCollapse={onClose} /> : null}
      <aside
        ref={side}
        tabIndex={-1}
        className="rs-side"
        aria-label={label}
        data-task-agent={taskAgent ? "true" : undefined}
        data-testid="right-sidebar"
        data-tab={shown}
        inert={!open && (taskAgent || !shared)}
      >
        <RightSidebarHeader
          label={label}
          shared={shared}
          taskAgent={taskAgent}
          filesFirst={filesFirst}
          open={open}
          shown={shown}
          terminalLayout={terminalLayout ?? null}
          artifactsNew={artifactsNew}
          artifactCount={artifactCount}
          sheet={sheet}
          headerToggle={headerToggle}
          onChooseFiles={chooseFiles}
          onClose={onClose}
        />
        <RightSidebarNotice notice={notice} onClose={onClose} />
        <div
          className="rs-body rs-preserved-panels"
          data-terminal-tab="rs-tab-terminal"
          ref={taskAgent && !open ? undefined : terminalLayout?.sidebarBody}
          id="rs-panel"
          role="tabpanel"
          aria-labelledby={`rs-tab-${shown}`}
          aria-hidden={shown === "terminal" ? true : undefined}
        >
          <div className="rs-preserved-panel" hidden={shown !== "files"}>
            <RightSidebarFiles
              surface={surface}
              artifacts={artifacts}
              sheet={sheet}
              onClose={onClose}
            />
          </div>
        </div>
      </aside>
    </>
  )
}
