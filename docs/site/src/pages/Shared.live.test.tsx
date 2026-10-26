// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedShare } from "@/lib/sharing/sharing";
import { SharedLink } from "./Shared";

vi.mock("@/lib/sharing/sharing", async (original) => {
  const actual = await original<typeof import("@/lib/sharing/sharing")>();
  return { ...actual, loadShare: vi.fn(async () => ready()), readShareUpdate: vi.fn() };
});
import { readShareUpdate } from "@/lib/sharing/sharing";

const ready = (title = "ql-verify-before"): Extract<LoadedShare, { status: "ready" }> => ({
  status: "ready", kind: "v2", title, docs: { "03-plan.md": `# ${title}` }, items: [],
});
const loaded = (rev: number, state = ready()) => ({ kind: "loaded", rev, state });
const flush = async (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(readShareUpdate).mockReset();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("an open share follows its owner", () => {
  it("bounds missed revision bumps with a full look, without exposing the key to the loader's URL", async () => {
    vi.mocked(readShareUpdate).mockResolvedValueOnce(loaded(7) as never).mockResolvedValue({ kind: "unchanged" } as never);
    render(<SharedLink id={"A".repeat(22)} linkKey={"B".repeat(43)} />);
    await flush();
    await flush(30_000);
    expect(vi.mocked(readShareUpdate).mock.calls[1]?.[2]).toBe(7);
    await flush(870_000);
    expect(vi.mocked(readShareUpdate).mock.calls[30]?.[2]).toBeUndefined();
  });

  it("does not overlap a slow request, times it out, and backs off before trying again", async () => {
    vi.mocked(readShareUpdate).mockImplementationOnce(async (_id, _key, _since, _fetch, signal) => new Promise((resolve) => {
      signal?.addEventListener("abort", () => resolve({ kind: "retry", message: "timed out" }), { once: true });
    }));
    vi.mocked(readShareUpdate).mockResolvedValue(loaded(2) as never);
    render(<SharedLink id={"A".repeat(22)} linkKey={"B".repeat(43)} />);
    await flush(44_999);
    expect(readShareUpdate).toHaveBeenCalledTimes(1);
    await flush(1);
    expect(readShareUpdate).toHaveBeenCalledTimes(2);
  });

  it("updates the seven steps and Plan still without remounting the guest's draft", async () => {
    vi.mocked(readShareUpdate).mockResolvedValueOnce(loaded(1) as never);
    const { unmount } = render(<SharedLink id={"A".repeat(22)} linkKey={"B".repeat(43)} />);
    await flush();
    fireEvent.change(screen.getByRole("textbox", { name: "Feedback" }), { target: { value: "ql-verify-draft" } });
    const docs = Object.fromEntries(["01-discuss.md", "02-research.md", "03-plan.md", "04-outline.md", "05-implement.md", "06-verify.md", "07-review.md"].map((name) => [name, `# ql-verify-latest-${name}`]));
    docs["plan-artifact.png"] = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ1sAAAAASUVORK5CYII=";
    vi.mocked(readShareUpdate).mockResolvedValueOnce(loaded(2, { ...ready("ql-verify-after"), docs, stills: { "artifacts/settings.html": { title: "ql-verify-settings", image: "data:image/png;base64,iVBORw0KGgo=" } } } as never) as never);
    await flush(30_000);
    expect(screen.getAllByText("ql-verify-after").length).toBeGreaterThan(0);
    expect((screen.getByRole("textbox", { name: "Feedback" }) as HTMLTextAreaElement).value).toBe("ql-verify-draft");
    fireEvent.mouseDown(screen.getByRole("tab", { name: /^Artifacts/ }), { button: 0, ctrlKey: false });
    fireEvent.change(screen.getByRole("combobox", { name: /^Artboard/ }), { target: { value: "plan-artifact.png" } });
    expect((screen.getByRole("img", { name: "Plan artifact" }) as HTMLImageElement).src).toBe("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ1sAAAAASUVORK5CYII=");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Workflow", exact: true }), { button: 0, ctrlKey: false });
    for (const step of ["Discuss", "Research", "Plan", "Outline", "Implement", "Verify", "Review"]) expect(screen.getByRole("button", { name: step })).toBeTruthy();
    unmount();
    await flush(300_000);
    expect(readShareUpdate).toHaveBeenCalledTimes(2);
  });

  it("pauses hidden tabs, resumes visible ones, and respects Retry-After across visibility changes", async () => {
    vi.mocked(readShareUpdate).mockResolvedValue(loaded(1) as never);
    render(<SharedLink id={"A".repeat(22)} linkKey={"B".repeat(43)} />);
    await flush();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await flush(120_000);
    expect(readShareUpdate).toHaveBeenCalledTimes(1);
    vi.mocked(readShareUpdate).mockResolvedValueOnce({ kind: "retry", retryAfter: 120_000, message: "busy" } as never);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await flush();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await flush(119_999);
    expect(readShareUpdate).toHaveBeenCalledTimes(2);
    await flush(1);
    expect(readShareUpdate).toHaveBeenCalledTimes(3);
  });

  it("backs off failures, keeps the last page and draft, and clears a revoked link", async () => {
    vi.mocked(readShareUpdate).mockResolvedValueOnce(loaded(1) as never);
    render(<SharedLink id={"A".repeat(22)} linkKey={"B".repeat(43)} />);
    await flush();
    fireEvent.change(screen.getByRole("textbox", { name: "Feedback" }), { target: { value: "ql-verify-kept" } });
    vi.mocked(readShareUpdate).mockResolvedValue({ kind: "retry", message: "offline" } as never);
    await flush(30_000);
    await flush(30_000);
    await flush(59_999);
    expect(readShareUpdate).toHaveBeenCalledTimes(3);
    expect((screen.getByRole("textbox", { name: "Feedback" }) as HTMLTextAreaElement).value).toBe("ql-verify-kept");
    vi.mocked(readShareUpdate).mockResolvedValueOnce({ kind: "loaded", state: { status: "gone" } } as never);
    await flush(1);
    expect(screen.getByText("This task is no longer shared")).toBeTruthy();
    await flush(300_000);
    expect(readShareUpdate).toHaveBeenCalledTimes(4);
  });
});
