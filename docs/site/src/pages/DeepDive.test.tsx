// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeepDive from "@/pages/DeepDive";
import { NEWSLETTER_CONSENT_TEXT } from "@/lib/deep-dive";

type Send = (input: RequestInfo | URL, options?: RequestInit) => Promise<Response>;
let send: ReturnType<typeof vi.fn<Send>>;
beforeEach(() => {
  send = vi.fn<Send>(async () => new Response("{}", { status: 202 }));
  vi.stubGlobal("fetch", send);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function page(query = "") {
  return render(<HelmetProvider><MemoryRouter initialEntries={[`/inside${query}`]}><DeepDive /></MemoryRouter></HelmetProvider>);
}
function fill() {
  const email = screen.getByRole("textbox", { name: "Email" }) as HTMLInputElement;
  fireEvent.change(email, { target: { value: "ada@example.test" } });
  fireEvent.click(screen.getByRole("checkbox", { name: NEWSLETTER_CONSENT_TEXT }));
  return email;
}

describe("the real DeepDive form", () => {
  it("submits one consent request, prevents a duplicate while pending, then focuses confirmation and a fresh address", async () => {
    let complete!: (response: Response) => void;
    send.mockImplementation(() => new Promise<Response>((resolve) => { complete = resolve; }));
    page();
    const email = fill();
    fireEvent.submit(email.closest("form")!);
    expect((screen.getByRole("button", { name: "Sending…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(email.readOnly || email.disabled).toBe(true);
    fireEvent.submit(email.closest("form")!);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBe("/api/newsletter");
    expect(JSON.parse(String(send.mock.calls[0]?.[1]?.body))).toEqual({ email: "ada@example.test", consent: true, source: "deep-dive" });
    complete(new Response("{}", { status: 202 }));
    const heading = await screen.findByRole("heading", { name: "Check your inbox" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    fireEvent.click(screen.getByRole("button", { name: "use another address" }));
    const next = await screen.findByRole("textbox", { name: "Email" }) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(next));
    expect(next.value).toBe("");
    expect((screen.getByRole("checkbox", { name: NEWSLETTER_CONSENT_TEXT }) as HTMLInputElement).checked).toBe(false);
  });

  it.each([400, 500, "throw"] as const)("retains entered consent and makes a failed request retryable (%s)", async (status) => {
    send.mockImplementation(async () => { if (status === "throw") throw new Error("Mock transport unavailable"); return new Response("{}", { status }); });
    page("?link=expired");
    const email = fill();
    fireEvent.submit(email.closest("form")!);
    expect((await screen.findByRole("alert")).textContent).toContain(status === 400 ? "Check the address" : status === "throw" ? "Mock transport unavailable" : "couldn't send");
    expect(email.value).toBe("ada@example.test");
    expect((screen.getByRole("checkbox", { name: NEWSLETTER_CONSENT_TEXT }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("button", { name: "Send me the video" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/That confirmation link has expired/)).toBeNull();
    send.mockResolvedValue(new Response("{}", { status: 202 }));
    fireEvent.submit(email.closest("form")!);
    await screen.findByRole("heading", { name: "Check your inbox" });
  });

  it.each([["expired", "That confirmation link has expired"], ["failed", "We couldn't confirm your address"]])("shows the existing %s recovery state without making a request", (state, copy) => {
    page(`?link=${state}`);
    expect(screen.getByRole("status").textContent).toContain(copy);
    expect(send).not.toHaveBeenCalled();
  });

  it("shows confirmation without submitting again and loads the trailer only after a click", () => {
    const view = page("?confirmed=1");
    expect(screen.getByRole("heading", { name: "The video is on its way" })).toBeTruthy();
    expect(view.container.querySelector("video")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Play the trailer/ }));
    const video = view.container.querySelector("video")!;
    expect(video.hasAttribute("controls")).toBe(true);
    expect(video.hasAttribute("autoplay")).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("the real DeepDive unsubscribe state", () => {
  it("does nothing on open, posts only after the button, and keeps provider failure retryable", async () => {
    send.mockResolvedValueOnce(new Response("{}", { status: 500 })).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    page("?unsubscribe=dummy-publication-test-token");
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("heading", { name: "You're unsubscribed" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
    await screen.findByRole("heading", { name: "You're unsubscribed" });
    expect(send).toHaveBeenCalledTimes(2);
    for (const [path, options] of send.mock.calls) {
      expect(path).toBe("/api/newsletter/unsubscribe");
      expect(options?.method).toBe("POST");
      expect(JSON.parse(String(options?.body))).toEqual({ token: "dummy-publication-test-token" });
    }
  });
});
