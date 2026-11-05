// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BRAND_LINE, DEEP_DIVE, SLOGAN } from "@/lib/product";
import { DEEP_DIVE_MINUTES, DEEP_DIVE_VIDEO_URL } from "@/lib/deep-dive";
import Hero, { LIVE_DEMO } from "./Hero";
import { OVERVIEW_VIDEO_URL } from "@/lib/videos";

/** Where the router is, to tell a station that plays its step from one that opens the tour. */
function Hash() { return <output data-testid="hash">{useLocation().hash}</output>; }

beforeEach(() => { vi.stubGlobal("fetch", async () => new Response("{}", { status: 503 })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("opens on the brand line and the slogan the rest of the site and the README use", () => {
  render(<MemoryRouter><Hero /></MemoryRouter>);
  const h1 = screen.getByRole("heading", { level: 1 });
  expect(h1.textContent).toBe(SLOGAN);
  expect(h1.previousElementSibling?.textContent).toBe(BRAND_LINE);
});

it("shows the App beside the copy as a still first frame, light and dark, with a phone crop and fixed sizes", () => {
  const { container } = render(<MemoryRouter><Hero /></MemoryRouter>);
  const pictures = [...container.querySelectorAll(".sx-shot picture")];
  expect(pictures.map((p) => p.className)).toEqual(["sx-shot-light", "sx-shot-dark"]);
  for (const [picture, theme] of pictures.map((p, i) => [p, i ? "dark" : "light"] as const)) {
    const img = picture.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(`/product/discuss-${theme}.webp`);
    expect([img.getAttribute("width"), img.getAttribute("height")]).toEqual(["2664", "1664"]);
    expect(img.getAttribute("alt")).toMatch(/seven steps/);
    const phone = picture.querySelector("source")!;
    expect(phone.getAttribute("media")).toBe("(max-width: 640px)");
    expect(phone.getAttribute("srcset")).toBe(`/hero/your-turn-${theme}.webp`);
    expect([phone.getAttribute("width"), phone.getAttribute("height")]).toEqual(["728", "776"]);
  }
});

it("plays the steps on a wide screen: the stations follow it, a station plays its step, and it pauses", async () => {
  const { container } = render(<MemoryRouter><Hero /><Hash /></MemoryRouter>);
  expect(container.querySelector(".hs-cam")).toBeTruthy();
  const stations = within(screen.getByRole("navigation", { name: "The seven steps" })).getAllByRole("link").slice(0, 7);
  await waitFor(() => expect(stations[0].getAttribute("aria-current")).toBe("step"));
  fireEvent.click(stations[4]);
  await waitFor(() => expect(stations[4].getAttribute("aria-current")).toBe("step"));
  expect(screen.getByTestId("hash").textContent).toBe("");
  expect(stations.filter((s) => s.hasAttribute("aria-current"))).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Pause the walkthrough" }));
  expect(screen.getByRole("button", { name: "Play the walkthrough" })).toBeTruthy();
});

it("keeps the still picture and plain station links on a phone", () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  const { container } = render(<MemoryRouter><Hero /><Hash /></MemoryRouter>);
  expect(container.querySelector(".hs-cam")).toBeNull();
  expect(screen.queryByRole("button", { name: /walkthrough/ })).toBeNull();
  const station = within(screen.getByRole("navigation", { name: "The seven steps" })).getAllByRole("link")[2];
  expect(station.hasAttribute("aria-current")).toBe(false);
  expect(screen.getByRole("link", { name: /^Try the App in your browser: the usage-based billing example/ }).getAttribute("href")).toBe(LIVE_DEMO);
  fireEvent.click(station);
  expect(screen.getByTestId("hash").textContent).toBe("#plan");
});

it("opens the walkthrough larger from the picture, with the demo one click away, and the demo from the hero action", async () => {
  render(<MemoryRouter><Hero /></MemoryRouter>);
  const picture = screen.getByRole("link", { name: "Watch the seven steps larger" });
  expect(picture.getAttribute("href")).toBe(LIVE_DEMO);
  expect(picture.querySelector(".sx-shot")).toBeTruthy();
  fireEvent.click(picture);
  const card = await screen.findByRole("dialog", { name: "The seven steps in the App" });
  expect(within(card).getByRole("link", { name: /Try it yourself/ }).getAttribute("href")).toBe(LIVE_DEMO);
  const steps = within(within(card).getByRole("list", { name: "Play a step" })).getAllByRole("button");
  expect(steps.map((s) => s.textContent)).toEqual(["Discuss", "Research", "Plan", "Outline", "Implement", "Verify", "Review"]);
  fireEvent.click(steps[6]);
  await waitFor(() => expect(steps[6].getAttribute("aria-current")).toBe("step"));
  fireEvent.click(within(card).getByRole("button", { name: "Close the walkthrough" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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

it("offers download, film and deep dive actions together in the hero", () => {
  render(<MemoryRouter><Hero /></MemoryRouter>);
  const download = screen.getAllByRole("link").find(link => link.textContent?.startsWith("Download"));
  expect(download?.getAttribute("href")).toBe("/download");
  const film = screen.getByRole("link", { name: /Watch the film on YouTube/ });
  expect(film.getAttribute("href")).toBe(OVERVIEW_VIDEO_URL);
  expect(film.getAttribute("target")).toBe("_blank");
  expect(film.getAttribute("rel")).toBe("noopener noreferrer");
  expect(document.querySelector("video")).toBeNull();
  // The deep dive appears once its video is published.
  const deepDive = screen.queryByRole("link", { name: `Inside QualityLayer, a ${DEEP_DIVE_MINUTES}-minute deep dive` });
  if (DEEP_DIVE_VIDEO_URL) expect(deepDive?.getAttribute("href")).toBe(DEEP_DIVE.href);
  else expect(deepDive).toBeNull();
  expect(screen.queryByText("/ql add usage-based billing")).toBeNull();
  expect(screen.queryByRole("button", { name: /Replay/ })).toBeNull();
});
