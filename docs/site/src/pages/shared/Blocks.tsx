import { mockupHtml, mockupName, type PlanBlock } from "@/lib/sharing/plan";
import { Diagram } from "./Diagram";
import { FencedVisual } from "./FencedVisual";
import { useTheme } from "@/hooks/useTheme";
import { ArtifactStill, MissingMockup, MockupFrame } from "./Frame";
import type { PlanStill } from "@/lib/sharing/sharing";

/**
 * The plan's parts in reading order: text, then each diagram and mockup where the plan put it.
 * `shown` names mockups already drawn elsewhere on the page (under a question), so none is drawn twice.
 */
export function Blocks({ blocks, docs, stills, shown }: { blocks: PlanBlock[]; docs: Record<string, string>; stills?: Record<string, PlanStill>; shown?: ReadonlySet<string> }) {
  const { theme } = useTheme();
  return (
    <>
      {blocks.map((block) => {
        if (block.kind === "html") {
          return (
            <div
              key={block.key}
              className="sh-doc typeset typeset-plan"
              // The markdown is sanitised in plan.ts (or escaped when there is no DOM).
              // biome-ignore lint/security/noDangerouslySetInnerHTML: sanitised by htmlOf
              dangerouslySetInnerHTML={{ __html: block.html }}
            />
          );
        }
        if (block.kind === "mermaid") return <Diagram key={block.key} source={block.source} />;
        if (block.kind === "wireframe" || block.kind === "panel") return <FencedVisual key={block.key} kind={block.kind} source={block.source} theme={theme} />;
        if (shown?.has(mockupName(block.path))) return null;
        const still = stills?.[block.path];
        if (still !== undefined) return <ArtifactStill key={block.key} still={still} />;
        const html = mockupHtml(docs, block.path);
        return html === undefined ? <MissingMockup key={block.key} /> : <MockupFrame key={block.key} html={html} title="Mockup" />;
      })}
    </>
  );
}
