import { useCallback, useEffect, useRef, useState } from "react"
import { useTerminalLayout } from "../agent-window/layout.tsx"
import type { TaskDetail } from "../api.ts"
import type { useDocumentReturn } from "../docs/mode.ts"
import { useCommandKeys } from "../kit/command-keys.ts"
import type { SidebarTab } from "../sidebar/RightSidebar.tsx"

type SidebarContext = {
  task: TaskDetail
  railOpen: boolean
  onRail: (open: boolean) => void
  artifactFile: string | null
  fullScreen: boolean
  readingFrom: ReturnType<typeof useDocumentReturn>
  backToStage: () => void
}

const DIALOG_OR_POPUP_SELECTOR =
  '[role="dialog"][data-open], [data-slot="select-positioner"][data-open], [data-testid="quick-ask"]'

function isEditableElement(target: EventTarget | null) {
  const el = target instanceof Element ? target : null
  if (el?.closest(".q-run-terminal")) return true
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)
}

function shouldIgnoreSidebarKey(event: KeyboardEvent) {
  if ((event.key !== "Escape" && event.key !== "]") || event.defaultPrevented) return true
  if (isEditableElement(event.target)) return true
  return document.querySelector(DIALOG_OR_POPUP_SELECTOR) !== null
}

function useSidebarKeyEffect({
  railOpen,
  closeSidebar,
  onRail,
  setSideTab,
  canReturnToStage,
  backToStage,
}: {
  railOpen: boolean
  closeSidebar: () => void
  onRail: (open: boolean) => void
  setSideTab: (tab: SidebarTab) => void
  canReturnToStage: boolean
  backToStage: () => void
}) {
  // Esc closes the sidebar while it is open, wherever the focus is, unless a field or a dialog has it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (shouldIgnoreSidebarKey(event)) return
      if (event.key === "]") {
        event.preventDefault()
        if (railOpen) closeSidebar()
        else {
          setSideTab("files")
          onRail(true)
        }
        return
      }
      if (canReturnToStage) {
        event.preventDefault()
        backToStage()
      } else if (railOpen) {
        closeSidebar()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [railOpen, closeSidebar, onRail, setSideTab, canReturnToStage, backToStage])
}

/** Owns the right sidebar's focus and keyboard controls: Conversation and Terminal, or Files. */
export function useTaskSidebar({
  task,
  railOpen,
  onRail,
  artifactFile,
  fullScreen,
  readingFrom,
  backToStage,
}: SidebarContext) {
  const terminalLayout = useTerminalLayout()
  const [sideTab, setSideTab] = useState<SidebarTab>("files")
  // Open when the page opens (a remembered choice): it has the focus at once.
  const [focusKey, setFocusKey] = useState(railOpen ? 1 : 0)
  const returnFocus = useRef(false)
  const defaultedFilesFor = useRef<string | null>(null)
  const outsideTask = task.outside !== undefined || task.start?.where === "here"
  useEffect(() => {
    if (!outsideTask || defaultedFilesFor.current === task.id) return
    defaultedFilesFor.current = task.id
    setSideTab("files")
    if (terminalLayout?.rightActive) terminalLayout.setPanel("files")
    if (!railOpen) onRail(true)
  }, [outsideTask, task.id, railOpen, onRail, terminalLayout])
  /** The task's session: Conversation or Terminal, whichever it shows. */
  const showConversation = () => {
    setFocusKey((n) => n + 1)
    terminalLayout?.setPanel("terminal")
    onRail(true)
  }
  /** The person opens the sidebar on a tab: it takes the focus. "comments" names the session now. */
  const showSidebar = (tab: SidebarTab | "comments") => {
    if (tab === "comments") {
      showConversation()
      return
    }
    if (terminalLayout?.rightActive) terminalLayout.setPanel("files")
    setSideTab(tab)
    if (!railOpen) setFocusKey((n) => n + 1)
    onRail(true)
  }
  const reopenSidebar = () => {
    if (!railOpen) setFocusKey((n) => n + 1)
    onRail(true)
  }
  /** Closed by its button or Esc: the focus goes back to the header's button. */
  const closeSidebar = useCallback(() => {
    returnFocus.current = true
    onRail(false)
  }, [onRail])
  useCommandKeys({
    sidebar: fullScreen ? undefined : () => (railOpen ? closeSidebar() : reopenSidebar()),
  })
  useEffect(() => {
    if (!railOpen && returnFocus.current) {
      returnFocus.current = false
      document.querySelector<HTMLElement>('[data-testid="sidebar-button"]')?.focus()
    }
  }, [railOpen])
  useSidebarKeyEffect({
    railOpen,
    closeSidebar,
    onRail,
    setSideTab,
    canReturnToStage: readingFrom?.taskId === task.id && artifactFile !== null,
    backToStage,
  })
  return {
    sideTab,
    setSideTab,
    focusKey,
    showSidebar,
    showConversation,
    reopenSidebar,
    closeSidebar,
  }
}
