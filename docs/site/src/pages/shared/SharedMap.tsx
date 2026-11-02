import { Component, type ReactNode } from "react";
import { ChangeMapBlock } from "@ql/ui/reader/ChangeMapBlock";
import { parseChangeMap, toMermaid } from "@ql/core/docs/change-map";
import { Diagram } from "./Diagram";

/** What the page shows when the App's map component cannot draw: the Mermaid the map generates, or its source. */
function Fallback({ source, title }: { source: string; title?: string }) {
  const parsed = parseChangeMap(source, { shared: true });
  return parsed.ok ? (
    <Diagram source={toMermaid(parsed.map)} title={title ?? parsed.map.title} />
  ) : (
    <pre>
      <code>{source}</code>
    </pre>
  );
}

class Guard extends Component<{ source: string; title?: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <Fallback source={this.props.source} title={this.props.title} /> : this.props.children;
  }
}

/**
 * A change map on a shared page: the App's own component, in its shared mode (no action that reaches the owner's
 * checkout). A map it cannot draw keeps its architecture as Mermaid. One that does not parse shows its problems.
 */
export function SharedMap({ source, title }: { source: string; title?: string }) {
  return (
    <Guard source={source} title={title}>
      <ChangeMapBlock source={source} shared />
    </Guard>
  );
}
