#!/usr/bin/env node
/**
 * Records the README's walkthrough loop from the homepage's enlarged showcase card, and the hashes
 * of the App captures it plays on (src/lib/showcase-shots.json; showcase.test.ts compares them).
 * Run it after any of those captures changes, once the hero's positions in src/lib/showcase.ts are
 * checked against the new captures.
 *
 *   npx vite --port 5191 &                          # the site, from docs/site
 *   node scripts/record-showcase.mjs [--url http://localhost:5191] [--segments 13500-20600,40650-51500]
 *
 * The README shows a short highlight (the Plan step, then Review to the pull request) at 2x, because
 * GitHub's image proxy refuses images over 5 MiB; the whole walkthrough plays on the website. The
 * loops are written to --out (a temporary folder by default) and uploaded to the media bucket under
 * a new versioned name, which the README then names:
 *
 *   wrangler r2 object put qualitylayer-media/readme-walkthrough-<theme>-v<date>01.webp \
 *     --file <out>/readme-walkthrough-<theme>.webp --content-type image/webp --remote
 *
 * Needs Playwright (a dev dependency) and libwebp's cwebp and webpmux (`brew install webp`). Frames that
 * repeat are merged into one longer frame.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: {
  url: { type: "string", default: "http://localhost:5191" },
  fps: { type: "string", default: "12" },
  quality: { type: "string", default: "45" },
  /** The README's highlight, in ms of the walkthrough: the Plan step, then Review to the pull request. */
  segments: { type: "string", default: "13500-20600,40650-51500" },
  /** Pixels per CSS pixel while recording; the loop is then scaled to --width. */
  scale: { type: "string", default: "2" },
  out: { type: "string" },
  /** The loop's width: 1.5x the README's 804 px, sharp on high-density screens and under 5 MiB. */
  width: { type: "string", default: "1206" },
  themes: { type: "string", default: "light,dark" },
  /** Keeps the PNG frames in this folder, to try other encodings without recording again. */
  keep: { type: "string" },
} });
const step = 1000 / Number(values.fps);
const segments = values.segments.split(",").map((span) => span.split("-").map(Number));
const LIMIT = 5 * 1024 * 1024;

/** The captures the walkthrough plays on, and their hashes now. */
function shotHashes() {
  const src = readFileSync(join(site, "src/lib/showcase.ts"), "utf8");
  const shots = JSON.parse(src.match(/export const SHOTS: Shot\[\] = (\[[^\]]+\])/)[1]);
  const files = shots.flatMap((s) => ["light", "dark"].map((t) => (s === "plan" ? `public/hero/plan-desktop-${t}.webp` : `public/product/${s}-${t}.webp`)));
  return Object.fromEntries(files.map((f) => [f, createHash("sha256").update(readFileSync(join(site, f))).digest("hex")]));
}

const work = values.keep ? resolve(values.keep) : mkdtempSync(join(tmpdir(), "showcase-"));
mkdirSync(work, { recursive: true });
const browser = await chromium.launch();
try {
  for (const theme of values.themes.split(",")) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 698 }, deviceScaleFactor: Number(values.scale), colorScheme: theme });
    await page.goto(`${values.url}/?capture`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: ".hs-card .hs-pause{display:none!important}.hs-card{animation:none!important}" });
    await page.click(".sx-live");
    await page.waitForSelector(".hs-card");
    await page.waitForTimeout(1500);
    const box = await page.evaluate(() => {
      const a = document.querySelector(".hs-stage-card").getBoundingClientRect();
      const b = document.querySelector(".hs-steps").getBoundingClientRect();
      return { x: Math.round(a.left) - 2, y: Math.round(a.top) - 2, width: Math.round(a.width) + 4, height: Math.round(b.bottom - a.top) + 4 };
    });
    const duration = await page.evaluate(async () => {
      const player = window.__heroShowcase;
      // Load every screen once, so no frame catches an image arriving.
      for (let t = 0; t < 60000; t += 3000) { player.render(t); await new Promise((r) => setTimeout(r, 120)); }
      return player.duration;
    });
    const frames = [];
    let last = null;
    const times = segments.flatMap(([from, to]) => Array.from({ length: Math.ceil((Math.min(to, duration) - from) / step) }, (_, i) => from + i * step));
    for (const t of times) {
      await page.evaluate((at) => window.__heroShowcase.render(at), t);
      const png = await page.screenshot({ clip: box, animations: "disabled" });
      const hash = createHash("sha1").update(png).digest("hex");
      if (last && last.hash === hash) { last.ms += step; continue; }
      const file = join(work, `${theme}-${String(frames.length).padStart(4, "0")}.png`);
      writeFileSync(file, png);
      last = { file, hash, ms: step };
      frames.push(last);
    }
    await page.close();
    const out = resolve(values.out ?? work);
    mkdirSync(out, { recursive: true });
    const target = join(out, `readme-walkthrough-${theme}.webp`);
    writeFileSync(join(work, `${theme}.json`), JSON.stringify(frames.map((f) => [f.file, Math.round(f.ms)])));
    // Every frame is a complete, opaque WebP, assembled without blending (webpmux "-b"). img2webp's
    // delta frames blend over the previous frame and, being lossy, leave ghost trails behind zooms.
    const parts = [];
    for (const [i, f] of frames.entries()) {
      const part = join(work, `${theme}-full-${String(i).padStart(4, "0")}.webp`);
      execFileSync("cwebp", ["-q", values.quality, "-m", "6", "-sharp_yuv", "-quiet", "-resize", values.width, "0", f.file, "-o", part]);
      parts.push("-frame", part, `+${Math.round(f.ms)}+0+0+0-b`);
    }
    execFileSync("webpmux", [...parts, "-loop", "0", "-bgcolor", "255,255,255,255", "-o", target], { stdio: "ignore" });
    const size = statSync(target).size;
    console.log(`${theme}: ${frames.length} frames, ${(size / 1e6).toFixed(2)} MB -> ${target}`);
    if (size > LIMIT) throw new Error(`${target} is over 5 MiB, so GitHub would not show it: lower --quality or shorten --segments`);
  }
  writeFileSync(join(site, "src/lib/showcase-shots.json"), `${JSON.stringify(shotHashes(), null, 2)}\n`);
  console.log("Recorded the captures' hashes in src/lib/showcase-shots.json. Upload the loops under a new versioned name and update README.md.");
} finally {
  await browser.close();
  if (!values.keep && !values.out) console.log(`Frames and loops stay in ${work} until you upload them.`);
}
