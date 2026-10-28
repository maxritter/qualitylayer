// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BRAND_LINE, SLOGAN, WEBINAR } from "@/lib/product";
import Hero, { LIVE_DEMO } from "./Hero";
import { useTheme } from "@/hooks/useTheme";
import { OVERVIEW_POSTERS } from "@/lib/film-posters";

beforeEach(() => { vi.stubGlobal("fetch", async () => new Response("{}", { status: 503 })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("opens on the brand line and the slogan the rest of the site and the README use", () => {
  render(<MemoryRouter><Hero /></MemoryRouter>);
  const h1 = screen.getByRole("heading", { level: 1 });
  expect(h1.textContent).toBe(SLOGAN);
  expect(h1.previousElementSibling?.textContent).toBe(BRAND_LINE);
});

it("shows the App at your turn beside the copy, light and dark, with a phone crop and fixed sizes", () => {
  const { container } = render(<MemoryRouter><Hero /></MemoryRouter>);
  const pictures = [...container.querySelectorAll(".sx-shot picture")];
  expect(pictures.map((p) => p.className)).toEqual(["sx-shot-light", "sx-shot-dark"]);
  for (const [picture, theme] of pictures.map((p, i) => [p, i ? "dark" : "light"] as const)) {
    const img = picture.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(`/product/plan-${theme}.webp`);
    expect([img.getAttribute("width"), img.getAttribute("height")]).toEqual(["2560", "1392"]);
    expect(img.getAttribute("alt")).toMatch(/what happens when a customer reaches their limit/);
    const phone = picture.querySelector("source")!;
    expect(phone.getAttribute("media")).toBe("(max-width: 640px)");
    expect(phone.getAttribute("srcset")).toBe(`/hero/your-turn-${theme}.webp`);
    expect([phone.getAttribute("width"), phone.getAttribute("height")]).toEqual(["724", "609"]);
  }
});

it("opens the App demo from the picture and from the hero action", () => {
  render(<MemoryRouter><Hero /></MemoryRouter>);
  const picture = screen.getByRole("link", { name: /^Try the App in your browser: the usage-based billing example/ });
  expect(picture.getAttribute("href")).toBe(LIVE_DEMO);
  expect(picture.querySelector(".sx-shot")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Try the demo in your browser" }).getAttribute("href")).toBe(LIVE_DEMO);
  expect(LIVE_DEMO).toBe("/app-demo/?story&guide");
});

it("lists the seven steps as stations that each open their step in the tour", () => {
  render(<MemoryRouter><Hero /></MemoryRouter>);
  const stations = within(screen.getByRole("navigation", { name: "The seven steps" })).getAllByRole("listitem");
  expect(stations.map((s) => s.querySelector(".mx-station-name")?.lastChild?.textContent)).toEqual(["Discuss", "Research", "Plan", "Outline", "Implement", "Verify", "Review"]);
  expect(stations.map((s) => within(s).getByRole("link").getAttribute("href"))).toEqual(["/#discuss", "/#research", "/#plan", "/#outline", "/#implement", "/#verify", "/#review"]);
  expect(screen.getByRole("link", { name: "See each step in the App" }).getAttribute("href")).toBe("/#discuss");
});

it("offers download, film and webinar actions together in the hero", () => {
  render(<MemoryRouter><Hero /></MemoryRouter>);
  const download = screen.getAllByRole("link").find(link => link.textContent?.startsWith("Download"));
  expect(download?.getAttribute("href")).toBe("/download");
  expect(screen.getByRole("button", { name: /Watch the film/ })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Join the Inside QualityLayer webinar" }).getAttribute("href")).toBe(WEBINAR.href);
  expect(screen.queryByText("/ql add usage-based billing")).toBeNull();
  expect(screen.queryByRole("button", { name: /Replay/ })).toBeNull();
});

it("opens the overview film and returns focus when the dialog closes", () => {
  const show = vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () {
    this.open = true;
  });
  try {
    render(<MemoryRouter><Hero /></MemoryRouter>);
    const opener = screen.getByRole("button", { name: /Watch the film/ });
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("video")?.hasAttribute("controls")).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    fireEvent(dialog, new Event("close"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  } finally { show.mockRestore(); }
});

it("updates the open film poster when the website theme changes", () => {
  const show = vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () { this.open = true; });
  function Page() {
    const { toggle } = useTheme();
    return <MemoryRouter><button onClick={toggle}>Toggle theme</button><Hero /></MemoryRouter>;
  }
  localStorage.setItem("theme", "dark");
  try {
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: /Watch the film/ }));
    const video = screen.getByRole("dialog").querySelector("video")!;
    expect(video.getAttribute("poster")).toBe(OVERVIEW_POSTERS.dark);
    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(video.getAttribute("poster")).toBe(OVERVIEW_POSTERS.light);
  } finally {
    localStorage.removeItem("theme");
    show.mockRestore();
  }
});
