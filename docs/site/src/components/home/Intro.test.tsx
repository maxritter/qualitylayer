// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import Intro from "./Intro";

afterEach(cleanup);

it("shows both approved quotes with anonymous captions and a named artifact section", () => {
  render(<Intro />);
  const quotes = screen.getByRole("region", { name: "What people say about QualityLayer" });
  expect(quotes.id).toBe("customer-quotes");
  expect(quotes.getAttribute("data-screen-label")).toBe("Customer quotes");
  const figures = within(quotes).getAllByRole("figure");
  expect(figures).toHaveLength(2);
  expect(figures.map(figure => figure.querySelector("blockquote")?.textContent)).toEqual([
    "“With QualityLayer, developing software with agents finally feels like doing real engineering again.”",
    "“I just wanted to say how much I LOVE QualityLayer. I feel like my productivity shot through the roof!”",
  ]);
  expect(figures.map(figure => figure.querySelector("figcaption")?.textContent)).toEqual([
    "An engineer who uses QualityLayer",
    "Former Pilot Shell user, now using QualityLayer",
  ]);
  expect(within(quotes).queryByRole("img")).toBeNull();
  expect(quotes.querySelector("cite")).toBeNull();
});

it("shows the skills right after the models, led by an example exchange between two agents", () => {
  const { container } = render(<Intro />);
  const ids = [...container.querySelectorAll("section")].map(section => section.id || section.getAttribute("aria-labelledby"));
  expect(ids.slice(0, 3)).toEqual(["agents", "mod-h", "skills"]);
  const skills = screen.getByRole("region", { name: "Your agents can talk to each other" });
  expect(skills.getAttribute("data-screen-label")).toBe("Skills");
  const example = within(skills).getByRole("figure", { name: "Example: Claude Code asks Codex for a review" });
  expect(within(example).getByText("Example")).toBeTruthy();
  expect([...example.querySelectorAll(".sk-win")].map(win => win.getAttribute("data-agent"))).toEqual(["claude-code", "codex"]);
  const more = within(skills).getByRole("list", { name: "More skills, with what you say" });
  expect(within(more).getAllByRole("listitem").map(item => item.querySelector("b")?.textContent)).toEqual(["Plan and build", "Chat", "Designs", "Security", "Sharing"]);
  expect(within(skills).getByRole("link", { name: "More about the skills" }).getAttribute("href")).toBe("/docs/agents/native");
});

it("draws an example change map with the App's own component right after the skills", async () => {
  const { container } = render(<Intro />);
  const ids = [...container.querySelectorAll("section")].map(section => section.id || section.getAttribute("aria-labelledby"));
  expect(ids.slice(2, 4)).toEqual(["skills", "change-map"]);
  const section = screen.getByRole("region", { name: "See how a change fits together" });
  const example = within(section).getByRole("figure", { name: "Example change map from a Plan" });
  expect(within(example).getByText("Example")).toBeTruthy();
  const map = await within(example).findByTestId("change-map", {}, { timeout: 5000 });
  expect(map.textContent).toContain("Ledger");
  expect(map.textContent).not.toContain("does not parse");
  expect(within(section).getByRole("link", { name: "More about the Plan" }).getAttribute("href")).toBe("/docs/steps/plan");
});

it("keeps the example change map a valid map", async () => {
  const { parseChangeMap } = await import("@ql/core/docs/change-map");
  const { EXAMPLE_MAP } = await import("./change-map-example");
  expect(parseChangeMap(EXAMPLE_MAP, { shared: true }).ok).toBe(true);
});
