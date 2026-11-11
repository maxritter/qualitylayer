import { Link, useLocation } from "react-router-dom";
import Page from "@/components/Page";
import SEO from "@/components/SEO";
import { LEGAL_UPDATED, SELLER } from "@/lib/legal";
import { CONTACT_EMAIL, GITHUB_URL } from "@/lib/product";
import "@/styles/legal.css";

const Mail = () => <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
const Updated = ({ date = LEGAL_UPDATED }: { date?: { iso: string; label: string } }) => (
  <p className="lg-stamp">
    Last updated <time dateTime={date.iso}>{date.label}</time>
  </p>
);

function Imprint() {
  return (
    <>
      <h1>Imprint</h1>
      <p className="lg-stamp">Impressum · information according to § 5 DDG</p>
      <address>
        {SELLER.name}
        <br />
        QualityLayer
        <br />
        {SELLER.street}
        <br />
        {SELLER.city}
        <br />
        {SELLER.country}
      </address>
      <h2>Contact</h2>
      <p>E-mail: <Mail /></p>
      <h2>VAT ID</h2>
      <p>VAT identification number according to § 27a UStG: {SELLER.vatId}</p>
      <h2>Responsible for content</h2>
      <p>Responsible for journalistic and editorial content, including the blog, according to § 18 (2) MStV: {SELLER.name}, address as above.</p>
      <h2>Consumer dispute resolution</h2>
      <p>We are neither willing nor obliged to take part in dispute resolution proceedings before a consumer arbitration board.</p>
    </>
  );
}

