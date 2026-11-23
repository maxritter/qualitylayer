// Private support: what the sheet's Private support button opens, and what "Report this" on an error
// can open. One text field, screenshots, the system details it always includes (folded, readable
// before sending), who the report is from, and what happened to it (sent with a reference, or saved
// to send later). It has the public sheet's shell: an icon in the title, the same icon-led choice and a
// folded System details row; there is no diagnostics switch (Max, 31 October 2026). The server owns the sending.

import { cn } from "cn"
import { BugIcon, SparklesIcon } from "lucide-react"
import { type ReactNode, useCallback, useRef } from "react"
import { type CloseDetails, Dialog, DialogContent, keepWhile } from "@/components/ui/dialog"
import { MAX_TEXT } from "../core/feedback/report.ts"
import type { Api } from "./api.ts"
import {
  copyText,
  FeedbackDetailsFold,
  FeedbackHead,
  FeedbackLicenceFrom,
  FeedbackQueuedView,
  FeedbackSentView,
  FeedbackShotsSection,
  FeedbackTrialFields,
} from "./feedback-sheet-parts.tsx"
import { type FeedbackKind, usePrivateFeedbackForm } from "./feedback-sheet-state.ts"
import { PublicFeedbackSheet } from "./PublicFeedbackSheet.tsx"
import { Segmented } from "./Segmented.tsx"
import type { ReportUpdate } from "./Updates.tsx"

export type FeedbackStart = {
  kind: "bug" | "idea"
  /** The error a toast showed; the text opens with it written in. */
  error?: string
  /** The kind of page the person was on when they asked. */
  page?: string
}

/** The same choice, with the same marks, as the public sheet. */
const KINDS: { id: FeedbackKind; label: string; icon: ReactNode }[] = [
  { id: "bug", label: "Report a bug", icon: <BugIcon /> },
  { id: "idea", label: "Suggest an improvement", icon: <SparklesIcon /> },
]

function feedbackFooterNote(
  signedOut: boolean,
  trial: boolean,
  senderOk: boolean,
  email: string,
): string {
  if (signedOut) return "Start the trial or activate a licence in Settings to send a report."
  if (!trial) return "Sent privately to Max with your licence e-mail."
  return senderOk
    ? `Sent privately to Max from ${email.trim()}.`
    : "Name and e-mail are needed to send."
}

