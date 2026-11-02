import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMPARE } from "./pricing";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const diagrams = join(repo, "docs/docusaurus/static/img/diagrams");
const read = (path: string) => readFileSync(join(repo, path), "utf8");
const words = (svg: string) => [...svg.matchAll(/<(?:text|title)\b[^>]*>(.*?)<\/(?:text|title)>/gs)].map((m) => m[1]).join(" ");

describe("current public illustrations and guides", () => {
  it("regenerates every diagram from its source without restoring the old interaction", () => {
    const output = mkdtempSync(join(tmpdir(), "ql-public-diagrams-"));
    try {
      const run = spawnSync("python3", [join(repo, "docs/docusaurus/scripts/diagrams.py"), output], { encoding: "utf8" });
      expect(run.status, run.stderr).toBe(0);
      const images = readdirSync(output).filter((name) => name.endsWith(".svg"));
      expect(images.length).toBeGreaterThan(70);
      for (const name of images) {
        const svg = readFileSync(join(output, name), "utf8");
        expect(svg, `${name} is stale; regenerate diagrams.py`).toBe(readFileSync(join(diagrams, name), "utf8"));
        expect(words(svg), name).not.toMatch(/\bNeeds you\b|one question at a time|question (?:N|\d+)\b|Approving takes the open ones|nothing to type here/i);
      }
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });

  it("keeps batch answers immediate in the Discuss guide", () => {
    const discuss = read("docs/docusaurus/docs/steps/discuss.md");
    expect(discuss).toMatch(/batch/i);
    expect(discuss).toContain("Independent choices can arrive together");
    expect(discuss).toContain("a dependent choice follows the answer it needs");
    expect(discuss).toContain("Answer in any order");
    expect(discuss).toMatch(/immediately|at once/);
  });

  it("keeps build workflow autonomous while respecting native permissions and explicit stops", () => {
    const readme = read("README.md");
    expect(readme).not.toMatch(/No waiting while it builds|Nothing waits for you/);
    const implement = read("docs/docusaurus/docs/steps/implement.md");
    expect(implement).toContain("Outline, Implement and Verify ask no workflow questions until Review");
    expect(implement).toContain("stays unverified for Review");
    expect(implement).toContain("Native permission and sign-in prompts still need your response");
    expect(implement).toContain("explicit stop or pause stays in force");
  });

  it("leads the pricing comparison with the whole workflow and both approvals", () => {
    const rows = COMPARE.flatMap((group) => group.rows);
    const workflow = rows[0];
    expect(workflow.feature).toBe("The whole workflow");
    expect(workflow.note).toMatch(/approval of the Plan and of the final Review/);
    expect(workflow.solo).toBe(true);
    expect(workflow.team).toBe(true);
    expect(rows.some((row) => /Done means point separately/.test(row.feature))).toBe(false);
  });
});
