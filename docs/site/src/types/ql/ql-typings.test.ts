// The site types the App's Reader by hand (see step-document.d.ts). These checks keep the hand-written
// names in step with the App's own source, which Vite loads: a prop or an export the App renames fails here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../../../../../qualitylayer/src/ui/${path}`, import.meta.url), "utf8");
const typing = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

/** The names a type literal declares: `name:` and `name?:` at the start of a line. */
const propsOf = (text: string) => [...text.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1] as string);

describe("the site's typings of the App's modules", () => {
  it("StepDocument takes exactly the props the typing names", () => {
    const app = source("steps/StepDocument.tsx");
    const props = app.slice(app.indexOf("type Props = {"), app.indexOf("\n}\n", app.indexOf("type Props = {")));
    const mine = typing("step-document.d.ts");
    const declared = mine.slice(mine.indexOf("export type StepDocumentProps = {"), mine.indexOf("\n};", mine.indexOf("export type StepDocumentProps = {")));
    expect(propsOf(declared).sort()).toEqual(propsOf(props).sort());
  });

  it("a comment needs only what the Reader reads, and every one of those is a field of the App's comment", () => {
    const comment = source("../core/gate/comments.ts");
    for (const field of propsOf(typing("step-document.d.ts").split("export type StepComment = {")[1]?.split("};")[0] ?? "")) {
      expect(comment).toMatch(new RegExp(`^\\s+${field}\\??:`, "m"));
    }
  });

  it("the App still exports what the site imports from it", () => {
    expect(source("reader/MermaidBlock.tsx")).toMatch(/export function loadMermaidFrom\(load: \(\) => Promise<MermaidModule>\)/);
    expect(source("steps/StepDocument.tsx")).toMatch(/export function StepDocument\(/);
    expect(source("components/ui/button.tsx")).toMatch(/export \{[^}]*\bButton\b/);
    expect(source("components/ui/sonner.tsx")).toMatch(/export \{ Toaster \}/);
  });

  it("the Button typing names the App's variants and sizes", () => {
    const app = source("components/ui/button.tsx");
    const mine = typing("button.d.ts");
    const words = mine.split("\n").filter((line) => /^\s+(variant|size)\?:/.test(line)).flatMap((line) => line.match(/"[a-z-]+"/g) ?? []);
    expect(words.length).toBeGreaterThan(10);
    for (const word of words) {
      const bare = word.slice(1, -1);
      expect(app).toMatch(new RegExp(`(^|\\s)"?${bare}"?:`, "m"));
    }
  });
});
