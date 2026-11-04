// @vitest-environment happy-dom
// A shared step document is drawn by the App's own Reader (StepDocument), so it looks the same here,
// in the App's step page and in its Files tab: On this page, Copy, diagrams, comments on passages.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadMermaidFrom } from "@ql/ui/reader/MermaidBlock";
import type { LoadedShare, Remark } from "@/lib/sharing/sharing";
import { withoutShownMockups } from "@/lib/sharing/plan";
import { SharedDocument } from "./shared/SharedDocument";
import { SharedView } from "./Shared";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

const DOC = "# The Plan\n\n## Why\n\nBecause one deployment is enough.\n\n## What\n\nThe settings page.\n\n## How\n\nIn two steps.\n";
const ready = (docs: Record<string, string>): Extract<LoadedShare, { status: "ready" }> => ({
  status: "ready", kind: "v2", title: "Settings cleanup", owner: "Max", stage: "plan", docs, items: [],
});
const noSend = async () => ({ ok: true as const });
const popover = () => within(document.body);

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
    fireEvent.click(within(fallback).getByRole("button", { name: "Close", exact: true }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Copy unavailable" })).toBeNull());
    await copy();
    await popover().findByText("Copied as Markdown. Paste it into your page.");
    expect(write.mock.calls.map((call) => String(call[0]).trim())).toEqual([DOC.trim(), DOC.trim()]);
  });

  it("a diagram in the document is drawn by Mermaid, in the page's theme, only when it is there", async () => {
    const render_ = vi.fn(async (_id: string, _source: string) => ({ svg: '<svg role="img" aria-label="drawn"><text>A to B</text></svg>' }));
    const load = vi.fn(async () => ({ default: { initialize: vi.fn(), render: render_ } }) as never);
    loadMermaidFrom(load);
    render(<SharedDocument name="03-plan.md" markdown={"# Plan\n\nBefore.\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nAfter."} docs={{}} comments={[]} onQuote={() => {}} />);
    expect(await screen.findByLabelText("drawn")).toBeTruthy();
    expect(render_.mock.calls[0]?.[1]).toContain("A --> B");
    expect(load).toHaveBeenCalledTimes(1);
    cleanup();
    load.mockClear();
    render(<SharedDocument name="03-plan.md" markdown="# Plan\n\nNo diagram." docs={{}} comments={[]} onQuote={() => {}} />);
    expect(load).not.toHaveBeenCalled();
  });

  it("a change map in the document is drawn by the App's component, with no action for the owner's checkout", () => {
    const map = JSON.stringify({ title: "T", parts: [{ id: "app", name: "App", kind: "ui" }], cards: [{ id: "proof", path: "src/ui/Proof.tsx", name: "Proof lanes", part: "app", change: "changed", today: "a", after: "b" }], links: [] });
    render(<SharedDocument name="03-plan.md" markdown={`# Plan\n\nBefore.\n\n\`\`\`ql-map\n${map}\n\`\`\`\n\nAfter.`} docs={{}} comments={[]} onQuote={() => {}} />);
    expect(screen.getByTestId("change-map")).toBeTruthy();
    expect(screen.getByText("Proof lanes")).toBeTruthy();
    expect(screen.queryByText(/open file/i)).toBeNull();
  });

  it("a Mermaid flowchart of code files is drawn as a map, with the Mermaid one click away and Mermaid loaded only then", async () => {
    const render_ = vi.fn(async (_id: string, _source: string) => ({ svg: '<svg role="img" aria-label="drawn"><text>A to B</text></svg>' }));
    const load = vi.fn(async () => ({ default: { initialize: vi.fn(), render: render_ } }) as never);
    loadMermaidFrom(load);
    const code = 'flowchart LR\n  a["Handler<br/>src/server/serve.ts"] -->|sends| b["View<br/>src/web/view.ts"]\n  b --> c["Sort<br/>src/domain/tasks.ts"]\n  a --> d["Browser"]';
    render(<SharedDocument name="01-research.md" markdown={`# Research\n\nBefore.\n\n\`\`\`mermaid\n${code}\n\`\`\`\n\nAfter.`} docs={{}} comments={[]} onQuote={() => {}} />);
    expect(screen.getByTestId("change-map")).toBeTruthy();
    expect(screen.getByText("Handler")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Today/ })).toBeNull();
    expect(screen.queryByText(/open file/i)).toBeNull();
    expect(load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Show as Mermaid" }));
    expect(await screen.findByLabelText("drawn")).toBeTruthy();
    expect(render_.mock.calls[0]?.[1]).toBe(code);
    fireEvent.click(screen.getByRole("button", { name: "Show as map" }));
    expect(screen.getByTestId("change-map")).toBeTruthy();
  });

  it("a mockup the link carries is shown, and one it does not carry says so", async () => {
    const docs = { "artifacts/settings.html": "<html><body>Settings</body></html>" };
    const doc = (path: string) => `# Plan\n\n\`\`\`artifact\n${path}\n\`\`\`\n`;
    const { rerender } = render(<SharedDocument name="03-plan.md" markdown={doc("artifacts/settings.html")} docs={docs} comments={[]} onQuote={() => {}} />);
    const preview = await screen.findByTestId("artifact-preview");
    await waitFor(() => expect(preview.querySelector("iframe")).not.toBeNull());
    rerender(<SharedDocument name="03-plan.md" markdown={doc("artifacts/gone.html")} docs={docs} comments={[]} onQuote={() => {}} />);
    expect(await screen.findByText("The mockup is not part of this link. Ask for a new link to see it.")).toBeTruthy();
  });

  it("leaves out the mockups a question already shows, so none is drawn twice", () => {
    const md = "# Plan\n\n```artifact\nartifacts/settings.html\n```\n\nKept.\n\n```artifact\nartifacts/other.html\n```\n";
    const out = withoutShownMockups(md, new Set(["settings.html"]));
    expect(out).not.toContain("settings.html");
    expect(out).toContain("artifacts/other.html");
    expect(out).toContain("Kept.");
    expect(withoutShownMockups(md, new Set())).toBe(md);
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
