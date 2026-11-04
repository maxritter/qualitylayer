import DOMPurify from "dompurify";
import {
  type DiagramTheme,
  endLifelines,
  mermaidConfig,
  titleGroupsLeft,
} from "@ql/core/docs/mermaid-style";

/** Renders one diagram's source to SVG markup for a theme; mermaid in the page, a stub in tests. */
export type RenderDiagram = (id: string, source: string, theme: DiagramTheme) => Promise<string>;

/**
 * Mermaid, loaded only when a plan has a diagram, and strict: no clicks, no HTML labels, no scripts.
 * It draws in QualityLayer's one style (the App's core/docs/mermaid-style.ts), so a shared plan
 * looks as it does in the App, light or dark.
 */
export const mermaidRenderer = (): RenderDiagram => {
  let ready: Promise<typeof import("mermaid").default> | null = null;
  return async (id, source, theme) => {
    const mermaid = await (ready ??= import("mermaid").then(({ default: m }) => m));
    // A diagram that does not parse keeps its source; mermaid draws no error graphic into the page.
    mermaid.initialize({ ...mermaidConfig(theme), suppressErrorRendering: true } as never);
    try {
      return titleGroupsLeft(endLifelines((await mermaid.render(id, source)).svg));
    } finally {
      // Mermaid draws in a temporary element and leaves it behind when a diagram does not parse.
      document.getElementById(`d${id}`)?.remove();
      document.getElementById(id)?.remove();
    }
  };
};

const sanitizeSvg = (svg: string) => DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });

/**
 * One diagram as sanitised SVG, or null when it does not parse or draws nothing: the page then
 * keeps the source, so the reader still sees what was meant.
 */
export async function drawDiagram(
  render: RenderDiagram,
  id: string,
  source: string,
  theme: DiagramTheme,
  sanitize: (svg: string) => string = sanitizeSvg,
): Promise<string | null> {
  try {
    const svg = sanitize(await render(id, source, theme));
    return svg.trim() === "" ? null : svg;
  } catch {
    return null;
  }
}