function Privacy() {
  return (
    <>
      <h1>Privacy policy</h1>
      <Updated date={{ iso: "2026-11-10", label: "10 November 2026" }} />
      <p className="lg-lead">
        QualityLayer keeps tasks, Chats, artifacts, memories and terminal history on machines you control. Your chosen coding agent may send context to its provider under your account and settings. We process licence and trial requests, billing, downloads, updates and reports you choose to send. Older clients may still use the retained services described below during migration.
      </p>

      <h2>Who is responsible</h2>
      <p>
        {SELLER.name}, {SELLER.street}, {SELLER.city}, {SELLER.country}, <Mail />. More in the <Link to="/imprint">imprint</Link>.
      </p>

      <h2>Visiting this website</h2>
      <p>
        Vercel Inc. (USA) serves the website and our API from Frankfurt. Each request carries your IP address, the page, the time and your browser; Vercel keeps these logs briefly to deliver and protect the service (Art. 6 (1) (f) GDPR). Vercel Web Analytics counts page views without cookies and without identifying you (Art. 6 (1) (f)).
      </p>
      <p>
        We set only the cookies a function needs: a sign-in cookie for Billing (1 hour) and one while a team owner connects Slack (10 minutes). No tracking or advertising cookies (§ 25 (2) TDDDG).
      </p>

      <h2>Licence check and trial</h2>
      <p>
        The App checks your licence once a day. It sends your licence key, the activation and a code for this computer to our API, which asks Polar, our licence provider (Art. 6 (1) (b)). For a free trial we keep a one-way keyed hash of the computer’s code and its original trial dates to enforce one trial per computer (Art. 6 (1) (f)). Trial records have no automatic expiry, including after the trial ends. Upstash stores the replacement trial ledger. The App sends no usage events.
      </p>

      <h2>Buying and billing</h2>
      <p>
        Polar Software, Inc. sells QualityLayer as merchant of record. It processes your payment, invoices and taxes as its own controller, under Polar's privacy policy. To sign you in to Billing, we e-mail you a one-time code through Resend, Inc. (USA); the code is kept for 10 minutes (Art. 6 (1) (b)).
      </p>

      <h2>Retained services for older clients</h2>
      <p>Current local-first clients do not upload task, Chat, artifact or memory content for hosted collaboration. Older clients can still use the services below during the transition. We retain the old-client service and Neon for at least 14 days after both replacement client and backend are available, and until affected users have migrated and the final valid workflow grants and cache allowances have cleared. Some old workflow grants can last 30 days. Retirement requires a separate resource review; elapsed time alone does not authorize deletion. Previously agreed retention and customer rights continue.</p>
      <p>
        Older Team clients can share tasks, plans, comments, artifacts and files. They are encrypted on your computer with your team's key, so we store only ciphertext. To route them we also store your team members' names and e-mail addresses from Polar, task names and steps, who asked whom, who read which version, and each computer's public key (Art. 6 (1) (b)).
      </p>
      <p>
        Review code travels between your computer and your own Git remote. When an older client uses Ask for review, QualityLayer pushes the task's branch to your team's Git remote, and teammates with access to it read the code there. We store your team's comments on lines of code, the short lines of code they quote (up to 300 characters each) and the repository, branch and commits they point to. All of it is encrypted on your computer with your team's key. Apart from those quoted lines, we never receive the code.
      </p>
      <table className="lg-table">
        <thead>
          <tr><th>Service</th><th>What it holds</th><th>Where</th></tr>
        </thead>
        <tbody>
          <tr><td>Neon</td><td>The database</td><td>Frankfurt</td></tr>
          <tr><td>Upstash</td><td>Short-lived counters and caches</td><td>Frankfurt</td></tr>
          <tr><td>Cloudflare R2</td><td>Encrypted file attachments</td><td>EU</td></tr>
        </tbody>
      </table>
      <p>
        Legacy task records and retained copies are assessed separately during migration and retirement. We do not promise automatic deletion after 30 days while the transition retention applies. Previously agreed deletion obligations and statutory access, deletion and restriction rights remain applicable; this transition does not suspend them. Contact us to exercise those rights.
      </p>
      <h3>Older share links</h3>
      <p>A link's content is sealed with a key that sits after the # in the link and never reaches our server. Links and the comments on them end after 14 days.</p>
      <h3>Older-client Slack and email</h3>
      <p>Collaboration notifications over Slack and email are stopped during this transition; pending collaboration notifications are not delivered. Previously enabled delivery sent task titles, questions and participant names through Slack Technologies (USA), or through Resend (USA) to the enabled seat address. Historical connection and notification records may remain while legacy lifecycle purges are frozen. An expiry timestamp alone does not establish that stored text has been physically deleted. The previously stated 72-hour deletion obligation remains applicable; the purge freeze does not extend it or suspend statutory access, deletion or restriction rights.</p>

      <h2>Product reports and private support</h2>
      <p>
        Report bug / idea publishes the title, description, system details and screenshots you approve as a public GitHub issue. Your account name and e-mail are not added automatically. We receive a private e-mail copy through Resend, with licence contact details when available.
      </p>
      <p>
        Private support sends your message, the diagnostics shown before sending and any attached screenshots to our private GitHub repository and to us through Resend. Contact details are included in the e-mail copy and left out of automatic issue fields.
      </p>
      <p>
        Feedback screenshots are stored in Cloudflare R2. Private-support screenshot links expire after 90 days. Published screenshot links do not expire automatically. Contact us if a report or image needs removal; copies others already downloaded can remain (Art. 6 (1) (f): handling your report).
      </p>

      <h2 id="newsletter">Newsletter and videos</h2>
      <p>
        When you ask for a video such as the Inside QualityLayer deep dive, we e-mail a confirmation link to your address through Resend. Nothing is stored until you open it; an unconfirmed link expires after 48 hours. Once you confirm, we keep your address, the consent text you agreed to and when you asked and confirmed, send you the video and add you to the QualityLayer newsletter: occasional e-mails about releases, guides and new videos (Art. 6 (1) (a) GDPR). Every e-mail has an unsubscribe link, and you can withdraw consent at any time by writing to <Mail />. We then remove your address from the list and keep only the record of your consent for as long as we may need to prove it.
      </p>

      <h2>E-mail</h2>
      <p>If you write to us, we use your message to answer it and keep the conversation as long as it is needed (Art. 6 (1) (b) or (f)).</p>

      <h2>Recipients outside the EU</h2>
      <p>
        Vercel, Cloudflare, GitHub, Resend, Slack and Polar may process data in the USA. Transfers rely on the EU–US Data Privacy Framework where the provider is certified, and otherwise on the EU Standard Contractual Clauses. Vercel, Neon, Upstash, Cloudflare and Resend process data for us under their data processing agreements. GitHub hosts public reports and private support issues under its own terms. Licence contact details reach us through the private e-mail copy. Polar, as merchant of record, and Slack, in your team's own workspace, are responsible for the data they receive.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask for access, correction, deletion, restriction and a copy of your data, and object to processing based on our legitimate interest (Art. 15–21 GDPR). Write to <Mail />. You can also complain to a supervisory authority, for example the Bayerisches Landesamt für Datenschutzaufsicht, Promenade 18, 91522 Ansbach.
      </p>
      <p>We make no automated decisions about you and build no profiles. We update this page when the service changes; the date at the top says when.</p>
    </>
  );
}

