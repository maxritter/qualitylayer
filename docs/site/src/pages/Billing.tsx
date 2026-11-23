import { useCallback, useRef } from "react";
import { Helmet } from "react-helmet-async";
import Page from "@/components/Page";
import SEO from "@/components/SEO";
import { CONTACT_EMAIL } from "@/lib/product";
import "@/styles/billing.css";
import { useBillingPortal } from "./billing/useBillingPortal";
import { BillingLogin } from "./billing/BillingLogin";
import { BillingSummary } from "./billing/BillingSummary";
import { BillingRecordsTabs } from "./billing/BillingRecords";
import { BillingActionModal, ReleaseMachineModal } from "./billing/BillingDialogs";

export default function Billing() {
  const opener = useRef<HTMLElement | null>(null);
  const message = useRef<HTMLDivElement>(null);
  const codeField = useRef<HTMLInputElement>(null);
  const setOpener = useCallback((el: HTMLElement | null) => { opener.current = el; }, []);
  const focusMessage = useCallback(() => { message.current?.focus(); }, []);
  const focusCodeField = useCallback(() => { codeField.current?.focus(); }, []);
  const b = useBillingPortal({ setOpener, focusMessage, focusCodeField });

  return (
    <>
      <SEO />
      <Helmet><meta name="referrer" content="no-referrer" /></Helmet>
      <Page className="page-billing">
        <div className="bl-wrap">
          <div ref={message} tabIndex={-1} className="bl-feedback">
            {b.error && <div className="bl-notice error" role="alert">{b.error}</div>}
            {b.notice && <div className="bl-notice" role="status">{b.notice}</div>}
          </div>
          {b.loading ? (
            <div className="bl-loading" role="status">Loading your billing account…</div>
          ) : !b.account ? (
            <BillingLogin
              email={b.email} code={b.code} challenge={b.challenge} busy={b.busy} codeField={codeField}
              onEmailChange={b.setEmail} onCodeChange={b.setCode} onSubmit={b.signIn} onResetChallenge={b.resetChallenge}
            />
          ) : (
            <>
              <BillingSummary
                account={b.account} subscription={b.subscription} busy={b.busy}
                onSignOut={b.signOut} onSelectSubscription={b.selectSubscription} onShow={b.show}
                onQuotePeriod={(productId) => void b.quote("period", productId)}
                onUpdatePayment={() => void b.updatePayment()}
              />
              <BillingRecordsTabs
                account={b.account} subscription={b.subscription} team={b.team} matchingMembers={b.matchingMembers}
                detailTab={b.detailTab} invoicePage={b.currentInvoicePage} memberPage={b.currentMemberPage}
                memberSearch={b.memberSearch} invite={b.invite} seatCount={b.seatCount} downloads={b.downloads} busy={b.busy}
                onTabChange={b.setDetailTab} onInvoicePageChange={b.setInvoicePage} onMemberPageChange={b.setMemberPage}
                onMemberSearchChange={b.updateMemberSearch} onInviteChange={b.setInvite} onSeatCountChange={b.setSeatCount}
                onDownload={(orderId, kind) => void b.download(orderId, kind)} onCopyKey={b.copyKey}
                onRequestRelease={b.requestRelease} onInviteSubmit={b.inviteTeammate}
                onQuoteSeats={() => void b.quote("seats")} onShow={b.show}
              />
              <div className="bl-bottom"><a href={`mailto:${CONTACT_EMAIL}`}>Contact support</a></div>
            </>
          )}
        </div>
      </Page>
      <BillingActionModal
        dialog={b.dialog} paymentSession={b.paymentSession} busy={b.busy} error={b.error} opener={opener}
        onUpdateDialog={b.setDialog}
        onClose={() => { b.setDialog(null); b.setPaymentSession(null); }}
        onConfirm={() => void b.confirm()}
        onPaymentConfirmed={() => b.setBusy(true)}
        onPaymentSuccess={b.paymentSuccess}
        onPaymentError={b.paymentError}
      />
      <ReleaseMachineModal
        release={b.release} busy={b.busy} error={b.error} opener={opener}
        onClose={() => b.setRelease(null)} onConfirm={b.releaseMachine}
      />
    </>
  );
}
