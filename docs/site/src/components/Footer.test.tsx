import { renderToReadableStream } from "react-dom/server.browser";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Footer from "./Footer";

async function html(path: string): Promise<string> {
  const stream = await renderToReadableStream(<MemoryRouter initialEntries={[path]}><Footer /></MemoryRouter>);
  await stream.allReady;
  return new Response(stream).text();
}

describe("the footer", () => {
  it("carries the links and the copyright, no fine print", async () => {
    for (const path of ["/", "/pricing", `/s/${"A".repeat(22)}`]) {
      const rendered = await html(path);
      expect(rendered).toContain("© 2026 QualityLayer");
      expect(rendered).toMatch(/href="\/docs\/">Docs<\/a>\s*<a href="\/blog">Blog<\/a>/);
      expect(rendered.match(/>Blog<\/a>/g)).toHaveLength(1);
      expect(rendered).toContain('href="/compare"');
      expect(rendered).toContain(">Compare</a>");
      // Who makes it: the author's own site, as the README's footer has it.
      expect(rendered).toMatch(/by <a href="https:\/\/www\.maxritter\.net\/">Max Ritter<\/a>/);
      // Every page links the imprint, privacy policy and terms a seller in Germany must show.
      for (const [path, label] of [["/imprint", "Imprint"], ["/privacy", "Privacy"], ["/terms", "Terms"]]) {
        expect(rendered).toMatch(new RegExp(`href="${path}"[^>]*>${label}</a>`));
      }
      expect(rendered).not.toMatch(/fictional|illustration|billed monthly/);
    }
  });
});
