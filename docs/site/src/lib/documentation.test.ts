import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const doc = (path: string) => readFileSync(new URL(`../../../docusaurus/docs/${path}`, import.meta.url), "utf8");

describe("installation and build instructions", () => {
  // The README stays short (Max, 2026-10-14): it names the opt-in; the build command lives in the docs.
  it("uses direct Claude workflow opt-in in the README", () => {
    const readme = readFileSync(new URL("../../../../README.md", import.meta.url), "utf8");
    expect(readme).not.toContain("/goal /ql implement");
    expect(readme).toContain("QualityLayer runs only when you ask for it");
  });
  it("puts native Windows PowerShell installation with the App and WSL with Linux", () => {
    const install = doc("install.md");
    // Servers and WSL2 sit under "In your browser" as their own ### part; split at both levels.
    const sections = install.split(/^#{2,3} /m);
    const desktop = sections.find((section) => section.startsWith("On your computer\n"));
    const headless = sections.find((section) => section.split("\n")[0].includes("{#without-a-screen}"));
    expect(desktop).toContain("irm https://qualitylayer.dev/install.ps1 | iex");
    expect(desktop).toContain("This installs the App and the command line");
    expect(headless).toContain("curl -fsSL https://qualitylayer.dev/install.sh | bash");
    expect(headless).toContain("Install QualityLayer where your agent runs");
    expect(headless).toContain("**WSL2**");
    expect(headless).toContain("In your Windows browser");
    expect(headless).not.toContain("install.ps1");
  });

  it("never counts human-only prerequisites as passed while available work continues", () => {
    const implement = doc("steps/implement.md");
    expect(implement).toMatch(/human-only prerequisite never counts as passed/);
    expect(implement).toMatch(/Other work continues/);
    expect(implement).toMatch(/one question at the end of \[Verify\]/);
    expect(implement).toMatch(/the App never takes the secret/i);
    expect(implement).toMatch(/Native permission and sign-in prompts still need your response/);
    expect(implement).toMatch(/explicit stop or pause stays in force/);
    expect(implement).not.toMatch(/never stops to wait|Nothing waits for you/);
  });

  it("includes the document argument required to open an approval", () => {
    expect(doc("reference/commands.md")).toContain("qualitylayer gate open 03-plan.md");
    expect(doc("reference/commands.md")).toContain("gate open final");
  });

  it("explains explicit memory portability without implicit imports or Git writes", () => {
    const memory = doc("memory.md");
    expect(memory).toContain("Search, startup and export never import records automatically");
    expect(memory).toContain("QualityLayer never commits, pushes or pulls for memory");
    expect(memory).toContain("Missing repository files never retire local lessons");
    expect(memory).toContain("both candidates remain available");
    expect(memory).toContain("separate from restoring a retired lesson");
  });
});
