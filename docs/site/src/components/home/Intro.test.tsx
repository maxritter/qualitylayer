// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import Intro, { Principles } from "./Intro";

afterEach(cleanup);

it("shows both approved quotes with anonymous captions and a named artifact section", () => {
  render(<Principles />);
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

it("puts the plan cards before the quotes, and names each agent once on the cards", () => {
  const { container } = render(<Principles />);
  const ids = [...container.querySelectorAll("section")].map(section => section.id || section.getAttribute("aria-labelledby"));
  expect(ids).toEqual(["pr-h", "customer-quotes"]);
  const cards = [...container.querySelectorAll(".mx-pr")];
  expect(cards.map(card => card.querySelector("p")?.textContent)).toEqual([
    "Claude Code, Codex, Cursor and five more.",
    "Comment on diagrams and clickable mockups.",
    "A separate agent checks the result against your plan.",
  ]);
});

it("shows the skills right after the models, led by an example exchange between two agents", () => {
  const { container } = render(<Intro />);
  const ids = [...container.querySelectorAll("section")].map(section => section.id || section.getAttribute("aria-labelledby"));
  expect(ids).toEqual(["agents", "mod-h", "skills", "local"]);
  expect(container.querySelector("#change-map")).toBeNull();
  const skills = screen.getByRole("region", { name: "Your agents can talk to each other" });
  expect(skills.getAttribute("data-screen-label")).toBe("Skills");
  const example = within(skills).getByRole("figure", { name: "Example: Claude Code asks Codex for a review" });
  expect(within(example).getByText("Example")).toBeTruthy();
  expect([...example.querySelectorAll(".sk-win")].map(win => win.getAttribute("data-agent"))).toEqual(["claude-code", "codex"]);
  const more = within(skills).getByRole("list", { name: "More skills, with what you say" });
  expect(within(more).getAllByRole("listitem").map(item => item.querySelector("b")?.textContent)).toEqual(["Plan and build", "Chat", "Designs", "Security", "Sharing"]);
  expect(within(skills).getByRole("link", { name: "More about the skills" }).getAttribute("href")).toBe("/docs/agents/native");
});

it("lists the models and the ways to set it up once, as still rows, without repeating the agents", () => {
  render(<Intro />);
  const models = screen.getByRole("list", { name: "Models" });
  expect(within(models).getAllByRole("listitem").map(item => item.textContent)).toEqual([
    "Opus 5.5", "Sonnet 5.5", "Fable 5.1", "Haiku 5.5", "GPT-6.1 Sol", "Grok 4.7", "Gemini 3.8 Flash",
  ]);
  expect(within(screen.getByRole("list", { name: "Ways to set it up" })).getAllByRole("listitem")).toHaveLength(5);
  expect(document.querySelector(".mx-track")).toBeNull();
  // The eight agents are named in one place, the agents grid; the chain card no longer lists them again.
  const chain = within(document.querySelector(".mx-chain") as HTMLElement);
  expect(chain.getByText("Your agent")).toBeTruthy();
  expect(chain.queryByText("Claude Code")).toBeNull();
});
