import { readFileSync } from "node:fs";
import { renderToReadableStream } from "react-dom/server.browser";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BANNED_WORDS } from "../lib/banned-words";
import { LEGAL_PATHS, SELLER } from "../lib/legal";
import { CONTACT_EMAIL } from "../lib/product";
import { PUBLIC_PAGES } from "../lib/seo";
import { render } from "../prerender";
import Legal from "./Legal";

async function html(path: string): Promise<string> {
  const stream = await renderToReadableStream(
    <HelmetProvider>
      <MemoryRouter initialEntries={[path]}>
        <Legal />
      </MemoryRouter>
    </HelmetProvider>,
  );
  await stream.allReady;
  return new Response(stream).text();
}

const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("the legal pages", () => {
  it.each(LEGAL_PATHS)("%s is one page with one heading and the site's frame", async (path) => {
    const page = await html(path);
    expect(page.match(/<h1[ >]/g)).toHaveLength(1);
    expect(page.match(/<main[ >]/g)).toHaveLength(1);
    expect(text(page)).not.toMatch(BANNED_WORDS);
  });

  it.each(LEGAL_PATHS)("%s has its own route, search metadata and prerendered page", async (path) => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    expect(app).toContain(`<Route path="${path}" element={<Legal />} />`);
    const metadata = PUBLIC_PAGES[path];
    expect(metadata?.title).toBeTruthy();
    const { head, body } = await render(path);
    expect(head).toContain(metadata.title);
    expect(body.match(/<h1[ >]/g)).toHaveLength(1);
  });

  it("the imprint names the seller, the address, the contact, the VAT ID and the content's owner", async () => {
    const page = text(await html("/imprint"));
    expect(page).toContain("§ 5 DDG");
    for (const fact of [SELLER.name, SELLER.street, SELLER.city, CONTACT_EMAIL, `§ 27a UStG: ${SELLER.vatId}`, "§ 18 (2) MStV"]) expect(page).toContain(fact);
    // The DDG replaced the TMG in May 2024; the EU dispute platform closed in July 2025.
    expect(page).not.toMatch(/TMG|ec\.europa\.eu\/consumers\/odr/);
  });

  it("the privacy policy names every processor, where it runs and how long data stays", async () => {
    const page = text(await html("/privacy"));
    for (const processor of ["Vercel", "Neon", "Upstash", "Cloudflare R2", "Polar", "Resend", "GitHub", "Slack"]) expect(page).toContain(processor);
    expect(page).toContain("deleted after 30 days");
    expect(page).toContain("Encrypted backups are kept in the EU for 30 days");
    expect(page).toContain("Private-support screenshot links expire after 90 days");
    expect(page).toContain("Bayerisches Landesamt für Datenschutzaufsicht");
    expect(page).toContain("§ 25 (2) TDDDG");
  });

  it("the terms keep liability for intent, gross negligence and injury unlimited and name German law", async () => {
    const page = text(await html("/terms"));
    expect(page).toContain("liable without limit for intent and gross negligence, for injury to life, body or health");
    expect(page).toContain("German law applies");
    expect(page).toContain("merchant of record");
    expect(page).not.toMatch(/as is|Netherlands/i);
  });
});
