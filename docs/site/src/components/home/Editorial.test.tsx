// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import Editorial from "./Editorial";

afterEach(cleanup);

const step = (name: string) => screen.getByRole("tab", { name: new RegExp(`^Step \\d: ${name}$`) });

it("opens on Discuss and opens any other step with its own screen on a click", () => {
  render(<MemoryRouter><Editorial /></MemoryRouter>);
  const steps = screen.getByRole("tablist", { name: "Workflow steps" });
  expect(within(steps).getAllByRole("tab").map((tab) => tab.getAttribute("aria-label"))).toEqual(
    ["Discuss", "Research", "Plan", "Outline", "Implement", "Verify", "Review", "Pull request"].map((name, i) => `Step ${i + 1}: ${name}`),
  );
  expect(step("Discuss").getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("button", { name: "Enlarge Discuss" })).toBeTruthy();
  fireEvent.click(step("Review"));
  expect(step("Review").getAttribute("aria-selected")).toBe("true");
  expect(step("Plan").getAttribute("aria-selected")).toBe("false");
  expect(document.getElementById("workflow-panel-plan")?.hidden).toBe(true);
  expect(screen.getByRole("button", { name: "Enlarge Review" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Review guide" }).getAttribute("href")).toBe("/docs/steps/review");
});


it("moves the workflow selection and focus with arrows, Home and End", () => {
  render(<MemoryRouter><Editorial /></MemoryRouter>);
  step("Plan").focus();
  fireEvent.keyDown(step("Plan"), { key: "ArrowRight" });
  expect(step("Outline").getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(step("Outline"));
  fireEvent.keyDown(step("Outline"), { key: "End" });
  expect(step("Pull request").getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(step("Pull request"), { key: "Home" });
  expect(step("Discuss").getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(step("Discuss"), { key: "ArrowLeft" });
  expect(document.activeElement).toBe(step("Pull request"));
});

it("opens the step a link names, so the hero's stations and /#verify land on it", () => {
  render(<MemoryRouter initialEntries={["/#verify"]}><Editorial /></MemoryRouter>);
  expect(step("Verify").getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText("Agents check", { selector: ".ed-who" })).toBeTruthy();
});

it("shows the App features as tabs that arrow keys move through, with Teams opening Team", () => {
  render(<MemoryRouter initialEntries={["/#team"]}><Editorial /></MemoryRouter>);
  const tabs = screen.getByRole("tablist", { name: "Also in the App" });
  expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Memory", "Artifacts", "Team", "Home", "Settings"]);
  const team = within(tabs).getByRole("tab", { name: "Team" });
  expect(team.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel", { name: "Team" }).textContent).toContain("Ask the people who know");
  fireEvent.keyDown(team, { key: "ArrowRight" });
  const home = within(tabs).getByRole("tab", { name: "Home" });
  expect(home.getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(home);
  fireEvent.keyDown(home, { key: "Home" });
  expect(within(tabs).getByRole("tab", { name: "Memory" }).getAttribute("aria-selected")).toBe("true");
});

it("opens the Artifacts tab from /#artifacts and links to its docs page", () => {
  render(<MemoryRouter initialEntries={["/#artifacts"]}><Editorial /></MemoryRouter>);
  const tabs = screen.getByRole("tablist", { name: "Also in the App" });
  expect(within(tabs).getByRole("tab", { name: "Artifacts" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("link", { name: "Read about artifacts" }).getAttribute("href")).toBe("/docs/artifacts");
});

it("keeps an honest caption when an image fails", () => {
  render(<MemoryRouter><Editorial /></MemoryRouter>);
  fireEvent.click(step("Plan"));
  fireEvent.error(screen.getByRole("img", { name: /visual billing architecture/ }));
  expect(screen.getByText("Plan image unavailable. Open the preview to retry.")).toBeTruthy();
});

it("marks the image preview as modal and returns focus after Escape", async () => {
  render(<MemoryRouter><Editorial /></MemoryRouter>);
  fireEvent.click(step("Plan"));
  const open = screen.getByRole("button", { name: "Enlarge Plan" });
  fireEvent.click(open);
  const preview = await screen.findByRole("dialog", { name: "Plan" });
  expect(preview.getAttribute("aria-modal")).toBe("true");
  const close = within(preview).getByRole("button", { name: "Close preview" });
  close.focus();
  fireEvent.keyDown(close, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(open));
});
