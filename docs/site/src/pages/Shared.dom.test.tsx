// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoadedShare, Remark } from "@/lib/sharing/sharing";
import * as sharing from "@/lib/sharing/sharing";
import { SharedLink, SharedView } from "./Shared";
import { Asks } from "./shared/Asks";
import { EMPTY } from "@/lib/sharing/drafts";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); });
const seen = (text: string) => screen.queryAllByText(text).length > 0;
const sendButton = () => screen.getAllByRole("button", { name: "Send to Max" })[0] as HTMLButtonElement;
const state: Extract<LoadedShare, { status: "ready" }> = {
  status: "ready", kind: "v2", title: "Settings cleanup", owner: "Max", stage: "plan",
  docs: { "03-plan.md": "# The Plan\n\nOne deployment." }, items: [],
};
function addComment(text = "Why one?") {
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Gina" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Feedback" }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Add feedback" }));
}

describe("commenting on the step documents", () => {
  it("copies and downloads published Markdown, retries clipboard failure and preserves unsent forms", async () => {
    const clipboard = vi.fn().mockRejectedValueOnce(new Error("blocked")).mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:markdown");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () { expect(this.download).toBe("03-plan.md"); });
    const onSend = vi.fn(async () => ({ ok: true as const }));
    const plan = "# The Plan\n\n## Why\n\nOne deployment.\n\n## What\n\nThe page.\n\n## How\n\nIn steps.";
    render(<SharedView state={{ ...state, docs: { "03-plan.md": plan } }} onSend={onSend} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Feedback" }), { target: { value: "Unsent text" } });
    // The document is named by the On this page menu, as it is in the App.
    fireEvent.click(screen.getByRole("button", { name: "On this page" }));
    expect((await screen.findByTestId("doc-path")).textContent).toBe("03-plan.md");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    const copyMarkdown = async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy document" }));
      fireEvent.click(await screen.findByRole("menuitem", { name: /^Copy as Markdown/ }));
    };
    await copyMarkdown();
    await screen.findByText("Copy failed: select the text instead");
    const fallback = await screen.findByRole("dialog", { name: "Copy unavailable" });
    const text = within(fallback).getByRole("textbox", { name: "Text to copy" }) as HTMLTextAreaElement;
    expect(text.readOnly).toBe(true);
    expect(text.value).toBe(plan);
    fireEvent.click(within(fallback).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Copy unavailable" })).toBeNull());
    await copyMarkdown();
    await screen.findByText("Copied as Markdown. Paste it into your page.");
    expect(clipboard.mock.calls).toEqual([[plan], [plan]]);
    fireEvent.click(screen.getByRole("button", { name: "Download Markdown" }));
    expect(await (create.mock.calls[0][0] as Blob).text()).toBe(plan);
    expect(click).toHaveBeenCalledOnce();
    await screen.findByText("Markdown download started.");
    expect((screen.getByRole("textbox", { name: "Feedback" }) as HTMLTextAreaElement).value).toBe("Unsent text");
    expect(onSend).not.toHaveBeenCalled();
  });
  it("keeps receipts on their own link and ignores malformed saved replies", async () => {
    const id = "abcdefghijklmnopqrstuv";
    localStorage.setItem(`qualitylayer-share-receipts:${id}`, JSON.stringify([{ key: "a", annotation: "a", label: "Summary", text: "My private receipt", replies: [{ text: "Malformed" }] }]));
    const onSend = vi.fn(async () => ({ ok: true as const }));
    const view = render(<SharedView state={{ ...state, id }} onSend={onSend} />);
    expect(await screen.findByText(/My private receipt/)).toBeTruthy();
    view.rerender(<SharedView state={{ ...state, id: "another-share-link-id" }} onSend={onSend} />);
    expect(screen.queryByText(/My private receipt/)).toBeNull();
    expect(localStorage.getItem("qualitylayer-share-receipts:another-share-link-id")).not.toContain("My private receipt");
  });
  it("keeps a receipt across reload and shows the owner's live reply and resolution", async () => {
    const share = { ...state, id: "abcdefghijklmnopqrstuv" };
    let annotation = "";
    const onSend = vi.fn(async (_author: string, remarks: Remark[]) => {
      const r = remarks[0];
      if (r.kind === "passage") annotation = r.id ?? "";
      return { ok: true as const };
    });
    const view = render(<SharedView state={share} onSend={onSend} />);
    addComment("Please check this passage");
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(annotation).not.toBe("");
    view.unmount();
    render(<SharedView state={{ ...share, threads: [{ remoteId: `0:${annotation}`, created: 1, doc: "03-plan.md", state: "resolved", replies: [{ id: "r1", author: { name: "Agent", email: "" }, text: "Added the check", at: 2, via: "agent" }] }] }} onSend={onSend} />);
    expect(await screen.findByText(/Added the check/)).toBeTruthy();
    expect(screen.getByText("Resolved")).toBeTruthy();
    expect(screen.getByText(/via agent/)).toBeTruthy();
  });
  it("names the owner's question group Your turn and keeps the owner's name", () => {
    const onAnswer = vi.fn();
    render(<Asks owner="Max" docs={state.docs} items={[{ id: "d1", family: "decide", kind: "decision", kindLabel: "Engineering decision", what: "Keep one deployment?", options: ["agree", "change"], step: "plan" }]} drafts={EMPTY} settled={{}} onAnswer={onAnswer} />);
    expect(screen.getByRole("heading", { name: "Your turn · Max asks you" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Agree" }));
    expect(onAnswer).toHaveBeenCalledWith("d1", "agree", "");
  });

  it("files the comment on its own step document, without an approval vote", async () => {
    const onSend = vi.fn(async (_author: string, _remarks: Remark[]) => ({ ok: true as const }));
    render(<SharedView state={state} onSend={onSend} />);
    expect(sendButton().disabled).toBe(true);
    addComment();
    expect(seen("1 feedback message")).toBe(true);
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0]).toEqual(["Gina", [{ kind: "passage", id: expect.any(String), doc: "03-plan.md", quote: "", text: "Why one?" }]]);
    expect(JSON.stringify(onSend.mock.calls)).not.toMatch(/verdict|approve|request_changes/);
    expect(seen("Sent to Max.")).toBe(true);
  });

  it("keeps unsent comments for another try when the owner cannot be reached", async () => {
    render(<SharedView state={state} onSend={async () => ({ ok: false, reason: "network" })} />);
    addComment();
    fireEvent.click(sendButton());
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("could not be sent");
    expect(seen("1 feedback message")).toBe(true);
    expect(seen("Sent to Max.")).toBe(false);
  });
});

describe("keeping an open link current", () => {
  it("refreshes without losing comments, keeps the page through an outage, and hides a revoked link", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const load = vi.spyOn(sharing, "readShareUpdate").mockResolvedValue({ kind: "loaded", state, rev: 1 });
    await act(async () => { render(<SharedLink id={"A".repeat(22)} linkKey={"B".repeat(43)} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    addComment();
    load.mockResolvedValue({ kind: "loaded", state: { ...state, docs: { "03-plan.md": "# Latest Plan\n\nThe Plan changed." } }, rev: 2 });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(seen("The Plan changed.")).toBe(true);
    expect(seen("1 feedback message")).toBe(true);
    load.mockResolvedValue({ kind: "retry", message: "Temporary outage" });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(seen("The Plan changed.")).toBe(true);
    expect(seen("1 feedback message")).toBe(true);
    expect(seen("Updates could not be received. Showing the last version until the connection returns.")).toBe(true);
    load.mockResolvedValue({ kind: "loaded", state: { status: "gone" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(seen("The Plan changed.")).toBe(false);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("makes no background reads while hidden and clears its timer on unmount", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const load = vi.spyOn(sharing, "readShareUpdate").mockResolvedValue({ kind: "loaded", state, rev: 1 });
    const view = render(<SharedLink id={"A".repeat(22)} linkKey={"B".repeat(43)} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(load).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    await act(async () => {
      fireEvent(document, new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(load).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
