import { Link } from "react-router-dom";
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { billingDate, money, type BillingAccount, type Subscription } from "@/lib/billing";
import { isSeatReviewDisabled, PAGE_SIZE, type BillingAction, type ReleaseTarget } from "./billing-actions";

function RecordPages({ page, count, label, onChange }: { page: number; count: number; label: string; onChange: (page: number) => void }) {
  const last = Math.max(0, Math.ceil(count / PAGE_SIZE) - 1);
  return (
    <div className="bl-pager">
      <span role="status">
        {count ? `${page * PAGE_SIZE + 1}–${Math.min(count, (page + 1) * PAGE_SIZE)} of ${count} ${label}` : `0 ${label}`}
      </span>
      <div className="bl-actions">
        <Button variant="outline" disabled={page === 0} onClick={() => onChange(page - 1)}>Previous</Button>
        <Button variant="outline" disabled={page >= last} onClick={() => onChange(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

function InvoicesTab(props: {
  invoices: BillingAccount["invoices"];
  page: number;
  downloads: Record<string, string>;
  busy: boolean;
  onPageChange: (page: number) => void;
  onDownload: (orderId: string, kind: "invoice" | "receipt") => void;
}) {
  const { invoices, page, downloads, busy, onPageChange, onDownload } = props;
  const visible = invoices.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  return (
    <TabsContent value="invoices" className="bl-panel">
      <div className="bl-list-heading"><div><h2>Invoices</h2><p>Invoices and receipts for your subscriptions.</p></div></div>
      {invoices.length ? (
        <>
          <Table className="bl-invoices">
            <TableHeader>
              <TableRow><TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Download</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell><strong>{invoice.number}</strong></TableCell>
                  <TableCell>{billingDate(invoice.date)}</TableCell>
                  <TableCell className="tabular-nums">{money(invoice.amount, invoice.currency)}</TableCell>
                  <TableCell>
                    <div className="bl-actions">
                      {(["invoice", "receipt"] as const)
                        .filter((kind) => kind === "invoice" || invoice.receiptAvailable)
                        .map((kind) => {
                          const href = downloads[`${invoice.id}:${kind}`];
                          if (href) {
                            return (
                              <Button key={kind} asChild variant="outline">
                                <a href={href} target="_blank" rel="noopener noreferrer">
                                  <DownloadIcon data-icon="inline-start" aria-hidden="true" />Download {kind}
                                </a>
                              </Button>
                            );
                          }
                          return (
                            <Button key={kind} variant="ghost" disabled={busy} onClick={() => onDownload(invoice.id, kind)}>
                              Prepare {kind}
                            </Button>
                          );
                        })}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <RecordPages page={page} count={invoices.length} label="invoices" onChange={onPageChange} />
          <p className="bl-hint">Receipt downloads appear when Polar has issued a receipt for the order.</p>
        </>
      ) : (
        <p className="bl-empty">Your paid invoices and receipts will appear here.</p>
      )}
    </TabsContent>
  );
}

function LicenceMachines(props: {
  licence: BillingAccount["licences"][number];
  busy: boolean;
  onRequestRelease: (target: ReleaseTarget, trigger: HTMLElement) => void;
}) {
  const { licence, busy, onRequestRelease } = props;
  if (licence.status !== "granted") return null;
  const count = licence.machines.length;
  const countText = licence.limit !== null
    ? `${count} of ${licence.limit} machines in use`
    : `${count} ${count === 1 ? "machine" : "machines"} in use`;

  return (
    <div className="bl-machines">
      <p className="bl-machine-count">{countText}</p>
      {licence.limit !== null && (
        <div className="bl-machine-bar" role="img" aria-label={countText}>
          <div style={{ width: `${Math.min(100, (count / Math.max(1, licence.limit)) * 100)}%` }} />
        </div>
      )}
      {count > 0 && (
        <div className="bl-machine-table">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Machine</TableHead><TableHead>Used by</TableHead><TableHead>Added</TableHead><TableHead><span className="sr-only">Action</span></TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {licence.machines.map((machine) => (
                <TableRow key={machine.id}>
                  <TableCell><div className="bl-machine-name"><span>{machine.name ?? "Unnamed machine"}</span><code>{machine.label}</code></div></TableCell>
                  <TableCell>{machine.product ?? "Pilot Shell or an earlier QualityLayer"}</TableCell>
                  <TableCell className="tabular-nums">{billingDate(machine.added)}</TableCell>
                  <TableCell className="bl-machine-action">
                    <Button
                      variant="outline"
                      disabled={busy}
                      aria-label={`Release ${machine.name ?? machine.label}`}
                      onClick={(event) => onRequestRelease({ licenceId: licence.id, activationId: machine.id, name: machine.name ?? "this machine" }, event.currentTarget)}
                    >
                      Release
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function LicencesTab(props: {
  licences: BillingAccount["licences"];
  busy: boolean;
  onCopyKey: (key: string) => void;
  onRequestRelease: (target: ReleaseTarget, trigger: HTMLElement) => void;
}) {
  const { licences, busy, onCopyKey, onRequestRelease } = props;
  return (
    <TabsContent value="licences" className="bl-panel">
      <h2>Licence keys</h2>
      {licences.length ? (
        <ul className="bl-keys">
          {licences.map((licence) => (
            <li key={licence.id} className="bl-key">
              <div className="bl-key-head">
                <details>
                  <summary>{licence.label} · {licence.status.replaceAll("_", " ")}</summary>
                  <code>{licence.key}</code>
                </details>
                <Button variant="outline" onClick={() => onCopyKey(licence.key)}>Copy licence key</Button>
              </div>
              <LicenceMachines licence={licence} busy={busy} onRequestRelease={onRequestRelease} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="bl-empty">Your licence keys will appear here after Polar grants them.</p>
      )}
      <p className="bl-hint">Paste your key in the App to activate this computer. Pilot Shell uses places on the same key. Release machines you no longer use to free a place.</p>
      <Link to="/download">Download the App</Link>
    </TabsContent>
  );
}

function MembersTab(props: {
  team: BillingAccount["seats"][number];
  subscription: Subscription;
  matchingMembers: BillingAccount["seats"][number]["seats"];
  page: number;
  memberSearch: string;
  invite: string;
  seatCount: number | null;
  busy: boolean;
  onSearchChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onInviteChange: (value: string) => void;
  onSeatCountChange: (value: number) => void;
  onInviteSubmit: () => void;
  onQuoteSeats: () => void;
  onShow: (action: BillingAction) => void;
}) {
  const { team, subscription, matchingMembers, page, memberSearch, invite, seatCount, busy } = props;
  const visible = matchingMembers.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const desiredSeats = seatCount ?? team.total;

  return (
    <TabsContent value="members" className="bl-panel">
      <div className="bl-list-heading">
        <div><h2>Seats</h2><p>{team.seats.length} of {team.total} seats assigned</p></div>
        <Field className="bl-search">
          <FieldLabel htmlFor="member-search">Search members</FieldLabel>
          <Input id="member-search" type="search" placeholder="Search by email" value={memberSearch} onChange={(event) => props.onSearchChange(event.target.value)} />
        </Field>
      </div>
      <ul className="bl-seat-list">
        {visible.map((seat) => (
          <li key={seat.id}>
            <div><strong>{seat.email}</strong><span>{seat.status === "pending" ? "Invitation pending" : "Joined"}</span></div>
            <div className="bl-actions">
              {seat.status === "pending" && (
                <Button variant="ghost" disabled={busy} onClick={() => props.onShow({ kind: "resend-seat", title: "Resend seat invitation?", copy: `Polar will email a fresh invitation to ${seat.email}.`, label: "Send invitation", subscription, seatId: seat.id })}>
                  Resend invitation
                </Button>
              )}
              <Button variant="ghost" disabled={busy} onClick={() => props.onShow({ kind: "revoke-seat", title: "Revoke this seat?", copy: `${seat.email} will lose this seat and its licence. Your purchased seat count stays at ${team.total}.`, label: "Revoke seat", subscription, seatId: seat.id })}>
                Revoke seat
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {!matchingMembers.length && (
        <p className="bl-empty">{memberSearch ? "No members match your search." : "No seats assigned yet. Invite a teammate below."}</p>
      )}
      <RecordPages page={page} count={matchingMembers.length} label="members" onChange={props.onPageChange} />
      <div className="bl-seat-forms">
        <form className="bl-seat-form" onSubmit={(event) => { event.preventDefault(); props.onInviteSubmit(); }}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="invite-email">Assign a seat by email</FieldLabel>
              <Input id="invite-email" type="email" required placeholder="teammate@company.com" value={invite} onChange={(event) => props.onInviteChange(event.target.value)} />
            </Field>
            <Button variant="outline" type="submit" disabled={busy || team.seats.length >= team.total}>Invite teammate</Button>
            {team.seats.length >= team.total && <p className="bl-hint">All purchased seats are assigned.</p>}
          </FieldGroup>
        </form>
        <form className="bl-seat-form" onSubmit={(event) => { event.preventDefault(); props.onQuoteSeats(); }}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="seat-count">Purchased seats</FieldLabel>
              <Input id="seat-count" type="number" min={Math.max(1, team.seats.length)} max={1000} required disabled={subscription.legacy} value={desiredSeats} onChange={(event) => props.onSeatCountChange(Number(event.target.value))} />
            </Field>
            <Button variant="outline" disabled={isSeatReviewDisabled(subscription, busy, desiredSeats, team.total)} type="submit">Review seat count</Button>
          </FieldGroup>
        </form>
      </div>
      <p className="bl-hint">
        {subscription.legacy
          ? "Contact support to change purchased seats while preserving your existing subscription terms."
          : "Enter a different count to review the price. Changes take effect at the next renewal. Existing assignments must fit within the new total."}
      </p>
    </TabsContent>
  );
}

export interface BillingRecordsProps {
  account: BillingAccount;
  subscription: Subscription | undefined;
  team: BillingAccount["seats"][number] | undefined;
  matchingMembers: BillingAccount["seats"][number]["seats"];
  detailTab: string;
  invoicePage: number;
  memberPage: number;
  memberSearch: string;
  invite: string;
  seatCount: number | null;
  downloads: Record<string, string>;
  busy: boolean;
  onTabChange: (tab: string) => void;
  onInvoicePageChange: (page: number) => void;
  onMemberPageChange: (page: number) => void;
  onMemberSearchChange: (value: string) => void;
  onInviteChange: (value: string) => void;
  onSeatCountChange: (value: number) => void;
  onDownload: (orderId: string, kind: "invoice" | "receipt") => void;
  onCopyKey: (key: string) => void;
  onRequestRelease: (target: ReleaseTarget, trigger: HTMLElement) => void;
  onInviteSubmit: () => void;
  onQuoteSeats: () => void;
  onShow: (action: BillingAction) => void;
}

export function BillingRecordsTabs(props: BillingRecordsProps) {
  return (
    <Tabs className="bl-records" value={props.detailTab} onValueChange={props.onTabChange}>
      <TabsList variant="line" className="bl-tabs" aria-label="Billing details">
        <TabsTrigger value="invoices">Invoices</TabsTrigger>
        <TabsTrigger value="licences">Licence keys</TabsTrigger>
        {props.team && <TabsTrigger value="members">Seats</TabsTrigger>}
      </TabsList>
      <InvoicesTab
        invoices={props.account.invoices}
        page={props.invoicePage}
        downloads={props.downloads}
        busy={props.busy}
        onPageChange={props.onInvoicePageChange}
        onDownload={props.onDownload}
      />
      <LicencesTab
        licences={props.account.licences}
        busy={props.busy}
        onCopyKey={props.onCopyKey}
        onRequestRelease={props.onRequestRelease}
      />
      {props.team && props.subscription && (
        <MembersTab
          team={props.team}
          subscription={props.subscription}
          matchingMembers={props.matchingMembers}
          page={props.memberPage}
          memberSearch={props.memberSearch}
          invite={props.invite}
          seatCount={props.seatCount}
          busy={props.busy}
          onSearchChange={props.onMemberSearchChange}
          onPageChange={props.onMemberPageChange}
          onInviteChange={props.onInviteChange}
          onSeatCountChange={props.onSeatCountChange}
          onInviteSubmit={props.onInviteSubmit}
          onQuoteSeats={props.onQuoteSeats}
          onShow={props.onShow}
        />
      )}
    </Tabs>
  );
}
