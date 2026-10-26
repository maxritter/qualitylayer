// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Metrics } from "./App";

let root: Root;
let container: HTMLDivElement;
const calls: Record<string, unknown[][]> = {};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const name of ["va", "si"]) {
    calls[name] = [];
    vi.stubGlobal(name, (...args: unknown[]) => calls[name].push(args));
  }
  vi.spyOn(document.head, "appendChild").mockImplementation((node) => node);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function show(path: string) {
  history.replaceState({}, "", path);
  await act(async () => root.render(<BrowserRouter><Metrics /></BrowserRouter>));
}

describe("actual React SDK registrations", () => {
  it("registers the privacy callback with BOTH installed SDKs before their scripts load", async () => {
    await show("/pricing?FAKE-QUERY#FAKE-FRAGMENT");
    for (const [sdk, type] of [["va", "pageview"], ["si", "vital"]]) {
      const registration = calls[sdk].find(([action]) => action === "beforeSend");
      expect(registration, sdk).toBeDefined();
      const callback = registration![1] as (event: { type: string; url: string }) => { url: string } | null;
      expect(callback({ type, url: location.href })).toMatchObject({ url: `${location.origin}/pricing` });
      history.replaceState({}, "", "/s/FAKE-SHARE#FAKE-KEY");
      expect(callback({ type, url: `${location.origin}/pricing` })).toBeNull();
      history.replaceState({}, "", "/pricing");
    }
    expect(document.head.appendChild).toHaveBeenCalledTimes(2);
    for (const [script] of vi.mocked(document.head.appendChild).mock.calls) {
      expect((script as HTMLScriptElement).dataset.route).toBeUndefined();
    }
  });

  it.each(["/s/FAKE-SHARE#FAKE-KEY", "/billing?code=FAKE", "/checkout/success?checkout_id=FAKE", "/open/ask/FAKE/FAKE", "/invite/FAKE"])("does not initialize either SDK at %s", async (path) => {
    await show(path);
    expect(calls.va).toEqual([]);
    expect(calls.si).toEqual([]);
    expect(document.head.appendChild).not.toHaveBeenCalled();
  });

  it("keeps the registered callbacks private after the SDK components unmount on navigation", async () => {
    await show("/pricing");
    const callbacks = [calls.va, calls.si].map((items) => items.find(([action]) => action === "beforeSend")![1] as (event: { type: string; url: string }) => unknown);
    await act(async () => {
      history.pushState({}, "", "/billing?code=FAKE");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    for (const callback of callbacks) expect(callback({ type: "pageview", url: `${location.origin}/pricing` })).toBeNull();
  });
});
