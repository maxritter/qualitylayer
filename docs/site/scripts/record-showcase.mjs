#!/usr/bin/env node
/**
 * Records the README's walkthrough loop from the homepage's enlarged showcase card, and the hashes
 * of the App captures it plays on (src/lib/showcase-shots.json; showcase.test.ts compares them).
 * Run it after any of those captures changes, once the hero's positions in src/lib/showcase.ts are
 * checked against the new captures.
 *
 *   npx vite --port 5191 &                          # the site, from docs/site
 *   node scripts/record-showcase.mjs [--url http://localhost:5191] [--segments 0-51000]
 *
 * The README plays the whole walkthrough, all seven steps and the pull request. GitHub's image proxy
 * refuses images over 5 MiB, so frames are encoded by what they show: a frame the picture rests on
 * (a highlight, a step's page) keeps --quality, a frame of a camera move or a fade takes
 * --motion-quality, which motion hides. The loops are written to --out (a temporary folder by
 * default) and uploaded to the media bucket under a new versioned name, which the README then names:
 *
 *   wrangler r2 object put qualitylayer-media/readme-walkthrough-<theme>-v<date>01.webp \
 *     --file <out>/readme-walkthrough-<theme>.webp --content-type image/webp --remote
 *
 * Needs Playwright (a dev dependency) and libwebp's cwebp and webpmux (`brew install webp`). Frames that
 * repeat are merged into one longer frame.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import sharp from "sharp";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: {
  url: { type: "string", default: "http://localhost:5191" },
  fps: { type: "string", default: "12" },
  /** WebP quality of the frames the picture rests on, of the frames in motion, and of a changed rectangle alone. */
  quality: { type: "string", default: "70" },
  "motion-quality": { type: "string", default: "30" },
  "patch-quality": { type: "string", default: "68" },
  /** The parts of the walkthrough to record, in ms; "all" records it whole. */
  segments: { type: "string", default: "all" },
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
const spans = (duration) => values.segments === "all" ? [[0, duration]] : values.segments.split(",").map((span) => span.split("-").map(Number));
const LIMIT = 5 * 1024 * 1024;

/** The captures the walkthrough plays on, and their hashes now. */
function shotHashes() {
  const src = readFileSync(join(site, "src/lib/showcase.ts"), "utf8");
  const shots = JSON.parse(src.match(/export const SHOTS: Shot\[\] = (\[[^\]]+\])/)[1]);
  const files = shots.flatMap((s) => ["light", "dark"].map((t) => `public/product/${s}-${t}.webp`));
  return Object.fromEntries(files.map((f) => [f, createHash("sha256").update(readFileSync(join(site, f))).digest("hex")]));
}

/**
 * The webpmux frame arguments for a loop. Every frame replaces what it covers without blending
 * (webpmux "-b"): img2webp's delta frames blend lossy pixels over the previous frame and leave ghost
 * trails behind zooms. A frame where only the cursor or a highlight changed is stored as that
 * rectangle alone, at --patch-quality. Camera moves and fades are whole frames at --motion-quality,
 * and the first still frame after one is stored whole again at --quality, so a picture at rest never
 * keeps the pixels of a moving one.
 */
async function encodeFrames(frames, theme) {
  const width = Number(values.width);
  const parts = [];
  let previous = null, moving = false;
  for (const [i, f] of frames.entries()) {
    const { data, info } = await sharp(f.file).resize(width).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { height } = info;
    const changed = previous ? changedBox(previous, data, width, height) : null;
    const small = changed !== null && changed.w * changed.h < width * height * 0.3;
    const rests = f.ms > step * 1.5;
    const png = join(work, `${theme}-enc-${String(i).padStart(4, "0")}.png`), part = png.replace(/\.png$/, ".webp");
    const image = sharp(data, { raw: { width, height, channels: 3 } });
    if (small && !moving) {
      await image.extract({ left: changed.x, top: changed.y, width: changed.w, height: changed.h }).png().toFile(png);
      execFileSync("cwebp", ["-q", values["patch-quality"], "-m", "6", "-sharp_yuv", "-quiet", png, "-o", part]);
      parts.push("-frame", part, `+${Math.round(f.ms)}+${changed.x}+${changed.y}+0-b`);
    } else {
      const settles = small && moving;
      await image.png().toFile(png);
      execFileSync("cwebp", ["-q", settles || rests ? values.quality : values["motion-quality"], "-m", "6", "-sharp_yuv", "-quiet", png, "-o", part]);
      parts.push("-frame", part, `+${Math.round(f.ms)}+0+0+0-b`);
      moving = !settles && !rests;
    }
    previous = data;
  }
  return parts;
}

/** The rectangle where two RGB frames differ, a little larger and on even offsets (WebP's frame grid); a 2 px box when none. */
function changedBox(a, b, width, height) {
  const differs = (o) => Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]) > 6;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let i = 0; i < width * height; i++) {
    if (!differs(i * 3)) continue;
    const x = i % width, y = Math.floor(i / width);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (x1 < 0) return { x: 0, y: 0, w: 2, h: 2 };
  x0 = Math.max(0, x0 - 6) & ~1;
  y0 = Math.max(0, y0 - 6) & ~1;
  return { x: x0, y: y0, w: Math.min(width, x1 + 7) - x0, h: Math.min(height, y1 + 7) - y0 };
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
    const times = spans(duration).flatMap(([from, to]) => Array.from({ length: Math.ceil((Math.min(to, duration) - from) / step) }, (_, i) => from + i * step));
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
    execFileSync("webpmux", [...await encodeFrames(frames, theme), "-loop", "0", "-bgcolor", "255,255,255,255", "-o", target], { stdio: "ignore" });
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