function Body({
  api,
  start,
  onClose,
  onDraft,
}: {
  api: Api
  start: FeedbackStart
  onClose: () => void
  /** Whether there is a draft worth keeping from a stray click or Escape. */
  onDraft: (has: boolean) => void
}) {
  const form = usePrivateFeedbackForm(api, start, onDraft)

  if (form.view.name === "sent") {
    return (
      <FeedbackSentView
        reference={form.view.reference}
        onAnother={form.another}
        onClose={onClose}
      />
    )
  }
  if (form.view.name === "queued") {
    const queued = form.view
    return (
      <FeedbackQueuedView
        view={queued}
        copied={form.copied}
        onCopy={() => void copyText(queued.copy).then(form.setCopied)}
        onClose={onClose}
      />
    )
  }

  const note = feedbackFooterNote(form.signedOut, form.trial, form.senderOk, form.email)
  return (
    <>
      <FeedbackHead
        title="Contact Max privately"
        line="For account details, private screenshots or a security concern."
      />
      <div className="grid max-h-[min(66vh,560px)] gap-4 overflow-y-auto px-5 py-4">
        <div className="q-private-kind">
          <Segmented
            label="Kind of report"
            value={form.kind}
            options={KINDS}
            onChange={(next) => form.setKind(next)}
          />
        </div>
        <div className="grid gap-1.5">
          <label className="sr-only" htmlFor="feedback-text">
            Your report
          </label>
          <textarea
            id="feedback-text"
            ref={form.field}
            value={form.text}
            maxLength={MAX_TEXT}
            onChange={(event) => form.setText(event.target.value)}
            onPaste={form.paste}
            placeholder={
              form.kind === "bug"
                ? "What did you do, and what happened instead?"
                : "What would help you?"
            }
            className="min-h-[130px] w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 text-[14px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring"
            data-testid="feedback-text"
          />
          {form.text.length > MAX_TEXT - 500 ? (
            <span className="q-dim justify-self-end text-[12px]" data-testid="feedback-count">
              {form.text.length.toLocaleString("en-US")} / {MAX_TEXT.toLocaleString("en-US")}
            </span>
          ) : null}
        </div>
        {form.trial ? (
          <FeedbackTrialFields
            name={form.name}
            email={form.email}
            onName={form.setName}
            onEmail={form.setEmail}
          />
        ) : null}
        <FeedbackShotsSection
          shots={form.shots}
          dragging={form.dragging}
          filesRef={form.files}
          onDragging={form.setDragging}
          onDrop={form.drop}
          onAddFiles={(list) => void form.add(list)}
          onRemoveShot={form.removeShot}
        />
        <FeedbackDetailsFold details={form.details} onOpen={() => void form.readDetails()} />
        {form.who?.kind === "licence" ? <FeedbackLicenceFrom who={form.who} /> : null}
      </div>
      <p className="m-0 px-5 pb-4 text-[13px] text-muted-foreground">
        You can also email me at{" "}
        <a className="q-link" href="mailto:hello@qualitylayer.dev">
          hello@qualitylayer.dev
        </a>
        .
      </p>
      <footer className="flex items-center justify-between gap-3 border-t border-line bg-sunken px-5 py-3">
        <p
          className={cn("m-0 text-[12.5px]", form.problem !== null ? "text-danger" : "q-dim")}
          role={form.problem !== null ? "alert" : undefined}
          data-testid="feedback-note"
        >
          {form.problem ?? note}
        </p>
        <div className="flex flex-none gap-2">
          <button type="button" className="q-btn quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="q-btn primary"
            disabled={!form.ready || form.sending || form.adding}
            onClick={() => void form.send()}
            data-testid="feedback-send"
          >
            {form.sending ? "Sending…" : "Send report"}
          </button>
        </div>
      </footer>
    </>
  )
}

/**
 * Closing the sheet puts the focus back on Report in the sidebar, where it opens from. A click on a
 * button does not focus it in every browser, so the page's own memory of the focus can point at
 * something else; with no Report button on screen the page decides.
 */
const focusReport = () =>
  document.querySelector<HTMLElement>('[data-testid="feedback-button"]') ?? true

export function PrivateFeedbackSheet({
  api,
  open,
  onOpenChange,
  start = { kind: "bug" },
}: {
  api: Api
  open: boolean
  onOpenChange: (open: boolean) => void
  start?: FeedbackStart
}) {
  // Up to 5,000 characters and screenshots must not go with a stray click or Escape; Cancel still closes.
  const draft = useRef(false)
  const change = useCallback(
    (next: boolean, details: CloseDetails) => keepWhile(draft.current, next, details, onOpenChange),
    [onOpenChange],
  )
  const onDraft = useCallback((has: boolean) => {
    draft.current = has
  }, [])
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent
        className="top-[max(24px,8vh)] translate-y-0 gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[600px]"
        showCloseButton={false}
        finalFocus={focusReport}
        // The sent and saved views say all they have in the title and two lines.
        aria-describedby={undefined}
        data-testid="feedback-sheet"
      >
        <Body api={api} start={start} onClose={() => onOpenChange(false)} onDraft={onDraft} />
      </DialogContent>
    </Dialog>
  )
}

export function FeedbackSheet(props: {
  api: Api
  open: boolean
  onOpenChange: (open: boolean) => void
  start?: FeedbackStart
  /** A newer version is ready: a bug report says so before its form. */
  update?: ReportUpdate | null
}) {
  return (
    <PublicFeedbackSheet
      {...props}
      start={props.start ?? { kind: "bug" }}
      privateSupport={(back) => (
        <PrivateFeedbackSheet
          {...props}
          onOpenChange={(open) => {
            if (!open) back()
          }}
        />
      )}
    />
  )
}
