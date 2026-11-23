import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Page from "@/components/Page";
import SEO from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { billingRequest } from "@/lib/billing";
import "@/styles/billing.css";

type OutcomeKind = "paid" | "failed" | "unknown" | "pending";

const OUTCOME_COPY: Record<OutcomeKind, { heading: string; message: string }> = {
  paid: {
    heading: "Your subscription is ready",
    message: "Activate QualityLayer with your licence key.",
  },
  failed: {
    heading: "Payment was not completed",
    message: "Return to pricing to try again, or contact support if you need help.",
  },
  unknown: {
    heading: "Check your subscription",
    message: "We couldn't check the payment. Check again or open your billing account.",
  },
  pending: {
    heading: "Confirming your purchase",
    message: "Polar is still confirming the payment. You can check again in a moment.",
  },
};

function classifyStatus(status: string): OutcomeKind {
  if (status === "succeeded") return "paid";
  if (status === "failed" || status === "expired") return "failed";
  if (status === "unknown") return "unknown";
  return "pending";
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Payment status is unavailable.";
}

function CheckoutActions({ outcome, busy, onCheck }: { outcome: OutcomeKind; busy: boolean; onCheck: () => void }) {
  if (outcome === "paid") {
    return (
      <>
        <Button asChild><Link to="/download">Download the App</Link></Button>
        <Button asChild variant="outline"><Link to="/billing">Open your billing account</Link></Button>
      </>
    );
  }
  if (outcome === "failed") {
    return <Button asChild><Link to="/pricing">Return to pricing</Link></Button>;
  }
  return (
    <>
      <Button disabled={busy} onClick={onCheck}>{busy ? "Checking…" : "Check payment status"}</Button>
      <Link to="/billing">Open your billing account</Link>
    </>
  );
}

export default function CheckoutSuccess() {
  const [params] = useSearchParams();
  const id = params.get("checkout_id");
  const [status, setStatus] = useState("checking");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  async function check() {
    setBusy(true);
    setError("");
    try {
      setStatus((await billingRequest<{ status: string }>("checkout-status", { checkoutId: id })).status);
    } catch (err) {
      setStatus("unknown");
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    billingRequest<{ status: string }>("checkout-status", { checkoutId: id })
      .then((value) => { if (active) setStatus(value.status); })
      .catch((err) => { if (active) { setStatus("unknown"); setError(errorText(err)); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [id]);

  const outcome = classifyStatus(status);
  const { heading, message } = OUTCOME_COPY[outcome];
  return (
    <>
      <SEO />
      <Page>
        <div className="bl-wrap">
          <section className="bl-confirmation">
            <h1>{heading}</h1>
            <p>{message}</p>
            {error && <p role="alert">{error}</p>}
            {outcome === "paid" && <p>Polar emails your licence key. You can also find it in your billing account.</p>}
            <div className="bl-actions">
              <CheckoutActions outcome={outcome} busy={busy} onCheck={() => void check()} />
            </div>
          </section>
        </div>
      </Page>
    </>
  );
}
