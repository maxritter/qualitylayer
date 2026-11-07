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

it("reserves each workflow capture's desktop aspect ratio, including the complete Plan question", () => {
  render(<MemoryRouter><Editorial /></MemoryRouter>);
  for (const name of ["Discuss", "Research", "Plan", "Outline", "Implement", "Verify", "Review", "Pull request"]) {
    fireEvent.click(step(name));
    const panel = screen.getByRole("tabpanel", { name: new RegExp(`Step \\d: ${name}$`) });
    const image = within(panel).getByRole("img") as HTMLImageElement;
    expect(image.width).toBe(2664);
    expect(image.height).toBe(name === "Plan" ? 2024 : 1664);
  }
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

const feature = (tabs: HTMLElement, name: string) => within(tabs).getByRole("tab", { name: new RegExp(`^${name}\\b`) });

it("lists the App features with their one line, moves with arrow keys, and Teams opens Team", () => {
  render(<MemoryRouter initialEntries={["/#team"]}><Editorial /></MemoryRouter>);
  const tabs = screen.getByRole("tablist", { name: "Also in the App" });
  expect(tabs.getAttribute("aria-orientation")).toBe("vertical");
  expect(within(tabs).getAllByRole("tab").map((t) => t.querySelector("b")?.textContent)).toEqual(["Home", "Team", "Artifacts", "Memory", "Settings"]);
  expect(feature(tabs, "Memory").textContent).toContain("Keep useful project lessons");
  const team = feature(tabs, "Team");
  expect(team.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel", { name: /^Team/ }).textContent).toContain("Teammates answer plan questions");
  expect(screen.getByRole("button", { name: "Enlarge Team" })).toBeTruthy();
  fireEvent.keyDown(team, { key: "ArrowDown" });
  const artifacts = feature(tabs, "Artifacts");
  expect(artifacts.getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(artifacts);
  fireEvent.keyDown(artifacts, { key: "ArrowUp" });
  expect(team.getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(team, { key: "End" });
  expect(feature(tabs, "Settings").getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(feature(tabs, "Settings"), { key: "Home" });
  expect(feature(tabs, "Home").getAttribute("aria-selected")).toBe("true");
});

it("opens Also in the App on Home, with a crop of the capture that Enlarge still opens whole", () => {
  render(<MemoryRouter><Editorial /></MemoryRouter>);
  const tabs = screen.getByRole("tablist", { name: "Also in the App" });
  expect(feature(tabs, "Home").getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText("See what needs you, try designs and work with your team.")).toBeTruthy();
  const frame = screen.getByRole("button", { name: "Enlarge Home" });
  expect(frame.style.getPropertyValue("--crop-w")).toBe("130.95%");
  expect(frame.style.getPropertyValue("--crop-x")).toBe("-20%");
  expect(frame.style.getPropertyValue("--crop-y")).toBe("-5.18%");
  expect(frame.querySelector("img")?.getAttribute("src")).toMatch(/home-(light|dark)\.webp$/);
});

it("draws what the page puts between the tour and Also in the App in that place", () => {
  const { container } = render(<MemoryRouter><Editorial between={<section id="between" />} /></MemoryRouter>);
  const ids = [...container.querySelectorAll("section")].map((section) => section.id);
  expect(ids).toEqual(["tour", "between", "extras"]);
});

it("keeps each id to one element: the Checks section does not share the tour's Verify tab id", async () => {
  const { default: Verification } = await import("./Verification");
  const { container } = render(<MemoryRouter><Editorial between={<Verification />} /></MemoryRouter>);
  expect(container.querySelectorAll('[id="verify"]')).toHaveLength(1);
  expect(container.querySelector("#verify")?.getAttribute("role")).toBe("tab");
  expect(container.querySelector("section#checks")).toBeTruthy();
});

it("opens Artifacts from /#artifacts and links to its docs page", () => {
  render(<MemoryRouter initialEntries={["/#artifacts"]}><Editorial /></MemoryRouter>);
  const tabs = screen.getByRole("tablist", { name: "Also in the App" });
  expect(feature(tabs, "Artifacts").getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("link", { name: "Read about artifacts" }).getAttribute("href")).toBe("/docs/artifacts");
});

it("keeps an honest caption when an image fails", () => {
  render(<MemoryRouter><Editorial /></MemoryRouter>);
  fireEvent.click(step("Plan"));
  fireEvent.error(screen.getByRole("img", { name: /Plan's limit question/ }));
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
