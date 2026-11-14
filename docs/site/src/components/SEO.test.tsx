import { renderToStaticMarkup } from "react-dom/server";
import { HelmetProvider } from "react-helmet-async";
import { StaticRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Billing from "@/pages/Billing";
import CheckoutSuccess from "@/pages/CheckoutSuccess";
import Open from "@/pages/Open";
import Shared from "@/pages/Shared";
import NotFound from "@/components/NotFound";
import SEO from "./SEO";

describe("page component metadata", () => {
  it.each([
    ["/billing", Billing], ["/checkout/success", CheckoutSuccess],
    ["/open/ask/task/question", Open], ["/s/example", Shared], ["/missing", NotFound],
  ] as const)("keeps complete Open Graph tags when %s renders its own metadata", (route, Page) => {
    const html = renderToStaticMarkup(<HelmetProvider><StaticRouter location={route}><Page /></StaticRouter></HelmetProvider>);
    for (const key of ["og:title", "og:description", "og:image", "og:url", "og:type"]) {
      expect(html.match(new RegExp(`property="${key}"`, "g"))).toHaveLength(1);
      expect(html).toMatch(new RegExp(`property="${key}" content="[^"]+"`));
    }
    expect(html).toMatch(/name="robots" content="noindex/);
    if (route === "/billing") expect(html).toContain('name="referrer" content="no-referrer"');
  });

  it("describes the shared image and keeps the brand line out of the keywords", () => {
    const html = renderToStaticMarkup(<HelmetProvider><StaticRouter location="/"><SEO /></StaticRouter></HelmetProvider>);
    const alt = "QualityLayer, quality by design: the software factory with you in the loop. Three steps: Plan, Implement, Verify. You approve the Plan and finished work; agents build, test and check.";
    expect(html).toContain(`property="og:image:alt" content="${alt}"`);
    expect(html).toContain(`name="twitter:image:alt" content="${alt}"`);
    expect(html).toMatch(/name="keywords" content="[^"]*agentic software factory/);
    expect(html).not.toMatch(/name="keywords" content="[^"]*quality by design/i);
  });

  it("keeps HTML and script-closing text inside valid, inert JSON-LD", () => {
    const data = { "@type": "Thing", name: '</script><script>alert("unexpected")</script><b>& text' };
    const html = renderToStaticMarkup(<HelmetProvider><StaticRouter location="/"><SEO structuredData={data} /></StaticRouter></HelmetProvider>);
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    expect(scripts[0][1]).toContain('type="application/ld+json"');
    expect(scripts[0][2]).not.toContain("<");
    expect(JSON.parse(scripts[0][2])).toEqual(data);
  });
});
