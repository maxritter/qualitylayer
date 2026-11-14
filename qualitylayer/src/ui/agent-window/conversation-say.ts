// A button elsewhere in the App puts a request into the task's Conversation composer. The visible
// window of that task takes it as its draft (nothing is sent: the person reads it and presses
// Send); when no window takes it, the caller says so and the words go to the clipboard instead.

import { useEffect } from "react"

const SAY = "qualitylayer:conversation-say"

type Ask = { task: string; text: string; taken: boolean }

/** The Conversation's side: `take` runs for each ask for this task while the window shows. */
export function useConversationSay(
  task: string | undefined,
  enabled: boolean,
  take: (text: string) => unknown,
): void {
  useEffect(() => {
    if (task === undefined || !enabled) return
    const listen = (event: Event) => {
      const ask = (event as CustomEvent<Ask>).detail
      if (ask.task !== task || ask.taken) return
      ask.taken = take(ask.text) !== false
    }
    window.addEventListener(SAY, listen)
    return () => window.removeEventListener(SAY, listen)
  }, [task, enabled, take])
}
