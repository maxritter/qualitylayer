import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Page from "@/components/Page";
import SEO from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { billingRequest } from "@/lib/billing";
import "@/styles/billing.css";

export default function CheckoutSuccess() {
  const [params] = useSearchParams();
  const id = params.get("checkout_id");
  const [status, setStatus] = useState("checking");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  async function check() {
    setBusy(true); setError("");
    try { setStatus((await billingRequest<{ status: string }>("checkout-status", { checkoutId: id })).status); }
    catch (err) { setStatus("unknown"); setError(err instanceof Error ? err.message : "Payment status is unavailable."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    let active = true;
    billingRequest<{ status: string }>("checkout-status", { checkoutId: id }).then((value) => {
      if (active) setStatus(value.status);
    }).catch((err) => {
      if (active) { setStatus("unknown"); setError(err instanceof Error ? err.message : "Payment status is unavailable."); }
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [id]);
  const paid = status === "succeeded", failed = ["failed", "expired"].includes(status);
  return <><SEO /><Page><div className="bl-wrap"><section className="bl-confirmation">
    <h1>{paid ? "Your subscription is ready" : failed ? "Payment was not completed" : status === "unknown" ? "Check your subscription" : "Confirming your purchase"}</h1>
    <p>{paid ? "Activate QualityLayer with your licence key." : failed ? "Return to pricing to try again, or contact support if you need help." : status === "unknown" ? "We couldn't check the payment. Check again or open your billing account." : "Polar is still confirming the payment. You can check again in a moment."}</p>
    {error && <p role="alert">{error}</p>}
    {paid && <p>Polar emails your licence key. You can also find it in your billing account.</p>}
    <div className="bl-actions">{paid ? <><Button asChild><Link to="/download">Download the App</Link></Button><Button asChild variant="outline"><Link to="/billing">Open your billing account</Link></Button></> : failed ? <Button asChild><Link to="/pricing">Return to pricing</Link></Button> : <><Button disabled={busy} onClick={() => void check()}>{busy ? "Checking…" : "Check payment status"}</Button><Link to="/billing">Open your billing account</Link></>}</div>
  </section></div></Page></>;
}
