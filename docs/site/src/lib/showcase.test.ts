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

it("zooms only as far as the work area beside the App's sidebar, and ends on the whole window", () => {
  for (const c of CHAPTERS) {
    const cams = c.beats.filter((b) => b[1] === "cam");
    for (const b of cams) if (b[2]) expect((b[2] as { s: number }).s).toBeLessThanOrEqual(1.3);
    for (const b of cams) expect(b[0] + (b[3] as number)).toBeLessThanOrEqual(c.dur);
  }
  expect(frameAt(DURATION - 1).view).toEqual({ s: 1, tx: 0, ty: 0 });
});

it("shows the step rail whenever it clicks a step", () => {
  for (const start of STARTS) {
    const f = frameAt(start + 700);
    expect(f.press).toBe(true);
    expect(f.cursor.y).toBeGreaterThanOrEqual(-f.view.ty / f.view.s);
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

it("keeps every highlight and click inside the part of the window the camera shows", () => {
  for (let t = 0; t < DURATION; t += 50) {
    const f = frameAt(t);
    const left = -f.view.tx / f.view.s, top = -f.view.ty / f.view.s, size = 100 / f.view.s;
    if (f.mark && f.markOn > 0.99) {
      expect(f.mark.x).toBeGreaterThanOrEqual(left - 0.5);
      expect(f.mark.y).toBeGreaterThanOrEqual(top - 0.5);
      expect(f.mark.x + f.mark.w).toBeLessThanOrEqual(left + size + 0.5);
      expect(f.mark.y + f.mark.h).toBeLessThanOrEqual(top + size + 0.5);
    }
    if (f.press) for (const v of [f.cursor.x - left, f.cursor.y - top]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(size);
    }
  }
});

it("captions each step and, after Approve, the pull request", () => {
  const said = new Set<string>();
  for (let t = 0; t < DURATION; t += 100) said.add(frameAt(t).caption);
  expect([...said].sort()).toEqual([...WORKFLOW_STEPS.map((s) => s.id), "pull-request"].sort());
});

it("loops: the time wraps around the whole walkthrough", () => {
  expect(frameAt(DURATION + 10)).toEqual(frameAt(10));
  expect(frameAt(-10)).toEqual(frameAt(DURATION - 10));
});

it("plays on the captures its positions were set against", () => {
  // The positions come from tour-geometry.json, measured with these captures. When one changes (a
  // screenshot refresh), play the hero and its card in both themes, then re-record the README
  // animation with `node scripts/record-showcase.mjs`, which records the new hashes.
  const site = join(__dirname, "../..");
  const now = Object.fromEntries(SHOTS.flatMap((s) => (["light", "dark"] as const).map((t) => {
    const file = `public${shotSrc(s, t)}`;
    return [file, createHash("sha256").update(readFileSync(join(site, file))).digest("hex")];
  })));
  expect(now, "A walkthrough capture changed: check src/lib/showcase.ts against it and run scripts/record-showcase.mjs").toEqual(RECORDED);
});
