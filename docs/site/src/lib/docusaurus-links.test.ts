import { describe, expect, it } from "vitest";
import { docsSourceUrl } from "../../../docusaurus/source-links";

describe("documentation source links", () => {
  it("links documentation pages to their stable source", () => {
    expect(docsSourceUrl("install.md")).toBe("https://github.com/maxritter/qualitylayer/blob/main/docs/docusaurus/docs/install.md");
    expect(docsSourceUrl("memory.md")).toBe("https://github.com/maxritter/qualitylayer/blob/main/docs/docusaurus/docs/memory.md");
  });
});
