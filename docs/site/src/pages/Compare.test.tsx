import { existsSync, readFileSync } from "node:fs";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { describe, expect, it } from "vitest";
import { COMPARISONS, COMPARISON_PATHS, ROUNDUP_FAQS, ROUNDUP_PATH } from "../lib/comparisons";
import { BANNED_WORDS } from "../lib/banned-words";
import { PUBLIC_PAGES } from "../lib/seo";
import { render } from "../prerender";

const SLUGS = ["superpowers", "spec-kit", "openspec", "bmad-method", "gsd", "kiro", "traycer", "compound-engineering", "claude-code-plan-mode", "cursor-plan-mode", "codex-plan-mode", "humanlayer", "task-master", "cline", "aider", "github-copilot-coding-agent", "devin", "claude-squad", "conductor"];
const ROUTES = ["/compare", ...SLUGS.map((slug) => `/compare/${slug}`), "/best-spec-driven-development-tools"];

function plainText(html: string) {
  function walk(node: DefaultTreeAdapterMap["node"]): string {
    if (node.nodeName === "#text") return (node as DefaultTreeAdapterMap["textNode"]).value;
    return "childNodes" in node ? node.childNodes.map(walk).join(" ") : "";
  }
  return walk(parseFragment(html)).replace(/\s+/g, " ");
}

function schemas(head: string): Record<string, unknown>[] {
  return [...head.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].flatMap((match) => JSON.parse(match[1]));
}

describe("comparison pages", () => {
  it("registers every comparison URL with distinct search metadata and explicit client routes", () => {
    expect(COMPARISON_PATHS).toEqual(ROUTES);
    const pages = ROUTES.map((route) => PUBLIC_PAGES[route as keyof typeof PUBLIC_PAGES]);
    expect(pages.every(Boolean)).toBe(true);
    expect(new Set(pages.map((page) => page.title)).size).toBe(ROUTES.length);
    expect(new Set(pages.map((page) => page.description)).size).toBe(ROUTES.length);
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    for (const route of ROUTES) expect(app).toContain(`<Route path="${route}" element={<Compare />} />`);
    expect(app).not.toContain('path="/compare/*"');
  });

  it.each(ROUTES)("prerenders %s as a sourced, indexable page with matching WebPage and breadcrumbs", async (route) => {
    const { head, body } = await render(route);
    const metadata = PUBLIC_PAGES[route as keyof typeof PUBLIC_PAGES];
    expect(body.match(/<h1[ >]/g)).toHaveLength(1);
    expect(body.match(/<main[ >]/g)).toHaveLength(1);
    const comparison = COMPARISONS.find(({ slug }) => route === `/compare/${slug}`);
    const checked = comparison?.checked ?? COMPARISONS.map((c) => c.checked).sort().at(-1);
    expect(body).toContain("Sources, checked October 2026");
    expect(body).toContain(`datetime="${checked}"`);
    expect(body).toContain('aria-label="Breadcrumb"');
    expect(head).not.toContain("noindex");
    const data = schemas(head);
    expect(data.find((s) => s["@type"] === "WebPage")).toMatchObject({
      url: `https://qualitylayer.dev${route}`, name: metadata.title,
      description: metadata.description, lastReviewed: checked,
      publisher: { name: "QualityLayer" },
    });
    const breadcrumb = data.find((s) => s["@type"] === "BreadcrumbList");
    const items = breadcrumb?.itemListElement as { position: number; item: string; name: string }[];
    expect(items.map((item) => item.position)).toEqual(route === "/compare" ? [1, 2] : [1, 2, 3]);
    expect(items.at(-1)?.item).toBe(`https://qualitylayer.dev${route}`);
    for (const item of items) expect(plainText(body)).toContain(item.name);
    expect(data.some((s) => s["@type"] === "FAQPage")).toBe(route === ROUNDUP_PATH);
    expect(plainText(body)).not.toMatch(BANNED_WORDS);

    // The new workflow links must target real guides, without changing the docs project.
    for (const [, href] of body.matchAll(/href="(\/docs\/steps\/[^"#]+)(?:#[^"]*)?"/g)) {
      expect(existsSync(new URL(`../../../docusaurus/docs/${href.slice(6)}.md`, import.meta.url)), href).toBe(true);
    }
  });

  it.each(COMPARISONS)("gives $name credit and links to the checked sources and related pages", async (c) => {
    const { body } = await render(`/compare/${c.slug}`);
    const text = plainText(body);
    for (const claim of [c.strengths, c.agents, c.chooseOther, c.chooseQualityLayer]) expect(text).toContain(claim);
    expect(text).toContain("An agent that did not write the code checks every change");
    expect(text).toContain("QualityLayer never merges it");
    expect(text).toContain("GitHub's gh CLI");
    for (const { url } of c.sources) expect(body).toContain(`href="${url}"`);
    for (const path of ["/compare", ROUNDUP_PATH, "/pricing", "/docs/steps/verify", "/docs/steps/review", "/docs/steps/pull-request"]) expect(body).toContain(`href="${path}"`);
    for (const other of COMPARISONS.filter((other) => other.slug !== c.slug)) expect(body).toContain(`href="/compare/${other.slug}"`);
    for (const [, id] of body.matchAll(/href="#(source-\d+)"/g)) expect(body).toContain(`id="${id}"`);
  });

  it("links the hub to every comparison and the roundup", async () => {
    const { body } = await render("/compare");
    for (const route of ROUTES.slice(1)) expect(body).toContain(`href="${route}"`);
  });

  it("roundup FAQ markup describes exactly the visible questions and answers", async () => {
    const { head, body } = await render(ROUNDUP_PATH);
    const text = plainText(body);
    const faq = schemas(head).find((s) => s["@type"] === "FAQPage");
    expect(faq?.mainEntity).toEqual(ROUNDUP_FAQS.map(({ question, answer }) => ({
      "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer },
    })));
    for (const { question, answer } of ROUNDUP_FAQS) {
      expect(text).toContain(question);
      expect(text).toContain(answer);
    }
  });
});
