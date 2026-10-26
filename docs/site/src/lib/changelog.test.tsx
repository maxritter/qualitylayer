// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import Changelog from "../../../docusaurus/src/components/Changelog";
import ReleaseMarkdown from "../../../docusaurus/src/components/ReleaseMarkdown";
import { loadReleasePage, publishedOn, releaseAnchor, type ReleasePage } from "../../../docusaurus/src/components/changelog-data";
import { CHANGELOG_URL } from "./product";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); location.hash = ""; });
const first: ReleasePage = { notes: [
  { version: "12.2.0", label: "12.2.0", published: "2026-10-24T16:33:50Z", notes: "The current release.\n\n- **Chat** in your terminal." },
  { version: "11.0.9", label: "11.0.9 (Pilot Shell)", published: "2026-10-21T09:03:51Z", notes: "### Bug Fixes\n\n- Existing Pilot notes." },
], nextPage: 2 };
const older: ReleasePage = { notes: [{ version: "8.6.2", label: "8.6.2 (Pilot Shell)", published: "2026-05-06T14:36:41Z", notes: "- Earlier notes." }], nextPage: null };

describe("native changelog", () => {
  it("renders GitHub wording and publication times, then retains notes across an older-history failure and retry", async () => {
    const load = vi.fn().mockResolvedValueOnce(first).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(older);
    render(<Changelog load={load} />);
    expect(screen.getByRole("status").textContent).toContain("Loading release notes");
    await screen.findByRole("heading", { name: "12.2.0, latest release" });
    expect(screen.getByText("Chat").tagName).toBe("STRONG");
    expect(screen.getByText(/Published 24 Oct 2026/).getAttribute("dateTime")).toBe("2026-10-24T16:33:50Z");
    const history = screen.getByText("Pilot Shell release history").parentElement as HTMLDetailsElement;
    history.open = true;
    fireEvent.click(screen.getByRole("button", { name: "Load earlier releases" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("heading", { name: "12.2.0, latest release" })).toBeTruthy();
    const retry = screen.getByRole("button", { name: "Retry earlier releases" });
    retry.focus();
    fireEvent.click(retry);
    await screen.findByRole("heading", { name: "8.6.2" });
    await waitFor(() => expect(document.activeElement?.id).toBe("862"));
    expect(screen.getByRole("heading", { name: "11.0.9" })).toBeTruthy();
    expect(screen.getByText("All published release notes are shown.")).toBeTruthy();
    expect(load.mock.calls.map(([page]) => page)).toEqual([1, 2, 2]);
  });

  it("retries the initial request without showing a release outline until notes exist", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce(first);
    render(<Changelog load={load} />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("navigation", { name: "On this page" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Retry$/ }));
    await screen.findByRole("heading", { name: "12.2.0, latest release" });
    expect(document.activeElement?.id).toBe("changelog");
  });

  it("opens the legacy disclosure for an existing release anchor and keeps that reading position when more notes load", async () => {
    location.hash = "#1109";
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    render(<Changelog load={vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(older)} />);
    await screen.findByRole("heading", { name: "11.0.9" });
    const history = screen.getByText("Pilot Shell release history").parentElement as HTMLDetailsElement;
    expect(history.open).toBe(true);
    expect(scroll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Load earlier releases" }));
    await screen.findByRole("heading", { name: "8.6.2" });
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("escapes raw HTML and blocks executable links while preserving paragraphs, code, nested headings and lists", () => {
    const { container } = render(<ReleaseMarkdown notes={'Intro **bold**.\n\n## Fixed\n\n- [Read](https://example.test/release)\n- [Unsafe](javascript:alert%281%29)\n\n```sh\nqualitylayer update\n```\n\n<script>alert(1)</script>\n<!-- qualitylayer-candidate:private-marker -->'} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(screen.getByRole("link", { name: "Read" }).getAttribute("rel")).toContain("noopener");
    expect(screen.getByRole("heading", { name: "Fixed" }).tagName).toBe("H3");
    expect(container.querySelector("pre code")?.textContent).toBe("qualitylayer update");
    expect(container.textContent).not.toContain("private-marker");
  });

  it("keeps native changelog links and the pre-12.2 version anchors", () => {
    expect(CHANGELOG_URL).toBe("/docs/changelog");
    expect(releaseAnchor("12.0.0-beta.53")).toBe("1200-beta53");
    expect(publishedOn(null)).toBe("Publication date unavailable");
    const config = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(config.redirects.some((r: { source: string }) => r.source === "/docs/changelog")).toBe(false);
    expect(config.redirects.find((r: { source: string }) => r.source === "/docs/reference/changelog").destination).toBe("/docs/changelog");
  });

  it("does not claim complete history when a cached older API response has no pagination metadata", async () => {
    render(<Changelog load={vi.fn().mockResolvedValue({ notes: first.notes })} />);
    await screen.findByRole("heading", { name: "12.2.0, latest release" });
    expect(screen.queryByText("All published release notes are shown.")).toBeNull();
    expect(screen.getByRole("link", { name: "Read the complete history on GitHub" }).getAttribute("href")).toBe("https://github.com/maxritter/qualitylayer/releases");
  });
});

describe("release page reader", () => {
  it("coalesces concurrent reads, caches only success and retries a failed page", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ notes: [{ version: "7.0.0", label: "7.0.0", notes: "- Seven." }], releases: { "7.0.0": "2026-01-01T00:00:00Z" }, nextPage: null })).mockResolvedValueOnce(new Response("offline", { status: 502 })).mockResolvedValueOnce(Response.json({ notes: [], releases: {}, nextPage: null }));
    vi.stubGlobal("fetch", fetcher);
    const [a, b] = await Promise.all([loadReleasePage(7), loadReleasePage(7)]);
    expect(a).toEqual(b);
    await loadReleasePage(7);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(loadReleasePage(8)).rejects.toThrow("unavailable");
    expect(await loadReleasePage(8)).toEqual({ notes: [], nextPage: null });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("evicts older cached pages and refreshes success after five minutes", async () => {
    vi.resetModules();
    const { loadReleasePage: read } = await import("../../../docusaurus/src/components/changelog-data");
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const fetcher = vi.fn(async () => Response.json({ notes: [], releases: {}, nextPage: null }));
    vi.stubGlobal("fetch", fetcher);
    for (const page of [21, 22, 23, 24, 25]) await read(page);
    await read(25);
    expect(fetcher).toHaveBeenCalledTimes(5);
    await read(21);
    expect(fetcher).toHaveBeenCalledTimes(6);
    now.mockReturnValue(301001);
    await read(25);
    expect(fetcher).toHaveBeenCalledTimes(7);
  });
});
