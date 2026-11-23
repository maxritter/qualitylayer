import type { RefObject } from "react";
import { Dialog as Modal } from "radix-ui";
import { Button } from "@/components/ui/button";
import { billingDate, money } from "@/lib/billing";
import PaymentMethodPanel from "@/components/PaymentMethodPanel";
import { CANCEL_REASONS, type BillingAction, type PaymentSession, type ReleaseTarget } from "./billing-actions";

function CancelBody({ dialog, busy, onUpdateDialog }: { dialog: BillingAction; busy: boolean; onUpdateDialog: (next: BillingAction) => void }) {
  if (dialog.step === 1) {
    return (
      <>
        <fieldset className="bl-reasons">
          <legend>Reasons, optional</legend>
          {CANCEL_REASONS.map((reason) => (
            <label key={reason} className="bl-reason">
              <input
                type="checkbox"
                checked={dialog.reasons?.includes(reason) ?? false}
                onChange={(event) => {
                  const prev = dialog.reasons ?? [];
                  const reasons = event.target.checked ? [...prev, reason] : prev.filter((r) => r !== reason);
                  onUpdateDialog({ ...dialog, reasons });
                }}
              />
              <span>{reason}</span>
            </label>
          ))}
        </fieldset>
        <label className="bl-note">
          <span>Anything else? Optional</span>
          <textarea rows={3} maxLength={1000} value={dialog.note ?? ""} placeholder="What would have made you stay?" onChange={(event) => onUpdateDialog({ ...dialog, note: event.target.value })} />
        </label>
        {dialog.subscription.status === "active" && !dialog.subscription.pauseScheduled && (
          <div className="bl-offer">
            <div><strong>Pause instead?</strong><span>No charges while paused. Your plans and settings stay; resume any time.</span></div>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => onUpdateDialog({
                kind: "pause",
                title: "Pause subscription?",
                copy: `Your subscription pauses on ${billingDate(dialog.subscription.periodEnd)}. Access stops while paused. Resuming starts a new paid billing period.`,
                label: "Pause at period end",
                subscription: dialog.subscription,
              })}
            >
              Pause instead
            </Button>
          </div>
        )}
      </>
    );
  }
  if (dialog.step === 2) {
    const summary = [...(dialog.reasons ?? []), dialog.note?.trim() ? `“${dialog.note.trim()}”` : ""].filter(Boolean).join(" · ") || "None given";
    return (
      <dl className="bl-details">
        <div><dt>Access until</dt><dd>{billingDate(dialog.subscription.periodEnd)}</dd></div>
        <div><dt>Plan</dt><dd>{dialog.subscription.name}{dialog.subscription.seats ? ` · ${dialog.subscription.seats} seats` : ""} · {dialog.subscription.interval === "year" ? "Yearly" : "Monthly"}</dd></div>
        <div><dt>Your reasons</dt><dd>{summary}</dd></div>
      </dl>
    );
  }
  if (dialog.step === 3 && (dialog.reasons?.length || dialog.note?.trim())) {
    return <p className="bl-sent">Thanks for telling us why.</p>;
  }
  return null;
}

function ModalActions(props: {
  dialog: BillingAction | null;
  paymentSession: PaymentSession | null;
  busy: boolean;
  onUpdateDialog: (next: BillingAction) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { dialog, paymentSession, busy, onUpdateDialog, onConfirm, onClose } = props;
  if (dialog?.kind === "cancel") {
    if (dialog.step === 3) {
      return (
        <div className="bl-actions">
          <Button disabled={busy} onClick={onClose}>Close</Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onUpdateDialog({
              kind: "uncancel",
              title: "Keep subscription?",
              copy: "Your subscription continues at its existing price.",
              label: "Keep subscription",
              subscription: dialog.subscription,
            })}
          >
            Keep subscription after all
          </Button>
        </div>
      );
    }
    return (
      <div className="bl-actions">
        <Button disabled={busy} onClick={onClose}>Keep subscription</Button>
        <Button variant={dialog.step === 2 ? "destructive" : "outline"} className={dialog.step === 2 ? "bl-danger" : undefined} disabled={busy} onClick={onConfirm}>
          {busy ? "Saving…" : dialog.label}
        </Button>
      </div>
    );
  }
  return (
    <div className="bl-actions">
      {!paymentSession && <Button disabled={busy} onClick={onConfirm}>{busy ? "Saving…" : dialog?.label}</Button>}
      <Button variant="outline" disabled={busy} onClick={onClose}>Back</Button>
    </div>
  );
}

