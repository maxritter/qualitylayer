import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PUBLIC_PAGES } from "./src/lib/seo";
import { render } from "./src/prerender";
import { renderedHtml } from "./vite-plugin-prerender";
import { FAQS, PRICING_FAQS } from "./src/lib/content";
import { PLANS } from "./src/lib/pricing";
import { DESCRIPTION } from "./src/lib/product";
import { DEEP_DIVE_PATH, DEEP_DIVE_POSTER, DEEP_DIVE_VIDEO_URL } from "./src/lib/deep-dive";
import { FILMS } from "./src/lib/films";

const template = readFileSync(new URL("./index.html", import.meta.url), "utf8");

function schemas(head: string): Record<string, unknown>[] {
  return [...head.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .flatMap((match) => JSON.parse(match[1]));
}

describe("HTML available before JavaScript runs", () => {
  it.each(Object.entries(PUBLIC_PAGES))("renders %s with its own content and one set of metadata", async (route, expected) => {
    const { head, body } = await render(route);
    const html = renderedHtml(template, head, body);
    expect(html.match(/<title[ >]/g)).toHaveLength(1);
    expect(html).toContain(`>${expected.title}</title>`);
    expect(head).toContain("data-prerendered-head");
    for (const key of ["description", "og:description", "twitter:description"]) {
      expect(html.match(new RegExp(`(?:name|property)="${key}"`, "g"))).toHaveLength(1);
      expect(html).toContain(`content="${expected.description}"`);
    }
    for (const key of ["og:title", "twitter:title"]) expect(head).toContain(`${key}" content="${expected.title}"`);
    for (const key of ["og:url", "twitter:url"]) expect(head).toContain(`${key}" content="https://qualitylayer.dev${route}"`);
    expect(head).toContain(`rel="canonical" href="https://qualitylayer.dev${route}"`);
    expect(body).toMatch(/<h1[ >]/);
    expect(body).toContain('<main id="main">');
    expect(body).not.toMatch(/<script[\s>]/);
    expect(body).not.toContain('id="S:');
    expect(html).not.toContain("<noscript>");
    expect(html).not.toContain("noindex");
    if (route !== "/") expect(body).not.toContain("hero-h");
    else for (const term of [DESCRIPTION, "Claude Code", "Codex"]) expect(body).toContain(term);
  });

  it("renders a complete, non-indexable 404 instead of the home page", async () => {
    const { head, body } = await render("/404");
    expect(head).toContain("noindex, follow");
    expect(body).toContain("Page not found");
    expect(body).not.toContain("hero-h");
  });

  it("describes the inside page and only its public trailer in JSON-LD", async () => {
    const { head, body } = await render(DEEP_DIVE_PATH);
    expect(head).toContain(">Inside QualityLayer: an AI software factory with humans in the loop</title>");
    const data = schemas(head);
    expect(data.map((item) => item["@type"])).toEqual(["WebPage", "BreadcrumbList", "VideoObject"]);
    expect(data[0]).toMatchObject({
      "@context": "https://schema.org", url: "https://qualitylayer.dev/inside",
      name: PUBLIC_PAGES[DEEP_DIVE_PATH].title, description: PUBLIC_PAGES[DEEP_DIVE_PATH].description,
      mainEntity: { "@id": "https://qualitylayer.dev/inside#trailer" },
    });
    expect(data[1].itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: "https://qualitylayer.dev/" },
      { "@type": "ListItem", position: 2, name: "Inside QualityLayer", item: "https://qualitylayer.dev/inside" },
    ]);
    expect(data[2]).toMatchObject({
      "@context": "https://schema.org", name: "Inside QualityLayer trailer",
      description: expect.stringContaining("56 second trailer"),
      thumbnailUrl: `https://qualitylayer.dev${DEEP_DIVE_POSTER}`,
      uploadDate: "2026-10-29", duration: "PT56S", contentUrl: FILMS.insideTrailer.src,
    });
    expect(JSON.stringify(data)).not.toContain(DEEP_DIVE_VIDEO_URL);
    expect(body).not.toContain("application/ld+json");
    expect(schemas(renderedHtml(template, head, body))).toEqual(data);
  });

  it.each(["/billing", "/checkout/success", "/shared", "/open"])("keeps the %s shell out of search results", async (route) => {
    const { head, body } = await render(route);
    expect(head).toContain("noindex");
    expect(body).not.toContain("hero-h");
  });

  it.each([...Object.keys(PUBLIC_PAGES), "/404", "/billing", "/checkout/success", "/shared", "/open"])("gives %s a complete Open Graph head without executable inline scripts", async (route) => {
    const { head, body } = await render(route);
    const html = renderedHtml(template, head, body);
    for (const key of ["og:title", "og:description", "og:image", "og:url", "og:type"]) {
      expect(html.match(new RegExp(`property="${key}"`, "g"))).toHaveLength(1);
      expect(head).toMatch(new RegExp(`property="${key}" content="[^"]+"`));
    }
    expect(head).toContain('property="og:type" content="website"');
    // The deep dive is shared on its own: its preview shows the video's title card.
    const image = route === DEEP_DIVE_PATH ? `https://qualitylayer.dev${DEEP_DIVE_PATH}/inside-qualitylayer-share.jpg` : "https://qualitylayer.dev/og.png";
    expect(head).toContain(`property="og:image" content="${image}"`);
    expect(head).toContain('property="og:image:width" content="1200"');
    expect(head).toContain(`property="og:image:height" content="${route === DEEP_DIVE_PATH ? 675 : 630}"`);
    expect(head).toContain(`property="og:url" content="https://qualitylayer.dev${route}"`);
    expect(html).toContain('rel="sitemap"');
    for (const script of html.matchAll(/<script\b([^>]*)>/g)) {
      expect(script[1]).toMatch(/\bsrc=|\btype="application\/ld\+json"/);
    }
  });

  it.each([["/", FAQS], ["/pricing", PRICING_FAQS]] as const)("prerenders software and the actual FAQ for %s in the head", async (route, faqs) => {
    const { head, body } = await render(route);
    const data = schemas(head);
    const software = data.find((item) => item["@type"] === "SoftwareApplication");
    expect(software).toMatchObject({
      "@context": "https://schema.org", name: "QualityLayer",
      applicationCategory: "DeveloperApplication", operatingSystem: "macOS, Linux, Windows",
      url: "https://qualitylayer.dev/",
    });
    const faq = data.filter((item) => item["@type"] === "FAQPage");
    expect(faq).toHaveLength(1);
    expect(faq[0].mainEntity).toEqual(faqs.map(({ question, answer }) => ({
      "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer },
    })));
    for (const { question } of faqs) expect(body).toContain(question);
    expect(head).not.toMatch(/"(?:aggregateRating|review|ratingValue|reviewCount)"/);
    expect(body).not.toContain("application/ld+json");
    expect(schemas(renderedHtml(template, head, body))).toEqual(data);
  });

  it("uses actual subscription prices and full annual charges, without inventing an Enterprise price", async () => {
    const { head } = await render("/pricing");
    const software = schemas(head).find((item) => item["@type"] === "SoftwareApplication")!;
    const expected = PLANS.flatMap((plan) => plan.price === "Custom" ? [] : [
      { name: `${plan.name} — monthly`, price: plan.price.monthly, duration: "P1M" },
      { name: `${plan.name} — yearly`, price: plan.price.yearly, duration: "P1Y" },
    ]);
    expect(software.offers).toEqual(expected.map(({ name, price, duration }) => expect.objectContaining({
      "@type": "Offer", name, price, priceCurrency: "EUR", url: "https://qualitylayer.dev/pricing#plans",
      priceSpecification: { "@type": "UnitPriceSpecification", price, priceCurrency: "EUR", billingDuration: duration },
    })));
  });

  it.each(["/download", "/404", "/billing", "/checkout/success", "/shared", "/open"])("does not invent a FAQ or product schema for %s", async (route) => {
    expect(schemas((await render(route)).head)).toEqual([]);
  });

  it.each(["app-demo/index.html", "public/slack/connected.html", "public/s-frame.html"])("includes Open Graph metadata on the standalone %s page", (file) => {
    const html = readFileSync(new URL(file, import.meta.url), "utf8");
    const head = html.split("</head>")[0];
    for (const key of ["og:title", "og:description", "og:image", "og:url", "og:type"]) {
      expect(head.match(new RegExp(`property="${key}"`, "g"))).toHaveLength(1);
      expect(head).toMatch(new RegExp(`property="${key}" content="[^"]+"`));
    }
    expect(head).toContain('name="robots" content="noindex"');
  });
});
