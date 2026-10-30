import { useEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from "react";
import { Link, useLocation } from "react-router-dom";
import { CircleCheck, Mail, MailCheck, MailX, type LucideIcon } from "lucide-react";
import Page from "@/components/Page";
import SEO from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CONTACT_EMAIL, SITE_URL } from "@/lib/product";
import {
  DEEP_DIVE_CHAPTERS, DEEP_DIVE_MINUTES, DEEP_DIVE_POSTER, DEEP_DIVE_PROMO, DEEP_DIVE_SPEAKER, DEEP_DIVE_TITLE, NEWSLETTER_CONSENT_TEXT, promoActive,
} from "@/lib/deep-dive";
import "@/styles/deep-dive.css";

const NOTICES: Record<string, string> = {
  expired: "That confirmation link has expired. Enter your address again, and we send a new one.",
  failed: "We couldn't confirm your address just now. Open the link in the email again in a minute.",
};

/** Posts JSON to the newsletter API and throws the message the visitor should read when it fails. */
async function post(path: string, body: unknown, invalid: string, failed: string): Promise<void> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (response.status === 400) throw new Error(invalid);
  if (!response.ok) throw new Error(failed);
}
const messageOf = (err: unknown) => (err instanceof Error && err.message ? err.message : "Please try again.");

/** A finished state in the card: an icon, a heading and what happens next. */
function Done({ icon: Icon, title, heading, children, live = true }: { icon: LucideIcon; title: string; heading?: Ref<HTMLHeadingElement>; children: ReactNode; live?: boolean }) {
  return (
    <div className="dd-done" role={live ? "status" : undefined}>
      <Icon size={20} aria-hidden="true" />
      <h2 ref={heading} tabIndex={heading ? -1 : undefined}>{title}</h2>
      {children}
    </div>
  );
}

