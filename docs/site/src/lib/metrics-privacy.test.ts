import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createMetricsFilter } from "./metrics-privacy.js";
import { PUBLIC_PAGES } from "./seo";

afterEach(() => vi.unstubAllGlobals());

const filter = createMetricsFilter(Object.keys(PUBLIC_PAGES));
const at = (path: string, referrer = "") => {
  vi.stubGlobal("location", new URL(path, "https://qualitylayer.dev"));
  vi.stubGlobal("document", { referrer });
};

describe.each(["pageview", "vital"])("%s URL privacy", (type) => {
  it.each(["/", "/pricing", "/download", "/compare/cline"])("keeps only the public origin and pathname for %s", (path) => {
    at(`${path}?checkout_id=FAKE-QUERY#FAKE-FRAGMENT`);
    const input = { type, url: location.href };
    expect(filter(input)).toEqual({ ...input, url: `https://qualitylayer.dev${path}` });
    expect(input.url).toContain("FAKE-QUERY");
  });

  it.each(["/s/FAKE-SHARE#FAKE-KEY", "/shared", "/billing?code=FAKE-CODE", "/checkout/success?checkout_id=FAKE-ID", "/open/ask/FAKE-TASK/FAKE-ASK", "/invite/FAKE-TOKEN", "/unknown/FAKE-TOKEN"])("drops %s before a request", (path) => {
    at(path);
    expect(filter({ type, url: location.href })).toBeNull();
  });

  it("checks both the current page and a delayed event after navigation", () => {
    at("/pricing");
    const delayedPrivate = { type, url: "https://qualitylayer.dev/s/FAKE-SHARE#FAKE-KEY" };
    expect(filter(delayedPrivate)).toBeNull();
    const publicEvent = { type, url: location.href };
    at("/billing?code=FAKE-CODE");
    expect(filter(publicEvent)).toBeNull();
    at("/download");
    expect(filter(publicEvent)?.url).toBe("https://qualitylayer.dev/pricing");
  });

  it.each(["https://foreign.invalid/pricing", "https://user:FAKE-PASSWORD@qualitylayer.dev/pricing", "javascript:FAKE", "https://["])("fails closed for %s", (url) => {
    at("/pricing");
    expect(filter({ type, url })).toBeNull();
  });

  it.each(["https://source.invalid/?FAKE-QUERY", "https://source.invalid/#FAKE-FRAGMENT", "https://source.invalid/FAKE-PRIVATE-PATH", "https://qualitylayer.dev/billing?code=FAKE-CODE", "https://qualitylayer.dev/s/FAKE-ID", "https://qualitylayer.dev/billing", "https://qualitylayer.dev/open/ask/FAKE-ID/FAKE-ASK", "https://user:FAKE-PASSWORD@source.invalid/"])("drops an unsafe SDK JSON referrer: %s", (referrer) => {
    at("/pricing", referrer);
    expect(filter({ type, url: location.href })).toBeNull();
  });

  it("accepts origin-only and ordinary same-origin public referrers", () => {
    for (const referrer of ["https://source.invalid/", "https://qualitylayer.dev/download"]) {
      at("/pricing", referrer);
      expect(filter({ type, url: location.href })?.url).toBe("https://qualitylayer.dev/pricing");
    }
  });
});

it("does not enable custom payload collection", () => {
  at("/pricing");
  expect(filter({ type: "event", url: location.href, payload: { email: "FAKE@example.invalid" } })).toBeNull();
});

it("uses origin-only HTTP referrers and preserves stronger private-page overrides", () => {
  const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
  const policy = (source: string) => config.headers.find((entry: { source: string }) => entry.source === source)
    .headers.find((header: { key: string }) => header.key === "Referrer-Policy").value;
  expect(policy("/(.*)")).toBe("strict-origin");
  expect(policy("/open/(.*)")).toBe("no-referrer");
  expect(policy("/s-frame.html")).toBe("no-referrer");
});