export function BillingActionModal(props: {
  dialog: BillingAction | null;
  paymentSession: PaymentSession | null;
  busy: boolean;
  error: string;
  opener: RefObject<HTMLElement | null>;
  onUpdateDialog: (next: BillingAction) => void;
  onClose: () => void;
  onConfirm: () => void;
  onPaymentConfirmed: () => void;
  onPaymentSuccess: () => void;
  onPaymentError: () => void;
}) {
  const { dialog, paymentSession, busy, error, opener, onUpdateDialog, onClose, onConfirm } = props;
  return (
    <Modal.Root open={!!dialog || !!paymentSession} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <Modal.Portal>
        <Modal.Overlay className="bl-overlay" />
        <Modal.Content
          className="bl-dialog"
          onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus(); }}
          onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
          onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}
        >
          {dialog?.kind === "cancel" && dialog.step !== 3 && <p className="bl-step">Step {dialog.step} of 2</p>}
          <Modal.Title>{paymentSession ? "Update payment method" : dialog?.title}</Modal.Title>
          <Modal.Description>
            {paymentSession ? "Your card details go directly to Polar’s payment processor. The new card becomes your default." : dialog?.copy}
          </Modal.Description>
          {paymentSession && (
            <PaymentMethodPanel
              token={paymentSession.token}
              fixture={paymentSession.fixture}
              onConfirmed={props.onPaymentConfirmed}
              onSuccess={props.onPaymentSuccess}
              onError={props.onPaymentError}
            />
          )}
          {dialog?.quote && (
            <dl className="bl-details">
              <div><dt>New price</dt><dd>{money(dialog.quote.amount, dialog.quote.currency)} per {dialog.quote.interval}</dd></div>
              <div><dt>Takes effect</dt><dd>{billingDate(dialog.quote.effectiveAt)}</dd></div>
              <div><dt>Due today</dt><dd>{money(dialog.quote.dueNow, dialog.quote.currency)}</dd></div>
              <div><dt>Tax</dt><dd>Calculated by Polar at renewal</dd></div>
            </dl>
          )}
          {dialog?.kind === "cancel" && <CancelBody dialog={dialog} busy={busy} onUpdateDialog={onUpdateDialog} />}
          {error && <p role="alert" className="bl-dialog-error">{error}</p>}
          <ModalActions dialog={dialog} paymentSession={paymentSession} busy={busy} onUpdateDialog={onUpdateDialog} onConfirm={onConfirm} onClose={onClose} />
        </Modal.Content>
      </Modal.Portal>
    </Modal.Root>
  );
}

export function ReleaseMachineModal(props: {
  release: ReleaseTarget | null;
  busy: boolean;
  error: string;
  opener: RefObject<HTMLElement | null>;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { release, busy, error, opener, onConfirm, onClose } = props;
  return (
    <Modal.Root open={!!release} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <Modal.Portal>
        <Modal.Overlay className="bl-overlay" />
        <Modal.Content
          className="bl-dialog"
          onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus(); }}
          onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
          onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}
        >
          <Modal.Title>{`Release ${release?.name ?? "this machine"}?`}</Modal.Title>
          <Modal.Description>Its place on this key is freed now. If QualityLayer or Pilot Shell runs there again, it asks for the key and takes a place again.</Modal.Description>
          {error && <p role="alert" className="bl-dialog-error">{error}</p>}
          <div className="bl-actions">
            <Button disabled={busy} onClick={onConfirm}>{busy ? "Releasing…" : "Release machine"}</Button>
            <Button variant="outline" disabled={busy} onClick={onClose}>Back</Button>
          </div>
        </Modal.Content>
      </Modal.Portal>
    </Modal.Root>
  );
}
