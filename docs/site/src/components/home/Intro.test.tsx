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
