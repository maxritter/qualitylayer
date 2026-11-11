// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import Editorial from "./Editorial";

afterEach(cleanup);

const stepRow = (id: string) => document.getElementById(id) as HTMLElement;

it("lists Plan, Implement and Verify with their own screens, then the pull request", () => {
  render(<MemoryRouter><Editorial /></MemoryRouter>);
  const tour = document.querySelector("ol.ed-tour") as HTMLElement;
  expect([...tour.children].map((row) => row.id)).toEqual(["plan", "implement", "verify", "pull-request"]);
  expect(screen.queryByRole("tablist", { name: "Workflow steps" })).toBeNull();
  for (const name of ["Plan", "Implement", "Verify"]) {
    expect(screen.getByRole("heading", { level: 3, name })).toBeTruthy();
    expect(screen.getByRole("button", { name: `Enlarge ${name}` })).toBeTruthy();
    expect(screen.getByRole("link", { name: `${name} guide` }).getAttribute("href")).toBe(`/docs/steps/${name.toLowerCase()}`);
  }
  expect(screen.getAllByText(/^Step \d of 3$/).map((mark) => mark.textContent)).toEqual(["Step 1 of 3", "Step 2 of 3", "Step 3 of 3"]);
  expect(screen.queryByText("Discuss")).toBeNull();
  expect(screen.getByText(/Then the pull request\./)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Pull request guide" }).getAttribute("href")).toBe("/docs/steps/pull-request");
});

it("reserves each workflow capture's desktop aspect ratio, including the complete Plan question", () => {
  render(<MemoryRouter><Editorial /></MemoryRouter>);
  for (const id of ["plan", "implement", "verify"]) {
    const image = within(stepRow(id)).getByRole("img") as HTMLImageElement;
    expect(image.width).toBe(2664);
    expect(image.height).toBe(id === "plan" ? 2024 : 1664);
  }
});

it("marks who acts in each step: you approve the Plan, agents work, agents check then you approve", () => {
  render(<MemoryRouter><Editorial /></MemoryRouter>);
  const who = (id: string) => stepRow(id).querySelector(".ed-who")?.textContent;
  expect([who("plan"), who("implement"), who("verify")]).toEqual(["You approve", "Agents work", "Agents check, then you approve"]);
});

it("keeps a link to a step on that step, so the hero's stations and /#verify land on it", () => {
  render(<MemoryRouter initialEntries={["/#verify"]}><Editorial /></MemoryRouter>);
  expect(stepRow("verify").tabIndex).toBe(-1);
  expect(within(stepRow("verify")).getByText("Agents check, then you approve")).toBeTruthy();
});

const feature = (tabs: HTMLElement, name: string) => within(tabs).getByRole("tab", { name: new RegExp(`^${name}\\b`) });

it("lists the local App features and keeps keyboard navigation after Team removal", () => {
  render(<MemoryRouter><Editorial /></MemoryRouter>);
  const tabs = screen.getByRole("tablist", { name: "Also in the App" });
  expect(within(tabs).getAllByRole("tab").map((tab) => tab.querySelector("b")?.textContent)).toEqual(["Home", "Artifacts", "Memory", "Settings"]);
  const home = feature(tabs, "Home");
  fireEvent.keyDown(home, { key: "ArrowDown" });
  expect(feature(tabs, "Artifacts").getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(feature(tabs, "Artifacts"));
  fireEvent.keyDown(feature(tabs, "Artifacts"), { key: "End" });
  expect(feature(tabs, "Settings").getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(feature(tabs, "Settings"), { key: "Home" });
  expect(home.getAttribute("aria-selected")).toBe("true");
});

it("opens Also in the App on Home, with a crop of the capture that Enlarge still opens whole", () => {
  render(<MemoryRouter><Editorial /></MemoryRouter>);
  const tabs = screen.getByRole("tablist", { name: "Also in the App" });
  expect(feature(tabs, "Home").getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText("See what needs you, try designs and keep project lessons.")).toBeTruthy();
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
  expect(container.querySelector("#verify")?.closest("ol.ed-tour")).toBeTruthy();
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
  fireEvent.error(screen.getByRole("img", { name: /Plan's limit question/ }));
  expect(screen.getByText("Plan image unavailable. Open the preview to retry.")).toBeTruthy();
});

it("marks the image preview as modal and returns focus after Escape", async () => {
  render(<MemoryRouter><Editorial /></MemoryRouter>);
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
