import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertSameSource, captureSource } from "./capture-source.mjs";

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ql-capture-source-"));
  roots.push(root);
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.test");
  put("qualitylayer/src/ui/App.tsx", "export const app = 'current';");
  put("docs/plans/notes.md", "Unrelated backend task");
  git("add", "."); git("commit", "-qm", "Fixture");
  return { root, put };
}

describe("public App capture provenance", () => {
  it("records committed UI hashes while ignoring unrelated task notes", () => {
    const { root, put } = fixture();
    const before = captureSource(root);
    expect(before.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(before.sourceTree).toMatch(/^[a-f0-9]{40}$/);
    expect(before.sourceInputs["qualitylayer/src/ui/App.tsx"]).toMatch(/^[a-f0-9]{64}$/);
    put("docs/plans/notes.md", "Another session updates backend notes");
    expect(captureSource(root)).toEqual(before);
  });
  it.each(["edited", "untracked"])("blocks %s UI in published captures but allows labelled review captures", (kind) => {
    const { root, put } = fixture();
    put(kind === "edited" ? "qualitylayer/src/ui/App.tsx" : "qualitylayer/src/ui/NewControl.tsx", "new UI");
    expect(() => captureSource(root)).toThrow("require committed App UI");
    const review = captureSource(root, { review: true });
    expect(review.sourceDirtyFiles).toHaveLength(1);
    expect(Object.keys(review.sourceInputs)).toContain(kind === "edited" ? "qualitylayer/src/ui/App.tsx" : "qualitylayer/src/ui/NewControl.tsx");
  });
  it("refuses changed source during a review run", () => {
    const { root, put } = fixture();
    const before = captureSource(root, { review: true });
    put("qualitylayer/src/ui/App.tsx", "UI changed mid-capture");
    expect(() => assertSameSource(before, captureSource(root, { review: true }))).toThrow("changed during the run");
  });
  it("records a deleted input and refuses a later restoration during capture", () => {
    const { root, put } = fixture();
    const path = "qualitylayer/src/ui/App.tsx";
    rmSync(join(root, path));
    expect(() => captureSource(root)).toThrow("require committed App UI");
    const deleted = captureSource(root, { review: true });
    expect(deleted.sourceInputs[path]).toBeNull();
    expect(deleted.sourceDirtyFiles).toHaveLength(1);
    put(path, "restored UI");
    expect(() => assertSameSource(deleted, captureSource(root, { review: true }))).toThrow("changed during the run");
  });
});
