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
    const faq = FAQS.find(({ question }) => /on my own/.test(question));
    expect(faq?.answer).toMatch(/Both/);
    expect(faq?.answer).toContain("Team plan");
  });

  it("keeps feedback diagnostics in the privacy docs rather than the marketing FAQ", () => {
    expect(FAQS.some((faq) => /Send feedback/i.test(faq.question))).toBe(false);
    const docs = readFileSync(new URL("../../../docusaurus/docs/reference/files.md", import.meta.url), "utf8");
    expect(docs).toMatch(/feedback/i);
    expect(docs).toMatch(/screenshots/i);
    expect(docs).toMatch(/operating-system and architecture details/i);
    expect(docs).toMatch(/agent version/i);
    expect(docs).toContain("Preview public issue");
    expect(docs).toContain("Private support");
    expect(docs).toContain("does not add your account name, email, repository paths or terminal logs");
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

  it("never counts the supported agents, which change as agents are added", () => {
    const counted = /\b(two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(coding\s+)?agents\b/i;
    for (const faq of [...FAQS, ...PRICING_FAQS]) expect(faq.answer, faq.question).not.toMatch(counted);
    for (const row of COMPARE.flatMap((group) => group.rows)) expect(`${row.feature} ${row.note ?? ""}`).not.toMatch(counted);
    for (const plan of PLANS) for (const [, text] of plan.highlights) expect(text).not.toMatch(counted);
    const agents = PRICING_FAQS.find((faq) => faq.question === "Which agents does it work with?")!.answer;
    expect(agents).toContain("Claude Code");
    expect(agents).toContain("Codex");
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
    expect(annual).toContain("Solo costs €24 a month instead of €29");
    expect(annual).toContain("Team €39 per seat a month instead of €49");
    // The page shows monthly amounts only; checkout shows the yearly total (Max, 2 November 2026).
    expect(annual).not.toMatch(/€288|€468/);
  });

  it("gives every plan five highlights, as the cards are drawn", () => {
    for (const plan of PLANS) expect(plan.highlights).toHaveLength(5);
  });

  it("publishes the euro charges for search engines", () => {
    expect(PRICING_APPLICATION.offers.map((offer) => [offer.price, offer.priceCurrency, offer.priceSpecification.priceCurrency])).toEqual([
      [29, "EUR", "EUR"], [288, "EUR", "EUR"], [49, "EUR", "EUR"], [468, "EUR", "EUR"],
    ]);
  });

  it("compares the plans in three groups of five that step up from Solo to Enterprise", () => {
    expect(COMPARE.map((group) => group.rows.length)).toEqual([5, 5, 5]);
    const [alone, team, large] = COMPARE;
    expect(alone.rows.every((r) => r.solo && r.team && r.enterprise)).toBe(true);
    expect(team.rows.every((r) => !r.solo && r.team && r.enterprise)).toBe(true);
    expect(large.rows.every((r) => !r.solo && !r.team && r.enterprise)).toBe(true);
  });
});
