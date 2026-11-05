import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import RECORDED from "./showcase-shots.json";
import { CHAPTERS, DURATION, SHOTS, STARTS, frameAt, seekTime, shotSrc } from "./showcase";
import { WORKFLOW_STEPS } from "./steps";

it("plays one chapter per workflow step, in order, back to back", () => {
  expect(CHAPTERS.map((c) => c.id)).toEqual(WORKFLOW_STEPS.map((s) => s.id));
  expect(STARTS[0]).toBe(0);
  expect(STARTS.at(-1)! + CHAPTERS.at(-1)!.dur).toBe(DURATION);
  for (const [i, start] of STARTS.entries()) expect(frameAt(start + 1).step).toBe(i);
});

it("keeps every zoom close enough to the 2x captures to stay sharp, and returns to the whole window", () => {
  for (const c of CHAPTERS) {
    const cams = c.beats.filter((b) => b[1] === "cam");
    for (const b of cams) if (b[2]) expect((b[2] as { s: number }).s).toBeLessThanOrEqual(2.4);
    const out = cams.at(-1)!;
    expect(out[2]).toBeNull();
    expect(out[0] + (out[3] as number)).toBeLessThanOrEqual(c.dur);
  }
});

it("never moves the camera outside the window", () => {
  for (let t = 0; t < DURATION; t += 50) {
    const { view: v } = frameAt(t);
    expect(v.tx).toBeLessThanOrEqual(0);
    expect(v.ty).toBeLessThanOrEqual(0);
    expect(v.tx).toBeGreaterThanOrEqual(100 - 100 * v.s - 1e-9);
    expect(v.ty).toBeGreaterThanOrEqual(100 - 100 * v.s - 1e-9);
  }
});

it("shows each step on its own screen, and after Approve the pull request", () => {
  for (const [i, c] of CHAPTERS.entries()) expect(frameAt(seekTime(i) + 400).to).toBe(c.id);
  const review = CHAPTERS.findIndex((c) => c.id === "review");
  const shots = new Set<string>();
  for (let t = STARTS[review] + 900; t < STARTS[review] + CHAPTERS[review].dur; t += 100) shots.add(frameAt(t).to);
  expect([...shots]).toEqual(["review", "review-approved", "pull-request"]);
});

it("loops: the time wraps around the whole walkthrough", () => {
  expect(frameAt(DURATION + 10)).toEqual(frameAt(10));
  expect(frameAt(-10)).toEqual(frameAt(DURATION - 10));
});

it("plays on the captures its positions were set against", () => {
  // Cursor, highlight and zoom positions in showcase.ts are set by hand on these captures. When one
  // changes (a screenshot refresh), play the hero and its card in both themes, fix what drifted, then
  // re-record the README animation with `node scripts/record-showcase.mjs`, which records the new hashes.
  const site = join(__dirname, "../..");
  const now = Object.fromEntries(SHOTS.flatMap((s) => (["light", "dark"] as const).map((t) => {
    const file = `public${shotSrc(s, t)}`;
    return [file, createHash("sha256").update(readFileSync(join(site, file))).digest("hex")];
  })));
  expect(now, "A walkthrough capture changed: check src/lib/showcase.ts against it and run scripts/record-showcase.mjs").toEqual(RECORDED);
});
