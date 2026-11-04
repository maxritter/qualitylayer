import { useEffect, useRef, useState, type FormEvent } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { Dialog as Modal } from "radix-ui";
import { DownloadIcon, LogOutIcon } from "lucide-react";
import Page from "@/components/Page";
import SEO from "@/components/SEO";
import { CONTACT_EMAIL } from "@/lib/product";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { billingDate, BillingError, billingRequest, money, type BillingAccount, type BillingQuote, type Subscription } from "@/lib/billing";
import PaymentMethodPanel from "@/components/PaymentMethodPanel";
import "@/styles/billing.css";

type Action = { kind: string; title: string; copy: string; label: string; subscription: Subscription; quote?: BillingQuote; seatId?: string; email?: string; step?: 1 | 2 | 3; reasons?: string[]; note?: string };
/** Why people cancel: any number may be ticked, and none is required (§312k BGB keeps cancelling free of hurdles). */
const CANCEL_REASONS = ["Too expensive", "I don’t use it enough", "Missing a feature I need", "Moving to another tool", "Hard to set up or use", "Bugs or reliability", "The project ended", "Something else"];
const cancelStart = (subscription: Subscription): Action => ({ kind: "cancel", step: 1, reasons: [], note: "", title: "Before you cancel", copy: "What made you decide to cancel? Pick any that apply.", label: "Continue", subscription });
const PAGE_SIZE = 10;

function RecordPages({ page, count, label, onChange }: { page: number; count: number; label: string; onChange: (page: number) => void }) {
  const last = Math.max(0, Math.ceil(count / PAGE_SIZE) - 1);
  return <div className="bl-pager"><span role="status">{count ? `${page * PAGE_SIZE + 1}–${Math.min(count, (page + 1) * PAGE_SIZE)} of ${count} ${label}` : `0 ${label}`}</span><div className="bl-actions"><Button variant="outline" disabled={page === 0} onClick={() => onChange(page - 1)}>Previous</Button><Button variant="outline" disabled={page >= last} onClick={() => onChange(page + 1)}>Next</Button></div></div>;
}

