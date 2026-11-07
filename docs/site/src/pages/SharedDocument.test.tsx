// @vitest-environment happy-dom
// A shared step document is drawn by the App's own Reader (StepDocument), so it looks the same here,
// in the App's step page and in its Files tab: On this page, Copy, diagrams, comments on passages.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadMermaidFrom } from "@ql/ui/reader/MermaidBlock";
import type { LoadedShare, Remark } from "@/lib/sharing/sharing";
import { SharedView } from "./Shared";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

const DOC = "# The Plan\n\n## Why\n\nBecause one deployment is enough.\n\n## What\n\nThe settings page.\n\n## How\n\nIn two steps.\n";
const ready = (docs: Record<string, string>): Extract<LoadedShare, { status: "ready" }> => ({
  status: "ready", kind: "v2", title: "Settings cleanup", owner: "Max", stage: "plan", docs, items: [],
});
const noSend = async () => ({ ok: true as const });
const popover = () => within(document.body);
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";

describe("the share page draws a document with the App's Reader", () => {
  it("has the On this page button and the Copy menu at the top of each document", () => {
    render(<SharedView state={ready({ "03-plan.md": DOC })} onSend={noSend} />);
    expect(screen.getByTestId("step-document")).toBeTruthy();
    expect(screen.getByTestId("doc-reader")).toBeTruthy();
    expect(screen.getByRole("button", { name: "On this page" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy document" })).toBeTruthy();
  });

  it("On this page names the document's path and its headings, and a heading jumps there", async () => {
    render(<SharedView state={ready({ "03-plan.md": DOC })} onSend={noSend} />);
    fireEvent.click(screen.getByRole("button", { name: "On this page" }));
    expect((await popover().findByTestId("doc-path")).textContent).toBe("03-plan.md");
    const scroll = await popover().findByTestId("outline-scroll");
    for (const heading of ["Why", "What", "How"]) expect(within(scroll).getByText(heading)).toBeTruthy();
  });

  it("a document with fewer than three sections has Copy but no On this page", () => {
    render(<SharedView state={ready({ "03-plan.md": "# Plan\n\nOne deployment." })} onSend={noSend} />);
    expect(screen.getByRole("button", { name: "Copy document" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "On this page" })).toBeNull();
  });

  it("Copy offers the document as Markdown, says so, and says when the browser refuses", async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error("blocked")).mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: write } });
    render(<SharedView state={ready({ "03-plan.md": DOC })} onSend={noSend} />);
    const copy = async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy document" }));
      fireEvent.click(await popover().findByRole("menuitem", { name: /^Copy as Markdown/ }));
    };
    await copy();
    await popover().findByText("Copy failed: select the text instead");
    const fallback = await screen.findByRole("dialog", { name: "Copy unavailable" });
    const text = within(fallback).getByRole("textbox", { name: "Text to copy" }) as HTMLTextAreaElement;
    expect(text.readOnly).toBe(true);
    expect(text.value).toBe(DOC.trim());
    fireEvent.click(within(fallback).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Copy unavailable" })).toBeNull());
    await copy();
    await popover().findByText("Copied as Markdown. Paste it into your page.");
    expect(write.mock.calls.map((call) => String(call[0]).trim())).toEqual([DOC.trim(), DOC.trim()]);
  });

  it("a diagram in the document is drawn by Mermaid, in the page's theme, only when it is there", async () => {
    const render_ = vi.fn(async (_id: string, _source: string) => ({ svg: '<svg role="img" aria-label="drawn"><text>A to B</text></svg>' }));
    const load = vi.fn(async () => ({ default: { initialize: vi.fn(), render: render_ } }) as never);
    loadMermaidFrom(load);
    render(<SharedView state={ready({ "03-plan.md": "# Plan\n\nBefore.\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nAfter." })} onSend={noSend} />);
    expect(await screen.findByLabelText("drawn")).toBeTruthy();
    expect(render_.mock.calls[0]?.[1]).toContain("A --> B");
    expect(load).toHaveBeenCalledTimes(1);
    cleanup();
    load.mockClear();
    render(<SharedView state={ready({ "03-plan.md": "# Plan\n\nNo diagram." })} onSend={noSend} />);
    expect(load).not.toHaveBeenCalled();
  });

  it("a mockup the link carries is shown, and one it does not carry says so", async () => {
    const doc = (path: string) => `# Plan\n\n\`\`\`artifact\n${path}\n\`\`\`\n`;
    const { rerender } = render(<SharedView state={ready({ "03-plan.md": doc("artifacts/settings.html"), "plan-artifact.png": png })} onSend={noSend} />);
    expect(await screen.findByRole("img", { name: "Plan artifact" })).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
    rerender(<SharedView state={ready({ "03-plan.md": doc("artifacts/gone.html") })} onSend={noSend} />);
    expect(await screen.findByText("This picture is not included in this link.")).toBeTruthy();
  });

  it("draws a referenced still once through the App Reader", () => {
    render(<SharedView state={ready({ "03-plan.md": "# Plan\n\n```artifact\nartifacts/settings.html\n```\n\nKept.", "plan-artifact.png": png })} onSend={noSend} />);
    expect(screen.getAllByRole("img", { name: "Plan artifact" })).toHaveLength(1);
    expect(screen.getByText("Kept.")).toBeTruthy();
  });

  it("a same-link poll replaces a same-named mockup and removes it when the new share omits it", async () => {
    const markdown = "# Plan\n\n```artifact\nartifacts/settings.html\n```\n";
    const second = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==";
    const { rerender } = render(<SharedView state={ready({ "03-plan.md": markdown, "plan-artifact.png": png })} onSend={noSend} />);
    expect((await screen.findByRole("img", { name: "Plan artifact" })).getAttribute("src")).toBe(png);
    rerender(<SharedView state={ready({ "03-plan.md": markdown, "plan-artifact.png": second })} onSend={noSend} />);
    await waitFor(() => expect(screen.getByRole("img", { name: "Plan artifact" }).getAttribute("src")).toBe(second));
    rerender(<SharedView state={ready({ "03-plan.md": markdown })} onSend={noSend} />);
    expect(await screen.findByText("This picture is not included in this link.")).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Plan artifact" })).toBeNull();
  });
});

