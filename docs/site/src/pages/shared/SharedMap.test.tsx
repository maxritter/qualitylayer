// @vitest-environment happy-dom
// A change map on a shared page is the App's own component, in its shared mode: the same picture
// under a question (Asks) and in a plan's contracts (Blocks), and a map that does not parse shows
// its problems and source, as in the App.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { planBlocks } from "@/lib/sharing/plan";
import type { ShareItem } from "@/lib/sharing/sharing";
import { Asks } from "./Asks";
import { Blocks } from "./Blocks";

afterEach(cleanup);

const MAP = JSON.stringify({
  title: "Re-run a lane",
  parts: [
    { id: "app", name: "App", kind: "ui" },
    { id: "engine", name: "Engine", kind: "core" },
  ],
  cards: [
    { id: "proof", path: "src/ui/Proof.tsx", name: "Proof lanes", part: "app", change: "changed", today: "Read only.", after: "Has Re-run." },
    { id: "rerun", path: "src/core/rerun.ts", name: "Lane re-run", part: "engine", change: "new", after: "Marks the lane stale." },
  ],
  links: [{ from: "proof", to: "rerun", label: "Re-run", change: "new" }],
});

const item = (media: ShareItem["media"]): ShareItem =>
  ({ id: "plan:decision:1", step: "plan", family: "decide", kind: "decision", kindLabel: "Engineering decision", what: "Where does Re-run live?", options: ["agree", "change"], media }) as ShareItem;

const asks = (media: ShareItem["media"]) => (
  <Asks items={[item(media)]} owner="Max" docs={{}} drafts={{ answers: {}, comments: [] } as never} settled={{}} onAnswer={() => {}} />
);

describe("a change map on a shared page", () => {
  it("is drawn under the owner's question, with the App's component", () => {
    render(asks({ kind: "map", source: MAP, title: "Today and after" }));
    expect(screen.getByTestId("change-map")).toBeTruthy();
    expect(screen.getByText("Proof lanes")).toBeTruthy();
  });

  it("is drawn where a plan's contract holds a ql-map fence", () => {
    render(<Blocks blocks={planBlocks(`Intro.\n\n\`\`\`ql-map\n${MAP}\n\`\`\`\n`)} docs={{}} />);
    expect(screen.getByTestId("change-map")).toBeTruthy();
  });

  it("draws a map whose cards have no paths, as a shared copy carries it, with no path anywhere", () => {
    const shared = JSON.stringify({ ...JSON.parse(MAP), cards: JSON.parse(MAP).cards.map(({ path: _path, ...card }: Record<string, unknown>) => card) });
    const { container } = render(asks({ kind: "map", source: shared }));
    expect(screen.queryByTestId("change-map-problems")).toBeNull();
    expect(screen.getByText("Proof lanes")).toBeTruthy();
    expect(container.querySelector(".cm-path")).toBeNull();
    expect(container.textContent).not.toContain("src/ui/Proof.tsx");
  });

  it("offers no action that reaches the owner's checkout", () => {
    render(asks({ kind: "map", source: MAP }));
    expect(screen.queryByText(/open file|open in code review/i)).toBeNull();
  });

  it("says what is wrong with a map that does not parse and shows its source", () => {
    render(asks({ kind: "map", source: "{ not json" }));
    expect(screen.getByTestId("change-map-problems")).toBeTruthy();
    expect(screen.getByText("{ not json")).toBeTruthy();
  });
});