/** The form: email and consent. Asking sends the confirmation mail; nothing is stored before it is opened. */
function Ask({ notice, onSent }: { notice: string; onSent: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [shownNotice, setShownNotice] = useState(notice);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    setSending(true); setError(""); setShownNotice("");
    try {
      await post("/api/newsletter", { email, consent, source: "deep-dive" }, "Check the address and try again.", `We couldn't send the email just now. Try again in a minute, or write to ${CONTACT_EMAIL}.`);
      onSent(email);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h2>Get the video</h2>
      <p className="dd-intro">We email you a confirmation link first, then the video.</p>
      {shownNotice ? <p className="dd-notice" role="status">{shownNotice}</p> : null}
      {error ? <p className="dd-error" role="alert">{error}</p> : null}
      <label className="dd-field">
        <span>Email</span>
        <Input type="email" name="email" autoComplete="email" required readOnly={sending} value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="dd-consent">
        <input type="checkbox" name="consent" required checked={consent} disabled={sending} onChange={(event) => setConsent(event.target.checked)} />
        <span>{NEWSLETTER_CONSENT_TEXT}</span>
      </label>
      <Button type="submit" size="xl" className="dd-submit" disabled={sending}>
        <Mail size={18} aria-hidden="true" />{sending ? "Sending…" : "Send me the video"}
      </Button>
      <p className="dd-small">How we handle your address: <Link to="/privacy#newsletter">Privacy</Link></p>
    </form>
  );
}

/** The unsubscribe link from the video email lands here; only the button unsubscribes, so a mail scanner opening the link changes nothing. */
function Unsubscribe({ token }: { token: string }) {
  const [state, setState] = useState<"ask" | "busy" | "done">("ask");
  const [error, setError] = useState("");

  async function leave() {
    if (state === "busy") return;
    setState("busy"); setError("");
    try {
      await post("/api/newsletter/unsubscribe", { token }, `This unsubscribe link doesn't work. Write to ${CONTACT_EMAIL}, and we remove your address.`, `We couldn't unsubscribe you just now. Try again in a minute, or write to ${CONTACT_EMAIL}.`);
      setState("done");
    } catch (err) {
      setState("ask");
      setError(messageOf(err));
    }
  }

  if (state === "done") return (
    <Done icon={CircleCheck} title="You're unsubscribed">
      <p>You won't get the QualityLayer newsletter anymore. You can sign up again here at any time.</p>
    </Done>
  );
  return (
    <Done icon={MailX} title="Unsubscribe from the newsletter?" live={false}>
      <p>You'll stop getting QualityLayer emails about releases, guides and new videos.</p>
      {error ? <p className="dd-error" role="alert">{error}</p> : null}
      <Button type="button" size="xl" className="dd-submit" disabled={state === "busy"} onClick={() => void leave()}>
        {state === "busy" ? "Unsubscribing…" : "Unsubscribe"}
      </Button>
    </Done>
  );
}

/** The sign-up card: the poster, then whatever the visitor came for. A link from an email decides where it starts. */
function SignUp() {
  const query = new URLSearchParams(useLocation().search);
  const token = query.get("unsubscribe") ?? "";
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (sentTo) heading.current?.focus(); }, [sentTo]);

  function another() {
    setSentTo(null); setRound((value) => value + 1);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".dd-card input[type=email]")?.focus());
  }

  let body: ReactNode;
  if (token) body = <Unsubscribe token={token} />;
  else if (sentTo) body = (
    <Done icon={MailCheck} title="Check your inbox" heading={heading}>
      <p>We sent a confirmation link to <b>{sentTo}</b>. Open it within 48 hours, and the video follows right away.</p>
      <p className="dd-small">Nothing there? Look in your spam folder, or <button type="button" className="dd-link" onClick={another}>use another address</button>.</p>
    </Done>
  );
  else if (query.get("confirmed") === "1" && round === 0) body = (
    <Done icon={CircleCheck} title="The video is on its way">
      <p>Your address is confirmed. The email with the video arrives within a few minutes.</p>
      <p className="dd-small">Want to try it while you watch? <Link to="/download">Download QualityLayer</Link></p>
    </Done>
  );
  else body = <Ask key={round} notice={round === 0 ? NOTICES[query.get("link") ?? ""] ?? "" : ""} onSent={setSentTo} />;

  return (
    <div className="dd-card">
      <img className="dd-poster" src={DEEP_DIVE_POSTER} width={1280} height={720} alt={`Title card: ${DEEP_DIVE_TITLE}, an AI software factory with humans in the loop, with ${DEEP_DIVE_SPEAKER}.`} />
      <div className="dd-body">{body}</div>
    </div>
  );
}

const DeepDive = () => (
  <>
    <SEO ogImage={`${SITE_URL}/inside/inside-qualitylayer-share.jpg`} ogImageAlt={`${DEEP_DIVE_TITLE}: an AI software factory with humans in the loop, with ${DEEP_DIVE_SPEAKER}.`} />
    <Page>
      <section className="w7-sec w7-nf dd-sec" aria-labelledby="dd-h">
        <div className="w7-wrap dd-grid">
          <header className="dd-head">
            <p className="dd-eyebrow">Deep dive · {DEEP_DIVE_MINUTES} min</p>
            <h1 id="dd-h" className="w7-h2">{DEEP_DIVE_TITLE}</h1>
            <p className="w7-lead">Why better models still break working software, how QualityLayer's seven steps keep you deciding what ships, and one task taken from request to pull request in the App.</p>
            <p className="dd-by">With {DEEP_DIVE_SPEAKER}, who builds QualityLayer.</p>
          </header>
          <SignUp />
          <div className="dd-more">
            <h2>What it covers</h2>
            <ol className="dd-chapters">
              {DEEP_DIVE_CHAPTERS.map((chapter) => <li key={chapter.title}><time className="dd-at">{chapter.at}</time><b>{chapter.title}</b><span>{chapter.about}</span></li>)}
            </ol>
            {promoActive() ? <p className="dd-offer">The email also brings a code for {DEEP_DIVE_PROMO.percent}% off your first year, valid until {DEEP_DIVE_PROMO.validUntilLabel}.</p> : null}
          </div>
        </div>
      </section>
    </Page>
  </>
);

export default DeepDive;
