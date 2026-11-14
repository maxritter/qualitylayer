// The approved social image uses the website's fonts, mark and workflow roles.
// Usage: node scripts/export-social.mjs [--out <png>]
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(site, '../..');
const args = process.argv.slice(2);
const out = args.includes('--out') ? resolve(args[args.indexOf('--out') + 1]) : `${site}/public/og.png`;
const font = async name => (await readFile(`${site}/public/fonts/${name}`)).toString('base64');
const mark = (await readFile(`${site}/public/brand/qualitylayer-mark.svg`, 'utf8'))
  .replace(/<style>[\s\S]*?<\/style>/, '').replace(/ width="\d+" height="\d+"/, '');
const user = '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="5"/>';
const steps = [
  ['Plan', 'Agree on what to build', '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M12 12V8"/>', true],
  ['Implement', 'Build and test', '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6m6-17-4 22"/>', false],
  ['Verify', 'Check, then review', '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>', true],
];
const svg = content => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Workflow share image · QualityLayer</title><style>
@font-face{font-family:Geist;src:url(data:font/woff2;base64,${await font('geist-latin.woff2')}) format('woff2');font-weight:100 900}
@font-face{font-family:'Geist Mono';src:url(data:font/woff2;base64,${await font('geist-mono-latin.woff2')}) format('woff2');font-weight:100 900}
*{box-sizing:border-box}body{margin:0;background:#dedede;font-family:Geist,sans-serif;color:#0d0d0d;-webkit-font-smoothing:antialiased}.share{width:1200px;height:630px;padding:66px 72px 0;background:#f4f4f4;overflow:hidden;transform-origin:top left}.top{display:flex;justify-content:space-between;align-items:center}.brand{display:flex;align-items:center;gap:13px;color:#2076c5;font-size:32px;font-weight:800;letter-spacing:-.035em}.brand svg{width:36px;height:34px;fill:currentColor}.url{color:#525252;font:20px 'Geist Mono',monospace}h1{margin:40px 0 0 -3px;font-size:88px;font-weight:800;letter-spacing:-.045em;line-height:1.01}h1>span{display:block}em{font-style:normal;color:#986207}ol{position:relative;display:grid;grid-template-columns:repeat(3,1fr);list-style:none;margin:48px 0 0;padding:0}ol:before{content:'';position:absolute;top:30px;left:16.667%;right:16.667%;height:2px;background:#c7c7c7}li{position:relative;display:flex;flex-direction:column;align-items:center}.tile{position:relative;display:grid;place-items:center;width:62px;height:62px;border:1px solid #8a650f;border-radius:17px;background:#faf4e7;color:#986207}.tile>svg{width:28px;height:28px}.implement .tile{color:#2076c5;background:#eaf2fa;border-color:#78a6d1}.verify .tile{color:#755598;background:#f0ebf6;border-color:#b09ac6}.human{position:absolute;top:-12px;right:-12px;display:grid;place-items:center;width:28px;height:28px;border:3px solid #f4f4f4;border-radius:50%;background:#ffb72c;color:#141414}.human svg{width:15px;height:15px}h2{margin:12px 0 0;font-size:22px;letter-spacing:-.025em}h2 span{font-weight:500;color:#666;margin-right:6px}.description{margin:4px 0 0;font-size:17px;color:#525252}.role{margin:12px 0 0;display:inline-flex;align-items:center;gap:7px;font-size:17px;font-weight:650;color:#986207}.role svg{width:17px;height:17px}.implement .role{color:#1b68af}.role-agent{width:7px;height:7px;border-radius:50%;background:currentColor}
</style></head><body><main class="share" id="share-image" data-screen-label="Human and agent roles"><div class="top"><div class="brand">${mark}Quality by design</div><span class="url">qualitylayer.dev</span></div><h1>The software factory<span>with <em>you</em> in the loop</span></h1><ol>${steps.map(([name, line, icon, human], i) => `<li class="${name.toLowerCase()}"><span class="tile">${svg(icon)}${human ? `<span class="human">${svg(user)}</span>` : ''}</span><h2><span>${i + 1}</span>${name}</h2><p class="description">${line}</p><p class="role">${human ? svg(user) : '<span class="role-agent"></span>'}${human ? 'You approve' : 'Agents work'}</p></li>`).join('')}</ol></main><script>function fit(){const s=Math.min(1,innerWidth/1200);const el=document.querySelector('.share');el.style.transform='scale('+s+')';document.body.style.height=(630*s)+'px'}addEventListener('resize',fit);fit()</script></body></html>`;
const finalHtml = html;
const require = createRequire(resolve(repo, 'qualitylayer/package.json'));
const { chromium } = require('@playwright/test');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(finalHtml, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out, type: 'png' });
} finally {
  await browser.close();
}
console.log(`Wrote the 1200×630 social image to ${out}.`);
