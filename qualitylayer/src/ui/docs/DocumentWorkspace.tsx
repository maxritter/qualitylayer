import { useEffect } from "react"
import type { TaskSurfaceProps } from "../interaction/props.ts"
import { useDocumentFullSize, useDocumentRecord } from "./mode.ts"
import "./docs.css"
import { RecordReader } from "./RecordReader.tsx"

const INPUT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"])

function shouldIgnoreShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return true
  const el = document.activeElement as HTMLElement | null
  return Boolean(el?.isContentEditable || INPUT_TAGS.has(el?.tagName ?? ""))
}

export function DocumentWorkspace(props: TaskSurfaceProps) {
  const { children, task, onSidebar } = props
  const full = useDocumentFullSize()
  const record = useDocumentRecord()
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (shouldIgnoreShortcut(event)) return
      if (
        document.querySelector(
          '[role="dialog"][data-open], [role="menu"], [data-slot="select-positioner"][data-open]',
        )
      )
        return
      if (event.key.toLowerCase() === "c") {
        event.preventDefault()
        onSidebar("comments")
      } else if (event.key.toLowerCase() === "d") {
        event.preventDefault()
        onSidebar("artifacts")
      }
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  })
  return (
    <div className="ir-document" data-testid="document-workspace" data-full-size={full}>
      {record?.taskId === task.id ? <RecordReader surface={props} path={record.path} /> : children}
    </div>
  )
}
