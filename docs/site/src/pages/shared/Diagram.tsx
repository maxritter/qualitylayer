import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { drawDiagram, mermaidRenderer, type RenderDiagram } from "@/lib/sharing/diagrams";

/** One renderer for the page: mermaid loads once, and only when a plan has a diagram. */
const mermaid = mermaidRenderer();
let counter = 0;

/**
 * Fit the drawing to what it shows, then to the column: down to three quarters, and scroll beyond
 * that. In a narrow window it may go down to 60 %, so a phone sees the whole diagram, not a corner.
 */
function fit(figure: HTMLElement): void {
  const svg = figure.querySelector("svg");
  if (svg === null || typeof svg.getBBox !== "function") return;
  let box: DOMRect;
  try {
    box = svg.getBBox();
  } catch {
    return;
  }
  if (box.width === 0 || box.height === 0) return;
  const pad = 12;
  svg.setAttribute("viewBox", `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`);
  const natural = Math.ceil(box.width + pad * 2);
  const room = figure.clientWidth - 32;
  svg.style.maxWidth = "none";
  svg.setAttribute("width", String(room > 0 && natural > room ? Math.max(room, Math.ceil(natural * (window.matchMedia("(max-width: 900px)").matches ? 0.6 : 0.75))) : natural));
  svg.removeAttribute("height");
}

/**
 * A diagram of the plan, drawn in the page's colours. Until it is drawn, or when it does not
 * parse, the figure holds its source, so the reader still sees what was meant.
 */
export function Diagram({ source, title, render = mermaid }: { source: string; title?: string; render?: RenderDiagram }) {
  const { theme } = useTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const figure = useRef<HTMLElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new theme draws the diagram again
  useEffect(() => {
    let live = true;
    counter++;
    void drawDiagram(render, `sh-diagram-${counter}`, source, theme === "light" ? "light" : "dark").then((drawn) => {
      if (live) setSvg(drawn);
    });
    return () => {
      live = false;
    };
  }, [source, render, theme]);

  useEffect(() => {
    if (svg !== null && figure.current !== null) fit(figure.current);
  }, [svg]);

  return (
    <figure ref={figure} className="sh-diagram" data-testid="shared-diagram" aria-label={title ?? "Diagram"}>
      {svg !== null ? (
        // The drawing is sanitised SVG (drawDiagram).
        // biome-ignore lint/security/noDangerouslySetInnerHTML: sanitised by drawDiagram
        <div className="sh-diagram-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <pre>
          <code>{source}</code>
        </pre>
      )}
    </figure>
  );
}
