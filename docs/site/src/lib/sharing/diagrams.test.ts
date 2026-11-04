import { describe, expect, it } from "vitest";
import { drawDiagram } from "./diagrams";

/**
 * A shared plan's ```mermaid blocks become diagrams; one that does not parse keeps its source.
 * Mermaid itself is a stub here: the test environment has no DOM to draw in.
 */

describe("a diagram on a shared plan", () => {
  it("is drawn from its source under its own id, in the page's theme, and only the sanitised SVG goes on the page", async () => {
    const seen: string[] = [];
    const svg = await drawDiagram(
      async (id, source, theme) => {
        seen.push(`${id}:${source}:${theme}`);
        return `<svg id="${id}"><script/></svg>`;
      },
      "sh-diagram-3",
      "graph LR; A-->B",
      "dark",
      (raw) => raw.replace("<script/>", ""),
    );
    expect(seen).toEqual(["sh-diagram-3:graph LR; A-->B:dark"]);
    expect(svg).toBe('<svg id="sh-diagram-3"></svg>');
  });

  it("is null when it does not parse, so the page keeps the source", async () => {
    const svg = await drawDiagram(
      async () => {
        throw new Error("Parse error");
      },
      "sh-diagram-0",
      "not a diagram",
      "light",
      (raw) => raw,
    );
    expect(svg).toBeNull();
  });

  it("is null when the drawing comes back empty", async () => {
    expect(await drawDiagram(async () => "", "sh-diagram-0", "graph LR; A-->B", "light", (raw) => raw)).toBeNull();
  });
});
