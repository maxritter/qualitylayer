import { billingDate, money, type BillingQuote, type Subscription } from "@/lib/billing";

export type BillingAction = {
  kind: string;
  title: string;
  copy: string;
  label: string;
  subscription: Subscription;
  quote?: BillingQuote;
  seatId?: string;
  email?: string;
  step?: 1 | 2 | 3;
  reasons?: string[];
  note?: string;
};

export type PaymentSession = { token: string; fixture?: boolean };
export type ReleaseTarget = { licenceId: string; activationId: string; name: string };

/** Why people cancel: any number may be ticked, and none is required (§312k BGB keeps cancelling free of hurdles). */
export const CANCEL_REASONS = [
  "Too expensive",
  "I don’t use it enough",
  "Missing a feature I need",
  "Moving to another tool",
  "Hard to set up or use",
  "Bugs or reliability",
  "The project ended",
  "Something else",
];

export const PAGE_SIZE = 10;

export function cancelStart(subscription: Subscription): BillingAction {
  return {
    kind: "cancel",
    step: 1,
    reasons: [],
    note: "",
    title: "Before you cancel",
    copy: "What made you decide to cancel? Pick any that apply.",
    label: "Continue",
    subscription,
  };
}

export function pauseModalAction(subscription: Subscription): BillingAction {
  if (subscription.status === "paused") {
    return {
      kind: "resume",
      title: "Resume subscription?",
      copy: `Resuming starts a new paid billing period immediately at ${money(subscription.amount, subscription.currency)} per ${subscription.interval}, plus any applicable tax.`,
      label: "Resume and pay",
      subscription,
    };
  }
  if (subscription.pauseScheduled) {
    return {
      kind: "unpause",
      title: "Keep subscription active?",
      copy: "Your existing renewal date and price continue.",
      label: "Keep active",
      subscription,
    };
  }
  return {
    kind: "pause",
    title: "Pause subscription?",
    copy: `Your subscription pauses on ${billingDate(subscription.periodEnd)}. Access stops while paused. Resuming starts a new paid billing period.`,
    label: "Pause at period end",
    subscription,
  };
}

export function pauseButtonLabel(subscription: Subscription): string {
  if (subscription.status === "paused") return "Resume subscription";
  if (subscription.pauseScheduled) return "Keep active";
  return "Pause subscription";
}

export function subscriptionStatus(subscription: Subscription | undefined): string | undefined {
  if (!subscription) return undefined;
  if (subscription.canceled) return "Ends at period end";
  if (subscription.pauseScheduled) return "Pauses at period end";
  return subscription.status.replaceAll("_", " ");
}

export function subscriptionDateLabel(subscription: Subscription): string {
  if (subscription.canceled) return "Access until";
  if (subscription.status === "paused") return "Paused since";
  return "Next renewal";
}

export function formatSeatSuffix(seats: number | null): string {
  if (seats === null) return "";
  return ` · ${seats} ${seats === 1 ? "seat" : "seats"}`;
}

export function canSwitchPeriod(subscription: Subscription): boolean {
  return !subscription.canceled && !subscription.pauseScheduled && !subscription.pending && subscription.status === "active";
}

export function isSeatReviewDisabled(subscription: Subscription, busy: boolean, desiredSeats: number, currentTotal: number): boolean {
  if (subscription.legacy || busy || subscription.pending) return true;
  if (subscription.canceled || subscription.pauseScheduled || subscription.status !== "active") return true;
  return desiredSeats === currentTotal;
}

export function confirmNotice(kind: string): string {
  if (kind === "resend-seat") return "Seat invitation sent.";
  if (kind === "revoke-seat") return "Seat revoked.";
  return "Your subscription has been updated.";
}
