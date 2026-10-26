import { renderToReadableStream } from "react-dom/server.browser";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Hero from "@/components/home/Hero";
import Sections from "@/components/home/Sections";
import PricingSection from "@/components/PricingSection";
import { BANNED_WORDS } from "@/lib/banned-words";
import { FAQS, PRICING_FAQS } from "@/lib/content";
import { COMPARE, PLANS } from "@/lib/pricing";
import { DESCRIPTION, ENGINEER_QUOTE } from "@/lib/product";
import { DownloadView } from "./Download";
import { readFileSync } from "node:fs";

/** The words of every page the redesign touches, read against the App's glossary. */

async function textOf(node: React.ReactNode): Promise<string> {
  const stream = await renderToReadableStream(<MemoryRouter>{node}</MemoryRouter>);
  await stream.allReady;
  const html = await new Response(stream).text();
  return html.replace(/<[^>]+>/g, " ").replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replace(/\s+/g, " ");
}

describe("the site's copy", () => {
  it("summarizes visual planning and checked implementation with the current artifact name", async () => {
    const hero = await textOf(<Hero />);
    expect(hero).toContain("Approve a visual plan with clickable artifacts.");
    expect(hero).toContain("Your coding agent builds the change and checks every requirement.");
    expect(hero).not.toContain("clickable designs");
  });

  it("uses the glossary, not the App's internal words, on the home page, download page and pricing page", async () => {
    const pages = {
      home: await textOf(<><Hero /><Sections /></>),
      download: await textOf(<DownloadView data={null} system={null} />),
      pricing: await textOf(<PricingSection />),
    };
    for (const [name, words] of Object.entries(pages)) expect(words, name).not.toMatch(BANNED_WORDS);
  });

  it("keeps the questions, the plans and the comparison table in plain words too", () => {
    const strings = [
      DESCRIPTION,
      ...[...FAQS, ...PRICING_FAQS].flatMap((f) => [f.question, f.answer]),
      ...PLANS.flatMap((p) => [p.audience, p.plus, ...p.highlights.map(([, h]) => h)]),
      ...COMPARE.flatMap((g) => g.rows.flatMap((r) => [r.feature, r.note ?? ""])),
    ];
    for (const s of strings) expect(s).not.toMatch(BANNED_WORDS);
  });

  it("calls the App the App", async () => {
    expect(await textOf(<Sections />)).not.toMatch(/cockpit/i);
  });

  it("explains Chat's supported agents, optional tools and move into the workflow", async () => {
    const home = await textOf(<Sections />);
    expect(home).toContain("Choose Chat for a direct conversation with Claude Code or Codex.");
    expect(home).toContain("Save a plan, build in slices, make artifacts, or ask for checks and an independent review when you need them.");
    expect(home).toContain("Start the workflow to keep the same task and conversation in the structured workflow.");
    expect(home).toContain("Choose Feature or Bugfix for the structured workflow.");
    expect(await textOf(<Hero />)).toContain("Seven steps for Feature and Bugfix,");
    expect(await textOf(<Hero />)).not.toContain("Seven steps on every change");
    expect(home).not.toContain("Available on every task.");
    const intro = readFileSync(new URL("../components/home/Intro.tsx", import.meta.url), "utf8");
    expect(intro).toContain('href="/docs/chat"');
    const guide = readFileSync(new URL("../../../docusaurus/docs/chat.md", import.meta.url), "utf8");
    expect(guide).toMatch(/Claude Code (?:and|or) Codex/);
    expect(guide).toMatch(/Chat does not (?:have|support) team sharing/);
    expect(guide).toMatch(/approve the workflow Plan before later implementation|a Chat plan is not that approval/);
  });

  it("describes the offline licence window enforced by the binary", async () => {
    // Read the real policy without importing the CLI's Bun environment into the website.
    const policy = readFileSync(new URL("../../../../qualitylayer/src/core/licence/constants.ts", import.meta.url), "utf8");
    const hours = policy.match(/export const OFFLINE_GRACE_PERIOD_HOURS = (\d+)/);
    expect(hours).not.toBeNull();
    const pricing = await textOf(<PricingSection />);
    expect(pricing).toContain(`up to ${Number(hours![1]) / 24} days after its last successful check`);
    expect(pricing).not.toContain("30 days");
  });

  it("describes the pending Slack delivery window without promising deletion of every copy", async () => {
    const policy = readFileSync(new URL("../../api/_lib/slack-queue.ts", import.meta.url), "utf8");
    const hours = policy.match(/const QUEUE_LIFE_MS = (\d+) \* 3_600_000/);
    expect(hours).not.toBeNull();
    const pricing = await textOf(<PricingSection />);
    expect(pricing).toContain(`Pending notifications expire after ${Number(hours![1])} hours.`);
    expect(pricing).not.toContain("held up to a day");
  });

  it("lets Pilot users keep both products and import memories when ready", async () => {
    const pricing = await textOf(<PricingSection />);
    expect(pricing).toMatch(/Pilot Shell 11 alongside QualityLayer/i);
    expect(pricing).toMatch(/paid subscription keeps its price/i);
    expect(pricing).toMatch(/Import memories per project/i);
    expect(pricing).not.toMatch(/updater moves you over|replaces Pilot Shell/i);
  });

  it("quotes the engineer word for word, attributed without a name", async () => {
    const home = await textOf(<Sections />);
    expect(home).toContain(`“${ENGINEER_QUOTE}”`);
    expect(home).toContain("An engineer who uses QualityLayer");
  });

  it("tells one developer and a team the same story: the closing says both", async () => {
    const home = await textOf(<Sections />);
    expect(home).toMatch(/on your own or with your team/i);
  });
});
