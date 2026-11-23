import { useEffect, useState, type FormEvent } from "react";
import { BillingError, billingRequest, type BillingAccount } from "@/lib/billing";
import { PAGE_SIZE, type BillingAction, type PaymentSession, type ReleaseTarget } from "./billing-actions";
import {
  confirmAction,
  performInvite,
  performRelease,
  performSignOut,
  prepareDownload,
  requestQuote,
  startPaymentUpdate,
  submitSignIn,
  type BillingMutationContext,
} from "./useBillingHandlers";

export interface BillingRefs {
  setOpener: (el: HTMLElement | null) => void;
  focusMessage: () => void;
  focusCodeField: () => void;
}

function useBillingInit(
  setAccount: (a: BillingAccount | null) => void,
  setLoading: (b: boolean) => void,
  setError: (s: string) => void,
  setNotice: (s: string) => void,
) {
  useEffect(() => {
    let active = true;
    billingRequest<BillingAccount>()
      .then((value) => { if (active) setAccount(value); })
      .catch((err) => { if (active && (!(err instanceof BillingError) || err.status !== 401)) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [setAccount, setLoading, setError]);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("polar_payment_method_status")) return;
    void import("@polar-sh/checkout/payment-method").then(({ PolarEmbedPaymentMethod }) => {
      const result = PolarEmbedPaymentMethod.getRedirectResult();
      if (result?.status === "failed") setError("The payment method could not be updated. Try again or contact support.");
      else if (result?.status === "succeeded") setNotice("Your current payment methods are listed below.");
    });
  }, [setError, setNotice]);
}

function clampPage(page: number, count: number): number {
  return Math.min(page, Math.max(0, Math.ceil(count / PAGE_SIZE) - 1));
}

export function useBillingPortal({ setOpener, focusMessage, focusCodeField }: BillingRefs) {
  const [account, setAccount] = useState<BillingAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState("");
  const [dialog, setDialog] = useState<BillingAction | null>(null);
  const [invite, setInvite] = useState("");
  const [seatCount, setSeatCount] = useState<number | null>(null);
  const [paymentSession, setPaymentSession] = useState<PaymentSession | null>(null);
  const [release, setRelease] = useState<ReleaseTarget | null>(null);
  const [downloads, setDownloads] = useState<Record<string, string>>({});
  const [detailTab, setDetailTab] = useState("invoices");
  const [invoicePage, setInvoicePage] = useState(0);
  const [memberPage, setMemberPage] = useState(0);
  const [memberSearch, setMemberSearch] = useState("");

  useBillingInit(setAccount, setLoading, setError, setNotice);
  useEffect(() => { if (challenge) focusCodeField(); }, [challenge, focusCodeField]);

  const subscription = account?.subscriptions.find((item) => item.id === selected) ?? account?.subscriptions[0];
  const team = account?.seats.find((item) => item.subscriptionId === subscription?.id);
  const matchingMembers = team?.seats.filter((seat) => seat.email.toLowerCase().includes(memberSearch.trim().toLowerCase())) ?? [];

  const reload = async () => setAccount(await billingRequest<BillingAccount>());
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await work();
    } catch (err) {
      if (err instanceof BillingError && err.status === 401 && account) {
        setAccount(null); setChallenge(null); setDialog(null); setPaymentSession(null);
      }
      setError(err instanceof Error ? err.message : "Please try again.");
      requestAnimationFrame(focusMessage);
    } finally {
      setBusy(false);
    }
  };

  const ctx: BillingMutationContext = {
    account, subscription, dialog, release, email, code, challenge, invite, seatCount,
    setOpener, run, reload, setAccount, setChallenge, setCode, setEmail, setDialog,
    setPaymentSession, setRelease, setDownloads, setInvite, setNotice, setError,
  };

  return {
    account, loading, busy, email, code, challenge, error, notice, dialog, invite, seatCount,
    paymentSession, release, downloads, detailTab, memberSearch,
    subscription, team, matchingMembers,
    currentMemberPage: clampPage(memberPage, matchingMembers.length),
    currentInvoicePage: clampPage(invoicePage, account?.invoices.length ?? 0),
    setEmail, setCode, setDialog, setInvite, setSeatCount, setPaymentSession, setRelease,
    setDetailTab, setInvoicePage, setMemberPage, setBusy, setError, setNotice,
    resetChallenge: () => { setChallenge(null); setCode(""); setError(""); },
    updateMemberSearch: (value: string) => { setMemberSearch(value); setMemberPage(0); },
    selectSubscription: (id: string) => { setSelected(id); setSeatCount(null); setMemberSearch(""); setMemberPage(0); setDetailTab("invoices"); },
    show: (action: BillingAction) => { setOpener(document.activeElement instanceof HTMLElement ? document.activeElement : null); setError(""); setDialog(action); },
    copyKey: (key: string) => void run(async () => { await navigator.clipboard.writeText(key); setNotice("Licence key copied."); }),
    requestRelease: (target: ReleaseTarget, trigger: HTMLElement) => { setOpener(trigger); setError(""); setRelease(target); },
    paymentSuccess: () => { setBusy(false); setPaymentSession(null); setNotice("Your default payment method has been updated."); void reload().catch(() => setError("Refresh billing to see your updated payment method.")); },
    paymentError: () => { setBusy(false); setError("Polar could not update your payment method. Try again or contact support."); },
    signIn: (event: FormEvent) => { event.preventDefault(); return submitSignIn(ctx); },
    quote: (kind: "period" | "seats", productId?: string) => requestQuote(ctx, kind, productId),
    confirm: () => confirmAction(ctx),
    updatePayment: () => startPaymentUpdate(ctx),
    download: (orderId: string, kind: "invoice" | "receipt") => prepareDownload(ctx, orderId, kind),
    signOut: () => performSignOut(ctx),
    inviteTeammate: () => performInvite(ctx),
    releaseMachine: () => performRelease(ctx),
  };
}
