// @vitest-environment happy-dom
// If the App's map component cannot draw (a build without it, a render error), the shared page still
// shows the architecture: the Mermaid the map generates, or the source when it does not parse.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@ql/ui/reader/ChangeMapBlock", () => ({
  ChangeMapBlock: () => {
    throw new Error("cannot draw");
  },
}));

const { SharedMap } = await import("./SharedMap");

afterEach(cleanup);

const MAP = JSON.stringify({
  title: "T",
  parts: [{ id: "app", name: "App", kind: "ui" }],
  cards: [{ id: "proof", path: "src/ui/Proof.tsx", name: "Proof lanes", part: "app", change: "changed", today: "a", after: "b" }],
  links: [],
});

describe("a map the page cannot draw", () => {
  it("falls back to the Mermaid the map generates", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<SharedMap source={MAP} />);
    expect(screen.getByTestId("shared-diagram").textContent).toContain("Proof lanes");
    expect(screen.getByTestId("shared-diagram").textContent).toMatch(/flowchart|graph/);
  });

  it("falls back to the source when it does not parse either", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<SharedMap source="{ not json" />);
    expect(screen.getByText("{ not json")).toBeTruthy();
  });
});
