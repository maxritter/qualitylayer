import { billingDate, billingRequest, type BillingAccount, type BillingQuote, type Subscription } from "@/lib/billing";
import { confirmNotice, type BillingAction, type PaymentSession, type ReleaseTarget } from "./billing-actions";

export interface BillingMutationContext {
  account: BillingAccount | null;
  subscription: Subscription | undefined;
  dialog: BillingAction | null;
  release: ReleaseTarget | null;
  email: string;
  code: string;
  challenge: string | null;
  invite: string;
  seatCount: number | null;
  setOpener: (el: HTMLElement | null) => void;
  run: (work: () => Promise<void>) => Promise<void>;
  reload: () => Promise<void>;
  setAccount: (a: BillingAccount | null) => void;
  setChallenge: (c: string | null) => void;
  setCode: (c: string) => void;
  setEmail: (e: string) => void;
  setDialog: (d: BillingAction | null) => void;
  setPaymentSession: (p: PaymentSession | null) => void;
  setRelease: (r: ReleaseTarget | null) => void;
  setDownloads: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  setInvite: (i: string) => void;
  setNotice: (n: string) => void;
  setError: (e: string) => void;
}

function captureOpener(ctx: BillingMutationContext) {
  ctx.setOpener(document.activeElement instanceof HTMLElement ? document.activeElement : null);
}

export async function submitSignIn(ctx: BillingMutationContext) {
  await ctx.run(async () => {
    if (!ctx.challenge) {
      const res = await billingRequest<{ challenge: string }>("request-code", { email: ctx.email });
      ctx.setChallenge(res.challenge);
      return;
    }
    await billingRequest("verify-code", { challenge: ctx.challenge, code: ctx.code });
    await ctx.reload();
    ctx.setCode("");
    ctx.setChallenge(null);
  });
}

export async function requestQuote(ctx: BillingMutationContext, kind: "period" | "seats", productId?: string) {
  const { subscription } = ctx;
  if (!subscription) return;
  captureOpener(ctx);
  await ctx.run(async () => {
    const seats = ctx.seatCount ?? subscription.seats ?? 1;
    const value = await billingRequest<BillingQuote>("quote", { kind, subscriptionId: subscription.id, productId, seats });
    ctx.setDialog({
      kind: "apply-quote",
      title: kind === "period" ? "Change billing period" : "Change seat count",
      copy: "Your current subscription continues until this change takes effect. No prorated charge is due today.",
      label: "Schedule change",
      subscription,
      quote: value,
    });
  });
}

async function advanceCancel(ctx: BillingMutationContext, action: BillingAction) {
  const endDate = billingDate(action.subscription.periodEnd);
  if (action.step === 1) {
    ctx.setDialog({
      ...action,
      step: 2,
      title: `Cancel ${action.subscription.name}?`,
      copy: `Renewals stop. You keep full access until ${endDate}, and your plans stay in your repositories.`,
      label: "Cancel subscription",
    });
    return;
  }
  if (action.step !== 2) {
    ctx.setDialog(null);
    return;
  }
  await ctx.run(async () => {
    await billingRequest("cancel", { subscriptionId: action.subscription.id, reasons: action.reasons, note: action.note });
    ctx.setDialog({
      ...action,
      step: 3,
      title: `Your subscription ends on ${endDate}`,
      copy: `Polar sends a confirmation to ${ctx.account?.email ?? "your email"}.`,
      label: "Close",
    });
    await ctx.reload();
  });
}

export async function confirmAction(ctx: BillingMutationContext) {
  const { dialog } = ctx;
  if (!dialog) return;
  if (dialog.kind === "cancel") {
    await advanceCancel(ctx, dialog);
    return;
  }
  await ctx.run(async () => {
    await billingRequest(dialog.kind, { subscriptionId: dialog.subscription.id, quoteId: dialog.quote?.id, seatId: dialog.seatId });
    ctx.setDialog(null);
    ctx.setNotice(confirmNotice(dialog.kind));
    await ctx.reload();
  });
}

export async function startPaymentUpdate(ctx: BillingMutationContext) {
  await ctx.run(async () => {
    captureOpener(ctx);
    ctx.setPaymentSession(await billingRequest<PaymentSession>("payment-session"));
  });
}

export async function prepareDownload(ctx: BillingMutationContext, orderId: string, kind: "invoice" | "receipt") {
  await ctx.run(async () => {
    const result = await billingRequest<{ url?: string; pending?: boolean; unavailable?: boolean }>(kind, { orderId });
    if (result.unavailable) {
      ctx.setNotice("Polar has not issued a receipt for this order. You can download its invoice instead.");
      return;
    }
    if (result.pending) {
      ctx.setNotice("Polar is preparing your invoice. Try again in a moment.");
      return;
    }
    const url = result.url ? new URL(result.url) : null;
    if (!url || url.protocol !== "https:") throw new Error("The download is unavailable. Please contact support.");
    ctx.setDownloads((values) => ({ ...values, [`${orderId}:${kind}`]: url.href }));
  });
}

export function performSignOut(ctx: BillingMutationContext) {
  void ctx.run(async () => {
    await billingRequest("sign-out");
    ctx.setAccount(null);
    ctx.setDownloads(() => ({}));
    ctx.setPaymentSession(null);
    ctx.setEmail("");
    ctx.setCode("");
    ctx.setChallenge(null);
  });
}

export function performInvite(ctx: BillingMutationContext) {
  const { subscription } = ctx;
  if (!subscription) return;
  void ctx.run(async () => {
    await billingRequest("assign-seat", { subscriptionId: subscription.id, email: ctx.invite });
    ctx.setInvite("");
    ctx.setNotice("Seat invitation sent.");
    await ctx.reload();
  });
}

export function performRelease(ctx: BillingMutationContext) {
  const { release } = ctx;
  void ctx.run(async () => {
    if (!release) return;
    await billingRequest("release-machine", { licenceId: release.licenceId, activationId: release.activationId });
    ctx.setRelease(null);
    ctx.setNotice("Machine released. Its place on the key is free.");
    await ctx.reload();
  });
}
