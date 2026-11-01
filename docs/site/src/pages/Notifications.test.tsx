// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Notifications from "@/pages/Notifications";
import { pageMetadata } from "@/lib/seo";

type Send = (input: RequestInfo | URL, options?: RequestInit) => Promise<Response>;
let send: ReturnType<typeof vi.fn<Send>>;
beforeEach(() => {
  send = vi.fn<Send>(async () => Response.json({ off: true, email: "sam@acme.test" }));
  vi.stubGlobal("fetch", send);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function page(query = "?off=dummy-publication-test-token") {
  return render(<HelmetProvider><MemoryRouter initialEntries={[`/notifications${query}`]}><Notifications /></MemoryRouter></HelmetProvider>);
}
const button = () => screen.getByRole("button", { name: "Turn off emails" }) as HTMLButtonElement;

describe("the turn-off page behind the email footer link", () => {
  it("asks first and changes nothing until the button is pressed", () => {
    page();
    expect(screen.getByRole("heading", { name: "Turn off QualityLayer emails?" })).toBeTruthy();
    expect(screen.getByText(/at this address\. They still appear in the App, and Slack messages don't change\./)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });

  it("posts the token once, shows Turning off… while it works, then names the address and moves focus to the result", async () => {
    let complete!: (response: Response) => void;
    send.mockImplementation(() => new Promise<Response>((resolve) => { complete = resolve; }));
    page();
    fireEvent.click(button());
    const busy = screen.getByRole("button", { name: "Turning off…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBe("/api/team/email/off");
    expect(send.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(send.mock.calls[0]?.[1]?.body))).toEqual({ token: "dummy-publication-test-token" });
    complete(Response.json({ off: true, email: "sam@acme.test" }));
    const heading = await screen.findByRole("heading", { name: "Emails are off" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByRole("status").textContent).toContain("QualityLayer won't email sam@acme.test anymore. Turn them on again in the App: Settings › Notifications.");
    expect(screen.queryByRole("button", { name: /Turn off emails|Turning off/ })).toBeNull();
  });

  it("says this address when the API does not return one", async () => {
    send.mockResolvedValue(Response.json({ off: true }));
    page();
    fireEvent.click(button());
    await screen.findByRole("heading", { name: "Emails are off" });
    expect(screen.getByRole("status").textContent).toContain("QualityLayer won't email this address anymore.");
  });

  it.each([500, "throw"] as const)("keeps the button active above a clear error and lets the visitor retry (%s)", async (status) => {
    send.mockImplementationOnce(async () => { if (status === "throw") throw new Error("Mock transport unavailable"); return new Response("{}", { status }); });
    page();
    fireEvent.click(button());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("We couldn't turn email off just now. Try again in a minute, or turn it off in the App: Settings › Notifications.");
    expect(button().disabled).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(button()));
    expect(alert.compareDocumentPosition(button()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(button());
    await screen.findByRole("heading", { name: "Emails are off" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains a spent or expired link on 400 bad_token and moves focus to that heading", async () => {
    send.mockResolvedValue(Response.json({ code: "bad_token" }, { status: 400 }));
    page();
    fireEvent.click(button());
    const heading = await screen.findByRole("heading", { name: "This link no longer works" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByText("It may be older than 90 days or already used. Turn email off in the App: Settings › Notifications.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Turn off emails|Turning off/ })).toBeNull();
  });

  it("treats a link without a token as no longer working, without a request or a focus jump", () => {
    page("");
    expect(screen.getByRole("heading", { name: "This link no longer works" })).toBeTruthy();
    expect(document.activeElement).not.toBe(screen.getByRole("heading", { name: "This link no longer works" }));
    expect(send).not.toHaveBeenCalled();
  });

  it("is a private page", () => {
    expect(pageMetadata("/notifications").robots).toBe("noindex,nofollow");
  });
});
