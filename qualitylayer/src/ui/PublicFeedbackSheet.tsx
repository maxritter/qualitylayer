import { TriangleAlertIcon } from "lucide-react"
import type { ReactNode } from "react"
import { Dialog, DialogContent, DialogTitle, keepWhile } from "@/components/ui/dialog"
import type { Api } from "./api.ts"
import type { FeedbackStart } from "./FeedbackSheet.tsx"
import {
  ReportFooter,
  ReportForm,
  ReportPreview,
  ReportResult,
  reportPresentation,
} from "./public-feedback-parts.tsx"
import { usePublicFeedback } from "./public-feedback-state.ts"
import type { ReportUpdate } from "./Updates.tsx"
import "./public-feedback.css"

type ReportingProps = {
  api: Api
  open: boolean
  onOpenChange: (open: boolean) => void
  start: FeedbackStart
  privateSupport: (back: () => void) => ReactNode
  /** A newer version is ready: a bug report says so before its form. */
  update?: ReportUpdate | null
}

export function PublicFeedbackSheet(props: ReportingProps) {
  const { open, onOpenChange, privateSupport, update } = props
  const fb = usePublicFeedback(props)
  if (fb.stage === "private") return privateSupport(() => fb.setStage("form"))
  const queued = fb.delivery?.status === "queued" && !fb.created
  const { heading, HeadingIcon } = reportPresentation(
    fb.stage,
    fb.delivery,
    fb.kind,
    Boolean(fb.created),
  )
  const ready = Boolean(fb.system && fb.title.trim() && fb.description.trim())
  const canPreview = !fb.busy && !fb.adding && ready
  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (fb.busy || fb.adding) details.cancel()
        else keepWhile(fb.draft, next, details, onOpenChange)
      }}
    >
      <DialogContent
        className="q-public-feedback"
        showCloseButton={false}
        aria-describedby={undefined}
        initialFocus={fb.titleField}
        finalFocus={() =>
          document.querySelector<HTMLElement>('[data-testid="feedback-button"]') ?? true
        }
        data-testid="feedback-sheet"
        onPaste={fb.pasted}
        onDragOver={(event) => event.preventDefault()}
        onDrop={fb.dropped}
      >
        <header className="q-report-head">
          <div className="q-report-heading">
            <span className="q-report-heading-icon">
              <HeadingIcon size={18} />
            </span>
            <DialogTitle>{heading}</DialogTitle>
          </div>
          <p>
            Public issue in{" "}
            <a
              href="https://github.com/maxritter/qualitylayer/issues"
              target="_blank"
              rel="noreferrer"
            >
              maxritter/qualitylayer
            </a>
            . Anyone can read it.
          </p>
        </header>
        <div className="q-report-body">
          {fb.stage === "form" ? (
            <ReportForm
              kind={fb.kind}
              setKind={fb.setKind}
              title={fb.title}
              setTitle={fb.setTitle}
              description={fb.description}
              setDescription={fb.setDescription}
              shots={fb.shots}
              setShots={fb.setShots}
              fileInput={fb.fileInput}
              titleField={fb.titleField}
              busy={fb.busy}
              adding={fb.adding}
              addImages={fb.addImages}
              system={fb.system}
              update={update ?? null}
            />
          ) : fb.stage === "preview" && fb.review ? (
            <ReportPreview review={fb.review} kind={fb.kind} />
          ) : fb.delivery ? (
            <ReportResult
              title={fb.title}
              delivery={fb.delivery}
              created={fb.created}
              queued={queued}
              busy={fb.busy}
              editQueued={fb.editQueued}
              HeadingIcon={HeadingIcon}
            />
          ) : null}
          {fb.stage !== "preview" ? (
            <p className="q-report-contact">
              You can also email me at{" "}
              <a href="mailto:hello@qualitylayer.dev">hello@qualitylayer.dev</a>.
            </p>
          ) : null}
          {fb.problem ? (
            <p className="q-report-error" role="alert">
              <TriangleAlertIcon size={15} />
              {fb.problem}
            </p>
          ) : null}
        </div>
        <ReportFooter
          stage={fb.stage}
          busy={fb.busy}
          adding={fb.adding}
          canPreview={canPreview}
          onPrivate={() => fb.setStage("private")}
          onClose={fb.close}
          onPreview={() => void fb.preview()}
          onBack={() => fb.setStage("form")}
          onSubmit={() => void fb.submit()}
        />
      </DialogContent>
    </Dialog>
  )
}
