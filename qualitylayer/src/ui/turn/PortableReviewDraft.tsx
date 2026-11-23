import { AlignLeftIcon, CopyIcon, ExternalLinkIcon, TypeIcon } from "lucide-react"
import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { ReviewDestination } from "../../core/integrations/review-destination.ts"
import { writeClipboardText } from "../clipboard.ts"
import { ReviewProviderIcon } from "./ReviewProviderIcon.tsx"

const names = { github: "GitHub", gitlab: "GitLab", bitbucket: "Bitbucket", other: "repository" }

export function PortableReviewDraft({
  destination,
  initialTitle,
  initialBody,
  onClose,
  plan,
}: {
  destination: ReviewDestination
  initialTitle: string
  initialBody: string
  onClose: () => void
  plan: boolean
}) {
  const [title, setTitle] = useState(initialTitle)
  const [body, setBody] = useState(initialBody)
  const [notice, setNotice] = useState("")
  const [manual, setManual] = useState<string | null>(null)
  const id = useId()
  const label = destination.provider === "gitlab" ? "merge request" : "pull request"
  const copy = async (text: string, what: string) => {
    if (await writeClipboardText(text)) {
      setManual(null)
      setNotice(`${what} copied`)
      return
    }
    setManual(text)
    setNotice("Select and copy the text below.")
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="q-portable-pr w-[min(760px,calc(100vw-24px))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>
            {plan ? `Plan ${label}` : label === "merge request" ? "Merge request" : "Pull request"}
          </DialogTitle>
          <DialogDescription className="q-pr-origin">
            <ReviewProviderIcon provider={destination.provider} />
            {destination.host
              ? [destination.host, destination.project].filter(Boolean).join(" · ")
              : "Local repository"}
          </DialogDescription>
        </DialogHeader>
        <div className="q-pr-fields">
          <div className="q-pr-field">
            <div>
              <label htmlFor={`${id}-title`}>
                <TypeIcon />
                Title
              </label>
              <Button variant="ghost" size="sm" onClick={() => void copy(title, "Title")}>
                <CopyIcon />
                Copy title
              </Button>
            </div>
            <Input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="q-pr-field">
            <div>
              <label htmlFor={`${id}-body`}>
                <AlignLeftIcon />
                Description
              </label>
              <Button variant="ghost" size="sm" onClick={() => void copy(body, "Description")}>
                <CopyIcon />
                Copy description
              </Button>
            </div>
            <textarea id={`${id}-body`} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <p className="text-sm text-muted-foreground">
            {destination.web
              ? `Paste this draft into the ${label} after pushing the branch you want reviewed.`
              : "Copy this draft into an existing review."}
          </p>
          {manual === null ? null : (
            <textarea
              aria-label="Text to copy"
              readOnly
              value={manual}
              onFocus={(e) => e.target.select()}
            />
          )}
        </div>
        <DialogFooter>
          <span className="q-pr-notice" role="status">
            {notice}
          </span>
          {destination.web ? (
            <Button render={<a href={destination.web} target="_blank" rel="noopener noreferrer" />}>
              Open {names[destination.provider]} <ExternalLinkIcon />
            </Button>
          ) : (
            <Button onClick={() => void copy(`${title}\n\n${body}`, "Draft")}>Copy draft</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