export default function Billing() {
  const [account, setAccount] = useState<BillingAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState("");
  const [dialog, setDialog] = useState<Action | null>(null);
  const [invite, setInvite] = useState("");
  const [seatCount, setSeatCount] = useState<number | null>(null);
  const [paymentSession, setPaymentSession] = useState<{ token: string; fixture?: boolean } | null>(null);
  const [release, setRelease] = useState<{ licenceId: string; activationId: string; name: string } | null>(null);
  const [downloads, setDownloads] = useState<Record<string, string>>({});
  const [detailTab, setDetailTab] = useState("invoices");
  const [invoicePage, setInvoicePage] = useState(0);
  const [memberPage, setMemberPage] = useState(0);
  const [memberSearch, setMemberSearch] = useState("");
  const opener = useRef<HTMLElement | null>(null);
  const message = useRef<HTMLDivElement>(null);
  const codeField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    billingRequest<BillingAccount>().then((value) => { if (active) setAccount(value); }).catch((err) => {
      if (active && (!(err instanceof BillingError) || err.status !== 401)) setError(err.message);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => { if (challenge) codeField.current?.focus(); }, [challenge]);
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("polar_payment_method_status")) return;
    void import("@polar-sh/checkout/payment-method").then(({ PolarEmbedPaymentMethod }) => {
      const result = PolarEmbedPaymentMethod.getRedirectResult();
      if (result?.status === "failed") setError("The payment method could not be updated. Try again or contact support.");
      else if (result?.status === "succeeded") setNotice("Your current payment methods are listed below.");
    });
  }, []);
  const subscription = account?.subscriptions.find((item) => item.id === selected) ?? account?.subscriptions[0];
  const team = account?.seats.find((item) => item.subscriptionId === subscription?.id);
  const matchingMembers = team?.seats.filter((seat) => seat.email.toLowerCase().includes(memberSearch.trim().toLowerCase())) ?? [];
  const currentMemberPage = Math.min(memberPage, Math.max(0, Math.ceil(matchingMembers.length / PAGE_SIZE) - 1));
  const currentInvoicePage = Math.min(invoicePage, Math.max(0, Math.ceil((account?.invoices.length ?? 0) / PAGE_SIZE) - 1));

  async function reload() { setAccount(await billingRequest<BillingAccount>()); }
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await work(); }
    catch (err) {
      if (err instanceof BillingError && err.status === 401 && account) { setAccount(null); setChallenge(null); setDialog(null); setPaymentSession(null); }
      setError(err instanceof Error ? err.message : "Please try again.");
      requestAnimationFrame(() => message.current?.focus());
    } finally { setBusy(false); }
  }
  function show(action: Action) {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError(""); setDialog(action);
  }
  async function signIn(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      if (!challenge) setChallenge((await billingRequest<{ challenge: string }>("request-code", { email })).challenge);
      else { await billingRequest("verify-code", { challenge, code }); await reload(); setCode(""); setChallenge(null); }
    });
  }
  async function quote(kind: "period" | "seats", productId?: string) {
    if (!subscription) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await run(async () => {
      const value = await billingRequest<BillingQuote>("quote", { kind, subscriptionId: subscription.id, productId, seats: seatCount ?? subscription.seats ?? 1 });
      setDialog({ kind: "apply-quote", title: kind === "period" ? "Change billing period" : "Change seat count", copy: "Your current subscription continues until this change takes effect. No prorated charge is due today.", label: "Schedule change", subscription, quote: value });
    });
  }
  async function confirm() {
    if (!dialog) return;
    if (dialog.kind === "cancel") {
      const action = dialog;
      if (action.step === 1) { setDialog({ ...action, step: 2, title: `Cancel ${action.subscription.name}?`, copy: `Renewals stop. You keep full access until ${billingDate(action.subscription.periodEnd)}, and your plans stay in your repositories.`, label: "Cancel subscription" }); return; }
      if (action.step === 2) {
        await run(async () => {
          await billingRequest("cancel", { subscriptionId: action.subscription.id, reasons: action.reasons, note: action.note });
          setDialog({ ...action, step: 3, title: `Your subscription ends on ${billingDate(action.subscription.periodEnd)}`, copy: `Polar sends a confirmation to ${account?.email ?? "your email"}.`, label: "Close" });
          await reload();
        });
        return;
      }
      setDialog(null); return;
    }
    await run(async () => {
      await billingRequest(dialog.kind, { subscriptionId: dialog.subscription.id, quoteId: dialog.quote?.id, seatId: dialog.seatId });
      setDialog(null); setNotice(dialog.kind === "resend-seat" ? "Seat invitation sent." : dialog.kind === "revoke-seat" ? "Seat revoked." : "Your subscription has been updated."); await reload();
    });
  }
  async function updatePayment() {
    await run(async () => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPaymentSession(await billingRequest<{ token: string; fixture?: boolean }>("payment-session"));
    });
  }
  async function download(orderId: string, kind: "invoice" | "receipt") {
    await run(async () => {
      const result = await billingRequest<{ url?: string; pending?: boolean; unavailable?: boolean }>(kind, { orderId });
      if (result.unavailable) { setNotice("Polar has not issued a receipt for this order. You can download its invoice instead."); return; }
      if (result.pending) { setNotice("Polar is preparing your invoice. Try again in a moment."); return; }
      if (!result.url) throw new Error("The download is unavailable. Please contact support.");
      const url = new URL(result.url);
      if (url.protocol !== "https:") throw new Error("The download is unavailable. Please contact support.");
      setDownloads((values) => ({ ...values, [`${orderId}:${kind}`]: url.href }));
    });
  }
  const status = subscription?.canceled ? "Ends at period end" : subscription?.pauseScheduled ? "Pauses at period end" : subscription?.status.replaceAll("_", " ");

  return <><SEO /><Helmet><meta name="referrer" content="no-referrer" /></Helmet><Page className="page-billing"><div className="bl-wrap">
    <div ref={message} tabIndex={-1} className="bl-feedback">
      {error && <div className="bl-notice error" role="alert">{error}</div>}
      {notice && <div className="bl-notice" role="status">{notice}</div>}
    </div>
    {loading ? <div className="bl-loading" role="status">Loading your billing account…</div> : !account ? <section className="bl-login" aria-labelledby="billing-title">
      <h1 id="billing-title">Your subscription</h1><p>Sign in with the email you used at checkout to manage billing and your licence.</p>
      <form onSubmit={signIn}>
        <FieldGroup><Field className="bl-field"><FieldLabel htmlFor="billing-email">Email address</FieldLabel><Input id="billing-email" type="email" autoComplete="email" required maxLength={254} value={email} disabled={busy || !!challenge} onChange={(event) => setEmail(event.target.value)} /></Field>
        {challenge && <Field className="bl-field"><FieldLabel htmlFor="billing-code">Sign-in code</FieldLabel><Input ref={codeField} id="billing-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} /><p className="bl-hint">Enter the six-digit code sent to {email}. It expires in 10 minutes.</p></Field>}</FieldGroup>
        <Button className="bl-primary" type="submit" disabled={busy}>{busy ? "Please wait…" : challenge ? "Sign in" : "Send sign-in code"}</Button>
        {challenge && <Button type="button" variant="ghost" className="bl-link" disabled={busy} onClick={() => { setChallenge(null); setCode(""); setError(""); }}>Use another email or request a new code</Button>}
      </form>
      <a href={`mailto:${CONTACT_EMAIL}`}>Contact support</a>
    </section> : <>
      <div className="bl-intro"><div><h1>Subscription &amp; billing</h1><p>Manage your plan, payments and licence.</p></div><div className="bl-account"><div className="bl-identity"><small>Signed in as</small><span>{account.email}</span></div><Button variant="outline" disabled={busy} onClick={() => void run(async () => { await billingRequest("sign-out"); setAccount(null); setDownloads({}); setPaymentSession(null); setEmail(""); setCode(""); setChallenge(null); })}><LogOutIcon data-icon="inline-start" aria-hidden="true" />Sign out</Button></div></div>
      {account.subscriptions.length > 1 && <Field className="bl-field bl-picker"><FieldLabel htmlFor="subscription-choice">Subscription</FieldLabel><Select value={subscription?.id} onValueChange={(id) => { setSelected(id); setSeatCount(null); setMemberSearch(""); setMemberPage(0); setDetailTab("invoices"); }}><SelectTrigger id="subscription-choice"><SelectValue /></SelectTrigger><SelectContent position="popper"><SelectGroup>{account.subscriptions.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}{item.seats !== null ? ` · ${item.seats} ${item.seats === 1 ? "seat" : "seats"}` : ""} · {item.interval === "year" ? "Yearly" : "Monthly"}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>}
      <div className="bl-grid">
        <section id="subscription" className="bl-panel"><h2>Subscription</h2>{subscription ? <>
          <div className="bl-plan-head"><h3>{subscription.name}</h3><Badge variant="outline" className="bl-status">{status}</Badge></div>
          <p className="bl-price">{money(subscription.amount, subscription.currency)} <small>per {subscription.interval}{subscription.seats !== null ? ` · ${subscription.seats} ${subscription.seats === 1 ? "seat" : "seats"}` : ""}</small></p>
          <dl className="bl-details"><div><dt>{subscription.canceled ? "Access until" : subscription.status === "paused" ? "Paused since" : "Next renewal"}</dt><dd>{billingDate(subscription.periodEnd)}</dd></div><div><dt>Billing</dt><dd>{subscription.interval === "year" ? "Yearly" : "Monthly"}</dd></div></dl>
          {subscription.legacy && <p className="bl-hint">Your Pilot Shell subscription keeps its current price. Contact support to change products.</p>}
          {subscription.status === "past_due" && <p className="bl-hint">A renewal payment failed. Update your payment method to restore payment.</p>}
          {subscription.pending && <div className="bl-notice"><p>{subscription.pending.name}{subscription.pending.seats ? ` · ${subscription.pending.seats} seats` : ""} takes effect on {billingDate(subscription.pending.at)}.</p><Button variant="ghost" disabled={busy} onClick={() => show({ kind: "clear-change", title: "Keep your current subscription?", copy: "The scheduled change will be removed. Your existing plan and price continue.", label: "Keep current plan", subscription })}>Remove scheduled change</Button></div>}
          <div className="bl-actions">
            {!subscription.canceled && !subscription.pauseScheduled && !subscription.pending && subscription.status === "active" && subscription.options.map((option) => <Button key={option.productId} variant="outline" disabled={busy} onClick={() => void quote("period", option.productId)}>Switch to {option.interval === "year" ? "yearly" : "monthly"} billing</Button>)}
            {!subscription.canceled && subscription.status !== "past_due" && <Button variant="ghost" disabled={busy} onClick={() => show({ kind: subscription.status === "paused" ? "resume" : subscription.pauseScheduled ? "unpause" : "pause", title: subscription.status === "paused" ? "Resume subscription?" : subscription.pauseScheduled ? "Keep subscription active?" : "Pause subscription?", copy: subscription.status === "paused" ? `Resuming starts a new paid billing period immediately at ${money(subscription.amount, subscription.currency)} per ${subscription.interval}, plus any applicable tax.` : subscription.pauseScheduled ? "Your existing renewal date and price continue." : `Your subscription pauses on ${billingDate(subscription.periodEnd)}. Access stops while paused. Resuming starts a new paid billing period.`, label: subscription.status === "paused" ? "Resume and pay" : subscription.pauseScheduled ? "Keep active" : "Pause at period end", subscription })}>{subscription.status === "paused" ? "Resume subscription" : subscription.pauseScheduled ? "Keep active" : "Pause subscription"}</Button>}
          </div>
          <div className="bl-bottom"><span>Manage renewal</span><Button variant="ghost" disabled={busy} onClick={() => show(subscription.canceled ? { kind: "uncancel", title: "Keep subscription?", copy: "Your subscription continues at its existing price.", label: "Keep subscription", subscription } : cancelStart(subscription))}>{subscription.canceled ? "Keep subscription" : "Cancel subscription"}</Button></div>
        </> : <><p className="bl-empty">No active subscription is associated with this account.</p><Link to="/pricing">Choose a plan</Link></>}</section>
        <section id="payment" className="bl-panel"><h2>Payment method</h2>{account.paymentMethods.length ? <ul className="bl-methods">{account.paymentMethods.map((method) => <li key={method.id}>{method.label}{method.isDefault && <span className="bl-status">Default</span>}</li>)}</ul> : <p className="bl-empty">No payment method saved.</p>}<p className="bl-hint">Add a card securely. It becomes the default for future payments.</p><Button variant="outline" disabled={busy} onClick={() => void updatePayment()}>Update payment method</Button></section>
      </div>
      <Tabs className="bl-records" value={detailTab} onValueChange={setDetailTab}>
        <TabsList variant="line" className="bl-tabs" aria-label="Billing details"><TabsTrigger value="invoices">Invoices</TabsTrigger><TabsTrigger value="licences">Licence keys</TabsTrigger>{team && <TabsTrigger value="members">Team seats</TabsTrigger>}</TabsList>
        <TabsContent value="invoices" className="bl-panel"><div className="bl-list-heading"><div><h2>Invoices</h2><p>Invoices and receipts for your subscriptions.</p></div></div>
          {account.invoices.length ? <><Table className="bl-invoices"><TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Download</TableHead></TableRow></TableHeader><TableBody>{account.invoices.slice(currentInvoicePage * PAGE_SIZE, (currentInvoicePage + 1) * PAGE_SIZE).map((invoice) => <TableRow key={invoice.id}><TableCell><strong>{invoice.number}</strong></TableCell><TableCell>{billingDate(invoice.date)}</TableCell><TableCell className="tabular-nums">{money(invoice.amount, invoice.currency)}</TableCell><TableCell><div className="bl-actions">{(["invoice", "receipt"] as const).filter((kind) => kind === "invoice" || invoice.receiptAvailable).map((kind) => downloads[`${invoice.id}:${kind}`] ? <Button key={kind} asChild variant="outline"><a href={downloads[`${invoice.id}:${kind}`]} target="_blank" rel="noopener noreferrer"><DownloadIcon data-icon="inline-start" aria-hidden="true" />Download {kind}</a></Button> : <Button key={kind} variant="ghost" disabled={busy} onClick={() => void download(invoice.id, kind)}>Prepare {kind}</Button>)}</div></TableCell></TableRow>)}</TableBody></Table><RecordPages page={currentInvoicePage} count={account.invoices.length} label="invoices" onChange={setInvoicePage} /><p className="bl-hint">Receipt downloads appear when Polar has issued a receipt for the order.</p></> : <p className="bl-empty">Your paid invoices and receipts will appear here.</p>}
        </TabsContent>
        <TabsContent value="licences" className="bl-panel"><h2>Licence keys</h2>{account.licences.length ? <ul className="bl-keys">{account.licences.map((licence) => <li key={licence.id} className="bl-key">
          <div className="bl-key-head"><details><summary>{licence.label} · {licence.status.replaceAll("_", " ")}</summary><code>{licence.key}</code></details><Button variant="outline" onClick={() => void run(async () => { await navigator.clipboard.writeText(licence.key); setNotice("Licence key copied."); })}>Copy licence key</Button></div>
          {licence.status === "granted" && <div className="bl-machines">
            <p className="bl-machine-count">{licence.limit !== null ? `${licence.machines.length} of ${licence.limit} machines in use` : `${licence.machines.length} ${licence.machines.length === 1 ? "machine" : "machines"} in use`}</p>
            {licence.limit !== null && <div className="bl-machine-bar" role="img" aria-label={`${licence.machines.length} of ${licence.limit} machines in use`}><div style={{ width: `${Math.min(100, (licence.machines.length / Math.max(1, licence.limit)) * 100)}%` }} /></div>}
            {licence.machines.length > 0 && <div className="bl-machine-table"><Table><TableHeader><TableRow><TableHead>Machine</TableHead><TableHead>Used by</TableHead><TableHead>Added</TableHead><TableHead><span className="sr-only">Action</span></TableHead></TableRow></TableHeader><TableBody>{licence.machines.map((machine) => <TableRow key={machine.id}>
              <TableCell><div className="bl-machine-name"><span>{machine.name ?? "Unnamed machine"}</span><code>{machine.label}</code></div></TableCell>
              <TableCell>{machine.product ?? "Pilot Shell or an earlier QualityLayer"}</TableCell>
              <TableCell className="tabular-nums">{billingDate(machine.added)}</TableCell>
              <TableCell className="bl-machine-action"><Button variant="outline" disabled={busy} aria-label={`Release ${machine.name ?? machine.label}`} onClick={(event) => { opener.current = event.currentTarget; setError(""); setRelease({ licenceId: licence.id, activationId: machine.id, name: machine.name ?? "this machine" }); }}>Release</Button></TableCell>
            </TableRow>)}</TableBody></Table></div>}
          </div>}
        </li>)}</ul> : <p className="bl-empty">Your licence keys will appear here after Polar grants them.</p>}<p className="bl-hint">Paste your key in the App to activate this computer. Pilot Shell uses places on the same key. Release machines you no longer use to free a place.</p><Link to="/download">Download the App</Link></TabsContent>
        {team && subscription && <TabsContent value="members" className="bl-panel"><div className="bl-list-heading"><div><h2>Team seats</h2><p>{team.seats.length} of {team.total} seats assigned</p></div><Field className="bl-search"><FieldLabel htmlFor="member-search">Search members</FieldLabel><Input id="member-search" type="search" placeholder="Search by email" value={memberSearch} onChange={(event) => { setMemberSearch(event.target.value); setMemberPage(0); }} /></Field></div>
          <ul className="bl-seat-list">{matchingMembers.slice(currentMemberPage * PAGE_SIZE, (currentMemberPage + 1) * PAGE_SIZE).map((seat) => <li key={seat.id}><div><strong>{seat.email}</strong><span>{seat.status === "pending" ? "Invitation pending" : "Joined"}</span></div><div className="bl-actions">{seat.status === "pending" && <Button variant="ghost" disabled={busy} onClick={() => show({ kind: "resend-seat", title: "Resend seat invitation?", copy: `Polar will email a fresh invitation to ${seat.email}.`, label: "Send invitation", subscription, seatId: seat.id })}>Resend invitation</Button>}<Button variant="ghost" disabled={busy} onClick={() => show({ kind: "revoke-seat", title: "Revoke this seat?", copy: `${seat.email} will lose this seat and its licence. Your purchased seat count stays at ${team.total}.`, label: "Revoke seat", subscription, seatId: seat.id })}>Revoke seat</Button></div></li>)}</ul>
          {!matchingMembers.length && <p className="bl-empty">{memberSearch ? "No members match your search." : "No seats assigned yet. Invite a teammate below."}</p>}
          <RecordPages page={currentMemberPage} count={matchingMembers.length} label="members" onChange={setMemberPage} />
          <div className="bl-seat-forms"><form className="bl-seat-form" onSubmit={(event) => { event.preventDefault(); void run(async () => { await billingRequest("assign-seat", { subscriptionId: subscription.id, email: invite }); setInvite(""); setNotice("Seat invitation sent."); await reload(); }); }}><FieldGroup><Field><FieldLabel htmlFor="invite-email">Assign a seat by email</FieldLabel><Input id="invite-email" type="email" required placeholder="teammate@company.com" value={invite} onChange={(event) => setInvite(event.target.value)} /></Field><Button variant="outline" type="submit" disabled={busy || team.seats.length >= team.total}>Invite teammate</Button>{team.seats.length >= team.total && <p className="bl-hint">All purchased seats are assigned.</p>}</FieldGroup></form>
          <form className="bl-seat-form" onSubmit={(event) => { event.preventDefault(); void quote("seats"); }}><FieldGroup><Field><FieldLabel htmlFor="seat-count">Purchased seats</FieldLabel><Input id="seat-count" type="number" min={Math.max(1, team.seats.length)} max={1000} required disabled={subscription.legacy} value={seatCount ?? team.total} onChange={(event) => setSeatCount(Number(event.target.value))} /></Field><Button variant="outline" disabled={subscription.legacy || busy || !!subscription.pending || subscription.canceled || subscription.pauseScheduled || subscription.status !== "active" || (seatCount ?? team.total) === team.total} type="submit">Review seat count</Button></FieldGroup></form></div><p className="bl-hint">{subscription.legacy ? "Contact support to change purchased seats while preserving your existing subscription terms." : "Enter a different count to review the price. Changes take effect at the next renewal. Existing assignments must fit within the new total."}</p>
        </TabsContent>}
      </Tabs>
      <div className="bl-bottom"><a href={`mailto:${CONTACT_EMAIL}`}>Contact support</a></div>
    </>}
  </div></Page>
  <Modal.Root open={!!dialog || !!paymentSession} onOpenChange={(open) => { if (!open && !busy) { setDialog(null); setPaymentSession(null); } }}><Modal.Portal><Modal.Overlay className="bl-overlay" /><Modal.Content className="bl-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus(); }} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}>
    {dialog?.kind === "cancel" && dialog.step !== 3 && <p className="bl-step">Step {dialog.step} of 2</p>}
    <Modal.Title>{paymentSession ? "Update payment method" : dialog?.title}</Modal.Title><Modal.Description>{paymentSession ? "Your card details go directly to Polar’s payment processor. The new card becomes your default." : dialog?.copy}</Modal.Description>
    {paymentSession && <PaymentMethodPanel token={paymentSession.token} fixture={paymentSession.fixture} onConfirmed={() => setBusy(true)} onSuccess={() => { setBusy(false); setPaymentSession(null); setNotice("Your default payment method has been updated."); void reload().catch(() => setError("Refresh billing to see your updated payment method.")); }} onError={() => { setBusy(false); setError("Polar could not update your payment method. Try again or contact support."); }} />}
    {dialog?.quote && <dl className="bl-details"><div><dt>New price</dt><dd>{money(dialog.quote.amount, dialog.quote.currency)} per {dialog.quote.interval}</dd></div><div><dt>Takes effect</dt><dd>{billingDate(dialog.quote.effectiveAt)}</dd></div><div><dt>Due today</dt><dd>{money(dialog.quote.dueNow, dialog.quote.currency)}</dd></div><div><dt>Tax</dt><dd>Calculated by Polar at renewal</dd></div></dl>}
    {dialog?.kind === "cancel" && dialog.step === 1 && <>
      <fieldset className="bl-reasons"><legend>Reasons, optional</legend>{CANCEL_REASONS.map((reason) => <label key={reason} className="bl-reason"><input type="checkbox" checked={dialog.reasons?.includes(reason) ?? false} onChange={(event) => setDialog({ ...dialog, reasons: event.target.checked ? [...(dialog.reasons ?? []), reason] : (dialog.reasons ?? []).filter((r) => r !== reason) })} /><span>{reason}</span></label>)}</fieldset>
      <label className="bl-note"><span>Anything else? Optional</span><textarea rows={3} maxLength={1000} value={dialog.note ?? ""} placeholder="What would have made you stay?" onChange={(event) => setDialog({ ...dialog, note: event.target.value })} /></label>
      {dialog.subscription.status === "active" && !dialog.subscription.pauseScheduled && <div className="bl-offer"><div><strong>Pause instead?</strong><span>No charges while paused. Your plans and settings stay; resume any time.</span></div><Button variant="outline" disabled={busy} onClick={() => setDialog({ kind: "pause", title: "Pause subscription?", copy: `Your subscription pauses on ${billingDate(dialog.subscription.periodEnd)}. Access stops while paused. Resuming starts a new paid billing period.`, label: "Pause at period end", subscription: dialog.subscription })}>Pause instead</Button></div>}
    </>}
    {dialog?.kind === "cancel" && dialog.step === 2 && <dl className="bl-details"><div><dt>Access until</dt><dd>{billingDate(dialog.subscription.periodEnd)}</dd></div><div><dt>Plan</dt><dd>{dialog.subscription.name}{dialog.subscription.seats ? ` · ${dialog.subscription.seats} seats` : ""} · {dialog.subscription.interval === "year" ? "Yearly" : "Monthly"}</dd></div><div><dt>Your reasons</dt><dd>{[...(dialog.reasons ?? []), dialog.note?.trim() ? `“${dialog.note.trim()}”` : ""].filter(Boolean).join(" · ") || "None given"}</dd></div></dl>}
    {dialog?.kind === "cancel" && dialog.step === 3 && (dialog.reasons?.length || dialog.note?.trim()) ? <p className="bl-sent">Thanks for telling us why.</p> : null}
    {error && <p role="alert" className="bl-dialog-error">{error}</p>}
    {dialog?.kind === "cancel" ? <div className="bl-actions">
      {dialog.step === 3 ? <><Button disabled={busy} onClick={() => setDialog(null)}>Close</Button><Button variant="outline" disabled={busy} onClick={() => setDialog({ kind: "uncancel", title: "Keep subscription?", copy: "Your subscription continues at its existing price.", label: "Keep subscription", subscription: dialog.subscription })}>Keep subscription after all</Button></>
        : <><Button disabled={busy} onClick={() => setDialog(null)}>Keep subscription</Button><Button variant={dialog.step === 2 ? "destructive" : "outline"} className={dialog.step === 2 ? "bl-danger" : undefined} disabled={busy} onClick={() => void confirm()}>{busy ? "Saving…" : dialog.label}</Button></>}
    </div> : <div className="bl-actions">{!paymentSession && <Button disabled={busy} onClick={() => void confirm()}>{busy ? "Saving…" : dialog?.label}</Button>}<Button variant="outline" disabled={busy} onClick={() => { setDialog(null); setPaymentSession(null); }}>Back</Button></div>}
  </Modal.Content></Modal.Portal></Modal.Root>
  <Modal.Root open={!!release} onOpenChange={(open) => { if (!open && !busy) setRelease(null); }}><Modal.Portal><Modal.Overlay className="bl-overlay" /><Modal.Content className="bl-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus(); }} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}>
    <Modal.Title>{`Release ${release?.name ?? "this machine"}?`}</Modal.Title>
    <Modal.Description>Its place on this key is freed now. If QualityLayer or Pilot Shell runs there again, it asks for the key and takes a place again.</Modal.Description>
    {error && <p role="alert" className="bl-dialog-error">{error}</p>}
    <div className="bl-actions"><Button disabled={busy} onClick={() => void run(async () => { if (!release) return; await billingRequest("release-machine", { licenceId: release.licenceId, activationId: release.activationId }); setRelease(null); setNotice("Machine released. Its place on the key is free."); await reload(); })}>{busy ? "Releasing…" : "Release machine"}</Button><Button variant="outline" disabled={busy} onClick={() => setRelease(null)}>Back</Button></div>
  </Modal.Content></Modal.Portal></Modal.Root></>;
}
