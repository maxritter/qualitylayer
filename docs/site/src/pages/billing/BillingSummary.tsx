import { Link } from "react-router-dom";
import { LogOutIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { billingDate, money, type BillingAccount, type Subscription } from "@/lib/billing";
import {
  canSwitchPeriod,
  cancelStart,
  formatSeatSuffix,
  pauseButtonLabel,
  pauseModalAction,
  subscriptionDateLabel,
  subscriptionStatus,
  type BillingAction,
} from "./billing-actions";

interface SubscriptionPanelProps {
  subscription: Subscription | undefined;
  busy: boolean;
  onShow: (action: BillingAction) => void;
  onQuotePeriod: (productId: string) => void;
}

function SubscriptionPanel({ subscription, busy, onShow, onQuotePeriod }: SubscriptionPanelProps) {
  if (!subscription) {
    return (
      <section id="subscription" className="bl-panel">
        <h2>Subscription</h2>
        <p className="bl-empty">No active subscription is associated with this account.</p>
        <Link to="/pricing">Choose a plan</Link>
      </section>
    );
  }

  const status = subscriptionStatus(subscription);
  const toggleRenewal = subscription.canceled
    ? { kind: "uncancel", title: "Keep subscription?", copy: "Your subscription continues at its existing price.", label: "Keep subscription", subscription }
    : cancelStart(subscription);

  return (
    <section id="subscription" className="bl-panel">
      <h2>Subscription</h2>
      <div className="bl-plan-head">
        <h3>{subscription.name}</h3>
        <Badge variant="outline" className="bl-status">{status}</Badge>
      </div>
      <p className="bl-price">
        {money(subscription.amount, subscription.currency)}{" "}
        <small>per {subscription.interval}{formatSeatSuffix(subscription.seats)}</small>
      </p>
      <dl className="bl-details">
        <div>
          <dt>{subscriptionDateLabel(subscription)}</dt>
          <dd>{billingDate(subscription.periodEnd)}</dd>
        </div>
        <div>
          <dt>Billing</dt>
          <dd>{subscription.interval === "year" ? "Yearly" : "Monthly"}</dd>
        </div>
      </dl>
      {subscription.legacy && (
        <p className="bl-hint">Your Pilot Shell subscription keeps its current price. Contact support to change products.</p>
      )}
      {subscription.status === "past_due" && (
        <p className="bl-hint">A renewal payment failed. Update your payment method to restore payment.</p>
      )}
      {subscription.pending && (
        <div className="bl-notice">
          <p>{subscription.pending.name}{subscription.pending.seats ? ` · ${subscription.pending.seats} seats` : ""} takes effect on {billingDate(subscription.pending.at)}.</p>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => onShow({
              kind: "clear-change",
              title: "Keep your current subscription?",
              copy: "The scheduled change will be removed. Your existing plan and price continue.",
              label: "Keep current plan",
              subscription,
            })}
          >
            Remove scheduled change
          </Button>
        </div>
      )}
      <div className="bl-actions">
        {canSwitchPeriod(subscription) && subscription.options.map((option) => (
          <Button key={option.productId} variant="outline" disabled={busy} onClick={() => onQuotePeriod(option.productId)}>
            Switch to {option.interval === "year" ? "yearly" : "monthly"} billing
          </Button>
        ))}
        {!subscription.canceled && subscription.status !== "past_due" && (
          <Button variant="ghost" disabled={busy} onClick={() => onShow(pauseModalAction(subscription))}>
            {pauseButtonLabel(subscription)}
          </Button>
        )}
      </div>
      <div className="bl-bottom">
        <span>Manage renewal</span>
        <Button variant="ghost" disabled={busy} onClick={() => onShow(toggleRenewal)}>
          {subscription.canceled ? "Keep subscription" : "Cancel subscription"}
        </Button>
      </div>
    </section>
  );
}

interface BillingSummaryProps {
  account: BillingAccount;
  subscription: Subscription | undefined;
  busy: boolean;
  onSignOut: () => void;
  onSelectSubscription: (id: string) => void;
  onShow: (action: BillingAction) => void;
  onQuotePeriod: (productId: string) => void;
  onUpdatePayment: () => void;
}

export function BillingSummary(props: BillingSummaryProps) {
  const { account, subscription, busy, onSignOut, onSelectSubscription, onShow, onQuotePeriod, onUpdatePayment } = props;
  return (
    <>
      <div className="bl-intro">
        <div>
          <h1>Subscription &amp; billing</h1>
          <p>Manage your plan, payments and licence.</p>
        </div>
        <div className="bl-account">
          <div className="bl-identity">
            <small>Signed in as</small>
            <span>{account.email}</span>
          </div>
          <Button variant="outline" disabled={busy} onClick={onSignOut}>
            <LogOutIcon data-icon="inline-start" aria-hidden="true" />Sign out
          </Button>
        </div>
      </div>
      {account.subscriptions.length > 1 && (
        <Field className="bl-field bl-picker">
          <FieldLabel htmlFor="subscription-choice">Subscription</FieldLabel>
          <Select value={subscription?.id} onValueChange={onSelectSubscription}>
            <SelectTrigger id="subscription-choice"><SelectValue /></SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                {account.subscriptions.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}{formatSeatSuffix(item.seats)} · {item.interval === "year" ? "Yearly" : "Monthly"}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      )}
      <div className="bl-grid">
        <SubscriptionPanel subscription={subscription} busy={busy} onShow={onShow} onQuotePeriod={onQuotePeriod} />
        <section id="payment" className="bl-panel">
          <h2>Payment method</h2>
          {account.paymentMethods.length ? (
            <ul className="bl-methods">
              {account.paymentMethods.map((method) => (
                <li key={method.id}>{method.label}{method.isDefault && <span className="bl-status">Default</span>}</li>
              ))}
            </ul>
          ) : (
            <p className="bl-empty">No payment method saved.</p>
          )}
          <p className="bl-hint">Add a card securely. It becomes the default for future payments.</p>
          <Button variant="outline" disabled={busy} onClick={onUpdatePayment}>Update payment method</Button>
        </section>
      </div>
    </>
  );
}
