import { expect, it } from "vitest";
import { screensFromReview, withScreenStills } from "@ql/core/review/screen-pairs";
import { sharedScreenStills } from "@ql/core/team/publication";
import { addRemark, EMPTY, pending } from "./drafts";
import { parsePlan, remarksPayload } from "./sharing";

it("built pairs round-trip the publication boundary and unsupported pictures remain explicit omissions", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==";
  const review = "# Review\n\n## Screens\n\n- **settings** · 840 px · light · captured · stale\n  - Independent review: Field order matches.\n- **large** · 1280 px · dark · captured · current\n  - Independent review: No comparison recorded.\n";
  const plan = parsePlan(JSON.stringify({ docs: { "07-review.md": review }, stills: {
    "screen/settings/840/light": { title: "Settings", image: png, built: png },
    "screen/large/1280/dark": { title: "Large", image: "", outcome: "omitted: size" },
    "screen/hostile/840/light": { title: "Hostile", image: png, built: "data:text/html,unsafe" },
  } }));
  expect(plan?.stills?.["screen/settings/840/light"]?.built).toBe(png);
  expect(plan?.stills?.["screen/hostile/840/light"]).toEqual({ title: "Hostile", image: "", outcome: "omitted: unsupported" });
  const screens = withScreenStills(screensFromReview(plan!.docs["07-review.md"]), sharedScreenStills(plan!.stills));
  expect(screens[0]).toMatchObject({ key: "settings", built: png, stale: true, verdict: "Field order matches." });
  expect(screens[1]).toMatchObject({ key: "large", outcome: "omitted: size" });
  expect(screens[1]?.built).toBeUndefined();
});

it("a person note remains structured after draft storage and keeps passage context", () => {
  const drafts = addRemark(EMPTY, { kind: "passage", doc: "03-plan.md", quote: "Repeat", text: "For Max", for: "person", before: "Second ", after: " here", section: "scope" });
  const note = remarksPayload("Guest", pending(drafts, []), 1).annotations[0]!;
  expect(note.blockId).toBe("review");
  expect(JSON.parse(note.originalText)).toEqual({ t: "thread", note: true, for: "person", doc: "03-plan.md", quote: "Repeat", before: "Second ", after: " here", section: "scope" });
  const ordinary = remarksPayload("Guest", [{ kind: "passage", doc: "03-plan.md", quote: "Repeat", text: "Fix this", before: "Second ", after: " here", section: "scope" }], 1).annotations[0]!;
  expect(ordinary).toMatchObject({ blockId: "03-plan.md", originalText: "Repeat", text: "Fix this", before: "Second ", after: " here", section: "scope" });
});
