// The right sidebar: Conversation, Terminal and Files. A task's session draws its Conversation and
// Terminal tabs into the slot here; Files lists the task's documents, artifacts, records and its
// earlier feedback, read-only. A task page closes it with the header's toggle (Esc and ] do too), so
// the sidebar draws no second button; as a sheet, which covers the header, and on Home, which has no
// toggle while it is open, it keeps a button of its own. Closed, nothing of it stays on the right.

import { BotIcon, FolderIcon, PanelRightIcon, SquareTerminalIcon, XIcon } from "lucide-react"
import { type RefObject, useEffect, useRef } from "react"
import { useTerminalLayout } from "../agent-window/layout.tsx"
import { TerminalResizer } from "../agent-window/TerminalResizer.tsx"
import { type FilesArtifactContent, FilesTab } from "../docs/FilesTab.tsx"
import type { TaskSurfaceProps } from "../interaction/props.ts"
import { Hint } from "./Hint.tsx"

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

export function RightSidebar({
  open,
  tab,
  onTab,
  artifacts,
  artifactCount,
  artifactsNew = false,
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
  const choose = (next: "files") => {
    if (shared) terminalLayout.setPanel(next)
    onTab(next)
  }
  const label = taskAgent
    ? "Conversation, Terminal and Files"
    : shared
      ? "Files and Terminal"
      : "Files"
  return (
    <>
      {shared && (!taskAgent || open) && terminalLayout.sidebarTabId ? (
        <TerminalResizer sidebar onCollapse={onClose} />
      ) : null}
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
        <div className="rs-top">
          <div
            className={taskAgent ? "rs-seg rs-view-tabs" : "rs-seg"}
            role="tablist"
            aria-label={label}
            data-files={shared ? "true" : undefined}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
              const tabs = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]:not(:disabled):not([aria-disabled="true"])',
                ),
              ]
              const index = tabs.indexOf(event.target as HTMLButtonElement)
              if (index < 0) return
              event.preventDefault()
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length
              tabs[next]?.click()
              tabs[next]?.focus()
            }}
          >
            {shared && taskAgent ? (
              <span className="rs-agent-view-tabs" ref={open ? terminalLayout.views : undefined} />
            ) : shared ? (
              <button
                type="button"
                role="tab"
                id="rs-tab-terminal"
                aria-selected={shown === "terminal"}
                tabIndex={shown === "terminal" ? 0 : -1}
                aria-controls="terminal-right-panel"
                onClick={() => terminalLayout.setPanel("terminal")}
              >
                {taskAgent ? (
                  <BotIcon className="tab-ic" aria-hidden="true" />
                ) : (
                  <SquareTerminalIcon className="tab-ic" aria-hidden="true" />
                )}
                {taskAgent ? "Agent" : "Terminal"}
              </button>
            ) : null}
            <button
              type="button"
              role="tab"
              id="rs-tab-files"
              aria-label="Files"
              title="Files"
              aria-selected={shown === "files"}
              tabIndex={shown === "files" ? 0 : -1}
              aria-controls="rs-panel"
              onClick={() => choose("files")}
            >
              <FolderIcon className="tab-ic" aria-hidden="true" />
              <span className="rs-tab-label">Files</span>
              {artifactsNew ? (
                <span
                  className="dg-dot"
                  title="Updated since you looked"
                  data-testid="artifacts-new"
                />
              ) : artifactCount > 0 ? (
                <span className="rs-cnt">{artifactCount}</span>
              ) : null}
            </button>
          </div>
          {/* The active agent's menu stays in the same slot on every tab. */}
          {taskAgent && open ? (
            <span
              className="q-agent-controls-slot"
              style={{ minWidth: 26, height: 26 }}
              ref={terminalLayout.controls}
            />
          ) : null}
          {sheet || !headerToggle ? (
            <Hint label="Close the sidebar · Esc" side="left">
              <button
                type="button"
                className="rs-ib"
                aria-label="Close the sidebar"
                data-testid="sidebar-close"
                onClick={() => {
                  onClose()
                }}
              >
                {sheet ? (
                  <XIcon className="size-4" aria-hidden="true" />
                ) : (
                  <PanelRightIcon className="size-4" aria-hidden="true" />
                )}
              </button>
            </Hint>
          ) : null}
        </div>
        {notice !== null ? (
          <div className="rs-auto" role="status" data-testid="auto-open-notice">
            <span>{notice}</span>
            <button type="button" className="q-link" onClick={onClose}>
              Close
            </button>
            <span className="rs-kbd" aria-hidden="true">
              Esc
            </span>
          </div>
        ) : null}
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
            {surface !== undefined ? (
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
            ) : typeof artifacts === "function" ? (
              artifacts(null)
            ) : (
              artifacts
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
