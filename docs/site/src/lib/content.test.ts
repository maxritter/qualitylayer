import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FAQS, PRICING_FAQS } from "./content";
import { CONTACT_EMAIL, INSTALL_COMMAND, SITE_URL } from "./product";
import { COMPARE, PLANS } from "./pricing";
import { PRICING_APPLICATION } from "./structured-data";

describe("FAQ", () => {
  it("answers in plain text, so structured data can reuse it", () => {
    for (const faq of [...FAQS, ...PRICING_FAQS]) {
      expect(faq.question.endsWith("?")).toBe(true);
      expect(faq.answer).not.toMatch(/<[^>]+>/);
    }
  });

  it("asks each question once", () => {
    const home = FAQS.map((faq) => faq.question);
    expect(new Set(home).size).toBe(home.length);
  });

  it("answers for one developer and for a team", () => {
    const answers = FAQS.map((faq) => `${faq.question} ${faq.answer}`).join(" ");
    expect(answers).toMatch(/on your own|alone/i);
    expect(answers).toMatch(/team/i);
  });

  it("keeps feedback diagnostics in the privacy docs rather than the marketing FAQ", () => {
    expect(FAQS.some((faq) => /Send feedback/i.test(faq.question))).toBe(false);
    const docs = readFileSync(new URL("../../../docusaurus/docs/reference/files.md", import.meta.url), "utf8");
    expect(docs).toMatch(/feedback/i);
    expect(docs).toMatch(/screenshots/i);
    expect(docs).toMatch(/operating-system and architecture details/i);
    expect(docs).toMatch(/agent version/i);
  });

  it("distinguishes the coding agent's provider from QualityLayer sharing and feedback", () => {
    for (const faq of [...FAQS, ...PRICING_FAQS].filter((f) => f.question === "Does my code leave my computer?")) {
      expect(faq.answer).toMatch(/your (AI |coding )?agent.*provider/i);
      expect(faq.answer).toMatch(/screenshot you attach to a feedback report/i);
      expect(faq.answer).not.toMatch(/^No\.|the one way it can leave/i);
    }
  });

  it("calls the second opinion one thing", () => {
    for (const faq of [...FAQS, ...PRICING_FAQS]) expect(faq.answer).not.toMatch(/vendor/i);
  });

  it("names only the agents the App sets up", () => {
    for (const faq of [...FAQS, ...PRICING_FAQS]) expect(faq.answer).not.toMatch(/grok bot|muse code/i);
  });

  it("names all seven agents the App sets up where it lists them", () => {
    const listing = [...FAQS, ...PRICING_FAQS].filter((faq) => faq.answer.includes("Antigravity"));
    expect(listing.length).toBeGreaterThan(0);
    for (const faq of listing) for (const name of ["Claude Code", "Codex", "Cursor", "Grok", "Antigravity", "Pi", "OpenCode"]) expect(faq.answer, faq.question).toContain(name);
  });
});

describe("product facts", () => {
  it("serves the installer from the product's own domain", () => {
    expect(INSTALL_COMMAND).toBe(`curl -fsSL ${SITE_URL}/install.sh | bash`);
    expect(SITE_URL).toBe("https://qualitylayer.dev");
  });

  it("sells Solo and Team through live checkouts, and Enterprise by mail", () => {
    expect(PLANS.map((plan) => plan.id)).toEqual(["solo", "team", "enterprise"]);
    for (const plan of PLANS.filter((p) => p.id !== "enterprise")) {
      const { price, href } = plan;
      if (price === "Custom" || typeof href === "string") throw new Error(`${plan.id} must sell monthly and yearly`);
      expect(Number.isInteger(price.yearly)).toBe(true);
      expect(Number.isInteger(price.yearly / 12)).toBe(true);
      expect(price.yearly).toBeLessThan(price.monthly * 12);
      for (const link of [href.monthly, href.yearly]) expect(link).toMatch(/^https:\/\/(sandbox-api\.polar\.sh|buy\.polar\.sh)\//);
    }
    expect(String(PLANS.find((p) => p.id === "enterprise")?.href)).toMatch(new RegExp(`^mailto:${CONTACT_EMAIL}\\?`));
  });

  it("keeps the approved full charges and exact monthly equivalents together", () => {
    expect(PLANS.filter((plan) => plan.price !== "Custom").map((plan) => plan.price)).toEqual([
      { monthly: 29, yearly: 288 },
      { monthly: 49, yearly: 468 },
    ]);
    const annual = PRICING_FAQS.find((faq) => faq.question === "Monthly or yearly?")!.answer;
    expect(annual).toContain("€288 a year, equivalent to €24 a month");
    expect(annual).toContain("€468 per seat a year, equivalent to €39 per seat a month");
  });

  it("gives every plan four highlights, as the cards are drawn", () => {
    for (const plan of PLANS) expect(plan.highlights).toHaveLength(4);
  });

  it("publishes the euro charges for search engines", () => {
    expect(PRICING_APPLICATION.offers.map((offer) => [offer.price, offer.priceCurrency, offer.priceSpecification.priceCurrency])).toEqual([
      [29, "EUR", "EUR"], [288, "EUR", "EUR"], [49, "EUR", "EUR"], [468, "EUR", "EUR"],
    ]);
  });

  it("offers the Enterprise-only rows on request, and nothing else", () => {
    const enterprise = COMPARE.find((g) => g.name === "Enterprise");
    expect(enterprise?.rows.every((r) => r.enterprise === "request" && !r.solo && !r.team)).toBe(true);
    const others = COMPARE.filter((g) => g.name !== "Enterprise").flatMap((g) => g.rows);
    expect(others.every((r) => r.enterprise !== "request")).toBe(true);
  });
});
