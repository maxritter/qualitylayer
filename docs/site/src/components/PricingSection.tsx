import { useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import CheckoutLink from "@/components/CheckoutLink";
import Questions from "@/components/Questions";
import { PRICING_FAQS } from "@/lib/content";
import { COMPARE, PLANS, formatPrice, type Cell, type Hue, type Plan } from "@/lib/pricing";
import { Link } from "react-router-dom";

/** The home page's step colours: amber where you decide, blue where agents build, violet where they check. */
const HUE: Record<Hue, string> = { plan: "var(--ql-amber)", build: "var(--ql-accent)", verify: "var(--ql-check)", review: "var(--ql-amber)", plain: "var(--mx-ink3)" };
const hue = (h: Hue) => ({ "--g": HUE[h] }) as CSSProperties;

type Billing = "monthly" | "yearly";

function CellMark({ value }: { value: Cell }) {
  if (value) return <span role="img" aria-label="Included" className="pr-ck" style={hue("build")} />;
  return <span role="img" aria-label="Not included" className="pr-dash" />;
}

/** The price as the switch shows it: always per month, yearly with its saving per month. Yearly totals are left to checkout (Max, 3 November 2026). */
function Price({ plan, billing }: { plan: Plan; billing: Billing }) {
  if (plan.price === "Custom") {
    return (
      <>
        <div className="pr-price"><b className="pr-amt">Custom</b><span className="pr-per">{plan.per}</span></div>
        <p className="pr-bill">Seats, hosting and terms set together</p>
      </>
    );
  }
  const { monthly, yearly } = plan.price;
  return (
    <>
      <div className="pr-price"><b className="pr-amt">{formatPrice(billing === "yearly" ? yearly / 12 : monthly)}</b><span className="pr-per">{plan.per}</span></div>
      {billing === "yearly" ? (
        <p className="pr-bill">Billed yearly · save {formatPrice(monthly - yearly / 12)} a month</p>
      ) : (
        <p className="pr-bill">Billed monthly · cancel any time</p>
      )}
    </>
  );
}

const PricingSection = () => {
  const [billing, setBilling] = useState<Billing>("monthly");

  return (
    <div className="pr-root">
      <section id="plans" className="pr-top-sec" aria-labelledby="pr-h">
        <div className="pr-wrap">
          <h1 id="pr-h" className="pr-h1">Pricing</h1>
          <p className="pr-lead">Start with a 7-day trial, then pick Solo or Team.</p>
          <div className="pr-seg" role="group" aria-label="Billing">
            <Button type="button" variant={billing === "monthly" ? "default" : "ghost"} aria-pressed={billing === "monthly"} onClick={() => setBilling("monthly")}>Monthly</Button>
            <Button type="button" variant={billing === "yearly" ? "default" : "ghost"} aria-pressed={billing === "yearly"} onClick={() => setBilling("yearly")}>Yearly <span className="pr-save">Save 20%</span></Button>
          </div>
          <p className="pr-account-link">All prices are in EUR. Tax is included or added at checkout based on your billing country.</p>
          <p className="pr-account-link">Already subscribed? <Link to="/billing">Manage billing</Link></p>
          <div className="pr-plans">
            {PLANS.map((plan) => (
              <article key={plan.id} className="pr-plan" aria-labelledby={`${plan.id}-h`}>
                <div className="pr-top">
                  <div><h2 id={`${plan.id}-h`} className="pr-name">{plan.name}</h2><p className="pr-aud">{plan.audience}</p></div>
                  {plan.badge ? <span className="pr-badge req">{plan.badge}</span> : null}
                </div>
                <Price plan={plan} billing={billing} />
                {plan.id === "enterprise" ? <Button asChild size="xl" variant="outline" className="pr-btn"><a href={plan.href as string}>{plan.cta}</a></Button> : <Button asChild size="xl" className="pr-btn"><CheckoutLink plan={plan.id} billing={billing} href={typeof plan.href === "string" ? plan.href : plan.href[billing]}>{plan.cta}</CheckoutLink></Button>}
                <p className="pr-plus">{plan.plus}</p>
                <ul className="pr-hl">
                  {plan.highlights.map(([h, text]) => (
                    <li key={text} className="pr-hli" style={hue(h)}><span aria-hidden="true" className="pr-ck" /><span className="pr-hlt">{text}</span></li>
                  ))}
                </ul>
                <a className="pr-more" href="#compare">Compare the plans</a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="compare" className="pr-sec sunk" aria-labelledby="compare-h">
        <div className="pr-wrap">
          <h2 id="compare-h" className="pr-h2">Compare the plans</h2>
          <div className="pr-table" role="table" aria-label="Compare Solo, Team and Enterprise">
            <div className="pr-tr pr-th" role="row">
              <span role="columnheader">Feature</span>
              <span className="pr-c" role="columnheader">Solo</span>
              <span className="pr-c" role="columnheader">Team</span>
              <span className="pr-c" role="columnheader">Enterprise</span>
            </div>
            {COMPARE.map((group) => (
              <div key={group.name} role="rowgroup" style={{ display: "contents" }}>
                <div className="pr-tr pr-tg" role="row" style={hue(group.hue)}><span role="rowheader">{group.name}</span></div>
                {group.rows.map((r) => (
                  <div key={r.feature} className="pr-tr" role="row">
                    <span role="rowheader">{r.feature}{r.note ? <span className="pr-note">{r.note}</span> : null}</span>
                    <span className="pr-c" role="cell"><CellMark value={r.solo} /></span>
                    <span className="pr-c" role="cell"><CellMark value={r.team} /></span>
                    <span className="pr-c" role="cell"><CellMark value={r.enterprise} /></span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="pr-account-link">Every feature, step by step, is in the <a href="/docs">docs</a>.</p>
        </div>
      </section>

      <Questions faqs={PRICING_FAQS} id="pricing-faq" sunk />
    </div>
  );
};

export default PricingSection;
