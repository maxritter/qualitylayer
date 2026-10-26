// @vitest-environment happy-dom
// The page is drawn in a DOM: the Reader sanitises with the page's own, and the page is client-rendered only.
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type LoadedShare, linkKeyOf, loadShare, openFromLink, sealForLink } from "@/lib/sharing/sharing";
import { SharedView } from "./Shared";

const ID = "A".repeat(22);
const KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const DOCS = { "01-discuss.md": "# Task\n\nThe problem.", "03-plan.md": "# Plan\n\nOne deployment." };
const answer = (status: number, body?: unknown) => vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status })) as unknown as typeof fetch;
const sealed = async (plan: Record<string, unknown>, expires?: string, key = KEY) => answer(200, { ...(await sealForLink(key, "plan", JSON.stringify(plan))), ...(expires ? { expires } : {}) });
async function html(node: React.ReactNode) { const view = render(node); const drawn = view.container.innerHTML; view.unmount(); return drawn; }
const ready = (docs: Record<string, string> = DOCS): Extract<LoadedShare, { kind: "v2" }> => ({ status: "ready", kind: "v2", title: "A shared task", docs, items: [], owner: "Max" });
const noSend = async () => ({ ok: true as const });

describe("opening encrypted links", () => {
  it("opens a link with its expiry and fetches only the link id", async () => {
    const fetcher = await sealed({ task: "A shared task", docs: DOCS }, "2026-10-14T10:00:00.000Z");
    expect(await loadShare(ID, KEY, fetcher)).toEqual({ status: "ready", kind: "v2", id: ID, title: "A shared task", docs: DOCS, items: [], threads: [], expires: "2026-10-14T10:00:00.000Z" });
    expect(fetcher).toHaveBeenCalledWith(`/api/share?id=${ID}`);
  });
  it("a keyless or malformed link never asks the service", async () => {
    const fetcher = answer(200, {});
    expect(await loadShare(ID, "", fetcher)).toEqual({ status: "no-key" });
    expect(await loadShare("short", KEY, fetcher)).toMatchObject({ status: "error" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(linkKeyOf(`#${KEY}`)).toBe(KEY);
    expect(linkKeyOf("#short")).toBe("");
  });
  it("rejects a different key, plaintext data and a seal made for feedback", async () => {
    expect(await loadShare(ID, KEY, await sealed({ docs: DOCS }, undefined, "B".repeat(43)))).toMatchObject({ status: "error" });
    expect(await loadShare(ID, KEY, answer(200, { v: 2, docs: DOCS }))).toMatchObject({ status: "error" });
    const feedback = await sealForLink(KEY, "feedback", JSON.stringify({ docs: DOCS }));
    expect(await openFromLink(KEY, "plan", feedback)).toBeNull();
    expect(await loadShare(ID, KEY, answer(200, feedback))).toMatchObject({ status: "error" });
  });
  it("distinguishes gone, damaged and unreachable links", async () => {
    expect(await loadShare(ID, KEY, answer(404))).toEqual({ status: "gone" });
    expect(await loadShare(ID, KEY, answer(500))).toMatchObject({ status: "error" });
    expect(await loadShare(ID, KEY, answer(200, {}))).toMatchObject({ status: "error" });
    expect(await loadShare(ID, KEY, vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toMatchObject({ status: "error" });
  });
  it("payloads lose code and every copy outside the step documents", async () => {
    const loaded = await loadShare(ID, KEY, await sealed({ task: "Task `SECRET_TITLE`", owner: "Max `SECRET_OWNER`", docs: {
      ...DOCS, "notes.md": "SECRET_DETAILS", "agent/private.md": "SECRET_AGENT",
      "artifacts/private.html": "SECRET_HTML", "review.json": "SECRET_REVIEW",
      "06-verify.md": "Checks passed.\n\n```ts\nSECRET_FENCE\n```\n\n`SECRET_INLINE`",
    }, items: [{ what: "SECRET_ITEM" }] }));
    expect(loaded.status).toBe("ready");
    expect(JSON.stringify(loaded)).not.toContain("SECRET_");
    if (loaded.status !== "ready" || loaded.kind !== "v2") throw new Error("Expected a workflow publication");
    expect(loaded.docs["06-verify.md"]).toContain("Checks passed.");
  });
});

describe("the approved document view", () => {
  it("shows the seven step names, the documents and comments without approval controls", async () => {
    const page = await html(<SharedView state={ready()} onSend={noSend} />);
    for (const step of ["Discuss", "Research", "Plan", "Outline", "Implement", "Verify", "Review"]) expect(page).toContain(`>${step}<`);
    expect(page).toContain("One deployment.");
    expect(page).toContain("Max shared this with you");
    expect(page).toContain("project source code is kept private");
    expect(page).toContain("Your name");
    expect(page).toContain(">Send to Max<");
    expect(page).not.toContain(">Approve<");
    expect(page).not.toContain("Request changes");
  });
  it("draws all seven steps, each reading its own document", async () => {
    const docs = { "01-discuss.md": "Seven discuss", "02-research.md": "Seven research", "03-plan.md": "Seven plan", "04-outline.md": "Seven outline", "05-implement.md": "Seven build", "06-verify.md": "Seven checks", "07-review.md": "Seven review" };
    const page = await html(<SharedView state={ready(docs)} onSend={noSend} />);
    const tabs = page.match(/<nav class="sh-tabs"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect([...tabs.matchAll(/>([A-Za-z]+)<\/button>/g)].map((m) => m[1])).toEqual(["Discuss", "Research", "Plan", "Outline", "Implement", "Verify", "Review"]);
    for (const [tab, text] of [["discuss", "Seven discuss"], ["research", "Seven research"], ["plan", "Seven plan"], ["outline", "Seven outline"], ["implement", "Seven build"], ["verify", "Seven checks"], ["review", "Seven review"]] as const)
      expect(await html(<SharedView state={ready(docs)} onSend={noSend} tab={tab} />)).toContain(text);
  });
  it("opens a task on the step it is at, and says a step not reached has not started", async () => {
    const docs = { "01-discuss.md": "Seven discuss", "02-research.md": "Seven research" };
    const at = (stage: string, tab?: "outline") => html(<SharedView state={{ ...ready(docs), stage }} onSend={noSend} tab={tab} />);
    expect(await at("research")).toContain("Seven research");
    expect(await at("outline", "outline")).toContain("Outline has not started yet.");
  });
  it("a missing future step is not started, and no artifact produces no mockup error", async () => {
    const page = await html(<SharedView state={ready()} onSend={noSend} tab="verify" />);
    expect(page).toContain("Verify has not started yet.");
    expect(page).not.toContain("shared-mockup-missing");
    expect(page).not.toContain("<iframe");
  });
  it("renders a PNG still and the plan's diagram, and never an HTML artifact or any other fence", async () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ1sAAAAASUVORK5CYII=";
    const docs = { ...DOCS, "plan-artifact.png": png, "artifacts/settings.html": "SECRET_HTML", "03-plan.md": "# Plan\n\n```artifact\nartifacts/settings.html\n```\n\n```ts\nSECRET_TS\n```\n\n```mermaid\nflowchart LR\n  A --> B\n```" };
    const page = await html(<SharedView state={ready(docs)} onSend={noSend} tab="plan" />);
    expect(page).toContain('alt="Plan artifact"');
    expect(page).toContain(png);
    // The diagram is part of the document and gets its frame; nothing else of a fence is carried.
    expect(page).toContain('data-testid="mermaid"');
    expect(page).not.toContain("SECRET_");
    expect(page).not.toContain("<iframe");
    expect(page).not.toContain("shared-mockup-missing");
  });
  it("gone and keyless links offer no comment form", async () => {
    for (const state of [{ status: "gone" }, { status: "no-key" }] as const) {
      const page = await html(<SharedView state={state} onSend={noSend} />);
      expect(page).not.toContain("Send to");
    }
  });
});
