// The 1200 × 630 social image, drawn as the home page's hero is: the blue "Quality by design"
// lockup, the slogan in heavy Geist with "you" in amber, and the seven steps as one line
// of equal stations. Chromium renders it with the site's own fonts, so the type matches the page.
// Usage: node scripts/export-social.mjs [--out <png>]
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(site, "../..");
const args = process.argv.slice(2);
const out = args.includes("--out") ? resolve(args[args.indexOf("--out") + 1]) : `${site}/public/og.png`;

const font = (name) => readFile(`${site}/public/fonts/${name}`).then((data) => data.toString("base64"));
const mark = (await readFile(`${site}/public/brand/qualitylayer-mark.svg`, "utf8"))
  .replace(/<style>[\s\S]*?<\/style>/, "").replace(/ width="\d+" height="\d+"/, "");

// Lucide's icons (ISC), as on the page.
const STEPS = [
  ["Discuss", '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'],
  ["Research", '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'],
  ["Plan", '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>'],
  ["Outline", '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>'],
  ["Implement", '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>'],
  ["Verify", '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>'],
  ["Review", '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m9 15 2 2 4-4"/>'],
];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Geist;src:url(data:font/woff2;base64,${await font("geist-latin.woff2")}) format("woff2");font-weight:100 900}
@font-face{font-family:"Geist Mono";src:url(data:font/woff2;base64,${await font("geist-mono-latin.woff2")}) format("woff2");font-weight:100 900}
*{box-sizing:border-box}
body{margin:0;width:1200px;height:630px;padding:84px 72px 0;background:#f4f4f4;color:#0d0d0d;font-family:Geist,sans-serif;-webkit-font-smoothing:antialiased}
.top{display:flex;align-items:center;justify-content:space-between}
.qbd{display:flex;align-items:center;gap:13px;margin:0;color:#2076c5;font-size:36px;font-weight:800;letter-spacing:-.035em;line-height:1}
.qbd svg{width:40px;height:37px;fill:currentColor}
.url{color:#525252;font:400 21px "Geist Mono",monospace}
h1{margin:46px 0 0 -4px;font-size:96px;font-weight:800;letter-spacing:-.04em;line-height:.98}
:root{--mx-human-ink:#986207}h1 span{display:block;color:inherit}h1 .you{display:inline;color:var(--mx-human-ink)}
ol{position:relative;display:grid;grid-template-columns:repeat(7,1fr);margin:68px 0 0;padding:0;list-style:none}
ol:before{content:"";position:absolute;top:29px;left:calc(100%/14);right:calc(100%/14);height:2px;background:#cfcfcf}
li{position:relative;display:flex;flex-direction:column;align-items:center;gap:12px}
.tile{display:grid;place-items:center;width:60px;height:60px;border:1px solid #cfcfcf;border-radius:18px;background:#fff;box-shadow:0 8px 24px rgb(0 0 0 / 5%)}
.tile svg{width:26px;height:26px;fill:none;stroke:#0d0d0d;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
b{font-size:20px;font-weight:700;letter-spacing:-.02em;white-space:nowrap}
b i{margin-right:.3em;font-style:normal;font-weight:600;color:#666}
</style></head><body>
<div class="top"><p class="qbd">${mark}Quality by design</p><span class="url">qualitylayer.dev</span></div>
<h1>The software factory <span>with <span class="you">you</span> in the loop</span></h1>
<ol>${STEPS.map(([name, icon], i) => `<li><span class="tile"><svg viewBox="0 0 24 24">${icon}</svg></span><b><i>${i + 1}</i>${name}</b></li>`).join("")}</ol>
</body></html>`;

const require = createRequire(resolve(repo, "qualitylayer/package.json"));
const { chromium } = require("@playwright/test");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out, type: "png" });
} finally {
  await browser.close();
}
console.log(`Wrote the 1200×630 social image to ${out}.`);
