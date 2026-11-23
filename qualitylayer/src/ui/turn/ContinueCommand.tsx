// The command that continues the task in an agent's window, with a Copy button: what a stopped
// agent's question card and the status of a Tell me more request point to.

import { CopyIcon } from "lucide-react"
import { toast } from "sonner"

export function ContinueCommand({
  command,
  testId = "focus-continue",
  copiedMessage = "Copied",
}: {
  command: string
  testId?: string
  copiedMessage?: string
}) {
  return (
    <div className="aa-cmd" data-testid={testId}>
      <code>{command}</code>
      <button
        type="button"
        className="q-btn quiet sm"
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(
            () => toast.success(copiedMessage),
            () => toast.error("Could not copy"),
          )
        }}
      >
        <CopyIcon aria-hidden="true" />
        Copy
      </button>
    </div>
  )
}