function Terms() {
  return (
    <>
      <h1>Terms of service</h1>
      <Updated />

      <h2>1. Who and what</h2>
      <p>
        These terms cover qualitylayer.dev, the QualityLayer App and CLI, and the ancillary services described here, offered by {SELLER.name} (see the <Link to="/imprint">imprint</Link>). The{" "}
        <a href={`${GITHUB_URL}/blob/main/LICENSE`}>QualityLayer Software License Agreement</a> grants the licence to the software. These terms do not revoke or narrow rights already granted under an earlier licence or separately agreed contract. Individual agreements and mandatory law prevail where applicable.
      </p>

      <h2>2. Buying</h2>
      <p>Polar Software, Inc. sells subscriptions as merchant of record. Polar's terms apply to payment, invoices, taxes, renewals and refunds, and to a consumer's right of withdrawal.</p>

      <h2>3. Trial</h2>
      <p>You can try QualityLayer for 7 days without paying, once per computer.</p>

      <h2>4. Subscription</h2>
      <p>A subscription renews every month or year until you cancel it. You can cancel at any time in <Link to="/billing">Billing</Link>; it ends with the paid period. Business centralizes seats, billing and licence assignment. Existing contractual prices, currencies, seats, benefits, grants, keys, activations and access remain governed by their agreed terms.</p>

      <h2>5. The local product and services</h2>
      <p>All plans include the same complete local Tasks, Chat and Artifacts product. Business adds centralized seats and billing, assignment and reassignment, priority support and priority feature requests. Priority means earlier consideration, without a delivery promise. Enterprise includes Business plus volume pricing, onboarding, invoicing arrangements and negotiated purchasing and support terms. The new offering includes no hosted collaboration, self-hosted team backend, SSO, private-source or complete-build grant. Existing granted rights, including an earlier Enterprise agreement, remain unaffected.</p>
      <p>Your own machines, SSH connections and paired browsers remain under your control. Your coding agent uses its own provider and account. Licence, trial, billing, update, support and newsletter services are separate from local work. Maintenance or faults can interrupt these services; the applicable offline allowance remains unchanged. Older-client services remain during the migration described in the privacy policy, without an immediate-deletion promise.</p>
      <h2>6. Your part and public source</h2>
      <ul>
        <li>Keep your licence key private and assign each seat to its authorized person.</li>
        <li>Send only content you may disclose, and use the product and services lawfully.</li>
        <li>Do not attack or overload services or bypass licence checks, subject to mandatory legal rights.</li>
      </ul>
      <p>The source-available offering permits inspection and contributions to QualityLayer itself under its exact licence and contribution agreement. It is paid commercial software, with no free complete edition or automatic open-source conversion. The public checkout intentionally excludes private components needed for a complete build. Only Max Ritter produces complete official builds. Your own output remains yours; previously granted rights and mandatory law remain unaffected.</p>

      <h2>7. Liability</h2>
      <p>
        We are liable without limit for intent and gross negligence, for injury to life, body or health, under the Product Liability Act and under any guarantee we give. For slight negligence we are liable only when we breach an obligation that makes the contract possible and on which you may rely, and only for the damage that was typical and foreseeable when the contract was made. Otherwise we are not liable for slight negligence.
      </p>

      <h2>8. Changes to these terms</h2>
      <p>We notify you of proposed contractual changes at least 30 days in advance where applicable. Changes take effect only to the extent validly agreed; continued use alone does not retroactively remove an existing right. Individual agreements and mandatory consumer rights remain unaffected.</p>

      <h2>9. Law and courts</h2>
      <p>
        German law applies, without the UN Convention on Contracts for the International Sale of Goods. Consumers in the EU keep the protection of their own country's mandatory law. If you are a merchant, a legal entity under public law, or have no general place of jurisdiction in Germany, the courts at our place of business decide disputes.
      </p>
    </>
  );
}

const PAGES = { "/imprint": Imprint, "/privacy": Privacy, "/terms": Terms } as const;

/** The imprint, privacy policy and terms: one reading column each, chosen by the path. */
export default function Legal() {
  const { pathname } = useLocation();
  const Body = PAGES[pathname as keyof typeof PAGES] ?? Imprint;
  return (
    <>
      <SEO />
      <Page className="lg-page">
        <article className="w7-wrap lg-article">
          <Body />
        </article>
      </Page>
    </>
  );
}
