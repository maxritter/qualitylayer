// The Review workspace opens from many places: the Review page's Your turn card, a file row of the Files
// tab, a file chip in the Conversation, a file ⌘K lists. They ask for it here, by task and file; the
// task's page holds the workspace itself (Host.tsx) and answers. The walkthrough publishes its summary
// here for the Your turn card, which reads how much of the code this person has read.

import { useEffect, useSyncExternalStore } from "react"

export type CodeSummary = { taskId: string; files: number; read: number; comments: number }

const OPEN = "ql:review-workspace-open"
/** How long an ask waits for a task page that is still mounting. */
const ASK_FRESH_MS = 3000

let summary: CodeSummary | null = null
let shown: string | null = null
let asked: { taskId: string; file: string | null; at: number; checked?: string } | null = null
const listeners = new Set<() => void>()
const changed = () => {
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The walkthrough's count of files, read files and the person's unsent comments; null when none. */
export function publishCodeSummary(next: CodeSummary | null): void {
  if (JSON.stringify(next) === JSON.stringify(summary)) return
  summary = next
  changed()
}

export function useCodeSummary(taskId: string): CodeSummary | null {
  const current = useSyncExternalStore(
    subscribe,
    () => summary,
    () => null,
  )
  return current !== null && current.taskId === taskId ? current : null
}

/**
 * Ask the task's page to open the workspace, at a file or at the first. A page that is still
 * opening takes the ask when it mounts; one that never does lets it go stale.
 */
export function openReviewWorkspace(
  taskId: string,
  file: string | null = null,
  checked?: string,
): void {
  asked = { taskId, file, at: Date.now(), ...(checked ? { checked } : {}) }
  window.dispatchEvent(new CustomEvent(OPEN, { detail: { taskId } }))
}

/** The task page's side: `open` runs for every ask for this task, and for one made just before it mounted. */
export function useReviewWorkspaceOpener(
  taskId: string,
  open: (file: string | null, checked?: string) => void,
): void {
  useEffect(() => {
    const take = () => {
      const ask = asked
      if (ask === null || ask.taskId !== taskId) return
      asked = null
      if (Date.now() - ask.at <= ASK_FRESH_MS) open(ask.file, ask.checked)
    }
    window.addEventListener(OPEN, take)
    take()
    return () => window.removeEventListener(OPEN, take)
  }, [taskId, open])
}

/** The task page tells the workspace is open (or closed): the walkthrough counts again when it closes. */
export function publishWorkspaceShown(taskId: string | null): void {
  if (shown === taskId) return
  shown = taskId
  changed()
}

export function useWorkspaceShown(taskId: string): boolean {
  return (
    useSyncExternalStore(
      subscribe,
      () => shown,
      () => null,
    ) === taskId
  )
}