describe("comments on a passage of the document", () => {
  it("the + beside a block quotes it, the comment is marked in the document and goes out against its document", async () => {
    const onSend = vi.fn(async (_author: string, _remarks: Remark[]) => ({ ok: true as const }));
    render(<SharedView state={ready({ "03-plan.md": DOC })} onSend={onSend} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Give feedback on this block" })[2] as HTMLElement);
    expect(screen.getByText(/Because one deployment is enough\./, { selector: "blockquote" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Gina" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Feedback" }), { target: { value: "Why one?" } });
    fireEvent.click(screen.getByRole("button", { name: "Add feedback" }));
    // Under the passage it is about, as the App shows a comment.
    const inline = await screen.findByTestId("inline-comment");
    expect(inline.textContent).toContain("Why one?");
    expect(inline.closest("[data-testid=block]")?.textContent).toContain("Because one deployment is enough.");
    fireEvent.click(screen.getAllByRole("button", { name: "Send to Max" })[0] as HTMLElement);
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0]).toEqual(["Gina", [{ kind: "passage", id: expect.any(String), doc: "03-plan.md", quote: "Because one deployment is enough.", text: "Why one?" }]]);
    // Sent, it stays under its passage and is listed as sent.
    expect(await screen.findByText("Sent to Max.")).toBeTruthy();
    expect(screen.getAllByTestId("inline-comment")).toHaveLength(1);
  });

  it("a comment is filed under the document of the passage it quotes", async () => {
    const docs = { "03-plan.md": "# Plan\n\nPlan words here." };
    const onSend = vi.fn(async (_author: string, _remarks: Remark[]) => ({ ok: true as const }));
    render(<SharedView state={ready(docs)} onSend={onSend} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Give feedback on this block" })[1] as HTMLElement);
    fireEvent.change(screen.getByRole("textbox", { name: "Feedback" }), { target: { value: "Check" } });
    fireEvent.click(screen.getByRole("button", { name: "Add feedback" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Send to Max" })[0] as HTMLElement);
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0]?.[1][0]).toMatchObject({ kind: "passage", doc: "03-plan.md", quote: "Plan words here." });
  });

  it("keeps a sent comment under its passage after a reload", async () => {
    const id = "abcdefghijklmnopqrstuv";
    localStorage.setItem(`qualitylayer-share-receipts:${id}`, JSON.stringify([{ key: "k", annotation: "k", doc: "03-plan.md", quote: "The settings page.", label: "“The settings page.”", text: "Which one?", replies: [] }]));
    render(<SharedView state={{ ...ready({ "03-plan.md": DOC }), id }} onSend={noSend} />);
    expect((await screen.findByTestId("inline-comment")).textContent).toContain("Which one?");
  });
});
