import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { CircleAlert, CircleCheck, MailX } from "lucide-react";
import Done from "@/components/DoneCard";
import Page from "@/components/Page";
import SEO from "@/components/SEO";
import { Button } from "@/components/ui/button";
import "@/styles/deep-dive.css";

const APP_PATH = "Settings › Notifications";
const FAILED = `We couldn't turn email off just now. Try again in a minute, or turn it off in the App: ${APP_PATH}.`;

/** Asks the team API to turn email off for the member the link was issued to. A 400 means the link is spent or expired. */
async function turnOff(token: string): Promise<{ email: string } | "bad"> {
  const response = await fetch("/api/team/email/off", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
  if (response.status === 400) return "bad";
  if (!response.ok) throw new Error(FAILED);
  const body: unknown = await response.json().catch(() => null);
  const email = body && typeof body === "object" && "email" in body && typeof body.email === "string" ? body.email : "";
  return { email };
}

/** The footer link of every notification email lands here; only the button turns email off, so a mail scanner opening the link changes nothing. */
function TurnOff({ token }: { token: string }) {
  const [state, setState] = useState<"ask" | "busy" | "done" | "bad">(token ? "ask" : "bad");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const acted = useRef(false);
  // Focus follows the button's own swap to the result heading, or back to the button after an error, so the keyboard is not dropped to the page.
  useEffect(() => {
    if (!acted.current) return;
    if (state === "done" || state === "bad") heading.current?.focus();
    else if (state === "ask") retry.current?.focus();
  }, [state]);

  async function off() {
    if (state === "busy") return;
    acted.current = true;
    setState("busy"); setError("");
    try {
      const result = await turnOff(token);
      if (result === "bad") setState("bad");
      else { setEmail(result.email); setState("done"); }
    } catch {
      setState("ask");
      setError(FAILED);
    }
  }

  if (state === "done") return (
    <Done icon={CircleCheck} title="Emails are off" heading={heading}>
      <p>Team notification emails are off for <b>{email || "this address"}</b>. Turn them on again in the App: {APP_PATH}.</p>
    </Done>
  );
  if (state === "bad") return (
    <Done icon={CircleAlert} title="This link no longer works" heading={heading}>
      <p>It may be older than 90 days or already used. Turn email off in the App: {APP_PATH}.</p>
    </Done>
  );
  return (
    <Done icon={MailX} title="Turn off QualityLayer emails?" live={false}>
      <p>You'll stop getting emails about your team's questions and task updates. App and Slack notifications are unchanged.</p>
      {error ? <p className="dd-error" role="alert">{error}</p> : null}
      <Button ref={retry} type="button" size="xl" className="dd-submit" disabled={state === "busy"} onClick={() => void off()}>
        {state === "busy" ? "Turning off…" : "Turn off emails"}
      </Button>
    </Done>
  );
}

/** The page behind `https://qualitylayer.dev/notifications?off=<token>`. Private: the token stays out of search results and referrers. */
const Notifications = () => {
  const token = new URLSearchParams(useLocation().search).get("off") ?? "";
  return (
    <>
      <SEO />
      <Helmet><meta name="referrer" content="no-referrer" /></Helmet>
      <Page>
        <section className="w7-sec w7-nf dd-sec" aria-labelledby="nf-h">
          <div className="w7-wrap dd-solo">
            <h1 id="nf-h" className="dd-hidden">QualityLayer email notifications</h1>
            <div className="dd-card"><div className="dd-body"><TurnOff token={token} /></div></div>
          </div>
        </section>
      </Page>
    </>
  );
};

export default Notifications;
