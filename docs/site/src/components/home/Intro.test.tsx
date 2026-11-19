// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import Intro, { Principles } from "./Intro";

afterEach(cleanup);

it("renders the plan cards as a single section", () => {
  const { container } = render(<Principles />);
  const ids = [...container.querySelectorAll("section")].map(section => section.id || section.getAttribute("aria-labelledby"));
  expect(ids).toEqual(["pr-h"]);
  const cards = [...container.querySelectorAll(".mx-pr")];
  expect(cards.map(card => card.querySelector("p")?.textContent)).toEqual([
    "Claude Code, Codex, Cursor and more.",
    "Ask about diagrams and clickable mockups.",
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
  expect(within(more).getAllByRole("listitem").map(item => item.querySelector("b")?.textContent)).toEqual(["Plan and build", "Chat", "Designs", "Security", "Tasks and settings"]);
  expect(within(skills).getByRole("link", { name: "More about the skills" }).getAttribute("href")).toBe("/docs/agents/native");
});

it("lists the models and the ways to set it up once, as still rows, without repeating the agents", () => {
  render(<Intro />);
  const models = screen.getByRole("list", { name: "Models" });
  expect(within(models).getAllByRole("listitem").map(item => item.textContent)).toEqual([
    "Opus 5.5", "Sonnet 5.5", "Fable 5.2", "Haiku 5.5", "GPT-6.1 Sol", "Grok 4.7", "Gemini 3.8 Flash",
  ]);
  expect(within(screen.getByRole("list", { name: "Ways to set it up" })).getAllByRole("listitem")).toHaveLength(5);
  expect(document.querySelector(".mx-track")).toBeNull();
  // The eight agents are named in one place, the agents grid; the chain card no longer lists them again.
  const chain = within(document.querySelector(".mx-chain") as HTMLElement);
  expect(chain.getByText("Your agent")).toBeTruthy();
  expect(chain.queryByText("Claude Code")).toBeNull();
});
