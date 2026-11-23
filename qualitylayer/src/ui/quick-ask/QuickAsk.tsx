// The quick field where the person marked (App Model: Ask agent where you mark): the place and a short
// quote, a box that grows as they write (up to six lines, then it scrolls), files from the paperclip, a
// paste or a drop, where it goes, and Send. Enter sends, Shift+Enter starts a new line. The message
// goes straight into the task's session; the field turns into a status at the same spot: Sending…,
// then in the conversation, typed into the terminal, or queued after the agent's step. When it does
// not arrive, the field comes back with the words and files kept and Try again.

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import type { MessageDraft } from "../agent-window/conversation/context-draft.ts"
import { sendQuickAsk, useQuickAskWhere } from "./deliver.ts"
import { QuickAskField } from "./QuickAskField.tsx"
import { type Failed, type Landed, type Status, StatusLine } from "./QuickAskParts.tsx"
import { closeQuickAsk, type QuickAskMark, useQuickAskMark } from "./store.ts"
import "./quick-ask.css"

function deliveredAnnouncement(result: Landed, agentName: string): string {
  if (result.status === "queued") return `Queued for ${agentName}`
  return result.where === "terminal"
    ? `Typed into ${agentName}’s terminal`
    : `In ${agentName}’s conversation`
}

export function QuickAskHost({
  task,
  agentName = "the agent",
  show,
}: {
  task: string
  /** The session's agent, for "Send to Claude Code". */
  agentName?: string
  /** Reveals the task's session panel so its window can take the message. */
  show?: () => void
}) {
  const mark = useQuickAskMark()
  const where = useQuickAskWhere(task)
  const [status, setStatus] = useState<Status | null>(null)
  const [failed, setFailed] = useState<Failed | null>(null)
  const [announce, setAnnounce] = useState("")
  useEffect(() => {
    if (status?.kind !== "done") return
    const timer = setTimeout(() => setStatus(null), 6000)
    return () => clearTimeout(timer)
  }, [status])
  useEffect(() => {
    if (mark) setStatus(null)
  }, [mark])
  const send = async (from: QuickAskMark, draft: MessageDraft) => {
    setFailed(null)
    setStatus({ kind: "sending", at: from.at })
    setAnnounce(`Sending to ${agentName}`)
    closeQuickAsk(from)
    const result = await sendQuickAsk(task, draft, { show })
    if (result.status === "failed") {
      setStatus(null)
      setAnnounce(`${agentName} did not get it. Your words and files are kept.`)
      setFailed({ mark: from, text: draft.text, files: draft.files, reason: result.reason })
      return
    }
    setStatus({ kind: "done", at: from.at, result })
    setAnnounce(deliveredAnnouncement(result, agentName))
  }
  const open = failed?.mark ?? mark
  // Drawn on the document's body, so it sits over the Review workspace and any page's stacking.
  return createPortal(
    <>
      {open ? (
        <QuickAskField
          key={`${open.place}:${open.at.x}:${open.at.y}:${failed ? "again" : ""}`}
          mark={open}
          agentName={agentName}
          where={where}
          failed={failed}
          onClose={() => {
            setFailed(null)
            closeQuickAsk(open)
          }}
          onSend={(draft) => void send(open, draft)}
        />
      ) : null}
      {status ? (
        <StatusLine
          status={status}
          agentName={agentName}
          show={show}
          onOpen={() => setStatus(null)}
        />
      ) : null}
      <span className="qa-sr" role="status" aria-live="polite">
        {announce}
      </span>
    </>,
    document.body,
  )
}
